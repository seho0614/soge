import {
  CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, from, lastValueFrom } from 'rxjs';
import { DatabaseService } from '../db/database.service';
import { PolicyViolation, StateConflict } from './errors';
import { ExternalMarks, RequestCtx } from './request-context';

/**
 * 결제 · 코드 발급은 Idempotency-Key 헤더가 필수입니다.
 * PG 웹훅은 재전송되고, 사용자는 버튼을 두 번 누릅니다.
 *
 * ── 10/6 (v10.18 · D022) 작업 **전에** 선점합니다 ───────────────────────────
 * 전에는 「조회 → 실행 → 저장」 순서라 같은 키의 요청이 동시에 오면 둘 다 실행됐습니다
 * (실측: 같은 키 10건 → 결제 승인 요청 10건 · 1건 성공 · 9건 PAYMENT_FAILED).
 *
 *   1. 줄을 먼저 넣습니다(INSERT … ON CONFLICT DO NOTHING · state PROCESSING). 줄이 이미 있으면
 *        본문 해시가 다름      → 409 IDEMPOTENCY_KEY_REUSED
 *        SUCCEEDED            → 저장된 응답을 그대로
 *   2. 실행권은 DB 잠금(pg_try_advisory_xact_lock)을 잡은 요청 하나만 가집니다. 못 잡으면 409 REQUEST_IN_PROGRESS.
 *      잠금은 그 요청의 트랜잭션이 끝나면(성공 · 실패 · 서버 종료) 풀립니다 — **시간이 지났다고 풀지 않습니다.**
 *   3. 처리 결과(SUCCEEDED · 응답 · HTTP 상태)는 업무 자료와 **같은 트랜잭션**에서 적습니다.
 *      업무 자료만 저장되고 기록이 빠지거나, 그 반대가 되는 일이 없습니다.
 *   4. 실패해도 키를 지우지 않습니다.
 *        외부 결제를 건드리지 않았거나 거절이 확정된 실패  → FAILED  (같은 키로 다시 할 수 있음)
 *        결제를 시도했고 결과가 확정되지 않은 실패          → UNKNOWN (다시 오면 처리 함수가 결제 결과부터 대조)
 *      「처리 중」으로 남은 줄(처리하다 서버가 죽음)도 같습니다 — 잠금이 풀려 있으면 다시 실행하되,
 *      처리 함수가 결제사에 먼저 물어 이미 승인된 결제를 또 받지 않습니다(payment-recover.ts).
 *
 * 이 장치를 쓰는 처리 함수는 **외부 결제를 대조하며 다시 실행해도 안전**해야 합니다(지금은 구독 시작 · 소개코드 발급 둘).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger(IdempotencyInterceptor.name);
  constructor(private readonly db: DatabaseService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['idempotency-key'] as string | undefined;

    if (!raw) {
      throw new PolicyViolation(
        'IDEMPOTENCY_KEY_REQUIRED',
        '이 요청에는 Idempotency-Key 헤더가 필요합니다.',
      );
    }
    if (raw.length > 200) {
      throw new PolicyViolation('IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Key 는 200자 이하여야 합니다.');
    }

    // 같은 키를 다른 사용자가 보내면 남의 응답이 돌아갑니다. 요청자 · 작업 경로로 격리합니다.
    const actor = RequestCtx.actorId();
    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const key = `${actor ?? 'anon'}:${route}:${raw}`;
    const legacyKey = actor ? `${actor}:${raw}` : raw;
    const hash = createHash('sha256').update(canonical(req.body ?? {})).digest('hex');
    const status = req.method === 'POST' ? 201 : 200;

    return from(this.run({ key, legacyKey, actor, route, raw, hash, status }, next));
  }

  private async run(
    k: { key: string; legacyKey: string; actor?: string; route: string; raw: string; hash: string; status: number },
    next: CallHandler,
  ): Promise<unknown> {
    // 0) 고치기 전에 쌓인 줄(사용자:키) — 그때의 응답을 그대로 돌려줍니다
    const legacy = await this.db.query<{ response: unknown }>(
      `SELECT response FROM idempotency_records WHERE key = $1 AND route IS NULL`, [k.legacyKey]);
    if (legacy[0]) return legacy[0].response;

    // 1) 선점 — 줄을 먼저 넣습니다
    const claimed = await this.db.query(
      `INSERT INTO idempotency_records (key, account_id, route, raw_key, request_hash, state, started_at, attempts)
       VALUES ($1, $2, $3, $4, $5, 'PROCESSING', now(), 0)
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [k.key, k.actor ?? null, k.route, k.raw, k.hash]);
    if (!claimed.length) {
      const [row] = await this.db.query<{ request_hash: string; state: string; response: unknown }>(
        `SELECT request_hash, state, response FROM idempotency_records WHERE key = $1`, [k.key]);
      if (row && row.request_hash !== k.hash) {
        throw new StateConflict('IDEMPOTENCY_KEY_REUSED',
          '같은 요청 키로 다른 내용을 보냈습니다. 새 요청에는 새 키를 쓰십시오.');
      }
      if (row?.state === 'SUCCEEDED') return row.response;
    }

    // 2) 실행 — 잠금을 잡은 요청만. 외부 결제 표시는 처리 함수가 남깁니다(payment-recover.ts)
    const marks: ExternalMarks = {};
    const store = RequestCtx.get();
    if (store) store.ext = marks;

    let out: { replay?: unknown; result?: unknown };
    try {
      out = await this.db.transaction(async () => {
        const [l] = await this.db.query<{ ok: boolean }>(
          `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok`, [k.key]);
        if (!l?.ok) throw new InProgress();

        const [cur] = await this.db.query<{ state: string; response: unknown }>(
          `SELECT state, response FROM idempotency_records WHERE key = $1 FOR UPDATE`, [k.key]);
        if (cur?.state === 'SUCCEEDED') return { replay: cur.response };   // 잠금을 기다리는 사이 먼저 끝남

        const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
        await this.db.query(
          `UPDATE idempotency_records
              SET state = 'SUCCEEDED', response = $2::jsonb, http_status = $3, completed_at = now(),
                  attempts = attempts + 1, error = NULL, pay_ref = $4::jsonb
            WHERE key = $1`,
          [k.key, JSON.stringify(result ?? {}), k.status, marks.payment ? JSON.stringify(marks.payment) : null]);
        return { result };
      });
    } catch (e: any) {
      if (e instanceof InProgress) {
        throw new StateConflict('REQUEST_IN_PROGRESS',
          '같은 요청을 처리하는 중입니다. 잠시 뒤 결과를 확인해 주십시오.');
      }
      /* 실패 — 키를 지우지 않습니다. 결제를 시도했고 거절이 확정되지 않았으면 「결과 불명확」입니다
       * (승인은 됐는데 응답만 끊겼거나, 승인 뒤 우리 쪽 저장이 실패했을 수 있습니다). */
      const pay = marks.payment;
      const state = pay && pay.state !== 'DECLINED' ? 'UNKNOWN' : 'FAILED';
      const http = e instanceof HttpException ? e.getStatus() : 500;
      const body = e instanceof HttpException ? e.getResponse() : { message: String(e?.message ?? e).slice(0, 300) };
      await this.db.query(
        `UPDATE idempotency_records
            SET state = $2, http_status = $3, error = $4::jsonb, pay_ref = $5::jsonb,
                completed_at = now(), attempts = attempts + 1
          WHERE key = $1 AND state <> 'SUCCEEDED'`,
        [k.key, state, http, JSON.stringify(body ?? {}), pay ? JSON.stringify(pay) : null],
      ).catch((err) => this.log.error(`중복 요청 기록 갱신 실패 (${k.route}): ${err?.message}`));
      if (state === 'UNKNOWN') {
        this.log.warn(`결제 결과 불명확 — 같은 키로 다시 오면 결제 결과를 대조합니다 (${k.route} · ${pay?.paymentKey ?? pay?.orderId ?? '-'})`);
      }
      throw e;
    }
    return 'replay' in out ? out.replay : out.result;
  }
}

/**
 * 요청 키가 **있을 때만** 같은 요청을 한 번만 처리합니다 (v10.27 · G-171).
 *
 * 소개몰 주문 생성(POST /health/orders)은 화면이 Idempotency-Key 를 보내 왔지만 서버가 쓰지 않아,
 * API 로 같은 본문을 두 번 보내면 주문이 2건 생겼습니다. 키가 있으면 위의 장치를 그대로 쓰고,
 * 키가 없는 기존 호출(시안의 서버 연동 · 운영 도구 · 시험)은 지금처럼 그대로 처리합니다.
 */
@Injectable()
export class OptionalIdempotencyInterceptor extends IdempotencyInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = ctx.switchToHttp().getRequest().headers['idempotency-key'] as string | undefined;
    if (!raw || !String(raw).trim()) return next.handle();
    return super.intercept(ctx, next);
  }
}

class InProgress extends Error {}

/** 키 순서와 무관하게 같은 내용이면 같은 글이 되게 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((x) => o[x] !== undefined)
    .map((x) => JSON.stringify(x) + ':' + canonical(o[x])).join(',') + '}';
}

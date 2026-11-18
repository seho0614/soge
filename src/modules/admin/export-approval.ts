/* ---------------------------------------------------------------------
 * v10.366 (D238 · docs/501) — 개인정보 대량 내려받기 승인
 *
 *   대상 4곳: POINT_REPORT(포인트 원천징수 신고 자료 · 주민등록번호) · AUDIT_EXPORT(감사 기록 CSV)
 *            NOTICE_READS(공지 읽음 CSV) · RATE_READS(요율 공지 읽음 CSV)
 *   흐름: 요청(사유) → 다른 SUPER 가 승인(SUPER 가 요청자 한 명뿐이면 스스로 · solo) → 승인 뒤 24시간 안 한 번 내려받기.
 *   내려받기 API 에는 @ExportGate(대상) 만 붙입니다 — ?ticket=<요청 번호> 를 먼저 확인하고, 성공하면 쓴 것으로 남깁니다.
 *   한 사람 하루(한국) 10건까지 요청.
 * ------------------------------------------------------------------- */
import { applyDecorators, CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiQuery } from '@nestjs/swagger';
import { from, Observable, switchMap, concatMap } from 'rxjs';
import { DatabaseService } from '../../db/database.service';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

export const EXPORT_TARGETS = ['POINT_REPORT', 'AUDIT_EXPORT', 'NOTICE_READS', 'RATE_READS', 'ACCT_JOURNAL', 'ACCT_TAX'] as const;   // v10.382 · 383 (D242) 전표 · 신고 자료
export type ExportTarget = typeof EXPORT_TARGETS[number];
export const EXPORT_KO: Record<ExportTarget, string> = {
  POINT_REPORT: '포인트 원천징수 신고 자료', AUDIT_EXPORT: '감사 기록 CSV', NOTICE_READS: '공지 읽음 CSV', RATE_READS: '요율 공지 읽음 CSV',
  ACCT_JOURNAL: '회계 전표 CSV', ACCT_TAX: '세금 신고 자료 CSV',
};
/** 요청할 수 있는 역할(SUPER 는 모두) — 내려받기 API 의 @Roles 와 같게 */
const TARGET_ROLES: Record<ExportTarget, string[]> = { POINT_REPORT: ['PAYOUT'], AUDIT_EXPORT: [], NOTICE_READS: [], RATE_READS: [], ACCT_JOURNAL: ['PAYOUT'], ACCT_TAX: ['PAYOUT'] };
export const EXPORT_DAILY_MAX = 10;
const EXPORT_GATE_KEY = 'export_gate';

/** 내려받기 API 에 붙임 — ?ticket=<승인된 요청 번호> 가 있어야 열림 */
export const ExportGate = (target: ExportTarget) => applyDecorators(
  SetMetadata(EXPORT_GATE_KEY, target),
  ApiQuery({ name: 'ticket', required: false, description: `v10.366 (D238) 내려받기 승인 번호 — 없거나 맞지 않으면 422 EXPORT_NEED_APPROVAL(대상 ${target})` }),
);

const needApproval = () => new PolicyViolation('EXPORT_NEED_APPROVAL', '내려받기 승인이 필요합니다(사유를 적어 요청 → 승인 뒤 24시간 안 한 번).');

@Injectable()
export class ExportApprovalService {
  constructor(private readonly db: DatabaseService) {}

  private async superCount(except?: string): Promise<number> {
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(DISTINCT r.account_id)::int AS n FROM account_roles r JOIN accounts a ON a.id = r.account_id
        WHERE r.role = 'SUPER' AND a.status = 'ACTIVE' AND ($1::uuid IS NULL OR r.account_id <> $1::uuid)`, [except ?? null]);
    return Number(r?.n ?? 0);
  }

  /** 요청 — 같은 대상의 「기다림」 · 「승인되고 안 쓴 것(24시간 안)」이 있으면 그것을 돌려줌 */
  async request(target: string, reasonIn: string, roles: string[]) {
    if (!(EXPORT_TARGETS as readonly string[]).includes(target)) throw new PolicyViolation('EXPORT_TARGET', '내려받기 대상이 아닙니다.');
    const t = target as ExportTarget;
    const isSuper = roles.includes('SUPER');
    if (!isSuper && !TARGET_ROLES[t].some((r) => roles.includes(r))) throw new AppError(403, { code: 'FORBIDDEN', message: '이 자료를 내려받을 권한이 없습니다.' });
    const reason = (reasonIn ?? '').replace(/\s+/g, ' ').trim();
    if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('EXPORT_REASON', '사유는 2 ~ 200자입니다.');
    const me = RequestCtx.actorId();
    if (!me) throw needApproval();
    const [open] = await this.db.query<{ id: string; state: string }>(
      `SELECT id::text AS id, state FROM export_requests
        WHERE requested_by = $1 AND target = $2 AND (state = 'PENDING' OR (state = 'APPROVED' AND used_at IS NULL AND decided_at > now() - interval '24 hours'))
        ORDER BY id DESC LIMIT 1`, [me, t]);
    if (open) return { ok: true, id: open.id, state: open.state, existing: true, note: open.state === 'APPROVED' ? '이미 승인된 요청이 있습니다 — 바로 내려받을 수 있습니다.' : '같은 자료의 요청이 승인을 기다리고 있습니다.' };
    const [d] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM export_requests WHERE requested_by = $1 AND requested_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`, [me]);
    if (Number(d?.n ?? 0) >= EXPORT_DAILY_MAX) throw new PolicyViolation('EXPORT_DAILY_LIMIT', `내려받기 요청은 하루 ${EXPORT_DAILY_MAX}건까지입니다.`);
    const solo = isSuper && (await this.superCount(me)) === 0;
    const [r] = await this.db.query<{ id: string; state: string }>(
      solo
        ? `INSERT INTO export_requests (target, reason, requested_by, state, decided_by, decided_at, solo, decide_note)
           VALUES ($1, $2, $3, 'APPROVED', $3, now(), true, 'SUPER 한 명 — 스스로 승인') RETURNING id::text AS id, state`
        : `INSERT INTO export_requests (target, reason, requested_by) VALUES ($1, $2, $3) RETURNING id::text AS id, state`, [t, reason, me]);
    return {
      ok: true, id: r!.id, state: r!.state, solo, existing: false,
      note: solo ? 'SUPER 가 한 명이라 스스로 승인했습니다(기록 · 월간 보안 보고에 「혼자 승인」). 24시간 안 한 번 내려받을 수 있습니다.'
        : '승인을 기다립니다 — 다른 SUPER 가 위험감지 › 감사 › 「내려받기 승인」에서 승인합니다.',
    };
  }

  /** 승인 · 거절 — SUPER · 자기 요청은 SUPER 가 자기 한 명일 때만 */
  async decide(idIn: number, approve: boolean, noteIn?: string) {
    const me = RequestCtx.actorId() ?? null;
    const [q] = await this.db.query<{ requested_by: string; state: string }>(`SELECT requested_by::text AS requested_by, state FROM export_requests WHERE id = $1`, [idIn]);
    if (!q) throw new NotFound('그 요청이 없습니다.');
    if (q.state !== 'PENDING') throw new AppError(409, { code: 'EXPORT_DECIDED', message: '이미 결정된 요청입니다.' });
    const self = q.requested_by === me;
    if (self && (await this.superCount(me ?? undefined)) > 0) throw new PolicyViolation('EXPORT_SELF_APPROVE', '자기 요청은 다른 SUPER 가 결정합니다.');
    const note = (noteIn ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
    await this.db.query(
      `UPDATE export_requests SET state = $2, decided_by = $3, decided_at = now(), decide_note = $4, solo = $5 WHERE id = $1 AND state = 'PENDING'`,
      [idIn, approve ? 'APPROVED' : 'REJECTED', me, note, self]);
    return { ok: true, id: String(idIn), state: approve ? 'APPROVED' : 'REJECTED', note: approve ? '승인했습니다 — 요청한 사람이 24시간 안 한 번 내려받을 수 있습니다.' : '거절했습니다.' };
  }

  /** 위험감지 › 감사 › 「내려받기 승인」 — 기다림(SUPER) · 내 요청 · 최근 결정 · 오늘 내 요청 수 */
  async list(roles: string[]) {
    const me = RequestCtx.actorId() ?? null;
    const isSuper = roles.includes('SUPER');
    const cols = `e.id::text AS id, e.target, e.reason, e.state, e.solo, e.requested_at AS "requestedAt", e.decided_at AS "decidedAt", e.decide_note AS "decideNote", e.used_at AS "usedAt",
                  (e.state = 'APPROVED' AND e.used_at IS NULL AND e.decided_at > now() - interval '24 hours') AS ready,
                  ra.email::text AS "requestedBy", da.email::text AS "decidedBy"`;
    const join = `FROM export_requests e JOIN accounts ra ON ra.id = e.requested_by LEFT JOIN accounts da ON da.id = e.decided_by`;
    const pending = isSuper ? await this.db.query(`SELECT ${cols}, (e.requested_by = $1) AS mine ${join} WHERE e.state = 'PENDING' ORDER BY e.requested_at LIMIT 50`, [me]) : [];
    const mine = await this.db.query(`SELECT ${cols} ${join} WHERE e.requested_by = $1 ORDER BY e.id DESC LIMIT 20`, [me]);
    const recent = isSuper ? await this.db.query(`SELECT ${cols} ${join} WHERE e.state <> 'PENDING' ORDER BY e.decided_at DESC LIMIT 20`) : [];
    const [d] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM export_requests WHERE requested_by = $1 AND requested_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`, [me]);
    const label = (x: Record<string, unknown>) => ({ ...x, targetLabel: EXPORT_KO[x.target as ExportTarget] ?? x.target });
    return {
      pending: pending.map(label), mine: mine.map(label), recent: recent.map(label), today: Number(d?.n ?? 0), dailyMax: EXPORT_DAILY_MAX,
      canDecide: isSuper, superOthers: isSuper ? await this.superCount(me ?? undefined) : null,
    };
  }

  /** 화면 단추 — 이 대상의 내 승인된 안 쓴 번호(24시간 안) · 기다리는 요청 */
  async ready(target: string) {
    const me = RequestCtx.actorId() ?? null;
    const [r] = await this.db.query<{ id: string; state: string; until: string | null }>(
      `SELECT id::text AS id, state, CASE WHEN state = 'APPROVED' THEN decided_at + interval '24 hours' END AS until FROM export_requests
        WHERE requested_by = $1 AND target = $2 AND (state = 'PENDING' OR (state = 'APPROVED' AND used_at IS NULL AND decided_at > now() - interval '24 hours'))
        ORDER BY (state = 'APPROVED') DESC, id DESC LIMIT 1`, [me, target]);
    return { target, id: r?.state === 'APPROVED' ? r.id : null, pendingId: r?.state === 'PENDING' ? r.id : null, until: r?.until ?? null };
  }

  /** 내려받기 API 앞 — 맞는 승인 번호인지 */
  async check(target: ExportTarget, ticket: unknown): Promise<number> {
    const id = Number(ticket);
    const me = RequestCtx.actorId();
    if (!me || !Number.isInteger(id) || id <= 0) throw needApproval();
    const [r] = await this.db.query(
      `SELECT 1 FROM export_requests WHERE id = $1 AND target = $2 AND requested_by = $3 AND state = 'APPROVED' AND used_at IS NULL AND decided_at > now() - interval '24 hours'`,
      [id, target, me]);
    if (!r) throw needApproval();
    return id;
  }

  /** 내려받기 성공 뒤 — 한 번 쓴 것으로(동시에 두 번이면 뒤엣것은 409) */
  async use(id: number) {
    const r = await this.db.query(`UPDATE export_requests SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [id]);
    if (!r.length) throw new AppError(409, { code: 'EXPORT_TICKET_USED', message: '이미 쓴 내려받기 승인입니다.' });
  }
}

@Injectable()
export class ExportGateInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly svc: ExportApprovalService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = this.reflector.get<ExportTarget | undefined>(EXPORT_GATE_KEY, ctx.getHandler());
    if (!target) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    return from(this.svc.check(target, req.query?.ticket)).pipe(
      switchMap((id) => next.handle().pipe(concatMap(async (out) => {
        await this.svc.use(id);
        return out && typeof out === 'object' ? { ...(out as Record<string, unknown>), exportTicket: String(id) } : out;
      }))),
    );
  }
}

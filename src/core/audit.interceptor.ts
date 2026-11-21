import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { DatabaseService } from '../db/database.service';
import { RequestCtx } from './request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUDIT_KEY = 'audit';
/** 감사 대상 액션을 선언합니다. 검수 승인·정산 지급·계좌 변경·정책 변경은 필수입니다. */
/* v10.559 — idOnly: 응답(급여 같은 민감 값)을 기록에 베끼지 않고 주소의 id 만 남김(사원 카드 등 읽기 화면) */
/* v10.565 — pick: 응답 객체 최상위에서 고른 칸만 남김(쓰기 결과의 상태 · 번호 · 합계) · 그 칸이 없으면 빈 객체 · 배열 응답이면 길이만 { n } · idOnly 가 먼저 · 옵션 없으면 예전처럼 응답 그대로 */
export type AuditOpts = { idOnly?: boolean; pick?: string[] };
export type AuditMeta = { action: string; targetType?: string; idOnly?: boolean; pick?: string[] };
export const Audit = (action: string, targetType?: string, opts?: AuditOpts) =>
  SetMetadata(AUDIT_KEY, {
    action, targetType, idOnly: opts?.idOnly === true,
    pick: opts && Array.isArray(opts.pick) ? opts.pick : undefined,
  });

/** v10.565 — after_data 에 넣을 값. idOnly → { id } · pick → 고른 칸(배열이면 { n }) · 둘 다 없으면 응답 그대로 */
export function auditAfter(meta: AuditMeta, params: Record<string, unknown> | undefined, result: unknown): unknown {
  if (meta.idOnly) return { id: String(params?.id ?? '') };
  if (meta.pick) {
    if (Array.isArray(result)) return { n: result.length };
    const out: Record<string, unknown> = {};
    if (result && typeof result === 'object') {
      for (const k of meta.pick) {
        if (Object.prototype.hasOwnProperty.call(result, k)) out[k] = (result as Record<string, unknown>)[k];
      }
    }
    return out;
  }
  return result ?? {};
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta>(
      AUDIT_KEY, ctx.getHandler(),
    );
    if (!meta) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const c = RequestCtx.get();

    return next.handle().pipe(
      tap({
        next: (result) => {
          // 감사 로그 실패가 본 요청을 실패시키면 안 됩니다.
          // 다만 누락은 그 자체로 사고이므로 반드시 로그를 남깁니다.
          void this.db
            .query(
              `INSERT INTO audit.audit_logs
                 (actor_account_id, actor_role, action, target_type, target_id,
                  after_data, ip, user_agent)
               VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
              [
                c?.actorId ?? null, c?.actorRole ?? null,
                meta.action, meta.targetType ?? null,
                /* v10.368 — 대상 칸은 uuid: 번호(bigint) 대상이면 비움(번호는 응답 after_data 에 있음) — 전에는 기록 쓰기가 통째로 실패 */
                (UUID_RE.test(String(req.params?.id ?? '')) ? req.params.id : null),
                JSON.stringify(meta.idOnly ? { id: String(req.params?.id ?? '') } : auditAfter(meta, req.params, result)),
                c?.ip ?? null, c?.userAgent ?? null,
              ],
            )
            .catch((e) => console.error('[AUDIT_WRITE_FAILED]', meta.action, e.message));
        },
      }),
    );
  }
}

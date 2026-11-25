import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { DatabaseService } from '../db/database.service';
import { RequestCtx } from './request-context';

/* e3.1 (docs/010) 소개뱅크 core/audit.interceptor.ts 와 같은 @Audit(action, targetType, { idOnly · pick }) — 기록은 ERP 자기 erp_audit(E002 · 쌓기만)
 *   소개뱅크 audit.audit_logs 와 다른 점: 대상은 글자(target · 번호 · uuid 모두) · 역할 · 브라우저는 detail 에 */
export const AUDIT_KEY = 'audit';
export type AuditOpts = { idOnly?: boolean; pick?: string[] };
export type AuditMeta = { action: string; targetType?: string; idOnly?: boolean; pick?: string[] };
export const Audit = (action: string, targetType?: string, opts?: AuditOpts) =>
  SetMetadata(AUDIT_KEY, { action, targetType, idOnly: opts?.idOnly === true, pick: opts && Array.isArray(opts.pick) ? opts.pick : undefined });

export function auditAfter(meta: AuditMeta, params: Record<string, unknown> | undefined, result: unknown): unknown {
  if (meta.idOnly) return { id: String(params?.id ?? '') };
  if (meta.pick) {
    if (Array.isArray(result)) return { n: result.length };
    const out: Record<string, unknown> = {};
    if (result && typeof result === 'object') for (const k of meta.pick) if (Object.prototype.hasOwnProperty.call(result, k)) out[k] = (result as Record<string, unknown>)[k];
    return out;
  }
  return result ?? {};
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly db: DatabaseService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta>(AUDIT_KEY, ctx.getHandler());
    if (!meta) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const c = RequestCtx.get();
    return next.handle().pipe(tap({
      next: (result) => {
        const actor = c?.actorId ?? req.erp?.accountId;
        if (!actor) return;
        const detail = { targetType: meta.targetType ?? null, role: c?.actorRole ?? null, after: auditAfter(meta, req.params, result) };
        let d = JSON.stringify(detail);
        if (d.length > 20000) d = JSON.stringify({ ...detail, after: { truncated: true } });
        void this.db.query(`INSERT INTO erp_audit (account_id, action, target, detail, ip) VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [actor, meta.action, req.params?.id != null ? String(req.params.id).slice(0, 120) : null, d, (c?.ip ?? '').slice(0, 64) || null])
          .catch((e) => console.error('[ERP_AUDIT_WRITE_FAILED]', meta.action, e.message));
      },
    }));
  }
}

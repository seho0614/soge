import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { DatabaseService } from '../db/database.service';
import { RequestCtx } from './request-context';

export const AUDIT_KEY = 'audit';
/** 감사 대상 액션을 선언합니다. 검수 승인·정산 지급·계좌 변경·정책 변경은 필수입니다. */
export const Audit = (action: string, targetType?: string) =>
  SetMetadata(AUDIT_KEY, { action, targetType });

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ action: string; targetType?: string }>(
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
                req.params?.id ?? null,
                JSON.stringify(result ?? {}),
                c?.ip ?? null, c?.userAgent ?? null,
              ],
            )
            .catch((e) => console.error('[AUDIT_WRITE_FAILED]', meta.action, e.message));
        },
      }),
    );
  }
}

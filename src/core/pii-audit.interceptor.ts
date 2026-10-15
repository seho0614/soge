import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { DatabaseService } from '../db/database.service';
import { RequestCtx } from './request-context';

export const PII_ACCESS_KEY = 'pii_access';

/**
 * 개인정보 조회 감사.
 *
 * 조회한 사실 자체가 기록돼야 오남용을 확인할 수 있습니다.
 * 일반 @Audit 은 변경만 남기므로, 조회 전용으로 따로 둡니다.
 */
export const PiiAccess = (targetType: 'ACCOUNT' | 'BUSINESS' | 'LEAD', reason: string) =>
  SetMetadata(PII_ACCESS_KEY, { targetType, reason });

@Injectable()
export class PiiAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ targetType: string; reason: string }>(
      PII_ACCESS_KEY, ctx.getHandler());
    if (!meta) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const c = RequestCtx.get();

    return next.handle().pipe(
      tap({
        next: () => {
          // 조회 기록 실패가 본 요청을 실패시키지는 않되, 누락은 사고이므로 로그를 남깁니다
          void this.db
            .query(
              `INSERT INTO audit.pii_access_logs
                 (actor_account_id, target_type, target_account_id, access_type, reason, ip)
               VALUES ($1,$2,$3,'VIEW',$4,$5)`,
              [c?.actorId ?? null, meta.targetType,
               req.params?.id ?? null, meta.reason, c?.ip ?? null],
            )
            .catch((e) => console.error('[PII_AUDIT_FAILED]', meta.targetType, e.message));
        },
      }),
    );
  }
}

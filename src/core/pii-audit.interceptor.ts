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

/** v10.359 (D236 · docs/493) — 머리글 X-PII-Reason(INQUIRY · DISPUTE · SETTLEMENT · REVIEW · LEGAL · OTHER:<글>) → 사유 글. 모르면 「미입력」 */
export const PII_REASON_KO: Record<string, string> = { INQUIRY: '문의 답변', DISPUTE: '분쟁 처리', SETTLEMENT: '정산 · 지급', REVIEW: '심사 · 인증', LEGAL: '법적 요청' };
export function piiReason(h: unknown): string {
  const v = typeof h === 'string' ? h.trim() : '';
  if (PII_REASON_KO[v]) return PII_REASON_KO[v]!;
  if (v.startsWith('OTHER:')) {
    let t = '';
    try { t = decodeURIComponent(v.slice(6)); } catch { t = ''; }
    t = t.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t.length >= 2) return `기타: ${t}`;
  }
  return '미입력';
}

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
    const why = piiReason(req.headers?.['x-pii-reason']);   /* v10.359 (D236 · docs/493) — 화면이 고른 열람 사유 · 없으면 「사유 미입력」(막지 않음) */

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
               req.params?.id ?? null, `${meta.reason} · 사유 ${why}`, c?.ip ?? null],
            )
            .catch((e) => console.error('[PII_AUDIT_FAILED]', meta.targetType, e.message));
        },
      }),
    );
  }
}

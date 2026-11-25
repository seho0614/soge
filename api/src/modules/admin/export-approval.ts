/* ---------------------------------------------------------------------
 * e3.5 (docs/011) 내려받기 승인 — 소개뱅크 admin/export-approval.ts 와 같은 이름 · 같은 모양(옮겨 온 회계 코드가 그대로 씀)
 *   요청 · 승인은 소개뱅크(운영 화면 › 감사 › 내려받기 승인 · 표 export_requests) 그대로
 *   ERP 내려받기 API 에 @ExportGate(대상) → ?ticket= 확인: svc.export_requests 읽기(승인 · 24시간 안 · 안 씀 · 대상 · 요청자 같음)
 *   성공하면 「썼음」은 소개뱅크 POST /internal/erp/export/consume(ERP 는 소개뱅크 표에 쓰지 않음 · 설계서 4-4)
 * ------------------------------------------------------------------- */
import { applyDecorators, CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiQuery } from '@nestjs/swagger';
import { concatMap, from, Observable, switchMap } from 'rxjs';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { sgb, sgbOk } from '../../core/sgb-client';
import { DatabaseService } from '../../db/database.service';

export type ExportTarget = string;
const EXPORT_GATE_KEY = 'export_gate';
export const ExportGate = (target: ExportTarget) => applyDecorators(
  SetMetadata(EXPORT_GATE_KEY, target),
  ApiQuery({ name: 'ticket', required: false, description: `내려받기 승인 번호(소개뱅크) — 없거나 맞지 않으면 422 EXPORT_NEED_APPROVAL(대상 ${target})` }),
);
const needApproval = () => new PolicyViolation('EXPORT_NEED_APPROVAL', '내려받기 승인이 필요합니다(소개뱅크 운영 화면에서 사유를 적어 요청 → 승인 뒤 24시간 안 한 번).');

@Injectable()
export class ExportGateInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly db: DatabaseService) {}

  async check(target: string, ticket: unknown): Promise<string> {
    const id = String(ticket ?? '');
    const me = RequestCtx.actorId();
    if (!/^\d{1,18}$/.test(id) || !me) throw needApproval();
    const [r] = await this.db.query(
      `SELECT 1 FROM svc.export_requests WHERE id = $1::bigint AND target = $2 AND requested_by = $3 AND state = 'APPROVED'
          AND used_at IS NULL AND decided_at > now() - interval '24 hours'`, [id, target, me]);
    if (!r) throw needApproval();
    return id;
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = this.reflector.get<string | undefined>(EXPORT_GATE_KEY, ctx.getHandler());
    if (!target) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    return from(this.check(target, req.query?.ticket)).pipe(
      switchMap((id) => next.handle().pipe(concatMap(async (out) => {
        sgbOk(await sgb.post('/internal/erp/export/consume', { id, target, accountId: RequestCtx.actorId() }));
        return out && typeof out === 'object' ? { ...(out as Record<string, unknown>), exportTicket: id } : out;
      }))),
    );
  }
}

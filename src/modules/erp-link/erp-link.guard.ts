import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Forbidden } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';

/**
 * v10.799 (D334 · docs/915) ERP 서비스 토큰 가드 — ERP 서버만 부르는 자리(introspect · /internal/erp/*).
 *   머리 X-Erp-Service-Token 의 sha256 을 설정 erp.service_token_hash 와 같은 길이 비교 · 비어 있으면 닫힘(fail-closed · InternalKeyGuard 와 같은 원칙).
 *   토큰 원문은 DB · 로그 · 응답에 남기지 않음.
 */
export const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

@Injectable()
export class ErpLinkGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const given = String(req.headers['x-erp-service-token'] ?? '').trim();
    const [row] = await this.db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'erp.service_token_hash'`);
    const want = (row?.value ?? '').trim();
    if (!/^[0-9a-f]{64}$/.test(want)) throw new Forbidden('ERP_TOKEN_UNSET', 'ERP 서비스 토큰이 설정되지 않았습니다.');
    const got = given ? sha256hex(given) : '';
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
      throw new Forbidden('ERP_TOKEN_INVALID', 'ERP 서비스 토큰이 맞지 않습니다.');
    }
    return true;
  }
}

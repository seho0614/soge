import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Forbidden } from './errors';
import { DatabaseService } from '../db/database.service';

/**
 * 내부 API 키 가드.
 *
 * ── 왜 역할이 아니라 키인가 ──────────────────────────────────────
 * 분리된 광고 플랫폼이 부르는 자리라 **사람 토큰이 없습니다.**
 * `@Roles` 를 달 수 없어 그대로 열려 있었고, ACL 검정에서
 * `/internal/businesses/{id}` 가 토큰 없이 상호를 내주는 것을
 * 찾았습니다.
 *
 * ── 키가 비어 있으면 닫습니다 ────────────────────────────────────
 * 열어 두는 것보다 **멈추는 편**이 낫습니다. 광고가 안 나가는 것은
 * 눈에 보이지만, 명부가 새는 것은 안 보입니다.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const given = String(req.headers['x-internal-key'] ?? '');

    const [row] = await this.db.query<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = 'internal.api_key'`);
    const key = (row?.value ?? '').trim();

    /* 키가 설정되지 않았으면 닫습니다 — fail-closed */
    if (!key) {
      throw new Forbidden('INTERNAL_KEY_UNSET',
        '내부 API 키가 설정되지 않았습니다.');
    }
    /* 길이가 같아야 비교 시간이 값을 흘리지 않습니다 */
    if (given.length !== key.length || given !== key) {
      throw new Forbidden('INTERNAL_KEY_INVALID', '내부 API 키가 맞지 않습니다.');
    }
    return true;
  }
}

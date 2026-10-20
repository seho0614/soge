import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Principal, Role } from '../../core/auth';

/**
 * principal 조립.
 *
 * 토큰에 담긴 값은 발급 시점의 상태입니다. 구독이 만료돼도 15분간 유효한
 * 토큰이 남습니다. 금전이 걸린 경로는 토큰을 믿지 말고 여기서 다시 봅니다.
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly db: DatabaseService) {}

  async load(accountId: string): Promise<Principal | null> {
    const [row] = await this.db.query<{
      account_id: string;
      roles: Role[] | null;
      identity_verified_at: Date | null;
      business_verified_at: Date | null;
      has_active_subscription: boolean;
      status: string;
      token_version: number;
    }>(
      `SELECT a.id AS account_id,
              a.status,
              a.token_version,
              a.identity_verified_at,
              array_remove(array_agg(DISTINCT r.role), NULL) AS roles,
              (SELECT max(b.verified_at) FROM businesses b WHERE b.account_id = a.id)
                AS business_verified_at,
              EXISTS (
                SELECT 1 FROM subscriptions s
                 WHERE s.account_id = a.id
                   AND s.status IN ('ACTIVE','PAST_DUE')
                   AND s.current_period_end > now()
              ) AS has_active_subscription
         FROM accounts a
         LEFT JOIN account_roles r ON r.account_id = a.id
        WHERE a.id = $1
        GROUP BY a.id`,
      [accountId],
    );

    if (!row || row.status !== 'ACTIVE') return null;

    /* ★ 2026-10-01 결정(Q5) — 운영 계정(ADMIN · SUPER)은 사용자 기능 전체를 씁니다.
     *   전에는 역할 행에 MEMBER 가 없어 사용자 웹에 로그인하면 **비로그인처럼** 보였습니다
     *   (/me/summary 가 MEMBER 전용). 운영 역할을 앞에 두어 감사 기록(actorRole)은 운영으로 남습니다.
     *   사업자·본인인증 게이트는 그대로 적용됩니다 — 역할만 열고 자격은 열지 않습니다. */
    let roles = (row.roles?.length ? row.roles : ['MEMBER']) as Role[];
    if (roles.some((r) => r === 'ADMIN' || r === 'SUPER')) {
      const ops = roles.filter((r) => ['SUPER', 'ADMIN', 'REVIEWER', 'PAYOUT'].includes(r));
      const user = (['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as Role[]).filter((r) => !ops.includes(r));
      roles = [...ops, ...user, ...roles.filter((r) => !ops.includes(r) && !user.includes(r))];
    }

    return {
      accountId: row.account_id,
      roles,
      identityVerifiedAt: row.identity_verified_at,
      businessVerifiedAt: row.business_verified_at,
      hasActiveSubscription: row.has_active_subscription,
      tokenVersion: Number(row.token_version ?? 0),
    };
  }

  /**
   * 금전 경로 전용 재확인. 코드 발급·정산 신청 직전에 호출합니다.
   * INV-8 트리거가 최종 방어선이지만, 여기서 막으면 사용자가 500 대신 안내를 받습니다.
   */
  async assertFresh(accountId: string): Promise<Principal> {
    const p = await this.load(accountId);
    if (!p) throw new Error('계정을 확인할 수 없습니다.');
    return p;
  }
}

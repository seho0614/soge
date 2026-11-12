import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.258 (docs/390) — 직접 추천한 분별 「내가 받은 추천 보상」(읽기만)
 *
 *   대표 「관계도를 정산에도 반영」(11/12) → 1단계 보상을 사람별로 보여 줌. 보상 규칙은 그대로(D189 — 직접 추천 1단계만).
 *   보이는 것은 **추천한 사람(나)이 받은 포인트**뿐 — 추천받은 분이 번 돈 · 실적은 넣지 않습니다(partner-affiliate #7).
 *   상태: GOT 받음(rewarded_at) · WAIT 그분 본인인증 전 · NONE 인증했지만 보상 없음(보상이 꺼져 있었거나 한 달 상한)
 *   여러 단계 보상은 만들지 않음 — 법무 확인 대기(partner-affiliate 미정 #5).
 * ------------------------------------------------------------------- */
export type RewardState = 'GOT' | 'WAIT' | 'NONE';
export interface DirectReward { id: string; name: string; withdrawn: boolean; joined: Date; state: RewardState; points: number; at: Date | null }
export interface RewardSum { points: number; got: number; wait: number; none: number }

const MAX = 3000;

export async function directRewards(db: DatabaseService, inviter: string): Promise<DirectReward[]> {
  const rows = await db.query<{ id: string; name: string; withdrawn: boolean; joined: Date; at: Date | null; verified: boolean; points: number }>(
    `SELECT r.invitee_id AS id, a.name, a.withdrawn_at IS NOT NULL AS withdrawn, r.created_at AS joined, r.rewarded_at AS at,
            a.identity_verified_at IS NOT NULL AS verified,
            coalesce((SELECT sum(l.points) FROM point_ledger l
                       WHERE l.account_id = r.inviter_id AND l.rule_code = 'REFERRAL_DIRECT' AND l.memo = 'invitee ' || r.invitee_id::text), 0)::int AS points
       FROM introducer_referrals r JOIN accounts a ON a.id = r.invitee_id
      WHERE r.inviter_id = $1 ORDER BY r.created_at LIMIT ${MAX}`, [inviter]);
  return rows.map((r) => ({
    id: r.id, name: r.name, withdrawn: r.withdrawn, joined: r.joined, points: r.points, at: r.at,
    state: r.at ? 'GOT' : r.verified ? 'NONE' : 'WAIT',
  }));
}

export function rewardSum(xs: DirectReward[]): RewardSum {
  return {
    points: xs.reduce((a, x) => a + x.points, 0),
    got: xs.filter((x) => x.state === 'GOT').length,
    wait: xs.filter((x) => x.state === 'WAIT').length,
    none: xs.filter((x) => x.state === 'NONE').length,
  };
}

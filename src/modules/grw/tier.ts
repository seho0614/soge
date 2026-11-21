import { DatabaseService } from '../../db/database.service';
import { grwSettings, maskName, num } from './common';

/* ---------------------------------------------------------------------
 * v10.600 (docs/742) ⑯ 여러 단계 추천 보상 — 처음 off · **법무 확인 필요(방문판매법 다단계판매 해당 여부)**
 *   11/9 대표 「법무 확인 이상없음 · 다단계 해당 안 됨」은 **직접 추천 1단계 보상(REFERRAL_DIRECT · D189)** 기준이고,
 *   여러 단계 보상(추천인의 추천인에게도)은 partner-affiliate 미정 #5 「법무 확인 대기」 그대로입니다. 이 판은 길만 만들고 꺼 둡니다.
 *
 *   이미 있는 것을 넓힘(고치지 않음):
 *     · 추천 관계(introducer_referrals · D189 · 칸 더하지 않음 · 고리 막기 그대로) — 위로 따라 올라가며 2 · 3 · 4단계
 *     · 직접 보상 fn_referral_reward(D189 · D190 · D277 판) — 손대지 않음. 그 함수가 point_ledger 에 REFERRAL_DIRECT 한 줄을 넣은 뒤(AFTER INSERT)
 *       trg_grw_tier_reward 가 grw.tier_reward 와 grw.tier_legal_ok 가 **둘 다 on** 일 때만 REFERRAL_TIER 줄을 더함
 *   지키는 것(DB): 가입한 사람 한 명 · 단계 하나에 한 번(grw_tier_rewards 고유) · 현금화 안 됨(redeemable false · 가드) · 정한 함수 밖에서 REFERRAL_TIER 줄 못 넣음
 *                 · 탈퇴 · 정지 회원은 건너뜀 · 한 달 상한(point_rules REFERRAL_TIER.monthly_cap) · 점수는 grw.tier_points(2 · 3 · 4단계)
 *   켜는 순서: 법무 확인 → SUPER 가 「법무 확인 끝」 표시(사유에 확인한 곳 · 날짜) → 점수 · 상한 → 켜기. 약관 · 안내 문구는 켜기 전에 고쳐 게시.
 * ------------------------------------------------------------------- */

export const TIER_LEGAL_NOTE =
  '여러 단계 추천 보상은 방문판매법상 다단계판매(판매원 가입이 여러 단계로 이어지고 그에 따라 보상이 주어지는 조직)에 해당할 수 있어 법무 확인이 필요합니다. ' +
  '11/9 「다단계 해당 안 됨」 확인은 직접 추천 1단계 보상 기준입니다. 법무 확인 · 약관 · 안내 문구 게시 전에는 켜지 마십시오.';

/** GET /admin/grw/tier — 설정 · 규칙 · 법무 안내 · 지금 관계에서 2단계 이상이 몇 개인지 · 최근 보상(가린 이름) */
export async function tierView(db: DatabaseService) {
  const s = await grwSettings(db);
  const [rule] = await db.query<{ points: number; monthly_cap: number | null; is_active: boolean }>(
    `SELECT points, monthly_cap, is_active FROM point_rules WHERE code = 'REFERRAL_TIER'`);
  const [direct] = await db.query<{ is_active: boolean; points: number }>(`SELECT is_active, points FROM point_rules WHERE code = 'REFERRAL_DIRECT'`);
  const [depth] = await db.query<{ l2: number; l3: number; l4: number }>(
    `SELECT count(r2.id)::int AS l2, count(r3.id)::int AS l3, count(r4.id)::int AS l4
       FROM introducer_referrals r1
       LEFT JOIN introducer_referrals r2 ON r2.invitee_id = r1.inviter_id
       LEFT JOIN introducer_referrals r3 ON r3.invitee_id = r2.inviter_id
       LEFT JOIN introducer_referrals r4 ON r4.invitee_id = r3.inviter_id`);
  const [tot] = await db.query<{ n: number; pts: number; m: number }>(
    `SELECT count(*)::int AS n, coalesce(sum(points), 0)::int AS pts,
            count(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')::int AS m
       FROM grw_tier_rewards`);
  const recent = await db.query<{ id: string; level: number; points: number; created_at: string; bname: string | null; iname: string | null }>(
    `SELECT t.id::text AS id, t.level, t.points, t.created_at, b.name AS bname, i.name AS iname
       FROM grw_tier_rewards t JOIN accounts b ON b.id = t.beneficiary_id JOIN accounts i ON i.id = t.invitee_id
      ORDER BY t.id DESC LIMIT 30`);
  return {
    settings: { tierReward: s.tierReward, tierLegalOk: s.tierLegalOk, tierPoints: s.tierPoints },
    points: s.tierPoints.split(',').map((p, i) => ({ level: i + 2, points: Number(p) })),
    rule: rule ? { monthlyCap: rule.monthly_cap, isActive: rule.is_active } : null,
    direct: direct ? { isActive: direct.is_active, points: num(direct.points) } : null,
    chains: { level2: num(depth?.l2), level3: num(depth?.l3), level4: num(depth?.l4) },
    totals: { rewards: num(tot?.n), points: num(tot?.pts), thisMonth: num(tot?.m) },
    recent: recent.map((r) => ({ id: r.id, level: r.level, points: num(r.points), at: r.created_at, to: maskName(r.bname), from: maskName(r.iname) })),
    redeemable: false,
    legal: TIER_LEGAL_NOTE,
    note: '직접 추천 보상(1단계)이 들어갈 때만 따라 붙습니다 — 직접 추천 보상이 꺼져 있으면 여러 단계 보상도 생기지 않습니다. 여러 단계 보상 점수는 현금화되지 않습니다.',
  };
}

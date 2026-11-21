import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { PartnerActorService } from '../partner/partner-actor.service';
import { directRewards, rewardSum } from '../affiliate/referral-reward';
import { smqNum, smqYm } from './common';

/* ---------------------------------------------------------------------
 * v10.580 (docs/722) ④ 파트너 정산 예측 — 파트너센터 › 정산 › 이번 달 예상(읽기만 · 스위치 없음 — 내 숫자를 보여 주기만)
 *   셈의 바탕은 기존 정산과 같음(affiliate-admin.service runSettle):
 *     정산 대상 = 귀속(attributed)된 제휴 주문(partner_orders) 가운데 확정(CONFIRMED) · 주문한 날(한국 달) 기준 · 원천징수 3.3%(사업소득 · 반올림)
 *   이번 달(한국) 주문을 상태로 나눔
 *     확정        CONFIRMED — 다음 정산에 들어감
 *     대기        PENDING — 아직 확정 전(소개몰 주문은 구매 확정 전)
 *     취소 가능   대기 가운데 소개몰 주문이 아직 구매 확정 전(결제 ~ 배송 완료)이거나 소개몰 밖 제휴 주문 — 취소 · 반품되면 빠짐
 *     취소됨      CANCELED(참고)
 *   예상 지급 = 확정분(아래 끝) ~ 확정 + 대기(위 끝) · 각각 3.3% 뺀 금액 · 지급일 = 다음 달 affiliate.payout_day 일
 *   돈 칸은 대표 · 정산 권한 직원만(myPerfTrend 와 같은 규칙) — 다른 직원은 건수만
 *   참고 — 추천 보상(소개코드 · 포인트)은 회사 정산과 따로라 「내가 받은 추천 보상」 요약만(referral-reward 재사용)
 *   리드 이용료(파트너가 내는 돈)는 정산이 아니라 넣지 않음 · 소개비(당사자끼리)는 여기 없음(INV-9)
 * ------------------------------------------------------------------- */

const RATE = 0.033;   // runSettle 과 같은 원천징수율(사업소득 3.3%)
const tax = (v: number) => Math.round(v * RATE);

export async function settleForecast(db: DatabaseService, actors: PartnerActorService, me: string | null) {
  if (!me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
  const p = await actors.forMember(me);
  if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
  const money = !!p.canMoney;
  const ym = smqYm(0);
  const [b] = await db.query<Record<string, unknown>>(
    `WITH o AS (
       SELECT o.state, o.commission AS amt,
              (o.state = 'PENDING' AND (h.id IS NULL OR h.status IN ('PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'))) AS cancelable
         FROM partner_orders o LEFT JOIN hlt_orders h ON h.order_no = o.order_no
        WHERE o.partner_id = $1::uuid AND o.attributed
          AND o.ordered_at >= ((($2::text || '-01')::date)::timestamp AT TIME ZONE 'Asia/Seoul')
          AND o.ordered_at < ((($2::text || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')
     )
     SELECT count(*) FILTER (WHERE state = 'CONFIRMED')::int AS "confirmedN", coalesce(sum(amt) FILTER (WHERE state = 'CONFIRMED'), 0)::bigint AS confirmed,
            count(*) FILTER (WHERE state = 'PENDING')::int AS "pendingN", coalesce(sum(amt) FILTER (WHERE state = 'PENDING'), 0)::bigint AS pending,
            count(*) FILTER (WHERE cancelable)::int AS "cancelableN", coalesce(sum(amt) FILTER (WHERE cancelable), 0)::bigint AS cancelable,
            count(*) FILTER (WHERE state = 'CANCELED')::int AS "canceledN", coalesce(sum(amt) FILTER (WHERE state = 'CANCELED'), 0)::bigint AS canceled,
            count(*) FILTER (WHERE state = 'SETTLED')::int AS "settledN", coalesce(sum(amt) FILTER (WHERE state = 'SETTLED'), 0)::bigint AS settled
       FROM o`, [p.id, ym]);
  /* 지난 90일 취소 비율(참고 — 예측에 곱하지 않고 보여 주기만) */
  const [h] = await db.query<{ total: number; canceled: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'CANCELED')::int AS canceled
       FROM partner_orders WHERE partner_id = $1::uuid AND attributed AND ordered_at > now() - interval '90 days'`, [p.id]);
  /* 이미 만든 이번 달 정산(마감 · 지급 단계) */
  const made = await db.query<Record<string, unknown>>(
    `SELECT s.id, s.track, s.period_from::text AS "from", s.period_to::text AS "to", s.gross_amount AS gross, s.net_amount AS net, s.state, s.paid_at AS "paidAt"
       FROM partner_settlements s
      WHERE s.partner_id = $1::uuid AND s.period_to >= ($2::text || '-01')::date AND s.period_from < (($2::text || '-01')::date + interval '1 month')
      ORDER BY s.period_from DESC LIMIT 12`, [p.id, ym]);
  const [pd] = await db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'affiliate.payout_day'`);
  const day = Number(pd?.value ?? 10) || 10;
  const k = new Date(Date.now() + 9 * 3600e3);
  const pay = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, day));
  const payDate = `${pay.getUTCFullYear()}-${String(pay.getUTCMonth() + 1).padStart(2, '0')}-${String(pay.getUTCDate()).padStart(2, '0')}`;
  const c = smqNum(b?.confirmed), pe = smqNum(b?.pending);
  const low = c, high = c + pe;
  const rw = rewardSum(await directRewards(db, me));
  const m = (v: number) => (money ? v : null);
  return {
    ym, payDate, money, partner: { company: p.company, grade: p.grade },
    counts: { confirmed: smqNum(b?.confirmedN), pending: smqNum(b?.pendingN), cancelable: smqNum(b?.cancelableN), canceled: smqNum(b?.canceledN), settled: smqNum(b?.settledN) },
    amounts: { confirmed: m(c), pending: m(pe), cancelable: m(smqNum(b?.cancelable)), canceled: m(smqNum(b?.canceled)), settled: m(smqNum(b?.settled)) },
    estimate: { grossLow: m(low), grossHigh: m(high), taxLow: m(tax(low)), taxHigh: m(tax(high)), netLow: m(low - tax(low)), netHigh: m(high - tax(high)), rate: RATE },
    cancelRate90: (h?.total ?? 0) > 0 ? Math.round(((h!.canceled) / h!.total) * 1000) / 10 : null,
    settlements: money ? made.map((x) => ({ ...x, gross: smqNum(x.gross), net: smqNum(x.net) })) : [],
    rewards: { points: rw.points, got: rw.got, wait: rw.wait },
    note: '이번 달(한국) 제휴 주문으로 셈한 예상입니다 — 확정분은 다음 정산에 들어가고, 대기분은 구매 확정 뒤 들어가거나 취소 · 반품되면 빠집니다. 원천징수 3.3%를 뺀 금액이 지급되고, 소개비(당사자끼리)와 리드 이용료는 여기 없습니다.',
  };
}

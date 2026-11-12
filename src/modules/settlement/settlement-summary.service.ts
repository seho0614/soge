import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound } from '../../core/errors';
import { maskName } from '../../common/mask';
import { directRewards, rewardSum } from '../affiliate/referral-reward';

/* ---------------------------------------------------------------------
 * v10.255 (docs/388) — 정산 내역 한눈에(읽기만)
 *
 *   회원 본인(나의공간 「정산 내역」)과 운영자(회원 상세 · 추천 관계도에서 그 회원 · 감사 기록)가 같은 모양을 봅니다.
 *   ① 소개비 정산(settlements — 받는 분 본인) ② 포인트(point_ledger 적립 · 규칙별) · 출금 신청 · 지급(point_cashouts)
 *   ③ 제휴 파트너 정산(partner_settlements — 그 회원의 파트너 · 있을 때만) ④ 소개몰 판매자 정산(hlt_settlements — 그 회원의 판매자 · 있을 때만)
 *   **다른 사람(추천한 분 · 추천받은 분)의 금액은 넣지 않습니다**(partner-affiliate #7 — 관계도에 실적 · 금액 없음).
 * ------------------------------------------------------------------- */
type Sum = { status: string; n: number; amount: number };
const RECENT = 20;

@Injectable()
export class SettlementSummaryService {
  constructor(private readonly db: DatabaseService) {}

  /** 나의공간 — 로그인한 본인 */
  mine() { return this.summary(RequestCtx.actorId()!); }

  /** 운영 화면 — 그 회원(없으면 404) */
  async forAdmin(id: string) {
    const [a] = await this.db.query<{ id: string }>(`SELECT id FROM accounts WHERE id::text = $1`, [id]);
    if (!a) throw new NotFound('없는 회원입니다.');
    return this.summary(a.id);
  }

  async summary(accountId: string) {
    /* ① 소개비 정산 */
    const introSum = await this.db.query<Sum>(
      `SELECT status, count(*)::int AS n, coalesce(sum(amount), 0)::float8 AS amount FROM settlements WHERE payee_account_id = $1 GROUP BY status ORDER BY status`, [accountId]);
    const intro = await this.db.query<{ id: string; dealId: string; amount: number; status: string; requestedAt: string; paidAt: string | null; held: boolean }>(
      `SELECT id, deal_id AS "dealId", amount::float8 AS amount, status, requested_at AS "requestedAt", paid_at AS "paidAt", held_by_dispute_id IS NOT NULL AS held
         FROM settlements WHERE payee_account_id = $1 ORDER BY requested_at DESC LIMIT ${RECENT}`, [accountId]);

    /* ② 포인트 · 출금 */
    const [pt] = await this.db.query<{ total: number; redeemable: number }>(
      `SELECT coalesce(sum(points), 0)::int AS total, coalesce(sum(points) FILTER (WHERE redeemable), 0)::int AS redeemable FROM point_ledger WHERE account_id = $1`, [accountId]);
    const byRule = await this.db.query<{ code: string; name: string | null; n: number; points: number }>(
      `SELECT l.rule_code AS code, max(r.name) AS name, count(*)::int AS n, sum(l.points)::int AS points
         FROM point_ledger l LEFT JOIN point_rules r ON r.code = l.rule_code
        WHERE l.account_id = $1 GROUP BY l.rule_code ORDER BY sum(l.points) DESC`, [accountId]);
    const ledger = await this.db.query<{ code: string; points: number; memo: string | null; at: string }>(
      `SELECT rule_code AS code, points, memo, earned_at AS at FROM point_ledger WHERE account_id = $1 ORDER BY earned_at DESC, id DESC LIMIT ${RECENT}`, [accountId]);
    const cashSum = await this.db.query<Sum>(
      `SELECT status, count(*)::int AS n, coalesce(sum(net_amount), 0)::float8 AS amount FROM point_cashouts WHERE account_id = $1 GROUP BY status ORDER BY status`, [accountId]);
    const cashouts = await this.db.query<{ id: string; points: number; netAmount: number; status: string; requestedAt: string; paidAt: string | null }>(
      `SELECT id, points, net_amount::float8 AS "netAmount", status, requested_at AS "requestedAt", paid_at AS "paidAt"
         FROM point_cashouts WHERE account_id = $1 ORDER BY requested_at DESC LIMIT ${RECENT}`, [accountId]);

    /* ③ 제휴 파트너 정산(그 회원의 사업자에 붙은 파트너 · 활동 여부 상관없이 기록은 보임) */
    const aff = await this.db.query<{ id: string; track: string; from: string; to: string; gross: number; withholding: number; net: number; state: string; paidAt: string | null }>(
      `SELECT s.id, s.track, s.period_from::text AS "from", s.period_to::text AS "to", s.gross_amount::float8 AS gross,
              s.withholding::float8 AS withholding, s.net_amount::float8 AS net, s.state, s.paid_at AS "paidAt"
         FROM partner_settlements s JOIN partners p ON p.id = s.partner_id JOIN businesses b ON b.id = p.business_id
        WHERE b.account_id = $1 ORDER BY s.period_from DESC LIMIT ${RECENT}`, [accountId]);

    /* ④ 소개몰 판매자 정산 */
    const seller = await this.db.query<{ id: string; seller: string; from: string; to: string; gross: number; commission: number; refund: number; net: number; status: string; paidAt: string | null }>(
      `SELECT s.id, h.name AS seller, s.period_from::text AS "from", s.period_to::text AS "to", s.gross_amount::float8 AS gross,
              s.commission::float8 AS commission, s.refund_amount::float8 AS refund, s.net_amount::float8 AS net, s.status, s.paid_at AS "paidAt"
         FROM hlt_settlements s JOIN hlt_sellers h ON h.id = s.seller_id
        WHERE h.account_id = $1 ORDER BY s.period_from DESC LIMIT ${RECENT}`, [accountId]);

    /* ⑤ v10.258 (docs/390) 추천 보상 — 내가 직접 추천한 분별로 **내가 받은** 포인트(그분 금액 아님 · 1단계만) */
    const rw = await directRewards(this.db, accountId);
    const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

    const total = (xs: Sum[], st: string[]) => xs.filter((x) => st.includes(x.status)).reduce((a, x) => a + Number(x.amount), 0);
    return {
      intro: { sums: introSum, paid: total(introSum, ['PAID']), waiting: total(introSum, ['REQUESTED', 'HELD']), items: intro },
      points: { total: pt?.total ?? 0, redeemable: pt?.redeemable ?? 0, byRule, ledger,
                cashout: { sums: cashSum, paid: total(cashSum, ['PAID']), items: cashouts } },
      affiliate: aff.length ? { paid: aff.filter((x) => x.state === 'PAID').reduce((a, x) => a + x.net, 0), items: aff } : null,
      referral: { ...rewardSum(rw), items: rw.map((x) => ({
        name: x.withdrawn ? null : maskName(x.name), joined: kst(x.joined), state: x.state, points: x.points, at: x.at ? kst(x.at) : null,
      })) },
      seller: seller.length ? { paid: seller.filter((x) => x.status === 'PAID').reduce((a, x) => a + x.net, 0), items: seller } : null,
      note: '다른 회원(추천한 분 · 추천받은 분)의 금액은 보이지 않습니다. 각 정산의 신청 · 계좌 · 지급은 해당 화면에서 합니다.',
    };
  }
}

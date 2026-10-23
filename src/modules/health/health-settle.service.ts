import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/**
 * 건강몰 — 판매자 · 정산 · 수수료율(운영 화면).
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthSettleService {
  constructor(private readonly db: DatabaseService) {}
  hltSellers() {
    return this.db.query(
      `SELECT s.code, s.name, s.type, s.status,
              s.commission_rate AS "commissionRate",
              (coalesce(btrim(s.submerchant_id),'') <> '') AS "payable",
              (SELECT count(*) FROM hlt_products p
                WHERE p.seller_id = s.id AND p.status = 'ON_SALE') AS "onSale",
              (SELECT count(*) FROM hlt_seller_licenses l
                WHERE l.seller_id = s.id
                  AND l.expires_at IS NOT NULL
                  AND l.expires_at < (now() AT TIME ZONE 'Asia/Seoul')::date) AS "expiredLicenses"
         FROM hlt_sellers s ORDER BY s.type, s.code`);
  }

  async hltSettlements() {
    const rows = await this.db.query(
      `SELECT st.period_from AS "from", st.period_to AS "to",
              s.code AS "seller", s.name AS "sellerName",
              st.gross_amount AS "gross", st.commission,
              st.refund_amount AS "refund", st.carried_in AS "carriedIn",
              st.net_amount AS "net", st.carried_out AS "carriedOut",
              st.status
         FROM hlt_settlements st JOIN hlt_sellers s ON s.id = st.seller_id
        ORDER BY st.period_from DESC, s.code LIMIT 50`);
    const ready = await this.db.query(
      `SELECT count(*)::int AS n, coalesce(sum(goods_amount),0) AS amount
         FROM v_hlt_settle_ready`);
    const blocked = await this.db.query(
      `SELECT code, name, reason FROM v_hlt_settle_blocked`);
    return { items: rows, ready: ready[0], blocked,
      note: blocked.length
        ? '하위가맹점 ID 가 없는 판매자가 있습니다 — 집계는 되지만 지급되지 않습니다.'
        : undefined };
  }

  /**
   * 주 정산 마감.
   *
   * **배송 완료 + 7일**이 지난 건만 집계합니다. 음수면 지급이 아니라
   * 이월합니다 — 판매자 계좌에서 빼 올 수 없습니다.
   */
  async closeSettlement(periodFrom: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFrom ?? '')) {
      throw new PolicyViolation('BAD_PERIOD', '정산 시작일을 YYYY-MM-DD 로 주십시오.');
    }
    const made = await this.db.query<any>(
      `WITH ready AS (
         SELECT r.seller_id, sum(r.goods_amount) AS gross, sum(r.commission) AS fee
           FROM v_hlt_settle_ready r GROUP BY r.seller_id)
       INSERT INTO hlt_settlements
         (seller_id, period_from, period_to, gross_amount, commission,
          refund_amount, carried_in, net_amount, carried_out, status)
       SELECT r.seller_id, $1::date, $1::date + 7, r.gross, r.fee, 0,
              coalesce((SELECT carried_out FROM hlt_settlements x
                         WHERE x.seller_id = r.seller_id
                           AND x.period_from = $1::date - 7), 0),
              r.gross - r.fee + coalesce((SELECT carried_out FROM hlt_settlements x
                         WHERE x.seller_id = r.seller_id
                           AND x.period_from = $1::date - 7), 0),
              0, 'DRAFT'
         FROM ready r
       ON CONFLICT (seller_id, period_from) DO NOTHING
       RETURNING id, seller_id, net_amount AS "net"`, [periodFrom]);

    /* 음수는 지급하지 않고 다음 주로 넘깁니다. */
    for (const m of made.filter((x: any) => Number(x.net) < 0)) {
      await this.db.query(
        `UPDATE hlt_settlements SET carried_out = net_amount, status = 'CARRIED'
          WHERE id = $1`, [m.id]);
    }

    return { created: made.length,
      carried: made.filter((x: any) => Number(x.net) < 0).length,
      note: '배송 완료 후 7일이 지난 건만 집계했습니다 — 청약철회 기간입니다.' };
  }

  /* ── 취소 · 반품 처리 (운영, D002) ─────────────────────────────── */

  commissionRates() {
    return this.db.query(
      `SELECT category_code AS "categoryCode", rate,
              referral_pct AS "referralPct", note, updated_at AS "updatedAt",
              (SELECT count(*) FROM hlt_commission_changes c
                WHERE c.target = r.category_code)::int AS changes
         FROM hlt_commission_rates r ORDER BY category_code`);
  }
}

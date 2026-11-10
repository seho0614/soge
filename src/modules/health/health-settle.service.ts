import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveSubmerchantProvider } from './submerchant.provider';

/**
 * 건강몰 — 판매자 · 정산 · 수수료율(운영 화면).
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthSettleService {
  constructor(private readonly db: DatabaseService) {}
  hltSellers() {
    return this.db.query(
      `SELECT s.id, s.code, s.name, s.type, s.status, s.submerchant_id AS "submerchantId",
              s.commission_rate AS "commissionRate",
              s.status_reason AS "statusReason", s.status_at AS "statusAt",   -- v10.223 (D193)
              (SELECT count(*)::int FROM hlt_seller_change_requests c WHERE c.seller_id = s.id AND c.state = 'PENDING') AS "changePending",
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
      `SELECT st.id, st.period_from AS "from", st.period_to AS "to", st.invoice_state AS "invoiceState", st.invoice_no AS "invoiceNo",
              s.type AS "sellerType", (coalesce(btrim(s.submerchant_id), '') <> '') AS "payable",
              (SELECT pr.state FROM hlt_payout_requests pr WHERE pr.settlement_id = st.id) AS "payoutState",
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
    /* v10.168 (D157) — 정산서 · 정산 항목(SALE · 정산 뒤 환불 REFUND) · 이월을 DB 함수 한 번에.
     *   전에는 정산 항목을 남기지 않아 다음 주 마감 때 같은 주문이 다시 집계됐습니다(v_hlt_settle_ready 는 항목으로 거름). 시작일은 월요일. */
    const [r] = await this.db.query<{ created: number; carried: number }>(`SELECT * FROM fn_hlt_settle_close($1::date)`, [periodFrom]);
    return { created: Number(r?.created ?? 0), carried: Number(r?.carried ?? 0),
      note: '배송 완료 후 7일이 지난 건만 집계했습니다 — 청약철회 기간입니다.' };
  }

  /* ── v10.169 (D158 · docs/260) 하위가맹점 · 확정 · 지급 요청 ─────────────────── */

  private async assumeOn() {
    const [r] = await this.db.query<{ on: boolean }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'assume.payment'), 'off') = 'on' AS "on"`);
    return !!r?.on;
  }

  /** 하위가맹점 번호 — 결제대행사 화면에서 받은 번호를 적거나(submerchantId) · 비우면 공급자에게 등록(간주 모드면 시험 번호) */
  async registerSubmerchant(sellerId: string, submerchantId?: string) {
    const [s] = await this.db.query<{ id: string; code: string; name: string; type: string; status: string }>(
      `SELECT id, code, name, type, status FROM hlt_sellers WHERE id::text = $1`, [sellerId]);
    if (!s || s.type === 'DIRECT') throw new StateConflict('NOT_FOUND', '입점 판매자를 찾을 수 없습니다.');
    if (s.status !== 'ACTIVE') throw new StateConflict('NOT_ACTIVE', '판매 중인 입점 판매자만 하위가맹점을 등록합니다.');
    let id = (submerchantId ?? '').trim();
    let stub = false;
    if (!id) {
      const p = resolveSubmerchantProvider(await this.assumeOn());
      if (!p) throw new PolicyViolation('PG_SUBMERCHANT_NOT_READY', '결제대행사 하위가맹점 연동 전입니다 — 결제대행사 화면에서 받은 번호를 적어 주십시오.');
      const r = await p.register({ code: s.code, name: s.name });
      if (!r.ok) throw new PolicyViolation('PG_SUBMERCHANT_FAILED', '하위가맹점을 등록하지 못했습니다 — 잠시 뒤 다시 해 주십시오.');
      id = (r as { submerchantId: string }).submerchantId; stub = p.stub;
    }
    await this.db.query(`UPDATE hlt_sellers SET submerchant_id = $2, submerchant_at = now(), updated_at = now() WHERE id = $1`, [s.id, id]);
    return { ok: true, submerchantId: id, stub };
  }

  /** 정산서 확정 — 판매자가 볼 시간을 둔 뒤(DRAFT → CONFIRMED · 시각은 DB 가 남김) */
  async confirmSettlement(id: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE hlt_settlements SET status = 'CONFIRMED' WHERE id::text = $1 AND status = 'DRAFT' AND net_amount > 0 RETURNING id`, [id]);
    if (!rows.length) throw new StateConflict('NOT_CONFIRMABLE', '확정할 수 있는 정산서가 아닙니다(마감 상태 · 지급액 0 보다 큼만).');
    return { ok: true, status: 'CONFIRMED' };
  }

  /** 지급 요청 — 확정된 입점 정산서를 결제대행사에 「판매자 하위가맹점으로 지급」 요청(간주 모드면 시험 · 돈은 움직이지 않음) */
  async payout(id: string) {
    return this.db.transaction(async () => {
      const [st] = await this.db.query<any>(
        `SELECT s.id, s.status, s.net_amount, s.seller_id, h.type, h.code, coalesce(btrim(h.submerchant_id), '') AS sub
           FROM hlt_settlements s JOIN hlt_sellers h ON h.id = s.seller_id WHERE s.id::text = $1 FOR UPDATE OF s`, [id]);
      if (!st) throw new StateConflict('NOT_FOUND', '정산서를 찾을 수 없습니다.');
      if (st.type === 'DIRECT') throw new StateConflict('DIRECT_NO_PAYOUT', '직판 정산서는 회사 매출이라 지급 요청이 없습니다.');
      if (st.status !== 'CONFIRMED') throw new StateConflict('NOT_CONFIRMED', '확정된 정산서만 지급을 요청합니다.');
      if (!st.sub) throw new PolicyViolation('NO_SUBMERCHANT', '하위가맹점 번호가 없는 판매자입니다 — 먼저 등록해 주십시오.');
      const p = resolveSubmerchantProvider(await this.assumeOn());
      if (!p) throw new PolicyViolation('PG_PAYOUT_NOT_READY', '결제대행사 지급대행 연동 전입니다 — 간주 모드에서만 시험할 수 있습니다.');
      const [req] = await this.db.query<{ id: string }>(
        `INSERT INTO hlt_payout_requests (settlement_id, seller_id, amount, provider, submerchant_id, stub, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [st.id, st.seller_id, Number(st.net_amount), p.name, st.sub, p.stub, RequestCtx.actorId()]);
      const r = await p.payout({ submerchantId: st.sub, amount: Number(st.net_amount), ref: `${st.code}-${String(req!.id).slice(0, 8)}` });
      if (!r.ok) {
        await this.db.query(`UPDATE hlt_payout_requests SET state = 'FAILED', error = $2 WHERE id = $1`, [req!.id, (r as { error: string }).error]);
        return { ok: false, state: 'FAILED' };
      }
      const ref = (r as { ref: string }).ref;
      await this.db.query(`UPDATE hlt_payout_requests SET state = 'DONE', ref = $2, done_at = now() WHERE id = $1`, [req!.id, ref]);
      await this.db.query(`UPDATE hlt_settlements SET status = 'PAID', paid_by = $2 WHERE id = $1`, [st.id, RequestCtx.actorId()]);
      return { ok: true, state: 'DONE', ref, stub: p.stub };
    });
  }

  /** v10.168 (D157) — 판매수수료 세금계산서 발행 기록(국세청 연동 전 · 운영이 번호를 적음) */
  async markInvoice(id: string, invoiceNo: string) {
    const no = (invoiceNo ?? '').trim();
    if (no.length < 4) throw new PolicyViolation('BAD_INVOICE_NO', '세금계산서 승인번호를 적어 주십시오.');
    const rows = await this.db.query<{ id: string }>(
      `UPDATE hlt_settlements SET invoice_state = 'ISSUED', invoice_no = $2, invoice_issued_at = now()
        WHERE id::text = $1 AND invoice_state = 'REQUESTED' RETURNING id`, [id, no]);
    if (!rows.length) throw new StateConflict('NOT_REQUESTED', '계산서를 발행할 정산서가 아닙니다(이미 발행 · 필요 없음).');
    return { ok: true, invoiceState: 'ISSUED' };
  }

  /** v10.168 (D157) — 갈래 기본 판매수수료율(결정 B · 오픈 전에 정함) — 바꾼 기록은 DB 가 남김(hlt_commission_changes) */
  async setCommissionRate(categoryCode: string, rate: number, note?: string) {
    const [c] = await this.db.query<{ code: string }>(
      `SELECT code FROM categories WHERE gwan_code = 'HLT' AND code = $1`, [categoryCode]);
    /* 전체 기본값(*) 줄은 받지 않음 — 변경 기록 트리거(fn_hlt_rate_log)가 범위 'DEFAULT' 를 쓰는데 기록 표의 규칙(hlt_chg_scope_check)이 CATEGORY · SELLER 만 받아
     *   바꾸면 늘 422(v10.168 시험이 찾음 · 옛 결함). 기본값은 fn_hlt_rate_for 의 10% — 갈래마다 정하면 됨 */
    if (!c) throw new PolicyViolation('BAD_CATEGORY', '소개몰 갈래를 골라 주십시오.');
    await this.db.query(
      `INSERT INTO hlt_commission_rates (category_code, rate, note, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (category_code) DO UPDATE SET rate = EXCLUDED.rate, note = coalesce(EXCLUDED.note, hlt_commission_rates.note),
              updated_by = EXCLUDED.updated_by, updated_at = now(),
              referral_pct = least(hlt_commission_rates.referral_pct, EXCLUDED.rate)`,
      [categoryCode, rate, note?.trim() || null, RequestCtx.actorId()]);
    return this.commissionRates();
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

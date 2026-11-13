import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveSubmerchantProvider } from './submerchant.provider';
import { HealthRateScheduleService } from './health-rate-schedule.service';

/**
 * 건강몰 — 판매자 · 정산 · 수수료율(운영 화면).
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthSettleService {
  constructor(private readonly db: DatabaseService, private readonly rates: HealthRateScheduleService) {}
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
  async setCommissionRate(categoryCode: string, rate: number, note?: string, effectiveDate?: string | null, reasonRaw?: string) {
    const [c] = await this.db.query<{ code: string; name: string }>(
      `SELECT code, name FROM categories WHERE gwan_code = 'HLT' AND code = $1`, [categoryCode]);
    /* 전체 기본값(*) 줄은 받지 않음 — 변경 기록 트리거(fn_hlt_rate_log)가 범위 'DEFAULT' 를 쓰는데 기록 표의 규칙(hlt_chg_scope_check)이 CATEGORY · SELLER 만 받아
     *   바꾸면 늘 422(v10.168 시험이 찾음 · 옛 결함). 기본값은 fn_hlt_rate_for 의 10% — 갈래마다 정하면 됨 */
    if (!c) throw new PolicyViolation('BAD_CATEGORY', '소개몰 갈래를 골라 주십시오.');
    /* v10.275 (D208) — 올라가고 그 갈래 요율이 쓰이는 판매자가 있으면 예약(약관 제17조 4항) · 내리면 바로 */
    const [cur] = await this.db.query<{ rate: string | null }>(`SELECT rate FROM hlt_commission_rates WHERE category_code = $1`, [categoryCode]);
    const sch = await this.rates.guard('CATEGORY', categoryCode, cur ? Number(cur.rate) : null, rate,
      String(reasonRaw ?? note ?? '').trim(), effectiveDate, `「${c.name}」 갈래`);
    if (sch) return sch;
    await this.db.query(
      `INSERT INTO hlt_commission_rates (category_code, rate, note, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (category_code) DO UPDATE SET rate = EXCLUDED.rate, note = coalesce(EXCLUDED.note, hlt_commission_rates.note),
              updated_by = EXCLUDED.updated_by, updated_at = now(),
              referral_pct = least(hlt_commission_rates.referral_pct, EXCLUDED.rate)`,
      [categoryCode, rate, note?.trim() || null, RequestCtx.actorId()]);
    return this.commissionRates();
  }

  /** v10.272 (D206 · docs/404) — 입점 유형별 기본 판매수수료율(약관 제17조) · 비어 있으면 갈래 요율 · 순서 판매자 → 유형 → 갈래 */
  typeRates() {
    return this.db.query(
      `SELECT t.seller_type AS "sellerType", t.rate, t.note, t.updated_at AS "updatedAt",
              (SELECT count(*) FROM hlt_sellers s WHERE s.type = t.seller_type AND s.status IN ('ACTIVE', 'PAUSED'))::int AS sellers,
              (SELECT count(*) FROM hlt_sellers s WHERE s.type = t.seller_type AND s.status IN ('ACTIVE', 'PAUSED') AND s.commission_rate IS NOT NULL)::int AS "ownRate",
              (SELECT count(*) FROM hlt_type_rate_changes c WHERE c.seller_type = t.seller_type)::int AS changes
         FROM hlt_seller_type_rates t ORDER BY t.seller_type`);
  }

  async setTypeRate(sellerType: string, rate: number | null, reasonRaw: string, effectiveDate?: string | null) {
    const reason = String(reasonRaw ?? '').trim();
    if (!['BRAND', 'TENANT'].includes(sellerType)) throw new PolicyViolation('BAD_TYPE', '입점 유형은 브랜드 직영관(BRAND) · 일반 입점(TENANT) 둘 중 하나입니다.');
    if (reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '바꾸는 사유를 적어 주십시오 — 기록에 남습니다.');
    if (rate !== null && !(rate >= 0 && rate <= 50)) throw new PolicyViolation('BAD_RATE', '수수료율은 0 ~ 50% 사이로 적어 주십시오.');
    return this.db.transaction(async () => {
      const [t] = await this.db.query<{ rate: string | null }>(
        `SELECT rate FROM hlt_seller_type_rates WHERE seller_type = $1 FOR UPDATE`, [sellerType]);
      if (!t) throw new PolicyViolation('BAD_TYPE', '입점 유형 줄이 없습니다(D206 적용 전).');
      const from = t.rate === null ? null : Number(t.rate);
      if (from === rate) throw new StateConflict('SAME_RATE', '지금과 같은 수수료율입니다.');
      const sch = await this.rates.guard('TYPE', sellerType, from, rate, reason, effectiveDate,
        sellerType === 'BRAND' ? '브랜드 직영관' : '일반 입점');   // v10.275 (D208) — 올라가면 예약
      if (sch) return sch;
      await this.db.query(`UPDATE hlt_seller_type_rates SET rate = $2, updated_by = $3, updated_at = now() WHERE seller_type = $1`,
        [sellerType, rate, RequestCtx.actorId()]);
      await this.db.query(
        `INSERT INTO hlt_type_rate_changes (seller_type, from_rate, to_rate, reason, changed_by) VALUES ($1, $2, $3, $4, $5)`,
        [sellerType, from, rate, reason, RequestCtx.actorId()]);
      return { ok: true, from, to: rate, note: rate === null ? '입점 유형 요율을 비웠습니다 — 갈래 요율을 씁니다(새 주문부터).' : '입점 유형 요율을 바꿨습니다. 새 주문부터 적용합니다.' };
    });
  }

  /**
   * v10.274 (docs/404) — 요율을 바꾸기 전 영향 미리보기 · **읽기만**
   *   최근 30일 결제된 주문 줄(대기 · 취소 뺌)을 지금 설정 요율과 새 요율로 각각 셈(줄마다 판매액 × 요율 ÷ 100 버림 · DB 와 같은 식).
   *   순서(판매자 → 유형 → 갈래 → * → 10%)상 **바꾸는 칸이 실제로 쓰이는 줄만** 셈 — 판매자 요율이 있는 판매자는 유형 · 갈래를 바꿔도 그대로.
   *   rate 가 null 이면 「비움」(다음 순서 요율로).
   */
  async rateImpact(scope: string, key: string, rate: number | null) {
    if (rate !== null && !(rate >= 0 && rate <= 50)) throw new PolicyViolation('BAD_RATE', '수수료율은 0 ~ 50% 사이로 적어 주십시오.');
    const W: Record<string, { where: string; next: string }> = {
      SELLER:   { where: `l.seller_id::text = $1`,                                  next: `coalesce($2::numeric, l.trate, l.crate)` },
      TYPE:     { where: `l.stype = $1 AND l.srate IS NULL`,                        next: `coalesce($2::numeric, l.crate)` },
      CATEGORY: { where: `l.cat = $1 AND l.srate IS NULL AND l.trate IS NULL`,      next: `coalesce($2::numeric, l.drate)` },
    };
    const w = W[scope];
    if (!w) throw new PolicyViolation('BAD_SCOPE', '범위는 SELLER · TYPE · CATEGORY 중 하나입니다.');
    if (scope === 'CATEGORY' && key === '*') throw new PolicyViolation('BAD_CATEGORY', '소개몰 갈래를 골라 주십시오.');
    const [r] = await this.db.query<Record<string, string | number>>(
      `WITH d AS (SELECT coalesce((SELECT rate FROM hlt_commission_rates WHERE category_code = '*'), 10.00) AS drate),
       l AS (
         SELECT i.amount, coalesce(i.commission_amount, 0) AS recorded, i.order_id, s.id AS seller_id, s.type AS stype, s.commission_rate AS srate,
                (SELECT t.rate FROM hlt_seller_type_rates t WHERE t.seller_type = s.type) AS trate,
                c.code AS cat, d.drate,
                coalesce((SELECT cr.rate FROM hlt_commission_rates cr WHERE cr.category_code = c.code), d.drate) AS crate
           FROM hlt_order_items i
           JOIN hlt_orders o ON o.id = i.order_id
           JOIN hlt_products p ON p.id = i.product_id
           JOIN hlt_sellers s ON s.id = p.seller_id
           LEFT JOIN categories c ON c.id = p.category_id
           CROSS JOIN d
          WHERE o.paid_at >= now() - interval '30 days' AND o.status NOT IN ('PENDING', 'CANCELED')
       )
       SELECT count(*)::int AS lines, count(DISTINCT l.order_id)::int AS orders,
              coalesce(sum(l.amount), 0)::bigint AS sales,
              coalesce(sum(l.recorded), 0)::bigint AS recorded,
              coalesce(sum(floor(l.amount * coalesce(l.srate, l.trate, l.crate) / 100)), 0)::bigint AS "nowFee",
              coalesce(sum(floor(l.amount * ${w.next} / 100)), 0)::bigint AS "newFee"
         FROM l WHERE ${w.where}`, [key, rate]);
    const nowFee = Number(r?.nowFee ?? 0), newFee = Number(r?.newFee ?? 0);
    const nt = await this.rates.notice(scope as 'SELLER' | 'TYPE' | 'CATEGORY', key, rate);   // v10.275 (D208) 예약이 필요한지
    return {
      scope, key, rate, days: 30,
      increase: nt.increase, affected: nt.affected, needsNotice: nt.needsNotice, earliest: nt.earliest, scheduled: nt.scheduled,
      lines: Number(r?.lines ?? 0), orders: Number(r?.orders ?? 0), sales: Number(r?.sales ?? 0), recorded: Number(r?.recorded ?? 0),
      nowFee, newFee, diff: newFee - nowFee,
      note: '최근 30일 결제된 주문 줄로 셈 · 이미 받은 주문의 수수료는 바뀌지 않음(주문 때 박힘) · 앞으로 같은 판매가 있다고 본 어림',
    };
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

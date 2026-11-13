import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { HealthAdminService } from './health-admin.service';
import { CARRIERS, HealthOrdersService } from './health-orders.service';
import { HealthReturnService } from './health-return.service';
import { HealthRateScheduleService } from './health-rate-schedule.service';

/* ---------------------------------------------------------------------
 * v10.166 (D156 · docs/257) — 소개몰 판매자센터: 상품 등록 → 운영 검수 · 배송비 · 반품비
 *
 *   누구     입점 승인된 판매자(hlt_sellers ACTIVE · PAUSED)의 회원만 — 자기 판매자의 상품만 봄 · 고침
 *   상품     운영 화면 「소개몰 상품」과 같은 규칙(HealthAdminService — 금지 표현 · 판매 범위 · 옵션 · 변경 기록)을 그대로 씀
 *            코드는 「판매자 코드-입력한 코드」(다른 판매자와 겹치지 않게)
 *   검수     초안 → 「검수 요청」(SUBMITTED) → 운영 통과(APPROVED) · 반려(REJECTED · 사유) → 통과한 상품만 「판매 시작」
 *            글 · 갈래 · 고시를 고치면 다시 검수(판매 중이면 초안으로 내림) — 값 · 재고 · 옵션은 검수 없이
 *   판매     DB 문(fn_hlt_tenant_sale_guard)이 검수 통과 · 판매자 ACTIVE · 하위가맹점 ID · mall.tenant on 을 봄
 *   배송     기본 배송비 · 무료 기준 · 회원 사정 왕복 반품비(6,000원 상한 · 결정 C) — 주문 · 반품 계산은 v10.167
 * ------------------------------------------------------------------- */
const CONTENT_KEYS = ['name', 'summary', 'caution', 'notice', 'adCopy', 'categoryCode', 'reviewNo', 'mainIngredient', 'imageFileId'] as const;

@Injectable()
export class HealthSellerService {
  constructor(private readonly db: DatabaseService, private readonly admin: HealthAdminService,
              private readonly orders_: HealthOrdersService, private readonly returns_: HealthReturnService, private readonly rateSched: HealthRateScheduleService) {}
  private get me() { return RequestCtx.actorId(); }

  /** 내 판매자(입점 승인된 것) — 없으면 403 */
  private async seller() {
    const [s] = await this.db.query<{ id: string; code: string; status: string }>(
      `SELECT id, code, status FROM hlt_sellers WHERE account_id = $1 AND type IN ('TENANT', 'BRAND') AND status IN ('ACTIVE', 'PAUSED')`, [this.me]);
    if (!s) throw new Forbidden('NOT_SELLER', '입점 승인된 판매자만 판매자센터를 쓸 수 있습니다.');
    return s;
  }

  /** 내 판매자의 상품인지 — 아니면 404(다른 판매자 상품이 있는지도 알리지 않음) */
  private async own(code: string) {
    const s = await this.seller();
    const [p] = await this.db.query<{ id: string; status: string; review_state: string }>(
      `SELECT id, status, review_state FROM hlt_products WHERE code = $1 AND seller_id = $2`, [code, s.id]);
    if (!p) throw new NotFound('내 상품을 찾을 수 없습니다.');
    return { s, p };
  }

  /** 판매자센터 첫 화면 — 판매자 정보 · 배송 설정 · 상품 수 */
  async center() {
    const s = await this.seller();
    const [r] = await this.db.query(
      `SELECT s.code, s.name, s.type, s.status, s.commission_rate AS "commissionRate",
              (coalesce(btrim(s.submerchant_id), '') <> '') AS "payable",
              s.ship_fee AS "shipFee", s.free_ship_over AS "freeShipOver", s.return_ship_fee AS "returnShipFee",
              (SELECT count(*)::int FROM hlt_products p WHERE p.seller_id = s.id) AS "products",
              (SELECT count(*)::int FROM hlt_products p WHERE p.seller_id = s.id AND p.status = 'ON_SALE') AS "onSale",
              (SELECT count(*)::int FROM hlt_products p WHERE p.seller_id = s.id AND p.review_state = 'SUBMITTED') AS "inReview",
              (SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant'), 'off') = 'on') AS "tenantOn"
         FROM hlt_sellers s WHERE s.id = $1`, [s.id]);
    return { ...r, rateSchedules: await this.rateSched.forSeller(s.id) };   // v10.277 (D208) 예정된 수수료율 변경(약관 제17조 4항 공지)
  }

  /** 배송비 · 반품비 — 반품비는 6,000원을 넘을 수 없음(DB 도 막음) */
  async shipping(d: { shipFee: number; freeShipOver?: number | null; returnShipFee: number }) {
    const s = await this.seller();
    if (d.returnShipFee > 6000) throw new PolicyViolation('RETURN_FEE_MAX', '회원 사정 왕복 반품비는 6,000원을 넘을 수 없습니다.');
    await this.db.query(
      `UPDATE hlt_sellers SET ship_fee = $2, free_ship_over = $3, return_ship_fee = $4, updated_at = now() WHERE id = $1`,
      [s.id, d.shipFee, d.freeShipOver || null, d.returnShipFee]);
    return this.center();
  }

  /** 내 상품 목록 */
  async products() {
    const s = await this.seller();
    return this.db.query(
      `SELECT p.code, p.name, p.status, p.review_state AS "reviewState", p.review_note AS "reviewNote",
              p.price, p.stock, c.code AS "categoryCode", c.name AS "categoryName",
              p.submitted_at AS "submittedAt", p.reviewed_at AS "reviewedAt", p.updated_at AS "updatedAt"
         FROM hlt_products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.seller_id = $1 ORDER BY p.updated_at DESC LIMIT 300`, [s.id]);
  }

  async product(code: string) {
    const { p } = await this.own(code);
    const d = await this.admin.get(code);
    const [r] = await this.db.query<any>(`SELECT review_state AS "reviewState", review_note AS "reviewNote" FROM hlt_products WHERE id = $1`, [p.id]);
    return { ...d, ...r };
  }

  /** 상품 등록 — 초안 · 코드는 「판매자 코드-입력」 · 판매자는 나 */
  async create(d: any) {
    const s = await this.seller();
    const code = `${s.code}-${String(d.code ?? '')}`;
    if (code.length > 40) throw new PolicyViolation('BAD_CODE', '상품 코드가 너무 깁니다 — 판매자 코드를 빼고 30자 안으로 적어 주십시오.');
    return this.db.transaction(async () => {
      await this.admin.create({ ...d, code });
      await this.db.query(`UPDATE hlt_products SET seller_id = $2 WHERE code = $1`, [code, s.id]);
      return { code, status: 'DRAFT', reviewState: 'NONE', note: '초안으로 등록했습니다. 「검수 요청」을 하면 운영이 확인합니다.' };
    });
  }

  /** 상품 고치기 — 글 · 갈래 · 고시를 바꾸면 다시 검수(판매 중이면 초안으로) */
  async update(code: string, d: any) {
    return this.db.transaction(async () => {
      const { p } = await this.own(code);
      const content = CONTENT_KEYS.some((k) => d[k] !== undefined);
      await this.admin.update(code, d);
      if (content && p.review_state !== 'NONE') {
        await this.db.query(
          `UPDATE hlt_products SET review_state = 'NONE', review_note = NULL, status = CASE WHEN status = 'ON_SALE' THEN 'DRAFT' ELSE status END, updated_at = now()
            WHERE id = $1`, [p.id]);
      }
      return this.product(code);
    });
  }

  /** 검수 요청 */
  async submit(code: string) {
    return this.db.transaction(async () => {
      const { p } = await this.own(code);
      if (p.review_state === 'SUBMITTED') throw new StateConflict('ALREADY_SUBMITTED', '이미 검수를 기다리는 상품입니다.');
      if (p.review_state === 'APPROVED') throw new StateConflict('ALREADY_APPROVED', '이미 검수를 통과한 상품입니다.');
      const [{ n }] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hlt_product_options WHERE product_id = $1 AND is_active`, [p.id]);
      if (!n) throw new PolicyViolation('OPTIONS_REQUIRED', '켠 옵션(결제 금액 · 재고)이 하나 이상 있어야 검수를 요청할 수 있습니다.');
      await this.db.query(
        `UPDATE hlt_products SET review_state = 'SUBMITTED', review_note = NULL, submitted_at = now(), updated_at = now() WHERE id = $1`, [p.id]);
      return this.product(code);
    });
  }

  /** 판매 시작 · 멈춤 · 품절 — 판매 시작은 DB 문이 검수 · 판매자 · 하위가맹점 · 켜짐을 봄 */
  async status(code: string, status: string) {
    if (!['ON_SALE', 'STOPPED', 'SOLD_OUT'].includes(status)) throw new PolicyViolation('BAD_STATUS', '판매 시작 · 판매 중지 · 품절만 바꿀 수 있습니다.');
    await this.own(code);
    return this.admin.setStatus(code, status);
  }

  async addOption(code: string, o: any) { await this.own(code); return this.admin.addOption(code, o); }
  async updateOption(code: string, optionId: string, d: any) { await this.own(code); return this.admin.updateOption(code, optionId, d); }

  /* ── v10.167 (docs/258) 주문 · 발송 · 반품 ──────────────────── */

  /** 내 판매자의 주문인지 — 아니면 404 */
  private async ownOrder(no: string) {
    const s = await this.seller();
    const [o] = await this.db.query<{ id: string }>(`SELECT id FROM hlt_orders WHERE order_no = $1 AND seller_id = $2`, [no, s.id]);
    if (!o) throw new NotFound('내 주문을 찾을 수 없습니다.');
    return { s, o };
  }

  /** 내 주문 — 발송할 것 먼저 · 배송에 필요한 받는 분 정보(입점 약관 제22조 — 배송 · 반품 · 응대 목적으로만) */
  async orders(status?: string) {
    const s = await this.seller();
    const st = status && ['PAID', 'SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(status) ? status : null;
    const items = await this.db.query(
      `SELECT o.order_no AS "orderNo", o.status, o.goods_amount AS "goodsAmount", o.ship_fee AS "shipFee", o.total,
              o.paid_at AS "paidAt", o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt", o.confirmed_at AS "confirmedAt",
              o.ship_memo AS "shipMemo",
              (SELECT string_agg(p.name || ' ' || coalesce(i.option_label, '') || ' × ' || i.qty, ' · ' ORDER BY i.id)
                 FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id WHERE i.order_id = o.id) AS items,
              CASE WHEN o.status IN ('PAID','PREPARING','SHIPPED') THEN a.receiver END AS receiver,
              CASE WHEN o.status IN ('PAID','PREPARING','SHIPPED') THEN a.phone END AS phone,
              CASE WHEN o.status IN ('PAID','PREPARING','SHIPPED') THEN concat_ws(' ', '(' || a.zipcode || ')', a.addr1, a.addr2) END AS address,
              x.carrier, x.tracking_no AS "trackingNo", x.state AS "shipState",
              EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('REQUESTED','APPROVED')) AS "openReturn"
         FROM hlt_orders o
         LEFT JOIN hlt_addresses a ON a.id = o.address_id
         LEFT JOIN LATERAL (SELECT carrier, tracking_no, state FROM hlt_shipments y WHERE y.order_id = o.id ORDER BY y.happened_at DESC, y.id DESC LIMIT 1) x ON true
        WHERE o.seller_id = $1 AND o.status IN ('PAID','PREPARING','SHIPPED','DELIVERED','CONFIRMED','RETURNED','CANCELED')
          AND ($2::text IS NULL OR o.status = $2 OR ($2 = 'PAID' AND o.status = 'PREPARING'))
        ORDER BY (o.status IN ('PAID','PREPARING')) DESC, (o.status = 'SHIPPED') DESC, coalesce(o.paid_at, o.created_at) DESC LIMIT 200`, [s.id, st]);
    const [counts] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status IN ('PAID','PREPARING'))::int AS "toShip", count(*) FILTER (WHERE status = 'SHIPPED')::int AS shipping,
              count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered, count(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed
         FROM hlt_orders WHERE seller_id = $1`, [s.id]);
    return { counts, carriers: CARRIERS, items };
  }

  async ship(no: string, carrier: string, trackingNo: string) { await this.ownOrder(no); return this.orders_.ship(no, carrier, trackingNo); }
  async fixTracking(no: string, carrier: string, trackingNo: string) { await this.ownOrder(no); return this.orders_.fixTracking(no, carrier, trackingNo); }
  async advance(no: string, state: 'IN_TRANSIT' | 'DELIVERED') { await this.ownOrder(no); return this.orders_.advance(no, state); }

  /** 내 주문의 취소 · 반품 · 교환 신청 — 접수(REQUESTED) 먼저 */
  async returns() {
    const s = await this.seller();
    return this.db.query(
      `SELECT r.id, r.kind, r.reason, r.detail, r.state, r.customer_opened AS "customerOpened", r.exchange_fee AS "exchangeFee",
              r.decide_note AS "decideNote", r.created_at AS "createdAt", r.decided_at AS "decidedAt",
              o.order_no AS "orderNo", o.status AS "orderStatus", o.total, r.ship_deduction AS "shipDeduction", r.refund_amount AS "refundAmount"
         FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
        WHERE o.seller_id = $1 ORDER BY (r.state = 'REQUESTED') DESC, r.created_at DESC LIMIT 200`, [s.id]);
  }

  /** 반품 · 취소 승인 · 반려 — 운영과 같은 규칙(재고 · 환불 · 반품비 · 교환 배송비). 반려에 회원이 이의를 내면 운영이 중재(입점 약관 제16조) */
  async decideReturn(id: string, state: string, note?: string, opened?: boolean, sellerFault?: boolean) {
    const s = await this.seller();
    const [r] = await this.db.query<{ id: string }>(
      `SELECT r.id FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id WHERE r.id::text = $1 AND o.seller_id = $2`, [id, s.id]);
    if (!r) throw new NotFound('내 주문의 신청을 찾을 수 없습니다.');
    return this.returns_.decideReturn(id, state, note, opened, sellerFault);
  }

  /* ── v10.168 (D157 · docs/259) 정산 ─────────────────────────────── */

  /** 내 정산서 — 주 1회 마감 · 매출 · 수수료 · 환불 조정 · 이월 · 지급액 · 계산서 상태 */
  async settlements() {
    const s = await this.seller();
    return this.db.query(
      `SELECT st.id, st.period_from AS "from", st.period_to AS "to", st.gross_amount AS gross, st.commission, st.refund_amount AS refund,
              st.carried_in AS "carriedIn", st.net_amount AS net, st.carried_out AS "carriedOut", st.status,
              st.invoice_state AS "invoiceState", st.invoice_no AS "invoiceNo", st.confirmed_at AS "confirmedAt", st.paid_at AS "paidAt",
              (SELECT count(*)::int FROM hlt_settlement_items i WHERE i.settlement_id = st.id) AS "items",
              (SELECT pr.state FROM hlt_payout_requests pr WHERE pr.settlement_id = st.id) AS "payoutState",
              (SELECT pr.ref FROM hlt_payout_requests pr WHERE pr.settlement_id = st.id) AS "payoutRef"
         FROM hlt_settlements st WHERE st.seller_id = $1 ORDER BY st.period_from DESC LIMIT 104`, [s.id]);
  }

  /** 정산서 하나의 주문별 명세(입점 약관 제19조 ④) */
  async settlement(id: string) {
    const s = await this.seller();
    const [st] = await this.db.query<{ id: string }>(`SELECT id FROM hlt_settlements WHERE id::text = $1 AND seller_id = $2`, [id, s.id]);
    if (!st) throw new NotFound('내 정산서를 찾을 수 없습니다.');
    return this.db.query(
      `SELECT i.kind, o.order_no AS "orderNo", i.goods_amount AS "goodsAmount", i.commission, i.net_amount AS net, o.delivered_at AS "deliveredAt"
         FROM hlt_settlement_items i JOIN hlt_orders o ON o.id = i.order_id WHERE i.settlement_id = $1 ORDER BY i.kind DESC, o.order_no`, [st.id]);
  }

  /* ── 운영 ─────────────────────────────────────────────────────────── */

  /** 입점 상품 검수 대기 — 오래된 것부터 */
  reviewQueue() {
    return this.db.query(
      `SELECT p.code, p.name, p.status, p.price, p.summary, p.caution, p.notice, p.review_no AS "reviewNo",
              c.code AS "categoryCode", c.name AS "categoryName", s.code AS "sellerCode", s.name AS "sellerName",
              (coalesce(btrim(s.submerchant_id), '') <> '') AS "payable", p.submitted_at AS "submittedAt",
              (SELECT count(*)::int FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active) AS "options"
         FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.review_state = 'SUBMITTED' ORDER BY p.submitted_at LIMIT 200`);
  }

  /** 검수 — 통과 · 반려(사유는 판매자에게 그대로 보임) */
  async review(code: string, decision: string, note?: string) {
    const why = (note ?? '').trim();
    if (decision === 'REJECT' && why.length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오 — 판매자에게 그대로 보입니다.');
    return this.db.transaction(async () => {
      const [p] = await this.db.query<{ id: string; review_state: string }>(
        `SELECT p.id, p.review_state FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id
          WHERE p.code = $1 AND s.type IN ('TENANT', 'BRAND') FOR UPDATE OF p`, [code]);
      if (!p) throw new NotFound('입점 상품을 찾을 수 없습니다.');
      if (p.review_state !== 'SUBMITTED') throw new StateConflict('NOT_SUBMITTED', '검수를 기다리는 상품이 아닙니다.');
      const st = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await this.db.query(
        `UPDATE hlt_products SET review_state = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4, updated_at = now() WHERE id = $1`,
        [p.id, st, why || null, this.me]);
      await this.db.query(
        `INSERT INTO hlt_product_history (product_id, actor_id, field, before, after, note) VALUES ($1, $2, 'review', 'SUBMITTED', $3, $4)`,
        [p.id, this.me, st, why || null]);
      return { code, reviewState: st };
    });
  }
}

import { affTouchHash, AFF_WINDOW_HOURS } from '../affiliate/aff-touch';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AppError, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { HLT_CUSTOMER_REASONS, HLT_EXCHANGE_SHIP_ROUND_TRIP, HLT_RETURN_SHIP_ROUND_TRIP, HLT_SHIP_FEE, exchangeFee, returnShipDeduction } from './health-policy';
import { FEE_STATE_SQL, PAY_COLS } from './health-shop.shared';

/**
 * 건강몰 — 주문 넣기 · 내 주문 · 배송지 · 장바구니 · 배송 조회(결제는 HealthPaymentService).
 * 규칙은 DB 가 집행합니다(`fn_hlt_product_guard` · `fn_hlt_stock_guard`). 여기서는 읽고 넣는 일만 합니다.
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthCheckoutService {
  constructor(private readonly db: DatabaseService) {}
  /**
   * 주문.
   *
   * 청약철회 규칙을 **주문 시점에 복사**합니다 — 상품 규칙이 나중에
   * 바뀌어도 사실 때 규칙이 적용됩니다.
   */
  async order(d: any, visitorKey?: string) {
    const me = RequestCtx.actorId()!;
    if (!d.items?.length) throw new PolicyViolation('EMPTY', '담으신 상품이 없습니다.');

    /* 배송지는 본인 것 · 지우지 않은 것만 — 전에는 남의 배송지 id 도 받았습니다 */
    const [addr] = await this.db.query<any>(
      `SELECT id FROM hlt_addresses WHERE id::text = $1 AND account_id = $2 AND deleted_at IS NULL`,
      [d.addressId, me]);
    if (!addr) throw new PolicyViolation('BAD_ADDRESS', '배송지를 다시 골라 주십시오.');

    /* v10.26 (D027) — 품목마다 옵션을 정합니다. 옵션을 주지 않으면 켠 옵션이 하나뿐인 상품(단품)만 그 옵션으로 봅니다 */
    const lines = await this.resolveLines(d.items);
    let goods = 0;
    for (const l of lines) goods += Number(l.price) * l.qty;

    /* 배송비는 받지 않습니다 — 전 상품 무료(2026-10-08 · health-policy.ts). 전에는 3만원 이상만 무료였습니다. */
    const ship = HLT_SHIP_FEE;

    /* 20261002 — 한 트랜잭션으로 묶습니다. 전에는 재고 트리거가 422 로 막아도
     * 주문 머리 행이 남아 **품목 없는 주문**이 생기고 그 주문에 결제까지 걸 수 있었습니다(실측). */
    return this.db.transaction(async () => {
    /* v10.26 (G-182) — 주문서에서 온 주문은 **장바구니와 대조**합니다. 장바구니의 그 줄을 먼저 비우고(같은 거래),
     * 비운 것이 보낸 품목 · 수량과 꼭 같지 않으면 거절합니다(거절되면 비운 것도 되돌아갑니다).
     * 전에는 화면이 들고 있던 품목을 그대로 받아, 결제 화면에서 「← 뒤로」로 돌아간 예전 주문서를 다시 보내면 같은 주문이 하나 더 생겼습니다(재고도 한 번 더 줄어듦).
     * 같은 주문서가 동시에 두 번 와도 줄을 먼저 비운 쪽만 접수됩니다.
     * v10.26 (D027) — 대조 단위는 옵션입니다. 담은 뒤 값이 바뀐 줄이 있으면 확인(priceAck 또는 장바구니의 「확인했습니다」)을 받아야 합니다. */
    if (d.fromCart === true) {
      const taken = await this.db.query<{ option_id: string; qty: number; added_price: string | null }>(
        `DELETE FROM hlt_cart_items WHERE account_id = $1 AND option_id = ANY($2::uuid[])
         RETURNING option_id, qty, added_price`, [me, lines.map((l) => l.optionId)]);
      const inCart = new Map(taken.map((t) => [t.option_id, t]));
      const same = taken.length === lines.length && lines.every((l) => Number(inCart.get(l.optionId)?.qty) === l.qty);
      if (!same) {
        throw new StateConflict('CART_CHANGED',
          '장바구니가 바뀌었습니다 — 이미 주문하셨거나 수량이 달라졌습니다. 장바구니를 다시 확인해 주십시오.');
      }
      const changed = lines.filter((l) => { const a = inCart.get(l.optionId)?.added_price; return a != null && Number(a) !== Number(l.price); });
      if (changed.length && d.priceAck !== true) {
        throw new AppError(409, { code: 'PRICE_CHANGED',
          message: '담으신 뒤 값이 바뀐 상품이 있습니다 — 장바구니에서 바뀐 값을 확인해 주십시오.',
          details: { lines: changed.map((l) => ({ code: l.code, optionId: l.optionId, label: l.label, before: Number(inCart.get(l.optionId)!.added_price), now: Number(l.price) })) } });
      }
    }
    /* v10.31 (시안 「배송 요청사항」) — 배송사로 넘어가는 글이라 연락처 · 계좌번호 같은 숫자 묶음은 받지 않습니다 */
    const memo = typeof d.shipMemo === 'string' ? d.shipMemo.replace(/\s+/g, ' ').trim().slice(0, 50) : '';
    if (memo && /\d[\d\s-]{7,}\d/.test(memo)) {
      throw new PolicyViolation('MEMO_HAS_NUMBER', '배송 요청사항에는 전화번호 · 계좌번호를 적지 마십시오. 받는 분 연락처는 배송지에 있습니다.');
    }
    const [o] = await this.db.query<any>(
      `INSERT INTO hlt_orders (order_no, account_id, address_id,
                               goods_amount, ship_fee, total, ship_memo)
       VALUES (fn_next_hlt_order_no(), $1, $2, $3, $4, $5, $6)
       RETURNING id, order_no AS "orderNo", total, status`,
      [me, d.addressId, goods, ship, goods + ship, memo || null]);

    /* 옵션 재고 확인 · 옵션 이름 복사(fn_hlt_stock_guard) · 재고 빼기(fn_hlt_stock_take)는 DB 가 합니다 */
    for (const l of lines) {
      await this.db.query(
        `INSERT INTO hlt_order_items (order_id, product_id, option_id, qty, unit_price,
                                      amount, withdrawal_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [o.id, l.productId, l.optionId, l.qty, l.price, Number(l.price) * l.qty, l.withdrawalCode]);
    }

    /* 주문한 옵션은 장바구니에서 뺍니다 — 전에는 남아 있어 같은 것을 또 주문하게 됐습니다 */
    await this.db.query(
      `DELETE FROM hlt_cart_items WHERE account_id = $1 AND option_id = ANY($2::uuid[])`,
      [me, lines.map((l) => l.optionId)]);

    /* v10.27 (G-190) — 제휴 링크 귀속. 이 방문자가 72시간 안에 누른 제휴 링크 가운데 가장 최근 것으로,
     * 그 링크의 도착 주소가 소개몰(/health…)이고 상품 화면(/health/p/코드)이면 이 주문에 그 상품이 있어야 합니다.
     * 파트너 본인의 주문 · 판매를 멈춘 제휴상품 · 쓰지 않는 링크는 귀속하지 않습니다.
     * 여기서는 표시만 해 두고, 결제되면 DB(fn_hlt_aff_sync)가 제휴 주문 · 수익을 만듭니다 — 결제하지 않은 주문에는 수수료가 없습니다. */
    const touch = affTouchHash(visitorKey);
    if (touch) {
      await this.db.query(
        `UPDATE hlt_orders o SET aff_link_id = t.link_id, aff_clicked_at = t.clicked_at
           FROM (SELECT t.link_id, t.clicked_at
                   FROM aff_touches t
                   JOIN partner_links l ON l.id = t.link_id AND l.is_active
                   JOIN partners pt ON pt.id = l.partner_id AND pt.status = 'ACTIVE'
                   JOIN businesses b ON b.id = pt.business_id
                   JOIN affiliate_products ap ON ap.id = l.product_id AND ap.status = 'ON_SALE'
                  WHERE t.visitor_hash = $2
                    AND t.clicked_at > now() - make_interval(hours => $5)
                    AND b.account_id <> $3
                    AND coalesce(nullif(btrim(l.landing_url), ''), ap.landing_url) ~ '^(https?://[^/]+)?/health(/|[?]|#|$)'
                    AND (coalesce(nullif(btrim(l.landing_url), ''), ap.landing_url) !~ '/health/p/'
                         OR substring(coalesce(nullif(btrim(l.landing_url), ''), ap.landing_url) FROM '/health/p/([^/?#]+)') = ANY($4::text[]))
                  ORDER BY t.clicked_at DESC LIMIT 1) t
          WHERE o.id = $1`,
        [o.id, touch, me, lines.map((l) => l.code), AFF_WINDOW_HOURS]);
    }

    return { ...o, shipFee: ship, note: '배송비는 없습니다(전 상품 무료).' };
    });
  }

  /**
   * 주문 · 담기의 품목을 옵션으로 정합니다(D027). 판매 중 상품 · 켠 옵션만.
   * 옵션을 주지 않으면 켠 옵션이 하나뿐인 상품(단품 · 지금 상품)만 받습니다 — 여럿이면 OPTION_REQUIRED.
   */
  private async resolveLines(items: Array<{ productCode: string; optionId?: string; qty: number }>) {
    const out: Array<{ code: string; productId: string; optionId: string; price: number; qty: number; label: string; withdrawalCode: string; stock: number }> = [];
    for (const it of items) {
      const qty = Number(it?.qty);
      if (!it || typeof it.productCode !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw new PolicyViolation('BAD_ITEM', '품목(상품 코드 · 수량 1 ~ 99)을 다시 확인해 주십시오.');
      }
      if (it.optionId != null && (typeof it.optionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(it.optionId))) {
        throw new PolicyViolation('BAD_ITEM', '옵션을 다시 골라 주십시오.');
      }
      const opts = await this.db.query<any>(
        `SELECT p.id AS "productId", p.code, p.status, p.withdrawal_code AS "withdrawalCode",
                o.id AS "optionId", o.price, o.stock, fn_hlt_option_label(o.months, o.tag) AS label
           FROM hlt_products p JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active
          WHERE p.code = $1 ORDER BY o.sort`, [it.productCode]);
      if (!opts.length || opts[0].status !== 'ON_SALE') throw new PolicyViolation('NOT_ON_SALE', '판매 중이 아닌 상품이 있습니다.');
      const o = it.optionId ? opts.find((x) => x.optionId === it.optionId) : (opts.length === 1 ? opts[0] : null);
      if (!o) {
        if (it.optionId) throw new PolicyViolation('BAD_OPTION', '이 상품의 옵션이 아닙니다 — 옵션을 다시 골라 주십시오.');
        throw new PolicyViolation('OPTION_REQUIRED', '옵션(개월 수)을 골라 주십시오.');
      }
      if (out.some((x) => x.optionId === o.optionId)) throw new PolicyViolation('DUPLICATE_ITEM', '같은 옵션이 두 번 들어 있습니다.');
      out.push({ code: o.code, productId: o.productId, optionId: o.optionId, price: Number(o.price), qty, label: o.label, withdrawalCode: o.withdrawalCode, stock: Number(o.stock) });
    }
    return out;
  }

  myOrders() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      /* v10.25 — 목록 줄에 무엇을 산 주문인지 보이게 첫 상품 이름과 품목 수를 함께 내립니다(시안의 내 주문 줄) */
      `SELECT o.order_no AS "orderNo", o.total, o.status, o.created_at AS "createdAt",
              o.shipped_at AS "shippedAt", o.delivered_at AS "deliveredAt",
              /* v10.28 (D035) — 구매확정 · 자동 확정 기한 · 처리 중인 신청 */
              o.confirmed_at AS "confirmedAt", CASE WHEN o.status = 'DELIVERED' THEN fn_hlt_confirm_due(o.id) END AS "confirmDue",
              EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('REQUESTED','APPROVED')) AS "openReturn",
              (SELECT p.name FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id
                WHERE i.order_id = o.id ORDER BY i.amount DESC, p.name LIMIT 1) AS "firstItemName",
              (SELECT count(*)::int FROM hlt_order_items i WHERE i.order_id = o.id) AS "itemCount",
              /* v10.26 (G-183) — 취소 신청이 접수돼 처리를 기다리는 주문. 화면이 「결제하기」를 감추고 「취소 신청 중」을 보입니다 */
              EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.kind = 'CANCEL' AND r.state = 'REQUESTED') AS "cancelRequested",
              /* v10.31 (시안 주문 카드) — 첫 상품의 그림 · 코드, 리뷰를 쓴 품목 수(「리뷰쓰기」 · 「내 리뷰 고치기」) */
              fi.code AS "firstItemCode", fi.art AS "firstItemArt", fi."imageUrl" AS "firstItemImageUrl",
              (SELECT count(*)::int FROM hlt_reviews rv WHERE rv.order_id = o.id AND rv.account_id = o.account_id) AS "reviewCount"
         FROM hlt_orders o
         LEFT JOIN LATERAL (
           SELECT p.code, json_build_object('form', p.art_form, 'tone', p.art_tone) AS art,
                  CASE WHEN f.id IS NOT NULL THEN '/api/v1/health/products/' || p.code || '/image' END AS "imageUrl"
             FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id
             LEFT JOIN files f ON f.id = p.image_file_id AND f.status = 'READY' AND f.purpose = 'PRODUCT_IMAGE'
            WHERE i.order_id = o.id ORDER BY i.amount DESC, p.name LIMIT 1) fi ON true
        WHERE o.account_id = $1
        ORDER BY o.created_at DESC LIMIT 50`, [me]);
  }

  async myOrder(no: string) {
    const me = RequestCtx.actorId()!;
    const [o] = await this.db.query<any>(
      `SELECT id, order_no AS "orderNo", goods_amount AS "goodsAmount",
              ship_fee AS "shipFee", total, status, created_at AS "createdAt",
              paid_at AS "paidAt", shipped_at AS "shippedAt",
              delivered_at AS "deliveredAt",
              EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = hlt_orders.id AND r.kind = 'CANCEL' AND r.state = 'REQUESTED') AS "cancelRequested",
              /* v10.28 (D035) */
              confirmed_at AS "confirmedAt", confirmed_by AS "confirmedBy",
              CASE WHEN status = 'DELIVERED' THEN fn_hlt_confirm_due(id) END AS "confirmDue",
              EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = hlt_orders.id AND r.state IN ('REQUESTED','APPROVED')) AS "openReturn",
              ship_memo AS "shipMemo",
              /* v10.31 — 자동 구매확정 기한이 지났는데 아직 배송 완료(매일 04시 일괄 작업이 확정합니다) */
              (status = 'DELIVERED' AND now() >= fn_hlt_confirm_due(id)) AS "confirmOverdue"
         FROM hlt_orders WHERE order_no = $1 AND account_id = $2`, [no, me]);
    if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');

    const items = await this.db.query(
      /* v10.26 — 옵션 이름(주문 때 복사한 것) · 작은 그림(꼴 · 색 · 사진) · 표제 성분 */
      `SELECT p.code, p.name, i.qty, i.unit_price AS "unitPrice", i.amount,
              i.option_id AS "optionId", i.option_label AS "optionLabel", i.months,
              w.label AS "withdrawalLabel", w.days AS "withdrawalDays",
              w.blocked_if AS "withdrawalBlockedIf",
              json_build_object('form', p.art_form, 'tone', p.art_tone) AS art,
              CASE WHEN f.id IS NOT NULL THEN '/api/v1/health/products/' || p.code || '/image' END AS "imageUrl",
              (SELECT json_build_object('code', g.code, 'name', g.name, 'amount', pi.amount)
                 FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
                WHERE pi.product_id = p.id AND pi.is_main) AS "mainIngredient"
         FROM hlt_order_items i
         JOIN hlt_products p ON p.id = i.product_id
         LEFT JOIN files f ON f.id = p.image_file_id AND f.status = 'READY' AND f.purpose = 'PRODUCT_IMAGE'
         LEFT JOIN withdrawal_rules w ON w.code = i.withdrawal_code
        WHERE i.order_id = $1`, [o.id]);
    /* 취소·반품 가능 여부 — 서버 판정(fn_hlt_return_judge)을 그대로 내려 화면이 따로 계산하지 않게 합니다 */
    const judge = async (kind: string, reason: string) => {
      const [j] = await this.db.query<any>(
        `SELECT ok, code, message, deadline FROM fn_hlt_return_judge($1, $2, $3)`, [o.id, kind, reason]);
      return j;
    };
    const returnable = {
      cancel: await judge('CANCEL', 'CHANGE_MIND'),
      /** 단순 변심 기준 */
      return: await judge('RETURN', 'CHANGE_MIND'),
      /** 하자·오배송·표시와 다름 기준 (17조 3항) */
      returnSellerFault: await judge('RETURN', 'DEFECT'),
    };
    /* D006 — 마지막 결제 건. 시험 결제(stub) 표시 · 가상계좌 안내에 씁니다 */
    const [payment] = await this.db.query<any>(
      `SELECT ${PAY_COLS} FROM hlt_payments p
        WHERE p.order_id = $1 ORDER BY (p.state = 'PAID') DESC, p.created_at DESC LIMIT 1`, [o.id]);
    /* 10/2 — 고객 사정 반품의 왕복 배송비 차감(health-policy.ts). 화면이 금액을 따로 적지 않게 서버 값을 내립니다 */
    /* v10.27 (G-184) — 결제하지 않은 주문은 낸 돈이 없습니다. 전에는 주문 금액을 「결제 금액」으로 내려 환불 표가 그려졌습니다 */
    /* v10.31 (결함 — 배송 완료 주문에 「결제 전 취소」 상자) — 결제 여부는 주문의 결제 시각(paid_at)이 기준입니다.
     *   전에는 결제 행(hlt_payments)의 승인 기록만 봐서, 결제 행이 없는 주문(운영 수기 · 시험 자료)은 배송이 끝나도 「결제 전」으로 보였습니다. */
    const [pp] = await this.db.query<{ paid: boolean }>(
      `SELECT ((SELECT paid_at FROM hlt_orders WHERE id = $1) IS NOT NULL
               OR EXISTS (SELECT 1 FROM hlt_payments WHERE order_id = $1 AND approved_at IS NOT NULL)) AS paid`, [o.id]);
    const paid = !!pp?.paid;
    const paidAmount = !paid ? 0 : payment?.state === 'PAID' ? Number(payment.amount) : Number(o.total);
    const returnShip = {
      customerReasons: HLT_CUSTOMER_REASONS, roundTripFee: HLT_RETURN_SHIP_ROUND_TRIP,
      /** v10.27 (G-184) — 결제했는가. false 면 환불 표 대신 「결제 전 취소 — 환불할 금액이 없습니다」 */
      paid,
      /** v10.25 — 환불 예상 표(결제 금액 · 반품 배송비 · 환불 예정액)의 기준 금액. 화면이 따로 계산하지 않게 내립니다 */
      paidAmount,
      customerRefundEstimate: Math.max(0, paidAmount - returnShipDeduction('RETURN', 'CHANGE_MIND', paidAmount)),
    };
    /* v10.26 — 진행 중인 교환(가장 최근 신청) · 교환 배송비 결제 상태. 주문 상태 값은 늘리지 않고 신청으로 보입니다(「교환 접수」) */
    const [exchange] = await this.db.query<any>(
      `SELECT r.id, r.state, r.reason, r.exchange_fee AS fee, r.created_at AS "createdAt", ${FEE_STATE_SQL} AS "feeState"
         FROM hlt_returns r WHERE r.order_id = $1 AND r.kind = 'EXCHANGE' ORDER BY r.created_at DESC LIMIT 1`, [o.id]);
    return { ...o, items, returnable, payment: payment ?? null, returnShip,
      exchange: exchange ?? null, exchangeFee: HLT_EXCHANGE_SHIP_ROUND_TRIP };
  }

  addresses() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT id, label, receiver, phone, zipcode, addr1, addr2,
              is_default AS "isDefault"
         FROM hlt_addresses WHERE account_id = $1 AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at DESC`, [me]);
  }

  async addAddress(d: any) {
    const me = RequestCtx.actorId()!;
    const [n] = await this.db.query<any>(
      `SELECT count(*)::int AS c FROM hlt_addresses WHERE account_id = $1 AND deleted_at IS NULL`, [me]);
    const [a] = await this.db.query<any>(
      `INSERT INTO hlt_addresses (account_id, label, receiver, phone,
                                  zipcode, addr1, addr2, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, receiver, zipcode, addr1`,
      [me, d.label ?? null, d.receiver, d.phone, d.zipcode,
       d.addr1, d.addr2 ?? null, n.c === 0]);
    return a;
  }

  /** 내 배송지 하나 (지운 것 제외). 남의 것이면 없는 것으로 봅니다 */
  private async myAddress(id: string) {
    const me = RequestCtx.actorId()!;
    const [a] = await this.db.query<any>(
      `SELECT id, is_default FROM hlt_addresses
        WHERE id::text = $1 AND account_id = $2 AND deleted_at IS NULL FOR UPDATE`, [id, me]);
    if (!a) throw new StateConflict('NOT_FOUND', '없는 배송지입니다.');
    return { me, a };
  }

  /**
   * 기본 배송지 바꾸기. 계정당 기본은 **하나**입니다(idx_hlt_addr_default).
   * 먼저 내리고 올립니다 — 한 문장으로 하면 유일 인덱스가 중간에 걸립니다.
   */
  async setDefaultAddress(id: string) {
    return this.db.transaction(async () => {
      const { me, a } = await this.myAddress(id);
      if (!a.is_default) {
        await this.db.query(
          `UPDATE hlt_addresses SET is_default = false WHERE account_id = $1 AND is_default`, [me]);
        await this.db.query(`UPDATE hlt_addresses SET is_default = true WHERE id = $1`, [a.id]);
      }
      return { id: a.id, isDefault: true, note: '기본 배송지로 정했습니다.' };
    });
  }

  /**
   * 배송지 지우기.
   *  · 진행 중인 주문(결제 대기~배송중)이 가리키면 **막습니다** — 그 주소로 가는 중입니다.
   *  · 지난 주문이 가리키면 **감춥니다**(deleted_at) — 주문 내역의 배송지가 사라지면 안 됩니다.
   *  · 아무 주문도 가리키지 않으면 행을 지웁니다(개인정보를 남기지 않습니다).
   *  기본 배송지를 지우면 가장 최근 배송지가 기본이 됩니다.
   */
  async deleteAddress(id: string) {
    return this.db.transaction(async () => {
      const { me, a } = await this.myAddress(id);
      const [use] = await this.db.query<any>(
        `SELECT count(*) FILTER (WHERE status IN ('PENDING','PAID','PREPARING','SHIPPED'))::int AS live,
                count(*)::int AS total
           FROM hlt_orders WHERE address_id = $1`, [a.id]);
      if (use.live > 0) {
        throw new StateConflict('ADDRESS_IN_USE',
          '진행 중인 주문이 이 배송지로 가고 있어 지울 수 없습니다. 배송이 끝난 뒤 지워 주십시오.');
      }
      if (use.total > 0) {
        await this.db.query(
          `UPDATE hlt_addresses SET deleted_at = now(), is_default = false WHERE id = $1`, [a.id]);
      } else {
        await this.db.query(`DELETE FROM hlt_addresses WHERE id = $1`, [a.id]);
      }
      let newDefault: string | null = null;
      if (a.is_default) {
        const [n] = await this.db.query<any>(
          `UPDATE hlt_addresses SET is_default = true
            WHERE id = (SELECT id FROM hlt_addresses
                         WHERE account_id = $1 AND deleted_at IS NULL
                         ORDER BY created_at DESC LIMIT 1)
            RETURNING id`, [me]);
        newDefault = n?.id ?? null;
      }
      return { id: a.id, deleted: true, newDefault,
        note: newDefault ? '지웠습니다. 가장 최근 배송지를 기본으로 정했습니다.' : '지웠습니다.' };
    });
  }

  /**
   * 장바구니.
   *
   * 합계와 배송비를 **서버가 계산**합니다 — 앱에서 계산하면 화면과
   * 주문서가 갈립니다.
   */
  async cart() {
    const me = RequestCtx.actorId()!;
    /* v10.26 (D027) — 줄 = 상품 + 옵션. 값 · 재고는 옵션의 것. 담을 때 값(addedPrice)과 지금 값이 다르면 priceChanged */
    const items = await this.db.query(
      `SELECT p.code, p.name, o.price, ci.qty, o.price * ci.qty AS amount,
              ci.option_id AS "optionId", fn_hlt_option_label(o.months, o.tag) AS "optionLabel", o.months,
              ci.added_price AS "addedPrice", (ci.added_price IS NOT NULL AND ci.added_price <> o.price) AS "priceChanged",
              o.stock, (o.stock < ci.qty) AS "overStock",
              (p.status <> 'ON_SALE' OR NOT o.is_active) AS "notOnSale",
              w.blocked_if AS "withdrawalBlockedIf",
              json_build_object('form', p.art_form, 'tone', p.art_tone) AS art,
              CASE WHEN f.id IS NOT NULL THEN '/api/v1/health/products/' || p.code || '/image' END AS "imageUrl",
              (SELECT json_build_object('code', g.code, 'name', g.name, 'amount', pi.amount)
                 FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
                WHERE pi.product_id = p.id AND pi.is_main) AS "mainIngredient",
              s.type AS "sellerType"
         FROM hlt_cart_items ci
         JOIN hlt_products p ON p.id = ci.product_id
         JOIN hlt_product_options o ON o.id = ci.option_id
         LEFT JOIN hlt_sellers s ON s.id = p.seller_id
         LEFT JOIN files f ON f.id = p.image_file_id AND f.status = 'READY' AND f.purpose = 'PRODUCT_IMAGE'
         LEFT JOIN withdrawal_rules w ON w.code = p.withdrawal_code
        WHERE ci.account_id = $1 ORDER BY ci.added_at, o.sort`, [me]);
    const [sum] = await this.db.query<any>(
      `SELECT lines, items, goods, ship_fee AS "shipFee", total,
              has_problem AS "hasProblem", price_changed AS "priceChanged"
         FROM v_hlt_cart WHERE account_id = $1`, [me]);
    return {
      items,
      lines: Number(sum?.lines ?? 0),
      goods: Number(sum?.goods ?? 0),
      shipFee: Number(sum?.shipFee ?? 0),
      total: Number(sum?.total ?? 0),
      hasProblem: sum?.hasProblem ?? false,
      priceChanged: sum?.priceChanged ?? false,
      note: '배송비는 없습니다(전 상품 무료).',
    };
  }

  /**
   * 담기.
   *
   * **재고를 잡지 않습니다** — 담아 놓고 안 사는 분 때문에 실제
   * 사실 분이 못 사면 안 됩니다.
   * v10.26 (D027) — 옵션 단위. 옵션이 여럿인 상품은 optionId 가 있어야 합니다(OPTION_REQUIRED). 품절 옵션은 담지 않습니다(SOLD_OUT).
   *   같은 옵션을 또 담으면 수량을 더하고(99까지) 담을 때 값을 지금 값으로 맞춥니다(다시 담은 것은 지금 값을 본 것입니다).
   */
  async addToCart(d: { productCode: string; optionId?: string; qty: number }) {
    const me = RequestCtx.actorId()!;
    const [p] = await this.db.query<any>(
      `SELECT id, status, name FROM hlt_products WHERE code = $1`, [d.productCode]);
    if (!p || p.status !== 'ON_SALE') throw new StateConflict('NOT_ON_SALE', '판매 중인 상품이 아닙니다.');
    const [line] = await this.resolveLines([{ productCode: d.productCode, optionId: d.optionId, qty: Math.max(1, Math.min(99, Number(d.qty) || 1)) }]);
    /* 앞 판의 응답 모양 그대로(422 · DB 장바구니 규칙의 글 「남은 수량이 0개입니다 — 상품 이름」) — 옵션 이름만 덧붙입니다 */
    if (line.stock <= 0) {
      throw new PolicyViolation('SOLD_OUT', `남은 수량이 0개입니다 — ${p.name}${line.label && line.label !== '단품' ? ` ${line.label}` : ''}. 입고되면 다시 담으실 수 있습니다.`);
    }

    await this.db.query(
      `INSERT INTO hlt_carts (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [me]);
    await this.db.query(
      `INSERT INTO hlt_cart_items (account_id, product_id, option_id, qty, added_price)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (account_id, option_id)
       DO UPDATE SET qty = LEAST(hlt_cart_items.qty + $4, 99), added_price = EXCLUDED.added_price`,
      [me, line.productId, line.optionId, line.qty, line.price]);
    return this.cart();
  }

  /** 수량 바꾸기(상품 코드). 0이면 뺍니다. 옵션이 여럿인 상품은 줄(옵션)로 바꿔야 합니다 — PATCH /me/health/cart/lines/{옵션} */
  async setQty(code: string, qty: number) {
    const me = RequestCtx.actorId()!;
    const lines = await this.db.query<any>(
      `SELECT ci.option_id FROM hlt_cart_items ci JOIN hlt_products p ON p.id = ci.product_id
        WHERE ci.account_id = $1 AND p.code = $2`, [me, code]);
    if (!lines.length) {
      const [p] = await this.db.query<any>(`SELECT id FROM hlt_products WHERE code = $1`, [code]);
      if (!p) throw new StateConflict('NOT_FOUND', '없는 상품입니다.');
      return this.cart();
    }
    if (lines.length > 1) throw new PolicyViolation('OPTION_REQUIRED', '옵션이 여럿 담긴 상품입니다 — 줄마다 수량을 바꿔 주십시오.');
    return this.setLineQty(lines[0].option_id, qty);
  }

  /** 줄(옵션)의 수량 바꾸기. 0이면 뺍니다 */
  async setLineQty(optionId: string, qty: number) {
    const me = RequestCtx.actorId()!;
    if (!/^[0-9a-f-]{36}$/i.test(String(optionId))) throw new StateConflict('NOT_FOUND', '장바구니에 없는 줄입니다.');
    if (!qty || qty <= 0) {
      await this.db.query(`DELETE FROM hlt_cart_items WHERE account_id = $1 AND option_id = $2`, [me, optionId]);
    } else {
      await this.db.query(
        `UPDATE hlt_cart_items SET qty = $3 WHERE account_id = $1 AND option_id = $2`, [me, optionId, Math.min(qty, 99)]);
    }
    return this.cart();
  }

  /**
   * 「가격이 변경되었습니다 — 확인했습니다」 (시안의 장바구니 · v10.26).
   * 담을 때 값과 지금 값이 다른 줄의 「담을 때 값」을 지금 값으로 맞춥니다 — 그 뒤에 주문할 수 있습니다.
   * 담을 때 본 금액과 결제 금액이 다르면 다툼이 되므로 조용히 바꾸지 않습니다(시안 주석).
   */
  async ackPrices() {
    const me = RequestCtx.actorId()!;
    await this.db.query(
      `UPDATE hlt_cart_items ci SET added_price = o.price
         FROM hlt_product_options o
        WHERE o.id = ci.option_id AND ci.account_id = $1 AND ci.added_price IS DISTINCT FROM o.price
          AND o.is_active AND o.stock >= ci.qty
          AND EXISTS (SELECT 1 FROM hlt_products p WHERE p.id = ci.product_id AND p.status = 'ON_SALE')`, [me]);
    return this.cart();
  }

  /* ── 교환 배송비 (v10.26 · D027 · 약관 제3조) ──────────────────────
   *
   * 회원 사정(단순 변심 · 잘못 주문) 교환은 왕복 배송비를 **신청 때 결제**합니다(사장님 확인 2026-10-08 · A-1 ①).
   * 결제 기록은 주문 결제(hlt_payments)와 따로 둡니다(hlt_exchange_fees) — 주문 결제의 상태가 주문을 바꾸는 규칙(fn_hlt_pay_apply)에 섞이지 않게.
   * 카드 · 계좌이체만 받습니다(가상계좌는 입금을 기다려야 해 교환 처리가 늦어짐).
   * 돌려드리는 때 — 반려 · 운영이 회사 사정으로 판정 · 교환할 상품이 없어 반품으로 바꿈. */

  async shipments(no: string) {
    const me = RequestCtx.actorId()!;
    const [o] = await this.db.query<any>(
      `SELECT id FROM hlt_orders WHERE order_no = $1 AND account_id = $2`, [no, me]);
    if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');
    /* v10.31 (시안 「택배사에서 보기」) — 택배사 공개 조회 주소에 송장번호만 넣어 돌려줍니다(이름 · 주소 · 연락처는 넘기지 않음) */
    return this.db.query(
      `SELECT s.carrier, s.tracking_no AS "trackingNo", s.state,
              s.happened_at AS "happenedAt", s.note,
              CASE WHEN s.tracking_no IS NOT NULL AND c.track_url IS NOT NULL
                   THEN replace(c.track_url, '{no}', regexp_replace(s.tracking_no, '[^0-9A-Za-z]', '', 'g')) END AS "trackUrl"
         FROM hlt_shipments s LEFT JOIN hlt_carriers c ON c.name = s.carrier
        WHERE s.order_id = $1
        ORDER BY s.happened_at DESC`, [o.id]);
  }
}

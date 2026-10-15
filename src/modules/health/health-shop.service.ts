import { affTouchHash, AFF_WINDOW_HOURS } from '../affiliate/aff-touch';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AppError, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { PaymentLookup, PaymentResult, RefundReceiveAccount, resolvePaymentProvider } from '../billing/payment.provider';
import {
  HLT_CUSTOMER_REASONS, HLT_EXCHANGE_SHIP_ROUND_TRIP, HLT_EXCHANGE_WAIT_DAYS, HLT_RETURN_SHIP_ROUND_TRIP, HLT_SHIP_FEE,
  exchangeFee, returnShipDeduction,
} from './health-policy';
import { CARD_COLS, CARD_FROM, OPTION_COLS, SEARCH_BODY } from './health-catalog.sql';
import { storageFromEnv } from '../file/storage';

/** 교환 배송비 결제 상태 — NONE(0원) · UNPAID · PAID · REFUNDED. 신청 r 이 FROM 에 있어야 합니다 */
const FEE_STATE_SQL = `CASE WHEN r.exchange_fee = 0 THEN
    CASE WHEN EXISTS (SELECT 1 FROM hlt_exchange_fees xf WHERE xf.return_id = r.id AND xf.state = 'REFUNDED') THEN 'REFUNDED' ELSE 'NONE' END
  ELSE coalesce((SELECT CASE xf.state WHEN 'PAID' THEN 'PAID' WHEN 'REFUNDED' THEN 'REFUNDED' END FROM hlt_exchange_fees xf
                  WHERE xf.return_id = r.id AND xf.state IN ('PAID','REFUNDED') LIMIT 1), 'UNPAID') END`;

/** 토스 결제 수단 원문 → 우리 코드(hlt_payments.method CHECK). 모르는 것은 준비 때 고른 수단을 그대로 둡니다 */
const TOSS_METHOD: Record<string, string> = {
  '카드': 'CARD', '간편결제': 'CARD', '계좌이체': 'TRANSFER', '가상계좌': 'VBANK',
};

/** 결제 행 → 화면. ★ vbank_secret 은 내보내지 않습니다 */
const PAY_COLS = `p.id, p.method, p.amount, p.state, p.stub, p.pg_status AS "pgStatus",
  p.approved_at AS "approvedAt", p.canceled_at AS "canceledAt", p.canceled_amount AS "canceledAmount",
  p.vbank, p.fail_reason AS "failReason"`;

/**
 * 건강몰 — 직판.
 *
 * 규칙은 DB 가 집행합니다(`fn_hlt_product_guard` · `fn_hlt_stock_guard`).
 * 여기서는 읽고 넣는 일만 합니다 — 규칙을 앱에도 적으면 두 곳이 갈라집니다.
 */
@Injectable()
export class HealthShopService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * 상품 목록. `ingredient` · `concern` 으로 좁힐 수 있습니다(D002 — 성분–상품 연결 표).
   * 고민으로 좁히면 그 고민에 묶인 성분 중 하나라도 든 상품입니다. 성분군(D027)이면 아래 성분이 든 상품까지입니다.
   * v10.26 — 카드 항목(표제 성분 · 정가 · 할인율 · 한 달 최저 · 배지 · 그림 · 판매자 유형 · 담을 옵션)이 함께 오고,
   *   검색 낱말은 상품 이름 · 한 줄 설명 · 갈래 이름 · 성분 이름(다른 이름 포함)에서 찾습니다(전에는 상품 이름만).
   */
  products(category?: string, keyword?: string, ingredient?: string, concern?: string) {
    return this.db.query(
      `SELECT ${CARD_COLS}
         FROM ${CARD_FROM}
        WHERE p.status IN ('ON_SALE','SOLD_OUT')
          AND ($1::text IS NULL OR c.code = $1)
          AND ($2::text IS NULL OR fn_search_match(p.name, ${SEARCH_BODY}, $2))
          AND ($3::text IS NULL OR EXISTS (
                SELECT 1 FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
                 WHERE pi.product_id = p.id AND (upper(g.code) = upper($3) OR upper(coalesce(g.parent_code, '')) = upper($3))))
          AND ($4::text IS NULL OR EXISTS (
                SELECT 1 FROM hlt_product_ingredients pi
                  JOIN hlt_concern_ingredients ci ON ci.ingredient_code = pi.ingredient_code
                  JOIN hlt_concerns k ON k.code = ci.concern_code AND k.is_active
                 WHERE pi.product_id = p.id AND upper(ci.concern_code) = upper($4)))
        ORDER BY p.created_at DESC LIMIT 100`,
      [category || null, keyword || null, ingredient || null, concern || null]);
  }

  /**
   * 상품 상세. **청약철회 조건이 함께 옵니다** — 사시기 전에 아셔야 합니다.
   * v10.26 — 옵션(개월 수 · 결제 금액 · 한 달 단가 · 재고 · 품절) · 상품정보제공고시(갈래 묶음의 항목 순서 · 비운 값은 「상세 설명 참조」) ·
   *   주의사항과 그 제목 · 「의약품이 아닙니다」 고지 여부 · 교환 배송비 · 반품 주소 · 같은 성분의 다른 상품.
   */
  async product(code: string) {
    const [p] = await this.db.query<any>(
      `SELECT ${CARD_COLS},
              w.label AS "withdrawalLabel", w.days AS "withdrawalDays",
              w.blocked_if AS "withdrawalBlockedIf", w.law AS "withdrawalLaw",
              p.caution, p.notice AS "noticeValues", p.id, p.seller_id,
              coalesce(ng.caution_title, '사용상 주의사항') AS "cautionTitle", coalesce(ng.not_medicine, false) AS "notMedicine",
              ng.notice_group AS "noticeGroup",
              coalesce(nullif(btrim(s.return_addr), ''), (SELECT value FROM site_settings WHERE key = 'footer.address')) AS "returnAddr",
              coalesce(nullif(btrim(s.cs_tel), ''), (SELECT value FROM site_settings WHERE key = 'footer.phone')) AS "csTel"
         FROM ${CARD_FROM}
         LEFT JOIN withdrawal_rules w ON w.code = p.withdrawal_code
         LEFT JOIN hlt_notice_groups ng ON ng.category_code = c.code
        WHERE p.code = $1 AND p.status IN ('ON_SALE','SOLD_OUT')`, [code]);
    if (!p) throw new StateConflict('NOT_FOUND', '판매 중인 상품이 아닙니다.');
    const [ingredients, concerns, options, items, same] = await Promise.all([
      this.db.query(
        `SELECT g.code, g.name, pi.amount, pi.is_main AS "isMain"
           FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
          WHERE pi.product_id = $1 ORDER BY pi.is_main DESC, pi.sort, g.name`, [p.id]),
      /* 이 상품의 성분을 많이 찾는 고민 — 효능 표시가 아닙니다 */
      this.db.query(
        `SELECT DISTINCT k.code, k.name, k.icon, k.sort
           FROM hlt_product_ingredients pi
           JOIN hlt_concern_ingredients ci ON ci.ingredient_code = pi.ingredient_code
           JOIN hlt_concerns k ON k.code = ci.concern_code AND k.is_active
          WHERE pi.product_id = $1 ORDER BY k.sort, k.code`, [p.id]),
      this.db.query(`SELECT ${OPTION_COLS} FROM hlt_product_options o WHERE o.product_id = $1 AND o.is_active ORDER BY o.sort, o.months`, [p.id]),
      p.noticeGroup
        ? this.db.query<any>(`SELECT label, auto FROM hlt_notice_items WHERE notice_group = $1 ORDER BY sort`, [p.noticeGroup])
        : Promise.resolve([] as any[]),
      /* 같은 성분(표제 성분)의 다른 상품 — 시안 기준(전에는 같은 갈래) */
      this.db.query(
        `SELECT ${CARD_COLS} FROM ${CARD_FROM}
          WHERE p.status IN ('ON_SALE','SOLD_OUT') AND p.id <> $1
            AND EXISTS (SELECT 1 FROM hlt_product_ingredients a JOIN hlt_product_ingredients b ON b.ingredient_code = a.ingredient_code
                         WHERE a.product_id = $1 AND a.is_main AND b.product_id = p.id)
          ORDER BY p.created_at DESC LIMIT 8`, [p.id]),
    ]);
    const vals = (p.noticeValues ?? {}) as Record<string, string>;
    const notice = items.map((it: any) => {
      const auto = it.auto === 'NAME' ? p.name : it.auto === 'CS_TEL' ? p.csTel : it.auto === 'AMOUNT' ? p.mainIngredient?.amount : null;
      const v = (vals[it.label] ?? '').trim() || auto || '상세 설명 참조';
      return { label: it.label, value: v };
    });
    const { id, seller_id, noticeValues, noticeGroup, ...view } = p;
    return {
      ...view, ingredients, options, notice, sameIngredient: same,
      exchangeFee: HLT_EXCHANGE_SHIP_ROUND_TRIP,
      concerns: concerns.map(({ sort, ...c }: any) => c),
    };
  }

  /** 상품 사진 — 운영 화면에서 올린 그림(PRODUCT_IMAGE)을 누구나 볼 수 있게 내보냅니다. 판매 중(품절 포함) 상품만 */
  async productImage(code: string) {
    const [f] = await this.db.query<any>(
      `SELECT f.id, f.storage_key, f.content_type, f.size_bytes
         FROM hlt_products p JOIN files f ON f.id = p.image_file_id
        WHERE p.code = $1 AND p.status IN ('ON_SALE','SOLD_OUT') AND f.status = 'READY' AND f.purpose = 'PRODUCT_IMAGE'`, [code]);
    if (!f) throw new StateConflict('NOT_FOUND', '상품 사진이 없습니다.');
    const stream = await storageFromEnv().open(f.storage_key);
    if (!stream) throw new StateConflict('NOT_FOUND', '상품 사진이 없습니다.');
    return { stream, contentType: f.content_type as string, size: Number(f.size_bytes) };
  }

  /**
   * 취급 갈래 (D025) — 열림 · 잠금 · 판매하지 않음.
   *
   * 소개몰 전용 표(hlt_sale_categories)에 적힌 갈래와, 판매 중인 상품이 있는 갈래가 나옵니다.
   * 표에 없는 갈래는 열림(OPEN)입니다. 잠금 · 미판매 갈래는 상품 수가 늘 0 입니다(상품을 판매 중으로 둘 수 없음).
   * v10.26 — 화장품(D027 · 열림)이 더해졌습니다.
   */
  categories() {
    return this.db.query(
      `SELECT c.code, c.name, coalesce(s.state, 'OPEN') AS state, s.note,
              count(p.id)::int AS "productCount"
         FROM categories c
         LEFT JOIN hlt_sale_categories s ON s.category_code = c.code
         LEFT JOIN hlt_products p ON p.category_id = c.id AND p.status IN ('ON_SALE','SOLD_OUT')
        WHERE c.gwan_code = 'HLT'
        GROUP BY c.id, s.category_code
       HAVING s.category_code IS NOT NULL OR count(p.id) > 0
        ORDER BY coalesce(s.sort, 100), c.name`);
  }

  /* ── 성분 · 고민 (D002 · D027) ─────────────────────────────────────
   * 문구 규칙: 고민 이름은 상태 표현만, "효과 있는"이 아니라 "많이 찾는" 성분입니다.
   * 상품 수는 판매 중(품절 포함) 상품만 셉니다. 「한 달 최저」는 살 수 있는 옵션만 봅니다.
   * 「자격 필요」 표시는 내보내지 않습니다 — 무슨 자격인지 정해지지 않았습니다(10/8 추천값 B-6). */

  /**
   * 성분 목록 — 취급 상품 수 · 「월 N원 부터」(minUnit) · 많이 찾는 성분(featured) · 성분군(isGroup · parent · children).
   * 군의 상품 수 · 한 달 최저는 아래 성분의 것을 모읍니다. 상품이 없는 성분도 숨기지 않습니다(「취급 준비 중」).
   */
  async ingredients() {
    const rows = await this.db.query<any>(
      `WITH pp AS (
         SELECT pi.ingredient_code AS code, p.id,
                (SELECT min(round(o.price::numeric / o.months))::int FROM hlt_product_options o
                  WHERE o.product_id = p.id AND o.is_active AND o.stock > 0 AND o.months IS NOT NULL) AS unit,
                (SELECT min(o.price) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 0) AS price
           FROM hlt_product_ingredients pi JOIN hlt_products p ON p.id = pi.product_id AND p.status IN ('ON_SALE','SOLD_OUT'))
       SELECT g.code, g.name, g.aliases, g.note, g.is_group AS "isGroup", g.parent_code AS parent, g.is_featured AS featured, g.sort,
              g.needs_license AS "needsLicense",   -- v10.31 (시안 「자격 필요」)
              (SELECT count(DISTINCT pp.id)::int FROM pp WHERE pp.code = g.code
                  OR pp.code IN (SELECT x.code FROM ingredients x WHERE x.parent_code = g.code)) AS "productCount",
              (SELECT min(pp.unit) FROM pp WHERE pp.code = g.code
                  OR pp.code IN (SELECT x.code FROM ingredients x WHERE x.parent_code = g.code)) AS "minUnit",
              (SELECT min(pp.price) FROM pp WHERE pp.code = g.code
                  OR pp.code IN (SELECT x.code FROM ingredients x WHERE x.parent_code = g.code)) AS "minPrice"
         FROM ingredients g
        WHERE NOT g.is_excipient
        ORDER BY g.sort, g.name LIMIT 300`);
    return rows.map((r) => ({ ...r, children: r.isGroup ? rows.filter((x) => x.parent === r.code).map((x) => x.code) : undefined }));
  }

  /**
   * 성분 상세 — 그 성분이 든 상품과, 그 성분을 많이 찾는 고민.
   * 군이면 아래 성분의 상품을 모읍니다(children). 함량 표제 목록(amounts — 2가지 이상이면 화면이 거르기 단추를 그림) ·
   * 정렬 sort = unit(한 달 단가 낮은 순 · 기본) | name(이름순). 리뷰순 · 별점순은 v10.27.
   */
  async ingredient(code: string, sort?: string) {
    const [g] = await this.db.query<any>(
      `SELECT code, name, aliases, note, is_group AS "isGroup", parent_code AS parent, is_featured AS featured,
              needs_license AS "needsLicense"
         FROM ingredients WHERE upper(code) = upper($1) AND NOT is_excipient`, [code]);
    if (!g) throw new StateConflict('NOT_FOUND', '없는 성분입니다.');
    const [products, concerns, children, amounts] = await Promise.all([
      this.products(undefined, undefined, g.code),
      this.db.query(
        `SELECT k.code, k.name, k.icon
           FROM hlt_concern_ingredients ci JOIN hlt_concerns k ON k.code = ci.concern_code
          WHERE (ci.ingredient_code = $1 OR ci.ingredient_code IN (SELECT code FROM ingredients WHERE parent_code = $1)) AND k.is_active
          GROUP BY k.code ORDER BY min(k.sort), k.code`, [g.code]),
      this.db.query(`SELECT code, name FROM ingredients WHERE parent_code = $1 ORDER BY sort, name`, [g.code]),
      this.db.query<{ amount: string }>(
        `SELECT DISTINCT pi.amount FROM hlt_product_ingredients pi JOIN hlt_products p ON p.id = pi.product_id
          WHERE p.status IN ('ON_SALE','SOLD_OUT') AND coalesce(btrim(pi.amount), '') <> ''
            AND (pi.ingredient_code = $1 OR pi.ingredient_code IN (SELECT code FROM ingredients WHERE parent_code = $1))
          ORDER BY pi.amount`, [g.code]),
    ]);
    /* v10.26 — 상품마다 「이 성분(군이면 아래 성분)의 함량」 — 화면의 함량 단추가 이것으로 거릅니다(대표 성분이 다른 상품도 있음) */
    const amt = new Map((await this.db.query<{ code: string; amount: string | null }>(
      `SELECT DISTINCT ON (p.code) p.code, pi.amount FROM hlt_product_ingredients pi JOIN hlt_products p ON p.id = pi.product_id
        WHERE pi.ingredient_code = $1 OR pi.ingredient_code IN (SELECT code FROM ingredients WHERE parent_code = $1)
        ORDER BY p.code, (pi.ingredient_code = $1) DESC, pi.is_main DESC`, [g.code])).map((r) => [r.code, r.amount]));
    const list = (products as any[]).map((p) => ({ ...p, ingAmount: amt.get(p.code) ?? null }));
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
    else list.sort((a, b) => (a.minUnit ?? Number.MAX_SAFE_INTEGER) - (b.minUnit ?? Number.MAX_SAFE_INTEGER) || Number(a.price) - Number(b.price));
    const units = list.filter((p) => !p.soldOut && p.minUnit != null).map((p) => Number(p.minUnit));
    return { ...g, products: list, concerns, children, amounts: amounts.map((a) => a.amount),
      minUnit: units.length ? Math.min(...units) : null, sort: sort === 'name' ? 'name' : 'unit' };
  }

  /**
   * 검색 제안(자동완성) — 성분 이름과 **상품 이름**(시안의 글 「성분과 상품명으로 제안」 · 시안 코드의 오타로 상품이 빠지던 것을 바르게).
   * 살 수 있는 것만 — 판매 중 상품이 있는 성분 · 판매 중이고 재고 있는 상품. 앞에서부터 맞는 낱말이 먼저 · 8줄까지 · 친 낱말과 꼭 같은 것은 뺌.
   */
  async suggest(q?: string) {
    const kw = (q ?? '').trim().slice(0, 40);
    if (!kw) return [];
    return this.db.query(
      `WITH cand AS (
         SELECT g.name AS word, '성분' AS kind, g.code, g.sort AS ord
           FROM ingredients g
          WHERE NOT g.is_excipient AND NOT g.is_group
            AND EXISTS (SELECT 1 FROM hlt_product_ingredients pi JOIN hlt_products p ON p.id = pi.product_id
                         WHERE pi.ingredient_code = g.code AND p.status = 'ON_SALE' AND p.stock > 0)
         UNION ALL
         SELECT p.name, '상품', p.code, 0 FROM hlt_products p WHERE p.status = 'ON_SALE' AND p.stock > 0)
       SELECT word, kind, code FROM cand
        WHERE position(lower($1) in lower(word)) > 0 AND lower(word) <> lower($1)
        ORDER BY (position(lower($1) in lower(word)) = 1) DESC, (kind = '성분') DESC, ord, word
        LIMIT 8`, [kw]);
  }

  /**
   * 고민 목록. **연결 성분이 없는 고민은 내보내지 않습니다**(시안 규칙).
   * ingredientCount 는 묶인 성분 수, stockedIngredientCount 는 그중 상품이 있는 성분 수입니다.
   */
  concerns() {
    return this.db.query(
      `SELECT k.code, k.name, k.icon, k.note,
              count(DISTINCT ci.ingredient_code)::int AS "ingredientCount",
              count(DISTINCT pi.ingredient_code) FILTER (WHERE p.id IS NOT NULL)::int AS "stockedIngredientCount",
              count(DISTINCT p.id)::int AS "productCount"
         FROM hlt_concerns k
         JOIN hlt_concern_ingredients ci ON ci.concern_code = k.code
         JOIN ingredients g ON g.code = ci.ingredient_code AND NOT g.is_excipient
         LEFT JOIN hlt_product_ingredients pi ON pi.ingredient_code = ci.ingredient_code
         LEFT JOIN hlt_products p ON p.id = pi.product_id AND p.status IN ('ON_SALE','SOLD_OUT')
        WHERE k.is_active
        GROUP BY k.code ORDER BY k.sort, k.code`);
  }

  /** 고민 상세 — 많이 찾는 성분(성분별 상품 수)과 상품. 상품마다 든 성분 코드가 함께 옵니다 */
  async concern(code: string) {
    const [k] = await this.db.query<any>(
      `SELECT code, name, icon, note FROM hlt_concerns
        WHERE upper(code) = upper($1) AND is_active`, [code]);
    if (!k) throw new StateConflict('NOT_FOUND', '없는 고민입니다.');
    const ingredients = await this.db.query(
      /* v10.25 (D025) — locked: 그 성분의 상품이 잠긴 갈래(건강기능식품 등)에만 있습니다. 화면이 「준비 중」 대신 자물쇠로 보입니다 */
      `SELECT g.code, g.name, g.aliases, g.note,
              count(p.id)::int AS "productCount",
              EXISTS (SELECT 1 FROM hlt_product_ingredients pi2
                        JOIN hlt_products p2 ON p2.id = pi2.product_id
                        JOIN categories c2 ON c2.id = p2.category_id
                        JOIN hlt_sale_categories s2 ON s2.category_code = c2.code AND s2.state = 'LOCKED'
                       WHERE pi2.ingredient_code = g.code) AS locked
         FROM hlt_concern_ingredients ci
         JOIN ingredients g ON g.code = ci.ingredient_code AND NOT g.is_excipient
         LEFT JOIN hlt_product_ingredients pi ON pi.ingredient_code = g.code
         LEFT JOIN hlt_products p ON p.id = pi.product_id AND p.status IN ('ON_SALE','SOLD_OUT')
        WHERE ci.concern_code = $1
        GROUP BY g.id, ci.sort ORDER BY ci.sort, g.name`, [k.code]);
    /* v10.26 — 카드 항목(CARD_COLS)을 함께. 상품마다 그 고민에 묶인 성분 코드(ingredients) */
    const products = await this.db.query(
      `SELECT ${CARD_COLS},
              (SELECT array_agg(DISTINCT pi.ingredient_code) FROM hlt_product_ingredients pi
                 JOIN hlt_concern_ingredients ci ON ci.ingredient_code = pi.ingredient_code AND ci.concern_code = $1
                WHERE pi.product_id = p.id) AS ingredients
         FROM ${CARD_FROM}
        WHERE p.status IN ('ON_SALE','SOLD_OUT')
          AND EXISTS (SELECT 1 FROM hlt_product_ingredients pi
                        JOIN hlt_concern_ingredients ci ON ci.ingredient_code = pi.ingredient_code AND ci.concern_code = $1
                       WHERE pi.product_id = p.id)
        ORDER BY p.created_at DESC LIMIT 100`, [k.code]);
    return { ...k, ingredients, products };
  }

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
   * 취소 · 반품 신청.
   *
   * **7일 안이면 이유를 묻지 않습니다.** 다만 식품은 개봉하면
   * 어렵고, 그 판정은 운영이 합니다.
   */
  async requestReturn(d: any) {
    const me = RequestCtx.actorId()!;
    const [o] = await this.db.query<any>(
      `SELECT id, status FROM hlt_orders WHERE order_no = $1 AND account_id = $2`,
      [d.orderNo, me]);
    if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');
    if (o.status === 'CANCELED' || o.status === 'RETURNED') {
      throw new StateConflict('ALREADY', '이미 취소·반품된 주문입니다.');
    }

    /* D002 — 청약철회 판정은 서버가 합니다(fn_hlt_return_judge: 발송 전 취소 · 받은 날부터 N일 반품 ·
     * 하자는 3개월). 같은 함수를 INSERT 트리거도 부릅니다 — 앱을 거치지 않아도 같은 규칙입니다. */
    const [j] = await this.db.query<any>(
      `SELECT ok, code, message, deadline FROM fn_hlt_return_judge($1, $2, $3)`,
      [o.id, d.kind, d.reason]);
    if (!j.ok) throw new PolicyViolation(j.code, j.message, { deadline: j.deadline });

    /* 20261002 — 처리 중인 신청이 있으면 또 받지 않습니다(전: 같은 주문에 여러 번 접수) */
    const [open] = await this.db.query<any>(
      `SELECT id FROM hlt_returns WHERE order_id = $1 AND state IN ('REQUESTED','APPROVED') LIMIT 1`, [o.id]);
    if (open) throw new StateConflict('ALREADY_REQUESTED', '이미 접수된 취소·반품 신청이 있습니다. 처리 결과를 기다려 주십시오.');

    /* D006 — 고객이 적은 개봉 여부는 **참고**입니다. 판정은 운영이 승인할 때 합니다.
     * 발송 전 취소는 개봉일 수 없어 받지 않습니다. */
    const customerOpened = d.kind === 'CANCEL' ? null : (typeof d.opened === 'boolean' ? d.opened : null);
    /* v10.26 — 회원 사정 교환은 왕복 배송비(6,000원)를 신청 때 결제합니다(약관 제3조 · A-1 ①). 회사 사정 교환은 0원 */
    const fee = exchangeFee(d.kind, d.reason);
    const [r] = await this.db.query<any>(
      `INSERT INTO hlt_returns (order_id, kind, reason, detail, customer_opened, exchange_fee)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, kind, state, customer_opened AS "customerOpened", created_at AS "createdAt", exchange_fee AS "exchangeFee"`,
      [o.id, d.kind, d.reason, d.detail ?? null, customerOpened, fee]);
    if (d.kind === 'EXCHANGE') {
      return { ...r, feeState: fee > 0 ? 'UNPAID' : 'NONE', deadline: j.deadline,
        note: fee > 0
          ? `교환을 접수했습니다. 교환 배송비(왕복) ${fee.toLocaleString()}원을 결제하시면 확인 뒤 처리합니다 — 반려되거나 회사 사정으로 판정되면 돌려드립니다.`
          : '교환을 접수했습니다. 회사 사정이라 비용이 들지 않습니다. 3영업일 안에 알려 드립니다.' };
    }
    return { ...r, deadline: j.deadline, note: '접수했습니다. 3영업일 안에 알려 드립니다.' };
  }

  myReturns() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT r.id, o.order_no AS "orderNo", r.kind, r.reason, r.state,
              r.decide_note AS "decideNote", r.refund_amount AS "refundAmount",
              r.ship_deduction AS "shipDeduction",
              r.created_at AS "createdAt", r.refunded_at AS "refundedAt",
              r.customer_opened AS "customerOpened",
              r.exchange_fee AS "exchangeFee", ${FEE_STATE_SQL} AS "feeState", r.converted_from AS "convertedFrom",
              /* v10.27 (G-184) — 결제 전에 들어온 취소(낸 돈이 없음): 환불 금액 「확정 전」 대신 「결제 전 취소」 */
              (r.kind = 'CANCEL' AND NOT EXISTS (SELECT 1 FROM hlt_payments hp WHERE hp.order_id = r.order_id AND hp.approved_at IS NOT NULL)) AS "beforePayment"
         FROM hlt_returns r
         JOIN hlt_orders o ON o.id = r.order_id
        WHERE o.account_id = $1
        ORDER BY r.created_at DESC LIMIT 50`, [me]);
  }
  /* ── 장바구니 ──────────────────────────────────────────────────── */

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

  /** 내 교환 신청 하나 — 결제 · 승인에 씀 */
  private async myExchange(id: string, lock = false) {
    const me = RequestCtx.actorId()!;
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
    const [r] = await this.db.query<any>(
      `SELECT r.id, r.kind, r.state, r.exchange_fee, o.order_no
         FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
        WHERE r.id = $1 AND o.account_id = $2 ${lock ? 'FOR UPDATE OF r' : ''}`, [id, me]);
    if (!r) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
    if (r.kind !== 'EXCHANGE' || Number(r.exchange_fee) <= 0) throw new StateConflict('NO_FEE', '교환 배송비를 낼 신청이 아닙니다.');
    if (r.state !== 'REQUESTED') throw new StateConflict('ALREADY_DECIDED', '이미 처리된 신청입니다.');
    return r;
  }

  /** 교환 배송비 결제 준비 — 결제창에 넘길 주문번호(toss) · 금액 · 이름 */
  async payExchangeFee(id: string, method: string) {
    if (!['CARD', 'TRANSFER'].includes(method)) throw new PolicyViolation('BAD_METHOD', '교환 배송비는 카드 · 계좌이체로 결제합니다.');
    return this.db.transaction(async () => {
      const r = await this.myExchange(id, true);
      const [paid] = await this.db.query<any>(`SELECT id FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'PAID'`, [r.id]);
      if (paid) throw new StateConflict('ALREADY_PAID', '교환 배송비를 이미 결제하셨습니다.');
      const [ready] = await this.db.query<any>(
        `SELECT id, amount, method, state, toss_order_id FROM hlt_exchange_fees
          WHERE return_id = $1 AND state = 'READY' ORDER BY created_at DESC LIMIT 1`, [r.id]);
      const name = `소개몰 교환 배송비 (${r.order_no})`;
      if (ready && ready.method === method && Number(ready.amount) === Number(r.exchange_fee)) {
        return { id: ready.id, amount: Number(ready.amount), method, state: 'READY', orderId: ready.toss_order_id, orderName: name,
          note: '이미 결제 준비 중입니다. 결제창을 다시 엽니다.' };
      }
      if (ready) await this.db.query(`UPDATE hlt_exchange_fees SET state = 'FAILED', fail_reason = '수단 변경', updated_at = now() WHERE id = $1`, [ready.id]);
      const [{ n }] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hlt_exchange_fees WHERE return_id = $1`, [r.id]);
      const [f] = await this.db.query<any>(
        `INSERT INTO hlt_exchange_fees (return_id, amount, method, toss_order_id)
         VALUES ($1,$2,$3,$4) RETURNING id, amount, method, state, toss_order_id AS "orderId"`,
        [r.id, Number(r.exchange_fee), method, `${r.order_no}-X${n + 1}`]);
      return { ...f, amount: Number(f.amount), orderName: name, note: '결제창으로 넘어갑니다.' };
    });
  }

  /**
   * 교환 배송비 결제 승인 — 주문 결제의 승인과 같은 방식(금액을 신청의 교환 배송비와 대조 · PG 승인 · 같은 paymentKey 는 같은 결과).
   * 키(TOSS_SECRET_KEY)가 없으면 스텁이 승인합니다(stub:true — 「시험 결제」).
   */
  async confirmExchangeFee(id: string, paymentKey: string, amount: number) {
    const provider = resolvePaymentProvider();
    const out = await this.db.transaction(async () => {
      const [same] = await this.db.query<any>(`SELECT id, return_id FROM hlt_exchange_fees WHERE payment_key = $1`, [paymentKey]);
      if (same) {
        if (same.return_id !== id) throw new StateConflict('PAYMENT_KEY_MISMATCH', '다른 신청의 결제입니다.');
        return { feeId: same.id };
      }
      const r = await this.myExchange(id, true);
      if (!Number.isInteger(Number(amount)) || Number(amount) !== Number(r.exchange_fee)) {
        throw new PolicyViolation('AMOUNT_MISMATCH',
          `결제 금액이 교환 배송비와 다릅니다 — 승인하지 않았습니다(교환 배송비 ${Number(r.exchange_fee).toLocaleString()}원).`,
          { expected: Number(r.exchange_fee), got: amount });
      }
      const [f] = await this.db.query<any>(
        `SELECT id, method, toss_order_id FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'READY'
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [r.id]);
      if (!f) throw new StateConflict('NO_READY_PAYMENT', '결제 준비 기록이 없습니다. 교환 배송비 결제를 다시 시작해 주십시오.');
      const res: PaymentResult = await provider.confirm({
        paymentKey, orderId: f.toss_order_id, amount: Number(r.exchange_fee),
        orderName: `소개몰 교환 배송비 (${r.order_no})`, method: f.method,
      });
      if (!res.approved) {
        await this.db.query(`UPDATE hlt_exchange_fees SET fail_reason = $2, updated_at = now() WHERE id = $1`,
          [f.id, (res.detail ?? (res.pending ? '입금 대기 결제는 받지 않습니다' : '결제 승인 실패')).slice(0, 500)]);
        return { fail: res };
      }
      await this.db.query(
        `UPDATE hlt_exchange_fees SET state = 'PAID', payment_key = $2, approved_at = coalesce($3::timestamptz, now()),
                stub = $4, pg_tid = $5, fail_reason = NULL, updated_at = now() WHERE id = $1`,
        [f.id, paymentKey, res.approvedAt ?? null, res.stub, res.transactionKey ?? null]);
      return { feeId: f.id };
    });
    if ('fail' in out) {
      throw new PolicyViolation('PAY_REJECTED', out.fail!.detail ?? '결제가 승인되지 않았습니다.', { pgCode: out.fail!.code ?? null });
    }
    const [row] = await this.db.query<any>(
      `SELECT id, amount, method, state, stub, approved_at AS "approvedAt" FROM hlt_exchange_fees WHERE id = $1`, [out.feeId]);
    return { ...row, amount: Number(row.amount), returnId: id,
      note: row.stub ? '시험 결제(스텁)로 승인했습니다 — 실제 돈은 오가지 않았습니다. 확인 뒤 교환을 처리합니다.' : '교환 배송비 결제가 승인되었습니다. 확인 뒤 교환을 처리합니다.' };
  }

  /** 낸 교환 배송비를 돌려드림(PG 취소). 실패하면 refund_error 를 남기고 PAID 로 둡니다 — 운영이 다시 시도합니다 */
  private async refundExchangeFee(returnId: string, why: string) {
    const [f] = await this.db.query<any>(
      `SELECT id, payment_key, amount, stub FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'PAID'`, [returnId]);
    if (!f) return { state: 'NONE' as const };
    const c = await resolvePaymentProvider().cancel({
      paymentKey: f.payment_key, cancelReason: `소개몰 교환 배송비 환불 — ${why}`.slice(0, 200), idempotencyKey: `hlt-xfee-${f.id}`,
    }).catch((e: any) => ({ ok: false, detail: e?.message ?? '연결 실패' } as any));
    if (!c.ok) {
      await this.db.query(`UPDATE hlt_exchange_fees SET refund_error = $2, updated_at = now() WHERE id = $1`, [f.id, String(c.detail ?? '환불 실패').slice(0, 500)]);
      return { state: 'FAILED' as const, amount: Number(f.amount), error: c.detail ?? '환불 실패' };
    }
    await this.db.query(
      `UPDATE hlt_exchange_fees SET state = 'REFUNDED', refunded_at = now(), refund_error = NULL, updated_at = now() WHERE id = $1`, [f.id]);
    return { state: 'REFUNDED' as const, amount: Number(f.amount), stub: !!(c.stub || f.stub) };
  }

  /** (운영) 교환 배송비 환불 다시 시도 */
  async retryExchangeFeeRefund(id: string) {
    const [r] = await this.db.query<any>(`SELECT id, kind, state, exchange_fee FROM hlt_returns WHERE id::text = $1`, [id]);
    if (!r || r.kind !== 'EXCHANGE') throw new StateConflict('NOT_FOUND', '없는 교환 신청입니다.');
    if (r.state === 'APPROVED' && Number(r.exchange_fee) > 0) throw new StateConflict('NOT_REFUNDABLE', '회원 사정으로 승인된 교환의 배송비는 돌려드리지 않습니다.');
    if (r.state === 'REQUESTED') throw new StateConflict('NOT_DECIDED', '아직 처리하지 않은 신청입니다.');
    return this.refundExchangeFee(r.id, '다시 시도');
  }

  /**
   * (운영) 교환할 상품이 없어 반품으로 바꿈 — 약관 제3조: 14일까지 입고를 기다리고 그 안에 들어오지 않으면(또는 회원이 원하면) 반품으로 처리 · 교환 배송비는 돌려드림.
   * 교환 신청은 반려로 닫히고(사유 「반품으로 바꿈 — …」) 같은 사유의 반품 신청이 생깁니다(converted_from). 청약철회 기간은 교환을 신청한 때로 봅니다.
   */
  async convertExchange(id: string, note?: string) {
    const me = RequestCtx.actorId()!;
    const why = (note ?? '').trim() || `교환할 상품이 ${HLT_EXCHANGE_WAIT_DAYS}일 안에 입고되지 않음`;
    const made = await this.db.transaction(async () => {
      const [r] = await this.db.query<any>(
        `SELECT r.id, r.kind, r.state, r.reason, r.detail, r.customer_opened, r.order_id, o.status
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id WHERE r.id::text = $1 FOR UPDATE OF r, o`, [id]);
      if (!r || r.kind !== 'EXCHANGE') throw new StateConflict('NOT_FOUND', '없는 교환 신청입니다.');
      if (!['REQUESTED', 'APPROVED'].includes(r.state)) throw new StateConflict('ALREADY_DECIDED', '이미 닫힌 신청입니다.');
      if (['CANCELED', 'RETURNED'].includes(r.status)) throw new StateConflict('ORDER_CLOSED', '이미 취소·반품된 주문입니다.');
      await this.db.query(
        `UPDATE hlt_returns SET state = 'REJECTED', decide_note = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
        [r.id, `반품으로 바꿈 — ${why}`.slice(0, 1000), me]);
      const [n] = await this.db.query<any>(
        `INSERT INTO hlt_returns (order_id, kind, reason, detail, customer_opened, converted_from)
         VALUES ($1, 'RETURN', $2, $3, $4, $5) RETURNING id, kind, state, created_at AS "createdAt"`,
        [r.order_id, r.reason, `(교환에서 바꿈) ${r.detail ?? ''}`.trim().slice(0, 1000), r.customer_opened, r.id]);
      return { exchangeId: r.id, ret: n };
    });
    const fee = await this.refundExchangeFee(made.exchangeId, '교환할 상품 없음 — 반품으로 바꿈');
    return { exchangeId: made.exchangeId, returnId: made.ret.id, feeRefund: fee,
      note: `반품으로 바꿨습니다(새 반품 신청 접수).${fee.state === 'REFUNDED' ? ` 교환 배송비 ${fee.amount.toLocaleString()}원을 돌려드렸습니다.` : fee.state === 'FAILED' ? ` 교환 배송비 환불이 실패했습니다 — 다시 시도해 주십시오.` : ''}` };
  }

  /* ── 결제 ──────────────────────────────────────────────────────── */

  /**
   * v10.26 (G-183) — 취소 신청이 접수돼 처리를 기다리는 주문은 결제를 받지 않습니다.
   * 전에는 주문 상태(결제 대기)만 봐서, 취소를 신청한 뒤에도 결제가 됐습니다(그 뒤 운영이 승인하면 환불 — 낼 필요 없는 돈을 냈다 돌려받음).
   * 운영이 신청을 반려하면 다시 결제할 수 있습니다.
   */
  private async assertNoCancelRequest(orderId: string) {
    const [r] = await this.db.query<{ id: string }>(
      `SELECT id FROM hlt_returns WHERE order_id = $1 AND kind = 'CANCEL' AND state = 'REQUESTED' LIMIT 1`, [orderId]);
    if (r) {
      throw new StateConflict('CANCEL_REQUESTED',
        '취소 신청이 접수된 주문입니다. 취소가 처리될 때까지 결제하실 수 없습니다.');
    }
  }

  /**
   * 결제.
   *
   * **카드번호는 저희 쪽에 남지 않습니다** — PG 가 처리하고
   * 거래번호만 받습니다. 승인되면 트리거가 주문 상태를 바꿉니다.
   */
  async pay(no: string, method: string) {
    const me = RequestCtx.actorId()!;
    const [o] = await this.db.query<any>(
      `SELECT id, total, status FROM hlt_orders
        WHERE order_no = $1 AND account_id = $2`, [no, me]);
    if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');
    if (o.status !== 'PENDING') {
      throw new StateConflict('ALREADY', '이미 결제되었거나 취소된 주문입니다.');
    }
    await this.assertNoCancelRequest(o.id);
    const [{ n }] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hlt_order_items WHERE order_id = $1`, [o.id]);
    if (!n) throw new StateConflict('EMPTY_ORDER', '품목이 없는 주문은 결제할 수 없습니다.');
    if (!['CARD', 'TRANSFER', 'VBANK'].includes(method)) {
      throw new PolicyViolation('BAD_METHOD', '없는 결제 수단입니다.');
    }

    /* 20261002 — 같은 주문의 준비(READY) 결제가 있으면 그것을 돌려줍니다.
     * 전에는 누를 때마다 READY 행이 쌓였습니다. 수단을 바꾸면 이전 준비 건은 FAILED 로 닫습니다.
     * ★ CANCELED 로 두면 안 됩니다 — fn_hlt_pay_apply 가 결제 취소를 **주문 취소**로 옮깁니다(실측). */
    const [ready] = await this.db.query<any>(
      `SELECT ${PAY_COLS}, p.payment_key FROM hlt_payments p
        WHERE p.order_id = $1 AND p.state = 'READY' ORDER BY p.created_at DESC LIMIT 1`, [o.id]);
    /* D006 — 가상계좌가 이미 발급됐으면 그 계좌로 입금을 기다립니다. 수단을 바꾸면 발급된 계좌로
     * 늦게 들어온 돈이 갈 곳이 없어집니다. */
    if (ready?.payment_key && ready.method !== method) {
      throw new StateConflict('VBANK_WAITING',
        '가상계좌가 이미 발급되어 입금을 기다리고 있습니다. 다른 수단으로 결제하시려면 주문을 취소하고 새로 주문해 주십시오.');
    }
    if (ready && ready.method === method) {
      const { payment_key, ...view } = ready;
      return { ...view, orderNo: no, orderName: await this.orderName(o.id),
        note: payment_key ? '가상계좌 입금을 기다리고 있습니다.' : '이미 결제 준비 중입니다. 결제창을 다시 엽니다.' };
    }
    if (ready) {
      await this.db.query(`UPDATE hlt_payments SET state = 'FAILED' WHERE id = $1`, [ready.id]);
    }

    /* 결제 연동 전에는 준비 상태로만 둡니다 — 됐다고 속이지 않습니다. */
    const [pay] = await this.db.query<any>(
      `INSERT INTO hlt_payments (order_id, method, amount, state)
       VALUES ($1,$2,$3,'READY')
       RETURNING id, method, amount, state`, [o.id, method, o.total]);

    return { ...pay, orderNo: no, orderName: await this.orderName(o.id),
      note: method === 'VBANK'
        ? '입금하실 계좌를 안내해 드립니다. 입금 확인 후 보내 드립니다.'
        : '결제창으로 넘어갑니다.' };
  }

  /** 결제창에 보일 주문명 — "첫 상품 외 N건" (토스 orderName 100자 제한) */
  private async orderName(orderId: string) {
    const [r] = await this.db.query<any>(
      `SELECT min(p.name) AS first, count(*)::int AS n
         FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id WHERE i.order_id = $1`, [orderId]);
    const name = r?.n > 1 ? `${r.first} 외 ${r.n - 1}건` : (r?.first ?? '소개몰 주문');
    return name.slice(0, 100);
  }

  /* ── 결제 승인 (D006 — 토스 표준 결제창) ───────────────────────────
   *
   * 흐름: POST /pay (READY) → 결제창 → 성공 주소(paymentKey · orderId · amount) → 여기.
   *   1) 금액을 **주문 금액과** 대조합니다 — 성공 주소의 amount 는 브라우저가 고칠 수 있습니다.
   *   2) PG 에 승인을 요청합니다(토스 /v1/payments/confirm). PG 도 자기 금액과 대조합니다.
   *   3) 승인되면 결제 PAID → fn_hlt_pay_apply 가 주문을 PAID 로 바꿉니다.
   *      가상계좌는 WAITING_FOR_DEPOSIT — READY 로 두고 계좌만 안내합니다(입금은 웹훅).
   *
   * 멱등: 같은 paymentKey 로 다시 부르면 PG 를 다시 부르지 않고 같은 결과를 돌려줍니다.
   * 동시성: 주문 행을 잠근 채 PG 를 부릅니다 — 같은 주문의 승인이 둘 겹치지 않습니다.
   * 키(TOSS_SECRET_KEY)가 없으면 스텁이 승인하고 stub:true 가 남습니다 — 화면은 "시험 결제" 로 보입니다. */
  async confirmPay(no: string, paymentKey: string, amount: number) {
    const me = RequestCtx.actorId()!;
    const provider = resolvePaymentProvider();

    const out = await this.db.transaction(async () => {
      const [o] = await this.db.query<any>(
        `SELECT id, order_no, total, status FROM hlt_orders
          WHERE order_no = $1 AND account_id = $2 FOR UPDATE`, [no, me]);
      if (!o) throw new StateConflict('NOT_FOUND', '없는 주문입니다.');

      /* 같은 paymentKey — 이미 처리한 결과를 그대로 */
      const [same] = await this.db.query<any>(
        `SELECT p.id, p.order_id FROM hlt_payments p WHERE p.payment_key = $1`, [paymentKey]);
      if (same) {
        if (same.order_id !== o.id) {
          throw new StateConflict('PAYMENT_KEY_MISMATCH', '다른 주문의 결제입니다.');
        }
        return { payId: same.id, again: true };
      }

      if (!Number.isInteger(Number(amount)) || Number(amount) !== Number(o.total)) {
        throw new PolicyViolation('AMOUNT_MISMATCH',
          `결제 금액이 주문 금액과 다릅니다 — 결제를 승인하지 않았습니다(주문 ${Number(o.total).toLocaleString()}원).`,
          { expected: Number(o.total), got: amount });
      }
      if (o.status !== 'PENDING') {
        throw new StateConflict('ALREADY', '이미 결제되었거나 취소된 주문입니다.');
      }
      await this.assertNoCancelRequest(o.id);
      const [ready] = await this.db.query<any>(
        `SELECT id, method, payment_key FROM hlt_payments
          WHERE order_id = $1 AND state = 'READY' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [o.id]);
      if (!ready) {
        throw new StateConflict('NO_READY_PAYMENT', '결제 준비 기록이 없습니다. 결제 화면에서 다시 시작해 주십시오.');
      }
      if (ready.payment_key) {
        throw new StateConflict('VBANK_WAITING', '가상계좌가 이미 발급되어 입금을 기다리고 있습니다.');
      }

      let r: PaymentResult = await provider.confirm({
        paymentKey, orderId: o.order_no, amount: Number(o.total),
        orderName: `소개몰 주문 ${o.order_no}`, method: ready.method,
      });
      /* 승인은 됐는데 우리 기록이 실패해 다시 온 경우 — PG 는 "이미 처리됨" 이라 답합니다.
       * 그때는 조회해서 이 주문 · 이 금액으로 승인된 것이 맞으면 승인으로 봅니다. */
      if (!r.approved && !r.pending && r.code === 'ALREADY_PROCESSED_PAYMENT') {
        const look = await provider.getPayment(paymentKey);
        if (look.found && look.status === 'DONE' && look.orderId === o.order_no
            && look.totalAmount === Number(o.total)) {
          r = { approved: true, stub: look.stub, amount: look.totalAmount, method: look.method,
            status: 'DONE', paymentKey, approvedAt: look.approvedAt, transactionKey: look.transactionKey };
        }
      }

      const method = TOSS_METHOD[r.method ?? ''] ?? ready.method;
      if (r.approved) {
        await this.db.query(
          `UPDATE hlt_payments
              SET state = 'PAID', payment_key = $2, approved_at = coalesce($3::timestamptz, now()),
                  pg_status = 'DONE', stub = $4, method = $5, pg_tid = $6, fail_reason = NULL
            WHERE id = $1`,
          [ready.id, paymentKey, r.approvedAt ?? null, r.stub, method, r.transactionKey ?? null]);
      } else if (r.pending) {
        await this.db.query(
          `UPDATE hlt_payments
              SET payment_key = $2, pg_status = $3, stub = $4, method = 'VBANK',
                  vbank = $5::jsonb, vbank_secret = $6, pg_tid = $7, fail_reason = NULL
            WHERE id = $1`,
          [ready.id, paymentKey, r.status ?? 'WAITING_FOR_DEPOSIT', r.stub,
           JSON.stringify(r.virtualAccount ?? {}), r.secret ?? null, r.transactionKey ?? null]);
      } else {
        /* 실패 — READY 로 둡니다(다시 결제할 수 있게). 사유만 남깁니다 */
        await this.db.query(
          `UPDATE hlt_payments SET fail_reason = $2 WHERE id = $1`,
          [ready.id, (r.detail ?? '결제 승인 실패').slice(0, 500)]);
        return { fail: r };
      }
      return { payId: ready.id, again: false };
    });

    if ('fail' in out) {
      throw new PolicyViolation('PAY_REJECTED', out.fail!.detail ?? '결제가 승인되지 않았습니다.',
        { pgCode: out.fail!.code ?? null });
    }
    const [row] = await this.db.query<any>(
      `SELECT ${PAY_COLS}, o.order_no AS "orderNo", o.status AS "orderStatus"
         FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id WHERE p.id = $1`, [out.payId]);
    return { ...row, again: out.again,
      note: row.state === 'PAID'
        ? (row.stub ? '시험 결제(스텁)로 승인했습니다 — 실제 돈은 오가지 않았습니다.' : '결제가 승인되었습니다.')
        : row.pgStatus === 'WAITING_FOR_DEPOSIT'
          ? '가상계좌를 발급했습니다. 입금이 확인되면 주문이 결제 완료로 바뀝니다.'
          : `결제 상태: ${row.state}` };
  }

  /* ── 토스 웹훅 (D006) ──────────────────────────────────────────────
   *
   * PAYMENT_STATUS_CHANGED { eventType, createdAt, data: Payment }
   * DEPOSIT_CALLBACK       { createdAt, secret, status, transactionKey, orderId } (가상계좌 입금)
   *
   * **본문을 믿지 않습니다.** 누구나 이 주소로 "입금됐다" 를 보낼 수 있습니다.
   * 본문에서는 어느 결제인지(paymentKey · orderId)만 읽고, 상태는 PG 에서 다시 조회한 값을 씁니다.
   * 조회가 실패하면 5xx 를 돌려줍니다 — 토스가 다시 보냅니다.
   * 이미 반영된 상태면 아무것도 하지 않습니다(재전송 안전). */
  async tossWebhook(body: any) {
    const data = body && typeof body.data === 'object' && body.data ? body.data : (body ?? {});
    const eventType = typeof body?.eventType === 'string' ? body.eventType
      : (typeof data.secret === 'string' ? 'DEPOSIT_CALLBACK' : 'UNKNOWN');
    const key = typeof data.paymentKey === 'string' ? data.paymentKey.slice(0, 200) : null;
    const orderId = typeof data.orderId === 'string' ? data.orderId.slice(0, 64) : null;
    if (!key && !orderId) return { ok: false, eventType, action: 'IGNORED', note: 'paymentKey · orderId 가 없습니다.' };

    const [row] = await this.db.query<any>(
      key
        ? `SELECT p.id, p.payment_key, p.vbank_secret, p.amount, o.order_no FROM hlt_payments p
             JOIN hlt_orders o ON o.id = p.order_id WHERE p.payment_key = $1`
        : `SELECT p.id, p.payment_key, p.vbank_secret, p.amount, o.order_no FROM hlt_payments p
             JOIN hlt_orders o ON o.id = p.order_id
            WHERE o.order_no = $1 AND p.payment_key IS NOT NULL
            ORDER BY p.created_at DESC LIMIT 1`, [key ?? orderId]);
    /* 우리 건강몰 결제가 아니면(구독 결제 등) 200 으로 받기만 합니다 — 재전송이 쌓이지 않게 */
    if (!row) return { ok: true, eventType, action: 'IGNORED', note: '소개몰 결제가 아닙니다.' };
    if (typeof data.secret === 'string' && row.vbank_secret && data.secret !== row.vbank_secret) {
      return { ok: false, eventType, action: 'REJECTED', note: '입금 알림 secret 이 맞지 않습니다.' };
    }

    const provider = resolvePaymentProvider();
    const look = await provider.getPayment(row.payment_key);
    if (!look.found) {
      if (look.stub) return { ok: false, eventType, action: 'IGNORED', note: look.detail };
      throw new AppError(502, { code: 'PG_LOOKUP_FAILED', message: `결제 조회 실패 — ${look.detail ?? ''}` });
    }
    return this.applyLookup(row.id, look, eventType);
  }

  /** PG 에서 조회한 상태를 우리 결제 · 주문에 반영합니다. 같은 상태면 아무것도 하지 않습니다 */
  private async applyLookup(payId: string, look: PaymentLookup, eventType: string) {
    return this.db.transaction(async () => {
      const [p] = await this.db.query<any>(
        `SELECT p.id, p.state, p.amount, p.method, p.pg_status, o.id AS order_id, o.order_no, o.status AS order_status
           FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id
          WHERE p.id = $1 FOR UPDATE OF p, o`, [payId]);
      const res = (action: string, note: string) =>
        ({ ok: true, eventType, action, pgStatus: look.status, state: p.state, stub: look.stub, orderNo: p.order_no, note });

      if (look.orderId && look.orderId !== p.order_no) {
        return { ...res('MISMATCH', 'PG 결제의 주문번호가 다릅니다 — 반영하지 않았습니다.'), ok: false };
      }
      if (look.totalAmount != null && look.totalAmount !== Number(p.amount)) {
        await this.db.query(`UPDATE hlt_payments SET fail_reason = $2 WHERE id = $1`,
          [p.id, `PG 금액 ${look.totalAmount} ≠ 결제 금액 ${p.amount} — 운영 확인 필요`]);
        return { ...res('MISMATCH', 'PG 금액이 결제 금액과 다릅니다 — 반영하지 않았습니다.'), ok: false };
      }

      const st = look.status ?? '';
      if (st === 'DONE') {
        if (p.state === 'PAID') return res('ALREADY', '이미 반영된 결제입니다.');
        if (p.state === 'READY' && p.order_status === 'PENDING') {
          await this.db.query(
            `UPDATE hlt_payments SET state = 'PAID', pg_status = 'DONE',
                    approved_at = coalesce($2::timestamptz, now()), stub = stub OR $3,
                    method = coalesce($4, method), fail_reason = NULL
              WHERE id = $1`,
            [p.id, look.approvedAt ?? null, look.stub, TOSS_METHOD[look.method ?? ''] ?? null]);
          return { ...res('PAID', '입금이 확인되어 결제 완료로 바꿨습니다.'), state: 'PAID' };
        }
        /* 닫힌 주문(취소)에 늦게 들어온 돈 — 주문을 되살리지 않습니다. 운영이 환불해야 합니다 */
        await this.db.query(
          `UPDATE hlt_payments SET pg_status = 'DONE', fail_reason = $2 WHERE id = $1`,
          [p.id, `LATE_DEPOSIT: 주문(${p.order_status})이 닫힌 뒤 입금됨 — 환불 필요`]);
        return { ...res('NEEDS_OPERATOR', '닫힌 주문에 입금되었습니다 — 운영이 환불해야 합니다.'), ok: false };
      }
      if (st === 'WAITING_FOR_DEPOSIT' || st === 'IN_PROGRESS' || st === 'READY') {
        await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE id = $1`, [p.id, st]);
        return res('WAITING', '입금을 기다리고 있습니다.');
      }
      if (['CANCELED', 'PARTIAL_CANCELED', 'EXPIRED', 'ABORTED'].includes(st)) {
        if (p.state === 'CANCELED' || p.state === 'FAILED') {
          await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE id = $1`, [p.id, st]);
          return res('ALREADY', '이미 닫힌 결제입니다.');
        }
        if (p.state === 'READY') {
          /* ★ CANCELED 가 아니라 FAILED — CANCELED 는 fn_hlt_pay_apply 가 주문 취소로 옮깁니다.
           * 입금 전 만료·취소는 결제만 닫고 주문은 결제 대기로 둡니다(다른 수단으로 다시 결제). */
          await this.db.query(
            `UPDATE hlt_payments SET state = 'FAILED', pg_status = $2, fail_reason = $3 WHERE id = $1`,
            [p.id, st, `PG ${st}`]);
          return { ...res('FAILED', '결제가 만료·취소되어 닫았습니다. 주문은 결제 대기로 남습니다.'), state: 'FAILED' };
        }
        /* PAID 인데 PG 쪽에서 취소됨(PG 관리화면 등) — 발송 전 전액 취소면 주문 취소로 반영합니다.
         * 발송 뒤거나 부분 취소면 상태를 바꾸지 않고 운영에 넘깁니다(반품 · 재고 판단이 필요합니다). */
        if (st === 'CANCELED' && ['PAID', 'PREPARING'].includes(p.order_status)) {
          await this.db.query(
            `UPDATE hlt_payments SET state = 'CANCELED', pg_status = $2, canceled_at = now(),
                    canceled_amount = amount WHERE id = $1`, [p.id, st]);
          return { ...res('CANCELED', 'PG 에서 취소된 결제라 주문을 취소했습니다.'), state: 'CANCELED' };
        }
        await this.db.query(
          `UPDATE hlt_payments SET pg_status = $2, fail_reason = $3 WHERE id = $1`,
          [p.id, st, `PG ${st} — 주문(${p.order_status}) 운영 확인 필요`]);
        return { ...res('NEEDS_OPERATOR', 'PG 에서 취소되었지만 발송 뒤라 운영 확인이 필요합니다.'), ok: false };
      }
      await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE id = $1`, [p.id, st || null]);
      return res('RECORDED', `PG 상태 ${st || '알 수 없음'} 을(를) 기록했습니다.`);
    });
  }

  /* ── 배송 ──────────────────────────────────────────────────────── */

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

  /** v10.31 (시안 「오늘의 건강상품」 특가 배너) — 지금 걸린 것(기간 안 · 켠 것) */
  promos() {
    return this.db.query(
      `SELECT id, slot, tag, title, title_em AS "titleEm", body, link_url AS "linkUrl", cta, is_sample AS "isSample"
         FROM hlt_promos
        WHERE is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
        ORDER BY sort_order, created_at DESC LIMIT 5`);
  }

  /* ── 판매자 정산 ──────────────────────────────────────────────── */

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

  /** 취소·반품 신청 목록. 기본은 접수(REQUESTED)만 */
  adminReturns(state?: string) {
    return this.db.query(
      `SELECT r.id, r.kind, r.reason, r.detail, r.state, r.decide_note AS "decideNote",
              r.created_at AS "createdAt", r.decided_at AS "decidedAt",
              o.order_no AS "orderNo", o.status AS "orderStatus", o.total,
              o.delivered_at AS "deliveredAt", o.restocked_at AS "restockedAt",
              o.restock_skipped AS "restockSkipped",
              r.customer_opened AS "customerOpened", r.opened,
              r.refund_amount AS "refundAmount", r.refunded_at AS "refundedAt",
              r.ship_deduction AS "shipDeduction",
              r.refund_error AS "refundError",
              r.exchange_fee AS "exchangeFee", ${FEE_STATE_SQL} AS "feeState", r.converted_from AS "convertedFrom",
              (SELECT xf.refund_error FROM hlt_exchange_fees xf WHERE xf.return_id = r.id AND xf.state = 'PAID' LIMIT 1) AS "feeRefundError",
              CASE WHEN r.kind = 'EXCHANGE' THEN (now()::date - (r.created_at AT TIME ZONE 'Asia/Seoul')::date) END AS "daysSince",
              pay.state AS "payState", pay.stub AS "payStub", pay.amount AS "payAmount", pay.method AS "payMethod",
              a.name AS "buyerName",
              (SELECT string_agg(p.name || coalesce(' (' || nullif(i.option_label, '단품') || ')', '') || ' × ' || i.qty, ', ')
                 FROM hlt_order_items i JOIN hlt_products p ON p.id = i.product_id
                WHERE i.order_id = o.id) AS items,
              (SELECT string_agg(DISTINCT w.blocked_if, ' / ')
                 FROM hlt_order_items i JOIN withdrawal_rules w ON w.code = i.withdrawal_code
                WHERE i.order_id = o.id AND coalesce(w.blocked_if,'') <> '') AS "blockedIf"
         FROM hlt_returns r
         JOIN hlt_orders o ON o.id = r.order_id
         JOIN accounts a ON a.id = o.account_id
         LEFT JOIN LATERAL (
           SELECT state, stub, amount, method FROM hlt_payments x
            WHERE x.order_id = o.id AND x.state IN ('PAID','CANCELED') AND x.payment_key IS NOT NULL
            ORDER BY (x.state = 'PAID') DESC, x.created_at DESC LIMIT 1) pay ON true
        WHERE ($1::text = 'ALL' OR r.state = $1)
        ORDER BY r.created_at DESC LIMIT 100`, [state || 'REQUESTED']);
  }

  /**
   * 취소·반품 승인 · 반려.
   *
   * 승인하면 주문이 CANCELED(취소) 또는 RETURNED(반품)로 바뀌고, **재고는 트리거가
   * 한 번만 되돌립니다**(fn_hlt_order_restock). 교환 승인은 주문 상태를 바꾸지 않습니다.
   * 반려는 사유가 있어야 합니다(fn_hlt_return_guard). 결제 대기 건은 닫습니다.
   *
   * D006
   *  · 반품 승인은 **개봉 여부 판정(opened)** 이 필수입니다. 개봉이면 주문은 RETURNED 지만
   *    재고로 되돌리지 않습니다(restock_skipped='OPENED', 사장님 결정 2026-10-02).
   *    발송 전 취소는 개봉일 수 없습니다.
   *  · 결제된 주문이면 승인 뒤 **바로 환불**합니다(PG 결제 취소 → REFUNDED).
   *    환불이 실패하면 승인(APPROVED)에 머물고 사유가 남습니다 — /refund 로 다시 시도합니다.
   *    순서: 주문을 먼저 닫고(이 트랜잭션) → 결제를 CANCELED 로(환불 트랜잭션).
   *    닫힌 주문은 fn_hlt_pay_apply 가 건드리지 않아 반품이 취소로 바뀌지 않습니다.
   */
  async decideReturn(id: string, state: string, note?: string, opened?: boolean, sellerFault?: boolean) {
    const me = RequestCtx.actorId()!;
    const decided = await this.db.transaction(async () => {
      const [r] = await this.db.query<any>(
        `SELECT r.id, r.kind, r.state, r.exchange_fee, o.id AS order_id, o.order_no, o.status
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
          WHERE r.id::text = $1 FOR UPDATE OF r, o`, [id]);
      if (!r) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
      if (r.state !== 'REQUESTED') {
        throw new StateConflict('ALREADY_DECIDED', '이미 처리된 신청입니다.');
      }
      if (state === 'REJECTED' && !note?.trim()) {
        throw new PolicyViolation('NOTE_REQUIRED', '반려하시려면 이유를 적어야 합니다 — 청약철회는 법이 준 권리라 근거가 필요합니다.');
      }
      if (r.kind === 'CANCEL' && opened === true) {
        throw new PolicyViolation('CANCEL_NOT_OPENED', '발송 전 취소는 개봉일 수 없습니다 — 개봉 판정은 반품에만 합니다.');
      }
      if (state === 'APPROVED' && r.kind === 'RETURN' && typeof opened !== 'boolean') {
        throw new PolicyViolation('OPENED_REQUIRED',
          '반품을 승인하시려면 개봉 여부를 골라 주십시오 — 개봉이면 재판매할 수 없어 재고로 되돌리지 않습니다.');
      }
      /* v10.26 — 회원 사정 교환은 교환 배송비를 낸 뒤에 승인합니다. 운영이 회사 사정으로 판정하면(sellerFault) 비용을 0 으로 하고 낸 돈을 돌려드립니다 */
      let fee = Number(r.exchange_fee ?? 0);
      if (sellerFault === true && r.kind !== 'EXCHANGE') {
        throw new PolicyViolation('SELLER_FAULT_EXCHANGE_ONLY', '「회사 사정으로 판정」은 교환 신청에만 씁니다.');
      }
      if (state === 'APPROVED' && r.kind === 'EXCHANGE' && fee > 0) {
        if (sellerFault === true) fee = 0;
        else {
          const [paid] = await this.db.query<any>(
            `SELECT id FROM hlt_exchange_fees WHERE return_id = $1 AND state = 'PAID' AND amount = $2`, [r.id, fee]);
          if (!paid) throw new StateConflict('FEE_UNPAID', '교환 배송비를 아직 결제하지 않은 신청입니다 — 결제 뒤에 승인하거나, 회사 사정이면 「회사 사정으로 판정」을 골라 주십시오.');
        }
      }

      let orderStatus = r.status;
      let vbankKeys: string[] = [];
      if (state === 'APPROVED') {
        if (r.status === 'CANCELED' || r.status === 'RETURNED') {
          throw new StateConflict('ORDER_CLOSED', '이미 취소·반품된 주문입니다.');
        }
        if (r.kind === 'CANCEL') {
          if (!['PENDING', 'PAID', 'PREPARING'].includes(r.status)) {
            throw new StateConflict('ALREADY_SHIPPED',
              '신청 뒤에 발송되었습니다. 취소가 아니라 반품으로 처리해야 합니다 — 반려하고 반품 신청을 안내해 주십시오.');
          }
          orderStatus = 'CANCELED';
        } else if (r.kind === 'RETURN') {
          if (!['SHIPPED', 'DELIVERED', 'CONFIRMED'].includes(r.status)) {      /* v10.28 — 구매확정 뒤에도 법정 기간 안의 반품은 받음 */
            throw new StateConflict('NOT_SHIPPED', '발송 전 주문은 반품이 아니라 취소입니다.');
          }
          orderStatus = 'RETURNED';
        }
        if (orderStatus !== r.status) {
          /* 개봉 반품은 재고로 되돌리지 않습니다 — 트리거가 restock_skipped 를 보고 건너뜁니다 */
          await this.db.query(
            `UPDATE hlt_orders SET status = $2, restock_skipped = $3 WHERE id = $1`,
            [r.order_id, orderStatus, orderStatus === 'RETURNED' && opened === true ? 'OPENED' : null]);
          /* 결제 준비 건은 닫습니다. ★ CANCELED 가 아니라 FAILED — CANCELED 는 fn_hlt_pay_apply 가 주문 취소로 옮깁니다.
           * 가상계좌가 발급된 준비 건은 PG 에서도 닫아야 늦은 입금이 생기지 않습니다(커밋 뒤). */
          const closed = await this.db.query<any>(
            `UPDATE hlt_payments SET state = 'FAILED', fail_reason = '주문 취소·반품'
              WHERE order_id = $1 AND state = 'READY' RETURNING payment_key`, [r.order_id]);
          vbankKeys = closed.map((x: any) => x.payment_key).filter(Boolean);
        }
      }

      await this.db.query(
        `UPDATE hlt_returns SET state = $2, decide_note = $3, decided_by = $4, decided_at = now(), opened = $5, exchange_fee = $6
          WHERE id = $1`,
        [r.id, state, note?.trim() || null, me, r.kind === 'CANCEL' ? false : (typeof opened === 'boolean' ? opened : null), fee]);
      return { r, vbankKeys, refundable: state === 'APPROVED' && orderStatus !== r.status,
        feeBack: r.kind === 'EXCHANGE' && (state === 'REJECTED' || (state === 'APPROVED' && fee === 0 && Number(r.exchange_fee) > 0)) };
    });

    const { r } = decided;
    /* 발급만 되고 입금 전인 가상계좌 닫기 — 실패해도 승인은 유지합니다(웹훅이 늦은 입금을 운영에 넘깁니다) */
    for (const k of decided.vbankKeys) {
      const c = await resolvePaymentProvider().cancel({
        paymentKey: k, cancelReason: `소개몰 주문 취소 (${r.order_no})`, idempotencyKey: `hlt-vbank-close-${k}`,
      }).catch(() => null);
      if (c?.ok) await this.db.query(`UPDATE hlt_payments SET pg_status = $2 WHERE payment_key = $1`, [k, c.status ?? 'CANCELED']);
    }

    let refund: any = { state: 'NONE' };
    if (decided.refundable) {
      const [paid] = await this.db.query<any>(
        `SELECT id FROM hlt_payments WHERE order_id = $1 AND state = 'PAID'`, [r.order_id]);
      if (paid) {
        try {
          const x = await this.refund(r.id);
          refund = { state: 'REFUNDED', amount: x.refundAmount, stub: x.stub, shipDeduction: x.shipDeduction };
        } catch (e: any) {
          refund = { state: 'FAILED', error: e?.getResponse?.()?.message ?? e?.message ?? '환불 실패' };
        }
      }
    }

    /* v10.26 — 교환 배송비 돌려드림(반려 · 회사 사정 판정). 실패해도 결정은 유지하고 다시 시도할 수 있게 둡니다 */
    const feeRefund = decided.feeBack ? await this.refundExchangeFee(r.id, state === 'REJECTED' ? '교환 반려' : '회사 사정으로 판정') : { state: 'NONE' as const };

    const [o] = await this.db.query<any>(
      `SELECT status, restocked_at AS "restockedAt", restock_skipped AS "restockSkipped"
         FROM hlt_orders WHERE id = $1`, [r.order_id]);
    const [cur] = await this.db.query<any>(`SELECT state, opened FROM hlt_returns WHERE id = $1`, [r.id]);
    const stock = o.restockedAt ? ' 재고를 되돌렸습니다.'
      : o.restockSkipped === 'OPENED' ? ' 개봉 반품이라 재고로 되돌리지 않았습니다.' : '';
    const base = { id: r.id, state: cur.state, orderNo: r.order_no, orderStatus: o.status,
      restockedAt: o.restockedAt, restockSkipped: o.restockSkipped, opened: cur.opened, refund, feeRefund };
    const feeNote = feeRefund.state === 'REFUNDED' ? ` 교환 배송비 ${feeRefund.amount.toLocaleString()}원을 돌려드렸습니다.`
      : feeRefund.state === 'FAILED' ? ' 교환 배송비 환불이 실패했습니다 — 「교환 배송비 환불 다시 시도」로 처리해 주십시오.' : '';
    if (state === 'REJECTED') return { ...base, note: `반려했습니다. 고객에게 사유가 보입니다.${feeNote}` };
    if (r.kind === 'EXCHANGE') return { ...base, note: `교환을 승인했습니다. 환불은 없습니다.${feeNote}` };
    if (refund.state === 'FAILED') {
      /* ok:false — 화면이 성공으로 보이지 않게 합니다(승인 자체는 됐습니다) */
      return { ...base, ok: false,
        note: `승인했지만 환불이 실패했습니다: ${refund.error} — 「환불 다시 시도」로 처리해 주십시오.${stock}` };
    }
    if (refund.state === 'REFUNDED') {
      const ded = Number(refund.shipDeduction ?? 0);
      return { ...base, note: `승인하고 ${ded > 0 ? `왕복 배송비 ${ded.toLocaleString()}원을 빼고 ` : ''}${Number(refund.amount).toLocaleString()}원을 환불했습니다${refund.stub ? '(시험 결제 — 실제 돈 없음)' : ''}.${stock}` };
    }
    return { ...base, note: `승인했습니다.${decided.refundable ? ' 결제 전 주문이라 환불할 것이 없습니다.' : ''}${stock}` };
  }

  /**
   * 반품 배송비 차감 (10/2 결정) — 고객 사정(단순 변심 · 잘못 주문)의 **반품**은 왕복 배송비를 뺍니다.
   * 금액 · 대상은 health-policy.ts 한 곳에서 정하고, 약관 초안(HLT_SALE §2)에 같은 값이 적힙니다.
   * DB 제약(ck_hlt_returns_ship_deduction)이 다른 사유 · 취소에서의 차감을 막습니다.
   */
  private refundDeduction(r: { kind: string; reason: string; converted_from?: string | null }, paid: number): number {
    /* v10.26 (10/8 답 「빼지 않음」 · 판매 약관 1.2 제3조 ③) — 재고가 없어 교환에서 바꾼 반품은 회사 사정이라 전액 환불합니다 */
    if (r.converted_from) return 0;
    return returnShipDeduction(r.kind, r.reason, paid);
  }

  /**
   * 환불 (D006) — 승인된 취소·반품의 결제를 PG 에서 취소하고 REFUNDED 로 닫습니다.
   * 이미 환불됐으면 같은 결과를 돌려줍니다(재시도 안전). PG 에는 Idempotency-Key(신청 id)를 붙입니다.
   * 실패하면 승인(APPROVED)에 머물고 refund_error 가 남습니다.
   */
  async refund(id: string, refundReceiveAccount?: RefundReceiveAccount) {
    const provider = resolvePaymentProvider();
    const out = await this.db.transaction(async () => {
      const [r] = await this.db.query<any>(
        `SELECT r.id, r.kind, r.reason, r.state, r.refund_amount, r.refunded_at, r.ship_deduction, r.converted_from,
                o.id AS order_id, o.order_no, o.status, o.ship_fee
           FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id
          WHERE r.id::text = $1 FOR UPDATE OF r, o`, [id]);
      if (!r) throw new StateConflict('NOT_FOUND', '없는 신청입니다.');
      if (r.state === 'REFUNDED') {
        const [p] = await this.db.query<any>(
          `SELECT stub FROM hlt_payments WHERE order_id = $1 AND state = 'CANCELED' AND payment_key IS NOT NULL
            ORDER BY canceled_at DESC NULLS LAST LIMIT 1`, [r.order_id]);
        return { r, again: true, amount: Number(r.refund_amount), deduct: Number(r.ship_deduction ?? 0), stub: !!p?.stub };
      }
      if (r.state !== 'APPROVED') throw new StateConflict('NOT_APPROVED', '승인된 신청만 환불합니다.');
      if (!['CANCEL', 'RETURN'].includes(r.kind)) {
        throw new StateConflict('NOT_REFUNDABLE', '교환은 환불하지 않습니다.');
      }
      /* 순서 보장 — 주문이 닫혀 있어야 결제 CANCELED 가 주문을 바꾸지 않습니다 */
      if (!['CANCELED', 'RETURNED'].includes(r.status)) {
        throw new StateConflict('ORDER_OPEN', '주문이 아직 닫히지 않았습니다 — 승인부터 해 주십시오.');
      }
      const [pay] = await this.db.query<any>(
        `SELECT id, amount, payment_key, stub FROM hlt_payments
          WHERE order_id = $1 AND state = 'PAID' FOR UPDATE`, [r.order_id]);
      if (!pay) throw new StateConflict('NOT_PAID', '결제되지 않은 주문이라 환불할 것이 없습니다.');

      const deduct = this.refundDeduction(r, Number(pay.amount));
      const amount = Number(pay.amount) - deduct;
      if (amount <= 0) {
        throw new StateConflict('NOTHING_TO_REFUND', '왕복 배송비를 빼면 환불할 금액이 없습니다 — 운영 확인이 필요합니다.');
      }
      const c = await provider.cancel({
        paymentKey: pay.payment_key,
        cancelReason: `소개몰 ${r.kind === 'RETURN' ? '반품' : '주문 취소'} 승인 (${r.order_no})`,
        cancelAmount: deduct > 0 ? amount : undefined,
        idempotencyKey: `hlt-refund-${r.id}`,
        refundReceiveAccount,
      });
      if (!c.ok) {
        await this.db.query(
          `UPDATE hlt_returns SET refund_error = $2, refund_tried_at = now() WHERE id = $1`,
          [r.id, (c.detail ?? '환불 실패').slice(0, 500)]);
        return { r, fail: c };
      }
      const refunded = c.canceledAmount ?? amount;
      await this.db.query(
        `UPDATE hlt_payments SET state = 'CANCELED', pg_status = $2,
                canceled_at = coalesce($3::timestamptz, now()), canceled_amount = $4
          WHERE id = $1`, [pay.id, c.status ?? 'CANCELED', c.canceledAt ?? null, refunded]);
      await this.db.query(
        `UPDATE hlt_returns SET state = 'REFUNDED', refund_amount = $2, refunded_at = now(),
                refund_error = NULL, refund_tried_at = now(), ship_deduction = $3
          WHERE id = $1`, [r.id, refunded, Number(pay.amount) - refunded]);
      return { r, again: false, amount: refunded, deduct: Number(pay.amount) - refunded, stub: c.stub || pay.stub };
    });

    if ('fail' in out && out.fail) {
      throw new AppError(502, { code: 'REFUND_FAILED',
        message: `환불하지 못했습니다 — ${out.fail.detail ?? 'PG 응답 없음'}. 승인 상태로 남아 있으니 다시 시도해 주십시오.`,
        details: { pgCode: out.fail.code ?? null } });
    }
    const o = out as { r: any; again: boolean; amount: number; deduct: number; stub: boolean };
    return { id: o.r.id, state: 'REFUNDED', orderNo: o.r.order_no, refundAmount: o.amount,
      shipDeduction: o.deduct, stub: o.stub, again: o.again,
      note: o.again ? '이미 환불된 신청입니다.'
        : `${o.deduct > 0 ? `왕복 배송비 ${o.deduct.toLocaleString()}원을 빼고 ` : ''}${o.amount.toLocaleString()}원을 환불했습니다${o.stub ? '(시험 결제 — 실제 돈 없음)' : ''}.` };
  }

  commissionRates() {
    return this.db.query(
      `SELECT category_code AS "categoryCode", rate,
              referral_pct AS "referralPct", note, updated_at AS "updatedAt",
              (SELECT count(*) FROM hlt_commission_changes c
                WHERE c.target = r.category_code)::int AS changes
         FROM hlt_commission_rates r ORDER BY category_code`);
  }

}

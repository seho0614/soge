import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { StateConflict } from '../../core/errors';
import { HLT_EXCHANGE_SHIP_ROUND_TRIP, exchangeFee } from './health-policy';
import { CARD_COLS, CARD_FROM, OPTION_COLS, SEARCH_BODY } from './health-catalog.sql';
import { storageFromEnv } from '../file/storage';
import { expandKeyword } from '../../core/search-expand';

/**
 * 건강몰 — 상품 · 성분 · 고민 · 기획전(읽기).
 * v10.86 — health-shop.service.ts 에서 나눔(동작 같음).
 */
@Injectable()
export class HealthCatalogService {
  constructor(private readonly db: DatabaseService) {}
  /**
   * 상품 목록. `ingredient` · `concern` 으로 좁힐 수 있습니다(D002 — 성분–상품 연결 표).
   * 고민으로 좁히면 그 고민에 묶인 성분 중 하나라도 든 상품입니다. 성분군(D027)이면 아래 성분이 든 상품까지입니다.
   * v10.26 — 카드 항목(표제 성분 · 정가 · 할인율 · 한 달 최저 · 배지 · 그림 · 판매자 유형 · 담을 옵션)이 함께 오고,
   *   검색 낱말은 상품 이름 · 한 줄 설명 · 갈래 이름 · 성분 이름(다른 이름 포함)에서 찾습니다(전에는 상품 이름만).
   */
  async products(category?: string, keyword?: string, ingredient?: string, concern?: string) {
    const kw = await expandKeyword(this.db, keyword);   // v10.83 (D111) — 동의어 · 오타 교정어
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
      [category || null, kw, ingredient || null, concern || null]);
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

  /** v10.31 (시안 「오늘의 건강상품」 특가 배너) — 지금 걸린 것(기간 안 · 켠 것) */
  promos() {
    return this.db.query(
      `SELECT id, slot, tag, title, title_em AS "titleEm", body, link_url AS "linkUrl", cta, is_sample AS "isSample"
         FROM hlt_promos
        WHERE is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
        ORDER BY sort_order, created_at DESC LIMIT 5`);
  }
}

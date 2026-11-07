/**
 * 소개몰 상품 카드 · 상세에 쓰는 SQL 조각 (v10.26 · D027).
 *
 * 상품의 값(price) · 재고(stock)는 옵션에서 계산된 값입니다(fn_hlt_option_sync) — 대표 판매가 = 가장 짧은 개월 수 옵션의 결제 금액.
 *
 * ★ 「한 달 N원 부터」(minUnit)는 **살 수 있는 옵션만**(켬 · 재고 있음 · 개월 수 있음)으로 계산합니다.
 *   시안은 품절 옵션도 넣어 p10 의 카드에 살 수 없는 값(2,900원)이 나왔습니다 — 10/8 확인 「추천한 형태로」(시안도 같이 고침).
 */

/** FROM 에 이것을 쓰면 아래 CARD_COLS 를 쓸 수 있습니다 */
export const CARD_FROM = `hlt_products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN hlt_sellers s ON s.id = p.seller_id
  LEFT JOIN files f ON f.id = p.image_file_id AND f.status = 'READY' AND f.purpose = 'PRODUCT_IMAGE'`;

/** 상품 카드 항목 — 목록 · 검색 · 성분/고민 상세 · 직판관 · 메인이 같은 모양을 받습니다 */
export const CARD_COLS = `p.code, p.name, p.price, p.stock, p.review_no AS "reviewNo",
  /* v10.28 (D036) — 보이는 리뷰의 별점 평균 · 수(시안 카드의 ★) */
  (SELECT rs.rating_avg FROM v_hlt_review_stats rs WHERE rs.product_id = p.id) AS "ratingAvg",
  coalesce((SELECT rs.review_count FROM v_hlt_review_stats rs WHERE rs.product_id = p.id), 0) AS "reviewCount",
  p.withdrawal_code AS withdrawal, c.name AS category, c.code AS "categoryCode",
  (p.stock = 0 OR p.status = 'SOLD_OUT') AS "soldOut",
  p.summary, p.list_price AS "listPrice", p.badge,
  CASE WHEN p.list_price > p.price THEN round((1 - p.price::numeric / p.list_price) * 100)::int END AS "offPct",
  (SELECT min(round(o.price::numeric / o.months))::int FROM hlt_product_options o
    WHERE o.product_id = p.id AND o.is_active AND o.stock > 0 AND o.months IS NOT NULL) AS "minUnit",
  (SELECT o.id FROM hlt_product_options o
    WHERE o.product_id = p.id AND o.is_active AND o.stock > 0 ORDER BY o.price, o.sort LIMIT 1) AS "cartOptionId",
  (SELECT count(*)::int FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active) AS "optionCount",
  (SELECT json_build_object('code', g.code, 'name', g.name, 'amount', pi.amount)
     FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
    WHERE pi.product_id = p.id AND pi.is_main) AS "mainIngredient",
  json_build_object('form', p.art_form, 'tone', p.art_tone) AS art,
  CASE WHEN f.id IS NOT NULL THEN '/api/v1/health/products/' || p.code || '/image' END AS "imageUrl",
  s.type AS "sellerType", s.name AS "sellerName", p.created_at AS "createdAt"`;

/** 검색 낱말이 닿는 글 — 상품 이름(제목) + 한 줄 설명 · 갈래 이름 · 성분 이름과 다른 이름(본문) */
export const SEARCH_BODY = `concat_ws(' ', p.summary, c.name,
  (SELECT string_agg(g.name || ' ' || array_to_string(coalesce(g.aliases, '{}'::text[]), ' '), ' ')
     FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code WHERE pi.product_id = p.id))`;

/** 옵션 한 줄 — 상세 · 운영 화면 */
export const OPTION_COLS = `o.id, o.months, o.price, o.stock, o.tag, o.sort, o.is_active AS "active",
  CASE WHEN o.months IS NOT NULL THEN round(o.price::numeric / o.months)::int END AS unit,
  fn_hlt_option_label(o.months, o.tag) AS label,
  (o.stock = 0) AS "soldOut"`;

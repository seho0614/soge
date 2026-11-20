import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { COMPARE_MAX, mbxSettings, PRODUCT_CODE_RE, targetType, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.502 (D273 · docs/640) 비교하기 — 대표 11/20 「㊸ ②」
 *   매물끼리 또는 상품끼리 최대 4개 나란히(GET /site/mbx/compare?type=&ids= · 로그인 없이)
 *   담는 목록은 이 브라우저(localStorage)에만 — 서버에 적지 않음(개인정보 · 기록 없음)
 *   싣는 칸은 **목록 · 상세 화면에 이미 공개된 칸만**: 매물 = 관 · 업종 · 제목 · 거래 금액 · 희망 소개비 · 부담 · 지역 · 매물번호 · 게시일 ·
 *     관심 · 조회 · 소개 신뢰도 · 등록자(회사명 또는 「개인」 · 인증 · 성사 건수) · 사진 주소 / 상품 = 소개몰 카드 칸(CARD_COLS 와 같은 뜻)
 *   싣지 않는 것: 등록자 이름 · 연락처 · 정확한 위치(좌표) · 본문 — 상세 화면에서 보면 됨
 *   게시 중이 아닌 매물 · 판매하지 않는 상품은 빼고 「빠진 것」 수만 돌려줌
 *   스위치 mbx.compare(처음 off) — 꺼지면 enabled:false · 빈 목록
 * ------------------------------------------------------------------- */

const LISTING_FIELDS = [
  ['gwanCode', '관'], ['categoryName', '업종'], ['dealAmount', '거래 금액'], ['desiredFee', '희망 소개비'], ['feeBearerLabel', '소개비 부담'],
  ['region', '지역'], ['listingNo', '매물번호'], ['publishedAt', '게시일'], ['likeCount', '관심'], ['viewCount', '조회'],
  ['trustScore', '소개 신뢰도'], ['owner', '등록자'],
] as const;
const PRODUCT_FIELDS = [
  ['category', '갈래'], ['price', '판매가'], ['listPrice', '정가'], ['offPct', '할인율'], ['minUnit', '한 달 단가(부터)'], ['mainIngredient', '주성분'],
  ['ratingAvg', '별점'], ['reviewCount', '리뷰 수'], ['soldOut', '품절'], ['sellerType', '판매 형태'], ['withdrawal', '청약철회 조건'],
] as const;

function parseIds(raw: string | undefined): string[] {
  const ids = [...new Set(String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean))];
  if (!ids.length) throw new PolicyViolation('MBX_COMPARE_IDS', '비교할 것을 하나 이상 고르십시오.');
  if (ids.length > COMPARE_MAX) throw new PolicyViolation('MBX_COMPARE_MAX', `한 번에 ${COMPARE_MAX}개까지 비교합니다.`);
  return ids;
}

/** GET /site/mbx/compare?type=LISTING|PRODUCT&ids=a,b,c,d — 고른 순서대로 */
export async function compareItems(db: DatabaseService, type: string, rawIds: string | undefined) {
  const t = targetType(type);
  const s = await mbxSettings(db);
  if (!s.compare) return { enabled: false, type: t, max: COMPARE_MAX, fields: [], items: [], missing: 0 };
  const ids = parseIds(rawIds);
  if (t === 'LISTING') {
    if (ids.some((x) => !UUID_RE.test(x))) throw new PolicyViolation('MBX_COMPARE_IDS', '매물 번호 형식이 맞지 않습니다.');
    const rows = await db.query<Record<string, unknown>>(
      `SELECT l.id, l.gwan_code AS "gwanCode", cat.name AS "categoryName", l.title, l.summary,
              l.deal_amount AS "dealAmount", l.desired_fee AS "desiredFee",
              (SELECT label FROM code_labels WHERE domain = 'fee.bearer' AND code = l.fee_bearer) AS "feeBearerLabel",
              CASE WHEN vr.sido IS NULL THEN NULL ELSE concat_ws(' ', vr.sido, vr.sigungu) END AS region,
              l.listing_no AS "listingNo", l.published_at AS "publishedAt", l.like_count AS "likeCount", l.view_count AS "viewCount",
              tr.score AS "trustScore",
              jsonb_build_object('companyName', coalesce(b.company_name, '개인'), 'verified', (b.verified_at IS NOT NULL),
                                 'confirmedDeals', coalesce(st.confirmed_deals, 0)) AS owner,
              CASE WHEN EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = l.id AND m.media_type = 'IMAGE' AND m.file_id IS NOT NULL)
                   THEN '/api/v1/listings/' || l.id || '/photos/0' END AS "thumbUrl"
         FROM listings l
         JOIN categories cat ON cat.id = l.category_id
         LEFT JOIN businesses b ON b.account_id = l.owner_account_id AND b.verified_at IS NOT NULL
         LEFT JOIN v_introducer_stats st ON st.account_id = l.owner_account_id
         LEFT JOIN v_listing_region vr ON vr.listing_id = l.id
         LEFT JOIN v_account_trust tr ON tr.account_id = l.owner_account_id
        WHERE l.id = ANY($1::uuid[]) AND l.status = 'PUBLISHED'`, [ids]);
    const by = new Map(rows.map((r) => [String(r.id), r]));
    const items = ids.map((id) => by.get(id)).filter(Boolean).map((r) => ({
      ...r!, dealAmount: r!.dealAmount == null ? null : Number(r!.dealAmount), desiredFee: r!.desiredFee == null ? null : Number(r!.desiredFee),
      trustScore: r!.trustScore == null ? null : Number(r!.trustScore) }));
    return { enabled: true, type: t, max: COMPARE_MAX, fields: LISTING_FIELDS.map(([key, label]) => ({ key, label })), items, missing: ids.length - items.length };
  }
  if (ids.some((x) => !PRODUCT_CODE_RE.test(x))) throw new PolicyViolation('MBX_COMPARE_IDS', '상품 코드 형식이 맞지 않습니다.');
  const rows = await db.query<Record<string, unknown>>(
    /* 소개몰 카드 칸(health-catalog.sql.ts CARD_COLS)과 같은 뜻 — 조각을 끼우지 않고 적어 둠(SQL 대조 검정이 읽게) */
    `SELECT p.code, p.name, p.price, p.list_price AS "listPrice", p.summary, p.badge, p.withdrawal_code AS withdrawal,
            c.name AS category, s.type AS "sellerType", s.name AS "sellerName",
            (p.stock = 0 OR p.status = 'SOLD_OUT') AS "soldOut",
            CASE WHEN p.list_price > p.price THEN round((1 - p.price::numeric / p.list_price) * 100)::int END AS "offPct",
            (SELECT min(round(o.price::numeric / o.months))::int FROM hlt_product_options o
              WHERE o.product_id = p.id AND o.is_active AND o.stock > 0 AND o.months IS NOT NULL) AS "minUnit",
            (SELECT json_build_object('code', g.code, 'name', g.name, 'amount', pi.amount)
               FROM hlt_product_ingredients pi JOIN ingredients g ON g.code = pi.ingredient_code
              WHERE pi.product_id = p.id AND pi.is_main LIMIT 1) AS "mainIngredient",
            (SELECT rs.rating_avg FROM v_hlt_review_stats rs WHERE rs.product_id = p.id) AS "ratingAvg",
            coalesce((SELECT rs.review_count FROM v_hlt_review_stats rs WHERE rs.product_id = p.id), 0) AS "reviewCount",
            CASE WHEN f.id IS NOT NULL THEN '/api/v1/health/products/' || p.code || '/image' END AS "imageUrl"
       FROM hlt_products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN hlt_sellers s ON s.id = p.seller_id
       LEFT JOIN files f ON f.id = p.image_file_id AND f.status = 'READY' AND f.purpose = 'PRODUCT_IMAGE'
      WHERE p.code = ANY($1::text[]) AND p.status IN ('ON_SALE', 'SOLD_OUT')`, [ids]);
  const by = new Map(rows.map((r) => [String(r.code), r]));
  const items = ids.map((c) => by.get(c)).filter(Boolean).map((r) => ({ ...r!, price: Number(r!.price ?? 0), listPrice: r!.listPrice == null ? null : Number(r!.listPrice) }));
  return { enabled: true, type: t, max: COMPARE_MAX, fields: PRODUCT_FIELDS.map(([key, label]) => ({ key, label })), items, missing: ids.length - items.length };
}

import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { Source, cr, dr, reverse } from '../acct/journal';

/* ---------------------------------------------------------------------
 * v10.469 (D264 · docs/607) 소개몰 할인 쿠폰 · 기획전 — 대표 11/20 「㉝」
 *   기획전 = 상품 묶음 · 기간 · 켬 — 쿠폰을 기획전 상품에만 걸 수 있음
 *   쿠폰 = 코드(영문 대문자 · 숫자 · 붙임표 4 ~ 20) · 정액(원) · 정률(1 ~ 90% · 최대 할인) · 최소 주문 · 전체 · 한 사람 한도 · 기간 · 멈춤
 *   할인 = 쿠폰이 걸린 상품 금액(기획전 쿠폰이면 그 상품만 · 아니면 주문 상품 전부)에서
 *          정액은 min(금액, 대상 금액) · 정률은 floor(대상 금액 × 비율 ÷ 100) 를 최대 할인까지 — 배송비에는 걸지 않음 · 상품 금액을 넘지 않음
 *   직판(DIRECT) 주문에만 — 입점 판매자 정산(상품 금액 기준)에 끼지 않게(회사가 부담)
 *   주문서: mall.coupon on 일 때만 couponCode 를 받음(처음 off) · 「주문 받기」(mall.order_open)가 꺼진 지금은 운영 화면 「할인 미리 셈」만
 *   쓰면 hlt_coupon_uses 한 줄(주문 하나에 하나) — 한도는 DB 가 쿠폰 줄을 잠그고 다시 셈 · 주문이 취소 · 반품되면 DB 가 되돌림(RESTORED)
 *   전표: 직판 결제 전표(MALL_SALE · 낸 금액 = 할인 뒤)가 있는 주문의 할인을 「매출할인」으로 다시 나눔
 *          MALL_DISCOUNT 차변 SALES_DISC(매출할인) / 대변 REV_MALL(과세 몫 ÷ 1.1) · REV_MALL_EXEMPT(면세 몫) — 매출 합계는 그대로 · 부가세는 낸 금액 기준(에누리)
 *          취소 · 환불(MALL_REFUND)이 생기면 MALL_DISCOUNT_CANCEL 반대 전표 — 계정 · 부가세 처리는 초안(세무사 확인)
 * ------------------------------------------------------------------- */

export const COUPON_CODE = /^[A-Z0-9-]{4,20}$/;   // DB CHECK hlt_coupons.code 와 같음(주문서 입력은 대문자로 바꾼 뒤 이 정규식)
export const COUPON_KINDS = ['FIXED', 'RATE'] as const;
export const COUPON_KIND_KO: Record<string, string> = { FIXED: '정액', RATE: '정률' };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown) => Number(v ?? 0);
const idOk = (id: string, msg = '없는 쿠폰입니다.') => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound(msg); return String(id); };

export interface CouponLine { productId: string; amount: number }
export interface CouponQuote { couponId: string; code: string; name: string; kind: string; base: number; discount: number; note: string }

interface CouponRow { id: string; code: string; name: string; kind: string; amount: string | null; rate: number | null; max_discount: string | null; min_order: string;
  total_limit: number | null; per_member_limit: number; state: string; started: boolean; ended: boolean; promotion_id: string | null; promo_live: boolean | null }

/** 쿠폰 할인 셈(쓰지 않음) — 주문서 · 운영 화면 「할인 미리 셈」이 같이 씀 · accountId 가 있으면 한 사람 한도까지 봄 */
export async function quoteCoupon(db: DatabaseService, codeIn: string, accountId: string | null, lines: CouponLine[], sellerType: string | null | undefined, opts: { ignoreSwitch?: boolean } = {}): Promise<CouponQuote> {
  if (!opts.ignoreSwitch) {
    const [sw] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'mall.coupon'`);
    if (sw?.v !== 'on') throw new PolicyViolation('COUPON_OFF', '지금은 쿠폰을 받지 않습니다.');
  }
  const code = String(codeIn ?? '').trim().toUpperCase();
  if (!COUPON_CODE.test(code)) throw new PolicyViolation('COUPON_CODE', '쿠폰 코드를 다시 확인해 주십시오.');
  const [c] = await db.query<CouponRow>(
    `SELECT c.id::text AS id, c.code, c.name, c.kind, c.amount::text AS amount, c.rate, c.max_discount::text AS max_discount, c.min_order::text AS min_order,
            c.total_limit, c.per_member_limit, c.state, now() >= c.starts_at AS started, now() >= c.ends_at AS ended, c.promotion_id::text AS promotion_id,
            (SELECT p.active AND $2::date BETWEEN p.starts_on AND p.ends_on FROM hlt_promotions p WHERE p.id = c.promotion_id) AS promo_live
       FROM hlt_coupons c WHERE c.code = $1`, [code, kstToday()]);
  if (!c) throw new PolicyViolation('COUPON_CODE', '없는 쿠폰입니다.');
  if (c.state !== 'ACTIVE' || !c.started || c.ended) throw new PolicyViolation('COUPON_PERIOD', '지금 쓸 수 있는 쿠폰이 아닙니다(기간 · 멈춤).');
  if (sellerType !== 'DIRECT') throw new PolicyViolation('COUPON_DIRECT_ONLY', '쿠폰은 직판 상품 주문에만 씁니다.');
  let target = lines;
  if (c.promotion_id) {
    if (!c.promo_live) throw new PolicyViolation('COUPON_PERIOD', '쿠폰이 걸린 기획전이 지금 열려 있지 않습니다.');
    const inPromo = new Set((await db.query<{ id: string }>(`SELECT product_id::text AS id FROM hlt_promotion_products WHERE promotion_id = $1::bigint`, [c.promotion_id])).map((x) => x.id));
    target = lines.filter((l) => inPromo.has(l.productId));
    if (!target.length) throw new PolicyViolation('COUPON_NO_ITEM', '이 쿠폰이 걸린 기획전 상품이 주문에 없습니다.');
  }
  const base = target.reduce((s, l) => s + Math.max(0, Math.floor(n(l.amount))), 0);
  if (base < n(c.min_order)) throw new PolicyViolation('COUPON_MIN_ORDER', `${n(c.min_order).toLocaleString('ko-KR')}원 이상 주문에 쓰는 쿠폰입니다.`);
  const [u] = await db.query<{ used: number; mine: number }>(
    `SELECT count(*) FILTER (WHERE state = 'USED')::int AS used, count(*) FILTER (WHERE state = 'USED' AND account_id::text = $2::text)::int AS mine
       FROM hlt_coupon_uses WHERE coupon_id = $1::bigint`, [c.id, accountId ?? '']);
  if (c.total_limit != null && n(u?.used) >= c.total_limit) throw new PolicyViolation('COUPON_LIMIT', '쿠폰이 모두 쓰였습니다.');
  if (accountId && n(u?.mine) >= c.per_member_limit) throw new PolicyViolation('COUPON_MEMBER_LIMIT', '이 쿠폰을 쓸 수 있는 횟수를 넘었습니다.');
  let discount = c.kind === 'FIXED' ? Math.min(n(c.amount), base) : Math.floor((base * n(c.rate)) / 100);
  if (c.kind === 'RATE' && c.max_discount != null) discount = Math.min(discount, n(c.max_discount));
  discount = Math.max(0, Math.min(discount, base));
  if (discount < 1) throw new PolicyViolation('COUPON_ZERO', '할인 금액이 0원입니다.');
  return { couponId: c.id, code: c.code, name: c.name, kind: c.kind, base, discount, note: `쿠폰 「${c.name}」 — ${discount.toLocaleString('ko-KR')}원 할인` };
}

/** 주문에 쿠폰 쓰기 — 주문 · 품목을 넣은 뒤 같은 트랜잭션에서(판매자가 정해진 뒤 · DB 가 한도 · 직판 · 금액을 다시 확인) */
export async function useCoupon(db: DatabaseService, q: CouponQuote, orderId: string, accountId: string) {
  await db.query(`INSERT INTO hlt_coupon_uses (coupon_id, order_id, account_id, discount) VALUES ($1::bigint, $2::uuid, $3::uuid, $4::bigint)`, [q.couponId, orderId, accountId, q.discount]);
}

/* ── 운영 화면 ── */

/** GET /admin/health/coupons — 쿠폰(쓴 수 · 되돌린 수 · 할인 합) · 기획전 · 스위치 */
export async function couponsView(db: DatabaseService) {
  const coupons = await db.query(
    `SELECT c.id::text AS id, c.code, c.name, c.kind, c.amount::bigint AS amount, c.rate, c.max_discount::bigint AS "maxDiscount", c.min_order::bigint AS "minOrder",
            c.total_limit AS "totalLimit", c.per_member_limit AS "perMemberLimit", c.starts_at AS "startsAt", c.ends_at AS "endsAt", c.state, c.memo,
            c.promotion_id::text AS "promotionId", p.title AS "promotionTitle",
            (now() >= c.starts_at AND now() < c.ends_at AND c.state = 'ACTIVE') AS live,
            (SELECT count(*)::int FROM hlt_coupon_uses u WHERE u.coupon_id = c.id AND u.state = 'USED') AS used,
            (SELECT count(*)::int FROM hlt_coupon_uses u WHERE u.coupon_id = c.id AND u.state = 'RESTORED') AS restored,
            (SELECT coalesce(sum(u.discount), 0)::bigint FROM hlt_coupon_uses u WHERE u.coupon_id = c.id AND u.state = 'USED') AS "discountSum"
       FROM hlt_coupons c LEFT JOIN hlt_promotions p ON p.id = c.promotion_id ORDER BY (now() >= c.ends_at), c.id DESC LIMIT 300`);
  const promotions = await db.query(
    `SELECT p.id::text AS id, p.title, p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", p.active, p.memo,
            (p.active AND $1::date BETWEEN p.starts_on AND p.ends_on) AS live,
            (SELECT count(*)::int FROM hlt_promotion_products x WHERE x.promotion_id = p.id) AS products
       FROM hlt_promotions p ORDER BY (p.ends_on < $1::date), p.starts_on DESC, p.id DESC LIMIT 200`, [kstToday()]);
  const [sw] = await db.query<{ coupon: string | null; open: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.coupon') AS coupon, coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') AS open`);
  return { coupons, promotions, kinds: COUPON_KIND_KO, couponOn: sw?.coupon === 'on', ordersOpen: sw?.open === 'on',
    note: '쿠폰은 직판 상품 주문에만 씁니다(입점 판매자 정산에 끼지 않음). 주문이 취소 · 반품되면 쓴 쿠폰은 저절로 되돌아갑니다.' };
}

export interface CouponIn { code: string; name: string; kind: string; amount?: number; rate?: number; maxDiscount?: number; minOrder?: number; totalLimit?: number; perMemberLimit?: number;
  startsAt: string; endsAt: string; promotionId?: string; memo?: string }
export interface CouponPatch { name?: string; amount?: number; rate?: number; maxDiscount?: number; minOrder?: number; totalLimit?: number; perMemberLimit?: number;
  startsAt?: string; endsAt?: string; state?: string; promotionId?: string; memo?: string }

const timeOk = (v: string | undefined, msg: string) => {
  const t = Date.parse(String(v ?? ''));
  if (!v || Number.isNaN(t)) throw new PolicyViolation('COUPON_PERIOD_IN', msg);
  return new Date(t).toISOString();
};
function shapeOk(kind: string, amount: unknown, rate: unknown, maxDiscount: unknown) {
  if (!(COUPON_KINDS as readonly string[]).includes(kind)) throw new PolicyViolation('COUPON_KIND', '쿠폰 종류(정액 · 정률)를 고르십시오.');
  if (kind === 'FIXED') {
    const a = Number(amount);
    if (!Number.isInteger(a) || a < 1 || a > 10_000_000) throw new PolicyViolation('COUPON_AMOUNT', '정액 할인은 1원 ~ 1천만 원 정수입니다.');
    return { amount: a, rate: null as number | null, maxDiscount: null as number | null };
  }
  const r = Number(rate);
  if (!Number.isInteger(r) || r < 1 || r > 90) throw new PolicyViolation('COUPON_RATE', '정률 할인은 1 ~ 90% 정수입니다.');
  const m = maxDiscount == null || maxDiscount === '' ? null : Number(maxDiscount);
  if (m != null && (!Number.isInteger(m) || m < 1 || m > 10_000_000)) throw new PolicyViolation('COUPON_AMOUNT', '최대 할인은 1원 ~ 1천만 원 정수입니다.');
  return { amount: null as number | null, rate: r, maxDiscount: m };
}
const intOr = (v: unknown, def: number | null, lo: number, hi: number, code: string, msg: string) => {
  if (v == null || v === '') return def;
  const x = Number(v);
  if (!Number.isInteger(x) || x < lo || x > hi) throw new PolicyViolation(code, msg);
  return x;
};
async function promoOk(db: DatabaseService, id: string | undefined | null) {
  if (!id) return null;
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 기획전입니다.');
  const [p] = await db.query(`SELECT 1 FROM hlt_promotions WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 기획전입니다.');
  return id;
}

/** POST /admin/health/coupons — 쿠폰 만들기 */
export async function createCoupon(db: DatabaseService, b: CouponIn, actor: string | null) {
  const code = String(b.code ?? '').trim();
  if (!COUPON_CODE.test(code)) throw new PolicyViolation('COUPON_CODE', '쿠폰 코드는 영문 대문자 · 숫자 · 붙임표 4 ~ 20자입니다.');
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) throw new PolicyViolation('COUPON_NAME', '쿠폰 이름은 2 ~ 60자입니다.');
  const sh = shapeOk(b.kind, b.amount, b.rate, b.maxDiscount);
  const minOrder = intOr(b.minOrder, 0, 0, 100_000_000, 'COUPON_MIN', '최소 주문은 0 ~ 1억 원 정수입니다.');
  const totalLimit = intOr(b.totalLimit, null, 1, 1_000_000, 'COUPON_LIMIT_IN', '전체 한도는 1 ~ 100만 장입니다(비우면 없음).');
  const perMember = intOr(b.perMemberLimit, 1, 1, 100, 'COUPON_LIMIT_IN', '한 사람 한도는 1 ~ 100번입니다.');
  const startsAt = timeOk(b.startsAt, '시작 시각이 바르지 않습니다.'), endsAt = timeOk(b.endsAt, '끝 시각이 바르지 않습니다.');
  if (endsAt <= startsAt) throw new PolicyViolation('COUPON_PERIOD_IN', '끝은 시작보다 뒤여야 합니다.');
  const promo = await promoOk(db, b.promotionId);
  const [dup] = await db.query(`SELECT 1 FROM hlt_coupons WHERE code = $1`, [code]);
  if (dup) throw new StateConflict('COUPON_DUP', '이미 있는 쿠폰 코드입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hlt_coupons (code, name, kind, amount, rate, max_discount, min_order, total_limit, per_member_limit, starts_at, ends_at, promotion_id, memo, created_by, updated_by)
     VALUES ($1, $2, $3, $4::bigint, $5::int, $6::bigint, $7::bigint, $8::int, $9::int, $10::timestamptz, $11::timestamptz, $12::bigint, $13, $14::uuid, $14::uuid) RETURNING id::text AS id`,
    [code, name, b.kind, sh.amount, sh.rate, sh.maxDiscount, minOrder, totalLimit, perMember, startsAt, endsAt, promo, String(b.memo ?? '').trim().slice(0, 200) || null, actor]);
  return { ok: true, id: r!.id, code, note: `쿠폰 ${code}(${name})을 만들었습니다.` };
}

/** PUT /admin/health/coupons/{id} — 보낸 칸만 고침 · 쓴 뒤에는 할인 모양(종류 · 금액 · 비율 · 최대 · 최소 주문 · 기획전)을 못 바꿈(409) · 멈춤 · 다시 씀 */
export async function updateCoupon(db: DatabaseService, idIn: string, b: CouponPatch, actor: string | null) {
  const id = idOk(idIn);
  const [c] = await db.query<{ kind: string; amount: string | null; rate: number | null; max_discount: string | null; min_order: string; total_limit: number | null; per_member_limit: number;
    starts_at: string; ends_at: string; state: string; promotion_id: string | null; name: string; memo: string | null; used: boolean }>(
    `SELECT kind, amount::text AS amount, rate, max_discount::text AS max_discount, min_order::text AS min_order, total_limit, per_member_limit, starts_at, ends_at, state,
            promotion_id::text AS promotion_id, name, memo, EXISTS (SELECT 1 FROM hlt_coupon_uses u WHERE u.coupon_id = c.id) AS used
       FROM hlt_coupons c WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 쿠폰입니다.');
  const shapeTouched = [b.amount, b.rate, b.maxDiscount, b.minOrder, b.promotionId].some((x) => x !== undefined);
  if (shapeTouched && c.used) throw new StateConflict('COUPON_USED', '이미 쓴 쿠폰은 할인 모양을 바꾸지 않습니다 — 멈추고 새 쿠폰으로.');
  const sh = shapeOk(c.kind, b.amount !== undefined ? b.amount : c.amount, b.rate !== undefined ? b.rate : c.rate, b.maxDiscount !== undefined ? b.maxDiscount : c.max_discount);
  const name = b.name === undefined ? c.name : String(b.name).replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) throw new PolicyViolation('COUPON_NAME', '쿠폰 이름은 2 ~ 60자입니다.');
  const minOrder = b.minOrder === undefined ? n(c.min_order) : intOr(b.minOrder, 0, 0, 100_000_000, 'COUPON_MIN', '최소 주문은 0 ~ 1억 원 정수입니다.');
  const totalLimit = b.totalLimit === undefined ? c.total_limit : intOr(b.totalLimit, null, 1, 1_000_000, 'COUPON_LIMIT_IN', '전체 한도는 1 ~ 100만 장입니다(비우면 없음).');
  const perMember = b.perMemberLimit === undefined ? c.per_member_limit : intOr(b.perMemberLimit, 1, 1, 100, 'COUPON_LIMIT_IN', '한 사람 한도는 1 ~ 100번입니다.');
  const startsAt = b.startsAt === undefined ? new Date(c.starts_at).toISOString() : timeOk(b.startsAt, '시작 시각이 바르지 않습니다.');
  const endsAt = b.endsAt === undefined ? new Date(c.ends_at).toISOString() : timeOk(b.endsAt, '끝 시각이 바르지 않습니다.');
  if (endsAt <= startsAt) throw new PolicyViolation('COUPON_PERIOD_IN', '끝은 시작보다 뒤여야 합니다.');
  const state = b.state === undefined ? c.state : b.state;
  if (!['ACTIVE', 'PAUSED'].includes(state)) throw new PolicyViolation('COUPON_STATE', '상태는 ACTIVE · PAUSED 입니다.');
  const promo = b.promotionId === undefined ? c.promotion_id : await promoOk(db, b.promotionId || null);
  const memo = b.memo === undefined ? c.memo : String(b.memo).trim().slice(0, 200) || null;
  await db.query(
    `UPDATE hlt_coupons SET name = $2, amount = $3::bigint, rate = $4::int, max_discount = $5::bigint, min_order = $6::bigint, total_limit = $7::int, per_member_limit = $8::int,
            starts_at = $9::timestamptz, ends_at = $10::timestamptz, state = $11, promotion_id = $12::bigint, memo = $13, updated_by = $14::uuid
      WHERE id = $1::bigint`,
    [id, name, sh.amount, sh.rate, sh.maxDiscount, minOrder, totalLimit, perMember, startsAt, endsAt, state, promo, memo, actor]);
  return { ok: true, id, state, note: state === 'PAUSED' ? '쿠폰을 멈췄습니다(쓴 기록은 그대로).' : '쿠폰을 고쳤습니다.' };
}

/** GET /admin/health/coupons/{id}/uses — 쓴 기록(주문 번호 · 가린 이름 · 할인 · 되돌림) */
export async function couponUses(db: DatabaseService, idIn: string) {
  const id = idOk(idIn);
  const [c] = await db.query<{ code: string }>(`SELECT code FROM hlt_coupons WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 쿠폰입니다.');
  const items = await db.query(
    `SELECT u.id::text AS id, o.order_no AS "orderNo", o.status AS "orderStatus", o.total::bigint AS total, u.discount::bigint AS discount, u.state,
            CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member,
            u.used_at AS "usedAt", u.restored_at AS "restoredAt", u.restore_reason AS "restoreReason"
       FROM hlt_coupon_uses u JOIN hlt_orders o ON o.id = u.order_id LEFT JOIN accounts a ON a.id = u.account_id
      WHERE u.coupon_id = $1::bigint ORDER BY u.id DESC LIMIT 300`, [id]);
  return { code: c.code, items };
}

/** POST /admin/health/coupons/quote — 할인 미리 셈(쓰지 않음 · 스위치 꺼져도 · 지금 판매가로) */
export async function quoteForAdmin(db: DatabaseService, b: { code: string; items: Array<{ productCode: string; optionId?: string; qty: number }>; accountId?: string }) {
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw new PolicyViolation('COUPON_ITEMS', '상품은 1 ~ 30줄입니다.');
  const lines: CouponLine[] = []; const sellerTypes = new Set<string>(); const shown: Array<{ productCode: string; qty: number; price: number; amount: number }> = [];
  for (const it of b.items) {
    const qty = Number(it?.qty);
    if (!it || typeof it.productCode !== 'string' || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new PolicyViolation('COUPON_ITEMS', '상품 코드 · 수량(1 ~ 99)을 다시 확인해 주십시오.');
    const [p] = await db.query<{ id: string; price: string; type: string }>(
      `SELECT p.id::text AS id, coalesce((SELECT o.price FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND ($2::text = '' OR o.id::text = $2::text) ORDER BY o.months NULLS FIRST LIMIT 1), p.price)::text AS price, s.type
         FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE p.code = $1`, [it.productCode, it.optionId ?? '']);
    if (!p) throw new NotFound(`없는 상품입니다(${String(it.productCode).slice(0, 40)}).`);
    sellerTypes.add(p.type);
    lines.push({ productId: p.id, amount: n(p.price) * qty });
    shown.push({ productCode: it.productCode, qty, price: n(p.price), amount: n(p.price) * qty });
  }
  if (sellerTypes.size > 1) throw new PolicyViolation('MIXED_SELLERS', '판매자가 다른 상품은 따로 셈합니다.');
  const accountId = b.accountId && /^[0-9a-fA-F-]{36}$/.test(b.accountId) ? b.accountId : null;
  const q = await quoteCoupon(db, b.code, accountId, lines, [...sellerTypes][0], { ignoreSwitch: true });
  const goods = lines.reduce((s, l) => s + l.amount, 0);
  return { ok: true, ...q, goods, after: goods - q.discount, lines: shown, note: `${q.note} · 상품 ${goods.toLocaleString('ko-KR')}원 → ${(goods - q.discount).toLocaleString('ko-KR')}원(배송비 따로).` };
}

/** GET /admin/health/promotions/{id} — 기획전 · 상품 */
export async function promotionDetail(db: DatabaseService, idIn: string) {
  const id = idOk(idIn, '없는 기획전입니다.');
  const [p] = await db.query(
    `SELECT id::text AS id, title, starts_on::text AS "startsOn", ends_on::text AS "endsOn", active, memo FROM hlt_promotions WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 기획전입니다.');
  const products = await db.query(
    `SELECT x.product_id::text AS id, pr.code, pr.name, pr.status, s.type AS "sellerType", x.sort
       FROM hlt_promotion_products x JOIN hlt_products pr ON pr.id = x.product_id LEFT JOIN hlt_sellers s ON s.id = pr.seller_id
      WHERE x.promotion_id = $1::bigint ORDER BY x.sort, pr.code`, [id]);
  const coupons = await db.query(`SELECT id::text AS id, code, name, state FROM hlt_coupons WHERE promotion_id = $1::bigint ORDER BY id DESC`, [id]);
  return { promotion: p, products, coupons };
}

export interface PromoIn { title: string; startsOn: string; endsOn: string; memo?: string; productCodes?: string[] }
export interface PromoPatch { title?: string; startsOn?: string; endsOn?: string; active?: boolean; memo?: string; productCodes?: string[] }

async function setPromoProducts(db: DatabaseService, id: string, codes: string[]) {
  if (!Array.isArray(codes) || codes.length > 200) throw new PolicyViolation('PROMO_PRODUCTS', '기획전 상품은 200개까지입니다.');
  const uniq = [...new Set(codes.map((c) => String(c ?? '').trim()).filter(Boolean))];
  const found = uniq.length ? await db.query<{ id: string; code: string; type: string | null }>(
    `SELECT p.id::text AS id, p.code, s.type FROM hlt_products p LEFT JOIN hlt_sellers s ON s.id = p.seller_id WHERE p.code = ANY($1::text[])`, [uniq]) : [];
  const miss = uniq.filter((c) => !found.some((f) => f.code === c));
  if (miss.length) throw new PolicyViolation('PROMO_PRODUCTS', `없는 상품 코드: ${miss.slice(0, 5).join(', ')}`);
  await db.query(`DELETE FROM hlt_promotion_products WHERE promotion_id = $1::bigint`, [id]);
  for (const [i, code] of uniq.entries()) {
    await db.query(`INSERT INTO hlt_promotion_products (promotion_id, product_id, sort) VALUES ($1::bigint, $2::uuid, $3::int)`, [id, found.find((f) => f.code === code)!.id, i]);
  }
  return { count: uniq.length, notDirect: found.filter((f) => f.type !== 'DIRECT').length };
}

/** POST /admin/health/promotions — 기획전 만들기(상품 코드 목록은 선택) */
export async function createPromotion(db: DatabaseService, b: PromoIn, actor: string | null) {
  const title = String(b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 60) throw new PolicyViolation('PROMO_TITLE', '기획전 이름은 2 ~ 60자입니다.');
  if (!YMD.test(b.startsOn ?? '') || !YMD.test(b.endsOn ?? '') || b.endsOn < b.startsOn) throw new PolicyViolation('PROMO_DATE', '기간(시작 ≤ 끝)을 다시 확인해 주십시오.');
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO hlt_promotions (title, starts_on, ends_on, memo, created_by) VALUES ($1, $2::date, $3::date, $4, $5::uuid) RETURNING id::text AS id`,
      [title, b.startsOn, b.endsOn, String(b.memo ?? '').trim().slice(0, 200) || null, actor]);
    const pr = b.productCodes ? await setPromoProducts(db, r!.id, b.productCodes) : { count: 0, notDirect: 0 };
    return { ok: true, id: r!.id, products: pr.count, notDirect: pr.notDirect,
             note: pr.notDirect ? `기획전 「${title}」을 만들었습니다(상품 ${pr.count}개 · 입점 상품 ${pr.notDirect}개는 쿠폰 할인 없음).` : `기획전 「${title}」을 만들었습니다(상품 ${pr.count}개).` };
  });
}

/** PUT /admin/health/promotions/{id} — 이름 · 기간 · 켬 · 메모 · 상품 목록(보내면 통째로 바꿈) */
export async function updatePromotion(db: DatabaseService, idIn: string, b: PromoPatch) {
  const id = idOk(idIn, '없는 기획전입니다.');
  const [p] = await db.query<{ title: string; starts_on: string; ends_on: string; active: boolean; memo: string | null }>(
    `SELECT title, starts_on::text AS starts_on, ends_on::text AS ends_on, active, memo FROM hlt_promotions WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 기획전입니다.');
  const title = b.title === undefined ? p.title : String(b.title).replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 60) throw new PolicyViolation('PROMO_TITLE', '기획전 이름은 2 ~ 60자입니다.');
  const s = b.startsOn === undefined ? p.starts_on : b.startsOn, e = b.endsOn === undefined ? p.ends_on : b.endsOn;
  if (!YMD.test(s) || !YMD.test(e) || e < s) throw new PolicyViolation('PROMO_DATE', '기간(시작 ≤ 끝)을 다시 확인해 주십시오.');
  const active = b.active === undefined ? p.active : !!b.active;
  const memo = b.memo === undefined ? p.memo : String(b.memo).trim().slice(0, 200) || null;
  return db.transaction(async () => {
    await db.query(`UPDATE hlt_promotions SET title = $2, starts_on = $3::date, ends_on = $4::date, active = $5, memo = $6, updated_at = now() WHERE id = $1::bigint`, [id, title, s, e, active, memo]);
    const pr = b.productCodes !== undefined ? await setPromoProducts(db, id, b.productCodes) : null;
    return { ok: true, id, products: pr?.count ?? null, note: pr ? `기획전을 고쳤습니다(상품 ${pr.count}개).` : '기획전을 고쳤습니다.' };
  });
}

/* ── 전표(정기 작업 acct_journal · sources.ts 끝에 덧붙임) — 계정 초안(세무사 확인) ── */
function discountLines(amount: number, exempt: number) {
  const ex = Math.max(0, Math.min(amount, exempt));
  const taxSupply = Math.round((amount - ex) / 1.1);   // 과세 몫은 부가세를 뺀 공급가만 다시 나눔(부가세는 낸 금액 기준 그대로)
  return [dr('SALES_DISC', ex + taxSupply), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(taxSupply > 0 ? [cr('REV_MALL', taxSupply)] : [])];
}
export const COUPON_SOURCES: Source[] = [
  {
    name: 'MALL_DISCOUNT', label: '소개몰 쿠폰 할인(매출할인)',
    sql: `SELECT p.id::text AS key, o.discount_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 (coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * o.discount_amount / nullif(o.goods_amount, 0))::bigint AS exempt, p.approved_at AS at
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.discount_amount > 0 AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_DISCOUNT' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 쿠폰 할인 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG', lines: discountLines(n(r.amount), n(r.exempt)) }),
  },
  {
    name: 'MALL_DISCOUNT_CANCEL', label: '소개몰 쿠폰 할인 되돌림(취소 · 환불)',
    sql: `SELECT p.id::text AS key, o.discount_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 (coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * o.discount_amount / nullif(o.goods_amount, 0))::bigint AS exempt, p.canceled_at AS at
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.discount_amount > 0 AND p.canceled_at IS NOT NULL AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_REFUND' AND e.source_key = p.id::text)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_DISCOUNT' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_DISCOUNT_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.canceled_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 쿠폰 할인 되돌림 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG', lines: reverse(discountLines(n(r.amount), n(r.exempt))) }),
  },
];

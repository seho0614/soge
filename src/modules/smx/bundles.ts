import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { BUNDLE_CODE_RE, SMX_KEYS, smxNum, smxOn } from './common';
import { SmxBundleSaveDto } from './smx.dto';

/* ---------------------------------------------------------------------
 * v10.553 (D287 · docs/691) ① 묶음(세트) 할인
 *   운영   목록 · 만들기 · 고치기 · 판매 시작 · 멈춤(구성은 판매 중이 아닐 때만 — DB 가 막음)
 *   공개   판매 중 묶음 목록 · 하나(smx.bundle off 면 on:false · 빈 목록)
 *   주문   health-checkout.service.ts 의 order() 에서 smxBundleQuote → (주문 머리) → smxBundleInsert
 *          · 구성 옵션마다 주문 품목 한 줄(재고 빼기 · 취소 · 반품 되돌림은 기존 트리거 그대로)
 *          · 단가 = 묶음가를 구성 정가 비율로 나눈 값(원 단위 아래 버림) · 나머지는 수량 1 인 구성 줄에(판매 시작 때 DB 가 그런 줄이 있는지 봄)
 *          · 쿠폰과 함께 씀(대표 11/21) — 쿠폰 대상 금액은 묶음가 기준(구성 품목의 나눈 금액 · couponLines) · 할인 ≤ 상품 금액(DB CHECK) · 적립금 · 상품권은 그대로
 *   반품   소개몰 취소 · 반품 · 교환은 주문 통째라 묶음이 쪼개지지 않음(묶음 단위)
 * ------------------------------------------------------------------- */

export interface SmxBundlePart { productId: string; optionId: string; qty: number; unitPrice: number; amount: number; withdrawalCode: string }
export interface SmxBundleLine { bundleId: string; code: string; name: string; qty: number; unitPrice: number; amount: number; listAmount: number; parts: SmxBundlePart[] }
export interface SmxBundleQuote { lines: SmxBundleLine[]; goods: number; productIds: string[]; couponLines: Array<{ productId: string; amount: number }> }

interface CompRow { bundleId: string; code: string; name: string; price: string; state: string; maxPerOrder: number; optionId: string | null; productId: string | null;
  qty: number | null; optPrice: string | null; stock: number | null; optActive: boolean | null; productStatus: string | null; productName: string | null; withdrawalCode: string | null; sellerType: string | null }

/** 주문에 묶음이 있나(주문 입력 검사 전에 씀) */
export function smxHasBundles(d: { bundles?: unknown }): boolean {
  return Array.isArray(d?.bundles) && d.bundles.length > 0;
}

/**
 * 주문할 묶음을 셈 — 스위치 · 코드 · 수량 · 판매 중 · 한 번에 살 수 있는 수 · 품절(같은 옵션을 여러 묶음이 쓰면 합쳐 셈) · 단가 나눔.
 * 묶음이 없으면 빈 결과(주문 흐름은 앞 판과 같음).
 */
export async function smxBundleQuote(db: DatabaseService, d: { bundles?: unknown }): Promise<SmxBundleQuote> {
  if (!smxHasBundles(d)) return { lines: [], goods: 0, productIds: [], couponLines: [] };
  if (!(await smxOn(db, SMX_KEYS.bundle))) throw new PolicyViolation('SMX_BUNDLE_OFF', '지금은 묶음 할인 상품을 팔지 않습니다.');
  const asked = (d.bundles as Array<{ code?: unknown; qty?: unknown }>);
  if (asked.length > 10) throw new PolicyViolation('SMX_BUNDLE_ITEM', '묶음은 한 주문에 열 가지까지 담을 수 있습니다.');
  const want = new Map<string, number>();
  for (const a of asked) {
    const code = String(a?.code ?? '');
    const qty = Number(a?.qty);
    if (!BUNDLE_CODE_RE.test(code) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new PolicyViolation('SMX_BUNDLE_ITEM', '묶음(코드 · 수량 1 ~ 20)을 다시 확인해 주십시오.');
    }
    if (want.has(code)) throw new PolicyViolation('SMX_BUNDLE_ITEM', '같은 묶음이 두 번 들어 있습니다.');
    want.set(code, qty);
  }
  const rows = await db.query<CompRow>(
    `SELECT b.id AS "bundleId", b.code, b.name, b.price::text AS price, b.state, b.max_per_order AS "maxPerOrder",
            bi.option_id AS "optionId", bi.product_id AS "productId", bi.qty, o.price::text AS "optPrice", o.stock, o.is_active AS "optActive",
            p.status AS "productStatus", p.name AS "productName", p.withdrawal_code AS "withdrawalCode", s.type AS "sellerType"
       FROM hlt_bundles b
       LEFT JOIN hlt_bundle_items bi ON bi.bundle_id = b.id
       LEFT JOIN hlt_product_options o ON o.id = bi.option_id
       LEFT JOIN hlt_products p ON p.id = bi.product_id
       LEFT JOIN hlt_sellers s ON s.id = p.seller_id
      WHERE b.code = ANY($1::text[])
      ORDER BY b.code, (bi.qty = 1) DESC, bi.sort, bi.id`, [[...want.keys()]]);
  const need = new Map<string, { stock: number; need: number; name: string }>();
  const lines: SmxBundleLine[] = [];
  for (const [code, qty] of want) {
    const comps = rows.filter((r) => r.code === code);
    const head = comps[0];
    if (!head || head.state !== 'ON_SALE') throw new PolicyViolation('SMX_BUNDLE_NOT_ON_SALE', `판매 중인 묶음이 아닙니다 — ${code}`);
    if (qty > Number(head.maxPerOrder)) throw new PolicyViolation('SMX_BUNDLE_QTY', `이 묶음은 한 주문에 ${head.maxPerOrder}개까지 살 수 있습니다 — ${head.name}`);
    const parts = comps.filter((c) => c.optionId);
    if (parts.length < 2) throw new PolicyViolation('SMX_BUNDLE_NOT_ON_SALE', `판매 중인 묶음이 아닙니다 — ${code}`);
    for (const c of parts) {
      if (c.sellerType !== 'DIRECT') throw new PolicyViolation('SMX_BUNDLE_NOT_ON_SALE', `판매 중인 묶음이 아닙니다 — ${code}`);
      if (c.productStatus !== 'ON_SALE' || !c.optActive) throw new PolicyViolation('SMX_BUNDLE_SOLD_OUT', `품절된 구성 상품이 있어 묶음을 살 수 없습니다 — ${head.name}`);
      const k = String(c.optionId);
      const cur = need.get(k) ?? { stock: Number(c.stock ?? 0), need: 0, name: head.name };
      cur.need += Number(c.qty) * qty;
      need.set(k, cur);
    }
    /* 단가 나눔 — 구성 1개당 u_i = ⌊P × 정가_i ÷ Σ(정가 × 구성 수량)⌋ · 나머지는 수량 1 인 첫 줄(정렬로 맨 앞) */
    const price = Number(head.price);
    const list = parts.reduce((a, c) => a + Number(c.optPrice) * Number(c.qty), 0);
    if (!(list > 0)) throw new PolicyViolation('SMX_BUNDLE_NOT_ON_SALE', `판매 중인 묶음이 아닙니다 — ${code}`);
    const unit = parts.map((c) => Math.floor((price * Number(c.optPrice)) / list));
    const used = parts.reduce((a, c, i) => a + unit[i] * Number(c.qty), 0);
    const one = parts.findIndex((c) => Number(c.qty) === 1);
    if (one < 0) throw new PolicyViolation('SMX_BUNDLE_NOT_ON_SALE', `판매 중인 묶음이 아닙니다 — ${code}`);
    unit[one] += price - used;
    lines.push({
      bundleId: head.bundleId, code, name: head.name, qty, unitPrice: price, amount: price * qty, listAmount: list,
      parts: parts.map((c, i) => ({ productId: String(c.productId), optionId: String(c.optionId), qty: Number(c.qty) * qty, unitPrice: unit[i],
        amount: unit[i] * Number(c.qty) * qty, withdrawalCode: String(c.withdrawalCode ?? '') })),
    });
  }
  for (const v of need.values()) {
    if (v.need > v.stock) throw new PolicyViolation('SMX_BUNDLE_SOLD_OUT', `품절된 구성 상품이 있어 묶음을 살 수 없습니다 — ${v.name}`);
  }
  const productIds = [...new Set(lines.flatMap((l) => l.parts.map((p) => p.productId)))];
  /* 쿠폰 대상 금액 = 구성 품목의 나눈 금액(묶음가 기준 · 정가 아님) — 기획전 쿠폰은 상품 번호로 거름(quoteCoupon) */
  const couponLines = lines.flatMap((l) => l.parts.map((p) => ({ productId: p.productId, amount: p.amount })));
  return { lines, goods: lines.reduce((a, l) => a + l.amount, 0), productIds, couponLines };
}

/** 주문 머리를 넣은 뒤 — 묶음 줄 · 구성 품목(재고 확인 · 빼기 · 옵션 이름 복사는 기존 트리거) · 금액 합은 거래 끝에 DB 가 다시 셈 */
export async function smxBundleInsert(db: DatabaseService, orderId: string, q: SmxBundleQuote): Promise<void> {
  for (const l of q.lines) {
    const [ob] = await db.query<{ id: string }>(
      `INSERT INTO hlt_order_bundles (order_id, bundle_id, code, name, qty, unit_price, amount, list_amount)
       VALUES ($1, $2, $3, $4, $5::int, $6::bigint, $7::bigint, $8::bigint) RETURNING id`,
      [orderId, l.bundleId, l.code, l.name, l.qty, l.unitPrice, l.amount, l.listAmount]);
    for (const p of l.parts) {
      await db.query(
        `INSERT INTO hlt_order_items (order_id, product_id, option_id, qty, unit_price, amount, withdrawal_code, bundle_line_id)
         VALUES ($1, $2, $3, $4::int, $5::bigint, $6::bigint, $7, $8)`,
        [orderId, p.productId, p.optionId, p.qty, p.unitPrice, p.amount, p.withdrawalCode, ob.id]);
    }
  }
}

/** 주문 응답에 붙이는 묶음 요약 */
export function smxBundleView(q: SmxBundleQuote) {
  return q.lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, listAmount: l.listAmount * l.qty }));
}

/* ── 공개 ── */

/** GET /health/bundles — 판매 중 묶음(품절 표시 · 구성 · 정가 합) */
export async function bundlesPublic(db: DatabaseService) {
  const on = await smxOn(db, SMX_KEYS.bundle);
  if (!on) return { on: false, items: [] as unknown[] };
  const rows = await db.query<Record<string, unknown>>(
    `SELECT b.code, b.name, b.summary, b.price, b.max_per_order AS "maxPerOrder", v.can_make AS "canMake", (v.can_make = 0) AS "soldOut", v.list_amount AS "listAmount",
            (SELECT coalesce(json_agg(json_build_object('code', p.code, 'name', p.name, 'optionLabel', fn_hlt_option_label(o.months, o.tag), 'qty', bi.qty,
                    'imageUrl', CASE WHEN p.image_file_id IS NOT NULL THEN '/api/v1/health/products/' || p.code || '/image' END) ORDER BY bi.sort, bi.id), '[]'::json)
               FROM hlt_bundle_items bi JOIN hlt_products p ON p.id = bi.product_id JOIN hlt_product_options o ON o.id = bi.option_id
              WHERE bi.bundle_id = b.id) AS parts
       FROM hlt_bundles b JOIN v_hlt_bundle_stock v ON v.bundle_id = b.id
      WHERE b.state = 'ON_SALE'
      ORDER BY (v.can_make = 0), b.started_at DESC NULLS LAST, b.code
      LIMIT 100`);
  return { on: true, items: rows.map((r) => ({ ...r, price: smxNum(r.price), listAmount: smxNum(r.listAmount), canMake: smxNum(r.canMake) })) };
}

/** GET /health/bundles/{code} */
export async function bundlePublic(db: DatabaseService, code: string) {
  if (!BUNDLE_CODE_RE.test(code)) throw new NotFound('없는 묶음입니다.');
  const all = await bundlesPublic(db);
  const one = (all.items as Array<{ code: string }>).find((x) => x.code === code);
  if (!one) throw new NotFound('없는 묶음입니다.');
  return one;
}

/* ── 운영 ── */

/** GET /admin/smx/bundles — 모든 묶음 · 구성 · 재고 · 정가 합 · 할인율 · 판매 시작 전 막힘 까닭 */
export async function bundlesAdmin(db: DatabaseService) {
  const on = await smxOn(db, SMX_KEYS.bundle);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT b.id, b.code, b.name, b.summary, b.price, b.state, b.max_per_order AS "maxPerOrder", b.started_at AS "startedAt", b.updated_at AS "updatedAt",
            v.lines, v.can_make AS "canMake", v.list_amount AS "listAmount",
            (SELECT count(*)::int FROM hlt_order_bundles ob WHERE ob.bundle_id = b.id) AS orders,
            (SELECT coalesce(json_agg(json_build_object('optionId', bi.option_id, 'qty', bi.qty, 'code', p.code, 'name', p.name,
                    'optionLabel', fn_hlt_option_label(o.months, o.tag), 'price', o.price, 'stock', o.stock, 'onSale', (p.status = 'ON_SALE' AND o.is_active),
                    'direct', (s.type = 'DIRECT')) ORDER BY bi.sort, bi.id), '[]'::json)
               FROM hlt_bundle_items bi JOIN hlt_products p ON p.id = bi.product_id JOIN hlt_product_options o ON o.id = bi.option_id LEFT JOIN hlt_sellers s ON s.id = p.seller_id
              WHERE bi.bundle_id = b.id) AS items
       FROM hlt_bundles b JOIN v_hlt_bundle_stock v ON v.bundle_id = b.id
      ORDER BY (b.state = 'ON_SALE') DESC, b.updated_at DESC
      LIMIT 200`);
  const items = rows.map((r) => {
    const price = smxNum(r.price), list = smxNum(r.listAmount);
    const comps = (r.items as Array<{ qty: number; direct: boolean }>) ?? [];
    const blocks: string[] = [];
    if (comps.length < 2) blocks.push('구성 두 줄 이상');
    if (!comps.some((c) => Number(c.qty) === 1)) blocks.push('수량 1 인 구성 줄');
    if (comps.some((c) => !c.direct)) blocks.push('직판 상품만');
    return { ...r, price, listAmount: list, canMake: smxNum(r.canMake), discountRate: list > 0 ? Math.round(((list - price) * 1000) / list) / 10 : 0,
      overList: price > list, startBlocks: blocks };
  });
  return { on, items, note: on ? '묶음 판매가 켜져 있습니다 — 판매 중 묶음은 공개 목록 · 주문에 보입니다.' : '묶음 판매가 꺼져 있습니다(smx.bundle) — 만들어 두기만 하고 공개 · 주문에는 보이지 않습니다.' };
}

/** 옵션 번호들이 직판 상품 옵션인지(DB 도 막지만 먼저 알아듣기 쉬운 글로) */
async function checkOptions(db: DatabaseService, items: SmxBundleSaveDto['items']) {
  const ids = items.map((i) => i.optionId);
  if (new Set(ids).size !== ids.length) throw new PolicyViolation('SMX_BUNDLE_ITEM', '같은 옵션이 두 번 들어 있습니다.');
  const ok = await db.query<{ id: string }>(
    `SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
      WHERE o.id = ANY($1::uuid[])`, [ids]);
  if (ok.length !== ids.length) throw new PolicyViolation('SMX_BUNDLE_ITEM', '묶음에는 소개몰 직판 상품의 옵션만 넣을 수 있습니다.');
}

/** POST /admin/smx/bundles — 초안으로 만듦 */
export async function bundleCreate(db: DatabaseService, dto: SmxBundleSaveDto) {
  return db.transaction(async () => {
    await checkOptions(db, dto.items);
    const [dup] = await db.query<{ id: string }>(`SELECT id FROM hlt_bundles WHERE code = $1`, [dto.code]);
    if (dup) throw new StateConflict('SMX_BUNDLE_DUP', '이미 있는 묶음 코드입니다.');
    const [b] = await db.query<{ id: string }>(
      `INSERT INTO hlt_bundles (code, name, summary, price, max_per_order, created_by) VALUES ($1, $2, $3, $4::bigint, $5::int, $6) RETURNING id`,
      [dto.code, dto.name.trim(), dto.summary?.trim() || null, dto.price, dto.maxPerOrder ?? 5, RequestCtx.actorId() ?? null]);
    let i = 0;
    for (const it of dto.items) {
      await db.query(`INSERT INTO hlt_bundle_items (bundle_id, product_id, option_id, qty, sort)
                      SELECT $1, o.product_id, o.id, $3::int, $4::int FROM hlt_product_options o WHERE o.id = $2`, [b.id, it.optionId, it.qty, i++]);
    }
    return { id: b.id, state: 'DRAFT', note: '묶음을 초안으로 만들었습니다 — 「판매 시작」을 눌러야 팝니다.' };
  });
}

/** PUT /admin/smx/bundles/{id} — 이름 · 설명 · 값 · 한 번에 살 수 있는 수는 늘 · 구성은 판매 중이 아닐 때만(바뀌었을 때만 다시 넣음) */
export async function bundleUpdate(db: DatabaseService, id: string, dto: SmxBundleSaveDto) {
  return db.transaction(async () => {
    const [b] = await db.query<{ id: string; code: string; state: string }>(`SELECT id, code, state FROM hlt_bundles WHERE id = $1 FOR UPDATE`, [id]);
    if (!b) throw new NotFound('없는 묶음입니다.');
    if (dto.code !== b.code && b.state !== 'DRAFT') throw new StateConflict('SMX_BUNDLE_CODE', '판매를 시작했던 묶음의 코드는 바꿀 수 없습니다.');
    const cur = await db.query<{ option_id: string; qty: number }>(`SELECT option_id, qty FROM hlt_bundle_items WHERE bundle_id = $1 ORDER BY sort, id`, [id]);
    const same = cur.length === dto.items.length && cur.every((c, i) => c.option_id === dto.items[i].optionId && Number(c.qty) === dto.items[i].qty);
    if (!same) {
      if (b.state === 'ON_SALE') throw new StateConflict('SMX_BUNDLE_ON_SALE', '판매 중인 묶음의 구성은 바꿀 수 없습니다 — 먼저 판매를 멈추십시오.');
      await checkOptions(db, dto.items);
    }
    if (dto.code !== b.code) {
      const [dup] = await db.query<{ id: string }>(`SELECT id FROM hlt_bundles WHERE code = $1 AND id <> $2`, [dto.code, id]);
      if (dup) throw new StateConflict('SMX_BUNDLE_DUP', '이미 있는 묶음 코드입니다.');
    }
    await db.query(`UPDATE hlt_bundles SET code = $2, name = $3, summary = $4, price = $5::bigint, max_per_order = $6::int WHERE id = $1`,
      [id, dto.code, dto.name.trim(), dto.summary?.trim() || null, dto.price, dto.maxPerOrder ?? 5]);
    if (!same) {
      await db.query(`DELETE FROM hlt_bundle_items WHERE bundle_id = $1`, [id]);
      let i = 0;
      for (const it of dto.items) {
        await db.query(`INSERT INTO hlt_bundle_items (bundle_id, product_id, option_id, qty, sort)
                        SELECT $1, o.product_id, o.id, $3::int, $4::int FROM hlt_product_options o WHERE o.id = $2`, [id, it.optionId, it.qty, i++]);
      }
    }
    return { id, state: b.state, note: same ? '고쳤습니다(값은 새 주문부터).' : '구성까지 고쳤습니다.' };
  });
}

/** POST /admin/smx/bundles/{id}/state — 판매 시작 · 다시 판매 · 멈춤(조건은 DB 트리거가 다시 봄) */
export async function bundleState(db: DatabaseService, id: string, state: 'ON_SALE' | 'STOPPED') {
  return db.transaction(async () => {
    const [b] = await db.query<{ id: string; state: string }>(`SELECT id, state FROM hlt_bundles WHERE id = $1 FOR UPDATE`, [id]);
    if (!b) throw new NotFound('없는 묶음입니다.');
    if (b.state === state) throw new StateConflict('SMX_BUNDLE_SAME', state === 'ON_SALE' ? '이미 판매 중입니다.' : '이미 멈춘 묶음입니다.');
    if (state === 'STOPPED' && b.state === 'DRAFT') throw new StateConflict('SMX_BUNDLE_DRAFT', '판매를 시작하지 않은 초안입니다.');
    await db.query(`UPDATE hlt_bundles SET state = $2 WHERE id = $1`, [id, state]);
    return { id, state, note: state === 'ON_SALE' ? '판매를 시작했습니다 — 묶음 판매 스위치(smx.bundle)가 켜져 있어야 공개됩니다.' : '판매를 멈췄습니다.' };
  });
}

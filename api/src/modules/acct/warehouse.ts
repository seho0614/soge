/* e3 (docs/010) 소개뱅크 src/modules/acct/warehouse.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.435 (D256 · docs/572) 창고 여러 곳 · 재고 이동 · 바코드
 *   이동평균 원가는 회사 전체(옵션마다 · ⑫ acct_stock_moves) 그대로 — 창고는 수량만 나눔.
 *   수불부 창고 빈 줄(옛 줄 · 결제 자동 출고) = 본 창고. 창고 간 이동 = acct_stock_transfers(쌓기만 · 원가 전표 없음).
 *   창고 입고 · 창고 실사는 수불부에 창고를 적어 넣음(IN · ADJUST → 원가 · 전표는 ⑫ 그대로).
 *   바코드 = 직판 옵션마다 글자 하나(Code128 · 화면에서 SVG 그림) — 한 번 정하면 바꾸지 않음.
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

async function mainWh(db: DatabaseService) {
  const [m] = await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_warehouses WHERE is_main LIMIT 1`);
  if (!m) throw new NotFound('본 창고가 없습니다.');
  return m.id;
}
async function whOf(db: DatabaseService, id: string) {
  const [w] = await db.query<{ id: string; name: string; active: boolean }>(`SELECT id::text AS id, name, active FROM acct_warehouses WHERE id::text = $1`, [String(id ?? '')]);
  if (!w) throw new NotFound('없는 창고입니다.');
  return w;
}
async function directOption(db: DatabaseService, optionId: string) {
  const [o] = await db.query<{ id: string; code: string; name: string; label: string; sort: number }>(
    `SELECT o.id::text AS id, p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label, coalesce(o.sort, 0) AS sort
       FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
      WHERE o.id::text = $1`, [String(optionId ?? '')]);
  if (!o) throw new NotFound('직판 상품 옵션이 아닙니다.');
  return o;
}
/** 그 창고 · 옵션 지금 수량(잠금 안에서 부름) */
async function whQty(db: DatabaseService, optionId: string, whId: string) {
  const [r] = await db.query<{ q: number }>(`SELECT coalesce(sum(qty), 0)::int AS q FROM v_acct_wh_stock WHERE option_id::text = $1 AND wh_id::text = $2`, [optionId, whId]);
  return n(r?.q);
}

/** GET /admin/acct/warehouses — 창고 · 창고별 재고 합 */
export async function listWarehouses(db: DatabaseService) {
  const items = await db.query(
    `SELECT w.id::text AS id, w.code, w.name, w.address, w.is_main AS "isMain", w.active,
            coalesce((SELECT sum(s.qty) FROM v_acct_wh_stock s WHERE s.wh_id = w.id), 0)::int AS qty,
            (SELECT count(*) FROM v_acct_wh_stock s WHERE s.wh_id = w.id AND s.qty <> 0)::int AS options
       FROM acct_warehouses w ORDER BY w.is_main DESC, w.code`);
  return { items, note: '수량은 원가 장부(수불부) 기준입니다 — 결제 자동 출고 · 옛 줄은 본 창고에서 나간 것으로 셉니다.' };
}
export async function addWarehouse(db: DatabaseService, b: { code: string; name: string; address?: string }) {
  const code = (b.code ?? '').trim().toUpperCase(), name = (b.name ?? '').trim();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new PolicyViolation('ACCT_WH', '창고 코드는 대문자 · 숫자 · 밑줄 · 붙임표 2 ~ 20자입니다.');
  if (name.length < 1 || name.length > 60) throw new PolicyViolation('ACCT_WH', '창고 이름은 1 ~ 60자입니다.');
  const [dup] = await db.query(`SELECT 1 FROM acct_warehouses WHERE code = $1`, [code]);
  if (dup) throw new PolicyViolation('ACCT_WH_DUP', '이미 있는 창고 코드입니다.');
  const [r] = await db.query<{ id: string }>(`INSERT INTO acct_warehouses (code, name, address) VALUES ($1, $2, nullif($3, '')) RETURNING id::text AS id`, [code, name, (b.address ?? '').trim().slice(0, 200)]);
  return { ok: true, id: r!.id, note: '창고를 더했습니다.' };
}
export async function updateWarehouse(db: DatabaseService, id: string, b: { name?: string; address?: string; active?: boolean }) {
  const w = await whOf(db, id);
  if (b.active === false) {
    const [m] = await db.query<{ main: boolean }>(`SELECT is_main AS main FROM acct_warehouses WHERE id::text = $1`, [id]);
    if (m?.main) throw new PolicyViolation('ACCT_WH', '본 창고는 끌 수 없습니다.');
    const [q] = await db.query<{ q: number }>(`SELECT coalesce(sum(qty), 0)::int AS q FROM v_acct_wh_stock WHERE wh_id::text = $1 AND qty <> 0`, [id]);
    if (n(q?.q) !== 0) throw new StateConflict('ACCT_WH_STOCK', '재고가 남은 창고는 끌 수 없습니다(다른 창고로 옮긴 뒤).');
  }
  await db.query(`UPDATE acct_warehouses SET name = coalesce(nullif(btrim($2), ''), name), address = coalesce($3, address), active = coalesce($4, active) WHERE id::text = $1`,
    [id, (b.name ?? '').slice(0, 60), b.address == null ? null : b.address.trim().slice(0, 200), typeof b.active === 'boolean' ? b.active : null]);
  return { ok: true, id: w.id, note: '창고를 고쳤습니다.' };
}

/** GET /admin/acct/warehouses/stock?wh= — 옵션 × 창고 수량 · 회사 전체 평균 단가 */
export async function whStock(db: DatabaseService, wh?: string) {
  const whs = await db.query<{ id: string; code: string; name: string }>(`SELECT id::text AS id, code, name FROM acct_warehouses WHERE active ORDER BY is_main DESC, code`);
  const rows = await db.query<{ optionId: string; code: string; name: string; label: string; whId: string; qty: number; avgCost: number; barcode: string | null }>(
    `SELECT o.id::text AS "optionId", p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label, s.wh_id::text AS "whId", s.qty,
            coalesce((SELECT m.avg_cost_after FROM acct_stock_moves m WHERE m.option_id = o.id ORDER BY m.id DESC LIMIT 1), 0)::float8 AS "avgCost",
            (SELECT b.code FROM acct_barcodes b WHERE b.option_id = o.id) AS barcode
       FROM v_acct_wh_stock s JOIN svc.hlt_product_options o ON o.id = s.option_id JOIN svc.hlt_products p ON p.id = o.product_id
      WHERE ($1::text IS NULL OR s.wh_id::text = $1)
      ORDER BY p.name, o.sort, s.wh_id`, [/^\d{1,18}$/.test(wh ?? '') ? wh : null]);
  const box = new Map<string, { optionId: string; code: string; name: string; label: string; avgCost: number; barcode: string | null; byWh: Record<string, number>; total: number }>();
  for (const r of rows) {
    const b = box.get(r.optionId) ?? (box.set(r.optionId, { optionId: r.optionId, code: r.code, name: r.name, label: r.label, avgCost: n(r.avgCost), barcode: r.barcode, byWh: {}, total: 0 }), box.get(r.optionId)!);
    b.byWh[r.whId] = n(r.qty); b.total += n(r.qty);
  }
  return { warehouses: whs, items: [...box.values()] };
}

/** POST /admin/acct/warehouses/transfer — 창고 간 이동(원가 전표 없음 · 보내는 창고 수량 넘지 못함) */
export async function transferStock(db: DatabaseService, b: { optionId: string; fromWh: string; toWh: string; qty: number; movedOn?: string; note?: string }, actor: string | null) {
  const o = await directOption(db, b.optionId);
  const qty = Math.round(Number(b.qty));
  if (!(qty > 0 && qty <= 1_000_000)) throw new PolicyViolation('ACCT_WH', '옮길 수량은 1 이상입니다.');
  if (String(b.fromWh) === String(b.toWh)) throw new PolicyViolation('ACCT_WH', '같은 창고로는 옮기지 않습니다.');
  const from = await whOf(db, b.fromWh), to = await whOf(db, b.toWh);
  if (!to.active) throw new PolicyViolation('ACCT_WH', '쓰지 않는 창고로는 옮기지 않습니다.');
  const day = b.movedOn || kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > kstToday()) throw new PolicyViolation('ACCT_WH', '옮긴 날짜는 오늘까지입니다.');
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_stock:' || $1::text))`, [o.id]);
    const have = await whQty(db, o.id, from.id);
    if (have < qty) throw new StateConflict('ACCT_WH_STOCK', `보내는 창고 수량이 모자랍니다(지금 {0}개).`.replace('{0}', String(have)));
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_stock_transfers (option_id, from_wh, to_wh, qty, moved_on, note, created_by) VALUES ($1::uuid, $2::bigint, $3::bigint, $4, $5::date, nullif($6, ''), $7) RETURNING id::text AS id`,
      [o.id, from.id, to.id, qty, day, (b.note ?? '').trim().slice(0, 200), actor]);
    return { ok: true, id: r!.id, note: `${o.name} ${o.label} ${qty}개를 ${from.name} → ${to.name} 로 옮겼습니다(원가 그대로).` };
  });
}

/** POST /admin/acct/warehouses/in — 창고 입고(⑫ 입고와 같음 · 창고만 적음) */
export async function whStockIn(db: DatabaseService, b: { optionId: string; whId: string; qty: number; unitCost: number; movedOn?: string; purchaseId?: string; note?: string }, actor: string | null) {
  const o = await directOption(db, b.optionId);
  const w = await whOf(db, b.whId);
  const qty = Math.round(Number(b.qty)), cost = Number(b.unitCost);
  if (!(qty > 0)) throw new PolicyViolation('ACCT_WH', '입고 수량은 1 이상입니다.');
  if (!(cost > 0)) throw new PolicyViolation('ACCT_WH', '입고 단가는 0보다 커야 합니다.');
  const day = b.movedOn || kstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > kstToday()) throw new PolicyViolation('ACCT_WH', '입고 날짜는 오늘까지입니다.');
  const [r] = await db.query<Record<string, unknown>>(
    `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key, purchase_id, note, created_by, warehouse_id)
     VALUES ($1::uuid, $2::date, 'IN', $3, $4, 'W:' || gen_random_uuid()::text, $5::bigint, nullif($6, ''), $7, $8::bigint)
     RETURNING id::text AS id, qty_after AS "qtyAfter"`,
    [o.id, day, qty, cost, /^\d{1,18}$/.test(b.purchaseId ?? '') ? b.purchaseId : null, (b.note ?? '').trim().slice(0, 200), actor, w.id]);
  return { ok: true, ...r, note: `${w.name} 에 ${qty}개 입고했습니다(회사 전체 ${n(r!.qtyAfter)}개).` };
}

/** POST /admin/acct/warehouses/adjust — 창고 실사(센 수량 → 차이만 ⑫ 실사 조정 · SUPER · 사유) */
export async function whAdjust(db: DatabaseService, b: { optionId: string; whId: string; counted: number; unitCost?: number; reason: string }, actor: string | null) {
  const o = await directOption(db, b.optionId);
  const w = await whOf(db, b.whId);
  const counted = Math.round(Number(b.counted));
  if (!(counted >= 0 && counted <= 1_000_000)) throw new PolicyViolation('ACCT_WH', '센 수량은 0 이상입니다.');
  const t = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_stock:' || $1::text))`, [o.id]);
    const have = await whQty(db, o.id, w.id);
    const diff = counted - have;
    if (diff === 0) return { ok: true, diff: 0, note: '장부 수량과 같습니다 — 조정할 것이 없습니다.' };
    await db.query(
      `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key, note, created_by, warehouse_id)
       VALUES ($1::uuid, $2::date, 'ADJUST', $3, $4, 'WA:' || gen_random_uuid()::text, $5, $6, $7::bigint)`,
      [o.id, kstToday(), diff, b.unitCost ?? null, `${w.name} 실사 · ${t}`.slice(0, 200), actor, w.id]);
    return { ok: true, diff, note: `${w.name} 실사 — 장부 ${have}개 → 센 ${counted}개(${diff > 0 ? '+' : ''}${diff}) · 차이는 매출원가 조정 전표로 갑니다.` };
  });
}

/* ── 바코드 ── */
const sanitize = (s: string) => s.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 24);

/** POST /admin/acct/barcodes/{optionId} — 바코드 정하기(비우면 「상품 코드-옵션 순서」) · 한 번 정하면 바꾸지 않음 */
export async function setBarcode(db: DatabaseService, optionId: string, code: string | undefined, actor: string | null) {
  const o = await directOption(db, optionId);
  const [have] = await db.query<{ code: string }>(`SELECT code FROM acct_barcodes WHERE option_id::text = $1`, [o.id]);
  if (have) throw new StateConflict('ACCT_BARCODE_SET', `이미 정한 바코드가 있습니다({0}).`.replace('{0}', have.code));
  let c = sanitize(code ?? '');
  if (!c) c = sanitize(`${o.code}-${String(o.sort + 1).padStart(2, '0')}`);
  if (!/^[0-9A-Z-]{4,32}$/.test(c)) throw new PolicyViolation('ACCT_BARCODE', '바코드는 대문자 · 숫자 · 붙임표 4 ~ 32자입니다.');
  let final = c;
  for (let i = 2; ; i++) {
    const [dup] = await db.query(`SELECT 1 FROM acct_barcodes WHERE code = $1`, [final]);
    if (!dup) break;
    if (code) throw new PolicyViolation('ACCT_BARCODE_DUP', '이미 쓰는 바코드입니다.');
    final = `${c.slice(0, 28)}-${i}`;
    if (i > 50) throw new PolicyViolation('ACCT_BARCODE_DUP', '이미 쓰는 바코드입니다.');
  }
  await db.query(`INSERT INTO acct_barcodes (option_id, code, created_by) VALUES ($1::uuid, $2, $3)`, [o.id, final, actor]);
  return { ok: true, optionId: o.id, code: final, note: `바코드 ${final} 을 정했습니다.` };
}

/** GET /admin/acct/barcodes — 직판 옵션 · 바코드(인쇄 화면) */
export async function listBarcodes(db: DatabaseService) {
  return db.query(
    `SELECT o.id::text AS "optionId", p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label, o.is_active AS active, b.code AS barcode
       FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
       LEFT JOIN acct_barcodes b ON b.option_id = o.id
      ORDER BY p.name, o.sort LIMIT 500`);
}

/** GET /admin/acct/barcodes/find?code= — 읽은 바코드 → 옵션 · 창고별 수량 */
export async function findBarcode(db: DatabaseService, code: string) {
  const c = sanitize(code ?? '');
  const [b] = await db.query<{ optionId: string }>(`SELECT option_id::text AS "optionId" FROM acct_barcodes WHERE code = $1`, [c]);
  if (!b) throw new NotFound('모르는 바코드입니다.');
  const o = await directOption(db, b.optionId);
  const byWh = await db.query(
    `SELECT w.id::text AS id, w.name, coalesce(s.qty, 0)::int AS qty FROM acct_warehouses w LEFT JOIN v_acct_wh_stock s ON s.wh_id = w.id AND s.option_id::text = $1
      WHERE w.active ORDER BY w.is_main DESC, w.code`, [o.id]);
  return { code: c, option: o, byWh };
}

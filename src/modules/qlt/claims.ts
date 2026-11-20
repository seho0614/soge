import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Source } from '../acct/journal';

/* ---------------------------------------------------------------------
 * v10.496 (D271 · docs/634) 품질 클레임 · 불량 — 대표 11/20 「㊶ ③」
 *
 *   접수(OPEN) → 확인 중(CHECKING) → 조치(ACTION) → 끝냄(CLOSED · 원인 · 조치 필수) / 반려(REJECTED · 사유)
 *   연결: 상품(필수) · 옵션 · 로트(② · 공급사 기본값) · 공급사(⑯ 매입처) · 주문(주문 번호)
 *   공급사 반품: 원가 수불부 새 종류 SUP_RETURN(평균 원가로 나감 · 재고가 모자라면 DB 가 막음) + 로트 수불 + 전표 QLT_SUP_RETURN
 *               (외상매입금 / 상품 — 공급사가 대금에서 빼 주는 것으로 봄 · 계정은 세무사 확인)
 *   재발: 같은 상품 · 같은 불량이 90일 안 qlt.repeat_count(처음 3)건 이상 → 운영 알림 QLT_CLAIM_REPEAT(상품 · 불량 · 달마다 한 번 · 줄면 풀림)
 *   지우지 않음 · 끝내거나 반려하면 고치지 않음(DB 도 막음) · 기록은 쌓기만.
 * ------------------------------------------------------------------- */

export const CLAIM_SOURCES = ['CUSTOMER', 'INSPECTION', 'SUPPLIER', 'INTERNAL'] as const;
export const DEFECT_TYPES = ['DAMAGE', 'EXPIRY', 'FOREIGN', 'LABEL', 'QUALITY', 'MISSING', 'OTHER'] as const;
export const CLAIM_STATES = ['OPEN', 'CHECKING', 'ACTION', 'CLOSED', 'REJECTED'] as const;
export const CLAIM_SOURCE_KO: Record<string, string> = { CUSTOMER: '고객', INSPECTION: '입고 검사', SUPPLIER: '공급사', INTERNAL: '사내' };
export const DEFECT_KO: Record<string, string> = { DAMAGE: '파손', EXPIRY: '유통기한', FOREIGN: '이물', LABEL: '표시 · 라벨', QUALITY: '품질 · 변질', MISSING: '수량 모자람', OTHER: '그 밖' };
export const CLAIM_STATE_KO: Record<string, string> = { OPEN: '접수', CHECKING: '확인 중', ACTION: '조치', CLOSED: '끝냄', REJECTED: '반려' };

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);
const idOk = (s?: string) => typeof s === 'string' && /^\d{1,18}$/.test(s);
const uuidOk = (s?: string) => typeof s === 'string' && /^[0-9a-fA-F-]{36}$/.test(s);
const isDay = (s?: string) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const txt = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);

async function claimOf(db: DatabaseService, id: string) {
  if (!idOk(id)) throw new NotFound('없는 클레임입니다.');
  const [c] = await db.query<{ id: string; state: string; qty: number; sup_return_qty: number; option_id: string | null; lot_id: string | null; party_id: string | null; cause: string | null; action: string | null; title: string }>(
    `SELECT id::text AS id, state, qty, sup_return_qty, option_id::text AS option_id, lot_id::text AS lot_id, party_id::text AS party_id, cause, action, title FROM qlt_claims WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 클레임입니다.');
  return { ...c, qty: n(c.qty), sup_return_qty: n(c.sup_return_qty) };
}
async function supplierOk(db: DatabaseService, partyId: string) {
  const [p] = idOk(partyId) ? await db.query<{ kind: string }>(`SELECT kind FROM acct_parties WHERE id = $1::bigint`, [partyId]) : [];
  if (!p) throw new NotFound('없는 거래처입니다.');
  if (!['SUPPLIER', 'BOTH'].includes(p.kind)) throw new PolicyViolation('QLT_PARTY', '매입처(공급사) 거래처를 고르십시오.');
}
async function log(db: DatabaseService, id: string, kind: string, note: string | null, actor: string | null) {
  await db.query(`INSERT INTO qlt_claim_logs (claim_id, kind, note, created_by) VALUES ($1::bigint, $2, $3, $4)`, [id, kind, note ? note.slice(0, 400) : null, actor]);
}

/** GET /admin/qlt/claims?state=&q= — 목록 · 상태별 수 */
export async function listClaims(db: DatabaseService, f: { state?: string; q?: string }) {
  const state = (CLAIM_STATES as readonly string[]).includes(f.state ?? '') ? f.state! : f.state === 'OPENALL' ? 'OPENALL' : '';
  const q = txt(f.q, 40);
  const items = await db.query<Record<string, unknown>>(
    `SELECT c.id::text AS id, c.received_on::text AS "receivedOn", c.source, c.defect_type AS "defectType", c.title, c.qty, c.state, c.sup_return_qty AS "supReturnQty",
            p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label, l.lot_no AS "lotNo", c.lot_id::text AS "lotId", pa.name AS "partyName", od.order_no AS "orderNo",
            c.closed_at AS "closedAt", c.updated_at AS "updatedAt"
       FROM qlt_claims c JOIN hlt_products p ON p.id = c.product_id LEFT JOIN hlt_product_options o ON o.id = c.option_id
       LEFT JOIN qlt_lots l ON l.id = c.lot_id LEFT JOIN acct_parties pa ON pa.id = c.party_id LEFT JOIN hlt_orders od ON od.id = c.order_id
      WHERE ($1::text = '' OR c.state = $1 OR ($1 = 'OPENALL' AND c.state IN ('OPEN', 'CHECKING', 'ACTION')))
        AND ($2::text = '' OR c.title ILIKE '%' || $2 || '%' OR p.code ILIKE '%' || $2 || '%' OR p.name ILIKE '%' || $2 || '%' OR l.lot_no ILIKE '%' || $2 || '%')
      ORDER BY (c.state IN ('CLOSED', 'REJECTED')), c.received_on DESC, c.id DESC LIMIT 500`, [state, q]);
  const counts = await db.query<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM qlt_claims GROUP BY state`);
  return { items: items.map((r) => ({ ...r, qty: n(r.qty), supReturnQty: n(r.supReturnQty) })), counts: Object.fromEntries(counts.map((c) => [c.state, n(c.n)])),
           states: CLAIM_STATE_KO, sources: CLAIM_SOURCE_KO, defects: DEFECT_KO,
           note: '끝낼 때는 원인과 조치를 적어야 합니다. 공급사 반품은 원가 장부에서 재고를 빼고(전표 외상매입금 / 상품), 로트가 있으면 그 로트에서도 뺍니다.' };
}

/** GET /admin/qlt/claims/stats?months= — 불량 유형 · 상품 · 공급사별 · 달마다 · 재발(90일 2건 이상) */
export async function claimStats(db: DatabaseService, months?: string) {
  const m = Math.min(24, Math.max(1, Math.round(Number(months ?? 6)) || 6));
  const from = new Date(Date.now() + 9 * 3600e3 - m * 30 * 86400e3).toISOString().slice(0, 10);
  const byDefect = await db.query(
    `SELECT c.defect_type AS key, count(*)::int AS n, sum(c.qty)::int AS qty FROM qlt_claims c
      WHERE c.state <> 'REJECTED' AND c.received_on >= $1::date GROUP BY c.defect_type ORDER BY n DESC`, [from]);
  const byProduct = await db.query(
    `SELECT p.code AS key, p.name, count(*)::int AS n, sum(c.qty)::int AS qty FROM qlt_claims c JOIN hlt_products p ON p.id = c.product_id
      WHERE c.state <> 'REJECTED' AND c.received_on >= $1::date GROUP BY p.code, p.name ORDER BY n DESC, p.code LIMIT 20`, [from]);
  const bySupplier = await db.query(
    `SELECT coalesce(pa.name, '(공급사 없음)') AS key, count(*)::int AS n, sum(c.qty)::int AS qty, sum(c.sup_return_qty)::int AS returned
       FROM qlt_claims c LEFT JOIN acct_parties pa ON pa.id = c.party_id
      WHERE c.state <> 'REJECTED' AND c.received_on >= $1::date GROUP BY pa.name ORDER BY n DESC LIMIT 20`, [from]);
  const byMonth = await db.query(
    `SELECT to_char(c.received_on, 'YYYY-MM') AS key, count(*)::int AS n FROM qlt_claims c
      WHERE c.state <> 'REJECTED' AND c.received_on >= $1::date GROUP BY 1 ORDER BY 1`, [from]);
  const repeats = await db.query(
    `SELECT p.code, p.name, c.defect_type AS "defectType", count(*)::int AS n, max(c.received_on)::text AS last
       FROM qlt_claims c JOIN hlt_products p ON p.id = c.product_id
      WHERE c.state <> 'REJECTED' AND c.received_on >= $1::date - 90
      GROUP BY p.code, p.name, c.defect_type HAVING count(*) >= 2 ORDER BY n DESC, last DESC LIMIT 30`, [kstToday()]);
  return { months: m, from, byDefect, byProduct, bySupplier, byMonth, repeats, defects: DEFECT_KO };
}

/** GET /admin/qlt/claims/{id} — 자세히 · 기록 */
export async function claimDetail(db: DatabaseService, id: string) {
  await claimOf(db, id);
  const [claim] = await db.query<Record<string, unknown>>(
    `SELECT c.id::text AS id, c.received_on::text AS "receivedOn", c.source, c.defect_type AS "defectType", c.title, c.detail, c.cause, c.action, c.qty, c.state,
            c.close_note AS "closeNote", c.closed_at AS "closedAt", c.sup_return_qty AS "supReturnQty",
            c.product_id::text AS "productId", p.code, p.name, c.option_id::text AS "optionId", fn_hlt_option_label(o.months, o.tag) AS label,
            c.lot_id::text AS "lotId", l.lot_no AS "lotNo", l.expires_on::text AS "lotExpiresOn", c.party_id::text AS "partyId", pa.name AS "partyName",
            od.order_no AS "orderNo", c.created_at AS "createdAt"
       FROM qlt_claims c JOIN hlt_products p ON p.id = c.product_id LEFT JOIN hlt_product_options o ON o.id = c.option_id
       LEFT JOIN qlt_lots l ON l.id = c.lot_id LEFT JOIN acct_parties pa ON pa.id = c.party_id LEFT JOIN hlt_orders od ON od.id = c.order_id
      WHERE c.id = $1::bigint`, [id]);
  const logs = await db.query(`SELECT kind, note, created_at AS "createdAt" FROM qlt_claim_logs WHERE claim_id = $1::bigint ORDER BY id`, [id]);
  const returns = await db.query(
    `SELECT m.id::text AS id, m.moved_on::text AS date, m.qty, m.amount::bigint AS amount, m.note FROM acct_stock_moves m
      WHERE m.kind = 'SUP_RETURN' AND m.source_key LIKE $1 ORDER BY m.id`, [`QC:${id}:%`]);
  return { claim: { ...claim, qty: n(claim?.qty), supReturnQty: n(claim?.supReturnQty) }, logs, returns };
}

export interface ClaimInput { receivedOn?: string; source: string; productId?: string; optionId?: string; lotId?: string; partyId?: string; orderNo?: string; qty: number; defectType: string; title: string; detail?: string }

/** POST /admin/qlt/claims — 접수 */
export async function addClaim(db: DatabaseService, b: ClaimInput, actor: string | null) {
  const day = b.receivedOn || kstToday();
  if (!isDay(day) || day > kstToday()) throw new PolicyViolation('QLT_CLAIM', '접수일은 오늘까지입니다.');
  if (!(CLAIM_SOURCES as readonly string[]).includes(b.source)) throw new PolicyViolation('QLT_CLAIM', '접수 경로를 고르십시오.');
  if (!(DEFECT_TYPES as readonly string[]).includes(b.defectType)) throw new PolicyViolation('QLT_CLAIM', '불량 유형을 고르십시오.');
  const title = String(b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('QLT_CLAIM', '제목은 2 ~ 100자입니다.');
  const qty = Math.round(Number(b.qty));
  if (!(qty >= 1 && qty <= 1_000_000)) throw new PolicyViolation('QLT_CLAIM', '수량은 1 ~ 1,000,000개입니다.');
  let productId = b.productId ?? null, optionId = b.optionId ?? null, partyId = b.partyId ?? null, lotId = b.lotId ?? null;
  if (lotId) {
    const [l] = idOk(lotId) ? await db.query<{ option_id: string; product_id: string; party_id: string | null }>(
      `SELECT option_id::text AS option_id, product_id::text AS product_id, party_id::text AS party_id FROM qlt_lots WHERE id = $1::bigint`, [lotId]) : [];
    if (!l) throw new NotFound('없는 로트입니다.');
    if ((productId && productId !== l.product_id) || (optionId && optionId !== l.option_id)) throw new PolicyViolation('QLT_CLAIM', '로트가 그 상품 · 옵션의 것이 아닙니다.');
    productId = l.product_id; optionId = l.option_id; partyId = partyId ?? l.party_id;
  }
  if (optionId && !productId) {
    const [o] = uuidOk(optionId) ? await db.query<{ product_id: string }>(`SELECT product_id::text AS product_id FROM hlt_product_options WHERE id::text = $1`, [optionId]) : [];
    if (!o) throw new NotFound('없는 상품 옵션입니다.');
    productId = o.product_id;
  }
  if (!productId || !uuidOk(productId)) throw new PolicyViolation('QLT_CLAIM', '상품을 고르십시오.');
  const [p] = await db.query(`SELECT 1 FROM hlt_products WHERE id::text = $1`, [productId]);
  if (!p) throw new NotFound('없는 상품입니다.');
  if (optionId) {
    const [o] = uuidOk(optionId) ? await db.query(`SELECT 1 FROM hlt_product_options WHERE id::text = $1 AND product_id::text = $2`, [optionId, productId]) : [];
    if (!o) throw new PolicyViolation('QLT_CLAIM', '옵션이 그 상품의 것이 아닙니다.');
  }
  if (partyId) await supplierOk(db, partyId);
  let orderId: string | null = null;
  if (b.orderNo) {
    const [od] = await db.query<{ id: string }>(`SELECT id::text AS id FROM hlt_orders WHERE order_no = $1`, [txt(b.orderNo, 40)]);
    if (!od) throw new NotFound('없는 주문 번호입니다.');
    orderId = od.id;
  }
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO qlt_claims (received_on, source, product_id, option_id, lot_id, party_id, order_id, qty, defect_type, title, detail, created_by)
       VALUES ($1::date, $2, $3::uuid, $4::uuid, $5::bigint, $6::bigint, $7::uuid, $8, $9, $10, nullif($11, ''), $12) RETURNING id::text AS id`,
      [day, b.source, productId, optionId, lotId, partyId, orderId, qty, b.defectType, title, txt(b.detail, 2000), actor]);
    await log(db, r!.id, 'CREATE', `${CLAIM_SOURCE_KO[b.source]} · ${DEFECT_KO[b.defectType]} · ${qty}개`, actor);
    return { ok: true, id: r!.id, state: 'OPEN', note: `클레임 ${r!.id}번을 접수했습니다.` };
  });
}

export interface ClaimEdit { state?: string; cause?: string; action?: string; detail?: string; partyId?: string; lotId?: string }

/** PUT /admin/qlt/claims/{id} — 원인 · 조치 · 상태(접수 · 확인 중 · 조치) · 공급사 · 로트(보낸 칸만) */
export async function editClaim(db: DatabaseService, id: string, b: ClaimEdit, actor: string | null) {
  const c = await claimOf(db, id);
  if (c.state === 'CLOSED' || c.state === 'REJECTED') throw new StateConflict('QLT_CLAIM_STATE', '끝내거나 반려한 클레임은 고치지 않습니다.');
  const notes: string[] = [];
  if (b.state !== undefined && !['OPEN', 'CHECKING', 'ACTION'].includes(b.state)) throw new PolicyViolation('QLT_CLAIM', '여기서는 접수 · 확인 중 · 조치로만 바꿉니다(끝냄 · 반려는 따로).');
  const stateMove = b.state !== undefined && b.state !== c.state;
  if (stateMove) notes.push(`상태 ${CLAIM_STATE_KO[c.state]} → ${CLAIM_STATE_KO[b.state!]}`);
  if (b.cause !== undefined) notes.push('원인');
  if (b.action !== undefined) notes.push('조치');
  if (b.detail !== undefined) notes.push('내용');
  if (b.partyId !== undefined) {
    if (b.partyId) await supplierOk(db, b.partyId);
    notes.push('공급사');
  }
  if (b.lotId !== undefined) {
    if (b.lotId && !idOk(b.lotId)) throw new NotFound('없는 로트입니다.');
    if (c.sup_return_qty > 0 && (b.lotId || null) !== c.lot_id) throw new StateConflict('QLT_CLAIM_STATE', '공급사 반품을 적은 뒤에는 로트를 바꾸지 않습니다.');
    notes.push('로트');
  }
  if (!notes.length) return { ok: true, id, note: '바꿀 것이 없습니다.' };
  return db.transaction(async () => {
    /* 보낸 칸만 바꿈(안 보낸 칸은 그대로 — 칸마다 「보냈나」 표시 $짝) */
    await db.query(
      `UPDATE qlt_claims SET
         state    = CASE WHEN $2::boolean  THEN $3 ELSE state END,
         cause    = CASE WHEN $4::boolean  THEN nullif($5, '') ELSE cause END,
         action   = CASE WHEN $6::boolean  THEN nullif($7, '') ELSE action END,
         detail   = CASE WHEN $8::boolean  THEN nullif($9, '') ELSE detail END,
         party_id = CASE WHEN $10::boolean THEN $11::bigint ELSE party_id END,
         lot_id   = CASE WHEN $12::boolean THEN $13::bigint ELSE lot_id END
       WHERE id = $1::bigint`,
      [id, stateMove, b.state ?? c.state, b.cause !== undefined, txt(b.cause, 1000), b.action !== undefined, txt(b.action, 1000),
       b.detail !== undefined, txt(b.detail, 2000), b.partyId !== undefined, b.partyId || null, b.lotId !== undefined, b.lotId || null]);
    await log(db, id, stateMove ? 'STATE' : 'EDIT', notes.join(' · '), actor);
    return { ok: true, id, changed: notes, note: `클레임 ${id}번을 고쳤습니다.` };
  });
}

/** POST /admin/qlt/claims/{id}/close — 끝냄(원인 · 조치 필수) 또는 반려(사유) */
export async function closeClaim(db: DatabaseService, id: string, b: { result: string; note?: string }, actor: string | null) {
  const c = await claimOf(db, id);
  if (c.state === 'CLOSED' || c.state === 'REJECTED') throw new StateConflict('QLT_CLAIM_STATE', '이미 끝내거나 반려한 클레임입니다.');
  const note = txt(b.note, 400);
  if (b.result === 'CLOSED') {
    if (txt(c.cause, 1000).length < 2 || txt(c.action, 1000).length < 2) throw new PolicyViolation('QLT_CLAIM_DONE', '끝내려면 원인과 조치를 먼저 적으십시오.');
  } else if (b.result === 'REJECTED') {
    if (note.length < 2) throw new PolicyViolation('QLT_REASON', '반려 사유(2자 이상)를 넣으십시오.');
  } else throw new PolicyViolation('QLT_CLAIM', '끝냄(CLOSED) 또는 반려(REJECTED)를 고르십시오.');
  return db.transaction(async () => {
    await db.query(`UPDATE qlt_claims SET state = $2, close_note = nullif($3, ''), closed_at = now() WHERE id = $1::bigint`, [id, b.result, note]);
    await log(db, id, 'CLOSE', `${CLAIM_STATE_KO[b.result]}${note ? ` · ${note}` : ''}`, actor);
    return { ok: true, id, state: b.result, note: b.result === 'CLOSED' ? `클레임 ${id}번을 끝냈습니다.` : `클레임 ${id}번을 반려했습니다.` };
  });
}

/** POST /admin/qlt/claims/{id}/supplier-return — 공급사 반품(SUPER · PAYOUT) = 수불부 SUP_RETURN + 로트 수불 + 전표(다음 전표 작업) */
export async function supplierReturn(db: DatabaseService, id: string, b: { qty: number; note?: string; whId?: string }, actor: string | null) {
  const c = await claimOf(db, id);
  if (c.state === 'CLOSED' || c.state === 'REJECTED') throw new StateConflict('QLT_CLAIM_STATE', '끝내거나 반려한 클레임에는 반품을 적지 않습니다.');
  if (!c.option_id) throw new PolicyViolation('QLT_RETURN', '공급사 반품은 상품 옵션이 있는 클레임만 적습니다(옵션 · 로트를 먼저 고르십시오).');
  if (!c.party_id) throw new PolicyViolation('QLT_RETURN', '공급사를 먼저 고르십시오.');
  const qty = Math.round(Number(b.qty));
  if (!(qty >= 1)) throw new PolicyViolation('QLT_RETURN', '반품 수량은 1 이상입니다.');
  if (c.sup_return_qty + qty > c.qty) throw new PolicyViolation('QLT_RETURN', `클레임 수량 안에서만 반품합니다(남은 {0}개).`.replace('{0}', String(c.qty - c.sup_return_qty)));
  const [o] = await db.query<{ direct: boolean }>(
    `SELECT coalesce(s.type = 'DIRECT', false) AS direct FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id LEFT JOIN hlt_sellers s ON s.id = p.seller_id WHERE o.id::text = $1`, [c.option_id]);
  if (!o?.direct) throw new PolicyViolation('QLT_RETURN', '직판 상품만 원가 장부에서 공급사 반품을 적습니다.');
  const note = txt(b.note, 120);
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_stock:' || $1::text))`, [c.option_id]);
    if (c.lot_id) await db.query(`SELECT pg_advisory_xact_lock(hashtext('qlt_lot:' || $1::text))`, [c.option_id]);
    const [wh] = b.whId
      ? await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_warehouses WHERE id::text = $1 AND active`, [String(b.whId)])
      : await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_warehouses WHERE is_main LIMIT 1`);
    if (!wh) throw new NotFound('없는 창고입니다.');
    const [w] = await db.query<{ q: number }>(`SELECT coalesce(sum(qty), 0)::int AS q FROM v_acct_wh_stock WHERE option_id::text = $1 AND wh_id::text = $2`, [c.option_id, wh.id]);
    if (n(w?.q) < qty) throw new PolicyViolation('QLT_RETURN', `그 창고 수량은 {0}개입니다.`.replace('{0}', String(n(w?.q))));
    if (c.lot_id) {
      const [l] = await db.query<{ qty: number }>(`SELECT qty FROM v_qlt_lot_qty WHERE lot_id = $1::bigint`, [c.lot_id]);
      if (n(l?.qty) < qty) throw new PolicyViolation('QLT_RETURN', `그 로트 남은 수량은 {0}개입니다.`.replace('{0}', String(n(l?.qty))));
    }
    const [seq] = await db.query<{ k: number }>(`SELECT count(*)::int + 1 AS k FROM acct_stock_moves WHERE kind = 'SUP_RETURN' AND source_key LIKE $1`, [`QC:${id}:%`]);
    const [m] = await db.query<{ id: string; amount: string }>(
      `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key, note, created_by, warehouse_id)
       VALUES ($1::uuid, $2::date, 'SUP_RETURN', $3, $4, $5, $6, $7::bigint) RETURNING id::text AS id, amount::text AS amount`,
      [c.option_id, kstToday(), -qty, `QC:${id}:${n(seq?.k)}`, `클레임 ${id}번 공급사 반품${note ? ` · ${note}` : ''}`.slice(0, 200), actor, wh.id]);
    if (c.lot_id) {
      await db.query(`INSERT INTO qlt_lot_moves (lot_id, kind, qty, move_id, claim_id, note, created_by) VALUES ($1::bigint, 'SUP_RETURN', $2, $3::bigint, $4::bigint, '공급사 반품', $5)`,
        [c.lot_id, -qty, m!.id, id, actor]);
    }
    await db.query(`INSERT INTO qlt_move_marks (move_id, mark, note) VALUES ($1::bigint, 'DONE', '공급사 반품') ON CONFLICT DO NOTHING`, [m!.id]);
    await db.query(`UPDATE qlt_claims SET sup_return_qty = sup_return_qty + $2 WHERE id = $1::bigint`, [id, qty]);
    await log(db, id, 'RETURN', `공급사 반품 ${qty}개 · 원가 ${Math.abs(n(m!.amount)).toLocaleString('ko-KR')}원${note ? ` · ${note}` : ''}`, actor);
    return { ok: true, id, moveId: m!.id, qty, amount: Math.abs(n(m!.amount)),
      note: `공급사 반품 ${qty}개를 적었습니다 — 원가 ${Math.abs(n(m!.amount)).toLocaleString('ko-KR')}원이 재고에서 빠지고 다음 전표 작업에서 외상매입금 / 상품 전표가 생깁니다.` };
  });
}

/** 재발 알림(qlt_daily 안) — 같은 상품 · 같은 불량 90일 안 qlt.repeat_count 건 이상 · 상품 · 불량 · 달마다 한 번 · 줄면 풀림 */
export async function qltClaimRepeatCheck(db: DatabaseService) {
  const [s] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'qlt.repeat_count'`);
  const cut = Number.isInteger(Number(s?.v)) && Number(s?.v) >= 2 && Number(s?.v) <= 10 ? Number(s?.v) : 3;
  const today = kstToday(), ym = today.slice(0, 7);
  const rows = await db.query<{ product_id: string; code: string; name: string; defect: string; n: number }>(
    `SELECT c.product_id::text AS product_id, p.code, p.name, c.defect_type AS defect, count(*)::int AS n
       FROM qlt_claims c JOIN hlt_products p ON p.id = c.product_id
      WHERE c.state <> 'REJECTED' AND c.received_on >= $1::date - 90
      GROUP BY c.product_id, p.code, p.name, c.defect_type HAVING count(*) >= $2::int LIMIT 100`, [today, cut]);
  const want = new Map(rows.map((r) => [`${r.product_id}|${r.defect}|${ym}`, r]));
  const open = await db.query<{ id: string; key: string; pd: string }>(
    `SELECT id::text AS id, detail->>'key' AS key, (detail->>'product') || '|' || (detail->>'defect') AS pd FROM ops_alerts WHERE alert_code = 'QLT_CLAIM_REPEAT' AND resolved_at IS NULL`);
  let resolved = 0;
  for (const a of open) {
    if (![...want.keys()].some((k) => k.startsWith(`${a.pd}|`))) {
      await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '90일 안 건수가 기준 아래' WHERE id = $1::bigint`, [a.id]);
      resolved++;
    }
  }
  const made: string[] = [];
  for (const [key, r] of want) {
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'QLT_CLAIM_REPEAT', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'QLT_CLAIM_REPEAT' AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`품질 클레임 재발 — ${r.name}(${r.code}) ${DEFECT_KO[r.defect] ?? r.defect} 90일 안 ${r.n}건 — 소개몰 › 품질 클레임(원인 · 공급사 확인)`,
       JSON.stringify({ key, product: r.product_id, defect: r.defect, count: n(r.n) }), key]);
    if (ins.length) made.push(key);
  }
  return { cut, made, resolved };
}

/* ── 전표(sources.ts 끝에 덧붙임) — 공급사 반품: 차변 외상매입금(AP) / 대변 상품(INVENTORY) · 금액 = 나간 원가 · 시작일 뒤 ── */
export const QLT_SOURCES: Source[] = [
  {
    name: 'QLT_SUP_RETURN', label: '공급사 반품(품질 클레임)',
    sql: `SELECT m.id::text AS key, (m.moved_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, (-m.amount)::bigint AS amt, -m.qty AS qty, pa.name AS party,
                 fn_hlt_option_label(o.months, o.tag) AS label, split_part(m.source_key, ':', 2) AS claim
            FROM acct_stock_moves m JOIN hlt_product_options o ON o.id = m.option_id
            LEFT JOIN qlt_claims c ON m.source_key LIKE 'QC:%' AND c.id::text = split_part(m.source_key, ':', 2)
            LEFT JOIN acct_parties pa ON pa.id = c.party_id
           WHERE m.kind = 'SUP_RETURN' AND m.amount <> 0 AND (m.moved_on::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'QLT_SUP_RETURN' AND e.source_key = m.id::text)
           ORDER BY m.id LIMIT 500`,
    build: (r) => ({ memo: `공급사 반품 ${r.label ?? ''} ${r.qty}개 (클레임 ${r.claim ?? ''})`.trim(), evidence: 'NONE',
      lines: [{ role: 'AP', debit: Math.abs(n(r.amt)), credit: 0 }, { role: 'INVENTORY', debit: 0, credit: Math.abs(n(r.amt)) }] }),
  },
];

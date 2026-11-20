import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.495 (D271 · docs/633) 재고 로트 · 유통기한 — 대표 11/20 「㊶ ②」
 *
 *   **덧붙이는 층**입니다. 판매용 재고(hlt_product_options.stock) · 원가 수불부(acct_stock_moves · 이동평균 · 전표)는 그대로 돌고,
 *   로트 관리를 켠 직판 상품(qlt_lot_products)의 수불부 줄에만 「어느 로트 몇 개」(qlt_lot_moves)를 붙입니다. 끄면 지금과 똑같습니다.
 *
 *   들어옴   입고 · 늘리는 실사 줄을 골라 로트 등록(로트 합 ≤ 그 줄 수량 · DB 가 막음) · 로트 관리 전 재고는 「시작 재고」(OPEN)
 *   나감     정기 작업 qlt_lot_alloc(매시간) — 주문 출고는 **배송 뒤**에(발송 전 화면에서 FEFO 제안 → 사람이 확정한 로트부터) · 수출 등은 바로
 *            로트 고르기: 출고 지정(qlt_lot_picks) → 먼저 끝나는 것부터(FEFO · 보류 · 회수 · 그날 지난 로트 뺌) · 모자라면 SHORT(판매는 막지 않음)
 *   반입     취소 · 반품 반입(RETURN)은 그 출고에 나갔던 로트로 되돌림 · 배송 전 취소는 로트 없이 SKIP · 개봉 반품은 반입 없음(D185 그대로)
 *   회수     로트 → 나간 주문 · 수출(이름 가림 · 전화 끝 4자리 · ADMIN · SUPER 만 · 볼 때마다 감사 기록 QLT_LOT_TRACE)
 *   임박     매일 07:20 qlt_daily — qlt.expiry_days(처음 30)일 안에 끝나는 로트 · 지난 로트(남은 수량 있음) → QLT_LOT_EXPIRY(로트 · 날짜마다 한 번)
 * ------------------------------------------------------------------- */

/** 로트 번호 — DB CHECK(qlt_lots.lot_no)와 같은 글자 */
export const LOT_NO_RE = /^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$/;
export const LOT_STATES = ['OK', 'HOLD', 'RECALL', 'CLOSED'] as const;
export const LOT_STATE_KO: Record<string, string> = { OK: '정상', HOLD: '보류', RECALL: '회수', CLOSED: '끝' };

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (day: string, d: number) => new Date(Date.parse(`${day}T00:00:00Z`) + d * 86400e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);
const isDay = (s?: string) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const idOk = (s?: string) => typeof s === 'string' && /^\d{1,18}$/.test(s);
const uuidOk = (s?: string) => typeof s === 'string' && /^[0-9a-fA-F-]{36}$/.test(s);
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function settingsOf(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('qlt.expiry_alert', 'qlt.expiry_days')`);
  const m = new Map(rows.map((r) => [r.key, r.value ?? '']));
  const days = Number(m.get('qlt.expiry_days'));
  return { on: (m.get('qlt.expiry_alert') ?? 'on') === 'on', days: Number.isInteger(days) && days >= 1 && days <= 180 ? days : 30 };
}

/** 직판 옵션 · 로트 관리 켜짐 */
async function optionOf(db: DatabaseService, optionId: string) {
  if (!uuidOk(optionId)) throw new NotFound('직판 상품 옵션이 아닙니다.');
  const [o] = await db.query<{ id: string; product_id: string; code: string; name: string; label: string; tracked: boolean }>(
    `SELECT o.id::text AS id, o.product_id::text AS product_id, p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label,
            coalesce((SELECT lp.active FROM qlt_lot_products lp WHERE lp.product_id = p.id), false) AS tracked
       FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
      WHERE o.id::text = $1`, [optionId]);
  if (!o) throw new NotFound('직판 상품 옵션이 아닙니다.');
  return o;
}

async function lotOf(db: DatabaseService, id: string) {
  if (!idOk(id)) throw new NotFound('없는 로트입니다.');
  const [l] = await db.query<{ id: string; option_id: string; lot_no: string; expires_on: string; state: string; qty: number; code: string; name: string; label: string }>(
    `SELECT l.id::text AS id, l.option_id::text AS option_id, l.lot_no, l.expires_on::text AS expires_on, l.state, q.qty,
            p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label
       FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = l.product_id
      WHERE l.id = $1::bigint`, [id]);
  if (!l) throw new NotFound('없는 로트입니다.');
  return { ...l, qty: n(l.qty) };
}

/** 원가 장부 지금 수량(옵션) */
async function ledgerQty(db: DatabaseService, optionId: string) {
  const [r] = await db.query<{ q: number }>(`SELECT coalesce((SELECT qty_after FROM acct_stock_moves WHERE option_id::text = $1 ORDER BY id DESC LIMIT 1), 0)::int AS q`, [optionId]);
  return n(r?.q);
}

/* ═════════════ 화면 ═════════════ */

/** GET /admin/qlt/lots?q=&state=&soon= — 로트 · 로트 관리 상품 · 로트 없는 입고 줄 · 셈 */
export async function listLots(db: DatabaseService, f: { q?: string; state?: string; soon?: string }) {
  const s = await settingsOf(db);
  const today = kstToday();
  const state = (LOT_STATES as readonly string[]).includes(f.state ?? '') ? f.state! : '';
  const q = clean(f.q, 40);
  const items = await db.query<Record<string, unknown>>(
    `SELECT l.id::text AS id, l.lot_no AS "lotNo", l.made_on::text AS "madeOn", l.expires_on::text AS "expiresOn", (l.expires_on - $3::date)::int AS "daysLeft",
            l.in_kind AS "inKind", l.in_qty AS "inQty", q.qty, l.state, l.state_note AS "stateNote", l.memo,
            l.option_id::text AS "optionId", p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label,
            l.party_id::text AS "partyId", pa.name AS "partyName", l.po_id::text AS "poId", l.in_move_id::text AS "moveId", l.created_at AS "createdAt"
       FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = l.product_id
       LEFT JOIN acct_parties pa ON pa.id = l.party_id
      WHERE ($1::text = '' OR l.state = $1)
        AND ($2::text = '' OR l.lot_no ILIKE '%' || $2 || '%' OR p.code ILIKE '%' || $2 || '%' OR p.name ILIKE '%' || $2 || '%')
        AND ($4::boolean IS NOT TRUE OR (q.qty > 0 AND l.state IN ('OK', 'HOLD') AND l.expires_on <= $3::date + $5::int))
      ORDER BY (l.state = 'CLOSED'), (q.qty = 0), l.expires_on, l.id LIMIT 500`,
    [state, q, today, f.soon === '1' || f.soon === 'true', s.days]);
  const products = await db.query<Record<string, unknown>>(
    `SELECT p.id::text AS "productId", p.code, p.name, coalesce(lp.active, false) AS tracked, lp.on_at AS "onAt",
            coalesce((SELECT sum(x.qty_after) FROM (SELECT DISTINCT ON (m.option_id) m.qty_after FROM acct_stock_moves m JOIN hlt_product_options oo ON oo.id = m.option_id
                                                    WHERE oo.product_id = p.id ORDER BY m.option_id, m.id DESC) x), 0)::int AS "ledgerQty",
            coalesce((SELECT sum(v.qty) FROM v_qlt_lot_qty v JOIN qlt_lots ll ON ll.id = v.lot_id WHERE ll.product_id = p.id AND ll.state <> 'CLOSED'), 0)::int AS "lotQty"
       FROM hlt_products p JOIN hlt_sellers sl ON sl.id = p.seller_id AND sl.type = 'DIRECT' LEFT JOIN qlt_lot_products lp ON lp.product_id = p.id
      WHERE p.status <> 'STOPPED' OR lp.product_id IS NOT NULL
      ORDER BY coalesce(lp.active, false) DESC, p.name LIMIT 300`);
  /* 로트 관리 상품의 입고 · 늘리는 실사 줄 중 로트로 다 나누지 않은 것(켠 뒤) */
  const unassigned = await db.query<Record<string, unknown>>(
    `SELECT m.id::text AS "moveId", m.moved_on::text AS date, m.kind, m.qty, m.option_id::text AS "optionId", p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label,
            coalesce((SELECT sum(l.in_qty) FROM qlt_lots l WHERE l.in_move_id = m.id), 0)::int AS assigned, m.source_key AS "sourceKey", m.note
       FROM acct_stock_moves m JOIN hlt_product_options o ON o.id = m.option_id JOIN hlt_products p ON p.id = o.product_id
       JOIN qlt_lot_products lp ON lp.product_id = p.id AND lp.active AND m.created_at >= lp.on_at
      WHERE (m.kind = 'IN' OR (m.kind = 'ADJUST' AND m.qty > 0 AND m.source_key NOT LIKE 'QL:%'))
        AND coalesce((SELECT sum(l.in_qty) FROM qlt_lots l WHERE l.in_move_id = m.id), 0) < m.qty
      ORDER BY m.id DESC LIMIT 200`);
  const [c] = await db.query<{ soon: number; expired: number; recall: number; short: number }>(
    `SELECT count(*) FILTER (WHERE q.qty > 0 AND l.state IN ('OK', 'HOLD') AND l.expires_on >= $1::date AND l.expires_on <= $1::date + $2::int)::int AS soon,
            count(*) FILTER (WHERE q.qty > 0 AND l.state IN ('OK', 'HOLD') AND l.expires_on < $1::date)::int AS expired,
            count(*) FILTER (WHERE l.state = 'RECALL')::int AS recall,
            (SELECT count(*) FROM qlt_move_marks k WHERE k.mark = 'SHORT')::int AS short
       FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id`, [today, s.days]);
  const pr = products.map((r) => ({ ...r, ledgerQty: n(r.ledgerQty), lotQty: n(r.lotQty), unassignedQty: n(r.ledgerQty) - n(r.lotQty) }));
  return {
    items: items.map((r) => ({ ...r, qty: n(r.qty), inQty: n(r.inQty), daysLeft: n(r.daysLeft) })),
    products: pr, unassigned, states: LOT_STATE_KO,
    counts: { soon: n(c?.soon), expired: n(c?.expired), recall: n(c?.recall), short: n(c?.short) },
    expiryDays: s.days, expiryAlert: s.on,
    note: '로트는 원가 수불부에 덧붙이는 기록입니다 — 판매 · 입고 · 반품은 지금처럼 돌고, 로트 관리를 켠 상품만 출고(배송 뒤) · 반입에 로트를 붙입니다(먼저 끝나는 것부터).',
  };
}

/** GET /admin/qlt/lots/{id} — 로트 · 수불(나간 곳은 주문 번호 · 수출 번호만) · 걸린 클레임 */
export async function lotDetail(db: DatabaseService, id: string) {
  const l = await lotOf(db, id);
  const [lot] = await db.query<Record<string, unknown>>(
    `SELECT l.id::text AS id, l.lot_no AS "lotNo", l.made_on::text AS "madeOn", l.expires_on::text AS "expiresOn", l.in_kind AS "inKind", l.in_qty AS "inQty",
            l.state, l.state_note AS "stateNote", l.memo, l.party_id::text AS "partyId", pa.name AS "partyName", l.po_id::text AS "poId", l.in_move_id::text AS "moveId",
            l.created_at AS "createdAt"
       FROM qlt_lots l LEFT JOIN acct_parties pa ON pa.id = l.party_id WHERE l.id = $1::bigint`, [id]);
  const moves = await db.query<Record<string, unknown>>(
    `SELECT x.id::text AS id, x.kind, x.qty, x.qty_after AS "qtyAfter", x.move_id::text AS "moveId", m.kind AS "ledgerKind", m.moved_on::text AS date,
            od.order_no AS "orderNo", CASE WHEN m.source_key LIKE 'EXP-%' THEN split_part(m.source_key, '-', 2) END AS "exportId", x.claim_id::text AS "claimId",
            x.note, x.created_at AS "createdAt"
       FROM qlt_lot_moves x LEFT JOIN acct_stock_moves m ON m.id = x.move_id
       LEFT JOIN hlt_order_items it ON it.id = x.order_item_id LEFT JOIN hlt_orders od ON od.id = it.order_id
      WHERE x.lot_id = $1::bigint ORDER BY x.id LIMIT 1000`, [id]);
  const claims = await db.query(
    `SELECT id::text AS id, received_on::text AS "receivedOn", defect_type AS "defectType", title, qty, state FROM qlt_claims WHERE lot_id = $1::bigint ORDER BY id DESC LIMIT 50`, [id]);
  return { lot: { ...lot, qty: l.qty, code: l.code, name: l.name, label: l.label }, moves, claims };
}

export interface LotInput { optionId: string; lotNo: string; madeOn?: string; expiresOn: string; qty: number; moveId?: string; partyId?: string; memo?: string }

/** POST /admin/qlt/lots — 로트 등록(입고 줄을 나눔 · 없으면 시작 재고) */
export async function addLot(db: DatabaseService, b: LotInput, actor: string | null) {
  const o = await optionOf(db, b.optionId);
  if (!o.tracked) throw new PolicyViolation('QLT_LOT_OFF', '이 상품은 로트 관리가 꺼져 있습니다 — 먼저 「로트 관리 켜기」를 누르십시오.');
  const lotNo = String(b.lotNo ?? '').trim();
  if (!LOT_NO_RE.test(lotNo)) throw new PolicyViolation('QLT_LOT', '로트 번호는 영문 · 숫자로 시작하는 1 ~ 40자(영문 · 숫자 · 점 · 밑줄 · 빗금 · 붙임표)입니다.');
  if (!isDay(b.expiresOn)) throw new PolicyViolation('QLT_LOT', '유통기한(YYYY-MM-DD)을 넣으십시오.');
  if (b.madeOn && (!isDay(b.madeOn) || b.madeOn > b.expiresOn || b.madeOn > kstToday())) throw new PolicyViolation('QLT_LOT', '제조일은 오늘까지 · 유통기한 앞이어야 합니다.');
  const qty = Math.round(Number(b.qty));
  if (!(qty >= 1 && qty <= 1_000_000)) throw new PolicyViolation('QLT_LOT', '로트 수량은 1 ~ 1,000,000개입니다.');
  const [dup] = await db.query(`SELECT 1 FROM qlt_lots WHERE option_id = $1::uuid AND lot_no = $2`, [o.id, lotNo]);
  if (dup) throw new StateConflict('QLT_LOT_DUP', '같은 옵션에 같은 로트 번호가 이미 있습니다.');
  let partyId: string | null = null, poId: string | null = null;
  if (b.partyId) {
    const [p] = idOk(b.partyId) ? await db.query<{ kind: string }>(`SELECT kind FROM acct_parties WHERE id = $1::bigint`, [b.partyId]) : [];
    if (!p) throw new NotFound('없는 거래처입니다.');
    if (!['SUPPLIER', 'BOTH'].includes(p.kind)) throw new PolicyViolation('QLT_PARTY', '매입처(공급사) 거래처를 고르십시오.');
    partyId = b.partyId;
  }
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('qlt_lot:' || $1::text))`, [o.id]);
    if (b.moveId) {
      if (!idOk(b.moveId)) throw new NotFound('없는 수불부 줄입니다.');
      const [m] = await db.query<{ option_id: string; kind: string; qty: number; source_key: string; used: number }>(
        `SELECT m.option_id::text AS option_id, m.kind, m.qty, m.source_key, coalesce((SELECT sum(l.in_qty) FROM qlt_lots l WHERE l.in_move_id = m.id), 0)::int AS used
           FROM acct_stock_moves m WHERE m.id = $1::bigint`, [b.moveId]);
      if (!m) throw new NotFound('없는 수불부 줄입니다.');
      if (m.option_id !== o.id || !(m.kind === 'IN' || (m.kind === 'ADJUST' && n(m.qty) > 0))) throw new PolicyViolation('QLT_LOT', '같은 옵션의 입고(또는 늘리는 실사) 줄만 로트로 나눕니다.');
      if (n(m.used) + qty > n(m.qty)) throw new PolicyViolation('QLT_LOT', `그 입고 줄에 남은 수량은 {0}개입니다.`.replace('{0}', String(n(m.qty) - n(m.used))));
      const po = /^PO-(\d{1,18})-\d+$/.exec(m.source_key ?? '');
      if (po) {
        poId = po[1]!;
        if (!partyId) { const [x] = await db.query<{ party_id: string }>(`SELECT party_id::text AS party_id FROM acct_pos WHERE id = $1::bigint`, [poId]); partyId = x?.party_id ?? null; }
      }
    } else {
      const [s] = await db.query<{ q: number }>(`SELECT coalesce(sum(v.qty), 0)::int AS q FROM v_qlt_lot_qty v JOIN qlt_lots l ON l.id = v.lot_id WHERE l.option_id = $1::uuid`, [o.id]);
      const free = (await ledgerQty(db, o.id)) - n(s?.q);
      if (qty > free) throw new PolicyViolation('QLT_LOT_OPEN', `로트로 나누지 않은 원가 장부 수량은 {0}개입니다 — 시작 재고는 그만큼까지입니다.`.replace('{0}', String(Math.max(free, 0))));
    }
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO qlt_lots (option_id, lot_no, made_on, expires_on, in_kind, in_qty, in_move_id, party_id, po_id, memo, created_by)
       VALUES ($1::uuid, $2, $3::date, $4::date, $5, $6, $7::bigint, $8::bigint, $9::bigint, nullif($10, ''), $11) RETURNING id::text AS id`,
      [o.id, lotNo, b.madeOn || null, b.expiresOn, b.moveId ? 'MOVE' : 'OPEN', qty, b.moveId || null, partyId, poId, clean(b.memo, 200), actor]);
    return { ok: true, id: r!.id, note: `로트 ${lotNo}(${o.name} ${o.label} ${qty}개 · 유통기한 ${b.expiresOn})를 등록했습니다.` };
  });
}

/** POST /admin/qlt/lots/{id}/state — 정상 ↔ 보류 · 회수(사유 · 운영 알림) · 끝(남은 0) */
export async function setLotState(db: DatabaseService, id: string, state: string, reason: string | undefined, actor: string | null) {
  const l = await lotOf(db, id);
  if (!(LOT_STATES as readonly string[]).includes(state)) throw new PolicyViolation('QLT_LOT', '상태는 OK · HOLD · RECALL · CLOSED 중 하나입니다.');
  const note = clean(reason, 200);
  if (state === l.state) return { ok: true, id, state, note: '이미 그 상태입니다.' };
  if (l.state === 'CLOSED' || (l.state === 'RECALL' && state !== 'CLOSED')) throw new StateConflict('QLT_LOT_STATE', '회수 로트는 끝내기만 · 끝낸 로트는 그대로입니다.');
  if ((state === 'HOLD' || state === 'RECALL') && note.length < 2) throw new PolicyViolation('QLT_REASON', '보류 · 회수 사유(2자 이상)를 넣으십시오.');
  if (state === 'CLOSED' && l.qty !== 0) throw new StateConflict('QLT_LOT_STATE', `남은 수량이 {0}개라 끝낼 수 없습니다(로트 조정 · 공급사 반품 뒤).`.replace('{0}', String(l.qty)));
  await db.transaction(async () => {
    await db.query(`UPDATE qlt_lots SET state = $2, state_note = CASE WHEN $2 IN ('HOLD', 'RECALL') THEN $3 ELSE state_note END WHERE id = $1::bigint`, [id, state, note]);
    if (state === 'RECALL') {
      await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'QLT_LOT_RECALL', 'WARN', $1, $2::jsonb, clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'QLT_LOT_RECALL' AND detail->>'lot' = $3 AND resolved_at IS NULL)
         ON CONFLICT DO NOTHING`,
        [`로트 회수 — ${l.name} ${l.label} 로트 ${l.lot_no}(남은 ${l.qty}개) · 사유 ${note} — 소개몰 › 로트 · 유통기한 › 나간 곳`, JSON.stringify({ lot: id, lotNo: l.lot_no, reason: note, by: actor }), id]);
    }
    if (state === 'CLOSED') {
      await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '로트 끝' WHERE alert_code IN ('QLT_LOT_RECALL', 'QLT_LOT_EXPIRY') AND detail->>'lot' = $1 AND resolved_at IS NULL`, [id]);
    }
  });
  return { ok: true, id, state, stateKo: LOT_STATE_KO[state], note: `로트 ${l.lot_no} 상태를 바꿨습니다.` };
}

/** POST /admin/qlt/lots/{id}/adjust — 로트 조정(SUPER · 사유) = 원가 수불부 실사 조정(ADJUST) 한 줄 + 그 로트 수불 */
export async function adjustLot(db: DatabaseService, id: string, b: { qty: number; reason: string; whId?: string }, actor: string | null) {
  const l = await lotOf(db, id);
  const qty = Math.round(Number(b.qty));
  if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > 1_000_000) throw new PolicyViolation('QLT_LOT', '조정 수량은 0 이 아닌 정수(±1,000,000 안)입니다.');
  const reason = clean(b.reason, 160);
  if (reason.length < 2) throw new PolicyViolation('QLT_REASON', '조정 사유(2자 이상)를 넣으십시오.');
  if (l.state === 'CLOSED') throw new StateConflict('QLT_LOT_STATE', '끝낸 로트는 조정하지 않습니다.');
  if (qty < 0 && l.qty + qty < 0) throw new PolicyViolation('QLT_LOT', `로트 남은 수량은 {0}개입니다.`.replace('{0}', String(l.qty)));
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_stock:' || $1::text))`, [l.option_id]);
    const [wh] = b.whId
      ? await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_warehouses WHERE id::text = $1 AND active`, [String(b.whId)])
      : await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_warehouses WHERE is_main LIMIT 1`);
    if (!wh) throw new NotFound('없는 창고입니다.');
    if (qty < 0) {
      const [w] = await db.query<{ q: number }>(`SELECT coalesce(sum(qty), 0)::int AS q FROM v_acct_wh_stock WHERE option_id::text = $1 AND wh_id::text = $2`, [l.option_id, wh.id]);
      if (n(w?.q) + qty < 0) throw new PolicyViolation('QLT_LOT', `그 창고 수량은 {0}개입니다.`.replace('{0}', String(n(w?.q))));
    }
    const [m] = await db.query<{ id: string; qty_after: number }>(
      `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key, note, created_by, warehouse_id)
       VALUES ($1::uuid, $2::date, 'ADJUST', $3, 'QL:' || gen_random_uuid()::text, $4, $5, $6::bigint) RETURNING id::text AS id, qty_after`,
      [l.option_id, kstToday(), qty, `로트 ${l.lot_no} 조정 · ${reason}`.slice(0, 200), actor, wh.id]);
    await db.query(`INSERT INTO qlt_lot_moves (lot_id, kind, qty, move_id, note, created_by) VALUES ($1::bigint, 'ADJUST', $2, $3::bigint, $4, $5)`, [id, qty, m!.id, reason, actor]);
    await db.query(`INSERT INTO qlt_move_marks (move_id, mark, note) VALUES ($1::bigint, 'DONE', '로트 조정') ON CONFLICT DO NOTHING`, [m!.id]);
    return { ok: true, id, moveId: m!.id, note: `로트 ${l.lot_no} 를 ${qty}개 조정했습니다 — 원가 장부에도 실사 조정 한 줄(남은 ${m!.qty_after}개)이 들어갔습니다.` };
  });
}

/** PUT /admin/qlt/lot-products/{id} — 직판 상품 로트 관리 켜기 · 끄기(끄면 지금과 같음 · 로트 기록은 남음) */
export async function setLotProduct(db: DatabaseService, productId: string, on: boolean, actor: string | null) {
  if (!uuidOk(productId)) throw new NotFound('없는 상품입니다.');
  const [p] = await db.query<{ name: string; direct: boolean }>(
    `SELECT p.name, coalesce(s.type = 'DIRECT', false) AS direct FROM hlt_products p LEFT JOIN hlt_sellers s ON s.id = p.seller_id WHERE p.id::text = $1`, [productId]);
  if (!p) throw new NotFound('없는 상품입니다.');
  if (!p.direct) throw new PolicyViolation('QLT_LOT', '직판 상품만 로트 관리를 켭니다.');
  await db.query(
    `INSERT INTO qlt_lot_products (product_id, active, updated_by) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (product_id) DO UPDATE SET active = EXCLUDED.active, updated_by = EXCLUDED.updated_by`, [productId, on, actor]);
  return { ok: true, productId, on,
    note: on ? `${p.name} 로트 관리를 켰습니다 — 지금부터의 출고 · 반입에 로트를 붙입니다. 지금 있는 재고는 「시작 재고」로 로트를 등록하십시오.`
             : `${p.name} 로트 관리를 껐습니다 — 지금과 같이 돌고, 로트 기록은 남습니다.` };
}

/* ═════════════ 회수 — 나간 곳 ═════════════ */

/** GET /admin/qlt/lots/{id}/trace — 그 로트가 나간 주문 · 수출(ADMIN · SUPER · 이름 가림 · 전화 끝 4자리 · 볼 때마다 감사 기록) */
export async function traceLot(db: DatabaseService, id: string) {
  const l = await lotOf(db, id);
  const rows = await db.query<{ kind: string; date: string; qty: number; orderNo: string | null; orderStatus: string | null; shippedAt: string | null; member: string | null;
                                phoneTail: string | null; exportId: string | null; exportTitle: string | null; partyName: string | null; sourceKey: string }>(
    `SELECT CASE WHEN od.id IS NOT NULL THEN 'ORDER' WHEN m.source_key LIKE 'EXP-%' THEN 'EXPORT' ELSE 'OTHER' END AS kind,
            min(m.moved_on)::text AS date, -sum(x.qty)::int AS qty,
            od.order_no AS "orderNo", od.status AS "orderStatus", od.shipped_at AS "shippedAt",
            fn_mask_name(a.name) AS member, right(regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g'), 4) AS "phoneTail",
            ex.id::text AS "exportId", ex.title AS "exportTitle", ep.name AS "partyName", m.source_key AS "sourceKey"
       FROM qlt_lot_moves x JOIN acct_stock_moves m ON m.id = x.move_id
       LEFT JOIN hlt_order_items it ON it.id::text = m.source_key LEFT JOIN hlt_orders od ON od.id = it.order_id LEFT JOIN accounts a ON a.id = od.account_id
       LEFT JOIN acct_exports ex ON m.source_key LIKE 'EXP-%' AND ex.id::text = split_part(m.source_key, '-', 2) LEFT JOIN acct_parties ep ON ep.id = ex.party_id
      WHERE x.lot_id = $1::bigint AND x.kind IN ('OUT', 'RETURN') AND m.kind IN ('OUT_SALE', 'RETURN')
      GROUP BY od.id, od.order_no, od.status, od.shipped_at, a.name, a.phone, ex.id, ex.title, ep.name, m.source_key
      ORDER BY min(m.moved_on), m.source_key LIMIT 2000`, [id]);
  const items = rows.map((r) => ({ ...r, qty: n(r.qty) }));
  const out = items.filter((r) => r.qty > 0);
  /* 감사 기록 — 무엇을 봤는지(로트 · 건수)만 · 사람 정보는 남기지 않음 */
  const c = RequestCtx.get();
  await db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
     VALUES ($1, $2, 'QLT_LOT_TRACE', 'HLT_PRODUCT', NULL, $3::jsonb, $4, $5)`,
    [c?.actorId ?? null, c?.actorRole ?? null, JSON.stringify({ lot: id, lotNo: l.lot_no, orders: out.filter((r) => r.kind === 'ORDER').length, exports: out.filter((r) => r.kind === 'EXPORT').length }),
     c?.ip ?? null, c?.userAgent ?? null]).catch((e) => console.error('[AUDIT_WRITE_FAILED] QLT_LOT_TRACE', (e as Error).message));
  return {
    lot: { id, lotNo: l.lot_no, code: l.code, name: l.name, label: l.label, expiresOn: l.expires_on, state: l.state, qty: l.qty },
    items: out, returned: items.filter((r) => r.qty <= 0).length,
    count: { orders: out.filter((r) => r.kind === 'ORDER').length, exports: out.filter((r) => r.kind === 'EXPORT').length, qty: out.reduce((a, r) => a + r.qty, 0) },
    note: '회수 대상 연락은 주문 번호로 「소개몰 주문」 화면에서 하십시오 — 여기서는 이름을 가리고 전화 끝 4자리만 보입니다(조회는 감사 기록에 남음).',
  };
}

/* ═════════════ 발송 전 FEFO 제안 · 출고 지정 ═════════════ */

export type LotCand = { id: string; lot_no: string; expires_on: string; qty: number };
/** 옵션의 쓸 수 있는 로트(정상 · 그날 지나지 않음 · 남은 수량) — 먼저 끝나는 것부터 */
async function fefoLots(db: DatabaseService, optionId: string, day: string) {
  const rows = await db.query<LotCand>(
    `SELECT l.id::text AS id, l.lot_no, l.expires_on::text AS expires_on, q.qty
       FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id
      WHERE l.option_id::text = $1 AND l.state = 'OK' AND l.expires_on >= $2::date AND q.qty > 0
      ORDER BY l.expires_on, l.id`, [optionId, day]);
  return rows.map((r) => ({ ...r, qty: n(r.qty) }));
}

/** GET /admin/qlt/ship-queue — 발송 전(결제 · 준비) 직판 주문 중 로트 관리 상품 줄 · FEFO 제안 · 지정한 로트 */
export async function shipQueue(db: DatabaseService) {
  const today = kstToday();
  const items = await db.query<{ itemId: string; orderId: string; orderNo: string; status: string; paidAt: string | null; optionId: string; code: string; name: string; label: string; qty: number }>(
    `SELECT it.id::text AS "itemId", od.id::text AS "orderId", od.order_no AS "orderNo", od.status, od.paid_at AS "paidAt", it.option_id::text AS "optionId",
            p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label, it.qty
       FROM hlt_orders od JOIN hlt_sellers s ON s.id = od.seller_id AND s.type = 'DIRECT'
       JOIN hlt_order_items it ON it.order_id = od.id JOIN hlt_product_options o ON o.id = it.option_id JOIN hlt_products p ON p.id = o.product_id
       JOIN qlt_lot_products lp ON lp.product_id = p.id AND lp.active
      WHERE od.status IN ('PAID', 'PREPARING') AND od.shipped_at IS NULL
      ORDER BY od.paid_at NULLS LAST, od.order_no, it.id LIMIT 300`);
  const picks = await db.query<{ itemId: string; lotId: string; lotNo: string; qty: number; expiresOn: string }>(
    `SELECT k.order_item_id::text AS "itemId", k.lot_id::text AS "lotId", l.lot_no AS "lotNo", k.qty, l.expires_on::text AS "expiresOn"
       FROM qlt_lot_picks k JOIN qlt_lots l ON l.id = k.lot_id WHERE k.consumed_move_id IS NULL ORDER BY k.id`);
  /* 지정해 둔 수량은 제안에서 빼고 셈(같은 로트를 두 주문에 겹쳐 제안하지 않게) */
  const held = new Map<string, number>();
  for (const k of picks) held.set(k.lotId, (held.get(k.lotId) ?? 0) + n(k.qty));
  const cache = new Map<string, LotCand[]>();
  const out = [];
  for (const it of items) {
    const mine = picks.filter((k) => k.itemId === it.itemId);
    let need = n(it.qty) - mine.reduce((a, k) => a + n(k.qty), 0);
    const lots = cache.get(it.optionId) ?? (cache.set(it.optionId, await fefoLots(db, it.optionId, today)), cache.get(it.optionId)!);
    const suggest: Array<{ lotId: string; lotNo: string; expiresOn: string; qty: number }> = [];
    for (const l of lots) {
      if (need <= 0) break;
      const free = l.qty - (held.get(l.id) ?? 0);
      if (free <= 0) continue;
      const take = Math.min(free, need);
      suggest.push({ lotId: l.id, lotNo: l.lot_no, expiresOn: l.expires_on, qty: take });
      held.set(l.id, (held.get(l.id) ?? 0) + take); need -= take;
    }
    out.push({ ...it, qty: n(it.qty), picks: mine.map((k) => ({ ...k, qty: n(k.qty) })), suggest, short: Math.max(need, 0) });
  }
  return { items: out, note: '발송 전에 로트를 확정해 두면 배송 뒤 그 로트로 붙습니다 — 확정하지 않으면 배송 뒤 먼저 끝나는 로트부터 저절로 붙습니다.' };
}

export interface PickInput { itemId: string; lotId: string; qty: number }

/** POST /admin/qlt/picks — 한 주문의 출고 로트 확정(쓰기 전 지정은 바꿈) */
export async function savePicks(db: DatabaseService, orderId: string, picks: PickInput[], actor: string | null) {
  if (!uuidOk(orderId)) throw new NotFound('없는 주문입니다.');
  const [od] = await db.query<{ status: string; shipped: boolean; direct: boolean }>(
    `SELECT od.status, od.shipped_at IS NOT NULL AS shipped, coalesce(s.type = 'DIRECT', false) AS direct FROM hlt_orders od LEFT JOIN hlt_sellers s ON s.id = od.seller_id WHERE od.id::text = $1`, [orderId]);
  if (!od) throw new NotFound('없는 주문입니다.');
  if (!od.direct) throw new PolicyViolation('QLT_PICK', '직판 주문만 로트를 지정합니다.');
  if (od.shipped || !['PAID', 'PREPARING'].includes(od.status)) throw new StateConflict('QLT_PICK_STATE', '발송 전(결제 · 준비) 주문만 로트를 지정합니다.');
  const items = await db.query<{ id: string; option_id: string; qty: number }>(`SELECT id::text AS id, option_id::text AS option_id, qty FROM hlt_order_items WHERE order_id::text = $1`, [orderId]);
  const byItem = new Map(items.map((i) => [i.id, i]));
  const sum = new Map<string, number>();
  const today = kstToday();
  for (const p of picks) {
    const it = byItem.get(p.itemId);
    if (!it) throw new PolicyViolation('QLT_PICK', '그 주문의 품목이 아닙니다.');
    const q = Math.round(Number(p.qty));
    if (!(q >= 1)) throw new PolicyViolation('QLT_PICK', '지정 수량은 1 이상입니다.');
    sum.set(p.itemId, (sum.get(p.itemId) ?? 0) + q);
    if ((sum.get(p.itemId) ?? 0) > n(it.qty)) throw new PolicyViolation('QLT_PICK', '지정 수량 합이 주문 수량을 넘습니다.');
  }
  return db.transaction(async () => {
    const opts = [...new Set(items.map((i) => i.option_id).filter(Boolean))].sort();
    for (const o of opts) await db.query(`SELECT pg_advisory_xact_lock(hashtext('qlt_lot:' || $1::text))`, [o]);
    await db.query(`DELETE FROM qlt_lot_picks WHERE consumed_move_id IS NULL AND order_item_id IN (SELECT id FROM hlt_order_items WHERE order_id::text = $1)`, [orderId]);
    for (const p of picks) {
      const it = byItem.get(p.itemId)!;
      const [l] = idOk(p.lotId) ? await db.query<{ option_id: string; state: string; expires_on: string; qty: number; held: number }>(
        `SELECT l.option_id::text AS option_id, l.state, l.expires_on::text AS expires_on, q.qty,
                coalesce((SELECT sum(k.qty) FROM qlt_lot_picks k WHERE k.lot_id = l.id AND k.consumed_move_id IS NULL), 0)::int AS held
           FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id WHERE l.id = $1::bigint`, [p.lotId]) : [];
      if (!l) throw new NotFound('없는 로트입니다.');
      if (l.option_id !== it.option_id) throw new PolicyViolation('QLT_PICK', '품목과 다른 옵션의 로트입니다.');
      if (l.state !== 'OK') throw new PolicyViolation('QLT_PICK', '보류 · 회수 · 끝낸 로트는 지정하지 않습니다.');
      if (l.expires_on < today) throw new PolicyViolation('QLT_PICK', '유통기한이 지난 로트는 지정하지 않습니다.');
      const q = Math.round(Number(p.qty));
      if (n(l.qty) - n(l.held) < q) throw new PolicyViolation('QLT_PICK', `그 로트에 지정할 수 있는 수량은 {0}개입니다.`.replace('{0}', String(Math.max(n(l.qty) - n(l.held), 0))));
      await db.query(`INSERT INTO qlt_lot_picks (order_item_id, lot_id, qty, created_by) VALUES ($1::uuid, $2::bigint, $3, $4)`, [p.itemId, p.lotId, q, actor]);
    }
    return { ok: true, orderId, picks: picks.length, note: picks.length ? '출고 로트를 확정했습니다 — 배송 뒤 이 로트로 붙습니다.' : '출고 로트 지정을 지웠습니다(배송 뒤 먼저 끝나는 것부터).' };
  });
}

/* ═════════════ 정기 작업 ═════════════ */

/** 한 출고(또는 줄이는 실사) 줄에 로트 붙이기 — 지정 → FEFO · 모자라면 SHORT */
async function allocOne(db: DatabaseService, mv: { id: string; option_id: string; kind: string; qty: number; day: string; item_id: string | null }) {
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('qlt_lot:' || $1::text))`, [mv.option_id]);
    const [done] = await db.query(`SELECT 1 FROM qlt_move_marks WHERE move_id = $1::bigint`, [mv.id]);
    if (done) return 'SEEN';
    let need = Math.abs(n(mv.qty));
    const kind = mv.kind === 'OUT_SALE' ? 'OUT' : 'ADJUST';
    /* 로트마다 한 줄(수불부 줄 × 로트 고유) — 지정 몫과 FEFO 몫을 모아 넣음 */
    const plan = new Map<string, number>();
    if (mv.item_id) {
      const picks = await db.query<{ id: string; lot_id: string; qty: number; bal: number; state: string }>(
        `SELECT k.id::text AS id, k.lot_id::text AS lot_id, k.qty, q.qty AS bal, l.state
           FROM qlt_lot_picks k JOIN qlt_lots l ON l.id = k.lot_id JOIN v_qlt_lot_qty q ON q.lot_id = k.lot_id
          WHERE k.order_item_id = $1::uuid AND k.consumed_move_id IS NULL ORDER BY l.expires_on, k.id`, [mv.item_id]);
      for (const k of picks) {
        const take = k.state === 'CLOSED' ? 0 : Math.min(n(k.qty), need, n(k.bal) - (plan.get(k.lot_id) ?? 0));
        if (take > 0) { plan.set(k.lot_id, (plan.get(k.lot_id) ?? 0) + take); need -= take; }
        await db.query(`UPDATE qlt_lot_picks SET consumed_move_id = $2::bigint WHERE id = $1::bigint`, [k.id, mv.id]);
      }
    }
    if (need > 0) {
      for (const l of await fefoLots(db, mv.option_id, mv.day)) {
        if (need <= 0) break;
        const take = Math.min(l.qty - (plan.get(l.id) ?? 0), need);
        if (take > 0) { plan.set(l.id, (plan.get(l.id) ?? 0) + take); need -= take; }
      }
    }
    for (const [lotId, take] of plan) {
      await db.query(`INSERT INTO qlt_lot_moves (lot_id, kind, qty, move_id, order_item_id, note) VALUES ($1::bigint, $2, $3, $4::bigint, $5::uuid, $6)`,
        [lotId, kind, -take, mv.id, mv.item_id, kind === 'OUT' ? '출고' : '실사 줄임(FEFO)']);
    }
    await db.query(`INSERT INTO qlt_move_marks (move_id, mark, short_qty, note) VALUES ($1::bigint, $2, $3, $4)`,
      [mv.id, need > 0 ? 'SHORT' : 'DONE', Math.max(need, 0), need > 0 ? '로트 모자람' : null]);
    return need > 0 ? 'SHORT' : 'DONE';
  });
}

/** 정기 작업 qlt_lot_alloc(매시간) — 로트 관리 상품의 출고(배송 뒤) · 줄이는 실사 → 로트 · 반입 → 나갔던 로트로 · 모자라면 QLT_LOT_SHORT */
export async function qltLotAllocJob(db: DatabaseService) {
  let done = 0, short = 0, skip = 0, back = 0; const failed: string[] = [];
  const outs = await db.query<{ id: string; option_id: string; kind: string; qty: number; day: string; item_id: string | null; shipped: boolean | null; returned: boolean }>(
    `SELECT m.id::text AS id, m.option_id::text AS option_id, m.kind, m.qty, m.moved_on::text AS day, it.id::text AS item_id,
            (od.shipped_at IS NOT NULL OR od.status IN ('SHIPPED', 'DELIVERED', 'RETURNED')) AS shipped,
            EXISTS (SELECT 1 FROM acct_stock_moves r WHERE r.kind = 'RETURN' AND r.source_key = m.source_key) AS returned
       FROM acct_stock_moves m JOIN hlt_product_options o ON o.id = m.option_id
       JOIN qlt_lot_products lp ON lp.product_id = o.product_id AND lp.active AND m.created_at >= lp.on_at
       LEFT JOIN hlt_order_items it ON it.id::text = m.source_key LEFT JOIN hlt_orders od ON od.id = it.order_id
      WHERE (m.kind = 'OUT_SALE' OR (m.kind = 'ADJUST' AND m.qty < 0))
        AND NOT EXISTS (SELECT 1 FROM qlt_move_marks k WHERE k.move_id = m.id)
      ORDER BY m.id LIMIT 500`);
  for (const m of outs) {
    try {
      if (m.item_id && !m.shipped) {
        /* 주문 출고는 배송 뒤 — 배송 전에 취소 · 반품 반입이 생겼으면 로트 없이 끝(SKIP) */
        if (m.returned) {
          await db.query(`INSERT INTO qlt_move_marks (move_id, mark, note) VALUES ($1::bigint, 'SKIP', '배송 전 취소') ON CONFLICT DO NOTHING`, [m.id]);
          skip++;
        }
        continue;
      }
      const r = await allocOne(db, m);
      if (r === 'DONE') done++; else if (r === 'SHORT') short++;
    } catch (e) { failed.push(`OUT ${m.id}: ${String((e as Error)?.message ?? e).slice(0, 100)}`); }
  }
  /* 반입 — 같은 근거(source_key)의 출고에 붙인 로트로 되돌림 · 출고가 SKIP · 로트 관리 전이면 SKIP · 아직이면 다음 차례 */
  const backs = await db.query<{ id: string; option_id: string; qty: number; out_id: string; out_mark: string | null; out_before: boolean }>(
    `SELECT r.id::text AS id, r.option_id::text AS option_id, r.qty, o2.id::text AS out_id, k.mark AS out_mark, (o2.created_at < lp.on_at) AS out_before
       FROM acct_stock_moves r JOIN hlt_product_options o ON o.id = r.option_id
       JOIN qlt_lot_products lp ON lp.product_id = o.product_id AND lp.active AND r.created_at >= lp.on_at
       JOIN acct_stock_moves o2 ON o2.kind = 'OUT_SALE' AND o2.source_key = r.source_key
       LEFT JOIN qlt_move_marks k ON k.move_id = o2.id
      WHERE r.kind = 'RETURN' AND NOT EXISTS (SELECT 1 FROM qlt_move_marks z WHERE z.move_id = r.id)
      ORDER BY r.id LIMIT 500`);
  for (const b of backs) {
    try {
      if (b.out_before || b.out_mark === 'SKIP') {
        await db.query(`INSERT INTO qlt_move_marks (move_id, mark, note) VALUES ($1::bigint, 'SKIP', $2) ON CONFLICT DO NOTHING`, [b.id, b.out_before ? '로트 관리 전 출고' : '배송 전 취소']);
        skip++; continue;
      }
      if (!b.out_mark) continue;
      await db.transaction(async () => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext('qlt_lot:' || $1::text))`, [b.option_id]);
        const [seen] = await db.query(`SELECT 1 FROM qlt_move_marks WHERE move_id = $1::bigint`, [b.id]);
        if (seen) return;
        const lots = await db.query<{ lot_id: string; qty: number; item: string | null }>(
          `SELECT lot_id::text AS lot_id, -sum(qty)::int AS qty, max(order_item_id::text) AS item FROM qlt_lot_moves WHERE move_id = $1::bigint AND kind = 'OUT' GROUP BY lot_id ORDER BY lot_id`, [b.out_id]);
        for (const l of lots) {
          if (n(l.qty) > 0) await db.query(`INSERT INTO qlt_lot_moves (lot_id, kind, qty, move_id, order_item_id, note) VALUES ($1::bigint, 'RETURN', $2, $3::bigint, $4::uuid, '취소 · 반품 반입')`, [l.lot_id, n(l.qty), b.id, l.item]);
        }
        await db.query(`INSERT INTO qlt_move_marks (move_id, mark, note) VALUES ($1::bigint, 'DONE', '반입')`, [b.id]);
        back++;
      });
    } catch (e) { failed.push(`RETURN ${b.id}: ${String((e as Error)?.message ?? e).slice(0, 100)}`); }
  }
  /* 로트가 모자란 줄 — 지난 알림 뒤 새로 생겼고 풀리지 않은 알림이 없으면 하나 */
  const [z] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM qlt_move_marks WHERE mark = 'SHORT'
        AND marked_at > coalesce((SELECT max(raised_at) FROM ops_alerts WHERE alert_code = 'QLT_LOT_SHORT'), '-infinity'::timestamptz)`);
  let alerted = false;
  if (n(z?.n) > 0) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'QLT_LOT_SHORT', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'QLT_LOT_SHORT' AND resolved_at IS NULL)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`로트가 모자란 출고 줄 ${n(z?.n)}개 — 로트를 등록하지 않은 입고가 있는지 보십시오(소개몰 › 로트 · 유통기한)`, JSON.stringify({ count: n(z?.n) })]);
    alerted = r.length > 0;
  }
  return { done, short, skip, back, alerted, failed: failed.slice(0, 10), failedCount: failed.length };
}

/** 유통기한 임박 · 지남 알림(qlt_daily 안) — 로트 · 날짜마다 한 번 · 다 쓰거나 회수 · 끝내면 풀림 · 끄면 모두 풂 */
export async function qltLotExpiryCheck(db: DatabaseService) {
  const s = await settingsOf(db);
  const today = kstToday();
  const want = new Map<string, { lot: string; lotNo: string; name: string; label: string; expiresOn: string; days: number; qty: number }>();
  if (s.on) {
    const rows = await db.query<{ id: string; lot_no: string; name: string; label: string; expires_on: string; days: number; qty: number }>(
      `SELECT l.id::text AS id, l.lot_no, p.name, fn_hlt_option_label(o.months, o.tag) AS label, l.expires_on::text AS expires_on, (l.expires_on - $1::date)::int AS days, q.qty
         FROM qlt_lots l JOIN v_qlt_lot_qty q ON q.lot_id = l.id JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = l.product_id
        WHERE l.state IN ('OK', 'HOLD') AND q.qty > 0 AND l.expires_on <= $2::date
        ORDER BY l.expires_on, l.id LIMIT 200`, [today, addDays(today, s.days)]);
    for (const r of rows) want.set(`${r.id}|${r.expires_on}|${n(r.days) < 0 ? 'X' : 'S'}`, { lot: r.id, lotNo: r.lot_no, name: r.name, label: r.label, expiresOn: r.expires_on, days: n(r.days), qty: n(r.qty) });
  }
  const open = await db.query<{ id: string; key: string }>(`SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'QLT_LOT_EXPIRY' AND resolved_at IS NULL`);
  let resolved = 0;
  for (const a of open) {
    if (!want.has(String(a.key ?? ''))) {
      await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint`, [a.id, s.on ? '다 썼거나 회수 · 끝 · 지남으로 바뀜' : '알림 끔']);
      resolved++;
    }
  }
  const made: string[] = [];
  for (const [key, x] of want) {
    const title = x.days < 0
      ? `로트 유통기한 지남 — ${x.name} ${x.label} 로트 ${x.lotNo} ${x.expiresOn}(${-x.days}일 지남) · 남은 ${x.qty}개 — 소개몰 › 로트 · 유통기한(보류 · 조정)`
      : `로트 유통기한 임박 — ${x.name} ${x.label} 로트 ${x.lotNo} ${x.expiresOn}(D-${x.days}) · 남은 ${x.qty}개 — 소개몰 › 로트 · 유통기한`;
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'QLT_LOT_EXPIRY', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'QLT_LOT_EXPIRY' AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [title, JSON.stringify({ key, lot: x.lot, lotNo: x.lotNo, expiresOn: x.expiresOn, days: x.days, qty: x.qty }), key]);
    if (ins.length) made.push(key);
  }
  return { on: s.on, days: s.days, made, resolved };
}

import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { addPo } from './trade';

/* ---------------------------------------------------------------------
 * v10.478 (D266 · docs/616) 안전 재고 · 재주문 — 대표 11/20 「㊱」
 *   규칙(acct_stock_rules) — 직판 상품 옵션마다 최소 재고 · 재주문 수량 · 매입처 · 단가(비우면 ⑫ 재고 평균 단가)
 *   재고 위치 = 판매용 재고(hlt_product_options.stock · 주문 때 빠지고 취소 · 반품 때 돌아옴) + 발주 중(㉑ acct_pos ORDERED 의 그 옵션 수량)
 *   정기 작업 acct_reorder(매시간 · acct.reorder on 일 때):
 *     위치 < 최소 → 운영 알림 STOCK_REORDER(옵션마다 하나 · 위치가 최소 이상이 되거나 규칙을 끄면 풀림)
 *                 + 재주문 초안(매입처마다 열린 초안 하나 · 그 옵션 줄이 없을 때만 더함 · 수량 = max(재주문 수량, 최소 − 위치))
 *   초안은 사람이 고치고(수량 · 단가 · 빼기) 「발주로 넣기」를 눌러야 ㉑ 국내 발주(addPo · ORDERED)가 됨 — 자동 발주 · 자동 보내기 없음
 *   발주로 넣으면 그 수량이 「발주 중」에 들어가 알림이 풀림 · 「버림」은 사유(다음 점검에서 아직 모자라면 새 초안)
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 재주문 초안입니다.'); return id; };

/** 직판 옵션마다 재고 위치 · 규칙(규칙 없는 옵션도 — 화면에서 규칙을 넣게) */
const POSITION_SQL = `
  SELECT o.id::text AS "optionId", p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label, o.is_active AS active, o.stock AS "shopQty",
         coalesce((SELECT sum(l.qty) FROM acct_po_lines l JOIN acct_pos po ON po.id = l.po_id WHERE po.state = 'ORDERED' AND l.option_id = o.id), 0)::int AS "onOrder",
         r.min_qty AS "minQty", r.reorder_qty AS "reorderQty", r.party_id::text AS "partyId", pt.name AS "partyName", r.unit_price::bigint AS "unitPrice", coalesce(r.active, false) AS "ruleOn", r.memo,
         (SELECT round(x.avg_cost_after)::bigint FROM acct_stock_moves x WHERE x.option_id = o.id ORDER BY x.id DESC LIMIT 1) AS "avgCost"
    FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
    LEFT JOIN acct_stock_rules r ON r.option_id = o.id LEFT JOIN acct_parties pt ON pt.id = r.party_id
   WHERE o.is_active OR r.option_id IS NOT NULL
   ORDER BY (r.active IS TRUE) DESC, p.name, o.sort LIMIT 500`;

export interface PosRow { optionId: string; code: string; name: string; label: string | null; active: boolean; shopQty: number; onOrder: number; minQty: number | null; reorderQty: number | null;
  partyId: string | null; partyName: string | null; unitPrice: string | null; ruleOn: boolean; memo: string | null; avgCost: string | null }

async function positions(db: DatabaseService) {
  const rows = await db.query<PosRow>(POSITION_SQL);
  return rows.map((r) => {
    const position = n(r.shopQty) + n(r.onOrder);
    const below = r.ruleOn && r.minQty != null && position < n(r.minQty);
    return { ...r, shopQty: n(r.shopQty), onOrder: n(r.onOrder), position, below, unitPrice: r.unitPrice == null ? null : n(r.unitPrice), avgCost: r.avgCost == null ? null : n(r.avgCost),
             need: below ? Math.max(n(r.reorderQty), n(r.minQty) - position) : 0 };
  });
}

async function draftsOf(db: DatabaseService, open: boolean) {
  const ds = await db.query<any>(
    `SELECT d.id::text AS id, d.party_id::text AS "partyId", p.name AS "partyName", d.state, d.po_id::text AS "poId", d.made_by_job AS "madeByJob", d.dismiss_note AS "dismissNote",
            d.created_at AS "createdAt", d.updated_at AS "updatedAt", d.done_at AS "doneAt", b.name AS "doneBy"
       FROM acct_reorder_drafts d LEFT JOIN acct_parties p ON p.id = d.party_id LEFT JOIN accounts b ON b.id = d.done_by
      WHERE ($1::boolean AND d.state = 'DRAFT') OR (NOT $1::boolean AND d.state <> 'DRAFT') ORDER BY d.id DESC LIMIT 30`, [open]);
  if (!ds.length) return [];
  const ls = await db.query<any>(
    `SELECT l.draft_id::text AS "draftId", l.option_id::text AS "optionId", p.name, fn_hlt_option_label(o.months, o.tag) AS label, l.qty, l.unit_price::bigint AS "unitPrice",
            l.position_qty AS "positionQty", l.min_qty AS "minQty"
       FROM acct_reorder_draft_lines l JOIN hlt_product_options o ON o.id = l.option_id JOIN hlt_products p ON p.id = o.product_id
      WHERE l.draft_id = ANY($1::bigint[]) ORDER BY l.id`, [ds.map((d: any) => d.id)]);
  return ds.map((d: any) => {
    const lines = ls.filter((l: any) => l.draftId === d.id).map((l: any) => ({ ...l, unitPrice: n(l.unitPrice), amount: n(l.qty) * n(l.unitPrice) }));
    return { ...d, lines, total: lines.reduce((a: number, l: any) => a + l.amount, 0) };
  });
}

/** GET /admin/acct/reorder — 옵션별 재고 위치 · 규칙 · 열린 초안 · 끝난 초안 30 */
export async function reorderView(db: DatabaseService) {
  const [s] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.reorder'`);
  const items = await positions(db);
  const parties = await db.query(`SELECT id::text AS id, name FROM acct_parties WHERE kind IN ('SUPPLIER', 'BOTH') ORDER BY name LIMIT 300`);
  return { on: (s?.value ?? 'on') === 'on', items, below: items.filter((x) => x.below).length, rules: items.filter((x) => x.ruleOn).length,
           drafts: await draftsOf(db, true), done: await draftsOf(db, false), parties,
           note: '재고 위치 = 판매용 재고 + 국내 발주 중 수량입니다. 최소 밑이면 매시간 운영 알림과 재주문 초안(매입처마다)을 만듭니다 — 발주는 「발주로 넣기」를 눌러야 생기고, 거래처에 보내는 일은 없습니다.' };
}

export interface RuleIn { minQty: number; reorderQty: number; partyId?: string; unitPrice?: number | null; active?: boolean; memo?: string }

/** PUT /admin/acct/reorder/rules/{optionId} — 넣기 · 고치기(보낸 칸 · 끄기는 active false) */
export async function setReorderRule(db: DatabaseService, optionId: string, b: RuleIn, actor: string | null) {
  if (!UUID.test(optionId ?? '')) throw new NotFound('없는 상품 옵션입니다.');
  const [o] = await db.query(
    `SELECT 1 FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.id::text = $1`, [optionId]);
  if (!o) throw new NotFound('직판 상품 옵션이 아닙니다.');
  const min = Math.trunc(n(b.minQty)), rq = Math.trunc(n(b.reorderQty));
  if (min < 0 || min > 1_000_000) throw new PolicyViolation('REORDER_MIN', '최소 재고는 0 ~ 1,000,000개입니다.');
  if (rq < 1 || rq > 1_000_000) throw new PolicyViolation('REORDER_QTY', '재주문 수량은 1 ~ 1,000,000개입니다.');
  let partyId: string | null = null;
  if (b.partyId) {
    if (!/^\d{1,18}$/.test(b.partyId)) throw new PolicyViolation('REORDER_PARTY', '없는 거래처입니다.');
    const [p] = await db.query(`SELECT 1 FROM acct_parties WHERE id = $1::bigint`, [b.partyId]);
    if (!p) throw new PolicyViolation('REORDER_PARTY', '없는 거래처입니다.');
    partyId = b.partyId;
  }
  const up = b.unitPrice == null ? null : Math.trunc(n(b.unitPrice));
  if (up != null && (up < 0 || up > 10_000_000_000)) throw new PolicyViolation('REORDER_PRICE', '단가가 맞지 않습니다.');
  const memo = String(b.memo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  await db.query(
    `INSERT INTO acct_stock_rules (option_id, min_qty, reorder_qty, party_id, unit_price, active, memo, created_by, updated_by)
     VALUES ($1::uuid, $2::int, $3::int, $4::bigint, $5::bigint, $6::boolean, $7, $8, $8)
     ON CONFLICT (option_id) DO UPDATE SET min_qty = EXCLUDED.min_qty, reorder_qty = EXCLUDED.reorder_qty, party_id = EXCLUDED.party_id, unit_price = EXCLUDED.unit_price,
                                           active = EXCLUDED.active, memo = EXCLUDED.memo, updated_by = EXCLUDED.updated_by`,
    [optionId, min, rq, partyId, up, b.active !== false, memo, actor]);
  return { ok: true, optionId, note: b.active === false ? '안전 재고 규칙을 껐습니다(알림 · 초안 없음).' : `안전 재고 규칙을 넣었습니다 — 최소 ${min}개 · 재주문 ${rq}개.` };
}

/** 정기 작업 acct_reorder(매시간) · POST /admin/acct/reorder/run — 알림 넣기 · 풀기 · 초안 줄 더하기 */
export async function acctReorderJob(db: DatabaseService) {
  const [s] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.reorder'`);
  const items = await positions(db);
  const belowIds = new Set(items.filter((x) => x.below).map((x) => x.optionId));
  /* 풀기 — 위치가 올라왔거나 규칙을 껐거나 스위치를 끔 */
  const open = await db.query<{ id: string; opt: string }>(`SELECT id::text AS id, detail->>'option' AS opt FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND resolved_at IS NULL`);
  const on = (s?.value ?? 'on') === 'on';
  let resolved = 0;
  for (const a of open) {
    if (on && belowIds.has(a.opt)) continue;
    resolved += (await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint AND resolved_at IS NULL RETURNING id`,
      [a.id, on ? '재고 위치가 최소 이상' : '재주문 알림 끔'])).length;
  }
  if (!on) return { on: false, below: belowIds.size, made: 0, resolved, lines: 0, drafts: [] as string[] };
  let made = 0, lines = 0; const drafts = new Set<string>();
  for (const x of items.filter((i) => i.below)) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'STOCK_REORDER', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND resolved_at IS NULL AND detail->>'option' = $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [x.position <= 0 ? 'CRITICAL' : 'WARN', `${x.name} ${x.label ?? ''} 재고 ${x.shopQty}개 + 발주 중 ${x.onOrder}개 — 최소 ${x.minQty}개 밑입니다(회계 › 안전 재고 · 재주문)`.replace(/\s+/g, ' '),
       JSON.stringify({ option: x.optionId, code: x.code, shopQty: x.shopQty, onOrder: x.onOrder, minQty: x.minQty }), x.optionId]);
    made += r.length;
    /* 초안 — 그 옵션이 열린 초안 어디에도 없을 때만(사람이 고친 줄을 덮지 않음) */
    const [has] = await db.query(
      `SELECT 1 FROM acct_reorder_draft_lines l JOIN acct_reorder_drafts d ON d.id = l.draft_id WHERE d.state = 'DRAFT' AND l.option_id::text = $1`, [x.optionId]);
    if (has) continue;
    const did = await db.transaction(async () => {
      const [d0] = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM acct_reorder_drafts WHERE state = 'DRAFT' AND coalesce(party_id, 0) = coalesce($1::bigint, 0) FOR UPDATE`, [x.partyId]);
      const id = d0?.id ?? (await db.query<{ id: string }>(
        `INSERT INTO acct_reorder_drafts (party_id, made_by_job) VALUES ($1::bigint, true) ON CONFLICT DO NOTHING RETURNING id::text AS id`, [x.partyId]))[0]?.id;
      if (!id) return null;
      const ins = await db.query(
        `INSERT INTO acct_reorder_draft_lines (draft_id, option_id, qty, unit_price, position_qty, min_qty) VALUES ($1::bigint, $2::uuid, $3::int, $4::bigint, $5::int, $6::int)
         ON CONFLICT (draft_id, option_id) DO NOTHING RETURNING id`,
        [id, x.optionId, x.need, x.unitPrice ?? x.avgCost ?? 0, x.position, n(x.minQty)]);
      lines += ins.length;
      if (ins.length) await db.query(`UPDATE acct_reorder_drafts SET updated_at = now() WHERE id = $1::bigint`, [id]);
      return id;
    });
    if (did) drafts.add(did);
  }
  return { on: true, below: belowIds.size, made, resolved, lines, drafts: [...drafts] };
}

/** PUT /admin/acct/reorder/drafts/{id}/lines — 초안 줄 바꾸기(보낸 옵션만 · qty 0 = 빼기) · 매입처 */
export async function editDraft(db: DatabaseService, id: string, b: { partyId?: string; lines?: Array<{ optionId: string; qty: number; unitPrice?: number }> }) {
  idOk(id);
  const [d] = await db.query<{ state: string }>(`SELECT state FROM acct_reorder_drafts WHERE id = $1::bigint`, [id]);
  if (!d) throw new NotFound('없는 재주문 초안입니다.');
  if (d.state !== 'DRAFT') throw new StateConflict('REORDER_STATE', '발주로 넣었거나 버린 초안은 고치지 않습니다.');
  const lines = b.lines ?? [];
  if (!lines.length && b.partyId === undefined) throw new PolicyViolation('REORDER_EMPTY', '바꿀 것이 없습니다.');
  if (lines.length > 50) throw new PolicyViolation('REORDER_LINES', '품목은 50줄까지입니다.');
  for (const l of lines) {
    if (!UUID.test(l.optionId ?? '')) throw new PolicyViolation('REORDER_LINES', '상품 옵션 번호가 맞지 않습니다.');
    const q = Math.trunc(n(l.qty));
    if (q < 0 || q > 1_000_000) throw new PolicyViolation('REORDER_LINES', '수량은 0 ~ 1,000,000개입니다(0 은 빼기).');
    if (l.unitPrice != null && (Math.trunc(n(l.unitPrice)) < 0 || n(l.unitPrice) > 10_000_000_000)) throw new PolicyViolation('REORDER_LINES', '단가가 맞지 않습니다.');
  }
  let partyId: string | null | undefined;
  if (b.partyId !== undefined) {
    partyId = b.partyId || null;
    if (partyId && !/^\d{1,18}$/.test(partyId)) throw new PolicyViolation('REORDER_PARTY', '없는 거래처입니다.');
    if (partyId) { const [p] = await db.query(`SELECT 1 FROM acct_parties WHERE id = $1::bigint`, [partyId]); if (!p) throw new PolicyViolation('REORDER_PARTY', '없는 거래처입니다.'); }
    const [other] = await db.query(`SELECT 1 FROM acct_reorder_drafts WHERE state = 'DRAFT' AND id <> $1::bigint AND coalesce(party_id, 0) = coalesce($2::bigint, 0)`, [id, partyId]);
    if (other) throw new StateConflict('REORDER_PARTY_DUP', '그 매입처의 열린 초안이 이미 있습니다 — 그 초안에 품목을 넣으십시오.');
  }
  await db.transaction(async () => {
    if (partyId !== undefined) await db.query(`UPDATE acct_reorder_drafts SET party_id = $2::bigint WHERE id = $1::bigint`, [id, partyId]);
    for (const l of lines) {
      const q = Math.trunc(n(l.qty));
      if (q === 0) { await db.query(`DELETE FROM acct_reorder_draft_lines WHERE draft_id = $1::bigint AND option_id = $2::uuid`, [id, l.optionId]); continue; }
      const [ok] = await db.query(
        `SELECT 1 FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.id = $1::uuid`, [l.optionId]);
      if (!ok) throw new PolicyViolation('REORDER_LINES', '직판(소개몰 직접 판매) 상품 옵션만 고를 수 있습니다.');
      await db.query(
        `INSERT INTO acct_reorder_draft_lines (draft_id, option_id, qty, unit_price) VALUES ($1::bigint, $2::uuid, $3::int, coalesce($4::bigint, 0))
         ON CONFLICT (draft_id, option_id) DO UPDATE SET qty = EXCLUDED.qty, unit_price = coalesce($4::bigint, acct_reorder_draft_lines.unit_price)`,
        [id, l.optionId, q, l.unitPrice == null ? null : Math.trunc(n(l.unitPrice))]);
    }
    await db.query(`UPDATE acct_reorder_drafts SET updated_at = now() WHERE id = $1::bigint`, [id]);
  });
  return { ok: true, id, note: '재주문 초안을 고쳤습니다.' };
}

/** POST /admin/acct/reorder/drafts/{id}/convert — 사람이 누를 때만 ㉑ 국내 발주(ORDERED) 하나로 · 보내기 없음 */
export async function convertDraft(db: DatabaseService, id: string, b: { partyId?: string; title?: string; memo?: string }, actor: string | null) {
  idOk(id);
  const [d] = await db.query<{ state: string; party_id: string | null }>(`SELECT state, party_id::text AS party_id FROM acct_reorder_drafts WHERE id = $1::bigint`, [id]);
  if (!d) throw new NotFound('없는 재주문 초안입니다.');
  if (d.state !== 'DRAFT') throw new StateConflict('REORDER_STATE', '이미 발주로 넣었거나 버린 초안입니다.');
  const partyId = b.partyId || d.party_id;
  if (!partyId) throw new PolicyViolation('REORDER_PARTY', '매입처(거래처)를 고르십시오 — 규칙에 매입처가 없던 초안입니다.');
  const lines = await db.query<{ option_id: string; qty: number; unit_price: string }>(
    `SELECT option_id::text AS option_id, qty, unit_price::text AS unit_price FROM acct_reorder_draft_lines WHERE draft_id = $1::bigint ORDER BY id`, [id]);
  if (!lines.length) throw new PolicyViolation('REORDER_LINES', '품목이 없는 초안입니다.');
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim() || `재주문 초안 ${id}번`;
  /* addPo 가 거래처 · 품목 · 제목을 다시 확인(같은 규칙) · 발주일 = 오늘 · 그 뒤 초안을 CONVERTED 로(같은 트랜잭션 안 · 실패하면 둘 다 그대로) */
  const out = await db.transaction(async () => {
    const po = await addPo(db, { partyId, title, orderedOn: kstToday(), memo: (b.memo ?? `안전 재고 재주문 초안 ${id}번에서`).slice(0, 200),
                                 lines: lines.map((l) => ({ optionId: l.option_id, qty: n(l.qty), unitPrice: n(l.unit_price) })) }, actor);
    const r = await db.query(
      `UPDATE acct_reorder_drafts SET state = 'CONVERTED', po_id = $2::bigint, party_id = $3::bigint, done_by = $4, done_at = now() WHERE id = $1::bigint AND state = 'DRAFT' RETURNING id`,
      [id, po.id, partyId, actor]);
    if (!r.length) throw new StateConflict('REORDER_STATE', '다른 요청이 먼저 처리했습니다 — 화면을 새로 고치십시오.');
    return po;
  });
  return { ok: true, id, poId: out.id, note: `국내 발주 ${out.id}번으로 넣었습니다(발주 상태) — 거래처에는 보내지 않았습니다. 회계 › 국내 발주에서 발주서를 인쇄 · 입고하십시오.` };
}

/** POST /admin/acct/reorder/drafts/{id}/dismiss — 버림(사유) */
export async function dismissDraft(db: DatabaseService, id: string, reason: string, actor: string | null) {
  idOk(id);
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const r = await db.query(
    `UPDATE acct_reorder_drafts SET state = 'DISMISSED', dismiss_note = $2, done_by = $3, done_at = now() WHERE id = $1::bigint AND state = 'DRAFT' RETURNING id`, [id, t, actor]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM acct_reorder_drafts WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 재주문 초안입니다.');
    throw new StateConflict('REORDER_STATE', '이미 발주로 넣었거나 버린 초안입니다.');
  }
  return { ok: true, id, note: '재주문 초안을 버렸습니다 — 다음 점검에서도 모자라면 새 초안이 생깁니다.' };
}

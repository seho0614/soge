import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Source } from './journal';
import { addPurchase } from './purchase';

/* ---------------------------------------------------------------------
 * v10.428 (D254 · docs/565) 무역 2단계 — 수출 · 국내 구매 발주
 *   대표 11/19 20:35 「모두개발」 → 다음 개발 후보 C8.
 *
 *   수출 한 건 = 거래처(⑯ acct_parties) · 제목 · 통화 · 품목(직판 옵션이면 재고에서 나감 · 아니면 글자 품목) · 외화 금액.
 *     ORDERED 수주 → SHIPPED 선적(선적일 · 선적일 환율 · B/L · 매출 인식) → CLEARED 수출신고 수리(수출신고번호 · 영세율 근거) → PAID 대금 회수(입금일 · 원화 입금액)
 *     (앞으로만 · 선적 전에만 취소 · DB 가 막음).
 *   전표(일반기업회계기준 · 선적 기준 매출 인식 · 영세율 0%):
 *     EXPORT_SALE  선적일 — 차변 외상매출금(AR) / 대변 수출 매출(REV_EXPORT) · 원화 = 외화 × 선적일 환율 · 부가세 없음 · 증빙 NONE(수출신고필증은 CLEARED 에 번호)
 *     EXPORT_PAID  입금일 — 차변 보통예금(CASH) 입금액 / 대변 AR 매출액 · 차액은 외환차익(FX_GAIN) · 외환차손(FX_LOSS)
 *   재고: 선적 때 직판 옵션 품목은 ⑫ 수불부 OUT_SALE(source_key EXP-건-줄) → ⑫ COGS 전표가 매출원가를 만듦(여기서 따로 만들지 않음).
 *   ⑭ 부가세 신고서 「영세율 · 기타」(6)에 수출 매출 공급가 합계(vatform 패치).
 *
 *   국내 구매 발주(acct_pos) = 거래처 · 품목(직판 옵션 또는 글자) · 수량 · 단가(공급가) · 부가세.
 *     ORDERED 발주 → RECEIVED 입고(⑫ 매입 관리에 매입 한 건 자동 · 직판 옵션 품목은 수불부 IN(purchase_id 붙임 → 재고 전표는 매입 전표가 대신))
 *     → 매입 전표는 ⑫ PURCHASE(차변 상품(INVENTORY) 또는 고른 비용 계정 · 부가세대급금 / 대변 미지급금).
 *   수출입 신고는 관세사 · 유니패스 연동 없음 · 환율은 사람이 넣음(서울외국환중개 매매기준율 등).
 * ------------------------------------------------------------------- */

export const EXPORT_STATES = ['ORDERED', 'SHIPPED', 'CLEARED', 'PAID'] as const;
export const EXPORT_STATE_KO: Record<string, string> = { ORDERED: '수주', SHIPPED: '선적', CLEARED: '수출신고 수리', PAID: '대금 회수', CANCELED: '취소' };
export const PO_STATE_KO: Record<string, string> = { ORDERED: '발주', RECEIVED: '입고', CANCELED: '취소' };
const n = (v: unknown) => Number(v ?? 0);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isDay = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const idOk = (id: string) => /^\d{1,18}$/.test(id);
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;

async function partyOk(db: DatabaseService, partyId?: string) {
  if (!partyId) return null;
  const [p] = idOk(partyId) ? await db.query<{ name: string; biz_no: string | null }>(`SELECT name, biz_no FROM acct_parties WHERE id = $1::bigint`, [partyId]) : [];
  if (!p) throw new PolicyViolation('TRADE_PARTY', '없는 거래처입니다.');
  return p;
}

/** 직판 옵션이면 확인 · 없으면 글자 품목(2 ~ 100자) */
async function checkTradeLines(db: DatabaseService, lines: Array<{ optionId?: string; item?: string; qty: number; amount: number }>, code: string, decimals: boolean) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) throw new PolicyViolation(code, '품목은 1 ~ 50줄입니다.');
  const ids = lines.map((l) => (l.optionId ? String(l.optionId) : '')).filter(Boolean);
  if (ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw new PolicyViolation(code, '상품 옵션 번호가 맞지 않습니다.');
  if (new Set(ids).size !== ids.length) throw new PolicyViolation(code, '같은 상품 옵션이 두 번 있습니다.');
  if (ids.length) {
    const ok = await db.query<{ id: string }>(
      `SELECT o.id::text AS id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.id = ANY($1::uuid[])`, [ids]);
    if (ok.length !== ids.length) throw new PolicyViolation(code, '직판(소개몰 직접 판매) 상품 옵션만 고를 수 있습니다.');
  }
  return lines.map((l) => {
    const qty = Math.round(Number(l.qty));
    const amount = decimals ? Math.round(Number(l.amount) * 100) / 100 : Math.round(Number(l.amount));
    const item = clean(l.item, 100);
    if (!l.optionId && (!item || item.length < 2)) throw new PolicyViolation(code, '상품 옵션을 고르거나 품목 이름(2 ~ 100자)을 넣으십시오.');
    if (!Number.isFinite(qty) || qty < 1 || qty > 1_000_000) throw new PolicyViolation(code, '수량은 1 ~ 1,000,000개입니다.');
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000_000) throw new PolicyViolation(code, '금액이 맞지 않습니다.');
    return { optionId: l.optionId ? String(l.optionId) : null, item, qty, amount };
  });
}

/* ═════════════ 수출 ═════════════ */

export interface ExportLineInput { optionId?: string; item?: string; qty: number; foreignAmount: number }
export interface ExportInput { partyId?: string; title: string; currency?: string; orderedOn: string; incoterms?: string; memo?: string; lines: ExportLineInput[] }

/** POST /admin/acct/exports — 수주(SUPER · PAYOUT) */
export async function addExport(db: DatabaseService, b: ExportInput, actor: string | null) {
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('EXPORT_TITLE', '수출 건 제목은 2 ~ 100자입니다.');
  const currency = (b.currency ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new PolicyViolation('EXPORT_CURRENCY', '통화는 영문 대문자 3자(USD · EUR · JPY · CNY 등)입니다.');
  if (!isDay(b.orderedOn) || b.orderedOn > kstToday()) throw new PolicyViolation('EXPORT_DATE', '수주일(YYYY-MM-DD · 앞날 안 됨)을 넣으십시오.');
  const inc = (b.incoterms ?? '').trim().toUpperCase();
  if (inc && !/^[A-Z]{3}$/.test(inc)) throw new PolicyViolation('EXPORT_INCOTERMS', '인코텀즈는 영문 대문자 3자(FOB · CIF · EXW 등)입니다.');
  await partyOk(db, b.partyId);
  const lines = await checkTradeLines(db, (b.lines ?? []).map((l) => ({ optionId: l.optionId, item: l.item, qty: l.qty, amount: l.foreignAmount })), 'EXPORT_LINES', true);
  const id = await db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_exports (party_id, title, currency, incoterms, ordered_on, memo, created_by) VALUES ($1::bigint, $2, $3, $4, $5::date, $6, $7) RETURNING id::text AS id`,
      [b.partyId || null, title, currency, inc || null, b.orderedOn, clean(b.memo, 200), actor]);
    await db.query(
      `INSERT INTO acct_export_lines (export_id, option_id, item, qty, foreign_amount)
       SELECT $1::bigint, x.option_id, x.item, x.qty, x.fa FROM jsonb_to_recordset($2::jsonb) AS x(option_id uuid, item text, qty int, fa numeric)`,
      [r!.id, JSON.stringify(lines.map((l) => ({ option_id: l.optionId, item: l.item, qty: l.qty, fa: l.amount })))]);
    return r!.id;
  });
  return { ok: true, id, note: '수출 건(수주)을 넣었습니다 — 선적 · 수출신고 수리 · 대금 회수 때 「다음 단계」로 넘기십시오.' };
}

export interface ExportAdvanceInput { to: string; date: string; fxRate?: number; blNo?: string; declNo?: string; paidKrw?: number }

/** POST /admin/acct/exports/{id}/advance — 한 단계씩(앞으로만) */
export async function advanceExport(db: DatabaseService, id: string, b: ExportAdvanceInput, actor: string | null) {
  if (!idOk(id)) throw new NotFound('없는 수출 건입니다.');
  const [cur] = await db.query<{ state: string; ordered_on: string; shipped_on: string | null; sale_krw: string | null }>(
    `SELECT state, ordered_on::text AS ordered_on, shipped_on::text AS shipped_on, sale_krw::text AS sale_krw FROM acct_exports WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 수출 건입니다.');
  if (cur.state === 'PAID' || cur.state === 'CANCELED') throw new StateConflict('EXPORT_STATE', '대금 회수 · 취소한 수출 건입니다.');
  const ord = EXPORT_STATES as readonly string[];
  if (!ord.includes(b.to) || ord.indexOf(b.to) <= ord.indexOf(cur.state)) throw new PolicyViolation('EXPORT_STATE', '다음 단계(선적 · 수출신고 수리 · 대금 회수)만 고를 수 있습니다.');
  if (!isDay(b.date) || b.date > kstToday() || b.date < cur.ordered_on) throw new PolicyViolation('EXPORT_DATE', '날짜는 수주일 뒤 · 오늘까지입니다.');

  if (b.to === 'SHIPPED') {
    const fx = Number(b.fxRate);
    if (!Number.isFinite(fx) || fx <= 0 || fx > 100000) throw new PolicyViolation('EXPORT_FX', '선적일 환율(원 · 외화 1단위)을 넣으십시오.');
    const lines = await db.query<{ id: string; option_id: string | null; qty: number; fa: string }>(
      `SELECT id::text AS id, option_id::text AS option_id, qty, foreign_amount::text AS fa FROM acct_export_lines WHERE export_id = $1::bigint ORDER BY id`, [id]);
    const rate = Math.round(fx * 10000) / 10000;
    const sale = lines.reduce((a, l) => a + Math.round(n(l.fa) * rate), 0);
    if (sale <= 0) throw new PolicyViolation('EXPORT_LINES', '수출 금액이 0원입니다 — 품목 금액을 확인하십시오.');
    await db.transaction(async () => {
      await db.query(`UPDATE acct_exports SET state = 'SHIPPED', shipped_on = $2::date, fx_rate = $3::numeric, sale_krw = $4::bigint, bl_no = $5 WHERE id = $1::bigint`,
        [id, b.date, rate, sale, clean(b.blNo, 40)]);
      for (const l of lines.filter((x) => x.option_id)) {
        await db.query(
          `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key, note, created_by)
           VALUES ($1::uuid, $2::date, 'OUT_SALE', $3, $4, $5, $6)`,
          [l.option_id, b.date, -l.qty, `EXP-${id}-${l.id}`, `수출 ${id}번 선적`, actor]);
      }
    });
    return { ok: true, id, state: 'SHIPPED', saleKrw: sale, note: '선적으로 넘겼습니다 — 수출 매출 전표(외상매출금 / 수출 매출 · 영세율)와 매출원가는 다음 전표 만들기 때 생깁니다.' };
  }
  if (b.to === 'CLEARED') {
    const decl = clean(b.declNo, 40);
    if (!decl || decl.length < 5) throw new PolicyViolation('EXPORT_DECL', '수출신고번호(수출신고필증)를 넣으십시오 — 영세율 근거입니다.');
    if (!cur.shipped_on) throw new PolicyViolation('EXPORT_STATE', '선적(환율 · 매출)을 먼저 넣으십시오.');
    await db.query(`UPDATE acct_exports SET state = 'CLEARED', cleared_on = $2::date, decl_no = $3 WHERE id = $1::bigint`, [id, b.date, decl]);
    return { ok: true, id, state: 'CLEARED', note: '수출신고 수리로 넘겼습니다(영세율 근거 번호 저장).' };
  }
  /* PAID */
  if (!cur.shipped_on || cur.sale_krw == null) throw new PolicyViolation('EXPORT_STATE', '선적(환율 · 매출)을 먼저 넣으십시오.');
  if (b.date < cur.shipped_on) throw new PolicyViolation('EXPORT_DATE', '대금 회수일은 선적일 뒤입니다.');
  const paid = Math.round(Number(b.paidKrw));
  if (!Number.isFinite(paid) || paid <= 0 || paid > 100_000_000_000) throw new PolicyViolation('EXPORT_PAID', '통장에 들어온 원화 금액을 넣으십시오.');
  await db.query(`UPDATE acct_exports SET state = 'PAID', paid_on = $2::date, paid_krw = $3::bigint WHERE id = $1::bigint`, [id, b.date, paid]);
  const diff = paid - n(cur.sale_krw);
  return { ok: true, id, state: 'PAID', fxDiff: diff,
           note: diff === 0 ? '대금 회수로 넘겼습니다.'
             : diff > 0 ? `대금 회수로 넘겼습니다 — 환율 차이 ${diff.toLocaleString('ko-KR')}원은 외환차익으로 전표에 들어갑니다.`
             : `대금 회수로 넘겼습니다 — 환율 차이 ${(-diff).toLocaleString('ko-KR')}원은 외환차손으로 전표에 들어갑니다.` };
}

/** POST /admin/acct/exports/{id}/cancel — 선적 전에만(사유) */
export async function cancelExport(db: DatabaseService, id: string, reason: string) {
  if (!idOk(id)) throw new NotFound('없는 수출 건입니다.');
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM acct_exports WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 수출 건입니다.');
  if (cur.state !== 'ORDERED') throw new StateConflict('EXPORT_STATE', '선적 전 수출 건만 취소합니다.');
  await db.query(`UPDATE acct_exports SET state = 'CANCELED', cancel_note = $2 WHERE id = $1::bigint`, [id, t]);
  return { ok: true, id, note: '수출 건을 취소했습니다.' };
}

/** GET /admin/acct/exports?state= */
export async function listExports(db: DatabaseService, state?: string) {
  const items = await db.query(
    `SELECT x.id::text AS id, x.party_id::text AS "partyId", p.name AS "partyName", x.title, x.currency, x.incoterms, x.fx_rate::float8 AS "fxRate",
            x.sale_krw::bigint AS "saleKrw", x.paid_krw::bigint AS "paidKrw", x.bl_no AS "blNo", x.decl_no AS "declNo", x.state,
            x.ordered_on::text AS "orderedOn", x.shipped_on::text AS "shippedOn", x.cleared_on::text AS "clearedOn", x.paid_on::text AS "paidOn",
            x.memo, x.cancel_note AS "cancelNote",
            (SELECT coalesce(sum(l.foreign_amount), 0)::float8 FROM acct_export_lines l WHERE l.export_id = x.id) AS "foreignTotal",
            (SELECT count(*)::int FROM acct_export_lines l WHERE l.export_id = x.id) AS lines,
            (SELECT e.id::text FROM acct_entries e WHERE e.source = 'EXPORT_SALE' AND e.source_key = x.id::text) AS "saleEntryId"
       FROM acct_exports x LEFT JOIN acct_parties p ON p.id = x.party_id
      WHERE ($1::text = '' OR x.state = $1) ORDER BY (x.state IN ('PAID', 'CANCELED')), x.ordered_on DESC, x.id DESC LIMIT 300`,
    [Object.keys(EXPORT_STATE_KO).includes(state ?? '') ? state : '']);
  const options = await db.query(
    `SELECT o.id::text AS id, p.name || ' ' || coalesce(fn_hlt_option_label(o.months, o.tag), '') AS label
       FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
      ORDER BY p.name, o.id LIMIT 500`);
  const open = (items as Array<{ state: string; saleKrw: number | null }>).filter((x) => !['PAID', 'CANCELED'].includes(x.state));
  return { items, options, states: EXPORT_STATE_KO,
           count: { open: open.length, receivable: open.reduce((a, x) => a + n(x.saleKrw), 0) },
           note: '수출 매출은 선적일에 선적일 환율로 잡고(영세율 · 부가세 0), 대금 회수 때 환율 차이는 외환차익 · 외환차손입니다. 수출신고는 관세사가 하고 수출신고번호를 넣으십시오(영세율 근거) — 일반 원칙 · 세무사 확인은 선택.' };
}

/* ═════════════ 국내 구매 발주 ═════════════ */

export interface PoLineInput { optionId?: string; item?: string; qty: number; unitPrice: number }
export interface PoInput { partyId?: string; title: string; orderedOn: string; memo?: string; lines: PoLineInput[]; requisitionId?: string }
export interface PoReceiveInput { date: string; kind?: string; vat?: number; deductible?: boolean; accountRole?: string; payRole?: string; attachments?: string[] }

/** POST /admin/acct/pos — 발주(SUPER · PAYOUT) */
export async function addPo(db: DatabaseService, b: PoInput, actor: string | null) {
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('PO_TITLE', '발주 제목은 2 ~ 100자입니다.');
  if (!isDay(b.orderedOn) || b.orderedOn > kstToday()) throw new PolicyViolation('PO_DATE', '발주일(YYYY-MM-DD · 앞날 안 됨)을 넣으십시오.');
  const party = await partyOk(db, b.partyId);
  if (!party) throw new PolicyViolation('TRADE_PARTY', '발주할 거래처(매입처)를 고르십시오.');
  if (b.requisitionId && !idOk(b.requisitionId)) throw new PolicyViolation('PO_REQ', '품의 번호가 맞지 않습니다.');
  const lines = await checkTradeLines(db, (b.lines ?? []).map((l) => ({ optionId: l.optionId, item: l.item, qty: l.qty, amount: l.unitPrice })), 'PO_LINES', false);
  const id = await db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_pos (party_id, title, ordered_on, memo, requisition_id, created_by) VALUES ($1::bigint, $2, $3::date, $4, $5::bigint, $6) RETURNING id::text AS id`,
      [b.partyId, title, b.orderedOn, clean(b.memo, 200), b.requisitionId || null, actor]);
    await db.query(
      `INSERT INTO acct_po_lines (po_id, option_id, item, qty, unit_price)
       SELECT $1::bigint, x.option_id, x.item, x.qty, x.up FROM jsonb_to_recordset($2::jsonb) AS x(option_id uuid, item text, qty int, up bigint)`,
      [r!.id, JSON.stringify(lines.map((l) => ({ option_id: l.optionId, item: l.item, qty: l.qty, up: l.amount })))]);
    return r!.id;
  });
  return { ok: true, id, note: '발주를 넣었습니다 — 물건이 들어오면 「입고」로 매입과 재고에 넣으십시오.' };
}

/** POST /admin/acct/pos/{id}/receive — 입고 → ⑫ 매입 한 건 + 직판 옵션 품목 재고 IN(purchase_id) */
export async function receivePo(db: DatabaseService, id: string, b: PoReceiveInput, actor: string | null) {
  if (!idOk(id)) throw new NotFound('없는 발주입니다.');
  const [po] = await db.query<{ state: string; ordered_on: string; title: string; party_name: string; biz_no: string | null; requisition_id: string | null }>(
    `SELECT o.state, o.ordered_on::text AS ordered_on, o.title, p.name AS party_name, p.biz_no, o.requisition_id::text AS requisition_id
       FROM acct_pos o JOIN acct_parties p ON p.id = o.party_id WHERE o.id = $1::bigint`, [id]);
  if (!po) throw new NotFound('없는 발주입니다.');
  if (po.state !== 'ORDERED') throw new StateConflict('PO_STATE', '발주 상태인 것만 입고합니다.');
  if (!isDay(b.date) || b.date > kstToday() || b.date < po.ordered_on) throw new PolicyViolation('PO_DATE', '입고일은 발주일 뒤 · 오늘까지입니다.');
  const lines = await db.query<{ id: string; option_id: string | null; item: string | null; qty: number; up: string }>(
    `SELECT id::text AS id, option_id::text AS option_id, item, qty, unit_price::text AS up FROM acct_po_lines WHERE po_id = $1::bigint ORDER BY id`, [id]);
  const supply = lines.reduce((a, l) => a + l.qty * n(l.up), 0);
  if (supply <= 0) throw new PolicyViolation('PO_LINES', '발주 금액이 0원입니다.');
  const kind = b.kind ?? 'TAX_INVOICE';
  const vat = b.vat == null ? (kind === 'SIMPLE' ? 0 : Math.round(supply * 0.1)) : Math.round(Number(b.vat));
  const allStock = lines.every((l) => l.option_id);
  const accountRole = b.accountRole ?? (allStock ? 'INVENTORY' : 'EXP_SUPPLIES');
  /* 매입 넣기(⑫ 검사 · 같은 건 막기 · 품의 한도는 DB) — 실패하면 발주는 그대로 */
  const pur = await addPurchase(db, {
    kind, issuedOn: b.date, supplierName: po.party_name, supplierBizNo: po.biz_no ?? undefined, item: `발주 ${id}번 ${po.title}`.slice(0, 120),
    supply, vat, deductible: b.deductible, accountRole, payRole: b.payRole ?? 'AP', memo: `국내 구매 발주 ${id}번 입고`, attachments: b.attachments,
    force: true, requisitionId: po.requisition_id ?? undefined,
  }, actor);
  await db.transaction(async () => {
    for (const l of lines.filter((x) => x.option_id)) {
      await db.query(
        `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key, purchase_id, note, created_by)
         VALUES ($1::uuid, $2::date, 'IN', $3, $4::numeric, $5, $6::bigint, $7, $8)`,
        [l.option_id, b.date, l.qty, n(l.up), `PO-${id}-${l.id}`, pur.id, `발주 ${id}번 입고`, actor]);
    }
    await db.query(`UPDATE acct_pos SET state = 'RECEIVED', received_on = $2::date, purchase_id = $3::bigint WHERE id = $1::bigint`, [id, b.date, pur.id]);
  });
  return { ok: true, id, purchaseId: pur.id, supply, vat, stockLines: lines.filter((x) => x.option_id).length,
           note: allStock || accountRole === 'INVENTORY'
             ? '입고했습니다 — 매입(상품 · 부가세대급금 / 미지급금)과 재고 수불부에 들어갔습니다(재고 전표는 매입 전표가 대신).'
             : '입고했습니다 — 매입에 들어갔습니다(직판 옵션 품목만 재고 수불부).' };
}

/** POST /admin/acct/pos/{id}/cancel — 입고 전에만 */
export async function cancelPo(db: DatabaseService, id: string, reason: string) {
  if (!idOk(id)) throw new NotFound('없는 발주입니다.');
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM acct_pos WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 발주입니다.');
  if (cur.state !== 'ORDERED') throw new StateConflict('PO_STATE', '입고 전 발주만 취소합니다.');
  await db.query(`UPDATE acct_pos SET state = 'CANCELED', cancel_note = $2 WHERE id = $1::bigint`, [id, t]);
  return { ok: true, id, note: '발주를 취소했습니다.' };
}

/** GET /admin/acct/pos?state= */
export async function listPos(db: DatabaseService, state?: string) {
  const items = await db.query(
    `SELECT o.id::text AS id, o.party_id::text AS "partyId", p.name AS "partyName", o.title, o.state, o.ordered_on::text AS "orderedOn", o.received_on::text AS "receivedOn",
            o.purchase_id::text AS "purchaseId", o.requisition_id::text AS "requisitionId", o.memo, o.cancel_note AS "cancelNote",
            (SELECT coalesce(sum(l.qty * l.unit_price), 0)::bigint FROM acct_po_lines l WHERE l.po_id = o.id) AS supply,
            (SELECT count(*)::int FROM acct_po_lines l WHERE l.po_id = o.id) AS lines
       FROM acct_pos o JOIN acct_parties p ON p.id = o.party_id
      WHERE ($1::text = '' OR o.state = $1) ORDER BY (o.state <> 'ORDERED'), o.ordered_on DESC, o.id DESC LIMIT 300`,
    [Object.keys(PO_STATE_KO).includes(state ?? '') ? state : '']);
  return { items, states: PO_STATE_KO, note: '입고하면 ⑫ 매입 관리에 매입이 한 건 생기고(같은 건 막기는 건너뜀), 직판 상품 옵션 품목은 재고 수불부에 입고됩니다.' };
}

/* ── 전표(sources.ts ALL_SOURCES 끝에 붙임) ── */
export const EXPORT_SOURCES: Source[] = [
  {
    name: 'EXPORT_SALE', label: '수출 매출(선적 · 영세율)',
    sql: `SELECT x.id::text AS key, (x.shipped_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, x.sale_krw::bigint AS amt, p.name AS party, x.title, x.currency, x.fx_rate::float8 AS fx
            FROM acct_exports x LEFT JOIN acct_parties p ON p.id = x.party_id
           WHERE x.state IN ('SHIPPED', 'CLEARED', 'PAID') AND x.sale_krw > 0 AND x.shipped_on IS NOT NULL
             AND (x.shipped_on::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPORT_SALE' AND e.source_key = x.id::text)
           ORDER BY x.id LIMIT 500`,
    build: (r) => ({ memo: `수출 ${r.title ?? ''} (${r.currency ?? ''} · ${r.fx ?? ''})`.trim(), evidence: 'NONE',
      lines: [{ role: 'AR', debit: n(r.amt), credit: 0 }, { role: 'REV_EXPORT', debit: 0, credit: n(r.amt) }] }),
  },
  {
    name: 'EXPORT_PAID', label: '수출 대금 회수(환율 차이)',
    sql: `SELECT x.id::text AS key, (x.paid_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, x.sale_krw::bigint AS sale, x.paid_krw::bigint AS paid, p.name AS party, x.title
            FROM acct_exports x LEFT JOIN acct_parties p ON p.id = x.party_id
           WHERE x.state = 'PAID' AND x.paid_on IS NOT NULL AND x.paid_krw > 0
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPORT_SALE' AND e.source_key = x.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPORT_PAID' AND e.source_key = x.id::text)
           ORDER BY x.id LIMIT 500`,
    build: (r) => {
      const sale = n(r.sale), paid = n(r.paid), diff = paid - sale;
      return { memo: `수출 대금 ${r.title ?? ''}`.trim(), evidence: 'NONE',
        lines: [{ role: 'CASH', debit: paid, credit: 0 }, { role: 'AR', debit: 0, credit: sale },
                ...(diff > 0 ? [{ role: 'FX_GAIN', debit: 0, credit: diff }] : []), ...(diff < 0 ? [{ role: 'FX_LOSS', debit: -diff, credit: 0 }] : [])] };
    },
  },
];

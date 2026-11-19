import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Line, Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.433 (D256 · docs/570) 견적서 · 주문서 · 거래명세서 · 발주서 출력 — 대표 11/19 「이카운트 보류 → 내부 시스템으로」
 *   견적(QUOTE) → 주문(ORDER) → 거래명세서(STATEMENT) 이어 만들기 · 번호 Q/O/S-YYMM-0001 · 쌓기만(고치기 = 새 판 rev+1).
 *   품목 줄: 공급가 = 수량 × 단가(원 미만 버림) · 부가세 = 과세 줄 공급가 × 10%(원 미만 버림) · 면세 · 영세는 0.
 *   거래명세서 확정(ACCEPTED) → 정기 전표 SALES_DOC(차변 외상매출금 / 대변 매출 · 부가세예수금) · 세금계산서 발행 요청(kind SALES_DOC).
 *   발주서 = ㉑ 국내 구매 발주(acct_pos · acct_po_lines) 인쇄 모양. 회사 정보 = 설정 footer.*.
 * ------------------------------------------------------------------- */

export const DOC_KINDS = ['QUOTE', 'ORDER', 'STATEMENT'] as const;
export type DocKind = typeof DOC_KINDS[number];
export const DOC_KO: Record<string, string> = { QUOTE: '견적서', ORDER: '주문서', STATEMENT: '거래명세서' };
export const DOC_STATE_KO: Record<string, string> = { DRAFT: '초안', SENT: '보냄', ACCEPTED: '확정', CANCELED: '취소' };
export const TAX_TYPES = ['TAXABLE', 'EXEMPT', 'ZERO'] as const;
const LETTER: Record<DocKind, string> = { QUOTE: 'Q', ORDER: 'O', STATEMENT: 'S' };
const NEXT: Record<string, DocKind[]> = { QUOTE: ['ORDER', 'STATEMENT'], ORDER: ['STATEMENT'], STATEMENT: [] };

const n = (v: unknown) => Number(v ?? 0);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOk = (d?: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);

export interface DocLineIn { item: string; spec?: string; qty: number; unit?: string; unitPrice: number; taxType?: string; optionId?: string }
export interface DocIn { kind: string; partyId: string; title: string; issuedOn?: string; validUntil?: string; dueOn?: string; revenueRole?: string; memo?: string; lines: DocLineIn[] }

/** 품목 줄 검사 · 셈 */
export function calcLines(lines: DocLineIn[]) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw new PolicyViolation('ACCT_DOC', '품목은 1 ~ 100줄입니다.');
  const out = lines.map((l, i) => {
    const item = String(l?.item ?? '').trim();
    if (item.length < 1 || item.length > 120) throw new PolicyViolation('ACCT_DOC', `품목 이름은 1 ~ 120자입니다(줄 {0}).`.replace('{0}', String(i + 1)));
    const qty = Number(l.qty), price = Math.round(Number(l.unitPrice));
    if (!(qty > 0 && qty <= 1e9)) throw new PolicyViolation('ACCT_DOC', '수량은 0보다 커야 합니다.');
    if (!(price >= 0 && price <= 1e12)) throw new PolicyViolation('ACCT_DOC', '단가가 바르지 않습니다.');
    const taxType = (TAX_TYPES as readonly string[]).includes(l.taxType ?? '') ? l.taxType! : 'TAXABLE';
    const supply = Math.floor(qty * price);
    const vat = taxType === 'TAXABLE' ? Math.floor(supply / 10) : 0;
    return { seq: i + 1, item, spec: (l.spec ?? '').trim().slice(0, 80) || null, qty, unit: (l.unit ?? '').trim().slice(0, 10) || null,
             unitPrice: price, supply, vat, taxType, optionId: /^[0-9a-f-]{36}$/i.test(l.optionId ?? '') ? l.optionId! : null };
  });
  const supply = out.reduce((s, l) => s + l.supply, 0), vat = out.reduce((s, l) => s + l.vat, 0);
  if (supply + vat <= 0) throw new PolicyViolation('ACCT_DOC', '합계가 0원입니다.');
  return { lines: out, supply, vat, total: supply + vat };
}

async function nextNo(db: DatabaseService, kind: DocKind, issuedOn: string) {
  const yymm = issuedOn.slice(2, 4) + issuedOn.slice(5, 7);
  const [r] = await db.query<{ last: number }>(
    `INSERT INTO acct_doc_counters (kind, ym, last) VALUES ($1, $2, 1)
     ON CONFLICT (kind, ym) DO UPDATE SET last = acct_doc_counters.last + 1 RETURNING last`, [kind, yymm]);
  return `${LETTER[kind]}-${yymm}-${String(r!.last).padStart(4, '0')}`;
}

async function insertDoc(db: DatabaseService, d: { kind: DocKind; docNo: string; rev: number; rootId: string | null; prevId: string | null; parentId: string | null;
  partyId: string; title: string; issuedOn: string; validUntil: string | null; dueOn: string | null; revenueRole: string; memo: string | null }, c: ReturnType<typeof calcLines>, actor: string | null) {
  const [doc] = await db.query<{ id: string }>(
    `INSERT INTO acct_sales_docs (kind, doc_no, rev, root_id, prev_id, parent_id, party_id, title, issued_on, valid_until, due_on, revenue_role, supply, vat, total, memo, created_by)
     VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7::bigint, $8, $9::date, $10::date, $11::date, $12, $13, $14, $15, $16, $17) RETURNING id::text AS id`,
    [d.kind, d.docNo, d.rev, d.rootId, d.prevId, d.parentId, d.partyId, d.title, d.issuedOn, d.validUntil, d.dueOn, d.revenueRole, c.supply, c.vat, c.total, d.memo, actor]);
  for (const l of c.lines) await db.query(
    `INSERT INTO acct_sales_doc_lines (doc_id, seq, item, spec, qty, unit, unit_price, supply, vat, tax_type, option_id)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid)`,
    [doc!.id, l.seq, l.item, l.spec, l.qty, l.unit, l.unitPrice, l.supply, l.vat, l.taxType, l.optionId]);
  return doc!.id;
}

async function checkHead(db: DatabaseService, b: Partial<DocIn>) {
  const title = (b.title ?? '').trim();
  if (title.length < 1 || title.length > 120) throw new PolicyViolation('ACCT_DOC', '제목은 1 ~ 120자입니다.');
  if (!dayOk(b.issuedOn) || !dayOk(b.validUntil) || !dayOk(b.dueOn)) throw new PolicyViolation('ACCT_DOC', '날짜가 바르지 않습니다.');
  const [p] = await db.query<{ id: string; state: string }>(`SELECT id::text AS id, state FROM acct_parties WHERE id::text = $1`, [String(b.partyId ?? '')]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  const role = (b.revenueRole ?? 'REV_SALES').trim();
  const [a] = await db.query<{ kind: string }>(`SELECT kind FROM acct_accounts WHERE role = $1`, [role]);
  if (!a || a.kind !== 'REVENUE') throw new PolicyViolation('ACCT_DOC', '매출 계정을 고르십시오.');
  return { title, partyId: p.id, revenueRole: role, issuedOn: b.issuedOn || kstToday(), validUntil: b.validUntil || null, dueOn: b.dueOn || null, memo: (b.memo ?? '').trim().slice(0, 400) || null };
}

/** POST /admin/acct/sales-docs — 새 문서(초안) */
export async function createDoc(db: DatabaseService, b: DocIn, actor: string | null) {
  if (!(DOC_KINDS as readonly string[]).includes(b.kind)) throw new PolicyViolation('ACCT_DOC', '문서 종류를 고르십시오(견적 · 주문 · 거래명세서).');
  const h = await checkHead(db, b);
  const c = calcLines(b.lines);
  return db.transaction(async () => {
    const docNo = await nextNo(db, b.kind as DocKind, h.issuedOn);
    const id = await insertDoc(db, { kind: b.kind as DocKind, docNo, rev: 1, rootId: null, prevId: null, parentId: null, ...h }, c, actor);
    return { ok: true, id, docNo, total: c.total, note: `${DOC_KO[b.kind]} ${docNo} 을 만들었습니다(초안).` };
  });
}

async function loadDoc(db: DatabaseService, id: string) {
  const [d] = await db.query<Record<string, any>>(
    `SELECT d.id::text AS id, d.kind, d.doc_no AS "docNo", d.rev, d.root_id::text AS "rootId", d.prev_id::text AS "prevId", d.parent_id::text AS "parentId",
            d.party_id::text AS "partyId", p.name AS "partyName", p.biz_no AS "partyBizNo", p.contact_name AS "contactName", p.contact_email AS "contactEmail",
            d.title, d.issued_on::text AS "issuedOn", d.valid_until::text AS "validUntil", d.due_on::text AS "dueOn", d.revenue_role AS "revenueRole",
            d.supply::bigint AS supply, d.vat::bigint AS vat, d.total::bigint AS total, d.memo, d.state, d.superseded_by::text AS "supersededBy",
            d.accepted_at AS "acceptedAt", d.canceled_at AS "canceledAt", d.cancel_reason AS "cancelReason", d.tax_invoice_id::text AS "taxInvoiceId", d.tax_invoice_no AS "taxInvoiceNo",
            d.created_at AS "createdAt"
       FROM acct_sales_docs d JOIN acct_parties p ON p.id = d.party_id WHERE d.id::text = $1`, [id]);
  if (!d) throw new NotFound('없는 문서입니다.');
  return d;
}
async function linesOf(db: DatabaseService, id: string) {
  return db.query<Record<string, any>>(
    `SELECT seq, item, spec, qty::float8 AS qty, unit, unit_price::bigint AS "unitPrice", supply::bigint AS supply, vat::bigint AS vat, tax_type AS "taxType", option_id::text AS "optionId"
       FROM acct_sales_doc_lines WHERE doc_id::text = $1 ORDER BY seq`, [id]);
}

/** GET /admin/acct/sales-docs — 목록(옛 판 빼고) */
export async function listDocs(db: DatabaseService, q: { kind?: string; state?: string; partyId?: string; ym?: string }) {
  const items = await db.query(
    `SELECT d.id::text AS id, d.kind, d.doc_no AS "docNo", d.rev, p.name AS "partyName", d.title, d.issued_on::text AS "issuedOn", d.due_on::text AS "dueOn",
            d.supply::bigint AS supply, d.vat::bigint AS vat, d.total::bigint AS total, d.state, d.tax_invoice_no AS "taxInvoiceNo",
            (SELECT x.doc_no FROM acct_sales_docs x WHERE x.id = d.parent_id) AS "parentNo"
       FROM acct_sales_docs d JOIN acct_parties p ON p.id = d.party_id
      WHERE d.superseded_by IS NULL
        AND ($1::text IS NULL OR d.kind = $1) AND ($2::text IS NULL OR d.state = $2) AND ($3::text IS NULL OR d.party_id::text = $3)
        AND ($4::text IS NULL OR to_char(d.issued_on, 'YYYY-MM') = $4)
      ORDER BY d.issued_on DESC, d.created_at DESC LIMIT 300`,
    [(DOC_KINDS as readonly string[]).includes(q.kind ?? '') ? q.kind : null, ['DRAFT', 'SENT', 'ACCEPTED', 'CANCELED'].includes(q.state ?? '') ? q.state : null,
     /^\d{1,18}$/.test(q.partyId ?? '') ? q.partyId : null, /^\d{4}-\d{2}$/.test(q.ym ?? '') ? q.ym : null]);
  const parties = await db.query(`SELECT id::text AS id, name, biz_no AS "bizNo" FROM acct_parties WHERE state = 'ACTIVE' AND kind IN ('CUSTOMER', 'BOTH') ORDER BY name LIMIT 500`);
  const revenues = await db.query(`SELECT role, name FROM acct_accounts WHERE kind = 'REVENUE' ORDER BY sort, role`);
  return { items, parties, revenues, kinds: DOC_KO, states: DOC_STATE_KO };
}

/** GET /admin/acct/sales-docs/{id} — 문서 · 줄 · 판 · 이어진 문서 · 회사 정보(인쇄) */
export async function docDetail(db: DatabaseService, id: string) {
  const d = await loadDoc(db, id);
  const lines = await linesOf(db, id);
  const revisions = await db.query(
    `SELECT id::text AS id, rev, state, created_at AS "createdAt" FROM acct_sales_docs WHERE doc_no = $1 ORDER BY rev`, [d.docNo]);
  const children = await db.query(
    `SELECT id::text AS id, kind, doc_no AS "docNo", state FROM acct_sales_docs WHERE parent_id::text = $1 AND superseded_by IS NULL ORDER BY created_at`, [id]);
  return { doc: d, lines, revisions, children, next: d.state === 'CANCELED' || d.supersededBy ? [] : NEXT[d.kind], company: await company(db) };
}

/** 회사 정보 — 설정 footer.*(공급자 · 인쇄 머리) */
export async function company(db: DatabaseService) {
  const s = await db.query<{ key: string; value: string | null }>(
    `SELECT key, nullif(btrim(value), '') AS value FROM site_settings WHERE key IN ('footer.company_name', 'footer.biz_reg_no', 'footer.ceo_name', 'footer.address', 'footer.phone')`);
  const v = (k: string) => s.find((x) => x.key === k)?.value ?? null;
  return { name: v('footer.company_name'), bizNo: v('footer.biz_reg_no'), ceo: v('footer.ceo_name'), address: v('footer.address'), phone: v('footer.phone') };
}

/** POST /admin/acct/sales-docs/{id}/revise — 고치기 = 새 판(초안 · 보냄일 때만) */
export async function reviseDoc(db: DatabaseService, id: string, b: Partial<DocIn> & { lines: DocLineIn[] }, actor: string | null) {
  return db.transaction(async () => {
    const [cur] = await db.query<{ state: string; superseded_by: string | null }>(`SELECT state, superseded_by::text FROM acct_sales_docs WHERE id::text = $1 FOR UPDATE`, [id]);
    if (!cur) throw new NotFound('없는 문서입니다.');
    if (cur.superseded_by) throw new StateConflict('ACCT_DOC_STATE', '이미 새 판이 있습니다 — 마지막 판을 고치십시오.');
    if (!['DRAFT', 'SENT'].includes(cur.state)) throw new StateConflict('ACCT_DOC_STATE', '확정 · 취소한 문서는 고치지 않습니다.');
    const d = await loadDoc(db, id);
    const h = await checkHead(db, { partyId: d.partyId, title: d.title, issuedOn: d.issuedOn, validUntil: d.validUntil, dueOn: d.dueOn, revenueRole: d.revenueRole, memo: d.memo,
      ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'lines')) });   // 빈 칸(undefined)이 옛 값을 덮지 않게
    const c = calcLines(b.lines);
    if (d.rev >= 99) throw new PolicyViolation('ACCT_DOC', '판은 99까지입니다.');
    const nid = await insertDoc(db, { kind: d.kind, docNo: d.docNo, rev: d.rev + 1, rootId: d.rootId ?? d.id, prevId: d.id, parentId: d.parentId, ...h }, c, actor);
    await db.query(`UPDATE acct_sales_docs SET superseded_by = $2::uuid WHERE id::text = $1`, [id, nid]);
    return { ok: true, id: nid, docNo: d.docNo, rev: d.rev + 1, note: `${d.docNo} 을 ${d.rev + 1}판으로 고쳤습니다(옛 판은 보관).` };
  });
}

/** POST /admin/acct/sales-docs/{id}/convert — 견적 → 주문 · 거래명세서 / 주문 → 거래명세서(앞 문서는 확정) */
export async function convertDoc(db: DatabaseService, id: string, to: string, actor: string | null) {
  return db.transaction(async () => {
    const d = await loadDoc(db, id);
    if (d.supersededBy) throw new StateConflict('ACCT_DOC_STATE', '옛 판에서는 이어 만들지 않습니다.');
    if (d.state === 'CANCELED') throw new StateConflict('ACCT_DOC_STATE', '취소한 문서에서는 이어 만들지 않습니다.');
    if (!(NEXT[d.kind] ?? []).includes(to as DocKind)) throw new PolicyViolation('ACCT_DOC', '이 문서에서 만들 수 없는 종류입니다.');
    const lines = await linesOf(db, id);
    const c = calcLines(lines.map((l) => ({ item: l.item, spec: l.spec ?? undefined, qty: l.qty, unit: l.unit ?? undefined, unitPrice: l.unitPrice, taxType: l.taxType, optionId: l.optionId ?? undefined })));
    const today = kstToday();
    const docNo = await nextNo(db, to as DocKind, today);
    const nid = await insertDoc(db, { kind: to as DocKind, docNo, rev: 1, rootId: null, prevId: null, parentId: d.id, partyId: d.partyId, title: d.title,
      issuedOn: today, validUntil: null, dueOn: d.dueOn, revenueRole: d.revenueRole, memo: d.memo }, c, actor);
    if (d.state !== 'ACCEPTED') await db.query(`UPDATE acct_sales_docs SET state = 'ACCEPTED', accepted_at = now() WHERE id::text = $1`, [id]);
    return { ok: true, id: nid, docNo, note: `${DOC_KO[d.kind]} ${d.docNo} → ${DOC_KO[to]} ${docNo} 을 만들었습니다(앞 문서는 확정).` };
  });
}

/** POST /admin/acct/sales-docs/{id}/state — 보냄 · 확정 · 취소(사유) · 거래명세서 확정 = 매출 전표(다음 전표 작업) */
export async function setDocState(db: DatabaseService, id: string, to: string, reason?: string) {
  const d = await loadDoc(db, id);
  if (d.supersededBy) throw new StateConflict('ACCT_DOC_STATE', '옛 판은 상태를 바꾸지 않습니다.');
  if (to === 'SENT') {
    if (d.state !== 'DRAFT') throw new StateConflict('ACCT_DOC_STATE', '초안만 「보냄」으로 바꿉니다.');
    await db.query(`UPDATE acct_sales_docs SET state = 'SENT' WHERE id::text = $1`, [id]);
  } else if (to === 'ACCEPTED') {
    if (!['DRAFT', 'SENT'].includes(d.state)) throw new StateConflict('ACCT_DOC_STATE', '이미 확정 · 취소한 문서입니다.');
    await db.query(`UPDATE acct_sales_docs SET state = 'ACCEPTED', accepted_at = now() WHERE id::text = $1`, [id]);
  } else if (to === 'CANCELED') {
    const t = (reason ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
    if (d.state === 'CANCELED') throw new StateConflict('ACCT_DOC_STATE', '이미 취소한 문서입니다.');
    await db.query(`UPDATE acct_sales_docs SET state = 'CANCELED', canceled_at = now(), cancel_reason = $2 WHERE id::text = $1`, [id, t]);
  } else throw new PolicyViolation('ACCT_DOC', '모르는 상태입니다.');
  const sales = d.kind === 'STATEMENT' && (to === 'ACCEPTED' || (to === 'CANCELED' && d.state === 'ACCEPTED'));
  return { ok: true, id, state: to,
    note: sales ? (to === 'ACCEPTED' ? '거래명세서를 확정했습니다 — 다음 전표 작업에서 매출 전표가 생깁니다.' : '확정한 거래명세서를 취소했습니다 — 다음 전표 작업에서 반대 전표가 생깁니다.') : '상태를 바꿨습니다.' };
}

/** POST /admin/acct/sales-docs/{id}/tax-invoice — 확정한 거래명세서의 세금계산서 발행 요청(acct_tax_invoices kind SALES_DOC) */
export async function requestDocInvoice(db: DatabaseService, id: string, actor: string | null) {
  const d = await loadDoc(db, id);
  if (d.kind !== 'STATEMENT' || d.state !== 'ACCEPTED' || d.supersededBy) throw new StateConflict('ACCT_DOC_STATE', '확정한 거래명세서만 세금계산서를 요청합니다.');
  if (d.taxInvoiceId) {   // 취소한 요청이면 다시 요청 가능(DB 가드도 같음)
    const [old] = await db.query<{ state: string }>(`SELECT state FROM acct_tax_invoices WHERE id = $1::uuid`, [d.taxInvoiceId]);
    if (old && old.state !== 'CANCELED') throw new StateConflict('ACCT_DOC_STATE', '이미 세금계산서를 요청했습니다.');
  }
  if (n(d.supply) <= 0) throw new PolicyViolation('ACCT_DOC', '공급가가 0원이라 세금계산서를 요청할 수 없습니다.');
  const biz = /^\d{10}$/.test(d.partyBizNo ?? '') ? `${d.partyBizNo.slice(0, 3)}-${d.partyBizNo.slice(3, 5)}-${d.partyBizNo.slice(5)}` : null;
  return db.transaction(async () => {
    const [t] = await db.query<{ id: string }>(
      `INSERT INTO acct_tax_invoices (kind, source_id, supply, vat, total, buyer_name, buyer_biz_no, item, requested_by)
       VALUES ('SALES_DOC', $1::uuid, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text AS id`,
      [id, d.supply, d.vat, d.total, String(d.partyName).slice(0, 120), biz, `${d.docNo} ${d.title}`.slice(0, 100), actor]);
    await db.query(`UPDATE acct_sales_docs SET tax_invoice_id = $2::uuid WHERE id::text = $1`, [id, t!.id]);
    return { ok: true, id, taxInvoiceId: t!.id, note: biz ? '세금계산서 발행을 요청했습니다 — 회계 › 신고 자료 › 세금계산서에서 보냅니다.' : '세금계산서 발행을 요청했습니다(거래처 사업자번호가 없어 개인 · 주민번호 발행은 회계 프로그램에서).' };
  });
}

/** GET /admin/acct/sales-docs/po/{id}/print — ㉑ 국내 구매 발주서 인쇄 모양 */
export async function poPrint(db: DatabaseService, id: string) {
  const [ok] = await db.query<{ t: boolean }>(`SELECT to_regclass('public.acct_pos') IS NOT NULL AS t`);
  if (!ok?.t) throw new NotFound('발주 기능(국내 구매)이 아직 없습니다.');
  const [po] = await db.query<Record<string, any>>(
    `SELECT o.id::text AS id, o.title, o.ordered_on::text AS "orderedOn", o.state, o.memo, p.name AS "partyName", p.biz_no AS "partyBizNo", p.contact_name AS "contactName", p.contact_phone AS "contactPhone"
       FROM acct_pos o JOIN acct_parties p ON p.id = o.party_id WHERE o.id::text = $1`, [id]);
  if (!po) throw new NotFound('없는 발주입니다.');
  const lines = await db.query<Record<string, any>>(
    `SELECT l.item, l.qty::float8 AS qty, l.unit_price::bigint AS "unitPrice", (l.qty * l.unit_price)::bigint AS supply FROM acct_po_lines l WHERE l.po_id::text = $1 ORDER BY l.id`, [id]);
  const supply = lines.reduce((s, l) => s + n(l.supply), 0);
  return { po: { ...po, no: `P-${String(po.id).padStart(6, '0')}` }, lines, supply, vat: Math.floor(supply / 10), total: supply + Math.floor(supply / 10), company: await company(db) };
}

/* ── 전표(정기 작업 acct_journal · sources.ts 에 붙임) ── */
const docLines = (r: Record<string, any>): Line[] => [
  { role: 'AR', debit: n(r.total), credit: 0 },
  { role: String(r.role || 'REV_SALES'), debit: 0, credit: n(r.supply) },
  ...(n(r.vat) > 0 ? [{ role: 'VAT_OUT', debit: 0, credit: n(r.vat) }] : []),
];
const DSEL = `d.id::text AS key, p.name AS party, d.supply::bigint AS supply, d.vat::bigint AS vat, d.total::bigint AS total, d.revenue_role AS role, d.doc_no AS no`;
export const SALES_DOC_SOURCES: Source[] = [
  {
    name: 'SALES_DOC', label: '거래명세서 매출',
    sql: `SELECT ${DSEL}, d.accepted_at AS at
            FROM acct_sales_docs d JOIN acct_parties p ON p.id = d.party_id
           WHERE d.kind = 'STATEMENT' AND d.accepted_at IS NOT NULL AND d.state IN ('ACCEPTED', 'CANCELED') AND d.superseded_by IS NULL AND d.total > 0
             AND d.accepted_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'SALES_DOC' AND e.source_key = d.id::text)
           ORDER BY d.accepted_at LIMIT 500`,
    build: (r) => ({ memo: `거래명세서 ${r.no ?? ''}`.trim(), evidence: 'TAX_INVOICE', lines: docLines(r) }),
  },
  {
    name: 'SALES_DOC_CANCEL', label: '거래명세서 취소',
    sql: `SELECT ${DSEL}, d.canceled_at AS at
            FROM acct_sales_docs d JOIN acct_parties p ON p.id = d.party_id
           WHERE d.kind = 'STATEMENT' AND d.state = 'CANCELED' AND d.accepted_at IS NOT NULL AND d.canceled_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'SALES_DOC' AND e.source_key = d.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'SALES_DOC_CANCEL' AND e.source_key = d.id::text)
           ORDER BY d.canceled_at LIMIT 500`,
    build: (r) => ({ memo: `거래명세서 취소 ${r.no ?? ''}`.trim(), evidence: 'TAX_INVOICE',
      lines: docLines(r).map((l) => ({ role: l.role, debit: l.credit, credit: l.debit })) }),
  },
];

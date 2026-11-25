/* e3 (docs/010) 소개뱅크 src/modules/acct/taxinbox.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { createHash } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { envInt, envJson, FetchLike, getPath, httpJson } from '../../common/http-json';
import { addPurchase } from './purchase';

/* ---------------------------------------------------------------------
 * v10.432 (D255 · docs/569) 홈택스 매입 세금계산서 가져오기 — 대표 11/19 「모두개발」(이카운트 연동은 보류)
 *
 *   홈택스를 직접 긁지 않습니다(공동인증서 · 스크래핑). 「연동 업체(바로빌 · 팝빌 등) API」 하나를 어댑터로 둡니다.
 *     acct.taxinbox        on | off(처음 off)          — 가져오기 자체를 켬
 *     acct.taxinbox_mode   ASSUME | LIVE(처음 ASSUME)   — ASSUME 이면 업체에 묻지 않고 간주 줄(「간주」 표시 · 매일 같은 승인번호라 다시 가져와도 한 번)
 *     acct.taxinbox_provider GENERIC | POPBILL | BAROBILL(처음 GENERIC) — 응답 칸 이름 기본값만 다름(업체 문서로 확인 필요)
 *   키 · 주소: 외부 연동 › 연동 키 「TAXINBOX_API_KEY」(SUPER · 암호화) · .env TAXINBOX_API_BASE · TAXINBOX_CORP_NUM(우리 사업자번호) · TAXINBOX_MAP(JSON · 칸 경로)
 *   LIVE 인데 키 · 주소가 없으면 422 TAXINBOX_NOT_READY(조용히 간주로 돌아가지 않음).
 *
 *   가져온 줄 acct_tax_inbox — 쌓기만 · 승인번호(24자리) 하나에 한 줄 · 내용 못 고침 · 상태는 NEW → BOOKED(매입으로 넘김) · IGNORED(사유)만.
 *   사람이 계정 · 낸 방법을 골라 「매입으로」 → ⑫ acct_purchases(매입 세금계산서) · 같은 공급자 · 날짜 · 합계 매입이 이미 있으면 409(그래도 넘기기 가능).
 *   정기 작업 acct_taxinbox — 매일 08:10 지난 7일(켜져 있을 때만).
 * ------------------------------------------------------------------- */

export interface InboxItem { approvalNo: string; issuedOn: string; supplierBizNo: string; supplierName: string; item: string; supply: number; vat: number; exempt: boolean }
export interface InboxResult { ok: boolean; items: InboxItem[]; errorKind?: string; error?: string }
export interface TaxInboxAdapter { readonly name: 'assume' | 'http'; list(from: string, to: string): Promise<InboxResult> }

const PROVIDERS = ['GENERIC', 'POPBILL', 'BAROBILL'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');
const num = (v: unknown) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? Math.round(x) : NaN; };

/** 간주 — 날짜마다 같은 2줄(공급자 「(간주) 시험 공급자」 · 승인번호가 날짜에서 나와 다시 가져와도 같은 줄) */
export class AssumeTaxInbox implements TaxInboxAdapter {
  readonly name = 'assume' as const;
  async list(from: string, to: string): Promise<InboxResult> {
    const items: InboxItem[] = [];
    for (let d = from, i = 0; d <= to && i < 31; d = addDays(d, 1), i++) {
      if (new Date(d).getUTCDate() % 5 !== 0) continue;   // 닷새에 한 번만(목록이 너무 길지 않게)
      const base = d.replace(/-/g, '');
      items.push({ approvalNo: `${base}4100000000000001`.slice(0, 24), issuedOn: d, supplierBizNo: '1048100001', supplierName: '(간주) 시험 공급자 사무용품',
                   item: '(간주) 복사용지', supply: 50000, vat: 5000, exempt: false });
      items.push({ approvalNo: `${base}4100000000000002`.slice(0, 24), issuedOn: d, supplierBizNo: '1048100002', supplierName: '(간주) 시험 공급자 도서',
                   item: '(간주) 업무 도서(면세 계산서)', supply: 30000, vat: 0, exempt: true });
    }
    return { ok: true, items };
  }
}

/** 응답 칸 경로 — 업체마다 다름(확인 필요) · .env TAXINBOX_MAP(JSON)로 고침 */
const MAP_DEFAULTS: Record<string, Record<string, string>> = {
  GENERIC:  { list: 'items', approvalNo: 'approvalNo', issuedOn: 'issueDate', supplierBizNo: 'supplierCorpNum', supplierName: 'supplierCorpName', item: 'itemName', supply: 'supplyCost', vat: 'tax', kind: 'kind', exemptValue: 'INVOICE' },
  POPBILL:  { list: 'list', approvalNo: 'ntsconfirmNum', issuedOn: 'writeDate', supplierBizNo: 'invoicerCorpNum', supplierName: 'invoicerCorpName', item: 'itemName', supply: 'supplyCostTotal', vat: 'taxTotal', kind: 'taxType', exemptValue: '면세' },
  BAROBILL: { list: 'Items', approvalNo: 'NTSSendKey', issuedOn: 'WriteDate', supplierBizNo: 'InvoicerCorpNum', supplierName: 'InvoicerCorpName', item: 'ItemName', supply: 'AmountTotal', vat: 'TaxTotal', kind: 'TaxType', exemptValue: '2' },
};

/** 업체 HTTP — GET {base}/purchase-invoices?from=&to= · 머리 Authorization: Bearer {key} · X-Corp-Num: {우리 사업자번호}
 *  ★ 실제 업체 주소 · 인증 방식 · 날짜 모양은 업체 문서로 확인 필요 — 이 파일 한 곳(요청 모양 · MAP)만 고치면 됨 */
export class HttpTaxInbox implements TaxInboxAdapter {
  readonly name = 'http' as const;
  constructor(private readonly provider: string, private readonly fetchFn?: FetchLike) {}
  static ready() { return !!(process.env.TAXINBOX_API_BASE && process.env.TAXINBOX_API_KEY && process.env.TAXINBOX_CORP_NUM); }
  async list(from: string, to: string): Promise<InboxResult> {
    if (!HttpTaxInbox.ready()) return { ok: false, items: [], errorKind: 'NOT_CONFIGURED', error: '연동 업체 주소 · 키 · 사업자번호가 없습니다' };
    const m = envJson('TAXINBOX_MAP', MAP_DEFAULTS[this.provider] ?? MAP_DEFAULTS.GENERIC!).value;
    const base = String(process.env.TAXINBOX_API_BASE).replace(/\/+$/, '');
    const r = await httpJson({
      url: `${base}/purchase-invoices?from=${from.replace(/-/g, '')}&to=${to.replace(/-/g, '')}`, method: 'GET',
      headers: { Authorization: `Bearer ${process.env.TAXINBOX_API_KEY}`, 'X-Corp-Num': digits(process.env.TAXINBOX_CORP_NUM) },
      timeoutMs: envInt('TAXINBOX_TIMEOUT_MS', 10000), fetchFn: this.fetchFn,
    });
    if (!r.ok) return { ok: false, items: [], errorKind: r.errorKind ?? 'UPSTREAM', error: r.error ?? `HTTP ${r.status}` };
    const list = getPath(r.body, m.list);
    if (!Array.isArray(list)) return { ok: false, items: [], errorKind: 'BAD_RESPONSE', error: '목록 칸이 없습니다(TAXINBOX_MAP 확인)' };
    const items: InboxItem[] = [];
    for (const x of list) {
      const ap = digits(getPath(x, m.approvalNo)), d = digits(getPath(x, m.issuedOn));
      const supply = num(getPath(x, m.supply)), vat = num(getPath(x, m.vat));
      if (ap.length !== 24 || d.length !== 8 || !Number.isFinite(supply) || !Number.isFinite(vat)) continue;   // 모르는 줄은 건너뜀(셈에 남김)
      items.push({ approvalNo: ap, issuedOn: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, supplierBizNo: ((z) => (z.length === 10 ? z : ''))(digits(getPath(x, m.supplierBizNo))),
                   supplierName: String(getPath(x, m.supplierName) ?? '').slice(0, 120) || '(이름 없음)', item: String(getPath(x, m.item) ?? '').slice(0, 120) || '(품목 없음)',
                   supply, vat, exempt: String(getPath(x, m.kind) ?? '') === m.exemptValue || vat === 0 });
    }
    return { ok: true, items };
  }
}

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM erp_site_settings WHERE key IN ('acct.taxinbox', 'acct.taxinbox_mode', 'acct.taxinbox_provider')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const provider = (PROVIDERS as readonly string[]).includes(v('acct.taxinbox_provider') ?? '') ? v('acct.taxinbox_provider')! : 'GENERIC';
  return { on: v('acct.taxinbox') === 'on', mode: v('acct.taxinbox_mode') === 'LIVE' ? 'LIVE' : 'ASSUME', provider };
}

export function adapterFor(s: { mode: string; provider: string }, fetchFn?: FetchLike): TaxInboxAdapter {
  if (s.mode !== 'LIVE') return new AssumeTaxInbox();
  if (!HttpTaxInbox.ready()) throw new PolicyViolation('TAXINBOX_NOT_READY', '연동 업체 주소 · 키 · 사업자번호가 없습니다 — 외부 연동 › 연동 키에서 넣거나 간주(ASSUME)로 두십시오.');
  return new HttpTaxInbox(s.provider, fetchFn);
}

/** GET 상태 — 켜짐 · 방식 · 업체 · 키 준비 · 마지막 가져오기 */
export async function inboxStatus(db: DatabaseService) {
  const s = await settings(db);
  const [last] = await db.query(
    `SELECT id::text AS id, from_on::text AS "from", to_on::text AS "to", mode, provider, got, added, dup, skipped, error, created_at AS "createdAt"
       FROM acct_tax_inbox_fetches ORDER BY id DESC LIMIT 1`);
  return { ...s, ready: s.mode === 'ASSUME' || HttpTaxInbox.ready(), last: last ?? null };
}

/** POST 가져오기 — 기간 31일까지 · 같은 승인번호는 한 번(ON CONFLICT) · 결과 쌓기만 */
export async function fetchInbox(db: DatabaseService, b: { from?: string; to?: string }, actor: string | null, fetchFn?: FetchLike) {
  const s = await settings(db);
  if (!s.on) throw new PolicyViolation('TAXINBOX_OFF', '매입 세금계산서 가져오기가 꺼져 있습니다 — 정책 › 전체 설정 acct.taxinbox 를 켜십시오(SUPER).');
  const to = b.to && YMD.test(b.to) ? b.to : kstToday();
  const from = b.from && YMD.test(b.from) ? b.from : addDays(to, -6);
  if (from > to) throw new PolicyViolation('TAXINBOX_PERIOD', '시작일이 끝일보다 늦습니다.');
  if (Date.parse(to) - Date.parse(from) > 30 * 86400e3) throw new PolicyViolation('TAXINBOX_PERIOD', '한 번에 31일까지 가져옵니다.');
  const ad = adapterFor(s, fetchFn);
  const r = await ad.list(from, to);
  let added = 0, dup = 0;
  if (r.ok) {
    for (const x of r.items) {
      const hash = createHash('sha256').update([x.approvalNo, x.issuedOn, x.supplierBizNo, x.supply, x.vat].join('|')).digest('hex');
      const ins = await db.query(
        `INSERT INTO acct_tax_inbox (approval_no, issued_on, supplier_biz_no, supplier_name, item, supply, vat, exempt, source, provider, row_hash)
         VALUES ($1, $2::date, nullif($3, ''), $4, $5, $6::bigint, $7::bigint, $8, $9, $10, $11)
         ON CONFLICT (approval_no) DO NOTHING RETURNING id`,
        [x.approvalNo, x.issuedOn, x.supplierBizNo, x.supplierName, x.item, x.supply, x.vat, x.exempt, ad.name === 'assume' ? 'ASSUME' : 'PROVIDER', s.provider, hash]);
      if (ins.length) added++; else dup++;
    }
  }
  await db.query(
    `INSERT INTO acct_tax_inbox_fetches (from_on, to_on, mode, provider, got, added, dup, skipped, error, created_by)
     VALUES ($1::date, $2::date, $3, $4, $5, $6, $7, 0, $8, $9)`,
    [from, to, s.mode, s.provider, r.items.length, added, dup, r.ok ? null : `${r.errorKind ?? ''} ${r.error ?? ''}`.trim().slice(0, 200), actor]);
  if (!r.ok) return { ok: false, from, to, added, dup, note: `가져오지 못했습니다 — ${r.error ?? r.errorKind ?? '업체 오류'}` };
  return { ok: true, from, to, mode: s.mode, got: r.items.length, added, dup, note: `가져옴 ${r.items.length}줄 · 새로 ${added} · 이미 있음 ${dup}.` };
}

/** GET 목록 — 달 · 상태 · 이미 매입에 같은 건이 있는지(dupPurchaseId) */
export async function listInbox(db: DatabaseService, q: { ym?: string; state?: string }) {
  const ym = q.ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.ym) ? q.ym : kstToday().slice(0, 7);
  const st = ['NEW', 'BOOKED', 'IGNORED'].includes(q.state ?? '') ? q.state! : null;
  const items = await db.query(
    `SELECT t.id::text AS id, t.approval_no AS "approvalNo", t.issued_on::text AS "issuedOn", t.supplier_biz_no AS "supplierBizNo", t.supplier_name AS "supplierName",
            t.item, t.supply::bigint AS supply, t.vat::bigint AS vat, (t.supply + t.vat)::bigint AS total, t.exempt, t.source, t.state,
            t.purchase_id::text AS "purchaseId", t.ignore_note AS "ignoreNote", t.decided_at AS "decidedAt", t.created_at AS "createdAt",
            (SELECT p.id::text FROM acct_purchases p WHERE p.state = 'ACTIVE' AND p.issued_on = t.issued_on AND p.total = t.supply + t.vat
                AND (p.supplier_biz_no = t.supplier_biz_no OR (t.supplier_biz_no IS NULL AND p.supplier_name = t.supplier_name))
                AND (t.purchase_id IS NULL OR p.id <> t.purchase_id) ORDER BY p.id LIMIT 1) AS "dupPurchaseId"
       FROM acct_tax_inbox t
      WHERE to_char(t.issued_on, 'YYYY-MM') = $1 AND ($2::text IS NULL OR t.state = $2)
      ORDER BY (t.state = 'NEW') DESC, t.issued_on DESC, t.id DESC LIMIT 500`, [ym, st]);
  const [c] = await db.query<{ n: number; b: number; i: number }>(
    `SELECT count(*) FILTER (WHERE state = 'NEW')::int AS n, count(*) FILTER (WHERE state = 'BOOKED')::int AS b, count(*) FILTER (WHERE state = 'IGNORED')::int AS i
       FROM acct_tax_inbox WHERE to_char(issued_on, 'YYYY-MM') = $1`, [ym]);
  return { ym, items, count: { new: Number(c?.n ?? 0), booked: Number(c?.b ?? 0), ignored: Number(c?.i ?? 0) }, status: await inboxStatus(db) };
}

/** POST 매입으로 — 계정 · 낸 방법 고름 · 같은 매입이 있으면 409(force 로 넘김) · ⑫ addPurchase 로 넣고 줄은 BOOKED */
export async function bookInbox(db: DatabaseService, id: string, b: { accountRole: string; payRole: string; memo?: string; force?: boolean; requisitionId?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 줄입니다.');
  return db.transaction(async () => {
    const [t] = await db.query<{ approval_no: string; issued_on: string; supplier_biz_no: string | null; supplier_name: string; item: string; supply: string; vat: string; exempt: boolean; state: string }>(
      `SELECT approval_no, issued_on::text AS issued_on, supplier_biz_no, supplier_name, item, supply::text, vat::text, exempt, state FROM acct_tax_inbox WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!t) throw new NotFound('없는 줄입니다.');
    if (t.state !== 'NEW') throw new StateConflict('TAXINBOX_STATE', '이미 처리한 줄입니다.');
    if (!b.force) {
      const [dup] = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM acct_purchases WHERE state = 'ACTIVE' AND issued_on = $1::date AND total = $2::bigint
            AND (supplier_biz_no = $3 OR ($3::text IS NULL AND supplier_name = $4)) LIMIT 1`,
        [t.issued_on, Number(t.supply) + Number(t.vat), t.supplier_biz_no, t.supplier_name]);
      if (dup) throw new StateConflict('TAXINBOX_DUP', `같은 공급자 · 날짜 · 합계 매입(${dup.id}번)이 이미 있습니다 — 다른 건이면 「그래도 넘기기」.`);
    }
    const p = await addPurchase(db, {
      kind: 'TAX_INVOICE', issuedOn: t.issued_on, supplierName: t.supplier_name, supplierBizNo: t.supplier_biz_no ?? undefined, item: t.item,
      supply: Number(t.supply), vat: Number(t.vat), deductible: !t.exempt && Number(t.vat) > 0, accountRole: b.accountRole, payRole: b.payRole,
      memo: (b.memo ?? '').trim() || `전자세금계산서 ${t.approval_no}`, force: true, requisitionId: b.requisitionId,
    }, actor);
    await db.query(`UPDATE acct_tax_inbox SET state = 'BOOKED', purchase_id = $2::bigint, decided_by = $3, decided_at = now() WHERE id = $1::bigint`, [id, p.id, actor]);
    return { ok: true, id, purchaseId: p.id, note: `매입 ${p.id}번으로 넘겼습니다 — 전표는 정기 작업 또는 「지금 전표 만들기」.` };
  });
}

/** POST 넘기지 않음 — 사유(2 ~ 200자) · 개인 카드 · 다른 회사 것 등 */
export async function ignoreInbox(db: DatabaseService, id: string, note: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 줄입니다.');
  const t = (note ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const r = await db.query(`UPDATE acct_tax_inbox SET state = 'IGNORED', ignore_note = $2, decided_by = $3, decided_at = now() WHERE id = $1::bigint AND state = 'NEW' RETURNING id`, [id, t, actor]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM acct_tax_inbox WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 줄입니다.');
    throw new StateConflict('TAXINBOX_STATE', '이미 처리한 줄입니다.');
  }
  return { ok: true, id, note: '넘기지 않음으로 두었습니다.' };
}

/** 정기 작업 acct_taxinbox — 켜져 있을 때만 지난 7일 */
export async function acctTaxInboxJob(db: DatabaseService) {
  const s = await settings(db);
  if (!s.on) return { on: false, added: 0 };
  try {
    const r = await fetchInbox(db, {}, null);
    return { on: true, added: r.added, dup: r.dup, ok: r.ok };
  } catch (e) {
    return { on: true, added: 0, ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

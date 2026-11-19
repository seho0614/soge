import { DatabaseService } from '../../db/database.service';
import { ALL_SOURCES } from './sources';   // v10.392 — ⑫ 돈 흐름 이름까지
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.383 · 384 (D242 · docs/519 · 520) 신고 자료 · 경영 보고서 — 모두 전표(acct_entries · acct_lines)와 원래 표에서 읽기만
 * ------------------------------------------------------------------- */

const REV = ['REV_SUB', 'REV_REFCODE', 'REV_AD', 'REV_LEAD', 'REV_DIRECTORY', 'REV_COMMISSION', 'REV_MALL'];
const EV_KO: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '증빙 없음', CARD: '법인카드', SIMPLE: '간이영수증' };
const LABEL = Object.fromEntries(ALL_SOURCES.map((s) => [s.name, s.label]));

/** 'YYYY-n' → [시작, 끝) 날짜 · 비우면 이번 분기(한국) */
export function quarterRange(q?: string) {
  let y: number, n: number;
  const m = /^(\d{4})-([1-4])$/.exec(q ?? '');
  if (m) { y = Number(m[1]); n = Number(m[2]); }
  else if (q) return null;
  else { const k = new Date(Date.now() + 9 * 3600e3); y = k.getUTCFullYear(); n = Math.floor(k.getUTCMonth() / 3) + 1; }
  const from = `${y}-${String(n * 3 - 2).padStart(2, '0')}-01`;
  const to = n === 4 ? `${y + 1}-01-01` : `${y}-${String(n * 3 + 1).padStart(2, '0')}-01`;
  return { q: `${y}-${n}`, from, to };
}

export async function vatSummary(db: DatabaseService, q?: string) {
  const r = quarterRange(q);
  if (!r) return { ok: false as const, q: q ?? '', rows: [], total: { supply: 0, vat: 0, exempt: 0 } };
  const rows = await db.query<{ evidence: string; source: string; supply: string; vat: string; exempt: string; entries: number }>(
    `SELECT e.evidence, e.source,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = ANY($3::text[])), 0)::text AS supply,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = 'VAT_OUT'), 0)::text AS vat,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = 'REV_MALL_EXEMPT'), 0)::text AS exempt,
            count(DISTINCT e.id)::int AS entries
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id
      WHERE e.entry_date >= $1::date AND e.entry_date < $2::date
      GROUP BY e.evidence, e.source
     HAVING coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = ANY($3::text[]) OR l.role IN ('VAT_OUT', 'REV_MALL_EXEMPT')), 0) <> 0
      ORDER BY e.evidence, e.source`, [r.from, r.to, REV]);
  const out = rows.map((x) => ({ evidence: x.evidence, evidenceKo: EV_KO[x.evidence] ?? x.evidence, source: x.source, label: LABEL[x.source] ?? x.source,
    supply: Number(x.supply), vat: Number(x.vat), exempt: Number(x.exempt), entries: Number(x.entries) }));
  const total = out.reduce((a, x) => ({ supply: a.supply + x.supply, vat: a.vat + x.vat, exempt: a.exempt + x.exempt }), { supply: 0, vat: 0, exempt: 0 });
  const byEvidence = Object.values(out.reduce<Record<string, { evidence: string; evidenceKo: string; supply: number; vat: number; exempt: number }>>((a, x) => {
    const k = a[x.evidence] ?? (a[x.evidence] = { evidence: x.evidence, evidenceKo: x.evidenceKo, supply: 0, vat: 0, exempt: 0 });
    k.supply += x.supply; k.vat += x.vat; k.exempt += x.exempt; return a;
  }, {}));
  return { ok: true as const, q: r.q, from: r.from, to: r.to, rows: out, byEvidence, total,
           note: '전표에서 셈 — 신고서 칸(세금계산서 발행분 · 신용카드 · 기타)과 맞추는 것은 세무사 확인. 간주 · 시험 결제는 acct.include_stub 이 off 면 빠짐.' };
}

export async function withholdingSummary(db: DatabaseService, ym: string) {
  const [m] = await db.query<{ people: number; n: number; gross: string; it: string; lt: string; net: string }>(
    `SELECT count(DISTINCT account_id)::int AS people, count(*)::int AS n, coalesce(sum(points), 0)::text AS gross,
            coalesce(sum(income_tax), 0)::text AS it, coalesce(sum(local_tax), 0)::text AS lt, coalesce(sum(net_amount), 0)::text AS net
       FROM point_cashouts WHERE status = 'PAID' AND to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1`, [ym]);
  const [y] = await db.query<{ n: number; gross: string; it: string; lt: string }>(
    `SELECT count(*)::int AS n, coalesce(sum(points), 0)::text AS gross, coalesce(sum(income_tax), 0)::text AS it, coalesce(sum(local_tax), 0)::text AS lt
       FROM point_cashouts WHERE status = 'PAID' AND to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY') = left($1, 4) AND to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') <= $1`, [ym]);
  const num = (v: unknown) => Number(v ?? 0);
  return { ym, month: { people: num(m?.people), count: num(m?.n), gross: num(m?.gross), incomeTax: num(m?.it), localTax: num(m?.lt), net: num(m?.net) },
           ytd: { count: num(y?.n), gross: num(y?.gross), incomeTax: num(y?.it), localTax: num(y?.lt) },
           note: '사업소득(추천 보상 포인트 출금) — 다음 달 10일까지 원천세 신고 · 납부. 사람별 주민등록번호는 지급 › 「신고 자료」 CSV(내려받기 승인).' };
}

export async function taxInvoices(db: DatabaseService, ym: string) {
  const rows = await db.query<{ kind: string; id: string; party: string | null; total: string; issued: boolean; assumed: boolean; no: string | null; at: string;
                                 req_id: string | null; req_state: string | null; etax_status: string | null; biz_no: string | null }>(
    `SELECT 'DIRECTORY' AS kind, d.id::text AS id, d.buyer_name AS party, d.total::text AS total, (d.state = 'ISSUED') AS issued,
            (coalesce(d.etax_status, '') = 'ASSUMED') AS assumed, d.invoice_no AS no, d.created_at AS at, NULL::text AS req_id, NULL::text AS req_state, d.etax_status, d.buyer_biz_no AS biz_no
       FROM consult_directory_invoices d WHERE to_char(d.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1
     UNION ALL
     SELECT 'LEAD_CASH', i.id::text, b.company_name, i.total::text, (i.state = 'ISSUED'), (coalesce(i.etax_status, '') = 'ASSUMED'), i.invoice_no, i.created_at, NULL, NULL, i.etax_status, b.biz_reg_no
       FROM lead_cash_invoices i LEFT JOIN partners pt ON pt.id = i.partner_id LEFT JOIN businesses b ON b.id = pt.business_id
      WHERE i.ym = $1 AND i.state <> 'CANCELED'
     UNION ALL
     SELECT 'AD', a.id::text, v.name, a.total::text, (coalesce(btrim(a.tax_invoice_no), '') <> '' OR t.state = 'ISSUED'), (coalesce(t.etax_status, '') = 'ASSUMED'),
            coalesce(nullif(btrim(a.tax_invoice_no), ''), t.invoice_no), a.created_at, t.id::text, t.state, t.etax_status, v.biz_reg_no
       FROM ad_invoices a LEFT JOIN advertisers v ON v.id = a.advertiser_id
       LEFT JOIN acct_tax_invoices t ON t.kind = 'AD' AND t.source_id = a.id AND t.state <> 'CANCELED'
      WHERE a.status <> 'VOID' AND to_char(a.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1
     UNION ALL
     SELECT 'COMMISSION', s.id::text, h.name, (s.commission + s.commission_vat)::text, (s.invoice_state = 'ISSUED' OR t.state = 'ISSUED'), (coalesce(t.etax_status, '') = 'ASSUMED'),
            coalesce(s.invoice_no, t.invoice_no), s.confirmed_at, t.id::text, t.state, t.etax_status, h.biz_reg_no
       FROM hlt_settlements s JOIN hlt_sellers h ON h.id = s.seller_id AND h.type <> 'DIRECT'
       LEFT JOIN acct_tax_invoices t ON t.kind = 'COMMISSION' AND t.source_id = s.id AND t.state <> 'CANCELED'
      WHERE s.status IN ('CONFIRMED', 'PAID') AND s.commission > 0 AND to_char(s.confirmed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1
     ORDER BY 8 DESC LIMIT 500`, [ym]);
  const KO: Record<string, string> = { DIRECTORY: '정액 노출', LEAD_CASH: '리드 캐시', AD: '광고 청구', COMMISSION: '입점 수수료' };
  const items = rows.map((r) => ({ kind: r.kind, id: r.id, party: r.party, issued: r.issued, assumed: r.assumed, no: r.no, at: r.at,
    kindKo: KO[r.kind] ?? r.kind, total: Number(r.total), reqId: r.req_id, reqState: r.req_state, etaxStatus: r.etax_status, hasBizNo: !!r.biz_no,
    /* v10.391 — 광고 청구 · 입점 수수료는 여기서 「발행 요청」 → 「발행」(전자세금계산서 · 간주) */
    canRequest: (r.kind === 'AD' || r.kind === 'COMMISSION') && !r.issued && !r.req_id }));
  return { ym, items, todo: items.filter((x) => !x.issued).length, assumed: items.filter((x) => x.assumed).length,
           where: { DIRECTORY: '파트너사 › 정액 노출 › 세금계산서', LEAD_CASH: '파트너사 › 리드 캐시 › 세금계산서', AD: '회계 › 신고 자료 › 세금계산서(발행 요청 → 발행)', COMMISSION: '회계 › 신고 자료 › 세금계산서(발행 요청 → 발행)' },
           note: '정액 노출 · 리드 캐시 · 광고 청구 · 입점 수수료 모두 전자세금계산서(지금 간주 모드 — 번호 「간주-…」 · 국세청 승인번호 없음). 광고 청구 · 입점 수수료는 이 화면에서 「발행 요청」 뒤 「발행」(v10.391). 공급받는 분이 개인(사업자등록번호 없음)이면 세금계산서 대신 카드 · 현금영수증입니다.' };
}

/** v10.391 (D244 · docs/528) 광고 청구 · 입점 수수료 세금계산서 발행 요청 — 금액 · 공급받는 자를 지금 값으로 고정 */
export async function requestTaxInvoice(db: DatabaseService, kind: 'AD' | 'COMMISSION', sourceId: string, actor: string | null) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId ?? '')) throw new NotFound('근거(청구서 · 정산)가 없습니다.');
  const src = kind === 'AD'
    ? (await db.query<any>(
        `SELECT a.amount::bigint AS supply, a.vat::bigint AS vat, v.name AS buyer, v.biz_reg_no AS biz, '광고비 ' || a.period_from || ' ~ ' || a.period_to AS item,
                (a.status = 'VOID') AS void, coalesce(btrim(a.tax_invoice_no), '') <> '' AS has_no
           FROM ad_invoices a LEFT JOIN advertisers v ON v.id = a.advertiser_id WHERE a.id = $1`, [sourceId]))[0]
    : (await db.query<any>(
        `SELECT CASE WHEN s.commission_vat > 0 OR coalesce((SELECT value FROM site_settings WHERE key = 'acct.commission_vat_included'), 'off') <> 'on' THEN s.commission
                     ELSE round(s.commission / 1.1) END::bigint AS supply,
                CASE WHEN s.commission_vat > 0 THEN s.commission_vat
                     WHEN coalesce((SELECT value FROM site_settings WHERE key = 'acct.commission_vat_included'), 'off') = 'on' THEN s.commission - round(s.commission / 1.1)
                     ELSE 0 END::bigint AS vat,
                h.name AS buyer, h.biz_reg_no AS biz, '판매 수수료 ' || s.period_from || ' ~ ' || s.period_to AS item,
                (s.status NOT IN ('CONFIRMED', 'PAID') OR s.commission <= 0 OR h.type = 'DIRECT') AS void, (s.invoice_state = 'ISSUED') AS has_no
           FROM hlt_settlements s JOIN hlt_sellers h ON h.id = s.seller_id WHERE s.id = $1`, [sourceId]))[0];
  if (!src) throw new NotFound('근거(청구서 · 정산)가 없습니다.');
  if (src.void) throw new PolicyViolation('TAXINV_NOT_ELIGIBLE', kind === 'AD' ? '취소(VOID)한 청구서입니다.' : '확인 · 지급한 입점 정산(수수료 있음)만 발행합니다.');
  if (src.has_no) throw new StateConflict('TAXINV_HAS_NO', '이미 세금계산서 번호가 적혀 있습니다(손으로 발행).');
  if (Number(src.supply) <= 0) throw new PolicyViolation('TAXINV_NOT_ELIGIBLE', '공급가가 0원입니다.');
  const r = await db.query<{ id: string }>(
    `INSERT INTO acct_tax_invoices (kind, source_id, supply, vat, total, buyer_name, buyer_biz_no, item, requested_by)
     VALUES ($1, $2, $3, $4, $3::bigint + $4::bigint, $5, $6, $7, $8)
     ON CONFLICT (kind, source_id) WHERE state <> 'CANCELED' DO NOTHING RETURNING id::text AS id`,
    [kind, sourceId, Number(src.supply), Number(src.vat), String(src.buyer ?? '').slice(0, 120) || '(이름 없음)', src.biz ?? null, String(src.item).slice(0, 100), actor]);
  if (!r.length) throw new StateConflict('TAXINV_REQUESTED', '이미 발행 요청한 근거입니다.');
  return { ok: true, id: r[0].id, kind, slug: kind === 'AD' ? 'ad' : 'commission', supply: Number(src.supply), vat: Number(src.vat), total: Number(src.supply) + Number(src.vat), hasBizNo: !!src.biz,
           note: src.biz ? '발행 요청을 만들었습니다 — 「발행」을 누르면 전자세금계산서(지금은 간주)로 나갑니다.'
                         : '발행 요청을 만들었지만 공급받는 분의 사업자등록번호가 없습니다 — 개인이면 세금계산서 대신 카드 · 현금영수증입니다.' };
}

/** 발행 요청 취소 — 아직 보내지 않은 요청만 */
export async function cancelTaxInvoiceRequest(db: DatabaseService, id: string, reason: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) throw new NotFound('발행 요청이 없습니다.');
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('TAXINV_REASON', '사유는 2 ~ 200자입니다.');
  const r = await db.query(`UPDATE acct_tax_invoices SET state = 'CANCELED', cancel_reason = $2 WHERE id = $1 AND state = 'REQUESTED' AND etax_status IS NULL RETURNING id`, [id, t]);
  if (!r.length) throw new StateConflict('TAXINV_NOT_CANCELABLE', '보내지 않은 발행 요청만 취소합니다(보낸 것은 전자세금계산서 「취소 · 수정 발행」).');
  return { ok: true, id, note: '발행 요청을 취소했습니다 — 다시 요청할 수 있습니다.' };
}

export async function acctReport(db: DatabaseService, months: number) {
  const rows = await db.query<{ ym: string; role: string; d: string; c: string }>(
    `SELECT e.ym, l.role, sum(l.debit)::text AS d, sum(l.credit)::text AS c
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id
      WHERE e.entry_date >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - make_interval(months => $1::int - 1))::date
      GROUP BY e.ym, l.role ORDER BY e.ym`, [months]);
  const byYm = new Map<string, { ym: string; revenue: number; byRevenue: Record<string, number>; expense: number; profit: number; vat: number; cashIn: number; cashOut: number }>();
  for (const r of rows) {
    const m = byYm.get(r.ym) ?? { ym: r.ym, revenue: 0, byRevenue: {}, expense: 0, profit: 0, vat: 0, cashIn: 0, cashOut: 0 };
    const d = Number(r.d), c = Number(r.c);
    if (r.role.startsWith('REV_')) { m.revenue += c - d; m.byRevenue[r.role] = (m.byRevenue[r.role] ?? 0) + c - d; }
    else if (r.role.startsWith('EXP_')) m.expense += d - c;
    else if (r.role === 'VAT_OUT') m.vat += c - d;
    else if (r.role === 'CASH' || r.role === 'PG_RECV') { m.cashIn += d; m.cashOut += c; }
    byYm.set(r.ym, m);
  }
  const list = [...byYm.values()].map((m) => ({ ...m, profit: m.revenue - m.expense }));
  const names = Object.fromEntries((await db.query<{ role: string; name: string }>(`SELECT role, name FROM acct_accounts WHERE role LIKE 'REV_%'`)).map((x) => [x.role, x.name]));
  const last = list[list.length - 1], prev = list[list.length - 2];
  const pct = (a?: number, b?: number) => (a == null || !b ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
  return { months: list, revenueNames: names, latest: last ?? null, change: { revenue: pct(last?.revenue, prev?.revenue), profit: pct(last?.profit, prev?.profit) },
           note: '전표에서 셈(공급가 · 부가세 뺌) — 회사 장부 전체가 아니라 소개뱅크 시스템을 지난 돈만입니다(급여 · 임대료 등 비용은 회계 프로그램).' };
}

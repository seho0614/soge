/* e3 (docs/010) 소개뱅크 src/modules/acct/ledger.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { dateOk, debitNormal, openingSetFor } from './statements';

/* ---------------------------------------------------------------------
 * v10.397 (D246 · docs/534) 계정별 원장 · 매입매출장
 *   원장 — 계정 하나의 기간 줄(날짜 · 전표 · 적요 · 거래처 · 차변 · 대변 · 잔액) · 기초는 시산표와 같은 방식(확정 판 + 그 뒤 전표).
 *   매출장 — 매출(REV_*) · 부가세예수금 줄이 있는 전표를 거래처별 · 전표별로(공급가 · 세액 · 합계 · 증빙).
 *   매입장 — 부가세대급금(VAT_IN) 줄이 있거나 매입 · 경비 · 법인카드 돈 흐름(PURCHASE · EXPENSE_APPROVED · CARD_TXN) 전표 — 공제 · 불공제 구분.
 *   CSV 는 거래처 이름이 들어가 내려받기 승인 ACCT_LEDGER(PAYOUT 요청 · SUPER 승인).
 * ------------------------------------------------------------------- */

export const LEDGER_MAX = 5000;
export const PURCHASE_SOURCES_NAMES = ['PURCHASE', 'PURCHASE_CANCEL', 'EXPENSE_APPROVED', 'CARD_TXN'];
const EV_KO: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '', CARD: '법인카드', SIMPLE: '간이영수증' };

function range(from?: string, to?: string) {
  dateOk(from); dateOk(to);
  if (from! > to!) throw new PolicyViolation('ACCT_DATE', '시작일이 끝일보다 늦습니다.');
  if (Date.parse(to!) - Date.parse(from!) > 366 * 86400e3) throw new PolicyViolation('ACCT_DATE', '기간은 1년까지입니다.');
  return { from: from!, to: to! };
}

/** 계정별 원장 */
export async function accountLedger(db: DatabaseService, role: string, fromQ?: string, toQ?: string) {
  const { from, to } = range(fromQ, toQ);
  const [acc] = await db.query<{ role: string; name: string; kind: string; code: string | null }>(`SELECT role, name, kind, ext_code AS code FROM acct_accounts WHERE role = $1`, [role]);
  if (!acc) throw new NotFound('없는 계정입니다.');
  const set = await openingSetFor(db, from);
  const base = set?.asOf ?? '0001-01-01';
  const [op] = await db.query<{ d: string; c: string }>(
    `SELECT (coalesce((SELECT sum(debit) FROM acct_opening WHERE set_id = $1::bigint AND role = $2), 0)
           + coalesce((SELECT sum(l.debit) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = $2 AND e.entry_date >= $3::date AND e.entry_date < $4::date), 0))::text AS d,
            (coalesce((SELECT sum(credit) FROM acct_opening WHERE set_id = $1::bigint AND role = $2), 0)
           + coalesce((SELECT sum(l.credit) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = $2 AND e.entry_date >= $3::date AND e.entry_date < $4::date), 0))::text AS c`,
    [set?.id ?? null, role, base, from]);
  const sign = debitNormal(acc.kind) ? 1 : -1;
  const opening = sign * (Number(op?.d ?? 0) - Number(op?.c ?? 0));
  const lines = await db.query<{ date: string; entryId: string; source: string; memo: string | null; party: string | null; evidence: string; debit: string; credit: string; late: boolean }>(
    `SELECT e.entry_date::text AS date, e.id::text AS "entryId", e.source, e.memo, e.party, e.evidence, l.debit::text AS debit, l.credit::text AS credit, e.late
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = $1 AND e.entry_date >= $2::date AND e.entry_date <= $3::date
      ORDER BY e.entry_date, e.id, l.id LIMIT ${LEDGER_MAX + 1}`, [role, from, to]);
  let bal = opening, d = 0, c = 0;
  const rows = lines.slice(0, LEDGER_MAX).map((l) => {
    const dd = Number(l.debit), cc = Number(l.credit);
    d += dd; c += cc; bal += sign * (dd - cc);
    return { date: l.date, entryId: l.entryId, source: l.source, memo: l.memo ?? '', party: l.party ?? '', evidence: l.evidence, debit: dd, credit: cc, balance: bal, late: l.late };
  });
  return { account: acc, from, to, openingSet: set, opening, rows, total: { debit: d, credit: c }, closing: bal, truncated: lines.length > LEDGER_MAX,
           note: lines.length > LEDGER_MAX ? `줄이 ${LEDGER_MAX}개를 넘어 앞 ${LEDGER_MAX}줄만 보입니다 — 기간을 나누십시오.` : '' };
}

export function ledgerCsv(r: Awaited<ReturnType<typeof accountLedger>>) {
  const head = ['일자', '전표번호', '근거', '적요', '거래처', '증빙', '차변', '대변', '잔액'];
  const body: unknown[][] = [[r.from, '', '', '기초 잔액', '', '', '', '', r.opening],
    ...r.rows.map((x) => [x.date, x.entryId, x.source, x.memo, x.party, EV_KO[x.evidence] ?? '', x.debit, x.credit, x.balance]),
    [r.to, '', '', '합계 · 기말', '', '', r.total.debit, r.total.credit, r.closing]];
  return { head, body };
}

/** 매입매출장 — kind SALES · PURCHASE · 거래처별 합 + 전표별 줄 */
export async function salesPurchaseBook(db: DatabaseService, kind: string, fromQ?: string, toQ?: string) {
  if (kind !== 'SALES' && kind !== 'PURCHASE') throw new PolicyViolation('ACCT_BOOK', '장부 종류는 SALES(매출장) · PURCHASE(매입장)입니다.');
  const { from, to } = range(fromQ, toQ);
  const rows = kind === 'SALES'
    ? await db.query<{ date: string; entryId: string; source: string; party: string | null; evidence: string; memo: string | null; supply: string; vat: string; exempt: string }>(
        `SELECT e.entry_date::text AS date, e.id::text AS "entryId", e.source, e.party, e.evidence, e.memo,
                sum(CASE WHEN a.kind = 'REVENUE' AND l.role <> 'REV_MALL_EXEMPT' THEN l.credit - l.debit ELSE 0 END)::text AS supply,
                sum(CASE WHEN l.role = 'VAT_OUT' THEN l.credit - l.debit ELSE 0 END)::text AS vat,
                sum(CASE WHEN l.role = 'REV_MALL_EXEMPT' THEN l.credit - l.debit ELSE 0 END)::text AS exempt
           FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
          WHERE e.entry_date >= $1::date AND e.entry_date <= $2::date
            AND EXISTS (SELECT 1 FROM acct_lines x JOIN acct_accounts xa ON xa.role = x.role WHERE x.entry_id = e.id AND (xa.kind = 'REVENUE' OR x.role = 'VAT_OUT'))
            AND e.source NOT IN ('ASSET_DISPOSE', 'YEAR_CLOSE')
          GROUP BY e.id ORDER BY e.entry_date, e.id LIMIT ${LEDGER_MAX + 1}`, [from, to])
    : await db.query<{ date: string; entryId: string; source: string; party: string | null; evidence: string; memo: string | null; supply: string; vat: string; exempt: string }>(
        `SELECT e.entry_date::text AS date, e.id::text AS "entryId", e.source, e.party, e.evidence, e.memo,
                sum(CASE WHEN a.kind IN ('EXPENSE', 'ASSET') AND l.role NOT IN ('VAT_IN', 'CASH', 'PG_RECV', 'AR') THEN l.debit - l.credit ELSE 0 END)::text AS supply,
                sum(CASE WHEN l.role = 'VAT_IN' THEN l.debit - l.credit ELSE 0 END)::text AS vat,
                '0' AS exempt
           FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
          WHERE e.entry_date >= $1::date AND e.entry_date <= $2::date
            AND (e.source = ANY($3::text[]) OR EXISTS (SELECT 1 FROM acct_lines x WHERE x.entry_id = e.id AND x.role = 'VAT_IN'))
            AND e.source NOT IN ('PG_SETTLE')
          GROUP BY e.id ORDER BY e.entry_date, e.id LIMIT ${LEDGER_MAX + 1}`, [from, to, PURCHASE_SOURCES_NAMES]);
  const items = rows.slice(0, LEDGER_MAX).map((r) => {
    const supply = Number(r.supply), vat = Number(r.vat), exempt = Number(r.exempt);
    return { date: r.date, entryId: r.entryId, source: r.source, party: r.party ?? '', evidence: r.evidence, memo: r.memo ?? '', supply, vat, exempt, total: supply + vat + exempt,
             deductible: kind === 'PURCHASE' ? vat !== 0 : null };
  });
  const byParty = new Map<string, { party: string; count: number; supply: number; vat: number; exempt: number; total: number }>();
  for (const x of items) {
    const k = x.party || '(거래처 없음)';
    const p = byParty.get(k) ?? { party: k, count: 0, supply: 0, vat: 0, exempt: 0, total: 0 };
    p.count++; p.supply += x.supply; p.vat += x.vat; p.exempt += x.exempt; p.total += x.total;
    byParty.set(k, p);
  }
  const sum = (f: 'supply' | 'vat' | 'exempt' | 'total') => items.reduce((a, x) => a + x[f], 0);
  return { kind, from, to, items, parties: [...byParty.values()].sort((a, b) => b.total - a.total),
           total: { count: items.length, supply: sum('supply'), vat: sum('vat'), exempt: sum('exempt'), total: sum('total') }, truncated: rows.length > LEDGER_MAX,
           note: kind === 'SALES' ? '매출 · 부가세예수금 줄이 있는 전표(취소 · 환불은 음수)입니다. 거래처가 비어 있는 줄은 카드 · PG 결제(개인 회원)입니다.'
                                  : '부가세대급금 줄이 있거나 매입 · 경비 · 법인카드 전표입니다. 세액이 0 이면 불공제(간이영수증 · 기업업무추진비 등)입니다.' };
}

export function bookCsv(r: Awaited<ReturnType<typeof salesPurchaseBook>>) {
  const head = ['일자', '전표번호', '근거', '거래처', '증빙', '적요', '공급가', '세액', ...(r.kind === 'SALES' ? ['면세'] : ['공제']), '합계'];
  const body = r.items.map((x) => [x.date, x.entryId, x.source, x.party, EV_KO[x.evidence] ?? '', x.memo, x.supply, x.vat, r.kind === 'SALES' ? x.exempt : (x.deductible ? '공제' : '불공제'), x.total]);
  return { head, body };
}

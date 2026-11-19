import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.456 (D261 · docs/593) 거래처별 원장
 *   ⑯ 거래처 대장(acct_parties) 이름 = 전표 거래처(acct_entries.party) 이름으로 찾음(⑭ 기간 분석 · ㉓ 독촉과 같은 규칙)
 *   받을 돈(AR 외상매출금) · 갚을 돈(AP 미지급금 · CARD_AP 법인카드 미지급금) 줄 — 기간 앞 잔액(기초) · 줄마다 늘고 줄음 · 잔액 · 기말
 *   해 마감 전표(YEAR_CLOSE · YEAR_REOPEN)는 뺌(잔액 계정은 마감 전표가 건드리지 않지만 같은 규칙으로)
 *   CSV 는 거래처 이름 · 금액이 들어가 내려받기 승인(ACCT_LEDGER — ⑬ 계정별 원장과 같은 대상)
 * ------------------------------------------------------------------- */

export const PARTY_ROLES = ['AR', 'AP', 'CARD_AP'] as const;
const ROLE_KO: Record<string, string> = { AR: '받을 돈(외상매출금)', AP: '갚을 돈(미지급금)', CARD_AP: '법인카드 미지급금' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const sign = (role: string, d: number, c: number) => (role === 'AR' ? d - c : c - d);   // 늘면 +

function period(from?: string, to?: string) {
  const t = to && YMD.test(to) ? to : kstToday();
  const f = from && YMD.test(from) ? from : `${t.slice(0, 7)}-01`;
  if (f > t) throw new PolicyViolation('ACCT_DATE', '시작일이 끝일보다 늦습니다.');
  if (Date.parse(t) - Date.parse(f) > 366 * 86400e3) throw new PolicyViolation('ACCT_DATE', '한 번에 1년까지 봅니다.');
  return { from: f, to: t };
}

/** GET /admin/acct/party-ledger?from=&to= — 거래처별 기초 · 늘어남 · 줄어듦 · 기말(받을 돈 · 갚을 돈) */
export async function partyLedgerSummary(db: DatabaseService, fromIn?: string, toIn?: string) {
  const { from, to } = period(fromIn, toIn);
  const rows = await db.query<{ party: string; role: string; open: string; inc: string; dec: string; n: number }>(
    `SELECT e.party AS party, l.role,
            sum(CASE WHEN e.entry_date < $1::date THEN (CASE WHEN l.role = 'AR' THEN l.debit - l.credit ELSE l.credit - l.debit END) ELSE 0 END)::text AS open,
            sum(CASE WHEN e.entry_date >= $1::date THEN greatest(CASE WHEN l.role = 'AR' THEN l.debit - l.credit ELSE l.credit - l.debit END, 0) ELSE 0 END)::text AS inc,
            sum(CASE WHEN e.entry_date >= $1::date THEN greatest(CASE WHEN l.role = 'AR' THEN l.credit - l.debit ELSE l.debit - l.credit END, 0) ELSE 0 END)::text AS dec,
            count(*) FILTER (WHERE e.entry_date >= $1::date)::int AS n
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = ANY($3::text[]) AND e.entry_date <= $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND nullif(btrim(e.party), '') IS NOT NULL
      GROUP BY e.party, l.role`, [from, to, PARTY_ROLES as unknown as string[]]);
  const parties = await db.query<{ id: string; name: string; kind: string; state: string }>(`SELECT id::text AS id, name, kind, state FROM acct_parties`);
  const byName = new Map(parties.map((p) => [p.name, p]));
  const box = new Map<string, { partyId: string | null; party: string; inBook: boolean; ar: { open: number; inc: number; dec: number; close: number }; ap: { open: number; inc: number; dec: number; close: number }; lines: number }>();
  for (const r of rows) {
    const p = byName.get(r.party);
    const b = box.get(r.party) ?? (box.set(r.party, { partyId: p?.id ?? null, party: r.party, inBook: !!p, ar: { open: 0, inc: 0, dec: 0, close: 0 }, ap: { open: 0, inc: 0, dec: 0, close: 0 }, lines: 0 }), box.get(r.party)!);
    const t = r.role === 'AR' ? b.ar : b.ap;   // AP · CARD_AP 는 갚을 돈 한 칸으로
    t.open += Number(r.open); t.inc += Number(r.inc); t.dec += Number(r.dec); t.close = t.open + t.inc - t.dec;
    b.lines += r.n;
  }
  const items = [...box.values()].filter((x) => x.lines > 0 || x.ar.close !== 0 || x.ap.close !== 0)
    .sort((a, b) => Math.abs(b.ar.close) + Math.abs(b.ap.close) - (Math.abs(a.ar.close) + Math.abs(a.ap.close)));
  const total = items.reduce((s, x) => ({ ar: s.ar + x.ar.close, ap: s.ap + x.ap.close }), { ar: 0, ap: 0 });
  return { from, to, items, total, notInBook: items.filter((x) => !x.inBook).length,
    note: '전표 거래처 이름으로 모읍니다 — 거래처 대장에 없는 이름은 「대장 없음」으로 보입니다(이름을 대장과 같게 적으면 한 줄로 모임).' };
}

/** GET /admin/acct/party-ledger/{id}?from=&to= — 한 거래처 줄(날짜 · 전표 · 내용 · 늘고 줄음 · 잔액) */
export async function partyLedger(db: DatabaseService, idIn: string, fromIn?: string, toIn?: string) {
  if (!/^\d{1,18}$/.test(String(idIn ?? ''))) throw new NotFound('없는 거래처입니다.');
  const { from, to } = period(fromIn, toIn);
  const [p] = await db.query<{ id: string; name: string; kind: string; biz_no: string | null; state: string }>(
    `SELECT id::text AS id, name, kind, biz_no, state FROM acct_parties WHERE id = $1::bigint`, [idIn]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  const opens = await db.query<{ role: string; v: string }>(
    `SELECT l.role, sum(CASE WHEN l.role = 'AR' THEN l.debit - l.credit ELSE l.credit - l.debit END)::text AS v
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE e.party = $1 AND l.role = ANY($2::text[]) AND e.entry_date < $3::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
      GROUP BY l.role`, [p.name, PARTY_ROLES as unknown as string[], from]);
  const lines = await db.query<{ entry_id: string; d: string; source: string; memo: string | null; role: string; debit: string; credit: string }>(
    `SELECT e.id::text AS entry_id, e.entry_date::text AS d, e.source, e.memo, l.role, l.debit::text AS debit, l.credit::text AS credit
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE e.party = $1 AND l.role = ANY($2::text[]) AND e.entry_date BETWEEN $3::date AND $4::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
      ORDER BY e.entry_date, e.id, l.id`, [p.name, PARTY_ROLES as unknown as string[], from, to]);
  const bal: Record<string, number> = Object.fromEntries(PARTY_ROLES.map((r) => [r, Number(opens.find((o) => o.role === r)?.v ?? 0)]));
  const opening = { ...bal };
  const rows = lines.map((l) => {
    const d = Number(l.debit), c = Number(l.credit), delta = sign(l.role, d, c);
    bal[l.role] = (bal[l.role] ?? 0) + delta;
    return { entryId: l.entry_id, date: l.d, source: l.source, memo: l.memo, role: l.role, roleKo: ROLE_KO[l.role] ?? l.role,
             increase: Math.max(delta, 0), decrease: Math.max(-delta, 0), balance: bal[l.role] };
  });
  return { party: { id: p.id, name: p.name, kind: p.kind, bizNo: p.biz_no, state: p.state }, from, to, opening, closing: { ...bal }, rows, roles: ROLE_KO,
    note: '받을 돈은 늘면(외상 매출) +, 받으면 − · 갚을 돈은 늘면(외상 매입 · 카드) +, 갚으면 − 입니다. 전표 거래처 이름이 대장 이름과 같은 줄만 나옵니다.' };
}

/** CSV 머리 · 줄 — 컨트롤러가 toCsv 로 */
export function partyLedgerCsv(r: Awaited<ReturnType<typeof partyLedger>>) {
  const head = ['날짜', '전표', '돈 흐름', '내용', '계정', '늘어남', '줄어듦', '잔액'];
  const body: unknown[][] = [];
  for (const role of PARTY_ROLES) body.push([r.from, '', '', '기초', ROLE_KO[role], '', '', r.opening[role] ?? 0]);
  for (const x of r.rows) body.push([x.date, x.entryId, x.source, x.memo ?? '', x.roleKo, x.increase, x.decrease, x.balance]);
  for (const role of PARTY_ROLES) body.push([r.to, '', '', '기말', ROLE_KO[role], '', '', r.closing[role] ?? 0]);
  return { head, body };
}

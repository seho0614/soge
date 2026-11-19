import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.396 (D246 · docs/533) 시산표 · 손익계산서 · 재무상태표 · 기초 잔액
 *   잔액 = 기초 잔액(확정한 판 중 기준일이 from 이전 가장 늦은 것) + 그 기준일부터의 전표.
 *   기초 잔액이 없으면 전표만(시스템을 지난 돈만 — 재무상태표가 맞지 않음을 화면에 알림).
 *   부호 — 자산 · 비용은 차변 − 대변, 부채 · 자본 · 매출은 대변 − 차변(「제 쪽」 잔액). 감가상각누계액(ACC_DEPR)은 자산 줄에서 음수로 보임.
 *   trialBalance 는 ⑭ 해 마감 · ⑮ 법인세가 씀(이름 · 모양 고정).
 * ------------------------------------------------------------------- */

export type Kind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export const KIND_ORDER: Kind[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
export const KIND_KO: Record<Kind, string> = { ASSET: '자산', LIABILITY: '부채', EQUITY: '자본', REVENUE: '매출 · 수익', EXPENSE: '비용' };
/** 제 쪽 부호 — 차변이 늘면 + 인 종류 */
export const debitNormal = (k: string) => k === 'ASSET' || k === 'EXPENSE';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const dateOk = (d: string | undefined, code = 'ACCT_DATE') => {
  if (!d || !DATE.test(d) || Number.isNaN(Date.parse(d))) throw new PolicyViolation(code, '날짜는 YYYY-MM-DD 로 적어 주십시오.');
  return d;
};
const addDay = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export interface TbRow {
  role: string; name: string; kind: Kind; code: string | null; codeName: string | null;
  opening: number; debit: number; credit: number; closing: number;
}
export interface TrialBalance {
  from: string; to: string; openingSet: { id: string; asOf: string } | null;
  rows: TbRow[]; total: { debit: number; credit: number; openingDebit: number; openingCredit: number; closingDebit: number; closingCredit: number }; balanced: boolean;
}

/** 쓰는 기초 잔액 판 — 확정 · 기준일 ≤ day 중 가장 늦은 것 */
export async function openingSetFor(db: DatabaseService, day: string) {
  const [s] = await db.query<{ id: string; as_of: string }>(
    `SELECT id::text AS id, as_of::text AS as_of FROM acct_opening_sets WHERE state = 'FIXED' AND as_of <= $1::date ORDER BY as_of DESC LIMIT 1`, [day]);
  return s ? { id: s.id, asOf: s.as_of } : null;
}

/**
 * 시산표 — 계정마다 기초(from 0시) · 기간 차변 · 대변(from ~ to) · 기말(to 끝).
 * from 을 비우면 to 이전 가장 늦은 확정 판부터(판이 없으면 처음부터 · 기초 0).
 * ⑭ · ⑮ 가 씀 — 바꾸면 그쪽 시험도.
 */
export async function trialBalance(db: DatabaseService, from: string | null, to: string, opts: { withZero?: boolean } = {}): Promise<TrialBalance> {
  dateOk(to);
  if (from) dateOk(from);
  if (from && from > to) throw new PolicyViolation('ACCT_DATE', '시작일이 끝일보다 늦습니다.');
  const set = await openingSetFor(db, from ?? to);   // from 이 없으면 to 까지 확정한 판 중 가장 늦은 것(재무상태표)
  const base = set?.asOf ?? '0001-01-01';
  const start = from ?? base;
  const rows = await db.query<{ role: string; name: string; kind: Kind; code: string | null; cname: string | null; sort: number; od: string; oc: string; pd: string; pc: string }>(
    `WITH op AS (SELECT role, sum(debit) AS d, sum(credit) AS c FROM acct_opening WHERE set_id = $1::bigint GROUP BY role),
          pre AS (SELECT l.role, sum(l.debit) AS d, sum(l.credit) AS c FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
                   WHERE e.entry_date >= $2::date AND e.entry_date < $3::date GROUP BY l.role),
          per AS (SELECT l.role, sum(l.debit) AS d, sum(l.credit) AS c FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
                   WHERE e.entry_date >= $3::date AND e.entry_date <= $4::date GROUP BY l.role)
     SELECT a.role, a.name, a.kind, a.ext_code AS code, a.ext_name AS cname, a.sort,
            (coalesce(op.d, 0) + coalesce(pre.d, 0))::text AS od, (coalesce(op.c, 0) + coalesce(pre.c, 0))::text AS oc,
            coalesce(per.d, 0)::text AS pd, coalesce(per.c, 0)::text AS pc
       FROM acct_accounts a LEFT JOIN op ON op.role = a.role LEFT JOIN pre ON pre.role = a.role LEFT JOIN per ON per.role = a.role
      ORDER BY array_position(ARRAY['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'], a.kind), a.sort, a.role`,
    [set?.id ?? null, base, start, to]);
  const out: TbRow[] = [];
  const t = { debit: 0, credit: 0, openingDebit: 0, openingCredit: 0, closingDebit: 0, closingCredit: 0 };
  for (const r of rows) {
    const od = Number(r.od), oc = Number(r.oc), d = Number(r.pd), c = Number(r.pc);
    const sign = debitNormal(r.kind) ? 1 : -1;
    const opening = sign * (od - oc), closing = sign * (od - oc + d - c);
    t.debit += d; t.credit += c;
    const on = od - oc, cn = od - oc + d - c;
    if (on > 0) t.openingDebit += on; else t.openingCredit -= on;
    if (cn > 0) t.closingDebit += cn; else t.closingCredit -= cn;
    if (!opts.withZero && opening === 0 && d === 0 && c === 0 && closing === 0) continue;
    out.push({ role: r.role, name: r.name, kind: r.kind, code: r.code, codeName: r.cname, opening, debit: d, credit: c, closing });
  }
  return { from: start === '0001-01-01' ? '' : start, to, openingSet: set, rows: out, total: t,
           balanced: t.debit === t.credit && t.openingDebit === t.openingCredit && t.closingDebit === t.closingCredit };
}

/** 손익계산서 — 기간 매출 · 비용(공급가 · 전표 기준) · 순이익 */
export async function incomeStatement(db: DatabaseService, from: string, to: string) {
  dateOk(from); dateOk(to);
  const tb = await trialBalance(db, from, to);
  const per = (r: TbRow) => (debitNormal(r.kind) ? r.debit - r.credit : r.credit - r.debit);
  const revenue = tb.rows.filter((r) => r.kind === 'REVENUE').map((r) => ({ role: r.role, name: r.name, code: r.code, amount: per(r) })).filter((r) => r.amount !== 0);
  const expense = tb.rows.filter((r) => r.kind === 'EXPENSE').map((r) => ({ role: r.role, name: r.name, code: r.code, amount: per(r) })).filter((r) => r.amount !== 0);
  const rev = revenue.reduce((a, r) => a + r.amount, 0), exp = expense.reduce((a, r) => a + r.amount, 0);
  const cogs = expense.find((r) => r.role === 'COGS')?.amount ?? 0;
  return { from, to, revenue, expense, total: { revenue: rev, cogs, grossProfit: rev - cogs, expense: exp, profit: rev - exp },
           note: '전표 기준 손익(공급가 · 부가세 뺌)입니다. 법인세 · 결산 조정(미지급 비용 등)은 들어 있지 않습니다 — 세무사 결산과 다를 수 있습니다.' };
}

/** 재무상태표 — asOf 끝 잔액 · 자산 = 부채 + 자본 + 아직 마감하지 않은 손익 */
export async function balanceSheet(db: DatabaseService, asOf: string) {
  dateOk(asOf);
  const tb = await trialBalance(db, null, asOf);
  const pick = (k: Kind) => tb.rows.filter((r) => r.kind === k && r.closing !== 0).map((r) => ({ role: r.role, name: r.name, code: r.code, amount: r.closing }));
  const assets = pick('ASSET'), liabilities = pick('LIABILITY'), equity = pick('EQUITY');
  const sum = (xs: Array<{ amount: number }>) => xs.reduce((a, x) => a + x.amount, 0);
  const unclosed = tb.rows.filter((r) => r.kind === 'REVENUE').reduce((a, r) => a + r.closing, 0) - tb.rows.filter((r) => r.kind === 'EXPENSE').reduce((a, r) => a + r.closing, 0);
  const A = sum(assets), L = sum(liabilities), E = sum(equity);
  const warn: string[] = [];
  if (!tb.openingSet) warn.push('기초 잔액이 없습니다 — 시스템을 지난 돈만이라 통장 잔액 · 자본금이 빠져 있습니다(회계 › 재무제표 › 기초 잔액).');
  if (A !== L + E + unclosed) warn.push(`자산 ${A} 과 부채 + 자본 ${L + E + unclosed} 이 다릅니다 — 전표 · 기초 잔액을 확인하십시오.`);
  return { asOf, openingSet: tb.openingSet, assets, liabilities, equity, unclosedProfit: unclosed,
           total: { assets: A, liabilities: L, equity: E, liabilitiesAndEquity: L + E + unclosed }, balanced: A === L + E + unclosed, warnings: warn,
           note: '「아직 마감하지 않은 손익」은 해 마감(v10.402) 전 올해 손익입니다. 해 마감 뒤에는 이월이익잉여금으로 옮겨집니다.' };
}

/* ── 기초 잔액 ── */
export async function openingList(db: DatabaseService) {
  const sets = await db.query<{ id: string; asOf: string; state: string; note: string | null; createdAt: string; fixedAt: string | null; d: string; c: string; n: number }>(
    `SELECT s.id::text AS id, s.as_of::text AS "asOf", s.state, s.note, s.created_at AS "createdAt", s.fixed_at AS "fixedAt",
            coalesce(sum(o.debit), 0)::text AS d, coalesce(sum(o.credit), 0)::text AS c, count(o.id)::int AS n
       FROM acct_opening_sets s LEFT JOIN acct_opening o ON o.set_id = s.id GROUP BY s.id ORDER BY s.as_of DESC LIMIT 20`);
  const lines = await db.query<{ setId: string; id: string; role: string; name: string; kind: string; debit: number; credit: number; memo: string | null }>(
    `SELECT o.set_id::text AS "setId", o.id::text AS id, o.role, a.name, a.kind, o.debit::float8 AS debit, o.credit::float8 AS credit, o.memo
       FROM acct_opening o JOIN acct_accounts a ON a.role = o.role
      WHERE o.set_id IN (SELECT id FROM acct_opening_sets ORDER BY as_of DESC LIMIT 20) ORDER BY o.set_id, a.sort, o.id`);
  const [st] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.start_on'`);
  return { sets: sets.map((s) => ({ ...s, debit: Number(s.d), credit: Number(s.c), lines: lines.filter((l) => l.setId === s.id) })), startOn: (st?.value ?? '2026-11-01').slice(0, 10),
           note: '시작일 0시 기준 통장 잔액 · 받을 돈 · 갚을 돈 · 자본금 · 이월이익잉여금 등을 넣고 차변 = 대변이면 「확정」합니다. 확정 뒤로는 고칠 수 없습니다.' };
}

export async function openingCreate(db: DatabaseService, asOf: string, note: string | undefined, actor: string | null) {
  dateOk(asOf);
  const [dup] = await db.query(`SELECT 1 FROM acct_opening_sets WHERE as_of = $1::date`, [asOf]);
  if (dup) throw new PolicyViolation('ACCT_OPENING_DUP', '그 기준일의 기초 잔액 판이 이미 있습니다.');
  const [r] = await db.query<{ id: string }>(`INSERT INTO acct_opening_sets (as_of, note, created_by) VALUES ($1::date, nullif($2, ''), $3) RETURNING id::text AS id`,
    [asOf, (note ?? '').trim().slice(0, 200), actor]);
  return { ok: true, id: r!.id, note: '기초 잔액 판을 만들었습니다 — 줄을 넣고 확정하십시오.' };
}

/** 줄 바꾸기(DRAFT 만 · 통째로) */
export async function openingSetLines(db: DatabaseService, id: string, lines: Array<{ role: string; debit?: number; credit?: number; memo?: string }>) {
  const [s] = await db.query<{ state: string }>(`SELECT state FROM acct_opening_sets WHERE id = $1::bigint`, [id]);
  if (!s) throw new NotFound('없는 기초 잔액 판입니다.');
  if (s.state === 'FIXED') throw new PolicyViolation('ACCT_OPENING_FIXED', '확정한 기초 잔액은 고칠 수 없습니다.');
  if (!Array.isArray(lines) || lines.length > 200) throw new PolicyViolation('ACCT_OPENING', '줄은 200개까지입니다.');
  const clean = lines.map((l) => ({ role: String(l.role ?? ''), debit: Math.round(Number(l.debit ?? 0)), credit: Math.round(Number(l.credit ?? 0)), memo: (l.memo ?? '').toString().trim().slice(0, 120) }));
  for (const l of clean) {
    if (!Number.isFinite(l.debit) || !Number.isFinite(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0))
      throw new PolicyViolation('ACCT_OPENING', '줄마다 차변 또는 대변 하나만 0보다 큰 정수로 적습니다.');
  }
  const roles = await db.query<{ role: string }>(`SELECT role FROM acct_accounts WHERE role = ANY($1::text[])`, [clean.map((l) => l.role)]);
  const known = new Set(roles.map((r) => r.role));
  const bad = clean.find((l) => !known.has(l.role));
  if (bad) throw new PolicyViolation('ACCT_OPENING', `없는 계정입니다: ${bad.role}`);
  await db.transaction(async () => {
    await db.query(`DELETE FROM acct_opening WHERE set_id = $1::bigint`, [id]);
    if (clean.length) await db.query(
      `INSERT INTO acct_opening (set_id, role, debit, credit, memo)
       SELECT $1::bigint, x.role, x.debit, x.credit, nullif(x.memo, '') FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint, memo text)`,
      [id, JSON.stringify(clean)]);
  });
  const d = clean.reduce((a, l) => a + l.debit, 0), c = clean.reduce((a, l) => a + l.credit, 0);
  return { ok: true, id, lines: clean.length, debit: d, credit: c, balanced: d === c && clean.length > 0,
           note: d === c ? `줄 ${clean.length}개를 저장했습니다(차변 = 대변 ${d}).` : `줄 ${clean.length}개를 저장했습니다 — 차변 ${d} · 대변 ${c} 이 달라 아직 확정할 수 없습니다.` };
}

export async function openingFix(db: DatabaseService, id: string, actor: string | null) {
  const [s] = await db.query<{ state: string }>(`SELECT state FROM acct_opening_sets WHERE id = $1::bigint`, [id]);
  if (!s) throw new NotFound('없는 기초 잔액 판입니다.');
  if (s.state === 'FIXED') throw new PolicyViolation('ACCT_OPENING_FIXED', '확정한 기초 잔액은 고칠 수 없습니다.');
  await db.query(`UPDATE acct_opening_sets SET state = 'FIXED', fixed_by = $2, fixed_at = now() WHERE id = $1::bigint`, [id, actor]);   // 차변 = 대변은 DB 가 확인
  return { ok: true, id, note: '기초 잔액을 확정했습니다 — 재무상태표가 이 잔액부터 셉니다.' };
}

/** 달 범위(YYYY-MM → 첫날 · 끝날) */
export const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
export const yearStart = (d: string) => `${d.slice(0, 4)}-01-01`;
export { addDay };

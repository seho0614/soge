import { DatabaseService } from '../../db/database.service';
import { estimateMonthlyWht } from './whtformula';   // v10.418 표 없을 때 산식 근사
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import type { Line, Source } from './journal';
import { parseCsv } from './bank';

/* ---------------------------------------------------------------------
 * v10.403 (D247 · docs/540) 급여 대장 · 4대보험
 *   직원(이름 · 입사 · 퇴사 · 월 기본급 · 비과세 · 부양가족 수 — 주민등록번호 · 계좌 없음 · SUPER)
 *   달 급여: 만들기(초안 · 그 달 재직자 줄) → 줄 고침(지급액 · 비과세 → 다시 셈) → 확정(SUPER · 전표 PAYROLL) → 지급(PAYOUT · SUPER · 전표 PAYROLL_PAID)
 *   셈 — 과세 급여 = 지급액 − 비과세
 *     국민연금 = 과세 급여를 기준소득 하한 ~ 상한으로 자른 값 × 요율 · 건강 = 과세 급여 × 요율 · 장기요양 = 건강보험료 × 요율 · 고용 = 과세 급여 × 요율(회사 몫 따로)
 *     4대보험은 10원 미만 버림 · 소득세 = 간이세액표(과세 급여 구간 × 부양가족 수 · 없으면 0 + 「간이세액표 없음」) · 지방소득세 = 소득세 × 10%(10원 미만 버림)
 *   요율 · 간이세액표는 표(acct_payroll_rates · acct_wht_table)에서 · 해마다 SUPER · 처음 값은 초안(노무사 · 세무사 확인).
 *   ※ 1,000만 원 넘는 급여의 간이세액 식 · 두루누리 지원 · 상여 · 연말정산은 이번 판에 없음(세무사).
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const floor10 = (v: number) => Math.floor(v / 10) * 10;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
export const RATE_KEYS = ['np_rate', 'np_base_min', 'np_base_max', 'hi_rate', 'ltc_rate', 'ei_rate', 'ei_company_rate', 'ia_company_rate'] as const;   // v10.418 산재(회사만)
export type RateKey = typeof RATE_KEYS[number];
export const RATE_KO: Record<RateKey, string> = {
  np_rate: '국민연금(본인 · 회사 각 %)', np_base_min: '국민연금 기준소득 하한(원)', np_base_max: '국민연금 기준소득 상한(원)',
  hi_rate: '건강보험(본인 · 회사 각 %)', ltc_rate: '장기요양(건강보험료의 %)', ei_rate: '고용보험 본인(%)', ei_company_rate: '고용보험 회사(%)', ia_company_rate: '산재보험 회사(% · 업종 요율)',
};

const reasonOk = (r: string | undefined) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};

/* ── 직원 ── */
export async function listEmployees(db: DatabaseService) {
  const items = await db.query(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", monthly_base::bigint AS "monthlyBase", nontax::bigint AS nontax,
            dependents, memo, (left_on IS NULL OR left_on >= (now() AT TIME ZONE 'Asia/Seoul')::date) AS active
       FROM acct_employees ORDER BY (left_on IS NULL) DESC, joined_on, id`);
  return { items, note: '직원은 이름 · 입사일 · 월 기본급 · 비과세 · 부양가족 수(본인 포함)만 둡니다 — 주민등록번호 · 계좌는 받지 않습니다. 지우지 않고 퇴사일을 넣습니다.' };
}

export interface EmpIn { name?: string; joinedOn?: string; leftOn?: string | null; monthlyBase?: number; nontax?: number; dependents?: number; memo?: string }
function checkEmp(b: EmpIn, partial = false) {
  const d = /^\d{4}-\d{2}-\d{2}$/;
  if (!partial || b.name !== undefined) { const t = (b.name ?? '').trim(); if (t.length < 1 || t.length > 40) throw new PolicyViolation('ACCT_EMPLOYEE', '이름은 1 ~ 40자입니다.'); }
  if (!partial || b.joinedOn !== undefined) if (!d.test(b.joinedOn ?? '')) throw new PolicyViolation('ACCT_EMPLOYEE', '입사일이 바르지 않습니다.');
  if (b.leftOn && !d.test(b.leftOn)) throw new PolicyViolation('ACCT_EMPLOYEE', '퇴사일이 바르지 않습니다.');
  for (const [k, v, max] of [['monthlyBase', b.monthlyBase, 100000000], ['nontax', b.nontax, 10000000]] as const)
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > max)) throw new PolicyViolation('ACCT_EMPLOYEE', `금액이 바르지 않습니다: ${k}`);
  if (b.dependents !== undefined && (!Number.isInteger(b.dependents) || b.dependents < 1 || b.dependents > 11)) throw new PolicyViolation('ACCT_EMPLOYEE', '부양가족 수는 본인 포함 1 ~ 11명입니다.');
}

export async function addEmployee(db: DatabaseService, b: EmpIn, actor: string | null) {
  checkEmp(b);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_employees (name, joined_on, left_on, monthly_base, nontax, dependents, memo, created_by)
     VALUES ($1, $2::date, $3::date, $4, $5, $6, nullif($7, ''), $8) RETURNING id::text AS id`,
    [b.name!.trim(), b.joinedOn, b.leftOn || null, b.monthlyBase ?? 0, b.nontax ?? 0, b.dependents ?? 1, (b.memo ?? '').trim().slice(0, 200), actor]);
  return { ok: true, id: r!.id, note: '직원을 넣었습니다 — 다음 달 급여 대장부터 들어갑니다.' };
}

export async function updateEmployee(db: DatabaseService, id: string, b: EmpIn) {
  checkEmp(b, true);
  const r = await db.query(
    `UPDATE acct_employees SET name = coalesce($2, name), joined_on = coalesce($3::date, joined_on),
            left_on = CASE WHEN $4::text = '' THEN NULL WHEN $4::text IS NULL THEN left_on ELSE $4::date END,
            monthly_base = coalesce($5, monthly_base), nontax = coalesce($6, nontax), dependents = coalesce($7, dependents), memo = coalesce($8, memo)
      WHERE id = $1::bigint RETURNING id`,
    [id, b.name?.trim() ?? null, b.joinedOn ?? null, b.leftOn === undefined ? null : (b.leftOn ?? ''), b.monthlyBase ?? null, b.nontax ?? null, b.dependents ?? null, b.memo ?? null]);
  if (!r.length) throw new NotFound('없는 직원입니다.');
  return { ok: true, id, note: '직원 정보를 고쳤습니다 — 이미 확정한 급여는 그대로입니다.' };
}

/* ── 요율 · 간이세액표 ── */
export async function ratesOf(db: DatabaseService, year: number) {
  const rows = await db.query<{ year: number; key: RateKey; value: string; draft: boolean }>(
    `SELECT DISTINCT ON (key) year, key, value::text, draft FROM acct_payroll_rates WHERE year <= $1 ORDER BY key, year DESC`, [year]);
  const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)])) as Partial<Record<RateKey, number>>;
  const [w] = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM acct_wht_table WHERE year = $1`, [year]);
  return { year, rates: map, rows: rows.map((r) => ({ ...r, value: Number(r.value), label: RATE_KO[r.key] })), fromYear: rows.length ? Math.max(...rows.map((r) => r.year)) : null,
           draft: rows.some((r) => r.draft), missing: RATE_KEYS.filter((k) => map[k] == null), whtRows: n(w?.c) };
}

export async function setRate(db: DatabaseService, year: number, key: string, value: number, reason: string | undefined, actor: string | null) {
  const t = reasonOk(reason);
  if (!(RATE_KEYS as readonly string[]).includes(key)) throw new PolicyViolation('ACCT_PAYROLL_RATE', '모르는 요율입니다.');
  if (!Number.isFinite(value) || value < 0 || (key.endsWith('_rate') && value > 50)) throw new PolicyViolation('ACCT_PAYROLL_RATE', '요율 값이 바르지 않습니다.');
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO acct_payroll_rates (year, key, value, draft, updated_by) VALUES ($1, $2, $3, false, $4)
       ON CONFLICT (year, key) DO UPDATE SET value = EXCLUDED.value, draft = false, updated_by = EXCLUDED.updated_by, updated_at = now()`, [year, key, value, actor]);
    await db.query(`INSERT INTO acct_payroll_rate_log (year, what, detail, reason, actor_id) VALUES ($1, 'RATE', $2::jsonb, $3, $4)`, [year, JSON.stringify({ key, value }), t, actor]);
  });
  return { ok: true, year, key, value, note: '요율을 고쳤습니다 — 새로 만드는 급여(초안 다시 셈 포함)부터 씁니다.' };
}

/** 국세청 간이세액표 CSV — 머리줄에 「이상」 · 「미만」 · 부양가족 수(1 ~ 11) 칸 · 급여 단위 천원(처음) 또는 원 · 처음은 그 해 전체를 바꿈 · 본문 한도(100kb) 때문에 크면 나눠 append */
export async function uploadWhtTable(db: DatabaseService, year: number, csv: string, unit: 'THOUSAND' | 'WON', reason: string | undefined, actor: string | null, append = false) {
  const t = reasonOk(reason);
  const rows = parseCsv(csv.replace(/^\uFEFF/, '')).map((r) => r.map((c) => String(c ?? '').replace(/,/g, '').trim()));   // 따옴표 안 쉼표(1,060) 풀고 지움
  const hi = rows.findIndex((r) => r.some((c) => c.includes('이상')) && r.some((c) => c.includes('미만')));
  if (hi < 0) throw new PolicyViolation('ACCT_WHT_TABLE', '머리줄(이상 · 미만 · 부양가족 수 칸)을 찾지 못했습니다.');
  const head = rows[hi]!;
  const iFrom = head.findIndex((c) => c.includes('이상')), iTo = head.findIndex((c) => c.includes('미만'));
  const fam = head.map((c, i) => ({ i, d: Number((/^(\d{1,2})/.exec(c) ?? [])[1]) })).filter((x) => x.i !== iFrom && x.i !== iTo && x.d >= 1 && x.d <= 11);
  if (!fam.length) throw new PolicyViolation('ACCT_WHT_TABLE', '부양가족 수 칸(1 ~ 11)을 찾지 못했습니다.');
  const mul = unit === 'WON' ? 1 : 1000;
  const out: Array<[number, number, number, number]> = [];
  for (const r of rows.slice(hi + 1)) {
    const f = Number(r[iFrom]), to = Number(r[iTo]);
    if (!Number.isFinite(f) || !Number.isFinite(to) || to <= f) continue;
    for (const x of fam) { const tax = Number((r[x.i] ?? '').replace(/[^0-9]/g, '') || 0); out.push([f * mul, to * mul, x.d, tax]); }
  }
  if (out.length < 1) throw new PolicyViolation('ACCT_WHT_TABLE', '세액 줄이 없습니다.');
  if (out.length > 50000) throw new PolicyViolation('ACCT_WHT_TABLE', '줄이 너무 많습니다(5만 줄까지).');
  await db.transaction(async () => {
    if (!append) await db.query(`DELETE FROM acct_wht_table WHERE year = $1`, [year]);
    for (let i = 0; i < out.length; i += 1000) {
      const part = out.slice(i, i + 1000);
      await db.query(
        `INSERT INTO acct_wht_table (year, wage_from, wage_to, dependents, tax)
         SELECT $1, x.f, x.t, x.d, x.tax FROM jsonb_to_recordset($2::jsonb) AS x(f bigint, t bigint, d int, tax bigint) ON CONFLICT DO NOTHING`,
        [year, JSON.stringify(part.map(([f, to, d, tax]) => ({ f, t: to, d, tax })))]);
    }
    await db.query(`INSERT INTO acct_payroll_rate_log (year, what, detail, reason, actor_id) VALUES ($1, 'WHT_TABLE', $2::jsonb, $3, $4)`, [year, JSON.stringify({ rows: out.length, unit, append }), t, actor]);
  });
  const [c] = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM acct_wht_table WHERE year = $1`, [year]);
  return { ok: true, year, rows: out.length, total: n(c?.c), note: `${year}년 간이세액표 ${out.length.toLocaleString('ko-KR')}줄을 넣었습니다(모두 ${n(c?.c).toLocaleString('ko-KR')}줄) — 새로 셈하는 급여부터 씁니다.` };
}

/* ── 셈 ── */
export interface Calc { gross: number; nontax: number; income_tax: number; local_tax: number; np: number; hi: number; ltc: number; ei: number; net: number;
  company_np: number; company_hi: number; company_ltc: number; company_ei: number; company_ia: number; wht_missing: boolean }

export async function calcLine(db: DatabaseService, year: number, gross: number, nontax: number, dependents: number, rates?: Partial<Record<RateKey, number>>): Promise<Calc> {
  const r = rates ?? (await ratesOf(db, year)).rates;
  const nt = Math.min(nontax, gross), taxable = gross - nt;
  const base = Math.min(Math.max(taxable, r.np_base_min ?? 0), r.np_base_max ?? Number.MAX_SAFE_INTEGER);
  const np = taxable > 0 ? floor10(base * (r.np_rate ?? 0) / 100) : 0;
  const hi = floor10(taxable * (r.hi_rate ?? 0) / 100), ltc = floor10(hi * (r.ltc_rate ?? 0) / 100);
  const ei = floor10(taxable * (r.ei_rate ?? 0) / 100), cei = floor10(taxable * (r.ei_company_rate ?? 0) / 100);
  const cia = floor10(taxable * (r.ia_company_rate ?? 0) / 100);   // v10.423 (D252) 산재 — 회사만 · 실지급에 영향 없음
  const [w] = taxable > 0 ? await db.query<{ tax: string }>(
    `SELECT tax::text FROM acct_wht_table WHERE year = $1 AND $2 >= wage_from AND $2 < wage_to AND dependents <= $3 ORDER BY dependents DESC LIMIT 1`, [year, taxable, dependents]) : [];
  /* v10.418 — 국세청 표가 없으면 산식 근사(whtformula · 일반 원칙) · wht_missing = 표 없이 산식으로 셈 */
  const it = w ? n(w.tax) : estimateMonthlyWht(taxable, dependents, np), lt = floor10(it * 0.1);
  return { gross, nontax: nt, income_tax: it, local_tax: lt, np, hi, ltc, ei, net: gross - it - lt - np - hi - ltc - ei,
           company_np: np, company_hi: hi, company_ltc: ltc, company_ei: cei, company_ia: cia, wht_missing: taxable > 0 && !w };
}

/* ── 달 급여 ── */
export async function payrollMonth(db: DatabaseService, ym: string) {
  if (!YM.test(ym)) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const [run] = await db.query<{ id: string; state: string; payDay: string; fixedAt: string | null; paidAt: string | null }>(
    `SELECT id::text AS id, state, pay_day::text AS "payDay", fixed_at AS "fixedAt", paid_at AS "paidAt" FROM acct_payroll_runs WHERE ym = $1`, [ym]);
  const lines = run ? await db.query(
    `SELECT l.id::text AS id, l.employee_id::text AS "employeeId", e.name, e.dependents, l.gross, l.nontax, l.income_tax AS "incomeTax", l.local_tax AS "localTax",
            l.np, l.hi, l.ltc, l.ei, l.net, l.company_np AS "companyNp", l.company_hi AS "companyHi", l.company_ltc AS "companyLtc", l.company_ei AS "companyEi",
            l.company_ia AS "companyIa", l.wht_missing AS "whtMissing"
       FROM acct_payroll_lines l JOIN acct_employees e ON e.id = l.employee_id WHERE l.run_id = $1::bigint ORDER BY e.joined_on, e.id`, [run.id]) : [];
  const sum = (k: string) => (lines as Array<Record<string, unknown>>).reduce((a, x) => a + n(x[k]), 0);
  const total = { gross: sum('gross'), incomeTax: sum('incomeTax'), localTax: sum('localTax'), employeeIns: sum('np') + sum('hi') + sum('ltc') + sum('ei'),
                  companyIns: sum('companyNp') + sum('companyHi') + sum('companyLtc') + sum('companyEi') + sum('companyIa'), companyIa: sum('companyIa'), net: sum('net'), people: lines.length };
  const r = await ratesOf(db, Number(ym.slice(0, 4)));
  return { ym, run: run ?? null, lines, total, rates: r,
    note: '요율 · 간이세액표는 초안일 수 있습니다(표에 「초안」) — 노무사 · 세무사 확인. 확정하면 전표가 생기고 줄을 고칠 수 없습니다.' };
}

export async function createRun(db: DatabaseService, ym: string, payDay: string | undefined, actor: string | null) {
  if (!YM.test(ym)) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.pay_day'`);
  const day = payDay && /^\d{4}-\d{2}-\d{2}$/.test(payDay) ? payDay : `${ym}-${String(Math.min(28, Math.max(1, Number(st?.v ?? 25) || 25))).padStart(2, '0')}`;
  if (day.slice(0, 7) !== ym) throw new PolicyViolation('ACCT_PAYROLL', '지급일은 그 달 안이어야 합니다.');
  const year = Number(ym.slice(0, 4));
  const rates = (await ratesOf(db, year)).rates;
  return db.transaction(async () => {
    const [dup] = await db.query(`SELECT 1 FROM acct_payroll_runs WHERE ym = $1`, [ym]);
    if (dup) throw new StateConflict('ACCT_PAYROLL_EXISTS', '그 달 급여 대장이 이미 있습니다.');
    const [run] = await db.query<{ id: string }>(`INSERT INTO acct_payroll_runs (ym, pay_day, created_by) VALUES ($1, $2::date, $3) RETURNING id::text AS id`, [ym, day, actor]);
    const emps = await db.query<{ id: string; base: string; nontax: string; dependents: number }>(
      `SELECT id::text AS id, monthly_base::text AS base, nontax::text AS nontax, dependents FROM acct_employees
        WHERE joined_on <= ($1 || '-01')::date + interval '1 month' - interval '1 day' AND (left_on IS NULL OR left_on >= ($1 || '-01')::date) ORDER BY joined_on, id`, [ym]);
    for (const e of emps) {
      const c = await calcLine(db, year, n(e.base), n(e.nontax), e.dependents, rates);
      await insLine(db, run!.id, e.id, c);
    }
    return { ok: true, id: run!.id, people: emps.length, note: `${ym} 급여 대장(초안)을 만들었습니다 — ${emps.length}명. 지급액을 고친 뒤 확정하십시오.` };
  });
}

async function insLine(db: DatabaseService, runId: string, empId: string, c: Calc) {
  await db.query(
    `INSERT INTO acct_payroll_lines (run_id, employee_id, gross, nontax, income_tax, local_tax, np, hi, ltc, ei, net, company_np, company_hi, company_ltc, company_ei, wht_missing, company_ia)
     VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [runId, empId, c.gross, c.nontax, c.income_tax, c.local_tax, c.np, c.hi, c.ltc, c.ei, c.net, c.company_np, c.company_hi, c.company_ltc, c.company_ei, c.wht_missing, c.company_ia]);
}

/** 초안 줄 고침 — 지급액 · 비과세 → 다시 셈 */
export async function updateLine(db: DatabaseService, lineId: string, b: { gross?: number; nontax?: number }) {
  for (const v of [b.gross, b.nontax]) if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 100000000)) throw new PolicyViolation('ACCT_PAYROLL', '금액이 바르지 않습니다.');
  const [l] = await db.query<{ gross: string; nontax: string; dependents: number; ym: string; state: string }>(
    `SELECT l.gross::text, l.nontax::text, e.dependents, r.ym, r.state FROM acct_payroll_lines l JOIN acct_payroll_runs r ON r.id = l.run_id JOIN acct_employees e ON e.id = l.employee_id WHERE l.id = $1::bigint`, [lineId]);
  if (!l) throw new NotFound('없는 급여 줄입니다.');
  if (l.state !== 'DRAFT') throw new StateConflict('ACCT_PAYROLL_FIXED', '확정한 급여는 고치지 않습니다.');
  const c = await calcLine(db, Number(l.ym.slice(0, 4)), b.gross ?? n(l.gross), b.nontax ?? n(l.nontax), l.dependents);
  await db.query(
    `UPDATE acct_payroll_lines SET gross = $2, nontax = $3, income_tax = $4, local_tax = $5, np = $6, hi = $7, ltc = $8, ei = $9, net = $10,
            company_np = $11, company_hi = $12, company_ltc = $13, company_ei = $14, wht_missing = $15, company_ia = $16 WHERE id = $1::bigint`,
    [lineId, c.gross, c.nontax, c.income_tax, c.local_tax, c.np, c.hi, c.ltc, c.ei, c.net, c.company_np, c.company_hi, c.company_ltc, c.company_ei, c.wht_missing, c.company_ia]);
  return { ok: true, id: lineId, line: c, note: '다시 셈했습니다.' };
}

export async function fixRun(db: DatabaseService, id: string, actor: string | null) {
  const [r] = await db.query<{ state: string; n: number }>(
    `SELECT r.state, (SELECT count(*)::int FROM acct_payroll_lines l WHERE l.run_id = r.id) AS n FROM acct_payroll_runs r WHERE r.id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 급여 대장입니다.');
  if (r.state !== 'DRAFT') throw new StateConflict('ACCT_PAYROLL_FIXED', '이미 확정한 급여입니다.');
  if (!r.n) throw new PolicyViolation('ACCT_PAYROLL', '급여 줄이 없습니다.');
  await db.query(`UPDATE acct_payroll_runs SET state = 'FIXED', fixed_by = $2, fixed_at = now() WHERE id = $1::bigint`, [id, actor]);
  return { ok: true, id, note: '급여를 확정했습니다 — 다음 자동 전표(매시간 · 「지금 전표 만들기」)에서 급여 전표가 생깁니다.' };
}

export async function paidRun(db: DatabaseService, id: string, actor: string | null) {
  const [r] = await db.query<{ state: string }>(`SELECT state FROM acct_payroll_runs WHERE id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 급여 대장입니다.');
  if (r.state !== 'FIXED') throw new StateConflict('ACCT_PAYROLL_STATE', '확정한 급여만 지급 처리합니다.');
  await db.query(`UPDATE acct_payroll_runs SET state = 'PAID', paid_by = $2, paid_at = now() WHERE id = $1::bigint`, [id, actor]);
  return { ok: true, id, note: '지급했습니다 — 통장 출금은 은행 맞추기에서 이 전표와 맞추십시오.' };
}

/* ── 전표 ── */
const dr = (role: string, v: number): Line => ({ role, debit: v, credit: 0 }) as Line;
const cr = (role: string, v: number): Line => ({ role, debit: 0, credit: v }) as Line;

export const PAYROLL_SOURCES: Source[] = [
  {
    name: 'PAYROLL', label: '급여 확정',
    sql: `SELECT r.id::text AS key, (r.pay_day::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Seoul' AS at, NULL::text AS party, r.ym,
                 sum(l.gross)::bigint AS gross, sum(l.income_tax + l.local_tax)::bigint AS wht,
                 sum(l.np + l.hi + l.ltc + l.ei)::bigint AS emp_ins, sum(l.company_np + l.company_hi + l.company_ltc + l.company_ei + l.company_ia)::bigint AS com_ins, sum(l.net)::bigint AS net
            FROM acct_payroll_runs r JOIN acct_payroll_lines l ON l.run_id = r.id
           WHERE r.state IN ('FIXED', 'PAID') AND (r.pay_day::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PAYROLL' AND e.source_key = r.id::text)
           GROUP BY r.id ORDER BY r.ym LIMIT 500`,
    build: (r) => {
      const gross = n(r.gross), wht = n(r.wht), emp = n(r.emp_ins), com = n(r.com_ins), net = n(r.net);
      return { memo: `${r.ym} 급여`, evidence: 'NONE', lines: [dr('EXP_SALARY', gross), ...(com > 0 ? [dr('EXP_INSURANCE', com)] : []),
        ...(wht > 0 ? [cr('WHT', wht)] : []), ...(emp + com > 0 ? [cr('INS_PAYABLE', emp + com)] : []), ...(net > 0 ? [cr('AP', net)] : [])] };
    },
  },
  {
    name: 'PAYROLL_PAID', label: '급여 지급',
    sql: `SELECT r.id::text AS key, r.paid_at AS at, NULL::text AS party, r.ym, (SELECT sum(l.net) FROM acct_payroll_lines l WHERE l.run_id = r.id)::bigint AS net
            FROM acct_payroll_runs r
           WHERE r.state = 'PAID' AND r.paid_at IS NOT NULL AND r.paid_at >= fn_acct_from()
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PAYROLL' AND e.source_key = r.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PAYROLL_PAID' AND e.source_key = r.id::text)
           ORDER BY r.paid_at LIMIT 500`,
    build: (r) => (n(r.net) > 0 ? { memo: `${r.ym} 급여 지급`, evidence: 'NONE', lines: [dr('AP', n(r.net)), cr('CASH', n(r.net))] } : null),
  },
];

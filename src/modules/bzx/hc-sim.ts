import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { ratesOf } from '../acct/payroll';
import type { RateKey } from '../acct/payroll';
import { clean, ID_RE, kstYm, YM_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.614 (docs/756) ㉚ 인건비 시뮬레이션 — 채용 계획 → 달마다 급여 · 회사 4대보험 · 퇴직금 적립
 *   요율은 급여 대장 요율표 그대로(acct_payroll_rates · ratesOf · 해마다 · 일반 원칙 값 docs/555 · SUPER 가 회계 › 급여 › 요율에서 고침)
 *   회사 몫 셈은 급여 셈(payroll.ts calcLine)과 같은 식:
 *     과세 = 지급액 − 비과세 · 연금 = 과세를 기준소득 하한 ~ 상한으로 자른 값 × np_rate · 건강 = 과세 × hi_rate · 장기요양 = 건강 × ltc_rate
 *     고용(회사) = 과세 × ei_company_rate · 산재 = 과세 × ia_company_rate · 모두 10원 미만 버림
 *     (간이세액표를 사람 · 달마다 묻지 않으려고 식만 옮김 — 소득세는 회사 비용이 아니라 뺌)
 *   퇴직금 적립(일반 원칙 · 퇴직급여보장법) = 그 달 지급액 ÷ 12(1년 30일분 평균임금을 달로 나눈 근사) · 1년을 못 채우고 나가면 실제 지급은 없음(표에 따로)
 *   해마다 인상률(raise_pct)은 시작 달부터 12개월마다 한 번 · 지금 직원(acct_employees 재직자 · 월 기본급 · 비과세)을 함께 넣을지 고름
 *   결과는 합계만(사람 이름 · 개인 급여 없음) · 계획은 bzx_hc_plans(SUPER · 지급 담당) · 실제 급여 · 장부에는 아무것도 쓰지 않음
 * ------------------------------------------------------------------- */

const floor10 = (v: number) => Math.floor(v / 10) * 10;
const ymAdd = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

export interface HcLine { role: string; count: number; monthlyBase: number; nontax?: number; startYm: string; endYm?: string | null }
export interface HcPlanInput { title: string; startYm: string; months: number; raisePct?: number; includeCurrent?: boolean; lines: HcLine[] }

export function companyCost(gross: number, nontax: number, r: Partial<Record<RateKey, number>>) {
  const taxable = Math.max(0, gross - Math.min(nontax, gross));
  const base = Math.min(Math.max(taxable, r.np_base_min ?? 0), r.np_base_max ?? Number.MAX_SAFE_INTEGER);
  const np = taxable > 0 ? floor10(base * (r.np_rate ?? 0) / 100) : 0;
  const hi = floor10(taxable * (r.hi_rate ?? 0) / 100), ltc = floor10(hi * (r.ltc_rate ?? 0) / 100);
  const ei = floor10(taxable * (r.ei_company_rate ?? 0) / 100), ia = floor10(taxable * (r.ia_company_rate ?? 0) / 100);
  return { np, hi, ltc, ei, ia, ins: np + hi + ltc + ei + ia };
}

function checkPlan(b: HcPlanInput) {
  const title = clean(b.title, 80);
  if (title.length < 2) throw new PolicyViolation('BZX_HC_INPUT', '계획 이름은 2 ~ 80자입니다.');
  if (!YM_RE.test(b.startYm ?? '')) throw new PolicyViolation('BZX_HC_INPUT', '시작 달은 YYYY-MM 입니다.');
  const months = Number(b.months);
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new PolicyViolation('BZX_HC_INPUT', '기간은 1 ~ 36개월입니다.');
  const raise = b.raisePct == null ? 0 : Number(b.raisePct);
  if (!Number.isFinite(raise) || raise < 0 || raise > 30) throw new PolicyViolation('BZX_HC_INPUT', '해마다 인상률은 0 ~ 30% 입니다.');
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length > 30) throw new PolicyViolation('BZX_HC_INPUT', '채용 줄은 30개까지입니다.');
  const out: HcLine[] = lines.map((l) => {
    const role = clean(l.role, 40), count = Number(l.count), base = Number(l.monthlyBase), nt = Number(l.nontax ?? 0);
    if (role.length < 1) throw new PolicyViolation('BZX_HC_INPUT', '자리 이름을 적으십시오.');
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new PolicyViolation('BZX_HC_INPUT', '인원은 1 ~ 50명입니다.');
    if (!Number.isInteger(base) || base < 0 || base > 100_000_000) throw new PolicyViolation('BZX_HC_INPUT', '월 기본급은 0 ~ 1억 원입니다.');
    if (!Number.isInteger(nt) || nt < 0 || nt > base) throw new PolicyViolation('BZX_HC_INPUT', '비과세는 0 원 ~ 월 기본급입니다.');
    if (!YM_RE.test(l.startYm ?? '') || (l.endYm && (!YM_RE.test(l.endYm) || l.endYm < l.startYm))) throw new PolicyViolation('BZX_HC_INPUT', '입사 · 퇴사 달(YYYY-MM)이 맞지 않습니다.');
    return { role, count, monthlyBase: base, nontax: nt, startYm: l.startYm, endYm: l.endYm || null };
  });
  if (!out.length && b.includeCurrent === false) throw new PolicyViolation('BZX_HC_INPUT', '채용 줄을 넣거나 지금 직원을 함께 셈하십시오.');
  return { title, startYm: b.startYm, months, raisePct: Math.round(raise * 100) / 100, includeCurrent: b.includeCurrent !== false, lines: out };
}

/** 셈(저장 안 함) — POST /admin/bzx/hc-sim · 저장한 계획 보기도 이것 */
export async function hcSimulate(db: DatabaseService, input: HcPlanInput) {
  const p = checkPlan(input);
  const lastYm = ymAdd(p.startYm, p.months - 1);
  const emps = p.includeCurrent ? await db.query<{ joined: string; left: string | null; base: string; nontax: string }>(
    `SELECT joined_on::text AS joined, left_on::text AS left, coalesce(monthly_base, 0)::text AS base, coalesce(nontax, 0)::text AS nontax
       FROM acct_employees WHERE joined_on <= $1::date AND (left_on IS NULL OR left_on >= $2::date)`, [monthEnd(lastYm), `${p.startYm}-01`]) : [];
  const rateCache = new Map<number, Awaited<ReturnType<typeof ratesOf>>>();
  const months: Array<{ ym: string; people: number; hires: number; gross: number; companyIns: number; severance: number; total: number; current: number }> = [];
  const perLine = p.lines.map((l) => ({ role: l.role, count: l.count, gross: 0, companyIns: 0, severance: 0, total: 0, shortStay: false }));
  let draft = false;
  const missing = new Set<string>();
  for (let i = 0; i < p.months; i++) {
    const ym = ymAdd(p.startYm, i), y = Number(ym.slice(0, 4));
    if (!rateCache.has(y)) rateCache.set(y, await ratesOf(db, y));
    const R = rateCache.get(y)!;
    if (R.draft) draft = true;
    R.missing.forEach((k) => missing.add(k));
    const up = Math.pow(1 + p.raisePct / 100, Math.floor(i / 12));
    let people = 0, hires = 0, gross = 0, ins = 0, sev = 0, cur = 0;
    for (const e of emps) {
      if (e.joined > monthEnd(ym) || (e.left && e.left < `${ym}-01`)) continue;
      const g = Math.round(Number(e.base) * up), c = companyCost(g, Number(e.nontax), R.rates);
      people++; gross += g; ins += c.ins; sev += Math.round(g / 12); cur += g + c.ins + Math.round(g / 12);
    }
    p.lines.forEach((l, k) => {
      if (ym < l.startYm || (l.endYm && ym > l.endYm)) return;
      const g = Math.round(l.monthlyBase * up), c = companyCost(g, l.nontax ?? 0, R.rates), s = Math.round(g / 12);
      people += l.count; hires += l.count; gross += g * l.count; ins += c.ins * l.count; sev += s * l.count;
      const pl = perLine[k]!; pl.gross += g * l.count; pl.companyIns += c.ins * l.count; pl.severance += s * l.count; pl.total += (g + c.ins + s) * l.count;
    });
    months.push({ ym, people, hires, gross, companyIns: ins, severance: sev, total: gross + ins + sev, current: cur });
  }
  p.lines.forEach((l, k) => {
    const end = l.endYm && l.endYm < lastYm ? l.endYm : null;
    if (end) { const span = (Number(end.slice(0, 4)) - Number(l.startYm.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(l.startYm.slice(5, 7)) + 1; perLine[k]!.shortStay = span < 12; }
  });
  const sum = (k: 'gross' | 'companyIns' | 'severance' | 'total' | 'current') => months.reduce((a, m) => a + m[k], 0);
  return {
    plan: p, months, lines: perLine,
    total: { gross: sum('gross'), companyIns: sum('companyIns'), severance: sum('severance'), total: sum('total'), current: sum('current'), added: sum('total') - sum('current') },
    draft, missingRates: [...missing],
    note: '회사 4대보험은 급여 대장 요율표(해마다)로 셈합니다 — 요율이 「초안」이면 노무사 확인 전입니다. 퇴직금 적립은 지급액의 1/12(1년 이상 일할 때 받는 몫의 달 근사)이고, 1년이 안 돼 나가는 자리는 실제 지급이 없습니다(줄에 「1년 미만」). 상여 · 수당 · 연차수당은 넣지 않았습니다.',
  };
}

/* ── 계획 저장 ── */
export async function hcPlans(db: DatabaseService) {
  const items = await db.query(
    `SELECT p.id::text AS id, p.title, p.start_ym AS "startYm", p.months, p.raise_pct::float AS "raisePct", p.include_current AS "includeCurrent",
            jsonb_array_length(p.lines) AS "lineCount", p.state, a.name AS "updatedBy", p.updated_at AS "updatedAt"
       FROM bzx_hc_plans p LEFT JOIN accounts a ON a.id = p.updated_by WHERE p.state = 'ACTIVE' ORDER BY p.updated_at DESC LIMIT 100`);
  return { items, thisYm: kstYm() };
}

async function plan(db: DatabaseService, id: string) {
  if (!ID_RE.test(String(id ?? ''))) throw new NotFound('없는 계획입니다.');
  const [r] = await db.query<{ id: string; title: string; start_ym: string; months: number; raise_pct: string; include_current: boolean; lines: HcLine[]; state: string }>(
    `SELECT id::text AS id, title, start_ym, months, raise_pct::text AS raise_pct, include_current, lines, state FROM bzx_hc_plans WHERE id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 계획입니다.');
  return r;
}

export async function hcPlanOne(db: DatabaseService, id: string) {
  const r = await plan(db, id);
  const sim = await hcSimulate(db, { title: r.title, startYm: r.start_ym, months: r.months, raisePct: Number(r.raise_pct), includeCurrent: r.include_current, lines: r.lines });
  return { id: r.id, state: r.state, ...sim };
}

export async function hcPlanSave(db: DatabaseService, id: string | null, input: HcPlanInput, actor: string | null) {
  const p = checkPlan(input);
  if (id) {
    const cur = await plan(db, id);
    if (cur.state !== 'ACTIVE') throw new StateConflict('BZX_HC_STATE', '보관한 계획은 고치지 않습니다.');
    await db.query(
      `UPDATE bzx_hc_plans SET title = $2, start_ym = $3, months = $4::int, raise_pct = $5::numeric, include_current = $6::boolean, lines = $7::jsonb, updated_by = $8::uuid, updated_at = now()
        WHERE id = $1::bigint`, [id, p.title, p.startYm, p.months, p.raisePct, p.includeCurrent, JSON.stringify(p.lines), actor]);
    return { ok: true, id, note: '계획을 고쳤습니다.' };
  }
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO bzx_hc_plans (title, start_ym, months, raise_pct, include_current, lines, created_by, updated_by)
     VALUES ($1, $2, $3::int, $4::numeric, $5::boolean, $6::jsonb, $7::uuid, $7::uuid) RETURNING id::text AS id`,
    [p.title, p.startYm, p.months, p.raisePct, p.includeCurrent, JSON.stringify(p.lines), actor]);
  return { ok: true, id: r!.id, note: '계획을 저장했습니다.' };
}

export async function hcPlanArchive(db: DatabaseService, id: string, actor: string | null) {
  const cur = await plan(db, id);
  if (cur.state !== 'ACTIVE') throw new StateConflict('BZX_HC_STATE', '이미 보관한 계획입니다.');
  await db.query(`UPDATE bzx_hc_plans SET state = 'ARCHIVED', updated_by = $2::uuid, updated_at = now() WHERE id = $1::bigint`, [id, actor]);
  return { ok: true, id, note: '계획을 보관했습니다(목록에서 빠짐).' };
}

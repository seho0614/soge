import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { wageStatements } from './filings';

/* ---------------------------------------------------------------------
 * ㉖ v10.448 (D259 · docs/585) 연말정산 자료 모음 — 대표 11/20 「다음개발」
 *   회사 쪽 장부 값: ⑲ 지급명세서(wageStatements · 해)의 직원별 총급여 · 비과세 · 과세 급여 · 기납부 소득세 · 지방소득세 · 4대보험 본인 몫
 *     + 달별 총급여 · 소득세(1 ~ 12월) + 부양가족 수(⑭ 직원 · 본인 포함).
 *   직원 제출 서류 받음 표시(acct_yearend_checks · 쌓기만 · 마지막 줄이 지금): 간소화 자료(PDF) · 소득 · 세액공제신고서 · 부양가족 확인 · 전 근무지 영수증.
 *   CSV 내려받기는 승인(ACCT_TAX) · 주민등록번호는 받지 않음(칸은 비움 — 홈택스 · 회계 프로그램에서 채움) · 결정세액 계산은 세무사 · 회계 프로그램.
 * ------------------------------------------------------------------- */

export const YE_ITEMS = ['SIMPLE_PDF', 'DEDUCTION_FORM', 'DEPENDENT', 'PREV_JOB', 'OTHER'] as const;
export const YE_ITEM_KO: Record<string, string> = {
  SIMPLE_PDF: '간소화 자료(PDF)', DEDUCTION_FORM: '소득 · 세액공제신고서', DEPENDENT: '부양가족 확인', PREV_JOB: '전 근무지 원천징수영수증', OTHER: '그 밖',
};
const REQUIRED = ['SIMPLE_PDF', 'DEDUCTION_FORM', 'DEPENDENT'];
const yearOk = (y: string) => { if (!/^\d{4}$/.test(String(y ?? '')) || Number(y) < 2000 || Number(y) > 2100) throw new PolicyViolation('ACCT_PERIOD', '해는 YYYY 입니다.'); return y; };

/** GET /admin/acct/yearend?year= */
export async function yearendView(db: DatabaseService, yearIn: string) {
  const year = yearOk(yearIn);
  const w = await wageStatements(db, year);
  const months = await db.query<{ emp: string; m: number; gross: number; it: number }>(
    `SELECT l.employee_id::text AS emp, extract(month FROM pr.pay_day)::int AS m, sum(l.gross)::float8 AS gross, sum(l.income_tax)::float8 AS it
       FROM acct_payroll_runs pr JOIN acct_payroll_lines l ON l.run_id = pr.id
      WHERE pr.state IN ('FIXED', 'PAID') AND to_char(pr.pay_day, 'YYYY') = $1 GROUP BY 1, 2`, [year]);
  const deps = await db.query<{ id: string; dependents: number }>(`SELECT id::text AS id, dependents FROM acct_employees`);
  const checks = await db.query<{ emp: string; item: string; done: boolean; note: string | null; at: string; by: string | null }>(
    `SELECT DISTINCT ON (c.employee_id, c.item) c.employee_id::text AS emp, c.item, c.done, c.note, c.created_at AS at, a.email AS by
       FROM acct_yearend_checks c LEFT JOIN accounts a ON a.id = c.created_by
      WHERE c.year = $1::int ORDER BY c.employee_id, c.item, c.id DESC`, [year]);
  const dm = new Map(deps.map((d) => [d.id, d.dependents]));
  const items = w.items.map((x) => {
    const ms = Array.from({ length: 12 }, (_, i) => months.find((m) => m.emp === x.employeeId && m.m === i + 1) ?? null)
      .map((m, i) => ({ month: i + 1, gross: m?.gross ?? 0, incomeTax: m?.it ?? 0 }));
    const cs = checks.filter((c) => c.emp === x.employeeId);
    const done = Object.fromEntries(YE_ITEMS.map((k) => [k, cs.find((c) => c.item === k) ?? null]));
    const missing = REQUIRED.filter((k) => !(done[k] as { done?: boolean } | null)?.done);
    return { ...x, dependents: dm.get(x.employeeId) ?? 1, months: ms, checks: done, missing: missing.map((k) => YE_ITEM_KO[k]) };
  });
  return { year, items, total: w.total, itemsKo: YE_ITEM_KO, ready: items.filter((x) => x.missing.length === 0).length,
           note: '회사 장부 값(확정 · 지급한 급여)과 직원 서류 받음 표시입니다. 주민등록번호 · 공제 금액 · 결정세액은 홈택스 간소화 자료로 회계 프로그램(세무사)에서 계산합니다.' };
}

/** POST /admin/acct/yearend/checks — 서류 받음 표시(쌓기만 · 마지막 줄이 지금) */
export async function setYearendCheck(db: DatabaseService, b: { employeeId: string; year: number; item: string; done: boolean; note?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(b.employeeId ?? ''))) throw new NotFound('직원이 없습니다.');
  const [e] = await db.query<{ name: string }>(`SELECT name FROM acct_employees WHERE id = $1::bigint`, [b.employeeId]);
  if (!e) throw new NotFound('직원이 없습니다.');
  yearOk(String(b.year));
  if (!(YE_ITEMS as readonly string[]).includes(b.item)) throw new PolicyViolation('YEAREND_ITEM', '서류 종류가 바르지 않습니다.');
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if (b.item === 'OTHER' && !note) throw new PolicyViolation('YEAREND_ITEM', '「그 밖」은 무엇인지 적습니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_yearend_checks (employee_id, year, item, done, note, created_by) VALUES ($1::bigint, $2::int, $3, $4::boolean, $5, $6::uuid) RETURNING id::text AS id`,
    [b.employeeId, b.year, b.item, !!b.done, note, actor]);
  const label = YE_ITEM_KO[b.item] ?? b.item;
  return { ok: true, id: r!.id, note: b.done ? `${e.name} 님 ${label} — 받음으로 적었습니다.` : `${e.name} 님 ${label} — 받지 않음으로 적었습니다.` };
}

export function yearendCsv(v: Awaited<ReturnType<typeof yearendView>>) {
  const head = ['해', '직원', '주민등록번호(신고 때 채움)', '입사일', '퇴사일', '부양가족(본인 포함)', '달 수', '총급여', '비과세', '과세 급여', '기납부 소득세', '기납부 지방소득세',
    '국민연금', '건강보험', '장기요양', '고용보험', ...Array.from({ length: 12 }, (_, i) => `${i + 1}월 총급여`), '안 받은 서류'];
  const body = v.items.map((x) => [v.year, x.name, '', x.joinedOn, x.leftOn ?? '', x.dependents, x.months.filter((m) => m.gross > 0).length, x.gross, x.nontax, x.taxable,
    x.incomeTax, x.localTax, x.np, x.hi, x.ltc, x.ei, ...x.months.map((m) => m.gross), x.missing.join(' · ')]);
  return { head, body };
}

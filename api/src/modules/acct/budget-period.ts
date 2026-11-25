/* e3 (docs/010) 소개뱅크 src/modules/acct/budget-period.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { setBudget } from './budget';

/* ---------------------------------------------------------------------
 * v10.427 (D253 · docs/564) 분기 · 연 예산
 *   ⑬ 달 예산(acct_budgets) 위에 — 분기(1 ~ 4) · 연 합계 · 누계(1월 ~ 이번 달) 실적 · 차이 · 쓴 비율.
 *   연 목표를 달로 나눠 넣기(SUPER · 사유) — EVEN 똑같이(남는 원은 12월) · LAST_YEAR 지난해 달 실적 비율대로(지난해 실적이 없으면 똑같이)
 *   · 시작 달부터(fromMonth · 지난달까지는 그대로 둠) · 실제 넣기는 ⑬ setBudget(바꾼 기록 · 알림 그대로).
 *   경영 보고서 한 줄 — budgetYearLine(올해 누계 비용 실적 / 누계 예산).
 * ------------------------------------------------------------------- */

const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const yearOk = (y?: number | string) => {
  const n = Number(y ?? kstYm().slice(0, 4));
  if (!Number.isInteger(n) || n < 2020 || n > 2100) throw new PolicyViolation('ACCT_YEAR', '해는 2020 ~ 2100 입니다.');
  return n;
};
const mm = (m: number) => String(m).padStart(2, '0');

/** GET /admin/acct/budget/period?year= — 계정마다 분기 · 연 · 누계 */
export async function budgetPeriod(db: DatabaseService, yearQ?: number | string) {
  const year = yearOk(yearQ);
  const now = kstYm();
  const upto = now.slice(0, 4) === String(year) ? Number(now.slice(5, 7)) : now.slice(0, 4) > String(year) ? 12 : 0;
  const rows = await db.query<{ role: string; name: string; kind: string; m: number; budget: string | null; d: string; c: string }>(
    `WITH months AS (SELECT generate_series(1, 12) AS m),
          acc AS (SELECT role, name, kind, sort FROM acct_accounts WHERE kind IN ('EXPENSE', 'REVENUE')),
          act AS (SELECT l.role, substr(e.ym, 6, 2)::int AS m, sum(l.debit) AS d, sum(l.credit) AS c
                    FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
                   WHERE substr(e.ym, 1, 4) = $1::text AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN') GROUP BY l.role, substr(e.ym, 6, 2)::int)
     SELECT acc.role, acc.name, acc.kind, months.m, b.amount::text AS budget, coalesce(act.d, 0)::text AS d, coalesce(act.c, 0)::text AS c
       FROM acc CROSS JOIN months
       LEFT JOIN acct_budgets b ON b.role = acc.role AND b.ym = $1::text || '-' || lpad(months.m::text, 2, '0')
       LEFT JOIN act ON act.role = acc.role AND act.m = months.m
      ORDER BY acc.kind DESC, acc.sort, acc.role, months.m`, [year]);
  const map = new Map<string, { role: string; name: string; kind: string; budget: number[]; actual: number[]; has: boolean }>();
  for (const r of rows) {
    const x = map.get(r.role) ?? { role: r.role, name: r.name, kind: r.kind, budget: Array(12).fill(0), actual: Array(12).fill(0), has: false };
    const a = r.kind === 'EXPENSE' ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d);
    x.actual[r.m - 1] = a;
    if (r.budget != null) { x.budget[r.m - 1] = Number(r.budget); x.has = true; }
    map.set(r.role, x);
  }
  const sum = (xs: number[], from: number, to: number) => xs.slice(from, to).reduce((s, v) => s + v, 0);
  const items = [...map.values()].filter((x) => x.has || x.actual.some((v) => v !== 0)).map((x) => {
    const q = [0, 1, 2, 3].map((i) => ({ q: i + 1, budget: sum(x.budget, i * 3, i * 3 + 3), actual: sum(x.actual, i * 3, i * 3 + 3) }));
    const ytdBudget = sum(x.budget, 0, upto), ytdActual = sum(x.actual, 0, upto);
    return { role: x.role, name: x.name, kind: x.kind, months: x.budget.map((b, i) => ({ m: i + 1, budget: b, actual: x.actual[i] })), quarters: q,
             year: { budget: sum(x.budget, 0, 12), actual: sum(x.actual, 0, 12) }, ytd: { budget: ytdBudget, actual: ytdActual, diff: ytdBudget - ytdActual,
             pct: ytdBudget ? Math.round((ytdActual / ytdBudget) * 1000) / 10 : null },
             over: x.kind === 'EXPENSE' && ytdBudget > 0 && ytdActual > ytdBudget };
  });
  const tot = (k: string, f: (i: typeof items[number]) => number) => items.filter((i) => i.kind === k).reduce((s, i) => s + f(i), 0);
  return { year, upto, items,
           total: { expenseYearBudget: tot('EXPENSE', (i) => i.year.budget), expenseYtdBudget: tot('EXPENSE', (i) => i.ytd.budget), expenseYtdActual: tot('EXPENSE', (i) => i.ytd.actual),
                    revenueYearBudget: tot('REVENUE', (i) => i.year.budget), revenueYtdBudget: tot('REVENUE', (i) => i.ytd.budget), revenueYtdActual: tot('REVENUE', (i) => i.ytd.actual) },
           note: '분기 · 연은 달 예산의 합입니다. 누계는 1월부터 이번 달까지(지난해는 12월까지)입니다. 연 목표를 넣으면 달로 나눠 달 예산에 들어갑니다.' };
}

/** POST /admin/acct/budget/year — 연 목표를 달로 나눠 넣기(SUPER) */
export async function setYearBudget(db: DatabaseService, b: { year: number; items: Array<{ role: string; amount: number }>; split?: string; fromMonth?: number; reason: string }, actor: string | null) {
  const year = yearOk(b.year);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length || items.length > 60) throw new PolicyViolation('ACCT_BUDGET', '연 목표는 1 ~ 60줄입니다.');
  const split = b.split === 'LAST_YEAR' ? 'LAST_YEAR' : 'EVEN';
  const now = kstYm();
  const minFrom = now.slice(0, 4) === String(year) ? Number(now.slice(5, 7)) : now.slice(0, 4) < String(year) ? 1 : 13;
  const from = Math.max(minFrom, Math.round(Number(b.fromMonth ?? minFrom)) || minFrom);
  if (from > 12) throw new PolicyViolation('ACCT_BUDGET', '지난 해의 연 목표는 달로 나눠 넣지 않습니다(달 예산에서 고침).');
  const months = Array.from({ length: 13 - from }, (_, i) => from + i);
  const perMonth = new Map<number, Array<{ role: string; amount: number }>>();
  for (const it of items) {
    const total = Math.round(Number(it.amount));
    if (!Number.isFinite(total) || total < 0 || total > 1e13) throw new PolicyViolation('ACCT_BUDGET', '예산은 0 이상 정수입니다(0 이면 지움).');
    let weights = months.map(() => 1);
    if (split === 'LAST_YEAR') {
      const prev = await db.query<{ m: number; v: string }>(
        `SELECT substr(e.ym, 6, 2)::int AS m, sum(CASE WHEN a.kind = 'EXPENSE' THEN l.debit - l.credit ELSE l.credit - l.debit END)::text AS v
           FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
          WHERE l.role = $1 AND substr(e.ym, 1, 4) = $2::text AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN') GROUP BY 1`, [String(it.role), year - 1]);
      const w = months.map((m) => Math.max(0, Number(prev.find((p) => p.m === m)?.v ?? 0)));
      if (w.some((x) => x > 0)) weights = w;
    }
    const wsum = weights.reduce((s, v) => s + v, 0);
    let left = total;
    months.forEach((m, i) => {
      const amt = i === months.length - 1 ? left : Math.floor((total * weights[i]!) / wsum);
      left -= amt;
      perMonth.set(m, [...(perMonth.get(m) ?? []), { role: String(it.role), amount: amt }]);
    });
  }
  let changed = 0;
  for (const m of months) {
    const r = await setBudget(db, { ym: `${year}-${mm(m)}`, items: perMonth.get(m) ?? [], reason: `연 목표 나눔(${split === 'EVEN' ? '똑같이' : '지난해 비율'}) · ${b.reason}`.slice(0, 200) }, actor);
    changed += Number(r.changed ?? 0);
  }
  return { ok: true, year, split, fromMonth: from, months: months.length, changed,
           note: `${year}년 연 목표를 ${from}월 ~ 12월 ${months.length}달로 나눠 넣었습니다(${changed}줄 바뀜).` };
}

/** 경영 보고서 한 줄 — 올해 누계 비용 · 매출 대비 예산(예산이 없으면 null) */
export async function budgetYearLine(db: DatabaseService) {
  const p = await budgetPeriod(db);
  const t = p.total;
  if (!t.expenseYearBudget && !t.revenueYearBudget) return null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
  return { year: p.year, upto: p.upto, ...t,
           text: `${p.year}년 1 ~ ${p.upto}월 누계 — 비용 ${t.expenseYtdActual.toLocaleString('ko-KR')}원 / 예산 ${t.expenseYtdBudget.toLocaleString('ko-KR')}원(${pct(t.expenseYtdActual, t.expenseYtdBudget)}) · 매출 ${t.revenueYtdActual.toLocaleString('ko-KR')}원 / 목표 ${t.revenueYtdBudget.toLocaleString('ko-KR')}원(${pct(t.revenueYtdActual, t.revenueYtdBudget)})` };
}

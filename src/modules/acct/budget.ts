import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.399 (D246 · docs/536) 예산 대비 실적
 *   SUPER 가 달 · 계정(비용 · 매출)마다 예산을 넣음(0 이면 지움 · 바꾼 기록 · 사유) · 지난달 예산 그대로 옮기기.
 *   실적 = 그 달 전표(비용 차변 − 대변 · 매출 대변 − 차변 · 공급가).
 *   정기 작업 acct_budget(매일 09:25) — 이번 달 · 지난달 비용 계정 실적 > 예산이면 ACCT_BUDGET_OVER(달 · 계정 한 번) · 예산을 올리거나 지우면 풀림.
 *   경영 보고서 한 줄 — budgetLine(ym).
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`; };
const ymOk = (ym?: string) => { if (!ym || !YM.test(ym)) throw new PolicyViolation('ACCT_YM', '달은 YYYY-MM 으로 적어 주십시오.'); return ym; };

/** 그 달 계정마다 예산 · 실적 · 차이 · 쓴 비율 */
export async function budgetView(db: DatabaseService, ymQ?: string) {
  const ym = ymOk(ymQ ?? kstYm());
  const rows = await db.query<{ role: string; name: string; kind: string; code: string | null; budget: string | null; d: string; c: string }>(
    `SELECT a.role, a.name, a.kind, a.ext_code AS code, b.amount::text AS budget,
            coalesce((SELECT sum(l.debit) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = a.role AND e.ym = $1), 0)::text AS d,
            coalesce((SELECT sum(l.credit) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = a.role AND e.ym = $1), 0)::text AS c
       FROM acct_accounts a LEFT JOIN acct_budgets b ON b.role = a.role AND b.ym = $1
      WHERE a.kind IN ('EXPENSE', 'REVENUE') ORDER BY a.kind DESC, a.sort, a.role`, [ym]);
  const items = rows.map((r) => {
    const actual = r.kind === 'EXPENSE' ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d);
    const budget = r.budget == null ? null : Number(r.budget);
    const diff = budget == null ? null : budget - actual;
    const pct = budget ? Math.round((actual / budget) * 1000) / 10 : null;
    return { role: r.role, name: r.name, kind: r.kind, code: r.code, budget, actual, diff, pct,
             over: budget != null && r.kind === 'EXPENSE' && actual > budget, short: budget != null && r.kind === 'REVENUE' && actual < budget };
  });   // 예산이 없는 계정도 보임(화면에서 바로 넣음)
  const exp = items.filter((x) => x.kind === 'EXPENSE'), rev = items.filter((x) => x.kind === 'REVENUE');
  const s = (xs: typeof items, f: 'budget' | 'actual') => xs.reduce((a, x) => a + (x[f] ?? 0), 0);
  const changes = await db.query(
    `SELECT c.id::text AS id, c.role, c.before::float8 AS before, c.after::float8 AS after, c.reason, c.created_at AS "createdAt", a.email AS actor
       FROM acct_budget_changes c LEFT JOIN accounts a ON a.id = c.actor_id WHERE c.ym = $1 ORDER BY c.id DESC LIMIT 30`, [ym]);
  return { ym, items, total: { expenseBudget: s(exp.filter((x) => x.budget != null), 'budget'), expenseActual: s(exp, 'actual'), revenueBudget: s(rev.filter((x) => x.budget != null), 'budget'), revenueActual: s(rev, 'actual'),
           overCount: items.filter((x) => x.over).length }, changes,
           note: '실적은 전표(공급가) 기준이고, 예산이 없는 계정은 예산 칸이 비어 있습니다. 비용이 예산을 넘으면 운영 알림 ACCT_BUDGET_OVER(달 · 계정 한 번)를 보냅니다.' };
}

/** 예산 넣기(SUPER) — 줄마다 계정 · 금액(0 이면 지움) · 사유 · copyFrom 이면 그 달 예산을 그대로(이미 있는 계정은 그대로 둠) */
export async function setBudget(db: DatabaseService, b: { ym?: string; items?: Array<{ role: string; amount: number }>; copyFrom?: string; reason?: string }, actor: string | null) {
  const ym = ymOk(b.ym);
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  let items = Array.isArray(b.items) ? b.items : [];
  if (b.copyFrom) {
    ymOk(b.copyFrom);
    const src = await db.query<{ role: string; amount: number }>(
      `SELECT s.role, s.amount::float8 AS amount FROM acct_budgets s WHERE s.ym = $1 AND NOT EXISTS (SELECT 1 FROM acct_budgets t WHERE t.ym = $2 AND t.role = s.role)`, [b.copyFrom, ym]);
    items = [...items, ...src];
  }
  if (!items.length) throw new PolicyViolation('ACCT_BUDGET', '넣을 예산이 없습니다.');
  if (items.length > 100) throw new PolicyViolation('ACCT_BUDGET', '한 번에 100줄까지입니다.');
  for (const it of items) {
    const n = Math.round(Number(it.amount));
    if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new PolicyViolation('ACCT_BUDGET', '예산은 0 이상 정수입니다(0 이면 지움).');
  }
  const known = await db.query<{ role: string }>(`SELECT role FROM acct_accounts WHERE role = ANY($1::text[]) AND kind IN ('EXPENSE', 'REVENUE')`, [items.map((i) => String(i.role))]);
  const ok = new Set(known.map((k) => k.role));
  const bad = items.find((i) => !ok.has(String(i.role)));
  if (bad) throw new PolicyViolation('ACCT_BUDGET', `예산은 비용 · 매출 계정에만 둡니다: ${String(bad.role)}`);
  let changed = 0;
  await db.transaction(async () => {
    for (const it of items) {
      const n = Math.round(Number(it.amount));
      const [cur] = await db.query<{ amount: string }>(`SELECT amount::text AS amount FROM acct_budgets WHERE ym = $1 AND role = $2`, [ym, it.role]);
      const before = cur ? Number(cur.amount) : null;
      if ((before ?? 0) === n) continue;
      if (n === 0) await db.query(`DELETE FROM acct_budgets WHERE ym = $1 AND role = $2`, [ym, it.role]);
      else await db.query(
        `INSERT INTO acct_budgets (ym, role, amount, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (ym, role) DO UPDATE SET amount = EXCLUDED.amount, updated_by = EXCLUDED.updated_by, updated_at = now()`, [ym, it.role, n, actor]);
      await db.query(`INSERT INTO acct_budget_changes (ym, role, before, after, reason, actor_id) VALUES ($1, $2, $3, $4, $5, $6)`, [ym, it.role, before, n || null, reason, actor]);
      changed++;
    }
  });
  const r = await budgetJob(db, ym);   // 예산을 올리면 그 자리에서 풀림
  return { ok: true, ym, changed, alerts: r, note: changed ? `${ym} 예산 ${changed}줄을 바꿨습니다.` : '바뀐 것이 없습니다.' };
}

/** 정기 작업 acct_budget — 넘은 비용 계정 알림 · 풀기(only 를 주면 그 달만) */
export async function budgetJob(db: DatabaseService, only?: string) {
  const [s] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.budget_alert'`);
  const on = (s?.value ?? 'on') === 'on';
  const now = kstYm(), months = only ? [only] : [now, prevYm(now)];
  const made: string[] = []; let resolved = 0;
  for (const ym of months) {
    const v = await budgetView(db, ym);
    const over = new Set(v.items.filter((x) => x.over).map((x) => x.role));
    const r = await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '예산 안으로 들어옴'
        WHERE alert_code = 'ACCT_BUDGET_OVER' AND resolved_at IS NULL AND detail->>'ym' = $1 AND NOT (detail->>'role' = ANY($2::text[])) RETURNING id`, [ym, [...over]]);
    resolved += r.length;
    if (!on) continue;
    for (const x of v.items.filter((i) => i.over)) {
      const k = `${ym}:${x.role}`;
      const ins = await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'ACCT_BUDGET_OVER', 'WARN', $1, $2::jsonb, clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_BUDGET_OVER' AND detail->>'key' = $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [`${ym} ${x.name} 예산 ${x.budget!.toLocaleString('ko-KR')}원을 넘었습니다(실적 ${x.actual.toLocaleString('ko-KR')}원 · ${x.pct}%) — 회계 › 예산`,
         JSON.stringify({ key: k, ym, role: x.role, budget: x.budget, actual: x.actual }), k]);
      if (ins.length) made.push(k);
    }
  }
  return { on, made, resolved };
}

/** 경영 보고서 한 줄 — 그 달 비용 예산 · 실적 · 넘은 계정 수(예산이 없으면 null) */
export async function budgetLine(db: DatabaseService, ym: string) {
  const v = await budgetView(db, ym);
  if (!v.items.some((x) => x.budget != null)) return null;
  const top = v.items.filter((x) => x.over).sort((a, b) => (b.actual - (b.budget ?? 0)) - (a.actual - (a.budget ?? 0))).slice(0, 3).map((x) => x.name);
  return { ym, expenseBudget: v.total.expenseBudget, expenseActual: v.total.expenseActual, overCount: v.total.overCount, over: top,
           text: `비용 예산 ${v.total.expenseBudget.toLocaleString('ko-KR')}원 중 ${v.total.expenseActual.toLocaleString('ko-KR')}원 씀${v.total.overCount ? ` · 넘은 계정 ${v.total.overCount}(${top.join(' · ')})` : ''}` };
}

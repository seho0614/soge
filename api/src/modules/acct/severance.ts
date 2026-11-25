/* e3 (docs/010) 소개뱅크 src/modules/acct/severance.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.406 (D248 · docs/543) 퇴직금 추계 · 연차 대장
 *   직원 · 급여는 ⑭(v10.403) acct_employees · acct_payroll_runs · acct_payroll_lines 를 읽습니다(없으면 빈 목록).
 *   퇴직금 추계(초안 · 노무사 · 세무사 확인):
 *     1일 평균임금 = 그 달까지 최근 3개월 급여 총액(확정 · 지급한 급여 · gross) ÷ 그 3개월 달력 날수
 *       (급여 기록이 없으면 월 기본급 × 3 ÷ 날수 · 상여 · 연차수당 3개월분 가산은 아직 안 함)
 *     추계액 = 1일 평균임금 × 30 × 재직일수 ÷ 365 · 법정 지급 대상(재직 1년 이상)만 충당 합계에 넣음
 *   달마다 한 번(SUPER): 추계액 합계 − 장부의 퇴직급여충당부채 잔액 = 차이만 전표 SEVERANCE_ACCRUE
 *     (늘면 차변 퇴직급여 / 대변 퇴직급여충당부채 · 줄면 반대) · 그 달 말 날짜 · 마감한 달이면 못 함.
 *   연차(초안): 1년 미만 — 한 달 개근마다 acct.leave_first_year_monthly(최대 11일) · 1년 이상 — acct.leave_base_days + 2년마다 1일(acct.leave_max_days 까지).
 *     생긴 날 · 쓴 날은 쌓기만(바로잡기는 음수 줄) · 남은 날 = 생긴 날 − 쓴 날. 「제안 일수」는 참고이고 넣는 날수는 SUPER 가 정함.
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthEnd = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const ymAdd = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function hasTable(db: DatabaseService, t: string) {
  const [r] = await db.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
  return !!r?.ok;
}

interface Emp { id: string; name: string; joinedOn: string; leftOn: string | null; monthlyBase: number }

async function employees(db: DatabaseService, asOf: string): Promise<Emp[]> {
  if (!(await hasTable(db, 'acct_employees'))) return [];
  const rows = await db.query<{ id: string; name: string; joinedOn: string; leftOn: string | null; monthlyBase: string }>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", coalesce(monthly_base, 0)::text AS "monthlyBase"
       FROM acct_employees WHERE joined_on <= $1::date AND (left_on IS NULL OR left_on > $1::date) ORDER BY joined_on, id`, [asOf]);
  return rows.map((r) => ({ ...r, monthlyBase: Number(r.monthlyBase) }));
}

/** 직원별 최근 3개월 급여 총액(확정 · 지급) — ⑭ 표가 없으면 빈 값 */
async function gross3(db: DatabaseService, ym: string): Promise<Map<string, { sum: number; months: number }>> {
  const out = new Map<string, { sum: number; months: number }>();
  if (!(await hasTable(db, 'acct_payroll_lines')) || !(await hasTable(db, 'acct_payroll_runs'))) return out;
  const rows = await db.query<{ emp: string; s: string; m: number }>(
    `SELECT l.employee_id::text AS emp, sum(l.gross)::text AS s, count(DISTINCT r.ym)::int AS m
       FROM acct_payroll_lines l JOIN acct_payroll_runs r ON r.id = l.run_id
      WHERE r.state IN ('FIXED', 'PAID') AND r.ym BETWEEN $1 AND $2 GROUP BY l.employee_id`, [ymAdd(ym, -2), ym]);
  for (const r of rows) out.set(r.emp, { sum: Number(r.s), months: Number(r.m) });
  return out;
}

export interface SevRow { employeeId: string; name: string; joinedOn: string; serviceDays: number; eligible: boolean; dailyAvg: number; estimate: number; basis: 'PAYROLL' | 'BASE' | 'NONE' }

/** 그 달 말 기준 추계(보기만) */
export async function severanceEstimate(db: DatabaseService, ym: string) {
  if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_SEVERANCE', '달(YYYY-MM)이 바르지 않습니다.');
  const end = monthEnd(ym);
  const emps = await employees(db, end);
  const g = await gross3(db, ym);
  const start3 = `${ymAdd(ym, -2)}-01`;
  const calDays3 = daysBetween(start3, end) + 1;
  const rows: SevRow[] = emps.map((e) => {
    const serviceDays = daysBetween(e.joinedOn, end) + 1;
    const p = g.get(e.id);
    /* 3개월 안에 들어온 사람은 들어온 날부터 날수 */
    const days3 = Math.max(1, Math.min(calDays3, serviceDays));
    let dailyAvg = 0, basis: SevRow['basis'] = 'NONE';
    if (p && p.sum > 0) { dailyAvg = p.sum / days3; basis = 'PAYROLL'; }
    else if (e.monthlyBase > 0) { dailyAvg = (e.monthlyBase * 3) / calDays3; basis = 'BASE'; }
    const eligible = serviceDays >= 365;
    const estimate = Math.round(dailyAvg * 30 * serviceDays / 365);
    return { employeeId: e.id, name: e.name, joinedOn: e.joinedOn, serviceDays, eligible, dailyAvg: Math.round(dailyAvg), estimate, basis };
  });
  const total = rows.filter((r) => r.eligible).reduce((a, r) => a + r.estimate, 0);
  /* v10.418 (D251) — 퇴직급여충당부채 장부 잔액 = 가장 늦은 확정 기초 잔액 판(⑬ acct_opening) + 그 기준일부터 전표(⑬ trialBalance 와 같은 셈) */
  const [b] = await db.query<{ v: string }>(
    `WITH s AS (SELECT id, as_of FROM acct_opening_sets WHERE state = 'FIXED' AND as_of <= $1::date ORDER BY as_of DESC LIMIT 1)
     SELECT (coalesce((SELECT sum(o.credit - o.debit) FROM acct_opening o JOIN s ON s.id = o.set_id WHERE o.role = 'SEVERANCE_RES'), 0)
           + coalesce((SELECT sum(l.credit - l.debit) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
                        WHERE l.role = 'SEVERANCE_RES' AND e.entry_date <= $1::date
                          AND e.entry_date >= coalesce((SELECT as_of FROM s), '0001-01-01'::date)), 0))::text AS v`, [end]);
  const book = Number(b?.v ?? 0);
  const [done] = await db.query(`SELECT id::text AS id, estimate::bigint AS estimate, diff::bigint AS diff, entry_id::text AS "entryId", created_at AS "createdAt" FROM acct_severance_runs WHERE ym = $1`, [ym]);
  return {
    ym, asOf: end, rows, total, allTotal: rows.reduce((a, r) => a + r.estimate, 0), book, diff: total - book, done: done ?? null, hasEmployees: await hasTable(db, 'acct_employees'),
    note: '추계액은 1일 평균임금 × 30 × 재직일수 ÷ 365 입니다(최근 3개월 급여 기준 · 상여 가산 없음). 충당은 재직 1년 이상만 합칩니다. 계산 방식은 초안이라 노무사 · 세무사 확인이 필요합니다.',
  };
}

/** POST /admin/acct/severance/run — 그 달 한 번 · 차이만 전표 */
export async function severanceRun(db: DatabaseService, ym: string, actor: string | null) {
  const est = await severanceEstimate(db, ym);
  if (ym >= kstToday().slice(0, 7)) throw new PolicyViolation('ACCT_SEVERANCE', '이번 달은 달이 끝난 뒤 합니다.');
  if (est.done) throw new StateConflict('ACCT_SEVERANCE_DONE', '그 달 퇴직금 추계는 이미 했습니다.');
  const [cl] = await db.query(`SELECT 1 FROM acct_closings WHERE ym = $1`, [ym]);
  if (cl) throw new PolicyViolation('ACCT_SEVERANCE', `${ym} 은 마감한 달입니다 — 마감 전에 퇴직금 추계를 하십시오.`);
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_severance'))`);
    let entryId: string | null = null;
    if (est.diff !== 0) {
      const amt = Math.abs(est.diff);
      const lines = est.diff > 0
        ? [{ role: 'EXP_SEVERANCE', debit: amt, credit: 0 }, { role: 'SEVERANCE_RES', debit: 0, credit: amt }]
        : [{ role: 'SEVERANCE_RES', debit: amt, credit: 0 }, { role: 'EXP_SEVERANCE', debit: 0, credit: amt }];
      const [e] = await db.query<{ id: string }>(
        `INSERT INTO acct_entries (entry_date, source, source_key, memo, evidence, late) VALUES ($1::date, 'SEVERANCE_ACCRUE', $2, $3, 'NONE', false) RETURNING id::text AS id`,
        [est.asOf, ym, `퇴직금 추계 ${ym}(${est.diff > 0 ? '충당' : '환입'})`]);
      await db.query(
        `INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT $1::bigint, x.role, x.debit, x.credit FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint)`,
        [e.id, JSON.stringify(lines)]);
      entryId = e.id;
    }
    await db.query(
      `INSERT INTO acct_severance_runs (ym, estimate, book_before, diff, detail, entry_id, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6::bigint, $7)`,
      [ym, est.total, est.book, est.diff, JSON.stringify(est.rows.map((r) => ({ name: r.name, serviceDays: r.serviceDays, dailyAvg: r.dailyAvg, estimate: r.estimate, eligible: r.eligible, basis: r.basis }))), entryId, actor]);
    return { ok: true, ym, estimate: est.total, book: est.book, diff: est.diff, entryId,
             note: est.diff === 0 ? '추계액과 장부가 같아 전표 없이 기록만 남겼습니다.' : `차이 ${est.diff.toLocaleString('ko-KR')}원을 전표 ${entryId} 로 넣었습니다.` };
  });
}

/* ── 연차 ── */
async function leaveRule(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM erp_site_settings WHERE key IN ('acct.leave_base_days', 'acct.leave_max_days', 'acct.leave_first_year_monthly')`);
  const v = (k: string, d: number) => { const n = Number(rows.find((r) => r.key === k)?.value ?? d); return Number.isFinite(n) ? n : d; };
  return { base: v('acct.leave_base_days', 15), max: v('acct.leave_max_days', 25), monthly: v('acct.leave_first_year_monthly', 1) };
}

/** 오늘 기준 제안 일수(참고) */
export function suggestLeave(joinedOn: string, today: string, rule: { base: number; max: number; monthly: number }) {
  const days = daysBetween(joinedOn, today);
  if (days < 0) return 0;
  const years = Math.floor(days / 365);
  if (years < 1) {
    const j = new Date(joinedOn), t = new Date(today);
    const months = (t.getUTCFullYear() - j.getUTCFullYear()) * 12 + (t.getUTCMonth() - j.getUTCMonth()) - (t.getUTCDate() < j.getUTCDate() ? 1 : 0);
    return Math.min(11, Math.max(0, months) * rule.monthly);
  }
  return Math.min(rule.max, rule.base + Math.floor((years - 1) / 2));
}

/** GET /admin/acct/leave?year= */
export async function leaveBook(db: DatabaseService, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new PolicyViolation('ACCT_LEAVE', '해(연도)가 바르지 않습니다.');
  const today = kstToday();
  const emps = await employees(db, `${year}-12-31` < today ? `${year}-12-31` : today);
  const rule = await leaveRule(db);
  const g = await db.query<{ emp: string; d: string }>(`SELECT employee_id::text AS emp, sum(days)::text AS d FROM acct_leave_grants WHERE year = $1 GROUP BY employee_id`, [year]);
  const u = await db.query<{ emp: string; d: string }>(
    `SELECT employee_id::text AS emp, sum(days)::text AS d FROM acct_leave_uses WHERE used_on BETWEEN $1::date AND $2::date GROUP BY employee_id`, [`${year}-01-01`, `${year}-12-31`]);
  const gm = new Map(g.map((x) => [x.emp, Number(x.d)])), um = new Map(u.map((x) => [x.emp, Number(x.d)]));
  const recent = await db.query(
    `SELECT x.kind, x.id::text AS id, x.employee_id::text AS "employeeId", x.day, x.days::float AS days, x.note, x.created_at AS "createdAt" FROM (
       SELECT 'GRANT' AS kind, id, employee_id, make_date(year, 1, 1)::text AS day, days, note, created_at FROM acct_leave_grants WHERE year = $1
       UNION ALL SELECT 'USE', id, employee_id, used_on::text, days, note, created_at FROM acct_leave_uses WHERE used_on BETWEEN $2::date AND $3::date) x
     ORDER BY x.created_at DESC LIMIT 50`, [year, `${year}-01-01`, `${year}-12-31`]);
  const rows = emps.map((e) => {
    const granted = gm.get(e.id) ?? 0, used = um.get(e.id) ?? 0;
    return { employeeId: e.id, name: e.name, joinedOn: e.joinedOn, granted, used, remaining: Math.round((granted - used) * 10) / 10, suggest: suggestLeave(e.joinedOn, today, rule) };
  });
  return { year, rows, recent, rule, hasEmployees: await hasTable(db, 'acct_employees'),
           note: '제안 일수는 설정(acct.leave_*) 기준 참고값입니다(초안 · 노무사 확인). 생긴 날 · 쓴 날은 쌓기만 하고, 바로잡기는 음수 줄로 합니다.' };
}

async function empExists(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id ?? '')) return false;
  if (!(await hasTable(db, 'acct_employees'))) return false;
  const [e] = await db.query(`SELECT 1 FROM acct_employees WHERE id = $1::bigint`, [id]);
  return !!e;
}

/** POST /admin/acct/leave/grant (SUPER) */
export async function leaveGrant(db: DatabaseService, b: { employeeId: string; year: number; days: number; note: string }, actor: string | null) {
  if (!(await empExists(db, b.employeeId))) throw new NotFound('직원이 없습니다.');
  const days = Math.round(Number(b.days) * 10) / 10, note = (b.note ?? '').replace(/\s+/g, ' ').trim();
  if (!days || Math.abs(days) > 40) throw new PolicyViolation('ACCT_LEAVE', '일수는 0 이 아닌 ±40 안입니다(0.5 단위).');
  if (note.length < 2 || note.length > 200) throw new PolicyViolation('ACCT_LEAVE', '사유는 2 ~ 200자입니다.');
  if (!Number.isInteger(b.year) || b.year < 2000 || b.year > 2100) throw new PolicyViolation('ACCT_LEAVE', '해(연도)가 바르지 않습니다.');
  const [r] = await db.query<{ id: string }>(`INSERT INTO acct_leave_grants (employee_id, year, days, note, created_by) VALUES ($1::bigint, $2, $3, $4, $5) RETURNING id::text AS id`,
    [b.employeeId, b.year, days, note, actor]);
  return { ok: true, id: r.id, note: `연차 ${days}일을 넣었습니다.` };
}

/** POST /admin/acct/leave/use (SUPER · PAYOUT) — 취소는 음수 */
export async function leaveUse(db: DatabaseService, b: { employeeId: string; usedOn: string; days: number; note?: string }, actor: string | null) {
  if (!(await empExists(db, b.employeeId))) throw new NotFound('직원이 없습니다.');
  const days = Math.round(Number(b.days) * 10) / 10;
  if (!days || Math.abs(days) > 30) throw new PolicyViolation('ACCT_LEAVE', '일수는 0 이 아닌 ±30 안입니다(0.5 단위 · 취소는 음수).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.usedOn ?? '') || Number.isNaN(Date.parse(b.usedOn))) throw new PolicyViolation('ACCT_LEAVE', '날짜가 바르지 않습니다.');
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if (days < 0 && (!note || note.length < 2)) throw new PolicyViolation('ACCT_LEAVE', '취소(음수)는 사유를 2자 이상 적어 주십시오.');
  const [r] = await db.query<{ id: string }>(`INSERT INTO acct_leave_uses (employee_id, used_on, days, note, created_by) VALUES ($1::bigint, $2::date, $3, $4, $5) RETURNING id::text AS id`,
    [b.employeeId, b.usedOn, days, note, actor]);
  return { ok: true, id: r.id, note: days > 0 ? `연차 ${days}일 사용을 적었습니다.` : `연차 ${-days}일 사용을 취소했습니다.` };
}

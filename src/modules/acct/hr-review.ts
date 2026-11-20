import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { myEmployee } from './hr';

/* ---------------------------------------------------------------------
 * ㉛ 인사 3 (D262 · docs/598) — v10.460 인사 평가 · 목표 · 대표 11/20 「다음개발 ㉛」
 *   분기 차례(hr_review_cycles) GOALS → REVIEW → CLOSED(ADMIN · 앞으로만)
 *   GOALS  — 직원이 내 인사에서 목표(1 ~ 10개 · 가중치 합 100) 적기 · 바꾸기
 *   REVIEW — 직원 자기 점수(1 ~ 5) · 의견 · 「제출」(뒤 못 고침) · 상사(ADMIN · 본인 아님) 점수 · 의견 · 등급
 *   CLOSED — 못 고침 · 직원에게 상사 점수 · 의견 · 등급이 보임(닫기 전에는 안 보임)
 *   등급 제안 = 상사 가중 평균 ≥ hr.review_grade_cuts(처음 S 4.5 · A 3.5 · B 2.5 · C 1.5 · 아래 D) — 상사가 골라 확정
 * ------------------------------------------------------------------- */

export const GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
const clean = (s: string | null | undefined, max: number) => (s ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max) || null;
const qRange = (y: number, q: number) => {
  const m0 = (q - 1) * 3 + 1;
  const end = new Date(Date.UTC(y, m0 + 2, 0)).toISOString().slice(0, 10);
  return { start: `${y}-${String(m0).padStart(2, '0')}-01`, end };
};

async function cuts(db: DatabaseService): Promise<Array<[string, number]>> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hr.review_grade_cuts'`);
  const m = /^S:([1-5](?:\.[0-9])?),A:([1-5](?:\.[0-9])?),B:([1-5](?:\.[0-9])?),C:([1-5](?:\.[0-9])?)$/.exec(r?.v ?? '');
  const v = m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : [4.5, 3.5, 2.5, 1.5];
  return [['S', v[0]!], ['A', v[1]!], ['B', v[2]!], ['C', v[3]!]];
}
export function gradeFor(avg: number | null, cs: Array<[string, number]>): string | null {
  if (avg == null) return null;
  for (const [g, c] of cs) if (avg >= c) return g;
  return 'D';
}
/** 가중 평균(점수 없는 목표는 뺌 · 소수 둘째 자리) */
export function weighted(goals: Array<{ weight: number; score: number | null }>): number | null {
  const has = goals.filter((g) => g.score != null);
  const w = has.reduce((a, g) => a + g.weight, 0);
  if (!w) return null;
  return Math.round((has.reduce((a, g) => a + g.weight * (g.score as number), 0) / w) * 100) / 100;
}

export interface Cycle { id: string; year: number; quarter: number; title: string; state: string; goalDue: string | null; reviewDue: string | null }
async function cycleOf(db: DatabaseService, id: string, lock = false): Promise<Cycle> {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 평가 차례입니다.');
  const [c] = await db.query<Cycle>(
    `SELECT id::text AS id, year, quarter, title, state, goal_due::text AS "goalDue", review_due::text AS "reviewDue" FROM hr_review_cycles WHERE id = $1::bigint`
    + (lock ? ' FOR UPDATE' : ''), [id]);
  if (!c) throw new NotFound('없는 평가 차례입니다.');
  return c;
}
async function staffOf(db: DatabaseService, c: Cycle) {
  const { start, end } = qRange(c.year, c.quarter);
  return db.query<{ id: string; name: string; accountId: string | null }>(
    `SELECT id::text AS id, name, account_id::text AS "accountId" FROM acct_employees
      WHERE joined_on <= $2::date AND (left_on IS NULL OR left_on >= $1::date) ORDER BY joined_on, id`, [start, end]);
}
export interface Goal { id: string; employeeId: string; title: string; measure: string | null; weight: number; selfScore: number | null; selfNote: string | null; mgrScore: number | null; mgrNote: string | null }
async function goalsOf(db: DatabaseService, cycleId: string, employeeId?: string) {
  return db.query<Goal>(
    `SELECT id::text AS id, employee_id::text AS "employeeId", title, measure, weight, self_score AS "selfScore", self_note AS "selfNote", mgr_score AS "mgrScore", mgr_note AS "mgrNote"
       FROM hr_review_goals WHERE cycle_id = $1::bigint AND ($2::text = '' OR employee_id::text = $2) ORDER BY employee_id, id`, [cycleId, employeeId ?? '']);
}
export interface Result { employeeId: string; selfComment: string | null; selfSubmittedAt: string | null; mgrComment: string | null; mgrAvg: number | null; grade: string | null; reviewedAt: string | null }
async function resultsOf(db: DatabaseService, cycleId: string, employeeId?: string) {
  return db.query<Result>(
    `SELECT employee_id::text AS "employeeId", self_comment AS "selfComment", self_submitted_at AS "selfSubmittedAt", mgr_comment AS "mgrComment",
            mgr_avg::float8 AS "mgrAvg", grade, reviewed_at AS "reviewedAt"
       FROM hr_review_results WHERE cycle_id = $1::bigint AND ($2::text = '' OR employee_id::text = $2)`, [cycleId, employeeId ?? '']);
}

/* ── 관리자 ── */
export async function cycles(db: DatabaseService) {
  const items = await db.query(
    `SELECT c.id::text AS id, c.year, c.quarter, c.title, c.state, c.goal_due::text AS "goalDue", c.review_due::text AS "reviewDue", c.closed_at AS "closedAt",
            (SELECT count(DISTINCT g.employee_id)::int FROM hr_review_goals g WHERE g.cycle_id = c.id) AS "withGoals",
            (SELECT count(*)::int FROM hr_review_results r WHERE r.cycle_id = c.id AND r.self_submitted_at IS NOT NULL) AS "selfDone",
            (SELECT count(*)::int FROM hr_review_results r WHERE r.cycle_id = c.id AND r.grade IS NOT NULL) AS graded
       FROM hr_review_cycles c ORDER BY c.year DESC, c.quarter DESC LIMIT 40`);
  return { items, grades: GRADES, cuts: await cuts(db),
           note: '차례는 목표 → 평가 → 닫음 순서로만 넘어갑니다. 직원은 자기 것만 보고, 상사 점수 · 등급은 닫은 뒤에 보입니다(본인 평가는 다른 관리자가).' };
}

/** POST /admin/hr/reviews — 분기 차례 만들기 */
export async function createCycle(db: DatabaseService, b: { year: number; quarter: number; title?: string; goalDue?: string; reviewDue?: string }, actor: string | null) {
  if (!Number.isInteger(b.year) || b.year < 2000 || b.year > 2100 || !Number.isInteger(b.quarter) || b.quarter < 1 || b.quarter > 4) throw new PolicyViolation('REVIEW_INPUT', '해 · 분기(1 ~ 4)가 바르지 않습니다.');
  for (const d of [b.goalDue, b.reviewDue]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new PolicyViolation('REVIEW_INPUT', '날짜는 YYYY-MM-DD 입니다.');
  if (b.goalDue && b.reviewDue && b.reviewDue < b.goalDue) throw new PolicyViolation('REVIEW_INPUT', '평가 마감은 목표 마감 뒤입니다.');
  const title = clean(b.title, 60) ?? `${b.year}년 ${b.quarter}분기 평가`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO hr_review_cycles (year, quarter, title, goal_due, review_due, created_by) VALUES ($1::int, $2::int, $3, $4::date, $5::date, $6::uuid)
     ON CONFLICT (year, quarter) DO NOTHING RETURNING id::text AS id`, [b.year, b.quarter, title.length >= 2 ? title : `${b.year}년 ${b.quarter}분기 평가`, b.goalDue || null, b.reviewDue || null, actor]);
  if (!r.length) throw new StateConflict('REVIEW_EXISTS', `${b.year}년 ${b.quarter}분기 평가 차례가 이미 있습니다.`);
  return { ok: true, id: r[0]!.id, note: `${title}를 만들었습니다 — 직원이 내 인사에서 목표를 적습니다.` };
}

/** GET /admin/hr/reviews/{id} — 차례 한눈에(직원마다 목표 · 자기 평가 · 상사 평가) */
export async function cycleDetail(db: DatabaseService, id: string) {
  const c = await cycleOf(db, id);
  const staff = await staffOf(db, c);
  const goals = await goalsOf(db, c.id);
  const res = await resultsOf(db, c.id);
  const cs = await cuts(db);
  const people = staff.map((e) => {
    const gs = goals.filter((g) => g.employeeId === e.id);
    const r = res.find((x) => x.employeeId === e.id) ?? null;
    const avg = weighted(gs.map((g) => ({ weight: g.weight, score: g.mgrScore })));
    return { employeeId: e.id, name: e.name, accountId: e.accountId, goals: gs, weightSum: gs.reduce((a, g) => a + g.weight, 0),
             selfAvg: weighted(gs.map((g) => ({ weight: g.weight, score: g.selfScore }))), mgrAvg: avg, suggested: gradeFor(avg, cs), result: r };
  });
  return { cycle: c, people, cuts: cs, grades: GRADES };
}

/** POST /admin/hr/reviews/{id}/advance — 다음 단계(GOALS → REVIEW → CLOSED) */
export async function advanceCycle(db: DatabaseService, id: string, actor: string | null) {
  return db.transaction(async () => {
    const c = await cycleOf(db, id, true);
    if (c.state === 'CLOSED') throw new StateConflict('REVIEW_STATE', '이미 닫은 차례입니다.');
    const next = c.state === 'GOALS' ? 'REVIEW' : 'CLOSED';
    let ungraded = 0;
    if (next === 'CLOSED') {
      const [u] = await db.query<{ n: number }>(
        `SELECT count(DISTINCT g.employee_id)::int AS n FROM hr_review_goals g
          WHERE g.cycle_id = $1::bigint AND NOT EXISTS (SELECT 1 FROM hr_review_results r WHERE r.cycle_id = g.cycle_id AND r.employee_id = g.employee_id AND r.grade IS NOT NULL)`, [c.id]);
      ungraded = u?.n ?? 0;
    }
    await db.query(
      `UPDATE hr_review_cycles SET state = $2, closed_by = CASE WHEN $2::text = 'CLOSED' THEN $3::uuid END, closed_at = CASE WHEN $2::text = 'CLOSED' THEN now() END WHERE id = $1::bigint`,
      [c.id, next, actor]);
    return { ok: true, id: c.id, state: next, ungraded,
             note: next === 'REVIEW' ? '평가 단계로 넘겼습니다 — 목표는 이제 못 고치고 자기 평가 · 상사 평가를 적습니다.'
               : `차례를 닫았습니다 — 직원에게 결과가 보입니다${ungraded ? `(등급 없는 직원 ${ungraded}명)` : ''}.` };
  });
}

/** PUT /admin/hr/reviews/{id}/employees/{employeeId} — 상사 평가(점수 · 의견 · 등급 · 본인 아님) */
export async function managerReview(db: DatabaseService, id: string, employeeId: string, b: { scores?: Array<{ goalId: string; score: number; note?: string }>; comment?: string; grade?: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(employeeId ?? ''))) throw new NotFound('없는 직원입니다.');
  if (b.grade !== undefined && b.grade !== null && !(GRADES as readonly string[]).includes(b.grade)) throw new PolicyViolation('REVIEW_GRADE', '등급은 S · A · B · C · D 중 하나입니다.');
  return db.transaction(async () => {
    const c = await cycleOf(db, id, true);
    if (c.state !== 'REVIEW') throw new StateConflict('REVIEW_STATE', '상사 평가는 평가 단계에서만 적습니다.');
    const [e] = await db.query<{ name: string; accountId: string | null }>(`SELECT name, account_id::text AS "accountId" FROM acct_employees WHERE id = $1::bigint`, [employeeId]);
    if (!e) throw new NotFound('없는 직원입니다.');
    if (actor && e.accountId === actor) throw new Forbidden('HR_SELF', '본인 평가는 다른 관리자가 합니다.');
    const goals = await goalsOf(db, c.id, employeeId);
    for (const s of b.scores ?? []) {
      if (!goals.some((g) => g.id === String(s.goalId))) throw new PolicyViolation('REVIEW_GOAL', '이 직원의 목표가 아닙니다.');
      if (!Number.isInteger(s.score) || s.score < 1 || s.score > 5) throw new PolicyViolation('REVIEW_SCORE', '점수는 1 ~ 5 입니다.');
      await db.query(`UPDATE hr_review_goals SET mgr_score = $2::smallint, mgr_note = $3 WHERE id = $1::bigint`, [String(s.goalId), s.score, clean(s.note, 300)]);
    }
    const after = await goalsOf(db, c.id, employeeId);
    const avg = weighted(after.map((g) => ({ weight: g.weight, score: g.mgrScore })));
    const grade = b.grade ? b.grade : null;
    if (grade && avg == null) throw new PolicyViolation('REVIEW_SCORE', '등급을 정하려면 목표 점수를 먼저 적습니다.');
    await db.query(
      `INSERT INTO hr_review_results (cycle_id, employee_id, mgr_comment, mgr_avg, grade, reviewed_by, reviewed_at)
       VALUES ($1::bigint, $2::bigint, $3, $4::numeric, $5, $6::uuid, now())
       ON CONFLICT (cycle_id, employee_id) DO UPDATE SET mgr_comment = CASE WHEN $7::boolean THEN EXCLUDED.mgr_comment ELSE hr_review_results.mgr_comment END,
              mgr_avg = EXCLUDED.mgr_avg, grade = coalesce(EXCLUDED.grade, hr_review_results.grade), reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now()`,
      [c.id, employeeId, clean(b.comment, 1000), avg, grade, actor, b.comment !== undefined]);
    const cs = await cuts(db);
    return { ok: true, cycleId: c.id, employeeId, mgrAvg: avg, suggested: gradeFor(avg, cs), grade, note: `${e.name} 님 상사 평가를 적었습니다${grade ? `(등급 ${grade})` : ''}.` };
  });
}

/* ── 본인 ── */
async function needMe(db: DatabaseService, actor: string | null) {
  const me = await myEmployee(db, actor);
  if (!me) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다 — SUPER 가 회계 › 인사 › 근태에서 직원과 계정을 연결해야 합니다.');
  return me;
}
/** 내 인사 — 최근 차례 4개 · 내 목표 · 내 결과(상사 칸은 닫은 뒤만) */
export async function myReviews(db: DatabaseService, employeeId: string) {
  const cs = await db.query<Cycle>(
    `SELECT id::text AS id, year, quarter, title, state, goal_due::text AS "goalDue", review_due::text AS "reviewDue" FROM hr_review_cycles ORDER BY year DESC, quarter DESC LIMIT 4`);
  const out: unknown[] = [];
  for (const c of cs) {
    const goals = await goalsOf(db, c.id, employeeId);
    const [r] = await resultsOf(db, c.id, employeeId);
    const closed = c.state === 'CLOSED';
    out.push({ cycle: c, goals: goals.map((g) => ({ ...g, mgrScore: closed ? g.mgrScore : null, mgrNote: closed ? g.mgrNote : null })),
               result: r ? { selfComment: r.selfComment, selfSubmittedAt: r.selfSubmittedAt, mgrComment: closed ? r.mgrComment : null, mgrAvg: closed ? r.mgrAvg : null, grade: closed ? r.grade : null } : null,
               selfAvg: weighted(goals.map((g) => ({ weight: g.weight, score: g.selfScore }))) });
  }
  return out;
}

/** PUT /admin/me/hr/reviews/{cycleId}/goals — 내 목표 통째로(GOALS 단계 · 1 ~ 10개 · 가중치 합 100) */
export async function setMyGoals(db: DatabaseService, actor: string | null, cycleId: string, goals: Array<{ title: string; measure?: string; weight: number }>) {
  const me = await needMe(db, actor);
  if (!Array.isArray(goals) || goals.length < 1 || goals.length > 10) throw new PolicyViolation('REVIEW_GOALS', '목표는 1 ~ 10개입니다.');
  const clean2 = goals.map((g) => ({ title: clean(g.title, 120), measure: clean(g.measure, 200), weight: g.weight }));
  if (clean2.some((g) => !g.title || g.title.length < 2)) throw new PolicyViolation('REVIEW_GOALS', '목표 이름은 2 ~ 120자입니다.');
  if (clean2.some((g) => !Number.isInteger(g.weight) || g.weight < 1 || g.weight > 100)) throw new PolicyViolation('REVIEW_GOALS', '가중치는 1 ~ 100 입니다.');
  const sum = clean2.reduce((a, g) => a + g.weight, 0);
  if (sum !== 100) throw new PolicyViolation('REVIEW_WEIGHT', `가중치 합이 100 이어야 합니다(지금 ${sum}).`);
  return db.transaction(async () => {
    const c = await cycleOf(db, cycleId, true);
    if (c.state !== 'GOALS') throw new StateConflict('REVIEW_STATE', '목표는 목표 단계에서만 적습니다.');
    await db.query(`DELETE FROM hr_review_goals WHERE cycle_id = $1::bigint AND employee_id = $2::bigint`, [c.id, me.id]);
    for (const g of clean2) {
      await db.query(`INSERT INTO hr_review_goals (cycle_id, employee_id, title, measure, weight) VALUES ($1::bigint, $2::bigint, $3, $4, $5::int)`, [c.id, me.id, g.title, g.measure, g.weight]);
    }
    return { ok: true, cycleId: c.id, count: clean2.length, note: `목표 ${clean2.length}개를 저장했습니다(가중치 합 100).` };
  });
}

/** POST /admin/me/hr/reviews/{cycleId}/self — 자기 평가(REVIEW 단계 · submit 이면 제출 · 제출 뒤 못 고침) */
export async function saveMySelf(db: DatabaseService, actor: string | null, cycleId: string, b: { scores?: Array<{ goalId: string; score: number; note?: string }>; comment?: string; submit?: boolean }) {
  const me = await needMe(db, actor);
  return db.transaction(async () => {
    const c = await cycleOf(db, cycleId, true);
    if (c.state !== 'REVIEW') throw new StateConflict('REVIEW_STATE', '자기 평가는 평가 단계에서만 적습니다.');
    const [r] = await resultsOf(db, c.id, me.id);
    if (r?.selfSubmittedAt) throw new StateConflict('REVIEW_SUBMITTED', '이미 제출한 자기 평가입니다.');
    const goals = await goalsOf(db, c.id, me.id);
    if (!goals.length) throw new PolicyViolation('REVIEW_GOALS', '이 차례에 적은 목표가 없습니다.');
    for (const s of b.scores ?? []) {
      if (!goals.some((g) => g.id === String(s.goalId))) throw new PolicyViolation('REVIEW_GOAL', '내 목표가 아닙니다.');
      if (!Number.isInteger(s.score) || s.score < 1 || s.score > 5) throw new PolicyViolation('REVIEW_SCORE', '점수는 1 ~ 5 입니다.');
      await db.query(`UPDATE hr_review_goals SET self_score = $2::smallint, self_note = $3 WHERE id = $1::bigint AND employee_id = $4::bigint`, [String(s.goalId), s.score, clean(s.note, 300), me.id]);
    }
    if (b.submit) {
      const left = (await goalsOf(db, c.id, me.id)).filter((g) => g.selfScore == null).length;
      if (left) throw new PolicyViolation('REVIEW_SCORE', `점수를 적지 않은 목표가 ${left}개 있습니다.`);
    }
    await db.query(
      `INSERT INTO hr_review_results (cycle_id, employee_id, self_comment, self_submitted_at) VALUES ($1::bigint, $2::bigint, $3, CASE WHEN $4::boolean THEN now() END)
       ON CONFLICT (cycle_id, employee_id) DO UPDATE SET self_comment = CASE WHEN $5::boolean THEN EXCLUDED.self_comment ELSE hr_review_results.self_comment END,
              self_submitted_at = EXCLUDED.self_submitted_at`,
      [c.id, me.id, clean(b.comment, 1000), b.submit === true, b.comment !== undefined]);
    return { ok: true, cycleId: c.id, submitted: b.submit === true, note: b.submit ? '자기 평가를 제출했습니다(이제 못 고침).' : '자기 평가를 저장했습니다(제출 전).' };
  });
}

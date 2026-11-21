import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { myEmployee, remaining } from './hr';
import { addDays, dayOk, hraSettings, kstToday, minusMonths, textOk } from './hra-common';

/* ---------------------------------------------------------------------
 * v10.581 (docs/723) 연차 사용 촉진 — 근로기준법 61조 · 일반 원칙(docs/555 「일반 원칙 값 적용」 · 노무 확인 권함)
 *   연차 사용 기간 = 달력 해(연차 대장 acct_leave_grants.year) — 끝 = 12/31
 *   1차 기간 = 끝나기 hra.leave_promo_first_months(6)개월 전 날부터 hra.leave_promo_reply_days(10)일(처음 값이면 7/1 ~ 7/10)
 *        남은 연차를 알리고(hra_leave_promos round 1) 직원이 알림 받은 날부터 10일 안에 쓸 날을 냄(PLANNED) · 안 내면 NO_PLAN
 *   2차 기한 = 끝나기 hra.leave_promo_second_months(2)개월 전 날(처음 값이면 10/31)까지 관리자가 쓸 날을 지정(round 2 · DESIGNATED)
 *   남은 연차는 hr.ts remaining(생김 − 씀) 그대로 · 낸 계획 · 지정한 날로 휴가를 저절로 넣지 않음(휴가 신청 → 승인이 그대로 연차를 뺌)
 *   1년 미만 직원(월 1일 연차 · 촉진 기준 3개월 · 1개월 전)은 대상 아님으로만 표시(노무 확인)
 *   관리자는 자기 직원 줄을 지정하지 않음(근태 · 휴가와 같은 규칙) · SQL 값은 모두 $n · 형을 못 박음(규칙 10)
 * ------------------------------------------------------------------- */

export const PROMO_STATE_KO: Record<string, string> = { ISSUED: '알림(계획 기다림)', PLANNED: '계획 냄', NO_PLAN: '계획 안 냄(2차 대상)', DESIGNATED: '쓸 날 지정함' };

export interface PromoWindow { year: number; end: string; firstStart: string; firstEnd: string; secondDue: string; replyDays: number }

/** 해의 촉진 기간 — 끝(12/31) · 1차 시작 · 1차 끝 · 2차 기한 */
export function promoWindow(year: number, s: { firstMonths: number; secondMonths: number; replyDays: number }): PromoWindow {
  const after = `${year + 1}-01-01`;
  const firstStart = minusMonths(after, s.firstMonths);
  return { year, end: `${year}-12-31`, firstStart, firstEnd: addDays(firstStart, s.replyDays - 1), secondDue: addDays(minusMonths(after, s.secondMonths), -1), replyDays: s.replyDays };
}

export interface EmpRow { id: string; name: string; joinedOn: string; leftOn: string | null; accountId: string | null }
export interface PromoRow { id: string; employeeId: string; year: number; round: number; unusedDays: number; issuedOn: string; replyDue: string; state: string;
  planDates: string[]; plannedAt: string | null; designatedDates: string[]; ackedAt: string | null; note: string | null; outOfWindow: boolean; createdAt: string }

const PROMO_SEL = `SELECT id::text AS id, employee_id::text AS "employeeId", year, round, unused_days::float8 AS "unusedDays", issued_on::text AS "issuedOn", reply_due::text AS "replyDue",
         state, plan_dates::text[] AS "planDates", planned_at AS "plannedAt", designated_dates::text[] AS "designatedDates", acked_at AS "ackedAt", note,
         out_of_window AS "outOfWindow", created_at AS "createdAt" FROM hra_leave_promos`;

const yearOk = (y: unknown) => {
  const n = Number(y);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new PolicyViolation('HRA_LEAVE_PROMO_YEAR', '해는 2000 ~ 2100 입니다.');
  return n;
};
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 연차 촉진 기록입니다.'); return String(id); };

/** 그 해 끝까지 재직 · 그 해 안에 입사한 직원 */
async function yearEmployees(db: DatabaseService, year: number) {
  return db.query<EmpRow>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", account_id::text AS "accountId"
       FROM acct_employees WHERE joined_on <= $1::date AND (left_on IS NULL OR left_on >= $2::date) ORDER BY joined_on, id`, [`${year}-12-31`, kstToday()]);
}
/** 1차 시작일에 1년 이상 일했나(월 1일 연차 대상은 기준이 달라 뺌) */
const oneYear = (joinedOn: string, firstStart: string) => joinedOn <= minusMonths(firstStart, 12);

/** 계획 · 지정 날짜 검사 — 고유 · 해 안 · 오늘 뒤 · 영업일 · 개수 */
async function checkDates(db: DatabaseService, raw: unknown, year: number, maxN: number, code: string) {
  const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '').trim()) : [];
  const uniq = [...new Set(list)].sort();
  if (!uniq.length || uniq.length !== list.length) throw new PolicyViolation(code, '날짜를 한 번씩 1개 이상 고르십시오.');
  if (uniq.length > Math.max(1, maxN)) throw new PolicyViolation(code, `남은 연차(${maxN}일)보다 많은 날을 고를 수 없습니다.`);
  const today = kstToday();
  for (const d of uniq) {
    if (!dayOk(d) || d.slice(0, 4) !== String(year)) throw new PolicyViolation(code, `그 해(${year}) 안의 날짜만 고릅니다: ${d}`);
    if (d <= today) throw new PolicyViolation(code, `오늘 뒤의 날짜만 고릅니다: ${d}`);
  }
  const [bad] = await db.query<{ d: string | null }>(
    `SELECT string_agg(x::text, ', ') AS d FROM unnest($1::date[]) x WHERE NOT fn_is_business_day(x)`, [uniq]);
  if (bad?.d) throw new PolicyViolation(code, `영업일이 아닌 날이 있습니다(주말 · 공휴일): ${bad.d}`);
  return uniq;
}

/** 기한 지난 1차(ISSUED) → NO_PLAN */
export async function markNoPlan(db: DatabaseService, today = kstToday()) {
  const r = await db.query(`UPDATE hra_leave_promos SET state = 'NO_PLAN' WHERE round = 1 AND state = 'ISSUED' AND reply_due < $1::date RETURNING id`, [today]);
  return r.length;
}

/** GET /admin/hr/leave-promo?year= — 직원마다 남은 연차 · 1차 · 2차 · 기간 · 설정 */
export async function leavePromoView(db: DatabaseService, yearIn?: string | number) {
  const today = kstToday();
  const year = yearIn === undefined || yearIn === '' ? Number(today.slice(0, 4)) : yearOk(yearIn);
  await markNoPlan(db, today);
  const s = await hraSettings(db);
  const w = promoWindow(year, s);
  const emps = await yearEmployees(db, year);
  const promos = await db.query<PromoRow>(`${PROMO_SEL} WHERE year = $1::int ORDER BY employee_id, round`, [year]);
  const rows = [];
  for (const e of emps) {
    const rem = await remaining(db, e.id, year);
    const r1 = promos.find((p) => p.employeeId === e.id && p.round === 1) ?? null;
    const r2 = promos.find((p) => p.employeeId === e.id && p.round === 2) ?? null;
    const eligible = oneYear(e.joinedOn, w.firstStart);
    const next = !eligible ? 'FIRST_YEAR' : !r1 ? (rem.remaining > 0 ? 'ISSUE' : 'NONE') : r1.state === 'NO_PLAN' && !r2 ? 'DESIGNATE' : r1.state === 'ISSUED' ? 'WAIT' : 'DONE';
    rows.push({ employeeId: e.id, name: e.name, joinedOn: e.joinedOn, linked: !!e.accountId, eligible, ...rem, round1: r1, round2: r2, next });
  }
  const phase = today < w.firstStart ? 'BEFORE' : today <= w.firstEnd ? 'FIRST' : today <= w.secondDue ? 'SECOND' : today <= w.end ? 'AFTER' : 'PAST';
  return {
    year, today, window: w, phase, settings: { on: s.leavePromo, firstMonths: s.firstMonths, secondMonths: s.secondMonths, replyDays: s.replyDays },
    rows, states: PROMO_STATE_KO,
    count: { eligible: rows.filter((r) => r.eligible).length, issued: rows.filter((r) => r.round1).length, toIssue: rows.filter((r) => r.next === 'ISSUE').length,
             toDesignate: rows.filter((r) => r.next === 'DESIGNATE').length, unlinked: rows.filter((r) => r.round1 && !r.linked).length },
    note: `연차 사용 기간은 달력 해(${w.year}-01-01 ~ ${w.end})입니다. 1차 ${w.firstStart} ~ ${w.firstEnd} 남은 연차 알림 → 직원 ${w.replyDays}일 안 계획 · 2차 ${w.secondDue}까지 쓸 날 지정(근로기준법 61조 일반 원칙 · 노무 확인 권함). 계정이 연결 안 된 직원은 서면(종이)으로 알리고 확인을 받으십시오.`,
  };
}

/** 1차 알림 만들기 — 관리자 「지금 만들기」 또는 정기 작업(actor null) · 이미 있으면 건너뜀 */
export async function issueRound1(db: DatabaseService, yearIn: number, actor: string | null, auto = false) {
  const year = yearOk(yearIn);
  const today = kstToday();
  const s = await hraSettings(db);
  const w = promoWindow(year, s);
  if (today > w.secondDue) throw new PolicyViolation('HRA_LEAVE_PROMO_LATE', `2차 기한(${w.secondDue})이 지나 1차 알림을 만들 수 없습니다.`);
  if (today < `${year}-01-01`) throw new PolicyViolation('HRA_LEAVE_PROMO_YEAR', '아직 오지 않은 해입니다.');
  const out = today < w.firstStart || today > w.firstEnd;
  const emps = await yearEmployees(db, year);
  const made: string[] = [], skipped: Array<{ employeeId: string; why: string }> = [];
  for (const e of emps) {
    if (!oneYear(e.joinedOn, w.firstStart)) { skipped.push({ employeeId: e.id, why: 'FIRST_YEAR' }); continue; }
    const rem = await remaining(db, e.id, year);
    if (rem.remaining <= 0) { skipped.push({ employeeId: e.id, why: 'NO_LEFT' }); continue; }
    const r = await db.query<{ id: string }>(
      `INSERT INTO hra_leave_promos (employee_id, year, round, unused_days, issued_on, reply_due, out_of_window, note, created_by)
       VALUES ($1::bigint, $2::int, 1, $3::numeric, $4::date, $5::date, $6::boolean, $7, $8::uuid)
       ON CONFLICT (employee_id, year, round) DO NOTHING RETURNING id::text AS id`,
      [e.id, year, rem.remaining, today, addDays(today, s.replyDays), out, auto ? '정기 작업(hra_daily)' : null, actor]);
    if (r.length) made.push(r[0]!.id); else skipped.push({ employeeId: e.id, why: 'EXISTS' });
  }
  return { ok: true, year, made: made.length, ids: made, skipped, outOfWindow: out, window: w,
           note: `1차 연차 사용 촉진 ${made.length}명을 만들었습니다(계획 기한 ${addDays(today, s.replyDays)}).`,
           warning: out ? `1차 기간(${w.firstStart} ~ ${w.firstEnd}) 밖이라 법이 정한 촉진으로 인정되지 않을 수 있습니다(노무 확인).` : null };
}

/** POST /admin/hr/leave-promo/{id}/designate — 2차: 계획을 안 낸 직원의 쓸 날 지정(관리자 · 본인 직원 아님) */
export async function designate(db: DatabaseService, idIn: string, datesIn: unknown, noteIn: string | undefined, actor: string | null) {
  const id = idOk(idIn);
  await markNoPlan(db);
  return db.transaction(async () => {
    const [p] = await db.query<PromoRow & { accountId: string | null; name: string }>(
      `SELECT p.id::text AS id, p.employee_id::text AS "employeeId", p.year, p.round, p.unused_days::float8 AS "unusedDays", p.state, e.account_id::text AS "accountId", e.name
         FROM hra_leave_promos p JOIN acct_employees e ON e.id = p.employee_id WHERE p.id = $1::bigint FOR UPDATE OF p`, [id]);
    if (!p || p.round !== 1) throw new NotFound('없는 1차 연차 촉진 기록입니다.');
    if (actor && p.accountId === actor) throw new Forbidden('HR_SELF', '본인 연차 촉진은 다른 관리자가 처리합니다.');
    if (p.state !== 'NO_PLAN') throw new StateConflict('HRA_LEAVE_PROMO_STATE', p.state === 'PLANNED' ? '직원이 계획을 냈습니다 — 2차 지정이 필요 없습니다.' : '계획 기한이 지나야(계획 안 냄) 2차로 지정합니다.');
    const [dup] = await db.query(`SELECT 1 FROM hra_leave_promos WHERE employee_id = $1::bigint AND year = $2::int AND round = 2`, [p.employeeId, p.year]);
    if (dup) throw new StateConflict('HRA_LEAVE_PROMO_DONE', '이미 2차로 쓸 날을 지정했습니다.');
    const rem = await remaining(db, p.employeeId, p.year);
    if (rem.remaining <= 0) throw new PolicyViolation('HRA_LEAVE_PROMO_NONE', '남은 연차가 없습니다 — 지정할 날이 없습니다.');
    const dates = await checkDates(db, datesIn, p.year, Math.ceil(rem.remaining), 'HRA_LEAVE_PROMO_DATES');
    const s = await hraSettings(db);
    const w = promoWindow(p.year, s);
    const today = kstToday();
    const out = today > w.secondDue;
    const note = textOk(noteIn, 0, 200) || null;
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO hra_leave_promos (employee_id, year, round, unused_days, issued_on, reply_due, state, designated_dates, out_of_window, note, created_by)
       VALUES ($1::bigint, $2::int, 2, $3::numeric, $4::date, $4::date, 'DESIGNATED', $5::date[], $6::boolean, $7, $8::uuid) RETURNING id::text AS id`,
      [p.employeeId, p.year, rem.remaining, today, dates, out, note, actor]);
    return { ok: true, id: r!.id, employeeId: p.employeeId, dates, outOfWindow: out,
             note: `${p.name} 님의 쓸 날 ${dates.length}일을 지정해 알렸습니다.`,
             warning: out ? `2차 기한(${w.secondDue})이 지나 법이 정한 촉진으로 인정되지 않을 수 있습니다(노무 확인).` : null };
  });
}

/* ── 본인(내 인사) ── */
/** GET /admin/me/hr/leave-promo — 올해 · 지난해 내 촉진 알림 */
export async function myLeavePromos(db: DatabaseService, actor: string | null) {
  const me = await myEmployee(db, actor);
  if (!me) return { linked: false, items: [], note: '이 계정에 연결된 직원이 없습니다.' };
  await markNoPlan(db);
  const y = Number(kstToday().slice(0, 4));
  const items = await db.query<PromoRow>(`${PROMO_SEL} WHERE employee_id = $1::bigint AND year IN ($2::int, $3::int) ORDER BY year DESC, round DESC`, [me.id, y, y - 1]);
  const rem = await remaining(db, me.id, y);
  return { linked: true, employee: { id: me.id, name: me.name }, leave: rem, items: items.map((x) => ({ ...x, stateKo: PROMO_STATE_KO[x.state] ?? x.state })),
           pending: items.filter((x) => !x.ackedAt || (x.round === 1 && x.state === 'ISSUED')).length,
           note: '회사가 남은 연차 사용을 알려 드립니다(근로기준법 61조). 1차 알림을 받으면 기한 안에 쓸 날을 적어 내 주십시오 — 내지 않으면 회사가 쓸 날을 지정합니다. 실제 휴가는 「휴가 신청」으로 합니다.' };
}

async function mine(db: DatabaseService, actor: string | null, idIn: string) {
  const me = await myEmployee(db, actor);
  if (!me) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다.');
  const [p] = await db.query<PromoRow>(`${PROMO_SEL} WHERE id = $1::bigint AND employee_id = $2::bigint`, [idOk(idIn), me.id]);
  if (!p) throw new NotFound('없는 연차 촉진 기록입니다.');
  return p;
}

/** POST /admin/me/hr/leave-promo/{id}/plan — 1차 계획 내기(기한 안 · 한 번) */
export async function submitPlan(db: DatabaseService, actor: string | null, idIn: string, datesIn: unknown) {
  await markNoPlan(db);
  const p = await mine(db, actor, idIn);
  if (p.round !== 1) throw new StateConflict('HRA_LEAVE_PROMO_STATE', '계획은 1차 알림에만 냅니다.');
  if (p.state !== 'ISSUED') throw new StateConflict('HRA_LEAVE_PROMO_STATE', p.state === 'PLANNED' ? '이미 계획을 냈습니다.' : '계획 기한이 지났습니다 — 회사가 쓸 날을 지정합니다.');
  const dates = await checkDates(db, datesIn, p.year, Math.ceil(p.unusedDays), 'HRA_LEAVE_PROMO_DATES');
  const r = await db.query(
    `UPDATE hra_leave_promos SET state = 'PLANNED', plan_dates = $2::date[], planned_at = now(), acked_at = coalesce(acked_at, now())
      WHERE id = $1::bigint AND state = 'ISSUED' RETURNING id`, [p.id, dates]);
  if (!r.length) throw new StateConflict('HRA_LEAVE_PROMO_STATE', '이미 처리된 알림입니다.');
  return { ok: true, id: p.id, dates, note: `쓸 날 ${dates.length}일을 냈습니다 — 그날 휴가는 「휴가 신청」으로 신청하십시오.` };
}

/** POST /admin/me/hr/leave-promo/{id}/ack — 받았다는 확인(한 번) */
export async function ackPromo(db: DatabaseService, actor: string | null, idIn: string) {
  const p = await mine(db, actor, idIn);
  if (p.ackedAt) return { ok: true, id: p.id, already: true, note: '이미 확인했습니다.' };
  await db.query(`UPDATE hra_leave_promos SET acked_at = now() WHERE id = $1::bigint AND acked_at IS NULL`, [p.id]);
  return { ok: true, id: p.id, already: false, note: '확인했습니다.' };
}

/* ── 정기 작업(hra_daily 안) ── */
export async function leavePromoJob(db: DatabaseService, today = kstToday()) {
  const noPlan = await markNoPlan(db, today);
  const s = await hraSettings(db);
  if (!s.leavePromo) return { on: false, noPlan, made: 0, alerts: 0, resolved: 0 };
  const year = Number(today.slice(0, 4));
  const w = promoWindow(year, s);
  let made = 0, alerts = 0;
  if (today >= w.firstStart && today <= w.firstEnd) {
    const r = await issueRound1(db, year, null, true);
    made = r.made;
    if (made) {
      const a = await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'HRA_LEAVE_PROMO', 'INFO', $1, $2::jsonb, clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'HRA_LEAVE_PROMO' AND detail->>'key' = $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [`${year}년 연차 사용 촉진 1차 알림 ${made}명을 만들었습니다 — 계정 연결이 없는 직원은 서면으로 알리십시오(회계 › 인사 › 연차 사용 촉진)`,
         JSON.stringify({ key: `R1:${year}`, year, made }), `R1:${year}`]);
      alerts += a.length;
    }
  }
  const [todo] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM hra_leave_promos p WHERE p.year = $1::int AND p.round = 1 AND p.state = 'NO_PLAN'
        AND NOT EXISTS (SELECT 1 FROM hra_leave_promos q WHERE q.employee_id = p.employee_id AND q.year = p.year AND q.round = 2)`, [year]);
  const n = Number(todo?.n ?? 0);
  if (n > 0 && today <= w.secondDue) {
    const a = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'HRA_LEAVE_PROMO', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'HRA_LEAVE_PROMO' AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`${year}년 연차 촉진 2차 — 계획을 안 낸 직원 ${n}명의 쓸 날을 ${w.secondDue}까지 지정하십시오(회계 › 인사 › 연차 사용 촉진)`,
       JSON.stringify({ key: `R2:${year}`, year, due: w.secondDue }), `R2:${year}`]);
    alerts += a.length;
  }
  const res = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '2차 지정 끝 · 기한 지남'
      WHERE alert_code = 'HRA_LEAVE_PROMO' AND resolved_at IS NULL AND detail->>'key' = $1 AND ($2::int = 0 OR $3::date > ($4::date)) RETURNING id`,
    [`R2:${year}`, n, today, w.secondDue]);
  return { on: true, noPlan, made, alerts, resolved: res.length, window: w };
}

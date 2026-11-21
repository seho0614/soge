import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * ㉖ 인사 2 (D259 · docs/582 · 583) — 대표 11/20 「다음개발」
 *   v10.445 근태 — 직원(⑭ acct_employees)을 운영 계정에 연결(SUPER) → 본인이 운영 화면 › 사무 › 내 인사에서 「출근」 · 「퇴근」
 *           하루 한 줄(acct_attendance) · 관리자(ADMIN · 본인 줄 아님)가 시각 고침(사유 · 고침 기록) · 달 확인(확인 뒤 못 고침)
 *           달 집계 = 일한 날 · 일한 시간 · 늦음(설정 hr.work_start 뒤 출근) · 퇴근 안 누름 · 휴가 일수
 *   v10.446 휴가 신청 → 승인 — 본인 신청(종일 · 오전 반차 · 오후 반차) · 영업일만 셈(fn_is_business_day)
 *           관리자 승인(본인 신청은 승인 못 함) → ⑮ 연차 쓴 날(acct_leave_uses)에 날마다 한 줄(note LR-번호)
 *           남은 연차보다 많으면 승인 막음(hr.leave_allow_negative 처음 off) · 승인 취소는 음수 줄
 *   SQL 값은 모두 $n · 자리값 하나를 두 형에 함께 쓰지 않음(점검 2 교훈) · DTO 빈 칸은 걸러서 씀(점검 3 교훈).
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const mask = (e: string) => { const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`; };

export interface Emp { id: string; name: string; joinedOn: string; leftOn: string | null; accountId: string | null }

/** 운영 계정에 연결된 직원(퇴사 전) — 없으면 null */
export async function myEmployee(db: DatabaseService, actor: string | null): Promise<Emp | null> {
  if (!actor) return null;
  const [e] = await db.query<Emp>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", account_id::text AS "accountId"
       FROM acct_employees WHERE account_id = $1::uuid AND (left_on IS NULL OR left_on >= $2::date)`, [actor, kstToday()]);
  return e ?? null;
}
async function needMe(db: DatabaseService, actor: string | null) {
  const e = await myEmployee(db, actor);
  if (!e) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다 — SUPER 가 회계 › 인사 › 근태에서 직원과 계정을 연결해야 합니다.');
  return e;
}
async function empById(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('직원이 없습니다.');
  const [e] = await db.query<Emp>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", account_id::text AS "accountId" FROM acct_employees WHERE id = $1::bigint`, [id]);
  if (!e) throw new NotFound('직원이 없습니다.');
  return e;
}
/** 관리자가 자기 자신의 근태 · 휴가를 처리하지 못하게 */
const notSelf = (e: Emp, actor: string | null) => {
  if (actor && e.accountId === actor) throw new Forbidden('HR_SELF', '본인 근태 · 휴가는 다른 관리자가 처리합니다.');
};

/* ── 직원 ↔ 운영 계정 연결 (SUPER) ── */
export async function linkAccount(db: DatabaseService, employeeId: string, email: string | null | undefined) {
  const e = await empById(db, employeeId);
  const em = (email ?? '').trim().toLowerCase();
  if (!em) {
    await db.query(`UPDATE acct_employees SET account_id = NULL WHERE id = $1::bigint`, [e.id]);
    return { ok: true, employeeId: e.id, accountId: null, note: `${e.name} 님의 계정 연결을 풀었습니다.` };
  }
  const [a] = await db.query<{ id: string; staff: boolean }>(
    `SELECT a.id::text AS id, EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF')) AS staff
       FROM accounts a WHERE lower(a.email) = $1`, [em]);
  if (!a) throw new NotFound('그 메일의 계정이 없습니다.');
  if (!a.staff) throw new PolicyViolation('HR_LINK', '운영 역할이 있는 계정만 직원과 연결합니다(세무사 · 회원 계정은 안 됨).');
  const [other] = await db.query<{ id: string; name: string }>(`SELECT id::text AS id, name FROM acct_employees WHERE account_id = $1::uuid AND id <> $2::bigint`, [a.id, e.id]);
  if (other) throw new StateConflict('HR_LINK_TAKEN', `이 계정은 이미 ${other.name} 님과 연결돼 있습니다.`);
  await db.query(`UPDATE acct_employees SET account_id = $2::uuid WHERE id = $1::bigint`, [e.id, a.id]);
  return { ok: true, employeeId: e.id, accountId: a.id, email: mask(em), note: `${e.name} 님을 ${mask(em)} 계정과 연결했습니다.` };
}

/* ── v10.445 근태 ── */
async function workStart(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hr.work_start'`);
  return r?.v && HM.test(r.v) ? r.v : '09:00';
}

/** POST /admin/me/hr/clock — 본인 출근 · 퇴근 */
export async function clock(db: DatabaseService, actor: string | null, kind: string, memo?: string) {
  const me = await needMe(db, actor);
  const note = (memo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if (kind === 'IN') {
    const r = await db.query<{ id: string }>(
      `INSERT INTO acct_attendance (employee_id, work_on, in_at, memo) VALUES ($1::bigint, $2::date, now(), $3)
       ON CONFLICT (employee_id, work_on) DO NOTHING RETURNING id::text AS id`, [me.id, kstToday(), note]);
    if (!r.length) throw new StateConflict('ATTEND_DONE', '오늘 출근은 이미 눌렀습니다.');
    return { ok: true, id: r[0]!.id, kind, note: '출근을 적었습니다.' };
  }
  if (kind !== 'OUT') throw new PolicyViolation('ATTEND_KIND', '출근(IN) · 퇴근(OUT) 중 하나입니다.');
  /* 밤샘도 되게 — 24시간 안 가장 최근의 퇴근 안 누른 줄 */
  const r = await db.query<{ id: string; minutes: number }>(
    `UPDATE acct_attendance SET out_at = now(), memo = coalesce($2, memo)
      WHERE id = (SELECT id FROM acct_attendance WHERE employee_id = $1::bigint AND out_at IS NULL AND in_at > now() - interval '24 hours' ORDER BY work_on DESC LIMIT 1)
      RETURNING id::text AS id, floor(extract(epoch FROM out_at - in_at) / 60)::int AS minutes`, [me.id, note]);
  if (!r.length) {
    const [today] = await db.query(`SELECT 1 FROM acct_attendance WHERE employee_id = $1::bigint AND work_on = $2::date`, [me.id, kstToday()]);
    if (today) throw new StateConflict('ATTEND_DONE', '오늘 퇴근은 이미 눌렀습니다.');
    throw new PolicyViolation('ATTEND_NO_IN', '출근 기록이 없습니다 — 관리자에게 고침을 부탁하십시오.');
  }
  return { ok: true, id: r[0]!.id, kind, minutes: r[0]!.minutes, note: `퇴근을 적었습니다(${Math.floor(r[0]!.minutes / 60)}시간 ${r[0]!.minutes % 60}분).` };
}

export interface AttRow { id: string; employeeId: string; name: string; workOn: string; inAt: string; outAt: string | null; inHm: string; outHm: string | null;
  minutes: number | null; late: boolean; fixed: boolean; confirmed: boolean; memo: string | null }

async function attRows(db: DatabaseService, ym: string, employeeId?: string) {
  const ws = await workStart(db);
  const rows = await db.query<AttRow>(
    `SELECT a.id::text AS id, a.employee_id::text AS "employeeId", e.name, a.work_on::text AS "workOn", a.in_at AS "inAt", a.out_at AS "outAt",
            to_char(a.in_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS "inHm", to_char(a.out_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS "outHm",
            CASE WHEN a.out_at IS NULL THEN NULL ELSE floor(extract(epoch FROM a.out_at - a.in_at) / 60)::int END AS minutes,
            (to_char(a.in_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') > $2) AS late, a.fixed, (a.confirmed_at IS NOT NULL) AS confirmed, a.memo
       FROM acct_attendance a JOIN acct_employees e ON e.id = a.employee_id
      WHERE to_char(a.work_on, 'YYYY-MM') = $1 AND ($3::text = '' OR a.employee_id::text = $3)
      ORDER BY a.work_on, e.name`, [ym, ws, employeeId ?? '']);
  return { ws, rows };
}

async function leaveDaysByEmp(db: DatabaseService, ym: string) {
  const r = await db.query<{ emp: string; d: string }>(
    `SELECT employee_id::text AS emp, sum(days)::text AS d FROM acct_leave_uses WHERE to_char(used_on, 'YYYY-MM') = $1 GROUP BY employee_id`, [ym]);
  return new Map(r.map((x) => [x.emp, Number(x.d)]));
}

function summarize(rows: AttRow[], leave: Map<string, number>, emps: Array<{ id: string; name: string }>) {
  return emps.map((e) => {
    const mine = rows.filter((r) => r.employeeId === e.id);
    const minutes = mine.reduce((a, r) => a + (r.minutes ?? 0), 0);
    return { employeeId: e.id, name: e.name, days: mine.length, minutes, hours: Math.round(minutes / 6) / 10, late: mine.filter((r) => r.late).length,
             open: mine.filter((r) => !r.outAt).length, confirmed: mine.filter((r) => r.confirmed).length, leaveDays: leave.get(e.id) ?? 0 };
  });
}

/** GET /admin/hr/attendance?ym= — 달 근태(관리자) */
export async function attendanceMonth(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && YM.test(ymIn) ? ymIn : kstToday().slice(0, 7);
  const { ws, rows } = await attRows(db, ym);
  const emps = await db.query<{ id: string; name: string; accountId: string | null; email: string | null }>(
    `SELECT e.id::text AS id, e.name, e.account_id::text AS "accountId", a.email
       FROM acct_employees e LEFT JOIN accounts a ON a.id = e.account_id
      WHERE e.joined_on <= ($1 || '-01')::date + interval '1 month' - interval '1 day' AND (e.left_on IS NULL OR e.left_on >= ($1 || '-01')::date)
      ORDER BY e.joined_on, e.id`, [ym]);
  const leave = await leaveDaysByEmp(db, ym);
  const fixes = await db.query(
    `SELECT f.id::text AS id, f.attendance_id::text AS "attendanceId", e.name, a.work_on::text AS "workOn",
            to_char(f.before_in AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS "beforeIn", to_char(f.before_out AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS "beforeOut",
            to_char(f.after_in AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS "afterIn", to_char(f.after_out AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS "afterOut",
            f.reason, f.created_at AS "createdAt"
       FROM acct_attendance_fixes f JOIN acct_attendance a ON a.id = f.attendance_id JOIN acct_employees e ON e.id = a.employee_id
      WHERE to_char(a.work_on, 'YYYY-MM') = $1 ORDER BY f.id DESC LIMIT 50`, [ym]);
  return { ym, workStart: ws, rows, summary: summarize(rows, leave, emps), employees: emps.map((e) => ({ ...e, email: e.email ? mask(e.email) : null })), fixes,
           note: `출근 기준 ${ws}(설정 hr.work_start) 뒤면 「늦음」입니다. 확인한 날은 고치지 않습니다 — 고침은 확인 전에 사유와 함께 합니다.` };
}

/** 'HH:MM' + 날짜 → 한국 시각 timestamptz 글자 */
const kstTs = (day: string, hm: string) => `${day} ${hm}:00+09`;

/** POST /admin/hr/attendance/{id}/fix — 시각 고침(관리자 · 본인 줄 아님 · 사유 · 고침 기록) */
export async function fixAttendance(db: DatabaseService, id: string, b: { inAt: string; outAt?: string | null; reason: string }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 근태입니다.');
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ATTEND_REASON', '사유는 2 ~ 200자입니다.');
  if (!HM.test(b.inAt ?? '') || (b.outAt && !HM.test(b.outAt))) throw new PolicyViolation('ATTEND_TIME', '시각은 HH:MM(한국 시각)입니다.');
  return db.transaction(async () => {
    const [a] = await db.query<{ id: string; employee_id: string; work_on: string; in_at: string; out_at: string | null; confirmed: boolean }>(
      `SELECT id::text AS id, employee_id::text AS employee_id, work_on::text AS work_on, in_at, out_at, (confirmed_at IS NOT NULL) AS confirmed
         FROM acct_attendance WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!a) throw new NotFound('없는 근태입니다.');
    if (a.confirmed) throw new StateConflict('ATTEND_CONFIRMED', '확인한 근태는 고치지 않습니다.');
    notSelf(await empById(db, a.employee_id), actor);
    const inTs = kstTs(a.work_on, b.inAt);
    const outTs = b.outAt ? kstTs(b.outAt < b.inAt ? addDays(a.work_on, 1) : a.work_on, b.outAt) : null;
    await db.query(`SELECT set_config('sgb.attend_fix', 'on', true)`);
    await db.query(
      `INSERT INTO acct_attendance_fixes (attendance_id, before_in, before_out, after_in, after_out, reason, created_by)
       VALUES ($1::bigint, $2::timestamptz, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6, $7::uuid)`, [a.id, a.in_at, a.out_at, inTs, outTs, reason, actor]);
    await db.query(`UPDATE acct_attendance SET in_at = $2::timestamptz, out_at = $3::timestamptz WHERE id = $1::bigint`, [a.id, inTs, outTs]);
    return { ok: true, id: a.id, note: `${a.work_on} 근태를 고쳤습니다(고침 기록에 남음).` };
  });
}

/** POST /admin/hr/attendance/add — 빠진 날 넣기(관리자 · 본인 아님 · 사유) */
export async function addAttendance(db: DatabaseService, b: { employeeId: string; workOn: string; inAt: string; outAt?: string | null; reason: string }, actor: string | null) {
  const e = await empById(db, b.employeeId);
  notSelf(e, actor);
  if (!dayOk(b.workOn) || b.workOn > kstToday()) throw new PolicyViolation('ATTEND_DATE', '날짜가 바르지 않습니다(오늘까지).');
  if (b.workOn < e.joinedOn || (e.leftOn && b.workOn > e.leftOn)) throw new PolicyViolation('ATTEND_DATE', '입사일 ~ 퇴사일 안의 날짜만 넣습니다.');
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ATTEND_REASON', '사유는 2 ~ 200자입니다.');
  if (!HM.test(b.inAt ?? '') || (b.outAt && !HM.test(b.outAt))) throw new PolicyViolation('ATTEND_TIME', '시각은 HH:MM(한국 시각)입니다.');
  const inTs = kstTs(b.workOn, b.inAt);
  const outTs = b.outAt ? kstTs(b.outAt < b.inAt ? addDays(b.workOn, 1) : b.workOn, b.outAt) : null;
  return db.transaction(async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO acct_attendance (employee_id, work_on, in_at, out_at, fixed) VALUES ($1::bigint, $2::date, $3::timestamptz, $4::timestamptz, true)
       ON CONFLICT (employee_id, work_on) DO NOTHING RETURNING id::text AS id`, [e.id, b.workOn, inTs, outTs]);
    if (!r.length) throw new StateConflict('ATTEND_DONE', '그날 근태가 이미 있습니다 — 고침으로 바꾸십시오.');
    await db.query(
      `INSERT INTO acct_attendance_fixes (attendance_id, before_in, before_out, after_in, after_out, reason, created_by)
       VALUES ($1::bigint, NULL, NULL, $2::timestamptz, $3::timestamptz, $4, $5::uuid)`, [r[0]!.id, inTs, outTs, reason, actor]);
    return { ok: true, id: r[0]!.id, note: `${e.name} 님 ${b.workOn} 근태를 넣었습니다.` };
  });
}

/** POST /admin/hr/attendance/confirm — 달 확인(퇴근까지 있는 줄만 · 관리자 본인 줄은 빼고) */
export async function confirmMonth(db: DatabaseService, ym: string, employeeId: string | undefined, actor: string | null) {
  if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const r = await db.query<{ n: number }>(
    `WITH x AS (UPDATE acct_attendance a SET confirmed_by = $3::uuid, confirmed_at = now()
                 WHERE to_char(a.work_on, 'YYYY-MM') = $1 AND a.confirmed_at IS NULL AND a.out_at IS NOT NULL
                   AND ($2::text = '' OR a.employee_id::text = $2)
                   AND NOT EXISTS (SELECT 1 FROM acct_employees e WHERE e.id = a.employee_id AND e.account_id = $3::uuid)
                 RETURNING 1)
     SELECT count(*)::int AS n FROM x`, [ym, employeeId ?? '', actor]);
  const [open] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM acct_attendance WHERE to_char(work_on, 'YYYY-MM') = $1 AND confirmed_at IS NULL AND ($2::text = '' OR employee_id::text = $2)`, [ym, employeeId ?? '']);
  return { ok: true, ym, confirmed: r[0]?.n ?? 0, left: open?.n ?? 0,
           note: `${ym} 근태 ${r[0]?.n ?? 0}줄을 확인했습니다 — 남은 줄 ${open?.n ?? 0}(퇴근 없음 · 본인 줄).` };
}

/* ── v10.446 휴가 신청 → 승인 ── */
async function bizDays(db: DatabaseService, from: string, to: string) {
  const r = await db.query<{ d: string }>(
    `SELECT d::date::text AS d FROM generate_series($1::date, $2::date, interval '1 day') d WHERE fn_is_business_day(d::date) ORDER BY d`, [from, to]);
  return r.map((x) => x.d);
}
export async function remaining(db: DatabaseService, employeeId: string, year: number) {   // v10.581 (docs/723) 연차 촉진도 씀
  const [g] = await db.query<{ d: string }>(`SELECT coalesce(sum(days), 0)::text AS d FROM acct_leave_grants WHERE employee_id = $1::bigint AND year = $2::int`, [employeeId, year]);
  const [u] = await db.query<{ d: string }>(
    `SELECT coalesce(sum(days), 0)::text AS d FROM acct_leave_uses WHERE employee_id = $1::bigint AND used_on BETWEEN $2::date AND $3::date`, [employeeId, `${year}-01-01`, `${year}-12-31`]);
  const granted = Number(g?.d ?? 0), used = Number(u?.d ?? 0);
  return { granted, used, remaining: Math.round((granted - used) * 10) / 10 };
}

/** POST /admin/me/hr/leave — 본인 신청 */
export async function requestLeave(db: DatabaseService, actor: string | null, b: { startOn: string; endOn?: string; half?: string; note?: string }) {
  const me = await needMe(db, actor);
  const half = b.half && ['FULL', 'AM', 'PM'].includes(b.half) ? b.half : 'FULL';
  const start = b.startOn, end = half === 'FULL' ? (b.endOn || b.startOn) : b.startOn;
  if (!dayOk(start) || !dayOk(end) || end < start) throw new PolicyViolation('LEAVE_DATE', '날짜가 바르지 않습니다(시작 ≤ 끝).');
  if (start.slice(0, 4) !== end.slice(0, 4)) throw new PolicyViolation('LEAVE_YEAR', '해를 넘는 휴가는 해마다 나눠 신청합니다.');
  if (Date.parse(end) - Date.parse(start) > 40 * 86400e3) throw new PolicyViolation('LEAVE_DATE', '한 번에 40일까지 신청합니다.');
  if (start < addDays(kstToday(), -30)) throw new PolicyViolation('LEAVE_DATE', '30일 넘게 지난 날은 신청하지 않습니다 — 관리자에게 부탁하십시오.');
  const days = await bizDays(db, start, end);
  if (!days.length) throw new PolicyViolation('LEAVE_NO_DAYS', '영업일이 없습니다(주말 · 공휴일만).');
  const n = half === 'FULL' ? days.length : 0.5;
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_leave_req:' || $1::text))`, [me.id]);
    const [over] = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM acct_leave_requests WHERE employee_id = $1::bigint AND state IN ('REQUESTED', 'APPROVED') AND start_on <= $3::date AND end_on >= $2::date
          AND NOT (half <> 'FULL' AND $4::text <> 'FULL' AND half <> $4::text) LIMIT 1`, [me.id, start, end, half]);
    if (over) throw new StateConflict('LEAVE_OVERLAP', `겹치는 휴가 신청이 있습니다(${over.id}번).`);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_leave_requests (employee_id, start_on, end_on, half, days, note, created_by) VALUES ($1::bigint, $2::date, $3::date, $4, $5::numeric, $6, $7::uuid) RETURNING id::text AS id`,
      [me.id, start, end, half, n, note, actor]);
    const rem = await remaining(db, me.id, Number(start.slice(0, 4)));
    return { ok: true, id: r!.id, days: n, remaining: rem.remaining, note: `휴가 ${n}일을 신청했습니다.`,
             warning: rem.remaining < n ? `남은 연차(${rem.remaining}일)보다 많아 승인되지 않을 수 있습니다.` : null };
  });
}

/** POST /admin/me/hr/leave/{id}/cancel — 본인 · 승인 전만 */
export async function cancelMyLeave(db: DatabaseService, actor: string | null, id: string) {
  const me = await needMe(db, actor);
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  const r = await db.query<{ id: string }>(
    `UPDATE acct_leave_requests SET state = 'CANCELED', decided_at = now(), decide_note = '본인 취소'
      WHERE id = $1::bigint AND employee_id = $2::bigint AND state = 'REQUESTED' RETURNING id::text AS id`, [id, me.id]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM acct_leave_requests WHERE id = $1::bigint AND employee_id = $2::bigint`, [id, me.id]);
    if (!x) throw new NotFound('없는 신청입니다.');
    throw new StateConflict('LEAVE_STATE', '승인 전 신청만 본인이 취소합니다 — 승인된 휴가는 관리자에게 취소를 부탁하십시오.');
  }
  return { ok: true, id, note: '휴가 신청을 취소했습니다.' };
}

/** GET /admin/hr/leave?state= — 관리자 목록 */
export async function leaveRequests(db: DatabaseService, state?: string) {
  const st = state && ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'].includes(state) ? state : '';
  const items = await db.query<{ id: string; employeeId: string; name: string; startOn: string; endOn: string; half: string; days: number; state: string }>(
    `SELECT r.id::text AS id, r.employee_id::text AS "employeeId", e.name, r.start_on::text AS "startOn", r.end_on::text AS "endOn", r.half, r.days::float AS days,
            r.note, r.state, r.decide_note AS "decideNote", r.decided_at AS "decidedAt", d.email AS "decidedBy", r.created_at AS "createdAt"
       FROM acct_leave_requests r JOIN acct_employees e ON e.id = r.employee_id LEFT JOIN accounts d ON d.id = r.decided_by
      WHERE ($1::text = '' OR r.state = $1) ORDER BY (r.state = 'REQUESTED') DESC, r.start_on DESC, r.id DESC LIMIT 300`, [st]);
  const rem = new Map<string, number>();
  for (const x of items) {
    const k = `${x.employeeId}:${x.startOn.slice(0, 4)}`;
    if (!rem.has(k)) rem.set(k, (await remaining(db, x.employeeId, Number(x.startOn.slice(0, 4)))).remaining);
  }
  const [allow] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hr.leave_allow_negative'`);
  return { state: st || null, items: items.map((x) => ({ ...x, remaining: rem.get(`${x.employeeId}:${x.startOn.slice(0, 4)}`) ?? 0 })),
           pending: items.filter((x) => x.state === 'REQUESTED').length, allowNegative: allow?.v === 'on',
           note: '승인하면 연차 쓴 날(회계 › 인사 › 퇴직금 · 연차)에 날마다 한 줄이 들어갑니다. 본인 신청은 다른 관리자가 승인합니다.' };
}

/** POST /admin/hr/leave/{id}/decide — 승인 · 반려(관리자 · 본인 아님) */
export async function decideLeave(db: DatabaseService, id: string, decision: string, noteIn: string | undefined, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  if (!['APPROVE', 'REJECT'].includes(decision)) throw new PolicyViolation('LEAVE_DECISION', '승인(APPROVE) · 반려(REJECT) 중 하나입니다.');
  const note = (noteIn ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if (decision === 'REJECT' && (!note || note.length < 2)) throw new PolicyViolation('LEAVE_REASON', '반려는 사유를 2자 이상 적습니다.');
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string; employee_id: string; start_on: string; end_on: string; half: string; days: string; state: string }>(
      `SELECT id::text AS id, employee_id::text AS employee_id, start_on::text AS start_on, end_on::text AS end_on, half, days::text AS days, state
         FROM acct_leave_requests WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!r) throw new NotFound('없는 신청입니다.');
    if (r.state !== 'REQUESTED') throw new StateConflict('LEAVE_STATE', '승인 · 반려는 신청 상태에서만 합니다.');
    const e = await empById(db, r.employee_id);
    notSelf(e, actor);
    if (decision === 'REJECT') {
      await db.query(`UPDATE acct_leave_requests SET state = 'REJECTED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, note]);
      return { ok: true, id, state: 'REJECTED', note: `${e.name} 님 휴가 신청을 반려했습니다.` };
    }
    const n = Number(r.days);
    const rem = await remaining(db, r.employee_id, Number(r.start_on.slice(0, 4)));
    const [allow] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hr.leave_allow_negative'`);
    if (rem.remaining < n && allow?.v !== 'on') {
      throw new PolicyViolation('LEAVE_SHORT', `남은 연차(${rem.remaining}일)보다 많습니다 — 연차를 먼저 넣거나(퇴직금 · 연차) 설정 hr.leave_allow_negative 를 켜십시오.`);
    }
    const days = r.half === 'FULL' ? await bizDays(db, r.start_on, r.end_on) : [r.start_on];
    for (const d of days) {
      await db.query(`INSERT INTO acct_leave_uses (employee_id, used_on, days, note, created_by) VALUES ($1::bigint, $2::date, $3::numeric, $4, $5::uuid)`,
        [r.employee_id, d, r.half === 'FULL' ? 1 : 0.5, `LR-${id} 휴가 승인${r.half !== 'FULL' ? (r.half === 'AM' ? ' · 오전 반차' : ' · 오후 반차') : ''}`, actor]);
    }
    await db.query(`UPDATE acct_leave_requests SET state = 'APPROVED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, note]);
    return { ok: true, id, state: 'APPROVED', days: n, remaining: Math.round((rem.remaining - n) * 10) / 10, note: `${e.name} 님 휴가 ${n}일을 승인했습니다(연차에서 뺌).` };
  });
}

/** POST /admin/hr/leave/{id}/revoke — 승인 취소(관리자 · 본인 아님 · 사유 · 음수 줄) */
export async function revokeLeave(db: DatabaseService, id: string, reasonIn: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  const reason = (reasonIn ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 150) throw new PolicyViolation('LEAVE_REASON', '사유는 2 ~ 150자입니다.');
  return db.transaction(async () => {
    const [r] = await db.query<{ employee_id: string; state: string }>(`SELECT employee_id::text AS employee_id, state FROM acct_leave_requests WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!r) throw new NotFound('없는 신청입니다.');
    if (r.state !== 'APPROVED') throw new StateConflict('LEAVE_STATE', '승인된 휴가만 승인 취소합니다.');
    const e = await empById(db, r.employee_id);
    notSelf(e, actor);
    const uses = await db.query<{ used_on: string; days: string }>(
      `SELECT used_on::text AS used_on, days::text AS days FROM acct_leave_uses WHERE employee_id = $1::bigint AND note LIKE $2 AND days > 0`, [r.employee_id, `LR-${id} %`]);
    for (const u of uses) {
      await db.query(`INSERT INTO acct_leave_uses (employee_id, used_on, days, note, created_by) VALUES ($1::bigint, $2::date, $3::numeric, $4, $5::uuid)`,
        [r.employee_id, u.used_on, -Number(u.days), `LR-${id} 승인 취소 · ${reason}`, actor]);
    }
    await db.query(`UPDATE acct_leave_requests SET state = 'CANCELED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, `승인 취소 · ${reason}`]);
    return { ok: true, id, state: 'CANCELED', returned: uses.reduce((a, u) => a + Number(u.days), 0), note: `${e.name} 님 휴가 승인을 취소했습니다(연차 되돌림).` };
  });
}

/* ── 내 인사 한눈에 ── */
export async function myHr(db: DatabaseService, actor: string | null) {
  const me = await myEmployee(db, actor);
  if (!me) return { linked: false, note: '이 계정에 연결된 직원이 없습니다 — SUPER 에게 연결을 부탁하십시오(회계 › 인사 › 근태).' };
  const today = kstToday(), ym = today.slice(0, 7);
  const { ws, rows } = await attRows(db, ym, me.id);
  const leave = await leaveDaysByEmp(db, ym);
  const rem = await remaining(db, me.id, Number(today.slice(0, 4)));
  const requests = await db.query(
    `SELECT id::text AS id, start_on::text AS "startOn", end_on::text AS "endOn", half, days::float AS days, note, state, decide_note AS "decideNote", created_at AS "createdAt"
       FROM acct_leave_requests WHERE employee_id = $1::bigint ORDER BY id DESC LIMIT 30`, [me.id]);
  const slips = await db.query(
    `SELECT l.id::text AS id, r.ym, r.pay_day::text AS "payDay", l.gross::float8 AS gross, l.net::float8 AS net
       FROM acct_payroll_lines l JOIN acct_payroll_runs r ON r.id = l.run_id
      WHERE l.employee_id = $1::bigint AND r.state IN ('FIXED', 'PAID') ORDER BY r.ym DESC LIMIT 24`, [me.id]);
  return { linked: true, employee: { id: me.id, name: me.name, joinedOn: me.joinedOn }, today: rows.find((r) => r.workOn === today) ?? null,
           month: { ym, workStart: ws, rows, summary: summarize(rows, leave, [{ id: me.id, name: me.name }])[0] }, leave: rem, requests, payslips: slips,
           note: '출근 · 퇴근은 하루 한 번씩입니다. 잘못 누르면 관리자에게 고침을 부탁하십시오.' };
}

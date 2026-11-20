import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { kstToday, myEmployee } from './hr';
import { HRX_HM_RE, hrxAddDays, hrxHm, hrxKstMs, hrxMonday, otRules } from './hrx-overtime';

/* ---------------------------------------------------------------------
 * v10.472 (D265 · docs/610) 근무표 · 교대 — 대표 11/20 「㉟ 인사 4」
 *   교대 유형(hrx_shift_types) — 처음 5개: 주간 09 ~ 18 · 조출 07 ~ 16 · 오후 13 ~ 22 · 야간 22 ~ 07(다음 날) · 휴무 · 휴게 분 · SUPER 고침
 *   주 근무표 — 직원 × 월 ~ 일 한 칸(hrx_shifts) · 칸을 넣으면 DB 가 유형 시각 · 휴게를 칸에 옮겨 적음(나중에 유형을 고쳐도 지난 근무표 그대로)
 *              여러 칸 한꺼번에 저장(비우면 지움) · 지난주 그대로 복사(빈 칸만) · 7일 넘게 지난 칸은 못 바꿈(DB 도 막음 · HRX_SHIFT_PAST)
 *   근태와 다름(㉖ acct_attendance · 오늘까지) — 근태 없음(휴가면 「휴가」) · 늦음 · 일찍 감(여유 hrx.shift_grace_min) · 퇴근 없음 · 근무표에 없는 날 일함
 *   주 계획 시간(휴게 뺌)이 기본(hrx.week_limits BASE) · 한도(BASE + OT)를 넘으면 표시.
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const HRX_SHIFT_CODE_RE = /^[A-Z][A-Z0-9_]{1,15}$/;   // DB CHECK hrx_shift_types.code 와 같음
export const HRX_SHIFT_KINDS = ['WORK', 'OFF'] as const;
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export interface ShiftType { code: string; name: string; kind: string; startHm: string | null; endHm: string | null; breakMin: number; active: boolean; sort: number }
async function shiftTypes(db: DatabaseService) {
  return db.query<ShiftType>(
    `SELECT code, name, kind, start_hm AS "startHm", end_hm AS "endHm", break_min AS "breakMin", active, sort FROM hrx_shift_types ORDER BY sort, code`);
}
async function graceMin(db: DatabaseService) {
  const [g] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hrx.shift_grace_min'`);
  const n = Number(g?.v ?? 10);
  return Number.isInteger(n) && n >= 0 && n <= 60 ? n : 10;
}
/** 칸의 [시작, 끝) 밀리초 — 끝 ≤ 시작이면 다음 날 */
export function shiftSpan(day: string, startHm: string, endHm: string) {
  const s = hrxKstMs(day, startHm);
  const e = endHm > startHm ? hrxKstMs(day, endHm) : hrxKstMs(hrxAddDays(day, 1), endHm);
  return { s, e };
}
const workMin = (c: { kind: string; startHm: string | null; endHm: string | null; breakMin: number }, day: string) => {
  if (c.kind !== 'WORK' || !c.startHm || !c.endHm) return 0;
  const { s, e } = shiftSpan(day, c.startHm, c.endHm);
  return Math.max(0, Math.round((e - s) / 60000) - c.breakMin);
};
const FLAG_KO: Record<string, string> = { ABSENT: '근태 없음', LEAVE: '휴가', LATE: '늦음', EARLY: '일찍 감', NO_OUT: '퇴근 없음', UNPLANNED: '근무표에 없는 날 일함' };

export interface CellShift { code: string; name: string; kind: string; startHm: string | null; endHm: string | null; breakMin: number; note: string | null }

/** GET /admin/hrx/shifts?week= — 주 근무표 · 근태 · 다름 · 주 계획 시간 */
export async function shiftWeek(db: DatabaseService, weekIn?: string) {
  const today = kstToday();
  const monday = hrxMonday(weekIn && dayOk(weekIn) ? weekIn : today), sunday = hrxAddDays(monday, 6);
  const days = Array.from({ length: 7 }, (_, i) => hrxAddDays(monday, i));
  const [types, grace, rules] = [await shiftTypes(db), await graceMin(db), await otRules(db)];
  const emps = await db.query<{ id: string; name: string; joinedOn: string; leftOn: string | null }>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn" FROM acct_employees
      WHERE joined_on <= $2::date AND (left_on IS NULL OR left_on >= $1::date) ORDER BY joined_on, id`, [monday, sunday]);
  const shifts = await db.query<{ employeeId: string; day: string } & CellShift>(
    `SELECT s.employee_id::text AS "employeeId", s.work_on::text AS day, s.type_code AS code, t.name, s.kind, s.start_hm AS "startHm", s.end_hm AS "endHm", s.break_min AS "breakMin", s.note
       FROM hrx_shifts s JOIN hrx_shift_types t ON t.code = s.type_code WHERE s.work_on BETWEEN $1::date AND $2::date`, [monday, sunday]);
  const att = await db.query<{ employeeId: string; day: string; inAt: string; outAt: string | null }>(
    `SELECT employee_id::text AS "employeeId", work_on::text AS day, in_at AS "inAt", out_at AS "outAt" FROM acct_attendance WHERE work_on BETWEEN $1::date AND $2::date`, [monday, sunday]);
  const leave = await db.query<{ employeeId: string; day: string; d: number }>(
    `SELECT employee_id::text AS "employeeId", used_on::text AS day, sum(days)::float8 AS d FROM acct_leave_uses WHERE used_on BETWEEN $1::date AND $2::date GROUP BY employee_id, used_on`, [monday, sunday]);
  const sOf = new Map(shifts.map((x) => [`${x.employeeId}|${x.day}`, x]));
  const aOf = new Map(att.map((x) => [`${x.employeeId}|${x.day}`, x]));
  const lOf = new Map(leave.filter((x) => Number(x.d) > 0).map((x) => [`${x.employeeId}|${x.day}`, Number(x.d)]));
  let diffs = 0;
  const rows = emps.map((e) => {
    let planned = 0;
    const cells = days.map((day) => {
      const k = `${e.id}|${day}`, s = sOf.get(k), a = aOf.get(k), lv = lOf.get(k) ?? 0;
      const inRange = day >= e.joinedOn && (!e.leftOn || day <= e.leftOn);
      const flags: string[] = [];
      if (s) planned += workMin(s, day);
      if (day <= today && inRange) {
        if (s?.kind === 'WORK' && s.startHm && s.endHm) {
          const { s: ss, e: se } = shiftSpan(day, s.startHm, s.endHm);
          if (!a) { if (day < today) flags.push(lv > 0 ? 'LEAVE' : 'ABSENT'); }
          else {
            if (Date.parse(a.inAt) > ss + grace * 60000) flags.push('LATE');
            if (a.outAt && Date.parse(a.outAt) < se - grace * 60000) flags.push('EARLY');
            if (!a.outAt && day < today) flags.push('NO_OUT');
          }
        } else if (a) flags.push('UNPLANNED');
      }
      if (flags.some((f) => f !== 'LEAVE')) diffs++;
      return { day, inRange, shift: s ? { code: s.code, name: s.name, kind: s.kind, startHm: s.startHm, endHm: s.endHm, breakMin: s.breakMin, note: s.note } : null,
               att: a ? { inHm: hrxHm(Date.parse(a.inAt)), outHm: a.outAt ? hrxHm(Date.parse(a.outAt)) : null } : null, leaveDays: lv,
               flags, flagsKo: flags.map((f) => FLAG_KO[f] ?? f) };
    });
    return { employeeId: e.id, name: e.name, cells, plannedMin: planned, plannedHours: Math.round(planned / 6) / 10,
             overBase: planned > rules.base * 60, overLimit: planned > (rules.base + rules.otMax) * 60 };
  });
  return { monday, sunday, days, today, lockBefore: hrxAddDays(today, -7), grace, types, rows, diffs, limits: { base: rules.base, otMax: rules.otMax },
           note: `근무표는 계획입니다 — 근태(출퇴근)와 다른 칸은 표시만 합니다(여유 ${grace}분 · 설정 hrx.shift_grace_min). 7일 넘게 지난 칸은 바꾸지 않습니다. 주 계획 ${rules.base}시간 · 한도 ${rules.base + rules.otMax}시간(휴게 뺌).` };
}

export interface ShiftCellInput { employeeId: string; day: string; type?: string | null; note?: string | null }

/** PUT /admin/hrx/shifts — 여러 칸 저장(type 비우면 지움) */
export async function setShifts(db: DatabaseService, cells: ShiftCellInput[], actor: string | null) {
  if (!Array.isArray(cells) || !cells.length || cells.length > 500) throw new PolicyViolation('HRX_SHIFT_CELLS', '칸은 1 ~ 500개입니다.');
  const lock = hrxAddDays(kstToday(), -7);
  const types = new Map((await shiftTypes(db)).map((t) => [t.code, t]));
  for (const c of cells) {
    if (!/^\d{1,18}$/.test(String(c.employeeId ?? ''))) throw new PolicyViolation('HRX_SHIFT_CELLS', '직원 번호가 바르지 않습니다.');
    if (!dayOk(c.day)) throw new PolicyViolation('HRX_SHIFT_CELLS', '날짜(YYYY-MM-DD)가 바르지 않습니다.');
    if (c.day < lock) throw new PolicyViolation('HRX_SHIFT_PAST', `7일 넘게 지난 근무표(${c.day})는 바꾸지 않습니다.`);
    if (c.type) {
      const t = types.get(c.type);
      if (!t || !t.active) throw new PolicyViolation('HRX_SHIFT_TYPE', `쓰는 교대 유형이 아닙니다: ${c.type}`);
    }
    if (c.note && String(c.note).length > 100) throw new PolicyViolation('HRX_SHIFT_CELLS', '칸 메모는 100자까지입니다.');
  }
  return db.transaction(async () => {
    const ids = [...new Set(cells.map((c) => c.employeeId))];
    const emps = await db.query<{ id: string; joinedOn: string; leftOn: string | null }>(
      `SELECT id::text AS id, joined_on::text AS "joinedOn", left_on::text AS "leftOn" FROM acct_employees WHERE id::text = ANY ($1::text[])`, [ids]);
    const eOf = new Map(emps.map((e) => [e.id, e]));
    let saved = 0, removed = 0;
    for (const c of cells) {
      const e = eOf.get(c.employeeId);
      if (!e) throw new NotFound('직원이 없습니다.');
      if (c.day < e.joinedOn || (e.leftOn && c.day > e.leftOn)) throw new PolicyViolation('HRX_SHIFT_CELLS', `입사일 ~ 퇴사일 밖의 날입니다(${c.day}).`);
      if (!c.type) {
        const r = await db.query(`DELETE FROM hrx_shifts WHERE employee_id = $1::bigint AND work_on = $2::date RETURNING id`, [c.employeeId, c.day]);
        removed += r.length;
        continue;
      }
      await db.query(
        `INSERT INTO hrx_shifts (employee_id, work_on, type_code, note, created_by, updated_by) VALUES ($1::bigint, $2::date, $3, $4, $5::uuid, $5::uuid)
         ON CONFLICT (employee_id, work_on) DO UPDATE SET type_code = EXCLUDED.type_code, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by`,
        [c.employeeId, c.day, c.type, c.note ? clean(c.note) : null, actor]);
      saved++;
    }
    return { ok: true, saved, removed, note: `근무표 ${saved}칸을 저장했습니다${removed ? ` · ${removed}칸을 비웠습니다` : ''}.` };
  });
}

/** POST /admin/hrx/shifts/copy — 지난주 근무표를 이 주 빈 칸에 복사(쓰는 유형 · 그날 다니는 직원만) */
export async function copyLastWeek(db: DatabaseService, weekIn: string, actor: string | null) {
  if (!dayOk(weekIn)) throw new PolicyViolation('HRX_SHIFT_CELLS', '주(YYYY-MM-DD)가 바르지 않습니다.');
  const monday = hrxMonday(weekIn), lock = hrxAddDays(kstToday(), -7);
  if (hrxAddDays(monday, 6) < lock) throw new PolicyViolation('HRX_SHIFT_PAST', '7일 넘게 지난 주에는 복사하지 않습니다.');
  const r = await db.query<{ id: string }>(
    `INSERT INTO hrx_shifts (employee_id, work_on, type_code, note, created_by, updated_by)
     SELECT s.employee_id, s.work_on + 7, s.type_code, s.note, $3::uuid, $3::uuid
       FROM hrx_shifts s JOIN hrx_shift_types t ON t.code = s.type_code AND t.active JOIN acct_employees e ON e.id = s.employee_id
      WHERE s.work_on BETWEEN ($1::date - 7) AND ($1::date - 1) AND s.work_on + 7 >= $2::date
        AND e.joined_on <= s.work_on + 7 AND (e.left_on IS NULL OR e.left_on >= s.work_on + 7)
     ON CONFLICT (employee_id, work_on) DO NOTHING RETURNING id::text AS id`, [monday, lock, actor]);
  return { ok: true, monday, copied: r.length, note: r.length ? `지난주 근무표 ${r.length}칸을 복사했습니다(이미 있던 칸은 그대로).` : '복사할 칸이 없습니다(지난주가 비었거나 이 주가 이미 차 있음).' };
}

export interface ShiftTypeInput { name?: string; kind?: string; startHm?: string | null; endHm?: string | null; breakMin?: number; active?: boolean; sort?: number }

/** PUT /admin/hrx/shifts/types/{code} — 교대 유형 넣기 · 고치기(SUPER · 보낸 칸만) */
export async function setShiftType(db: DatabaseService, code: string, b: ShiftTypeInput, actor: string | null) {
  if (!HRX_SHIFT_CODE_RE.test(String(code ?? ''))) throw new PolicyViolation('HRX_SHIFT_TYPE', '유형 코드는 영문 대문자로 시작하는 2 ~ 16자(대문자 · 숫자 · _)입니다.');
  const [old] = await db.query<ShiftType>(
    `SELECT code, name, kind, start_hm AS "startHm", end_hm AS "endHm", break_min AS "breakMin", active, sort FROM hrx_shift_types WHERE code = $1`, [code]);
  if (old && b.kind !== undefined && b.kind !== old.kind) throw new PolicyViolation('HRX_SHIFT_TYPE', '근무 · 휴무 종류는 바꾸지 않습니다(새 유형으로).');
  const x: ShiftType = {
    code, name: b.name !== undefined ? clean(b.name) : old?.name ?? '', kind: old?.kind ?? (b.kind === 'OFF' ? 'OFF' : 'WORK'),
    startHm: b.startHm !== undefined ? (b.startHm || null) : old?.startHm ?? null, endHm: b.endHm !== undefined ? (b.endHm || null) : old?.endHm ?? null,
    breakMin: b.breakMin !== undefined ? Number(b.breakMin) : old?.breakMin ?? 0, active: b.active !== undefined ? !!b.active : old?.active ?? true, sort: b.sort !== undefined ? Number(b.sort) : old?.sort ?? 100,
  };
  if (x.name.length < 1 || x.name.length > 30) throw new PolicyViolation('HRX_SHIFT_TYPE', '유형 이름은 1 ~ 30자입니다.');
  if (x.kind === 'OFF') { x.startHm = null; x.endHm = null; x.breakMin = 0; }
  else {
    if (!x.startHm || !x.endHm || !HRX_HM_RE.test(x.startHm) || !HRX_HM_RE.test(x.endHm) || x.startHm === x.endHm) throw new PolicyViolation('HRX_SHIFT_TYPE', '근무 유형은 시작 · 끝(HH:MM · 서로 다름)이 있어야 합니다.');
    if (!Number.isInteger(x.breakMin) || x.breakMin < 0 || x.breakMin > 240) throw new PolicyViolation('HRX_SHIFT_TYPE', '휴게는 0 ~ 240분입니다.');
  }
  if (!Number.isInteger(x.sort) || x.sort < 0 || x.sort > 9999) throw new PolicyViolation('HRX_SHIFT_TYPE', '순서는 0 ~ 9999 입니다.');
  await db.query(
    `INSERT INTO hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort, updated_by) VALUES ($1, $2, $3, $4, $5, $6::int, $7::boolean, $8::int, $9::uuid)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, start_hm = EXCLUDED.start_hm, end_hm = EXCLUDED.end_hm, break_min = EXCLUDED.break_min,
            active = EXCLUDED.active, sort = EXCLUDED.sort, updated_by = EXCLUDED.updated_by`,
    [x.code, x.name, x.kind, x.startHm, x.endHm, x.breakMin, x.active, x.sort, actor]);
  return { ok: true, type: x, created: !old, note: old ? `교대 유형 ${x.name}을 고쳤습니다 — 이미 넣은 근무표 칸은 그대로입니다.` : `교대 유형 ${x.name}을 더했습니다.` };
}

/** 내 근무표 — 이번 주 · 다음 주 */
export async function myShifts(db: DatabaseService, actor: string | null) {
  const me = await myEmployee(db, actor);
  if (!me) return { linked: false, days: [] };
  const monday = hrxMonday(kstToday());
  const rows = await db.query<{ day: string } & CellShift>(
    `SELECT s.work_on::text AS day, s.type_code AS code, t.name, s.kind, s.start_hm AS "startHm", s.end_hm AS "endHm", s.break_min AS "breakMin", s.note
       FROM hrx_shifts s JOIN hrx_shift_types t ON t.code = s.type_code WHERE s.employee_id = $1::bigint AND s.work_on BETWEEN $2::date AND ($2::date + 13) ORDER BY s.work_on`, [me.id, monday]);
  const of = new Map(rows.map((r) => [r.day, r]));
  return { linked: true, monday, days: Array.from({ length: 14 }, (_, i) => { const d = hrxAddDays(monday, i); const s = of.get(d); return { day: d, shift: s ?? null }; }) };
}

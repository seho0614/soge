import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { kstToday, myEmployee } from './hr';

/* ---------------------------------------------------------------------
 * ㉛ 인사 3 (D262 · docs/596) — v10.458 법정 의무교육 · 대표 11/20 「다음개발 ㉛」
 *   종류(hr_training_kinds) — 처음 4개는 일반 원칙 값(성희롱 예방 · 개인정보 · 장애인 인식 개선 연 1회 1시간 · 산업안전 반기 6시간) · SUPER 가 고치고 더함
 *   기간 = 연(YYYY) · 반기(YYYY-H1 · H2) · 이수 = 그 기간 확인(CONFIRMED) 시간 합 ≥ 최소 시간
 *   본인 제출(증빙 파일 HR_DOC 필수 · 열람 ADMIN · SUPER · 본인만) → 관리자 확인(본인 아님) · 관리자 등록(여러 명 한 번에 · 본인 줄은 제출로 둠) · 무효(사유)
 *   기한 알림 — 정기 작업 hr_training_due(매일 09:45) · 기간 끝 N일(hr.training_due_days) 전 HR_TRAINING_DUE · 지난 기간 미이수 HR_TRAINING_OVERDUE
 *   SQL 값은 모두 $n · 자리값 하나를 두 형에 함께 쓰지 않음 · DTO 빈 칸은 걸러서 씀.
 * ------------------------------------------------------------------- */

export const TRAINING_METHODS = ['ONLINE', 'CLASS', 'ETC'] as const;
export const KIND_CODE_RE = /^[A-Z][A-Z0-9_]{1,30}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clean = (s: string | null | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
const oneDecimal = (x: number) => Number.isFinite(x) && Math.abs(Math.round(x * 10) - x * 10) < 1e-6;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);   // m = 1 ~ 12

export interface Kind { code: string; name: string; basis: string | null; cycleMonths: number; minHours: number; active: boolean; sort: number; createdOn: string }

/** 날짜 → 기간 글자(연 YYYY · 반기 YYYY-H1 · YYYY-H2) */
export function periodOf(cycleMonths: number, day: string): string {
  const y = day.slice(0, 4), m = Number(day.slice(5, 7));
  return cycleMonths === 6 ? `${y}-H${m <= 6 ? 1 : 2}` : y;
}
/** 기간 → 처음 · 끝 날짜 */
export function periodRange(period: string): { start: string; end: string } {
  const y = Number(period.slice(0, 4));
  if (period.endsWith('-H1')) return { start: `${y}-01-01`, end: lastDay(y, 6) };
  if (period.endsWith('-H2')) return { start: `${y}-07-01`, end: lastDay(y, 12) };
  return { start: `${y}-01-01`, end: lastDay(y, 12) };
}
/** 바로 앞 기간 */
export function prevPeriod(period: string): string {
  const y = Number(period.slice(0, 4));
  if (period.endsWith('-H2')) return `${y}-H1`;
  if (period.endsWith('-H1')) return `${y - 1}-H2`;
  return String(y - 1);
}

export async function kinds(db: DatabaseService, activeOnly = false): Promise<Kind[]> {
  return db.query<Kind>(
    `SELECT code, name, basis, cycle_months AS "cycleMonths", min_hours::float8 AS "minHours", active, sort, (created_at AT TIME ZONE 'Asia/Seoul')::date::text AS "createdOn"
       FROM hr_training_kinds WHERE ($1::boolean = false OR active) ORDER BY sort, code`, [activeOnly]);
}
async function kindOf(db: DatabaseService, code: string) {
  const [k] = await db.query<Kind>(
    `SELECT code, name, basis, cycle_months AS "cycleMonths", min_hours::float8 AS "minHours", active, sort, (created_at AT TIME ZONE 'Asia/Seoul')::date::text AS "createdOn" FROM hr_training_kinds WHERE code = $1`, [code]);
  if (!k) throw new NotFound('없는 교육 종류입니다.');
  return k;
}
async function dueDays(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hr.training_due_days'`);
  const n = Number(r?.v);
  return Number.isInteger(n) && n >= 1 && n <= 180 ? n : 30;
}

/** 기간 안에 다닌 직원(입사 ≤ 기간 끝 · 퇴사 없음 또는 ≥ 기간 처음) */
async function staffIn(db: DatabaseService, period: string) {
  const { start, end } = periodRange(period);
  return db.query<{ id: string; name: string; accountId: string | null }>(
    `SELECT id::text AS id, name, account_id::text AS "accountId" FROM acct_employees
      WHERE joined_on <= $2::date AND (left_on IS NULL OR left_on >= $1::date) ORDER BY joined_on, id`, [start, end]);
}
/** (직원 · 종류 · 기간) → 확인 시간 · 기다리는 제출 수 */
async function hoursMap(db: DatabaseService, periods: string[]) {
  const rows = await db.query<{ emp: string; kind: string; period: string; hours: number; pending: number }>(
    `SELECT employee_id::text AS emp, kind_code AS kind, period,
            coalesce(sum(hours) FILTER (WHERE state = 'CONFIRMED'), 0)::float8 AS hours, count(*) FILTER (WHERE state = 'SUBMITTED')::int AS pending
       FROM hr_training_records WHERE period = ANY($1::text[]) AND state <> 'VOID' GROUP BY employee_id, kind_code, period`, [periods]);
  return new Map(rows.map((r) => [`${r.emp}|${r.kind}|${r.period}`, r]));
}

/** GET /admin/hr/training?year= — 종류마다 그 해 기간 · 직원별 이수 · 기다리는 제출 */
export async function trainingBoard(db: DatabaseService, yearIn?: string) {
  const today = kstToday();
  const year = /^\d{4}$/.test(yearIn ?? '') && Number(yearIn) >= 2000 && Number(yearIn) <= 2100 ? Number(yearIn) : Number(today.slice(0, 4));
  const ks = await kinds(db, true);
  const days = await dueDays(db);
  const boards: unknown[] = [];
  for (const k of ks) {
    const periods = k.cycleMonths === 6 ? [`${year}-H1`, `${year}-H2`] : [String(year)];
    const hm = await hoursMap(db, periods.map(String));
    for (const p of periods) {
      const { start, end } = periodRange(p);
      if (start > today && p !== periodOf(k.cycleMonths, today)) continue;   // 아직 시작 안 한 반기는 뺌
      const staff = await staffIn(db, p);
      const rows = staff.map((e) => {
        const h = hm.get(`${e.id}|${k.code}|${p}`);
        const hours = h?.hours ?? 0;
        return { employeeId: e.id, name: e.name, hours, pending: h?.pending ?? 0, done: hours >= k.minHours };
      });
      const left = Math.round((Date.parse(end) - Date.parse(today)) / 86400e3);
      boards.push({ kind: k.code, name: k.name, period: p, start, dueOn: end, minHours: k.minHours, daysLeft: left,
                    state: rows.every((r) => r.done) ? 'DONE' : left < 0 ? 'OVERDUE' : left <= days ? 'DUE' : 'OPEN',
                    done: rows.filter((r) => r.done).length, total: rows.length, rows });
    }
  }
  const pending = await db.query(
    `SELECT r.id::text AS id, r.employee_id::text AS "employeeId", e.name, r.kind_code AS kind, k.name AS "kindName", r.period, r.done_on::text AS "doneOn",
            r.hours::float8 AS hours, r.method, r.provider, r.file_id::text AS "fileId", r.note, r.created_at AS "createdAt"
       FROM hr_training_records r JOIN acct_employees e ON e.id = r.employee_id JOIN hr_training_kinds k ON k.code = r.kind_code
      WHERE r.state = 'SUBMITTED' ORDER BY r.id LIMIT 200`);
  const recent = await db.query(
    `SELECT r.id::text AS id, e.name, k.name AS "kindName", r.period, r.done_on::text AS "doneOn", r.hours::float8 AS hours, r.state, r.void_reason AS "voidReason",
            r.file_id::text AS "fileId", r.decided_at AS "decidedAt"
       FROM hr_training_records r JOIN acct_employees e ON e.id = r.employee_id JOIN hr_training_kinds k ON k.code = r.kind_code
      WHERE substr(r.period, 1, 4) = $1 ORDER BY r.id DESC LIMIT 100`, [String(year)]);
  return { year, dueDays: days, kinds: ks, boards, pending, recent,
           note: `기간 끝 ${days}일 전부터(설정 hr.training_due_days) 미이수 직원이 있으면 운영 알림이 뜹니다. 종류 · 주기 · 시간은 일반 원칙 값이며 SUPER 가 고칩니다(법 조문 · 적용 범위는 노무사 확인).` };
}

/** PUT /admin/hr/training/kinds/{code} — 종류 고치기 · 새로 더하기(SUPER) */
export async function setKind(db: DatabaseService, code: string, b: { name?: string; basis?: string; cycleMonths?: number; minHours?: number; active?: boolean; sort?: number }, actor: string | null) {
  if (!KIND_CODE_RE.test(code ?? '')) throw new PolicyViolation('TRAINING_KIND', '종류 코드는 영문 대문자 · 숫자 · _ 2 ~ 31자입니다.');
  if (b.cycleMonths !== undefined && ![6, 12].includes(b.cycleMonths)) throw new PolicyViolation('TRAINING_KIND', '주기는 6(반기) · 12(연)달입니다.');
  if (b.minHours !== undefined && !(b.minHours > 0 && b.minHours <= 40 && oneDecimal(b.minHours))) throw new PolicyViolation('TRAINING_KIND', '최소 시간은 0.1 ~ 40시간(소수 한 자리)입니다.');
  const name = b.name === undefined ? undefined : clean(b.name, 60);
  if (name !== undefined && (!name || name.length < 2)) throw new PolicyViolation('TRAINING_KIND', '이름은 2 ~ 60자입니다.');
  const [old] = await db.query<{ code: string }>(`SELECT code FROM hr_training_kinds WHERE code = $1`, [code]);
  if (!old) {
    if (!name || b.cycleMonths === undefined || b.minHours === undefined) throw new PolicyViolation('TRAINING_KIND', '새 종류는 이름 · 주기 · 최소 시간을 모두 적습니다.');
    await db.query(
      `INSERT INTO hr_training_kinds (code, name, basis, cycle_months, min_hours, active, sort, updated_by)
       VALUES ($1, $2, $3, $4::int, $5::numeric, $6::boolean, $7::int, $8::uuid)`,
      [code, name, b.basis === undefined ? null : clean(b.basis, 200), b.cycleMonths, b.minHours, b.active ?? true, b.sort ?? 100, actor]);
    return { ok: true, code, created: true, note: `교육 종류 「${name}」을 더했습니다.` };
  }
  if (b.cycleMonths !== undefined) {
    const [used] = await db.query<{ cm: number }>(
      `SELECT k.cycle_months AS cm FROM hr_training_kinds k WHERE k.code = $1 AND k.cycle_months <> $2::int AND EXISTS (SELECT 1 FROM hr_training_records r WHERE r.kind_code = k.code)`, [code, b.cycleMonths]);
    if (used) throw new StateConflict('TRAINING_KIND_USED', '이수 기록이 있는 종류는 주기를 바꾸지 않습니다 — 새 종류를 더하고 옛 것은 「쓰지 않음」으로 두십시오.');
  }
  await db.query(
    `UPDATE hr_training_kinds SET name = coalesce($2, name), basis = CASE WHEN $3::boolean THEN $4 ELSE basis END, cycle_months = coalesce($5::int, cycle_months),
            min_hours = coalesce($6::numeric, min_hours), active = coalesce($7::boolean, active), sort = coalesce($8::int, sort), updated_by = $9::uuid
      WHERE code = $1`,
    [code, name ?? null, b.basis !== undefined, b.basis === undefined ? null : clean(b.basis, 200), b.cycleMonths ?? null, b.minHours ?? null, b.active ?? null, b.sort ?? null, actor]);
  return { ok: true, code, created: false, note: '교육 종류를 고쳤습니다 — 이미 확인한 이수 기록은 그대로입니다.' };
}

interface RecIn { kind: string; doneOn: string; hours: number; method?: string; provider?: string; fileId?: string; note?: string }
async function checkRec(db: DatabaseService, b: RecIn) {
  const k = await kindOf(db, b.kind);
  if (!k.active) throw new PolicyViolation('TRAINING_KIND_OFF', '쓰지 않는 교육 종류입니다.');
  if (!dayOk(b.doneOn) || b.doneOn > kstToday()) throw new PolicyViolation('TRAINING_DATE', '이수일이 바르지 않습니다(오늘까지).');
  if (!(b.hours > 0 && b.hours <= 40 && oneDecimal(b.hours))) throw new PolicyViolation('TRAINING_HOURS', '시간은 0.1 ~ 40(소수 한 자리)입니다.');
  const method = b.method && (TRAINING_METHODS as readonly string[]).includes(b.method) ? b.method : 'ONLINE';
  if (b.fileId && !UUID_RE.test(b.fileId)) throw new PolicyViolation('TRAINING_FILE', '증빙 파일 번호가 바르지 않습니다.');
  if (b.fileId) {
    const [f] = await db.query<{ ok: boolean }>(`SELECT (purpose = 'HR_DOC' AND status = 'READY') AS ok FROM files WHERE id = $1::uuid`, [b.fileId]);
    if (!f?.ok) throw new PolicyViolation('TRAINING_FILE', '증빙은 인사 서류 용도(HR_DOC)로 올린 파일(JPG · PNG · PDF)만 붙입니다.');
  }
  return { k, method, period: periodOf(k.cycleMonths, b.doneOn) };
}

/** POST /admin/hr/training/records — 관리자 등록(여러 직원 한 번에 · 확인으로 들어감 · 관리자 본인 줄은 제출로) */
export async function addRecords(db: DatabaseService, b: RecIn & { employeeIds: string[] }, actor: string | null) {
  const ids = [...new Set((b.employeeIds ?? []).map(String))];
  if (!ids.length || ids.length > 200 || ids.some((x) => !/^\d{1,18}$/.test(x))) throw new PolicyViolation('TRAINING_EMPLOYEES', '직원을 1 ~ 200명 고르십시오.');
  const { k, method, period } = await checkRec(db, b);
  const { start, end } = periodRange(period);
  return db.transaction(async () => {
    const emps = await db.query<{ id: string; name: string; accountId: string | null }>(
      `SELECT id::text AS id, name, account_id::text AS "accountId" FROM acct_employees
        WHERE id = ANY($1::bigint[]) AND joined_on <= $3::date AND (left_on IS NULL OR left_on >= $2::date)`, [ids, start, end]);
    if (emps.length !== ids.length) throw new PolicyViolation('TRAINING_EMPLOYEES', '없는 직원이거나 그 기간에 다니지 않은 직원이 있습니다.');
    const made: string[] = [];
    let self = 0;
    for (const e of emps) {
      const mine = !!actor && e.accountId === actor;
      if (mine) self++;
      const [r] = await db.query<{ id: string }>(
        `INSERT INTO hr_training_records (employee_id, kind_code, period, done_on, hours, method, provider, file_id, note, state, decided_by, decided_at, created_by)
         VALUES ($1::bigint, $2, $3, $4::date, $5::numeric, $6, $7, $8::uuid, $9, $10::text, $11::uuid, CASE WHEN $10::text = 'CONFIRMED' THEN now() END, $12::uuid) RETURNING id::text AS id`,
        [e.id, k.code, period, b.doneOn, b.hours, method, clean(b.provider, 100), b.fileId || null, clean(b.note, 200), mine ? 'SUBMITTED' : 'CONFIRMED', mine ? null : actor, actor]);
      made.push(r!.id);
    }
    return { ok: true, ids: made, period, confirmed: made.length - self, submitted: self,
             note: `${k.name} ${period} 이수를 ${made.length}명 넣었습니다${self ? ` — 본인 줄 ${self}개는 다른 관리자가 확인합니다` : ''}.` };
  });
}

/** POST /admin/me/hr/training — 본인 제출(증빙 필수 · 관리자 확인 기다림) */
export async function submitMyTraining(db: DatabaseService, actor: string | null, b: RecIn) {
  const me = await myEmployee(db, actor);
  if (!me) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다 — SUPER 가 회계 › 인사 › 근태에서 직원과 계정을 연결해야 합니다.');
  if (!b.fileId) throw new PolicyViolation('TRAINING_FILE', '이수증 등 증빙 파일을 붙이십시오.');
  const { k, method, period } = await checkRec(db, b);
  const [own] = await db.query<{ ok: boolean }>(`SELECT (owner_account_id = $2::uuid) AS ok FROM files WHERE id = $1::uuid`, [b.fileId, actor]);
  if (!own?.ok) throw new PolicyViolation('TRAINING_FILE', '본인이 올린 증빙 파일만 붙입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hr_training_records (employee_id, kind_code, period, done_on, hours, method, provider, file_id, note, created_by)
     VALUES ($1::bigint, $2, $3, $4::date, $5::numeric, $6, $7, $8::uuid, $9, $10::uuid) RETURNING id::text AS id`,
    [me.id, k.code, period, b.doneOn, b.hours, method, clean(b.provider, 100), b.fileId, clean(b.note, 200), actor]);
  return { ok: true, id: r!.id, period, note: `${k.name} ${period} 이수를 제출했습니다 — 관리자가 확인하면 이수로 셉니다.` };
}

async function recOf(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 이수 기록입니다.');
  const [r] = await db.query<{ id: string; state: string; accountId: string | null; name: string }>(
    `SELECT r.id::text AS id, r.state, e.account_id::text AS "accountId", e.name FROM hr_training_records r JOIN acct_employees e ON e.id = r.employee_id
      WHERE r.id = $1::bigint FOR UPDATE OF r`, [id]);
  if (!r) throw new NotFound('없는 이수 기록입니다.');
  return r;
}

/** POST /admin/hr/training/records/{id}/decide — 확인 · 돌려보냄(관리자 · 본인 아님) */
export async function decideRecord(db: DatabaseService, id: string, decision: string, reasonIn: string | undefined, actor: string | null) {
  if (!['CONFIRM', 'REJECT'].includes(decision)) throw new PolicyViolation('TRAINING_DECISION', '확인(CONFIRM) · 돌려보냄(REJECT) 중 하나입니다.');
  const reason = clean(reasonIn, 200);
  if (decision === 'REJECT' && (!reason || reason.length < 2)) throw new PolicyViolation('TRAINING_REASON', '돌려보낼 때는 사유를 2자 이상 적습니다.');
  return db.transaction(async () => {
    const r = await recOf(db, id);
    if (actor && r.accountId === actor) throw new Forbidden('HR_SELF', '본인 이수는 다른 관리자가 확인합니다.');
    if (r.state !== 'SUBMITTED') throw new StateConflict('TRAINING_STATE', '제출 상태에서만 확인 · 돌려보냅니다.');
    await db.query(
      `UPDATE hr_training_records SET state = $2, decided_by = $3::uuid, decided_at = now(), void_reason = $4 WHERE id = $1::bigint`,
      [r.id, decision === 'CONFIRM' ? 'CONFIRMED' : 'VOID', actor, decision === 'CONFIRM' ? null : `돌려보냄 · ${reason}`]);
    return { ok: true, id: r.id, state: decision === 'CONFIRM' ? 'CONFIRMED' : 'VOID', note: `${r.name} 님 이수를 ${decision === 'CONFIRM' ? '확인' : '돌려보냈'}습니다.` };
  });
}

/** POST /admin/hr/training/records/{id}/void — 확인한 줄 무효(관리자 · 본인 아님 · 사유) */
export async function voidRecord(db: DatabaseService, id: string, reasonIn: string, actor: string | null) {
  const reason = clean(reasonIn, 200);
  if (!reason || reason.length < 2) throw new PolicyViolation('TRAINING_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const r = await recOf(db, id);
    if (actor && r.accountId === actor) throw new Forbidden('HR_SELF', '본인 이수는 다른 관리자가 처리합니다.');
    if (r.state !== 'CONFIRMED') throw new StateConflict('TRAINING_STATE', '확인한 이수만 무효로 합니다(제출은 돌려보냄).');
    await db.query(`UPDATE hr_training_records SET state = 'VOID', decided_by = $2::uuid, decided_at = now(), void_reason = $3 WHERE id = $1::bigint`, [r.id, actor, reason]);
    return { ok: true, id: r.id, state: 'VOID', note: `${r.name} 님 이수 기록을 무효로 했습니다(기록은 남음).` };
  });
}

/** 내 인사 — 지금 기간 종류마다 내 이수 · 내 기록 */
export async function myTraining(db: DatabaseService, employeeId: string) {
  const today = kstToday();
  const ks = await kinds(db, true);
  const periods = ks.map((k) => periodOf(k.cycleMonths, today));
  const hm = await hoursMap(db, [...new Set(periods)]);
  const items = ks.map((k) => {
    const p = periodOf(k.cycleMonths, today);
    const h = hm.get(`${employeeId}|${k.code}|${p}`);
    return { kind: k.code, name: k.name, period: p, dueOn: periodRange(p).end, minHours: k.minHours, hours: h?.hours ?? 0, pending: h?.pending ?? 0, done: (h?.hours ?? 0) >= k.minHours };
  });
  const records = await db.query(
    `SELECT r.id::text AS id, k.name AS "kindName", r.period, r.done_on::text AS "doneOn", r.hours::float8 AS hours, r.state, r.void_reason AS "voidReason", r.file_id::text AS "fileId"
       FROM hr_training_records r JOIN hr_training_kinds k ON k.code = r.kind_code WHERE r.employee_id = $1::bigint ORDER BY r.id DESC LIMIT 30`, [employeeId]);
  return { items, records, methods: TRAINING_METHODS };
}

/** 정기 작업 hr_training_due(매일 09:45) — 지금 기간 기한 N일 전 HR_TRAINING_DUE · 지난 기간 미이수 HR_TRAINING_OVERDUE · 모두 이수하면 풀림 */
export async function trainingDueJob(db: DatabaseService) {
  const today = kstToday();
  const days = await dueDays(db);
  const ks = await kinds(db, true);
  let made = 0, resolved = 0;
  const checks: Array<{ kind: string; period: string; missing: number; code: string }> = [];
  for (const k of ks) {
    const cur = periodOf(k.cycleMonths, today);
    for (const [p, code] of [[cur, 'HR_TRAINING_DUE'], [prevPeriod(cur), 'HR_TRAINING_OVERDUE']] as const) {
      const { end } = periodRange(p);
      /* 종류를 만든 날(처음 4개는 D262 적용 날) 전에 끝난 기간은 기한 지남 알림을 띄우지 않음 — 적용 날 지난 기간 전부가 급한 알림으로 쏟아지지 않게 */
      if (code === 'HR_TRAINING_OVERDUE' && end < k.createdOn) continue;
      const staff = await staffIn(db, p);
      const hm = await hoursMap(db, [p]);
      const missing = staff.filter((e) => (hm.get(`${e.id}|${k.code}|${p}`)?.hours ?? 0) < k.minHours).length;
      const left = Math.round((Date.parse(end) - Date.parse(today)) / 86400e3);
      checks.push({ kind: k.code, period: p, missing, code });
      if (!missing) {
        const r = await db.query(
          `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '모두 이수'
            WHERE alert_code = $1 AND resolved_at IS NULL AND detail->>'kind' = $2 AND detail->>'period' = $3 RETURNING id`, [code, k.code, p]);
        resolved += r.length;
        continue;
      }
      if (code === 'HR_TRAINING_DUE' && left > days) continue;
      const r = await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT $1::text, $2::text, $3::text, jsonb_build_object('kind', $4::text, 'period', $5::text, 'missing', $6::int, 'dueOn', $7::text), clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = $1::text AND a.resolved_at IS NULL AND a.detail->>'kind' = $4::text AND a.detail->>'period' = $5::text)
         ON CONFLICT DO NOTHING RETURNING id`,
        [code, code === 'HR_TRAINING_DUE' ? 'WARN' : 'CRITICAL',
         code === 'HR_TRAINING_DUE' ? `법정 의무교육 「${k.name}」 ${p} 기한 ${end} — 미이수 ${missing}명 · 회계 › 인사 › 의무교육`
                                    : `법정 의무교육 「${k.name}」 ${p} 기한 지남 — 미이수 ${missing}명 · 회계 › 인사 › 의무교육`,
         k.code, p, missing, end]);
      made += r.length;
    }
  }
  return { days, made, resolved, checks };
}

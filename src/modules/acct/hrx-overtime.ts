import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { kstToday, myEmployee } from './hr';
import { updateLine } from './payroll';

/* ---------------------------------------------------------------------
 * v10.471 (D265 · docs/609) 연장 · 야간 · 휴일 근로 — 대표 11/20 「㉟ 인사 4」
 *   신청 — 본인(사무 › 내 인사) 또는 관리자 대신(회계 › 인사 › 연장 근로 · 본인 아님) · 일한 날 · 시작 · 끝(한국 시각 · 끝 ≤ 시작이면 다음 날) · 사유
 *          분 · 야간 분(22 ~ 06시) · 날 종류(영업일 · 토요일 휴무일 · 휴일)는 DB 트리거가 셈(fn_hrx_ot_guard) — 서버는 돌려받아 씀
 *          한 직원의 살아 있는 신청은 시간이 겹치지 않음(DB 배제 제약 ex_hrx_ot_overlap → 409 HRX_OT_OVERLAP)
 *   주 52시간 — 주(월 ~ 일) 연장 · 휴일 근로 합(신청 + 승인)이 WARN − BASE 시간을 넘으면 경고 · 승인 합이 OT 한도를 넘는 승인은 막음(hrx.ot_over_block on)
 *   승인 — 관리자(ADMIN · 본인 신청 아님) · 반려는 사유 · 승인 취소(급여 대장에 넘기기 전만)
 *   ㉖ 근태와 비교 — 그날 출퇴근(acct_attendance)과 신청 시간이 겹친 분 · 근태 없음 · 퇴근 없음 · 짧음
 *   급여 대장으로 — 그 달 초안 급여 대장(⑭ acct_payroll_lines)의 지급액(gross)에 수당을 더하고 다시 셈(payroll.updateLine) · 넘긴 기록(hrx_ot_pay_links) · 초안일 때만 되돌림
 *     수당 = 통상시급(월 기본급 ÷ hrx.std_month_hours) × 분/60 × (100% + 가산율) — 연장 OT% · 휴일 8시간 안 HOL% · 넘음 HOL8% · 야간 분에 NIGHT% 더함
 *     기준 시간 hrx.ot_pay_basis — MIN(처음) 승인과 근태 겹친 분 중 작은 쪽 · REQUEST 승인 그대로
 *   값은 일반 원칙(근로기준법 제50 · 53 · 56조) · SUPER 가 고침 · 노무사 확인(통상임금 범위 · 포괄임금 · 5인 미만 가산 제외 등 — docs/609).
 *   SQL 값은 모두 $n · 자리값 하나를 두 형에 함께 쓰지 않음 · DTO 빈 칸은 걸러서 씀.
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
export const HRX_HM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;   // DB CHECK(hrx_shift_types.start_hm 등)와 같음
export const HRX_OT_RATES_RE = /^OT:[0-9]{1,3},NIGHT:[0-9]{1,3},HOL:[0-9]{1,3},HOL8:[0-9]{1,3}$/;   // site_settings hrx.ot_rates value_pattern 과 같음
export const HRX_WEEK_LIMITS_RE = /^BASE:[0-9]{1,2},OT:[0-9]{1,2},WARN:[0-9]{1,2}$/;   // hrx.week_limits 와 같음
export const HRX_STD_HOURS_RE = /^(1[0-9]{2}|2[0-4][0-9])$/;   // hrx.std_month_hours 와 같음
export const HRX_PAY_BASES = ['MIN', 'REQUEST'] as const;
export const HRX_DAY_KIND_KO: Record<string, string> = { WORKDAY: '영업일(연장)', OFFDAY: '토요일 휴무일(연장)', HOLIDAY: '휴일' };

const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
export const hrxAddDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
/** 그 날이 든 주의 월요일(한국 날짜 글자 기준) */
export const hrxMonday = (d: string) => { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return hrxAddDays(d, -((dow + 6) % 7)); };
/** 한국 날짜 + HH:MM → 밀리초 */
export const hrxKstMs = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);
/** 밀리초 → 한국 HH:MM */
export const hrxHm = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);
/** 밀리초 → 한국 날짜 */
const kstDayOf = (ms: number) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** [시작, 끝) 안 야간(한국 22:00 ~ 06:00) 분 — DB 트리거와 같은 셈(근태 겹친 구간에도 씀) */
export function hrxNightMinutes(startMs: number, endMs: number) {
  if (!(endMs > startMs)) return 0;
  let n = 0;
  for (let d = hrxAddDays(kstDayOf(startMs), -1); hrxKstMs(d, '22:00') < endMs; d = hrxAddDays(d, 1)) {
    const ws = hrxKstMs(d, '22:00'), we = ws + 8 * 3600e3;
    n += Math.max(0, Math.min(endMs, we) - Math.max(startMs, ws));
  }
  return Math.floor(n / 60000);
}

const parsePairs = (s: string) => Object.fromEntries(s.split(',').map((x) => x.split(':')).map(([k, v]) => [String(k), Number(v)])) as Record<string, number>;

export interface OtRules { rates: { OT: number; NIGHT: number; HOL: number; HOL8: number }; base: number; otMax: number; warn: number; stdHours: number; block: boolean; satHoliday: boolean; basis: string }
export async function otRules(db: DatabaseService): Promise<OtRules> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('hrx.ot_rates', 'hrx.week_limits', 'hrx.std_month_hours', 'hrx.ot_over_block', 'hrx.sat_as_holiday', 'hrx.ot_pay_basis')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? '';
  const r = parsePairs(HRX_OT_RATES_RE.test(v('hrx.ot_rates')) ? v('hrx.ot_rates') : 'OT:50,NIGHT:50,HOL:50,HOL8:100');
  const w = parsePairs(HRX_WEEK_LIMITS_RE.test(v('hrx.week_limits')) ? v('hrx.week_limits') : 'BASE:40,OT:12,WARN:48');
  return { rates: { OT: r.OT ?? 50, NIGHT: r.NIGHT ?? 50, HOL: r.HOL ?? 50, HOL8: r.HOL8 ?? 100 }, base: w.BASE ?? 40, otMax: w.OT ?? 12, warn: w.WARN ?? 48,
           stdHours: HRX_STD_HOURS_RE.test(v('hrx.std_month_hours')) ? Number(v('hrx.std_month_hours')) : 209,
           block: v('hrx.ot_over_block') !== 'off', satHoliday: v('hrx.sat_as_holiday') === 'on', basis: v('hrx.ot_pay_basis') === 'REQUEST' ? 'REQUEST' : 'MIN' };
}

/** 수당(원) — 통상시급 × 분/60 × (100% + 가산) · 휴일은 8시간(480분)까지 HOL · 넘으면 HOL8 · 야간 분에 NIGHT 더함 */
export function hrxOtPay(minutes: number, nightMin: number, dayKind: string, hourly: number, r: OtRules['rates']) {
  const m = Math.max(0, minutes), nm = Math.max(0, Math.min(nightMin, m));
  let pctMin = 100 * m;
  if (dayKind === 'HOLIDAY') pctMin += r.HOL * Math.min(m, 480) + r.HOL8 * Math.max(0, m - 480);
  else pctMin += r.OT * m;
  pctMin += r.NIGHT * nm;
  return Math.round((hourly * pctMin) / 100 / 60);
}

export interface Emp { id: string; name: string; joinedOn: string; leftOn: string | null; accountId: string | null; base: number }
async function empById(db: DatabaseService, id: string): Promise<Emp> {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('직원이 없습니다.');
  const [e] = await db.query<Emp>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", account_id::text AS "accountId", monthly_base::float8 AS base
       FROM acct_employees WHERE id = $1::bigint`, [id]);
  if (!e) throw new NotFound('직원이 없습니다.');
  return e;
}
async function needMe(db: DatabaseService, actor: string | null) {
  const e = await myEmployee(db, actor);
  if (!e) throw new PolicyViolation('HR_NOT_LINKED', '이 계정에 연결된 직원이 없습니다 — SUPER 가 회계 › 인사 › 근태에서 직원과 계정을 연결해야 합니다.');
  return e;
}
const notSelf = (e: { accountId: string | null }, actor: string | null) => {
  if (actor && e.accountId === actor) throw new Forbidden('HR_SELF', '본인 연장 근로는 다른 관리자가 처리합니다.');
};

/** 주(월 ~ 일) 연장 · 휴일 근로 분 — 승인 · 신청 따로 */
async function weekUse(db: DatabaseService, employeeId: string, monday: string, exceptId?: string) {
  const [w] = await db.query<{ approved: number; requested: number }>(
    `SELECT coalesce(sum(minutes) FILTER (WHERE state = 'APPROVED'), 0)::int AS approved, coalesce(sum(minutes) FILTER (WHERE state = 'REQUESTED'), 0)::int AS requested
       FROM hrx_ot_requests WHERE employee_id = $1::bigint AND work_on BETWEEN $2::date AND ($2::date + 6) AND state IN ('REQUESTED', 'APPROVED') AND id::text <> $3`,
    [employeeId, monday, exceptId ?? '']);
  return { approved: w?.approved ?? 0, requested: w?.requested ?? 0 };
}
function weekWarning(r: OtRules, approved: number, requested: number) {
  const total = approved + requested, warnMin = Math.max(0, r.warn - r.base) * 60, maxMin = r.otMax * 60;
  if (total > maxMin) return `이번 주 연장 · 휴일 근로가 ${Math.round(total / 6) / 10}시간으로 한도 ${r.otMax}시간(주 ${r.base + r.otMax}시간)을 넘습니다 — 승인되지 않을 수 있습니다.`;
  if (total > warnMin) return `이번 주 연장 · 휴일 근로가 ${Math.round(total / 6) / 10}시간입니다 — 주 ${r.warn}시간을 넘었습니다(한도 주 ${r.base + r.otMax}시간).`;
  return null;
}

export interface OtInput { workOn?: string; startHm?: string; endHm?: string; reason?: string }

async function insertRequest(db: DatabaseService, e: { id: string; joinedOn: string; leftOn: string | null }, b: OtInput, actor: string | null) {
  const workOn = String(b.workOn ?? ''), s = String(b.startHm ?? ''), t = String(b.endHm ?? ''), reason = clean(b.reason);
  const today = kstToday();
  if (!dayOk(workOn)) throw new PolicyViolation('HRX_OT_DATE', '일한 날(YYYY-MM-DD)이 바르지 않습니다.');
  if (workOn < hrxAddDays(today, -31) || workOn > hrxAddDays(today, 31)) throw new PolicyViolation('HRX_OT_DATE', '오늘 앞뒤 31일 안의 날만 신청합니다.');
  if (workOn < e.joinedOn || (e.leftOn && workOn > e.leftOn)) throw new PolicyViolation('HRX_OT_DATE', '입사일 ~ 퇴사일 안의 날만 신청합니다.');
  if (!HRX_HM_RE.test(s) || !HRX_HM_RE.test(t)) throw new PolicyViolation('HRX_OT_TIME', '시각은 HH:MM(한국 시각)입니다.');
  if (s === t) throw new PolicyViolation('HRX_OT_TIME', '시작과 끝이 같습니다.');
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HRX_OT_REASON', '사유는 2 ~ 200자입니다.');
  const startMs = hrxKstMs(workOn, s), endMs = t > s ? hrxKstMs(workOn, t) : hrxKstMs(hrxAddDays(workOn, 1), t);
  const minutes = Math.round((endMs - startMs) / 60000);
  if (minutes < 10 || minutes > 960) throw new PolicyViolation('HRX_OT_TIME', '한 번에 10분 ~ 16시간입니다.');
  const startIso = new Date(startMs).toISOString(), endIso = new Date(endMs).toISOString();
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('hrx_ot:' || $1::text))`, [e.id]);
    const [over] = await db.query<{ id: string }>(
      `SELECT id::text AS id FROM hrx_ot_requests WHERE employee_id = $1::bigint AND state IN ('REQUESTED', 'APPROVED')
          AND tstzrange(start_at, end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)') LIMIT 1`, [e.id, startIso, endIso]);
    if (over) throw new StateConflict('HRX_OT_OVERLAP', `시간이 겹치는 연장 근로 신청이 있습니다(${over.id}번).`);
    let r: { id: string; minutes: number; nightMin: number; dayKind: string } | undefined;
    try {
      [r] = await db.query<{ id: string; minutes: number; nightMin: number; dayKind: string }>(
        `INSERT INTO hrx_ot_requests (employee_id, work_on, start_at, end_at, reason, created_by) VALUES ($1::bigint, $2::date, $3::timestamptz, $4::timestamptz, $5, $6::uuid)
         RETURNING id::text AS id, minutes, night_min AS "nightMin", day_kind AS "dayKind"`, [e.id, workOn, startIso, endIso, reason, actor]);
    } catch (err) {
      if ((err as { code?: string })?.code === '23P01') throw new StateConflict('HRX_OT_OVERLAP', '시간이 겹치는 연장 근로 신청이 있습니다.');
      throw err;
    }
    const rules = await otRules(db);
    const w = await weekUse(db, e.id, hrxMonday(workOn));
    return { ok: true, id: r!.id, minutes: r!.minutes, nightMin: r!.nightMin, dayKind: r!.dayKind, week: { monday: hrxMonday(workOn), ...w },
             warning: weekWarning(rules, w.approved, w.requested), note: `연장 근로 ${Math.floor(r!.minutes / 60)}시간 ${r!.minutes % 60}분(${HRX_DAY_KIND_KO[r!.dayKind] ?? r!.dayKind})을 신청했습니다.` };
  });
}

/** POST /admin/me/hrx/overtime — 본인 신청 */
export async function requestMyOvertime(db: DatabaseService, actor: string | null, b: OtInput) {
  const me = await needMe(db, actor);
  return insertRequest(db, me, b, actor);
}

/** POST /admin/hrx/overtime — 관리자가 대신 신청(본인 것은 내 인사에서) */
export async function requestOvertimeFor(db: DatabaseService, employeeId: string, b: OtInput, actor: string | null) {
  const e = await empById(db, employeeId);
  notSelf(e, actor);
  return insertRequest(db, e, b, actor);
}

/** POST /admin/me/hrx/overtime/{id}/cancel — 본인 · 승인 전만 */
export async function cancelMyOvertime(db: DatabaseService, actor: string | null, id: string) {
  const me = await needMe(db, actor);
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  const r = await db.query<{ id: string }>(
    `UPDATE hrx_ot_requests SET state = 'CANCELED', decided_at = now(), decide_note = '본인 취소'
      WHERE id = $1::bigint AND employee_id = $2::bigint AND state = 'REQUESTED' RETURNING id::text AS id`, [id, me.id]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM hrx_ot_requests WHERE id = $1::bigint AND employee_id = $2::bigint`, [id, me.id]);
    if (!x) throw new NotFound('없는 신청입니다.');
    throw new StateConflict('HRX_OT_STATE', '승인 전 신청만 본인이 취소합니다.');
  }
  return { ok: true, id, note: '연장 근로 신청을 취소했습니다.' };
}

export interface OtRow { id: string; employeeId: string; name: string; workOn: string; startAt: string; endAt: string; minutes: number; nightMin: number; dayKind: string;
  reason: string; state: string; decideNote: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string; accountId: string | null; base: number;
  inAt: string | null; outAt: string | null; linkAmount: number | null; linkYm: string | null }

const OT_SELECT = `SELECT r.id::text AS id, r.employee_id::text AS "employeeId", e.name, r.work_on::text AS "workOn", r.start_at AS "startAt", r.end_at AS "endAt",
       r.minutes, r.night_min AS "nightMin", r.day_kind AS "dayKind", r.reason, r.state, r.decide_note AS "decideNote", d.email AS "decidedBy", r.decided_at AS "decidedAt",
       r.created_at AS "createdAt", e.account_id::text AS "accountId", e.monthly_base::float8 AS base, a.in_at AS "inAt", a.out_at AS "outAt",
       l.amount::float8 AS "linkAmount", pr.ym AS "linkYm"
  FROM hrx_ot_requests r JOIN acct_employees e ON e.id = r.employee_id
  LEFT JOIN accounts d ON d.id = r.decided_by
  LEFT JOIN acct_attendance a ON a.employee_id = r.employee_id AND a.work_on = r.work_on
  LEFT JOIN hrx_ot_pay_links l ON l.request_id = r.id
  LEFT JOIN acct_payroll_runs pr ON pr.id = l.run_id`;

/** 근태와 비교 — 겹친 분 · 표시 · 수당에 쓸 분 · 야간 분 */
function compare(x: OtRow, rules: OtRules, today: string) {
  const s = Date.parse(x.startAt), t = Date.parse(x.endAt);
  let actualMin: number | null = null, actualNight = 0, flag = 'OK';
  if (!x.inAt) flag = x.workOn < today ? 'NO_ATTEND' : 'FUTURE';
  else if (!x.outAt) flag = x.workOn < today ? 'NO_OUT' : 'WORKING';
  else {
    const a = Math.max(s, Date.parse(x.inAt)), b = Math.min(t, Date.parse(x.outAt));
    actualMin = Math.max(0, Math.floor((b - a) / 60000));
    actualNight = b > a ? hrxNightMinutes(a, b) : 0;
    if (actualMin < x.minutes - 10) flag = 'SHORT';
  }
  const useMin = rules.basis === 'REQUEST' ? x.minutes : Math.min(x.minutes, actualMin ?? 0);
  const useNight = rules.basis === 'REQUEST' ? x.nightMin : Math.min(x.nightMin, actualNight);
  const hourly = Math.floor(Number(x.base || 0) / rules.stdHours);
  return { actualMin, flag, payMin: useMin, payNight: useNight, hourly, pay: hrxOtPay(useMin, useNight, x.dayKind, hourly, rules.rates) };
}
const FLAG_KO: Record<string, string> = { OK: '맞음', NO_ATTEND: '근태 없음', NO_OUT: '퇴근 없음', SHORT: '근태가 짧음', FUTURE: '아직', WORKING: '일하는 중' };

function shape(x: OtRow, rules: OtRules, today: string) {
  const c = compare(x, rules, today);
  return { id: x.id, employeeId: x.employeeId, name: x.name, workOn: x.workOn, startHm: hrxHm(Date.parse(x.startAt)), endHm: hrxHm(Date.parse(x.endAt)),
           minutes: x.minutes, nightMin: x.nightMin, dayKind: x.dayKind, reason: x.reason, state: x.state, decideNote: x.decideNote, decidedBy: x.decidedBy, decidedAt: x.decidedAt,
           inHm: x.inAt ? hrxHm(Date.parse(x.inAt)) : null, outHm: x.outAt ? hrxHm(Date.parse(x.outAt)) : null, actualMin: c.actualMin, flag: c.flag, flagKo: FLAG_KO[c.flag] ?? c.flag,
           hourly: c.hourly, payMin: c.payMin, payNight: c.payNight, pay: c.pay, paidYm: x.linkYm, paidAmount: x.linkAmount };
}

/** GET /admin/hrx/overtime?state=&ym= — 관리자 목록 · 직원별 주 합계 · 규칙 */
export async function overtimeList(db: DatabaseService, stateIn?: string, ymIn?: string) {
  const st = stateIn && ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'].includes(stateIn) ? stateIn : '';
  const ym = ymIn && YM.test(ymIn) ? ymIn : kstToday().slice(0, 7);
  const rules = await otRules(db), today = kstToday();
  const rows = await db.query<OtRow>(
    OT_SELECT + ` WHERE (to_char(r.work_on, 'YYYY-MM') = $1 OR r.state = 'REQUESTED') AND ($2::text = '' OR r.state = $2)
      ORDER BY (r.state = 'REQUESTED') DESC, r.work_on DESC, r.id DESC LIMIT 500`, [ym, st]);
  const items = rows.map((x) => shape(x, rules, today));
  const weeks = await db.query<{ employeeId: string; name: string; monday: string; approved: number; requested: number }>(
    `SELECT r.employee_id::text AS "employeeId", e.name, date_trunc('week', r.work_on)::date::text AS monday,
            coalesce(sum(r.minutes) FILTER (WHERE r.state = 'APPROVED'), 0)::int AS approved, coalesce(sum(r.minutes) FILTER (WHERE r.state = 'REQUESTED'), 0)::int AS requested
       FROM hrx_ot_requests r JOIN acct_employees e ON e.id = r.employee_id
      WHERE r.state IN ('REQUESTED', 'APPROVED') AND r.work_on >= ($1 || '-01')::date - 6 AND r.work_on < ($1 || '-01')::date + interval '1 month'
      GROUP BY r.employee_id, e.name, date_trunc('week', r.work_on) ORDER BY monday DESC, e.name`, [ym]);
  const warnMin = Math.max(0, rules.warn - rules.base) * 60;
  const employees = await db.query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM acct_employees WHERE left_on IS NULL OR left_on >= $1::date ORDER BY joined_on, id`, [today]);
  return { ym, state: st || null, rules, items, pending: items.filter((x) => x.state === 'REQUESTED').length, employees,
           weeks: weeks.map((w) => ({ ...w, total: w.approved + w.requested, warn: w.approved + w.requested > warnMin, over: w.approved + w.requested > rules.otMax * 60 })),
           kinds: HRX_DAY_KIND_KO,
           note: `주 ${rules.base}시간 + 연장 ${rules.otMax}시간(휴일 근로 포함)이 한도 · ${rules.warn}시간을 넘으면 경고 · 가산 연장 ${rules.rates.OT}% · 야간 ${rules.rates.NIGHT}% · 휴일 ${rules.rates.HOL}%(8시간 넘으면 ${rules.rates.HOL8}%) — 일반 원칙 값(SUPER 고침 · 노무사 확인).` };
}

/** POST /admin/hrx/overtime/{id}/decide — 승인 · 반려(관리자 · 본인 아님 · 주 한도) */
export async function decideOvertime(db: DatabaseService, id: string, decision: string, noteIn: string | undefined, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  if (!['APPROVE', 'REJECT'].includes(decision)) throw new PolicyViolation('HRX_OT_DECISION', '승인(APPROVE) · 반려(REJECT) 중 하나입니다.');
  const note = clean(noteIn).slice(0, 200) || null;
  if (decision === 'REJECT' && (!note || note.length < 2)) throw new PolicyViolation('HRX_OT_REASON', '반려는 사유를 2자 이상 적습니다.');
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string; employee_id: string; work_on: string; minutes: number; state: string }>(
      `SELECT id::text AS id, employee_id::text AS employee_id, work_on::text AS work_on, minutes, state FROM hrx_ot_requests WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!r) throw new NotFound('없는 신청입니다.');
    if (r.state !== 'REQUESTED') throw new StateConflict('HRX_OT_STATE', '승인 · 반려는 신청 상태에서만 합니다.');
    const e = await empById(db, r.employee_id);
    notSelf(e, actor);
    if (decision === 'REJECT') {
      await db.query(`UPDATE hrx_ot_requests SET state = 'REJECTED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, note]);
      return { ok: true, id, state: 'REJECTED', note: `${e.name} 님 연장 근로 신청을 반려했습니다.` };
    }
    const rules = await otRules(db);
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('hrx_ot:' || $1::text))`, [r.employee_id]);
    const w = await weekUse(db, r.employee_id, hrxMonday(r.work_on), id);
    const after = w.approved + r.minutes;
    if (rules.block && after > rules.otMax * 60) {
      throw new PolicyViolation('HRX_OT_LIMIT', `승인하면 이번 주 연장 · 휴일 근로가 ${Math.round(after / 6) / 10}시간으로 한도 ${rules.otMax}시간을 넘습니다(설정 hrx.week_limits · hrx.ot_over_block).`);
    }
    await db.query(`UPDATE hrx_ot_requests SET state = 'APPROVED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, note]);
    return { ok: true, id, state: 'APPROVED', weekApproved: after, warning: weekWarning(rules, after, w.requested), note: `${e.name} 님 연장 근로를 승인했습니다.` };
  });
}

/** POST /admin/hrx/overtime/{id}/revoke — 승인 취소(본인 아님 · 사유 · 급여 대장에 넘기기 전만) */
export async function revokeOvertime(db: DatabaseService, id: string, reasonIn: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  const reason = clean(reasonIn);
  if (reason.length < 2 || reason.length > 150) throw new PolicyViolation('HRX_OT_REASON', '사유는 2 ~ 150자입니다.');
  return db.transaction(async () => {
    const [r] = await db.query<{ employee_id: string; state: string; paid: boolean }>(
      `SELECT employee_id::text AS employee_id, state, EXISTS (SELECT 1 FROM hrx_ot_pay_links l WHERE l.request_id = r.id) AS paid FROM hrx_ot_requests r WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!r) throw new NotFound('없는 신청입니다.');
    if (r.state !== 'APPROVED') throw new StateConflict('HRX_OT_STATE', '승인한 연장 근로만 승인 취소합니다.');
    if (r.paid) throw new StateConflict('HRX_OT_PAID', '급여 대장에 넘긴 연장 근로입니다 — 급여 대장 넘김을 먼저 되돌리십시오.');
    const e = await empById(db, r.employee_id);
    notSelf(e, actor);
    await db.query(`UPDATE hrx_ot_requests SET state = 'CANCELED', decided_by = $2::uuid, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, `승인 취소 · ${reason}`]);
    return { ok: true, id, state: 'CANCELED', note: `${e.name} 님 연장 근로 승인을 취소했습니다.` };
  });
}

/* ── 가산율 · 한도 고치기(SUPER · 사유) — 설정 바뀜 기록은 site_settings 트리거가 남김 ── */
export interface OtRulesInput { rates?: string; weekLimits?: string; stdHours?: number; block?: boolean; satHoliday?: boolean; basis?: string; reason?: string }
export async function setOtRules(db: DatabaseService, b: OtRulesInput) {
  const reason = clean(b.reason);
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('HRX_OT_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  if (b.rates !== undefined) { if (!HRX_OT_RATES_RE.test(b.rates)) throw new PolicyViolation('HRX_OT_RULE', '가산율은 OT:50,NIGHT:50,HOL:50,HOL8:100 모양입니다.'); set.push(['hrx.ot_rates', b.rates]); }
  if (b.weekLimits !== undefined) {
    if (!HRX_WEEK_LIMITS_RE.test(b.weekLimits)) throw new PolicyViolation('HRX_OT_RULE', '주 한도는 BASE:40,OT:12,WARN:48 모양입니다.');
    const w = parsePairs(b.weekLimits);
    if (!((w.BASE ?? 0) <= (w.WARN ?? 0) && (w.WARN ?? 0) <= (w.BASE ?? 0) + (w.OT ?? 0))) throw new PolicyViolation('HRX_OT_RULE', '경고 시간은 기본 시간 이상 · 기본 + 연장 한도 이하입니다.');
    set.push(['hrx.week_limits', b.weekLimits]);
  }
  if (b.stdHours !== undefined) { if (!HRX_STD_HOURS_RE.test(String(b.stdHours))) throw new PolicyViolation('HRX_OT_RULE', '통상시급 나눗수는 100 ~ 249 시간입니다.'); set.push(['hrx.std_month_hours', String(b.stdHours)]); }
  if (b.block !== undefined) set.push(['hrx.ot_over_block', b.block ? 'on' : 'off']);
  if (b.satHoliday !== undefined) set.push(['hrx.sat_as_holiday', b.satHoliday ? 'on' : 'off']);
  if (b.basis !== undefined) { if (!(HRX_PAY_BASES as readonly string[]).includes(b.basis)) throw new PolicyViolation('HRX_OT_RULE', '수당 기준은 MIN · REQUEST 중 하나입니다.'); set.push(['hrx.ot_pay_basis', b.basis]); }
  if (!set.length) throw new PolicyViolation('HRX_OT_RULE', '바꿀 값이 없습니다.');
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2 WHERE key = $1`, [k, v]);
  });
  return { ok: true, rules: await otRules(db), changed: set.map(([k]) => k), note: `연장 근로 규칙 ${set.length}개를 바꿨습니다 — 이미 급여 대장에 넘긴 금액은 그대로입니다.` };
}

/* ── 급여 대장으로 넘기기 ── */
async function runOf(db: DatabaseService, ym: string, lock = false) {
  const [run] = await db.query<{ id: string; state: string }>('SELECT id::text AS id, state FROM acct_payroll_runs WHERE ym = $1' + (lock ? ' FOR UPDATE' : ''), [ym]);
  return run ?? null;
}

/** GET /admin/hrx/overtime/payroll?ym= — 넘길 것 · 넘긴 것 미리보기 */
export async function overtimePayroll(db: DatabaseService, ymIn: string) {
  if (!YM.test(ymIn ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const rules = await otRules(db), today = kstToday();
  const run = await runOf(db, ymIn);
  const rows = await db.query<OtRow>(OT_SELECT + ` WHERE to_char(r.work_on, 'YYYY-MM') = $1 AND r.state = 'APPROVED' ORDER BY e.name, r.work_on, r.id`, [ymIn]);
  const items = rows.map((x) => shape(x, rules, today));
  const ready = items.filter((x) => !x.paidYm), done = items.filter((x) => x.paidYm);
  const byEmp = new Map<string, { employeeId: string; name: string; count: number; minutes: number; amount: number }>();
  for (const x of ready) {
    const g = byEmp.get(x.employeeId) ?? (byEmp.set(x.employeeId, { employeeId: x.employeeId, name: x.name, count: 0, minutes: 0, amount: 0 }), byEmp.get(x.employeeId)!);
    g.count++; g.minutes += x.payMin; g.amount += x.pay;
  }
  return { ym: ymIn, run, basis: rules.basis, ready, done, byEmployee: [...byEmp.values()], total: [...byEmp.values()].reduce((a, g) => a + g.amount, 0),
           note: run?.state === 'DRAFT' ? '「급여 대장에 넘기기」를 누르면 직원별 지급액에 더하고 세금 · 4대보험을 다시 셉니다.'
             : run ? '확정 · 지급한 급여 대장에는 넘기지 않습니다.' : '그 달 급여 대장(초안)을 먼저 만드십시오(회계 › 인사 › 급여).' };
}

/** POST /admin/hrx/overtime/payroll — 승인분 수당을 초안 급여 대장 지급액에 더함(신청 하나 한 번) */
export async function pushOvertimePayroll(db: DatabaseService, ym: string, actor: string | null) {
  if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const rules = await otRules(db), today = kstToday();
  return db.transaction(async () => {
    const run = await runOf(db, ym, true);
    if (!run) throw new PolicyViolation('HRX_OT_NO_RUN', '그 달 급여 대장이 없습니다 — 회계 › 인사 › 급여에서 먼저 만드십시오.');
    if (run.state !== 'DRAFT') throw new StateConflict('HRX_OT_RUN_FIXED', '확정한 급여 대장에는 넘기지 않습니다.');
    const rows = await db.query<OtRow>(
      OT_SELECT + ` WHERE to_char(r.work_on, 'YYYY-MM') = $1 AND r.state = 'APPROVED' AND l.id IS NULL ORDER BY r.employee_id, r.id FOR UPDATE OF r`, [ym]);
    const lines = await db.query<{ id: string; employeeId: string; gross: number }>(
      `SELECT id::text AS id, employee_id::text AS "employeeId", gross::float8 AS gross FROM acct_payroll_lines WHERE run_id = $1::bigint`, [run.id]);
    const lineOf = new Map(lines.map((l) => [l.employeeId, l]));
    const skipped: Array<{ id: string; name: string; why: string }> = [];
    const add = new Map<string, number>();
    let pushed = 0, amount = 0;
    for (const x of rows) {
      const line = lineOf.get(x.employeeId);
      if (!line) { skipped.push({ id: x.id, name: x.name, why: '그 달 급여 줄 없음' }); continue; }
      const c = compare(x, rules, today);
      await db.query(
        `INSERT INTO hrx_ot_pay_links (request_id, run_id, line_id, paid_min, night_min, hourly, amount, basis, created_by)
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4::int, $5::int, $6::bigint, $7::bigint, $8, $9::uuid)`,
        [x.id, run.id, line.id, c.payMin, c.payNight, c.hourly, c.pay, rules.basis, actor]);
      add.set(line.id, (add.get(line.id) ?? 0) + c.pay);
      pushed++; amount += c.pay;
    }
    for (const [lineId, plus] of add) {
      const line = lines.find((l) => l.id === lineId)!;
      if (plus > 0) await updateLine(db, lineId, { gross: Math.round(Number(line.gross) + plus) });
    }
    return { ok: true, ym, runId: run.id, pushed, amount, lines: add.size, skipped,
             note: pushed ? `연장 근로 ${pushed}건 · ${amount.toLocaleString('ko-KR')}원을 ${ym} 급여 대장(${add.size}명)에 더했습니다 — 세금 · 4대보험을 다시 셈했습니다.` : '넘길 승인분이 없습니다.' };
  });
}

/** POST /admin/hrx/overtime/payroll/undo — 초안 급여 대장에 넘긴 것을 되돌림(지급액에서 뺌 · 넘김 기록 지움) */
export async function undoOvertimePayroll(db: DatabaseService, ym: string) {
  if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  return db.transaction(async () => {
    const run = await runOf(db, ym, true);
    if (!run) throw new PolicyViolation('HRX_OT_NO_RUN', '그 달 급여 대장이 없습니다.');
    if (run.state !== 'DRAFT') throw new StateConflict('HRX_OT_RUN_FIXED', '확정한 급여 대장은 되돌리지 않습니다.');
    const sums = await db.query<{ lineId: string; amount: number; n: number; gross: number }>(
      `SELECT l.line_id::text AS "lineId", sum(l.amount)::float8 AS amount, count(*)::int AS n, max(p.gross)::float8 AS gross
         FROM hrx_ot_pay_links l JOIN acct_payroll_lines p ON p.id = l.line_id WHERE l.run_id = $1::bigint GROUP BY l.line_id`, [run.id]);
    let n = 0, amount = 0;
    for (const s of sums) {
      await db.query(`DELETE FROM hrx_ot_pay_links WHERE run_id = $1::bigint AND line_id = $2::bigint`, [run.id, s.lineId]);
      await updateLine(db, s.lineId, { gross: Math.max(0, Math.round(Number(s.gross) - Number(s.amount))) });
      n += s.n; amount += Number(s.amount);
    }
    return { ok: true, ym, undone: n, amount, note: n ? `${ym} 급여 대장에서 연장 근로 ${n}건 · ${amount.toLocaleString('ko-KR')}원을 뺐습니다.` : '되돌릴 것이 없습니다.' };
  });
}

/* ── 내 연장 근로 ── */
export async function myOvertime(db: DatabaseService, actor: string | null) {
  const me = await myEmployee(db, actor);
  if (!me) return { linked: false, items: [], week: null };
  const rules = await otRules(db), today = kstToday();
  const rows = await db.query<OtRow>(OT_SELECT + ` WHERE r.employee_id = $1::bigint ORDER BY r.work_on DESC, r.id DESC LIMIT 40`, [me.id]);
  const monday = hrxMonday(today);
  const w = await weekUse(db, me.id, monday);
  return { linked: true, items: rows.map((x) => { const s = shape(x, rules, today); return { ...s, hourly: undefined, pay: undefined }; }),
           week: { monday, ...w, warnHours: rules.warn, limitHours: rules.base + rules.otMax, warning: weekWarning(rules, w.approved, w.requested) } };
}

/* ── 정기 작업 hrx_ot_week(매일 09:50) — 이번 주 WARN − BASE 시간을 넘은 직원 수 → HRX_OT_WEEK(주에 하나 · 이름 없이 수만) ── */
export async function otWeekJob(db: DatabaseService) {
  const rules = await otRules(db), monday = hrxMonday(kstToday());
  const warnMin = Math.max(0, rules.warn - rules.base) * 60;
  const [c] = await db.query<{ n: number; over: number }>(
    `SELECT count(*) FILTER (WHERE m > $2::int)::int AS n, count(*) FILTER (WHERE m > $3::int)::int AS over FROM (
       SELECT employee_id, sum(minutes) AS m FROM hrx_ot_requests WHERE state IN ('REQUESTED', 'APPROVED') AND work_on BETWEEN $1::date AND ($1::date + 6) GROUP BY employee_id) x`,
    [monday, warnMin, rules.otMax * 60]);
  const n = c?.n ?? 0, over = c?.over ?? 0;
  const open = await db.query<{ id: string; key: string }>(`SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'HRX_OT_WEEK' AND resolved_at IS NULL`);
  let resolved = 0;
  for (const x of open) if (x.key !== monday || n === 0) {
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint`, [x.id, n === 0 ? '넘은 직원 없음' : '지난주']);
    resolved++;
  }
  let made = 0;
  if (n > 0) {
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'HRX_OT_WEEK', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'HRX_OT_WEEK' AND detail->>'key' = $4)
       ON CONFLICT DO NOTHING RETURNING id`,
      [over > 0 ? 'CRITICAL' : 'WARN', `이번 주(${monday} ~) 연장 · 휴일 근로가 주 ${rules.warn}시간을 넘은 직원 ${n}명${over ? ` · 한도 넘음 ${over}명` : ''} — 회계 › 인사 › 연장 근로`,
       JSON.stringify({ key: monday, monday, count: n, over, warnHours: rules.warn, limitHours: rules.base + rules.otMax }), monday]);
    made = ins.length;
  }
  return { monday, count: n, over, made, resolved };
}

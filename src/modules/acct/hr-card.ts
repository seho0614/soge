import { DatabaseService } from '../../db/database.service';
import { NotFound } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { piiReason } from '../../core/pii-audit.interceptor';
import { attendanceMonth, kstToday } from './hr';
import { leaveBook, severanceEstimate } from './severance';
import { myTraining } from './hr-training';
import { myReviews } from './hr-review';
import { hrxAddDays, hrxMonday, otRules } from './hrx-overtime';
import { shiftWeek } from './hrx-shifts';

/* ---------------------------------------------------------------------
 * v10.559 (docs/698) 사원 카드 — 대표 11/21 승인
 *   GET /admin/hr/employees/{id}/card — 직원 한 사람의 인사 정보를 한 장에(읽기만 · SUPER · 지급 담당 · 급여 탭과 같은 범위)
 *   ① 기본       acct_employees · 연결 운영 계정(가린 메일 · 운영 역할) · 재직일
 *   ② 근태 · 휴가 이번 달 집계(hr.attendanceMonth) · 남은 연차(severance.leaveBook) · 최근 휴가 신청 5
 *   ③ 급여       월 기본급 · 비과세 · 부양가족 · 최근 6개월 급여 줄(저장된 값 그대로) · 퇴직금 추계(severance.severanceEstimate)
 *   ④ 계약 · 교육 · 평가  근로계약서 최근 5(본문 없음) · 의무교육 지금 기간(hr-training.myTraining) · 인사 평가 최근 4(hr-review.myReviews — 상사 점수 · 등급은 닫은 뒤만)
 *   ⑤ 근무       연장 근로 이번 주 · 이번 달 분(신청 · 승인) · 최근 5 · 이번 주 근무표(hrx-shifts.shiftWeek)
 *   셈은 새로 만들지 않고 기존 함수를 부른 뒤 이 직원 줄만 고름 · 주민등록번호 · 계좌 · 계약서 본문 · 평가 의견은 넣지 않음
 *   열람 사유 — 회원 상세와 같은 머리글 X-PII-Reason(piiReason) · 없으면 「미입력」(막지 않음) · 개인정보 접속기록(audit.pii_access_logs)에 「사원 카드(직원 n) · 사유 …」
 *   칸 하나가 실패해도 나머지는 보이게(errors 에 칸 이름) · SQL 값은 모두 $n.
 * ------------------------------------------------------------------- */

const ID_RE = /^\d{1,18}$/;
const maskMail = (e: string | null) => {
  if (!e) return null;
  if (e.includes('*')) return e;   // 이미 가린 값(탈퇴 등)은 그대로
  const [u, d] = e.split('@');
  return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

/** 화면의 「자세히」 단추가 갈 탭 */
export const HR_CARD_LINKS = {
  attendance: 'hr-attend', leave: 'hr-leave', payroll: 'acct-payroll', payslip: 'acct-payslip', severance: 'acct-severance',
  contract: 'hr-contract', training: 'hr-training', review: 'hr-review', overtime: 'hrx-overtime', shifts: 'hrx-shifts',
} as const;

export interface HrCardEmpRow { id: string; name: string; joinedOn: string; leftOn: string | null; monthlyBase: number; nontax: number; dependents: number; memo: string | null; accountId: string | null }

async function part<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) {
    errors.push(name);
    console.error('[HR_CARD_PART]', name, (e as Error)?.message);
    return null;
  }
}

/** GET /admin/hr/employees/{id}/card */
export async function hrCard(db: DatabaseService, id: string, reasonHeader?: string) {
  if (!ID_RE.test(String(id ?? ''))) throw new NotFound('직원이 없습니다.');
  const [e] = await db.query<HrCardEmpRow>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", coalesce(monthly_base, 0)::float8 AS "monthlyBase",
            coalesce(nontax, 0)::float8 AS nontax, dependents, memo, account_id::text AS "accountId"
       FROM acct_employees WHERE id = $1::bigint`, [id]);
  if (!e) throw new NotFound('직원이 없습니다.');

  /* 열람 사유 — 회원 상세(@PiiAccess)와 같은 글 모양 · 직원 번호는 uuid 가 아니라 대상 칸은 연결 계정(없으면 비움) */
  const why = piiReason(reasonHeader);
  const actor = RequestCtx.actorId() ?? null;
  if (actor) {
    await db.query(
      `INSERT INTO audit.pii_access_logs (actor_account_id, target_type, target_account_id, access_type, reason, ip)
       VALUES ($1::uuid, 'EMPLOYEE', $2::uuid, 'VIEW', $3, $4::inet)`,
      [actor, e.accountId, `사원 카드(직원 ${e.id}) · 사유 ${why}`, RequestCtx.get()?.ip ?? null],
    ).catch((x: Error) => console.error('[PII_AUDIT_FAILED]', 'EMPLOYEE', x.message));
  }

  const today = kstToday(), ym = today.slice(0, 7), year = Number(today.slice(0, 4));
  const monday = hrxMonday(today), sunday = hrxAddDays(monday, 6);
  const errors: string[] = [];
  const end = e.leftOn && e.leftOn < today ? e.leftOn : today;
  const serviceDays = Math.max(0, daysBetween(e.joinedOn, end) + 1);

  /* ① 기본 */
  const account = await part('account', errors, async () => {
    if (!e.accountId) return { linked: false, email: null, roles: [] as string[] };
    const [a] = await db.query<{ email: string | null; roles: string[] }>(
      `SELECT a.email, coalesce(array(SELECT r.role FROM account_roles r WHERE r.account_id = a.id AND r.role <> 'MEMBER' ORDER BY r.role), '{}') AS roles
         FROM accounts a WHERE a.id = $1::uuid`, [e.accountId]);
    return { linked: true, email: maskMail(a?.email ?? null), roles: a?.roles ?? [] };
  });

  /* ② 근태 · 휴가 */
  const attendance = await part('attendance', errors, async () => {
    const m = await attendanceMonth(db, ym);
    const s = m.summary.find((x) => x.employeeId === e.id) ?? null;
    return { ym, workStart: m.workStart, summary: s ? { days: s.days, hours: s.hours, late: s.late, open: s.open, confirmed: s.confirmed, leaveDays: s.leaveDays } : null };
  });
  const leave = await part('leave', errors, async () => {
    const b = await leaveBook(db, year);
    const r = b.rows.find((x) => x.employeeId === e.id) ?? null;
    const requests = await db.query(
      `SELECT id::text AS id, start_on::text AS "startOn", end_on::text AS "endOn", half, days::float8 AS days, state, created_at AS "createdAt"
         FROM acct_leave_requests WHERE employee_id = $1::bigint ORDER BY id DESC LIMIT 5`, [e.id]);
    return { year, granted: r?.granted ?? null, used: r?.used ?? null, remaining: r?.remaining ?? null, suggest: r?.suggest ?? null, requests };
  });

  /* ③ 급여 */
  const payLines = await part('payroll', errors, () => db.query(
    `SELECT l.id::text AS id, r.ym, r.state, r.pay_day::text AS "payDay", l.gross::float8 AS gross, l.nontax::float8 AS nontax,
            (l.income_tax + l.local_tax)::float8 AS tax, (l.np + l.hi + l.ltc + l.ei)::float8 AS ins, l.net::float8 AS net
       FROM acct_payroll_lines l JOIN acct_payroll_runs r ON r.id = l.run_id
      WHERE l.employee_id = $1::bigint ORDER BY r.ym DESC LIMIT 6`, [e.id]));
  const severance = await part('severance', errors, async () => {
    const s = await severanceEstimate(db, ym);
    const r = s.rows.find((x) => x.employeeId === e.id);
    return r ? { asOf: s.asOf, serviceDays: r.serviceDays, eligible: r.eligible, dailyAvg: r.dailyAvg, estimate: r.estimate, basis: r.basis } : null;
  });

  /* ④ 계약 · 교육 · 평가 */
  const contracts = await part('contract', errors, () => db.query<{ id: string; title: string; state: string }>(
    `SELECT id::text AS id, title, state, sign_mode AS "signMode", sent_at AS "sentAt", signed_at AS "signedAt", created_at AS "createdAt"
       FROM hr_contracts WHERE employee_id = $1::bigint ORDER BY id DESC LIMIT 5`, [e.id]));
  const training = await part('training', errors, async () => (await myTraining(db, e.id)).items);
  const reviews = await part('review', errors, async () => (await myReviews(db, e.id) as Array<{
    cycle: { id: string; year: number; quarter: number; title: string; state: string };
    goals: unknown[]; result: { selfSubmittedAt: string | null; mgrAvg: number | null; grade: string | null } | null; selfAvg: number | null }>)
    .map((x) => ({ cycleId: x.cycle.id, year: x.cycle.year, quarter: x.cycle.quarter, title: x.cycle.title, state: x.cycle.state, goals: x.goals.length,
                   selfSubmittedAt: x.result?.selfSubmittedAt ?? null, selfAvg: x.selfAvg, mgrAvg: x.result?.mgrAvg ?? null, grade: x.result?.grade ?? null })));

  /* ⑤ 근무 */
  const overtime = await part('overtime', errors, async () => {
    const [s] = await db.query<{ wa: number; wr: number; ma: number; mr: number; pending: number }>(
      `SELECT coalesce(sum(minutes) FILTER (WHERE state = 'APPROVED' AND work_on BETWEEN $2::date AND $3::date), 0)::int AS wa,
              coalesce(sum(minutes) FILTER (WHERE state = 'REQUESTED' AND work_on BETWEEN $2::date AND $3::date), 0)::int AS wr,
              coalesce(sum(minutes) FILTER (WHERE state = 'APPROVED' AND to_char(work_on, 'YYYY-MM') = $4::text), 0)::int AS ma,
              coalesce(sum(minutes) FILTER (WHERE state = 'REQUESTED' AND to_char(work_on, 'YYYY-MM') = $4::text), 0)::int AS mr,
              count(*) FILTER (WHERE state = 'REQUESTED')::int AS pending
         FROM hrx_ot_requests WHERE employee_id = $1::bigint`, [e.id, monday, sunday, ym]);
    const rules = await otRules(db);
    const recent = await db.query(
      `SELECT id::text AS id, work_on::text AS "workOn", minutes, night_min AS "nightMin", day_kind AS "dayKind", state
         FROM hrx_ot_requests WHERE employee_id = $1::bigint ORDER BY work_on DESC, id DESC LIMIT 5`, [e.id]);
    const h = (m: number) => Math.round((m ?? 0) / 6) / 10;
    return { monday, sunday, ym,
             week: { approvedMin: s?.wa ?? 0, requestedMin: s?.wr ?? 0, hours: h((s?.wa ?? 0) + (s?.wr ?? 0)) },
             month: { approvedMin: s?.ma ?? 0, requestedMin: s?.mr ?? 0, hours: h((s?.ma ?? 0) + (s?.mr ?? 0)) },
             pending: s?.pending ?? 0, limits: { base: rules.base, otMax: rules.otMax, warn: rules.warn }, recent };
  });
  const shifts = await part('shifts', errors, async () => {
    const w = await shiftWeek(db, monday);
    const r = w.rows.find((x) => x.employeeId === e.id);
    return r ? { monday: w.monday, sunday: w.sunday, days: w.days, plannedHours: r.plannedHours, overBase: r.overBase, overLimit: r.overLimit,
                 cells: r.cells.map((c) => ({ day: c.day, inRange: c.inRange, shift: c.shift ? { name: c.shift.name, kind: c.shift.kind, startHm: c.shift.startHm, endHm: c.shift.endHm } : null,
                                              att: c.att, leaveDays: c.leaveDays, flagsKo: c.flagsKo })) }
             : { monday: w.monday, sunday: w.sunday, days: w.days, plannedHours: 0, overBase: false, overLimit: false, cells: [] };
  });

  const signed = (contracts ?? []).find((c) => c.state === 'SIGNED');
  const live = (contracts ?? []).find((c) => c.state !== 'CANCELED');
  return {
    employee: { id: e.id, name: e.name, joinedOn: e.joinedOn, leftOn: e.leftOn, active: !e.leftOn || e.leftOn >= today, serviceDays,
                serviceYears: Math.floor(serviceDays / 365), memo: e.memo, account },
    attendance, leave,
    pay: { monthlyBase: e.monthlyBase, nontax: e.nontax, dependents: e.dependents, lines: payLines ?? [], severance },
    docs: { contractState: signed ? 'SIGNED' : live ? live.state : 'NONE', contracts: contracts ?? [], training: training ?? [],
            trainingUndone: (training ?? []).filter((t) => !t.done).length, reviews: reviews ?? [] },
    work: { overtime, shifts },
    links: HR_CARD_LINKS, viewReason: why, errors, today,
    note: '읽기만 하는 한 장입니다 — 고치기는 칸마다 「자세히」로 그 탭에서 합니다. 주민등록번호 · 계좌 · 계약서 본문 · 평가 의견은 넣지 않습니다. 연 기록은 감사(HR_CARD_VIEW)와 개인정보 접속기록에 남습니다.',
  };
}

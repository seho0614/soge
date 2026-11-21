import { DatabaseService } from '../../db/database.service';
import { myHr, kstToday } from './hr';
import { myTraining } from './hr-training';
import { myContracts } from './hr-contract';
import { myReviews } from './hr-review';
import { hrxAddDays, hrxMonday, otRules } from './hrx-overtime';
import { shiftWeek } from './hrx-shifts';

/* ---------------------------------------------------------------------
 * v10.567 (docs/709) 내 사원 카드(본인) — 대표 11/21 승인
 *   GET /admin/me/hr/card — 로그인한 운영 계정에 연결된 직원(acct_employees.account_id = 나 · 재직 중)의 인사 정보를 한 장에(읽기만)
 *   관리자 판(hr-card.ts · v10.559)과 칸 모양을 맞추되 본인에게 맞게 다름:
 *     · 직원 번호를 받지 않음 — 늘 나 자신(남의 것은 길이 없음) · 연결이 없으면 404 가 아니라 200 + { linked: false }
 *     · 급여는 금액 줄 · 월 기본급 · 비과세 대신 「내 급여명세서 목록」(확정 · 지급한 것 · lineId → GET /admin/me/hr/payslips/{lineId})
 *     · 퇴직금 추계 없음(관리자 판만) · 관리자 메모(acct_employees.memo) 없음 · 연차 제안 일수 없음
 *     · 평가는 닫힌(CLOSED) 차례의 내 결과만 — 등급 · 상사 평균 · 내 평균 · 목표 수(의견 · 평가자 메모 · 목표별 점수 없음)
 *     · 계약서는 내가 받은 것(보냄 · 서명함)만(hr-contract.myContracts · 서명 주소 뺌)
 *     · 열람 사유 묻지 않음 · 개인정보 접속기록 · 감사 남기지 않음(본인 것 · 개인정보를 베끼지 않음)
 *   셈은 새로 만들지 않음 — myHr(근태 · 연차 · 휴가 · 명세서 목록) · myTraining · myContracts · myReviews · otRules · shiftWeek 를 부른 뒤 내 줄만 고름
 *   칸 하나가 실패해도 나머지는 보이게(errors 에 칸 이름) · SQL 값은 모두 $n.
 * ------------------------------------------------------------------- */

/** 화면의 「자세히」 — 본인 카드는 늘 내 인사 화면 안(관리자 탭으로 보내지 않음) */
export const MY_HR_CARD_LINKS = {
  attendance: 'my-hr', leave: 'my-hr', payslip: 'my-hr', contract: 'my-hr', training: 'my-hr', review: 'my-hr', overtime: 'my-hr', shifts: 'my-hr',
} as const;

interface MyHrSelfRes {
  linked: boolean; note?: string;
  employee?: { id: string; name: string; joinedOn: string };
  today?: { inHm: string; outHm: string | null } | null;
  month?: { ym: string; workStart: string; summary?: { days: number; hours: number; late: number; open: number; confirmed: number; leaveDays: number } };
  leave?: { granted: number; used: number; remaining: number };
  requests?: Array<{ id: string; startOn: string; endOn: string; half: string; days: number; state: string }>;
  payslips?: Array<{ id: string; ym: string; payDay: string | null }>;
}
interface SelfReviewRow {
  cycle: { id: string; year: number; quarter: number; title: string; state: string };
  goals: unknown[]; result: { selfSubmittedAt: string | null; mgrAvg: number | null; grade: string | null } | null; selfAvg: number | null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

async function selfPart<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) {
    errors.push(name);
    console.error('[HR_CARD_SELF_PART]', name, (e as Error)?.message);
    return null;
  }
}

/** GET /admin/me/hr/card */
export async function hrCardSelf(db: DatabaseService, actor: string | null) {
  const h = (await myHr(db, actor)) as unknown as MyHrSelfRes;
  if (!h.linked || !h.employee) {
    return { linked: false, self: true, note: '이 계정에 연결된 직원이 없습니다 — SUPER 에게 연결을 부탁하십시오(회계 › 인사 › 근태).' };
  }
  const id = h.employee.id;
  const today = kstToday(), ym = today.slice(0, 7), year = Number(today.slice(0, 4));
  const monday = hrxMonday(today), sunday = hrxAddDays(monday, 6);
  const errors: string[] = [];

  /* ① 기본 — 관리자 메모 · 금액 칸은 고르지 않음 */
  const [e] = await db.query<{ joinedOn: string; leftOn: string | null; dependents: number }>(
    `SELECT joined_on::text AS "joinedOn", left_on::text AS "leftOn", dependents FROM acct_employees WHERE id = $1::bigint`, [id]);
  const joinedOn = e?.joinedOn ?? h.employee.joinedOn, leftOn = e?.leftOn ?? null;
  const end = leftOn && leftOn < today ? leftOn : today;
  const serviceDays = Math.max(0, daysBetween(joinedOn, end) + 1);
  const account = await selfPart('account', errors, async () => {
    const rs = await db.query<{ role: string }>(
      `SELECT role FROM account_roles WHERE account_id = $1::uuid AND role <> 'MEMBER' ORDER BY role`, [actor]);
    return { linked: true, roles: rs.map((r) => r.role) };
  });

  /* ② 근태 · 휴가 — myHr 결과에서 고름 */
  const s = h.month?.summary ?? null;
  const attendance = h.month ? {
    ym: h.month.ym, workStart: h.month.workStart,
    today: h.today ? { inHm: h.today.inHm, outHm: h.today.outHm } : null,
    summary: s ? { days: s.days, hours: s.hours, late: s.late, open: s.open, confirmed: s.confirmed, leaveDays: s.leaveDays } : null,
  } : null;
  const leave = {
    year, granted: h.leave?.granted ?? null, used: h.leave?.used ?? null, remaining: h.leave?.remaining ?? null,
    requests: (h.requests ?? []).slice(0, 5).map((r) => ({ id: r.id, startOn: r.startOn, endOn: r.endOn, half: r.half, days: r.days, state: r.state })),
  };

  /* ③ 급여 — 금액 대신 명세서 목록(확정 · 지급만 · myHr 와 같음) */
  const payslips = (h.payslips ?? []).slice(0, 12).map((p) => ({ lineId: p.id, ym: p.ym, payDay: p.payDay }));

  /* ④ 계약 · 교육 · 평가 */
  const contracts = await selfPart('contract', errors, async () =>
    (await myContracts(db, id) as Array<{ id: string; title: string; state: string; signMode: string | null; sentAt: string | null; signedAt: string | null }>)
      .slice(0, 5).map((c) => ({ id: c.id, title: c.title, state: c.state, signMode: c.signMode, sentAt: c.sentAt, signedAt: c.signedAt })));
  const training = await selfPart('training', errors, async () => (await myTraining(db, id)).items);
  const reviews = await selfPart('review', errors, async () => (await myReviews(db, id) as SelfReviewRow[])
    .filter((x) => x.cycle.state === 'CLOSED')
    .map((x) => ({ cycleId: x.cycle.id, year: x.cycle.year, quarter: x.cycle.quarter, title: x.cycle.title, state: x.cycle.state, goals: x.goals.length,
                   selfSubmittedAt: x.result?.selfSubmittedAt ?? null, selfAvg: x.selfAvg, mgrAvg: x.result?.mgrAvg ?? null, grade: x.result?.grade ?? null })));

  /* ⑤ 근무 — 관리자 판과 같은 셈(내 직원 번호만) */
  const overtime = await selfPart('overtime', errors, async () => {
    const [o] = await db.query<{ wa: number; wr: number; ma: number; mr: number; pending: number }>(
      `SELECT coalesce(sum(minutes) FILTER (WHERE state = 'APPROVED' AND work_on BETWEEN $2::date AND $3::date), 0)::int AS wa,
              coalesce(sum(minutes) FILTER (WHERE state = 'REQUESTED' AND work_on BETWEEN $2::date AND $3::date), 0)::int AS wr,
              coalesce(sum(minutes) FILTER (WHERE state = 'APPROVED' AND to_char(work_on, 'YYYY-MM') = $4::text), 0)::int AS ma,
              coalesce(sum(minutes) FILTER (WHERE state = 'REQUESTED' AND to_char(work_on, 'YYYY-MM') = $4::text), 0)::int AS mr,
              count(*) FILTER (WHERE state = 'REQUESTED')::int AS pending
         FROM hrx_ot_requests WHERE employee_id = $1::bigint`, [id, monday, sunday, ym]);
    const rules = await otRules(db);
    const recent = await db.query(
      `SELECT id::text AS id, work_on::text AS "workOn", minutes, night_min AS "nightMin", day_kind AS "dayKind", state
         FROM hrx_ot_requests WHERE employee_id = $1::bigint ORDER BY work_on DESC, id DESC LIMIT 5`, [id]);
    const hr = (m: number) => Math.round((m ?? 0) / 6) / 10;
    return { monday, sunday, ym,
             week: { approvedMin: o?.wa ?? 0, requestedMin: o?.wr ?? 0, hours: hr((o?.wa ?? 0) + (o?.wr ?? 0)) },
             month: { approvedMin: o?.ma ?? 0, requestedMin: o?.mr ?? 0, hours: hr((o?.ma ?? 0) + (o?.mr ?? 0)) },
             pending: o?.pending ?? 0, limits: { base: rules.base, otMax: rules.otMax, warn: rules.warn }, recent };
  });
  const shifts = await selfPart('shifts', errors, async () => {
    const w = await shiftWeek(db, monday);
    const r = w.rows.find((x) => x.employeeId === id);   // 내 줄만 — 다른 직원 줄은 응답에 넣지 않음
    return r ? { monday: w.monday, sunday: w.sunday, plannedHours: r.plannedHours, overBase: r.overBase, overLimit: r.overLimit,
                 cells: r.cells.map((c) => ({ day: c.day, inRange: c.inRange, shift: c.shift ? { name: c.shift.name, kind: c.shift.kind, startHm: c.shift.startHm, endHm: c.shift.endHm } : null,
                                              att: c.att, leaveDays: c.leaveDays, flagsKo: c.flagsKo })) }
             : { monday: w.monday, sunday: w.sunday, plannedHours: 0, overBase: false, overLimit: false, cells: [] };
  });

  const cs = contracts ?? [];
  const signed = cs.find((c) => c.state === 'SIGNED');
  const live = cs.find((c) => c.state !== 'CANCELED');
  return {
    linked: true, self: true,
    employee: { id, name: h.employee.name, joinedOn, leftOn, active: !leftOn || leftOn >= today, serviceDays, serviceYears: Math.floor(serviceDays / 365),
                dependents: e?.dependents ?? null, account },
    attendance, leave,
    pay: { payslips },
    docs: { contractState: signed ? 'SIGNED' : live ? live.state : 'NONE', contracts: cs, training: training ?? [],
            trainingUndone: (training ?? []).filter((t) => !t.done).length, reviews: reviews ?? [] },
    work: { overtime, shifts },
    links: MY_HR_CARD_LINKS, errors, today,
    note: '내 인사 정보를 한 장에 모았습니다(읽기만) — 출퇴근 · 휴가 신청 · 명세서 인쇄 · 교육 제출 · 계약서 서명 · 목표 · 자기 평가는 아래 각 칸에서 합니다. 평가는 닫힌 차례의 내 결과만 보입니다.',
  };
}

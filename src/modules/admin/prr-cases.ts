import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskEmail } from '../../common/mask';
import { addEmployee, updateEmployee } from '../acct/payroll';
import { myTraining } from '../acct/hr-training';
import { severanceEstimate } from '../acct/severance';
import { STAFF_ROLES, kstToday, revokeAll } from './staff';
import { permLog } from './perm-sets';
import { errOf } from './prr-review';

/* ---------------------------------------------------------------------
 * v10.568 (docs/710) 직원 입사 · 퇴사 흐름 — 대표 11/21 「모두 개발진행」
 *   흐름(prr_cases) = 직원 하나 · 종류(JOIN 입사 · LEAVE 퇴사)마다 열린 것 하나 · 단계는 대부분 기존 표를 보고 저절로 「됨」
 *   입사 JOIN  ① EMPLOYEE 직원 대장(흐름을 열 때 새로 넣거나 고름 · payroll.addEmployee 재사용)
 *              ② INVITE 운영 계정 초대(메일 짝 맞추기용으로 적어 둠 · 안내문 · 메일은 보내지 않음) ③ ACCOUNT 계정 연결(acct_employees.account_id — 역할 주기에서 직원을 고르면 이어짐 · v10.563)
 *              ④ ROLE_GROUP 운영 역할 + 권한그룹 하나 이상 ⑤ CONTRACT 근로계약서 서명(hr_contracts SIGNED) ⑥ TRAINING 의무교육 지금 기간 모두 이수(hr-training.myTraining)
 *   퇴사 LEAVE ① LEFT_ON 퇴사일(흐름을 열 때 넣음 · payroll.updateEmployee 재사용 → D291 트리거가 STAFF_LEFT_ROLE)
 *              ② ROLES 운영 역할 · 권한그룹 · 개별 권한 0(「권한 거두기」 = staff.revokeAll 재사용 + 권한그룹 · 개별 지움)
 *              ③ ASSETS 맡은 IT 자산(its_assets.owner_id · ACTIVE) 0 — IT 자산 · 구독 탭에서 담당을 바꾸거나 해지
 *              ④ SEVERANCE 퇴직금 추계 확인(재직 1년 미만은 저절로 됨 · severance.severanceEstimate 재사용 · 금액은 SUPER 만)
 *              ⑤ DOCS 서류 보관 기한(근로기준법 42조 3년 · 국세기본법 5년 — 일반 원칙 값 · SUPER 고침)
 *   손으로 「됨」은 INVITE · SEVERANCE · DOCS 만 · 「건너뜀」은 사유 2자 이상(EMPLOYEE · LEFT_ON 은 못 건너뜀)
 *   흐름이 열린 동안 운영 알림 STAFF_CASE_OPEN(INFO)이 풀리지 않음 · 기한 넘김 STAFF_JOIN_OVERDUE · STAFF_LEAVE_OVERDUE(정기 작업 prr_daily) · 끝내기 · 취소 때 셋 다 풂
 *   주소는 /admin/staff/cases(/admin/acct 밖 — 세무사는 못 봄) · 보기 ADMIN · 고치기 SUPER · SQL 값은 모두 $n.
 * ------------------------------------------------------------------- */

export const CASE_KINDS = ['JOIN', 'LEAVE'] as const;
export const JOIN_STEPS = ['EMPLOYEE', 'INVITE', 'ACCOUNT', 'ROLE_GROUP', 'CONTRACT', 'TRAINING'] as const;
export const LEAVE_STEPS = ['LEFT_ON', 'ROLES', 'ASSETS', 'SEVERANCE', 'DOCS'] as const;
const MANUAL_STEPS = ['INVITE', 'SEVERANCE', 'DOCS'];
const CORE_STEPS = ['EMPLOYEE', 'LEFT_ON'];
export const STEP_KO: Record<string, string> = {
  EMPLOYEE: '직원 대장', INVITE: '운영 계정 초대', ACCOUNT: '계정 연결', ROLE_GROUP: '역할 · 권한그룹', CONTRACT: '근로계약서', TRAINING: '의무교육',
  LEFT_ON: '퇴사일', ROLES: '운영 권한 거두기', ASSETS: '장비 반납', SEVERANCE: '퇴직금 추계 확인', DOCS: '서류 보관 기한',
};
/** 단계마다 「자세히」가 갈 탭 */
export const STEP_GO: Record<string, string> = {
  EMPLOYEE: 'acct-payroll', ACCOUNT: 'roles', ROLE_GROUP: 'perm-staff', CONTRACT: 'hr-contract', TRAINING: 'hr-training',
  LEFT_ON: 'acct-payroll', ROLES: 'staff-list', ASSETS: 'its-assets', SEVERANCE: 'acct-severance', DOCS: 'corp-docs',
};
/** 이메일 모양 — DB prr_cases.invite_email CHECK 와 같음(pbulk 초대와 같은 식) */
export const PRR_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ID_RE = /^\d{1,18}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const reasonOk = (r: string | undefined, code = 'PRR_REASON') => {
  const t = clean(r);
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400e3).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
const addYears = (d: string, y: number) => `${Number(d.slice(0, 4)) + y}${d.slice(4)}`;
const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

export interface PrrCaseSettings { joinDays: number; leaveGrace: number; keepLabor: number; keepTax: number }
export async function caseSettings(db: DatabaseService): Promise<PrrCaseSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [['prr.join_days', 'prr.leave_grace', 'prr.keep_labor_years', 'prr.keep_tax_years']]);
  const n = (k: string, def: number, lo: number, hi: number) => { const v = Number((rows.find((r) => r.key === k)?.value ?? '').trim() || def); return Number.isInteger(v) && v >= lo && v <= hi ? v : def; };
  return { joinDays: n('prr.join_days', 14, 1, 60), leaveGrace: n('prr.leave_grace', 3, 0, 30), keepLabor: n('prr.keep_labor_years', 3, 1, 10), keepTax: n('prr.keep_tax_years', 5, 1, 10) };
}

interface CaseRow { id: string; employeeId: string; kind: string; state: string; targetOn: string; inviteEmail: string | null; invitedAt: string | null; note: string | null; openedAt: string; closedAt: string | null; closeNote: string | null }
interface EmpRow { id: string; name: string; joinedOn: string; leftOn: string | null; accountId: string | null }
export interface StepView { key: string; ko: string; state: 'DONE' | 'SKIP' | 'TODO'; how: 'AUTO' | 'MANUAL'; manual: boolean; detail: string; go: string | null; note?: string | null; data?: unknown }

async function caseRow(db: DatabaseService, id: string) {
  if (!ID_RE.test(String(id ?? ''))) throw new NotFound('없는 흐름입니다.');
  const [c] = await db.query<CaseRow>(
    `SELECT id::text AS id, employee_id::text AS "employeeId", kind, state, target_on::text AS "targetOn", invite_email AS "inviteEmail", invited_at AS "invitedAt",
            note, opened_at AS "openedAt", closed_at AS "closedAt", close_note AS "closeNote"
       FROM prr_cases WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 흐름입니다.');
  return c;
}
async function empRow(db: DatabaseService, id: string) {
  const [e] = await db.query<EmpRow>(
    `SELECT id::text AS id, name, joined_on::text AS "joinedOn", left_on::text AS "leftOn", account_id::text AS "accountId" FROM acct_employees WHERE id = $1::bigint`, [id]);
  if (!e) throw new NotFound('없는 직원입니다.');
  return e;
}

/** 흐름 하나의 단계 — full 이면 퇴직금 추계 금액(SUPER) · 자산 목록 같은 자세한 값까지 */
async function stepsOf(db: DatabaseService, c: CaseRow, e: EmpRow, superView: boolean, full: boolean) {
  const today = kstToday();
  const s = await caseSettings(db);
  const manual = new Map((await db.query<{ step: string; state: 'DONE' | 'SKIP'; note: string | null }>(
    `SELECT step, state, note FROM prr_case_steps WHERE case_id = $1::bigint`, [c.id])).map((r) => [r.step, r]));
  const acc = e.accountId
    ? (await db.query<{ roles: string[]; groups: number; overrides: number; assets: number; email: string | null; lastLoginAt: string | null }>(
        `SELECT coalesce((SELECT array_agg(r.role ORDER BY r.role) FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($2::text[])), '{}') AS roles,
                (SELECT count(*)::int FROM perm_account_groups g WHERE g.account_id = a.id AND (g.expires_at IS NULL OR g.expires_at > now())) AS groups,
                (SELECT count(*)::int FROM perm_account_overrides o WHERE o.account_id = a.id AND (o.expires_at IS NULL OR o.expires_at > now())) AS overrides,
                (SELECT count(*)::int FROM its_assets t WHERE t.owner_id = a.id AND t.state = 'ACTIVE') AS assets,
                a.email::text AS email, a.last_login_at AS "lastLoginAt"
           FROM accounts a WHERE a.id = $1::uuid`, [e.accountId, [...STAFF_ROLES]]))[0] ?? null
    : null;
  const out: StepView[] = [];
  const put = (key: string, autoDone: boolean, detail: string, data?: unknown) => {
    const m = manual.get(key);
    const state: StepView['state'] = autoDone ? 'DONE' : m ? m.state : 'TODO';
    out.push({ key, ko: STEP_KO[key] ?? key, state, how: MANUAL_STEPS.includes(key) ? 'MANUAL' : 'AUTO', manual: !!m, detail, go: STEP_GO[key] ?? null, note: m?.note ?? null, data });
  };
  if (c.kind === 'JOIN') {
    put('EMPLOYEE', true, `직원 번호 ${e.id} · 입사 ${e.joinedOn}`);
    put('INVITE', !!c.invitedAt || !!e.accountId,
        e.accountId ? '계정이 이미 연결돼 있습니다' : c.invitedAt ? `초대함 ${maskEmail(c.inviteEmail) ?? ''}` : '운영 계정 초대 메일을 적으면 가입한 계정을 찾아 줍니다');
    let found = false;
    if (!e.accountId && c.inviteEmail) {
      const [a] = await db.query<{ id: string }>(`SELECT id::text AS id FROM accounts WHERE lower(email) = lower($1)`, [c.inviteEmail]);
      found = !!a;
    }
    put('ACCOUNT', !!e.accountId,
        e.accountId ? `연결됨 ${superView ? acc?.email ?? '' : maskEmail(acc?.email ?? null) ?? ''}` : found ? '초대한 메일로 가입했습니다 — 역할 주기에서 이 직원을 고르면 연결됩니다' : '가입 기다림 — 가입하면 역할 주기에서 직원을 골라 연결합니다',
        { accountFound: found });
    put('ROLE_GROUP', !!acc && acc.roles.length > 0 && acc.groups > 0,
        acc ? `역할 ${acc.roles.join(', ') || '없음'} · 권한그룹 ${acc.groups}` : '계정 연결 뒤');
    const [ct] = await db.query<{ signed: number; sent: number; draft: number }>(
      `SELECT count(*) FILTER (WHERE state = 'SIGNED')::int AS signed, count(*) FILTER (WHERE state = 'SENT')::int AS sent, count(*) FILTER (WHERE state = 'DRAFT')::int AS draft
         FROM hr_contracts WHERE employee_id = $1::bigint`, [e.id]);
    put('CONTRACT', Number(ct?.signed ?? 0) > 0,
        Number(ct?.signed ?? 0) > 0 ? '서명함' : Number(ct?.sent ?? 0) > 0 ? '보냄 — 서명 기다림' : Number(ct?.draft ?? 0) > 0 ? '초안 — 보내기 전' : '계약서 없음');
    let tr: Array<{ name: string; done: boolean; dueOn: string }> = [];
    try { tr = (await myTraining(db, e.id)).items; } catch { tr = []; }
    const undone = tr.filter((t) => !t.done);
    put('TRAINING', undone.length === 0, undone.length ? `남은 교육 ${undone.length} — ${undone.map((t) => `${t.name}(${t.dueOn}까지)`).join(' · ')}`.slice(0, 300) : tr.length ? '지금 기간 모두 이수' : '교육 종류 없음');
  } else {
    put('LEFT_ON', !!e.leftOn, e.leftOn ? `퇴사 ${e.leftOn}` : '퇴사일 없음');
    const left = acc ? acc.roles.length + acc.groups + acc.overrides : 0;
    put('ROLES', !acc || left === 0,
        !acc ? '연결 계정 없음' : left === 0 ? '남은 운영 권한 없음' : `역할 ${acc.roles.join(', ') || '없음'} · 권한그룹 ${acc.groups} · 개별 ${acc.overrides} 남음`,
        acc ? { roles: acc.roles, groups: acc.groups, overrides: acc.overrides } : null);
    let assets: Array<{ id: string; name: string; kind: string; assetTag: string | null }> = [];
    if (acc && acc.assets > 0 && full) {
      assets = await db.query(`SELECT id::text AS id, name, kind, asset_tag AS "assetTag" FROM its_assets WHERE owner_id = $1::uuid AND state = 'ACTIVE' ORDER BY id LIMIT 50`, [e.accountId]);
    }
    put('ASSETS', !acc || acc.assets === 0, !acc ? '연결 계정 없음' : acc.assets === 0 ? '맡은 IT 자산 없음' : `맡은 IT 자산 ${acc.assets}개 — 담당을 바꾸거나 해지`, full ? { assets } : null);
    const end = e.leftOn ?? today;
    const serviceDays = Math.max(0, daysBetween(e.joinedOn, end) + 1);
    const eligible = serviceDays >= 365;
    let sev: unknown = null;
    if (full && eligible && superView) {
      try {
        let ym = (addDays(end, -1) < today ? addDays(end, -1) : today).slice(0, 7);
        if (monthEnd(ym) >= end) ym = prevYm(ym);
        const est = await severanceEstimate(db, ym);
        const r = est.rows.find((x) => x.employeeId === e.id);
        sev = r ? { ym, asOf: est.asOf, serviceDays: r.serviceDays, dailyAvg: r.dailyAvg, estimate: r.estimate, basis: r.basis } : { ym, missing: true };
      } catch { sev = null; }
    }
    put('SEVERANCE', !eligible, eligible ? `재직 ${serviceDays}일 — 퇴직금 대상(급여 › 퇴직금에서 정산 · 노무 확인 권함)` : `재직 ${serviceDays}일 — 1년 미만이라 퇴직금 없음(근로자퇴직급여 보장법 4조 일반 원칙)`, { serviceDays, eligible, estimate: sev });
    const docs = [
      { doc: '근로계약서', law: '근로기준법 42조', years: s.keepLabor },
      { doc: '근로자 명부', law: '근로기준법 42조', years: s.keepLabor },
      { doc: '임금대장 · 급여명세', law: '근로기준법 42조', years: s.keepLabor },
      { doc: '퇴직금 정산 · 해고 · 퇴직 서류', law: '근로기준법 42조', years: s.keepLabor },
      { doc: '급여 원천징수 장부 · 증빙', law: '국세기본법 85조의3', years: s.keepTax },
    ].map((d) => ({ ...d, keepUntil: e.leftOn ? addYears(e.leftOn, d.years) : null }));
    put('DOCS', false, `서류 ${docs.length}종 — 퇴사일부터 ${s.keepLabor}년 · 원천징수 ${s.keepTax}년 보관(일반 원칙 · 노무 · 세무 확인 권함)`, { docs });
  }
  const left = out.filter((x) => x.state === 'TODO').map((x) => x.key);
  return { steps: out, left, canClose: c.state === 'OPEN' && left.length === 0, settings: s };
}

/** GET /admin/staff/cases — 흐름 목록(열린 것 먼저 · 열린 것은 진행 정도) · SUPER 에게 직원 고르기 목록 */
export async function caseList(db: DatabaseService, superView: boolean) {
  const rows = await db.query<CaseRow & { name: string; joinedOn: string; leftOn: string | null; accountId: string | null }>(
    `SELECT c.id::text AS id, c.employee_id::text AS "employeeId", c.kind, c.state, c.target_on::text AS "targetOn", c.invite_email AS "inviteEmail", c.invited_at AS "invitedAt",
            c.note, c.opened_at AS "openedAt", c.closed_at AS "closedAt", c.close_note AS "closeNote",
            e.name, e.joined_on::text AS "joinedOn", e.left_on::text AS "leftOn", e.account_id::text AS "accountId"
       FROM prr_cases c JOIN acct_employees e ON e.id = c.employee_id
      ORDER BY (c.state = 'OPEN') DESC, c.opened_at DESC LIMIT 200`);
  const today = kstToday();
  const s = await caseSettings(db);
  const items = [];
  for (const r of rows) {
    let progress: { done: number; total: number; left: string[] } | null = null;
    if (r.state === 'OPEN') {
      try {
        const st = await stepsOf(db, r, { id: r.employeeId, name: r.name, joinedOn: r.joinedOn, leftOn: r.leftOn, accountId: r.accountId }, superView, false);
        progress = { done: st.steps.length - st.left.length, total: st.steps.length, left: st.left };
      } catch { progress = null; }
    }
    const due = r.kind === 'JOIN' ? addDays(r.targetOn, s.joinDays) : addDays(r.targetOn, s.leaveGrace);
    items.push({ id: r.id, employeeId: r.employeeId, name: r.name, kind: r.kind, state: r.state, targetOn: r.targetOn, dueOn: due,
                 overdue: r.state === 'OPEN' && due < today, openedAt: r.openedAt, closedAt: r.closedAt, progress });
  }
  const employees = superView
    ? await db.query(
        `SELECT e.id::text AS id, e.name, e.joined_on::text AS "joinedOn", e.left_on::text AS "leftOn", (e.account_id IS NOT NULL) AS linked,
                EXISTS (SELECT 1 FROM prr_cases c WHERE c.employee_id = e.id AND c.state = 'OPEN' AND c.kind = 'JOIN') AS "joinOpen",
                EXISTS (SELECT 1 FROM prr_cases c WHERE c.employee_id = e.id AND c.state = 'OPEN' AND c.kind = 'LEAVE') AS "leaveOpen"
           FROM acct_employees e WHERE e.left_on IS NULL OR e.left_on >= $1::date - 90 ORDER BY (e.left_on IS NULL) DESC, e.name, e.id LIMIT 500`, [today])
    : [];
  return { items, open: items.filter((x) => x.state === 'OPEN').length, overdue: items.filter((x) => x.overdue).length, employees, settings: s, canEdit: superView,
           note: '입사 · 퇴사 흐름은 단계 대부분이 저절로 「됨」이 됩니다(직원 대장 · 역할 · 권한그룹 · 근로계약서 · 의무교육 · IT 자산). 손으로 하는 것은 초대 · 퇴직금 확인 · 서류 보관뿐이고, 흐름이 끝날 때까지 운영 알림이 남습니다.' };
}

/** GET /admin/staff/cases/{id} */
export async function caseView(db: DatabaseService, id: string, superView: boolean) {
  const c = await caseRow(db, id);
  const e = await empRow(db, c.employeeId);
  const st = await stepsOf(db, c, e, superView, true);
  const today = kstToday();
  const due = c.kind === 'JOIN' ? addDays(c.targetOn, st.settings.joinDays) : addDays(c.targetOn, st.settings.leaveGrace);
  return {
    case: { ...c, inviteEmail: superView ? c.inviteEmail : maskEmail(c.inviteEmail), dueOn: due, overdue: c.state === 'OPEN' && due < today },
    employee: { id: e.id, name: e.name, joinedOn: e.joinedOn, leftOn: e.leftOn, linked: !!e.accountId },
    steps: st.steps, left: st.left, canClose: st.canClose, canEdit: superView && c.state === 'OPEN',
    note: c.kind === 'JOIN'
      ? '입사 — 직원 대장 → 운영 계정 초대 → 계정 연결(역할 주기에서 직원 고르기) → 역할 · 권한그룹 → 근로계약서 → 의무교육. 운영 계정이 필요 없는 직원은 초대 · 연결 · 역할을 사유와 함께 건너뜁니다.'
      : '퇴사 — 퇴사일 → 운영 권한 거두기 → 장비 반납 → 퇴직금 추계 확인 → 서류 보관 기한. 권한 거두기는 이 화면 단추(역할 · 권한그룹 · 개별 권한 모두)로 합니다.',
  };
}

async function openAlert(db: DatabaseService, caseId: string, kind: string, name: string, targetOn: string) {
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('STAFF_CASE_OPEN', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [`${kind === 'JOIN' ? '입사' : '퇴사'} 흐름 열림 — ${name} · ${targetOn} · 직원 · 권한 › 입사 · 퇴사(끝날 때까지 남음)`.slice(0, 280), JSON.stringify({ caseId, kind })]).catch(() => undefined);
}
async function resolveAlerts(db: DatabaseService, caseId: string, note: string) {
  await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2
      WHERE alert_code IN ('STAFF_CASE_OPEN', 'STAFF_JOIN_OVERDUE', 'STAFF_LEAVE_OVERDUE') AND resolved_at IS NULL AND detail->>'caseId' = $1`, [caseId, note.slice(0, 200)]).catch(() => undefined);
}

export interface PrrCaseOpenIn { kind?: string; employeeId?: string; name?: string; joinedOn?: string; monthlyBase?: number; nontax?: number; dependents?: number; leftOn?: string; note?: string }

/** POST /admin/staff/cases — 흐름 열기(SUPER) · 입사는 직원을 새로 넣을 수 있음 · 퇴사는 퇴사일을 넣음 */
export async function openCase(db: DatabaseService, b: PrrCaseOpenIn, actor: string | null) {
  const kind = String(b.kind ?? '');
  if (!(CASE_KINDS as readonly string[]).includes(kind)) throw new PolicyViolation('PRR_KIND', '흐름 종류는 JOIN(입사) · LEAVE(퇴사)입니다.');
  const note = clean(b.note).slice(0, 200);
  return db.transaction(async () => {
    let empId = String(b.employeeId ?? '').trim();
    if (kind === 'JOIN') {
      if (!empId) {
        if (!clean(b.name) || !DATE_RE.test(String(b.joinedOn ?? ''))) throw new PolicyViolation('PRR_EMPLOYEE', '직원을 고르거나 이름 · 입사일을 적어 새 직원을 넣으십시오.');
        const r = await addEmployee(db, { name: clean(b.name), joinedOn: b.joinedOn, monthlyBase: b.monthlyBase ?? 0, nontax: b.nontax ?? 0, dependents: b.dependents ?? 1 }, actor);
        empId = r.id;
      }
    } else if (!empId) throw new PolicyViolation('PRR_EMPLOYEE', '퇴사할 직원을 고르십시오.');
    if (!ID_RE.test(empId)) throw new PolicyViolation('PRR_EMPLOYEE', '직원 번호가 바르지 않습니다.');
    let e = await empRow(db, empId);
    const today = kstToday();
    if (kind === 'JOIN' && e.leftOn && e.leftOn < today) throw new PolicyViolation('PRR_EMPLOYEE', `${e.name} 님은 퇴사한 직원입니다.`);
    if (kind === 'LEAVE') {
      const lo = String(b.leftOn ?? '').trim();
      if (lo) {
        if (!DATE_RE.test(lo) || Number.isNaN(Date.parse(lo))) throw new PolicyViolation('PRR_LEFT_ON', '퇴사일이 바르지 않습니다.');
        if (lo < e.joinedOn) throw new PolicyViolation('PRR_LEFT_ON', '퇴사일은 입사일 뒤여야 합니다.');
        if (lo !== e.leftOn) { await updateEmployee(db, e.id, { leftOn: lo }); e = await empRow(db, empId); }
      }
      if (!e.leftOn) throw new PolicyViolation('PRR_LEFT_ON', '퇴사일을 적으십시오.');
    }
    const [dup] = await db.query<{ id: string }>(`SELECT id::text AS id FROM prr_cases WHERE employee_id = $1::bigint AND kind = $2 AND state = 'OPEN'`, [e.id, kind]);
    if (dup) throw new StateConflict('PRR_CASE_OPEN', `${e.name} 님의 ${kind === 'JOIN' ? '입사' : '퇴사'} 흐름이 이미 열려 있습니다(${dup.id}번).`);
    const targetOn = kind === 'JOIN' ? e.joinedOn : e.leftOn!;
    const [c] = await db.query<{ id: string }>(
      `INSERT INTO prr_cases (employee_id, kind, target_on, note, opened_by) VALUES ($1::bigint, $2, $3::date, nullif($4, ''), $5::uuid) RETURNING id::text AS id`,
      [e.id, kind, targetOn, note, actor]);
    await openAlert(db, c!.id, kind, e.name, targetOn);
    return { ok: true, id: c!.id, kind, employeeId: e.id, note: `${e.name} 님의 ${kind === 'JOIN' ? '입사' : '퇴사'} 흐름을 열었습니다 — 끝날 때까지 운영 알림이 남습니다.` };
  });
}

async function openCaseOf(db: DatabaseService, id: string, kind?: string) {
  const c = await caseRow(db, id);
  if (c.state !== 'OPEN') throw new StateConflict('PRR_CASE_CLOSED', '끝났거나 취소한 흐름입니다.');
  if (kind && c.kind !== kind) throw new PolicyViolation('PRR_KIND', kind === 'JOIN' ? '입사 흐름에서만 합니다.' : '퇴사 흐름에서만 합니다.');
  return c;
}

/** POST /admin/staff/cases/{id}/invite — 운영 계정 초대 메일 적기(입사 · SUPER) · 메일은 보내지 않고 안내문을 돌려줌 */
export async function inviteCase(db: DatabaseService, id: string, email: string | undefined, actor: string | null) {
  const c = await openCaseOf(db, id, 'JOIN');
  const em = clean(email).toLowerCase();
  if (!em || em.length > 120 || !PRR_EMAIL_RE.test(em)) throw new PolicyViolation('PRR_EMAIL', '메일 주소가 바르지 않습니다.');
  const e = await empRow(db, c.employeeId);
  if (e.accountId) throw new StateConflict('PRR_ALREADY_LINKED', `${e.name} 님은 이미 운영 계정과 연결돼 있습니다.`);
  await db.query(`UPDATE prr_cases SET invite_email = $2, invited_at = now() WHERE id = $1::bigint`, [c.id, em]);
  const [a] = await db.query<{ id: string }>(`SELECT id::text AS id FROM accounts WHERE lower(email) = $1`, [em]);
  void actor;
  return {
    ok: true, id: c.id, invited: maskEmail(em), accountFound: !!a,
    guide: `[소개뱅크 운영 계정 안내] ${e.name} 님, 소개뱅크 사용자 웹에서 이 메일(${em})로 회원 가입(본인 인증 포함)을 해 주십시오. 가입을 마치면 담당자가 운영 역할을 드립니다. 운영 화면은 회사 허용 IP 에서만 열리고, 처음 로그인 때 2단계 인증을 등록합니다.`,
    note: a ? '이 메일로 가입한 계정이 있습니다 — 역할 주기에서 이 직원을 골라 역할을 주면 연결됩니다.' : '초대 메일을 적어 두었습니다 — 메일은 보내지 않으니 안내문을 복사해 전하십시오.',
  };
}

/** PUT /admin/staff/cases/{id}/steps/{step} — 손으로 「됨」(초대 · 퇴직금 · 서류) · 「건너뜀」(사유) */
export async function setStep(db: DatabaseService, id: string, step: string, action: string | undefined, note: string | undefined, actor: string | null) {
  const c = await openCaseOf(db, id);
  const allowed: readonly string[] = c.kind === 'JOIN' ? JOIN_STEPS : LEAVE_STEPS;
  if (!allowed.includes(step)) throw new PolicyViolation('PRR_STEP', '이 흐름에 없는 단계입니다.');
  if (CORE_STEPS.includes(step)) throw new PolicyViolation('PRR_STEP_CORE', '직원 대장 · 퇴사일 단계는 건너뛰거나 손으로 바꾸지 않습니다.');
  const act = action === 'SKIP' ? 'SKIP' : action === 'DONE' ? 'DONE' : '';
  if (!act) throw new PolicyViolation('PRR_STEP', '「됨」(DONE) 또는 「건너뜀」(SKIP)을 고르십시오.');
  if (act === 'DONE' && !MANUAL_STEPS.includes(step)) throw new PolicyViolation('PRR_STEP_AUTO', `${STEP_KO[step]} 단계는 저절로 「됨」이 됩니다 — 그 탭에서 일을 마치거나 사유와 함께 건너뛰십시오.`);
  const t = clean(note).slice(0, 200);
  if (act === 'SKIP' && t.length < 2) throw new PolicyViolation('PRR_NOTE', '건너뛰는 사유를 2자 이상 적으십시오.');
  await db.query(
    `INSERT INTO prr_case_steps (case_id, step, state, note, done_by) VALUES ($1::bigint, $2, $3, nullif($4, ''), $5::uuid)
     ON CONFLICT (case_id, step) DO UPDATE SET state = EXCLUDED.state, note = EXCLUDED.note, done_by = EXCLUDED.done_by, done_at = now()`,
    [c.id, step, act, t, actor]);
  return { ok: true, id: c.id, step, state: act, note: `${STEP_KO[step]} — ${act === 'DONE' ? '됨' : '건너뜀'}으로 적었습니다.` };
}

/** DELETE /admin/staff/cases/{id}/steps/{step} — 손으로 적은 것 되돌리기 */
export async function undoStep(db: DatabaseService, id: string, step: string) {
  const c = await openCaseOf(db, id);
  const r = await db.query(`DELETE FROM prr_case_steps WHERE case_id = $1::bigint AND step = $2 RETURNING step`, [c.id, step]);
  if (!r.length) throw new NotFound('손으로 적은 것이 없습니다.');
  return { ok: true, id: c.id, step, state: 'TODO', note: `${STEP_KO[step] ?? step} — 되돌렸습니다.` };
}

/** POST /admin/staff/cases/{id}/revoke — 퇴사자 운영 권한 모두 거두기(SUPER · 사유) — 역할(staff.revokeAll) + 권한그룹 · 개별 권한 */
export async function revokeCase(db: DatabaseService, id: string, reason: string | undefined, actor: string | null) {
  const why = reasonOk(reason);
  const c = await openCaseOf(db, id, 'LEAVE');
  const e = await empRow(db, c.employeeId);
  if (!e.accountId) throw new StateConflict('PRR_NO_ACCOUNT', `${e.name} 님은 연결된 운영 계정이 없습니다(거둘 것 없음).`);
  if (actor && actor === e.accountId) throw new Forbidden('SELF_GRANT', '자신의 권한은 거둘 수 없습니다.');
  let revoked: string[] = [];
  try {
    revoked = (await revokeAll(db, e.accountId, `퇴사 흐름 — ${why}`.slice(0, 200), actor)).revoked;
  } catch (x) {
    if (errOf(x).code !== 'NO_SUCH_ROLE') throw x;   // 역할이 이미 없으면 권한그룹 · 개별만
  }
  const [g, o] = await db.transaction(async () => [
    await db.query(`DELETE FROM perm_account_groups WHERE account_id = $1::uuid RETURNING group_key`, [e.accountId]),
    await db.query(`DELETE FROM perm_account_overrides WHERE account_id = $1::uuid RETURNING id`, [e.accountId]),
  ] as const);
  if (g.length || o.length) await permLog(db, 'ACCOUNT', e.accountId, 'PRR_LEAVE_REVOKE', { groups: g.length, overrides: o.length, caseId: c.id }, `퇴사 흐름 — ${why}`.slice(0, 200), actor);
  if (!revoked.length && !g.length && !o.length) throw new StateConflict('NO_SUCH_ROLE', '거둘 운영 권한이 없습니다.');
  return { ok: true, id: c.id, revoked, groups: g.length, overrides: o.length,
           note: `운영 역할 ${revoked.length}개 · 권한그룹 ${g.length} · 개별 권한 ${o.length}을 거두었습니다.` };
}

/** POST /admin/staff/cases/{id}/close — 끝내기(남은 단계 0 · SUPER) · 초대 메일 지움 · 알림 풂 */
export async function closeCase(db: DatabaseService, id: string, note: string | undefined, actor: string | null) {
  const c = await openCaseOf(db, id);
  const e = await empRow(db, c.employeeId);
  const st = await stepsOf(db, c, e, true, false);
  if (st.left.length) {
    const names = st.left.map((k) => STEP_KO[k] ?? k).join(' · ');
    throw new StateConflict('PRR_STEPS_LEFT', `남은 단계가 있습니다 — ${names}(그 탭에서 마치거나 사유와 함께 건너뛰십시오).`);
  }
  const t = clean(note).slice(0, 200);
  const r = await db.query(
    `UPDATE prr_cases SET state = 'DONE', closed_by = $2::uuid, closed_at = now(), close_note = nullif($3, ''), invite_email = NULL
      WHERE id = $1::bigint AND state = 'OPEN' RETURNING id`, [c.id, actor, t]);
  if (!r.length) throw new StateConflict('PRR_CASE_CLOSED', '끝났거나 취소한 흐름입니다.');
  await resolveAlerts(db, c.id, `흐름 끝냄${t ? ` — ${t}` : ''}`);
  return { ok: true, id: c.id, state: 'DONE', note: `${e.name} 님의 ${c.kind === 'JOIN' ? '입사' : '퇴사'} 흐름을 끝냈습니다.` };
}

/** POST /admin/staff/cases/{id}/cancel — 취소(사유 · SUPER) · 퇴사일 · 거둔 권한은 되돌리지 않음 */
export async function cancelCase(db: DatabaseService, id: string, reason: string | undefined, actor: string | null) {
  const why = reasonOk(reason);
  const c = await openCaseOf(db, id);
  await db.query(
    `UPDATE prr_cases SET state = 'CANCELED', closed_by = $2::uuid, closed_at = now(), close_note = $3, invite_email = NULL WHERE id = $1::bigint AND state = 'OPEN'`, [c.id, actor, why]);
  await resolveAlerts(db, c.id, `흐름 취소 — ${why}`);
  return { ok: true, id: c.id, state: 'CANCELED', note: '흐름을 취소했습니다 — 퇴사일 · 거둔 권한은 그대로입니다(필요하면 급여 › 직원 · 역할 주기에서).' };
}

/** 정기 작업(prr_daily) — 기한 넘긴 열린 흐름에 알림 한 번(흐름마다) */
export async function casesDaily(db: DatabaseService) {
  const s = await caseSettings(db);
  const today = kstToday();
  const leave = await db.query<{ id: string }>(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'STAFF_LEAVE_OVERDUE', 'WARN', left('퇴사 흐름 기한 넘김 — ' || e.name || ' · 퇴사 ' || c.target_on::text || ' · 권한 거두기 · 장비 반납을 확인하십시오(직원 · 권한 › 입사 · 퇴사)', 280),
            jsonb_build_object('caseId', c.id::text, 'employeeId', e.id::text), clock_timestamp() + (row_number() OVER (ORDER BY c.id)) * interval '1 microsecond'
       FROM prr_cases c JOIN acct_employees e ON e.id = c.employee_id
      WHERE c.kind = 'LEAVE' AND c.state = 'OPEN' AND c.target_on + $1::int < $2::date
        AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'STAFF_LEAVE_OVERDUE' AND a.detail->>'caseId' = c.id::text)
      LIMIT 50
     ON CONFLICT DO NOTHING RETURNING id::text AS id`, [s.leaveGrace, today]);
  const join = await db.query<{ id: string }>(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'STAFF_JOIN_OVERDUE', 'INFO', left('입사 흐름 기한 넘김 — ' || e.name || ' · 입사 ' || c.target_on::text || ' · 계정 · 근로계약서 · 의무교육을 확인하십시오(직원 · 권한 › 입사 · 퇴사)', 280),
            jsonb_build_object('caseId', c.id::text, 'employeeId', e.id::text), clock_timestamp() + (row_number() OVER (ORDER BY c.id)) * interval '1 microsecond'
       FROM prr_cases c JOIN acct_employees e ON e.id = c.employee_id
      WHERE c.kind = 'JOIN' AND c.state = 'OPEN' AND c.target_on + $1::int < $2::date
        AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'STAFF_JOIN_OVERDUE' AND a.detail->>'caseId' = c.id::text)
      LIMIT 50
     ON CONFLICT DO NOTHING RETURNING id::text AS id`, [s.joinDays, today]);
  return { leaveOverdue: leave.length, joinOverdue: join.length };
}

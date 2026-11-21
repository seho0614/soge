import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskEmail } from '../../common/mask';

/* ---------------------------------------------------------------------
 * v10.561 ~ 563 (D291 · docs/702 ~ 705) 회원 · 직원 권한 분리 A안 — 대표 11/21 승인
 *   계정 표(accounts)는 하나 · 화면 · 규칙만 나눔. 「운영자」 = 운영 역할(account_roles) 하나 이상(새 역할 만들지 않음).
 *   v10.561 운영자 목록(직원 · 권한 › 운영자 목록) — 운영 역할 있는 계정만 · 연결 직원 · 역할 · 기한 · 2단계 · 마지막 로그인 · 붙은 권한그룹 수
 *   v10.563 역할 주기 때 직원 대장 연결 필수(안쪽 역할) · 외부 역할(세무사 · 파트너 담당)은 연결 없이 되지만 기한 꼭
 *           직원 퇴사 → 운영 역할이 남으면 STAFF_LEFT_ROLE(D291 트리거) · 「운영 역할 모두 거두기」(SUPER) 로 풀림
 *   옛 운영자 중 직원 연결 없는 계정은 막지 않음 — 목록에 「직원 연결 없음」만 표시.
 *   SQL 값은 모두 $n · 자리값 하나를 두 형에 쓰지 않음.
 * ------------------------------------------------------------------- */

/** 운영 역할(mfa.service OPS_ROLES 와 같은 목록 · 순서는 화면 표시 순서) */
export const STAFF_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;
/** 외부 역할 — 직원 대장 연결 없이 줄 수 있지만 기한 꼭(세무사 공유 계정 · 바깥 파트너 담당) */
export const EXTERNAL_ROLES = ['ACCOUNTANT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;
/** 안쪽 역할 — 직원 대장(acct_employees.account_id) 연결이 있어야 줌 */
export const INTERNAL_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER'] as const;

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isExternal = (r: string) => (EXTERNAL_ROLES as readonly string[]).includes(r);
const isInternal = (r: string) => (INTERNAL_ROLES as readonly string[]).includes(r);

export interface StaffRow {
  id: string; name: string | null; email: string | null; status: string; roles: string[]; expiresAt: string | null; external: boolean;
  employeeId: string | null; employeeName: string | null; joinedOn: string | null; leftOn: string | null;
  mfa: boolean; lastLoginAt: string | null; groups: number;
}

/** GET /admin/staff — 운영자 목록(ADMIN · SUPER 읽기 · 메일은 SUPER 만 원문) */
export async function staffList(db: DatabaseService, superView: boolean) {
  const today = kstToday();
  const rows = await db.query<StaffRow>(
    `SELECT a.id::text AS id, a.name, a.email::text AS email, a.status,
            array_agg(DISTINCT r.role) AS roles,
            min(r.expires_at) AS "expiresAt",
            bool_and(r.role = ANY($1::text[])) AS external,
            e.id::text AS "employeeId", e.name AS "employeeName", e.joined_on::text AS "joinedOn", e.left_on::text AS "leftOn",
            (m.enabled_at IS NOT NULL) AS mfa, a.last_login_at AS "lastLoginAt",
            (SELECT count(*)::int FROM perm_account_groups g WHERE g.account_id = a.id AND (g.expires_at IS NULL OR g.expires_at > now())) AS groups
       FROM accounts a
       JOIN account_roles r ON r.account_id = a.id AND r.role = ANY($2::text[])
       LEFT JOIN acct_employees e ON e.account_id = a.id
       LEFT JOIN account_mfa m ON m.account_id = a.id
      GROUP BY a.id, e.id, m.enabled_at
      ORDER BY (a.status = 'ACTIVE') DESC, a.last_login_at DESC NULLS LAST
      LIMIT 500`, [[...EXTERNAL_ROLES], [...STAFF_ROLES]]);
  const order = (rs: string[]) => [...rs].sort((x, y) => (STAFF_ROLES as readonly string[]).indexOf(x) - (STAFF_ROLES as readonly string[]).indexOf(y));
  const items = rows.map((r) => {
    const left = !!r.leftOn && r.leftOn < today;
    return {
      ...r, roles: order(r.roles ?? []), email: superView ? r.email : maskEmail(r.email),
      noEmployee: !r.employeeId,                       // 옛 계정 · 외부 역할 — 막지 않고 표시만
      leftWithRole: left,                              // 퇴사한 직원인데 운영 역할 남음(STAFF_LEFT_ROLE)
      externalNoExpiry: r.external && !r.employeeId && !r.expiresAt,
    };
  });
  const free = superView
    ? await db.query<{ id: string; name: string; joinedOn: string }>(
        `SELECT id::text AS id, name, joined_on::text AS "joinedOn" FROM acct_employees
          WHERE account_id IS NULL AND (left_on IS NULL OR left_on >= $1::date) ORDER BY name, id LIMIT 300`, [today])
    : [];
  return {
    items, total: items.length,
    noEmployee: items.filter((x) => x.noEmployee && x.status === 'ACTIVE').length,
    leftWithRole: items.filter((x) => x.leftWithRole).length,
    noMfa: items.filter((x) => !x.mfa && x.status === 'ACTIVE').length,
    freeEmployees: free,
    note: '운영 역할(검수 · 운영 · 지급 · 최고 · 파트너 담당 · 세무사)이 하나라도 있는 계정입니다. 「직원 연결 없음」은 막지 않고 표시만 합니다 — 새로 줄 때는 직원 대장 연결이 필요합니다(외부 역할은 기한 꼭).',
  };
}

/** 계정에 연결된 직원(오늘 기준 퇴사 전) */
export async function linkedEmployee(db: DatabaseService, accountId: string) {
  const [e] = await db.query<{ id: string; name: string; leftOn: string | null }>(
    `SELECT id::text AS id, name, left_on::text AS "leftOn" FROM acct_employees
      WHERE account_id = $1::uuid AND (left_on IS NULL OR left_on >= $2::date)`, [accountId, kstToday()]);
  return e ?? null;
}

/**
 * v10.563 — 역할 주기 전에 부름(report.service setRole · 거래 안 · grant 일 때만).
 *   안쪽 역할: 연결 직원이 있으면 통과 · 없으면 employeeId 로 그 자리에서 연결(퇴사 전 · 다른 계정과 연결 안 된 직원) · 둘 다 없으면 422 STAFF_EMPLOYEE_REQUIRED
 *   외부 역할: 연결 직원이 있으면 통과 · 없으면 기한(expiresDays) 꼭 · 없으면 422 STAFF_EXTERNAL_EXPIRY
 *   (직원 ↔ 계정 연결 API(PUT /admin/hr/employees/{id}/account)는 운영 역할이 있어야 연결해 주므로, 처음 줄 때는 여기서 함께 연결)
 */
export async function assertStaffGrant(db: DatabaseService, accountId: string, role: string, expiresDays?: number | null, employeeId?: string | null) {
  if (!isInternal(role) && !isExternal(role)) return { linked: null as string | null };
  const cur = await linkedEmployee(db, accountId);
  if (cur) return { linked: cur.id };
  if (isExternal(role)) {
    if (!expiresDays) throw new PolicyViolation('STAFF_EXTERNAL_EXPIRY', '직원 대장에 연결되지 않은 계정에 외부 역할(세무사 · 파트너 담당)을 줄 때는 기한(7 · 30 · 90일)을 꼭 고르십시오.');
    return { linked: null };
  }
  const eid = String(employeeId ?? '').trim();
  if (!eid) throw new PolicyViolation('STAFF_EMPLOYEE_REQUIRED', '운영 역할(검수 · 운영 · 지급 · 최고)은 직원 대장(회계 › 인사 › 급여 › 직원)에 있는 직원과 연결해야 줄 수 있습니다 — 직원을 고르십시오.');
  if (!/^\d{1,18}$/.test(eid)) throw new PolicyViolation('STAFF_EMPLOYEE_REQUIRED', '직원 번호가 바르지 않습니다.');
  const [e] = await db.query<{ id: string; name: string; accountId: string | null; leftOn: string | null }>(
    `SELECT id::text AS id, name, account_id::text AS "accountId", left_on::text AS "leftOn" FROM acct_employees WHERE id = $1::bigint FOR UPDATE`, [eid]);
  if (!e) throw new NotFound('직원이 없습니다.');
  if (e.leftOn && e.leftOn < kstToday()) throw new PolicyViolation('STAFF_EMPLOYEE_LEFT', `${e.name} 님은 퇴사한 직원입니다.`);
  if (e.accountId && e.accountId !== accountId) throw new StateConflict('HR_LINK_TAKEN', `${e.name} 님은 이미 다른 계정과 연결돼 있습니다.`);
  /* 한 계정은 한 직원(uq_acct_employees_account) — 같은 계정에 남은 퇴사 직원 연결은 풂 */
  await db.query(`UPDATE acct_employees SET account_id = NULL WHERE account_id = $1::uuid AND id <> $2::bigint`, [accountId, eid]);
  await db.query(`UPDATE acct_employees SET account_id = $1::uuid WHERE id = $2::bigint`, [accountId, eid]);
  return { linked: e.id };
}

/** 운영 역할이 하나도 안 남으면 STAFF_LEFT_ROLE 알림 풂(퇴사 직원 계정) */
export async function resolveLeftAlert(db: DatabaseService, accountId: string, note: string) {
  const [r] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM account_roles WHERE account_id = $1::uuid AND role = ANY($2::text[])`, [accountId, [...STAFF_ROLES]]);
  if (Number(r?.n ?? 0) > 0) return 0;
  const done = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2
      WHERE alert_code = 'STAFF_LEFT_ROLE' AND resolved_at IS NULL AND detail->>'accountId' = $1 RETURNING id`, [accountId, note.slice(0, 200)]).catch(() => []);
  return done.length;
}

/** GET /admin/staff/employees/{id}/roles — 급여 › 직원 「퇴사」 뒤 「운영 역할도 거둘까요?」 */
export async function employeeRoles(db: DatabaseService, employeeId: string) {
  if (!/^\d{1,18}$/.test(String(employeeId ?? ''))) throw new NotFound('직원이 없습니다.');
  const [e] = await db.query<{ id: string; name: string; accountId: string | null; leftOn: string | null }>(
    `SELECT id::text AS id, name, account_id::text AS "accountId", left_on::text AS "leftOn" FROM acct_employees WHERE id = $1::bigint`, [employeeId]);
  if (!e) throw new NotFound('직원이 없습니다.');
  const roles = e.accountId
    ? (await db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1::uuid AND role = ANY($2::text[]) ORDER BY role`, [e.accountId, [...STAFF_ROLES]])).map((r) => r.role)
    : [];
  return { employeeId: e.id, name: e.name, leftOn: e.leftOn, accountId: e.accountId, roles,
           note: roles.length ? `${e.name} 님 계정에 운영 역할 ${roles.length}개가 남아 있습니다.` : '남은 운영 역할이 없습니다.' };
}

/**
 * POST /admin/staff/{accountId}/revoke-all — 운영 역할 모두 거두기(SUPER · 사유)
 *   역할 기록(role_changes)은 트리거가 사유 · 처리자를 함께 남김(app.role_reason · app.actor_id) · 마지막 SUPER 는 DB 가 막음 → 409 STAFF_LAST_SUPER
 */
export async function revokeAll(db: DatabaseService, accountId: string, reason: string, actor: string | null) {
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('STAFF_REASON', '사유는 2 ~ 200자입니다.');
  if (!/^[0-9a-fA-F-]{36}$/.test(String(accountId ?? ''))) throw new NotFound('없는 계정입니다.');
  if (actor && actor === accountId) throw new Forbidden('SELF_GRANT', '자신의 권한은 바꿀 수 없습니다.');
  return db.transaction(async () => {
    await db.query(`SELECT set_config('app.role_reason', $1, true), set_config('app.actor_id', $2, true)`, [why, actor ?? '']);
    /* 마지막 SUPER 는 거두지 않음(다 지우면 아무도 권한을 줄 수 없음) — 다른 SUPER 가 있어야 함 */
    const [s] = await db.query<{ me: boolean; others: number }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role = 'SUPER') AS me,
              (SELECT count(*)::int FROM account_roles WHERE role = 'SUPER' AND account_id <> $1::uuid) AS others`, [accountId]);
    if (s?.me && !Number(s.others)) throw new StateConflict('STAFF_LAST_SUPER', '마지막 최고 관리자(SUPER)는 거둘 수 없습니다.');
    const gone = await db.query<{ role: string }>(`DELETE FROM account_roles WHERE account_id = $1::uuid AND role = ANY($2::text[]) RETURNING role`, [accountId, [...STAFF_ROLES]]);
    if (!gone.length) throw new StateConflict('NO_SUCH_ROLE', '거둘 운영 역할이 없습니다.');
    const resolved = await resolveLeftAlert(db, accountId, `역할 모두 거둠 — ${why}`);
    return { ok: true, accountId, revoked: gone.map((g) => g.role), alertsResolved: resolved, note: `운영 역할 ${gone.length}개를 거두었습니다.` };
  });
}

/** SQL 조각에 넣지 않고 값으로 넘김 — 운영 역할이 있는 계정인지 */
export async function isStaffAccount(db: DatabaseService, accountId: string) {
  const [r] = await db.query<{ s: boolean }>(`SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role = ANY($2::text[])) AS s`, [accountId, [...STAFF_ROLES]]);
  return !!r?.s;
}

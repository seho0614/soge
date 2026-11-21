import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { maskEmail } from '../../common/mask';
import { EXTERNAL_ROLES, STAFF_ROLES, kstToday, resolveLeftAlert } from './staff';
import { permLog } from './perm-sets';

/* ---------------------------------------------------------------------
 * v10.566 (docs/708) 권한 정기 점검 자동화 — 대표 11/21 「모두 개발진행」
 *   분기마다 「거둘 후보」(prr_review_items)를 만들고 SUPER 가 골라 한 번에 거둠(사유) 또는 「둠」(메모)
 *   후보 종류(같은 대상이 여럿에 걸리면 위 것 하나만)
 *     LEFT_STAFF          퇴사한 직원(acct_employees.left_on 이 오늘 전)의 연결 계정에 남은 운영 역할 · 권한그룹 · 개별 권한
 *     LOGIN_IDLE          운영 역할 계정이 ops.role_idle_days(90)일 넘게 로그인 안 함(로그인 기록 accounts.last_login_at · 한 번도 없으면 역할 받은 날부터)
 *     GROUP_IDLE          붙은 지 90일 넘은 권한그룹인데 그 그룹이 여는 업무를 90일 동안 한 번도 안 씀(prr_task_use · 모으기 시작한 날 prr.use_since 부터 90일 뒤에만 셈)
 *     EXTERNAL_NO_EXPIRY  직원 대장 연결 없는 외부 역할(세무사 · 파트너 담당)에 기한이 없음(v10.563 전에 준 것)
 *     ROLE_GONE           운영 역할이 하나도 없는데(기한 지나 거둠 등) 권한그룹 · 개별 권한이 남음 — 기한 지난 외부 계정이 여기에 걸림
 *     EXPIRED_LEFTOVER    기한이 지난 권한그룹 · 개별 권한 줄(효력은 없지만 정리)
 *   거두기: 역할 = account_roles 지움(권한 변경 기록에 사유 · 처리자 · 마지막 SUPER 는 못 거둠 · 자기 자신 못 거둠) ·
 *           권한그룹 = perm_account_groups 지움 · 개별 = perm_account_overrides 지움(perm_changes 에 계정마다 한 줄)
 *   역할이 모두 없어지면 STAFF_LEFT_ROLE 풀림(v10.563 resolveLeftAlert 재사용). 자동으로 거두는 일은 없음.
 *   perm_shadow_log(막힘 · 다름 기록)는 후보 줄 옆에 「최근 막힘 n」으로만 보여 줌(쓰려다 막힌 사람을 모르고 거두지 않게).
 *   SQL 값은 모두 $n · 자리값 하나를 두 형에 쓰지 않음.
 * ------------------------------------------------------------------- */

export const PRR_KINDS = ['LEFT_STAFF', 'LOGIN_IDLE', 'GROUP_IDLE', 'EXTERNAL_NO_EXPIRY', 'ROLE_GONE', 'EXPIRED_LEFTOVER'] as const;
export const PRR_KIND_KO: Record<string, string> = {
  LEFT_STAFF: '퇴사자 권한', LOGIN_IDLE: '오래 로그인 안 함', GROUP_IDLE: '안 쓴 권한그룹',
  EXTERNAL_NO_EXPIRY: '외부 계정 기한 없음', ROLE_GONE: '역할 없는데 권한 남음', EXPIRED_LEFTOVER: '기한 지난 권한 줄',
};
const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const ID_RE = /^\d{1,18}$/;

const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400e3).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
/** 날짜 → 그 분기 첫날 */
export const quarterOf = (d: string) => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
/** 분기 첫날 → 2026-Q4 */
export const quarterLabel = (q: string) => `${q.slice(0, 4)}-Q${Math.floor((Number(q.slice(5, 7)) - 1) / 3) + 1}`;
/** 2026-Q4 → 2026-10-01 (없으면 이번 분기) */
export function parseQuarter(q: string | undefined | null): string {
  const s = String(q ?? '').trim();
  if (!s) return quarterOf(kstToday());
  if (!QUARTER_RE.test(s)) throw new PolicyViolation('PRR_QUARTER', '분기는 2026-Q4 처럼 적어 주십시오.');
  const [y, n] = s.split('-Q');
  return `${y}-${String((Number(n) - 1) * 3 + 1).padStart(2, '0')}-01`;
}
const reasonOk = (r: string | undefined, code = 'PRR_REASON') => {
  const t = String(r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};
function idsOk(ids: unknown): string[] {
  const xs = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x)))];
  if (!xs.length || xs.length > 500) throw new PolicyViolation('PRR_IDS', '후보를 1 ~ 500개 고르십시오.');
  if (xs.some((x) => !ID_RE.test(x))) throw new PolicyViolation('PRR_IDS', '후보 번호가 바르지 않습니다.');
  return xs;
}

/** AppError(HttpException) 의 응답 몸통에서 코드 · 글 — 줄마다 결과에 씀 */
export function errOf(e: unknown): { code: string; message: string } {
  const r = (e as { getResponse?: () => unknown })?.getResponse?.() as { code?: string; message?: string } | undefined;
  return { code: String(r?.code ?? 'ERROR'), message: String(r?.message ?? (e as Error)?.message ?? '').slice(0, 200) };
}

export interface PrrSettings { idleDays: number; useSince: string; auto: boolean }
export async function prrSettings(db: DatabaseService): Promise<PrrSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [['ops.role_idle_days', 'prr.use_since', 'prr.review_auto']]);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  const idle = Number(v('ops.role_idle_days') || 90);
  const since = v('prr.use_since');
  return {
    idleDays: Number.isInteger(idle) && idle >= 7 && idle <= 730 ? idle : 90,
    useSince: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : kstToday(),
    auto: v('prr.review_auto') !== 'off',
  };
}

/** 후보 만들기 · 다시 만들기(이번 분기만) — 새 후보 더함 · 대상이 없어진 열린 줄은 GONE · 다시 돌려도 같음 */
export async function buildReview(db: DatabaseService, quarter: string, actor: string | null) {
  const q = quarter;
  if (q !== quarterOf(kstToday())) throw new PolicyViolation('PRR_QUARTER_RANGE', '후보는 이번 분기만 만듭니다(지난 분기는 보기만).');
  const s = await prrSettings(db);
  const today = kstToday();
  const cutoff = addDays(today, -s.idleDays);                 // 이날 전이면 「오래」
  const useReady = daysBetween(s.useSince, today) >= s.idleDays;
  const roles = [...STAFF_ROLES], ext = [...EXTERNAL_ROLES];
  const added: Record<string, number> = {};
  /* 아래 INSERT 는 하나씩 통째로 적음(조각을 이어 붙이지 않음 · check-sql 이 PREPARE 할 수 있게) */
  const ins = async (kind: string, sql: string, params: unknown[]) => {
    const r = await db.query<{ id: string }>(sql, [q, ...params]);
    added[kind] = r.length;
  };
  return db.transaction(async () => {
    await db.query(
      `INSERT INTO prr_reviews (quarter, last_built_by) VALUES ($1::date, $2::uuid)
       ON CONFLICT (quarter) DO UPDATE SET last_built_at = now(), last_built_by = EXCLUDED.last_built_by, runs = prr_reviews.runs + 1`, [q, actor]);

    /* 차례가 곧 우선순위 — 같은 대상(계정 · 종류 · 대상)은 먼저 들어간 종류 하나만(UNIQUE) */
    // ① 퇴사자 권한 ($2 오늘 · $3 운영 역할)
    await ins('LEFT_STAFF',
      `INSERT INTO prr_review_items (quarter, kind, account_id, target_kind, target, detail)
       SELECT $1::date, 'LEFT_STAFF', e.account_id, y.tk, y.t, jsonb_build_object('employeeId', e.id::text, 'employee', e.name, 'leftOn', e.left_on::text)
         FROM acct_employees e
         CROSS JOIN LATERAL (
           SELECT 'ROLE'::text AS tk, r.role AS t FROM account_roles r WHERE r.account_id = e.account_id AND r.role = ANY($3::text[])
           UNION ALL SELECT 'GROUP', g.group_key FROM perm_account_groups g WHERE g.account_id = e.account_id
           UNION ALL SELECT 'OVERRIDE', o.id::text FROM perm_account_overrides o WHERE o.account_id = e.account_id) y
        WHERE e.account_id IS NOT NULL AND e.left_on IS NOT NULL AND e.left_on < $2::date
       ON CONFLICT (quarter, account_id, target_kind, target) DO NOTHING RETURNING id::text AS id`, [today, roles]);
    // ② 오래 로그인 안 함 ($2 기준 날 · $3 운영 역할 · $4 날수)
    await ins('LOGIN_IDLE',
      `INSERT INTO prr_review_items (quarter, kind, account_id, target_kind, target, detail)
       SELECT $1::date, 'LOGIN_IDLE', a.id, y.tk, y.t, jsonb_build_object('lastLoginAt', a.last_login_at, 'idleDays', $4::int)
         FROM accounts a
         CROSS JOIN LATERAL (
           SELECT 'ROLE'::text AS tk, r.role AS t FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($3::text[])
           UNION ALL SELECT 'GROUP', g.group_key FROM perm_account_groups g WHERE g.account_id = a.id AND (g.expires_at IS NULL OR g.expires_at > now())) y
        WHERE a.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM account_roles r2 WHERE r2.account_id = a.id AND r2.role = ANY($3::text[]))
          AND coalesce(a.last_login_at, (SELECT min(r3.granted_at) FROM account_roles r3 WHERE r3.account_id = a.id AND r3.role = ANY($3::text[]))) < $2::date
       ON CONFLICT (quarter, account_id, target_kind, target) DO NOTHING RETURNING id::text AS id`, [cutoff, roles, s.idleDays]);
    // ③ 안 쓴 권한그룹 ($2 기준 날 · $3 운영 역할 · $4 날수) — 모으기 시작하고 안 쓴 기간이 지나야
    if (useReady) {
      await ins('GROUP_IDLE',
        `INSERT INTO prr_review_items (quarter, kind, account_id, target_kind, target, detail)
         SELECT $1::date, 'GROUP_IDLE', g.account_id, 'GROUP', g.group_key, jsonb_build_object('grantedAt', g.granted_at, 'idleDays', $4::int)
           FROM perm_account_groups g
          WHERE (g.expires_at IS NULL OR g.expires_at > now()) AND g.granted_at < $2::date
            AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = g.account_id AND r.role = ANY($3::text[]))
            AND NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = g.account_id AND r.role = 'SUPER')
            AND NOT EXISTS (SELECT 1 FROM prr_task_use u WHERE u.account_id = g.account_id AND u.last_on >= $2::date
                              AND u.task_key IN (SELECT x.task_key FROM fn_perm_group_expand(g.group_key) x))
         ON CONFLICT (quarter, account_id, target_kind, target) DO NOTHING RETURNING id::text AS id`, [cutoff, roles, s.idleDays]);
    } else added.GROUP_IDLE = 0;
    // ④ 외부 계정 기한 없음 ($2 외부 역할 · $3 오늘)
    await ins('EXTERNAL_NO_EXPIRY',
      `INSERT INTO prr_review_items (quarter, kind, account_id, target_kind, target, detail)
       SELECT $1::date, 'EXTERNAL_NO_EXPIRY', r.account_id, 'ROLE', r.role, jsonb_build_object('grantedAt', r.granted_at)
         FROM account_roles r
        WHERE r.role = ANY($2::text[]) AND r.expires_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM acct_employees e WHERE e.account_id = r.account_id AND (e.left_on IS NULL OR e.left_on >= $3::date))
       ON CONFLICT (quarter, account_id, target_kind, target) DO NOTHING RETURNING id::text AS id`, [ext, today]);
    // ⑤ 역할 없는데 권한 남음 ($2 운영 역할)
    await ins('ROLE_GONE',
      `INSERT INTO prr_review_items (quarter, kind, account_id, target_kind, target, detail)
       SELECT $1::date, 'ROLE_GONE', y.account_id, y.tk, y.t,
              jsonb_build_object('roleGoneAt', (SELECT max(c.changed_at) FROM role_changes c WHERE c.account_id = y.account_id AND c.action = 'REVOKE'))
         FROM (SELECT g.account_id, 'GROUP'::text AS tk, g.group_key AS t FROM perm_account_groups g WHERE g.expires_at IS NULL OR g.expires_at > now()
               UNION ALL SELECT o.account_id, 'OVERRIDE', o.id::text FROM perm_account_overrides o WHERE o.expires_at IS NULL OR o.expires_at > now()) y
        WHERE NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = y.account_id AND r.role = ANY($2::text[]))
       ON CONFLICT (quarter, account_id, target_kind, target) DO NOTHING RETURNING id::text AS id`, [roles]);
    // ⑥ 기한 지난 권한 줄
    await ins('EXPIRED_LEFTOVER',
      `INSERT INTO prr_review_items (quarter, kind, account_id, target_kind, target, detail)
       SELECT $1::date, 'EXPIRED_LEFTOVER', y.account_id, y.tk, y.t, y.detail FROM (
         SELECT g.account_id, 'GROUP'::text AS tk, g.group_key AS t, jsonb_build_object('expiresAt', g.expires_at) AS detail FROM perm_account_groups g WHERE g.expires_at <= now()
         UNION ALL
         SELECT o.account_id, 'OVERRIDE', o.id::text, jsonb_build_object('expiresAt', o.expires_at, 'task', o.task_key, 'level', o.level) FROM perm_account_overrides o WHERE o.expires_at <= now()) y
       ON CONFLICT (quarter, account_id, target_kind, target) DO NOTHING RETURNING id::text AS id`, []);

    /* 대상이 이미 없어진 열린 줄 → GONE */
    const gone = await db.query<{ id: string }>(
      `UPDATE prr_review_items i SET state = 'GONE', decided_at = now(), decide_note = '대상이 이미 없음(다시 만들 때 확인)'
        WHERE i.quarter = $1::date AND i.state = 'OPEN' AND NOT (
              (i.target_kind = 'ROLE' AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = i.account_id AND r.role = i.target))
           OR (i.target_kind = 'GROUP' AND EXISTS (SELECT 1 FROM perm_account_groups g WHERE g.account_id = i.account_id AND g.group_key = i.target))
           OR (i.target_kind = 'OVERRIDE' AND EXISTS (SELECT 1 FROM perm_account_overrides o WHERE o.account_id = i.account_id AND o.id::text = i.target)))
        RETURNING i.id::text AS id`, [q]);
    const [c] = await db.query<{ open: number; counts: Record<string, number> }>(
      `SELECT count(*) FILTER (WHERE state = 'OPEN')::int AS open,
              coalesce((SELECT jsonb_object_agg(k.kind, k.n) FROM (SELECT kind, count(*)::int AS n FROM prr_review_items WHERE quarter = $1::date AND state = 'OPEN' GROUP BY kind) k), '{}'::jsonb) AS counts
         FROM prr_review_items WHERE quarter = $1::date`, [q]);
    await db.query(`UPDATE prr_reviews SET counts = $2::jsonb WHERE quarter = $1::date`, [q, JSON.stringify(c?.counts ?? {})]);
    const open = Number(c?.open ?? 0);
    await reviewAlert(db, q, open);
    return { ok: true, quarter: quarterLabel(q), added, addedTotal: Object.values(added).reduce((a, b) => a + b, 0), gone: gone.length, open,
             groupIdleReady: useReady, useSince: s.useSince, idleDays: s.idleDays,
             note: `거둘 후보를 다시 만들었습니다 — 새 후보 ${Object.values(added).reduce((a, b) => a + b, 0)} · 없어짐 ${gone.length} · 남은 후보 ${open}.` };
  });
}

/** 열린 후보가 있으면 분기마다 한 번 PRR_REVIEW_OPEN(INFO) · 0이면 풂 */
async function reviewAlert(db: DatabaseService, q: string, open: number) {
  const label = quarterLabel(q);
  if (open > 0) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'PRR_REVIEW_OPEN', 'INFO', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'PRR_REVIEW_OPEN' AND a.detail->>'quarter' = $3)
       ON CONFLICT DO NOTHING`,
      [`${label} 권한 정기 점검 — 거둘 후보 ${open}건(직원 · 권한 › 거둘 후보에서 거두거나 「둠」)`.slice(0, 280), JSON.stringify({ quarter: label, open }), label]).catch(() => undefined);
  } else {
    await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '거둘 후보 0'
        WHERE alert_code = 'PRR_REVIEW_OPEN' AND resolved_at IS NULL AND detail->>'quarter' = $1`, [label]).catch(() => undefined);
  }
}

/** GET /admin/staff/review — 분기 거둘 후보(ADMIN 읽기 · 메일 원문은 SUPER) */
export async function reviewView(db: DatabaseService, quarter: string | undefined, superView: boolean) {
  const q = parseQuarter(quarter);
  const s = await prrSettings(db);
  const today = kstToday();
  const [head] = await db.query<{ firstBuiltAt: string; lastBuiltAt: string; runs: number }>(
    `SELECT first_built_at AS "firstBuiltAt", last_built_at AS "lastBuiltAt", runs FROM prr_reviews WHERE quarter = $1::date`, [q]);
  const rows = await db.query<{ id: string; kind: string; accountId: string; targetKind: string; target: string; state: string; email: string | null; blocked: number }>(
    `SELECT i.id::text AS id, i.kind, i.account_id::text AS "accountId", i.target_kind AS "targetKind", i.target, i.detail, i.state,
            i.decided_at AS "decidedAt", i.decide_note AS "decideNote", d.name AS "decidedBy", i.created_at AS "createdAt",
            a.name, a.email::text AS email, a.status, a.last_login_at AS "lastLoginAt",
            e.id::text AS "employeeId", e.name AS "employeeName", e.left_on::text AS "leftOn",
            coalesce(rg.name, '') AS "groupName",
            (SELECT o.task_key || ':' || o.level FROM perm_account_overrides o WHERE i.target_kind = 'OVERRIDE' AND o.id::text = i.target) AS "overrideTask",
            (SELECT count(*)::int FROM perm_shadow_log l WHERE l.account_id = i.account_id AND l.created_at > now() - make_interval(days => $2::int)) AS blocked
       FROM prr_review_items i
       JOIN accounts a ON a.id = i.account_id
       LEFT JOIN acct_employees e ON e.account_id = i.account_id
       LEFT JOIN accounts d ON d.id = i.decided_by
       LEFT JOIN perm_role_groups rg ON i.target_kind = 'GROUP' AND rg.key = i.target
      WHERE i.quarter = $1::date
      ORDER BY (i.state = 'OPEN') DESC, array_position($3::text[], i.kind), a.email, i.target_kind, i.target
      LIMIT 2000`, [q, s.idleDays, [...PRR_KINDS]]);
  const items = rows.map((r) => ({ ...r, kindKo: PRR_KIND_KO[r.kind] ?? r.kind, email: superView ? r.email : maskEmail(r.email) }));
  const byKind: Record<string, number> = {};
  for (const it of items) if (it.state === 'OPEN') byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
  const [rv] = await db.query<{ reviewedAt: string | null; reviewedBy: string | null }>(
    `SELECT r.reviewed_at AS "reviewedAt", a.name AS "reviewedBy" FROM audit.role_reviews r LEFT JOIN accounts a ON a.id = r.reviewed_by WHERE r.quarter = $1::date`, [q]).catch(() => []);
  const quarters = await db.query(
    `SELECT to_char(p.quarter, 'YYYY') || '-Q' || extract(quarter FROM p.quarter)::int AS quarter, p.last_built_at AS "lastBuiltAt",
            (SELECT count(*)::int FROM prr_review_items i WHERE i.quarter = p.quarter AND i.state = 'OPEN') AS open,
            (SELECT count(*)::int FROM prr_review_items i WHERE i.quarter = p.quarter AND i.state = 'REVOKED') AS revoked,
            (SELECT count(*)::int FROM prr_review_items i WHERE i.quarter = p.quarter AND i.state = 'KEPT') AS kept
       FROM prr_reviews p ORDER BY p.quarter DESC LIMIT 8`);
  const useDays = daysBetween(s.useSince, today);
  return {
    quarter: quarterLabel(q), current: q === quarterOf(today), built: head ?? null, items,
    open: items.filter((x) => x.state === 'OPEN').length, byKind, kinds: PRR_KIND_KO,
    idleDays: s.idleDays, useSince: s.useSince, useDays, groupIdleReady: useDays >= s.idleDays, auto: s.auto,
    roleReview: rv ?? null, quarters, canRevoke: superView,
    note: useDays >= s.idleDays
      ? `거둘 후보는 자동으로 거두지 않습니다 — SUPER 가 골라 사유와 함께 「거두기」 또는 메모와 함께 「둠」. 분기 점검 완료 기록은 「권한 점검」 탭(기존)에서 남깁니다.`
      : `업무 사용 기록을 모은 지 ${useDays}일입니다 — ${s.idleDays}일이 지나야 「안 쓴 권한그룹」을 셉니다(그 전에는 퇴사자 · 오래 로그인 안 함 · 외부 계정 · 남은 권한 줄만).`,
  };
}

/** POST /admin/staff/review/revoke — 고른 후보 한 번에 거두기(SUPER · 사유) · 줄마다 결과 */
export async function revokeItems(db: DatabaseService, ids: unknown, reason: string | undefined, actor: string | null) {
  const why = reasonOk(reason);
  const xs = idsOk(ids);
  const results: Array<{ id: string; ok: boolean; code?: string; message?: string }> = [];
  const touched = new Map<string, Array<{ kind: string; target: string }>>();
  for (const id of xs) {
    try {
      await db.transaction(async () => {
        const [it] = await db.query<{ id: string; accountId: string; targetKind: string; target: string; state: string }>(
          `SELECT id::text AS id, account_id::text AS "accountId", target_kind AS "targetKind", target, state FROM prr_review_items WHERE id = $1::bigint FOR UPDATE`, [id]);
        if (!it) throw new StateConflict('PRR_NOT_FOUND', '없는 후보입니다.');
        if (it.state !== 'OPEN') throw new StateConflict('PRR_NOT_OPEN', '이미 결정한 후보입니다.');
        if (actor && actor === it.accountId) throw new StateConflict('SELF_GRANT', '자신의 권한은 거둘 수 없습니다.');
        let n = 0;
        if (it.targetKind === 'ROLE') {
          if (it.target === 'SUPER') {
            const [s] = await db.query<{ others: number }>(`SELECT count(*)::int AS others FROM account_roles WHERE role = 'SUPER' AND account_id <> $1::uuid`, [it.accountId]);
            if (!Number(s?.others)) throw new StateConflict('STAFF_LAST_SUPER', '마지막 최고 관리자(SUPER)는 거둘 수 없습니다.');
          }
          await db.query(`SELECT set_config('app.role_reason', $1, true), set_config('app.actor_id', $2, true)`, [`권한 정기 점검 — ${why}`.slice(0, 200), actor ?? '']);
          n = (await db.query(`DELETE FROM account_roles WHERE account_id = $1::uuid AND role = $2 RETURNING role`, [it.accountId, it.target])).length;
        } else if (it.targetKind === 'GROUP') {
          n = (await db.query(`DELETE FROM perm_account_groups WHERE account_id = $1::uuid AND group_key = $2 RETURNING group_key`, [it.accountId, it.target])).length;
        } else {
          n = (await db.query(`DELETE FROM perm_account_overrides WHERE account_id = $1::uuid AND id::text = $2 RETURNING id`, [it.accountId, it.target])).length;
        }
        await db.query(
          `UPDATE prr_review_items SET state = $2, decided_by = $3::uuid, decided_at = now(), decide_note = $4 WHERE id = $1::bigint`,
          [id, n ? 'REVOKED' : 'GONE', actor, n ? why : `대상이 이미 없음 — ${why}`.slice(0, 200)]);
        if (n) { const l = touched.get(it.accountId) ?? []; l.push({ kind: it.targetKind, target: it.target }); touched.set(it.accountId, l); }
      });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, ...errOf(e) });
    }
  }
  let resolved = 0;
  for (const [acc, list] of touched) {
    if (list.some((x) => x.kind !== 'ROLE')) {
      await permLog(db, 'ACCOUNT', acc, 'PRR_REVOKE', { items: list.filter((x) => x.kind !== 'ROLE') }, `권한 정기 점검 — ${why}`.slice(0, 200), actor).catch(() => undefined);
    }
    resolved += await resolveLeftAlert(db, acc, `권한 정기 점검으로 거둠 — ${why}`).catch(() => 0);
  }
  const done = results.filter((r) => r.ok).length;
  return { ok: done > 0, done, failed: results.length - done, results, alertsResolved: resolved,
           note: `${done}건을 거두었습니다 · 못 거둔 것 ${results.length - done}건(마지막 SUPER · 자기 자신 · 이미 결정 등은 줄마다 결과).` };
}

/** POST /admin/staff/review/keep — 고른 후보 「둠」(SUPER · 메모) */
export async function keepItems(db: DatabaseService, ids: unknown, note: string | undefined, actor: string | null) {
  const why = reasonOk(note, 'PRR_NOTE');
  const xs = idsOk(ids);
  const r = await db.query<{ id: string }>(
    `UPDATE prr_review_items SET state = 'KEPT', decided_by = $2::uuid, decided_at = now(), decide_note = $3
      WHERE id = ANY($1::bigint[]) AND state = 'OPEN' RETURNING id::text AS id`, [xs, actor, why]);
  if (!r.length) throw new StateConflict('PRR_NOT_OPEN', '고른 후보가 모두 이미 결정됐습니다.');
  return { ok: true, kept: r.length, skipped: xs.length - r.length, note: `${r.length}건을 그대로 두기로 했습니다(메모 남김).` };
}

/** 정기 작업(prr_daily) — prr.review_auto on 이면 이번 분기 후보 다시 만들기 */
export async function reviewDaily(db: DatabaseService) {
  const s = await prrSettings(db);
  if (!s.auto) return { skipped: 'prr.review_auto off' };
  const r = await buildReview(db, quarterOf(kstToday()), null);
  return { quarter: r.quarter, added: r.addedTotal, gone: r.gone, open: r.open };
}

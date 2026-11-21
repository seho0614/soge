import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.441 ~ 444 (D258 · docs/578 ~ 581) 업무별 권한 관리 — 대표 11/19 22:10 승인 · 권한 관리는 SUPER 만
 *   업무(탭) · 업무그룹 · 권한그룹(업무 × VIEW · EDIT · APPROVE · EXPORT) · 개인권한(그룹 + 개별 더하기/빼기 + 기한) · 구분 STAFF / MANAGER.
 *   서버 검사(PermGuard)는 기존 @Roles 뒤에 한 번 더 — 표(perm_route_map)에 있는 주소만 · SUPER 는 늘 통과 · perm.enforce OFF · SHADOW(처음 · 기록만) · ON.
 * ------------------------------------------------------------------------------- */

export const LEVELS = ['VIEW', 'EDIT', 'APPROVE', 'EXPORT'] as const;
export type Level = typeof LEVELS[number];
/** 권한 검사 대상 역할 — 이 역할만 요구하는 API(회원 역할이 섞이면 보지 않음 · 2단계 인증과 같은 범위) */
export const PERM_OPS = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];

interface RouteRow { method: string; pattern: string; task_key: string; level: string }
interface Compiled { method: string; pattern: string; re: RegExp; task: string; level: string }

let routeCache: { at: number; list: Compiled[] } | null = null;
let modeCache: { at: number; mode: string } | null = null;
const effCache = new Map<string, { at: number; set: Set<string> }>();
const shadowSeen = new Map<string, number>();

/** 바꾼 뒤 바로 반영(이 서버 · 다른 서버는 길어야 15 ~ 60초) */
export function permCacheClear() { routeCache = null; modeCache = null; effCache.clear(); widenEffCache.clear(); widenCache = null; }

const toRe = (pattern: string) =>
  new RegExp('^' + pattern.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}/]+\}/g, '[^/]+') + '/?$');

export async function permMode(db: DatabaseService): Promise<string> {
  if (modeCache && Date.now() - modeCache.at < 30_000) return modeCache.mode;
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'perm.enforce'`).catch(() => [] as Array<{ value: string | null }>);
  const mode = ['OFF', 'SHADOW', 'ON'].includes(r?.value ?? '') ? r!.value! : 'OFF';
  modeCache = { at: Date.now(), mode };
  return mode;
}

async function routes(db: DatabaseService): Promise<Compiled[]> {
  if (routeCache && Date.now() - routeCache.at < 60_000) return routeCache.list;
  const rows = await db.query<RouteRow>(`SELECT method, pattern, task_key, level FROM perm_route_map`).catch(() => [] as RouteRow[]);
  /* 보안 점검(11/19) — Express 는 주소 대소문자를 가리지 않으므로 표 패턴 · 요청 주소 모두 소문자로 맞춤 */
  const list = rows.map((r) => ({ method: r.method.toUpperCase(), pattern: r.pattern, re: toRe(r.pattern.toLowerCase()), task: r.task_key, level: r.level }));
  routeCache = { at: Date.now(), list };
  return list;
}

/** 요청 주소(/api/v1 뺀 /admin/...) → 맞는 업무 · 수준들 */
export async function routeNeeds(db: DatabaseService, method: string, path: string) {
  const p = path.split('?')[0]!.toLowerCase().replace(/^\/api\/v1/, '');
  if (!p.startsWith('/admin/')) return [];
  const m = String(method ?? '').toUpperCase() === 'HEAD' ? 'GET' : String(method ?? '').toUpperCase();   // HEAD 는 GET 처리기로 감
  return (await routes(db)).filter((r) => r.method === m && r.re.test(p));
}

export async function effective(db: DatabaseService, accountId: string): Promise<Set<string>> {
  const c = effCache.get(accountId);
  if (c && Date.now() - c.at < 15_000) return c.set;
  const rows = await db.query<{ task_key: string; level: string }>(`SELECT task_key, level FROM fn_perm_effective($1::uuid)`, [accountId]);
  const set = new Set(rows.map((r) => `${r.task_key}:${r.level}`));
  effCache.set(accountId, { at: Date.now(), set });
  return set;
}

/** 넓히기에 쓰는 권한 — 처음 변환 그룹(R_역할)은 빼고 SUPER 가 만든 그룹 · 개별 더하기만(보안 점검 11/19 · fn_perm_widen_effective) */
const widenEffCache = new Map<string, { at: number; set: Set<string> }>();
export async function widenEffective(db: DatabaseService, accountId: string): Promise<Set<string>> {
  const c = widenEffCache.get(accountId);
  if (c && Date.now() - c.at < 15_000) return c.set;
  const rows = await db.query<{ task_key: string; level: string }>(`SELECT task_key, level FROM fn_perm_widen_effective($1::uuid)`, [accountId]);
  const set = new Set(rows.map((r) => `${r.task_key}:${r.level}`));
  widenEffCache.set(accountId, { at: Date.now(), set });
  return set;
}

/** SHADOW · ON 에서 막혔을(막은) 요청 기록 — 같은 사람 · 같은 주소는 10분에 한 번 */
export async function logDenied(db: DatabaseService, accountId: string, need: Compiled[], mode: string) {
  const k = `${accountId}|${need[0]!.method}|${need[0]!.pattern}`;
  const last = shadowSeen.get(k) ?? 0;
  if (Date.now() - last < 600_000) return;
  shadowSeen.set(k, Date.now());
  if (shadowSeen.size > 5000) shadowSeen.clear();
  await db.query(
    `INSERT INTO perm_shadow_log (account_id, method, pattern, task_keys, level, mode) VALUES ($1::uuid, $2, $3, $4::text[], $5, $6)`,
    [accountId, need[0]!.method, need[0]!.pattern, [...new Set(need.map((n) => n.task))], need[0]!.level, mode]).catch(() => undefined);
}

const reasonOk = (r: string | undefined) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('PERM_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};
const dateOrNull = (v?: string | null) => {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(Date.parse(v))) throw new PolicyViolation('PERM_DATE', '기한 날짜가 바르지 않습니다.');
  return v;
};

async function changed(db: DatabaseService, kind: string, target: string, action: string, detail: unknown, reason: string, actor: string | null) {
  await db.query(`INSERT INTO perm_changes (target_kind, target, action, detail, reason, actor_id) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [kind, target, action, JSON.stringify(detail ?? {}), reason, actor]);
  /* 중요 설정 바뀜과 같은 길 — 운영 알림(같은 종류 같은 시각 충돌을 피해 clock_timestamp) */
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PERM_CHANGED', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [`업무 권한 바뀜 — ${kind} ${target} · ${action}(${reason})`.slice(0, 280), JSON.stringify({ kind, target, action })]).catch(() => undefined);
  permCacheClear();
}

/** GET /admin/perm/me — 내 업무 · 수준(화면이 메뉴 · 단추를 고를 때) */
export async function myPerms(db: DatabaseService, accountId: string, roles: string[]) {
  const mode = await permMode(db);
  const sup = roles.includes('SUPER');
  const set = sup ? new Set<string>() : await effective(db, accountId);
  const tasks: Record<string, string[]> = {};
  for (const k of set) { const [t, l] = k.split(':'); (tasks[t!] ??= []).push(l!); }
  /* known — 표에 있는 업무(탭)만 권한그룹으로 고르고, 표에 없는 탭은 화면도 지금처럼 역할로 */
  const known = (await db.query<{ key: string }>(`SELECT key FROM perm_tasks WHERE active`)).map((r) => r.key);
  return { mode, super: sup, tasks, known };
}

/** GET /admin/perm/overview — 업무그룹 · 업무 · 권한그룹 · 운영자 */
export async function overview(db: DatabaseService) {
  const taskGroups = await db.query(`SELECT key, name, sort FROM perm_task_groups ORDER BY sort, key`);
  const tasks = await db.query(`SELECT key, name, group_key AS "groupKey", levels, sort, active FROM perm_tasks ORDER BY sort, key`);
  const roleGroups = await db.query(
    `SELECT g.key, g.name, g.kind, g.from_role AS "fromRole", g.note, g.active,
            (SELECT count(*)::int FROM perm_role_group_items i WHERE i.group_key = g.key) AS items,
            (SELECT count(*)::int FROM perm_account_groups a WHERE a.group_key = g.key AND (a.expires_at IS NULL OR a.expires_at > now())) AS people
       FROM perm_role_groups g ORDER BY g.from_role NULLS LAST, g.name`);
  const people = await db.query(
    `SELECT a.id::text AS id, coalesce(a.name, '') AS name, a.email,
            array_agg(DISTINCT r.role ORDER BY r.role) AS roles,
            coalesce((SELECT k.kind FROM perm_account_kind k WHERE k.account_id = a.id), 'STAFF') AS kind,
            coalesce((SELECT json_agg(json_build_object('key', g.group_key, 'expiresAt', g.expires_at) ORDER BY g.group_key) FROM perm_account_groups g WHERE g.account_id = a.id), '[]'::json) AS groups,
            (SELECT count(*)::int FROM perm_account_overrides o WHERE o.account_id = a.id) AS overrides
       FROM accounts a JOIN account_roles r ON r.account_id = a.id
      WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')
      GROUP BY a.id, a.name, a.email ORDER BY a.email LIMIT 500`);
  return { mode: await permMode(db), widen: await widenOn(db), levels: LEVELS, taskGroups, tasks, roleGroups, people,
           note: '권한그룹은 기존 역할 범위 안에서 더 좁힙니다(둘 다 통과해야 함). SUPER 는 늘 모든 권한입니다. perm.enforce 가 SHADOW 면 막지 않고 「막혔을 것」만 기록합니다.' };
}

export async function roleGroupDetail(db: DatabaseService, key: string) {
  const [g] = await db.query(`SELECT key, name, kind, from_role AS "fromRole", note, active FROM perm_role_groups WHERE key = $1`, [key]);
  if (!g) throw new NotFound('없는 권한그룹입니다.');
  const items = await db.query(`SELECT task_key AS "taskKey", level FROM perm_role_group_items WHERE group_key = $1 ORDER BY task_key, level`, [key]);
  return { group: g, items };
}

/** PUT /admin/perm/role-groups/{key} — 만들기 · 고치기(항목은 통째로 바꿈) */
export async function saveRoleGroup(db: DatabaseService, key: string,
  b: { name: string; kind?: string; note?: string; active?: boolean; items: Array<{ taskKey: string; level: string }>; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(key)) throw new PolicyViolation('PERM_KEY', '권한그룹 키는 대문자 · 숫자 · 밑줄입니다.');
  const kind = b.kind === 'MANAGER' ? 'MANAGER' : 'STAFF';
  const items = (b.items ?? []).filter((i) => (LEVELS as readonly string[]).includes(i.level));
  if (items.length > 2000) throw new PolicyViolation('PERM_ITEMS', '항목이 너무 많습니다.');
  const known = new Set((await db.query<{ key: string }>(`SELECT key FROM perm_tasks`)).map((t) => t.key));
  const bad = items.find((i) => !known.has(i.taskKey));
  if (bad) throw new PolicyViolation('PERM_TASK', `없는 업무입니다: ${bad.taskKey}`);
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO perm_role_groups (key, name, kind, note, active, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, note = EXCLUDED.note, active = EXCLUDED.active, updated_at = now()`,
      [key, (b.name ?? '').trim().slice(0, 40) || key, kind, b.note?.trim().slice(0, 200) || null, b.active !== false, actor]);
    await db.query(`DELETE FROM perm_role_group_items WHERE group_key = $1 AND effect = 'ALLOW'`, [key]);   // v10.562 (D291) 빼기(DENY) · 세트는 새 화면(권한그룹)에서
    if (items.length) await db.query(
      `INSERT INTO perm_role_group_items (group_key, task_key, level)
       SELECT $1, x.t, x.l FROM jsonb_to_recordset($2::jsonb) AS x(t text, l text) ON CONFLICT DO NOTHING`,
      [key, JSON.stringify(items.map((i) => ({ t: i.taskKey, l: i.level })))]);
    await changed(db, 'ROLE_GROUP', key, 'SAVE', { name: b.name, kind, items: items.length }, reason, actor);
  });
  return { ok: true, key, items: items.length, note: '권한그룹을 저장했습니다 — 붙은 사람에게 바로(길어야 1분) 반영됩니다.' };
}

export async function saveTaskGroup(db: DatabaseService, key: string, b: { name: string; sort?: number; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  const r = await db.query(`UPDATE perm_task_groups SET name = $2, sort = coalesce($3, sort), updated_by = $4, updated_at = now() WHERE key = $1 RETURNING key`,
    [key, (b.name ?? '').trim().slice(0, 40), b.sort ?? null, actor]);
  if (!r.length) throw new NotFound('없는 업무그룹입니다.');
  await changed(db, 'TASK_GROUP', key, 'RENAME', { name: b.name, sort: b.sort }, reason, actor);
  return { ok: true, key, note: '업무그룹을 고쳤습니다.' };
}

export async function saveTask(db: DatabaseService, key: string, b: { groupKey?: string; active?: boolean; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  const r = await db.query(`UPDATE perm_tasks SET group_key = coalesce($2, group_key), active = coalesce($3, active) WHERE key = $1 RETURNING key`,
    [key, b.groupKey ?? null, b.active ?? null]);
  if (!r.length) throw new NotFound('없는 업무입니다.');
  await changed(db, 'TASK', key, 'MOVE', { groupKey: b.groupKey, active: b.active }, reason, actor);
  return { ok: true, key, note: '업무를 고쳤습니다.' };
}

/** PUT /admin/perm/accounts/{id} — 구분 · 그룹(기한) · 개별 더하기/빼기(통째로 바꿈) */
export async function saveAccount(db: DatabaseService, id: string,
  b: { kind?: string; groups?: Array<{ key: string; expiresAt?: string | null }>; overrides?: Array<{ taskKey: string; level: string; effect: string; expiresAt?: string | null; reason?: string }>; reason?: string },
  actor: string | null) {
  const reason = reasonOk(b.reason);
  const [acc] = await db.query<{ id: string; sup: boolean }>(
    `SELECT a.id::text AS id, EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = 'SUPER') AS sup FROM accounts a WHERE a.id::text = $1`, [id]);
  if (!acc) throw new NotFound('없는 계정입니다.');
  const kind = b.kind === 'MANAGER' ? 'MANAGER' : 'STAFF';
  const groups = b.groups ?? [];
  const ovs = (b.overrides ?? []).filter((o) => (LEVELS as readonly string[]).includes(o.level) && ['ALLOW', 'DENY'].includes(o.effect));
  await db.transaction(async () => {
    await db.query(`INSERT INTO perm_account_kind (account_id, kind, updated_by) VALUES ($1::uuid, $2, $3)
                    ON CONFLICT (account_id) DO UPDATE SET kind = EXCLUDED.kind, updated_by = EXCLUDED.updated_by, updated_at = now()`, [id, kind, actor]);
    await db.query(`DELETE FROM perm_account_groups WHERE account_id = $1::uuid`, [id]);
    for (const g of groups) await db.query(
      `INSERT INTO perm_account_groups (account_id, group_key, expires_at, granted_by) VALUES ($1::uuid, $2, $3::timestamptz, $4)`,
      [id, g.key, dateOrNull(g.expiresAt), actor]);
    await db.query(`DELETE FROM perm_account_overrides WHERE account_id = $1::uuid`, [id]);
    for (const o of ovs) await db.query(
      `INSERT INTO perm_account_overrides (account_id, task_key, level, effect, expires_at, reason, granted_by) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $6, $7)`,
      [id, o.taskKey, o.level, o.effect, dateOrNull(o.expiresAt), (o.reason ?? reason).trim().slice(0, 200) || reason, actor]);
    if (!acc.sup) {   // v10.563 (D291) 함께 못 갖는 조합(정산 승인 ↔ 지급 실행 등) — 422 PERM_CONFLICT(perm-sets 는 이 파일을 가져오므로 늦게 불러 고리를 피함)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { assertNoConflict } = require('./perm-sets') as typeof import('./perm-sets');   // 부르는 순간에 가져옴(서로 가져오는 고리)
      const effRows = await db.query<{ task_key: string; level: string }>(`SELECT task_key, level FROM fn_perm_effective($1::uuid)`, [id]);
      await assertNoConflict(db, new Set(effRows.map((e) => `${e.task_key}:${e.level}`)), '이 사원의 권한');
    }
    await changed(db, 'ACCOUNT', id, 'SAVE', { kind, groups: groups.map((g) => g.key), overrides: ovs.length, super: acc.sup }, reason, actor);
  });
  return { ok: true, id, note: acc.sup ? '저장했습니다 — 이 사람은 SUPER 라 권한그룹과 상관없이 모든 권한입니다.' : '개인권한을 저장했습니다 — 길어야 1분 안에 반영됩니다.' };
}

/** GET /admin/perm/accounts/{id} — 개인권한 · 지금 권한 미리보기(보이는 업무) */
export async function accountDetail(db: DatabaseService, id: string) {
  const [acc] = await db.query(
    `SELECT a.id::text AS id, coalesce(a.name, '') AS name, a.email,
            coalesce((SELECT array_agg(r.role ORDER BY r.role) FROM account_roles r WHERE r.account_id = a.id), '{}') AS roles,
            coalesce((SELECT k.kind FROM perm_account_kind k WHERE k.account_id = a.id), 'STAFF') AS kind
       FROM accounts a WHERE a.id::text = $1`, [id]);
  if (!acc) throw new NotFound('없는 계정입니다.');
  const groups = await db.query(`SELECT group_key AS key, expires_at AS "expiresAt" FROM perm_account_groups WHERE account_id::text = $1 ORDER BY group_key`, [id]);
  const overrides = await db.query(
    `SELECT task_key AS "taskKey", level, effect, expires_at AS "expiresAt", reason FROM perm_account_overrides WHERE account_id::text = $1 ORDER BY task_key, level`, [id]);
  const eff = await db.query<{ task_key: string; level: string }>(`SELECT task_key, level FROM fn_perm_effective($1::uuid)`, [id]);
  const preview: Record<string, string[]> = {};
  for (const e of eff) (preview[e.task_key] ??= []).push(e.level);
  return { account: acc, groups, overrides, preview, note: '미리보기는 권한그룹 기준입니다 — 실제로 보이려면 역할(@Roles)도 맞아야 합니다(둘 다 통과).' };
}

export async function shadowLog(db: DatabaseService, days: number) {
  const d = Math.min(90, Math.max(1, Math.floor(days) || 7));
  const rows = await db.query(
    `SELECT s.method, s.pattern, s.task_keys AS "taskKeys", s.level, s.mode, count(*)::int AS n, max(s.created_at) AS "lastAt",
            array_agg(DISTINCT coalesce(a.name, a.email)) AS who
       FROM perm_shadow_log s LEFT JOIN accounts a ON a.id = s.account_id
      WHERE s.created_at > now() - make_interval(days => $1::int)
      GROUP BY s.method, s.pattern, s.task_keys, s.level, s.mode ORDER BY max(s.created_at) DESC LIMIT 200`, [d]);
  return { days: d, rows, mode: await permMode(db),
           note: 'SHADOW 기록은 「권한그룹대로라면 막혔을」 요청입니다. 맞게 막힌 것이면 그대로, 막히면 안 되는 것이면 권한그룹에 더한 뒤 perm.enforce 를 ON 으로.' };
}

export async function permChanges(db: DatabaseService) {
  return db.query(
    `SELECT c.id::text AS id, c.target_kind AS "targetKind", c.target, c.action, c.detail, c.reason, c.created_at AS "createdAt", a.email AS actor
       FROM perm_changes c LEFT JOIN accounts a ON a.id = c.actor_id ORDER BY c.id DESC LIMIT 100`);
}

/* ---------------------------------------------------------------------
 * v10.442 (D258 · docs/579) 권한 넓히기 — perm.allow_widen(처음 off) · perm.enforce = ON 일 때만
 *   AuthGuard 의 역할 검사가 실패한 지점에서 부름 — 역할(@Roles)로는 막히지만 권한그룹 · 개인권한이 그 주소의 업무 · 수준을 주면 통과.
 *   넓히지 않는 것(늘 막음): 회원 API(운영 역할만 요구하는 API 가 아니면) · SUPER 전용 API · 운영 역할이 없는 계정 ·
 *     권한 관리 · 역할 주기 · 외부 연동 · AI 키 · 결제 · 정산 · 출금 · 환불 쓰기 · 개인정보(회원 · 감사 · 세금 번호) 내려받기.
 *   2단계 인증 · 접속 인증은 AuthGuard 가 그대로 이어서 봄. 통과하면 perm_widen_log + 감사 기록 PERM_WIDEN(같은 사람 · 주소 10분에 한 번).
 * ------------------------------------------------------------------- */
let widenCache: { at: number; on: boolean } | null = null;
const widenSeen = new Map<string, number>();
export function widenCacheClear() { widenCache = null; }
export async function widenOn(db: DatabaseService) {
  if (widenCache && Date.now() - widenCache.at < 30_000) return widenCache.on;
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'perm.allow_widen'`).catch(() => [] as Array<{ value: string | null }>);
  widenCache = { at: Date.now(), on: r?.value === 'on' };
  return widenCache.on;
}
/* 실제 주소(src @Controller · 경로 대조 · 보안 점검 11/19) — 권한 · 역할 · 2단계 · 키 · 허용 IP · 전체 설정 · 정기 작업 · 감사 */
const WIDEN_DENY = [/^\/admin\/perm(\/|$)/, /^\/admin\/reports\/roles(\/|$)/, /^\/admin\/roles?(\/|$)/, /^\/admin\/accounts\/[^/]+\/(roles|mfa-reset)(\/|$)/,
  /^\/admin\/mfa(\/|$)/, /^\/admin\/integrations?(\/|$)/, /^\/admin\/integration-keys(\/|$)/, /^\/admin\/integ-tests(\/|$)/, /^\/admin\/secrets?(\/|$)/,
  /^\/admin\/agent\/(key|model-prices)(\/|$)/, /^\/admin\/map\/keys(\/|$)/, /^\/admin\/weather\/key(\/|$)/,
  /^\/admin\/staff-access(\/|$)/, /^\/admin\/staff-ip(\/|$)/, /^\/admin\/site-settings(\/|$)/, /^\/admin\/security(\/|$)/, /^\/admin\/jobs(\/|$)/, /^\/admin\/audit(\/|$)/];
const WIDEN_DENY_WRITE = [/payout/, /settlement/, /cashout/, /refund/, /\/pay(\/|$)/, /\/paid(\/|$)/, /payments?(\/|$)/, /^\/admin\/fin\/transfers(\/|$)/];   // v10.454 (D261) 대량 이체는 넓히지 않음
const WIDEN_DENY_EXPORT = [/member/, /privacy/, /account/, /audit/, /tax-?id/, /pii/, /payout/];

export async function widenAllowed(db: DatabaseService, p: { accountId: string; roles: string[] } | undefined,
                                   req: { method?: string; originalUrl?: string; url?: string; ip?: string; headers?: Record<string, unknown> }, required: string[]) {
  if (!p || !required?.length) return false;
  if (!required.every((r) => PERM_OPS.includes(r))) return false;              // 회원 API 는 넓히지 않음
  if (required.every((r) => r === 'SUPER')) return false;                       // SUPER 전용
  if (!p.roles.some((r) => PERM_OPS.includes(r) && r !== 'SUPER')) return false; // 운영 역할이 있는 계정만
  if ((await permMode(db)) !== 'ON' || !(await widenOn(db))) return false;
  const method0 = String(req.method ?? '').toUpperCase();
  const method = method0 === 'HEAD' ? 'GET' : method0;
  const raw = String(req.originalUrl ?? req.url ?? '');
  const path = raw.split('?')[0]!.toLowerCase().replace(/^\/api\/v1/, '');
  if (WIDEN_DENY.some((re) => re.test(path))) return false;
  if (method !== 'GET' && WIDEN_DENY_WRITE.some((re) => re.test(path))) return false;
  const need = await routeNeeds(db, method, raw);
  if (!need.length) return false;
  if (need.some((n) => n.level === 'EXPORT') && WIDEN_DENY_EXPORT.some((re) => re.test(path))) return false;
  const eff = await widenEffective(db, p.accountId);
  /* 한 주소가 여러 업무에 걸리면 모두 가져야 넓힘(하나만 맞아도 통과하면 다른 업무 범위까지 열림) */
  if (!need.every((n) => eff.has(`${n.task}:${n.level}`))) return false;
  const hit = need[0]!;
  const k = `${p.accountId}|${method}|${hit.pattern}`;
  if (Date.now() - (widenSeen.get(k) ?? 0) > 600_000) {
    widenSeen.set(k, Date.now());
    if (widenSeen.size > 5000) widenSeen.clear();
    await db.query(
      `INSERT INTO perm_widen_log (account_id, method, path, task_key, level, roles, required) VALUES ($1::uuid, $2, $3, $4, $5, $6::text[], $7::text[])`,
      [p.accountId, method, path.slice(0, 300), hit.task, hit.level, p.roles, required]).catch(() => undefined);
    await db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, 'PERM_WIDEN', 'PERM', NULL, $3::jsonb, $4, $5)`,
      [p.accountId, p.roles[0] ?? null, JSON.stringify({ method, path: path.slice(0, 300), task: hit.task, level: hit.level, required }),
       req.ip ?? null, String(req.headers?.['user-agent'] ?? '').slice(0, 300) || null]).catch(() => undefined);
  }
  return true;
}

/** GET /admin/perm/widen-log — 넓혀서 통과한 요청(최근 100) */
export async function widenLog(db: DatabaseService) {
  const items = await db.query(
    `SELECT w.id::text AS id, w.created_at AS "createdAt", coalesce(a.name, a.email) AS who, w.method, w.path, w.task_key AS task, w.level, w.roles, w.required
       FROM perm_widen_log w LEFT JOIN accounts a ON a.id = w.account_id ORDER BY w.id DESC LIMIT 100`);
  return { on: await widenOn(db), mode: await permMode(db), items,
           note: '권한 넓히기는 perm.allow_widen = on 이고 검사 모드가 ON 일 때만 동작합니다. SUPER 전용 · 권한 관리 · 결제 · 정산 지급 · 개인정보 내려받기는 늘 막습니다.' };
}

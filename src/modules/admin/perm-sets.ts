import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { LEVELS, permCacheClear } from './perm.service';
import { STAFF_ROLES } from './staff';

/* ---------------------------------------------------------------------
 * v10.562 (D291 · docs/704) 업무 목록 → 업무그룹 → 권한그룹 — 대표 11/21 「사원 권한은 권한그룹이 정함」
 *   업무(perm_tasks · 탭 하나) — 이름 · 설명 · 쓸 수 있는 수준 · 켜고 끄기 · 주소 연결 수
 *   업무그룹(perm_task_groups) — 만들기 · 고치기 · 끄기 · 업무 넣고 빼기 · 업무 하나가 여러 업무그룹에(perm_task_group_items)
 *     perm_tasks.group_key 는 「기본 메뉴 그룹」으로 남김(메뉴 그룹과 같은 처음 업무그룹은 지우지 않음 · 끄기만)
 *   권한그룹(perm_role_groups) — 항목 = 업무그룹 × 수준(perm_role_group_sets) + 업무 단위 더하기/빼기(perm_role_group_items.effect ALLOW · DENY)
 *     실제 여는 업무 = fn_perm_effective(D291 새 판)가 세트를 펼치고 · 더하기를 더하고 · 그 그룹의 빼기를 뺀 것(그룹끼리는 합)
 *   함께 못 갖는 조합(perm_conflict_rules · perm_conflict_items) — 한 권한그룹 · 한 사람의 실제 권한에 A 쪽 하나와 B 쪽 하나가 함께 있으면 422 PERM_CONFLICT
 *     처음 3줄: 정산 승인 ↔ 지급 실행(C710 · ADMIN · PAYOUT 분리) · 지급 실행 ↔ 안심 파트너 · 지급 실행 ↔ 제휴 파트너(D173)
 *   바꾼 것은 perm_changes(쌓기만) · 운영 알림 PERM_CHANGED · 캐시 비움.
 * ------------------------------------------------------------------- */

const TASK_KEY = /^[a-z][a-z0-9-]{1,40}$/;
const GROUP_KEY = /^[a-z][a-z0-9_]{1,30}$/;
const ROLE_GROUP_KEY = /^[A-Z][A-Z0-9_]{1,40}$/;
const RULE_CODE = /^[A-Z][A-Z0-9_]{1,40}$/;
const isLevel = (l: string) => (LEVELS as readonly string[]).includes(l);

const reasonOk = (r: string | undefined) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('PERM_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};
const nameOk = (n: string | undefined, max = 60) => {
  const t = (n ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 1 || t.length > max) throw new PolicyViolation('PERM_NAME', `이름은 1 ~ ${max}자입니다.`);
  return t;
};

export async function permLog(db: DatabaseService, kind: string, target: string, action: string, detail: unknown, reason: string, actor: string | null) {
  await db.query(`INSERT INTO perm_changes (target_kind, target, action, detail, reason, actor_id) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [kind, target, action, JSON.stringify(detail ?? {}), reason, actor]);
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PERM_CHANGED', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [`업무 권한 바뀜 — ${kind} ${target} · ${action}(${reason})`.slice(0, 280), JSON.stringify({ kind, target, action })]).catch(() => undefined);
  permCacheClear();
}

/* ── 업무 목록 ─────────────────────────────────────────────────── */

/** GET /admin/perm/tasks — 업무 · 업무그룹(여럿) · 주소 연결 수 · 붙은 권한그룹 수 */
export async function taskList(db: DatabaseService) {
  const items = await db.query<{ key: string; routes: number }>(
    `SELECT t.key, t.name, t.description, t.group_key AS "menuGroup", t.levels, t.sort, t.active,
            coalesce((SELECT array_agg(i.group_key ORDER BY i.group_key) FROM perm_task_group_items i WHERE i.task_key = t.key), '{}') AS groups,
            (SELECT count(*)::int FROM perm_route_map m WHERE m.task_key = t.key) AS routes,
            (SELECT count(DISTINCT x.group_key)::int FROM (
               SELECT i.group_key FROM perm_role_group_items i WHERE i.task_key = t.key AND i.effect = 'ALLOW'
               UNION SELECT s.group_key FROM perm_role_group_sets s JOIN perm_task_group_items gi ON gi.group_key = s.task_group_key WHERE gi.task_key = t.key) x) AS "roleGroups"
       FROM perm_tasks t ORDER BY t.sort, t.key`);
  return { items, levels: LEVELS, noRoute: items.filter((x) => x.routes === 0).length,
           note: '업무 하나는 운영 화면 탭 하나입니다. 「주소 연결 없음」은 서버 API 와 이어지지 않은 업무입니다(화면 메뉴만 가림). 탭 목록에 있는데 업무에 없는 것은 화면이 따로 보여 줍니다.' };
}

/** POST /admin/perm/tasks — 탭 목록에는 있는데 업무에 없는 것 더하기 */
export async function createTask(db: DatabaseService, b: { key: string; name: string; groupKey: string; description?: string; levels?: string[]; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  if (!TASK_KEY.test(b.key ?? '')) throw new PolicyViolation('PERM_TASK', '업무 키는 탭 키(소문자 · 숫자 · -)와 같게 적습니다.');
  if (!GROUP_KEY.test(b.groupKey ?? '')) throw new PolicyViolation('PERM_GROUP', '업무그룹 키가 바르지 않습니다.');
  const levels = (b.levels?.length ? b.levels : [...LEVELS]).filter(isLevel);
  if (!levels.length) throw new PolicyViolation('PERM_LEVELS', '수준을 하나 이상 고르십시오.');
  const [g] = await db.query(`SELECT key FROM perm_task_groups WHERE key = $1`, [b.groupKey]);
  if (!g) throw new PolicyViolation('PERM_GROUP', '없는 업무그룹입니다.');
  const r = await db.query(
    `INSERT INTO perm_tasks (key, name, group_key, levels, sort, description) VALUES ($1, $2, $3, $4::text[], 9000, nullif($5, '')) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [b.key, nameOk(b.name), b.groupKey, levels, (b.description ?? '').trim().slice(0, 300)]);
  if (!r.length) throw new PolicyViolation('PERM_TASK', '이미 있는 업무입니다.');
  await permLog(db, 'TASK', b.key, 'CREATE', { groupKey: b.groupKey, levels }, reason, actor);
  return { ok: true, key: b.key, note: '업무를 더했습니다 — 메뉴 그룹(업무그룹)에도 넣었습니다(트리거).' };
}

/** PUT /admin/perm/tasks/{key} — 이름 · 설명 · 수준 · 켜고 끄기 */
export async function saveTaskInfo(db: DatabaseService, key: string, b: { name?: string; description?: string; levels?: string[]; active?: boolean; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  const levels = b.levels === undefined ? null : b.levels.filter(isLevel);
  if (levels && !levels.length) throw new PolicyViolation('PERM_LEVELS', '수준을 하나 이상 고르십시오.');
  const r = await db.query(
    `UPDATE perm_tasks SET name = coalesce($2, name), description = CASE WHEN $3::text IS NULL THEN description ELSE nullif($3::text, '') END,
            levels = coalesce($4::text[], levels), active = coalesce($5, active) WHERE key = $1 RETURNING key`,
    [key, b.name === undefined ? null : nameOk(b.name), b.description === undefined ? null : b.description.trim().slice(0, 300), levels, b.active ?? null]);
  if (!r.length) throw new NotFound('없는 업무입니다.');
  await permLog(db, 'TASK', key, 'INFO', { name: b.name, levels, active: b.active }, reason, actor);
  return { ok: true, key, note: '업무를 고쳤습니다.' };
}

/* ── 업무그룹 ─────────────────────────────────────────────────── */

/** GET /admin/perm/task-groups — 업무그룹 · 든 업무 · 쓰는 권한그룹 수 */
export async function taskGroupList(db: DatabaseService) {
  const items = await db.query(
    `SELECT g.key, g.name, g.sort, g.active, g.note,
            EXISTS (SELECT 1 FROM perm_tasks t WHERE t.group_key = g.key) AS "menuGroup",
            coalesce((SELECT array_agg(i.task_key ORDER BY i.task_key) FROM perm_task_group_items i WHERE i.group_key = g.key), '{}') AS tasks,
            (SELECT count(DISTINCT s.group_key)::int FROM perm_role_group_sets s WHERE s.task_group_key = g.key) AS "roleGroups"
       FROM perm_task_groups g ORDER BY g.sort, g.key`);
  return { items, note: '업무 하나가 여러 업무그룹에 들 수 있습니다. 메뉴 그룹과 같은 처음 업무그룹은 지우지 않고 끄기만 합니다(끄면 그 업무그룹으로 붙인 권한이 모두 빠짐).' };
}

/** PUT /admin/perm/task-groups/{key} — 만들기 · 고치기(든 업무 통째로) */
export async function saveTaskGroupFull(db: DatabaseService, key: string,
  b: { name: string; sort?: number; active?: boolean; note?: string; tasks?: string[]; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  if (!GROUP_KEY.test(key)) throw new PolicyViolation('PERM_GROUP', '업무그룹 키는 소문자 · 숫자 · 밑줄 2 ~ 31자입니다.');
  const name = nameOk(b.name, 40);
  const tasks = [...new Set((b.tasks ?? []).map((t) => String(t)))];
  if (tasks.length > 600) throw new PolicyViolation('PERM_ITEMS', '업무가 너무 많습니다.');
  if (tasks.some((t) => !TASK_KEY.test(t))) throw new PolicyViolation('PERM_TASK', '업무 키가 바르지 않습니다.');
  const known = new Set((await db.query<{ key: string }>(`SELECT key FROM perm_tasks`)).map((t) => t.key));
  const bad = tasks.find((t) => !known.has(t));
  if (bad) throw new PolicyViolation('PERM_TASK', `없는 업무입니다: ${bad}`);
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO perm_task_groups (key, name, sort, active, note, updated_by) VALUES ($1, $2, coalesce($3, 5000), coalesce($4, true), nullif($5, ''), $6)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, sort = coalesce($3, perm_task_groups.sort), active = coalesce($4, perm_task_groups.active),
                                     note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, name, b.sort ?? null, b.active ?? null, (b.note ?? '').trim().slice(0, 200), actor]);
    if (b.tasks !== undefined) {
      await db.query(`DELETE FROM perm_task_group_items WHERE group_key = $1`, [key]);
      if (tasks.length) await db.query(`INSERT INTO perm_task_group_items (group_key, task_key) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [key, tasks]);
    }
    await permLog(db, 'TASK_GROUP', key, 'SAVE', { name, active: b.active, tasks: b.tasks === undefined ? null : tasks.length }, reason, actor);
  });
  /* 업무그룹이 바뀌면 그 업무그룹을 쓰는 권한그룹 · 사람의 조합 규칙도 다시 봄 — 어긋나면 알려만 줌(저장은 그대로) */
  const clash = await conflictsOfRoleGroupsUsing(db, key);
  return { ok: true, key, tasks: tasks.length, conflicts: clash,
           note: clash.length ? `저장했습니다 — 이 업무그룹을 쓰는 권한그룹 ${clash.length}개가 함께 못 갖는 조합에 걸립니다(권한그룹 화면에서 고치십시오).` : '업무그룹을 저장했습니다.' };
}

/* ── 함께 못 갖는 조합 ─────────────────────────────────────────── */

interface RuleItem { code: string; side: string; task_key: string; level: string }
async function rules(db: DatabaseService) {
  const rs = await db.query<{ code: string; name: string; note: string | null; active: boolean }>(`SELECT code, name, note, active FROM perm_conflict_rules ORDER BY code`);
  const its = await db.query<RuleItem>(`SELECT code, side, task_key, level FROM perm_conflict_items ORDER BY code, side, task_key, level`);
  return rs.map((r) => ({ ...r, a: its.filter((i) => i.code === r.code && i.side === 'A').map((i) => `${i.task_key}:${i.level}`),
                                b: its.filter((i) => i.code === r.code && i.side === 'B').map((i) => `${i.task_key}:${i.level}`) }));
}

/** 실제 권한(업무:수준 묶음)에 걸리는 규칙 */
export async function conflictsOf(db: DatabaseService, eff: Set<string>) {
  return (await rules(db)).filter((r) => r.active && r.a.some((x) => eff.has(x)) && r.b.some((x) => eff.has(x)))
    .map((r) => ({ code: r.code, name: r.name, a: r.a.filter((x) => eff.has(x)), b: r.b.filter((x) => eff.has(x)) }));
}
export async function assertNoConflict(db: DatabaseService, eff: Set<string>, who: string) {
  const hit = await conflictsOf(db, eff);
  if (hit.length) {
    const h = hit[0]!;
    throw new PolicyViolation('PERM_CONFLICT', `${who}에 함께 가질 수 없는 권한이 있습니다 — ${h.name}(${h.a.join(', ')} ↔ ${h.b.join(', ')}).`, { conflicts: hit });
  }
}

/** 권한그룹 하나를 펼친 실제 업무:수준(DB 함수 fn_perm_group_expand · D291) */
export async function expandRoleGroup(db: DatabaseService, key: string) {
  const rows = await db.query<{ task_key: string; level: string }>(`SELECT task_key, level FROM fn_perm_group_expand($1)`, [key]);
  return new Set(rows.map((r) => `${r.task_key}:${r.level}`));
}
async function conflictsOfRoleGroupsUsing(db: DatabaseService, taskGroupKey: string) {
  const gs = await db.query<{ group_key: string }>(`SELECT DISTINCT group_key FROM perm_role_group_sets WHERE task_group_key = $1`, [taskGroupKey]);
  const out: Array<{ group: string; code: string }> = [];
  for (const g of gs) for (const c of await conflictsOf(db, await expandRoleGroup(db, g.group_key))) out.push({ group: g.group_key, code: c.code });
  return out;
}

/** GET /admin/perm/conflicts */
export async function conflictList(db: DatabaseService) {
  return { items: await rules(db), note: '한 권한그룹 · 한 사람의 실제 권한에 A 쪽 하나와 B 쪽 하나가 함께 있으면 저장을 막습니다(422 PERM_CONFLICT). 역할 겸직 금지(C710 · D173)를 권한그룹에 옮긴 것입니다.' };
}

/** PUT /admin/perm/conflicts/{code} */
export async function saveConflict(db: DatabaseService, code: string, b: { name: string; note?: string; active?: boolean; a: string[]; b: string[]; reason?: string }, actor: string | null) {
  const reason = reasonOk(b.reason);
  if (!RULE_CODE.test(code)) throw new PolicyViolation('PERM_KEY', '규칙 코드는 대문자 · 숫자 · 밑줄입니다.');
  const parse = (xs: string[]) => [...new Set(xs ?? [])].map((x) => { const [t, l] = String(x).split(':'); if (!TASK_KEY.test(t ?? '') || !isLevel(l ?? '')) throw new PolicyViolation('PERM_TASK', `「업무:수준」 모양이 아닙니다: ${x}`); return [t!, l!] as const; });
  const A = parse(b.a), B = parse(b.b);
  if (!A.length || !B.length) throw new PolicyViolation('PERM_ITEMS', 'A 쪽 · B 쪽에 하나 이상씩 넣으십시오.');
  await db.transaction(async () => {
    await db.query(`INSERT INTO perm_conflict_rules (code, name, note, active) VALUES ($1, $2, nullif($3, ''), coalesce($4, true))
                    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, note = EXCLUDED.note, active = coalesce($4, perm_conflict_rules.active), updated_at = now()`,
      [code, nameOk(b.name), (b.note ?? '').trim().slice(0, 200), b.active ?? null]);
    await db.query(`DELETE FROM perm_conflict_items WHERE code = $1`, [code]);
    await db.query(`INSERT INTO perm_conflict_items (code, side, task_key, level)
                    SELECT $1, x.s, x.t, x.l FROM jsonb_to_recordset($2::jsonb) AS x(s text, t text, l text)
                     WHERE EXISTS (SELECT 1 FROM perm_tasks k WHERE k.key = x.t) ON CONFLICT DO NOTHING`,
      [code, JSON.stringify([...A.map(([t, l]) => ({ s: 'A', t, l })), ...B.map(([t, l]) => ({ s: 'B', t, l }))])]);
    await permLog(db, 'ROLE_GROUP', code, 'CONFLICT_RULE', { a: A.length, b: B.length, active: b.active }, reason, actor);
  });
  return { ok: true, code, note: '조합 규칙을 저장했습니다 — 이미 붙어 있는 사람은 그대로이고, 다음 저장부터 막습니다(사원 권한 화면에 「조합 어긋남」 표시).' };
}

/* ── 권한그룹(업무그룹 × 수준) ──────────────────────────────────── */

/** GET /admin/perm/role-groups/{key}/sets — 세트 · 업무 더하기/빼기 · 실제 여는 업무 · 조합 */
export async function roleGroupSets(db: DatabaseService, key: string) {
  const [g] = await db.query(`SELECT key, name, kind, from_role AS "fromRole", note, active FROM perm_role_groups WHERE key = $1`, [key]);
  if (!g) throw new NotFound('없는 권한그룹입니다.');
  const sets = await db.query(`SELECT task_group_key AS "taskGroupKey", level FROM perm_role_group_sets WHERE group_key = $1 ORDER BY task_group_key, level`, [key]);
  const items = await db.query(`SELECT task_key AS "taskKey", level, effect FROM perm_role_group_items WHERE group_key = $1 ORDER BY task_key, level`, [key]);
  const eff = await expandRoleGroup(db, key);
  const preview: Record<string, string[]> = {};
  for (const k of eff) { const [t, l] = k.split(':'); (preview[t!] ??= []).push(l!); }
  return { group: g, sets, items, preview, tasks: Object.keys(preview).length, conflicts: await conflictsOf(db, eff),
           note: '실제 여는 업무는 업무그룹 × 수준을 펼친 것 + 업무 더하기 − 이 그룹의 업무 빼기. 업무의 쓸 수 있는 수준 · 꺼진 업무 · 꺼진 업무그룹은 빠집니다.' };
}

/** PUT /admin/perm/role-groups/{key}/sets — 만들기 · 고치기(세트 · 항목 통째로) · 조합 검사 */
export async function saveRoleGroupSets(db: DatabaseService, key: string,
  b: { name: string; kind?: string; note?: string; active?: boolean; sets: Array<{ taskGroupKey: string; level: string }>; items?: Array<{ taskKey: string; level: string; effect?: string }>; reason?: string },
  actor: string | null) {
  const reason = reasonOk(b.reason);
  if (!ROLE_GROUP_KEY.test(key)) throw new PolicyViolation('PERM_KEY', '권한그룹 키는 대문자 · 숫자 · 밑줄입니다.');
  const kind = b.kind === 'MANAGER' ? 'MANAGER' : 'STAFF';
  const sets = (b.sets ?? []).filter((s) => GROUP_KEY.test(s.taskGroupKey ?? '') && isLevel(s.level));
  const items = (b.items ?? []).filter((i) => TASK_KEY.test(i.taskKey ?? '') && isLevel(i.level)).map((i) => ({ ...i, effect: i.effect === 'DENY' ? 'DENY' : 'ALLOW' }));
  if (sets.length > 400 || items.length > 2000) throw new PolicyViolation('PERM_ITEMS', '항목이 너무 많습니다.');
  const tg = new Set((await db.query<{ key: string }>(`SELECT key FROM perm_task_groups`)).map((x) => x.key));
  const badG = sets.find((s) => !tg.has(s.taskGroupKey));
  if (badG) throw new PolicyViolation('PERM_GROUP', `없는 업무그룹입니다: ${badG.taskGroupKey}`);
  const tk = new Set((await db.query<{ key: string }>(`SELECT key FROM perm_tasks`)).map((x) => x.key));
  const badT = items.find((i) => !tk.has(i.taskKey));
  if (badT) throw new PolicyViolation('PERM_TASK', `없는 업무입니다: ${badT.taskKey}`);
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO perm_role_groups (key, name, kind, note, active, created_by) VALUES ($1, $2, $3, nullif($4, ''), coalesce($5, true), $6)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, note = EXCLUDED.note, active = coalesce($5, perm_role_groups.active), updated_at = now()`,
      [key, nameOk(b.name, 40), kind, (b.note ?? '').trim().slice(0, 200), b.active ?? null, actor]);
    await db.query(`DELETE FROM perm_role_group_sets WHERE group_key = $1`, [key]);
    if (sets.length) await db.query(
      `INSERT INTO perm_role_group_sets (group_key, task_group_key, level) SELECT $1, x.g, x.l FROM jsonb_to_recordset($2::jsonb) AS x(g text, l text) ON CONFLICT DO NOTHING`,
      [key, JSON.stringify(sets.map((s) => ({ g: s.taskGroupKey, l: s.level })))]);
    await db.query(`DELETE FROM perm_role_group_items WHERE group_key = $1`, [key]);
    if (items.length) await db.query(
      `INSERT INTO perm_role_group_items (group_key, task_key, level, effect) SELECT $1, x.t, x.l, x.e FROM jsonb_to_recordset($2::jsonb) AS x(t text, l text, e text) ON CONFLICT DO NOTHING`,
      [key, JSON.stringify(items.map((i) => ({ t: i.taskKey, l: i.level, e: i.effect })))]);
    /* 같은 거래 안에서 펼쳐 조합 검사 — 걸리면 통째로 되돌림 */
    await assertNoConflict(db, await expandRoleGroup(db, key), `권한그룹 ${key} `);
    await permLog(db, 'ROLE_GROUP', key, 'SAVE_SETS', { name: b.name, kind, sets: sets.length, items: items.length }, reason, actor);
  });
  return { ok: true, key, sets: sets.length, items: items.length, note: '권한그룹을 저장했습니다 — 붙은 사람에게 길어야 1분 안에 반영됩니다.' };
}

/* ── 사원 권한 ─────────────────────────────────────────────────── */

/** GET /admin/perm/staff — 사원(운영 역할 계정)마다 붙은 권한그룹 · 개별 수 · 실제 업무 수 · 조합 어긋남 · 직원 연결 */
export async function permStaffList(db: DatabaseService) {
  const rows = await db.query<{ id: string }>(
    `SELECT a.id::text AS id, coalesce(a.name, '') AS name, a.email::text AS email, a.status,
            array_agg(DISTINCT r.role) AS roles,
            coalesce((SELECT json_agg(json_build_object('key', g.group_key, 'expiresAt', g.expires_at) ORDER BY g.group_key) FROM perm_account_groups g WHERE g.account_id = a.id), '[]'::json) AS groups,
            (SELECT count(*)::int FROM perm_account_overrides o WHERE o.account_id = a.id) AS overrides,
            (SELECT count(DISTINCT e.task_key)::int FROM fn_perm_effective(a.id) e) AS tasks,
            (SELECT e.name FROM acct_employees e WHERE e.account_id = a.id) AS "employeeName"
       FROM accounts a JOIN account_roles r ON r.account_id = a.id AND r.role = ANY($1::text[])
      GROUP BY a.id ORDER BY (a.status = 'ACTIVE') DESC, a.email LIMIT 500`, [[...STAFF_ROLES]]);
  const out = [];
  for (const r of rows) {
    const effRows = await db.query<{ task_key: string; level: string }>(`SELECT task_key, level FROM fn_perm_effective($1::uuid)`, [r.id]);
    const c = await conflictsOf(db, new Set(effRows.map((e) => `${e.task_key}:${e.level}`)));
    out.push({ ...r, conflicts: c.map((x) => x.code) });
  }
  return { items: out, note: '사원의 업무 권한은 붙은 권한그룹(기한) + 개별 더하기 − 개별 빼기입니다. 역할(운영 · 검수 …)을 받으면 같은 범위의 처음 권한그룹(R_역할)이 저절로 붙습니다. SUPER 는 늘 모든 권한입니다.' };
}

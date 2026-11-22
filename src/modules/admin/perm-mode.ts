import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { PERM_OPS, effective, permCacheClear, routeNeeds } from './perm.service';
import { permLog } from './perm-sets';
import { PGX_OPEN } from './pgx-open';   // v10.615 (docs/757) 역할 이름 검사 중 권한그룹과 맞추지 않은 곳(지금 0)

/* ---------------------------------------------------------------------
 * v10.564 (D291 · docs/706) 판정 바꾸기 — 설정 perm.mode
 *   ROLE    (처음) 지금처럼 @Roles 가 먼저 · 권한그룹은 perm.enforce(OFF · SHADOW · ON)대로 좁히기만
 *   COMPARE @Roles 로 통과 · 막음은 그대로 · 권한그룹 판정이 다르면 perm_shadow_log(mode COMPARE · diff ROLE_ONLY / GROUP_ONLY)에 「다름」
 *   GROUPS  운영 역할 계정이 운영 역할만 요구하는 API 를 부르면 @Roles 의 역할 검사 대신 권한그룹이 정함
 *           · 회원 역할(MEMBER · BIZ_OWNER · BIZ_STAFF)이 섞인 API 는 역할 그대로 · SUPER 전용 API 는 역할 그대로(권한그룹으로 열지 않음)
 *           · SUPER 는 늘 모두 · 표(perm_route_map)에 없는 주소는 역할 그대로(GROUPS 로 바꿀 때 0 이어야 함)
 *   GROUPS 로 바꾸기는 SUPER 만 · 「연결 안 된 /admin 주소 0 · 최근 24시간 다름 0」 일 때만(서버가 막음 · DB 트리거도 막음)
 *   되돌리기(GROUPS → COMPARE · ROLE)는 조건 없음(SUPER 만) — 잠김 방지: SUPER 는 늘 통과 · perm.mode API 는 SUPER 전용이라 권한그룹을 보지 않음.
 *   바꾸는 곳: core/auth.ts AuthGuard(역할 검사 자리) · core/perm.guard.ts — 두 군데만. 컨트롤러 @Roles 는 그대로.
 * ------------------------------------------------------------------- */

export const PERM_MODES = ['ROLE', 'COMPARE', 'GROUPS'] as const;
export type PermDecideMode = typeof PERM_MODES[number];

let pmCache: { at: number; mode: PermDecideMode } | null = null;
export function permModeCacheClear() { pmCache = null; }

export async function permDecideMode(db: DatabaseService): Promise<PermDecideMode> {
  if (pmCache && Date.now() - pmCache.at < 30_000) return pmCache.mode;
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'perm.mode'`).catch(() => [] as Array<{ value: string | null }>);
  const mode = (PERM_MODES as readonly string[]).includes(r?.value ?? '') ? (r!.value as PermDecideMode) : 'ROLE';
  pmCache = { at: Date.now(), mode };
  return mode;
}

/** 이 요청을 권한그룹으로 볼 대상인지 — 운영 역할만 요구 · SUPER 전용 아님 · 부르는 사람에게 SUPER 아닌 운영 역할이 있음 */
export function groupsApplicable(principalRoles: readonly string[] | undefined | null, required: readonly string[] | undefined | null): boolean {
  if (!required?.length || !principalRoles?.length) return false;
  if (!required.every((r) => PERM_OPS.includes(r))) return false;      // 회원 역할 섞임 → 역할 그대로
  if (required.every((r) => r === 'SUPER')) return false;              // SUPER 전용 → 역할 그대로
  if (principalRoles.includes('SUPER')) return false;                  // SUPER 는 늘 통과(가드가 먼저 봄)
  return principalRoles.some((r) => PERM_OPS.includes(r));
}

/** 권한그룹 판정 — 표에 있는 주소면 true / false · 없으면 null(역할에 맡김) */
export async function groupsDecide(db: DatabaseService, accountId: string, method: string, url: string): Promise<boolean | null> {
  const need = await routeNeeds(db, String(method ?? '').toUpperCase(), String(url ?? ''));
  if (!need.length) return null;
  const eff = await effective(db, accountId);
  return need.some((n) => eff.has(`${n.task}:${n.level}`));
}

const diffSeen = new Map<string, number>();
/** COMPARE 「다름」 기록 — 같은 사람 · 주소 · 방향은 10분에 한 번 */
export async function logDiff(db: DatabaseService, accountId: string, method: string, url: string, diff: 'ROLE_ONLY' | 'GROUP_ONLY') {
  const need = await routeNeeds(db, String(method ?? '').toUpperCase(), String(url ?? ''));
  if (!need.length) return;
  const k = `${accountId}|${need[0]!.method}|${need[0]!.pattern}|${diff}`;
  if (Date.now() - (diffSeen.get(k) ?? 0) < 600_000) return;
  diffSeen.set(k, Date.now());
  if (diffSeen.size > 5000) diffSeen.clear();
  await db.query(
    `INSERT INTO perm_shadow_log (account_id, method, pattern, task_keys, level, mode, diff) VALUES ($1::uuid, $2, $3, $4::text[], $5, 'COMPARE', $6)`,
    [accountId, need[0]!.method, need[0]!.pattern, [...new Set(need.map((n) => n.task))], need[0]!.level, diff]).catch(() => undefined);
}

/* ── 연결 안 된 /admin 주소 ─────────────────────────────────────── */

export interface AdminRoute { method: string; pattern: string; roles: string[]; controller: string }
const M = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const ROLES_KEY = 'roles';   // core/auth.ts ROLES_KEY 와 같음(가져오면 auth → perm-mode → auth 고리라 글자로)

/** 실행 중 데코레이터에서 /api/v1/admin 주소 · @Roles — 통합 현황(admin-v31 routes)과 같은 방식 */
export function adminRoutes(modules: ModulesContainer): AdminRoute[] {
  const out: AdminRoute[] = [];
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...a: unknown[]) => unknown) | null;
      if (!cls) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
      const clsRoles: string[] = Reflect.getMetadata(ROLES_KEY, cls) ?? [];
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const fn = proto[name];
        if (typeof fn !== 'function') continue;
        const p = Reflect.getMetadata(PATH_METADATA, fn);
        const m = Reflect.getMetadata(METHOD_METADATA, fn);
        if (p === undefined || m === undefined) continue;
        const roles: string[] = Reflect.getMetadata(ROLES_KEY, fn) ?? clsRoles;
        const path = `/${[base, String(p)].map((s) => s.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;
        if (!path.startsWith('/api/v1/admin/')) continue;
        out.push({ method: M[m] ?? String(m), pattern: path.slice('/api/v1'.length).replace(/:(\w+)/g, '{$1}'), roles, controller: cls.name });
      }
    }
  }
  return out;
}

const norm = (p: string) => p.toLowerCase().replace(/\{[^}]+\}/g, '{}');

/** GET /admin/perm/unmapped-routes — 운영 역할만 요구 · SUPER 전용 아님 · perm_route_map 에 없는 주소 */
export async function unmappedRoutes(db: DatabaseService, modules: ModulesContainer) {
  const have = new Set((await db.query<{ method: string; pattern: string }>(`SELECT method, pattern FROM perm_route_map`)).map((r) => `${r.method} ${norm(r.pattern)}`));
  const all = adminRoutes(modules);
  const target = all.filter((r) => r.roles.length && r.roles.every((x) => PERM_OPS.includes(x)) && !r.roles.every((x) => x === 'SUPER'));
  const items = target.filter((r) => !have.has(`${r.method} ${norm(r.pattern)}`));
  return { total: all.length, target: target.length, unmapped: items.length, items: items.slice(0, 500),
           note: '연결 안 된 주소는 GROUPS 에서도 역할(@Roles)로만 판정합니다. 0 이어야 GROUPS 로 바꿀 수 있습니다 — 빠진 주소는 마이그레이션 시드(perm_route_map)로 채웁니다(도구 tools/perm_unmapped.py).' };
}

/** 최근 24시간 COMPARE 「다름」 수 · 최근 50줄 */
async function diffs(db: DatabaseService) {
  const [n] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM perm_shadow_log WHERE mode = 'COMPARE' AND diff IS NOT NULL AND created_at > now() - interval '24 hours'`);
  const recent = await db.query(
    `SELECT s.created_at AS "at", coalesce(a.name, a.email::text) AS who, s.method, s.pattern, s.task_keys AS "taskKeys", s.level, s.diff
       FROM perm_shadow_log s LEFT JOIN accounts a ON a.id = s.account_id
      WHERE s.mode = 'COMPARE' AND s.diff IS NOT NULL ORDER BY s.id DESC LIMIT 50`);
  return { diff24: Number(n?.n ?? 0), recent };
}

/** GET /admin/perm/mode */
export async function modeView(db: DatabaseService, modules: ModulesContainer) {
  const mode = await permDecideMode(db);
  const um = await unmappedRoutes(db, modules);
  const d = await diffs(db);
  const [since] = await db.query<{ at: string | null }>(
    `SELECT max(at) AS at FROM site_setting_changes WHERE key = 'perm.mode'`).catch(() => [{ at: null }]);
  /* v10.624 (docs/767) GROUPS 로 바꾸기 전 점검표 — 꼭(서버가 막음) 3줄 · 권장(화면이 알림만) 2줄 */
  const [enf] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'perm.enforce'`).catch(() => [{ value: null }]);
  const compareHours = mode === 'COMPARE' && since?.at ? Math.floor((Date.now() - new Date(since.at).getTime()) / 3_600_000) : 0;
  const checklist = [
    { key: 'unmapped', label: '연결 안 된 /admin 주소 0', ok: um.unmapped === 0, need: true, detail: String(um.unmapped) },
    { key: 'diff24', label: '최근 24시간 COMPARE 다름 0', ok: d.diff24 === 0, need: true, detail: String(d.diff24) },
    { key: 'roleChecks', label: '역할 이름으로 막는 곳 중 맞추지 않은 곳 0(docs/757)', ok: PGX_OPEN.length === 0, need: true, detail: String(PGX_OPEN.length) },
    { key: 'compare24', label: 'COMPARE 로 24시간 이상 돌림(다름 0 이 하루치여야 뜻이 있음)', ok: compareHours >= 24, need: false, detail: mode === 'COMPARE' ? `${compareHours}시간` : `지금 ${mode}` },
    { key: 'enforceOn', label: '검사 모드 perm.enforce = ON(SHADOW 기록을 본 뒤)', ok: enf?.value === 'ON', need: false, detail: String(enf?.value ?? '—') },
  ];
  return { mode, modes: PERM_MODES, unmapped: um.unmapped, unmappedItems: um.items.slice(0, 100), diff24: d.diff24, recent: d.recent, since: since?.at ?? null,
           checklist, compareHours, enforce: enf?.value ?? null,
           groupsReady: um.unmapped === 0 && d.diff24 === 0 && PGX_OPEN.length === 0, roleChecksOpen: PGX_OPEN.length,   // v10.615 (docs/757)
           note: 'ROLE → COMPARE 로 하루 이상 돌려 「다름」이 없고 연결 안 된 주소가 0 이면 GROUPS 로 바꿀 수 있습니다. 되돌리기는 언제든(SUPER).' };
}

/** PUT /admin/perm/mode — SUPER · 사유 · GROUPS 는 조건 */
export async function setMode(db: DatabaseService, modules: ModulesContainer, mode: string, reason: string | undefined, actor: string | null) {
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('PERM_REASON', '사유는 2 ~ 200자입니다.');
  if (!(PERM_MODES as readonly string[]).includes(mode)) throw new PolicyViolation('PERM_MODE', '판정 방식은 ROLE · COMPARE · GROUPS 중 하나입니다.');
  const cur = await permDecideMode(db);
  if (mode === 'GROUPS') {
    const um = await unmappedRoutes(db, modules);
    const d = await diffs(db);
    /* v10.615 (docs/757) — 역할 이름으로 직접 막는 곳 중 권한그룹과 맞추지 않은 곳(pgx-open.ts PGX_OPEN)이 있으면 막음 */
    if (PGX_OPEN.length) {
      throw new PolicyViolation('PERM_MODE_NOT_READY',
        `GROUPS 로 바꿀 수 없습니다 — 역할 이름으로 막는 곳 중 권한그룹과 맞추지 않은 곳 ${PGX_OPEN.length}개(docs/757 3절).`, { roleChecksOpen: PGX_OPEN.length, items: PGX_OPEN });
    }
    if (um.unmapped > 0 || d.diff24 > 0) {
      throw new PolicyViolation('PERM_MODE_NOT_READY',
        `GROUPS 로 바꿀 수 없습니다 — 연결 안 된 /admin 주소 ${um.unmapped}개 · 최근 24시간 다름 ${d.diff24}건(둘 다 0 이어야 함).`, { unmapped: um.unmapped, diff24: d.diff24 });
    }
  }
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true), set_config('app.actor_id', $2, true), set_config('app.perm_mode_ok', $3, true)`,
      [why, actor ?? '', mode === 'GROUPS' ? 'yes' : 'no']);
    const r = await db.query(`UPDATE site_settings SET value = $1, updated_by = $2::uuid, updated_at = now() WHERE key = 'perm.mode' RETURNING key`, [mode, actor]);
    if (!r.length) throw new PolicyViolation('PERM_MODE', '설정 perm.mode 가 없습니다(D291 적용 전).');
    await permLog(db, 'SETTING', 'perm.mode', `${cur}->${mode}`, { from: cur, to: mode }, why, actor);
  });
  permModeCacheClear(); permCacheClear();
  return { ok: true, from: cur, mode, note: mode === 'GROUPS' ? '이제 운영 역할 API 는 권한그룹이 정합니다(회원 API · SUPER 전용은 그대로). 문제가 있으면 COMPARE 로 되돌리십시오.' : `판정 방식을 ${mode} 로 바꿨습니다.` };
}

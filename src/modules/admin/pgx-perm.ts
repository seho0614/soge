import { DatabaseService } from '../../db/database.service';
import { PERM_OPS, effective } from './perm.service';
import { permDecideMode } from './perm-mode';

/* ---------------------------------------------------------------------
 * v10.615 (docs/757) 권한그룹 전환 준비 — 서비스 안 「역할 이름 검사」를 권한그룹 판정과 함께 보게 하는 도우미
 *   perm.mode = ROLE · COMPARE  → 지금처럼 역할 이름(SUPER 는 늘 통과) — 아무것도 바뀌지 않음
 *   perm.mode = GROUPS          → 운영 역할 계정은 그 업무 · 수준(fn_perm_effective)이 정함(가드 core/perm.guard.ts 와 같은 규칙)
 *                                  · SUPER 는 늘 통과 · 운영 역할이 없는 계정(회원)은 역할 그대로(권한그룹으로 넓히지 않음)
 *   권한그룹 조회가 실패하면 역할 그대로(잠김 방지 · 요청은 이미 가드를 지남).
 *   「EDIT 이상」 = EDIT 또는 APPROVE(수준은 서로 포함하지 않으므로 둘 중 하나).
 *   어느 업무 · 수준으로 볼지는 R_역할 처음 권한그룹(D258 · D291)이 같은 범위가 되는 것만 골랐음 — docs/757 3절 표.
 * ------------------------------------------------------------------- */

export const PGX_EDIT_UP: readonly string[] = ['EDIT', 'APPROVE'];
/** member-ops 의 작은 Q 같은 것도 받게 query 만 */
export interface PgxDb { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }   // eslint-disable-line @typescript-eslint/no-explicit-any
type Db = PgxDb;

const isSup = (roles: readonly string[] | null | undefined) => !!roles?.includes('SUPER');
const hasAny = (roles: readonly string[] | null | undefined, want: readonly string[]) => isSup(roles) || want.some((r) => !!roles?.includes(r));

/** 이 계정을 권한그룹으로 볼지 — perm.mode GROUPS · SUPER 아님 · 운영 역할 있음 */
export async function pgxGroupsOn(db: Db, roles: readonly string[] | null | undefined): Promise<boolean> {
  if (!roles?.length || isSup(roles) || !roles.some((r) => PERM_OPS.includes(r))) return false;
  return (await permDecideMode(db as DatabaseService).catch(() => 'ROLE')) === 'GROUPS';
}

/** GROUPS 면 실제 권한(「업무:수준」 모음) · 아니면 null(역할로 판정) */
export async function pgxEffective(db: Db, accountId: string | null | undefined, roles: readonly string[] | null | undefined): Promise<Set<string> | null> {
  if (!accountId || !(await pgxGroupsOn(db, roles))) return null;
  try { return await effective(db as DatabaseService, accountId); }
  catch { return null; }   // 조회 실패 → 역할 그대로
}

/** 역할 이름 검사 자리 — ROLE · COMPARE 는 legacy 역할 · GROUPS 는 tasks 중 하나에 levels 중 하나 */
export async function pgxCan(db: Db, accountId: string | null | undefined, roles: readonly string[] | null | undefined,
                             tasks: readonly string[], levels: readonly string[], legacy: readonly string[]): Promise<boolean> {
  if (isSup(roles)) return true;
  const eff = await pgxEffective(db, accountId, roles);
  if (!eff) return hasAny(roles, legacy);
  return tasks.some((t) => levels.some((l) => eff.has(`${t}:${l}`)));
}

/** 역할 목록 — RequestCtx.actorRole 은 첫 역할 하나뿐이라 DB 에서 기한 안 역할을 다시 읽음 */
export async function pgxRolesOf(db: Db, accountId: string | null | undefined): Promise<string[]> {
  if (!accountId) return [];
  const rows = await db.query<{ role: string }>(
    `SELECT role FROM account_roles WHERE account_id = $1::uuid AND (expires_at IS NULL OR expires_at > now())`, [accountId]).catch(() => [] as Array<{ role: string }>);
  return rows.map((r) => r.role);
}


/** 지금 요청한 사람(RequestCtx 를 부르는 쪽이 넘김)의 실제 권한 — perm.mode 가 GROUPS 일 때만 역할을 다시 읽음(그 밖 모드는 질의 하나) */
export async function pgxEffectiveOf(db: Db, accountId: string | null | undefined): Promise<Set<string> | null> {
  if (!accountId) return null;
  if ((await permDecideMode(db as DatabaseService).catch(() => 'ROLE')) !== 'GROUPS') return null;
  return pgxEffective(db, accountId, await pgxRolesOf(db, accountId));
}

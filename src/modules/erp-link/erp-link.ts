import { randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { effective, permMode } from '../admin/perm.service';
import { permDecideMode } from '../admin/perm-mode';
import { sha256hex } from './erp-link.guard';

/* ---------------------------------------------------------------------
 * v10.799 (D333 · docs/915) ERP 로그인 확인(introspect) · 서비스 토큰
 *
 *   ERP 서버는 비밀 키(JWT_SECRET)를 갖지 않음 — 화면이 낸 운영자 토큰을 그대로 이 길에 물어 「누구 · 운영자인지 · 2단계 확인 · 권한」을 받음(ERP 가 1분 기억).
 *   토큰 검사 · 계정 다시 읽기 · 2단계 · 패스키 판정은 소개뱅크 AuthMiddleware 가 이미 함(req.principal) — 여기서는 그 결과를 정리만.
 *   운영 화면 접속 인증(허용 IP)은 ERP 서버 주소로 판정되므로 보내지 않음(ERP 화면은 Nginx 허용 IP 로 막음 · 설계서 4-1).
 *   권한: 판정 방식(perm.mode ROLE · COMPARE · GROUPS) · 권한 걸기(perm.enforce OFF · SHADOW · ON) · 업무 권한 목록(task:LEVEL) — ERP 가 소개뱅크와 같은 규칙으로 판정.
 * ------------------------------------------------------------------- */

export const STAFF_ROLES = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];

export interface IntrospectPrincipal {
  accountId: string; roles: string[]; mfaPending?: boolean; passkeyPending?: boolean;
}

/** JWT 가운데 마디의 exp(초) — 검사는 AuthMiddleware 가 이미 함 · 여기는 끝 시각만 읽음 */
export function tokenExp(authHeader: string | undefined): number | null {
  const t = String(authHeader ?? '').replace(/^Bearer\s+/i, '');
  const mid = t.split('.')[1];
  if (!mid) return null;
  try {
    const p = JSON.parse(Buffer.from(mid.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof p.exp === 'number' ? p.exp : null;
  } catch { return null; }
}

export async function introspect(db: DatabaseService, p: IntrospectPrincipal | undefined, authHeader: string | undefined) {
  if (!p) return { active: false, reason: 'UNAUTHENTICATED' as const };
  const roles = [...(p.roles ?? [])];
  const staff = roles.some((r) => STAFF_ROLES.includes(r));
  if (!staff) return { active: false, reason: 'NOT_STAFF' as const, accountId: p.accountId };
  const [a] = await db.query<{ name: string | null; status: string }>(`SELECT name, status FROM accounts WHERE id = $1`, [p.accountId]);
  if (!a || a.status !== 'ACTIVE') return { active: false, reason: 'NOT_ACTIVE' as const, accountId: p.accountId };
  const mfaOk = !p.mfaPending && !p.passkeyPending;
  const [enforce, decide] = await Promise.all([permMode(db).catch(() => 'OFF'), permDecideMode(db).catch(() => 'ROLE' as const)]);
  const tasks = [...(await effective(db, p.accountId).catch(() => new Set<string>()))].sort();
  return {
    active: true, accountId: p.accountId, name: a.name, roles, staff, super: roles.includes('SUPER'),
    mfaOk, mfaPending: !!p.mfaPending, passkeyPending: !!p.passkeyPending,
    perm: { enforce, decide, tasks },
    exp: tokenExp(authHeader),
    note: mfaOk ? null : '2단계 인증(또는 패스키) 확인 뒤에만 ERP 를 쓸 수 있습니다 — 운영 화면에서 먼저 확인하십시오.',
  };
}

/** SUPER — 서비스 토큰 새로 만들기(원문은 이 응답에 한 번만 · DB 에는 sha256) · 전 토큰은 바로 무효 */
export async function rotateServiceToken(db: DatabaseService, actor: string) {
  const token = 'erp_' + randomBytes(32).toString('hex');
  await db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'erp.service_token_hash'`, [sha256hex(token), actor]);
  return { token, note: '이 값은 지금 한 번만 보입니다 — ERP 서버 .env 의 SGB_SERVICE_TOKEN 에 넣으십시오. 전 토큰은 바로 쓸 수 없습니다.' };
}

export async function linkState(db: DatabaseService) {
  const [r] = await db.query<{ set: boolean; at: string | null }>(
    `SELECT (value ~ '^[0-9a-f]{64}$') AS set, updated_at AS at FROM site_settings WHERE key = 'erp.service_token_hash'`);
  return { tokenSet: !!r?.set, tokenUpdatedAt: r?.set ? r.at : null, erpUrl: process.env.ERP_WEB_URL ?? null };
}

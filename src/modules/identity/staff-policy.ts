import * as bcrypt from 'bcryptjs';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.357 · 360 (D236 · docs/491 · 494) — 운영 역할만 더 엄격하게
 *   ① 로그인 유지(다시 받기 증표) ops.staff_refresh_days(처음 1일) · 운영 화면 자동 로그아웃 ops.admin_idle_min(처음 30분)
 *   ④ 비밀번호 12자 이상 · 최근 3개(지금 것 포함) 다시 쓰기 금지 · 90일 지나면 알림(막지 않음)
 *   회원은 지금 규칙 그대로(10자 · 14일).
 * ------------------------------------------------------------------- */
/** 운영 역할 — mfa.service 의 OPS_ROLES 와 같게(여기서 가져오면 auth.service → mfa.service → auth.service 로 물려 Nest 가 못 뜸) */
const OPS_ROLES: readonly string[] = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];   // v10.437 (D257) 세무사

interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

export const isStaff = (roles: readonly string[] | undefined) => (roles ?? []).some((r) => (OPS_ROLES as readonly string[]).includes(r));

let cache: { at: number; idleMin: number; refreshDays: number } | null = null;
/** 설정 두 개(1분 캐시) — 읽지 못하면 처음 값 */
export async function staffSession(db: Q): Promise<{ idleMin: number; refreshDays: number }> {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('ops.admin_idle_min', 'ops.staff_refresh_days')`).catch(() => []);
  const v = (k: string, d: number, lo: number, hi: number) => {
    const n = Number(rows.find((r) => r.key === k)?.value);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
  };
  cache = { at: Date.now(), idleMin: v('ops.admin_idle_min', 30, 5, 240), refreshDays: v('ops.staff_refresh_days', 1, 1, 14) };
  return cache;
}

const STAFF_MIN = 12;
const REUSE = 3;
export const PASSWORD_MAX_DAYS = 90;

/** 운영 역할이면 12자 이상 · 지금 비밀번호와 최근 바꾼 것 2개(모두 3개)와 같으면 거절. 운영 역할이 아니면 아무것도 안 함 */
export async function assertStaffPassword(db: Q, accountId: string, pw: string): Promise<boolean> {
  const [r] = await db.query<{ staff: boolean; hash: string | null }>(
    `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1 AND role = ANY($2::text[])) AS staff,
            (SELECT password_hash FROM accounts WHERE id = $1) AS hash`, [accountId, OPS_ROLES]);
  if (!r?.staff) return false;
  if ((pw ?? '').length < STAFF_MIN) throw new PolicyViolation('WEAK_PASSWORD_STAFF', '운영 역할 계정의 비밀번호는 12자 이상이어야 합니다(영문 · 숫자 · 특수문자 섞어).');
  const old = await db.query<{ password_hash: string }>(
    `SELECT password_hash FROM password_history WHERE account_id = $1 ORDER BY replaced_at DESC LIMIT $2`, [accountId, REUSE - 1]);
  for (const h of [r.hash, ...old.map((x) => x.password_hash)].filter(Boolean) as string[]) {
    if (await bcrypt.compare(pw, h).catch(() => false)) {
      throw new PolicyViolation('PASSWORD_REUSED', '최근에 쓴 비밀번호(3개)는 다시 쓸 수 없습니다. 새 비밀번호를 넣어 주십시오.');
    }
  }
  return true;
}

/** 바꾸기 직전 — 지금 해시를 기록에 한 줄(운영 역할 · 회원 모두 · 해시만) */
export async function keepOldPassword(db: Q, accountId: string): Promise<void> {
  await db.query(`INSERT INTO password_history (account_id, password_hash) SELECT id, password_hash FROM accounts WHERE id = $1 AND password_hash IS NOT NULL`, [accountId]);
}

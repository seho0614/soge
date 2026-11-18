import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.362 (D237 · docs/496) — 가입 차단 목록 확인(가입 · 본인인증)
 *   EMAIL_DOMAIN: 이메일 도메인이 같거나 그 하위 도메인 · IP_CIDR: 접속 IP 가 대역 안 · PERSON: 본인인증 고유값 해시가 같음
 *   걸리면 그날 · 종류 셈 +1 → 422(차단 이유를 알리지 않는 일반 문장). 기한 지난 것 · 푼 것은 안 셈.
 * ------------------------------------------------------------------- */
interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

async function hit(db: Q, kind: string) {
  await db.query(
    `INSERT INTO signup_block_hits (day, kind, n) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, $1, 1)
     ON CONFLICT (day, kind) DO UPDATE SET n = signup_block_hits.n + 1`, [kind]).catch(() => undefined);
}

/** 가입 — 이메일 도메인 · 접속 IP */
export async function assertSignupAllowed(db: Q, email: string, ip: string | null): Promise<void> {
  const domain = String(email ?? '').toLowerCase().split('@')[1] ?? '';
  const [b] = await db.query<{ kind: string }>(
    `SELECT kind FROM signup_blocks
      WHERE removed_at IS NULL AND (expires_at IS NULL OR expires_at > now())
        AND ((kind = 'EMAIL_DOMAIN' AND $1 <> '' AND ($1 = value OR right($1, char_length(value) + 1) = '.' || value))
          OR (kind = 'IP_CIDR' AND $2::text IS NOT NULL AND $2::inet <<= value::cidr))
      LIMIT 1`, [domain, ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null]);
  if (b) {
    await hit(db, b.kind);
    throw new PolicyViolation('SIGNUP_BLOCKED', '지금은 가입할 수 없습니다. 고객센터로 문의해 주십시오.');
  }
}

/** 본인인증 — 고유값 해시(ci_hash) */
export async function assertPersonAllowed(db: Q, ciHash: string): Promise<void> {
  const [b] = await db.query(
    `SELECT 1 FROM signup_blocks WHERE removed_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND kind = 'PERSON' AND value = $1 LIMIT 1`, [ciHash]);
  if (b) {
    await hit(db, 'PERSON');
    throw new PolicyViolation('IDENTITY_BLOCKED', '본인인증을 마칠 수 없습니다. 고객센터로 문의해 주십시오.');
  }
}

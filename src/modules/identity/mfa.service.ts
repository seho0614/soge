import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { AppError, Forbidden, PolicyViolation, StateConflict } from '../../core/errors';
import { Principal, Role, isSuper } from '../../core/auth';
import { RequestCtx } from '../../core/request-context';
import { backupHash, newBackupCodes, newTotpSecret, otpauthUri, totpMatch } from '../../common/totp';
import { AuthService } from './auth.service';

/* ---------------------------------------------------------------------
 * v10.180 (D169 · docs/281) — 운영자 2단계 인증
 *
 *   로그인(비밀번호)은 그대로 — 운영 화면이 인증 앱 6자리 번호를 넣으면 「2단계 확인됨(ma)」이 붙은 새 증표를 줍니다.
 *   설정 admin.mfa_required(off · SUPER · ALL)가 켜져 있으면 운영 역할만 요구하는 API 는
 *   확인된 지 admin.mfa_hours(12) 안의 증표가 아니면 403 MFA_REQUIRED(AuthGuard).
 *   회원 기능(MEMBER · BIZ_*)은 보지 않습니다. 설정은 30초 동안 메모리에 둡니다.
 * ------------------------------------------------------------------- */
export const OPS_ROLES: readonly Role[] = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'];   // v10.194 — 파트너 담당도 운영 역할
const MAX_FAILS = 5;
const LOCK_MIN = 15;
const CACHE_MS = 30_000;

let cache: { at: number; mode: string; hours: number } | null = null;
/** 시험 · 설정 저장 뒤 — 바로 다시 읽게 */
export function resetMfaSettingCache() { cache = null; }

@Injectable()
export class MfaService {
  constructor(private readonly db: DatabaseService, private readonly auth: AuthService) {}

  async settings(): Promise<{ mode: string; hours: number }> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache;
    const rows = await this.db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key IN ('admin.mfa_required', 'admin.mfa_hours')`).catch(() => []);
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
    const mode = ['SUPER', 'ALL'].includes(m['admin.mfa_required']) ? m['admin.mfa_required'] : 'off';
    const h = Number(m['admin.mfa_hours']);
    cache = { at: Date.now(), mode, hours: h >= 1 && h <= 24 ? h : 12 };
    return cache;
  }

  /** 이 역할에 2단계가 필요한가 */
  static requiredFor(mode: string, roles: readonly string[]): boolean {
    if (mode === 'SUPER') return isSuper(roles);
    if (mode === 'ALL') return roles.some((r) => OPS_ROLES.includes(r as Role));
    return false;
  }

  /** AuthMiddleware — 운영 역할이 있을 때만 설정을 봄(회원 요청은 DB 를 더 부르지 않음) */
  async pending(p: Principal, mfaAt: number | undefined): Promise<boolean> {
    if (!p.roles.some((r) => OPS_ROLES.includes(r))) return false;
    const s = await this.settings();
    if (!MfaService.requiredFor(s.mode, p.roles)) return false;
    return !(mfaAt && mfaAt * 1000 > Date.now() - s.hours * 3600_000);
  }

  private me(): string {
    const id = RequestCtx.actorId();
    if (!id) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    return id;
  }

  private async row(accountId: string) {
    const [r] = await this.db.query<{ enabled: boolean; backups: number; locked_until: Date | null; created_at: Date }>(
      `SELECT enabled_at IS NOT NULL AS enabled, cardinality(backup_hashes)::int AS backups, locked_until, created_at
         FROM account_mfa WHERE account_id = $1`, [accountId]);
    return r ?? null;
  }

  /** 내 상태 — 운영 화면이 「번호 넣기 · 등록」 중 무엇을 보일지 정함 */
  async status(p: Principal, mfaAt: number | undefined) {
    const s = await this.settings();
    const r = await this.row(p.accountId);
    return {
      mode: s.mode, hours: s.hours,
      required: MfaService.requiredFor(s.mode, p.roles),
      enrolled: !!r?.enabled,
      verified: !!(mfaAt && mfaAt * 1000 > Date.now() - s.hours * 3600_000),
      backupLeft: r?.enabled ? r.backups : null,
      lockedUntil: r?.locked_until && new Date(r.locked_until) > new Date() ? r.locked_until : null,
    };
  }

  /** 등록 시작 — 새 비밀값(이미 등록했으면 409 · 등록 중이면 새로 만듦) */
  async setup(p: Principal) {
    if (!p.roles.some((r) => OPS_ROLES.includes(r))) throw new Forbidden('FORBIDDEN', '운영 계정만 2단계 인증을 등록합니다.');
    const r = await this.row(p.accountId);
    if (r?.enabled) throw new StateConflict('MFA_ENABLED', '이미 2단계 인증을 등록했습니다 — 다시 등록하려면 최고 관리자에게 초기화를 요청하십시오.');
    const secret = newTotpSecret();
    await this.db.query(
      `INSERT INTO account_mfa (account_id, secret_enc) VALUES ($1, pgp_sym_encrypt($2, fn_enc_key()))
       ON CONFLICT (account_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_step = 0, fails = 0, locked_until = NULL, created_at = now()
        WHERE account_mfa.enabled_at IS NULL`, [p.accountId, secret]);
    const [a] = await this.db.query<{ email: string }>(`SELECT email FROM accounts WHERE id = $1`, [p.accountId]);
    return { secret, uri: otpauthUri(secret, a?.email ?? 'admin') };
  }

  private async secretOf(accountId: string): Promise<{ secret: string; enabled: boolean; lastStep: number; backups: string[]; fails: number; lockedUntil: Date | null } | null> {
    const [r] = await this.db.query<{ secret: string; enabled: boolean; last_step: string; backup_hashes: string[]; fails: number; locked_until: Date | null }>(
      `SELECT pgp_sym_decrypt(secret_enc, fn_enc_key()) AS secret, enabled_at IS NOT NULL AS enabled, last_step, backup_hashes, fails, locked_until
         FROM account_mfa WHERE account_id = $1`, [accountId]);
    return r ? { secret: r.secret, enabled: r.enabled, lastStep: Number(r.last_step), backups: r.backup_hashes ?? [], fails: r.fails, lockedUntil: r.locked_until } : null;
  }

  /** 감사 기록 — 결과만(비밀값 · 예비 번호 · 증표는 남기지 않음) */
  private audit(action: string, targetId: string, data: Record<string, unknown>) {
    const c = RequestCtx.get();
    return this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, $3, 'ACCOUNT', $4, $5::jsonb, $6, $7)`,
      [c?.actorId ?? targetId, c?.actorRole ?? null, action, targetId, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null],
    ).catch((e) => console.error('[AUDIT_WRITE_FAILED]', action, e.message));
  }

  private async fail(accountId: string, fails: number): Promise<never> {
    const n = fails + 1;
    const lock = n >= MAX_FAILS;
    await this.db.query(
      `UPDATE account_mfa SET fails = CASE WHEN $2 THEN 0 ELSE $3 END,
              locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $4) ELSE locked_until END
        WHERE account_id = $1`, [accountId, lock, n, LOCK_MIN]);
    if (lock) {
      await this.audit('MFA_LOCKED', accountId, { minutes: LOCK_MIN });
      throw new AppError(423, { code: 'MFA_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
    }
    throw new AppError(403, { code: 'MFA_INVALID', message: '번호가 맞지 않습니다.', details: { attemptsLeft: MAX_FAILS - n } });
  }

  private assertNotLocked(lockedUntil: Date | null) {
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      throw new AppError(423, { code: 'MFA_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
    }
  }

  /** 등록 마치기 — 앱 번호가 맞으면 켜고 예비 번호 10개(이때 한 번만 보여 줌) + 확인된 새 증표 */
  async enable(p: Principal, code: string) {
    const r = await this.secretOf(p.accountId);
    if (!r) throw new AppError(404, { code: 'MFA_NOT_SETUP', message: '먼저 등록을 시작하십시오.' });
    if (r.enabled) throw new StateConflict('MFA_ENABLED', '이미 2단계 인증을 등록했습니다 — 다시 등록하려면 최고 관리자에게 초기화를 요청하십시오.');
    this.assertNotLocked(r.lockedUntil);
    const step = totpMatch(r.secret, code.trim(), r.lastStep);
    if (step === null) return this.fail(p.accountId, r.fails);
    const codes = newBackupCodes();
    await this.db.query(
      `UPDATE account_mfa SET enabled_at = now(), last_step = $2, fails = 0, locked_until = NULL, backup_hashes = $3::text[]
        WHERE account_id = $1 AND enabled_at IS NULL`, [p.accountId, step, codes.map(backupHash)]);
    await this.audit('MFA_ENABLE', p.accountId, { enabled: true, backupCodes: codes.length });
    return { backupCodes: codes, ...(await this.tokens(p.accountId)) };
  }

  /** 번호 확인 — 인증 앱 6자리 또는 예비 번호(한 번 쓰면 빠짐) */
  async verify(p: Principal, code: string) {
    const r = await this.secretOf(p.accountId);
    if (!r || !r.enabled) throw new AppError(404, { code: 'MFA_NOT_ENROLLED', message: '2단계 인증을 아직 등록하지 않았습니다.' });
    this.assertNotLocked(r.lockedUntil);
    const c = code.trim();
    let usedBackup = false;
    if (/^\d{6}$/.test(c)) {
      const step = totpMatch(r.secret, c, r.lastStep);
      if (step === null) return this.fail(p.accountId, r.fails);
      await this.db.query(`UPDATE account_mfa SET last_step = $2, fails = 0 WHERE account_id = $1`, [p.accountId, step]);
    } else {
      const h = backupHash(c);
      if (c.replace(/\D/g, '').length !== 10 || !r.backups.includes(h)) return this.fail(p.accountId, r.fails);
      const [u] = await this.db.query(
        `UPDATE account_mfa SET backup_hashes = array_remove(backup_hashes, $2), fails = 0
          WHERE account_id = $1 AND $2 = ANY(backup_hashes) RETURNING 1`, [p.accountId, h]);
      if (!u) return this.fail(p.accountId, r.fails);
      usedBackup = true;
    }
    if (usedBackup) await this.audit('MFA_BACKUP_USED', p.accountId, { usedBackup: true });
    const [left] = await this.db.query<{ n: number }>(`SELECT cardinality(backup_hashes)::int AS n FROM account_mfa WHERE account_id = $1`, [p.accountId]);
    return { usedBackup, backupLeft: left?.n ?? 0, ...(await this.tokens(p.accountId)) };
  }

  private async tokens(accountId: string) {
    const t = await this.auth.issue(accountId, Math.floor(Date.now() / 1000));
    return { accessToken: t.accessToken, refreshToken: t.refreshToken };
  }

  /** SUPER — 다른 운영자의 등록 초기화(휴대폰 분실 등 · 사유 필수 · 감사 기록 · 본인 것은 안 됨) */
  async reset(targetId: string, reason: string) {
    if (!reason?.trim() || reason.trim().length < 5) throw new PolicyViolation('REASON_REQUIRED', '초기화 사유를 5자 이상 적어 주십시오.');
    if (targetId === this.me()) throw new PolicyViolation('SELF_RESET', '자신의 2단계 인증은 초기화할 수 없습니다 — 다른 최고 관리자에게 요청하십시오.');
    const [gone] = await this.db.query(`DELETE FROM account_mfa WHERE account_id = $1 RETURNING account_id`, [targetId]);
    if (!gone) throw new AppError(404, { code: 'MFA_NOT_ENROLLED', message: '2단계 인증을 등록하지 않은 계정입니다.' });
    return { accountId: targetId, reset: true };
  }

  /** 설정 저장 전(AdminService) — 켜는 사람이 먼저 등록했는지 */
  async assertCanTurnOn(value: string) {
    if (value === 'off') return;
    const r = await this.row(this.me());
    if (!r?.enabled) throw new PolicyViolation('MFA_ENROLL_FIRST', '먼저 「내 2단계 인증」을 등록한 뒤 켜십시오 — 등록하지 않고 켜면 운영 화면에 들어오지 못할 수 있습니다.');
  }
}

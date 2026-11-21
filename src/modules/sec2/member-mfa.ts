/* ---------------------------------------------------------------------
 * v10.592 (docs/734) ⑧ 회원 2단계 인증(선택) — 운영자 2단계 인증(D169 · v10.180)을 그대로 씀
 *
 *   같은 표 account_mfa(비밀값 암호화 · 예비 번호 해시 · 5번 틀리면 15분) · 같은 계산 common/totp.ts.
 *   다른 것: 회원은 스스로 켜고 끄며(끄기 = 비밀번호 + 번호), 로그인 때 비밀번호가 맞으면 증표 대신 「2단계 표」(5분 · 한 번)를 받고
 *   POST /auth/mfa/member-login 에 표 + 번호를 넣어야 증표가 나옵니다(증표가 번호 전에 나가지 않음).
 *   표는 무작위 값 32바이트 — DB 에는 sha256 만(sec2_mfa_tickets).
 *   운영 역할 계정은 이 흐름을 쓰지 않음(운영 화면 MfaGate 그대로) — 끄기도 막음(SUPER 초기화 그대로).
 *   간편 로그인(카카오 · 네이버)은 번호를 물을 곳이 없어 등록한 회원은 막고 이메일 로그인으로 안내(social.ts 패치).
 *   스위치 sec2.member_mfa 처음 off — off 면 등록 화면이 숨고 로그인도 번호를 묻지 않음(등록은 남음).
 * ------------------------------------------------------------------- */
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppError, Forbidden, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { backupHash, newBackupCodes, newTotpSecret, otpauthUri, totpMatch } from '../../common/totp';
import { Sec2Db, sec2Audit, sec2IsStaff, sec2Settings } from './common';

const MAX_FAILS = 5;
const LOCK_MIN = 15;
const TICKET_MIN = 5;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function rolesOf(db: Sec2Db, accountId: string): Promise<string[]> {
  const r = await db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1`, [accountId]);
  return r.map((x) => x.role);
}

async function mfaRow(db: Sec2Db, accountId: string) {
  const [r] = await db.query<{ enabled: boolean; backups: number; locked_until: string | null }>(
    `SELECT enabled_at IS NOT NULL AS enabled, cardinality(backup_hashes)::int AS backups, locked_until FROM account_mfa WHERE account_id = $1`, [accountId]);
  return r ?? null;
}

function me(): string {
  const id = RequestCtx.actorId();
  if (!id) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
  return id;
}

/** GET /me/mfa — 나의공간 › 보안 「2단계 인증」 칸 */
export async function sec2MemberMfaStatus(db: Sec2Db) {
  const id = me();
  const s = await sec2Settings(db);
  const [roles, row, pw] = await Promise.all([
    rolesOf(db, id), mfaRow(db, id),
    db.query<{ has: boolean }>(`SELECT coalesce(password_hash, '') <> '' AS has FROM accounts WHERE id = $1`, [id]),
  ]);
  const staff = sec2IsStaff(roles);
  return {
    available: s.memberMfa, staff, enrolled: !!row?.enabled, backupLeft: row?.enabled ? row.backups : null,
    hasPassword: !!pw[0]?.has,
    lockedUntil: row?.locked_until && new Date(row.locked_until) > new Date() ? row.locked_until : null,
    note: !s.memberMfa ? '회원 2단계 인증은 아직 열지 않았습니다.'
      : staff ? '운영 계정의 2단계 인증은 운영 화면에서 관리합니다(끄기는 최고 관리자 초기화).'
      : row?.enabled ? '로그인할 때 인증 앱 번호를 넣습니다. 휴대폰을 잃으면 예비 번호로 들어와 끄고 다시 등록하십시오.'
      : '켜면 비밀번호가 새어도 휴대폰의 인증 앱 번호 없이는 로그인할 수 없습니다.',
  };
}

function assertOpen(on: boolean) {
  if (!on) throw new PolicyViolation('SEC2_MFA_OFF', '회원 2단계 인증은 아직 열지 않았습니다.');
}

/** POST /me/mfa/setup — 새 비밀값 · otpauth 주소(이미 켰으면 409) */
export async function sec2MemberMfaSetup(db: Sec2Db) {
  const id = me();
  assertOpen((await sec2Settings(db)).memberMfa);
  const [pw] = await db.query<{ has: boolean; email: string }>(`SELECT coalesce(password_hash, '') <> '' AS has, email::text AS email FROM accounts WHERE id = $1`, [id]);
  if (!pw?.has) throw new PolicyViolation('SEC2_MFA_NEED_PASSWORD', '간편 로그인만 쓰는 계정은 먼저 비밀번호를 만드십시오 — 2단계 인증은 이메일 로그인에 붙습니다.');
  const row = await mfaRow(db, id);
  if (row?.enabled) throw new StateConflict('MFA_ENABLED', '이미 2단계 인증을 켰습니다.');
  const secret = newTotpSecret();
  await db.query(
    `INSERT INTO account_mfa (account_id, secret_enc) VALUES ($1, pgp_sym_encrypt($2, fn_enc_key()))
     ON CONFLICT (account_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_step = 0, fails = 0, locked_until = NULL, created_at = now()
      WHERE account_mfa.enabled_at IS NULL`, [id, secret]);
  return { secret, uri: otpauthUri(secret, pw.email ?? 'member') };
}

async function secretOf(db: Sec2Db, accountId: string) {
  const [r] = await db.query<{ secret: string; enabled: boolean; last_step: string; backup_hashes: string[]; fails: number; locked_until: string | null }>(
    `SELECT pgp_sym_decrypt(secret_enc, fn_enc_key()) AS secret, enabled_at IS NOT NULL AS enabled, last_step, backup_hashes, fails, locked_until
       FROM account_mfa WHERE account_id = $1`, [accountId]);
  return r ? { secret: r.secret, enabled: r.enabled, lastStep: Number(r.last_step), backups: r.backup_hashes ?? [], fails: r.fails, lockedUntil: r.locked_until } : null;
}

async function fail(db: Sec2Db, accountId: string, fails: number): Promise<never> {
  const n = fails + 1;
  const lock = n >= MAX_FAILS;
  await db.query(
    `UPDATE account_mfa SET fails = CASE WHEN $2 THEN 0 ELSE $3::int END,
            locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $4::int) ELSE locked_until END
      WHERE account_id = $1`, [accountId, lock, n, LOCK_MIN]);
  if (lock) {
    await sec2Audit(db, 'MFA_LOCKED', 'ACCOUNT', accountId, { minutes: LOCK_MIN, member: true });
    throw new AppError(423, { code: 'MFA_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
  }
  throw new AppError(403, { code: 'MFA_INVALID', message: '번호가 맞지 않습니다.', details: { attemptsLeft: MAX_FAILS - n } });
}

function assertNotLocked(lockedUntil: string | null) {
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    throw new AppError(423, { code: 'MFA_LOCKED', message: `번호가 여러 번 틀려 ${LOCK_MIN}분 동안 막았습니다.` });
  }
}

/** 번호 확인(앱 6자리 또는 예비 번호 한 번) — 맞으면 { usedBackup } · 틀리면 403 · 잠김 423 */
async function checkCode(db: Sec2Db, accountId: string, code: string): Promise<{ usedBackup: boolean }> {
  const r = await secretOf(db, accountId);
  if (!r || !r.enabled) throw new AppError(404, { code: 'MFA_NOT_ENROLLED', message: '2단계 인증을 켜지 않았습니다.' });
  assertNotLocked(r.lockedUntil);
  const c = String(code ?? '').trim();
  if (/^\d{6}$/.test(c)) {
    const step = totpMatch(r.secret, c, r.lastStep);
    if (step === null) return fail(db, accountId, r.fails);
    await db.query(`UPDATE account_mfa SET last_step = $2, fails = 0 WHERE account_id = $1`, [accountId, step]);
    return { usedBackup: false };
  }
  const h = backupHash(c);
  if (c.replace(/\D/g, '').length !== 10 || !r.backups.includes(h)) return fail(db, accountId, r.fails);
  const [u] = await db.query(
    `UPDATE account_mfa SET backup_hashes = array_remove(backup_hashes, $2), fails = 0 WHERE account_id = $1 AND $2 = ANY(backup_hashes) RETURNING 1`, [accountId, h]);
  if (!u) return fail(db, accountId, r.fails);
  await sec2Audit(db, 'MFA_BACKUP_USED', 'ACCOUNT', accountId, { usedBackup: true, member: true });
  return { usedBackup: true };
}

/** POST /me/mfa/enable — 번호가 맞으면 켜고 예비 번호 10개(이때 한 번만) */
export async function sec2MemberMfaEnable(db: Sec2Db, code: string) {
  const id = me();
  assertOpen((await sec2Settings(db)).memberMfa);
  const r = await secretOf(db, id);
  if (!r) throw new AppError(404, { code: 'MFA_NOT_SETUP', message: '먼저 등록을 시작하십시오.' });
  if (r.enabled) throw new StateConflict('MFA_ENABLED', '이미 2단계 인증을 켰습니다.');
  assertNotLocked(r.lockedUntil);
  const step = totpMatch(r.secret, String(code ?? '').trim(), r.lastStep);
  if (step === null) return fail(db, id, r.fails);
  const codes = newBackupCodes();
  const u = await db.query(
    `UPDATE account_mfa SET enabled_at = now(), last_step = $2, fails = 0, locked_until = NULL, backup_hashes = $3::text[]
      WHERE account_id = $1 AND enabled_at IS NULL RETURNING 1`, [id, step, codes.map(backupHash)]);
  if (!u.length) throw new StateConflict('MFA_ENABLED', '이미 2단계 인증을 켰습니다.');
  await sec2Audit(db, 'MFA_ENABLE', 'ACCOUNT', id, { enabled: true, backupCodes: codes.length, member: true });
  return { ok: true, backupCodes: codes, note: '2단계 인증을 켰습니다. 예비 번호 10개는 지금만 보입니다 — 적어 두십시오(한 번씩 씀).' };
}

/** POST /me/mfa/disable — 비밀번호 + 번호(앱 또는 예비) · 운영 계정은 못 끔 */
export async function sec2MemberMfaDisable(db: Sec2Db, password: string, code: string) {
  const id = me();
  if (sec2IsStaff(await rolesOf(db, id))) {
    throw new Forbidden('SEC2_MFA_STAFF', '운영 계정의 2단계 인증은 끌 수 없습니다 — 최고 관리자에게 초기화를 요청하십시오.');
  }
  const [a] = await db.query<{ password_hash: string | null }>(`SELECT password_hash FROM accounts WHERE id = $1`, [id]);
  if (!a?.password_hash || !(await bcrypt.compare(String(password ?? ''), a.password_hash))) {
    throw new AppError(403, { code: 'INVALID_PASSWORD', message: '비밀번호가 맞지 않습니다.' });
  }
  await checkCode(db, id, code);
  await db.query(`DELETE FROM account_mfa WHERE account_id = $1`, [id]);
  await db.query(`UPDATE sec2_mfa_tickets SET used_at = now() WHERE account_id = $1 AND used_at IS NULL`, [id]);
  await sec2Audit(db, 'MFA_DISABLE', 'ACCOUNT', id, { member: true });
  return { ok: true, note: '2단계 인증을 껐습니다. 다시 켜려면 처음부터 등록합니다.' };
}

/**
 * 로그인(AuthService.login) — 비밀번호가 맞은 뒤 · 증표 전에 부름.
 *   스위치 on · 운영 역할 아님 · 2단계를 켠 회원이면 표를 만들어 { mfaRequired, ticket } 를 돌려줌(증표 없음) · 아니면 null(지금처럼 증표)
 */
export async function sec2MemberMfaTicket(db: Sec2Db, accountId: string): Promise<{ mfaRequired: true; ticket: string; expiresIn: number; message: string } | null> {
  const s = await sec2Settings(db);
  if (!s.memberMfa) return null;
  const row = await mfaRow(db, accountId).catch(() => null);
  if (!row?.enabled) return null;
  if (sec2IsStaff(await rolesOf(db, accountId))) return null;   // 운영 계정은 운영 화면 MfaGate 그대로
  const ticket = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sec2_mfa_tickets (token_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3::int))`,
    [sha256(ticket), accountId, TICKET_MIN]);
  return { mfaRequired: true, ticket, expiresIn: TICKET_MIN * 60, message: '인증 앱의 6자리 번호(또는 예비 번호)를 넣어 주십시오.' };
}

/** 간편 로그인(social.ts) — 2단계를 켠 회원이면 막음(번호를 물을 곳이 없음) */
export async function sec2MemberMfaBlocksSocial(db: Sec2Db, accountId: string): Promise<void> {
  const s = await sec2Settings(db);
  if (!s.memberMfa) return;
  const row = await mfaRow(db, accountId).catch(() => null);
  if (row?.enabled && !sec2IsStaff(await rolesOf(db, accountId))) {
    throw new Forbidden('SEC2_MFA_USE_EMAIL', '2단계 인증을 켠 계정입니다 — 이메일 · 비밀번호로 로그인한 뒤 인증 앱 번호를 넣어 주십시오.');
  }
}

/**
 * POST /auth/mfa/member-login — 표 + 번호 → 계정 번호(증표는 컨트롤러가 AuthService.issue 로)
 *   표: 있고 · 5분 안 · 안 씀 · 5번 안 틀림. 번호가 틀리면 표의 틀린 수도 올림(5번이면 표를 버림 → 다시 로그인).
 */
export async function sec2MemberMfaRedeem(db: Sec2Db, ticket: string, code: string): Promise<string> {
  const t = String(ticket ?? '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) throw new AppError(403, { code: 'SEC2_TICKET_INVALID', message: '로그인 시간이 지났습니다. 다시 로그인해 주십시오.' });
  const [k] = await db.query<{ id: string; account_id: string; ok: boolean }>(
    `SELECT id::text AS id, account_id::text AS account_id, (used_at IS NULL AND expires_at > now() AND fails < 5) AS ok
       FROM sec2_mfa_tickets WHERE token_hash = $1`, [sha256(t)]);
  if (!k || !k.ok) throw new AppError(403, { code: 'SEC2_TICKET_INVALID', message: '로그인 시간이 지났습니다. 다시 로그인해 주십시오.' });
  const [acc] = await db.query<{ status: string }>(`SELECT status FROM accounts WHERE id = $1`, [k.account_id]);
  if (acc?.status !== 'ACTIVE') throw new Forbidden('ACCOUNT_INACTIVE', '사용할 수 없는 계정입니다.');
  try {
    await checkCode(db, k.account_id, code);
  } catch (e) {
    await db.query(`UPDATE sec2_mfa_tickets SET fails = least(fails + 1, 10) WHERE id = $1::bigint`, [k.id]).catch(() => undefined);
    throw e;
  }
  const u = await db.query(`UPDATE sec2_mfa_tickets SET used_at = now() WHERE id = $1::bigint AND used_at IS NULL RETURNING 1`, [k.id]);
  if (!u.length) throw new AppError(403, { code: 'SEC2_TICKET_INVALID', message: '로그인 시간이 지났습니다. 다시 로그인해 주십시오.' });
  return k.account_id;
}

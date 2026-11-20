import { createHash, createPublicKey, KeyObject, randomBytes, verify as cryptoVerify } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { AppError, Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { Principal } from '../../core/auth';
import { RequestCtx } from '../../core/request-context';
import { maskMail } from '../../common/mail/mail-admin.service';

/* ---------------------------------------------------------------------
 * v10.484 (D268 · docs/622) 운영자 패스키(WebAuthn · FIDO2) — 대표 11/20 「㊳ ②」
 *
 *   새 npm 패키지 없이 Node 내장 crypto 만 씀 — CBOR(등록 증명 attestationObject)은 읽지 않음:
 *     등록  브라우저 response.getPublicKey()(SPKI DER) · getPublicKeyAlgorithm() · getAuthenticatorData() 를 보냄
 *           → 서버가 확인: clientDataJSON(type webauthn.create · 문제 · 출처) · authenticatorData(도메인 지문 · UP · UV · AT 깃발 · 자격 번호 = rawId)
 *             · 공개 키가 알고리즘과 맞는지(ES256 P-256 · EdDSA Ed25519 · RS256 2048 비트 이상). 증명(attestation)은 'none' — 기기 제조사 확인 안 함
 *     확인  navigator.credentials.get → authenticatorData · clientDataJSON · signature
 *           → 서버가 확인: 문제(한 번 · 5분) · 출처 · 도메인 지문 · UP · UV · 서명(authData ‖ sha256(clientDataJSON)) · 서명 횟수(줄거나 같으면 복제 의심 — 둘 다 0 이면 통과)
 *   방식(SUPER · admin.passkey_mode)
 *     EXTRA        비밀번호 · 2단계 인증 뒤 한 번 더 — 패스키를 등록한 운영자만 · 로그인 기기(login_sessions.passkey_at)가 admin.mfa_hours 안 확인이어야 운영 API(403 PASSKEY_REQUIRED)
 *     REPLACE_MFA  패스키 확인이 2단계 인증을 대신함 — 확인하면 「2단계 확인됨(ma)」 증표를 줌(인증 앱 번호 없이)
 *   등록은 비밀번호 + (필요하면) 2단계 인증 · 접속 인증 · (EXTRA 이고 이미 있으면) 패스키 확인을 마친 증표로만 — 훔친 비밀번호만으로 패스키를 붙이지 못하게
 *   패스키로 「비밀번호 없이 로그인」은 하지 않음(로그인 잠금 · 접속 인증 · 해외 접속 판정을 한 길로 두려고 — docs/622 3절)
 * ------------------------------------------------------------------- */

export const PASSKEY_ALGS = [-7, -8, -257] as const;
export const CRED_RE = /^[A-Za-z0-9_-]+$/;            // DB CHECK staff_passkeys.cred_id 와 같음(길이 16 ~ 1400 은 따로)
export const RP_RE = /^(|localhost|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/;   // DB value_pattern admin.passkey_rp_id 와 같음
const B64U_RE = /^[A-Za-z0-9_-]*$/;
const CHALLENGE_MIN = 5;
const MAX_KEYS = 10;
const OPEN_CHALLENGES = 20;
const CACHE_MS = 30_000;
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_AT = 0x40;

let cache: { at: number; on: boolean; mode: 'EXTRA' | 'REPLACE_MFA'; rpId: string; hours: number } | null = null;
/** 시험 · 설정 저장 뒤 — 바로 다시 읽게 */
export function resetPasskeyCache() { cache = null; }

export async function passkeySettings(db: DatabaseService) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('admin.passkey', 'admin.passkey_mode', 'admin.passkey_rp_id', 'admin.mfa_hours')`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  const h = Number(v('admin.mfa_hours'));
  const rp = v('admin.passkey_rp_id').toLowerCase();
  cache = { at: Date.now(), on: v('admin.passkey') === 'on', mode: v('admin.passkey_mode') === 'REPLACE_MFA' ? 'REPLACE_MFA' : 'EXTRA',
    rpId: RP_RE.test(rp) ? rp : '', hours: h >= 1 && h <= 24 ? h : 12 };
  return cache;
}

/* 운영 역할 — mfa.service 의 OPS_ROLES 와 같은 목록(여기서 mfa.service 를 import 하지 않음 — 서비스 파일 사이 순환을 만들지 않게) */
const STAFF_ROLES: readonly string[] = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];
const isStaff = (roles: readonly string[]) => roles.some((r) => STAFF_ROLES.includes(r));
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64u = (b: Buffer) => b.toString('base64url');
function unb64u(s: unknown, what: string, max = 8192): Buffer {
  const t = String(s ?? '');
  if (!t || t.length > max || !B64U_RE.test(t)) throw new PolicyViolation('PASSKEY_FORMAT', `${what} 형식이 아닙니다.`);
  return Buffer.from(t, 'base64url');
}

/** 출처(origin)가 도메인에 속하는가 — https 만(점검판 localhost 는 http 도) */
export function originOk(origin: string, rpId: string): boolean {
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  if (u.origin !== origin) return false;
  if (rpId === 'localhost') return u.hostname === 'localhost' && (u.protocol === 'http:' || u.protocol === 'https:');
  return u.protocol === 'https:' && (u.hostname === rpId || u.hostname.endsWith('.' + rpId));
}

/** authenticatorData — 도메인 지문(32) · 깃발(1) · 서명 횟수(4) · [AT 면] aaguid(16) · 자격 번호 길이(2) · 자격 번호 */
export function parseAuthData(buf: Buffer) {
  if (buf.length < 37) throw new PolicyViolation('PASSKEY_FORMAT', '인증 자료(authenticatorData)가 짧습니다.');
  const flags = buf[32]!;
  const out = { rpIdHash: buf.subarray(0, 32), flags, signCount: buf.readUInt32BE(33), aaguid: null as string | null, credId: null as Buffer | null };
  if (flags & FLAG_AT) {
    if (buf.length < 55) throw new PolicyViolation('PASSKEY_FORMAT', '인증 자료에 자격 정보가 없습니다.');
    out.aaguid = buf.subarray(37, 53).toString('hex');
    const n = buf.readUInt16BE(53);
    if (buf.length < 55 + n || n < 16) throw new PolicyViolation('PASSKEY_FORMAT', '인증 자료의 자격 번호 길이가 맞지 않습니다.');
    out.credId = buf.subarray(55, 55 + n);
  }
  return out;
}

/** 공개 키(SPKI DER)가 알고리즘과 맞는가 */
export function keyFor(der: Buffer, alg: number): KeyObject {
  let k: KeyObject;
  try { k = createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { throw new PolicyViolation('PASSKEY_KEY', '공개 키를 읽지 못했습니다.'); }
  const t = k.asymmetricKeyType, d = k.asymmetricKeyDetails ?? {};
  const fit = (alg === -7 && t === 'ec' && d.namedCurve === 'prime256v1') || (alg === -8 && t === 'ed25519') || (alg === -257 && t === 'rsa' && (d.modulusLength ?? 0) >= 2048);
  if (!fit) throw new PolicyViolation('PASSKEY_KEY', '공개 키가 알고리즘과 맞지 않습니다(ES256 · EdDSA · RS256 만).');
  return k;
}

export function verifySig(alg: number, key: KeyObject, data: Buffer, sig: Buffer): boolean {
  try { return alg === -8 ? cryptoVerify(null, data, key, sig) : cryptoVerify('sha256', data, key, sig); } catch { return false; }
}

function clientData(raw: Buffer, type: string, rpId: string) {
  let j: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
  try { j = JSON.parse(raw.toString('utf8')); } catch { throw new PolicyViolation('PASSKEY_FORMAT', 'clientDataJSON 을 읽지 못했습니다.'); }
  if (j.type !== type) throw new PolicyViolation('PASSKEY_TYPE', '패스키 응답 종류가 맞지 않습니다.');
  if (!originOk(String(j.origin ?? ''), rpId)) throw new PolicyViolation('PASSKEY_ORIGIN', '패스키를 요청한 주소가 운영 화면 도메인이 아닙니다.');
  if (j.crossOrigin) throw new PolicyViolation('PASSKEY_ORIGIN', '다른 사이트 안에서 부른 패스키는 받지 않습니다.');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(j.challenge ?? ''))) throw new PolicyViolation('PASSKEY_CHALLENGE', '확인 문제가 없습니다.');
  return { challenge: String(j.challenge) };
}

/** 문제를 한 번만 씀(5분 · 그 계정 · 그 용도) */
async function consumeChallenge(db: DatabaseService, accountId: string, purpose: 'REGISTER' | 'VERIFY', challenge: string) {
  const [r] = await db.query(
    `UPDATE staff_passkey_challenges SET used_at = now() WHERE challenge_hash = $1 AND account_id = $2 AND purpose = $3 AND used_at IS NULL AND expires_at > now() RETURNING id`,
    [sha256(challenge).toString('hex'), accountId, purpose]);
  if (!r) throw new PolicyViolation('PASSKEY_CHALLENGE', '확인 문제가 지났거나 이미 썼습니다 — 다시 시도해 주십시오.');
}

async function newChallenge(db: DatabaseService, accountId: string, purpose: 'REGISTER' | 'VERIFY') {
  const [n] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM staff_passkey_challenges WHERE account_id = $1 AND created_at > now() - interval '10 minutes'`, [accountId]);
  if ((n?.n ?? 0) >= OPEN_CHALLENGES) throw new AppError(429, { code: 'PASSKEY_TOO_MANY', message: '패스키 요청이 너무 많습니다 — 10분 뒤에 다시 시도해 주십시오.' });
  const ch = b64u(randomBytes(32));
  await db.query(`INSERT INTO staff_passkey_challenges (account_id, purpose, challenge_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4::int))`,
    [accountId, purpose, sha256(ch).toString('hex'), CHALLENGE_MIN]);
  return ch;
}

function audit(db: DatabaseService, action: string, targetId: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent) VALUES ($1, $2, $3, 'ACCOUNT', $4, $5::jsonb, $6, $7)`,
    [c?.actorId ?? targetId, c?.actorRole ?? null, action, targetId, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}

/** AuthMiddleware — EXTRA 이고 패스키를 등록한 운영자인데 이 로그인 기기가 확인하지 않았으면 true(운영 역할 · 켜짐일 때만 DB 를 봄) */
export async function passkeyPending(db: DatabaseService, p: Principal, sid: string | undefined): Promise<boolean> {
  if (!isStaff(p.roles)) return false;
  const s = await passkeySettings(db);
  if (!s.on || s.mode !== 'EXTRA' || !s.rpId) return false;
  const [r] = await db.query<{ has: boolean; ok: boolean | null }>(
    `SELECT EXISTS (SELECT 1 FROM staff_passkeys WHERE account_id = $1 AND revoked_at IS NULL AND rp_id = $3) AS has,
            (SELECT passkey_at > now() - make_interval(hours => $4::int) FROM login_sessions WHERE id::text = $2 AND account_id = $1 AND revoked_at IS NULL) AS ok`,
    [p.accountId, sid ?? '', s.rpId, s.hours]);
  return !!r?.has && !r.ok;
}

async function myKeys(db: DatabaseService, accountId: string, rpId?: string) {
  return db.query<{ id: string; credId: string; label: string; alg: number; rpId: string; transports: string[]; createdAt: string; lastUsedAt: string | null }>(
    `SELECT id::text AS id, cred_id AS "credId", label, alg, rp_id AS "rpId", transports, created_at AS "createdAt", last_used_at AS "lastUsedAt"
       FROM staff_passkeys WHERE account_id = $1 AND revoked_at IS NULL AND ($2 = '' OR rp_id = $2) ORDER BY id`, [accountId, rpId ?? '']);
}

/** 내 패스키 상태 — 운영 화면이 「패스키로 확인」 화면 · 등록 단추를 정함 */
export async function passkeyStatus(db: DatabaseService, p: Principal, sid: string | undefined) {
  const s = await passkeySettings(db);
  const keys = isStaff(p.roles) ? await myKeys(db, p.accountId) : [];
  const usable = keys.filter((k) => k.rpId === s.rpId);
  const [ses] = sid ? await db.query<{ ok: boolean | null }>(
    `SELECT passkey_at > now() - make_interval(hours => $3::int) AS ok FROM login_sessions WHERE id::text = $1 AND account_id = $2`, [sid, p.accountId, s.hours]) : [];
  const verified = !!ses?.ok;
  const live = s.on && !!s.rpId && usable.length > 0;
  return {
    on: s.on, mode: s.mode, rpId: s.rpId || null, rpReady: !!s.rpId, hours: s.hours, staff: isStaff(p.roles),
    items: keys.map((k) => ({ id: k.id, label: k.label, alg: k.alg, rpId: k.rpId, usable: k.rpId === s.rpId, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    enrolled: usable.length, verified, sessionKnown: !!sid,
    /* EXTRA: 아직 확인 안 했으면 게이트 · REPLACE_MFA: 2단계 인증 화면 대신 패스키(운영 화면이 2단계 상태와 함께 판단) */
    gate: !live ? null : s.mode === 'EXTRA' ? (verified ? null : 'EXTRA') : 'REPLACE_MFA',
    canRegister: s.on && !!s.rpId && isStaff(p.roles) && usable.length < MAX_KEYS,
  };
}

/** 등록 · 끄기 전 — 이 증표가 비밀번호만으로 받은 것이 아님(2단계 · 접속 인증 · 패스키 확인을 마침) */
function assertFullyVerified(p: Principal) {
  if (!isStaff(p.roles)) throw new Forbidden('FORBIDDEN', '운영 계정만 패스키를 씁니다.');
  if (p.mfaPending) throw new Forbidden('MFA_REQUIRED', '2단계 인증 번호를 먼저 넣어 주십시오.');
  if (p.ipPending) throw new Forbidden('IP_VERIFY_REQUIRED', '처음 쓰는 곳에서 접속했습니다 — 접속 인증번호를 먼저 넣어 주십시오.');
  if (p.passkeyPending) throw new Forbidden('PASSKEY_REQUIRED', '등록한 패스키로 먼저 확인해 주십시오.');
}

async function readySettings(db: DatabaseService) {
  const s = await passkeySettings(db);
  if (!s.on) throw new PolicyViolation('PASSKEY_OFF', '패스키가 꺼져 있습니다(admin.passkey) — 최고 관리자가 켜야 합니다.');
  if (!s.rpId) throw new PolicyViolation('PASSKEY_NOT_READY', '패스키 도메인(admin.passkey_rp_id)이 비어 있습니다 — 최고 관리자가 넣어야 합니다.');
  return s;
}

/** 등록 시작 — 브라우저 navigator.credentials.create 에 넣을 값 */
export async function registerOptions(db: DatabaseService, p: Principal) {
  assertFullyVerified(p);
  const s = await readySettings(db);
  const keys = await myKeys(db, p.accountId, s.rpId);
  if (keys.length >= MAX_KEYS) throw new PolicyViolation('PASSKEY_MAX', `패스키는 한 사람에 ${MAX_KEYS}개까지입니다 — 쓰지 않는 것을 끄고 다시 하십시오.`);
  const [a] = await db.query<{ email: string; name: string | null }>(`SELECT email::text AS email, name FROM accounts WHERE id = $1`, [p.accountId]);
  const challenge = await newChallenge(db, p.accountId, 'REGISTER');
  return {
    challenge, rp: { id: s.rpId, name: '소개뱅크 운영' },
    user: { id: b64u(Buffer.from(p.accountId.replace(/-/g, ''), 'hex')), name: a?.email ?? 'admin', displayName: a?.name || a?.email || '운영자' },
    pubKeyCredParams: PASSKEY_ALGS.map((alg) => ({ type: 'public-key', alg })),
    timeout: CHALLENGE_MIN * 60_000, attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: keys.map((k) => ({ type: 'public-key', id: k.credId })),
  };
}

/** 등록 마치기 */
export async function registerPasskey(db: DatabaseService, p: Principal, sid: string | undefined, d: {
  id: string; clientDataJSON: string; authenticatorData: string; publicKey: string; publicKeyAlgorithm: number; transports?: string[]; label: string }) {
  assertFullyVerified(p);
  const s = await readySettings(db);
  const label = String(d.label ?? '').replace(/\s+/g, ' ').trim();
  if (label.length < 1 || label.length > 40) throw new PolicyViolation('PASSKEY_LABEL', '패스키 이름은 1 ~ 40자입니다(예: 사무실 노트북 지문).');
  const credId = String(d.id ?? '');
  if (!CRED_RE.test(credId) || credId.length < 16 || credId.length > 1400) throw new PolicyViolation('PASSKEY_FORMAT', '자격 번호 형식이 아닙니다.');
  const alg = Number(d.publicKeyAlgorithm);
  if (!(PASSKEY_ALGS as readonly number[]).includes(alg)) throw new PolicyViolation('PASSKEY_KEY', '지원하지 않는 알고리즘입니다(ES256 · EdDSA · RS256 만).');
  const cd = clientData(unb64u(d.clientDataJSON, 'clientDataJSON'), 'webauthn.create', s.rpId);
  const ad = parseAuthData(unb64u(d.authenticatorData, '인증 자료'));
  if (!ad.rpIdHash.equals(sha256(s.rpId))) throw new PolicyViolation('PASSKEY_RP', '패스키 도메인이 맞지 않습니다.');
  if (!(ad.flags & FLAG_UP) || !(ad.flags & FLAG_UV)) throw new PolicyViolation('PASSKEY_UV', '기기에서 지문 · 얼굴 · PIN 확인을 마쳐야 합니다.');
  if (!ad.credId || !ad.credId.equals(Buffer.from(credId, 'base64url'))) throw new PolicyViolation('PASSKEY_FORMAT', '인증 자료의 자격 번호가 보낸 번호와 다릅니다.');
  const der = unb64u(d.publicKey, '공개 키', 4096);
  keyFor(der, alg);
  await consumeChallenge(db, p.accountId, 'REGISTER', cd.challenge);
  const transports = (Array.isArray(d.transports) ? d.transports : []).filter((t) => /^[a-z-]{2,20}$/.test(String(t))).slice(0, 8);
  const [dup] = await db.query(`SELECT 1 FROM staff_passkeys WHERE cred_id = $1`, [credId]);
  if (dup) throw new StateConflict('PASSKEY_DUP', '이미 등록한 패스키입니다.');
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO staff_passkeys (account_id, cred_id, public_key, alg, rp_id, sign_count, label, transports, aaguid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9) RETURNING id::text AS id`,
    [p.accountId, credId, der, alg, s.rpId, ad.signCount, label, transports, ad.aaguid && /^[0-9a-f]{32}$/.test(ad.aaguid) ? ad.aaguid : null]);
  /* 등록도 기기 확인(UV)을 거쳤으므로 이 로그인 기기는 확인한 것으로 */
  if (sid) await db.query(`UPDATE login_sessions SET passkey_at = now() WHERE id::text = $1 AND account_id = $2`, [sid, p.accountId]);
  await audit(db, 'PASSKEY_REGISTER', p.accountId, { passkeyId: row.id, alg, label });
  return { ok: true, id: row.id, note: '패스키를 등록했습니다.' };
}

/** 확인 시작 */
export async function verifyOptions(db: DatabaseService, p: Principal) {
  if (!isStaff(p.roles)) throw new Forbidden('FORBIDDEN', '운영 계정만 패스키를 씁니다.');
  const s = await readySettings(db);
  const keys = await myKeys(db, p.accountId, s.rpId);
  if (!keys.length) throw new PolicyViolation('PASSKEY_NONE', '등록한 패스키가 없습니다.');
  const challenge = await newChallenge(db, p.accountId, 'VERIFY');
  return { challenge, rpId: s.rpId, timeout: CHALLENGE_MIN * 60_000, userVerification: 'required',
    allowCredentials: keys.map((k) => ({ type: 'public-key', id: k.credId, transports: k.transports })) };
}

/** 확인 — EXTRA: 이 로그인 기기에 확인 시각 · REPLACE_MFA: 2단계 확인된 새 증표(issue 는 AuthService 를 부르는 쪽이 넘김) */
export async function verifyPasskey(db: DatabaseService, p: Principal, sid: string | undefined, d: {
  id: string; clientDataJSON: string; authenticatorData: string; signature: string }, issue: (accountId: string, mfaAt: number, sid?: string) => Promise<{ accessToken: string; refreshToken: string }>) {
  if (!isStaff(p.roles)) throw new Forbidden('FORBIDDEN', '운영 계정만 패스키를 씁니다.');
  if (p.ipPending) throw new Forbidden('IP_VERIFY_REQUIRED', '처음 쓰는 곳에서 접속했습니다 — 접속 인증번호를 먼저 넣어 주십시오.');
  const s = await readySettings(db);
  if (!sid) throw new StateConflict('PASSKEY_NO_SESSION', '이 로그인은 기기 기록이 없는 옛 증표입니다 — 로그아웃 뒤 다시 로그인해 주십시오.');
  const credId = String(d.id ?? '');
  if (!CRED_RE.test(credId) || credId.length < 16 || credId.length > 1400) throw new PolicyViolation('PASSKEY_FORMAT', '자격 번호 형식이 아닙니다.');
  const [k] = await db.query<{ id: string; publicKey: Buffer; alg: number; signCount: string }>(
    `SELECT id::text AS id, public_key AS "publicKey", alg, sign_count::text AS "signCount" FROM staff_passkeys
      WHERE cred_id = $1 AND account_id = $2 AND revoked_at IS NULL AND rp_id = $3`, [credId, p.accountId, s.rpId]);
  if (!k) throw new Forbidden('PASSKEY_INVALID', '등록한 패스키가 아닙니다.');
  const rawCd = unb64u(d.clientDataJSON, 'clientDataJSON');
  const cd = clientData(rawCd, 'webauthn.get', s.rpId);
  const rawAd = unb64u(d.authenticatorData, '인증 자료');
  const ad = parseAuthData(rawAd);
  await consumeChallenge(db, p.accountId, 'VERIFY', cd.challenge);
  const fail = async (why: string): Promise<never> => {
    await audit(db, 'PASSKEY_FAIL', p.accountId, { passkeyId: k.id, why });
    throw new Forbidden('PASSKEY_INVALID', '패스키 확인에 실패했습니다.');
  };
  if (!ad.rpIdHash.equals(sha256(s.rpId))) return fail('RP');
  if (!(ad.flags & FLAG_UP) || !(ad.flags & FLAG_UV)) return fail('UV');
  const key = keyFor(Buffer.from(k.publicKey), k.alg);
  if (!verifySig(k.alg, key, Buffer.concat([rawAd, sha256(rawCd)]), unb64u(d.signature, '서명', 2048))) return fail('SIGNATURE');
  const prev = Number(k.signCount);
  if ((prev > 0 || ad.signCount > 0) && ad.signCount <= prev) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PASSKEY_CLONE_SUSPECT', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`운영자 패스키 복제 의심 — 서명 횟수가 줄거나 같음(${prev} → ${ad.signCount}) · 권한 계층 › 내 2단계 인증 › 패스키에서 끄십시오`, JSON.stringify({ accountId: p.accountId, passkeyId: k.id, prev, now: ad.signCount })]);
    return fail('COUNTER');
  }
  await db.query(`UPDATE staff_passkeys SET sign_count = $2, last_used_at = now() WHERE id = $1::bigint`, [k.id, ad.signCount]);
  await db.query(`UPDATE login_sessions SET passkey_at = now() WHERE id::text = $1 AND account_id = $2`, [sid, p.accountId]);
  await audit(db, 'PASSKEY_VERIFY', p.accountId, { passkeyId: k.id, mode: s.mode });
  if (s.mode === 'REPLACE_MFA') {
    const t = await issue(p.accountId, Math.floor(Date.now() / 1000), sid);
    return { ok: true, mode: s.mode, accessToken: t.accessToken, refreshToken: t.refreshToken, note: '패스키로 확인했습니다(2단계 인증을 대신함).' };
  }
  return { ok: true, mode: s.mode, note: '패스키로 확인했습니다.' };
}

/** 내 패스키 끄기(분실 · 기기 바꿈) — 끝까지 확인한 증표로만 */
export async function revokeMyPasskey(db: DatabaseService, p: Principal, id: string, reason?: string) {
  assertFullyVerified(p);
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 패스키입니다.');
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim() || '본인이 끔';
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('PASSKEY_REASON', '사유는 2 ~ 200자입니다.');
  const [r] = await db.query(`UPDATE staff_passkeys SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1::bigint AND account_id = $2 AND revoked_at IS NULL RETURNING id`, [id, p.accountId, why]);
  if (!r) throw new NotFound('없거나 이미 끈 패스키입니다.');
  await audit(db, 'PASSKEY_REVOKE', p.accountId, { passkeyId: id, self: true });
  return { ok: true, id, note: '패스키를 껐습니다.' };
}

/* ── SUPER ─────────────────────────────────────────────────────── */
export async function staffPasskeys(db: DatabaseService) {
  const s = await passkeySettings(db);
  const items = await db.query<{ email: string }>(
    `SELECT k.id::text AS id, a.email::text AS email, a.name, k.label, k.alg, k.rp_id AS "rpId", k.created_at AS "createdAt", k.last_used_at AS "lastUsedAt",
            k.revoked_at AS "revokedAt", k.revoke_reason AS "revokeReason", (k.account_id::text = $1) AS me
       FROM staff_passkeys k JOIN accounts a ON a.id = k.account_id
      ORDER BY (k.revoked_at IS NULL) DESC, k.id DESC LIMIT 200`, [RequestCtx.actorId() ?? '']);
  return { settings: { on: s.on, mode: s.mode, rpId: s.rpId, hours: s.hours }, items: items.map((x) => ({ ...x, email: maskMail(x.email) })) };
}

export async function revokeStaffPasskey(db: DatabaseService, id: string, reason: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 패스키입니다.');
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 5 || why.length > 200) throw new PolicyViolation('PASSKEY_REASON', '끄는 사유를 5 ~ 200자로 적어 주십시오.');
  const me = RequestCtx.actorId() ?? null;
  const [r] = await db.query<{ account: string }>(
    `UPDATE staff_passkeys SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE id = $1::bigint AND revoked_at IS NULL RETURNING account_id::text AS account`, [id, me, why]);
  if (!r) throw new NotFound('없거나 이미 끈 패스키입니다.');
  await audit(db, 'PASSKEY_REVOKE', r.account, { passkeyId: id, by: me, reason: why });
  return { ok: true, id, note: '그 운영자의 패스키를 껐습니다.' };
}

export async function setPasskeyPolicy(db: DatabaseService, d: { on?: boolean; mode?: string; rpId?: string; reason: string }) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('PASSKEY_REASON', '사유는 2 ~ 200자입니다.');
  const cur = await passkeySettings(db);
  const set: Array<[string, string]> = [];
  if (d.rpId !== undefined) {
    const rp = d.rpId.trim().toLowerCase();
    if (!RP_RE.test(rp)) throw new PolicyViolation('PASSKEY_RP', '도메인 형식이 아닙니다(예 sogaebank.com · 점검판 localhost).');
    set.push(['admin.passkey_rp_id', rp]);
  }
  if (d.mode !== undefined) {
    if (!['EXTRA', 'REPLACE_MFA'].includes(d.mode)) throw new PolicyViolation('PASSKEY_MODE', '방식은 EXTRA · REPLACE_MFA 중 하나입니다.');
    set.push(['admin.passkey_mode', d.mode]);
  }
  if (d.on !== undefined) {
    const rp = d.rpId !== undefined ? d.rpId.trim().toLowerCase() : cur.rpId;
    if (d.on && !rp) throw new PolicyViolation('PASSKEY_NOT_READY', '켜기 전에 패스키 도메인(admin.passkey_rp_id)을 넣어 주십시오.');
    set.push(['admin.passkey', d.on ? 'on' : 'off']);
  }
  if (!set.length) throw new PolicyViolation('PASSKEY_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  resetPasskeyCache();
  const s = await passkeySettings(db);
  return { ok: true, settings: { on: s.on, mode: s.mode, rpId: s.rpId, hours: s.hours }, note: '패스키 설정을 바꿨습니다(다른 서버 프로세스는 30초 안에 따라옴).' };
}

/* ===== v10.484 (D268 · docs/622) 운영자 패스키 — web/src/lib/passkey.ts 새 파일 =====
 * 브라우저 WebAuthn(navigator.credentials) 도우미 — 새 npm 패키지 없음.
 *   등록: create() 의 응답에서 getPublicKey()(SPKI) · getPublicKeyAlgorithm() · getAuthenticatorData() 를 꺼내 서버로(서버는 CBOR 을 읽지 않음)
 *   확인: get() 의 authenticatorData · clientDataJSON · signature
 *   getPublicKey 가 없는 옛 브라우저는 등록할 수 없음(크롬 · 엣지 · 사파리 · 파이어폭스 최근 판은 됨)
 */
import { api } from './api';

const toB64u = (b: ArrayBuffer | ArrayBufferView) => {
  const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let s = ''; u.forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(t); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

interface RegOptions { challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>; timeout: number; attestation: AttestationConveyancePreference;
  authenticatorSelection: AuthenticatorSelectionCriteria; excludeCredentials: Array<{ type: 'public-key'; id: string }> }
interface VerOptions { challenge: string; rpId: string; timeout: number; userVerification: UserVerificationRequirement; allowCredentials: Array<{ type: 'public-key'; id: string; transports?: string[] }> }

/** 패스키 만들기 → 서버에 등록 */
export async function registerPasskey(label: string) {
  if (!passkeySupported()) throw new Error('이 브라우저는 패스키를 지원하지 않습니다.');
  const o = await api<RegOptions>('/auth/passkey/register/options', { method: 'POST' });
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: fromB64u(o.challenge), rp: o.rp, user: { ...o.user, id: fromB64u(o.user.id) }, pubKeyCredParams: o.pubKeyCredParams,
    timeout: o.timeout, attestation: o.attestation, authenticatorSelection: o.authenticatorSelection,
    excludeCredentials: o.excludeCredentials.map((c) => ({ type: c.type, id: fromB64u(c.id) })),
  } }) as PublicKeyCredential | null;
  if (!cred) throw new Error('패스키를 만들지 않았습니다.');
  const r = cred.response as AuthenticatorAttestationResponse & { getPublicKey?: () => ArrayBuffer | null; getPublicKeyAlgorithm?: () => number; getAuthenticatorData?: () => ArrayBuffer; getTransports?: () => string[] };
  const pk = r.getPublicKey?.() ?? null;
  if (!pk || !r.getPublicKeyAlgorithm || !r.getAuthenticatorData) throw new Error('이 브라우저는 공개 키를 꺼내 주지 않습니다 — 최근 크롬 · 엣지 · 사파리 · 파이어폭스로 해 주십시오.');
  return api<{ ok: boolean; id: string; note: string }>('/auth/passkey/register', { method: 'POST', body: JSON.stringify({
    id: toB64u(cred.rawId), clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.getAuthenticatorData()),
    publicKey: toB64u(pk), publicKeyAlgorithm: r.getPublicKeyAlgorithm(), transports: r.getTransports?.() ?? [], label,
  }) });
}

/** 패스키로 확인 → 서버(REPLACE_MFA 면 새 증표가 옴) */
export async function verifyPasskey() {
  if (!passkeySupported()) throw new Error('이 브라우저는 패스키를 지원하지 않습니다.');
  const o = await api<VerOptions>('/auth/passkey/verify/options', { method: 'POST' });
  const cred = await navigator.credentials.get({ publicKey: {
    challenge: fromB64u(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification,
    allowCredentials: o.allowCredentials.map((c) => ({ type: c.type, id: fromB64u(c.id), transports: (c.transports ?? []) as AuthenticatorTransport[] })),
  } }) as PublicKeyCredential | null;
  if (!cred) throw new Error('패스키 확인을 하지 않았습니다.');
  const r = cred.response as AuthenticatorAssertionResponse;
  return api<{ ok: boolean; mode: string; accessToken?: string; refreshToken?: string; note: string }>('/auth/passkey/verify', { method: 'POST', body: JSON.stringify({
    id: toB64u(cred.rawId), clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature),
  }) });
}

export interface PasskeyStatus {
  on: boolean; mode: 'EXTRA' | 'REPLACE_MFA'; rpId: string | null; rpReady: boolean; hours: number; staff: boolean;
  items: Array<{ id: string; label: string; alg: number; rpId: string; usable: boolean; createdAt: string; lastUsedAt: string | null }>;
  enrolled: number; verified: boolean; sessionKnown: boolean; gate: 'EXTRA' | 'REPLACE_MFA' | null; canRegister: boolean;
}

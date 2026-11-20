/**
 * v10.498 (D272 · docs/636) 간편 로그인 — 사용자 웹 서버 쪽 도움 함수(라우트 처리기 · 서버 액션이 씀).
 *
 *   ★ 'use server' 파일이 아닙니다 — 여기 함수는 브라우저가 부를 수 없습니다(증표 쿠키를 쓰는 함수가 있어서).
 *   증표 쿠키 이름 · 옵션은 lib/session.ts 의 saveTokens 와 같게(sgb_at 15분 · sgb_rt 14일 · httpOnly · lax). 그쪽을 바꾸면 여기도.
 *   간편 로그인 쿠키 셋은 /login/social 아래에서만 보냄(path) — 묶음 값(sgb_sb · 10분) · 돌아갈 주소(sgb_sn · 10분) · 이어서 표(sgb_st · 15분).
 */
import { cookies, headers } from 'next/headers';

export const API = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
export const SOC_BIND = 'sgb_sb';
export const SOC_NEXT = 'sgb_sn';
export const SOC_TICKET = 'sgb_st';
export const SOC_PATH = '/login/social';
const prod = () => process.env.NODE_ENV === 'production';

/** 이 사이트 안의 경로만(로그인 화면 safeNext 와 같은 규칙) */
export function safeNext(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 500) return null;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.includes('://')) return null;
  if (/[\u0000-\u001f]/.test(v)) return null;
  return v;
}

/** 무작위 base64url(브라우저 묶음 값) */
export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Buffer.from(a).toString('base64url');
}

/** 접속자 IP · 브라우저 종류를 API 로(로그인 횟수 제한 · 로그인 기록이 손님 기준이 되게 — session.ts fwdHeaders 와 같음) */
export async function fwd(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  try {
    const hh = await headers();
    const xff = hh.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) h['X-Forwarded-For'] = xff;
    const ua = hh.get('user-agent');
    if (ua) h['User-Agent'] = ua.slice(0, 300);
  } catch { /* 요청 밖 */ }
  return h;
}

export type ApiOut = { status: number; data: any };

export async function apiPost(path: string, body: unknown, withAuth = false, method = 'POST'): Promise<ApiOut> {
  const jar = await cookies();
  const extra: Record<string, string> = {};
  if (withAuth) {
    const at = jar.get('sgb_at')?.value;
    if (!at) return { status: 401, data: { code: 'UNAUTHENTICATED', message: '로그인이 풀렸습니다. 다시 로그인해 주십시오.' } };
    extra.Authorization = `Bearer ${at}`;
  }
  try {
    const res = await fetch(API + path, { method, headers: await fwd(extra), body: method === 'DELETE' ? undefined : JSON.stringify(body ?? {}), cache: 'no-store' });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 503, data: { code: 'API_DOWN', message: '서버에 닿지 못했습니다.' } };
  }
}

/** 로그인 증표 저장(로그인 상태 유지 켬과 같음) · 재동의 확인 기억 지움 */
export async function saveSession(access: string, refresh: string) {
  const jar = await cookies();
  jar.delete('sgb_tc');
  jar.set('sgb_at', access, { httpOnly: true, secure: prod(), sameSite: 'lax', path: '/', maxAge: 900 });
  jar.set('sgb_rt', refresh, { httpOnly: true, secure: prod(), sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 14 });
  jar.delete('sgb_keep');
}

export async function setSocCookie(name: string, value: string, maxAge: number) {
  (await cookies()).set(name, value, { httpOnly: true, secure: prod(), sameSite: 'lax', path: SOC_PATH, maxAge });
}
export async function clearSocCookie(name: string) {
  (await cookies()).set(name, '', { httpOnly: true, secure: prod(), sameSite: 'lax', path: SOC_PATH, maxAge: 0 });
}

/** 돌아올 주소의 앞부분 — 운영은 SITE_ORIGIN(https://sogaebank.com), 없으면 요청 주소 */
export function siteOrigin(reqOrigin: string): string {
  return (process.env.SITE_ORIGIN || reqOrigin).replace(/\/+$/, '');
}

/** 서버 오류 코드 → 사전 열쇠(upt.*) */
export const SOC_ERR_KEY = {
  SOCIAL_STATE_INVALID: 'errState', SOCIAL_TICKET_INVALID: 'expired', SOCIAL_OFF: 'errOff', SOCIAL_ASSUME_PROD: 'errOff', SOCIAL_NOT_READY: 'errOff',
  SOCIAL_CANCELLED: 'errCancelled', SOCIAL_STAFF_NOT_ALLOWED: 'errStaff', SOCIAL_LINKED_OTHER: 'errLinkedOther', SOCIAL_PROVIDER_TAKEN: 'errTaken',
  WITHDRAW_PENDING: 'errWithdraw', ACCOUNT_INACTIVE: 'errInactive', SOCIAL_TOKEN_FAIL: 'errProvider', SOCIAL_PROFILE_FAIL: 'errProvider', SOCIAL_CODE_INVALID: 'errProvider',
} as const;
export type SocErrKey = (typeof SOC_ERR_KEY)[keyof typeof SOC_ERR_KEY] | 'errDefault';
export function socErrKey(code: string | null | undefined): SocErrKey {
  return code && code in SOC_ERR_KEY ? SOC_ERR_KEY[code as keyof typeof SOC_ERR_KEY] : 'errDefault';
}

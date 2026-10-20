'use server';
import { cookies, headers } from 'next/headers';
import { REF_COOKIE, VISITOR_COOKIE } from './api';

const AT = 'sgb_at';
const RT = 'sgb_rt';
const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';

export interface Principal {
  accountId: string;
  roles: string[];
  identityVerifiedAt: string | null;
  businessVerifiedAt: string | null;
  hasActiveSubscription: boolean;
}

/**
 * 토큰은 HttpOnly 쿠키에 둡니다.
 * localStorage 에 두면 XSS 한 번에 세션이 나갑니다.
 */
async function saveTokens(access: string, refresh: string, keep = true) {
  const jar = await cookies();
  const prod = process.env.NODE_ENV === 'production';
  jar.delete('sgb_tc');      // v10.28 — 재동의 확인 기억(미들웨어)은 계정이 바뀌면 다시 묻습니다
  jar.set(AT, access,  { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: 900 });
  /* v10.31 — 「로그인 상태 유지」를 끄면 브라우저를 닫을 때 사라지는 쿠키(maxAge 없음) · 미들웨어가 다시 발급할 때도 같게(sgb_keep=0) */
  jar.set(RT, refresh, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', ...(keep ? { maxAge: 60 * 60 * 24 * 14 } : {}) });
  if (keep) jar.delete('sgb_keep');
  else jar.set('sgb_keep', '0', { httpOnly: true, secure: prod, sameSite: 'lax', path: '/' });
}

/** 방문자 키. 비로그인 유입을 나중에 계정과 잇는 근거입니다 (INV-2) */
export async function ensureVisitor(): Promise<string> {
  const jar = await cookies();
  let v = jar.get(VISITOR_COOKIE)?.value;
  if (!v) {
    v = crypto.randomUUID();
    jar.set(VISITOR_COOKIE, v, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  return v;
}

/** 소개코드는 ?ref= 로 들어옵니다. 쿠키에 담아 이후 요청 헤더로 보냅니다 */
export async function captureRef(ref: string) {
  const jar = await cookies();
  jar.set(REF_COOKIE, ref, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 90 });
}

type AuthResult = { ok: true; reconsent?: boolean } | { ok: false; code: string; message: string };

/**
 * v10.48 (D102) — 서버 액션이 API 를 부를 때 **접속자 IP** 를 넘깁니다.
 *   넘기지 않으면 API 는 이 서버(사용자 웹)의 IP 로 보아, 로그인 실패 횟수 제한(같은 IP 1분 5회)이 모든 사람에게 한꺼번에 걸립니다.
 *   운영 Nginx 가 X-Forwarded-For 를 $remote_addr 로 덮어쓰므로 그 첫 값이 실제 접속자입니다.
 */
async function fwdHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  try {
    const xff = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) h['X-Forwarded-For'] = xff;
  } catch { /* 요청 밖에서 불림 — 넘길 것 없음 */ }
  return h;
}

async function post(path: string, body: unknown, keep = true): Promise<AuthResult> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: await fwdHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      code: data?.code ?? 'UNKNOWN',
      message: data?.message ?? '요청을 처리하지 못했습니다.',
    };
  }
  await saveTokens(data.accessToken, data.refreshToken, keep);
  return { ok: true, reconsent: await needsConsent(data.accessToken) };
}

/** v10.28 (재동의) — 동의하지 않은 필수 약관이 있으면 true. 로그인 직후 동의 화면으로 보내는 데 씁니다. 서버가 답하지 않으면 false(막지 않음). */
async function needsConsent(token: string): Promise<boolean> {
  try {
    const r = await fetch(BASE + '/terms/required', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!r.ok) return false;
    const list = (await r.json()) as Array<{ isRequired?: boolean; agreed?: boolean }>;
    return Array.isArray(list) && list.some((t) => t.isRequired && !t.agreed);
  } catch { return false; }
}

export async function login(email: string, password: string, keep = true): Promise<AuthResult> {
  // ★ visitorKey 를 함께 보냅니다. 빠뜨리면 비로그인 유입이 전부 유실됩니다
  const visitorKey = await ensureVisitor();
  return post('/auth/login', { email, password, visitorKey }, keep);
}

export async function signup(
  email: string, password: string, name: string, agreedTerms?: string[], jobTitle?: string,
): Promise<AuthResult> {
  const visitorKey = await ensureVisitor();
  return post('/auth/signup', {
    email, password, name, visitorKey, ...(agreedTerms ? { agreedTerms } : {}), ...(jobTitle ? { jobTitle } : {}),
  });
}

export async function logout() {
  const jar = await cookies();
  jar.delete(AT);
  jar.delete(RT);
  jar.delete('sgb_tc');
  jar.delete('sgb_keep');
}

/* ── v10.48 (D102) 비밀번호 찾기 · 재설정 · 변경 · 회원 탈퇴 ─────────────────────── */

export type ActResult = { ok: true; note?: string; devLink?: string } | { ok: false; code: string; message: string; details?: unknown };

async function call(method: string, path: string, body: unknown, withAuth: boolean): Promise<{ status: number; data: any }> {
  const jar = await cookies();
  const extra: Record<string, string> = {};
  if (withAuth) {
    const at = jar.get(AT)?.value;
    if (!at) return { status: 401, data: { code: 'UNAUTHENTICATED', message: '로그인이 풀렸습니다. 다시 로그인해 주십시오.' } };
    extra.Authorization = `Bearer ${at}`;
  }
  const res = await fetch(BASE + path, { method, headers: await fwdHeaders(extra), body: JSON.stringify(body), cache: 'no-store' });
  return { status: res.status, data: await res.json().catch(() => null) };
}

function fail(data: any, fallback: string): ActResult {
  return { ok: false, code: data?.code ?? 'UNKNOWN', message: data?.message ?? fallback, details: data?.details };
}

/** SB-HOM-AUT-040 — 가입한 이메일로 재설정 링크(계정이 있든 없든 같은 답) */
export async function forgotPassword(email: string): Promise<ActResult> {
  const r = await call('POST', '/auth/password/forgot', { email }, false);
  if (r.status >= 400) return fail(r.data, '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.');
  return { ok: true, note: r.data?.note, ...(r.data?.devLink ? { devLink: r.data.devLink } : {}) };
}

/** SB-HOM-AUT-041 — 링크의 token 으로 새 비밀번호. 이 브라우저의 로그인도 지웁니다(다시 로그인) */
export async function resetPassword(token: string, password: string): Promise<ActResult> {
  const r = await call('POST', '/auth/password/reset', { token, password }, false);
  if (r.status >= 400) return fail(r.data, '비밀번호를 바꾸지 못했습니다.');
  await logout();
  return { ok: true, note: r.data?.note };
}

/** SB-MYP-ACC-010 — 로그인 상태에서 변경. 새 증표를 쿠키에 다시 담습니다(다른 기기는 끊김) */
export async function changePassword(currentPassword: string, newPassword: string): Promise<ActResult> {
  const r = await call('PATCH', '/me/password', { currentPassword, newPassword }, true);
  if (r.status >= 400) return fail(r.data, '비밀번호를 바꾸지 못했습니다.');
  const jar = await cookies();
  if (r.data?.accessToken && r.data?.refreshToken) await saveTokens(r.data.accessToken, r.data.refreshToken, jar.get('sgb_keep')?.value !== '0');
  return { ok: true, note: r.data?.note };
}

/** SB-MYP-ACC-020 — 회원 탈퇴. 끝나면 로그인 쿠키를 지웁니다 */
export async function withdrawAccount(password: string, reason: string, memo?: string): Promise<ActResult> {
  const r = await call('POST', '/me/withdraw', { password, reason, ...(memo ? { memo } : {}) }, true);
  if (r.status >= 400) return fail(r.data, '탈퇴를 처리하지 못했습니다.');
  await logout();
  return { ok: true, note: r.data?.note };
}

/** 현재 로그인 상태. 토큰이 아니라 서버가 조립한 principal 입니다 */
export async function me(): Promise<Principal | null> {
  const jar = await cookies();
  const token = jar.get(AT)?.value;
  if (!token) return null;
  const res = await fetch(BASE + '/me/summary', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const d = await res.json();
  return (d.principal ?? d) as Principal;
}

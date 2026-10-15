'use server';
import { cookies } from 'next/headers';
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

async function post(path: string, body: unknown, keep = true): Promise<AuthResult> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

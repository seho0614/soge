'use server';
import { cookies, headers } from 'next/headers';
import { REF_COOKIE, VISITOR_COOKIE, apiGet } from './api';

const AT = 'sgb_at';
const RT = 'sgb_rt';
const DM = 'sgb_dm';   // v10.546 (D285) 기기 표지 — 무작위 값(HttpOnly · 2년) · 로그인 · 가입 때만 API 로 넘김 · API 는 해시만 남김 · v10.559 스위치 켜졌을 때만 만듦
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

/**
 * v10.546 (D285) 기기 표지 — 같은 브라우저에서 여러 계정을 만드는지 보는 데만 씁니다(운영 위험감지 · 자동 정지 없음).
 *   무작위 값 하나(브라우저 지문 · 화면 크기 · 글꼴 같은 것은 모으지 않음) · HttpOnly 쿠키 · 로그인 · 가입 때 없으면 만듦
 *   API 로는 fwdHeaders 가 X-Device-Mark 로 넘김(API 는 로그인 성공 · 가입 때만 해시로 씀 · 꺼져 있으면 버림)
 */
async function ensureDeviceMark(): Promise<void> {
  try {
    const jar = await cookies();
    const v = jar.get(DM)?.value;
    /* v10.559 — 스위치(sfx.device_watch)가 켜졌을 때만 만듦 · 꺼져 있으면 있던 표지도 지움(처리방침에 기기 표지를 게시하기 전에는 쿠키를 남기지 않음 · 대표 11/21)
     *   스위치 값은 공개 설정(/site-settings/public · 이 키 하나만 더함)에서 · 못 읽으면 꺼진 것으로 봄 */
    const st = await apiGet<Record<string, string | null>>('/site-settings/public', 60).catch(() => ({} as Record<string, string | null>));
    if (st['sfx.device_watch'] !== 'on') {
      if (v) jar.delete(DM);
      return;
    }
    if (!v || !/^[A-Za-z0-9-]{16,64}$/.test(v)) {
      jar.set(DM, crypto.randomUUID(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 730 });
    }
  } catch { /* 요청 밖 — 만들 것 없음 */ }
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
    const hh = await headers();
    const xff = hh.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) h['X-Forwarded-For'] = xff;
    /* v10.181 (D170) — 로그인 기록의 브라우저 종류 · 약관 동의 기록이 서버(node)가 아니라 손님 브라우저가 되게 */
    const ua = hh.get('user-agent');
    if (ua) h['User-Agent'] = ua.slice(0, 300);
    /* v10.546 (D285) — 기기 표지 쿠키가 있으면 넘김(읽기만 · 만드는 것은 로그인 · 가입의 ensureDeviceMark) */
    const dm = (await cookies()).get(DM)?.value;
    if (dm && /^[A-Za-z0-9-]{16,64}$/.test(dm)) h['X-Device-Mark'] = dm;
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
  /* v10.592 (docs/734) — 회원 2단계 인증: 증표 대신 표(ticket) — 브라우저 스크립트 · 주소창에 두지 않고 HttpOnly 쿠키(5분) · 화면은 /login/mfa 로(lib/scxAuth memberMfaLogin) */
  if (data?.mfaRequired && typeof data.ticket === 'string') {
    const jar = await cookies();
    const prod = process.env.NODE_ENV === 'production';
    jar.set('sgb_mfa_t', data.ticket, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: 300 });
    jar.set('sgb_mfa_k', keep ? '1' : '0', { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: 300 });
    return { ok: false, code: 'MFA_REQUIRED', message: String(data.message ?? '') };
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
  await ensureDeviceMark();   // v10.546 (D285) 기기 표지
  return post('/auth/login', { email, password, visitorKey }, keep);
}

export async function signup(
  email: string, password: string, name: string, agreedTerms?: string[], jobTitle?: string, recommendCode?: string,
): Promise<AuthResult> {
  const visitorKey = await ensureVisitor();
  await ensureDeviceMark();   // v10.546 (D285) 기기 표지
  return post('/auth/signup', {
    email, password, name, visitorKey, ...(agreedTerms ? { agreedTerms } : {}), ...(jobTitle ? { jobTitle } : {}),
    ...(recommendCode ? { recommendCode } : {}),   // v10.218 (D189) — 추천 코드(선택)
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

/* ── v10.181 (D170 · docs/283) 내 정보 내려받기 · 모든 기기 로그아웃 · 개인정보 권리 요청 ─────────── */

export type ExportResult = { ok: true; fileName: string; json: string } | { ok: false; code: string; message: string; details?: unknown };

/** SB-MYP-DAT-010 — 비밀번호 확인 뒤 내 정보(JSON). 화면이 파일로 저장합니다 */
export async function exportMyData(password: string): Promise<ExportResult> {
  const r = await call('POST', '/me/data-export', { password }, true);
  if (r.status >= 400 || !r.data) return fail(r.data, '내 정보를 내려받지 못했습니다.') as ExportResult;
  return { ok: true, fileName: String(r.data.fileName ?? 'sogaebank_my_data.json'), json: JSON.stringify(r.data, null, 2) };
}

/** SB-MYP-SEC-010 — 다른 기기의 로그인을 모두 풀고 이 기기는 새 증표로 */
export async function logoutAllDevices(password: string): Promise<ActResult> {
  const r = await call('POST', '/me/logout-all', { password }, true);
  if (r.status >= 400) return fail(r.data, '로그아웃하지 못했습니다.');
  const jar = await cookies();
  if (r.data?.accessToken && r.data?.refreshToken) await saveTokens(r.data.accessToken, r.data.refreshToken, jar.get('sgb_keep')?.value !== '0');
  return { ok: true, note: r.data?.note };
}

/** v10.380 (D241 · docs/516) — 내 로그인 기기 하나 로그아웃 · 지금 이 기기면 쿠키도 지움 */
export async function revokeSession(id: string): Promise<ActResult & { current?: boolean }> {
  const r = await call('POST', `/me/sessions/${encodeURIComponent(id)}/revoke`, {}, true);
  if (r.status >= 400) return fail(r.data, '로그아웃하지 못했습니다.');
  if (r.data?.current) await logout();
  return { ok: true, note: r.data?.note, current: !!r.data?.current };
}

/** SB-MYP-PRV-010 — 열람 · 정정 · 삭제 · 처리정지 요청 */
export async function createPrivacyRequest(kind: string, body: string): Promise<ActResult> {
  const r = await call('POST', '/me/privacy-requests', { kind, body }, true);
  if (r.status >= 400) return fail(r.data, '요청을 보내지 못했습니다.');
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

/** v10.376 (D240 · docs/511) — 탈퇴 유예 중 「탈퇴 취소」(이메일 · 비밀번호) — 성공하면 화면이 다시 로그인 */
export async function cancelWithdraw(email: string, password: string): Promise<{ ok: boolean; message?: string; note?: string }> {
  const r = await call('POST', '/auth/withdraw/cancel', { email, password }, false);
  return r.status === 200 ? { ok: true, note: r.data?.note } : { ok: false, message: r.data?.message ?? '탈퇴를 취소하지 못했습니다.' };
}

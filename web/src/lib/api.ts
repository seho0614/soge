/**
 * API 클라이언트.
 *
 * 서버 오류 규약을 그대로 타입으로 옮깁니다.
 *   409 상태 충돌 — 재시도 무의미
 *   422 정책 위반 — message 를 사용자에게 그대로 보여도 됩니다
 */
export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
}

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiError) {
    super(body.message);
  }
  /** 재시도해도 같은 결과입니다. 재시도 버튼을 띄우지 마십시오. */
  get isConflict() { return this.status === 409; }
  /** 형식은 맞으나 규칙이 막았습니다. message 를 그대로 보여 줍니다. */
  get isPolicy() { return this.status === 422; }
  /** 게이트 미충족. code 에 따라 유도 화면으로 보냅니다. */
  get isGate() { return this.status === 403; }
}

/* ── 로그인 토큰 (20260930) ─────────────────────────────────────────
 * ★ 전에는 setToken 을 부르는 곳이 **한 군데도 없었습니다.** 운영 BO 의
 *   모든 관리자 API 가 토큰 없이 나가 403 이었고, 화면은 전부 오류였습니다(실측).
 *
 *   탭을 닫으면 사라지도록 sessionStorage 에 둡니다 — 운영 권한이 담긴
 *   토큰을 브라우저에 오래 남기지 않습니다. access 가 만료되면 refresh 로
 *   한 번 다시 받고, 그것도 안 되면 로그인 화면으로 돌아갑니다. */
const AT_KEY = 'sgb_bo_at', RT_KEY = 'sgb_bo_rt';
const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => {
    try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* 저장 불가 환경 */ }
  },
};
let accessToken: string | null = ss.get(AT_KEY);
let refreshToken: string | null = ss.get(RT_KEY);
const listeners = new Set<(on: boolean) => void>();
export const onAuthChange = (f: (on: boolean) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const hasToken = () => !!accessToken;
export const setToken = (t: string | null, rt?: string | null) => {
  accessToken = t; ss.set(AT_KEY, t);
  if (rt !== undefined) { refreshToken = rt; ss.set(RT_KEY, rt); }
  listeners.forEach((f) => f(!!t));
};
/** JWT 본문의 역할. 서버가 최종 판단하므로 화면 분기용으로만 씁니다. */
export function tokenRoles(): string[] {
  try { return JSON.parse(atob(((accessToken ?? '').split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))).roles ?? []; }
  catch { return []; }
}
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch((import.meta.env.VITE_API_BASE ?? '/api/v1') + '/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => null);
  if (!res || !res.ok) { setToken(null, null); return false; }
  const b = await res.json();
  setToken(b.accessToken, b.refreshToken ?? refreshToken);
  return true;
}

/** 소개코드. 최초 유입은 ?ref= 로 오고, 이후 요청부터 헤더로 보냅니다 (INV-2) */
const VISITOR_KEY = 'sgb_visitor';
const REF_KEY = 'sgb_ref';

export function captureRef() {
  const url = new URL(window.location.href);
  const ref = url.searchParams.get('ref');
  if (ref) localStorage.setItem(REF_KEY, ref);
  if (!localStorage.getItem(VISITOR_KEY)) {
    localStorage.setItem(VISITOR_KEY, crypto.randomUUID());
  }
}
export const visitorKey = () => localStorage.getItem(VISITOR_KEY) ?? undefined;

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

export async function api<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const ref = localStorage.getItem(REF_KEY);
  if (ref) headers.set('X-Ref-Code', ref);

  // 결제·정산·코드 발급은 헤더가 없으면 서버가 422 로 거절합니다
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);

  const res = await fetch(BASE + path, { ...init, headers, credentials: 'include' });
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({
    code: 'PARSE_ERROR', message: '응답을 읽을 수 없습니다.',
  }));
  /* access 만료 → 서버는 비로그인으로 보고 UNAUTHENTICATED 를 줍니다. 한 번만 다시 받습니다. */
  if (res.status === 403 && (body as ApiError).code === 'UNAUTHENTICATED' && accessToken
      && !(init as { _retried?: boolean })._retried) {
    if (await tryRefresh()) return api<T>(path, { ...init, _retried: true } as typeof init);
  }
  if (!res.ok) throw new ApiFailure(res.status, body as ApiError);
  return body as T;
}

'use server';
/**
 * v10.592 · 593 (docs/734 · 735) 회원 2단계 인증 · 낯선 로그인 답 — 서버 액션
 *
 *   2단계 로그인 표(ticket)는 lib/session.ts post() 가 HttpOnly 쿠키 sgb_mfa_t(5분)에 넣음 — 브라우저 스크립트 · 주소창에 나오지 않음.
 *   memberMfaLogin 은 그 쿠키 + 번호로 POST /auth/mfa/member-login → 증표를 session.ts 와 같은 쿠키 이름 · 같은 설정으로 저장.
 *   (session.ts 의 saveTokens 는 'use server' 파일 안 비공개 함수라 같은 규칙을 여기 둠 — 쿠키 이름 · 수명이 바뀌면 둘 다)
 */
import { cookies, headers } from 'next/headers';

const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const TICKET = 'sgb_mfa_t';
const KEEP = 'sgb_mfa_k';

export type ScxAct = { ok: true; note?: string; backupCodes?: string[]; secret?: string; uri?: string; next?: string | null; reconsent?: boolean }
  | { ok: false; code: string; message: string };

async function fwd(extra: Record<string, string> = {}): Promise<Record<string, string>> {
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

async function call(method: string, path: string, body: unknown, withAuth: boolean): Promise<{ status: number; data: any }> {
  const extra: Record<string, string> = {};
  if (withAuth) {
    const at = (await cookies()).get('sgb_at')?.value;
    if (!at) return { status: 401, data: { code: 'UNAUTHENTICATED', message: '로그인이 풀렸습니다. 다시 로그인해 주십시오.' } };
    extra.Authorization = `Bearer ${at}`;
  }
  const res = await fetch(BASE + path, { method, headers: await fwd(extra), body: JSON.stringify(body ?? {}), cache: 'no-store' });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const fail = (d: any, fb: string): ScxAct => ({ ok: false, code: d?.code ?? 'UNKNOWN', message: d?.message ?? fb });

/** SB-HOM-SCX-010 — 2단계 로그인 */
export async function memberMfaLogin(code: string): Promise<ScxAct> {
  const jar = await cookies();
  const ticket = jar.get(TICKET)?.value;
  if (!ticket) return { ok: false, code: 'SEC2_TICKET_INVALID', message: '로그인 시간이 지났습니다. 다시 로그인해 주십시오.' };
  const r = await call('POST', '/auth/mfa/member-login', { ticket, code: String(code ?? '').trim() }, false);
  if (r.status >= 400 || !r.data?.accessToken) {
    if (r.data?.code === 'SEC2_TICKET_INVALID') { jar.delete(TICKET); jar.delete(KEEP); }
    return fail(r.data, '로그인하지 못했습니다.');
  }
  const keep = jar.get(KEEP)?.value !== '0';
  const prod = process.env.NODE_ENV === 'production';
  jar.delete(TICKET); jar.delete(KEEP);
  jar.delete('sgb_tc');
  jar.set('sgb_at', r.data.accessToken, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: 900 });
  jar.set('sgb_rt', r.data.refreshToken, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', ...(keep ? { maxAge: 60 * 60 * 24 * 14 } : {}) });
  if (keep) jar.delete('sgb_keep'); else jar.set('sgb_keep', '0', { httpOnly: true, secure: prod, sameSite: 'lax', path: '/' });
  return { ok: true };
}

/** 2단계 로그인 표가 아직 있는지(화면이 「다시 로그인」을 바로 보일지) */
export async function memberMfaPending(): Promise<boolean> {
  return !!(await cookies()).get(TICKET)?.value;
}

/* ── SB-MYP-SCX-010 나의공간 › 보안 「2단계 인증」 ─────────────────── */
export async function memberMfaSetup(): Promise<ScxAct> {
  const r = await call('POST', '/me/mfa/setup', {}, true);
  if (r.status >= 400) return fail(r.data, '등록을 시작하지 못했습니다.');
  return { ok: true, secret: r.data?.secret, uri: r.data?.uri };
}
export async function memberMfaEnable(code: string): Promise<ScxAct> {
  const r = await call('POST', '/me/mfa/enable', { code: String(code ?? '').trim() }, true);
  if (r.status >= 400) return fail(r.data, '켜지 못했습니다.');
  return { ok: true, note: r.data?.note, backupCodes: r.data?.backupCodes ?? [] };
}
export async function memberMfaDisable(password: string, code: string): Promise<ScxAct> {
  const r = await call('POST', '/me/mfa/disable', { password, code: String(code ?? '').trim() }, true);
  if (r.status >= 400) return fail(r.data, '끄지 못했습니다.');
  return { ok: true, note: r.data?.note };
}

/* ── SB-MYP-SCX-020 낯선 로그인 답 ─────────────────────────────── */
export async function answerLoginAlert(id: string, answer: 'ME' | 'NOT_ME'): Promise<ScxAct> {
  const r = await call('POST', `/me/login-alerts/${encodeURIComponent(id)}/answer`, { answer }, true);
  if (r.status >= 400) return fail(r.data, '처리하지 못했습니다.');
  return { ok: true, note: r.data?.note, next: r.data?.next ?? null };
}

import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { envInt, FetchLike, getPath } from '../../common/http-json';

/* ---------------------------------------------------------------------
 * v10.498 (D272 · docs/636) 간편 로그인 어댑터 — 외부 연동 SOCIAL(카카오 · 네이버)
 *
 *   OAuth 2.0 authorization code + state(서버가 만든 무작위 · 지문만 저장 · 10분 · 한 번) + PKCE(S256 · code_verifier 는 서버만)
 *   카카오   authorize https://kauth.kakao.com/oauth/authorize · token https://kauth.kakao.com/oauth/token(form) · 회원 https://kapi.kakao.com/v2/user/me
 *            client_id = KAKAO_LOGIN_CLIENT_ID(외부 연동 › 연동 키 · SOCIAL) — 비면 지도(MAP)의 KAKAO_REST_KEY 를 다시 씀(같은 카카오 앱일 때 · docs/636 3절)
 *            client_secret = KAKAO_LOGIN_SECRET(카카오 앱에서 Client Secret 을 켰을 때만 · 선택)
 *   네이버   authorize https://nid.naver.com/oauth2.0/authorize · token https://nid.naver.com/oauth2.0/token · 회원 https://openapi.naver.com/v1/nid/me
 *            NAVER_CLIENT_ID · NAVER_CLIENT_SECRET(둘 다 필요)
 *   받는 것  회원 번호(→ 지문만 저장) · 이메일(카카오는 is_email_verified · 네이버는 @naver.com 메일만 「확인된 이메일」로 봄) · 별명(가입 칸 미리 채우기)
 *            업체 접근 증표(access token)는 회원 정보를 읽은 뒤 버림(저장 · 기록하지 않음).
 *   간주     social.mode = ASSUME(점검판) — 업체를 부르지 않고 code 「ASSUME.<꼬리표>[.<이메일 base64url>]」를 회원으로 봄.
 *            운영 서버(NODE_ENV=production)에서는 간주 로그인을 받지 않음(SOCIAL_ASSUME_PROD).
 *   ★ 업체 주소 · 칸 이름은 2026-11 공개 문서 기준 — 운영 켜기 전 업체 문서로 다시 확인(docs/636 7절). 네이버는 PKCE 를 문서에 적지 않음(보내도 무시 · state + client_secret 로 막음).
 * ------------------------------------------------------------------- */

export type SocProvider = 'KAKAO' | 'NAVER';
export const SOC_PROVIDERS: SocProvider[] = ['KAKAO', 'NAVER'];
export const SOC_PATH_RE = /^(kakao|naver)$/;                         // 주소 조각(작은 글자)
export const SOC_REDIRECT_RE = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?\/login\/social\/(kakao|naver)\/callback$/;
export const SOC_ASSUME_RE = /^ASSUME\.([a-z0-9-]{4,40})(?:\.([A-Za-z0-9_-]{4,200}))?$/;

export interface SocProfile { id: string; email: string | null; emailVerified: boolean; name: string | null }
export type SocResult = { ok: true; profile: SocProfile } | { ok: false; code: string; detail?: string };

export const b64url = (n: number) => randomBytes(n).toString('base64url');
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** PKCE S256 — base64url(sha256(verifier)) */
export const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
/** 업체 회원 번호 지문 — 원래 번호는 어디에도 남기지 않음 */
export const subjectHash = (p: SocProvider, id: string) => sha(`soc|${p}|${id}`);
export const isProd = () => (process.env.NODE_ENV ?? 'development') === 'production';

const KAKAO = { auth: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', me: 'https://kapi.kakao.com/v2/user/me' };
const NAVER = { auth: 'https://nid.naver.com/oauth2.0/authorize', token: 'https://nid.naver.com/oauth2.0/token', me: 'https://openapi.naver.com/v1/nid/me' };

/** 카카오 client_id — 연동 키 KAKAO_LOGIN_CLIENT_ID → 지도(MAP) KAKAO_REST_KEY(운영 화면 값 → .env). 어디서 왔는지도 */
export async function kakaoClientId(db: DatabaseService): Promise<{ id: string | null; from: 'OWN' | 'MAP' | null }> {
  const own = process.env.KAKAO_LOGIN_CLIENT_ID?.trim();
  if (own) return { id: own, from: 'OWN' };
  const [r] = await db.query<{ v: string | null }>(`SELECT public.fn_integ_secret_get('MAP', 'KAKAO_REST_KEY') AS v`).catch(() => [] as Array<{ v: string | null }>);
  const map = r?.v?.trim() || process.env.KAKAO_REST_KEY?.trim() || null;
  return map ? { id: map, from: 'MAP' } : { id: null, from: null };
}

export async function socReady(db: DatabaseService) {
  const k = await kakaoClientId(db);
  return {
    KAKAO: { ready: !!k.id, clientFrom: k.from, secret: !!process.env.KAKAO_LOGIN_SECRET?.trim() },
    NAVER: { ready: !!(process.env.NAVER_CLIENT_ID?.trim() && process.env.NAVER_CLIENT_SECRET?.trim()), clientFrom: process.env.NAVER_CLIENT_ID?.trim() ? 'OWN' as const : null, secret: !!process.env.NAVER_CLIENT_SECRET?.trim() },
  };
}

/** 업체 로그인 화면 주소(LIVE) */
export async function authorizeUrl(db: DatabaseService, p: SocProvider, a: { state: string; verifier: string; redirectUri: string }): Promise<string | null> {
  const q = new URLSearchParams({ response_type: 'code', redirect_uri: a.redirectUri, state: a.state, code_challenge: challengeOf(a.verifier), code_challenge_method: 'S256' });
  if (p === 'KAKAO') {
    const c = await kakaoClientId(db);
    if (!c.id) return null;
    q.set('client_id', c.id);
    return `${KAKAO.auth}?${q.toString()}`;
  }
  const id = process.env.NAVER_CLIENT_ID?.trim();
  if (!id || !process.env.NAVER_CLIENT_SECRET?.trim()) return null;
  q.set('client_id', id);
  return `${NAVER.auth}?${q.toString()}`;
}

/** 간주(ASSUME) 회원 — 「ASSUME.<꼬리표>[.<이메일 base64url>]」 · 이메일이 있으면 확인된 것으로 봄(점검판 시험) */
export function assumeProfile(code: string): SocResult {
  const m = SOC_ASSUME_RE.exec(String(code ?? ''));
  if (!m) return { ok: false, code: 'SOCIAL_CODE_INVALID' };
  let email: string | null = null;
  if (m[2]) {
    try { email = Buffer.from(m[2], 'base64url').toString('utf8').trim().toLowerCase(); } catch { email = null; }
    if (!email || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(email)) return { ok: false, code: 'SOCIAL_CODE_INVALID' };
  }
  return { ok: true, profile: { id: `assume-${m[1]}`, email, emailVerified: !!email, name: `시험 ${m[1].slice(0, 12)}` } };
}

async function formPost(url: string, form: Record<string, string>, fetchFn?: FetchLike): Promise<{ ok: boolean; status: number; body: any; error?: string }> {
  const f = fetchFn ?? (fetch as unknown as FetchLike);
  try {
    const res = await f(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(envInt('SOCIAL_TIMEOUT_MS', 5000)),
    });
    const text = await res.text().catch(() => '');
    let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: res.ok, status: res.status, body, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, status: 0, body: null, error: e?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK' };
  }
}

async function bearerGet(url: string, token: string, fetchFn?: FetchLike): Promise<{ ok: boolean; status: number; body: any }> {
  const f = fetchFn ?? (fetch as unknown as FetchLike);
  try {
    const res = await f(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(envInt('SOCIAL_TIMEOUT_MS', 5000)) });
    const text = await res.text().catch(() => '');
    let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  } catch { return { ok: false, status: 0, body: null }; }
}

/** LIVE — code → 접근 증표 → 회원 정보(증표는 여기서 버림). 점검판에서는 부르지 않음 */
export async function exchangeAndFetch(db: DatabaseService, p: SocProvider, a: { code: string; state: string; verifier: string; redirectUri: string }, fetchFn?: FetchLike): Promise<SocResult> {
  let tok: { ok: boolean; status: number; body: any; error?: string };
  if (p === 'KAKAO') {
    const c = await kakaoClientId(db);
    if (!c.id) return { ok: false, code: 'SOCIAL_NOT_READY' };
    const form: Record<string, string> = { grant_type: 'authorization_code', client_id: c.id, redirect_uri: a.redirectUri, code: a.code, code_verifier: a.verifier };
    const sec = process.env.KAKAO_LOGIN_SECRET?.trim();
    if (sec) form.client_secret = sec;
    tok = await formPost(KAKAO.token, form, fetchFn);
  } else {
    const id = process.env.NAVER_CLIENT_ID?.trim(), sec = process.env.NAVER_CLIENT_SECRET?.trim();
    if (!id || !sec) return { ok: false, code: 'SOCIAL_NOT_READY' };
    tok = await formPost(NAVER.token, { grant_type: 'authorization_code', client_id: id, client_secret: sec, code: a.code, state: a.state, code_verifier: a.verifier }, fetchFn);
  }
  const access = String(getPath(tok.body, 'access_token') ?? '');
  if (!tok.ok || !access) return { ok: false, code: 'SOCIAL_TOKEN_FAIL', detail: tok.error ?? String(getPath(tok.body, 'error') ?? '').slice(0, 40) };
  const me = await bearerGet(p === 'KAKAO' ? KAKAO.me : NAVER.me, access, fetchFn);
  if (!me.ok || !me.body) return { ok: false, code: 'SOCIAL_PROFILE_FAIL', detail: `HTTP ${me.status}` };
  if (p === 'KAKAO') {
    const id = getPath(me.body, 'id');
    if (id === undefined || id === null || String(id) === '') return { ok: false, code: 'SOCIAL_PROFILE_FAIL' };
    const em = String(getPath(me.body, 'kakao_account.email') ?? '').trim().toLowerCase() || null;
    const verified = !!em && getPath(me.body, 'kakao_account.is_email_valid') === true && getPath(me.body, 'kakao_account.is_email_verified') === true;
    const nick = String(getPath(me.body, 'kakao_account.profile.nickname') ?? getPath(me.body, 'properties.nickname') ?? '').trim().slice(0, 40) || null;
    return { ok: true, profile: { id: String(id), email: em, emailVerified: verified, name: nick } };
  }
  if (String(getPath(me.body, 'resultcode') ?? '') !== '00') return { ok: false, code: 'SOCIAL_PROFILE_FAIL' };
  const id = String(getPath(me.body, 'response.id') ?? '').trim();
  if (!id) return { ok: false, code: 'SOCIAL_PROFILE_FAIL' };
  const em = String(getPath(me.body, 'response.email') ?? '').trim().toLowerCase() || null;
  const nm = String(getPath(me.body, 'response.nickname') ?? getPath(me.body, 'response.name') ?? '').trim().slice(0, 40) || null;
  return { ok: true, profile: { id, email: em, emailVerified: !!em && em.endsWith('@naver.com'), name: nm } };
}

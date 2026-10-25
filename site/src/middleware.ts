import { NextResponse, type NextRequest } from 'next/server';

/**
 * 두 가지를 합니다.
 *
 * ① 화면 요청 — access 쿠키(15분)가 없고 refresh 쿠키(14일)가 있으면 조용히 재발급합니다.
 *    서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없어 session.ts 의 me() 가 할 수 없는 일입니다.
 *
 * ② /api/* 요청 (20260930 추가) — 브라우저가 부르는 API 에 **로그인 토큰을 붙여** 넘깁니다.
 *
 *    ★ 전에는 /api 를 next.config 의 rewrite 로만 넘겼습니다. 토큰은 httpOnly 쿠키에만
 *      있고 API 는 Authorization 헤더만 봅니다 — 그래서 **브라우저에서 하는 로그인 필요 동작이
 *      전부 403** 이었습니다(실측: 로그인 후 fetch('/api/v1/me/summary') → 403).
 *      매물 등록 · 요청 등록 · 문의 · 사업자 등록 · 파트너 신청 등 27개 화면이 해당됩니다.
 *
 *    토큰을 자바스크립트에 내주지 않고(httpOnly 유지) 여기서만 붙입니다.
 *    쿠키 기반이 되므로 CSRF 를 막습니다 — 쓰기 요청은 같은 출처(Origin)만 받습니다.
 *    (쿠키도 SameSite=Lax 라 다른 사이트의 POST 에는 실리지 않습니다 — 이중 방어)
 */
const AT = 'sgb_at';
const RT = 'sgb_rt';
const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
/* /api/v1/… 를 넘길 곳. API_BASE 에서 /api/v1 을 뗀 값입니다 */
const ORIGIN = process.env.API_ORIGIN ?? BASE.replace(/\/api\/v1\/?$/, '');

async function refresh(rt: string) {
  try {
    const r = await fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
      cache: 'no-store',
    });
    if (r.ok) return (await r.json()) as { accessToken?: string; refreshToken?: string };
  } catch { /* API 가 죽어 있으면 비로그인으로 진행합니다 */ }
  return null;
}

/* v10.31 (w1) — 시안 로그인 「로그인 상태 유지」: 끄고 로그인하면 sgb_keep=0 이 남고, 다시 발급할 때도 브라우저를 닫으면 사라지는 쿠키로 둡니다 */
function setAuthCookies(res: NextResponse, at: string, rt: string, req?: NextRequest) {
  const prod = process.env.NODE_ENV === 'production';
  const keep = req?.cookies.get('sgb_keep')?.value !== '0';
  res.cookies.set(AT, at, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', maxAge: 900 });
  res.cookies.set(RT, rt, { httpOnly: true, secure: prod, sameSite: 'lax', path: '/', ...(keep ? { maxAge: 60 * 60 * 24 * 14 } : {}) });
}

/* 20261002 — 같은 출처 판정.
 * ★ 전에는 Origin 을 req.nextUrl.origin 과만 비교했습니다. 그런데 next 가 `-H 0.0.0.0` 으로 뜨면(Docker)
 *   nextUrl.origin 이 http://0.0.0.0:5174 가 되어, 브라우저(Origin http://localhost:5174)의 **모든 쓰기 요청이 403 CSRF**
 *   였습니다(docker compose 실구동 실측 — 광고 노출 · 클릭 기록 등). HTTPS 를 앞단(ALB · nginx)에서 끊는 운영도
 *   Origin https://도메인 ↔ nextUrl http://… 로 같은 문제가 납니다.
 *   이제 ① nextUrl.origin ② 요청의 Host(앞단이 넘긴 X-Forwarded-Host 우선) — 호스트:포트 비교 ③ SITE_ORIGINS(쉼표 목록) 중
 *   하나와 맞으면 같은 출처로 봅니다. 다른 사이트의 브라우저 요청은 Host 를 바꿀 수 없고(우리 서버 주소),
 *   X-Forwarded-Host 같은 임의 헤더는 사전 확인(preflight) 없이 실을 수 없으므로 방어는 그대로입니다. */
function sameSite(req: NextRequest, origin: string): boolean {
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (o.origin === req.nextUrl.origin) return true;
  const allow = (process.env.SITE_ORIGINS ?? '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean);
  if (allow.includes(o.origin)) return true;
  const host = ((req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0] ?? '').trim().toLowerCase();
  return host !== '' && o.host.toLowerCase() === host;
}

/* ── ③ 소개코드 유입 (D010 · 20261002) ───────────────────────────────
 * 화면 주소에 ?ref=코드 가 있으면 유입을 기록합니다(POST /attribution/touch).
 *
 * ★ 전에는 ?ref= 공유 링크가 **아무 일도 하지 않았습니다** — session.ts 의 captureRef 를 부르는 곳이 없고,
 *   매물 API 의 X-Ref-Code 헤더는 문서에만 있었습니다. 그래서 거래에 소개자가 붙을 수 없었습니다.
 *
 * · 방문자 쿠키(sgb_visitor)를 확보합니다(없으면 만듭니다). 로그인 · 가입 때 이 값으로 비로그인 유입이 계정에 이어집니다.
 * · 로그인 상태면 토큰을 함께 보내 계정도 남깁니다(재발급된 토큰 포함).
 * · 짧은 시간 제한(1.5초) — 기록이 실패해도 화면은 그대로 엽니다. 결과(recorded)는 보지 않습니다.
 * · sgb_ref 쿠키(90일 · lax)를 남깁니다.
 * · 링크 미리보기 로봇 · 중복(24시간) · 본인 코드는 API 가 걸러 냅니다(User-Agent 를 그대로 넘깁니다). */
const VISITOR = 'sgb_visitor';
const REF = 'sgb_ref';
const REF_RE = /^[A-Za-z0-9]{3,16}$/;
const VISITOR_RE = /^[A-Za-z0-9-]{8,64}$/;

async function withRef(req: NextRequest, res: NextResponse, at?: string): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get('ref');
  if (!raw || !REF_RE.test(raw) || req.method !== 'GET') return res;
  const code = raw.toUpperCase();

  let visitor = req.cookies.get(VISITOR)?.value;
  if (!visitor || !VISITOR_RE.test(visitor)) {
    visitor = crypto.randomUUID();
    res.cookies.set(VISITOR, visitor, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Visitor-Key': visitor,
    'User-Agent': req.headers.get('user-agent') ?? '',
  };
  if (at) headers.Authorization = `Bearer ${at}`;
  const referer = req.headers.get('referer');
  if (referer) headers.Referer = referer.slice(0, 500);
  const xff = req.headers.get('x-forwarded-for');
  if (xff) headers['X-Forwarded-For'] = xff;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    await fetch(BASE + '/attribution/touch', {
      method: 'POST', headers, cache: 'no-store', signal: ctl.signal,
      body: JSON.stringify({ code, landingUrl: (req.nextUrl.pathname + req.nextUrl.search).slice(0, 500) }),
    });
  } catch { /* 기록 실패 · 시간 초과 — 화면은 정상으로 엽니다 */ }
  finally { clearTimeout(timer); }

  // session.ts captureRef 와 같은 모양 — 방문자 쿠키처럼 비밀값이 아니라 secure 를 걸지 않습니다(http 개발 · Docker 에서도 남게)
  res.cookies.set(REF, code, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 90 });
  return res;
}

export async function middleware(req: NextRequest) {
  let at = req.cookies.get(AT)?.value;
  const rt = req.cookies.get(RT)?.value;

  /* ── ② API 프록시 ─────────────────────────────────────────────── */
  if (req.nextUrl.pathname.startsWith('/api/')) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.get('origin');
      if (origin && !sameSite(req, origin)) {
        return NextResponse.json({ code: 'CSRF', message: '다른 사이트에서 온 요청은 받지 않습니다.' }, { status: 403 });
      }
    }
    let fresh: { accessToken?: string; refreshToken?: string } | null = null;
    if (!at && rt) {
      fresh = await refresh(rt);
      at = fresh?.accessToken;
    }
    const headers = new Headers(req.headers);
    if (at && !headers.has('authorization')) headers.set('authorization', `Bearer ${at}`);
    /* ④ 「이건 어때?」 투표 (D021 · 20261002) — 비로그인도 투표합니다. 누가 투표했는지는 방문자 쿠키(sgb_visitor)로 가립니다.
     *    쿠키가 없으면 여기서 만들어 응답에 심고, 그 값을 X-Visitor-Key 로 API 에 넘깁니다.
     *    브라우저가 보낸 X-Visitor-Key 는 믿지 않고 **쿠키 값으로 덮어씁니다** — 헤더만 바꿔 여러 번 투표하지 못하게. */
    let newVisitor: string | null = null;
    /*    v10.105 (다국어 3-3) — 소개광장 「번역 보기」도 같은 방식(비회원 하루 횟수를 방문자 쿠키로 셈 · 머리말을 바꿔 한도를 피하지 못하게) */
    if (req.nextUrl.pathname.startsWith('/api/v1/community/polls') || /^\/api\/v1\/community\/posts\/[0-9a-f-]{36}\/translate$/i.test(req.nextUrl.pathname)) {
      let visitor = req.cookies.get(VISITOR)?.value;
      if (!visitor || !VISITOR_RE.test(visitor)) { visitor = crypto.randomUUID(); newVisitor = visitor; }
      headers.set('x-visitor-key', visitor);
    }
    /* ⑤ 제휴 링크 귀속 (v10.27 · G-190) — 소개몰 주문에 방문자 쿠키를 X-Visitor-Key 로 넘깁니다(제휴 링크를 누른 지 72시간 안이면 그 링크에 귀속).
     *    브라우저가 보낸 X-Visitor-Key 는 믿지 않고 쿠키 값으로 덮어씁니다. 쿠키가 없으면 머리말을 지웁니다(귀속 없음). */
    else if (req.nextUrl.pathname === '/api/v1/health/orders') {
      const visitor = req.cookies.get(VISITOR)?.value;
      if (visitor && VISITOR_RE.test(visitor)) headers.set('x-visitor-key', visitor); else headers.delete('x-visitor-key');
    }
    const target = new URL(req.nextUrl.pathname + req.nextUrl.search, ORIGIN);
    const res = NextResponse.rewrite(target, { request: { headers } });
    if (fresh?.accessToken && fresh.refreshToken) setAuthCookies(res, fresh.accessToken, fresh.refreshToken, req);
    if (newVisitor) res.cookies.set(VISITOR, newVisitor, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    return res;
  }

  /* ── ① 화면 ──────────────────────────────────────────────────── */
  if (at || !rt) {
    const gate = at ? await consentGate(req, at) : null;
    if (gate?.redirect) return gate.redirect;
    const res = NextResponse.next();
    if (gate?.ok) markConsentOk(res, gate.ok);
    return withRef(req, res, at);
  }

  const data = await refresh(rt);
  if (!data?.accessToken || !data.refreshToken) {
    // refresh 도 무효 — 정지·탈퇴 계정. 쿠키를 지워 로그인 화면으로 유도합니다
    const res = NextResponse.next();
    res.cookies.delete(RT);
    return withRef(req, res);
  }

  const gate = await consentGate(req, data.accessToken);
  if (gate?.redirect) { setAuthCookies(gate.redirect, data.accessToken, data.refreshToken, req); return gate.redirect; }
  // 이 요청의 서버 컴포넌트도 새 토큰을 보도록 request 쿠키를 바꿔 넘깁니다
  const headers = new Headers(req.headers);
  const cookie = req.cookies.getAll().filter((c) => c.name !== AT && c.name !== RT)
    .map((c) => `${c.name}=${c.value}`).concat([`${AT}=${data.accessToken}`, `${RT}=${data.refreshToken}`]).join('; ');
  headers.set('cookie', cookie);
  const res = NextResponse.next({ request: { headers } });
  setAuthCookies(res, data.accessToken, data.refreshToken, req);
  if (gate?.ok) markConsentOk(res, gate.ok);
  return withRef(req, res, data.accessToken);
}

/* ── ⑥ 약관 재동의 (v10.28 · 10/9 답 「로그인이 필요한 기능 전부를 동의 화면으로」) ─────────────────
 * 필수 약관의 새 판이 발행됐거나(D041 등) 약관 발행 전에 가입해 동의한 적이 없는 회원은, 로그인이 필요한 화면을 열면
 * 동의 화면(/terms/agree?next=…)으로 보냅니다. 둘러보기 · 약관 보기 · 로그아웃은 그대로 됩니다(이 목록에 없음).
 * · 확인은 GET /terms/required 로 서버에 묻습니다(동의 기록은 서버에만 있음). 서버가 답하지 않으면 막지 않습니다(1.5초).
 * · 「동의를 마침」은 5분 쿠키(sgb_tc = 계정 id)로 기억해 화면마다 묻지 않습니다. 계정이 바뀌면 다시 묻습니다 — 로그인 · 로그아웃이 지웁니다.
 * · 로그인 직후는 로그인 처리(session.login)가 같은 확인을 해 바로 동의 화면으로 보냅니다(다음 로그인 때 동의 받음 — 10/9 답). */
const TC = 'sgb_tc';
const GATED = [
  /^\/my(\/|$)/, /^\/partner(\/|$)/, /^\/partners(\/|$)/, /^\/deal\//, /^\/chat\//, /^\/health\/(cart|order)(\/|$)/,
  /^\/community\/write/, /^\/ai\/(match|profile)/, /^\/biz\//, /^\/register(\/|$)/, /^\/repair-inbox/, /^\/mall\/give\/pay/,
  /^\/mal\/brokers/, /^\/listings\/[^/]+\/edit/, /^\/verify(\/|$)/, /^\/report\//,
];

function jwtSub(token: string): string | null {
  try {
    const p = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')));
    return typeof json.sub === 'string' ? json.sub : null;
  } catch { return null; }
}

async function consentGate(req: NextRequest, token: string): Promise<{ redirect?: NextResponse; ok?: string } | null> {
  if (req.method !== 'GET' || !GATED.some((re) => re.test(req.nextUrl.pathname))) return null;
  const sub = jwtSub(token);
  if (!sub) return null;
  if (req.cookies.get(TC)?.value === sub) return null;
  try {
    const r = await fetch(BASE + '/terms/required', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const list = (await r.json()) as Array<{ isRequired?: boolean; agreed?: boolean }>;
    if (!Array.isArray(list)) return null;
    if (list.some((t) => t.isRequired && !t.agreed)) {
      const next = req.nextUrl.pathname + req.nextUrl.search;
      const url = new URL('/terms/agree', req.url);
      url.searchParams.set('next', next);
      return { redirect: NextResponse.redirect(url) };
    }
    return { ok: sub };
  } catch { return null; }
}

function markConsentOk(res: NextResponse, sub: string) {
  res.cookies.set(TC, sub, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 300 });
}

export const config = {
  // 정적 파일만 제외합니다. /api 는 ② 에서 토큰을 붙여 넘깁니다 (20260930)
  matcher: ['/((?!_next/|favicon.ico|.*\\.(?:png|jpg|svg|css|js|ico)$).*)'],
};

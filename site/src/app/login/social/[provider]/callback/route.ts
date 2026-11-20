import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { VISITOR_COOKIE } from '@/lib/api';
import { SOC_BIND, SOC_NEXT, SOC_TICKET, apiPost, clearSocCookie, safeNext, saveSession, setSocCookie, siteOrigin } from '@/lib/socialAuth';

/**
 * v10.498 (D272 · docs/636) 간편 로그인 돌아옴 — GET /login/social/{kakao|naver}/callback?code=…&state=…
 *   업체(간주면 우리 시작 처리기)가 보낸 code · state 를 묶음 쿠키와 함께 API 에(POST /auth/social/{p}/callback)
 *   LOGIN   → 증표 쿠키 저장 · 돌아갈 주소(sgb_sn)
 *   LINKED  → 내 정보 › 간편 로그인(?linked=1)
 *   PENDING → 이어서 표를 httpOnly 쿠키(sgb_st · 15분)로 · /login/social/continue(새로 가입 또는 기존 계정 연결)
 *   업체에서 취소(error=access_denied 등) · 실패 → 로그인 화면(?social_error=코드) · 연결이었으면 내 정보(?error=코드)
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const jar = await cookies();
  const binding = jar.get(SOC_BIND)?.value ?? '';
  const next = safeNext(jar.get(SOC_NEXT)?.value) ?? '/';
  const linkFlow = next.startsWith('/my/account/social');
  const fail = (code: string) => {
    const u = new URL(linkFlow ? '/my/account/social' : '/login', req.url);
    u.searchParams.set(linkFlow ? 'error' : 'social_error', code.slice(0, 40));
    return NextResponse.redirect(u);
  };
  await clearSocCookie(SOC_BIND);
  await clearSocCookie(SOC_NEXT);
  if (!/^(kakao|naver)$/.test(provider)) return fail('SOCIAL_STATE_INVALID');
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code') ?? '', state = sp.get('state') ?? '';
  if (sp.get('error') || !code) return fail('SOCIAL_CANCELLED');
  if (!binding || !state) return fail('SOCIAL_STATE_INVALID');
  const visitorKey = jar.get(VISITOR_COOKIE)?.value;
  const r = await apiPost(`/auth/social/${provider}/callback`, {
    code, state, binding, redirectUri: `${siteOrigin(req.nextUrl.origin)}/login/social/${provider}/callback`,
    ...(visitorKey && /^[A-Za-z0-9-]{8,64}$/.test(visitorKey) ? { visitorKey } : {}),
  });
  if (r.status >= 400) return fail(String(r.data?.code ?? 'SOCIAL_FAIL'));
  const d = r.data ?? {};
  if (d.result === 'LOGIN' && d.accessToken && d.refreshToken) {
    await saveSession(d.accessToken, d.refreshToken);
    return NextResponse.redirect(new URL(next, req.url));
  }
  if (d.result === 'LINKED') return NextResponse.redirect(new URL('/my/account/social?linked=1', req.url));
  if (d.result === 'PENDING' && typeof d.ticket === 'string') {
    await setSocCookie(SOC_TICKET, d.ticket, 900);
    await setSocCookie(SOC_NEXT, next, 900);
    return NextResponse.redirect(new URL('/login/social/continue', req.url));
  }
  return fail('SOCIAL_FAIL');
}

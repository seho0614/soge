import { NextResponse, type NextRequest } from 'next/server';
import { SOC_BIND, SOC_NEXT, apiPost, randomToken, safeNext, setSocCookie, siteOrigin } from '@/lib/socialAuth';

/**
 * v10.498 (D272 · docs/636) 간편 로그인 시작 — GET /login/social/{kakao|naver}?next=…(&mode=link)
 *   ① 이 브라우저 묶음 값(무작위)을 httpOnly 쿠키(sgb_sb · /login/social · 10분)로 두고 그 값을 API 에 보냄(API 는 지문만)
 *   ② API 가 state · PKCE 를 만들어 업체 로그인 주소를 돌려줌 → 302(간주면 바로 돌아올 주소)
 *   mode=link 는 로그인한 회원의 「연결」(POST /me/social/{p}/start · 증표 필요) — 돌아오면 내 정보 › 간편 로그인
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const link = req.nextUrl.searchParams.get('mode') === 'link';
  const back = link ? '/my/account/social' : '/login';
  if (!/^(kakao|naver)$/.test(provider)) return NextResponse.redirect(new URL(back, req.url));
  const next = safeNext(req.nextUrl.searchParams.get('next')) ?? (link ? '/my/account/social' : '/');
  const binding = randomToken(32);
  const redirectUri = `${siteOrigin(req.nextUrl.origin)}/login/social/${provider}/callback`;
  const r = await apiPost(link ? `/me/social/${provider}/start` : `/auth/social/${provider}/start`, { redirectUri, binding }, link);
  if (r.status === 401 && link) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent('/my/account/social')}`, req.url));
  const url = typeof r.data?.authorizeUrl === 'string' ? r.data.authorizeUrl : '';
  if (r.status >= 400 || !/^https?:\/\//.test(url)) {
    const u = new URL(back, req.url);
    u.searchParams.set(link ? 'error' : 'social_error', String(r.data?.code ?? 'SOCIAL_OFF').slice(0, 40));
    return NextResponse.redirect(u);
  }
  await setSocCookie(SOC_BIND, binding, 600);
  await setSocCookie(SOC_NEXT, next, 600);
  return NextResponse.redirect(url);
}

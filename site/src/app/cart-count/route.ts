import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * GET /cart-count — 머리줄의 「사람마다 다른 칸」: 로그인했는지(in) · 장바구니에 담긴 상품 가짓수(n). v10.23 · 두 관 전용 머리줄(components/b2/AuthArea)이 씁니다.
 *
 * 왜 API 를 브라우저에서 바로 부르지 않는가 — `GET /api/v1/me/health/cart` 는 로그인하지 않으면 403 이라,
 * 로그인하지 않은 사람의 **모든 화면에서 브라우저 오류 기록(Failed to load resource 403)** 이 남습니다(실측).
 * 여기서는 로그인 쿠키가 없으면 API 를 부르지 않고 { n: 0, in: false } 를 돌려줍니다 — 언제나 200 입니다.
 * 로그인 여부는 「쿠키가 있다」가 아니라 **API 가 그 토큰을 받아들였는지**로 봅니다(만료 · 정지된 계정은 false).
 * 토큰은 httpOnly 쿠키에만 있고(자바스크립트에 내주지 않음), 만료됐으면 미들웨어가 이 요청에서 다시 발급합니다.
 *
 * v10.29 — `?bell=1` 이면 장바구니 대신 **읽지 않은 알림 수(bell)** 를 돌려줍니다(소개장터 메인의 알림 종 · GET /me/summary).
 *   API 는 한 번만 부릅니다(장바구니 · 알림 중 하나). 로그인 여부를 보는 기준은 같습니다 — API 가 그 토큰을 받아들였는지.
 * v10.31 (w1) — 로그인했으면 장바구니 모드에서도 /me/summary 를 한 번 더 불러 읽지 않은 알림 수(bell) · 운영 역할 여부(ops)를 함께 돌려줍니다
 *   (소개광장 · 소개몰 머리줄의 🔔 · 「관리자 페이지」 — 시안 CMU 머리줄). 역할 이름 자체는 내보내지 않습니다.
 */
import { isOps } from '@/components/common/links';
const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const at = (await cookies()).get('sgb_at')?.value;
  let n = 0, loggedIn = false, ops = false, bell2 = 0;
  if (new URL(req.url).searchParams.get('bell') === '1') {
    let bell = 0;
    if (at) {
      try {
        const r = await fetch(BASE + '/me/summary', { headers: { Authorization: `Bearer ${at}` }, cache: 'no-store' });
        if (r.ok) {
          loggedIn = true;
          const j = (await r.json()) as { unreadNotifications?: number; principal?: { roles?: string[] } };
          const u = Number(j?.unreadNotifications);
          bell = Number.isFinite(u) && u >= 0 ? Math.floor(u) : 0;
          ops = isOps(j?.principal?.roles);
        }
      } catch { /* 숫자를 못 받아도 머리줄은 그대로 씁니다 */ }
    }
    return NextResponse.json({ n: 0, bell, in: loggedIn, ops }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (at) {
    try {
      const r = await fetch(BASE + '/me/health/cart', { headers: { Authorization: `Bearer ${at}` }, cache: 'no-store' });
      if (r.ok) {
        loggedIn = true;
        const j = (await r.json()) as { lines?: number; items?: unknown[] };
        const lines = Number(j?.lines);
        n = Number.isFinite(lines) && lines >= 0 ? lines : Array.isArray(j?.items) ? j.items.length : 0;
      }
    } catch { /* 숫자를 못 받아도 머리줄은 그대로 씁니다 */ }
    if (loggedIn) {
      try {
        const r = await fetch(BASE + '/me/summary', { headers: { Authorization: `Bearer ${at}` }, cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as { unreadNotifications?: number; principal?: { roles?: string[] } };
          const u = Number(j?.unreadNotifications);
          bell2 = Number.isFinite(u) && u >= 0 ? Math.floor(u) : 0;
          ops = isOps(j?.principal?.roles);
        }
      } catch { /* 없어도 됩니다 */ }
    }
  }
  return NextResponse.json({ n, in: loggedIn, bell: bell2, ops }, { headers: { 'Cache-Control': 'private, no-store' } });
}

'use client';
/**
 * 머리줄 오른쪽 끝 — 로그인 · 무료 회원가입(또는 나의공간 · 로그아웃) · 장바구니 숫자. v10.23 · 두 관 전용 머리줄(components/b2).
 *
 * 머리줄은 서버에서 한 번 그려 모든 사람에게 같은 것을 내보냅니다(쿠키를 읽지 않음 — 그래야 화면을 캐시할 수 있습니다).
 * 그래서 **사람마다 다른 이 칸만** 브라우저에서 따로 받습니다 — GET /cart-count (이 사이트의 길 · app/cart-count/route.ts).
 *   · 처음에는 로그인하지 않은 모양(로그인 · 무료 회원가입 · 0)으로 그리고, 답이 오면 바꿉니다.
 *   · 로그인했으면 「나의공간」 · 「로그아웃」 (10/7 사장님 확인 — 시안과 같게).
 *   · 화면을 옮길 때마다 다시 받습니다(로그인 화면을 거쳐 돌아온 경우).
 * 로그아웃은 서버 동작(lib/session.ts 의 logout — httpOnly 쿠키 두 개를 지움)입니다. 토큰을 자바스크립트에 내주지 않습니다.
 *
 * v10.29 — 소개장터 메인(/money)에서는 그 디자인대로 장바구니 자리에 **알림 종**을 놓습니다.
 *   · 숫자는 읽지 않은 알림 수입니다(GET /cart-count?bell=1 → bell). 로그인하지 않았거나 0 이면 숫자를 붙이지 않습니다 — 그림의 「1」은 견본이라 그대로 박아 넣지 않았습니다.
 *   · 누르면 알림 화면(/my/notifications) — 로그인하지 않았으면 그 화면이 로그인으로 보냅니다.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { logout } from '@/lib/session';
import { isMoneyMain } from '@/components/Chrome';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

export function AuthArea({ cartIcon, bellIcon }: { cartIcon: React.ReactNode; bellIcon?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const money = isMoneyMain(pathname) && !!bellIcon;
  const [st, setSt] = useState<{ in: boolean; n: number; bell: number; ops: boolean }>({ in: false, n: 0, bell: 0, ops: false });
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    fetch(money ? '/cart-count?bell=1' : '/cart-count', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setSt({ in: j.in === true, n: num(j.n), bell: num(j.bell), ops: j.ops === true }); })
      .catch(() => { /* 못 받아도 머리줄은 그대로 씁니다(로그인하지 않은 모양) */ });
    return () => { live = false; };
  }, [pathname, money]);

  function out() {
    start(async () => {
      await logout();
      setSt({ in: false, n: 0, bell: 0, ops: false });
      router.refresh();      // 로그인해야 보이는 화면(글쓰기 등)이면 서버가 로그인 화면으로 보냅니다
    });
  }

  return (
    <>
      {st.in ? (
        <>
          <Link className="b2-login" href="/my">나의공간</Link>
          <button type="button" className="b2-login b2-out" onClick={out} disabled={busy}>{busy ? '나가는 중…' : '로그아웃'}</button>
          {/* v10.31 — 시안 소개광장 머리줄(로그인 뒤): 🔔 · 관리자 페이지(운영 역할만 · → 운영 화면). 소개장터 메인은 아래 종을 그대로 씁니다 */}
          {!money && (
            <Link className="b2-ntf" href="/my/notifications" aria-label={st.bell > 0 ? `알림 — 읽지 않은 알림 ${st.bell}건` : '알림'} title="알림">
              🔔{st.bell > 0 && <span className="b2-belln" aria-hidden>{st.bell > 99 ? '99+' : st.bell}</span>}
            </Link>
          )}
          {st.ops && <a className="b2-join b2-adm" href="/go/admin">관리자 페이지</a>}
        </>
      ) : (
        <>
          <Link className="b2-login" href="/login">로그인</Link>
          <Link className="b2-join" href="/signup">무료 회원가입</Link>
        </>
      )}
      {money ? (
        <Link className="b2-bell" href="/my/notifications" aria-label={st.in && st.bell > 0 ? `알림 — 읽지 않은 알림 ${st.bell}건` : '알림'} data-bell={st.in ? st.bell : ''}>
          {bellIcon}
          {st.in && st.bell > 0 && <span className="b2-belln" aria-hidden>{st.bell > 99 ? '99+' : st.bell}</span>}
        </Link>
      ) : (
        <Link className="b2-cart" href="/health/cart" aria-label="소개몰 장바구니">
          {cartIcon}
          <span className="b2-cartn" aria-label={`장바구니에 담긴 상품 ${st.n}개`}>{st.n}</span>
        </Link>
      )}
    </>
  );
}

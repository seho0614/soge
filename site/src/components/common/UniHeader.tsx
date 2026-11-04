'use client';
/**
 * v10.188 (docs/294 · 대표 「머리줄 통일」 「지금 수정된 히어로의 머리줄로」 「승인」 2026-11-04) — 사이트 공통 머리줄 하나.
 *
 *   전에는 세 가지였습니다 — 메인(home/Frame HomeHeader · 큰 로고) · 두 관 + 소개장터 메인(b2/Frame B2Header · 큰 로고 · 관마다 가입 단추 색 · KR)
 *   · 그 밖의 화면(common/SiteHeader · 작은 네모 로고 · 파란 글자 고른 메뉴). 이제 메인 머리줄 모양 하나를 모든 화면이 씁니다
 *   (전용 상단바를 쓰는 /partner/** 는 그대로 — Chrome.tsx OWN_HEADER_PATHS).
 *
 *   왼쪽   큰 로고(메인 그림에서 잘라 낸 것 · home/Icons) → 메인
 *   가운데 관 메뉴(실제 /gwans — 주소가 있고 켜진 관) + 소개광장 + 이용안내 · **지금 있는 관에 주황 밑줄**(aria-current)
 *   오른쪽 검색(메인은 히어로 검색칸으로 · 그 밖은 검색 팝업) · 「파트너센터」(v10.187 B안 · 휴대폰 비로그인은 숨김) · 언어(다국어 켜짐일 때만 · lang)
 *          · 로그인 전: 로그인 · 무료 회원가입(남색 — 관 색 아님) / 로그인 뒤: 나의공간 · 🔔(읽지 않은 수) · 로그아웃 · 관리자 페이지(운영 역할만)
 *          · 소개몰 화면에서만 장바구니(숫자)
 *
 * 머리줄은 서버에서 모두에게 같은 것을 그리고, 사람마다 다른 칸(로그인 · 알림 · 장바구니)만 브라우저에서 GET /cart-count 로 받습니다
 * (b2/AuthArea 와 같은 방식 — 화면 캐시를 깨지 않음). 처음에는 로그인하지 않은 모양으로 그립니다.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Gwan } from '@/lib/types';
import { GWAN_PATH } from '@/lib/format';
import { isGwanKey } from '@/i18n/keys';
import { logout } from '@/lib/session';
import { clearDraft } from '@/lib/profileDraft';
import { FindButton } from '@/components/search/FindButton';
import { isShop } from '@/components/Chrome';
import { Line, Pic } from '@/components/home/Icons';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
const under = (p: string, base: string) => p === base || p.startsWith(base + '/');

export function UniHeader({ gwans, lang }: { gwans: Gwan[]; lang?: React.ReactNode }) {
  const h = useTranslations('header');
  const t = useTranslations('b2');
  const locale = useLocale();
  const p = usePathname() ?? '/';
  const router = useRouter();
  const shop = isShop(p);
  const [st, setSt] = useState<{ in: boolean; n: number; bell: number; ops: boolean }>({ in: false, n: 0, bell: 0, ops: false });
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    fetch('/cart-count', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setSt({ in: j.in === true, n: num(j.n), bell: num(j.bell), ops: j.ops === true }); })
      .catch(() => { /* 못 받아도 로그인하지 않은 모양으로 씁니다 */ });
    return () => { live = false; };
  }, [p]);

  function out() {
    start(async () => {
      clearDraft();   // v10.120 — 로그인 전 성향 답이 같은 탭의 다음 계정에 채워지지 않게(HdAuth · HomeLogout 과 같음)
      await logout();
      setSt({ in: false, n: 0, bell: 0, ops: false });
      router.refresh();
    });
  }

  /* 주소가 없는 관(허브 EARN 등)과 중지된 관은 뺍니다 — 전의 세 머리줄과 같은 규칙 · 한국어는 늘 서버 이름(다른 언어만 사전) */
  const menu = [
    ...gwans.filter((g) => g.isActive !== false && GWAN_PATH[g.code])
      .map((g) => ({ href: `/${GWAN_PATH[g.code]}`, label: locale !== 'ko' && isGwanKey(g.code) ? h(`gwan.${g.code}`) : g.name })),
    { href: '/community', label: h('community') },
    { href: '/guide', label: h('guide') },
  ];
  const cur = menu.find((m) => under(p, m.href))?.href;

  return (
    <header className="sh-hd" data-uni-header="">
      <div className="sh-in">
        {/* v10.190 (docs/297 · 대표 「로고 크기 줄이기」) — 높이 48 → 40px(휴대폰은 site-head.css 30px 그대로) */}
        <Link href="/" className="sh-logo" aria-label={h('logoHome')}><Pic name="logo" h={40} alt={h('brand')} /></Link>
        <nav className="sh-nav" aria-label={h('mainMenu')}>
          {menu.map((m) => (
            <Link key={m.href} href={m.href} className={m.href === cur ? 'on' : undefined} aria-current={m.href === cur ? 'page' : undefined}>{m.label}</Link>
          ))}
          {/* 휴대폰 — 단추 줄이 넘치지 않게 로그인한 사람의 「파트너센터」는 메뉴 줄 끝에(.m-only · PC 는 오른쪽 글자 링크) */}
          {st.in && <Link className="m-only" href="/partners">{h('partners')}</Link>}
        </nav>
        <div className="sh-hdr">
          {/* 메인은 히어로 검색칸(#home-q)으로 가서 그 팝업을 엽니다(HeroSearch) · 다른 화면은 같은 검색 팝업 */}
          {p === '/'
            ? <a className="sh-icbtn" href="#home-q" aria-label={h('search')}><Line name="search" size={22} w={2.4} /></a>
            : <FindButton className="sh-icbtn"><Line name="search" size={22} w={2.4} /></FindButton>}
          <Link className={`sh-txt${st.in ? '' : ' pc-only'}`} href="/partners" data-home-partners="">{h('partners')}</Link>
          {lang}
          {st.in ? (
            <>
              <Link className="sh-pill" href="/my">{h('my')}</Link>
              <Link className="sh-bell" href="/my/notifications" aria-label={st.bell > 0 ? t('bellUnread', { n: st.bell }) : t('bell')} title={t('bell')}>
                <span aria-hidden>🔔</span>{st.bell > 0 && <span className="sh-num" aria-hidden>{st.bell > 99 ? '99+' : st.bell}</span>}
              </Link>
              <button type="button" className="sh-pill" onClick={out} disabled={busy}>{busy ? h('loggingOut') : h('logout')}</button>
              {st.ops && <a className="sh-pill p" href="/go/admin">{h('admin')}</a>}
            </>
          ) : (
            <>
              <Link className="sh-pill" href="/login">{h('login')}</Link>
              <Link className="sh-pill p" href="/signup">{h('signup')}</Link>
            </>
          )}
          {shop && (
            <Link className="sh-cart" href="/health/cart" aria-label={t('cartCount', { n: st.n })}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 4h2.5l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 7H6.6" /><circle cx="9.5" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" />
              </svg>
              <span className="sh-num">{st.n}</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

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
 *          · v10.294 (docs/415) 로그인 뒤 최근 30일 안 펼친 공지가 있으면 📢 + 점 → 고객센터 › 공지사항
 *          · 소개몰 화면에서만 장바구니(숫자)
 *   v10.202 (docs/319 · 대표 「관리자 페이지 아이콘으로 · 안심소개 파트너 · 파트너센터 아이콘 · 소개몰 등록」 → 「승인」) — 641px 이상은 자격 있는 사람에게 동그란 아이콘
 *          (관리자 페이지 · 안심소개 파트너 · 파트너센터(제휴 활동 중) · 소개몰 입점(신청 받는 중 · 판매자면 판매자센터)) · 마우스를 올리면 이름(title) · 휴대폰은 메뉴 줄 끝 글자
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

/** v10.202 — 머리줄 자격 아이콘(선 굵기는 검색 아이콘과 같은 결 · 22px) */
const ROLE_ICON: Record<'admin' | 'mal' | 'aff' | 'shop', string[]> = {
  admin: ['M12 3l7 3v5c0 4.4-2.9 8.2-7 10-4.1-1.8-7-5.6-7-10V6z', 'M9 12l2 2 4-4'],
  mal: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M9.5 15.5l1.8 1.8 3.4-3.6'],
  aff: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M16.5 10a2.5 2.5 0 1 0 0-5', 'M2.5 20c.6-3.4 2.8-5.5 5.5-5.5s4.9 2.1 5.5 5.5', 'M15 14.6c2.6.1 4.6 2.1 5.2 5.4'],
  shop: ['M4 9l1.5-5h13L20 9', 'M4 9h16v1.5a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0 2.7 2.7 0 0 1-5.3 0z', 'M5.5 13v7h13v-7', 'M10 20v-4h4v4'],
};
function RoleIcon({ k }: { k: keyof typeof ROLE_ICON }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ROLE_ICON[k].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
type St = { in: boolean; n: number; bell: number; nt: number; ops: boolean; mal: boolean; aff: boolean; seller: boolean; tenant: boolean };
const ST0: St = { in: false, n: 0, bell: 0, nt: 0, ops: false, mal: false, aff: false, seller: false, tenant: false };

export function UniHeader({ gwans, lang }: { gwans: Gwan[]; lang?: React.ReactNode }) {
  const h = useTranslations('header');
  const t = useTranslations('b2');
  const locale = useLocale();
  const p = usePathname() ?? '/';
  const router = useRouter();
  const shop = isShop(p);
  const [st, setSt] = useState<St>(ST0);
  const [busy, start] = useTransition();
  /* v10.294 (docs/415) — 공지를 펼쳐 읽음이 기록되면(NoticeDetails · 창 이벤트 sgb:notice-read) 공지 점을 다시 셈 */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener('sgb:notice-read', on);
    return () => window.removeEventListener('sgb:notice-read', on);
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/cart-count', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setSt({ in: j.in === true, n: num(j.n), bell: num(j.bell), nt: num(j.nt), ops: j.ops === true, mal: j.mal === true, aff: j.aff === true, seller: j.seller === true, tenant: j.tenant === true }); })
      .catch(() => { /* 못 받아도 로그인하지 않은 모양으로 씁니다 */ });
    return () => { live = false; };
  }, [p, tick]);

  function out() {
    start(async () => {
      clearDraft();   // v10.120 — 로그인 전 성향 답이 같은 탭의 다음 계정에 채워지지 않게(HdAuth · HomeLogout 과 같음)
      await logout();
      setSt(ST0);
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
    <header className={`sh-hd${st.in ? ' in' : ''}`} data-uni-header="">
      <div className="sh-in">
        {/* v10.190 (docs/297 · 대표 「로고 크기 줄이기」) — 높이 48 → 40px(휴대폰은 site-head.css 30px 그대로) */}
        <Link href="/" className="sh-logo" aria-label={h('logoHome')}><Pic name="logo" h={40} alt={h('brand')} /></Link>
        <nav className="sh-nav" aria-label={h('mainMenu')}>
          {menu.map((m) => (
            <Link key={m.href} href={m.href} className={m.href === cur ? 'on' : undefined} aria-current={m.href === cur ? 'page' : undefined}>{m.label}</Link>
          ))}
          {/* 휴대폰 — 단추 줄이 넘치지 않게 로그인한 사람의 「파트너센터」는 메뉴 줄 끝에(.m-only · PC 는 오른쪽 글자 링크) */}
          {st.in && <Link className="m-only" href="/partners">{h('partners')}</Link>}
          {/* v10.202 — 휴대폰은 자격 아이콘 대신 메뉴 줄 끝 글자(641px 이상은 오른쪽 아이콘 · .m-role) */}
          {st.in && st.mal && <Link className="m-only m-role" href="/partner">{h('malPartner')}</Link>}
          {st.in && st.tenant && <Link className="m-only m-role" href={st.seller ? '/health/seller/center' : '/health/seller'}>{h(st.seller ? 'sellerCenter' : 'seller')}</Link>}
          {/* v10.190 (docs/297) — 휴대폰은 언어 칸도 메뉴 줄 끝에(첫 줄이 넘쳐 머리줄이 세 줄이 되던 것 · PC 는 오른쪽 그대로) */}
          {/* v10.190 (docs/297) — 운영 계정은 1440px 아래에서 「관리자 페이지」도 메뉴 줄 끝에(1280px 에서 메뉴가 밀리던 것 · 휴대폰 셋째 줄) */}
          {st.ops && <a className="m-only m-role" href="/go/admin">{h('admin')}</a>}
          {lang && <span className="m-lang">{lang}</span>}
        </nav>
        <div className="sh-hdr">
          {/* 메인은 히어로 검색칸(#home-q)으로 가서 그 팝업을 엽니다(HeroSearch) · 다른 화면은 같은 검색 팝업 */}
          {p === '/'
            ? <a className="sh-icbtn" href="#home-q" aria-label={h('search')}><Line name="search" size={22} w={2.4} /></a>
            : <FindButton className="sh-icbtn"><Line name="search" size={22} w={2.4} /></FindButton>}
          {st.in && st.aff
            ? <Link className="sh-icbtn sh-role" href="/partners" title={h('partners')} aria-label={h('partners')} data-home-partners="" data-role-icon="aff"><RoleIcon k="aff" /></Link>
            : <Link className={`sh-txt${st.in ? '' : ' pc-only'}`} href="/partners" data-home-partners="">{h('partners')}</Link>}
          {st.in && st.mal && <Link className="sh-icbtn sh-role" href="/partner" title={h('malPartner')} aria-label={h('malPartner')} data-role-icon="mal"><RoleIcon k="mal" /></Link>}
          {st.in && st.tenant && (
            <Link className="sh-icbtn sh-role" href={st.seller ? '/health/seller/center' : '/health/seller'} title={h(st.seller ? 'sellerCenter' : 'seller')}
              aria-label={h(st.seller ? 'sellerCenter' : 'seller')} data-role-icon="shop"><RoleIcon k="shop" /></Link>
          )}
          {st.ops && <a className="sh-icbtn sh-role sh-adm" href="/go/admin" title={h('admin')} aria-label={h('admin')} data-role-icon="admin"><RoleIcon k="admin" /></a>}
          {lang}
          {st.in ? (
            <>
              <Link className="sh-pill" href="/my">{h('my')}</Link>
              {/* v10.294 (docs/415) — 최근 30일 안 펼친 공지가 있을 때만 📢 + 점(고객센터 › 공지사항) */}
              {st.nt > 0 && (
                <Link className="sh-bell sh-ntc" href="/support/notices" aria-label={h('noticeNew', { n: st.nt })} title={h('noticeNew', { n: st.nt })} data-notice-dot={st.nt}>
                  <span aria-hidden>📢</span><span className="sh-dot" aria-hidden />
                </Link>
              )}
              <Link className="sh-bell" href="/my/notifications" aria-label={st.bell > 0 ? t('bellUnread', { n: st.bell }) : t('bell')} title={t('bell')}>
                <span aria-hidden>🔔</span>{st.bell > 0 && <span className="sh-num" aria-hidden>{st.bell > 99 ? '99+' : st.bell}</span>}
              </Link>
              <button type="button" className="sh-pill" onClick={out} disabled={busy}>{busy ? h('loggingOut') : h('logout')}</button>
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

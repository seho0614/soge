'use client';
/**
 * v10.29 — 제휴 파트너스(/partners/**) 틀의 주소에 따라 바뀌는 부분 — 시안 p2Shell · scP2Dsh
 *
 *   P2Menu  왼쪽 남색 메뉴(시안 PTC2NAV 순서 · SVG 아이콘 그대로). 켜진 칸은 흰 바탕 + 파랑 네모 아이콘.
 *   P2Hero  인사 띠 — 대시보드는 시안 사진(public/proto-img/partner/p2-hero.png) + 남색 글귀 칸,
 *           다른 화면은 시안 p2Shell 처럼 사진 자리를 파랑 그러데이션으로 둡니다.
 *   P2Body  대시보드는 칸들을 그대로, 다른 화면은 흰 본문 상자(.p2body) 안에.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* 시안 P2ICON — 선 두께 · 모양 그대로 */
const ICON: Record<string, React.ReactNode> = {
  dsh: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  rec: <><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></>,
  lnk: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  rev: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  ord: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  stl: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20" /></>,
  mkt: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  ntc: <path d="M3 11l18-8-8 18-2-8-8-2z" />,
  qna: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  gde: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
};

/* 시안 PTC2NAV 순서 그대로 — 화면마다 메뉴 자리가 같아야 찾지 않습니다. */
const MENU: Array<[string, string, string]> = [
  ['/partners', '대시보드', 'dsh'],
  ['/partners/products', '추천상품', 'rec'],
  ['/partners/links', '내 소개링크', 'lnk'],
  ['/partners/revenues', '수익관리', 'rev'],
  ['/partners/orders', '주문/고객현황', 'ord'],
  ['/partners/settlements', '정산내역', 'stl'],
  ['/partners/materials', '마케팅자료실', 'mkt'],
  ['/partners/notices', '공지사항', 'ntc'],
  ['/partners/inquiries', '1:1 문의', 'qna'],
  ['/partners/guides', '파트너가이드', 'gde'],
];

export function P2Menu() {
  const path = usePathname() ?? '';
  return (
    <nav className="p2menu" aria-label="파트너센터 메뉴">
      {MENU.map(([href, t, ic]) => {
        const on = href === '/partners' ? path === '/partners' : path === href || path.startsWith(href + '/');
        return (
          <Link key={href} href={href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>
            {on ? (
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">{ICON[ic]}</svg></span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{ICON[ic]}</svg>
            )}
            {t}
          </Link>
        );
      })}
    </nav>
  );
}

export function P2Hero({ name }: { name: string }) {
  const dash = (usePathname() ?? '') === '/partners';
  return (
    <div className={`p2hero${dash ? ' dash' : ''}`}>
      <div className="p2herotx">
        <div className="h1">{name}</div>
        <div className="h1">오늘도 수익을 만들어보세요 <span style={{ fontSize: 20 }} aria-hidden>💙</span></div>
        <p>좋은 제품을 소개하는 당신이, 더 많은 사람에게 좋은 변화를 만듭니다.<br />소개뱅크 PARTNERS가 항상 함께합니다.</p>
      </div>
      {dash ? (
        <>
          <div className="p2heroimg photo">
            {/* 시안의 사진 그대로(다시 압축하지 않음) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proto-img/partner/p2-hero.png" alt="" />
          </div>
          <div className="p2herotag">
            <div className="t">소개하는<br />당신이<br />특별합니다.</div>
            <div className="ln" />
            <div className="s">PARTNER<br />TODAY<br />A BETTER<br />TOMORROW</div>
          </div>
        </>
      ) : <div className="p2heroimg" />}
    </div>
  );
}

export function P2Body({ children }: { children: React.ReactNode }) {
  const dash = (usePathname() ?? '') === '/partners';
  return dash ? <div className="p2dash">{children}</div> : <div className="p2body">{children}</div>;
}

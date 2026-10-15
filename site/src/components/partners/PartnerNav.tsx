'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* 시안 PTC2NAV 순서 그대로 — 화면마다 메뉴 자리가 같아야 찾지 않습니다. */
export const PARTNER_MENU = [
  { href: '/partners',             t: '대시보드' },
  { href: '/partners/products',    t: '추천상품' },
  { href: '/partners/links',       t: '내 소개링크' },
  { href: '/partners/revenues',    t: '수익관리' },
  { href: '/partners/orders',      t: '주문/고객현황' },
  { href: '/partners/settlements', t: '정산내역' },
  { href: '/partners/materials',   t: '마케팅자료실' },
  { href: '/partners/notices',     t: '공지사항' },
  { href: '/partners/inquiries',   t: '1:1 문의' },
  { href: '/partners/guides',      t: '파트너가이드' },
] as const;

/** 파트너센터 좌측(모바일은 상단 가로) 메뉴 */
export function PartnerNav() {
  const path = usePathname() ?? '';
  return (
    <nav className="p2menu" aria-label="파트너센터 메뉴">
      {PARTNER_MENU.map((m) => {
        const on = m.href === '/partners' ? path === '/partners' : path.startsWith(m.href);
        return (
          <Link key={m.href} href={m.href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>
            {m.t}
          </Link>
        );
      })}
      {/* ★ 파트너 화면에서 소개뱅크로 돌아갈 길 — 시안과 같은 자리(메뉴 끝) */}
      <Link href="/" className="p2back">← 소개뱅크로 가기</Link>
    </nav>
  );
}

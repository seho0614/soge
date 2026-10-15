'use client';
/** 머리줄 메뉴 한 칸 — 지금 화면이 그 메뉴 아래면 aria-current="page"(남색 글자 · 주황 밑줄). 주소만 봅니다. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const p = usePathname() ?? '';
  /* 소개몰의 「내 주문 · 배송지 · 반품」은 주소가 /my/health… 입니다 — 그 화면에서도 「소개몰」에 표시합니다 */
  const on = p === href || p.startsWith(href + '/') || (href === '/health' && (p === '/my/health' || p.startsWith('/my/health/')));
  return <Link href={href} aria-current={on ? 'page' : undefined}>{children}</Link>;
}

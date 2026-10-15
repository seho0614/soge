'use client';
/**
 * v10.29 — 머리줄 가운데 메뉴(시안 .gnb). 지금 있는 관을 파랑 · 굵게(.on) 표시하는 일만 브라우저에서 합니다.
 * 좁은 화면(760px 아래)에서는 시안이 오른쪽 글자 링크를 숨기므로, 개발에만 있던 「소개받기 · 파트너센터 · 나의공간」을 메뉴 줄 끝에 붙입니다(.m-only).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const under = (p: string, href: string) => p === href || p.startsWith(href + '/');

export function HdNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const p = usePathname() ?? '';
  return (
    <nav className="pc-gnb" aria-label="주 메뉴">
      {items.map((m) => {
        const on = under(p, m.href);
        return <Link key={m.href + m.label} href={m.href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>{m.label}</Link>;
      })}
      <Link href="/request" className="m-only">소개받기</Link>
      <Link href="/partners" className="m-only">파트너센터</Link>
      <Link href="/my" className="m-only">나의공간</Link>
    </nav>
  );
}

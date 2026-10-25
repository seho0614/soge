'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

/* t = 사전 affiliate.menu.<키> (v10.100 다국어 2-5a)
 * 시안 PTC2NAV 순서 그대로 — 화면마다 메뉴 자리가 같아야 찾지 않습니다. */
export const PARTNER_MENU = [
  { href: '/partners',             t: 'dashboard' },
  { href: '/partners/products',    t: 'products' },
  { href: '/partners/links',       t: 'links' },
  { href: '/partners/revenues',    t: 'revenues' },
  { href: '/partners/orders',      t: 'orders' },
  { href: '/partners/settlements', t: 'settlements' },
  { href: '/partners/materials',   t: 'materials' },
  { href: '/partners/notices',     t: 'notices' },
  { href: '/partners/inquiries',   t: 'inquiries' },
  { href: '/partners/guides',      t: 'guides' },
] as const;

/** 파트너센터 좌측(모바일은 상단 가로) 메뉴 */
export function PartnerNav() {
  const path = usePathname() ?? '';
  const t = useTranslations('affiliate.menu');
  return (
    <nav className="p2menu" aria-label={t('aria')}>
      {PARTNER_MENU.map((m) => {
        const on = m.href === '/partners' ? path === '/partners' : path.startsWith(m.href);
        return (
          <Link key={m.href} href={m.href} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined}>
            {t(m.t)}
          </Link>
        );
      })}
      {/* ★ 파트너 화면에서 소개뱅크로 돌아갈 길 — 시안과 같은 자리(메뉴 끝) */}
      <Link href="/" className="p2back">{t('back')}</Link>
    </nav>
  );
}

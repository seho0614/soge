'use client';
/**
 * v10.29 — 나의공간 공통 틀 (시안 myShell() · myNav() — proto_lite.html).
 *
 *   ← ○○(으)로 돌아가기
 *   ┌ 나의공간 ─────┐ ┌ 화면 머리(제목 · 설명 · 오른쪽 단추) ─────────┐
 *   │ 메뉴 14 + 건수 │ │ 내용                                         │
 *   │ 계정 2         │ │                                              │
 *   └────────────────┘ └──────────────────────────────────────────────┘
 *
 * 메뉴 항목 · 순서는 시안 D.my.menu(9) + counts() 가 덧붙이는 5개 + 「계정」 2개 그대로입니다.
 * 건수는 서버(GET /me/home)가 주는 본인 숫자만 씁니다 — 시안처럼 6개 항목(리스팅 · 소개 내역 · 계약 · 문의 · 정산 · 관심).
 * 숫자가 0 이면 시안처럼 비워 둡니다. 숫자를 지어내지 않습니다.
 *
 * ★ 이 틀을 씌우지 않는 곳: /my/health/**(소개몰 주문 — 소개몰 시안 틀) · /my/broker/**(중개사 인증 — 관 묶음).
 * 레이아웃(app/my/layout.tsx)은 주소를 모르므로 여기(usePathname)서 고릅니다.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BackBar } from '@/components/common/BackBar';
import { useTranslations } from 'next-intl';
import type { KO } from '@/i18n/messages';

/** v10.99 — 메뉴 · 돌아가기 이름은 사전 키(my.shell.menu.*)로 둡니다(docs/157) */
type MenuKey = keyof typeof KO.my.shell.menu;

export type MyCounts = Partial<Record<'listings' | 'allDeals' | 'contracts' | 'conversations' | 'settlePending' | 'favorites', number | null>>;

interface Item { key: string; label: MenuKey; href: string; count?: keyof MyCounts; match?: (p: string) => boolean }

const under = (p: string, base: string) => p === base || p.startsWith(base + '/');

/** 시안 순서 그대로 (D.my.menu → counts() 의 push 5개) */
export const MY_MENU: Item[] = [
  { key: 'mylst',  label: 'listings', href: '/my/listings',      count: 'listings' },
  { key: 'mydeal', label: 'deals',      href: '/my/deals',         count: 'allDeals' },
  { key: 'myctr',  label: 'contracts',      href: '/my/contracts',     count: 'contracts', match: (p) => under(p, '/my/contracts') || under(p, '/contracts/templates') },
  { key: 'ask',    label: 'inquiries',    href: '/my/inquiries',     count: 'conversations' },
  { key: 'mystl',  label: 'settlement',    href: '/my/settlement',    count: 'settlePending' },
  { key: 'mylik',  label: 'likes',      href: '/my/likes',         count: 'favorites' },
  { key: 'mysub',  label: 'subscription', href: '/my/subscription', match: (p) => p === '/my/subscription' || under(p, '/my/subscription/pay') },
  { key: 'aiprf',  label: 'aiProfile',      href: '/ai/profile' },
  { key: 'brkmy',  label: 'broker',    href: '/my/broker' },
  { key: 'mypaym', label: 'payment',      href: '/my/payment' },
  { key: 'myntf',  label: 'notifications',           href: '/my/notifications' },
  { key: 'mysubup', label: 'upgrade', href: '/my/subscription/upgrade' },
  { key: 'mybiz2', label: 'business',    href: '/my/business' },
  { key: 'introhome', label: 'intro',   href: '/my/intro' },
];

/** 이 주소들은 공통 틀을 씌우지 않습니다 */
const NO_SHELL = ['/my/health', '/my/broker'];

/** 돌아가기 줄 — 시안은 이력의 직전 화면, 실제 웹은 정해 둔 윗 화면(BackBar 방식) */
function backOf(p: string): { href: string; label: MenuKey } {
  if (p === '/my') return { href: '/', label: 'main' };
  if (under(p, '/my/settlement/history')) return { href: '/my/settlement', label: 'settlement' };
  if (p.startsWith('/my/intro/')) return { href: '/my/intro', label: 'intro' };
  if (p.startsWith('/my/contracts/')) return { href: '/my/contracts', label: 'contracts' };
  if (under(p, '/contracts/templates')) return { href: '/my/contracts', label: 'contracts' };
  if (p.startsWith('/my/inquiries/')) return { href: '/my/inquiries', label: 'inquiries' };
  if (p.startsWith('/my/subscription/')) return { href: '/my/subscription', label: 'subscription' };
  return { href: '/my', label: 'my' };
}

export function MyShell({ counts, children, active }: { counts: MyCounts | null; children: React.ReactNode; active?: string }) {
  const p = usePathname() ?? '/my';
  const t = useTranslations('my.shell');
  if (NO_SHELL.some((b) => under(p, b))) return <>{children}</>;
  const back = backOf(p);
  /* v10.32 (추가) — 넘겨받은 active(메뉴 key)가 있으면 그 항목을 켭니다(주소가 /my 밖인 화면 — 분쟁 접수 등) */
  const on = (m: Item) => (active ? active === m.key : m.match ? m.match(p) : under(p, m.href));
  const n = (m: Item) => {
    const v = m.count && counts ? counts[m.count] : null;
    return v ? <i>{Number(v).toLocaleString('ko-KR')}</i> : null;
  };

  return (
    <div className="mys" data-my-shell="">
      <BackBar href={back.href} label={t(`menu.${back.label}`)} />
      <div className="my-lay">
        <aside className="my-nav" aria-label={t('navAria')} data-my-nav="">
          <div className="my-mh">{t('menu.my')}</div>
          {MY_MENU.map((m) => (
            <Link key={m.key} href={m.href} className={on(m) ? 'on' : undefined} aria-current={on(m) ? 'page' : undefined} data-my-nav-item={m.key}>
              {t(`menu.${m.label}`)}{n(m)}
            </Link>
          ))}
          <div className="my-mh2">{t('account')}</div>
          <Link href="/my/account" className={under(p, '/my/account') ? 'on' : undefined} data-my-nav-item="myacc">{t('profile')}</Link>
          {/* 시안 v10.27 G-196 — 「설정 · 알림」은 알림 화면(수신 설정이 그 안에 있음) */}
          <Link href="/my/notifications#prefs" data-my-nav-item="myset">{t('settings')}</Link>
          {/* v10.31 (시안 결함 X2) — 시안에는 화면만 있고 들어갈 길이 없던 두 화면(내 신고 내역 · 내 이벤트 참여) */}
          <Link href="/my/reports" className={under(p, '/my/reports') ? 'on' : undefined} aria-current={under(p, '/my/reports') ? 'page' : undefined} data-my-nav-item="myrpt">{t('reports')}</Link>
          <Link href="/my/events" className={under(p, '/my/events') ? 'on' : undefined} aria-current={under(p, '/my/events') ? 'page' : undefined} data-my-nav-item="myevt">{t('events')}</Link>
        </aside>
        <div className="my-main">{children}</div>
      </div>
    </div>
  );
}

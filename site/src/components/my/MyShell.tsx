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
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { BackBar } from '@/components/common/BackBar';
import { useTranslations } from 'next-intl';
import type { KO } from '@/i18n/messages';

/** v10.99 — 메뉴 · 돌아가기 이름은 사전 키(my.shell.menu.*)로 둡니다(docs/157) */
type MenuKey = keyof typeof KO.my.shell.menu;
type GroupKey = keyof typeof KO.my.shell.groups;
type SubKey = keyof typeof KO.my.shell.sub;

export type MyCounts = Partial<Record<'listings' | 'allDeals' | 'contracts' | 'conversations' | 'settlePending' | 'favorites', number | null>>;

interface Sub { label: SubKey; href: string; match?: (p: string, h: string) => boolean }
interface Item { key: string; label: MenuKey; href: string; count?: keyof MyCounts; match?: (p: string) => boolean; subs?: Sub[] }
interface Group { key: string; label: GroupKey; items: Item[] }

const under = (p: string, base: string) => p === base || p.startsWith(base + '/');
const exact = (p: string, h: string) => p === (h.split('#')[0] ?? h);

/**
 * v10.256 (docs/388) — 나의공간 메뉴 3단계(대표 「같은 기능은 하나로 · 3단계 정도」 11/12)
 *   1단 대분류 5개 → 2단 메뉴 13개 → 3단 세부(그 메뉴를 열면 아래에 보임). 주소는 그대로 · data-my-nav-item 이름도 그대로.
 *   겹치던 것 — 「알림」 + 「설정 · 알림」 · 「구독 · 소개코드」 + 「한도 안내 · 요금제」 · 「소개 내역」 + 「소개 활동」 · 프로필 + 사업자 전환 + 중개사 인증.
 *   메뉴 밖이던 것 — 이행 보고 확인(/my/fulfillments) · 소개몰 주문 · 반품 · 배송지 · 추천 관계도(v10.253) · 정산 내역 한눈에(v10.255).
 */
export const MY_GROUPS: Group[] = [
  { key: 'deal', label: 'deal', items: [
    { key: 'mylst',  label: 'listings', href: '/my/listings', count: 'listings' },
    { key: 'mydeal', label: 'deals', href: '/my/deals', count: 'allDeals',
      match: (p) => under(p, '/my/deals') || (under(p, '/my/intro') && !under(p, '/my/intro/activity')) || under(p, '/my/fulfillments'),
      subs: [{ label: 'deals', href: '/my/deals' }, { label: 'intro', href: '/my/intro', match: exact }, { label: 'fulfill', href: '/my/fulfillments' }] },
    { key: 'myctr',  label: 'contracts', href: '/my/contracts', count: 'contracts', match: (p) => under(p, '/my/contracts') || under(p, '/contracts/templates'),
      subs: [{ label: 'myContracts', href: '/my/contracts' }, { label: 'templates', href: '/contracts/templates' }] },
    { key: 'ask',    label: 'inquiries', href: '/my/inquiries', count: 'conversations' },
    { key: 'mylik',  label: 'likes', href: '/my/likes', count: 'favorites' },
  ] },
  { key: 'money', label: 'money', items: [
    { key: 'mystl',  label: 'settlement', href: '/my/settlement/all', count: 'settlePending', match: (p) => under(p, '/my/settlement') || under(p, '/my/intro/activity'),
      subs: [{ label: 'settleAll', href: '/my/settlement/all' }, { label: 'settleIntro', href: '/my/settlement', match: exact },
             { label: 'settleHistory', href: '/my/settlement/history' }, { label: 'points', href: '/my/intro/activity' }] },
    { key: 'mysub',  label: 'subscription', href: '/my/subscription', match: (p) => under(p, '/my/subscription'),
      subs: [{ label: 'mySub', href: '/my/subscription', match: (p) => p === '/my/subscription' || under(p, '/my/subscription/pay') },
             { label: 'upgrade', href: '/my/subscription/upgrade' }] },
    { key: 'mypaym', label: 'payment', href: '/my/payment' },
  ] },
  { key: 'mall', label: 'mall', items: [
    { key: 'myhlt',  label: 'mallOrders', href: '/my/health/orders', match: (p) => under(p, '/my/health'),
      subs: [{ label: 'orders', href: '/my/health/orders' }, { label: 'returns', href: '/my/health/returns' }, { label: 'addresses', href: '/my/health/addresses' }] },
  ] },
  { key: 'rec', label: 'rec', items: [
    { key: 'myrcm',  label: 'recommend', href: '/my/recommend' },
  ] },
  { key: 'me', label: 'me', items: [
    { key: 'myacc',  label: 'profile', href: '/my/account',
      match: (p) => p === '/my/account' || under(p, '/my/business') || under(p, '/my/broker'),
      subs: [{ label: 'profile', href: '/my/account', match: exact }, { label: 'business', href: '/my/business' }, { label: 'broker', href: '/my/broker' }] },
    { key: 'myntf',  label: 'notifications', href: '/my/notifications', match: (p) => under(p, '/my/notifications') || under(p, '/ai/profile'),
      subs: [{ label: 'notifications', href: '/my/notifications', match: exact }, { label: 'prefs', href: '/my/notifications#prefs', match: () => false },
             { label: 'aiProfile', href: '/ai/profile' }] },
    { key: 'myprv',  label: 'privacy', href: '/my/account/security',
      match: (p) => under(p, '/my/account/security') || under(p, '/my/account/data') || under(p, '/my/account/privacy') || under(p, '/my/account/withdraw'),
      subs: [{ label: 'security', href: '/my/account/security' }, { label: 'data', href: '/my/account/data' },
             { label: 'privacyReq', href: '/my/account/privacy' }, { label: 'withdraw', href: '/my/account/withdraw' }] },
    { key: 'myrec',  label: 'records', href: '/my/reports', match: (p) => under(p, '/my/reports') || under(p, '/my/events'),
      subs: [{ label: 'reports', href: '/my/reports' }, { label: 'events', href: '/my/events' }] },
  ] },
];
/** 옛 이름(다른 화면이 import) — 2단 메뉴를 한 줄로 */
export const MY_MENU: Item[] = MY_GROUPS.flatMap((g) => g.items);

/** 이 주소들은 공통 틀을 씌우지 않습니다 */
const NO_SHELL = ['/my/health', '/my/broker'];

/** 돌아가기 줄 — 시안은 이력의 직전 화면, 실제 웹은 정해 둔 윗 화면(BackBar 방식) */
function backOf(p: string): { href: string; label: MenuKey } {
  if (p === '/my') return { href: '/', label: 'main' };
  if (under(p, '/my/settlement/history') || p === '/my/settlement') return { href: '/my/settlement/all', label: 'settlement' };
  if (p.startsWith('/my/intro/')) return { href: '/my/intro', label: 'intro' };
  if (p.startsWith('/my/contracts/')) return { href: '/my/contracts', label: 'contracts' };
  if (under(p, '/contracts/templates')) return { href: '/my/contracts', label: 'contracts' };
  if (p.startsWith('/my/inquiries/')) return { href: '/my/inquiries', label: 'inquiries' };
  if (p.startsWith('/my/subscription/')) return { href: '/my/subscription', label: 'subscription' };
  return { href: '/my', label: 'my' };
}

export function MyShell({ counts, children, active }: { counts: MyCounts | null; children: React.ReactNode; active?: string }) {
  const p = usePathname() ?? '/my';
  const [openG, setOpenG] = useState<string | null>(null);
  const t = useTranslations('my.shell');
  if (NO_SHELL.some((b) => under(p, b))) return <>{children}</>;
  const back = backOf(p);
  /* 좁은 화면 — 대분류를 누르면 펼침(넓은 화면은 모두 펼쳐 둠 · CSS) */
  /* v10.32 (추가) — 넘겨받은 active(메뉴 key)가 있으면 그 항목을 켭니다(주소가 /my 밖인 화면 — 분쟁 접수 등) */
  const on = (m: Item) => (active ? active === m.key : m.match ? m.match(p) : under(p, m.href));
  const n = (m: Item) => {
    const v = m.count && counts ? counts[m.count] : null;
    return v ? <i>{Number(v).toLocaleString('ko-KR')}</i> : null;
  };

  const groupOn = (g: Group) => g.items.some(on);
  return (
    <div className="mys" data-my-shell="">
      <BackBar href={back.href} label={t(`menu.${back.label}`)} />
      <div className="my-lay">
        <aside className="my-nav my-nav3" aria-label={t('navAria')} data-my-nav="">
          <div className="my-mh">{t('menu.my')}</div>
          {MY_GROUPS.map((g) => {
            const gOn = groupOn(g);
            return (
              <div key={g.key} className={`my-g${gOn ? ' on' : ''}${openG === g.key ? ' open' : ''}`} data-my-nav-group={g.key}>
                <button type="button" className="my-gh" aria-expanded={gOn || openG === g.key} onClick={() => setOpenG(openG === g.key ? null : g.key)}>{t(`groups.${g.label}`)}</button>
                <div className="my-gi">
                  {g.items.map((m) => (
                    <div key={m.key} className="my-it">
                      <Link href={m.href} className={on(m) ? 'on' : undefined} aria-current={on(m) ? 'page' : undefined} data-my-nav-item={m.key}>
                        {t(`menu.${m.label}`)}{n(m)}
                      </Link>
                      {m.subs && on(m) && (
                        <div className="my-sub" data-my-nav-sub={m.key}>
                          {m.subs.map((s) => {
                            const sOn = s.match ? s.match(p, s.href) : under(p, s.href.split('#')[0] ?? s.href);
                            return <Link key={s.href} href={s.href} className={sOn ? 'on' : undefined} aria-current={sOn ? 'page' : undefined} data-my-nav-subitem={s.label}>{t(`sub.${s.label}`)}</Link>;
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </aside>
        <div className="my-main">{children}</div>
      </div>
    </div>
  );
}

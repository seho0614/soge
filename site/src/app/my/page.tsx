import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import type { MyHome } from '@/components/my/MyFrame';
import { MyHead, Note } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.home'))('title') };
}

type Home = MyHome;

const bizNo = (s: string | null) => (s && /^\d{10}$/.test(s) ? `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}` : s ?? '');

/**
 * SB-MYP-DSH-010 나의공간 첫 화면.
 *
 * v10.27 (G-195) — 시안(scMy)처럼 프로필 한 줄 → 요약 4칸 → 바로가기(숫자) → 정산 안내 순서입니다.
 * v10.29 — 시안 배치 그대로: 왼쪽 「나의공간」 메뉴(공통 틀 app/my/layout.tsx) + 프로필 카드 · 숫자 4칸 · 바로가기.
 *   숫자 4칸(진행 중 소개 · 성사 · 정산 대기 · 누적 수익)은 모두 GET /me/home 이 본인 것만 셉니다 — 지어낸 값 없음.
 *   v10.31 — 시안의 「거래신용 812 · 활동지역」을 서버 값으로 그립니다(GET /me/home trustCredit · regions). 거래신용 = 소개 신뢰도(인증 ·
 *   초대 동의율 · 성사 · 거래 후기 · 인정된 신고 · 0~99)의 ×10, 활동지역 = 소개자 프로필 지역 → 없으면 내 매물 등록 지역. 지역이 없으면 「소개 활동」에서 등록하라고 잇습니다.
 *   바로가기는 시안 14칸(9 + 덧붙인 5) 순서 그대로, 그 뒤에 개발에만 있던 4칸(프로필 수정 · 소개몰 주문 · 취소 · 반품 · 배송지)을 남겨 둡니다.
 *   「지금 막혀 있는 단계」 안내(본인인증 → 사업자 → 구독)는 개발에만 있어 시안 안내 상자 모양으로 맨 위에 남깁니다.
 */
export default async function MyPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('my.home');
  const h = await apiGetPersonal<Home>('/me/home').catch(() => null);

  /* v10.37 (D095 · P2P) — 사업자 인증은 막힌 단계가 아닙니다(사업자로 소개비를 받을 때만) */
  const blocked: 'IDENTITY' | 'BUSINESS' | 'SUBSCRIPTION' | null = !p.identityVerifiedAt ? 'IDENTITY'
                : !p.hasActiveSubscription ? 'SUBSCRIPTION' : null;

  const NEXT = {
    IDENTITY:     { href: '/verify',          label: t('next.identity.label'),   why: t('next.identity.why') },
    BUSINESS:     { href: '/my/business',     label: t('next.business.label'), why: t('next.business.why') },
    SUBSCRIPTION: { href: '/my/subscription', label: t('next.subscription.label'),   why: t('next.subscription.why') },
  } as const;

  const n = (k: keyof Home) => (h ? Number(h[k] ?? 0) : null);
  /* 시안 D.my.summary — 성사 · 누적 수익은 지급 내역(mypay)으로, 정산 대기는 정산(mystl)으로.
     시안의 「진행 중 소개 → 내 등록 리스팅」은 엉뚱한 곳이라(시안 결함 · diffs) 소개 내역으로 보냅니다. */
  const tiles = [
    { t: t('tiles.open'), v: n('openDeals'),     u: t('unitCount'), href: '/my/deals' },
    { t: t('tiles.closed'),         v: n('closedDeals'),   u: t('unitCount'), href: '/my/settlement/history' },
    { t: t('tiles.pending'),    v: n('settlePending'), u: t('unitCount'), href: '/my/settlement' },
    { t: t('tiles.earned'),    v: n('earned'),        u: t('unitWon'), href: '/my/settlement/history' },
  ];
  const zero = !!h && tiles.every((x) => !x.v);

  const menus: { href: string; t: string; d: string; c?: number | null; dot?: boolean; dev?: boolean }[] = [
    /* 시안 D.my.menu 9칸 */
    { href: '/my/listings',     t: t('menu.listings.t'), d: t('menu.listings.d'), c: n('listings') },
    { href: '/my/deals',        t: t('menu.deals.t'),      d: t('menu.deals.d'), c: n('allDeals') },
    { href: '/my/contracts',    t: t('menu.contracts.t'),      d: t('menu.contracts.d'), c: n('contracts') },
    { href: '/my/inquiries',    t: t('menu.inquiries.t'),    d: t('menu.inquiries.d'), c: n('conversations'), dot: !!h && h.unreadMessages > 0 },
    { href: '/my/settlement',   t: t('menu.settlement.t'),    d: t('menu.settlement.d'), c: n('settlePending') },
    { href: '/my/likes',        t: t('menu.likes.t'),      d: t('menu.likes.d'), c: n('favorites') },
    { href: '/my/subscription', t: t('menu.subscription.t'), d: h?.planName ? t('menu.subscription.dPlan', { plan: h.planName }) : t('menu.subscription.d') },
    { href: '/ai/profile',      t: t('menu.aiProfile.t'),      d: t('menu.aiProfile.d') },
    { href: '/my/broker',       t: t('menu.broker.t'),    d: t('menu.broker.d') },
    /* 시안 counts() 가 덧붙이는 5칸 */
    { href: '/my/payment',      t: t('menu.payment.t'),      d: t('menu.payment.d') },
    { href: '/my/notifications', t: t('menu.notifications.t'),          d: t('menu.notifications.d'), c: n('unreadNotifications'), dot: !!h && h.unreadNotifications > 0 },
    { href: '/my/subscription/upgrade', t: t('menu.upgrade.t'), d: t('menu.upgrade.d') },
    { href: '/my/business',     t: t('menu.business.t'),    d: t('menu.business.d') },
    { href: '/my/intro',        t: t('menu.intro.t'),      d: t('menu.intro.d') },
    /* 개발에만 있던 바로가기 — 없애지 않고 뒤에 둡니다(diffs 마이-1) */
    { href: '/my/account',      t: t('menu.account.t'), d: t('menu.account.d'), dev: true },
    { href: '/my/health/orders', t: t('menu.orders.t'),   d: t('menu.orders.d'), dev: true },
    { href: '/my/health/returns', t: t('menu.returns.t'),  d: t('menu.returns.d'), dev: true },
    { href: '/my/health/addresses', t: t('menu.addresses.t'),     d: t('menu.addresses.d'), dev: true },
  ];

  return (
    <><div className="myhome" data-my-home>
      <MyHead title={t('title')} sub={t('sub')} />

      {blocked && (
        <Note kind="warn" className="act" data-my-blocked={blocked}>
          <div>
            <b>{NEXT[blocked].why}</b>
            <p>{t('blocked')}</p>
          </div>
          <Link className="my-bp" href={NEXT[blocked].href}>{NEXT[blocked].label}</Link>
        </Note>
      )}

      {h && (
        <div className="my-prof" data-my-prof>
          <div className="my-av" aria-hidden>{[...(h.name ?? '').trim()][0] ?? t('avatarFallback')}</div>
          <div className="my-pi">
            <b>{h.name}</b>{' '}
            {h.businessVerifiedAt ? <span className="my-bg ok">{t('badgeBiz')}</span>
              : h.identityVerifiedAt ? <span className="my-bg ok">{t('badgeId')}</span>
              : <span className="my-bg off">{t('badgeNone')}</span>}
            {h.companyName && <div className="my-ps">{h.companyName}{h.bizRegNo && t('bizRegNo', { no: bizNo(h.bizRegNo) })}</div>}
            <div className="my-ps" data-my-trust="">
              {h.trustCredit != null && <span title={t('trustTitle', { score: String(h.trustScore ?? ''), sample: String(h.trustSample ?? 0) })}>{t('trust', { n: h.trustCredit.toLocaleString('ko-KR') })}</span>}
              {t('regions')} {h.regions?.length ? h.regions.join(' · ') : <Link href="/my/intro#mine">{t('register')}</Link>} · {t('joined', { date: ymdKst(h.since) })}
              {h.planName && ` · ${h.planName}`}
            </div>
          </div>
          <Link className="my-bo" href="/my/account">{t('editProfile')}</Link>
        </div>
      )}

      {zero ? (
        <Note kind="info" data-my-zero><b>{t('zero.b')}</b> {t('zero.text')} <Link href="/register">{t('zero.link')}</Link></Note>
      ) : h && (
        <div className="my-tiles" data-my-tiles>
          {tiles.map((x) => (
            <Link key={x.t} className="my-tile" href={x.href}>
              <span className="my-tl">{x.t}</span>
              <b>{(x.v ?? 0).toLocaleString('ko-KR')}</b>
              <span className="my-tu">{x.u}</span>
            </Link>
          ))}
        </div>
      )}

      <h2 className="my-s2">{t('shortcuts')}</h2>
      <div className="my-mgrid" data-my-menu>
        {menus.map((m) => (
          <Link key={m.href} href={m.href} className="my-mcard" data-my-dev={m.dev ? '' : undefined}>
            <b>{m.t}{m.c ? <i> {m.c.toLocaleString('ko-KR')}</i> : null}{m.dot && <span className="my-dot" title={t('newDot')}>N</span>}</b>
            <span>{m.d}</span>
          </Link>
        ))}
      </div>

      {h && (
        <Note kind="info" data-my-settle-note>
          <b>{t('settle.b')}</b>{' '}
          {t(h.closedDeals > 0 ? 'settle.open' : 'settle.none', { n: h.closedDeals.toLocaleString('ko-KR') })}
        </Note>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import type { MyHome } from '@/components/my/MyFrame';
import { MyHead, Note } from '@/components/my/ui';

export const metadata: Metadata = { title: '나의공간' };

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
  const h = await apiGetPersonal<Home>('/me/home').catch(() => null);

  /* v10.37 (D095 · P2P) — 사업자 인증은 막힌 단계가 아닙니다(사업자로 소개비를 받을 때만) */
  const blocked: 'IDENTITY' | 'BUSINESS' | 'SUBSCRIPTION' | null = !p.identityVerifiedAt ? 'IDENTITY'
                : !p.hasActiveSubscription ? 'SUBSCRIPTION' : null;

  const NEXT = {
    IDENTITY:     { href: '/verify',          label: '본인인증하기',   why: '문의와 거래 참여에 필요합니다' },
    BUSINESS:     { href: '/my/business',     label: '사업자 전환하기', why: '사업자로 소개비(세금계산서)를 받을 때 필요합니다' },
    SUBSCRIPTION: { href: '/my/subscription', label: '구독 시작하기',   why: '소개코드 발급에 필요합니다 (INV-8)' },
  } as const;

  const n = (k: keyof Home) => (h ? Number(h[k] ?? 0) : null);
  /* 시안 D.my.summary — 성사 · 누적 수익은 지급 내역(mypay)으로, 정산 대기는 정산(mystl)으로.
     시안의 「진행 중 소개 → 내 등록 리스팅」은 엉뚱한 곳이라(시안 결함 · diffs) 소개 내역으로 보냅니다. */
  const tiles = [
    { t: '진행 중 소개', v: n('openDeals'),     u: '건', href: '/my/deals' },
    { t: '성사',         v: n('closedDeals'),   u: '건', href: '/my/settlement/history' },
    { t: '정산 대기',    v: n('settlePending'), u: '건', href: '/my/settlement' },
    { t: '누적 수익',    v: n('earned'),        u: '원', href: '/my/settlement/history' },
  ];
  const zero = !!h && tiles.every((x) => !x.v);

  const menus: { href: string; t: string; d: string; c?: number | null; dot?: boolean; dev?: boolean }[] = [
    /* 시안 D.my.menu 9칸 */
    { href: '/my/listings',     t: '내 등록 리스팅', d: '등록한 상품 · 서비스와 노출 상태', c: n('listings') },
    { href: '/my/deals',        t: '소개 내역',      d: '내가 소개한 건과 귀속 코드', c: n('allDeals') },
    { href: '/my/contracts',    t: '계약 진행',      d: '당사자끼리 계약을 맺고 있는 건', c: n('contracts') },
    { href: '/my/inquiries',    t: '문의 · 대화',    d: '진행 중인 1:1 대화', c: n('conversations'), dot: !!h && h.unreadMessages > 0 },
    { href: '/my/settlement',   t: '정산 · 지급',    d: '신청 가능한 건과 지급 내역', c: n('settlePending') },
    { href: '/my/likes',        t: '관심 목록',      d: '담아 둔 상품 · 서비스', c: n('favorites') },
    { href: '/my/subscription', t: '구독 · 소개코드', d: h?.planName ? `현재 요금제 ${h.planName}와 남은 코드` : '현재 요금제와 남은 코드' },
    { href: '/ai/profile',      t: '관심 성향',      d: '광고와 추천에 쓰이는 성향을 다시 진단합니다' },
    { href: '/my/broker',       t: '중개사 인증',    d: '부동산 소개를 등록하려면 인증이 먼저입니다' },
    /* 시안 counts() 가 덧붙이는 5칸 */
    { href: '/my/payment',      t: '결제 수단',      d: '정기결제에 쓰는 카드' },
    { href: '/my/notifications', t: '알림',          d: '거래 · 정산 · 검수 소식', c: n('unreadNotifications'), dot: !!h && h.unreadNotifications > 0 },
    { href: '/my/subscription/upgrade', t: '한도 안내 · 요금제', d: '열람 · 슬롯 한도와 요금제' },
    { href: '/my/business',     t: '사업자 전환',    d: '사업자로 소개비(세금계산서)를 받으려면' },
    { href: '/my/intro',        t: '소개 활동',      d: '초대 · 활동 · 포인트' },
    /* 개발에만 있던 바로가기 — 없애지 않고 뒤에 둡니다(diffs 마이-1) */
    { href: '/my/account',      t: '프로필 · 사업자 정보 수정', d: '이름 · 연락처 · 인증 전 사업자 정보', dev: true },
    { href: '/my/health/orders', t: '소개몰 주문',   d: '주문 · 결제 · 배송 조회', dev: true },
    { href: '/my/health/returns', t: '취소 · 반품',  d: '신청과 처리 결과', dev: true },
    { href: '/my/health/addresses', t: '배송지',     d: '소개몰 배송지 관리', dev: true },
  ];

  return (
    <><div className="myhome" data-my-home>
      <MyHead title="나의공간" sub="소개자가 자기 활동을 확인하는 자리입니다. 진행 중인 소개와 정산 대기가 여기서 한눈에 보입니다." />

      {blocked && (
        <Note kind="warn" className="act" data-my-blocked={blocked}>
          <div>
            <b>{NEXT[blocked].why}</b>
            <p>지금 이 단계에서 막혀 있습니다.</p>
          </div>
          <Link className="my-bp" href={NEXT[blocked].href}>{NEXT[blocked].label}</Link>
        </Note>
      )}

      {h && (
        <div className="my-prof" data-my-prof>
          <div className="my-av" aria-hidden>{[...(h.name ?? '').trim()][0] ?? '회'}</div>
          <div className="my-pi">
            <b>{h.name}</b>{' '}
            {h.businessVerifiedAt ? <span className="my-bg ok">사업자인증</span>
              : h.identityVerifiedAt ? <span className="my-bg ok">본인인증</span>
              : <span className="my-bg off">인증 전</span>}
            {h.companyName && <div className="my-ps">{h.companyName}{h.bizRegNo && ` · 사업자등록번호 ${bizNo(h.bizRegNo)}`}</div>}
            <div className="my-ps" data-my-trust="">
              {h.trustCredit != null && <span title={`소개 신뢰도 ${h.trustScore ?? ''}점 ×10 — 인증 · 초대 동의율 · 성사 · 거래 후기로 매깁니다. 표본 ${h.trustSample ?? 0}건`}>거래신용 {h.trustCredit.toLocaleString('ko-KR')} · </span>}
              활동지역 {h.regions?.length ? h.regions.join(' · ') : <Link href="/my/intro#mine">등록하기</Link>} · {ymdKst(h.since)} 가입
              {h.planName && ` · ${h.planName}`}
            </div>
          </div>
          <Link className="my-bo" href="/my/account">프로필 수정</Link>
        </div>
      )}

      {zero ? (
        <Note kind="info" data-my-zero><b>아직 활동이 없습니다.</b> 소개할 상품 · 서비스를 먼저 등록해 보세요. <Link href="/register">등록하기 ›</Link></Note>
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

      <h2 className="my-s2">바로가기</h2>
      <div className="my-mgrid" data-my-menu>
        {menus.map((m) => (
          <Link key={m.href} href={m.href} className="my-mcard" data-my-dev={m.dev ? '' : undefined}>
            <b>{m.t}{m.c ? <i> {m.c.toLocaleString('ko-KR')}</i> : null}{m.dot && <span className="my-dot" title="새 소식">N</span>}</b>
            <span>{m.d}</span>
          </Link>
        ))}
      </div>

      {h && (
        <Note kind="info" data-my-settle-note>
          <b>정산 메뉴는 성사 1건 이상일 때 쓰실 수 있습니다.</b>{' '}
          지금 성사 {h.closedDeals.toLocaleString('ko-KR')}건{h.closedDeals > 0 ? '이라 열려 있습니다.' : '이라 아직 신청할 건이 없습니다.'}
        </Note>
      )}
    </div><i hidden data-root-end="" /></>
  );
}

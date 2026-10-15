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

export type MyCounts = Partial<Record<'listings' | 'allDeals' | 'contracts' | 'conversations' | 'settlePending' | 'favorites', number | null>>;

interface Item { key: string; label: string; href: string; count?: keyof MyCounts; match?: (p: string) => boolean }

const under = (p: string, base: string) => p === base || p.startsWith(base + '/');

/** 시안 순서 그대로 (D.my.menu → counts() 의 push 5개) */
export const MY_MENU: Item[] = [
  { key: 'mylst',  label: '내 등록 리스팅', href: '/my/listings',      count: 'listings' },
  { key: 'mydeal', label: '소개 내역',      href: '/my/deals',         count: 'allDeals' },
  { key: 'myctr',  label: '계약 진행',      href: '/my/contracts',     count: 'contracts', match: (p) => under(p, '/my/contracts') || under(p, '/contracts/templates') },
  { key: 'ask',    label: '문의 · 대화',    href: '/my/inquiries',     count: 'conversations' },
  { key: 'mystl',  label: '정산 · 지급',    href: '/my/settlement',    count: 'settlePending' },
  { key: 'mylik',  label: '관심 목록',      href: '/my/likes',         count: 'favorites' },
  { key: 'mysub',  label: '구독 · 소개코드', href: '/my/subscription', match: (p) => p === '/my/subscription' || under(p, '/my/subscription/pay') },
  { key: 'aiprf',  label: '관심 성향',      href: '/ai/profile' },
  { key: 'brkmy',  label: '중개사 인증',    href: '/my/broker' },
  { key: 'mypaym', label: '결제 수단',      href: '/my/payment' },
  { key: 'myntf',  label: '알림',           href: '/my/notifications' },
  { key: 'mysubup', label: '한도 안내 · 요금제', href: '/my/subscription/upgrade' },
  { key: 'mybiz2', label: '사업자 전환',    href: '/my/business' },
  { key: 'introhome', label: '소개 활동',   href: '/my/intro' },
];

/** 이 주소들은 공통 틀을 씌우지 않습니다 */
const NO_SHELL = ['/my/health', '/my/broker'];

/** 돌아가기 줄 — 시안은 이력의 직전 화면, 실제 웹은 정해 둔 윗 화면(BackBar 방식) */
function backOf(p: string): { href: string; label: string } {
  if (p === '/my') return { href: '/', label: '메인' };
  if (under(p, '/my/settlement/history')) return { href: '/my/settlement', label: '정산 · 지급' };
  if (p.startsWith('/my/intro/')) return { href: '/my/intro', label: '소개 활동' };
  if (p.startsWith('/my/contracts/')) return { href: '/my/contracts', label: '계약 진행' };
  if (under(p, '/contracts/templates')) return { href: '/my/contracts', label: '계약 진행' };
  if (p.startsWith('/my/inquiries/')) return { href: '/my/inquiries', label: '문의 · 대화' };
  if (p.startsWith('/my/subscription/')) return { href: '/my/subscription', label: '구독 · 소개코드' };
  return { href: '/my', label: '나의공간' };
}

export function MyShell({ counts, children, active }: { counts: MyCounts | null; children: React.ReactNode; active?: string }) {
  const p = usePathname() ?? '/my';
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
      <BackBar href={back.href} label={back.label} />
      <div className="my-lay">
        <aside className="my-nav" aria-label="나의공간 메뉴" data-my-nav="">
          <div className="my-mh">나의공간</div>
          {MY_MENU.map((m) => (
            <Link key={m.key} href={m.href} className={on(m) ? 'on' : undefined} aria-current={on(m) ? 'page' : undefined} data-my-nav-item={m.key}>
              {m.label}{n(m)}
            </Link>
          ))}
          <div className="my-mh2">계정</div>
          <Link href="/my/account" className={under(p, '/my/account') ? 'on' : undefined} data-my-nav-item="myacc">프로필 · 사업자 정보</Link>
          {/* 시안 v10.27 G-196 — 「설정 · 알림」은 알림 화면(수신 설정이 그 안에 있음) */}
          <Link href="/my/notifications#prefs" data-my-nav-item="myset">설정 · 알림</Link>
          {/* v10.31 (시안 결함 X2) — 시안에는 화면만 있고 들어갈 길이 없던 두 화면(내 신고 내역 · 내 이벤트 참여) */}
          <Link href="/my/reports" className={under(p, '/my/reports') ? 'on' : undefined} aria-current={under(p, '/my/reports') ? 'page' : undefined} data-my-nav-item="myrpt">내 신고 내역</Link>
          <Link href="/my/events" className={under(p, '/my/events') ? 'on' : undefined} aria-current={under(p, '/my/events') ? 'page' : undefined} data-my-nav-item="myevt">내 이벤트 참여</Link>
        </aside>
        <div className="my-main">{children}</div>
      </div>
    </div>
  );
}

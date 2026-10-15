/**
 * v10.29 — 나의공간 공통 틀의 서버 쪽. 메뉴 건수를 GET /me/home 에서 한 번 받아 MyShell 에 넘깁니다.
 *
 * app/my/layout.tsx 가 씁니다. /contracts/templates/{code}(계약서 양식 전문 · 시안에서는 나의공간 「계약 진행」 안의 화면)도
 * 로그인한 사람에게는 같은 틀로 보입니다.
 * 로그인하지 않았으면 틀 없이 그대로 그립니다(각 화면이 로그인으로 보냅니다).
 */
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { MyShell, type MyCounts } from './MyShell';

export interface MyHome extends Required<MyCounts> {
  name: string; since: string; identityVerifiedAt: string | null;
  companyName: string | null; bizRegNo: string | null; businessVerifiedAt: string | null;
  openDeals: number; closedDeals: number; settlePending: number; earned: number;
  unreadMessages: number; unreadNotifications: number; planCode: string | null; planName: string | null;
  /** v10.31 — 거래신용(0~99 · 화면은 ×10 정수 trustCredit) · 활동지역 */
  trustScore?: number | null; trustCredit?: number | null; trustSample?: number;
  regions?: string[]; regionsBasis?: 'PROFILE' | 'LISTINGS' | null;
}

/** active — v10.32 (추가): /my 밖 화면이 켤 메뉴 항목(MY_MENU 의 key · 예 분쟁 접수 /support/dispute → 'mydeal' 「소개 내역」 · 시안 myShell("mydeal")) */
export async function MyFrame({ children, active }: { children: React.ReactNode; active?: string }) {
  const p = await me();
  if (!p) return <>{children}</>;
  const h = await apiGetPersonal<MyHome>('/me/home').catch(() => null);
  const counts: MyCounts | null = h && {
    listings: h.listings, allDeals: h.allDeals, contracts: h.contracts,
    conversations: h.conversations, settlePending: h.settlePending, favorites: h.favorites,
  };
  return <MyShell counts={counts} active={active}>{children}</MyShell>;
}

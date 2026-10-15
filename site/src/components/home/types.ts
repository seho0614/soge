/**
 * SB-HOM-MAIN-010 · SB-HOM-MAIN-011 메인 — 응답 모양.
 *
 * ★ 전부 curl 로 실측한 모양입니다 (2026-10-02, 개발 DB). API 가 바뀌면 여기부터 고치십시오.
 */

/** GET /ads/serve?slot=HERO — 소재가 없으면 { empty: true } */
export interface AdServe {
  empty: boolean;
  id?: string;
  code?: string;
  advertiser?: string;
  title?: string;
  body?: string;
  cta?: string | null;
  /** 시안 화면 키(예: reg) 또는 / 로 시작하는 경로. 대부분 null */
  landingRoute?: string | null;
  slot?: string;
  label?: string;
  matchedSegment?: string | null;
}

/** GET /requests?limit= — 소개받기(요청) 한 줄 */
export interface HomeRequest {
  id: string;
  gwanCode: string;
  title: string;
  categoryName: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  offeredFee: number | null;
  status: string;
  closesAt: string | null;
  statusLabel: string | null;
  proposalCount: number;
}

/** GET /me/summary */
export interface MeSummary {
  unreadNotifications: number;
  publishedListings: number;
  openDeals: number;
  /** v10.31 — 머리줄 「👤 이름」(인증 사업자면 회사명) · 운영 역할이면 「관리자 페이지」 */
  displayName?: string | null;
  principal?: { roles?: string[] } | null;
}

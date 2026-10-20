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

/** v10.49 (D103 · docs/101) GET /weather/today?region= — 메인 「오늘의 날씨」. available=false 면 띠를 그리지 않습니다 */
export interface WeatherToday {
  available: boolean;
  region: string;
  regionName: string;
  regions: { code: string; name: string }[];
  temp: number | null;
  label: string | null;
  icon: 'sun' | 'partly' | 'cloud' | 'rain' | 'sleet' | 'snow' | null;
  min: number | null;
  max: number | null;
  pop: number | null;
  humidity: number | null;
  observedAt: string | null;
  source: string;
}

/** 방문자가 고른 날씨 지역(시 · 도 코드)을 기억하는 쿠키 — 서버(page.tsx)와 브라우저(Weather.tsx)가 같이 씁니다.
 *  ★ 'use client' 파일에서 내보내면 서버 쪽에서 값이 아니라 참조가 되므로 이 파일에 둡니다 */
export const WX_COOKIE = 'sgb_wx';
export const WX_REGION_RE = /^[A-Z]{4,10}$/;

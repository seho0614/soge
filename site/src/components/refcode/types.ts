/** D010 — 소개코드 화면이 받는 API 응답 모양 (SB-MAL-DTL-010 · SB-MAL-GIV-010) */

/** GET /me/referral-codes/quota */
export interface RefQuota {
  /** 운영 설정 refcode.scope (D012) — listing: 매물마다 코드가 따로 · all: 매물에 묶지 않음 */
  scope?: 'listing' | 'all';
  subscribed: boolean;
  planCode: string;
  planName: string;
  freePlan: boolean;
  includedCodes: number;
  usedThisMonth: number;
  freeRemaining: number;
  extraCodePrice: number;
  identityVerified: boolean;
  countScope: 'CI' | 'ACCOUNT' | 'SUBSCRIPTION' | 'NONE';
  /** scope=listing: 그 매물의 내 코드(달과 무관) · scope=all: 이번 달 받은 코드 */
  current: { code: string; isExtra: boolean; issuedAt: string; listingId?: string | null } | null;
  listing?: { id: string; title: string; gwanCode: string } | null;
  /** 그 매물에 소개코드를 받을 수 없는 까닭 */
  blocked?: 'LISTING_NOT_PUBLISHED' | 'OWN_LISTING' | 'NO_INTRO_CATEGORY' | null;
  paymentRequired: boolean;
  paymentStub: boolean;
}

/** GET /me/referral-codes · POST /referral-codes 의 한 행 */
export interface RefCode {
  code: string;
  /** 이 코드가 소개하는 매물. null = 옛 코드 · scope=all 코드(모든 매물) */
  listingId?: string | null;
  listingTitle?: string | null;
  gwanCode?: string | null;
  listingStatus?: string | null;
  /** 발급 응답 — 그 매물에 이미 받은 코드를 그대로 돌려줌 */
  reused?: boolean;
  isExtra: boolean;
  issuedAt: string;
  revokedAt?: string | null;
  extraAmount?: number | null;
  paid?: boolean;
  paymentStub?: boolean | null;
  thisMonth?: boolean;
  touches?: number;
}

/** API 오류 본문 */
export interface ApiErr { code?: string; message?: string; details?: Record<string, unknown> }

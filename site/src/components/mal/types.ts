/** SB-MAL-MAIN-010 · SB-MAL-CSL-010 — 안심소개 화면이 받는 API 응답 모양 */

/**
 * GET /consult/categories (D018 · D019)
 *  · status      APPROVED 공개 / PENDING 준비 중(신청을 받지 않습니다)
 *  · publishMode GATED 는 자격 심사를 통과한 업체만 받습니다
 *  · consultMode LEAD 상담 신청 → 인증업체 1곳 / LISTING_FEE 월 정액 노출형(법률 · 세무 — 상담 신청 없이 사무소 목록만)
 *  · partnerCount 지금 받을 수 있는 인증업체 수(정액 노출형은 게재 중인 사무소 수)
 */
export interface ConsultCat {
  id: string; code: string; name: string;
  status: 'APPROVED' | 'PENDING'; publishMode: 'OPEN' | 'GATED';
  consultMode: 'LEAD' | 'LISTING_FEE'; partnerCount: number;
}

/**
 * GET /consult/categories/{code} (v10.24 · SB-MAL-CSL-025 업종 상세)
 *  · regions  받는 지역 — 시 · 도별 인증업체 수(많은 순). 업체 이름 · 연락처는 오지 않습니다
 *  · rules    진행 규칙 — 서버가 실제로 쓰는 설정값. 월 정액 노출형(법률 · 세무)은 null
 */
export interface ConsultCatDetail extends ConsultCat {
  regions: Array<{ sido: string; partnerCount: number }>;
  rules: { deliverTo: number; otpMinutes: number; otpMaxTries: number; dailyLimit: number; viewTtlHours: number } | null;
}

/** 상담 신청을 지금 받는 업종인가 — 공개 · 리드형 · 받을 인증업체가 1곳 이상 */
export function consultOpen(c: ConsultCat): boolean {
  return c.status === 'APPROVED' && c.consultMode === 'LEAD' && c.partnerCount > 0;
}

/** GET /categories?gwanCode=MAL */
export interface MalCategory { id: string; gwanCode: string; code: string; name: string }

/** GET /partner/dashboard (로그인 개인) — 입점 승인 여부만 씁니다 */
export interface PartnerDash { applied: boolean; status?: string; company?: string }

/** GET /site-settings/public */
export type PublicSettings = Record<string, string>;

/** GET /subscription-plans */
export interface Plan {
  code: string; name: string; monthlyPrice: number; includedCodes: number; extraCodePrice: number;
}

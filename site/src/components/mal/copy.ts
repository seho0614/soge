/**
 * SB-MAL-MAIN-010 · SB-MAL-CSL-010 — 안심소개 화면 문구 (시안 v10.8 `MAL` · `malcsl` · `malgive`)
 *
 * 여기 있는 것은 **문구**뿐입니다. 숫자 · 목록(업종 · 받는 중 여부 · 요금제 건수 · 매물)은
 * 전부 API 응답으로 채웁니다 — 시안의 「인증업체 N곳」 같은 시연 숫자는 옮기지 않았습니다.
 */

/** 상담 업종 한 줄 설명 — 시안 LEADCAT 의 설명 칸. 코드가 없으면 설명 없이 이름만 보입니다.
 *  v10.98 — 값은 사전 키(consult.desc.*)입니다. 화면에서 t(key) 로 바꿔 씁니다. */
const CSL_DESC_KEYS = {
  /* 시안 v10.11 LEADCAT (D016 · D017 · D019) — 자격 확인 10 · 일반 10 · 월 정액 노출형 2. 카드 · 금융은 보관 */
  CSL_INSURANCE: 'desc.insurance',
  CSL_MEDICAL: 'desc.medical',
  CSL_MOVING: 'desc.moving',
  CSL_INTERIOR: 'desc.interior',
  CSL_CONSTRUCTION: 'desc.construction',
  CSL_AUTO: 'desc.auto',
  CSL_TRAVEL: 'desc.travel',
  CSL_EDU: 'desc.edu',
  CSL_LOGISTICS: 'desc.logistics',
  CSL_TELCO: 'desc.telco',
  CSL_CLEANING: 'desc.cleaning',
  CSL_WEDDING: 'desc.wedding',
  CSL_EVENT: 'desc.event',
  CSL_RENTAL: 'desc.rental',
  CSL_USEDCAR: 'desc.usedcar',
  CSL_MARKETING: 'desc.marketing',
  CSL_DESIGN: 'desc.design',
  CSL_IT: 'desc.it',
  CSL_MANUFACTURE: 'desc.manufacture',
  CSL_TRADE: 'desc.trade',
  CSL_LEGAL: 'desc.listingFee',
  CSL_TAX: 'desc.listingFee',
} as const;
export type CslDescKey = (typeof CSL_DESC_KEYS)[keyof typeof CSL_DESC_KEYS];
export const CSL_DESC: Record<string, CslDescKey | undefined> = CSL_DESC_KEYS;

/* v10.121 — 축(AXIS) · 매물 안전 수칙(SAFE_LISTING)은 쓰던 MalMain 과 함께 지웠습니다. */

/** v10.98 — 값은 사전 키(consult.safe.*)입니다. 화면에서 t(key) 로 바꿔 씁니다 */
export const SAFE_CONSULT = ['safe.s1', 'safe.s2', 'safe.s3'] as const;

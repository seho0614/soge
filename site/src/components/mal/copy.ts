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

/** 축 — 시안 AX.MAL. 기계 · 설비(B)와 부동산(A)은 서버에 축 구분 API 가 없어 「매물」 하나로 묶습니다. */
export const AXIS = {
  listing: {
    nm: '매물', sub: '부동산 · 기계 · 설비',
    judge: '등기부등본이 있는 자산과 실물로 넘기는 자산을 다룹니다.',
    why: '등기가 있는 자산과 실물로 넘기는 자산은 확인할 것도 법도 다릅니다.',
  },
  consult: {
    nm: '생활 · 금융 상담', sub: '상담신청형',
    judge: '상담을 신청하면 인증된 업체 1곳이 연락드립니다.',
    why: '상담은 매물 거래가 아닙니다 — 소비자가 신청하고, 입점 승인을 받은 업체가 연락합니다.',
  },
} as const;

/** 시안 axSafe — 축마다 먼저 확인할 것 */
export const SAFE_LISTING: Array<[string, string[]]> = [
  ['기계 · 설비 · 시설', [
    '장비 가동 상태를 실물로 확인하십시오 — 사진만으로는 확인되지 않습니다',
    '리스 · 할부 잔액이 남아 있는지 확인하십시오',
    '철거 · 이전 조건과 비용을 계약서에 적으십시오',
  ]],
  ['부동산', [
    '등기부등본으로 소유자 · 근저당 · 가압류를 확인하십시오',
    '권리금 이중계약 여부를 확인하십시오',
    '임대인 동의가 필요한 계약인지 확인하십시오',
    '큰 금액일수록 계약서와 세금계산서를 먼저 갖추십시오 — 플랫폼은 대금에 관여하지 않습니다',
  ]],
];

/** v10.98 — 값은 사전 키(consult.safe.*)입니다. 화면에서 t(key) 로 바꿔 씁니다 */
export const SAFE_CONSULT = ['safe.s1', 'safe.s2', 'safe.s3'] as const;

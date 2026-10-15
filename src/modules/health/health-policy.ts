/**
 * 소개몰 배송비 · 반품 배송비 정책 — 한 곳에서만 정합니다 (2026-10-02 · 2026-10-08 배송비 전 상품 무료).
 *
 * 주문 금액 계산(배송비), 환불 차감, 약관 초안(scripts/gen-terms-draft.js), 화면 안내가 모두 이 값을 씁니다.
 * 값을 바꾸면 **약관 개정 절차**가 함께 필요합니다 — 약관에 없는 돈을 빼면 다툼이 됩니다.
 */

/**
 * 주문 배송비 — **전 상품 무료** (사장님 결정 2026-10-08 「시안 값으로」).
 * 전에는 3만원 이상 무료 · 미만 3,000원이었습니다. 장바구니 요약(v_hlt_cart · D025)도 같은 값입니다.
 */
export const HLT_SHIP_FEE = 0;
/** 반품에 드는 편도 택배비 — 주문 배송비를 받지 않아도 반품에 드는 실비는 같습니다 */
export const HLT_RETURN_SHIP_ONE_WAY = 3000;

/**
 * 고객 사정(단순 변심 · 잘못 주문)으로 **반품**하면 왕복 배송비를 환불 금액에서 뺍니다.
 * — 사장님 결정 10/2 「단순 변심은 왕복 배송비 차감」.
 * 근거: 전자상거래법 18조 9항(청약철회 시 반환 비용은 소비자 부담) — 위약금 · 손해배상은 받을 수 없습니다.
 *
 *   결제액 − 6,000원 (보내 드린 배송비 3,000 + 돌려받는 배송비 3,000)
 *   2026-10-08 부터 모든 주문이 무료배송이라 경우가 하나입니다(전에는 유료배송 주문이 따로 있었습니다).
 *
 * 발송 전 취소(CANCEL)와 판매자 사유(파손 · 오배송 · 표시와 다름 · 지연)는 빼지 않습니다(17조 3항 · 18조 10항).
 */
export const HLT_RETURN_SHIP_ROUND_TRIP = 6000;   // = HLT_RETURN_SHIP_ONE_WAY × 2. 주문 배송비(HLT_SHIP_FEE)와 묶지 않습니다 — 0 이 되어도 이 값은 그대로여야 합니다
export const HLT_CUSTOMER_REASONS = ['CHANGE_MIND', 'WRONG_ORDER'] as const;

/**
 * 교환 배송비(왕복) — 회원 사정(단순 변심 · 잘못 주문) 교환은 **신청 때 결제**합니다(사장님 확인 2026-10-08 · A-1 ①).
 * 반려 · 회사 사정 판정 · 교환할 상품이 없어 반품으로 바꾸면 돌려드립니다. 회사 사정의 교환은 0원.
 * 근거는 판매 약관 제3조(1.2) — 전자상거래법 18조 9 · 10항은 청약철회(반품)의 반환 비용만 정합니다.
 * DB 규칙(ck_hlt_returns_exchange_fee)이 다른 경우의 교환 배송비를 막습니다.
 */
export const HLT_EXCHANGE_SHIP_ROUND_TRIP = 6000;
/** 교환할 상품이 없을 때 입고를 기다리는 날 — 지나면 운영이 반품으로 바꿉니다(약관 제3조 · 10/8 답 「14일」) */
export const HLT_EXCHANGE_WAIT_DAYS = 14;
export function exchangeFee(kind: string, reason: string): number {
  return kind === 'EXCHANGE' && (HLT_CUSTOMER_REASONS as readonly string[]).includes(reason) ? HLT_EXCHANGE_SHIP_ROUND_TRIP : 0;
}

export function returnShipDeduction(kind: string, reason: string, paid: number): number {
  if (kind !== 'RETURN') return 0;
  if (!(HLT_CUSTOMER_REASONS as readonly string[]).includes(reason)) return 0;
  return Math.min(HLT_RETURN_SHIP_ROUND_TRIP, Math.max(0, paid));
}

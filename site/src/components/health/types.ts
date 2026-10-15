/**
 * 소개몰(건강관) 응답 모양 — SB-HLT-*
 *
 * ★ 전부 curl 로 실측한 모양입니다 (2026-10-02, 개발 DB).
 *   API 가 바뀌면 여기부터 고치십시오. 금액은 원 단위 정수입니다.
 */

/** GET /health/products — 목록 한 줄 */
export interface HltProduct {
  code: string;
  name: string;
  price: number;
  stock: number;
  /** 심의필 번호. 의료기기는 필수 */
  reviewNo: string | null;
  /** v10.28 (D036) — 보이는 리뷰의 별점 평균 · 수 */
  ratingAvg?: number | string | null; reviewCount?: number;
  /** 청약철회 규칙 코드 — FOOD_SEALED · DEVICE · GENERAL */
  withdrawal: string;
  /** 카테고리 **이름** */
  category: string | null;
  /** 카테고리 코드 (D002) */
  categoryCode: string | null;
  soldOut: boolean;
  /* ── v10.26 (D027) — 카드 항목 ── */
  summary?: string | null;
  /** 정가 — 대표 옵션(가장 짧은 개월 수)의 정상가 */
  listPrice?: number | null;
  /** 할인율 — 정가가 대표 판매가보다 클 때만 */
  offPct?: number | null;
  /** 한 달 최저 단가 — 살 수 있는 옵션만(품절 옵션 제외 · 단품이면 null) */
  minUnit?: number | null;
  badge?: string | null;
  /** 카드의 🛒 가 담는 옵션(재고 있는 옵션 가운데 결제 금액이 가장 싼 것) */
  cartOptionId?: string | null;
  optionCount?: number;
  mainIngredient?: { code: string; name: string; amount: string | null } | null;
  art?: { form: string | null; tone: string | null } | null;
  imageUrl?: string | null;
  sellerType?: string | null;
  sellerName?: string | null;
}

/** 옵션(복용 개월 수) — v10.26 */
export interface HltOption {
  id: string; months: number | null; price: number; stock: number; tag: string | null;
  /** 한 달 단가 = round(결제 금액 ÷ 개월 수) · 단품이면 null */
  unit: number | null;
  /** 「9개월 분 2+1」 · 「단품」 */
  label: string; soldOut: boolean;
}

/** GET /health/products/{code} — 청약철회 조건이 함께 옵니다 */
export interface HltProductDetail extends HltProduct {
  /* v10.26 */
  options: HltOption[];
  notice: { label: string; value: string }[];
  caution: string | null;
  cautionTitle: string;
  /** 「의약품이 아닙니다」 고지를 보일지(식품 · 건강기능식품) */
  notMedicine: boolean;
  exchangeFee: number;
  returnAddr: string | null;
  csTel: string | null;
  sameIngredient: HltProduct[];
  withdrawalLabel: string | null;
  withdrawalDays: number | null;
  withdrawalBlockedIf: string | null;
  withdrawalLaw: string | null;
  /** 든 성분 — hlt_product_ingredients (D002) */
  ingredients: { code: string; name: string; amount: string | null }[];
  /** 이 상품의 성분을 많이 찾는 고민 */
  concerns: HltConcernRef[];
}

/** GET /health/ingredients — 취급 상품 수 · 재고 있는 상품 최저가가 함께 옵니다 */
export interface HltIngredient {
  code: string;
  name: string;
  aliases: string[] | null;
  note: string | null;
  productCount: number;
  minPrice: number | null;
  /* v10.26 — 성분군 · 많이 찾는 성분 · 「월 N원 부터」 */
  isGroup?: boolean; parent?: string | null; featured?: boolean; minUnit?: number | null; children?: string[];
  /** v10.31 — 건강기능식품 기능성 원료(시안 「자격 필요」) */
  needsLicense?: boolean;
}

/** 고민 요약 */
export interface HltConcernRef { code: string; name: string; icon: string | null }

/** GET /health/ingredients/{code} */
export interface HltIngredientDetail {
  code: string; name: string; aliases: string[] | null; note: string | null;
  /** v10.26 — ingAmount: 이 성분(군이면 아래 성분)의 함량 */
  products: (HltProduct & { ingAmount?: string | null })[];
  concerns: HltConcernRef[];
  /* v10.26 */
  isGroup?: boolean; children?: { code: string; name: string }[]; amounts?: string[]; minUnit?: number | null; sort?: string;
  needsLicense?: boolean;
}

/** GET /health/concerns — 연결 성분이 없는 고민은 오지 않습니다 */
export interface HltConcern extends HltConcernRef {
  note: string | null;
  ingredientCount: number;
  /** 묶인 성분 중 상품이 있는 성분 수 */
  stockedIngredientCount: number;
  productCount: number;
}

/** GET /health/concerns/{code} */
export interface HltConcernDetail extends HltConcernRef {
  note: string | null;
  /** locked — 그 성분의 상품이 잠긴 갈래(건강기능식품 등)에만 있음(D025) */
  ingredients: { code: string; name: string; aliases: string[] | null; note: string | null; productCount: number; locked?: boolean }[];
  /** 상품마다 든 성분 코드(ingredients)가 함께 옵니다 */
  products: (HltProduct & { ingredients: string[] })[];
}

/** GET /health/categories — 소개몰 취급 갈래(D025). OPEN 지금 팝니다 · LOCKED 준비 중 · NOT_SOLD 팔지 않습니다 */
export interface HltSaleCategory { code: string; name: string; state: 'OPEN' | 'LOCKED' | 'NOT_SOLD'; note: string | null; productCount: number }

/** GET /categories?gwanCode=HLT */
export interface HltCategory { id: string; gwanCode: string; code: string; name: string }

/** GET /me/health/cart — 합계·배송비는 서버 계산값입니다 */
export interface HltCartItem {
  code: string; name: string; price: number; qty: number; amount: number;
  stock: number; overStock: boolean; notOnSale: boolean;
  withdrawalBlockedIf: string | null;
  /* v10.26 — 줄 = 상품 + 옵션. 담을 때 값과 지금 값이 다르면 priceChanged */
  optionId: string; optionLabel: string; months: number | null;
  addedPrice: number | null; priceChanged: boolean;
  art?: { form: string | null; tone: string | null } | null; imageUrl?: string | null;
  mainIngredient?: { code: string; name: string; amount: string | null } | null; sellerType?: string | null;
}
export interface HltCart {
  items: HltCartItem[];
  lines: number; goods: number; shipFee: number; total: number;
  hasProblem: boolean; note: string | null;
  /** v10.26 — 담은 뒤 값이 바뀐 줄이 있음(「확인했습니다」를 받아야 주문) */
  priceChanged?: boolean;
}

/** GET /me/health/addresses */
export interface HltAddress {
  id: string; label: string | null; receiver: string; phone: string;
  zipcode: string; addr1: string; addr2: string | null; isDefault: boolean;
}

/** GET /me/health/orders — 목록 */
export interface HltOrderRow {
  orderNo: string; total: number; status: string;
  createdAt: string; shippedAt: string | null; deliveredAt: string | null;
  /** v10.25 — 금액이 가장 큰 품목의 이름 · 품목 수(시안의 내 주문 줄) */
  firstItemName?: string | null; itemCount?: number;
  /** v10.26 (G-183) — 취소 신청이 접수돼 처리를 기다리는 중. 이 동안은 결제 · 취소 단추를 내립니다 */
  cancelRequested?: boolean;
  /** v10.28 (D035) — 구매확정 시각 · 자동 확정 기한(배송 완료일 때) · 처리 중인 취소 · 반품 신청 */
  confirmedAt?: string | null; confirmDue?: string | null; openReturn?: boolean; confirmedBy?: string | null;
  /** v10.31 (시안 주문 카드) — 첫 상품 그림 · 리뷰를 쓴 품목 수(「리뷰쓰기」 · 「내 리뷰 고치기」) */
  firstItemCode?: string | null; firstItemArt?: { form: string | null; tone: string | null } | null; firstItemImageUrl?: string | null;
  reviewCount?: number;
}

/** GET /me/health/orders/{no} — 상세 */
export interface HltOrderItem {
  code: string; name: string; qty: number; unitPrice: number; amount: number;
  /* v10.26 — 주문 때 복사한 옵션 이름 · 작은 그림 */
  optionId?: string | null; optionLabel?: string | null; months?: number | null;
  art?: { form: string | null; tone: string | null } | null; imageUrl?: string | null;
  mainIngredient?: { code: string; name: string; amount: string | null } | null;
  withdrawalLabel: string | null; withdrawalDays: number | null; withdrawalBlockedIf: string | null;
}
/** 서버 청약철회 판정 (fn_hlt_return_judge) */
export interface HltJudge { ok: boolean; code: string; message: string; deadline: string | null }
export interface HltOrder {
  id: string; orderNo: string; goodsAmount: number; shipFee: number; total: number;
  status: string; createdAt: string; paidAt: string | null;
  shippedAt: string | null; deliveredAt: string | null;
  /** v10.26 (G-183) — 취소 신청이 접수돼 처리를 기다리는 중 */
  cancelRequested?: boolean;
  /** v10.28 (D035) */
  confirmedAt?: string | null; confirmedBy?: string | null; confirmDue?: string | null; openReturn?: boolean;
  /** v10.31 — 주문서 배송 요청사항 · 자동 구매확정 기한이 지났는데 아직 배송 완료(매일 04시 일괄 작업이 확정) */
  shipMemo?: string | null; confirmOverdue?: boolean;
  items: HltOrderItem[];
  /** 취소 · 반품(단순 변심) · 반품(하자·오배송·표시와 다름) 가능 여부 — 서버 판정 (D002) */
  returnable: { cancel: HltJudge; return: HltJudge; returnSellerFault: HltJudge };
  /** 마지막 결제 건 (D006). 결제 준비 전이면 null */
  payment?: HltPayment | null;
  /** 고객 사정 반품의 왕복 배송비 차감 (D009 · 10/2) — 서버 health-policy.ts 값 */
  returnShip?: HltReturnShip;
  /** v10.26 — 가장 최근 교환 신청 · 교환 배송비 결제 상태(NONE · UNPAID · PAID · REFUNDED) */
  exchange?: { id: string; state: string; reason: string; fee: number; createdAt: string; feeState: string } | null;
  /** 회원 사정 교환의 왕복 배송비(원) */
  exchangeFee?: number;
}
export interface HltReturnShip {
  /** 차감 대상 사유 (단순 변심 · 잘못 주문) */
  customerReasons: string[];
  /** 왕복 배송비 (원) */
  roundTripFee: number;
  /** 환불 예상의 기준 금액(결제된 금액 · 결제 전이면 주문 금액) — v10.25 */
  paidAmount?: number;
  /** v10.27 (G-184) — 결제했는가. false 면 환불 표 대신 「결제 전 취소」 */
  paid?: boolean;
  /** 고객 사정으로 반품하면 받으실 예상 환불액 */
  customerRefundEstimate: number;
}

/** 결제 건 (D006) — POST /health/orders/{no}/pay · /pay/confirm 응답, 주문 상세의 payment */
export interface HltPayment {
  id: string; method: string; amount: number; state: string;
  /** 결제 키 없이 스텁으로 승인 — 실제 돈이 오가지 않았습니다. 화면에 "시험 결제" 로 표시합니다 */
  stub: boolean;
  /** PG 상태 원문 — DONE · WAITING_FOR_DEPOSIT · CANCELED … */
  pgStatus: string | null;
  approvedAt: string | null; canceledAt: string | null; canceledAmount: number | null;
  vbank: { bankCode?: string; accountNumber?: string; customerName?: string; dueDate?: string } | null;
  failReason: string | null;
  orderNo?: string; orderStatus?: string; orderName?: string; again?: boolean; note?: string;
}

/** GET /me/health/orders/{no}/shipments */
export interface HltShipment {
  carrier: string | null; trackingNo: string | null; state: string;
  happenedAt: string; note: string | null;
  /** v10.31 — 택배사 공개 조회 주소(송장번호만 넣음 · 「택배사에서 보기」가 새 창으로 엶) */
  trackUrl?: string | null;
}

/** GET /me/health/returns */
export interface HltReturn {
  id: string; orderNo: string; kind: string; reason: string; state: string;
  decideNote: string | null; refundAmount: number | null;
  /** 환불 때 뺀 반품 배송비 (D009). 고객 사정 반품만 0 보다 큼 */
  shipDeduction?: number;
  createdAt: string; refundedAt: string | null;
  /** 신청할 때 적으신 개봉 여부(참고) — D006 */
  customerOpened?: boolean | null;
  /** v10.26 — 교환 배송비 · 결제 상태 · 교환에서 바꾼 반품 */
  exchangeFee?: number; feeState?: 'NONE' | 'UNPAID' | 'PAID' | 'REFUNDED'; convertedFrom?: string | null;
  /** v10.27 (G-184) — 결제 전에 들어온 취소(낸 돈이 없음) */
  beforePayment?: boolean;
}

/** GET /terms */
export interface HltTerm { code: string; version: string; title: string; body: string; isRequired: boolean }

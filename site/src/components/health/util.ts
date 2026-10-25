/**
 * 소개몰(건강관) 공용 — 라벨.
 *
 * 서버 코드 라벨 번들(/codes)에 건강몰 상태 라벨이 아직 없어 여기 둡니다.
 * 고민 · 성분 연결은 서버 API 입니다(D002).
 * 번들에 들어오면 이 표를 지우고 codeList() 로 바꾸십시오.
 */

/** 금액 — 서버가 bigint 를 문자열로 줄 때도 있어 Number 로 한 번 거릅니다 */
export const krw = (n: number | string | null | undefined) =>
  n == null ? '-' : Number(n).toLocaleString('ko-KR') + '원';

/* 20261008 (v10.25) — 날짜 표기를 시안대로: 2026.10.03 · 2026.10.03 14:20 (한국 시각). 전에는 「2026. 10. 3.」 「2026. 10. 3. AM 12:38」이었습니다 */
const KST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const kst = (iso: string) => {
  const p = Object.fromEntries(KST.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { d: `${p.year}.${p.month}.${p.day}`, t: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
};
export const ymd = (iso: string | null | undefined) => (iso ? kst(iso).d : '-');

export const ymdhm = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const k = kst(iso);
  return `${k.d} ${k.t}`;
};

/* ── 주문 상태 (hlt_orders.status CHECK 와 같은 목록) ─────────────── */
export const ORDER_LABEL: Record<string, string> = {
  PENDING: '결제 대기', PAID: '결제 완료', PREPARING: '상품 준비중',
  SHIPPED: '배송중', DELIVERED: '배송 완료', CONFIRMED: '구매확정', CANCELED: '취소 완료', RETURNED: '반품 완료',
};
/** 상태 → 기존 .state-* 색 */
export const ORDER_TONE: Record<string, string> = {
  PENDING: 'held', PAID: 'paid', PREPARING: 'approved', SHIPPED: 'approved',
  DELIVERED: 'confirmed', CONFIRMED: 'paid', CANCELED: 'rejected', RETURNED: 'rejected',
};
/** 진행 단계 표시 순서 */
export const ORDER_STEPS = ['PENDING', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'];   /* v10.28 — 구매확정(D035) */

/* ── 결제 (hlt_payments.method CHECK) ─────────────────────────────── */
export const PAY_METHODS: { code: string; label: string }[] = [
  { code: 'CARD', label: '카드' },
  { code: 'TRANSFER', label: '계좌이체' },
  /* v10.31 (시안 결제수단 「간편결제」) — 결제사(토스) 결제창의 간편결제(토스페이 · 카카오페이 · 네이버페이 등)를 고르는 길입니다.
   * 결제사 연동 범위 안: 서버에는 카드 결제(CARD)로 준비하고 결제창은 카드 · 간편결제 창을 엽니다. 기록은 결제사가 준 수단 그대로(간편결제 → CARD). */
  { code: 'EASY', label: '간편결제' },
  { code: 'VBANK', label: '가상계좌' },
];
/** 화면 수단 → 서버 수단(hlt_payments.method CHECK — CARD · TRANSFER · VBANK) */
export const serverPayMethod = (m: string) => (m === 'EASY' ? 'CARD' : m);
export const PAY_LABEL: Record<string, string> =
  Object.fromEntries(PAY_METHODS.map((m) => [m.code, m.label]));
/** 결제 상태 (hlt_payments.state CHECK) — D006 */
export const PAY_STATE: Record<string, string> = {
  READY: '결제 대기', PAID: '결제 완료', FAILED: '실패', CANCELED: '취소(환불)',
};

/* ── 배송 (hlt_shipments.state CHECK) ─────────────────────────────── */
export const SHIP_LABEL: Record<string, string> = {
  READY: '발송 준비', PICKED: '집화 처리', IN_TRANSIT: '배송중', DELIVERED: '배송 완료', FAILED: '배송 실패',
};

/* ── 취소 · 반품 (hlt_returns CHECK) ──────────────────────────────── */
export const RETURN_KIND: Record<string, string> = {
  CANCEL: '주문 취소', RETURN: '반품', EXCHANGE: '교환',
};
export const RETURN_STATE: Record<string, string> = {
  REQUESTED: '접수', APPROVED: '승인', REJECTED: '반려', REFUNDED: '환불 완료',
};
export const RETURN_TONE: Record<string, string> = {
  REQUESTED: 'requested', APPROVED: 'approved', REJECTED: 'rejected', REFUNDED: 'paid',
};
/**
 * 사유 — 시안 REASONS 그대로. 귀책(party)은 사유가 정합니다 — 고객이 고르지 않습니다.
 * 서버에는 코드를 보내고, 화면에서 라벨로 바꿔 보여 줍니다.
 */
export const RETURN_REASONS: { code: string; label: string; party: 'CUSTOMER' | 'SELLER' }[] = [
  { code: 'CHANGE_MIND', label: '단순 변심', party: 'CUSTOMER' },
  { code: 'WRONG_ORDER', label: '잘못 주문했습니다', party: 'CUSTOMER' },
  { code: 'DEFECT', label: '파손 · 불량', party: 'SELLER' },
  { code: 'WRONG_ITEM', label: '다른 상품이 왔습니다', party: 'SELLER' },
  { code: 'MISMATCH', label: '표시와 다릅니다', party: 'SELLER' },
  { code: 'DELAY', label: '배송이 지연되었습니다', party: 'SELLER' },
];
/** 고객 사정 반품의 왕복 배송비 (원) — 서버 src/modules/health/health-policy.ts 의 HLT_RETURN_SHIP_ROUND_TRIP 와 같아야 합니다.
 *  주문별 화면은 서버 값(returnShip · shipDeduction)을 쓰고, 이 값은 안내 문구(이용 안내 · 내역)에만 씁니다. srv_retship.py 가 둘을 대조합니다. */
export const RETURN_SHIP_ROUND_TRIP = 6000;
export const reasonLabel = (code: string) =>
  RETURN_REASONS.find((r) => r.code === code)?.label ?? code;

/** 청약철회 기간 기본값 — 전자상거래법 17조. withdrawal_rules.days 가 오면 그 값을 씁니다 (판정은 서버가 합니다) */
export const RETURN_WINDOW_DAYS = 7;

/** 청약철회 규칙 코드 → 짧은 라벨은 v10.99 부터 사전 hlt.card.withdrawal.<코드> (목록 응답에는 코드만 옵니다) */

/* ── 성분 · 고민 ───────────────────────────────────────────────────
 * D002 부터 서버 표(hlt_product_ingredients · hlt_concerns · hlt_concern_ingredients)와
 * API(GET /health/concerns · /health/concerns/{code} · /health/ingredients/{code},
 * /health/products?ingredient=&concern=)를 씁니다. 화면에서 상품명으로 매칭하지 않습니다.
 *
 * 문구 규칙(시안): 고민 이름은 **상태 표현**만(질병명 금지 — DB 트리거가 막습니다),
 * "효과 있는 성분"이 아니라 "많이 찾는 성분"이라고 씁니다.
 * ──────────────────────────────────────────────────────────────── */

/* ── 취급하지 않는 카테고리 ───────────────────────────────────────
 * 카테고리 표에는 있지만 법상 팔 수 없는 것 — 비어 있는 이유는 v10.99 부터 사전 hlt.category.notSoldBy.<코드>. */

/**
 * v10.99 (다국어 2-4) — 코드 → 사전 글자(order.<묶음>.<코드> · 예: orderState.PAID).
 *   위의 한국어 표(ORDER_LABEL · PAY_STATE …)는 사전과 같은 글자이고, 사전에 없는 코드일 때만 씁니다(fallback).
 *   t 는 useTranslations('order') / getTranslations('order').
 */
type CodeT = { (key: never): string; has: (key: never) => boolean };
export const codeText = (t: CodeT, group: string, code: string, fallback: string) => {
  const k = `${group}.${code}` as never;
  return t.has(k) ? t(k) : fallback;
};

/** 로그인 필요 응답인가 — API 는 비로그인에 403 UNAUTHENTICATED 를 줍니다 */
export const needsLogin = (status: number, code?: string) =>
  status === 401 || code === 'UNAUTHENTICATED';

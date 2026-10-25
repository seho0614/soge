/**
 * 요청 열람 한도 표시 (D011 · 10/2 결정) — 구독 화면 두 곳이 같이 씁니다.
 *
 * 운영 설정(GET /site-settings/public):
 *   request.view.limit        off = 홍보 기간(모든 회원 제한 없음) · on = 정식 서비스
 *   request.view.limit_from   홍보 기간 종료일(선택) — 이 날부터 off 여도 적용 (D013)
 *   request.view.free_monthly 무료 요금제와 구독 없는 일반 회원의 월 건수(둘에 똑같이 적용, 기본 3)
 * 유료 요금제는 요금제 값(requestViewsPerMonth, null = 무제한)을 씁니다.
 */
export type PublicSettings = Record<string, string | null>;

export function viewLimitOn(s: PublicSettings): boolean {
  if (s['request.view.limit'] === 'on') return true;
  /* D013 — 홍보 기간 종료일(request.view.limit_from)이 되면 스위치가 off 여도 적용됩니다 (서버 fn_request_view_limit 와 같은 판정) */
  const from = s['request.view.limit_from'];
  if (!from || !/^20\d{2}-\d{2}-\d{2}$/.test(from)) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return today >= from;
}

/** v10.100 (2-5a) — 화면 문구는 부르는 쪽이 사전(billing.viewLimit)에서 넘깁니다 */
export interface ViewLimitMsgs { promo: string; unlimited: string; perMonth: (n: string) => string }

export function viewLimitText(s: PublicSettings, plan: { monthlyPrice: number; requestViewsPerMonth: number | null }, m: ViewLimitMsgs): string {
  if (!viewLimitOn(s)) return m.promo;
  if (Number(plan.monthlyPrice) === 0) return m.perMonth(s['request.view.free_monthly'] ?? '3');
  return plan.requestViewsPerMonth == null ? m.unlimited : m.perMonth(String(plan.requestViewsPerMonth));
}

/** v10.517 (D277 · docs/655) GET /popups — 메인 팝업 한 줄(보는 사람 대상 · 순서대로 · 최대 prx.popup_max) */
export interface HomePopup {
  id: string;
  title: string;
  body: string;
  /** / 로 시작하는 사이트 주소 또는 https:// 주소 · 없으면 단추 없음 */
  linkUrl: string | null;
  linkLabel: string | null;
  endsAt: string;
}

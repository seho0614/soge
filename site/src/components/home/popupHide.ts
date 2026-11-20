/**
 * v10.517 (D277 · docs/655) 메인 팝업 「오늘 하루 안 보기」 — 이 브라우저에만 적어 둠(localStorage · 서버 · 회원 기록 없음).
 *   메인 공지 띠(noticeHide.ts · v10.326)와 같은 방식: 한국 날짜 + 그날 숨긴 팝업 번호들. 날짜가 바뀌면 다시 보입니다.
 *   저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서는 이번 화면에서만 숨깁니다.
 */
import { kstDay } from './noticeHide';

export const POPUP_HIDE_KEY = 'sgb.homePopupHide';

export function readPopupHidden(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(POPUP_HIDE_KEY) ?? 'null') as { d?: string; ids?: string[] } | null;
    return v && v.d === kstDay() && Array.isArray(v.ids) ? v.ids.filter((x) => typeof x === 'string').slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function writePopupHidden(id: string): void {
  try {
    const ids = [...new Set([...readPopupHidden(), id])].slice(-50);
    window.localStorage.setItem(POPUP_HIDE_KEY, JSON.stringify({ d: kstDay(), ids }));
  } catch {
    /* 저장소를 못 쓰면 이번 화면에서만 숨김 */
  }
}

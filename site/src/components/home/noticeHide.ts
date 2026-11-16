/**
 * v10.326 (docs/453) 메인 공지 띠 「오늘 하루 안 보기」 — 이 브라우저에만 적어 둠(localStorage · 서버 · 회원 기록 없음).
 *   적는 값: 한국 날짜 + 그때 띠에 있던 공지 번호들. 날짜가 바뀌거나 새 고정 공지가 올라오면(번호가 달라지면) 다시 보입니다.
 *   저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서는 숨기지 못하고 띠가 그대로 보입니다.
 */
export const NOTICE_HIDE_KEY = 'sgb.homeNoticeHide';

export const kstDay = (now = Date.now()) => new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);

export const noticeIdsKey = (ids: string[]) => [...ids].sort().join(',');

export function readNoticeHidden(ids: string[]): boolean {
  if (!ids.length) return false;
  try {
    const v = JSON.parse(window.localStorage.getItem(NOTICE_HIDE_KEY) ?? 'null') as { d?: string; ids?: string } | null;
    return !!v && v.d === kstDay() && v.ids === noticeIdsKey(ids);
  } catch {
    return false;
  }
}

export function writeNoticeHidden(ids: string[]): void {
  try {
    window.localStorage.setItem(NOTICE_HIDE_KEY, JSON.stringify({ d: kstDay(), ids: noticeIdsKey(ids) }));
  } catch {
    /* 저장소를 못 쓰면 이번 화면에서만 숨김 */
  }
}

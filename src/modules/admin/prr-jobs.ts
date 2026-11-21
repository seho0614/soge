import { DatabaseService } from '../../db/database.service';
import { reviewDaily } from './prr-review';
import { casesDaily } from './prr-cases';

/* ---------------------------------------------------------------------
 * v10.566 · 568 (docs/708 · 710) 정기 작업 prr_daily — 매일 09:20(한국)
 *   ① 권한 정기 점검: prr.review_auto on 이면 이번 분기 거둘 후보 다시 만들기(새 후보만 더함 · 없어진 것 GONE · PRR_REVIEW_OPEN 분기마다 한 번 · 0이면 풂)
 *   ② 입사 · 퇴사 흐름: 기한 넘긴 열린 흐름에 STAFF_LEAVE_OVERDUE(WARN) · STAFF_JOIN_OVERDUE(INFO) — 흐름마다 한 번
 *   둘 중 하나가 실패해도 다른 것은 돎(실패는 detail 에 글자로) · 거두기 · 메일 · 외부 호출 없음
 * ------------------------------------------------------------------- */
export async function prrDailyJob(db: DatabaseService) {
  const review = await reviewDaily(db).catch((e: Error) => ({ error: String(e?.message ?? e).slice(0, 200) }));
  const cases = await casesDaily(db).catch((e: Error) => ({ error: String(e?.message ?? e).slice(0, 200), leaveOverdue: 0, joinOverdue: 0 }));
  const added = 'added' in review ? Number(review.added ?? 0) : 0;
  return { review, cases, affected: added + Number(cases.leaveOverdue ?? 0) + Number(cases.joinOverdue ?? 0) };
}

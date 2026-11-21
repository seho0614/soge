import { DatabaseService } from '../../db/database.service';
import { bulkPurge } from './bulk';
import { reviewAskJob } from './review-ask';
import { searchClickPurge } from './search-click';
import { trackJob } from './tracking';

/* ---------------------------------------------------------------------
 * v10.602 ~ 607 (docs/744 ~ 749) 정기 작업 두 개(scheduler.service.ts 한 줄 import)
 *   lsq_daily  매일 10:20  후기 요청(lsq.review_ask on) · 미리보기 지난 CSV 묶음 EXPIRED · 90일 지난 묶음 지움 · 보관 지난 검색 클릭 묶음 지움
 *   lsq_track  매시간      배송 추적(lsq.track on 일 때만 · 방식 lsq.track_mode)
 * ------------------------------------------------------------------- */

export async function lsqDailyJob(db: DatabaseService) {
  const review = await reviewAskJob(db);
  const bulk = await bulkPurge(db);
  const clicks = await searchClickPurge(db);
  return { made: review.asked + review.again + bulk.expired + bulk.deleted + clicks.deleted, review, bulk, clicks };
}

export async function lsqTrackJob(db: DatabaseService) {
  const r = await trackJob(db);
  return { made: r.events, ...r };
}

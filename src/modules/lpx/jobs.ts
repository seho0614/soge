import { DatabaseService } from '../../db/database.service';
import { offerExpireJob } from './offers';
import { awayEndJob } from './away';
import { statsDailyJob } from './stats';

/* ---------------------------------------------------------------------
 * v10.549 ~ 552 (D286) 정기 작업 두 개(scheduler.service.ts 한 줄 import)
 *   lpx_hourly       매시간      기한 지난 · 내려간 매물의 열린 가격 제안 EXPIRED(알림) · 끝 날짜 지난 자리 비움 ENDED — 스위치와 상관없이
 *   lpx_stats_daily  매일 04:50  지역별 시세 통계 이번 달 · 지난달 다시 셈 · 빠진 달 채움(lpx.stats on 일 때만)
 * ------------------------------------------------------------------- */

export async function lpxHourlyJob(db: DatabaseService) {
  const offers = await offerExpireJob(db);
  const away = await awayEndJob(db);
  return { made: offers.expired + away.ended, offers, away };
}

export async function lpxStatsDailyJob(db: DatabaseService) {
  const r = await statsDailyJob(db);
  return { made: r.rows, ...r };
}

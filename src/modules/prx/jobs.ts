import { DatabaseService } from '../../db/database.service';
import { refEventHourly } from './refevent';
import { abHourly } from './abtest';
import { adReportJob, type Mailer } from './adreport';

/* ---------------------------------------------------------------------
 * v10.518 ~ 520 (D277) 정기 작업 — scheduler.service.ts 가 부름
 *   prx_hourly     매시간 · 추천 이벤트 기간 끝(PERIOD) · 끝난 이벤트 알림 PRX_REF_EVENT_END · 비교 시험 기간 끝 결과 고정 · 알림 PRX_AB_DONE
 *   prx_ad_report  매일 08:10 · 지난달 광고 성과 보고서(없는 광고주만) · prx.ad_report_mail on 이면 메일
 * ------------------------------------------------------------------- */

export async function prxHourlyJob(db: DatabaseService) {
  const ev = await refEventHourly(db);
  const ab = await abHourly(db);
  return { eventsEnded: ev.ended, eventAlerts: ev.alerts, abEnded: ab.ended };
}

export const prxAdReportJob = (db: DatabaseService, mail: Mailer) => adReportJob(db, mail);

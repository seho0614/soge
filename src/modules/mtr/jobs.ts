import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { mtrSettings } from './common';
import { appealOverdueJob } from './appeal';
import { reviewScan } from './review-watch';
import { trustRecompute } from './trust';
import { dormantJob } from './dormant';

/* ---------------------------------------------------------------------
 * v10.573 ~ 576 (docs/715 ~ 718) 정기 작업 두 개 · 운영 한눈에
 *   mtr_hourly 매시간 — 이의 제기 처리 기한 넘김 알림(열린 이의가 있을 때) · 가짜 후기 탐지(mtr.review_watch)
 *   mtr_daily  매일 04:40 — 소개자 신뢰 점수 셈(mtr.trust) · 휴면 전 알림 · 휴면 전환(mtr.dormant)
 *   스위치가 모두 꺼져 있으면 아무것도 바꾸지 않음(처음 상태 · 이의 기한 알림은 열린 이의가 없으면 아무것도 안 함)
 * ------------------------------------------------------------------- */

export async function mtrHourlyJob(db: DatabaseService) {
  const appeal = await appealOverdueJob(db);
  const review = await reviewScan(db, false);
  return { made: (review.added ?? 0), appeal, review };
}

export async function mtrDailyJob(db: DatabaseService, mail: MailService | null) {
  const trust = await trustRecompute(db, false);
  const dormant = await dormantJob(db, mail);
  return { made: (trust.computed ?? 0) + (dormant.noticed ?? 0) + (dormant.dormant ?? 0), trust, dormant };
}

/** 운영 — 한눈에(설정 · 숫자) */
export async function mtrOverview(db: DatabaseService) {
  const s = await mtrSettings(db);
  const [n] = await db.query<{ appealOpen: number; appealOverdue: number; reviewOpen: number; trustCounted: number; dormantNoticed: number; dormant: number }>(
    `SELECT (SELECT count(*)::int FROM mtr_appeals WHERE state = 'OPEN') AS "appealOpen",
            (SELECT count(*)::int FROM mtr_appeals WHERE state = 'OPEN' AND due_at < now()) AS "appealOverdue",
            (SELECT count(*)::int FROM mtr_review_flags WHERE state = 'OPEN') AS "reviewOpen",
            (SELECT count(*)::int FROM mtr_trust_scores) AS "trustCounted",
            (SELECT count(*)::int FROM mtr_dormant WHERE state = 'NOTICED') AS "dormantNoticed",
            (SELECT count(*)::int FROM mtr_dormant WHERE state = 'DORMANT') AS dormant`);
  return { settings: s, counts: n ?? { appealOpen: 0, appealOverdue: 0, reviewOpen: 0, trustCounted: 0, dormantNoticed: 0, dormant: 0 } };
}

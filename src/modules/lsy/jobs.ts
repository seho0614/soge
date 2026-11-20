import { DatabaseService } from '../../db/database.service';
import { lsySettings } from './common';
import { dupScanJob } from './dup';
import { photoCheckJob } from './photo';
import { triageJob } from './triage';

/* ---------------------------------------------------------------------
 * v10.524 ~ 527 (D279) 정기 작업 두 개 · 운영 한눈에
 *   lsy_hourly 매시간 — 중복 매물 짝 찾기(lsy.dup_detect) · 사진 품질 검사(lsy.photo_check) · 사진 속 연락처 AI(lsy.photo_ai · 월 상한)
 *   lsy_triage 10분마다 — 신고 규칙 분류(lsy.report_triage) · AI 분류(lsy.report_ai · 월 상한)
 *   스위치가 모두 꺼져 있으면 아무것도 하지 않음(처음 상태)
 * ------------------------------------------------------------------- */

export async function lsyHourlyJob(db: DatabaseService) {
  const dup = await dupScanJob(db);
  const photo = await photoCheckJob(db);
  return { made: dup.pairs + photo.checked + photo.ai, dup, photo };
}

export async function lsyTriageJob(db: DatabaseService) {
  const triage = await triageJob(db);
  return { made: triage.made + triage.ai, triage };
}

/** 운영 — 한눈에(설정 · 숫자) */
export async function lsyOverview(db: DatabaseService) {
  const s = await lsySettings(db);
  const [n] = await db.query<{ dupPending: number; photoWarn: number; photoContact: number; videoPending: number; triageOpen: number; triageU1: number }>(
    `SELECT (SELECT count(*)::int FROM lsy_dup_pairs WHERE state = 'PENDING') AS "dupPending",
            (SELECT count(*)::int FROM lsy_photo_checks WHERE cardinality(warnings) > 0) AS "photoWarn",
            (SELECT count(*)::int FROM lsy_photo_checks WHERE ai_contact) AS "photoContact",
            (SELECT count(*)::int FROM lsy_listing_videos WHERE state = 'PENDING') AS "videoPending",
            (SELECT count(*)::int FROM lsy_report_triage t JOIN reports r ON r.id = t.report_id WHERE r.state IN ('OPEN', 'QUEUED')) AS "triageOpen",
            (SELECT count(*)::int FROM lsy_report_triage t JOIN reports r ON r.id = t.report_id
              WHERE r.state IN ('OPEN', 'QUEUED') AND coalesce(t.urgency, CASE WHEN t.ai_state = 'DONE' THEN t.ai_urgency END, t.rule_urgency) = 'U1') AS "triageU1"`);
  return { settings: s, counts: n ?? { dupPending: 0, photoWarn: 0, photoContact: 0, videoPending: 0, triageOpen: 0, triageU1: 0 } };
}

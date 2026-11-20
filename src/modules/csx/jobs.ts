import { DatabaseService } from '../../db/database.service';
import { autoDraftJob } from './ai-draft';
import { churnJob } from './churn';
import { csxSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.528 ~ 531 (D280) 정기 작업 둘 · 한눈에
 *   csx_daily   매일 06:20 — 이탈 위험 신호 다시 셈(csx.churn on 일 때만)
 *   csx_hourly  매시간     — 1:1 문의 자동 AI 초안(csx.ai_draft_auto on · AI 통로 CSX_DRAFT 가 열려 있을 때만)
 * ------------------------------------------------------------------- */

export async function csxDailyJob(db: DatabaseService) {
  const churn = await churnJob(db);
  return { made: churn.made, churn };
}

export async function csxHourlyJob(db: DatabaseService) {
  const draft = await autoDraftJob(db);
  return { made: draft.made, draft };
}

/** 운영 화면 네 탭 위 한 줄 */
export async function csxOverview(db: DatabaseService) {
  const s = await csxSettings(db);
  const [c] = await db.query<{ drafts: number; churnHigh: number; churnMid: number; customTpl: number; mergeOpen: number }>(
    `SELECT (SELECT count(*)::int FROM csx_inquiry_drafts WHERE state = 'DRAFT') AS drafts,
            (SELECT count(*)::int FROM csx_churn_signals WHERE level = 'HIGH') AS "churnHigh",
            (SELECT count(*)::int FROM csx_churn_signals WHERE level = 'MID') AS "churnMid",
            (SELECT count(*)::int FROM csx_mail_templates WHERE is_custom) AS "customTpl",
            (SELECT count(*)::int FROM csx_account_merges WHERE state = 'REQUESTED') AS "mergeOpen"`);
  return { settings: s, counts: c ?? { drafts: 0, churnHigh: 0, churnMid: 0, customTpl: 0, mergeOpen: 0 } };
}

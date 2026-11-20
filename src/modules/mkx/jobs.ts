import { DatabaseService } from '../../db/database.service';
import { pushSendJob } from './webpush';
import { gbRun } from './groupbuy';
import { rebuyRun } from './rebuy';

/* ---------------------------------------------------------------------
 * v10.538 ~ 541 (D283) 정기 작업 — worker 허용 목록 · scheduler case 는 patches/1_wiring.md
 *   mkx_push_send  1분    웹 푸시 보내기(push.send on 일 때만 · 처음 off · ASSUME)
 *   mkx_groupbuy   10분   공동구매 확정 · 실패(참여 주문마다 기존 취소 신청) · 마감
 *   mkx_daily      10:05  재구매 알림(mkx.rebuy on 일 때만 · 21 ~ 8시 안 함) · 30일 지난 웹 푸시 기록 · 90일 지난 GONE · OFF 구독 지움
 * ------------------------------------------------------------------- */

export const mkxPushJob = (db: DatabaseService) => pushSendJob(db);

export const mkxGroupbuyJob = (db: DatabaseService) => gbRun(db);

export async function mkxDailyJob(db: DatabaseService) {
  const rebuy = await rebuyRun(db);
  const sends = await db.query(`DELETE FROM mkx_push_sends WHERE created_at < now() - interval '30 days' RETURNING id`);
  const subs = await db.query(`DELETE FROM mkx_push_subs WHERE state IN ('GONE', 'OFF') AND updated_at < now() - interval '90 days' RETURNING id`);
  return { rebuy, purgedSends: sends.length, purgedSubs: subs.length };
}

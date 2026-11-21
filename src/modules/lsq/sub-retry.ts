import { DatabaseService } from '../../db/database.service';
import { NotFound, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { mallSubscribeJob } from '../health/health-subscribe';
import { lsqDay, lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.606 (docs/748) ㉒ 정기 배송 결제 실패 다시 시도 — 기존 정기 배송(D267 · health-subscribe.ts) 위에
 *   지금(그대로): 결제 실패 → 주문 취소 · 회차 FAILED · 실패 수 + 1 · mall.subscribe_retry(3)번 이어서 실패하면 멈춤 · 다음 날 다시
 *   lsq.sub_retry on 이면(처음 off):
 *     ① 실패 뒤(failSub 끝에서 lsqAfterSubFail) — 다음 시도일을 간격표 lsq.sub_retry_days(1,3,5)의 그 차례 값만큼 미룸(멈춘 것은 그대로)
 *        · 실패 기록 lsq_sub_pay_fails · 회원 알림 LSQ_SUB_PAY_FAIL(다음 시도일 · 「지금 다시 결제」 안내)
 *     ② 「지금 다시 결제」 — 회원(카드를 바꾼 뒤 · 내 것) · 운영 — 실패로 멈춘 것은 다시 켬 · 오늘 회차가 없을 때만 그 한 건만 기존 작업(mallSubscribeJob)으로 청구
 *   청구는 기존 그대로 — mall.subscribe_mode ASSUME(처음 · 결제대행사를 부르지 않는 간주) · LIVE(카드 자동결제 등록 키)
 *   mall.subscribe · 주문 받기가 꺼져 있으면 「지금 다시」도 하지 않음(NOT_DUE)
 * ------------------------------------------------------------------- */

const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 정기 배송입니다.'); return String(id); };

/** 「지금 다시 결제」 — 회원(me 가 주인) · 운영(me = null) */
export async function retrySubNow(db: DatabaseService, id0: string, me: string | null, who: 'MEMBER' | 'ADMIN', actor: string | null) {
  const id = idOk(id0);
  const st = await lsqSettings(db);
  if (who === 'MEMBER' && !st.subRetryOn) throw new StateConflict('LSQ_SUB_RETRY_OFF', '지금은 「지금 다시 결제」를 받지 않습니다.');
  const [s] = await db.query<{ id: string; state: string; fail_count: number; account_id: string }>(
    `SELECT id::text AS id, state, fail_count, account_id::text AS account_id FROM hlt_subscriptions WHERE id = $1::bigint AND ($2::uuid IS NULL OR account_id = $2::uuid)`, [id, me]);
  if (!s) throw new NotFound('없는 정기 배송입니다.');
  if (s.fail_count < 1) throw new StateConflict('LSQ_SUB_NOT_FAILED', '결제가 실패한 정기 배송만 다시 결제할 수 있습니다.');
  if (s.state === 'CANCELED') throw new StateConflict('LSQ_SUB_CANCELED', '해지한 정기 배송입니다.');
  const today = lsqDay();
  const [ran] = await db.query<{ state: string }>(`SELECT state FROM hlt_subscription_runs WHERE sub_id = $1::bigint AND (run_on = $2::date OR state = 'ORDERED') LIMIT 1`, [id, today]);
  if (ran) throw new StateConflict('LSQ_SUB_TRIED_TODAY', ran.state === 'ORDERED' ? '결과를 확인 중인 결제가 있습니다 — 운영이 확인한 뒤 다시 하십시오.' : '오늘은 이미 결제를 시도했습니다 — 내일 다시 하십시오.');
  await db.query(`UPDATE hlt_subscriptions SET state = 'ACTIVE', next_on = $2::date WHERE id = $1::bigint AND state IN ('ACTIVE', 'PAUSED')`, [id, today]);
  const r = await mallSubscribeJob(db, id);
  const result = r.due === 0 ? 'NOT_DUE' : r.paid ? 'PAID' : r.failed ? 'FAILED' : r.skipped ? 'SKIPPED' : 'UNCERTAIN';
  await db.query(`INSERT INTO lsq_sub_retry_log (sub_id, actor, who, result, detail) VALUES ($1::bigint, $2::uuid, $3, $4, $5)`,
    [id, actor, who, result, ('note' in r ? String(r.note ?? '') : '').slice(0, 200) || null]);
  const note = result === 'PAID' ? '결제했습니다 — 다음 결제일이 정해졌습니다.'
    : result === 'FAILED' ? '다시 결제하지 못했습니다 — 카드를 확인한 뒤 다음 시도일을 기다리십시오.'
    : result === 'NOT_DUE' ? '지금은 결제를 진행할 수 없습니다(정기 배송 · 주문 받기가 꺼져 있음).' : '결과를 확인 중입니다.';
  return { id, result, note };
}

/** 나의공간 — 결제가 실패한 내 정기 배송(최근 실패 · 다음 시도일) */
export async function mySubFails(db: DatabaseService, me: string) {
  const st = await lsqSettings(db);
  const items = await db.query(
    `SELECT s.id::text AS id, s.state, s.fail_count AS "failCount", s.next_on::text AS "nextOn", p.name AS "productName",
            f.day::text AS "lastFailOn", f.reason AS "lastReason", f.next_try_on::text AS "nextTryOn"
       FROM hlt_subscriptions s JOIN hlt_products p ON p.id = s.product_id
       LEFT JOIN LATERAL (SELECT day, reason, next_try_on FROM lsq_sub_pay_fails x WHERE x.sub_id = s.id ORDER BY day DESC LIMIT 1) f ON true
      WHERE s.account_id = $1::uuid AND s.fail_count > 0 AND s.state <> 'CANCELED' ORDER BY s.id DESC LIMIT 20`, [me]);
  return { on: st.subRetryOn, days: st.subRetryDays, items };
}

/** 운영 — 설정 · 실패 중인 정기 배송 100(가린 이름) · 최근 실패 50 · 「지금 다시」 기록 30 */
export async function adminSubRetry(db: DatabaseService) {
  const settings = await lsqSettings(db);
  const failing = await db.query<{ name: string | null } & Record<string, unknown>>(
    `SELECT s.id::text AS id, s.state, s.fail_count AS "failCount", s.next_on::text AS "nextOn", p.name AS "productName", a.name,
            (SELECT r.detail FROM hlt_subscription_runs r WHERE r.sub_id = s.id AND r.state = 'FAILED' ORDER BY r.run_on DESC LIMIT 1) AS "lastReason"
       FROM hlt_subscriptions s JOIN hlt_products p ON p.id = s.product_id JOIN accounts a ON a.id = s.account_id
      WHERE s.fail_count > 0 AND s.state <> 'CANCELED' ORDER BY s.state DESC, s.next_on LIMIT 100`);
  const fails = await db.query(
    `SELECT f.sub_id::text AS "subId", f.day::text AS day, f.attempt, f.reason, f.next_try_on::text AS "nextTryOn", f.paused, f.notified
       FROM lsq_sub_pay_fails f ORDER BY f.id DESC LIMIT 50`);
  const log = await db.query(
    `SELECT l.sub_id::text AS "subId", l.who, l.result, l.detail, l.created_at AS "createdAt" FROM lsq_sub_retry_log l ORDER BY l.id DESC LIMIT 30`);
  const [mode] = await db.query<{ mode: string | null; on: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.subscribe_mode') AS mode, (SELECT value FROM site_settings WHERE key = 'mall.subscribe') AS on`);
  return { settings, subscribe: { on: mode?.on === 'on', mode: mode?.mode === 'LIVE' ? 'LIVE' : 'ASSUME' },
    failing: failing.map(({ name, ...r }) => ({ ...r, member: maskName(name) ?? '회원' })), fails, log,
    note: '청구는 기존 정기 배송 그대로(mall.subscribe_mode — 처음 ASSUME 간주) · 스위치가 꺼져 있으면 지금처럼 다음 날 다시 시도합니다.' };
}

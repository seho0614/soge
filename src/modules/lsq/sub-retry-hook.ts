import { DatabaseService } from '../../db/database.service';
import { lsqNotify, lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.606 (docs/748) ㉒ 정기 배송 결제 실패 뒤 고리 — health-subscribe.ts failSub 끝에서 한 줄로 부름
 *   (이 파일은 health-subscribe 를 import 하지 않음 — 서로 부르는 고리를 만들지 않게 · 「지금 다시 결제」는 sub-retry.ts)
 * ------------------------------------------------------------------- */

const addDays = (ymd: string, d: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + d * 86400e3).toISOString().slice(0, 10);

/** failSub(기존) 끝에서 부름 — 스위치 off 면 아무것도 안 함(지금 동작 그대로) · 실패가 본 작업을 막지 않음 */
export async function lsqAfterSubFail(db: DatabaseService, s: { id: string; account_id: string }, attempt: number, paused: boolean, why: string, today: string) {
  try {
    const st = await lsqSettings(db);
    if (!st.subRetryOn) return { on: false };
    const gap = st.subRetryDays[Math.min(Math.max(attempt, 1), st.subRetryDays.length) - 1] ?? 1;
    const next = paused ? null : addDays(today, gap);
    if (next) await db.query(`UPDATE hlt_subscriptions SET next_on = $2::date WHERE id = $1::bigint AND state = 'ACTIVE'`, [s.id, next]);
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO lsq_sub_pay_fails (sub_id, day, attempt, reason, next_try_on, paused) VALUES ($1::bigint, $2::date, $3::int, $4, $5::date, $6::boolean)
       ON CONFLICT (sub_id, day) DO UPDATE SET attempt = EXCLUDED.attempt, reason = EXCLUDED.reason, next_try_on = EXCLUDED.next_try_on, paused = EXCLUDED.paused
       RETURNING id::text AS id`, [s.id, today, Math.min(attempt, 100), why.slice(0, 300), next, paused]);
    const [p] = await db.query<{ name: string }>(
      `SELECT p.name FROM hlt_subscriptions x JOIN hlt_products p ON p.id = x.product_id WHERE x.id = $1::bigint`, [s.id]);
    await lsqNotify(db, s.account_id, 'LSQ_SUB_PAY_FAIL', { product: (p?.name ?? '정기 배송').slice(0, 40), next: next ?? '멈춤(다시 켜야 함)' }, '/my/health/sub-retry');
    if (row) await db.query(`UPDATE lsq_sub_pay_fails SET notified = true WHERE id = $1::bigint`, [row.id]);
    return { on: true, next, paused };
  } catch {
    return { on: true, error: true };
  }
}


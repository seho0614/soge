import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.505 (D274 · docs/643) 소개몰 재입고 알림 — 대표 11/20 「㊹ ①」
 *   회원: 품절 옵션(재고 0)에 「입고되면 알림」 신청 · 내 신청 · 취소(로그인 · 기다림은 옵션마다 하나 · mall.restock_max 개까지)
 *   DB : 옵션 재고가 0 → 양수(또는 꺼진 옵션을 재고 있게 다시 켬)가 되면 트리거(trg_hlt_restock_fire)가 기다리는 회원에게 알림 HLT_RESTOCK 한 번
 *        · 알림은 fn_notify — 회원이 「재입고 알림」 수신을 끄면 보내지 않음(신청은 닫힘) · 스위치 mall.restock_alert(처음 off) on 일 때만
 *   운영: 기다리는 옵션 순위 · 최근 알림 수 · 「지금 보내기」(스위치를 켜기 전에 재고가 돌아온 옵션 따라잡기 = fn_hlt_restock_catchup)
 *   정기: mlx_daily_purge(매일 04:35)가 기한(mall.restock_keep_days) 지난 기다림을 닫고 따라잡기
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setting(db: DatabaseService, key: string) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return r?.v ?? null;
}

/** GET /admin/health/restock — 스위치 · 상태별 수 · 기다리는 옵션 순위 50 · 최근 신청 50(이름 가림) */
export async function restockView(db: DatabaseService) {
  const on = (await setting(db, 'mall.restock_alert')) === 'on';
  const [c] = await db.query<{ waiting: string; notified30: string; canceled30: string; expired30: string; members: string }>(
    `SELECT count(*) FILTER (WHERE state = 'WAITING')::text AS waiting,
            count(*) FILTER (WHERE state = 'NOTIFIED' AND notified_at >= now() - interval '30 days')::text AS notified30,
            count(*) FILTER (WHERE state = 'CANCELED' AND closed_at >= now() - interval '30 days')::text AS canceled30,
            count(*) FILTER (WHERE state = 'EXPIRED' AND closed_at >= now() - interval '30 days')::text AS expired30,
            count(DISTINCT account_id) FILTER (WHERE state = 'WAITING')::text AS members
       FROM hlt_restock_subs`);
  const options = await db.query(
    `SELECT o.id AS "optionId", p.code AS "productCode", p.name AS "productName", fn_hlt_option_label(o.months, o.tag) AS label,
            o.stock, o.is_active AS active, p.status, count(s.id)::int AS waiting, min(s.created_at) AS "oldestAt"
       FROM hlt_restock_subs s JOIN hlt_product_options o ON o.id = s.option_id JOIN hlt_products p ON p.id = s.product_id
      WHERE s.state = 'WAITING'
      GROUP BY o.id, p.code, p.name, o.months, o.tag, o.stock, o.is_active, p.status
      ORDER BY count(s.id) DESC, min(s.created_at) LIMIT 50`);
  const recent = await db.query(
    `SELECT s.id::text AS id, fn_mask_name(a.name) AS member, p.code AS "productCode", p.name AS "productName",
            fn_hlt_option_label(o.months, o.tag) AS label, s.state, s.created_at AS "createdAt", s.notified_at AS "notifiedAt", s.expires_at AS "expiresAt"
       FROM hlt_restock_subs s JOIN accounts a ON a.id = s.account_id JOIN hlt_product_options o ON o.id = s.option_id JOIN hlt_products p ON p.id = s.product_id
      ORDER BY s.id DESC LIMIT 50`);
  return {
    on, waiting: n(c?.waiting), members: n(c?.members), notified30: n(c?.notified30), canceled30: n(c?.canceled30), expired30: n(c?.expired30),
    keepDays: n((await setting(db, 'mall.restock_keep_days')) ?? 90), maxPerMember: n((await setting(db, 'mall.restock_max')) ?? 30),
    options, recent,
    note: on ? '재고가 0 에서 다시 늘면 기다리는 회원에게 한 번 알립니다(알림 수신을 끈 회원은 빼고).'
      : '재입고 알림이 꺼져 있습니다(mall.restock_alert) — 신청 단추가 보이지 않고, 재고가 돌아와도 알리지 않습니다.',
  };
}

/** POST /admin/health/restock/run — 따라잡기(이미 재고가 있는 옵션의 기다림에 알림) */
export async function restockRun(db: DatabaseService) {
  if ((await setting(db, 'mall.restock_alert')) !== 'on') throw new PolicyViolation('HLT_RESTOCK_OFF', '지금은 재입고 알림을 받지 않습니다.');
  const [r] = await db.query<{ n: number }>(`SELECT fn_hlt_restock_catchup() AS n`);
  return { notified: n(r?.n), note: `재고가 이미 돌아온 옵션의 기다림 ${n(r?.n)}건에 알렸습니다.` };
}

/** GET /me/health/restock — 내 기다림 · 최근 닫힌 신청 20 */
export async function myRestock(db: DatabaseService, me: string) {
  const items = await db.query(
    `SELECT s.id::text AS id, s.state, p.code AS "productCode", p.name AS "productName", o.id AS "optionId",
            fn_hlt_option_label(o.months, o.tag) AS label, o.stock > 0 AND o.is_active AS "inStock",
            s.created_at AS "createdAt", s.notified_at AS "notifiedAt", s.expires_at AS "expiresAt"
       FROM hlt_restock_subs s JOIN hlt_product_options o ON o.id = s.option_id JOIN hlt_products p ON p.id = s.product_id
      WHERE s.account_id = $1::uuid AND (s.state = 'WAITING' OR s.id IN (SELECT x.id FROM hlt_restock_subs x WHERE x.account_id = $1::uuid AND x.state <> 'WAITING' ORDER BY x.id DESC LIMIT 20))
      ORDER BY (s.state = 'WAITING') DESC, s.id DESC`, [me]);
  return { on: (await setting(db, 'mall.restock_alert')) === 'on', items };
}

/** POST /me/health/restock — 품절 옵션에 신청(같은 옵션 기다림이 있으면 그것을 돌려줌) */
export async function restockSubscribe(db: DatabaseService, me: string, optionId: string) {
  if ((await setting(db, 'mall.restock_alert')) !== 'on') throw new PolicyViolation('HLT_RESTOCK_OFF', '지금은 재입고 알림을 받지 않습니다.');
  if (!UUID.test(String(optionId ?? ''))) throw new NotFound('없는 옵션입니다.');
  const [o] = await db.query<{ id: string; product_id: string; stock: number; active: boolean; status: string; code: string }>(
    `SELECT o.id, o.product_id, o.stock, o.is_active AS active, p.status, p.code FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE o.id = $1::uuid`, [optionId]);
  if (!o || !['ON_SALE', 'SOLD_OUT'].includes(o.status)) throw new NotFound('없는 옵션입니다.');
  if (o.active && n(o.stock) > 0) throw new PolicyViolation('HLT_RESTOCK_IN_STOCK', '지금 살 수 있는 옵션입니다 — 바로 담아 주십시오.');
  const [same] = await db.query<{ id: string; expires_at: string }>(
    `SELECT id::text AS id, expires_at FROM hlt_restock_subs WHERE account_id = $1::uuid AND option_id = $2::uuid AND state = 'WAITING'`, [me, optionId]);
  if (same) return { id: same.id, already: true, expiresAt: same.expires_at, note: '이미 신청한 옵션입니다 — 들어오면 알려 드립니다.' };
  const days = Math.min(365, Math.max(7, n((await setting(db, 'mall.restock_keep_days')) ?? 90)));
  const [r] = await db.query<{ id: string; expires_at: string }>(
    `INSERT INTO hlt_restock_subs (account_id, option_id, product_id, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, now() + make_interval(days => $4::int))
     RETURNING id::text AS id, expires_at`, [me, optionId, o.product_id, days]);
  return { id: r!.id, already: false, expiresAt: r!.expires_at, note: `입고되면 알림으로 알려 드립니다(${days}일 동안).` };
}

/** DELETE /me/health/restock/{id} — 내 기다림 취소 */
export async function restockCancel(db: DatabaseService, me: string, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  const [s] = await db.query<{ state: string }>(`SELECT state FROM hlt_restock_subs WHERE id = $1::bigint AND account_id = $2::uuid`, [id, me]);
  if (!s) throw new NotFound('없는 신청입니다.');
  if (s.state !== 'WAITING') throw new StateConflict('HLT_RESTOCK_CLOSED', '이미 알림을 보냈거나 닫힌 신청입니다.');
  await db.query(`UPDATE hlt_restock_subs SET state = 'CANCELED', closed_at = now() WHERE id = $1::bigint AND state = 'WAITING'`, [id]);
  return { id, state: 'CANCELED' };
}

/** 정기(mlx_daily_purge) — 기한 지난 기다림 닫기 · 따라잡기 */
export async function restockDaily(db: DatabaseService) {
  const ex = await db.query(`UPDATE hlt_restock_subs SET state = 'EXPIRED', closed_at = now() WHERE state = 'WAITING' AND expires_at <= now() RETURNING id`);
  const [c] = await db.query<{ n: number }>(`SELECT fn_hlt_restock_catchup() AS n`);
  return { expired: ex.length, caughtUp: n(c?.n) };
}

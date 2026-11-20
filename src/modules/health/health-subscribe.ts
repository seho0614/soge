import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { PaymentResult, resolvePaymentProvider } from '../billing/payment.provider';
import { ORDER_OPEN_SQL, sellerShipFee } from './health-policy';

/* ---------------------------------------------------------------------
 * v10.481 (D267 · docs/619) 소개몰 정기 배송 — 대표 11/20 「㊲ ③」
 *   회원: 직판 상품 옵션 · 수량(1 ~ 10) · 배송지 · 주기(14 · 28 · 30 · 60 · 90일) · 첫 결제일(내일 ~ 60일 뒤) → 신청(mall.subscribe on 일 때만)
 *         다음 한 번 건너뛰기 · 멈춤 · 다시 · 해지(끝) — 결제는 「카드 자동결제 등록 키」(billing_keys · 구독과 같은 카드)
 *   정기 작업 mall_subscribe(매일 07:10): mall.subscribe on · 「주문 받기」 on 일 때만 · 결제일이 된 것마다
 *         건너뛰기면 회차 SKIPPED · 아니면 주문(지금 판매가 · 배송비 직판 0) → 결제 준비 → 청구
 *         청구: mall.subscribe_mode = ASSUME(간주 · 결제대행사를 부르지 않음 · stub 표시 · 처음) · LIVE(기존 결제 어댑터 chargeWithBillingKey)
 *         성공 → 결제 승인(주문 결제됨 · 트리거) · 다음 결제일 = 결제일 + 주기 · 실패 → 주문 취소(재고 되돌림) · 다음 날 다시 ·
 *         mall.subscribe_retry 번 이어서 실패하면 멈춤 + 운영 알림 MALL_SUBSCRIBE_FAIL
 *   ★ 회원 화면(site/)은 이번 판에 없음 — 서버 · 운영 화면만(주문 받기를 켤 때 회원 화면)
 * ------------------------------------------------------------------- */

export const SUB_CYCLES = [14, 28, 30, 60, 90] as const;   // DB CHECK hlt_subscriptions.cycle_days 와 같음
const kstYmd = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown) => Number(v ?? 0);
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 정기 배송입니다.'); return String(id); };
const sw = async (db: DatabaseService, key: string) => {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return r?.v ?? null;
};

/* ── 회원 ── */

/** GET /me/health/subscriptions — 내 정기 배송 · 최근 회차 */
export async function mySubs(db: DatabaseService, me: string) {
  const items = await db.query(
    `SELECT s.id::text AS id, s.state, s.qty, s.cycle_days AS "cycleDays", s.next_on::text AS "nextOn", s.skip_next AS "skipNext", s.fail_count AS "failCount", s.runs,
            p.code AS "productCode", p.name AS "productName", fn_hlt_option_label(op.months, op.tag) AS "optionLabel", op.price::bigint AS price, (op.price * s.qty)::bigint AS amount,
            s.created_at AS "createdAt", s.canceled_at AS "canceledAt", s.cancel_reason AS "cancelReason",
            (SELECT json_agg(x ORDER BY x."runOn" DESC) FROM (SELECT r.run_on::text AS "runOn", r.state, r.amount::bigint AS amount, o.order_no AS "orderNo"
                FROM hlt_subscription_runs r LEFT JOIN hlt_orders o ON o.id = r.order_id WHERE r.sub_id = s.id ORDER BY r.run_on DESC LIMIT 5) x) AS runs5
       FROM hlt_subscriptions s JOIN hlt_products p ON p.id = s.product_id JOIN hlt_product_options op ON op.id = s.option_id
      WHERE s.account_id = $1::uuid ORDER BY (s.state = 'CANCELED'), s.next_on, s.id DESC LIMIT 50`, [me]);
  const [k] = await db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM billing_keys WHERE account_id = $1::uuid AND status = 'ACTIVE') AS ok`, [me]);
  return { on: (await sw(db, 'mall.subscribe')) === 'on', hasCard: !!k?.ok, cycles: SUB_CYCLES, items };
}

export interface SubNewIn { productCode: string; optionId?: string; qty: number; addressId: string; cycleDays: number; firstOn?: string }

/** POST /me/health/subscriptions — 신청(mall.subscribe on · 직판 · 판매 중 · 켠 옵션 · 본인 배송지 · LIVE 면 카드 등록 키 있어야) */
export async function createSub(db: DatabaseService, me: string, b: SubNewIn) {
  if ((await sw(db, 'mall.subscribe')) !== 'on') throw new PolicyViolation('HLT_SUB_OFF', '지금은 정기 배송을 받지 않습니다.');
  const qty = n(b.qty), cycle = n(b.cycleDays);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new PolicyViolation('HLT_SUB_QTY', '수량은 1 ~ 10개입니다.');
  if (!(SUB_CYCLES as readonly number[]).includes(cycle)) throw new PolicyViolation('HLT_SUB_CYCLE', '주기는 14 · 28 · 30 · 60 · 90일 가운데 고르십시오.');
  const first = b.firstOn === undefined || b.firstOn === '' ? kstYmd(1) : String(b.firstOn);
  if (!YMD.test(first) || first < kstYmd(1) || first > kstYmd(60)) throw new PolicyViolation('HLT_SUB_FIRST', '첫 결제일은 내일부터 60일 안입니다.');
  if (!UUID.test(String(b.addressId ?? ''))) throw new PolicyViolation('HLT_SUB_ADDRESS', '배송지를 다시 골라 주십시오.');
  const opts = await db.query<{ product_id: string; option_id: string; status: string; seller_type: string | null }>(
    `SELECT p.id::text AS product_id, o.id::text AS option_id, p.status, s.type AS seller_type
       FROM hlt_products p JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active LEFT JOIN hlt_sellers s ON s.id = p.seller_id
      WHERE p.code = $1 ORDER BY o.sort`, [String(b.productCode ?? '')]);
  if (!opts.length || opts[0]!.status !== 'ON_SALE') throw new PolicyViolation('NOT_ON_SALE', '판매 중이 아닌 상품입니다.');
  if (opts[0]!.seller_type !== 'DIRECT') throw new PolicyViolation('HLT_SUB_DIRECT_ONLY', '정기 배송은 직판 상품만 됩니다.');
  const o = b.optionId ? opts.find((x) => x.option_id === b.optionId) : (opts.length === 1 ? opts[0] : undefined);
  if (!o) throw new PolicyViolation(b.optionId ? 'BAD_OPTION' : 'OPTION_REQUIRED', b.optionId ? '이 상품의 옵션이 아닙니다 — 옵션을 다시 골라 주십시오.' : '옵션(개월 수)을 골라 주십시오.');
  if ((await sw(db, 'mall.subscribe_mode')) === 'LIVE') {
    const [k] = await db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM billing_keys WHERE account_id = $1::uuid AND status = 'ACTIVE') AS ok`, [me]);
    if (!k?.ok) throw new PolicyViolation('HLT_SUB_NO_CARD', '정기 결제할 카드를 먼저 등록해 주십시오(구독 · 결제 수단).');
  }
  const [dup] = await db.query<{ id: string }>(`SELECT id::text AS id FROM hlt_subscriptions WHERE account_id = $1::uuid AND option_id = $2::uuid AND state <> 'CANCELED'`, [me, o.option_id]);
  if (dup) throw new StateConflict('HLT_SUB_DUP', '이 상품 옵션의 정기 배송이 이미 있습니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hlt_subscriptions (account_id, product_id, option_id, qty, address_id, cycle_days, next_on)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::uuid, $6::int, $7::date) RETURNING id::text AS id`,
    [me, o.product_id, o.option_id, qty, b.addressId, cycle, first]);
  return { ok: true, id: r!.id, nextOn: first, note: `정기 배송을 신청했습니다 — 첫 결제일 ${first} · ${cycle}일마다.` };
}

/** POST /me/health/subscriptions/{id}/action — SKIP(다음 한 번 건너뛰기 · 다시 누르면 풀기) · PAUSE · RESUME · CANCEL(끝) */
export async function subAction(db: DatabaseService, me: string | null, idIn: string, b: { action: string; reason?: string }, asAdmin = false) {
  const id = idOk(idIn);
  if (!['SKIP', 'PAUSE', 'RESUME', 'CANCEL'].includes(b.action)) throw new PolicyViolation('HLT_SUB_ACTION', '건너뛰기 · 멈춤 · 다시 · 해지 가운데 고르십시오.');
  return db.transaction(async () => {
    const [s] = await db.query<{ state: string; skip_next: boolean; next_on: string; cycle_days: number; account_id: string }>(
      `SELECT state, skip_next, next_on::text AS next_on, cycle_days, account_id::text AS account_id FROM hlt_subscriptions WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!s || (!asAdmin && s.account_id !== me)) throw new NotFound('없는 정기 배송입니다.');
    if (s.state === 'CANCELED') throw new StateConflict('HLT_SUB_CANCELED', '해지한 정기 배송입니다.');
    const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
    if (asAdmin && (!reason || reason.length < 2)) throw new PolicyViolation('HLT_SUB_REASON', '사유를 2자 이상 적어 주십시오.');
    if (b.action === 'SKIP') {
      if (s.state !== 'ACTIVE') throw new StateConflict('HLT_SUB_STATE', '진행 중인 정기 배송만 건너뜁니다.');
      await db.query(`UPDATE hlt_subscriptions SET skip_next = NOT skip_next WHERE id = $1::bigint`, [id]);
      return { ok: true, id, skipNext: !s.skip_next, note: s.skip_next ? '건너뛰기를 풀었습니다.' : `다음 결제일(${s.next_on})을 건너뜁니다.` };
    }
    if (b.action === 'PAUSE') {
      if (s.state !== 'ACTIVE') throw new StateConflict('HLT_SUB_STATE', '진행 중인 정기 배송만 멈춥니다.');
      await db.query(`UPDATE hlt_subscriptions SET state = 'PAUSED' WHERE id = $1::bigint`, [id]);
      return { ok: true, id, state: 'PAUSED', note: '정기 배송을 멈췄습니다.' };
    }
    if (b.action === 'RESUME') {
      if (s.state !== 'PAUSED') throw new StateConflict('HLT_SUB_STATE', '멈춘 정기 배송만 다시 합니다.');
      /* 지난 결제일은 몰아서 하지 않음 — 다음 결제일이 지났으면 내일로 */
      await db.query(`UPDATE hlt_subscriptions SET state = 'ACTIVE', fail_count = 0, next_on = greatest(next_on, $2::date) WHERE id = $1::bigint`, [id, kstYmd(1)]);
      return { ok: true, id, state: 'ACTIVE', note: '정기 배송을 다시 시작했습니다.' };
    }
    await db.query(`UPDATE hlt_subscriptions SET state = 'CANCELED', canceled_at = now(), cancel_reason = $2 WHERE id = $1::bigint`, [id, reason ?? (asAdmin ? '운영 해지' : '회원 해지')]);
    return { ok: true, id, state: 'CANCELED', note: '정기 배송을 해지했습니다(이미 결제된 주문은 그대로입니다).' };
  });
}

/* ── 운영 › 소개몰 › 정기 배송 ── */

/** GET /admin/health/subscriptions?state= — 스위치 · 방식 · 상태별 수 · 오늘 결제일 · 목록 200 · 최근 회차 50 */
export async function subsView(db: DatabaseService, state?: string) {
  const st = ['ACTIVE', 'PAUSED', 'CANCELED'].includes(String(state)) ? String(state) : '';
  const [c] = await db.query<{ active: number; paused: number; canceled: number; due: number }>(
    `SELECT count(*) FILTER (WHERE state = 'ACTIVE')::int AS active, count(*) FILTER (WHERE state = 'PAUSED')::int AS paused,
            count(*) FILTER (WHERE state = 'CANCELED')::int AS canceled, count(*) FILTER (WHERE state = 'ACTIVE' AND next_on <= $1::date)::int AS due
       FROM hlt_subscriptions`, [kstYmd()]);
  const items = await db.query(
    `SELECT s.id::text AS id, s.state, s.qty, s.cycle_days AS "cycleDays", s.next_on::text AS "nextOn", s.skip_next AS "skipNext", s.fail_count AS "failCount", s.runs,
            p.code AS "productCode", p.name AS "productName", fn_hlt_option_label(op.months, op.tag) AS "optionLabel", op.price::bigint AS price, (op.price * s.qty)::bigint AS amount,
            s.created_at AS "createdAt", s.canceled_at AS "canceledAt", s.cancel_reason AS "cancelReason",
            CASE WHEN char_length(coalesce(a.name, '')) <= 1 THEN '*' ELSE left(a.name, 1) || repeat('*', char_length(a.name) - 1) END AS member
       FROM hlt_subscriptions s JOIN hlt_products p ON p.id = s.product_id JOIN hlt_product_options op ON op.id = s.option_id JOIN accounts a ON a.id = s.account_id
      WHERE ($1::text = '' OR s.state = $1::text) ORDER BY (s.state = 'CANCELED'), s.next_on, s.id DESC LIMIT 200`, [st]);
  const runs = await db.query(
    `SELECT r.id::text AS id, r.sub_id::text AS "subId", r.run_on::text AS "runOn", r.state, r.amount::bigint AS amount, r.stub, r.detail, o.order_no AS "orderNo", r.created_at AS "createdAt"
       FROM hlt_subscription_runs r LEFT JOIN hlt_orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT 50`);
  const [s] = await db.query<{ sw: string | null; mode: string | null; retry: string | null; open_: boolean }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.subscribe') AS sw, (SELECT value FROM site_settings WHERE key = 'mall.subscribe_mode') AS mode,
            (SELECT value FROM site_settings WHERE key = 'mall.subscribe_retry') AS retry, (SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mall.order_open'), 'on') = 'on') AS open_`);
  return { on: s?.sw === 'on', mode: s?.mode ?? 'ASSUME', retry: n(s?.retry ?? 3), ordersOpen: !!s?.open_, counts: c, items, runs,
    note: '매일 07:10 결제일이 된 정기 배송을 주문 · 결제합니다(정기 배송 · 주문 받기가 모두 켜져 있을 때). 간주(ASSUME)는 결제대행사를 부르지 않습니다.' };
}

/* ── 정기 작업 mall_subscribe(매일 07:10) · POST /admin/health/subscriptions/run ── */

export interface DueRow { id: string; account_id: string; product_id: string; option_id: string; qty: number; address_id: string; cycle_days: number; next_on: string; skip_next: boolean; fail_count: number }

const addDays = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86400e3).toISOString().slice(0, 10);
/** 다음 결제일 = 결제일 + 주기(오늘이 지날 때까지) */
const nextAfter = (ymd: string, cycle: number, today: string) => { let x = addDays(ymd, cycle); while (x <= today) x = addDays(x, cycle); return x; };

export async function mallSubscribeJob(db: DatabaseService) {
  const on = (await sw(db, 'mall.subscribe')) === 'on';
  const [oo] = await db.query<{ open: boolean }>(ORDER_OPEN_SQL);
  if (!on || !oo?.open) return { on, ordersOpen: !!oo?.open, due: 0, paid: 0, skipped: 0, failed: 0, note: '꺼짐(mall.subscribe · mall.order_open)' };
  const mode = (await sw(db, 'mall.subscribe_mode')) === 'LIVE' ? 'LIVE' : 'ASSUME';
  const retry = Math.max(1, Math.min(5, n((await sw(db, 'mall.subscribe_retry')) ?? 3) || 3));
  const today = kstYmd();
  const due = await db.query<DueRow>(
    `SELECT id::text AS id, account_id::text AS account_id, product_id::text AS product_id, option_id::text AS option_id, qty, address_id::text AS address_id,
            cycle_days, next_on::text AS next_on, skip_next, fail_count
       FROM hlt_subscriptions s WHERE state = 'ACTIVE' AND next_on <= $1::date
        AND NOT EXISTS (SELECT 1 FROM hlt_subscription_runs r WHERE r.sub_id = s.id AND (r.run_on = $1::date OR r.state = 'ORDERED'))
      ORDER BY next_on, id LIMIT 200`, [today]);
  let paid = 0, skipped = 0, failed = 0;
  const provider = mode === 'LIVE' ? resolvePaymentProvider() : null;
  for (const s of due) {
    if (s.skip_next) {
      await db.transaction(async () => {
        await db.query(`INSERT INTO hlt_subscription_runs (sub_id, run_on, state, detail) VALUES ($1::bigint, $2::date, 'SKIPPED', '회원이 건너뜀') ON CONFLICT (sub_id, run_on) DO NOTHING`, [s.id, today]);
        await db.query(`UPDATE hlt_subscriptions SET skip_next = false, next_on = $2::date WHERE id = $1::bigint`, [s.id, nextAfter(s.next_on, s.cycle_days, today)]);
      });
      skipped++;
      continue;
    }
    /* 1) 주문 · 결제 준비 · 회차(한 트랜잭션 · 재고 · 판매 중이 아니면 통째로 되돌아감) */
    let made: { orderId: string; orderNo: string; payId: string; runId: string; amount: number } | null = null;
    let why = '';
    try {
      made = await db.transaction(async () => {
        const [p] = await db.query<{ price: string; withdrawal_code: string; status: string; active: boolean; seller_type: string | null }>(
          `SELECT o.price::text AS price, p.withdrawal_code, p.status, o.is_active AS active, sl.type AS seller_type
             FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id LEFT JOIN hlt_sellers sl ON sl.id = p.seller_id WHERE o.id = $1::uuid`, [s.option_id]);
        if (!p || p.status !== 'ON_SALE' || !p.active) throw new PolicyViolation('NOT_ON_SALE', '판매 중이 아닌 상품입니다.');
        const goods = n(p.price) * s.qty;
        const ship = sellerShipFee({ type: p.seller_type ?? 'DIRECT' }, goods);
        const [o] = await db.query<{ id: string; order_no: string }>(
          `INSERT INTO hlt_orders (order_no, account_id, address_id, goods_amount, ship_fee, total, ship_memo, subscription_id)
           VALUES (fn_next_hlt_order_no(), $1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::bigint, '정기 배송', $6::bigint) RETURNING id::text AS id, order_no`,
          [s.account_id, s.address_id, goods, ship, goods + ship, s.id]);
        await db.query(
          `INSERT INTO hlt_order_items (order_id, product_id, option_id, qty, unit_price, amount, withdrawal_code) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::bigint, $6::bigint, $7)`,
          [o!.id, s.product_id, s.option_id, s.qty, n(p.price), goods, p.withdrawal_code]);
        const [pay] = await db.query<{ id: string }>(`INSERT INTO hlt_payments (order_id, method, amount, state) VALUES ($1::uuid, 'CARD', $2::bigint, 'READY') RETURNING id::text AS id`, [o!.id, goods + ship]);
        const [run] = await db.query<{ id: string }>(
          `INSERT INTO hlt_subscription_runs (sub_id, run_on, state, order_id, amount, stub) VALUES ($1::bigint, $2::date, 'ORDERED', $3::uuid, $4::bigint, $5::boolean) RETURNING id::text AS id`,
          [s.id, today, o!.id, goods + ship, mode === 'ASSUME']);
        return { orderId: o!.id, orderNo: o!.order_no, payId: pay!.id, runId: run!.id, amount: goods + ship };
      });
    } catch (e) {
      why = String((e as { response?: { message?: string } })?.response?.message ?? (e as Error)?.message ?? e).slice(0, 200);
    }
    if (!made) {
      await failSub(db, s, today, null, why || '주문을 만들지 못했습니다', retry);
      failed++;
      continue;
    }
    /* 2) 청구 — ASSUME 은 부르지 않음(간주) · LIVE 는 카드 등록 키로 결제 어댑터 */
    let r: PaymentResult;
    if (mode === 'ASSUME') {
      r = { approved: true, stub: true, amount: made.amount, method: 'CARD', status: 'DONE', paymentKey: `assume_sub_${made.orderNo}` } as PaymentResult;
    } else {
      const [k] = await db.query<{ billing_key: string }>(`SELECT billing_key FROM billing_keys WHERE account_id = $1::uuid AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`, [s.account_id]);
      r = k ? await provider!.chargeWithBillingKey({ billingKey: k.billing_key, customerKey: s.account_id, orderId: made.orderNo, amount: made.amount,
                                                   orderName: `소개몰 정기 배송 ${made.orderNo}`, idempotencyKey: `hltsub-${made.runId}` })
            : ({ approved: false, stub: false, detail: '등록된 카드가 없습니다' } as PaymentResult);
    }
    if (!r.approved && r.uncertain) {
      /* 결과를 알 수 없음(D022) — 실패로 적지 않음 · 회차는 「주문함」으로 남겨 다음 날 새 주문을 만들지 않음 · 운영이 결제대행사에서 확인 */
      await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('MALL_SUBSCRIBE_UNCERTAIN', 'CRITICAL', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
        [`소개몰 정기 배송 결제 결과를 알 수 없음 — 주문 ${made.orderNo} · 결제대행사에서 확인 — 소개몰 › 정기 배송`.slice(0, 300), JSON.stringify({ sub: s.id, order: made.orderNo, run: made.runId, detail: r.detail ?? null })]);
      continue;
    }
    if (r.approved) {
      await db.transaction(async () => {
        await db.query(
          `UPDATE hlt_payments SET state = 'PAID', payment_key = $2, approved_at = coalesce($3::timestamptz, now()), pg_status = 'DONE', stub = $4::boolean, pg_tid = $5, fail_reason = NULL WHERE id = $1::uuid`,
          [made!.payId, r.paymentKey ?? `sub_${made!.orderNo}`, r.approvedAt ?? null, !!r.stub, r.transactionKey ?? null]);
        await db.query(`UPDATE hlt_subscription_runs SET state = 'PAID', stub = $2::boolean WHERE id = $1::bigint`, [made!.runId, !!r.stub]);
        await db.query(`UPDATE hlt_subscriptions SET next_on = $2::date, fail_count = 0, runs = runs + 1, last_order_id = $3::uuid WHERE id = $1::bigint`,
          [s.id, nextAfter(s.next_on, s.cycle_days, today), made!.orderId]);
      });
      paid++;
    } else {
      await db.transaction(async () => {
        await db.query(`UPDATE hlt_payments SET state = 'FAILED', fail_reason = $2 WHERE id = $1::uuid`, [made!.payId, (r.detail ?? '결제 승인 실패').slice(0, 500)]);
        await db.query(`UPDATE hlt_orders SET status = 'CANCELED' WHERE id = $1::uuid AND status = 'PENDING'`, [made!.orderId]);
      });
      await failSub(db, s, today, made.runId, r.detail ?? '결제 승인 실패', retry);
      failed++;
    }
  }
  return { on, mode, due: due.length, paid, skipped, failed };
}

/** 실패 — 회차 FAILED · 실패 수 + 1 · 정한 수를 넘으면 멈춤 · 운영 알림(정기 배송 · 날짜마다 한 번) */
async function failSub(db: DatabaseService, s: DueRow, today: string, runId: string | null, why: string, retry: number) {
  await db.transaction(async () => {
    if (runId) await db.query(`UPDATE hlt_subscription_runs SET state = 'FAILED', detail = $2 WHERE id = $1::bigint AND state = 'ORDERED'`, [runId, why.slice(0, 300)]);
    else await db.query(`INSERT INTO hlt_subscription_runs (sub_id, run_on, state, detail) VALUES ($1::bigint, $2::date, 'FAILED', $3) ON CONFLICT (sub_id, run_on) DO NOTHING`, [s.id, today, why.slice(0, 300)]);
    const pause = s.fail_count + 1 >= retry;
    await db.query(`UPDATE hlt_subscriptions SET fail_count = least(100, fail_count + 1), state = CASE WHEN $2::boolean THEN 'PAUSED' ELSE state END WHERE id = $1::bigint`, [s.id, pause]);
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'MALL_SUBSCRIBE_FAIL', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'MALL_SUBSCRIBE_FAIL' AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING`,
      [`소개몰 정기 배송 실패 — ${s.id}번 · ${today} · ${why}${pause ? ' · 멈춤' : ''} — 소개몰 › 정기 배송`.slice(0, 300),
       JSON.stringify({ key: `${s.id}|${today}`, sub: s.id, day: today, why, paused: pause }), `${s.id}|${today}`]);
  });
}

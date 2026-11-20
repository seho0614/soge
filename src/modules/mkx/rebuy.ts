import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { maskName } from '../../common/mask';
import { PRODUCT_CODE_RE, intIn, isOn, mkxAudit, nightKst, readSettings, todayKst } from './common';

/* ---------------------------------------------------------------------
 * v10.539 (D283 · docs/677) ② 소개몰 재구매 알림
 *   규칙   상품마다 사용 일수(7 ~ 730 · 개월 옵션이 있으면 개월 × 30일이 먼저) × 수량 · 며칠 전(0 ~ 60) — 보기 v_mkx_rebuy_due 가 알릴 날을 셈
 *   보내기 정기 작업 mkx_daily(매일 10:05 · mkx.rebuy on) — 알릴 날이 오늘 이전이고 mkx.rebuy_late_days 안인 품목 · 품목 하나에 한 번
 *          광고성 정보라 마케팅 수신 동의(fn_consent_at MARKETING)가 지금 있는 회원만 · 21 ~ 8시에는 돌리지 않음(야간 광고 동의를 따로 보지 않으려고)
 *          같은 상품을 그 결제 뒤에 또 산 회원 · 판매 중 아님 · 쓰지 않는 계정 · 이 알림 종류를 끈 회원은 건너뜀(까닭 기록)
 *          회원 하루 한 통 · 하루 전체 mkx.rebuy_daily_max(넘는 줄은 다음 날 — 늦게 보내기 한도 안이면)
 *   알림   회원 알림 MARKETING_MALL_REBUY(제목 「(광고)」) → 웹 푸시(①)가 켜진 기기면 그대로 푸시도 감
 * ------------------------------------------------------------------- */

const REBUY_KEYS = ['mkx.rebuy', 'mkx.rebuy_daily_max', 'mkx.rebuy_late_days'];
export interface RebuySettings { on: boolean; dailyMax: number; lateDays: number }
export async function rebuySettings(db: DatabaseService): Promise<RebuySettings> {
  const s = await readSettings(db, REBUY_KEYS);
  return { on: isOn(s['mkx.rebuy']), dailyMax: intIn(s['mkx.rebuy_daily_max'], 1, 5000, 300), lateDays: intIn(s['mkx.rebuy_late_days'], 0, 30, 7) };
}

async function productByCode(db: DatabaseService, code: string) {
  if (!PRODUCT_CODE_RE.test(code ?? '')) throw new NotFound('없는 상품입니다.');
  const [p] = await db.query<{ id: string; code: string; name: string; status: string }>(`SELECT id, code, name, status FROM hlt_products WHERE code = $1`, [code]);
  if (!p) throw new NotFound('없는 상품입니다.');
  return p;
}

/* ── 운영 화면 ─────────────────────────────────────────────────── */
export async function rebuyAdminView(db: DatabaseService) {
  const s = await rebuySettings(db);
  const today = todayKst();
  const rules = await db.query(
    `SELECT p.code, p.name, p.status, r.use_days AS "useDays", r.before_days AS "beforeDays", r.is_active AS active, r.memo, r.updated_at AS "updatedAt",
            (SELECT count(*)::int FROM v_mkx_rebuy_due d WHERE d.product_id = r.product_id AND d.notify_on BETWEEN $1::date AND $1::date + 14
                AND NOT EXISTS (SELECT 1 FROM mkx_rebuy_sends x WHERE x.order_item_id = d.order_item_id)) AS "next14",
            (SELECT count(*)::int FROM mkx_rebuy_sends x WHERE x.product_id = r.product_id AND x.state = 'SENT' AND x.created_at > now() - interval '30 days') AS "sent30"
       FROM mkx_rebuy_rules r JOIN hlt_products p ON p.id = r.product_id ORDER BY p.name LIMIT 300`, [today]);
  const [c] = await db.query<{ due: number; sent30: number; skipped30: number }>(
    `SELECT (SELECT count(*)::int FROM v_mkx_rebuy_due d WHERE d.notify_on BETWEEN $1::date - $2::int AND $1::date
                AND NOT EXISTS (SELECT 1 FROM mkx_rebuy_sends x WHERE x.order_item_id = d.order_item_id)) AS due,
            (SELECT count(*)::int FROM mkx_rebuy_sends WHERE state = 'SENT' AND created_at > now() - interval '30 days') AS "sent30",
            (SELECT count(*)::int FROM mkx_rebuy_sends WHERE state = 'SKIPPED' AND created_at > now() - interval '30 days') AS "skipped30"`, [today, s.lateDays]);
  const reasons = await db.query(
    `SELECT reason, count(*)::int AS n FROM mkx_rebuy_sends WHERE state = 'SKIPPED' AND created_at > now() - interval '30 days' GROUP BY reason ORDER BY 2 DESC`);
  const recent = (await db.query<{ id: string; at: string; state: string; reason: string | null; dueOn: string; notifyOn: string; code: string; product: string; name: string | null }>(
    `SELECT x.id::text AS id, x.created_at AS at, x.state, x.reason, to_char(x.due_on, 'YYYY-MM-DD') AS "dueOn", to_char(x.notify_on, 'YYYY-MM-DD') AS "notifyOn",
            p.code, p.name AS product, a.name
       FROM mkx_rebuy_sends x JOIN hlt_products p ON p.id = x.product_id JOIN accounts a ON a.id = x.account_id
      ORDER BY x.id DESC LIMIT 100`)).map((r) => ({ ...r, name: maskName(r.name) }));
  return { settings: s, night: nightKst(), today, rules, counts: c, reasons, recent,
    note: '광고성 정보라 마케팅 수신 동의자에게만, 품목 하나에 한 번, 회원 하루 한 통만 보냅니다(제목 「(광고)」). 스위치 · 상한은 정책 › 전체 설정의 mkx.rebuy* 입니다.' };
}

export async function rebuySetRule(db: DatabaseService, code: string, d: { useDays: number; beforeDays?: number; active?: boolean; memo?: string }, actor: string | null) {
  const p = await productByCode(db, code);
  const useDays = Number(d.useDays), before = d.beforeDays === undefined ? 7 : Number(d.beforeDays);
  if (!Number.isInteger(useDays) || useDays < 7 || useDays > 730) throw new PolicyViolation('MKX_REBUY_DAYS', '사용 일수는 7 ~ 730일입니다.');
  if (!Number.isInteger(before) || before < 0 || before > 60 || before >= useDays) throw new PolicyViolation('MKX_REBUY_BEFORE', '며칠 전은 0 ~ 60일이고 사용 일수보다 작아야 합니다.');
  const memo = d.memo === undefined ? null : String(d.memo).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const active = d.active === undefined ? true : !!d.active;
  await db.query(
    `INSERT INTO mkx_rebuy_rules (product_id, use_days, before_days, is_active, memo, updated_by) VALUES ($1, $2::int, $3::int, $4, $5, $6)
     ON CONFLICT (product_id) DO UPDATE SET use_days = EXCLUDED.use_days, before_days = EXCLUDED.before_days, is_active = EXCLUDED.is_active,
            memo = coalesce(EXCLUDED.memo, mkx_rebuy_rules.memo), updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [p.id, useDays, before, active, memo, actor]);
  await mkxAudit(db, 'MKX_REBUY_RULE', 'HLT_PRODUCT', { code: p.code, useDays, beforeDays: before, active });
  return { ok: true, code: p.code, useDays, beforeDays: before, active, note: `「${p.name}」 재구매 알림 규칙을 저장했습니다(사용 ${useDays}일 · ${before}일 전).` };
}

export async function rebuyDeleteRule(db: DatabaseService, code: string) {
  const p = await productByCode(db, code);
  const rows = await db.query(`DELETE FROM mkx_rebuy_rules WHERE product_id = $1 RETURNING product_id`, [p.id]);
  if (!rows.length) throw new NotFound('이 상품에는 재구매 알림 규칙이 없습니다.');
  await mkxAudit(db, 'MKX_REBUY_RULE_DEL', 'HLT_PRODUCT', { code: p.code });
  return { ok: true, code: p.code, note: `「${p.name}」 재구매 알림 규칙을 지웠습니다(보낸 기록은 남음).` };
}

/* ── 보내기(정기 작업 · 「지금 한 번」) ─────────────────────────────── */
export async function rebuyRun(db: DatabaseService) {
  const s = await rebuySettings(db);
  const out = { on: s.on, night: nightKst(), picked: 0, sent: 0, skipped: 0, capped: 0 };
  if (!s.on || out.night) return out;
  const today = todayKst();
  const rows = await db.query<{ itemId: string; accountId: string; productId: string; dueOn: string; notifyOn: string; days: number; paidOn: string;
    code: string; name: string; onSale: boolean; active: boolean; consent: boolean; rebought: boolean; optedOut: boolean; late: boolean }>(
    `SELECT d.order_item_id::text AS "itemId", d.account_id AS "accountId", d.product_id::text AS "productId",
            to_char(d.due_on, 'YYYY-MM-DD') AS "dueOn", to_char(d.notify_on, 'YYYY-MM-DD') AS "notifyOn", d.days,
            to_char((d.paid_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS "paidOn",
            p.code, p.name, (p.status = 'ON_SALE') AS "onSale", (a.status = 'ACTIVE') AS active,
            public.fn_consent_at(d.account_id, 'MARKETING', now()) AS consent,
            EXISTS (SELECT 1 FROM hlt_order_items i2 JOIN hlt_orders o2 ON o2.id = i2.order_id
                     WHERE o2.account_id = d.account_id AND i2.product_id = d.product_id AND o2.paid_at > d.paid_at
                       AND o2.status NOT IN ('CANCELED', 'RETURNED')) AS rebought,
            EXISTS (SELECT 1 FROM notification_preferences np WHERE np.account_id = d.account_id AND np.event_code = 'MARKETING_MALL_REBUY'
                       AND np.channel = 'INAPP' AND NOT np.enabled) AS "optedOut",
            (d.notify_on < $1::date - $2::int) AS late
       FROM v_mkx_rebuy_due d JOIN hlt_products p ON p.id = d.product_id JOIN accounts a ON a.id = d.account_id
      WHERE d.notify_on <= $1::date
        AND NOT EXISTS (SELECT 1 FROM mkx_rebuy_sends x WHERE x.order_item_id = d.order_item_id)
      ORDER BY d.notify_on DESC, d.order_item_id LIMIT 5000`, [today, s.lateDays]);
  out.picked = rows.length;
  const [sentToday] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mkx_rebuy_sends WHERE state = 'SENT' AND created_at >= ((now() AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul'`);
  let budget = s.dailyMax - (sentToday?.n ?? 0);
  const doneToday = new Set((await db.query<{ a: string }>(
    `SELECT DISTINCT account_id AS a FROM mkx_rebuy_sends WHERE state = 'SENT' AND created_at >= ((now() AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul'`)).map((r) => r.a));
  for (const r of rows) {
    const skip = r.late ? 'TOO_LATE' : !r.active ? 'INACTIVE' : !r.onSale ? 'NOT_ON_SALE' : r.rebought ? 'REBOUGHT' : !r.consent ? 'NO_CONSENT' : r.optedOut ? 'OPTED_OUT' : null;
    if (skip) {
      await db.query(
        `INSERT INTO mkx_rebuy_sends (order_item_id, account_id, product_id, due_on, notify_on, state, reason) VALUES ($1::uuid, $2, $3::uuid, $4::date, $5::date, 'SKIPPED', $6)
         ON CONFLICT (order_item_id) DO NOTHING`, [r.itemId, r.accountId, r.productId, r.dueOn, r.notifyOn, skip]);
      out.skipped++; continue;
    }
    if (budget <= 0 || doneToday.has(r.accountId)) { out.capped++; continue; }   // 다음 날(늦게 보내기 한도 안이면)
    await db.transaction(async () => {
      await db.query(`SELECT public.fn_notify($1, 'MARKETING_MALL_REBUY', $2::jsonb, $3)`,
        [r.accountId, JSON.stringify({ product: r.name, date: r.paidOn, days: String(r.days) }), `/health/p/${r.code}`]);
      const [n] = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM notifications WHERE account_id = $1 AND event_code = 'MARKETING_MALL_REBUY' AND created_at > now() - interval '1 minute' ORDER BY id DESC LIMIT 1`, [r.accountId]);
      await db.query(
        `INSERT INTO mkx_rebuy_sends (order_item_id, account_id, product_id, due_on, notify_on, state, notification_id) VALUES ($1::uuid, $2, $3::uuid, $4::date, $5::date, 'SENT', $6::bigint)
         ON CONFLICT (order_item_id) DO NOTHING`, [r.itemId, r.accountId, r.productId, r.dueOn, r.notifyOn, n?.id ?? null]);
    });
    budget--; doneToday.add(r.accountId); out.sent++;
  }
  return out;
}

export async function rebuyRunNow(db: DatabaseService) {
  const s = await rebuySettings(db);
  if (!s.on) throw new PolicyViolation('MKX_REBUY_OFF', '재구매 알림이 꺼져 있습니다(mkx.rebuy).');
  if (nightKst()) throw new PolicyViolation('MKX_REBUY_NIGHT', '21시 ~ 8시에는 광고 알림을 보내지 않습니다 — 아침에 다시 누르십시오.');
  const r = await rebuyRun(db);
  return { ok: true, ...r, note: `보냄 ${r.sent} · 건너뜀 ${r.skipped} · 상한으로 다음 날 ${r.capped}` };
}

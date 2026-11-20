import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { ORDER_OPEN_SQL, ORDERS_CLOSED_MSG, sellerShipFee } from '../health/health-policy';
import { PRODUCT_CODE_RE, cleanReason, isOn, mkxAlert, mkxAudit, readSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.540 (D283 · docs/678) ③ 소개몰 공동구매
 *   운영   초안(직판 상품 옵션 하나 · 할인가 · 목표 인원 · 최대 인원 · 한 사람 수량 · 기한) → 열기(mkx.groupbuy on · DB 가 직판 · 판매 중 · 할인가 < 옵션 값 확인)
 *   회원   /health/groupbuys 에서 참여 → 할인가로 보통 주문 하나(주문 받기 mall.order_open 도 켜져야 함 · 기본 배송지) → 보통 결제 흐름으로 결제
 *   확정   결제를 마친 참여자(사람 수)가 목표에 닿으면 바로 SUCCESS(그때부터 발송 · 회원 알림 MALL_GB_SUCCESS) · 기한이 지나면 CLOSED
 *   실패   기한까지 못 모이면 FAILED — 참여 주문마다 기존 취소 신청(hlt_returns CANCEL · 까닭 GROUPBUY_FAILED)을 넣음 → 환불은 기존 환불 흐름
 *          (소개몰 › 주문 · 취소 처리에서 승인 → 환불 · 결제 전 주문은 승인만으로 취소) · 회원 알림 MALL_GB_FAILED · 운영 알림 MKX_GB_FAILED
 *   발송   확정 전 · 실패 · 취소한 공동구매의 주문은 DB 트리거(trg_mkx_gb_ship_hold)가 상품 준비 · 발송을 막음
 *   법무 확인 끝(11/20 대표 · 이상 없음 · docs/678 6절) — 표시(정가 · 할인가 · 모집 조건) · 청약철회 · 실패 때 환불 기한 · 스위치는 그대로 처음 꺼짐
 * ------------------------------------------------------------------- */

export const GB_STATES = ['DRAFT', 'OPEN', 'SUCCESS', 'FAILED', 'CANCELED', 'CLOSED'] as const;
const STATE_KO: Record<string, string> = { DRAFT: '초안', OPEN: '모집 중', SUCCESS: '확정', FAILED: '실패', CANCELED: '취소', CLOSED: '마감' };

const gbOn = async (db: DatabaseService) => isOn((await readSettings(db, ['mkx.groupbuy']))['mkx.groupbuy']);

interface GbRow { id: string; productId: string; optionId: string; title: string; listPrice: number; dealPrice: number; targetCount: number; maxCount: number | null;
  perMemberMax: number; endsAt: string; state: string; code: string; name: string; optionLabel: string; sellerType: string }

async function gbRow(db: DatabaseService, id: string): Promise<GbRow> {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('없는 공동구매입니다.');
  const [g] = await db.query<GbRow>(
    `SELECT g.id::text AS id, g.product_id AS "productId", g.option_id AS "optionId", g.title, g.list_price::float8 AS "listPrice", g.deal_price::float8 AS "dealPrice",
            g.target_count AS "targetCount", g.max_count AS "maxCount", g.per_member_max AS "perMemberMax", g.ends_at AS "endsAt", g.state,
            p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS "optionLabel", s.type AS "sellerType"
       FROM mkx_groupbuys g JOIN hlt_products p ON p.id = g.product_id JOIN hlt_product_options o ON o.id = g.option_id
       LEFT JOIN hlt_sellers s ON s.id = p.seller_id
      WHERE g.id = $1::bigint`, [id]);
  if (!g) throw new NotFound('없는 공동구매입니다.');
  return g;
}

function checkEnds(v: string): Date {
  const at = new Date(v);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 3600e3 || at.getTime() > Date.now() + 60 * 86400e3) {
    throw new PolicyViolation('MKX_GB_ENDS', '기한은 지금부터 1시간 ~ 60일 안입니다.');
  }
  return at;
}

/* ── 운영 화면 ─────────────────────────────────────────────────── */
export async function gbAdminList(db: DatabaseService, state?: string) {
  const st = state && (GB_STATES as readonly string[]).includes(state) ? state : null;
  const items = await db.query(
    `SELECT g.id::text AS id, g.title, g.state, g.list_price::float8 AS "listPrice", g.deal_price::float8 AS "dealPrice", g.target_count AS "targetCount", g.max_count AS "maxCount",
            g.per_member_max AS "perMemberMax", g.ends_at AS "endsAt", g.opened_at AS "openedAt", g.success_at AS "successAt", g.closed_at AS "closedAt", g.cancel_reason AS "cancelReason",
            p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS "optionLabel",
            fn_mkx_gb_paid(g.id) AS paid, fn_mkx_gb_taken(g.id) AS taken,
            (SELECT count(*)::int FROM mkx_gb_joins j WHERE j.groupbuy_id = g.id AND j.cancel_return_id IS NOT NULL) AS "cancelFiled",
            (SELECT count(*)::int FROM mkx_gb_joins j JOIN hlt_returns r ON r.id = j.cancel_return_id WHERE j.groupbuy_id = g.id AND r.state = 'REQUESTED') AS "cancelOpen"
       FROM mkx_groupbuys g JOIN hlt_products p ON p.id = g.product_id JOIN hlt_product_options o ON o.id = g.option_id
      WHERE ($1::text IS NULL OR g.state = $1::text)
      ORDER BY (g.state IN ('OPEN', 'SUCCESS', 'DRAFT')) DESC, g.id DESC LIMIT 200`, [st]);
  const products = await db.query(
    `SELECT p.code, p.name, o.id AS "optionId", fn_hlt_option_label(o.months, o.tag) AS "optionLabel", o.price::float8 AS price, o.stock
       FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active
      WHERE p.status = 'ON_SALE' ORDER BY p.name, o.sort LIMIT 300`);
  return { on: await gbOn(db), orderOpen: !!(await db.query<{ open: boolean }>(ORDER_OPEN_SQL))[0]?.open, items, products, states: STATE_KO,
    note: '직판 상품 옵션 하나로 엽니다. 결제를 마친 참여자가 목표에 닿으면 바로 확정되고, 기한까지 못 모이면 참여 주문마다 취소 신청이 들어갑니다 — 환불은 소개몰 › 주문 · 취소 처리에서 기존 절차로 합니다.' };
}

export async function gbJoinsOf(db: DatabaseService, id: string) {
  const g = await gbRow(db, id);
  const rows = (await db.query<{ id: string; name: string | null; orderNo: string; status: string; paid: boolean; qty: number; total: number; returnState: string | null; at: string }>(
    `SELECT j.id::text AS id, a.name, o.order_no AS "orderNo", o.status, (o.paid_at IS NOT NULL) AS paid, j.qty, o.total::float8 AS total,
            r.state AS "returnState", j.created_at AS at
       FROM mkx_gb_joins j JOIN accounts a ON a.id = j.account_id JOIN hlt_orders o ON o.id = j.order_id LEFT JOIN hlt_returns r ON r.id = j.cancel_return_id
      WHERE j.groupbuy_id = $1::bigint ORDER BY j.id LIMIT 1000`, [g.id])).map((r) => ({ ...r, name: maskName(r.name) }));
  return { id: g.id, title: g.title, state: g.state, rows };
}

export async function gbCreate(db: DatabaseService, d: { productCode: string; optionId?: string; title: string; dealPrice: number; targetCount: number; maxCount?: number; perMemberMax?: number; endsAt: string }, actor: string | null) {
  if (!PRODUCT_CODE_RE.test(d.productCode ?? '')) throw new NotFound('없는 상품입니다.');
  const opts = await db.query<{ productId: string; optionId: string; price: number; sellerType: string | null; status: string }>(
    `SELECT p.id AS "productId", o.id AS "optionId", o.price::float8 AS price, s.type AS "sellerType", p.status
       FROM hlt_products p JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active LEFT JOIN hlt_sellers s ON s.id = p.seller_id
      WHERE p.code = $1 ORDER BY o.sort`, [d.productCode]);
  if (!opts.length) throw new NotFound('없는 상품이거나 켠 옵션이 없습니다.');
  if (opts[0].sellerType !== 'DIRECT') throw new PolicyViolation('MKX_GB_PRODUCT', '공동구매는 직판 상품만 엽니다(입점 판매자 상품은 다음 단계).');
  const o = d.optionId ? opts.find((x) => x.optionId === d.optionId) : opts.length === 1 ? opts[0] : null;
  if (!o) throw new PolicyViolation('MKX_GB_OPTION', '옵션을 골라 주십시오.');
  const title = cleanReason(d.title);
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('MKX_GB_TITLE', '공동구매 이름은 2 ~ 80자입니다.');
  const deal = Number(d.dealPrice), target = Number(d.targetCount), per = d.perMemberMax === undefined ? 1 : Number(d.perMemberMax);
  const max = d.maxCount === undefined || d.maxCount === null ? null : Number(d.maxCount);
  if (!Number.isInteger(deal) || deal <= 0 || deal >= Number(o.price)) throw new PolicyViolation('MKX_GB_PRICE', '할인가는 1원 이상이고 지금 옵션 값보다 낮아야 합니다.');
  if (!Number.isInteger(target) || target < 2 || target > 10000) throw new PolicyViolation('MKX_GB_TARGET', '목표 인원은 2 ~ 10,000명입니다.');
  if (max !== null && (!Number.isInteger(max) || max < target || max > 100000)) throw new PolicyViolation('MKX_GB_MAX', '최대 인원은 목표 인원 이상 100,000명 이하입니다.');
  if (!Number.isInteger(per) || per < 1 || per > 10) throw new PolicyViolation('MKX_GB_QTY', '한 분 수량 상한은 1 ~ 10개입니다.');
  const ends = checkEnds(d.endsAt);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO mkx_groupbuys (product_id, option_id, title, list_price, deal_price, target_count, max_count, per_member_max, ends_at, created_by)
     VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6::int, $7::int, $8::int, $9::timestamptz, $10) RETURNING id::text AS id`,
    [o.productId, o.optionId, title, o.price, deal, target, max, per, ends.toISOString(), actor]);
  await mkxAudit(db, 'MKX_GB_CREATE', 'HLT_PRODUCT', { id: r.id, code: d.productCode, deal, target, max, per, endsAt: ends.toISOString() });
  return { ok: true, id: r.id, note: '공동구매 초안을 만들었습니다 — 확인한 뒤 「열기」를 누르십시오.' };
}

export async function gbUpdate(db: DatabaseService, id: string, d: { title?: string; dealPrice?: number; targetCount?: number; maxCount?: number | null; perMemberMax?: number; endsAt?: string }) {
  const g = await gbRow(db, id);
  if (!['DRAFT', 'OPEN', 'SUCCESS'].includes(g.state)) throw new StateConflict('MKX_GB_STATE', '끝난 공동구매는 고치지 않습니다.');
  const draft = g.state === 'DRAFT';
  if (!draft && (d.dealPrice !== undefined || d.targetCount !== undefined || d.maxCount !== undefined || d.perMemberMax !== undefined)) {
    throw new StateConflict('MKX_GB_FIXED', '연 공동구매는 값 · 인원을 바꾸지 않습니다(이름 · 기한 늘리기만).');
  }
  /* DTO 의 빠진 칸은 undefined — 옛 값 위에 덮지 않음(규칙 11) */
  const title = d.title !== undefined ? cleanReason(d.title) : g.title;
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('MKX_GB_TITLE', '공동구매 이름은 2 ~ 80자입니다.');
  const deal = d.dealPrice !== undefined ? Number(d.dealPrice) : g.dealPrice;
  const target = d.targetCount !== undefined ? Number(d.targetCount) : g.targetCount;
  const max = d.maxCount !== undefined ? (d.maxCount === null ? null : Number(d.maxCount)) : g.maxCount;
  const per = d.perMemberMax !== undefined ? Number(d.perMemberMax) : g.perMemberMax;
  if (draft) {
    if (!Number.isInteger(deal) || deal <= 0 || deal >= g.listPrice) throw new PolicyViolation('MKX_GB_PRICE', '할인가는 1원 이상이고 정가보다 낮아야 합니다.');
    if (!Number.isInteger(target) || target < 2 || target > 10000) throw new PolicyViolation('MKX_GB_TARGET', '목표 인원은 2 ~ 10,000명입니다.');
    if (max !== null && (!Number.isInteger(max) || max < target || max > 100000)) throw new PolicyViolation('MKX_GB_MAX', '최대 인원은 목표 인원 이상 100,000명 이하입니다.');
    if (!Number.isInteger(per) || per < 1 || per > 10) throw new PolicyViolation('MKX_GB_QTY', '한 분 수량 상한은 1 ~ 10개입니다.');
  }
  let ends = g.endsAt;
  if (d.endsAt !== undefined) {
    const at = checkEnds(d.endsAt);
    if (!draft && at.getTime() < new Date(g.endsAt).getTime()) throw new StateConflict('MKX_GB_ENDS', '모집 중에는 기한을 앞당기지 않습니다(늘리기만).');
    ends = at.toISOString();
  }
  await db.query(
    `UPDATE mkx_groupbuys SET title = $2, deal_price = $3::bigint, target_count = $4::int, max_count = $5::int, per_member_max = $6::int, ends_at = $7::timestamptz WHERE id = $1::bigint`,
    [g.id, title, deal, target, max, per, ends]);
  return { ok: true, id: g.id, note: '고쳤습니다.' };
}

export async function gbOpen(db: DatabaseService, id: string) {
  const g = await gbRow(db, id);
  if (g.state !== 'DRAFT') throw new StateConflict('MKX_GB_STATE', '초안만 열 수 있습니다.');
  if (!(await gbOn(db))) throw new PolicyViolation('MKX_GB_OFF', '공동구매가 꺼져 있습니다(mkx.groupbuy) — 켠 뒤 여십시오.');
  if (g.sellerType !== 'DIRECT') throw new PolicyViolation('MKX_GB_PRODUCT', '공동구매는 직판 상품만 엽니다.');
  const [taken] = await db.query<{ id: string }>(`SELECT id::text AS id FROM mkx_groupbuys WHERE option_id = $1 AND state IN ('OPEN', 'SUCCESS') AND id <> $2::bigint`, [g.optionId, g.id]);
  if (taken) throw new StateConflict('MKX_GB_DUP', `같은 옵션으로 모집 중인 공동구매(${taken.id}번)가 있습니다.`);
  await db.query(`UPDATE mkx_groupbuys SET state = 'OPEN', opened_at = now() WHERE id = $1::bigint AND state = 'DRAFT'`, [g.id]);
  await mkxAudit(db, 'MKX_GB_OPEN', 'HLT_PRODUCT', { id: g.id, code: g.code });
  return { ok: true, id: g.id, note: `「${g.title}」 공동구매를 열었습니다 — 결제를 마친 참여자 ${g.targetCount}명이 모이면 확정됩니다.` };
}

/** 참여 주문마다 기존 취소 신청(hlt_returns CANCEL) · 회원 알림 — 실패 · 운영 취소가 같은 길 */
async function fileCancels(db: DatabaseService, g: { id: string; title: string }, why: string) {
  const joins = await db.query<{ id: string; accountId: string; orderId: string; orderNo: string; status: string }>(
    `SELECT j.id::text AS id, j.account_id AS "accountId", j.order_id AS "orderId", o.order_no AS "orderNo", o.status
       FROM mkx_gb_joins j JOIN hlt_orders o ON o.id = j.order_id
      WHERE j.groupbuy_id = $1::bigint AND j.cancel_return_id IS NULL ORDER BY j.id`, [g.id]);
  let filed = 0, skipped = 0;
  for (const j of joins) {
    if (['CANCELED', 'RETURNED'].includes(j.status)) {
      await db.query(`UPDATE mkx_gb_joins SET failed_at = coalesce(failed_at, now()) WHERE id = $1::bigint`, [j.id]);
      skipped++; continue;
    }
    try {
      await db.transaction(async () => {
        const [open] = await db.query<{ id: string }>(`SELECT id FROM hlt_returns WHERE order_id = $1 AND kind = 'CANCEL' AND state = 'REQUESTED' LIMIT 1`, [j.orderId]);
        const rid = open?.id ?? (await db.query<{ id: string }>(
          `INSERT INTO hlt_returns (order_id, kind, reason, detail) VALUES ($1, 'CANCEL', 'GROUPBUY_FAILED', $2) RETURNING id`,
          [j.orderId, `공동구매 ${g.id}번 「${g.title}」 ${why} — 결제 금액 전액 환불(정기 작업 mkx_groupbuy)`.slice(0, 500)]))[0].id;
        await db.query(`UPDATE mkx_gb_joins SET cancel_return_id = $2, failed_at = coalesce(failed_at, now()) WHERE id = $1::bigint`, [j.id, rid]);
        await db.query(`SELECT public.fn_notify($1, 'MALL_GB_FAILED', $2::jsonb, $3)`,
          [j.accountId, JSON.stringify({ title: g.title, orderNo: j.orderNo, why }), `/my/health/orders/${j.orderNo}`]);
      });
      filed++;
    } catch (e) {
      skipped++;
      await mkxAlert(db, 'MKX_GB_CANCEL_FAIL', 'WARN', `공동구매 취소 신청 못 넣음 — ${g.title} · 주문 ${j.orderNo} · ${String((e as Error)?.message ?? e).slice(0, 120)}`, `gb-cancel-${j.id}`, { groupbuy: g.id, order: j.orderNo });
    }
  }
  return { filed, skipped };
}

export async function gbCancel(db: DatabaseService, id: string, reason: string) {
  const g = await gbRow(db, id);
  const why = cleanReason(reason);
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('MKX_GB_REASON', '취소 사유는 2 ~ 200자입니다.');
  if (!['DRAFT', 'OPEN', 'SUCCESS'].includes(g.state)) throw new StateConflict('MKX_GB_STATE', '끝난 공동구매입니다.');
  const [u] = await db.query(`UPDATE mkx_groupbuys SET state = 'CANCELED', cancel_reason = $2, closed_at = now() WHERE id = $1::bigint AND state IN ('DRAFT', 'OPEN', 'SUCCESS') RETURNING id`, [g.id, why]);
  if (!u) throw new StateConflict('MKX_GB_STATE', '다른 사람이 먼저 바꿨습니다 — 새로 고침 하십시오.');
  const r = g.state === 'DRAFT' ? { filed: 0, skipped: 0 } : await fileCancels(db, g, '운영자가 취소하여');
  await mkxAudit(db, 'MKX_GB_CANCEL', 'HLT_PRODUCT', { id: g.id, reason: why, ...r });
  if (r.filed) await mkxAlert(db, 'MKX_GB_FAILED', 'WARN', `공동구매 취소 — ${g.title} · 취소 신청 ${r.filed}건 — 소개몰 › 주문 · 취소 처리에서 승인 · 환불`, `gb-${g.id}`, { groupbuy: g.id, filed: r.filed });
  return { ok: true, id: g.id, ...r, note: r.filed ? `취소했습니다 — 참여 주문 ${r.filed}건에 취소 신청을 넣었습니다(환불은 소개몰 › 주문 · 취소 처리에서).` : '취소했습니다.' };
}

/* ── 정기 작업 mkx_groupbuy(10분) ─────────────────────────────────── */
export async function gbRun(db: DatabaseService) {
  const out = { success: 0, failed: 0, closed: 0, filed: 0 };
  /* 확정 — 결제 참여자 ≥ 목표 */
  const ready = await db.query<{ id: string; title: string }>(
    `SELECT id::text AS id, title FROM mkx_groupbuys WHERE state = 'OPEN' AND ends_at > now() AND fn_mkx_gb_paid(id) >= target_count ORDER BY id LIMIT 50`);
  for (const g of ready) {
    const [u] = await db.query(`UPDATE mkx_groupbuys SET state = 'SUCCESS', success_at = now() WHERE id = $1::bigint AND state = 'OPEN' RETURNING id`, [g.id]);
    if (!u) continue;
    out.success++;
    const js = await db.query<{ accountId: string; orderNo: string }>(
      `SELECT j.account_id AS "accountId", o.order_no AS "orderNo" FROM mkx_gb_joins j JOIN hlt_orders o ON o.id = j.order_id
        WHERE j.groupbuy_id = $1::bigint AND o.paid_at IS NOT NULL AND o.status NOT IN ('CANCELED', 'RETURNED')`, [g.id]);
    for (const j of js) {
      await db.query(`SELECT public.fn_notify($1, 'MALL_GB_SUCCESS', $2::jsonb, $3)`, [j.accountId, JSON.stringify({ title: g.title, orderNo: j.orderNo }), `/my/health/orders/${j.orderNo}`]).catch(() => undefined);
    }
  }
  /* 기한 지남 — 확정이면 마감 · 아니면 실패(취소 신청) */
  const due = await db.query<{ id: string; title: string; state: string; paid: number; target: number }>(
    `SELECT id::text AS id, title, state, fn_mkx_gb_paid(id) AS paid, target_count AS target FROM mkx_groupbuys WHERE state IN ('OPEN', 'SUCCESS') AND ends_at <= now() ORDER BY id LIMIT 50`);
  for (const g of due) {
    if (g.state === 'SUCCESS' || g.paid >= g.target) {
      const [u] = await db.query(
        `UPDATE mkx_groupbuys SET state = CASE WHEN state = 'OPEN' THEN 'SUCCESS' ELSE state END, success_at = coalesce(success_at, now()) WHERE id = $1::bigint AND state IN ('OPEN', 'SUCCESS') RETURNING id`, [g.id]);
      if (u) await db.query(`UPDATE mkx_groupbuys SET state = 'CLOSED', closed_at = now() WHERE id = $1::bigint AND state = 'SUCCESS'`, [g.id]);
      out.closed++; continue;
    }
    const [u] = await db.query(`UPDATE mkx_groupbuys SET state = 'FAILED', closed_at = now() WHERE id = $1::bigint AND state = 'OPEN' RETURNING id`, [g.id]);
    if (!u) continue;
    out.failed++;
    const r = await fileCancels(db, g, `목표 인원(${g.target}명)을 채우지 못해(결제 ${g.paid}명)`);
    out.filed += r.filed;
    await mkxAlert(db, 'MKX_GB_FAILED', 'WARN', `공동구매 실패 — ${g.title} · 결제 ${g.paid}/${g.target}명 · 취소 신청 ${r.filed}건 — 소개몰 › 주문 · 취소 처리에서 승인 · 환불`, `gb-${g.id}`, { groupbuy: g.id, paid: g.paid, target: g.target, filed: r.filed });
  }
  return out;
}

export async function gbRunNow(db: DatabaseService) {
  const r = await gbRun(db);
  return { ok: true, ...r, note: `확정 ${r.success} · 실패 ${r.failed}(취소 신청 ${r.filed}) · 마감 ${r.closed}` };
}

/* ── 회원 ─────────────────────────────────────────────────────── */
export async function gbPublicList(db: DatabaseService) {
  const on = await gbOn(db);
  if (!on) return { on: false, items: [] as unknown[], note: '지금은 공동구매가 없습니다.' };
  const items = await db.query(
    `SELECT g.id::text AS id, g.title, g.state, g.list_price::float8 AS "listPrice", g.deal_price::float8 AS "dealPrice", g.target_count AS "targetCount", g.max_count AS "maxCount",
            g.per_member_max AS "perMemberMax", g.ends_at AS "endsAt", p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS "optionLabel",
            fn_mkx_gb_paid(g.id) AS paid, fn_mkx_gb_taken(g.id) AS taken
       FROM mkx_groupbuys g JOIN hlt_products p ON p.id = g.product_id JOIN hlt_product_options o ON o.id = g.option_id
      WHERE g.state IN ('OPEN', 'SUCCESS') AND g.ends_at > now() ORDER BY g.ends_at LIMIT 50`);
  return { on: true, items, note: '결제를 마친 참여자가 목표 인원에 닿으면 확정되어 보내 드립니다. 기한까지 모이지 않으면 주문을 취소하고 결제 금액을 모두 돌려 드립니다.' };
}

export async function gbJoin(db: DatabaseService, me: string, id: string, d: { qty?: number; addressId?: string }) {
  if (!(await gbOn(db))) throw new PolicyViolation('MKX_GB_OFF', '지금은 공동구매에 참여할 수 없습니다.');
  const [oo] = await db.query<{ open: boolean }>(ORDER_OPEN_SQL);
  if (!oo?.open) throw new PolicyViolation('ORDERS_CLOSED', ORDERS_CLOSED_MSG);
  const g = await gbRow(db, id);
  if (!['OPEN', 'SUCCESS'].includes(g.state) || new Date(g.endsAt).getTime() <= Date.now()) throw new StateConflict('MKX_GB_CLOSED', '모집 중인 공동구매가 아닙니다.');
  const qty = d.qty === undefined ? 1 : Number(d.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > g.perMemberMax) throw new PolicyViolation('MKX_GB_QTY', `한 분이 살 수 있는 수량은 ${g.perMemberMax}개까지입니다.`);
  const [mine] = await db.query<{ id: string }>(`SELECT id::text AS id FROM mkx_gb_joins WHERE groupbuy_id = $1::bigint AND account_id = $2`, [g.id, me]);
  if (mine) throw new StateConflict('MKX_GB_JOINED', '이미 참여한 공동구매입니다 — 내 주문에서 확인해 주십시오.');
  const [addr] = await db.query<{ id: string }>(
    d.addressId
      ? `SELECT id FROM hlt_addresses WHERE id::text = $1 AND account_id = $2 AND deleted_at IS NULL`
      : `SELECT id FROM hlt_addresses WHERE account_id = $2 AND deleted_at IS NULL AND ($1::text IS NULL) ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [d.addressId ?? null, me]);
  if (!addr) throw new PolicyViolation('BAD_ADDRESS', '배송지를 먼저 등록해 주십시오(나의공간 › 소개몰 › 배송지).');
  const [opt] = await db.query<{ withdrawalCode: string; stock: number; active: boolean }>(
    `SELECT p.withdrawal_code AS "withdrawalCode", o.stock, (o.is_active AND p.status = 'ON_SALE') AS active
       FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE o.id = $1`, [g.optionId]);
  if (!opt?.active) throw new StateConflict('NOT_ON_SALE', '판매 중이 아닌 상품입니다.');
  if (Number(opt.stock) < qty) throw new StateConflict('MKX_GB_STOCK', '재고가 모자랍니다.');
  const goods = g.dealPrice * qty;
  const ship = sellerShipFee({ type: g.sellerType ?? 'DIRECT' }, goods);
  return db.transaction(async () => {
    const [o] = await db.query<{ id: string; orderNo: string; total: number }>(
      `INSERT INTO hlt_orders (order_no, account_id, address_id, goods_amount, ship_fee, total, ship_memo)
       VALUES (fn_next_hlt_order_no(), $1, $2, $3::bigint, $4::bigint, $5::bigint, $6)
       RETURNING id, order_no AS "orderNo", total::float8 AS total`,
      [me, addr.id, goods, ship, goods + ship, `공동구매 ${g.id}번`]);
    await db.query(
      `INSERT INTO hlt_order_items (order_id, product_id, option_id, qty, unit_price, amount, withdrawal_code) VALUES ($1, $2, $3, $4::int, $5::bigint, $6::bigint, $7)`,
      [o.id, g.productId, g.optionId, qty, g.dealPrice, goods, opt.withdrawalCode]);
    await db.query(`INSERT INTO mkx_gb_joins (groupbuy_id, account_id, order_id, qty) VALUES ($1::bigint, $2, $3, $4::int)`, [g.id, me, o.id, qty]);
    return { ok: true, orderNo: o.orderNo, total: o.total, payUrl: `/my/health/orders/${o.orderNo}`,
      note: '공동구매에 참여했습니다 — 내 주문에서 결제를 마치면 참여 인원에 들어갑니다. 목표 인원이 모이면 보내 드리고, 모이지 않으면 결제 금액을 모두 돌려 드립니다.' };
  });
}

export async function gbMine(db: DatabaseService, me: string) {
  return db.query(
    `SELECT g.id::text AS id, g.title, g.state, g.deal_price::float8 AS "dealPrice", g.target_count AS "targetCount", g.ends_at AS "endsAt",
            fn_mkx_gb_paid(g.id) AS paid, o.order_no AS "orderNo", o.status AS "orderStatus", (o.paid_at IS NOT NULL) AS "orderPaid", j.qty, j.created_at AS "joinedAt"
       FROM mkx_gb_joins j JOIN mkx_groupbuys g ON g.id = j.groupbuy_id JOIN hlt_orders o ON o.id = j.order_id
      WHERE j.account_id = $1 ORDER BY j.id DESC LIMIT 50`, [me]);
}

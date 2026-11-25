/* e3 (docs/010) 소개뱅크 src/modules/acct/stock.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import type { Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.395 (D245 · docs/532) 직판 재고 수불부 — 이동평균 · 매출원가 전표
 *
 *   판매용 재고 수량(hlt_product_options.stock · 주문 때 빠지고 취소 · 반품 때 돌아옴)은 그대로 둡니다.
 *   이 수불부는 **회계용 원가 장부**입니다 — 옵션(주문 · 재고 단위)마다 들어옴 · 나감 · 남은 수량 · 남은 금액 · 평균 단가.
 *
 *   IN        매입 입고(단가 필수 · ⑫ 매입 번호 purchase_id 는 숫자만 — 매입 전표가 이미 「상품」으로 잡았으면 입고 전표 없음)
 *   OUT_SALE  직판 결제 승인 때(소개몰 직판 매출 전표 MALL_SALE 과 같은 시점) 주문 줄마다 자동 · 단가 = 그때 평균
 *   RETURN    취소 · 반품으로 판매용 재고가 돌아온 때(hlt_orders.restocked_at) 자동 · 나갈 때 원가 그대로 되돌림
 *             개봉 반품(restock_skipped = OPENED · 재판매 금지)은 돌아오지 않으므로 RETURN 없음(원가는 매출원가에 남음)
 *   ADJUST    실사 조정(SUPER · 사유) — 늘림은 지금 평균 단가(재고가 없으면 단가 입력) · 줄임은 0 아래로 못 감
 *
 *   이동평균: 들어올 때 평균 = (남은 금액 + 들어온 금액) ÷ (남은 수량 + 들어온 수량).
 *   재고가 모자란 채 팔리면 판매는 막지 않고 모자란 몫은 원가 0 으로 남김(zero_cost) → 운영 알림 STOCK_NEGATIVE.
 *   계산은 DB 트리거(fn_acct_stock_move · 옵션마다 잠금)가 함 — 앱은 종류 · 옵션 · 수량 · 단가만 넣습니다. 쌓기만.
 * ------------------------------------------------------------------- */

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

/** 직판 옵션인지 · 상품 코드 · 이름 */
async function directOption(db: DatabaseService, optionId: string) {
  const [o] = await db.query<{ id: string; code: string; name: string; label: string }>(
    `SELECT o.id::text AS id, p.code, p.name, fn_hlt_option_label(o.months, o.tag) AS label
       FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
      WHERE o.id::text = $1`, [optionId]);
  if (!o) throw new NotFound('직판 상품 옵션이 아닙니다.');
  return o;
}

/** GET /admin/acct/stock — 옵션마다 수량 · 평균 단가 · 재고 금액 · 판매용 재고와 차이 */
export async function stockList(db: DatabaseService) {
  const items = await db.query<Record<string, unknown>>(
    `SELECT p.code, p.name, o.id::text AS "optionId", fn_hlt_option_label(o.months, o.tag) AS label, o.is_active AS active,
            o.stock AS "shopQty", coalesce(m.qty_after, 0) AS qty, coalesce(m.avg_cost_after, 0)::float8 AS "avgCost", coalesce(m.amount_after, 0)::bigint AS amount,
            m.moved_on::text AS "lastMove",
            (SELECT count(*)::int FROM acct_stock_moves z WHERE z.option_id = o.id AND z.zero_cost) AS "zeroCost"
       FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
       LEFT JOIN LATERAL (SELECT qty_after, avg_cost_after, amount_after, moved_on FROM acct_stock_moves x WHERE x.option_id = o.id ORDER BY x.id DESC LIMIT 1) m ON true
      WHERE o.is_active OR m.qty_after IS NOT NULL
      ORDER BY p.name, o.sort LIMIT 500`);
  const list = items.map((r) => ({ ...r, qty: n(r.qty), shopQty: n(r.shopQty), amount: n(r.amount), avgCost: n(r.avgCost), zeroCost: n(r.zeroCost), diff: n(r.shopQty) - n(r.qty) }));
  return {
    items: list,
    total: { amount: list.reduce((a, r) => a + r.amount, 0), qty: list.reduce((a, r) => a + r.qty, 0), zeroCost: list.reduce((a, r) => a + n(r.zeroCost), 0) },
    note: '회계용 원가 장부(이동평균)입니다. 「판매용」은 쇼핑몰 재고 수량 — 차이가 있으면 입고를 적지 않았거나 실사 조정이 필요합니다.',
  };
}

/** GET /admin/acct/stock/{code}/moves?ym= — 그 상품(옵션 모두)의 그 달 수불 */
export async function stockMoves(db: DatabaseService, code: string, ym: string) {
  const [p] = await db.query<{ id: string; name: string }>(
    `SELECT p.id::text AS id, p.name FROM svc.hlt_products p JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE p.code = $1`, [code]);
  if (!p) throw new NotFound('직판 상품이 아닙니다.');
  const moves = await db.query(
    `SELECT m.id::text AS id, m.moved_on::text AS date, m.kind, m.option_id::text AS "optionId", fn_hlt_option_label(o.months, o.tag) AS label,
            m.qty, m.unit_cost::float8 AS "unitCost", m.amount::bigint AS amount, m.qty_after AS "qtyAfter", m.amount_after::bigint AS "amountAfter",
            m.avg_cost_after::float8 AS "avgAfter", m.zero_cost AS "zeroCost", m.purchase_id::text AS "purchaseId", m.source_key AS "sourceKey", m.note
       FROM acct_stock_moves m JOIN svc.hlt_product_options o ON o.id = m.option_id
      WHERE m.product_id::text = $1 AND to_char(m.moved_on, 'YYYY-MM') = $2 ORDER BY m.id LIMIT 1000`, [p.id, ym]);
  return { code, name: p.name, ym, moves };
}

/** POST /admin/acct/stock/in — 매입 입고(SUPER · PAYOUT) */
export async function stockIn(db: DatabaseService, b: { optionId: string; qty: number; unitCost: number; movedOn?: string; purchaseId?: string; note?: string }, actor: string | null) {
  const o = await directOption(db, b.optionId);
  const day = b.movedOn || kstToday();
  if (day > kstToday()) throw new PolicyViolation('ACCT_STOCK', '입고 날짜는 오늘까지입니다.');
  const [r] = await db.query<Record<string, unknown>>(
    `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key, purchase_id, note, created_by)
     VALUES ($1::uuid, $2::date, 'IN', $3, $4, 'M:' || gen_random_uuid()::text, $5::bigint, nullif($6, ''), $7)
     RETURNING id::text AS id, qty_after AS "qtyAfter", amount_after::bigint AS "amountAfter", avg_cost_after::float8 AS "avgAfter", amount::bigint AS amount`,
    [b.optionId, day, b.qty, b.unitCost, b.purchaseId || null, (b.note ?? '').trim().slice(0, 200), actor]);
  return { ok: true, ...r, code: o.code,
    note: b.purchaseId
      ? `입고했습니다 — 남은 ${r!.qtyAfter}개 · 평균 ${Math.round(n(r!.avgAfter)).toLocaleString('ko-KR')}원. 매입 전표가 상품으로 잡아 입고 전표는 만들지 않습니다.`
      : `입고했습니다 — 남은 ${r!.qtyAfter}개 · 평균 ${Math.round(n(r!.avgAfter)).toLocaleString('ko-KR')}원.` };
}

/** POST /admin/acct/stock/adjust — 실사 조정(SUPER · 사유 · 줄임은 0 아래로 못 감) */
export async function stockAdjust(db: DatabaseService, b: { optionId: string; qty: number; unitCost?: number; reason: string }, actor: string | null) {
  const o = await directOption(db, b.optionId);
  const [r] = await db.query<Record<string, unknown>>(
    `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, unit_cost, source_key, note, created_by)
     VALUES ($1::uuid, $2::date, 'ADJUST', $3, $4, 'A:' || gen_random_uuid()::text, $5, $6)
     RETURNING id::text AS id, qty_after AS "qtyAfter", amount::bigint AS amount, avg_cost_after::float8 AS "avgAfter"`,
    [b.optionId, kstToday(), b.qty, b.unitCost ?? null, b.reason, actor]);
  return { ok: true, ...r, code: o.code, note: `실사 조정했습니다 — 남은 ${r!.qtyAfter}개 · 금액 ${n(r!.amount).toLocaleString('ko-KR')}원.` };
}

/** 정기 작업 acct_stock(매시간 · acct_journal 앞) — 직판 결제 → 출고 · 취소 · 반품 → 반입 · 모자란 출고는 알림 */
export async function stockJob(db: DatabaseService) {
  let out = 0, back = 0; const failed: string[] = [];
  /* 출고 — 직판 결제 승인(MALL_SALE 과 같은 근거) · 주문 줄마다 · 옵션 없는 옛 줄은 뺌 */
  const sales = await db.query<{ id: string; option_id: string; qty: number; day: string }>(
    `SELECT it.id::text AS id, it.option_id::text AS option_id, it.qty, (p.approved_at AT TIME ZONE 'Asia/Seoul')::date::text AS day
       FROM svc.hlt_payments p JOIN svc.hlt_orders od ON od.id = p.order_id JOIN svc.hlt_sellers s ON s.id = od.seller_id AND s.type = 'DIRECT'
       JOIN svc.hlt_order_items it ON it.order_id = od.id
      WHERE p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
        AND it.option_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM acct_stock_moves m WHERE m.kind = 'OUT_SALE' AND m.source_key = it.id::text)
      ORDER BY p.approved_at, it.id LIMIT 500`);
  for (const s of sales) {
    try {
      const r = await db.query(
        `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key) VALUES ($1::uuid, $2::date, 'OUT_SALE', $3, $4)
         ON CONFLICT (kind, source_key) DO NOTHING RETURNING id`, [s.option_id, s.day, -Math.abs(n(s.qty)), s.id]);
      out += r.length;
    } catch (e) { failed.push(`OUT ${s.id}: ${String((e as Error)?.message ?? e).slice(0, 100)}`); }
  }
  /* 반입 — 판매용 재고가 돌아온 주문(restocked_at)의 줄 · 나갈 때 원가 그대로 */
  const backs = await db.query<{ id: string; option_id: string; qty: number; amount: string; day: string }>(
    `SELECT m.source_key AS id, m.option_id::text AS option_id, -m.qty AS qty, (-m.amount)::text AS amount, (od.restocked_at AT TIME ZONE 'Asia/Seoul')::date::text AS day
       FROM acct_stock_moves m JOIN svc.hlt_order_items it ON it.id::text = m.source_key JOIN svc.hlt_orders od ON od.id = it.order_id
      WHERE m.kind = 'OUT_SALE' AND od.restocked_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM acct_stock_moves r WHERE r.kind = 'RETURN' AND r.source_key = m.source_key)
      ORDER BY od.restocked_at, m.id LIMIT 500`);
  for (const b of backs) {
    try {
      const r = await db.query(
        `INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, amount, source_key) VALUES ($1::uuid, $2::date, 'RETURN', $3, $4::bigint, $5)
         ON CONFLICT (kind, source_key) DO NOTHING RETURNING id`, [b.option_id, b.day, n(b.qty), b.amount, b.id]);
      back += r.length;
    } catch (e) { failed.push(`RETURN ${b.id}: ${String((e as Error)?.message ?? e).slice(0, 100)}`); }
  }
  /* 재고 없이 나간 것 — 지난 알림 뒤 새로 생겼고 풀리지 않은 알림이 없으면 하나 */
  const [z] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM acct_stock_moves
      WHERE zero_cost AND created_at > coalesce((SELECT max(raised_at) FROM ops_alerts WHERE alert_code = 'STOCK_NEGATIVE'), '-infinity'::timestamptz)`);
  let alerted = false;
  if (n(z?.n) > 0) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'STOCK_NEGATIVE', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'STOCK_NEGATIVE' AND resolved_at IS NULL)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`직판 재고가 모자란 채 팔린 줄 ${n(z?.n)}개 — 원가 0 으로 남겼습니다. 입고를 적거나 실사 조정하십시오(회계 › 재고)`, JSON.stringify({ count: n(z?.n) })]);
    alerted = r.length > 0;
  }
  return { out, back, alerted, failed: failed.slice(0, 10), failedCount: failed.length };
}

/* ── 전표(journal.ts SOURCES 끝에 이어 붙임) ──
 *   at = 수불 날짜 0시(한국) — 전표 날짜가 수불 날짜와 같게 · 시작일 뒤만 · 금액 0 줄(원가 0 출고)은 전표 없음 */
const MV = (kind: string, extra: string, name: string) => `
  SELECT m.id::text AS key, (m.moved_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, m.amount::bigint AS amt, m.qty, p.name AS party, fn_hlt_option_label(o.months, o.tag) AS label
    FROM acct_stock_moves m JOIN svc.hlt_product_options o ON o.id = m.option_id JOIN svc.hlt_products p ON p.id = m.product_id
   WHERE m.kind = '${kind}' AND m.amount <> 0 ${extra} AND (m.moved_on::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
     AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = '${name}' AND e.source_key = m.id::text)
   ORDER BY m.id LIMIT 500`;
const abs = (v: unknown) => Math.abs(n(v));

export const STOCK_SOURCES: Source[] = [
  {
    name: 'STOCK_IN', label: '직판 재고 입고(매입 번호 없음)',
    sql: MV('IN', 'AND m.purchase_id IS NULL', 'STOCK_IN'),
    build: (r) => ({ memo: `재고 입고 ${r.label ?? ''} ${r.qty}개`.trim(), evidence: 'NONE', lines: [{ role: 'INVENTORY', debit: abs(r.amt), credit: 0 }, { role: 'AP', debit: 0, credit: abs(r.amt) }] }),
  },
  {
    name: 'COGS', label: '직판 매출원가(출고)',
    sql: MV('OUT_SALE', '', 'COGS'),
    build: (r) => ({ memo: `매출원가 ${r.label ?? ''} ${abs(r.qty)}개`.trim(), evidence: 'NONE', lines: [{ role: 'COGS', debit: abs(r.amt), credit: 0 }, { role: 'INVENTORY', debit: 0, credit: abs(r.amt) }] }),
  },
  {
    name: 'COGS_RETURN', label: '직판 매출원가 되돌림(취소 · 반품 반입)',
    sql: MV('RETURN', '', 'COGS_RETURN'),
    build: (r) => ({ memo: `매출원가 되돌림 ${r.label ?? ''} ${abs(r.qty)}개`.trim(), evidence: 'NONE', lines: [{ role: 'INVENTORY', debit: abs(r.amt), credit: 0 }, { role: 'COGS', debit: 0, credit: abs(r.amt) }] }),
  },
  {
    name: 'STOCK_ADJUST', label: '직판 재고 실사 조정',
    sql: MV('ADJUST', '', 'STOCK_ADJUST'),
    build: (r) => n(r.amt) > 0
      ? { memo: `실사 조정 늘림 ${r.label ?? ''} ${r.qty}개`.trim(), evidence: 'NONE', lines: [{ role: 'INVENTORY', debit: n(r.amt), credit: 0 }, { role: 'COGS', debit: 0, credit: n(r.amt) }] }
      : { memo: `실사 조정 줄임 ${r.label ?? ''} ${abs(r.qty)}개`.trim(), evidence: 'NONE', lines: [{ role: 'COGS', debit: abs(r.amt), credit: 0 }, { role: 'INVENTORY', debit: 0, credit: abs(r.amt) }] },
  },
];

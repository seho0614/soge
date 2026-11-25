/* e3 (docs/010) 소개뱅크 src/modules/health/health-benefit.ts 에서 BENEFIT_SOURCES 와 그것이 쓰는 선언만 옮김(R3) — 글자 그대로 · R1 · R2 · 나머지는 소개뱅크에 남음 */
import { Source, cr, dr, reverse, vatSplit } from '../acct/journal';

const n = (v: unknown) => Number(v ?? 0);

function pointUseLines(amount: number, exempt: number) {
  const ex = Math.max(0, Math.min(amount, exempt));
  return [dr('MALL_POINT_LIAB', amount), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(amount - ex > 0 ? [cr('REV_MALL', amount - ex)] : [])];
}

function giftUseLines(amount: number, exempt: number) {
  const ex = Math.max(0, Math.min(amount, exempt));
  const v = vatSplit(amount - ex);
  return [dr('GIFT_ADV', amount), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(v.supply > 0 ? [cr('REV_MALL', v.supply)] : []), ...(v.vat > 0 ? [cr('VAT_OUT', v.vat)] : [])];
}

function giftCloseLines(kind: string, gkind: string, amount: number) {
  const to = kind === 'REFUND' ? 'CASH' : gkind === 'PROMO' ? 'EXP_MALL_PROMO' : kind === 'VOID' ? 'CASH' : 'INC_GIFT_LAPSE';
  return [dr('GIFT_ADV', amount), cr(to, amount)];
}

export const BENEFIT_SOURCES: Source[] = [
  {
    name: 'MALL_POINT_EARN', label: '소개몰 적립금 적립 · 운영 지급(판매촉진비)',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, t.kind, o.order_no AS no, NULL::text AS party
            FROM svc.hlt_point_txns t LEFT JOIN svc.hlt_orders o ON o.id = t.order_id
           WHERE t.kind IN ('EARN', 'ADJUST_ADD') AND t.created_at >= fn_acct_from() AND fn_acct_stub_ok(coalesce((SELECT bool_or(p.stub) FROM svc.hlt_payments p WHERE p.order_id = t.order_id AND p.approved_at IS NOT NULL), false))
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_EARN' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 ${r.kind === 'ADJUST_ADD' ? '운영 지급' : '적립'} ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: [dr('EXP_MALL_PROMO', n(r.amount)), cr('MALL_POINT_LIAB', n(r.amount))] }),
  },
  {
    name: 'MALL_POINT_LAPSE', label: '소개몰 적립금 소멸 · 회수(환입)',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, t.kind, o.order_no AS no, NULL::text AS party
            FROM svc.hlt_point_txns t LEFT JOIN svc.hlt_point_lots l ON l.id = t.lot_id LEFT JOIN svc.hlt_orders o ON o.id = coalesce(t.order_id, l.order_id)
           WHERE t.kind IN ('EXPIRE', 'REVOKE', 'ADJUST_SUB') AND t.created_at >= fn_acct_from() AND fn_acct_stub_ok(coalesce((SELECT bool_or(p.stub) FROM svc.hlt_payments p WHERE p.order_id = coalesce(t.order_id, l.order_id) AND p.approved_at IS NOT NULL), false))
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_LAPSE' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 ${r.kind === 'EXPIRE' ? '소멸' : r.kind === 'REVOKE' ? '반품 회수' : '운영 회수'} ${r.no ?? ''}`.trim(), evidence: 'NONE',
      lines: [dr('MALL_POINT_LIAB', n(r.amount)), cr('EXP_MALL_PROMO', n(r.amount))] }),
  },
  {
    name: 'MALL_POINT_USE', label: '소개몰 적립금 사용(매출)',
    sql: `SELECT p.id::text AS key, p.approved_at AS at, o.point_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total, 0), o.point_amount)::bigint AS exempt
            FROM svc.hlt_payments p JOIN svc.hlt_orders o ON o.id = p.order_id JOIN svc.hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.point_amount > 0 AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_USE' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 사용 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: pointUseLines(n(r.amount), n(r.exempt)) }),
  },
  {
    name: 'MALL_POINT_USE_CANCEL', label: '소개몰 적립금 사용 되돌림(취소 · 반품)',
    sql: `SELECT p.id::text AS key, (SELECT max(t.created_at) FROM svc.hlt_point_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE') AS at,
                 o.point_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total, 0), o.point_amount)::bigint AS exempt
            FROM svc.hlt_payments p JOIN svc.hlt_orders o ON o.id = p.order_id JOIN svc.hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.point_amount > 0 AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM svc.hlt_point_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE')
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_USE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_POINT_USE_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 적립금 사용 되돌림 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: reverse(pointUseLines(n(r.amount), n(r.exempt))) }),
  },
  {
    name: 'MALL_GIFT_ISSUE', label: '소개몰 상품권 발행(선수금)',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, g.kind AS gkind, g.batch_no AS no, g.buyer_name AS party
            FROM svc.hlt_giftcard_txns t JOIN svc.hlt_giftcards g ON g.id = t.card_id
           WHERE t.kind = 'ISSUE' AND t.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_ISSUE' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 ${r.gkind === 'PROMO' ? '판촉 발행' : '판매'} ${r.no ?? ''}`.trim(), evidence: 'NONE',
      lines: [dr(r.gkind === 'PROMO' ? 'EXP_MALL_PROMO' : 'CASH', n(r.amount)), cr('GIFT_ADV', n(r.amount))] }),
  },
  {
    name: 'MALL_GIFT_USE', label: '소개몰 상품권 사용(매출)',
    sql: `SELECT p.id::text AS key, p.approved_at AS at, o.gift_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total - o.point_amount, 0), o.gift_amount)::bigint AS exempt
            FROM svc.hlt_payments p JOIN svc.hlt_orders o ON o.id = p.order_id JOIN svc.hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.gift_amount > 0 AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_USE' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 사용 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: giftUseLines(n(r.amount), n(r.exempt)) }),
  },
  {
    name: 'MALL_GIFT_USE_CANCEL', label: '소개몰 상품권 사용 되돌림(취소 · 반품)',
    sql: `SELECT p.id::text AS key, (SELECT max(t.created_at) FROM svc.hlt_giftcard_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE') AS at,
                 o.gift_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 least(greatest((coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0)) - o.total - o.point_amount, 0), o.gift_amount)::bigint AS exempt
            FROM svc.hlt_payments p JOIN svc.hlt_orders o ON o.id = p.order_id JOIN svc.hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.gift_amount > 0 AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM svc.hlt_giftcard_txns t WHERE t.order_id = o.id AND t.kind = 'RESTORE')
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_USE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_USE_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 사용 되돌림 ${r.no ?? ''}`.trim(), evidence: 'NONE', lines: reverse(giftUseLines(n(r.amount), n(r.exempt))) }),
  },
  {
    name: 'MALL_GIFT_CLOSE', label: '소개몰 상품권 소멸 · 무효 · 잔액 환불',
    sql: `SELECT t.id::text AS key, t.created_at AS at, t.amount::bigint AS amount, t.kind, g.kind AS gkind, g.batch_no AS no, g.buyer_name AS party
            FROM svc.hlt_giftcard_txns t JOIN svc.hlt_giftcards g ON g.id = t.card_id
           WHERE t.kind IN ('EXPIRE', 'VOID', 'REFUND') AND t.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_GIFT_CLOSE' AND e.source_key = t.id::text)
           ORDER BY t.id LIMIT 500`,
    build: (r) => ({ memo: `소개몰 상품권 ${r.kind === 'VOID' ? '무효' : r.kind === 'REFUND' ? '잔액 환불' : '소멸'} ${r.no ?? ''}`.trim(), evidence: 'NONE',
      lines: giftCloseLines(String(r.kind ?? 'EXPIRE'), String(r.gkind ?? 'SOLD'), n(r.amount)) }),
  },
];

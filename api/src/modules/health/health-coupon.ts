/* e3 (docs/010) 소개뱅크 src/modules/health/health-coupon.ts 에서 COUPON_SOURCES 와 그것이 쓰는 선언만 옮김(R3) — 글자 그대로 · R1 · R2 · 나머지는 소개뱅크에 남음 */
import { Source, cr, dr, reverse } from '../acct/journal';

const n = (v: unknown) => Number(v ?? 0);

function discountLines(amount: number, exempt: number) {
  const ex = Math.max(0, Math.min(amount, exempt));
  const taxSupply = Math.round((amount - ex) / 1.1);   // 과세 몫은 부가세를 뺀 공급가만 다시 나눔(부가세는 낸 금액 기준 그대로)
  return [dr('SALES_DISC', ex + taxSupply), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(taxSupply > 0 ? [cr('REV_MALL', taxSupply)] : [])];
}

export const COUPON_SOURCES: Source[] = [
  {
    name: 'MALL_DISCOUNT', label: '소개몰 쿠폰 할인(매출할인)',
    sql: `SELECT p.id::text AS key, o.discount_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 (coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * o.discount_amount / nullif(o.goods_amount, 0))::bigint AS exempt, p.approved_at AS at
            FROM svc.hlt_payments p JOIN svc.hlt_orders o ON o.id = p.order_id JOIN svc.hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.discount_amount > 0 AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_DISCOUNT' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 쿠폰 할인 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG', lines: discountLines(n(r.amount), n(r.exempt)) }),
  },
  {
    name: 'MALL_DISCOUNT_CANCEL', label: '소개몰 쿠폰 할인 되돌림(취소 · 환불)',
    sql: `SELECT p.id::text AS key, o.discount_amount::bigint AS amount, o.order_no AS no, NULL::text AS party,
                 (coalesce((SELECT sum(it.amount) FROM svc.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * o.discount_amount / nullif(o.goods_amount, 0))::bigint AS exempt, p.canceled_at AS at
            FROM svc.hlt_payments p JOIN svc.hlt_orders o ON o.id = p.order_id JOIN svc.hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE o.discount_amount > 0 AND p.canceled_at IS NOT NULL AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_REFUND' AND e.source_key = p.id::text)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_DISCOUNT' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_DISCOUNT_CANCEL' AND e.source_key = p.id::text)
           ORDER BY p.canceled_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 쿠폰 할인 되돌림 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG', lines: reverse(discountLines(n(r.amount), n(r.exempt))) }),
  },
];

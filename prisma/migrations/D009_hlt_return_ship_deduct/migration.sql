-- =====================================================================
-- D009 — 소개뱅크몰 반품 배송비 차감 (2026-10-02 사장님 결정 「단순 변심은 왕복 배송비 차감」)
--
--   고객 사정(단순 변심 CHANGE_MIND · 잘못 주문 WRONG_ORDER)으로 **반품**(RETURN)하면
--   왕복 배송비(편도 3,000원 × 2 = 6,000원)를 환불 금액에서 뺍니다. 금액은 src/modules/health/health-policy.ts.
--   발송 전 취소 · 판매자 사유(파손 · 오배송 · 표시와 다름 · 지연)는 빼지 않습니다 — 아래 제약이 집행합니다.
--   근거: 전자상거래법 18조 9항(반환 비용은 소비자 부담) · 10항(표시와 다르면 사업자 부담).
--
--   재실행 안전(IF NOT EXISTS · DROP CONSTRAINT IF EXISTS).
-- =====================================================================

ALTER TABLE public.hlt_returns ADD COLUMN IF NOT EXISTS ship_deduction integer NOT NULL DEFAULT 0;

ALTER TABLE public.hlt_returns DROP CONSTRAINT IF EXISTS ck_hlt_returns_ship_deduction;
ALTER TABLE public.hlt_returns ADD CONSTRAINT ck_hlt_returns_ship_deduction CHECK (
  ship_deduction >= 0
  AND (ship_deduction = 0 OR (kind = 'RETURN' AND reason IN ('CHANGE_MIND', 'WRONG_ORDER')))
);

COMMENT ON COLUMN public.hlt_returns.ship_deduction IS
  '환불 때 뺀 반품 배송비(원). 고객 사정 반품만 0 보다 큼 — 환불액 + 이 값 = 결제액 (D009).';

-- 감시 뷰: 환불 완료 신청의 환불액 + 차감액이 결제액과 다른 건. **0이어야 정상**.
CREATE OR REPLACE VIEW public.v_hlt_refund_mismatch AS
SELECT r.id, r.order_id, r.refund_amount, r.ship_deduction, p.amount AS paid
  FROM hlt_returns r
  JOIN hlt_payments p ON p.order_id = r.order_id AND p.payment_key IS NOT NULL AND p.state = 'CANCELED'
 WHERE r.state = 'REFUNDED'
   AND r.refund_amount + r.ship_deduction <> p.amount;
COMMENT ON VIEW public.v_hlt_refund_mismatch IS
  '환불액 + 반품 배송비 차감 ≠ 결제액인 환불. **0이어야 정상** — 돈이 덜 나갔거나 더 나갔다는 뜻입니다.';

-- v10.31 (10/10 점검 결함 · SB-HLT-MYO-020 「주문 시각 어긋남」) — 주문 2026-10-09 19:54 인데 배송 완료 2026-09-29 · 발송 「-」.
--   원인: 시험 스크립트가 발송 · 배송 완료 시각만 과거로 돌리고 주문 · 결제 시각은 그대로 둠(배송 완료 시각 = 구매확정 · 반품 기한의 기준).
--   이제 DB 가 시각 순서를 지킵니다 — 결제 ≥ 주문, 발송 ≥ 결제(없으면 주문), 배송 완료 ≥ 발송, 배송 완료에는 발송 시각이 있어야 함.
--   시각 칸이 바뀔 때만 봅니다(예전 행의 다른 칸을 고치는 것은 막지 않음).
CREATE OR REPLACE FUNCTION public.fn_hlt_order_time_guard() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paid_at IS NOT NULL AND NEW.paid_at < NEW.created_at - interval '1 minute' THEN
    RAISE EXCEPTION 'HLT_TIME_ORDER: 결제 시각(%)이 주문 시각(%)보다 앞섭니다', NEW.paid_at, NEW.created_at;
  END IF;
  IF NEW.shipped_at IS NOT NULL AND NEW.shipped_at < coalesce(NEW.paid_at, NEW.created_at) - interval '1 minute' THEN
    RAISE EXCEPTION 'HLT_TIME_ORDER: 발송 시각(%)이 결제 · 주문 시각(%)보다 앞섭니다', NEW.shipped_at, coalesce(NEW.paid_at, NEW.created_at);
  END IF;
  IF NEW.delivered_at IS NOT NULL AND NEW.shipped_at IS NULL THEN
    RAISE EXCEPTION 'HLT_TIME_ORDER: 발송 시각 없이 배송 완료 시각을 넣을 수 없습니다';
  END IF;
  IF NEW.delivered_at IS NOT NULL AND NEW.delivered_at < NEW.shipped_at THEN
    RAISE EXCEPTION 'HLT_TIME_ORDER: 배송 완료 시각(%)이 발송 시각(%)보다 앞섭니다', NEW.delivered_at, NEW.shipped_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_order_time_guard ON public.hlt_orders;
CREATE TRIGGER trg_hlt_order_time_guard
  BEFORE INSERT OR UPDATE OF created_at, paid_at, shipped_at, delivered_at ON public.hlt_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_order_time_guard();
COMMENT ON FUNCTION public.fn_hlt_order_time_guard() IS '소개몰 주문 시각 순서(주문 ≤ 결제 ≤ 발송 ≤ 배송 완료) — v10.31';

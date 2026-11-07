-- =====================================================================
-- D185 — 소개몰 개봉 반품 재고 대장(보관 · 폐기 · 판매자 반송 · 재판매 없음) (v10.208 · 2026-11-07)
--
--   대표 「개봉 반품 — 별도 재고」(mall-return-refund 미정 2) → 법무 「식품 · 화장품은 재판매 금지」(11/7).
--   전에는 개봉 반품을 재고로 되돌리지 않는 것만 있었고(restock_skipped = 'OPENED' · D006) 상품이 어디로 갔는지 기록이 없었음.
--
--   ① 개봉 반품 재고 대장 hlt_open_stock — 반품 승인(개봉)마다 주문 줄별 한 행.
--      처리: HOLD 보관(폐기 대기) · DISCARDED 폐기 · TO_SELLER 판매자에게 반송.
--      입점(TENANT) 상품은 반송만 · 직판(DIRECT · BRAND)은 보관 또는 폐기로 시작 · 보관 → 폐기만(한 방향).
--   ② **재판매 상태는 없음** — 소개몰은 건강식품 · 화장품만 팔고 둘 다 개봉품 재판매 금지(법무 확인 11/7).
--      재고로 되돌리지 않는 것은 D006 그대로.
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hlt_open_stock (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id       uuid NOT NULL REFERENCES public.hlt_returns(id),
  order_id        uuid NOT NULL REFERENCES public.hlt_orders(id),
  order_item_id   uuid NOT NULL REFERENCES public.hlt_order_items(id),
  product_id      uuid NOT NULL REFERENCES public.hlt_products(id),
  option_id       uuid REFERENCES public.hlt_product_options(id),
  qty             int  NOT NULL CHECK (qty > 0),
  state           text NOT NULL CHECK (state IN ('HOLD', 'DISCARDED', 'TO_SELLER')),
  note            text CHECK (note IS NULL OR length(note) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid,
  CONSTRAINT ux_hlt_open_stock_item UNIQUE (order_item_id)
);
CREATE INDEX IF NOT EXISTS ix_hlt_open_stock_state ON public.hlt_open_stock (state, created_at DESC);
COMMENT ON TABLE public.hlt_open_stock IS
  '소개몰 개봉 반품 재고 대장(D185) — 보관(폐기 대기) · 폐기 · 판매자 반송. 식품 · 화장품 개봉품은 재판매 금지(법무 11/7)라 판매 상태 없음. 지우지 않음 · 보관 → 폐기만';

CREATE OR REPLACE FUNCTION public.fn_hlt_open_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLTOS: 개봉 반품 재고 기록은 지울 수 없습니다.'; END IF;
  SELECT s.type INTO v_type FROM public.hlt_products p LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id WHERE p.id = NEW.product_id;
  IF TG_OP = 'INSERT' THEN
    IF v_type = 'TENANT' AND NEW.state <> 'TO_SELLER' THEN
      RAISE EXCEPTION 'HLTOS: 입점 판매자 상품의 개봉 반품은 판매자에게 돌려보냅니다.';
    END IF;
    IF coalesce(v_type, 'DIRECT') <> 'TENANT' AND NEW.state NOT IN ('HOLD', 'DISCARDED') THEN
      RAISE EXCEPTION 'HLTOS: 직판 상품의 개봉 반품은 보관 또는 폐기로 시작합니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.qty <> OLD.qty OR NEW.product_id <> OLD.product_id OR NEW.option_id IS DISTINCT FROM OLD.option_id
     OR NEW.return_id <> OLD.return_id OR NEW.order_item_id <> OLD.order_item_id THEN
    RAISE EXCEPTION 'HLTOS: 개봉 반품 재고의 상품 · 수량은 바꿀 수 없습니다.';
  END IF;
  -- 처리 끝난 줄(폐기 · 반송)은 다시 고치지 않음 — 다시 폐기해 사유 · 처리 시각을 덮어쓰는 것도 막음
  IF OLD.state <> 'HOLD' OR (NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'DISCARDED') THEN
    RAISE EXCEPTION 'HLTOS: 보관 중인 것만 폐기로 옮길 수 있습니다 — 식품 · 화장품 개봉품은 다시 팔 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_open_stock_guard ON public.hlt_open_stock;
CREATE TRIGGER trg_hlt_open_stock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_open_stock
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_open_stock_guard();

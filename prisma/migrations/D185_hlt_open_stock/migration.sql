-- =====================================================================
-- D185 — 소개몰 개봉 반품 재고 · 할인 판매(꺼진 채) (v10.208 · 2026-11-07)
--
--   대표 「개봉 반품 — 별도 재고(할인 판매)」 → 「2단계까지」(mall-return-refund 미정 2).
--   전에는 개봉 반품을 재고로 되돌리지 않는 것만 있었고(restock_skipped = 'OPENED' · D006) 상품이 어디로 갔는지 기록이 없었음.
--
--   ① 개봉 반품 재고 대장 hlt_open_stock — 반품 승인(개봉)마다 주문 줄별 한 행.
--      처리: HOLD 보관 · FOR_SALE 할인 판매 상품으로 옮김 · DISCARDED 폐기 · TO_SELLER 판매자에게 반송.
--      입점(TENANT) 상품은 반송만 · 직판(DIRECT · BRAND)은 보관 또는 폐기로 시작.
--      옮김은 한 방향(HOLD → FOR_SALE · DISCARDED / FOR_SALE · 끝 상태는 되돌리지 않음) · 지우지 않음.
--   ② 할인 판매 상품 = 원래 상품을 복제한 「[개봉 반품] …」 상품(open_from_product_id) — 장바구니 · 주문 · 결제 · 환불은
--      지금 흐름 그대로. 옵션 하나(원래 옵션과 같은 개월 수 · 값은 원래보다 낮게) · 재고 = 옮긴 수량.
--   ③ 판매 스위치 hlt.open_stock_sale — **처음 off**. off 면 개봉 반품 상품은 판매 중이 될 수 없고(트리거),
--      끄는 순간 판매 중인 것은 STOPPED(open_paused) · 다시 켜면 그것만 판매 중으로. 켜기는 SUPER(서버).
--   개봉 식품 · 화장품 재판매의 법적 허용 범위는 확인 전(docs/333) — 확인 뒤 켬.
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

-- ② 할인 판매 상품 표시 --------------------------------------------------
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS open_from_product_id uuid REFERENCES public.hlt_products(id);
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS open_from_option_id uuid REFERENCES public.hlt_product_options(id);
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS open_note text;
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS open_expires_on date;
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS open_paused boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hlt_products_open_note') THEN
    ALTER TABLE public.hlt_products ADD CONSTRAINT ck_hlt_products_open_note
      CHECK (open_note IS NULL OR length(open_note) <= 300);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_products_open_from_option ON public.hlt_products (open_from_option_id) WHERE open_from_option_id IS NOT NULL;
COMMENT ON COLUMN public.hlt_products.open_from_product_id IS '개봉 반품 할인 판매 상품이면 원래 상품(D185). 목록 · 검색에는 나오지 않고 원래 상품 화면에서 안내';

-- ① 대장 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hlt_open_stock (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id       uuid NOT NULL REFERENCES public.hlt_returns(id),
  order_id        uuid NOT NULL REFERENCES public.hlt_orders(id),
  order_item_id   uuid NOT NULL REFERENCES public.hlt_order_items(id),
  product_id      uuid NOT NULL REFERENCES public.hlt_products(id),
  option_id       uuid REFERENCES public.hlt_product_options(id),
  qty             int  NOT NULL CHECK (qty > 0),
  state           text NOT NULL CHECK (state IN ('HOLD', 'FOR_SALE', 'DISCARDED', 'TO_SELLER')),
  note            text CHECK (note IS NULL OR length(note) <= 300),
  expires_on      date,
  sale_product_id uuid REFERENCES public.hlt_products(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  decided_by      uuid,
  CONSTRAINT ux_hlt_open_stock_item UNIQUE (order_item_id),
  CONSTRAINT ck_hlt_open_stock_sale CHECK ((state = 'FOR_SALE') = (sale_product_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_hlt_open_stock_state ON public.hlt_open_stock (state, created_at DESC);
COMMENT ON TABLE public.hlt_open_stock IS '소개몰 개봉 반품 재고 대장(D185) — 보관 · 할인 판매 · 폐기 · 판매자 반송. 지우지 않음 · 옮김은 한 방향';

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
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (OLD.state = 'HOLD' AND NEW.state IN ('FOR_SALE', 'DISCARDED')) THEN
    RAISE EXCEPTION 'HLTOS: 보관 중인 것만 할인 판매나 폐기로 옮길 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_open_stock_guard ON public.hlt_open_stock;
CREATE TRIGGER trg_hlt_open_stock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_open_stock
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_open_stock_guard();

-- ③ 판매 스위치 --------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('hlt.open_stock_sale', 'off', 'GLOBAL',
   '소개몰 개봉 반품 할인 판매 — off(처음 값)면 개봉 반품 상품을 팔 수 없음 · 끄면 판매 중인 것이 멈춤 · 다시 켜면 멈춘 것만 판매. 켜기는 최고 관리자. 개봉 식품 · 화장품 재판매의 법적 허용 범위를 확인한 뒤 켬(sgb-core docs/333).',
   '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_hlt_open_sale_on() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT value FROM public.site_settings WHERE key = 'hlt.open_stock_sale'), 'off') = 'on'
$$;

CREATE OR REPLACE FUNCTION public.fn_hlt_open_product_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.open_from_product_id IS NOT NULL AND NEW.status = 'ON_SALE'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ON_SALE') AND NOT public.fn_hlt_open_sale_on() THEN
    RAISE EXCEPTION 'HLTOS: 개봉 반품 할인 판매가 꺼져 있습니다(hlt.open_stock_sale) — 켠 뒤에 판매할 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_open_product_guard ON public.hlt_products;
CREATE TRIGGER trg_hlt_open_product_guard BEFORE INSERT OR UPDATE OF status ON public.hlt_products
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_open_product_guard();

/* 스위치를 끄면 판매 중인 개봉 반품 상품을 멈추고(open_paused) · 다시 켜면 그것만 판매 중으로 */
CREATE OR REPLACE FUNCTION public.fn_hlt_open_sale_switch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key <> 'hlt.open_stock_sale' OR NEW.value IS NOT DISTINCT FROM OLD.value THEN RETURN NEW; END IF;
  IF NEW.value = 'off' THEN
    UPDATE public.hlt_products SET status = 'STOPPED', open_paused = true
     WHERE open_from_product_id IS NOT NULL AND status IN ('ON_SALE', 'SOLD_OUT');
  ELSIF NEW.value = 'on' THEN
    UPDATE public.hlt_products SET open_paused = false,
           status = CASE WHEN stock > 0 THEN 'ON_SALE' ELSE 'SOLD_OUT' END
     WHERE open_from_product_id IS NOT NULL AND open_paused;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_open_sale_switch ON public.site_settings;
CREATE TRIGGER trg_hlt_open_sale_switch AFTER UPDATE OF value ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_open_sale_switch();

-- ② 할인 판매로 옮기기 ---------------------------------------------------
/*  보관(HOLD) 행들을 같은 옵션의 개봉 반품 상품으로 옮김. 상품이 없으면 원래 상품을 복제해 만듦(성분까지).
 *  값은 원래 옵션 값보다 낮아야 함. 스위치가 켜져 있으면 판매 중 · 꺼져 있으면 멈춤(open_paused — 켜면 판매). 돌려줌: 상품 코드 */
CREATE OR REPLACE FUNCTION public.fn_hlt_open_stock_sell(p_ids uuid[], p_price bigint, p_note text, p_expires date, p_actor uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_opt uuid; v_n int; v_qty int; v_src public.hlt_products%ROWTYPE; o public.hlt_product_options%ROWTYPE;
  v_new public.hlt_products%ROWTYPE; v_pid uuid; v_code text;
BEGIN
  SELECT min(option_id::text)::uuid INTO v_opt FROM public.hlt_open_stock WHERE id = ANY(p_ids);
  SELECT count(*) INTO v_n FROM (SELECT DISTINCT option_id FROM public.hlt_open_stock WHERE id = ANY(p_ids)) x;
  SELECT coalesce(sum(qty), 0)::int INTO v_qty FROM public.hlt_open_stock WHERE id = ANY(p_ids);
  IF v_qty = 0 OR (SELECT count(*) FROM public.hlt_open_stock WHERE id = ANY(p_ids)) <> coalesce(array_length(p_ids, 1), 0) THEN
    RAISE EXCEPTION 'HLTOS: 옮길 개봉 반품 재고를 찾지 못했습니다.';
  END IF;
  IF v_n <> 1 OR v_opt IS NULL THEN RAISE EXCEPTION 'HLTOS: 같은 상품 · 같은 옵션끼리만 한 번에 옮길 수 있습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.hlt_open_stock WHERE id = ANY(p_ids) AND state <> 'HOLD') THEN
    RAISE EXCEPTION 'HLTOS: 보관 중인 것만 할인 판매로 옮길 수 있습니다.';
  END IF;
  SELECT * INTO o FROM public.hlt_product_options WHERE id = v_opt;
  IF p_price IS NULL OR p_price <= 0 OR p_price >= o.price THEN
    RAISE EXCEPTION 'HLTOS: 할인 판매 값은 원래 값보다 낮아야 합니다.';
  END IF;
  IF p_expires IS NOT NULL AND p_expires <= (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'HLTOS: 유통기한이 지났거나 오늘인 상품은 팔 수 없습니다.';
  END IF;

  SELECT id, code INTO v_pid, v_code FROM public.hlt_products WHERE open_from_option_id = v_opt;
  IF v_pid IS NULL THEN
    SELECT * INTO v_src FROM public.hlt_products WHERE id = o.product_id;
    v_new := v_src;
    v_new.id := gen_random_uuid();
    v_new.code := left(v_src.code, 40) || '-OR' || coalesce(o.months, 0);
    v_new.name := '[개봉 반품] ' || v_src.name;
    v_new.status := 'DRAFT';
    v_new.stock := 0;
    v_new.created_at := now(); v_new.updated_at := now();
    v_new.open_from_product_id := v_src.id; v_new.open_from_option_id := v_opt;
    v_new.open_paused := true;
    INSERT INTO public.hlt_products SELECT (v_new).*;
    INSERT INTO public.hlt_product_ingredients (product_id, ingredient_code, amount, is_main, sort)
    SELECT v_new.id, ingredient_code, amount, is_main, sort FROM public.hlt_product_ingredients WHERE product_id = v_src.id
    ON CONFLICT DO NOTHING;
    INSERT INTO public.hlt_product_options (product_id, months, price, stock, tag, sort, is_active)
    VALUES (v_new.id, o.months, p_price, 0, '개봉 반품', 0, true);
    v_pid := v_new.id; v_code := v_new.code;
  END IF;

  UPDATE public.hlt_product_options SET price = p_price, stock = stock + v_qty, is_active = true, updated_at = now()
   WHERE product_id = v_pid;
  UPDATE public.hlt_products SET open_note = nullif(btrim(coalesce(p_note, '')), ''), open_expires_on = p_expires
   WHERE id = v_pid;
  UPDATE public.hlt_open_stock SET state = 'FOR_SALE', sale_product_id = v_pid, decided_at = now(), decided_by = p_actor,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note), expires_on = coalesce(p_expires, expires_on)
   WHERE id = ANY(p_ids);
  IF public.fn_hlt_open_sale_on() THEN
    UPDATE public.hlt_products SET status = 'ON_SALE', open_paused = false WHERE id = v_pid AND status <> 'ON_SALE';
  ELSE
    UPDATE public.hlt_products SET status = 'STOPPED', open_paused = true WHERE id = v_pid AND status = 'DRAFT';
  END IF;
  RETURN v_code;
END $$;

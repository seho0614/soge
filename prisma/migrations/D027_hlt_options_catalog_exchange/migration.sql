-- =====================================================================
-- D027 — 소개몰 v10.26: 옵션(복용 개월 수) · 상품 자료 · 성분군 · 화장품 갈래 · 교환 배송비 · 상품 변경 기록 (2026-10-08 확정)
--
--   사장님 확인(2026-10-08 · 문서 「소개몰 상품자료 · 옵션 · 교환배송비 비교표」):
--     · 시안의 상품 = 「상품 → 옵션(개월 수 · 결제 금액 · 재고 · 꼬리 글자)」. 장바구니 · 주문 · 재고를 **옵션 단위**로 바꿉니다.
--     · 상품의 값(price) · 재고(stock)는 이제 **옵션에서 계산한 값**입니다 — 대표 판매가 = 가장 짧은 개월 수 옵션의 결제 금액(개월 수가 없는 「단품」이 먼저),
--       재고 = 켠 옵션 재고의 합. 상품 행을 직접 고치면 DB 가 막습니다(옵션을 고치십시오). 지금 쓰는 화면 · 뷰 · 정산은 상품의 값 · 재고를 그대로 읽으면 됩니다.
--     · 지금 상품(시드 · 운영 DB 의 것)은 「단품」 옵션 하나로 옮깁니다(값 · 재고 그대로). 장바구니 줄 · 주문 품목도 그 옵션을 가리키게 합니다(주문 기록은 그대로).
--     · 성분 — 시안의 26줄(군 2 · 아래 성분 4 · 많이 찾는 7) · 고민 14종 · 고민↔성분 41줄. 지금 성분은 시안 코드로 합칩니다(옛 이름은 「다른 이름」으로 남겨 검색이 됩니다):
--         VIT-D → VITD(비타민D) · CA → CALC(칼슘) · LACTO → PROBIO(유산균) · GINSENG → REDGIN(홍삼) · OMEGA3 이름 「오메가-3」 → 「오메가3」. 비타민 B군 · 부형제는 그대로.
--       「자격 필요」 표시는 넣지 않습니다(뜻이 정해지지 않음 — 추천값 B-6).
--     · 화장품 갈래(열림) · 수수료율 10% · 상품정보제공고시 항목(시안의 식품 11 · 건강기능식품 13 · 화장품 11 — 항목 이름은 자료라 코드 수정 없이 바꿀 수 있음)
--     · 교환 배송비 — 회원 사정(단순 변심 · 잘못 주문) 교환은 왕복 6,000원을 **신청 때 결제**, 반려 · 회사 사정 판정 · 반품으로 바꿈이면 돌려드림(A-1 ①).
--       결제 기록은 주문 결제(hlt_payments)와 따로 둡니다 — 주문 결제가 바뀌면 주문 상태가 바뀌는 규칙(fn_hlt_pay_apply)에 섞이지 않게.
--     · 교환할 상품이 없으면 운영이 반품으로 바꿉니다(converted_from). 바꾼 반품은 청약철회 기간을 다시 재지 않습니다 — 교환을 신청한 때 이미 기간 안이었습니다.
--     · 상품 이름 · 한 줄 설명 · 주의사항 · 기능성 문구에 금지 표현(banned_words · BLOCK · 관 HLT 또는 전체)이 있으면 저장되지 않습니다.
--
--   ★ 견본 16종 + 화장품 견본은 이 마이그레이션에 넣지 않습니다 — 개발 · 시연용 시드(scripts/seed-hlt-samples.js)입니다. 서버 적용 경로는 그 스크립트를 부르지 않습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 옵션
-- ---------------------------------------------------------------------
CREATE TABLE public.hlt_product_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.hlt_products(id) ON DELETE CASCADE,
  months      integer CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  price       bigint  NOT NULL CHECK (price > 0),
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  tag         text CHECK (tag IS NULL OR length(tag) <= 10),
  sort        integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hlt_product_options_sort_key UNIQUE (product_id, sort)
);
CREATE INDEX idx_hlt_opt_product ON public.hlt_product_options (product_id);
/* 켠 옵션끼리 개월 수가 겹치면 손님이 고를 수 없습니다(단품은 하나) */
CREATE UNIQUE INDEX idx_hlt_opt_months ON public.hlt_product_options (product_id, coalesce(months, 0)) WHERE is_active;
COMMENT ON TABLE public.hlt_product_options IS
  '소개몰 상품의 옵션(복용 개월 수). 한 달 단가 = round(price / months). months 가 없으면 「단품」. 장바구니 · 주문 · 재고의 단위입니다(D027).';

/** 옵션 이름 — 「9개월 분 2+1」 · 「3개월 분」 · 「단품」(장바구니 · 주문 · 화면이 같은 글을 씁니다) */
CREATE FUNCTION public.fn_hlt_option_label(p_months integer, p_tag text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_months IS NULL THEN '단품' ELSE p_months || '개월 분' END
         || coalesce(' ' || nullif(btrim(p_tag), ''), '')
$$;

/* 상품의 값 · 재고 = 옵션에서 계산. 옵션이 바뀔 때마다 맞춥니다 */
CREATE FUNCTION public.fn_hlt_option_sync() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE pid uuid; v_price bigint; v_stock integer;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.product_id; ELSE pid := NEW.product_id; END IF;
  SELECT o.price INTO v_price FROM public.hlt_product_options o
   WHERE o.product_id = pid AND o.is_active ORDER BY o.months NULLS FIRST, o.sort DESC LIMIT 1;
  SELECT coalesce(sum(o.stock), 0)::int INTO v_stock FROM public.hlt_product_options o
   WHERE o.product_id = pid AND o.is_active;
  PERFORM set_config('sgb.hlt_option_sync', '1', true);
  UPDATE public.hlt_products SET price = coalesce(v_price, price), stock = v_stock
   WHERE id = pid AND (price IS DISTINCT FROM coalesce(v_price, price) OR stock IS DISTINCT FROM v_stock);
  PERFORM set_config('sgb.hlt_option_sync', '', true);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_hlt_option_sync AFTER INSERT OR UPDATE OR DELETE ON public.hlt_product_options
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_option_sync();

/* 상품 행의 값 · 재고를 직접 고치면 막습니다 — 옵션과 어긋납니다 */
CREATE FUNCTION public.fn_hlt_product_derived_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.price IS DISTINCT FROM OLD.price OR NEW.stock IS DISTINCT FROM OLD.stock)
     AND coalesce(current_setting('sgb.hlt_option_sync', true), '') <> '1' THEN
    RAISE EXCEPTION 'HLTP: 상품의 값 · 재고는 옵션에서 계산됩니다 — 옵션(hlt_product_options)을 고치십시오 (%)', OLD.code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hlt_product_derived BEFORE UPDATE OF price, stock ON public.hlt_products
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_product_derived_guard();

/* 지금 상품 → 「단품」 옵션 하나(값 · 재고 그대로) */
INSERT INTO public.hlt_product_options (product_id, months, price, stock, tag, sort)
SELECT p.id, NULL, p.price, p.stock, NULL, 0 FROM public.hlt_products p
 WHERE NOT EXISTS (SELECT 1 FROM public.hlt_product_options o WHERE o.product_id = p.id);

-- ---------------------------------------------------------------------
-- 2) 장바구니 · 주문 품목이 옵션을 가리킴
-- ---------------------------------------------------------------------
ALTER TABLE public.hlt_cart_items
  ADD COLUMN option_id uuid REFERENCES public.hlt_product_options(id) ON DELETE CASCADE,
  ADD COLUMN added_price bigint CHECK (added_price IS NULL OR added_price > 0);
ALTER TABLE public.hlt_cart_items DISABLE TRIGGER trg_hlt_cart;      -- 옛 줄을 옮기는 동안만(판매 중지 · 재고 부족 줄도 그대로 옮김)
UPDATE public.hlt_cart_items ci SET option_id = o.id, added_price = o.price
  FROM public.hlt_product_options o WHERE o.product_id = ci.product_id AND ci.option_id IS NULL;
ALTER TABLE public.hlt_cart_items ENABLE TRIGGER trg_hlt_cart;
ALTER TABLE public.hlt_cart_items ALTER COLUMN option_id SET NOT NULL;
ALTER TABLE public.hlt_cart_items DROP CONSTRAINT hlt_cart_items_account_id_product_id_key;
ALTER TABLE public.hlt_cart_items ADD CONSTRAINT hlt_cart_items_account_option_key UNIQUE (account_id, option_id);
COMMENT ON COLUMN public.hlt_cart_items.added_price IS '담을 때의 옵션 값 — 지금 값과 다르면 장바구니가 「가격 변경」을 보이고, 주문 때 확인(priceAck)을 받습니다(D027)';

ALTER TABLE public.hlt_order_items
  ADD COLUMN option_id uuid REFERENCES public.hlt_product_options(id) ON DELETE RESTRICT,
  ADD COLUMN option_label text,
  ADD COLUMN months integer;
UPDATE public.hlt_order_items i SET option_id = o.id, option_label = '단품'
  FROM public.hlt_product_options o WHERE o.product_id = i.product_id AND i.option_id IS NULL;
COMMENT ON COLUMN public.hlt_order_items.option_label IS '주문 때의 옵션 이름(「9개월 분 2+1」) — 옵션을 나중에 고쳐도 주문 기록은 그대로입니다(D027)';

/* 담기 — 판매 중 · 켠 옵션 · 옵션 재고 안에서만. 담을 때 값을 적어 둡니다 */
CREATE OR REPLACE FUNCTION public.fn_hlt_cart_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE p record; o record;
BEGIN
  SELECT * INTO p FROM public.hlt_products WHERE id = NEW.product_id;
  IF p.status <> 'ON_SALE' THEN
    RAISE EXCEPTION 'HLTC: 판매 중인 상품이 아닙니다 — %', p.name;
  END IF;
  SELECT * INTO o FROM public.hlt_product_options WHERE id = NEW.option_id;
  IF o.id IS NULL OR o.product_id <> NEW.product_id THEN
    RAISE EXCEPTION 'HLTC: 이 상품의 옵션이 아닙니다 — %', p.name;
  END IF;
  IF NOT o.is_active THEN
    RAISE EXCEPTION 'HLTC: 판매하지 않는 옵션입니다 — % %', p.name, public.fn_hlt_option_label(o.months, o.tag);
  END IF;
  /* 재고보다 많이 담는 것은 막습니다 — 주문 때 알면 이미 늦습니다. */
  IF o.stock < NEW.qty THEN
    RAISE EXCEPTION 'HLTC: 남은 수량이 %개입니다 — % %', o.stock, p.name, public.fn_hlt_option_label(o.months, o.tag);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.added_price IS NULL THEN NEW.added_price := o.price; END IF;

  INSERT INTO public.hlt_carts (account_id) VALUES (NEW.account_id)
    ON CONFLICT (account_id) DO UPDATE SET updated_at = now();
  RETURN NEW;
END $$;

/* 주문 품목 — 옵션 재고를 확인하고 옵션 이름 · 개월 수를 박습니다 */
CREATE OR REPLACE FUNCTION public.fn_hlt_stock_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE p record; o record;
BEGIN
  SELECT * INTO p FROM public.hlt_products WHERE id = NEW.product_id;
  IF p.status <> 'ON_SALE' THEN
    RAISE EXCEPTION 'HLTO: 판매 중인 상품이 아닙니다 — %', p.name;
  END IF;
  IF NEW.option_id IS NULL THEN
    RAISE EXCEPTION 'HLTO: 옵션을 골라야 합니다 — %', p.name;
  END IF;
  SELECT * INTO o FROM public.hlt_product_options WHERE id = NEW.option_id;
  IF o.id IS NULL OR o.product_id <> NEW.product_id THEN
    RAISE EXCEPTION 'HLTO: 이 상품의 옵션이 아닙니다 — %', p.name;
  END IF;
  IF NOT o.is_active THEN
    RAISE EXCEPTION 'HLTO: 판매하지 않는 옵션입니다 — % %', p.name, public.fn_hlt_option_label(o.months, o.tag);
  END IF;
  IF o.stock < NEW.qty THEN
    RAISE EXCEPTION 'HLTO: 재고가 부족합니다 — % % (남은 수량 %)', p.name, public.fn_hlt_option_label(o.months, o.tag), o.stock;
  END IF;
  NEW.option_label := public.fn_hlt_option_label(o.months, o.tag);
  NEW.months := o.months;
  RETURN NEW;
END $$;

/* 주문 품목이 들어가면 그 옵션의 재고를 뺍니다(같은 거래). 동시에 둘이 빼서 음수가 되면 CHECK 가 막아 거래 전체가 되돌아갑니다 */
CREATE FUNCTION public.fn_hlt_stock_take() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.hlt_product_options SET stock = stock - NEW.qty, updated_at = now() WHERE id = NEW.option_id;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_hlt_stock_take AFTER INSERT ON public.hlt_order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_stock_take();

/* 취소 · 반품 — 재고를 옵션으로 한 번만 되돌립니다(나머지는 앞 판 그대로) */
CREATE OR REPLACE FUNCTION public.fn_hlt_order_restock() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  /* 한 번 적힌 되돌림 시각 · 미복구 사유는 지우거나 바꿀 수 없습니다 */
  IF OLD.restocked_at IS NOT NULL THEN
    NEW.restocked_at := OLD.restocked_at;
  END IF;
  IF OLD.restock_skipped IS NOT NULL THEN
    NEW.restock_skipped := OLD.restock_skipped;
  END IF;

  /* 취소·반품은 끝 상태입니다. 되살리면 재고를 다시 빼야 하는데 그 경로가 없습니다 */
  IF OLD.status IN ('CANCELED','RETURNED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'HLTO: 취소·반품된 주문은 상태를 바꿀 수 없습니다 — 새로 주문해 주십시오 (%)', OLD.order_no;
  END IF;

  /* D006 — 미복구 사유는 반품으로 닫히는 그 순간에만 붙일 수 있습니다. */
  IF NEW.restock_skipped IS NOT NULL AND OLD.restock_skipped IS NULL THEN
    IF NEW.status <> 'RETURNED' THEN
      RAISE EXCEPTION 'HLTO: 재고 미복구(개봉)는 반품에만 붙일 수 있습니다 — 발송 전 취소는 개봉일 수 없습니다 (%)', OLD.order_no;
    END IF;
    IF OLD.status IN ('CANCELED','RETURNED') THEN
      RAISE EXCEPTION 'HLTO: 이미 닫힌 주문의 재고 처리는 바꿀 수 없습니다 (%)', OLD.order_no;
    END IF;
  END IF;

  IF NEW.status IN ('CANCELED','RETURNED') AND OLD.restocked_at IS NULL
     AND NEW.restock_skipped IS NULL THEN
    UPDATE public.hlt_product_options o
       SET stock = o.stock + x.q, updated_at = now()
      FROM (SELECT option_id, sum(qty)::int AS q
              FROM public.hlt_order_items WHERE order_id = NEW.id AND option_id IS NOT NULL
             GROUP BY option_id) x
     WHERE o.id = x.option_id;
    NEW.restocked_at := now();
  END IF;
  RETURN NEW;
END $$;

/* 장바구니 요약 — 옵션의 값 · 재고로. price_changed = 담은 뒤 값이 바뀐 줄이 있음 */
CREATE OR REPLACE VIEW public.v_hlt_cart AS
 SELECT ci.account_id,
    count(*) AS lines,
    sum(ci.qty) AS items,
    sum(o.price * ci.qty) AS goods,
    0 AS ship_fee,
    sum(o.price * ci.qty) AS total,
    bool_or(o.stock < ci.qty OR p.status <> 'ON_SALE'::text OR NOT o.is_active) AS has_problem,
    bool_or(ci.added_price IS NOT NULL AND ci.added_price <> o.price) AS price_changed
   FROM public.hlt_cart_items ci
     JOIN public.hlt_products p ON p.id = ci.product_id
     JOIN public.hlt_product_options o ON o.id = ci.option_id
  GROUP BY ci.account_id;

-- ---------------------------------------------------------------------
-- 3) 상품 자료 · 그림 · 고시 · 금지 표현 · 판매 시작 조건 · 변경 기록
-- ---------------------------------------------------------------------
ALTER TABLE public.files DROP CONSTRAINT ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC'::text, 'MARKETING_MATERIAL'::text, 'PARTNER_GUIDE'::text, 'PRODUCT_IMAGE'::text]));
INSERT INTO public.file_policies VALUES ('PRODUCT_IMAGE', 'image/jpeg', 5242880, 'jpg'), ('PRODUCT_IMAGE', 'image/png', 5242880, 'png')
  ON CONFLICT DO NOTHING;

ALTER TABLE public.hlt_products
  ADD COLUMN summary       text  CHECK (summary IS NULL OR length(summary) <= 120),
  ADD COLUMN list_price    bigint CHECK (list_price IS NULL OR list_price > 0),
  ADD COLUMN badge         text  CHECK (badge IS NULL OR badge IN ('신규입점', '특별가격')),
  ADD COLUMN caution       text  CHECK (caution IS NULL OR length(caution) <= 500),
  ADD COLUMN notice        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(notice) = 'object'),
  ADD COLUMN ad_copy       text  CHECK (ad_copy IS NULL OR length(ad_copy) <= 300),
  ADD COLUMN art_form      text  CHECK (art_form IS NULL OR art_form IN ('BOX', 'POUCH', 'BOTTLE')),
  ADD COLUMN art_tone      text  CHECK (art_tone IS NULL OR art_tone ~ '^[A-Z]{3,10}$'),
  ADD COLUMN image_file_id uuid  REFERENCES public.files(id);
COMMENT ON COLUMN public.hlt_products.list_price IS '정가 — 대표 옵션(가장 짧은 개월 수)의 정상가. 할인율 = round((1 − 대표 판매가 ÷ 정가) × 100), 정가가 더 클 때만 보입니다(D027)';
COMMENT ON COLUMN public.hlt_products.notice IS '상품정보제공고시 값 { 항목 이름: 값 } — 항목은 갈래 묶음(hlt_notice_items)을 따릅니다. 비운 항목은 「상세 설명 참조」(D027)';
COMMENT ON COLUMN public.hlt_products.art_form IS '사진이 없을 때 화면이 그리는 그림의 꼴. 그림에는 성분 이름 · 함량만 적습니다(「건강기능식품」 · 「GMP」 글자를 넣지 않음 — 시안 고침 · D027)';

/* 상품 글의 금지 표현 — banned_words(BLOCK · 관 HLT 또는 전체). 고민 이름 규칙(fn_hlt_concern_guard)과 같은 뜻입니다 */
CREATE FUNCTION public.fn_hlt_product_words_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE hit record;
BEGIN
  SELECT * INTO hit FROM public.fn_check_banned_words(
      coalesce(NEW.name,'') || ' ' || coalesce(NEW.summary,'') || ' ' || coalesce(NEW.caution,'') || ' ' || coalesce(NEW.ad_copy,''), 'HLT')
   WHERE severity = 'BLOCK' LIMIT 1;
  IF hit.word IS NOT NULL THEN
    RAISE EXCEPTION 'BANNED_WORD: "%"는 상품 이름 · 설명 · 주의사항에 쓸 수 없는 표현입니다.', hit.word;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hlt_product_words BEFORE INSERT OR UPDATE OF name, summary, caution, ad_copy ON public.hlt_products
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_product_words_guard();

/* 판매 중으로 바꾸려면 켠 옵션이 하나 이상 있어야 합니다 */
CREATE FUNCTION public.fn_hlt_product_sale_ready() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ON_SALE' AND OLD.status IS DISTINCT FROM 'ON_SALE'
     AND NOT EXISTS (SELECT 1 FROM public.hlt_product_options o WHERE o.product_id = NEW.id AND o.is_active) THEN
    RAISE EXCEPTION 'HLTP: 옵션이 하나도 없어 판매할 수 없습니다 — 옵션을 먼저 넣어 주십시오 (%)', NEW.code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hlt_product_sale_ready BEFORE UPDATE OF status ON public.hlt_products
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_product_sale_ready();

/* 상품 변경 기록 — 결제 금액 · 재고 · 상태 · 글을 누가 언제 바꿨는지. 쓰기만 됩니다 */
CREATE TABLE public.hlt_product_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.hlt_products(id) ON DELETE CASCADE,
  option_id   uuid REFERENCES public.hlt_product_options(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES public.accounts(id),
  field       text NOT NULL,
  before      text,
  after       text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hlt_hist_product ON public.hlt_product_history (product_id, created_at DESC);
CREATE FUNCTION public.fn_hlt_history_ro() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HLTP: 상품 변경 기록은 고치거나 지울 수 없습니다';
END $$;
CREATE TRIGGER trg_hlt_history_ro BEFORE UPDATE ON public.hlt_product_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_history_ro();

-- ---------------------------------------------------------------------
-- 4) 성분 — 군(2단까지) · 많이 찾는 · 표제 성분 · 시안의 26줄 · 고민 14종
-- ---------------------------------------------------------------------
ALTER TABLE public.ingredients
  ADD COLUMN parent_code text REFERENCES public.ingredients(code) ON UPDATE CASCADE,
  ADD COLUMN is_group    boolean NOT NULL DEFAULT false,
  ADD COLUMN is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN sort        integer NOT NULL DEFAULT 1000,
  ADD CONSTRAINT ck_ingredients_parent CHECK (parent_code IS NULL OR (parent_code <> code AND NOT is_group));

/* 성분군은 2단까지(군 → 성분) — 「3단은 소비자가 못 찾습니다」(시안). 군의 위에 군을 둘 수 없고, 군이 아닌 성분 아래에 달 수 없습니다 */
CREATE FUNCTION public.fn_ingredient_tree_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE par record;
BEGIN
  IF NEW.parent_code IS NOT NULL THEN
    SELECT * INTO par FROM public.ingredients WHERE code = NEW.parent_code;
    IF NOT par.is_group THEN
      RAISE EXCEPTION 'HLTI: 성분군(군)이 아닌 성분 아래에는 달 수 없습니다 — %', NEW.parent_code;
    END IF;
  END IF;
  IF NEW.is_group AND EXISTS (SELECT 1 FROM public.hlt_product_ingredients pi WHERE pi.ingredient_code = NEW.code) THEN
    RAISE EXCEPTION 'HLTI: 상품에 쓰인 성분은 군으로 바꿀 수 없습니다 — 아래 성분을 만들어 옮겨 주십시오 (%)', NEW.code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ingredient_tree BEFORE INSERT OR UPDATE ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.fn_ingredient_tree_guard();

/* 지금 성분을 시안 코드로 합침 — 상품 · 고민 연결은 ON UPDATE CASCADE 로 따라옵니다. 옛 이름은 다른 이름(aliases)으로 */
UPDATE public.ingredients SET code = 'VITD',   name = '비타민D', aliases = array(SELECT DISTINCT unnest(coalesce(aliases, '{}') || ARRAY['비타민 D'])) WHERE code = 'VIT-D'   AND NOT EXISTS (SELECT 1 FROM public.ingredients WHERE code = 'VITD');
UPDATE public.ingredients SET code = 'CALC',   name = '칼슘',   aliases = coalesce(aliases, '{}')                                                   WHERE code = 'CA'      AND NOT EXISTS (SELECT 1 FROM public.ingredients WHERE code = 'CALC');
UPDATE public.ingredients SET code = 'PROBIO', name = '유산균', aliases = array(SELECT DISTINCT unnest(array_remove(coalesce(aliases, '{}'), '유산균') || ARRAY['락토바실러스'])) WHERE code = 'LACTO' AND NOT EXISTS (SELECT 1 FROM public.ingredients WHERE code = 'PROBIO');
UPDATE public.ingredients SET code = 'REDGIN', name = '홍삼',   aliases = array(SELECT DISTINCT unnest(array_remove(coalesce(aliases, '{}'), '홍삼') || ARRAY['홍삼 농축액'])) WHERE code = 'GINSENG' AND NOT EXISTS (SELECT 1 FROM public.ingredients WHERE code = 'REDGIN');
UPDATE public.ingredients SET name = '오메가3', aliases = array(SELECT DISTINCT unnest(coalesce(aliases, '{}') || ARRAY['오메가-3'])) WHERE code = 'OMEGA3' AND name = '오메가-3';

/* 시안의 성분 26줄 — 군을 먼저 넣고, 아래 성분 · 많이 찾는 표시 · 순서를 시안대로 */
CREATE TEMP TABLE _ing (code text, name text, is_group boolean, is_featured boolean, parent_code text, sort int);
INSERT INTO _ing VALUES
  ('VITC','비타민C',false,true,NULL,10),
  ('VITD','비타민D',false,true,NULL,20),
  ('CALC','칼슘',false,true,NULL,30),
  ('OMEGA3','오메가3',false,true,NULL,40),
  ('LUTEIN','루테인',false,true,NULL,50),
  ('PROBIO','유산균',false,true,NULL,60),
  ('MULTI','멀티비타민',false,true,NULL,70),
  ('MAGNE','마그네슘',false,false,NULL,80),
  ('MILK','밀크씨슬',false,false,NULL,90),
  ('MSM','MSM',false,false,NULL,100),
  ('SAWPAL','쏘팔메토',false,false,NULL,110),
  ('COLLA','콜라겐',false,false,NULL,120),
  ('GARCI','가르시니아',false,false,NULL,130),
  ('THEAN','테아닌',false,false,NULL,140),
  ('CABBAGE','양배추',false,false,NULL,150),
  ('BITTER','여주',false,false,NULL,160),
  ('ALBU','알부민',false,false,NULL,170),
  ('KAMUT','카무트',false,false,NULL,180),
  ('PS','포스파티딜세린',false,false,NULL,190),
  ('MELA','멜라토닌',false,false,NULL,200),
  ('BERRY','블루베리·베리류',true,false,NULL,210),
  ('BLUEB','블루베리',false,false,'BERRY',220),
  ('BILB','빌베리',false,false,'BERRY',230),
  ('HONG','홍삼·한방성분',true,false,NULL,240),
  ('REDGIN','홍삼',false,false,'HONG',250),
  ('DEER','녹용',false,false,'HONG',260);
INSERT INTO public.ingredients (code, name, is_group, is_featured, sort)
SELECT code, name, is_group, is_featured, sort FROM _ing ORDER BY is_group DESC, sort
ON CONFLICT (code) DO UPDATE SET is_group = EXCLUDED.is_group, is_featured = EXCLUDED.is_featured, sort = EXCLUDED.sort;
UPDATE public.ingredients g SET parent_code = x.parent_code FROM _ing x WHERE g.code = x.code AND x.parent_code IS NOT NULL;
DROP TABLE _ing;

/* 상품의 표제 성분(카드 · 상세의 「성분 | 함량」) — 상품마다 하나 */
ALTER TABLE public.hlt_product_ingredients ADD COLUMN is_main boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX idx_hlt_pi_main ON public.hlt_product_ingredients (product_id) WHERE is_main;
UPDATE public.hlt_product_ingredients pi SET is_main = true
  FROM (SELECT DISTINCT ON (product_id) product_id, ingredient_code FROM public.hlt_product_ingredients ORDER BY product_id, sort, ingredient_code) f
 WHERE pi.product_id = f.product_id AND pi.ingredient_code = f.ingredient_code;

/* 고민 14종(시안 순서) · 고민 ↔ 성분 41줄. 이름은 고민 규칙(fn_hlt_concern_guard — 질병명 · 효능 금지)을 거칩니다 */
INSERT INTO public.hlt_concerns (code, name, icon, sort) VALUES
  ('IMMUNE','면역','🛡',10),
  ('EYE','눈','👁',20),
  ('BONE','뼈 · 연골 · 관절','🦴',30),
  ('LIVER','간','🫀',40),
  ('MEN','남성 · 전립선','🚹',50),
  ('SLEEP','수면 · 스트레스','🌙',60),
  ('DIET','다이어트','⚖️',70),
  ('GLUCOSE','혈당','📉',80),
  ('SKIN','피부 · 모발','✨',90),
  ('FATIGUE','피로회복','🔋',100),
  ('BRAIN','두뇌','🧠',110),
  ('STOMACH','위','🍽',120),
  ('ANTIOX','항산화','🍇',130),
  ('CIRC','혈행','🩺',140)
ON CONFLICT (code) DO UPDATE SET sort = EXCLUDED.sort;
INSERT INTO public.hlt_concern_ingredients (concern_code, ingredient_code, sort) VALUES
  ('IMMUNE','PROBIO',1),
  ('IMMUNE','VITC',2),
  ('IMMUNE','VITD',3),
  ('IMMUNE','MULTI',4),
  ('EYE','LUTEIN',1),
  ('EYE','OMEGA3',2),
  ('EYE','BLUEB',3),
  ('EYE','BILB',4),
  ('BONE','CALC',1),
  ('BONE','VITD',2),
  ('BONE','MAGNE',3),
  ('BONE','MSM',4),
  ('BONE','COLLA',5),
  ('LIVER','MILK',1),
  ('LIVER','CABBAGE',2),
  ('MEN','SAWPAL',1),
  ('MEN','OMEGA3',2),
  ('SLEEP','THEAN',1),
  ('SLEEP','MAGNE',2),
  ('SLEEP','MELA',3),
  ('DIET','GARCI',1),
  ('DIET','BITTER',2),
  ('GLUCOSE','BITTER',1),
  ('GLUCOSE','PROBIO',2),
  ('SKIN','COLLA',1),
  ('SKIN','MSM',2),
  ('SKIN','VITC',3),
  ('FATIGUE','MULTI',1),
  ('FATIGUE','REDGIN',2),
  ('FATIGUE','DEER',3),
  ('FATIGUE','ALBU',4),
  ('BRAIN','PS',1),
  ('BRAIN','OMEGA3',2),
  ('STOMACH','CABBAGE',1),
  ('ANTIOX','VITC',1),
  ('ANTIOX','BLUEB',2),
  ('ANTIOX','BILB',3),
  ('ANTIOX','BITTER',4),
  ('ANTIOX','KAMUT',5),
  ('CIRC','OMEGA3',1),
  ('CIRC','REDGIN',2)
ON CONFLICT (concern_code, ingredient_code) DO UPDATE SET sort = EXCLUDED.sort;

-- ---------------------------------------------------------------------
-- 5) 화장품 갈래 · 상품정보제공고시 항목 · 주의사항 제목
-- ---------------------------------------------------------------------
INSERT INTO public.categories (gwan_code, code, name, status, fee_bearer, labor_law_flag, labor_law_memo, labor_law_checked_at, approved_at)
SELECT 'HLT', 'HLT_COSMETIC', '화장품', 'APPROVED', 'SELLER', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE gwan_code = 'HLT' AND code = 'HLT_COSMETIC');
INSERT INTO public.hlt_sale_categories (category_code, state, note, sort) VALUES ('HLT_COSMETIC', 'OPEN', NULL, 20)
  ON CONFLICT (category_code) DO NOTHING;
INSERT INTO public.hlt_commission_rates (category_code, rate, note) VALUES ('HLT_COSMETIC', 10.00, '화장품 — 건강식품과 같게(입점 판매자를 받을 때 다시 정함)')
  ON CONFLICT (category_code) DO NOTHING;

/* 갈래 → 고시 묶음 · 주의사항 제목 · 「의약품이 아닙니다」 고지. 표에 없는 갈래는 고시 없음 · 「사용상 주의사항」 · 고지 없음 */
CREATE TABLE public.hlt_notice_groups (
  category_code text PRIMARY KEY,
  notice_group  text NOT NULL,
  caution_title text NOT NULL,
  not_medicine  boolean NOT NULL
);
INSERT INTO public.hlt_notice_groups VALUES
  ('HLT_FOOD',     'FOOD',     '섭취 · 사용상 주의사항', true),
  ('HLT_FUNC',     'HFF',      '섭취 시 주의사항',       true),
  ('HLT_COSMETIC', 'COSMETIC', '사용할 때의 주의사항',   false);

/* 고시 항목 — 시안의 항목 그대로(이름이 현행 고시와 같은지는 운영에서 확인 · 자료라 코드 수정 없이 바꿉니다).
   auto: NAME = 상품 이름 · CS_TEL = 소비자상담 전화(판매자 · 사이트 대표 전화) · AMOUNT = 표제 성분의 함량(화장품 용량) */
CREATE TABLE public.hlt_notice_items (
  notice_group text NOT NULL,
  sort         integer NOT NULL,
  label        text NOT NULL,
  auto         text CHECK (auto IS NULL OR auto IN ('NAME', 'CS_TEL', 'AMOUNT')),
  PRIMARY KEY (notice_group, sort),
  UNIQUE (notice_group, label)
);
INSERT INTO public.hlt_notice_items VALUES
  ('FOOD', 1, '제품명', 'NAME'), ('FOOD', 2, '식품유형', NULL), ('FOOD', 3, '생산자', NULL), ('FOOD', 4, '소재지', NULL),
  ('FOOD', 5, '제조연월일', NULL), ('FOOD', 6, '유통기한', NULL), ('FOOD', 7, '포장단위별 내용물의 용량', NULL), ('FOOD', 8, '원재료명', NULL),
  ('FOOD', 9, '영양성분', NULL), ('FOOD', 10, '보관방법', NULL), ('FOOD', 11, '소비자상담 전화', 'CS_TEL'),
  ('HFF', 1, '제품명', 'NAME'), ('HFF', 2, '식품의 유형', NULL), ('HFF', 3, '제조업소 명칭과 소재지', NULL), ('HFF', 4, '제조연월일', NULL),
  ('HFF', 5, '유통기한', NULL), ('HFF', 6, '용량', NULL), ('HFF', 7, '원재료명 및 함량', NULL), ('HFF', 8, '영양정보', NULL),
  ('HFF', 9, '기능정보', NULL), ('HFF', 10, '섭취량 및 섭취방법', NULL), ('HFF', 11, '섭취 시 주의사항', NULL), ('HFF', 12, '건강기능식품 도안', NULL),
  ('HFF', 13, '소비자상담 전화', 'CS_TEL'),
  ('COSMETIC', 1, '용량 또는 중량', 'AMOUNT'), ('COSMETIC', 2, '제품 주요 사양', NULL), ('COSMETIC', 3, '사용기한 또는 개봉 후 사용기간', NULL),
  ('COSMETIC', 4, '사용방법', NULL), ('COSMETIC', 5, '화장품제조업자', NULL), ('COSMETIC', 6, '화장품책임판매업자', NULL), ('COSMETIC', 7, '제조국', NULL),
  ('COSMETIC', 8, '전성분', NULL), ('COSMETIC', 9, '기능성 화장품 심사필 여부', NULL), ('COSMETIC', 10, '사용할 때의 주의사항', NULL),
  ('COSMETIC', 11, '소비자상담 전화', 'CS_TEL');

-- ---------------------------------------------------------------------
-- 6) 교환 배송비 — 회원 사정 교환은 신청 때 결제 · 반려/회사 사정/반품으로 바꿈이면 돌려드림
-- ---------------------------------------------------------------------
ALTER TABLE public.hlt_returns
  ADD COLUMN exchange_fee   integer NOT NULL DEFAULT 0,
  ADD COLUMN converted_from uuid REFERENCES public.hlt_returns(id),
  ADD CONSTRAINT ck_hlt_returns_exchange_fee
    CHECK (exchange_fee >= 0 AND (exchange_fee = 0 OR (kind = 'EXCHANGE' AND reason = ANY (ARRAY['CHANGE_MIND'::text, 'WRONG_ORDER'::text])))),
  ADD CONSTRAINT ck_hlt_returns_converted CHECK (converted_from IS NULL OR kind = 'RETURN');
COMMENT ON COLUMN public.hlt_returns.exchange_fee IS '교환 배송비(왕복) — 회원 사정 교환만 0 보다 큼. 운영이 회사 사정으로 판정하면 0 으로 바꾸고 낸 돈을 돌려드립니다(D027 · 약관 제3조)';
COMMENT ON COLUMN public.hlt_returns.converted_from IS '교환할 상품이 없어 반품으로 바꾼 경우 — 원래 교환 신청(그 신청은 반려로 닫힘). 청약철회 기간은 교환을 신청한 때로 봅니다(D027)';

CREATE TABLE public.hlt_exchange_fees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES public.hlt_returns(id) ON DELETE RESTRICT,
  amount        integer NOT NULL CHECK (amount > 0),
  method        text NOT NULL CHECK (method IN ('CARD', 'TRANSFER')),
  state         text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY', 'PAID', 'FAILED', 'REFUNDED')),
  toss_order_id text NOT NULL UNIQUE,
  payment_key   text UNIQUE,
  stub          boolean NOT NULL DEFAULT false,
  pg_tid        text,
  approved_at   timestamptz,
  refunded_at   timestamptz,
  refund_error  text,
  fail_reason   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_xfee_paid CHECK (state NOT IN ('PAID', 'REFUNDED') OR (payment_key IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ck_hlt_xfee_refunded CHECK (state <> 'REFUNDED' OR refunded_at IS NOT NULL)
);
/* 한 신청에 낸 돈(PAID · REFUNDED)은 한 건 — 두 번 받지 않습니다 */
CREATE UNIQUE INDEX idx_hlt_xfee_once ON public.hlt_exchange_fees (return_id) WHERE state IN ('PAID', 'REFUNDED');
COMMENT ON TABLE public.hlt_exchange_fees IS '교환 배송비 결제 — 주문 결제(hlt_payments)와 따로 둡니다. 카드 · 계좌이체만(가상계좌 없음). 환불은 결제사 취소(D027)';

/* 신청 규칙 — 앞 판 그대로 + 반품으로 바꾼 신청은 기간을 다시 재지 않음 + 교환 비용을 내기 전에는 승인할 수 없음 */
CREATE OR REPLACE FUNCTION public.fn_hlt_return_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE j record; src record;
BEGIN
  IF NEW.state = 'REJECTED' AND coalesce(btrim(NEW.decide_note),'') = '' THEN
    RAISE EXCEPTION
      'HLTR: 거절하시려면 이유를 적어야 합니다 — 청약철회는 법이 준 권리라 근거가 필요합니다';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.converted_from IS NOT NULL THEN
      SELECT * INTO src FROM public.hlt_returns WHERE id = NEW.converted_from;
      IF src.id IS NULL OR src.kind <> 'EXCHANGE' OR src.order_id <> NEW.order_id OR src.state <> 'REJECTED' THEN
        RAISE EXCEPTION 'HLTR: 반품으로 바꿀 수 있는 것은 같은 주문의 닫힌 교환 신청뿐입니다';
      END IF;
    ELSE
      SELECT * INTO j FROM public.fn_hlt_return_judge(NEW.order_id, NEW.kind, NEW.reason);
      IF NOT j.ok THEN
        RAISE EXCEPTION 'HLTR: %', j.message;
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind = 'EXCHANGE' AND NEW.state = 'APPROVED' AND OLD.state = 'REQUESTED'
     AND NEW.exchange_fee > 0
     AND NOT EXISTS (SELECT 1 FROM public.hlt_exchange_fees f WHERE f.return_id = NEW.id AND f.state = 'PAID' AND f.amount = NEW.exchange_fee) THEN
    RAISE EXCEPTION 'HLTR: 교환 배송비(% 원)를 내기 전에는 승인할 수 없습니다', NEW.exchange_fee;
  END IF;
  RETURN NEW;
END $$;

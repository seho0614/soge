/* D287 (v10.553 ~ 555 · docs/691 ~ 693) (57) 소개몰 3 — 묶음(세트) 할인 · 도서산간 배송비 · 리뷰 판매자 답글 */

/* =====================================================================
 * D287 (v10.553 ~ 555 · docs/691 ~ 693) (57) 소개몰 3 — 대표 11/21 「지금 바로 동시 착수」
 *   ① 묶음(세트) 할인 · ② 도서산간 배송비 · ③ 리뷰 판매자 답글 — 모두 처음 꺼짐(smx.bundle · smx.remote_ship · smx.review_reply off)
 *   다시 돌려도 같음(IF NOT EXISTS · DROP IF EXISTS 뒤 ADD · ON CONFLICT DO NOTHING · CREATE OR REPLACE)
 * ===================================================================== */

/* ── ① 묶음(세트) 할인 ────────────────────────────────────────────────
 *   여러 직판 상품 · 옵션을 한 묶음으로 · 묶음가 하나 · 재고는 따로 두지 않고 구성 옵션에서 빠짐(주문 품목 = 구성 옵션 줄)
 *   하나라도 품절(판매 중 아님 · 옵션 끔 · 재고 < 구성 수량)이면 묶음도 품절(v_hlt_bundle_stock.can_make = 0)
 *   반품은 묶음 단위 — 소개몰 취소 · 반품 · 교환은 주문 하나 통째(hlt_returns 에 품목 칸 없음)라 묶음이 쪼개지지 않음
 *   판매 중(ON_SALE)인 묶음의 구성은 바꿀 수 없음(멈춘 뒤 고침) · 값은 바꿀 수 있음(새 주문부터) */
CREATE TABLE IF NOT EXISTS public.hlt_bundles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CONSTRAINT ck_hlt_bundle_code CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  name           text NOT NULL CONSTRAINT ck_hlt_bundle_name CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  summary        text CONSTRAINT ck_hlt_bundle_summary CHECK (summary IS NULL OR char_length(summary) <= 200),
  price          bigint NOT NULL CONSTRAINT ck_hlt_bundle_price CHECK (price BETWEEN 1 AND 100000000),
  state          text NOT NULL DEFAULT 'DRAFT' CONSTRAINT ck_hlt_bundle_state CHECK (state IN ('DRAFT', 'ON_SALE', 'STOPPED')),
  max_per_order  integer NOT NULL DEFAULT 5 CONSTRAINT ck_hlt_bundle_max CHECK (max_per_order BETWEEN 1 AND 20),
  created_by     uuid REFERENCES public.accounts(id),
  started_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hlt_bundles IS 'v10.553 (D287) 소개몰 묶음(세트) 할인 — 직판 상품 · 옵션 여럿을 묶음가 하나로 · 재고는 구성 옵션에서 · 처음 꺼짐(smx.bundle) · 판매 중이면 구성 못 바꿈';

CREATE TABLE IF NOT EXISTS public.hlt_bundle_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id   uuid NOT NULL REFERENCES public.hlt_bundles(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.hlt_products(id) ON DELETE RESTRICT,
  option_id   uuid NOT NULL REFERENCES public.hlt_product_options(id) ON DELETE RESTRICT,
  qty         integer NOT NULL CONSTRAINT ck_hlt_bundle_item_qty CHECK (qty BETWEEN 1 AND 20),
  sort        integer NOT NULL DEFAULT 0,
  CONSTRAINT ux_hlt_bundle_item UNIQUE (bundle_id, option_id)
);
CREATE INDEX IF NOT EXISTS idx_hlt_bundle_items_option ON public.hlt_bundle_items (option_id);
COMMENT ON TABLE public.hlt_bundle_items IS 'v10.553 (D287) 묶음 구성 — 옵션 · 수량(1 ~ 20) · 직판 상품만(트리거) · 상품 번호는 옵션에서 채움';

/* 구성 줄 지킴 — 직판 상품만 · 상품은 옵션에서 · 판매 중 묶음은 구성 못 바꿈(지움은 묶음이 지워질 때 함께) */
CREATE OR REPLACE FUNCTION public.fn_smx_bundle_item_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE b record; o record; s_type text;
BEGIN
  SELECT id, state INTO b FROM public.hlt_bundles WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bundle_id ELSE NEW.bundle_id END;
  IF b.id IS NOT NULL AND b.state = 'ON_SALE' THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 판매 중인 묶음의 구성은 바꿀 수 없습니다 — 먼저 판매를 멈추십시오.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT po.id, po.product_id INTO o FROM public.hlt_product_options po WHERE po.id = NEW.option_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'SMX_BUNDLE: 없는 옵션입니다.'; END IF;
  NEW.product_id := o.product_id;
  SELECT s.type INTO s_type FROM public.hlt_products p JOIN public.hlt_sellers s ON s.id = p.seller_id WHERE p.id = o.product_id;
  IF s_type IS DISTINCT FROM 'DIRECT' THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 묶음에는 소개몰 직판 상품만 넣을 수 있습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_bundle_item_guard ON public.hlt_bundle_items;
CREATE TRIGGER trg_smx_bundle_item_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_bundle_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_bundle_item_guard();

/* 묶음 지킴 — 판매 시작은 구성 2줄 이상 · 수량 1 인 줄 하나 이상(묶음가를 원 단위로 나눌 자리) · 모두 직판 · 코드는 초안일 때만 바꿈 · 지우기는 초안만 */
CREATE OR REPLACE FUNCTION public.fn_smx_bundle_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE n_lines integer; n_one integer; n_other integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'SMX_BUNDLE: 판매를 시작했던 묶음은 지우지 않고 멈춥니다.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code IS DISTINCT FROM OLD.code AND OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'SMX_BUNDLE: 판매를 시작했던 묶음의 코드는 바꿀 수 없습니다.';
    END IF;
    IF NEW.state = 'DRAFT' AND OLD.state <> 'DRAFT' THEN
      RAISE EXCEPTION 'SMX_BUNDLE: 판매를 시작했던 묶음은 초안으로 되돌릴 수 없습니다 — 멈춤 · 다시 판매만 됩니다.';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF NEW.state = 'ON_SALE' AND (TG_OP = 'INSERT' OR OLD.state <> 'ON_SALE') THEN
    SELECT count(*), count(*) FILTER (WHERE bi.qty = 1), count(*) FILTER (WHERE s.type IS DISTINCT FROM 'DIRECT')
      INTO n_lines, n_one, n_other
      FROM public.hlt_bundle_items bi JOIN public.hlt_products p ON p.id = bi.product_id LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id
     WHERE bi.bundle_id = NEW.id;
    IF coalesce(n_lines, 0) < 2 THEN RAISE EXCEPTION 'SMX_BUNDLE: 묶음은 구성이 두 줄 이상이어야 판매할 수 있습니다.'; END IF;
    IF coalesce(n_one, 0) < 1 THEN RAISE EXCEPTION 'SMX_BUNDLE: 수량 1 인 구성 줄이 하나는 있어야 합니다(묶음가를 원 단위로 나눠 적는 자리).'; END IF;
    IF coalesce(n_other, 0) > 0 THEN RAISE EXCEPTION 'SMX_BUNDLE: 묶음에는 소개몰 직판 상품만 넣을 수 있습니다.'; END IF;
    NEW.started_at := coalesce(NEW.started_at, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_bundle_guard ON public.hlt_bundles;
CREATE TRIGGER trg_smx_bundle_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_bundles
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_bundle_guard();

/* 묶음 재고 — 만들 수 있는 묶음 수(구성마다 재고 ÷ 구성 수량의 가장 작은 값 · 판매 중 아님 · 옵션 끔이면 0) · 정가 합 */
CREATE OR REPLACE VIEW public.v_hlt_bundle_stock AS
SELECT b.id AS bundle_id,
       count(bi.id)::int AS lines,
       coalesce(min(CASE WHEN p.status = 'ON_SALE' AND o.is_active THEN o.stock / bi.qty ELSE 0 END), 0)::int AS can_make,
       coalesce(sum(o.price * bi.qty), 0)::bigint AS list_amount
  FROM public.hlt_bundles b
  LEFT JOIN public.hlt_bundle_items bi ON bi.bundle_id = b.id
  LEFT JOIN public.hlt_product_options o ON o.id = bi.option_id
  LEFT JOIN public.hlt_products p ON p.id = bi.product_id
 GROUP BY b.id;
COMMENT ON VIEW public.v_hlt_bundle_stock IS 'v10.553 (D287) 묶음 재고 — can_make 0 이면 품절(구성 하나라도 품절) · list_amount 구성 정가 합(묶음 1개)';

/* 주문의 묶음 줄 — 주문 품목(hlt_order_items)은 구성 옵션 줄로 들어가고 bundle_line_id 로 이어짐(재고 빼기 · 되돌림은 기존 트리거 그대로) */
CREATE TABLE IF NOT EXISTS public.hlt_order_bundles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.hlt_orders(id) ON DELETE CASCADE,
  bundle_id    uuid NOT NULL REFERENCES public.hlt_bundles(id) ON DELETE RESTRICT,
  code         text NOT NULL,
  name         text NOT NULL,
  qty          integer NOT NULL CONSTRAINT ck_hlt_ob_qty CHECK (qty BETWEEN 1 AND 20),
  unit_price   bigint NOT NULL CONSTRAINT ck_hlt_ob_price CHECK (unit_price > 0),
  amount       bigint NOT NULL,
  list_amount  bigint NOT NULL CONSTRAINT ck_hlt_ob_list CHECK (list_amount >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_ob_amount CHECK (amount = unit_price * qty)
);
CREATE INDEX IF NOT EXISTS idx_hlt_order_bundles_order ON public.hlt_order_bundles (order_id);
CREATE INDEX IF NOT EXISTS idx_hlt_order_bundles_bundle ON public.hlt_order_bundles (bundle_id, created_at DESC);
COMMENT ON TABLE public.hlt_order_bundles IS 'v10.553 (D287) 주문에 담긴 묶음 — 이름 · 묶음가 · 수량을 주문 때 복사 · 구성 품목 금액 합 = amount(늦춘 확인 트리거) · 고치지 않음';

ALTER TABLE public.hlt_order_items ADD COLUMN IF NOT EXISTS bundle_line_id uuid REFERENCES public.hlt_order_bundles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_hlt_order_items_bundle ON public.hlt_order_items (bundle_line_id) WHERE bundle_line_id IS NOT NULL;
COMMENT ON COLUMN public.hlt_order_items.bundle_line_id IS 'v10.553 (D287) 묶음 구성 품목이면 그 묶음 줄 — 단가는 묶음가를 정가 비율로 나눈 값(원 단위 나머지는 수량 1 인 구성 줄에)';

/* 묶음 줄 넣기 지킴 — 스위치 on · 판매 중 묶음 · 결제 전 주문 · 묶음가 그대로 · 고치지 않음(지움은 주문째일 때만) */
CREATE OR REPLACE FUNCTION public.fn_smx_order_bundle_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE b record; o record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 주문에 담긴 묶음 줄은 고칠 수 없습니다.';
  END IF;
  IF NOT public.fn_hlt_setting_on('smx.bundle') THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 지금은 묶음 할인 상품을 팔지 않습니다.';
  END IF;
  SELECT id, state, price, code, name INTO b FROM public.hlt_bundles WHERE id = NEW.bundle_id FOR SHARE;
  IF b.id IS NULL OR b.state <> 'ON_SALE' THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 판매 중인 묶음이 아닙니다.';
  END IF;
  IF NEW.unit_price <> b.price THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 묶음가가 바뀌었습니다 — 다시 주문해 주십시오.';
  END IF;
  SELECT id, status INTO o FROM public.hlt_orders WHERE id = NEW.order_id;
  IF o.id IS NULL OR o.status <> 'PENDING' THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 결제 전 주문에만 묶음을 담을 수 있습니다.';
  END IF;
  NEW.code := b.code; NEW.name := b.name;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_order_bundle_guard ON public.hlt_order_bundles;
CREATE TRIGGER trg_smx_order_bundle_guard BEFORE INSERT OR UPDATE ON public.hlt_order_bundles
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_order_bundle_guard();

/* 거래 끝에 다시 셈 — 구성 품목 금액 합 = 묶음 줄 금액 · 구성 옵션마다 수량 = 구성 수량 × 묶음 수량(늦춘 확인 · 주문째 되돌아감) */
CREATE OR REPLACE FUNCTION public.fn_smx_order_bundle_sum() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_sum bigint; v_bad integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.hlt_order_bundles WHERE id = NEW.id) THEN RETURN NULL; END IF;
  SELECT coalesce(sum(amount), 0) INTO v_sum FROM public.hlt_order_items WHERE bundle_line_id = NEW.id;
  IF v_sum <> NEW.amount THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 묶음 구성 품목 금액이 묶음가와 맞지 않습니다 — 다시 주문해 주십시오.';
  END IF;
  SELECT count(*) INTO v_bad
    FROM public.hlt_bundle_items bi
    LEFT JOIN (SELECT option_id, sum(qty) AS q FROM public.hlt_order_items WHERE bundle_line_id = NEW.id GROUP BY option_id) x ON x.option_id = bi.option_id
   WHERE bi.bundle_id = NEW.bundle_id AND coalesce(x.q, 0) <> bi.qty * NEW.qty;
  IF v_bad > 0 OR EXISTS (SELECT 1 FROM public.hlt_order_items it WHERE it.bundle_line_id = NEW.id
                            AND NOT EXISTS (SELECT 1 FROM public.hlt_bundle_items bi WHERE bi.bundle_id = NEW.bundle_id AND bi.option_id = it.option_id)) THEN
    RAISE EXCEPTION 'SMX_BUNDLE: 묶음 구성 품목이 묶음 구성과 맞지 않습니다 — 다시 주문해 주십시오.';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_smx_order_bundle_sum ON public.hlt_order_bundles;
CREATE CONSTRAINT TRIGGER trg_smx_order_bundle_sum AFTER INSERT ON public.hlt_order_bundles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_smx_order_bundle_sum();

/* 주문 품목의 묶음 줄 — 같은 주문의 묶음 줄만 · 나중에 붙이거나 떼지 않음 */
CREATE OR REPLACE FUNCTION public.fn_smx_order_item_bundle() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_order uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.bundle_line_id IS DISTINCT FROM OLD.bundle_line_id THEN
      RAISE EXCEPTION 'SMX_BUNDLE: 주문 품목의 묶음 표시는 바꿀 수 없습니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.bundle_line_id IS NOT NULL THEN
    SELECT order_id INTO v_order FROM public.hlt_order_bundles WHERE id = NEW.bundle_line_id;
    IF v_order IS DISTINCT FROM NEW.order_id THEN
      RAISE EXCEPTION 'SMX_BUNDLE: 다른 주문의 묶음 줄입니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_order_item_bundle ON public.hlt_order_items;
CREATE TRIGGER trg_smx_order_item_bundle BEFORE INSERT OR UPDATE OF bundle_line_id ON public.hlt_order_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_order_item_bundle();

/* ── ② 도서산간 배송비 ────────────────────────────────────────────────
 *   우편번호 범위 표(제주 · 도서 · 산간 · 그 밖) · 운영이 금액 지정 · 주문 때 배송지 우편번호로 자동 더함 · 주문서에 따로 표시
 *   직판 · 입점 판매자 주문 모두(대표 11/21) — 입점 주문의 추가 몫은 판매자 몫으로 정산(아래 v_hlt_settle_ready) · 처음 꺼짐(smx.remote_ship)
 *   세무(대표 11/21 · 일반 원칙) — 면세 상품만 담은 직판 주문의 추가 몫은 면세 · 섞이면 상품 금액 비율로 나눔(fn_smx_remote_exempt · smx.remote_tax_mode)
 *   주문 금액 규칙(hlt_orders_total_check)은 바꾸지 않음 — 추가 배송비는 ship_fee 안에 들어가고 remote_ship_fee 로 따로 적음 */
CREATE TABLE IF NOT EXISTS public.smx_remote_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CONSTRAINT ck_smx_rz_name CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
  kind        text NOT NULL DEFAULT 'ISLAND' CONSTRAINT ck_smx_rz_kind CHECK (kind IN ('JEJU', 'ISLAND', 'MOUNTAIN', 'OTHER')),
  zip_from    text NOT NULL CONSTRAINT ck_smx_rz_from CHECK (zip_from ~ '^[0-9]{5}$'),
  zip_to      text NOT NULL CONSTRAINT ck_smx_rz_to CHECK (zip_to ~ '^[0-9]{5}$'),
  fee         integer NOT NULL CONSTRAINT ck_smx_rz_fee CHECK (fee BETWEEN 0 AND 100000),
  is_active   boolean NOT NULL DEFAULT true,
  memo        text CONSTRAINT ck_smx_rz_memo CHECK (memo IS NULL OR char_length(memo) <= 200),
  updated_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_smx_rz_range CHECK (zip_from <= zip_to),
  CONSTRAINT ux_smx_rz_range UNIQUE (zip_from, zip_to)
);
CREATE INDEX IF NOT EXISTS idx_smx_rz_active ON public.smx_remote_zones (zip_from, zip_to) WHERE is_active;
COMMENT ON TABLE public.smx_remote_zones IS 'v10.554 (D287) 도서산간 추가 배송비 — 우편번호 범위(5자리 · 처음 ~ 끝 포함) · 금액(원 · 0 ~ 100,000) · 겹치면 큰 금액 하나 · smx.remote_ship on 일 때 직판 · 입점 주문 모두';

CREATE OR REPLACE FUNCTION public.fn_smx_remote_zone_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_remote_zone_touch ON public.smx_remote_zones;
CREATE TRIGGER trg_smx_remote_zone_touch BEFORE UPDATE ON public.smx_remote_zones
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_remote_zone_touch();

/* 우편번호 → 추가 배송비(켠 줄 가운데 가장 큰 금액 하나 · 없으면 줄 없음) */
CREATE OR REPLACE FUNCTION public.fn_smx_remote_fee(p_zip text) RETURNS TABLE (zone_id uuid, zone_name text, fee integer)
  LANGUAGE sql STABLE AS $$
  SELECT z.id, z.name, z.fee
    FROM public.smx_remote_zones z
   WHERE p_zip ~ '^[0-9]{5}$' AND z.is_active AND p_zip BETWEEN z.zip_from AND z.zip_to
   ORDER BY z.fee DESC, z.zip_from
   LIMIT 1
$$;

/* 주문에 따로 적는 칸 — ship_fee 안의 도서산간 몫 · 구역 이름(주문 때 복사) · 주문 뒤 바꾸지 않음 */
ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS remote_ship_fee bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS remote_zone text;
ALTER TABLE public.hlt_orders DROP CONSTRAINT IF EXISTS ck_hlt_order_remote_ship;
ALTER TABLE public.hlt_orders ADD CONSTRAINT ck_hlt_order_remote_ship
  CHECK (remote_ship_fee >= 0 AND remote_ship_fee <= ship_fee AND (remote_ship_fee = 0 OR remote_zone IS NOT NULL));
COMMENT ON COLUMN public.hlt_orders.remote_ship_fee IS 'v10.554 (D287) 배송비(ship_fee) 가운데 도서산간 추가 몫(원) — 주문 때 한 번 · 주문서 · 내 주문에 따로 표시 · total 규칙은 그대로';
COMMENT ON COLUMN public.hlt_orders.remote_zone IS 'v10.554 (D287) 도서산간 구역 이름(주문 때 복사 — 구역 표를 고쳐도 주문은 그대로)';

CREATE OR REPLACE FUNCTION public.fn_smx_order_remote_lock() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.remote_ship_fee IS DISTINCT FROM OLD.remote_ship_fee OR NEW.remote_zone IS DISTINCT FROM OLD.remote_zone THEN
    RAISE EXCEPTION 'SMX_REMOTE: 주문의 도서산간 배송비는 주문 뒤 바꿀 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_order_remote_lock ON public.hlt_orders;
CREATE TRIGGER trg_smx_order_remote_lock BEFORE UPDATE OF remote_ship_fee, remote_zone ON public.hlt_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_order_remote_lock();

/* 처음 구역 2줄(흔히 쓰는 범위 · 금액은 운영 확인 뒤 고침 — 스위치가 꺼져 있어 주문에는 아직 안 붙음) */
INSERT INTO public.smx_remote_zones (name, kind, zip_from, zip_to, fee, memo) VALUES
  ('제주특별자치도', 'JEJU', '63000', '63644', 3000, '처음 값 — 택배사 계약 금액 · 범위 확인 뒤 고침(D287)'),
  ('울릉도 · 독도', 'ISLAND', '40200', '40240', 5000, '처음 값 — 택배사 계약 금액 · 범위 확인 뒤 고침(D287)')
ON CONFLICT (zip_from, zip_to) DO NOTHING;

/* 입점 정산 — 도서산간 몫은 판매자 몫(대표 11/21). 주 정산(fn_hlt_settle_close)은 이 보기의 goods_amount 를 매출 · 지급액으로 쓰고
 * 정산 뒤 환불도 정산 항목의 goods_amount 를 되돌리므로, 보기에서 goods_amount 에 remote_ship_fee 를 더하면 정산 · 환불 · 월 정산서(b281 · hlt_settlements 합)가 그대로 따라감.
 * 수수료는 품목 수수료(commission_amount) 합 그대로 — 도서산간 몫 · 기본 배송비에는 수수료를 매기지 않음. 입점 판매자 기본 배송비(ship_fee − remote_ship_fee)도 판매자 몫(11/21 대표 · 아래).
 * D035 판 칸 이름 · 차례 그대로 + goods_amount 식 · 끝에 remote_ship_fee · base_ship_fee 두 칸(그래서 CREATE OR REPLACE 됨) */
/* 11/21 대표 — 입점(TENANT · BRAND) 판매자의 기본 배송비도 판매자에게 정산
 *   goods_amount(정산 대상 금액) = 입점: 상품 금액 + 기본 배송비 + 도서산간 몫 / 직판: 상품 금액 + 도서산간 몫(직판 기본 배송비 0 · 앞 판 그대로)
 *   수수료는 상품 금액에만(품목 수수료 합 그대로) · 칸 base_ship_fee(기본 배송비) · remote_ship_fee(도서산간 몫)를 따로 보임
 *   주 정산서(fn_hlt_settle_close) · 정산 항목 · 정산 뒤 환불(정산 항목 goods_amount 를 되돌림) · 월 정산서(정산서 합)가 같은 값을 봄 */
CREATE OR REPLACE VIEW public.v_hlt_settle_ready AS
 SELECT o.id AS order_id, o.seller_id, o.order_no,
    (o.goods_amount + o.remote_ship_fee + CASE WHEN s.type IN ('TENANT', 'BRAND') THEN greatest(o.ship_fee - o.remote_ship_fee, 0) ELSE 0 END) AS goods_amount,
    ( SELECT COALESCE(sum(i.commission_amount), (0)::numeric) FROM hlt_order_items i WHERE i.order_id = o.id) AS commission,
    o.delivered_at, (o.delivered_at + '7 days'::interval) AS confirm_at, o.remote_ship_fee,
    (CASE WHEN s.type IN ('TENANT', 'BRAND') THEN greatest(o.ship_fee - o.remote_ship_fee, 0) ELSE 0 END)::bigint AS base_ship_fee
   FROM hlt_orders o LEFT JOIN hlt_sellers s ON s.id = o.seller_id
  WHERE o.status IN ('DELIVERED','CONFIRMED') AND o.delivered_at IS NOT NULL AND o.delivered_at < (now() - '7 days'::interval)
    AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items si WHERE si.order_id = o.id AND si.kind = 'SALE')
    AND NOT EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state = ANY (ARRAY['APPROVED','REFUNDED']));
COMMENT ON VIEW public.v_hlt_settle_ready IS '정산 대상. **배송 완료 + 청약철회 7일**이 지나고 반품이 없는 주문입니다. v10.554 (D287) goods_amount = 상품 금액 + 도서산간 몫 + (입점이면) 기본 배송비 — 배송비는 판매자 몫 · 수수료 없음(11/21 대표) · base_ship_fee · remote_ship_fee 따로';

/* 세무(대표 11/21 · 일반 원칙) — 주문의 도서산간 몫 가운데 면세 몫
 *   RATIO(처음): 면세 상품만 담은 주문은 전부 면세 · 과세 · 면세 섞이면 상품 금액 비율(면세 품목 금액 ÷ 상품 금액 · 원 아래 버림)
 *   TAXABLE: 늘 과세(0) — smx.remote_tax_mode 는 SUPER 만 바꿈(admin.service 패치)
 *   쓰는 곳: 현금영수증 금액 나눔(fn_hlt_cr_amounts · 아래) · 직판 매출 · 환불 전표(journal.ts MALL_SALE · MALL_REFUND 의 exempt 패치) */
CREATE OR REPLACE FUNCTION public.fn_smx_remote_exempt(p_order uuid) RETURNS bigint
  LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT CASE WHEN coalesce(o.remote_ship_fee, 0) <= 0 OR coalesce(o.goods_amount, 0) <= 0 THEN 0
                WHEN coalesce((SELECT s.value FROM public.site_settings s WHERE s.key = 'smx.remote_tax_mode'), 'RATIO') = 'TAXABLE' THEN 0
                ELSE (o.remote_ship_fee * coalesce((SELECT sum(it.amount) FROM public.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) / o.goods_amount)::bigint END
      FROM public.hlt_orders o WHERE o.id = p_order), 0)::bigint
$$;
COMMENT ON FUNCTION public.fn_smx_remote_exempt(uuid) IS 'v10.554 (D287) 도서산간 몫의 면세 몫 — RATIO(면세만이면 전부 · 섞이면 상품 금액 비율) · TAXABLE(0) · smx.remote_tax_mode';

/* 현금영수증 금액 나눔 — D274 판 그대로 + 면세 몫에 도서산간 면세 몫을 더함(결제 금액까지) */
CREATE OR REPLACE FUNCTION public.fn_hlt_cr_amounts(p_order uuid, OUT o_amount bigint, OUT o_tax_free bigint, OUT o_supply bigint, OUT o_vat bigint)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_goods bigint; v_disc bigint; v_ex bigint; v_paid bigint; v_tax bigint;
BEGIN
  SELECT o.goods_amount, o.discount_amount, coalesce((SELECT sum(it.amount) FROM public.hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0),
         coalesce((SELECT p.amount - coalesce(p.canceled_amount, 0) FROM public.hlt_payments p WHERE p.order_id = o.id AND p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL ORDER BY p.approved_at DESC LIMIT 1), o.total)
    INTO v_goods, v_disc, v_ex, v_paid FROM public.hlt_orders o WHERE o.id = p_order;
  IF v_paid IS NULL OR v_paid <= 0 THEN o_amount := NULL; o_tax_free := 0; o_supply := NULL; o_vat := NULL; RETURN; END IF;
  o_amount := v_paid;
  o_tax_free := least(v_paid, CASE WHEN coalesce(v_goods, 0) > 0 THEN (v_ex * (v_goods - coalesce(v_disc, 0)) / v_goods) ELSE 0 END + public.fn_smx_remote_exempt(p_order));
  v_tax := v_paid - o_tax_free;
  o_vat := round(v_tax / 11.0)::bigint;
  o_supply := v_tax - o_vat;
END $$;

/* ── ③ 리뷰 판매자 답글 ──────────────────────────────────────────────
 *   입점 판매자는 자기 상품 리뷰에 · 직판 상품 리뷰는 운영자가 · 리뷰 하나에 답글 하나(review_id 고유)
 *   금칙어는 기존 사전(fn_check_banned_words · 소개몰 HLT + 공통) 그대로 — 걸리면 운영 확인 뒤 보임(PENDING)
 *   고치기 기록은 쌓기만(hlt_review_reply_edits · 고치지 못함) · 운영은 가림(HIDDEN · 사유) · 리뷰를 지우면 답글도 함께 지움
 *   처음 꺼짐(smx.review_reply) — 꺼져 있으면 쓰기 막음 · 공개 리뷰 목록에도 안 보임 */
CREATE TABLE IF NOT EXISTS public.hlt_review_replies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      uuid NOT NULL UNIQUE REFERENCES public.hlt_reviews(id) ON DELETE CASCADE,
  author_kind    text NOT NULL CONSTRAINT ck_hlt_rr_kind CHECK (author_kind IN ('SELLER', 'STAFF')),
  author_id      uuid NOT NULL REFERENCES public.accounts(id),
  seller_id      uuid REFERENCES public.hlt_sellers(id),
  body           text NOT NULL CONSTRAINT ck_hlt_rr_body CHECK (char_length(btrim(body)) BETWEEN 2 AND 1000),
  state          text NOT NULL DEFAULT 'VISIBLE' CONSTRAINT ck_hlt_rr_state CHECK (state IN ('VISIBLE', 'PENDING', 'HIDDEN')),
  hold_word      text,
  hidden_reason  text,
  decided_by     uuid REFERENCES public.accounts(id),
  decided_at     timestamptz,
  edit_count     integer NOT NULL DEFAULT 0 CONSTRAINT ck_hlt_rr_edits CHECK (edit_count >= 0),
  notified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_rr_hidden CHECK (state <> 'HIDDEN' OR btrim(coalesce(hidden_reason, '')) <> ''),
  CONSTRAINT ck_hlt_rr_seller CHECK ((author_kind = 'SELLER') = (seller_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_hlt_rr_state ON public.hlt_review_replies (state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hlt_rr_seller ON public.hlt_review_replies (seller_id) WHERE seller_id IS NOT NULL;
COMMENT ON TABLE public.hlt_review_replies IS 'v10.555 (D287) 소개몰 리뷰 답글 — 입점 판매자는 자기 상품 · 직판은 운영자 · 리뷰당 하나 · 금칙어면 PENDING · 운영 가림 · 처음 꺼짐(smx.review_reply)';

CREATE TABLE IF NOT EXISTS public.hlt_review_reply_edits (
  id          bigserial PRIMARY KEY,
  reply_id    uuid NOT NULL REFERENCES public.hlt_review_replies(id) ON DELETE CASCADE,
  old_body    text NOT NULL,
  new_body    text NOT NULL,
  edited_by   uuid REFERENCES public.accounts(id),
  edited_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hlt_rre_reply ON public.hlt_review_reply_edits (reply_id, edited_at DESC);
COMMENT ON TABLE public.hlt_review_reply_edits IS 'v10.555 (D287) 리뷰 답글 고치기 기록 — 고칠 때마다 앞 글 · 새 글 · 고친 사람 · 쌓기만(고치지 못함 · 답글이 지워지면 함께)';

/* 답글 지킴 — 누가 쓸 수 있나(입점 = 그 상품 판매자 본인 · 직판 = 운영자) · 보이는 리뷰에만 · 리뷰 · 쓴 쪽 못 바꿈 · 가린 답글 못 고침 · 금칙어 */
CREATE OR REPLACE FUNCTION public.fn_smx_reply_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE r record; hit record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT rv.id, rv.state, s.id AS seller_id, s.type AS seller_type, s.account_id AS seller_account
      INTO r
      FROM public.hlt_reviews rv JOIN public.hlt_products p ON p.id = rv.product_id LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id
     WHERE rv.id = NEW.review_id;
    IF r.id IS NULL THEN RAISE EXCEPTION 'SMX_REPLY: 없는 리뷰입니다.'; END IF;
    IF r.state <> 'VISIBLE' THEN RAISE EXCEPTION 'SMX_REPLY: 보이는 리뷰에만 답글을 달 수 있습니다.'; END IF;
    IF r.seller_type = 'DIRECT' OR r.seller_type IS NULL THEN
      IF NEW.author_kind <> 'STAFF' THEN RAISE EXCEPTION 'SMX_REPLY: 직판 상품 리뷰의 답글은 운영자가 씁니다.'; END IF;
      NEW.seller_id := NULL;
    ELSE
      IF NEW.author_kind <> 'SELLER' OR r.seller_account IS DISTINCT FROM NEW.author_id THEN
        RAISE EXCEPTION 'SMX_REPLY: 입점 상품 리뷰의 답글은 그 상품의 판매자만 씁니다.';
      END IF;
      NEW.seller_id := r.seller_id;
    END IF;
    NEW.edit_count := 0;
  ELSE
    IF NEW.review_id <> OLD.review_id OR NEW.author_kind <> OLD.author_kind OR NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN
      RAISE EXCEPTION 'SMX_REPLY: 답글의 리뷰 · 쓴 쪽은 바꿀 수 없습니다.';
    END IF;
    IF OLD.author_kind = 'SELLER' AND NEW.author_id <> OLD.author_id THEN
      RAISE EXCEPTION 'SMX_REPLY: 판매자 답글은 그 판매자만 고칩니다.';
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body THEN
      IF OLD.state = 'HIDDEN' THEN RAISE EXCEPTION 'SMX_REPLY: 가려진 답글은 고칠 수 없습니다.'; END IF;
      NEW.edit_count := OLD.edit_count + 1;
    ELSE
      NEW.edit_count := OLD.edit_count;
    END IF;
    NEW.updated_at := now();
  END IF;
  IF TG_OP = 'INSERT' OR NEW.body IS DISTINCT FROM OLD.body THEN
    SELECT * INTO hit FROM public.fn_check_banned_words(NEW.body, 'HLT') LIMIT 1;
    IF hit.word IS NOT NULL THEN
      IF NEW.state = 'VISIBLE' THEN NEW.state := 'PENDING'; END IF;
      NEW.hold_word := hit.word;
    ELSIF TG_OP = 'UPDATE' AND OLD.state = 'PENDING' AND OLD.decided_at IS NULL AND NEW.state = 'PENDING' THEN
      NEW.state := 'VISIBLE'; NEW.hold_word := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_smx_reply_guard ON public.hlt_review_replies;
CREATE TRIGGER trg_smx_reply_guard BEFORE INSERT OR UPDATE ON public.hlt_review_replies
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_reply_guard();

/* 글을 고치면 기록 한 줄(앞 글 · 새 글 · 고친 사람 = 그때 쓴 사람) */
CREATE OR REPLACE FUNCTION public.fn_smx_reply_edit_log() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    INSERT INTO public.hlt_review_reply_edits (reply_id, old_body, new_body, edited_by) VALUES (NEW.id, OLD.body, NEW.body, NEW.author_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_smx_reply_edit_log ON public.hlt_review_replies;
CREATE TRIGGER trg_smx_reply_edit_log AFTER UPDATE OF body ON public.hlt_review_replies
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_reply_edit_log();

/* 고치기 기록은 쌓기만 — 바꾸지 못함(지움은 답글 · 리뷰가 지워질 때 함께) */
CREATE OR REPLACE FUNCTION public.fn_smx_reply_edits_lock() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SMX_REPLY: 답글 고치기 기록은 바꿀 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_smx_reply_edits_lock ON public.hlt_review_reply_edits;
CREATE TRIGGER trg_smx_reply_edits_lock BEFORE UPDATE ON public.hlt_review_reply_edits
  FOR EACH ROW EXECUTE FUNCTION public.fn_smx_reply_edits_lock();

/* ── ④ 설정 · ㉕ 권한(D258) 시드 ──────────────────────────────────────
 *   세 스위치 모두 처음 off · 세무 구분 smx.remote_tax_mode 처음 RATIO(스위치 아님 · SUPER 만)(규칙 9 · 주문 받기가 꺼진 지금은 운영 화면에서 미리 만들어 두기만) · 정기 작업 없음 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('smx.bundle', 'off', 'ADMIN', '소개몰 묶음(세트) 할인 판매(v10.553 · D287) — 처음 off · on 이면 판매 중 묶음이 공개 목록에 보이고 주문에 담을 수 있음(직판만 · 쿠폰과 함께 쓰면 대상은 묶음가 · 재고는 구성 옵션에서)', false, '^(on|off)$', 'off'),
  ('smx.remote_ship', 'off', 'ADMIN', '도서산간 추가 배송비(v10.554 · D287) — 처음 off · on 이면 주문(직판 · 입점) 배송지 우편번호가 구역 표(소개몰 › 도서산간 배송비)에 들면 그 금액을 배송비에 더하고 주문서에 따로 보임 · 입점 주문의 몫은 판매자 정산', false, '^(on|off)$', 'off'),
  ('smx.remote_tax_mode', 'RATIO', 'ADMIN', '도서산간 배송비 부가세 구분(v10.554 · D287 · 일반 원칙 · SUPER 만 바꿈) — RATIO(처음): 면세 상품만 담은 주문은 면세 · 섞이면 상품 금액 비율로 나눔 / TAXABLE: 늘 과세 · 현금영수증 · 직판 매출 전표가 씀', false, '^(RATIO|TAXABLE)$', 'RATIO'),
  ('smx.review_reply', 'off', 'ADMIN', '리뷰 판매자 답글(v10.555 · D287) — 처음 off · on 이면 입점 판매자(자기 상품) · 운영자(직판 상품)가 리뷰에 답글 하나 · 금칙어면 운영 확인 뒤 보임 · 꺼지면 공개 화면에도 안 보임', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) 시드 — 새 탭 3개(소개몰 묶음 admhlt · TAB_ROLES 따로 없음 = ADMIN · SUPER)
 *   gen_seed.py 와 같은 규칙: GET = VIEW · 판매 시작 · 멈춤 · 답글 보이기 · 가림 = APPROVE · 그 밖 변경 = EDIT */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('smx-bundles', '묶음 할인', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3210),
  ('smx-remote', '도서산간 배송비', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3220),
  ('smx-replies', '리뷰 답글', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 3230)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'smx-bundles', 'VIEW'), ('R_ADMIN', 'smx-bundles', 'EDIT'), ('R_ADMIN', 'smx-bundles', 'APPROVE'), ('R_ADMIN', 'smx-bundles', 'EXPORT'),
  ('R_ADMIN', 'smx-remote', 'VIEW'), ('R_ADMIN', 'smx-remote', 'EDIT'), ('R_ADMIN', 'smx-remote', 'APPROVE'), ('R_ADMIN', 'smx-remote', 'EXPORT'),
  ('R_ADMIN', 'smx-replies', 'VIEW'), ('R_ADMIN', 'smx-replies', 'EDIT'), ('R_ADMIN', 'smx-replies', 'APPROVE'), ('R_ADMIN', 'smx-replies', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/smx/bundles', 'smx-bundles', 'VIEW'),
  ('POST', '/admin/smx/bundles', 'smx-bundles', 'EDIT'),
  ('PUT', '/admin/smx/bundles/{id}', 'smx-bundles', 'EDIT'),
  ('POST', '/admin/smx/bundles/{id}/state', 'smx-bundles', 'APPROVE'),
  ('GET', '/admin/smx/remote-zones', 'smx-remote', 'VIEW'),
  ('GET', '/admin/smx/remote-zones/check', 'smx-remote', 'VIEW'),
  ('POST', '/admin/smx/remote-zones', 'smx-remote', 'EDIT'),
  ('PUT', '/admin/smx/remote-zones/{id}', 'smx-remote', 'EDIT'),
  ('DELETE', '/admin/smx/remote-zones/{id}', 'smx-remote', 'EDIT'),
  ('GET', '/admin/smx/review-replies', 'smx-replies', 'VIEW'),
  ('GET', '/admin/smx/review-replies/{id}/edits', 'smx-replies', 'VIEW'),
  ('PUT', '/admin/smx/review-replies/{id}', 'smx-replies', 'EDIT'),
  ('POST', '/admin/smx/review-replies/{id}/decide', 'smx-replies', 'APPROVE')
ON CONFLICT DO NOTHING;


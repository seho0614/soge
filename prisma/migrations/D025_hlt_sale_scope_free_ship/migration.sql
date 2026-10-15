-- =====================================================================
-- D025 — 소개몰: 취급 갈래(잠금 · 미판매) · 배송비 전 상품 무료 (2026-10-08 결정 · v10.25)
--
--   사장님 결정(2026-10-08): 「개발분과 시안이 다르면 시안을 기준으로」 — 서로 다르게 말하던 3건을 시안 값으로.
--     ① 배송비          시안 「전 상품 무료」          ← 개발분 「3만원 이상 무료 · 미만 3,000원」
--     ② 의료기기        시안 「현재 판매하지 않습니다」  ← 개발분 「심의필 번호가 있으면 판매」
--     ③ 건강기능식품    시안 「잠금 — 2단계에 엶」      ← 개발분 「판매」
--
--   ★ 이 마이그레이션은 **소개몰이 직접 파는 상품(hlt_products)** 의 규칙만 바꿉니다.
--     회원 간 도매 · 납품 매물의 등록 규칙(restricted_industries — 의료기기 = 심의필, 의약품 · 의료 서비스 = 금지)은 그대로입니다.
--     그래서 그 표를 쓰지 않고 소개몰 전용 표를 따로 둡니다.
--
--   반품 왕복 배송비 6,000원(D009 · 회원 사정 반품)은 그대로입니다 — 시안에도 같은 값이 있습니다.
--   약관 문구(판매 약관의 배송비 조항)는 D024 가 이름과 함께 고칩니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 소개몰 취급 갈래
--      OPEN      지금 팝니다
--      LOCKED    준비 중 — 화면에 자물쇠와 안내가 나옵니다(상품은 팔 수 없음)
--      NOT_SOLD  팔지 않습니다 — 갈래 단추에 나오지 않고, 이용안내의 「취급하지 않는 것」에 적습니다
--    이 표에 없는 갈래는 OPEN 으로 봅니다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hlt_sale_categories (
  category_code text PRIMARY KEY,
  state         text NOT NULL CHECK (state IN ('OPEN','LOCKED','NOT_SOLD')),
  note          text,
  sort          integer NOT NULL DEFAULT 100,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hlt_sale_categories_note_check CHECK (state = 'OPEN' OR coalesce(btrim(note), '') <> '')
);
COMMENT ON TABLE public.hlt_sale_categories IS
  '소개몰(직판)이 취급하는 갈래의 상태. LOCKED · NOT_SOLD 갈래의 상품은 판매 중으로 둘 수 없습니다(fn_hlt_product_guard). 회원 간 매물의 등록 규칙(restricted_industries)과는 별개입니다.';
COMMENT ON COLUMN public.hlt_sale_categories.note IS '손님에게 보이는 안내 — 잠금 · 미판매의 까닭. OPEN 이 아니면 반드시 적습니다.';

INSERT INTO public.hlt_sale_categories (category_code, state, note, sort) VALUES
  ('HLT_FOOD',   'OPEN',     NULL, 10),
  ('HLT_FUNC',   'LOCKED',   '건강기능식품은 준비 중입니다. 2단계에 엽니다(건강기능식품 판매업 영업신고와 표시 · 광고 심의 체계를 갖춘 뒤).', 30),
  ('HLT_MEDDEV', 'NOT_SOLD', '의료기기는 현재 판매하지 않습니다(의료기기법 제24조 — 광고 사전심의 대상).', 90)
ON CONFLICT (category_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) 잠금 · 미판매 갈래의 상품은 판매 중지로 — 지우지 않습니다(지난 주문이 가리킵니다)
-- ---------------------------------------------------------------------
UPDATE public.hlt_products p
   SET status = 'STOPPED', updated_at = now()
  FROM public.categories c
  JOIN public.hlt_sale_categories s ON s.category_code = c.code AND s.state IN ('LOCKED','NOT_SOLD')
 WHERE c.id = p.category_id AND p.status IN ('ON_SALE','SOLD_OUT');

-- 회원이 담아 둔 장바구니는 건드리지 않습니다 — 장바구니가 「판매 중이 아닌 상품」으로 알려 주고 회원이 뺍니다(지금 있는 동작).

-- ---------------------------------------------------------------------
-- 3) 상품 규칙 — 잠금 · 미판매 갈래의 상품은 「판매 중」으로 둘 수 없습니다
--    (D024 의 함수에 갈래 상태 확인을 더한 것입니다. 나머지는 같습니다)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_hlt_product_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c record; r record; s record;
BEGIN
  IF NEW.status NOT IN ('ON_SALE','SOLD_OUT') THEN RETURN NEW; END IF;
  IF NEW.category_id IS NULL THEN
    RAISE EXCEPTION 'HLTP: 업종을 정해야 판매할 수 있습니다';
  END IF;
  SELECT * INTO c FROM categories WHERE id = NEW.category_id;
  IF c.gwan_code <> 'HLT' THEN
    RAISE EXCEPTION 'HLTP: 소개몰 업종이 아닙니다 — 직판은 소개몰만입니다';
  END IF;
  SELECT * INTO s FROM hlt_sale_categories WHERE category_code = c.code;
  IF s.state IN ('LOCKED','NOT_SOLD') THEN
    RAISE EXCEPTION 'HLTP: %', s.note;
  END IF;
  SELECT * INTO r FROM restricted_industries
   WHERE code = c.restricted_code AND gwan_code = 'HLT' AND is_active;
  IF r.id IS NOT NULL THEN
    IF r.mode IN ('BLOCK','AD_ONLY') THEN RAISE EXCEPTION 'HLTP: %', r.block_message; END IF;
    IF r.mode = 'GATED' AND coalesce(btrim(NEW.review_no),'') = '' THEN
      RAISE EXCEPTION 'HLTP: 심의필 번호가 있어야 판매할 수 있습니다 (의료기기법 24조)';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 갈래를 잠그면 그 갈래에 「판매 중」 상품이 남지 않아야 합니다 — 점검용
CREATE OR REPLACE VIEW public.v_hlt_locked_on_sale AS
 SELECT p.code, p.name, p.status, c.code AS category_code, s.state
   FROM public.hlt_products p
   JOIN public.categories c ON c.id = p.category_id
   JOIN public.hlt_sale_categories s ON s.category_code = c.code AND s.state IN ('LOCKED','NOT_SOLD')
  WHERE p.status IN ('ON_SALE','SOLD_OUT');
COMMENT ON VIEW public.v_hlt_locked_on_sale IS '잠금 · 미판매 갈래인데 판매 중인 상품 — 늘 0건이어야 합니다.';

-- ---------------------------------------------------------------------
-- 4) 배송비 — 전 상품 무료. 장바구니 요약(v_hlt_cart)이 3만원 기준으로 3,000원을 붙이던 것을 없앱니다.
--    칸(ship_fee)은 남깁니다 — 주문 표의 total = goods_amount + ship_fee 규칙과 화면이 그 칸을 봅니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_hlt_cart AS
 SELECT ci.account_id,
    count(*) AS lines,
    sum(ci.qty) AS items,
    sum((p.price * ci.qty)) AS goods,
    0 AS ship_fee,
    sum((p.price * ci.qty)) AS total,
    bool_or(((p.stock < ci.qty) OR (p.status <> 'ON_SALE'::text))) AS has_problem
   FROM (public.hlt_cart_items ci
     JOIN public.hlt_products p ON ((p.id = ci.product_id)))
  GROUP BY ci.account_id;

-- ── 청약철회 규칙의 이름(2026-10-08) ─────────────────────────────────────────
-- 의료기기는 팔지 않습니다(위 hlt_sale_categories). 팔지 않는 품목을 규칙 이름에 두면 주문 상세 · 이용안내가 「의료기기」를 파는 것처럼 읽힙니다.
-- 규칙(7일 · 사용 흔적이 있거나 위생상 재판매가 어려운 경우 · 전자상거래법 17조 2항)은 그대로이고 이름만 바꿉니다.
UPDATE withdrawal_rules SET label = '건강기기' WHERE code = 'DEVICE' AND label = '의료기기 · 건강기기';

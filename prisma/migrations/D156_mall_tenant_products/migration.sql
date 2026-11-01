-- =====================================================================
-- D156 · 소개몰 입점 2단계 — 판매자 상품 등록 → 운영 검수 · 배송비 · 반품비(상한 6,000원) — 꺼진 채로 (v10.166 · 2026-11-01 · sgb-core docs/257)
--   대표 결정(11/1 · decisions/mall-return-refund #15 — C 반품 배송비는 판매자가 정하되 왕복 6,000원 상한 · A 판매대금 판매자 직접 귀속)
--   ① hlt_products 칸 더함   review_state(NONE · SUBMITTED · APPROVED · REJECTED) · review_note · submitted_at · reviewed_at · reviewed_by
--   ② hlt_sellers 칸 더함    ship_fee(기본 배송비 · 0 ~ 50,000) · free_ship_over(이 금액 이상 무료 · 비우면 없음) · return_ship_fee(회원 사정 왕복 반품비 · 0 ~ 6,000)
--   ③ 입점 상품 판매 문(fn_hlt_tenant_sale_guard) — 직판이 아닌 상품은 판매 중으로 바꾸려면
--      운영 검수 통과(APPROVED) · 판매자 ACTIVE · 하위가맹점 ID(결제대행사 직접 귀속) · 설정 mall.tenant on 이 모두 있어야 함
--   직판(DIRECT) 상품 · 주문 · 정산은 바꾸지 않음(검수 칸은 NONE 그대로 · 문은 직판을 보지 않음). 재실행 안전 · 지우는 문장 없음
-- =====================================================================

ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.accounts(id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hlt_products_review_state') THEN
    ALTER TABLE public.hlt_products ADD CONSTRAINT ck_hlt_products_review_state CHECK (review_state IN ('NONE', 'SUBMITTED', 'APPROVED', 'REJECTED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hlt_products_review_note') THEN
    ALTER TABLE public.hlt_products ADD CONSTRAINT ck_hlt_products_review_note CHECK (review_state <> 'REJECTED' OR length(btrim(coalesce(review_note, ''))) >= 2);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_hlt_products_review ON public.hlt_products (submitted_at) WHERE review_state = 'SUBMITTED';
COMMENT ON COLUMN public.hlt_products.review_state IS '입점 상품 운영 검수(D156) — NONE 내지 않음 · SUBMITTED 검수 대기 · APPROVED 통과(판매 시작 가능) · REJECTED 반려(사유 review_note). 직판은 NONE 그대로';

ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS ship_fee integer NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS free_ship_over integer;
ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS return_ship_fee integer NOT NULL DEFAULT 6000;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hlt_sellers_ship_fee') THEN
    ALTER TABLE public.hlt_sellers ADD CONSTRAINT ck_hlt_sellers_ship_fee CHECK (ship_fee BETWEEN 0 AND 50000 AND (free_ship_over IS NULL OR free_ship_over > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hlt_sellers_return_fee') THEN
    ALTER TABLE public.hlt_sellers ADD CONSTRAINT ck_hlt_sellers_return_fee CHECK (return_ship_fee BETWEEN 0 AND 6000);
  END IF;
END $$;
COMMENT ON COLUMN public.hlt_sellers.return_ship_fee IS '회원 사정(단순 변심) 왕복 반품 배송비 — 판매자가 정함 · 6,000원 상한(입점 약관 제15조 · 결정 C · D156). 직판은 6,000원 고정(D014)';

CREATE OR REPLACE FUNCTION public.fn_hlt_tenant_sale_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE s record;
BEGIN
  IF NEW.status <> 'ON_SALE' OR NEW.seller_id IS NULL THEN RETURN NEW; END IF;
  SELECT type, status, submerchant_id INTO s FROM hlt_sellers WHERE id = NEW.seller_id;
  IF s.type = 'DIRECT' THEN RETURN NEW; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'mall.tenant'), 'off') <> 'on' THEN
    RAISE EXCEPTION 'HLTP: 소개몰 입점 판매가 아직 열리지 않았습니다';
  END IF;
  IF s.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'HLTP: 판매 중인 입점 판매자가 아니어서 판매할 수 없습니다';
  END IF;
  IF coalesce(btrim(s.submerchant_id), '') = '' THEN
    RAISE EXCEPTION 'HLTP: 결제대행사 하위가맹점 등록을 마친 판매자만 판매할 수 있습니다';
  END IF;
  IF NEW.review_state <> 'APPROVED' THEN
    RAISE EXCEPTION 'HLTP: 입점 상품은 운영 검수를 통과해야 판매할 수 있습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_tenant_sale_guard ON public.hlt_products;
CREATE TRIGGER trg_hlt_tenant_sale_guard BEFORE INSERT OR UPDATE OF status, review_state, seller_id ON public.hlt_products
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_tenant_sale_guard();

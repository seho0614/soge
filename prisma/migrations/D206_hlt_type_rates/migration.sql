-- =====================================================================
-- D206 (v10.272 · docs/404) — 소개몰 입점 유형별 기본 판매수수료율
--
--   입점 약관 제17조는 요율을 입점 유형(브랜드 직영관 · 일반 입점)으로 정하는데, 시스템은 갈래 · 판매자별이라 어긋났습니다(docs/400 1절).
--   대표 결정(11/13): 요율 고르는 순서 = 판매자 지정 → **입점 유형** → 갈래 → 전체 기본(*) → 10%.
--   ① hlt_seller_type_rates — BRAND(브랜드 직영관) · TENANT(일반 입점) 두 줄 · rate 는 **처음에 비어 있음(NULL)**.
--      비어 있으면 지금과 똑같이 갈래 요율을 씁니다(갈래 요율에 8 · 12% 가 있어 10% 로 채우면 바뀌므로 비워 둠).
--   ② hlt_type_rate_changes — 바꾼 기록(사유 2자 이상 · 고치거나 지울 수 없음)
--   ③ fn_hlt_rate_for — 같은 이름 · 같은 인자 · 순서에 유형 한 칸만 더함. 수수료는 주문 줄을 넣을 때 박으므로 이미 받은 주문은 그대로.
--   소개뱅크 직판관(DIRECT)은 해당 없음(판매자 요율 0 이 먼저). 추천 몫(referral_pct)은 갈래 기준 그대로.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hlt_seller_type_rates (
  seller_type text PRIMARY KEY CHECK (seller_type IN ('BRAND', 'TENANT')),
  rate        numeric(5,2) CHECK (rate IS NULL OR (rate >= 0 AND rate <= 50)),
  note        text,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hlt_seller_type_rates IS
  'v10.272 (D206) 입점 유형별 기본 판매수수료율 — BRAND 브랜드 직영관 · TENANT 일반 입점(약관 제17조). NULL 이면 갈래 요율을 씀. 순서: 판매자 → 유형 → 갈래 → * → 10%';

INSERT INTO public.hlt_seller_type_rates (seller_type, rate, note) VALUES
  ('BRAND',  NULL, '브랜드 직영관 — 비어 있으면 갈래 요율'),
  ('TENANT', NULL, '일반 입점 — 비어 있으면 갈래 요율')
ON CONFLICT (seller_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.hlt_type_rate_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_type text NOT NULL CHECK (seller_type IN ('BRAND', 'TENANT')),
  from_rate   numeric(5,2),
  to_rate     numeric(5,2),
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 2),
  changed_by  uuid REFERENCES public.accounts(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hlt_type_rate_changes ON public.hlt_type_rate_changes(seller_type, changed_at DESC);
COMMENT ON TABLE public.hlt_type_rate_changes IS
  'v10.272 (D206) 입점 유형 요율 바꾼 기록 — NULL 은 「비움(갈래 요율)」. 고치거나 지울 수 없음';

DROP TRIGGER IF EXISTS trg_hlt_type_rate_changes_ro ON public.hlt_type_rate_changes;
CREATE TRIGGER trg_hlt_type_rate_changes_ro BEFORE UPDATE OR DELETE ON public.hlt_type_rate_changes
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_rate_log_ro();

CREATE OR REPLACE FUNCTION public.fn_hlt_rate_for(p_seller uuid, p_category_code text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce(
    (SELECT commission_rate FROM hlt_sellers WHERE id = p_seller AND commission_rate IS NOT NULL),
    (SELECT t.rate FROM hlt_seller_type_rates t JOIN hlt_sellers s ON s.type = t.seller_type
      WHERE s.id = p_seller AND t.rate IS NOT NULL),
    (SELECT rate FROM hlt_commission_rates WHERE category_code = p_category_code),
    (SELECT rate FROM hlt_commission_rates WHERE category_code = '*'),
    10.00);
$$;
COMMENT ON FUNCTION public.fn_hlt_rate_for(p_seller uuid, p_category_code text) IS
  '이 판매자·이 카테고리에 적용할 수수료율. **한 곳에서만 정합니다** — 앱이 따로 계산하면 화면과 정산이 갈립니다. v10.272 (D206) 순서: 판매자 지정 → 입점 유형(비어 있으면 건너뜀) → 갈래 → * → 10%';

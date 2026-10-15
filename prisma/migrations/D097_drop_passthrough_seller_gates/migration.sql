-- =====================================================================
-- D097 — v10.39 (2026-10-13 대표 지시 「리팩토링 — 코드 구조만」)
--
--   P2P(v10.37 · D095) 뒤 판매 게이트 두 함수는 아무것도 막지 않고 통과만 합니다(RETURN NEW).
--   그런데 매물 저장마다 트리거 3개가 불려, 「사업자만 판매」 규칙이 아직 있는 것처럼 읽힙니다.
--   트리거 3개와 함수 2개를 뺍니다 — 동작은 같습니다(전에도 통과).
--
--     trg_listing_seller_gate      (BEFORE INSERT)  → fn_listing_seller_gate
--     trg_listing_business_gate    (BEFORE INSERT)  → fn_listing_requires_business
--     trg_listing_business_gate_u  (BEFORE UPDATE)  → fn_listing_requires_business
--
--   인증이 필요한 등록의 게이트는 그대로입니다 — 보험 · 의료 자격(fn_gated_no_intro_listing · fn_gated_category_guard) ·
--   부동산(fn_broker_gate · fn_property_guard) · 제한업종(fn_block_restricted_listing) · 안심소개 입점 승인(fn_mal_partner_only_guard).
--   item_types.requires_business 칸은 자료라 그대로 둡니다(읽는 곳 없음 · 참고 값).
--   재실행 안전.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_listing_seller_gate ON public.listings;
DROP TRIGGER IF EXISTS trg_listing_business_gate ON public.listings;
DROP TRIGGER IF EXISTS trg_listing_business_gate_u ON public.listings;

DROP FUNCTION IF EXISTS public.fn_listing_seller_gate();
DROP FUNCTION IF EXISTS public.fn_listing_requires_business();

COMMENT ON COLUMN public.item_types.requires_business IS
  '참고 값(읽는 곳 없음). v10.37 (D095 · P2P) 뒤 판매 등록에 사업자 판정이 없고, v10.39 (D097) 에서 통과만 하던 게이트를 뺐습니다.';

-- =====================================================================
-- C990 — 관 표시 이름 변경 (관이름변경안 v1.1)
--
--   사장님 결정 (2026-09-26):
--     소개머니 → 소개장터 · 소개몰 → 안심소개 · 건강몰 → 소개뱅크몰(1차 전문관 건강관)
--     소개창업 · 소개리드 · 상위 허브(EARN 「소개하고 벌기」) 는 그대로입니다.
--
--   바꾸는 것 : 사람이 보는 이름·설명·오류 문구·검색 사전
--   바꾸지 않는 것 :
--     · 관 코드(MNY · MAL · BIZ · LED · HLT · EARN) — 948곳이 코드로 묶여 있습니다
--     · URL (/money · /mall · /health)
--     · "소개머니 = 확정 소개비 정산원장" (v_intro_money_ledger · RSK-04)
--       — 관 이름이 아니라 정산 용어입니다. 일괄 치환하면 뜻이 깨집니다
--     · 법적 문서: 약관(C880) · 입점 표준계약서 · 직판 고지(legal.direct_notice)
--       — 약관 개정 · 계약 개정 절차로 따로 바꿉니다
--     · 보험·의료 제한업종(AD_ONLY) · 리드관 보류(LED is_active=false)
--       — 법무 회신 원문 확인 전까지 현행 유지
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 관 이름 · 설명
-- ---------------------------------------------------------------------
UPDATE public.gwans
   SET name = '소개장터',
       description = '물품·용역·납품 — 무엇이든 소개하고 소개받는 곳'
 WHERE code = 'MNY';

UPDATE public.gwans
   SET name = '안심소개',
       description = '부동산·기계설비·중고차 — 자격 확인된 전문가와 하는 거래'
 WHERE code = 'MAL';

/* ★ 설명에서 "의료기기는 취급하지 않습니다" 를 뺐습니다.
     제한업종 설정은 의료기기를 GATED(심의필이면 판매 가능)로 두고 있어
     설명과 규칙이 서로 달랐습니다. 규칙 쪽에 맞춥니다. */
UPDATE public.gwans
   SET name = '소개뱅크몰',
       description = '소개뱅크가 운영하는 쇼핑몰 — 1차 전문관 건강관. 의약품은 취급하지 않습니다.'
 WHERE code = 'HLT';

-- ---------------------------------------------------------------------
-- 2. 광고 지면 설명 (운영자 화면에 보임)
-- ---------------------------------------------------------------------
UPDATE public.ad_slots
   SET placement = '소개장터 · 안심소개 · 소개창업 상단. 메인 HERO 와 같은 규격이며 **관을 옮길 때마다** 노출됩니다.'
 WHERE code = 'GHERO';

-- ---------------------------------------------------------------------
-- 3. 검색 사전 — 관 이름이 바뀌어도 옛 이름으로 찾히게
-- ---------------------------------------------------------------------
UPDATE public.search_synonyms SET canonical = '안심소개'
 WHERE kind = 'GWAN' AND canonical = '소개몰';
UPDATE public.search_synonyms SET canonical = '소개뱅크몰'
 WHERE kind = 'GWAN' AND canonical = '건강몰';

INSERT INTO public.search_synonyms (term, canonical, kind, weight) VALUES
  ('소개머니',  '소개장터',   'GWAN', 9),
  ('소개몰',    '안심소개',   'GWAN', 9),
  ('건강몰',    '소개뱅크몰', 'GWAN', 9),
  ('건강상품관', '소개뱅크몰', 'GWAN', 9)
ON CONFLICT (term, kind) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. 사용자에게 보이는 오류 문구 — 함수 본문은 B075 와 같고 문구만 다릅니다
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_hlt_product_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c record; r record;
BEGIN
  IF NEW.status NOT IN ('ON_SALE','SOLD_OUT') THEN RETURN NEW; END IF;
  IF NEW.category_id IS NULL THEN
    RAISE EXCEPTION 'HLTP: 업종을 정해야 판매할 수 있습니다';
  END IF;
  SELECT * INTO c FROM categories WHERE id = NEW.category_id;
  IF c.gwan_code <> 'HLT' THEN
    RAISE EXCEPTION 'HLTP: 소개뱅크몰 업종이 아닙니다 — 직판은 소개뱅크몰만입니다';
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

CREATE OR REPLACE FUNCTION public.fn_hlt_sale_gate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_mode text; v_msg text;
BEGIN
  IF NEW.gwan_code <> 'HLT' OR NEW.category_id IS NULL THEN RETURN NEW; END IF;

  SELECT r.mode, r.block_message INTO v_mode, v_msg
    FROM categories c
    JOIN restricted_industries r
      ON r.code = c.restricted_code AND r.gwan_code = 'HLT' AND r.is_active
   WHERE c.id = NEW.category_id;

  /* GATED 는 통과시킵니다 — 자격 확인은 trg_gated_category 가 합니다.
     BLOCK 과 AD_ONLY 만 막습니다. */
  IF v_mode IN ('BLOCK', 'AD_ONLY') THEN
    RAISE EXCEPTION 'HEALTH: %', coalesce(v_msg,
      '소개뱅크몰에서 판매할 수 없는 품목입니다');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hub_no_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM gwans WHERE code = NEW.gwan_code AND is_hub) THEN
    RAISE EXCEPTION
      'GWAN: %는 상위 관이라 직접 등록할 수 없습니다 — 소개장터·안심소개·소개창업 중에서 고르십시오',
      NEW.gwan_code;
  END IF;
  RETURN NEW;
END $$;

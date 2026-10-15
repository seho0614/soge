-- =====================================================================
-- D005 — 소개리드 폐지 · 안심소개 「생활·금융 상담」 축 통합
--
--   사장님 결정 (2026-10-01) · 설계서 「안심소개 상담 축 통합 v1.2」
--     1. 소개리드(LED) 관을 없애고 리드 업종을 안심소개 상담 축으로 옮긴다
--     2. 안심소개의 모든 게시는 축별 입점 승인을 받은 인증업체만 한다
--     3. 기존 매물 등록 회원 이관 — 국세청 실연동으로 계속사업자가 확인된
--        회원은 기계·설비 축 일괄 승인, 나머지는 재심사
--     4. BASIC 소개코드 월 1건 (본인인증 1명당 1건 · 매월 1일 · 이월 없음)
--
--   바꾸지 않는 것
--     · 관 코드 LED 행 자체 — 지난 리드·리드료 기록이 남아 있어 지우지 않고 닫습니다
--     · 기계·부동산 축의 의료 개설·양도 AD_ONLY(안심소개 MEDICAL 행)
--     · 소개장터 보험·의료 GATED (C991)
--     · 카드·금융·통신 GATED (C993) — 설계서 v1.2 의 OPEN 표기는 서버 기준으로 정정
--
--   2번 규칙은 스위치(mal.partner_only)를 off 로 넣습니다.
--   오픈 직전에 fn_mal_partner_bulk_migrate(true) 를 돌린 뒤 on 으로 바꿉니다.
--   on 으로 바꾸기 전에도 v_mal_partner_only_gap 으로 대상이 보입니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 안심소개 축
-- ---------------------------------------------------------------------
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS axis text;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS ck_categories_axis;
ALTER TABLE public.categories ADD CONSTRAINT ck_categories_axis
  CHECK (axis IS NULL OR (gwan_code = 'MAL' AND axis IN ('EQUIP','RE','SOLAR','CONSULT')));
COMMENT ON COLUMN public.categories.axis IS
  '안심소개(MAL) 축. EQUIP 기계·설비·시설 / RE 부동산 / SOLAR 태양광 / CONSULT 생활·금융 상담. 다른 관은 NULL.';

UPDATE public.categories SET axis = 'RE', updated_at = now()
 WHERE gwan_code = 'MAL' AND axis IS NULL
   AND code IN ('MAL_APT','MAL_FACTORY','MAL_LAND','MAL_OFFICE','MAL_SHOP','MAL_MEDICAL');

-- ---------------------------------------------------------------------
-- 2. 제한업종 — 상담 축 전용 행
--    안심소개에는 이미 MEDICAL(AD_ONLY · 의료 개설·양도) 행이 있습니다.
--    같은 코드로 GATED 를 넣으면 부동산 축 규칙이 풀리므로 CSL_ 코드로 따로 둡니다.
--    자격 심사(qualification_reviews)는 원래 코드로 남아 있어 qual_code 로 잇습니다.
-- ---------------------------------------------------------------------
ALTER TABLE public.restricted_industries ADD COLUMN IF NOT EXISTS qual_code text;
COMMENT ON COLUMN public.restricted_industries.qual_code IS
  '이 업종을 통과시키는 자격 심사 코드(qualification_reviews.category_code). 비면 code 를 씁니다.';

INSERT INTO public.restricted_industries
  (code, name, legal_basis, gwan_code, mode, gate_requirement, is_active,
   block_message, intro_allowed, qual_code)
SELECT 'CSL_' || r.code, r.name, r.legal_basis, 'MAL', r.mode, r.gate_requirement, true,
       replace(r.block_message, '리드', '상담 신청'), r.intro_allowed, r.code
  FROM public.restricted_industries r
 WHERE r.gwan_code = 'LED'
ON CONFLICT (code, gwan_code) DO NOTHING;

UPDATE public.restricted_industries SET is_active = false, updated_at = now()
 WHERE gwan_code = 'LED';

-- ---------------------------------------------------------------------
-- 3. 리드 업종 8종 → 안심소개 상담 축 · 렌탈 추가
-- ---------------------------------------------------------------------
UPDATE public.categories
   SET gwan_code = 'MAL', axis = 'CONSULT',
       code = 'CSL_' || substr(code, 5),
       restricted_code = CASE WHEN restricted_code IS NULL THEN NULL ELSE 'CSL_' || restricted_code END,
       updated_at = now()
 WHERE gwan_code = 'LED';

INSERT INTO public.categories
  (gwan_code, code, name, status, restricted_code, labor_law_flag, approved_at, axis)
VALUES ('MAL', 'CSL_RENTAL', '렌탈', 'APPROVED', NULL, 'NOT_APPLICABLE', now(), 'CONSULT')
ON CONFLICT (gwan_code, code) DO NOTHING;

UPDATE public.gwans
   SET is_active = false,
       description = '폐지(2026-10-01) — 안심소개 「생활·금융 상담」 축으로 통합. 지난 기록 보존용으로만 남깁니다.'
 WHERE code = 'LED';

-- ---------------------------------------------------------------------
-- 4. 리드 생성 게이트 — 상담 축 업종만 · 자격은 qual_code 로
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_restricted_guard() RETURNS trigger AS $$
DECLARE
  v_gwan text; v_axis text;
  v_mode text; v_msg text; v_code text; v_qual text;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;                          -- 업종 없는 리드(옛 기록 형식)는 업종 규칙 밖
  END IF;

  SELECT c.gwan_code, c.axis, r.mode, r.block_message, r.code, coalesce(r.qual_code, r.code)
    INTO v_gwan, v_axis, v_mode, v_msg, v_code, v_qual
    FROM categories c
    LEFT JOIN restricted_industries r
      ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
   WHERE c.id = NEW.category_id;

  /* INV-AX1 — 리드 전용 규칙은 상담 축에만 걸리고, 리드도 상담 축에서만 생깁니다 */
  IF v_gwan IS DISTINCT FROM 'MAL' OR v_axis IS DISTINCT FROM 'CONSULT' THEN
    RAISE EXCEPTION 'LEAD_AXIS: 상담 신청은 안심소개 「생활·금융 상담」 업종에서만 만들 수 있습니다';
  END IF;

  IF v_mode = 'BLOCK' THEN
    RAISE EXCEPTION 'LEAD_BLOCK: % — %', v_code, coalesce(v_msg, '이 업종은 상담 신청을 받을 수 없습니다.');
  END IF;

  IF v_mode = 'GATED' AND NOT EXISTS (
       SELECT 1 FROM qualification_reviews qr
        WHERE qr.category_code = v_qual AND qr.state = 'APPROVED') THEN
    RAISE EXCEPTION 'LEAD_GATED: % — %', v_code,
      coalesce(v_msg, '자격 심사를 통과한 업체가 없어 상담 신청을 받을 수 없습니다.');
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fn_lead_restricted_guard() IS
'상담 신청(리드) 생성 게이트. 안심소개 상담 축 업종만 받고, BLOCK 은 거부, GATED 는 자격 승인 업체가 있어야 합니다(D005).';

CREATE OR REPLACE VIEW public.v_lead_restricted_leak AS
SELECT l.id, l.created_at, c.name AS category, r.code AS restricted, r.mode
  FROM leads l
  JOIN categories c ON c.id = l.category_id
  JOIN restricted_industries r
    ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
 WHERE r.mode = 'BLOCK'
    OR (r.mode = 'GATED' AND NOT EXISTS (
         SELECT 1 FROM qualification_reviews qr
          WHERE qr.category_code = coalesce(r.qual_code, r.code) AND qr.state = 'APPROVED'));

COMMENT ON VIEW public.v_lead_restricted_leak IS
'제한업종인데 만들어진 상담 신청. **0이어야 정상** — 자격 없는 곳으로 소비자 개인정보가 넘어갑니다.';

CREATE OR REPLACE VIEW public.v_lead_axis_leak AS
SELECT l.id, l.created_at, c.gwan_code, c.axis, c.name AS category
  FROM leads l JOIN categories c ON c.id = l.category_id
 WHERE c.gwan_code <> 'MAL' OR c.axis IS DISTINCT FROM 'CONSULT';

COMMENT ON VIEW public.v_lead_axis_leak IS
'INV-AX1 — 상담 축이 아닌 업종으로 만들어진 리드. **0이어야 정상**.';

CREATE OR REPLACE VIEW public.v_led_category_selfmade AS
SELECT id, code, name, requested_by, status
  FROM categories
 WHERE gwan_code = 'MAL' AND axis = 'CONSULT' AND requested_by IS NOT NULL;

COMMENT ON VIEW public.v_led_category_selfmade IS
'회원이 요청해 만들어진 상담 축 업종. **0이어야 정상** — 상담 업종은 관리자만 관리합니다(D005 로 대상이 안심소개 상담 축으로 바뀜).';

-- ---------------------------------------------------------------------
-- 5. 상담 업종은 매물이 될 수 없습니다 (INV-AX2)
--    트리거 이름을 trg_aa_ 로 시작해 다른 매물 게이트보다 먼저 돕니다(이름순 실행).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_listing_consult_block() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.axis = 'CONSULT') THEN
    RAISE EXCEPTION 'MAL_CONSULT_NOT_LISTING: 생활·금융 상담 업종은 매물로 올릴 수 없습니다 — 안심소개 파트너센터에서 서비스로 등록하십시오';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- 조회수·찜 갱신이 게이트를 다시 타지 않게 UPDATE 는 fn_listing_content_changed 로 거릅니다(K7 규약).
DROP TRIGGER IF EXISTS trg_aa_listing_consult_block ON public.listings;
CREATE TRIGGER trg_aa_listing_consult_block
  BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_listing_consult_block();
DROP TRIGGER IF EXISTS trg_aa_listing_consult_block_u ON public.listings;
CREATE TRIGGER trg_aa_listing_consult_block_u
  BEFORE UPDATE OF category_id ON public.listings
  FOR EACH ROW WHEN (fn_listing_content_changed(OLD.*, NEW.*) AND OLD.category_id IS DISTINCT FROM NEW.category_id)
  EXECUTE FUNCTION public.fn_listing_consult_block();

CREATE OR REPLACE VIEW public.v_listing_consult_leak AS
SELECT l.id, l.title, c.code AS category
  FROM listings l JOIN categories c ON c.id = l.category_id
 WHERE c.axis = 'CONSULT';

COMMENT ON VIEW public.v_listing_consult_leak IS 'INV-AX2 — 상담 업종으로 올라간 매물. **0이어야 정상**.';

-- ---------------------------------------------------------------------
-- 6. 축별 입점 승인 · 인증업체만 게시
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mal_partner_axes (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  axis        text NOT NULL CHECK (axis IN ('EQUIP','RE','SOLAR','CONSULT')),
  state       text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','APPROVED','REJECTED','REVOKED')),
  source      text NOT NULL DEFAULT 'APPLY' CHECK (source IN ('APPLY','BULK_MIGRATION','ADMIN')),
  reason      text,
  decided_by  uuid,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, axis),
  CONSTRAINT ck_mal_axis_decided CHECK (state = 'PENDING' OR decided_at IS NOT NULL)
);
COMMENT ON TABLE public.mal_partner_axes IS
  '안심소개 인증업체의 축별 입점 승인. 한 업체가 여러 축에 입점할 수 있고 축마다 따로 승인합니다(설계서 v1.2 §4).';

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS nts_env text;
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS ck_businesses_nts_env;
ALTER TABLE public.businesses ADD CONSTRAINT ck_businesses_nts_env
  CHECK (nts_env IS NULL OR nts_env IN ('STUB','TEST','LIVE'));
COMMENT ON COLUMN public.businesses.nts_env IS
  '국세청 조회가 어느 단계에서 났는가. LIVE 만 일괄 승인 근거가 됩니다. 시험·모의 기록은 실연동 후 다시 조회합니다.';
UPDATE public.businesses SET nts_env = 'STUB' WHERE nts_status IS NOT NULL AND nts_env IS NULL;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('mal.partner_only', 'off', 'GLOBAL',
  '안심소개 게시를 축별 입점 승인 업체로만 제한합니다. 오픈 직전 일괄 이관(fn_mal_partner_bulk_migrate) 후 on 으로 바꿉니다.',
  false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_mal_partner_only_guard() RETURNS trigger AS $$
DECLARE v_axis text;
BEGIN
  IF NEW.gwan_code <> 'MAL' OR NEW.status NOT IN ('IN_REVIEW','PUBLISHED') THEN RETURN NEW; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'mal.partner_only'), 'off') <> 'on' THEN RETURN NEW; END IF;
  SELECT axis INTO v_axis FROM categories WHERE id = NEW.category_id;
  IF NOT EXISTS (
    SELECT 1 FROM mal_partner_axes ap JOIN businesses b ON b.id = ap.business_id
     WHERE b.account_id = NEW.owner_account_id AND ap.axis = v_axis AND ap.state = 'APPROVED') THEN
    RAISE EXCEPTION 'MAL_PARTNER_ONLY: 안심소개는 입점 승인을 받은 인증업체만 게시합니다 (축 %) — 안심소개 파트너센터에서 입점 신청하십시오', coalesce(v_axis, '미지정');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_aa_mal_partner_only ON public.listings;
CREATE TRIGGER trg_aa_mal_partner_only
  BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_mal_partner_only_guard();
DROP TRIGGER IF EXISTS trg_aa_mal_partner_only_u ON public.listings;
CREATE TRIGGER trg_aa_mal_partner_only_u
  BEFORE UPDATE OF status, category_id, owner_account_id ON public.listings
  FOR EACH ROW WHEN (fn_listing_content_changed(OLD.*, NEW.*) AND (OLD.status IS DISTINCT FROM NEW.status
                  OR OLD.category_id IS DISTINCT FROM NEW.category_id
                  OR OLD.owner_account_id IS DISTINCT FROM NEW.owner_account_id))
  EXECUTE FUNCTION public.fn_mal_partner_only_guard();

CREATE OR REPLACE VIEW public.v_mal_partner_only_gap AS
SELECT l.id AS listing_id, l.owner_account_id, c.axis, l.status
  FROM listings l JOIN categories c ON c.id = l.category_id
 WHERE l.gwan_code = 'MAL' AND l.status IN ('IN_REVIEW','PUBLISHED')
   AND NOT EXISTS (
     SELECT 1 FROM mal_partner_axes ap JOIN businesses b ON b.id = ap.business_id
      WHERE b.account_id = l.owner_account_id AND ap.axis = c.axis AND ap.state = 'APPROVED');
COMMENT ON VIEW public.v_mal_partner_only_gap IS
  '입점 승인 없이 게시 중인 안심소개 매물. 스위치 off 동안은 관찰용이고, on 으로 바꾸기 전 0 으로 만들어야 합니다.';

-- ---------------------------------------------------------------------
-- 7. 기존 매물 등록 회원 일괄 이관 (오픈 직전 1회)
--    p_execute=false 면 결과만 보여 주고 아무것도 바꾸지 않습니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_mal_partner_bulk_migrate(p_execute boolean DEFAULT false)
RETURNS TABLE(business_id uuid, owner_account_id uuid, axis text, result text, reason text)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH owners AS (
    SELECT DISTINCT l.owner_account_id AS acc, c.axis AS ax
      FROM listings l JOIN categories c ON c.id = l.category_id
     WHERE l.gwan_code = 'MAL' AND l.status <> 'ARCHIVED' AND c.axis IS NOT NULL AND c.axis <> 'CONSULT'
  ), judged AS (
    SELECT b.id AS bid, o.acc, o.ax,
           CASE WHEN b.id IS NULL THEN 'REVIEW'
                WHEN o.ax = 'EQUIP' AND b.verified_at IS NOT NULL
                     AND b.nts_env = 'LIVE' AND b.nts_status = 'VALID' THEN 'APPROVE'
                ELSE 'REVIEW' END AS res,
           CASE WHEN b.id IS NULL THEN '사업자 등록 없음 — 입점 신청 필요'
                WHEN o.ax = 'EQUIP' AND b.verified_at IS NOT NULL
                     AND b.nts_env = 'LIVE' AND b.nts_status = 'VALID' THEN '국세청 실연동 계속사업자 — 기계·설비 축 일괄 승인'
                WHEN o.ax = 'RE'    THEN '부동산 축은 중개사 인증 재심사'
                WHEN o.ax = 'SOLAR' THEN '태양광 축은 재심사'
                WHEN coalesce(b.nts_env,'') <> 'LIVE' THEN '국세청 실연동 기록 없음 — 재조회 후 재심사'
                ELSE '사업자 상태 확인 필요 — 재심사' END AS why
      FROM owners o
      LEFT JOIN LATERAL (
        SELECT * FROM businesses bb WHERE bb.account_id = o.acc
         ORDER BY bb.verified_at DESC NULLS LAST, bb.created_at DESC LIMIT 1) b ON true
  ), applied AS (
    INSERT INTO mal_partner_axes (business_id, axis, state, source, reason, decided_at)
    SELECT j.bid, j.ax, CASE WHEN j.res = 'APPROVE' THEN 'APPROVED' ELSE 'PENDING' END,
           'BULK_MIGRATION', j.why, CASE WHEN j.res = 'APPROVE' THEN now() END
      FROM judged j
     WHERE p_execute AND j.bid IS NOT NULL
    ON CONFLICT ON CONSTRAINT mal_partner_axes_business_id_axis_key DO NOTHING
    RETURNING 1
  )
  SELECT j.bid, j.acc, j.ax, j.res, j.why FROM judged j
   WHERE (SELECT count(*) FROM applied) >= 0;
END $$;

COMMENT ON FUNCTION public.fn_mal_partner_bulk_migrate(boolean) IS
'기존 안심소개 매물 등록 회원 이관. 국세청 실연동(nts_env=LIVE) 계속사업자 + 기계·설비 매물만 일괄 승인, 나머지는 재심사 대기. false 로 먼저 돌려 결과를 확인하십시오.';

-- ---------------------------------------------------------------------
-- 8. BASIC 소개코드 월 1건 (발급 규칙은 billing.service — 월 단위 · 본인인증 1명당 1건)
-- ---------------------------------------------------------------------
UPDATE public.subscription_plans SET included_codes = 1 WHERE code = 'BASIC' AND included_codes = 0;

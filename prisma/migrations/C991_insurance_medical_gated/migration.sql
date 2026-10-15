-- =====================================================================
-- C991 — 보험·의료 입점: 자격 확인 후 게시 (소개장터)
--
--   사장님 결정 (2026-09-26):
--     보험·의료 사업자는 자격 확인 후 소개장터에 게시할 수 있다.
--
--   선을 어디에 긋는가:
--     열리는 것  = 자격 있는 사업자가 **자기 서비스를 직접 게시**하는 것
--     막힌 채로  = 제3자 **소개·알선** (소개자 · 소개비)
--   의료법 27조(환자 유인·알선)와 보험업법이 문제 삼는 것은 후자입니다.
--   C3-SCOPE 가 "소개·알선은 법 개정 없이 불가" 로 적은 판단은 그대로입니다.
--   그래서 GATED 로 열되 **소개 통로는 닫힌 GATED** 로 엽니다.
--
--   세 겹:
--     ① 사업자 자격 — qualification_reviews APPROVED (발급처 조회 필수 · 관리자 결정)
--     ② 게시물 심의필 — 기존 fn_gated_category_guard
--     ③ 소개 차단 — 소개비 0 · 소개자 없음 (listings · requests · deals)
--   ＋ 관리자 수동 검수 — 기존 auto_review_policies.manual_gated_category
--
--   바꾸지 않는 것:
--     안심소개 의료 개설·양도(AD_ONLY) · 소개뱅크몰 의료 서비스(BLOCK) ·
--     리드관 보류(LED 비활성)
--
--   ★ 법무 회신 원문으로 "자기 게시" 구조가 알선에 해당하지 않는지
--     확인해야 합니다. 부정이면 아래 1번을 AD_ONLY 로 되돌리면 끝납니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 소개 허용 여부를 모드와 따로 둡니다
--    GATED 는 "자격이 있으면 된다" 는 뜻인데, 보험·의료는 자격이 있어도
--    소개는 안 됩니다. 모드 하나로는 이 차이를 담을 수 없습니다.
-- ---------------------------------------------------------------------
ALTER TABLE public.restricted_industries
  ADD COLUMN IF NOT EXISTS intro_allowed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.restricted_industries.intro_allowed IS
  'false 면 게시는 되어도 소개는 안 됩니다 — 소개비 0 · 소개자 없음. '
  '보험·의료(의료법 27조 · 보험업법)처럼 자격이 있어도 알선이 금지된 업종용.';

-- ---------------------------------------------------------------------
-- 1. 소개장터 보험·의료 : AD_ONLY → GATED (소개 불가)
-- ---------------------------------------------------------------------
UPDATE public.restricted_industries
   SET mode = 'GATED',
       intro_allowed = false,
       gate_requirement = CASE code
         WHEN 'INSURANCE' THEN '보험설계사·대리점 등록 자격 심사 통과 + 게시물마다 보험 광고 심의필 번호'
         WHEN 'MEDICAL'   THEN '의료기관 개설신고 자격 심사 통과 + 게시물마다 의료광고 심의필 번호'
       END,
       block_message = '자격 심사를 통과하고 심의필 번호를 적어야 게시할 수 있습니다. 이 업종은 소개비를 받을 수 없고 소개자를 둘 수 없습니다.',
       updated_at = now()
 WHERE gwan_code = 'MNY' AND code IN ('INSURANCE','MEDICAL');

-- ---------------------------------------------------------------------
-- 2. 보험 자격 규칙 (의료는 이미 있음)
-- ---------------------------------------------------------------------
INSERT INTO public.qualification_rules
  (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active)
VALUES
  ('INSURANCE', '보험', '보험설계사 또는 보험대리점 등록증 · 보험 광고 심의필',
   '보험업법 — 설계사·대리점 등록 및 광고 기준', true, true)
ON CONFLICT (category_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. 소개 차단 판정 — GATED 라도 intro_allowed=false 면 막힘
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_is_intro_blocked(p_code text, p_gwan text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM restricted_industries r
     WHERE r.is_active
       AND r.code = p_code
       AND (r.gwan_code IS NULL OR r.gwan_code = p_gwan)
       AND (r.mode IN ('BLOCK','AD_ONLY')                -- ★ 둘 다 소개는 막습니다
            OR (r.mode = 'GATED' AND NOT r.intro_allowed)) -- ★ 자격 게시만 되는 업종
  );
$$;

/* 업종 id 하나로 "소개가 막힌 업종인가" 를 봅니다. */
CREATE OR REPLACE FUNCTION public.fn_category_no_intro(p_category uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM categories c
      JOIN restricted_industries r
        ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
     WHERE c.id = p_category
       AND r.mode = 'GATED' AND NOT r.intro_allowed
  );
$$;

-- ---------------------------------------------------------------------
-- 4. 게시 게이트 — 자격 심사 통과 + 소개비 0
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_gated_no_intro_listing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c record; v_ok boolean;
BEGIN
  IF NEW.category_id IS NULL OR NOT fn_category_no_intro(NEW.category_id) THEN
    RETURN NEW;
  END IF;

  /* 소개비는 초안에서도 받지 않습니다 — 나중에 지우겠다는 약속은 지켜지지 않습니다. */
  IF coalesce(NEW.desired_fee, 0) > 0 THEN
    RAISE EXCEPTION 'GATED: 보험·의료는 소개비를 받을 수 없습니다 (의료법 27조 · 보험업법)';
  END IF;

  /* 심사 요청·공개로 올릴 때만 자격을 봅니다. 초안은 미리 써 둘 수 있습니다. */
  IF NEW.status IN ('IN_REVIEW','PUBLISHED') THEN
    SELECT * INTO c FROM categories WHERE id = NEW.category_id;
    SELECT EXISTS (
      SELECT 1 FROM qualification_reviews q
        JOIN businesses b ON b.id = q.business_id
       WHERE b.account_id = NEW.owner_account_id
         AND q.category_code = c.restricted_code
         AND q.state = 'APPROVED'
    ) INTO v_ok;
    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION 'GATED: 자격 심사를 통과한 사업자만 게시할 수 있습니다 (%)', c.restricted_code;
    END IF;
  END IF;
  RETURN NEW;
END $$;

/* K7 규칙 — 조회수·찜 갱신에는 게이트를 다시 태우지 않습니다(C975). */
DROP TRIGGER IF EXISTS trg_gated_no_intro_listing   ON public.listings;
DROP TRIGGER IF EXISTS trg_gated_no_intro_listing_u ON public.listings;
CREATE TRIGGER trg_gated_no_intro_listing BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_gated_no_intro_listing();
CREATE TRIGGER trg_gated_no_intro_listing_u BEFORE UPDATE ON public.listings
  FOR EACH ROW WHEN (fn_listing_content_changed(OLD, NEW))
  EXECUTE FUNCTION public.fn_gated_no_intro_listing();

/* 요청 쪽도 사례금을 걸 수 없습니다. */
CREATE OR REPLACE FUNCTION public.fn_gated_no_intro_request() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND fn_category_no_intro(NEW.category_id)
     AND coalesce(NEW.offered_fee, 0) > 0 THEN
    RAISE EXCEPTION 'GATED: 보험·의료 요청에는 소개비를 걸 수 없습니다 (의료법 27조 · 보험업법)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gated_no_intro_request ON public.requests;
CREATE TRIGGER trg_gated_no_intro_request BEFORE INSERT OR UPDATE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_gated_no_intro_request();

-- ---------------------------------------------------------------------
-- 5. 거래 게이트 — 소개자 없음 · 소개비 0
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_gated_no_intro_deal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_cat uuid;
BEGIN
  IF NEW.listing_id IS NOT NULL THEN
    SELECT category_id INTO v_cat FROM listings WHERE id = NEW.listing_id;
  ELSE
    SELECT category_id INTO v_cat FROM requests WHERE id = NEW.request_id;
  END IF;
  IF v_cat IS NULL OR NOT fn_category_no_intro(v_cat) THEN RETURN NEW; END IF;

  IF NEW.introducer_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'GATED: 보험·의료 거래에는 소개자를 둘 수 없습니다 (의료법 27조 · 보험업법)';
  END IF;
  IF coalesce(NEW.agreed_fee, 0) > 0 THEN
    RAISE EXCEPTION 'GATED: 보험·의료 거래에는 소개비가 없습니다 (의료법 27조 · 보험업법)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gated_no_intro_deal ON public.deals;
CREATE TRIGGER trg_gated_no_intro_deal BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.fn_gated_no_intro_deal();

-- ---------------------------------------------------------------------
-- 6. 감시 뷰 — 전부 0 이어야 합니다
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_no_intro_leak AS
 SELECT 'LISTING'::text AS kind, l.id
   FROM listings l
  WHERE fn_category_no_intro(l.category_id) AND coalesce(l.desired_fee, 0) > 0
 UNION ALL
 SELECT 'REQUEST', q.id
   FROM requests q
  WHERE fn_category_no_intro(q.category_id) AND coalesce(q.offered_fee, 0) > 0
 UNION ALL
 SELECT 'DEAL', d.id
   FROM deals d
   LEFT JOIN listings l ON l.id = d.listing_id
   LEFT JOIN requests q ON q.id = d.request_id
  WHERE fn_category_no_intro(coalesce(l.category_id, q.category_id))
    AND (d.introducer_account_id IS NOT NULL OR coalesce(d.agreed_fee, 0) > 0);

COMMENT ON VIEW public.v_no_intro_leak IS
  '소개가 막힌 업종(보험·의료)에 스며든 소개비·소개자. **0이어야 합니다.**';

CREATE OR REPLACE VIEW public.v_gated_unqualified_public AS
 SELECT l.id, l.title, c.restricted_code
   FROM listings l
   JOIN categories c ON c.id = l.category_id
  WHERE fn_category_no_intro(l.category_id)
    AND l.status IN ('IN_REVIEW','PUBLISHED')
    AND NOT EXISTS (
      SELECT 1 FROM qualification_reviews q
        JOIN businesses b ON b.id = q.business_id
       WHERE b.account_id = l.owner_account_id
         AND q.category_code = c.restricted_code
         AND q.state = 'APPROVED');

COMMENT ON VIEW public.v_gated_unqualified_public IS
  '자격 심사 없이 공개·심사 중인 보험·의료 게시물. **0이어야 합니다.**';

-- ---------------------------------------------------------------------
-- 7. 결정 기록
-- ---------------------------------------------------------------------
UPDATE public.pending_decisions
   SET title = '보험·의료 — 자격 게시는 열고 소개·알선은 닫음',
       depends_on = '법무 회신 원문 확인 (자기 게시 구조의 알선 해당 여부)',
       risk = 'MEDIUM',
       note = '2026-09-26 사장님 결정: 소개장터 보험·의료를 GATED(intro_allowed=false)로 열었습니다. '
           || '자격 심사 통과 + 심의필 + 관리자 수동 검수 후 게시, 소개비 0 · 소개자 불가. '
           || '소개·알선은 의료법 27조·보험업법상 여전히 막습니다. '
           || '회신이 부정이면 C991 의 1번을 AD_ONLY 로 되돌리십시오.'
 WHERE code = 'C3-SCOPE';

-- =====================================================================
-- D107 — v10.70 (2026-10-22 · 자동검수 점검 ② 개인 회원 기준 · docs/126)
--
--   대표 결정(2026-10-22 「2번 a」): 자동검수의 「인증 전」 판정을 **본인인증 기준**으로.
--   전에는 인증된 사업자가 없으면 무조건 사람 검수 → 본인인증한 개인 매물도 자동 승인될 수 없었습니다
--   (P2P 원칙 2026-10-13 「개인도 모든 업무」 · 판매 등록의 사업자 판정은 D095 · D097 에서 이미 뺌).
--
--   ① fn_auto_review_reasons — UNVERIFIED_BUSINESS 는 「본인인증도 사업자 인증도 없을 때」만(나머지 판정은 그대로)
--   ② 사유 이름표 · 정책 설명을 새 뜻으로(코드 이름 UNVERIFIED_BUSINESS · 정책 키는 그대로 — 화면 · 통계가 이 이름을 씀)
--
--   자료를 지우지 않습니다. 재실행 안전(CREATE OR REPLACE · 같은 값으로 UPDATE).
--   이미 사람 검수로 간 건은 그대로입니다(다시 판정하지 않음).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_auto_review_reasons(p_review_item_id uuid) RETURNS text[]
    LANGUAGE plpgsql
    AS $$
DECLARE
  ri record; l record; b record; c record;
  reasons text[] := '{}';
  pol record;
  prior_rejects int;
  warn_word text;
BEGIN
  SELECT * INTO ri FROM review_items WHERE id = p_review_item_id;
  IF ri IS NULL THEN RETURN ARRAY['NOT_FOUND']; END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'auto_approve_enabled';
  IF NOT pol.enabled THEN RETURN ARRAY['AUTO_DISABLED']; END IF;

  IF ri.target_type <> 'LISTING' THEN
    RETURN ARRAY['TARGET_TYPE_' || ri.target_type];
  END IF;

  SELECT * INTO l FROM listings WHERE id = ri.target_id;
  IF l IS NULL THEN RETURN ARRAY['TARGET_MISSING']; END IF;

  SELECT * INTO b FROM businesses
   WHERE account_id = l.owner_account_id ORDER BY verified_at NULLS LAST LIMIT 1;
  SELECT * INTO c FROM categories WHERE id = l.category_id;

  -- ★ 주의 단어. 문맥에 따라 정상일 수 있어 차단하지 않고 사람에게 보냅니다
  SELECT w.word INTO warn_word
    FROM fn_check_banned_words(
           coalesce(l.title,'') || ' ' || coalesce(l.body,''), l.gwan_code) w
   WHERE w.severity = 'WARN' LIMIT 1;
  IF warn_word IS NOT NULL THEN
    reasons := array_append(reasons, 'BANNED_WORD_WARN');
  END IF;

  -- D107 — P2P(2026-10-13 · 개인도 모든 업무): 본인인증한 개인은 이 이유로 사람에게 보내지 않습니다.
  --        본인인증도 사업자 인증도 없을 때만(전: 사업자 인증이 없으면 개인은 모두 사람 검수)
  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_unverified_business';
  IF pol.enabled AND (b IS NULL OR b.verified_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM accounts a
                      WHERE a.id = l.owner_account_id AND a.identity_verified_at IS NOT NULL) THEN
    reasons := array_append(reasons, 'UNVERIFIED_BUSINESS');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_first_listing';
  IF pol.enabled AND NOT EXISTS (
       SELECT 1 FROM listings x
        WHERE x.owner_account_id = l.owner_account_id
          AND x.id <> l.id AND x.status = 'PUBLISHED'
     ) THEN
    reasons := array_append(reasons, 'FIRST_LISTING');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_fee_threshold';
  IF pol.enabled AND l.desired_fee IS NOT NULL AND l.desired_fee >= pol.num_value THEN
    reasons := array_append(reasons, 'HIGH_FEE');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_after_reject';
  IF pol.enabled THEN
    SELECT count(*) INTO prior_rejects FROM review_items x
     WHERE x.submitted_by = l.owner_account_id AND x.status = 'REJECTED';
    IF prior_rejects > 0 THEN reasons := array_append(reasons, 'PRIOR_REJECT'); END IF;
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'manual_gated_category';
  IF pol.enabled AND c.restricted_code IS NOT NULL AND EXISTS (
       SELECT 1 FROM restricted_industries r
        WHERE r.code = c.restricted_code AND r.gwan_code = l.gwan_code
          AND r.is_active AND r.mode = 'GATED'
     ) THEN
    reasons := array_append(reasons, 'GATED_CATEGORY');
  END IF;

  SELECT * INTO pol FROM auto_review_policies WHERE key = 'min_body_length';
  IF pol.enabled AND coalesce(length(btrim(l.body)), 0) < pol.num_value THEN
    reasons := array_append(reasons, 'THIN_CONTENT');
  END IF;

  RETURN reasons;
END $$;

UPDATE public.code_labels
   SET label = '본인 · 사업자 인증 전', description = '본인인증도 사업자 인증도 하지 않은 회원(책임 주체 미특정) — D107', updated_at = now()
 WHERE domain = 'review.manual_reason' AND code = 'UNVERIFIED_BUSINESS'
   AND label IS DISTINCT FROM '본인 · 사업자 인증 전';

UPDATE public.auto_review_policies
   SET description = '본인인증도 사업자 인증도 없으면 사람이 본다(P2P · 본인인증한 개인은 자동)', updated_at = now()
 WHERE key = 'manual_unverified_business'
   AND description IS DISTINCT FROM '본인인증도 사업자 인증도 없으면 사람이 본다(P2P · 본인인증한 개인은 자동)';

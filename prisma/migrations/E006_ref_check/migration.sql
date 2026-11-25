-- =====================================================================
-- E006 (e2.3 · docs/008) 소개뱅크 번호 확인 — 외래 키를 지운 칸(docs/e2-fk-dropped.tsv)을 코드 · 트리거가 확인
--
--   erp_ref_ok(kind, id)      → boolean   svc 외부 표에 그 번호가 있는지(없거나 NULL 이면 false · NULL 은 호출 쪽이 판단)
--   erp_ref_assert(kind, id)  → void      없으면 ERP_REF_MISSING(SQLSTATE 23503 — 외래 키 위반과 같은 번호라 지금 오류 처리 그대로)
--   kind: account · product · option · seller · advertiser
--   svc 는 tools/erp-svc.sh 가 만듦(마이그레이션 뒤) — 함수 몸은 부를 때 해석되므로 순서 상관없음
--   RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE OR REPLACE FUNCTION public.erp_ref_ok(p_kind text, p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE r boolean;
BEGIN
  IF p_id IS NULL THEN RETURN false; END IF;
  CASE p_kind
    WHEN 'account'    THEN SELECT EXISTS (SELECT 1 FROM svc.accounts            WHERE id = p_id) INTO r;
    WHEN 'product'    THEN SELECT EXISTS (SELECT 1 FROM svc.hlt_products        WHERE id = p_id) INTO r;
    WHEN 'option'     THEN SELECT EXISTS (SELECT 1 FROM svc.hlt_product_options WHERE id = p_id) INTO r;
    WHEN 'seller'     THEN SELECT EXISTS (SELECT 1 FROM svc.hlt_sellers         WHERE id = p_id) INTO r;
    WHEN 'advertiser' THEN SELECT EXISTS (SELECT 1 FROM svc.advertisers         WHERE id = p_id) INTO r;
    ELSE RAISE EXCEPTION USING MESSAGE = 'ERP_REF_KIND: 모르는 종류 — ' || coalesce(p_kind, '(없음)');
  END CASE;
  RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION public.erp_ref_assert(p_kind text, p_id uuid) RETURNS void
LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  IF p_id IS NOT NULL AND NOT public.erp_ref_ok(p_kind, p_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'ERP_REF_MISSING: 소개뱅크에 없는 번호 — ' || p_kind || ' ' || p_id::text;
  END IF;
END $fn$;

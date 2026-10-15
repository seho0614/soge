-- =====================================================================
-- C960 — 기준 데이터에 굳은 시험 흔적 정리
--
--   B900_reference_data 는 당시 DB 를 그대로 떠서 만들었습니다.
--   그때 검정이 남긴 행이 정식 기준 데이터가 되어 버렸습니다.
--
--   B900 자체는 고치지 않습니다. 이미 적용된 마이그레이션을 고치면
--   migrate.js 의 변경감지에 걸립니다. 여기서 지웁니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 시험 업종 — APPROVED 라 사용자에게 보였습니다
-- ---------------------------------------------------------------------
DELETE FROM public.categories
 WHERE id = 'dcdcdcdc-0000-4000-a000-000000000002'
   AND code = 'TESTRSTR';

-- ---------------------------------------------------------------------
-- 2. 시험 제한업종 — 연결된 업종이 0 이라 트리거가 못 잡습니다.
--    v_restricted_unlinked 가 이것을 잡고 있었습니다.
-- ---------------------------------------------------------------------
DELETE FROM public.restricted_industries
 WHERE code = 'NEWR';

-- ---------------------------------------------------------------------
-- 3. 시험 금칙어 2건
-- ---------------------------------------------------------------------
DELETE FROM public.banned_words
 WHERE word IN ('시험차단어', '시험주의어');

-- ---------------------------------------------------------------------
-- 4. ★ 수금 계좌 — 지우지 않습니다
--
--    is_required_for_open = true 라 비우면 오픈 검정이 막힙니다.
--    문제는 값이 "시험용가상은행 / 999999-99-999999" 인데도
--    v_company_account 의 missing 이 0 이라 통과한다는 것입니다.
--
--    빈 값만 보던 뷰가 시험용 값도 잡도록 고칩니다.
--    계약 후 실제 계좌를 넣으면 저절로 0 이 됩니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_company_account AS
SELECT
  (SELECT value FROM site_settings WHERE key = 'company.bank_name')    AS bank,
  (SELECT value FROM site_settings WHERE key = 'company.bank_account') AS account,
  (SELECT value FROM site_settings WHERE key = 'company.bank_holder')  AS holder,
  (SELECT count(*)
     FROM site_settings
    WHERE key LIKE 'company.bank%'
      AND (
            COALESCE(btrim(value), '') = ''        -- 비어 있음
         OR value LIKE '%시험%'                     -- 시험용 값
         OR value LIKE '%테스트%'
         OR value ~ '^9{6}-9{2}-9{6}$'             -- 자리채움 계좌번호
          )
  ) AS missing;

COMMENT ON VIEW public.v_company_account IS
'회사 수금 계좌. **missing 이 0이어야 오픈할 수 있습니다** — 비어 있거나 시험용 값이면 무통장 입금을 받을 수 없습니다.';

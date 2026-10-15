-- =====================================================================
-- C993 — 리드관(LED) 업종 8종 · 등록 폼 문구
--
--   사장님 결정 (2026-09-26):
--     의료 · 보험 · 카드 · 금융 · 이사짐 · 중고차 · 통신사대리점 · 렌터카
--     전부 **관리자가 관리**합니다 (회원이 임의로 늘리지 못합니다).
--
--   ★ 업종마다 규제 강도가 다릅니다
--     리드는 소비자 개인정보를 파는 것이라, 업종을 나열만 하고
--     규제를 안 걸면 C992 게이트가 헛돕니다.
--     제한업종에 걸리는 것과 아닌 것을 나눠 둡니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 업종 8종
--
--    status='APPROVED' — fn_gwan_open_guard 가 승인 업종을 요구합니다.
--    관리자 관리이므로 requested_by 는 비우고 approved_at 만 찍습니다.
-- ---------------------------------------------------------------------
INSERT INTO public.categories
  (gwan_code, code, name, status, restricted_code, labor_law_flag, approved_at)
VALUES
  -- 제한업종 — C992 게이트가 자격을 확인합니다
  ('LED', 'LED_MEDICAL',  '의료',         'APPROVED', 'MEDICAL',   'NOT_APPLICABLE', now()),
  ('LED', 'LED_INSURANCE','보험',         'APPROVED', 'INSURANCE', 'NOT_APPLICABLE', now()),
  ('LED', 'LED_CARD',     '카드',         'APPROVED', 'CARD',      'NOT_APPLICABLE', now()),
  ('LED', 'LED_FINANCE',  '금융',         'APPROVED', 'FINANCE',   'NOT_APPLICABLE', now()),
  ('LED', 'LED_TELCO',    '통신사 대리점', 'APPROVED', 'TELCO',     'NOT_APPLICABLE', now()),
  -- 일반 — 자격 없이 리드를 받습니다
  ('LED', 'LED_MOVING',   '이사짐',       'APPROVED', NULL,        'NOT_APPLICABLE', now()),
  ('LED', 'LED_USEDCAR',  '중고차',       'APPROVED', NULL,        'NOT_APPLICABLE', now()),
  ('LED', 'LED_RENTCAR',  '렌터카',       'APPROVED', NULL,        'NOT_APPLICABLE', now())
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. 제한업종 3종 추가 — 카드 · 금융 · 통신사 대리점
--
--    ★ 왜 이 셋도 거는가
--      카드·금융  여신전문금융업법 · 대부업법 — 모집인 등록 없이
--                 유치하면 불법입니다. 리드 전달도 모집에 해당할
--                 여지가 큽니다.
--      통신사     방문판매법 · 단통법 — 사전승낙서 없는 판매점은
--                 개통을 할 수 없습니다.
--
--      보험·의료는 C992 에서 이미 넣었습니다.
--      이사짐 · 중고차 · 렌터카는 등록 자격이 필요 없어 제외합니다.
-- ---------------------------------------------------------------------
INSERT INTO public.restricted_industries
  (code, name, legal_basis, gwan_code, mode, gate_requirement,
   is_active, block_message, intro_allowed)
VALUES
  ('CARD', '카드',
   '여신전문금융업법 14조의2 — 모집인 등록 없는 신용카드 회원 모집 금지',
   'LED', 'GATED',
   '신용카드 모집인 등록증. 리드를 받는 쪽의 자격을 확인합니다.',
   true,
   '카드 리드는 모집인 등록을 마친 곳만 받을 수 있습니다.',
   false),
  ('FINANCE', '금융',
   '대부업법 3조 · 금융소비자보호법 — 등록 없는 대출 중개·광고 금지',
   'LED', 'GATED',
   '대부중개업 또는 금융상품판매대리·중개업 등록증.',
   true,
   '금융 리드는 등록을 마친 곳만 받을 수 있습니다.',
   false),
  ('TELCO', '통신사 대리점',
   '단말기유통법 · 방문판매법 — 사전승낙서 없는 판매점의 개통 금지',
   'LED', 'GATED',
   '이동통신 사전승낙서.',
   true,
   '통신 리드는 사전승낙서를 받은 곳만 받을 수 있습니다.',
   false)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. 자격 규칙 — 무엇을 내야 하는지
-- ---------------------------------------------------------------------
INSERT INTO public.qualification_rules
  (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active)
VALUES
  ('CARD',    '카드',         '신용카드 모집인 등록증',
   '여신전문금융업법 14조의2', true, true),
  ('FINANCE', '금융',         '대부중개업 등록증 또는 금융상품판매대리·중개업 등록증',
   '대부업법 3조 · 금융소비자보호법', true, true),
  ('TELCO',   '통신사 대리점', '이동통신 사전승낙서',
   '단말기유통법', true, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. 등록 폼 문구 — fn_gwan_open_guard 가 요구합니다
--
--    리드관은 다른 관과 말이 다릅니다.
--    다른 관  "소개하고 소개비를 받습니다"
--    리드관   소비자가 문의를 남기고, 업체가 그 문의를 받습니다.
--             소개비가 아니라 리드료(회사 몫)입니다.
-- ---------------------------------------------------------------------
INSERT INTO public.gwan_form_copy
  (gwan_code, role, subject, title_hint, body_hint, notice)
VALUES
  ('LED', 'REQUEST', '상담 문의',
   '어떤 상담이 필요하신가요?',
   '지역과 원하시는 조건을 적어 주세요. 연락처는 암호화되어 저장됩니다.',
   '남기신 문의는 해당 업종의 자격을 확인받은 업체에만 전달됩니다. 연락처는 전달 전까지 공개되지 않습니다.'),
  ('LED', 'OFFER', '상담 문의',
   '어떤 문의를 받으시겠습니까?',
   '받으실 지역과 업종을 고르세요.',
   '문의를 받으시려면 업종별 자격 확인이 필요합니다. 받으신 건마다 리드료가 부과됩니다.')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. 감시 — 관리자 관리 원칙
--
--    회원이 리드관 업종을 만들면 안 됩니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_led_category_selfmade AS
SELECT id, code, name, requested_by, status
  FROM categories
 WHERE gwan_code = 'LED'
   AND requested_by IS NOT NULL;

COMMENT ON VIEW v_led_category_selfmade IS
'회원이 요청해 만들어진 리드관 업종. **0이어야 정상** — 리드관 업종은 관리자만 관리합니다.';

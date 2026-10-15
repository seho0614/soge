-- =====================================================================
-- C992 — 리드관(LED) 보험·의료 GATED
--
--   사장님 결정 (2026-09-26): GATED
--     소개장터와 같은 기준입니다 — 자격을 확인하고 받습니다.
--
--   ★ 왜 급한가
--     `leads` 표에는 트리거가 **하나도 없었습니다.**
--     실제로 보험 업종 리드를 넣어 보니 아무 검사 없이 들어갔습니다.
--     `restricted_industries` 에 LED 행이 0건이라 막을 근거 자체가
--     없었기 때문입니다 (migrations-deferred/README 의 2번 경고).
--
--   ★ 리드는 소개장터와 다릅니다
--     소개장터  게시물을 올리고 소개비를 받습니다 → intro_allowed 로 차단
--     리드관    소비자 문의 자체를 파트너에게 넘깁니다 → 소개비 개념이 없고
--               대신 **리드료**(lead_fees, 회사 몫)를 받습니다
--     그래서 여기서는 "소개 차단"이 아니라 **"자격 없으면 리드를 만들지
--     못하게"** 막습니다. 개인정보가 넘어가기 전에 세워야 합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. LED 제한업종 — 보험 · 의료
-- ---------------------------------------------------------------------
INSERT INTO public.restricted_industries
  (code, name, legal_basis, gwan_code, mode, gate_requirement,
   is_active, block_message, intro_allowed)
VALUES
  ('INSURANCE', '보험',
   '보험업법 — 모집 자격 없는 자의 모집 금지. 리드 전달도 모집 행위로 볼 여지가 있어 자격을 먼저 봅니다.',
   'LED', 'GATED',
   '보험설계사·대리점 등록 자격 심사 통과. 리드를 받는 쪽(파트너)의 자격을 확인합니다.',
   true,
   '보험 리드는 자격 심사를 통과한 파트너만 받을 수 있습니다.',
   false),
  ('MEDICAL', '의료',
   '의료법 27조 — 환자 알선·유인 금지. 의료 리드는 알선으로 해석될 여지가 큽니다.',
   'LED', 'GATED',
   '의료기관 개설신고증 + 광고 심의필. 리드를 받는 쪽의 자격을 확인합니다.',
   true,
   '의료 리드는 자격 심사를 통과한 의료기관만 받을 수 있습니다.',
   false)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. 보험 자격 규칙 — 의료는 이미 있습니다
-- ---------------------------------------------------------------------
INSERT INTO public.qualification_rules
  (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active)
VALUES
  ('INSURANCE', '보험', '보험설계사 등록증 또는 보험대리점 등록증',
   '보험업법 83조 · 87조', true, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. ★ 리드 생성 게이트 — 없던 것을 만듭니다
--
--    leads 에 트리거가 하나도 없어 제한업종이 무의미했습니다.
--    개인정보가 담기기 전에 업종부터 봅니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lead_restricted_guard() RETURNS trigger AS $$
DECLARE
  v_mode text;
  v_msg  text;
  v_code text;
BEGIN
  SELECT r.mode, r.block_message, r.code
    INTO v_mode, v_msg, v_code
    FROM categories c
    JOIN restricted_industries r
      ON r.code = c.restricted_code
     AND r.gwan_code IN ('LED', c.gwan_code)
     AND r.is_active
   WHERE c.id = NEW.category_id
   ORDER BY (r.gwan_code = 'LED') DESC   -- LED 전용 규칙이 우선
   LIMIT 1;

  IF v_mode IS NULL THEN
    RETURN NEW;                          -- 제한업종이 아님
  END IF;

  IF v_mode = 'BLOCK' THEN
    RAISE EXCEPTION 'LEAD_BLOCK: % — %', v_code,
      coalesce(v_msg, '이 업종은 리드를 만들 수 없습니다.');
  END IF;

  IF v_mode = 'GATED' THEN
    /* 리드는 소비자 개인정보입니다. 받을 파트너의 자격이 확인되기 전에는
       만들지 않습니다 — 만든 뒤에 거르면 이미 저장된 뒤입니다. */
    IF NOT EXISTS (
      SELECT 1 FROM qualification_reviews qr
       WHERE qr.category_code = v_code
         AND qr.state = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'LEAD_GATED: % — %', v_code,
        coalesce(v_msg, '자격 심사를 통과한 파트너가 없어 리드를 만들 수 없습니다.');
    END IF;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_lead_restricted_guard() IS
'리드 생성 시 제한업종을 봅니다. BLOCK 이면 거부, GATED 면 자격 승인된 파트너가 있어야 합니다. 개인정보가 저장되기 전에 막습니다.';

DROP TRIGGER IF EXISTS trg_lead_restricted ON leads;
CREATE TRIGGER trg_lead_restricted
  BEFORE INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION fn_lead_restricted_guard();

-- ---------------------------------------------------------------------
-- 4. 감시 — 제한업종인데 통과한 리드
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_lead_restricted_leak AS
SELECT l.id, l.created_at, c.name AS category, r.code AS restricted, r.mode
  FROM leads l
  JOIN categories c ON c.id = l.category_id
  JOIN restricted_industries r
    ON r.code = c.restricted_code
   AND r.gwan_code IN ('LED', c.gwan_code)
   AND r.is_active
 WHERE r.mode = 'BLOCK'
    OR (r.mode = 'GATED' AND NOT EXISTS (
         SELECT 1 FROM qualification_reviews qr
          WHERE qr.category_code = r.code AND qr.state = 'APPROVED'));

COMMENT ON VIEW v_lead_restricted_leak IS
'제한업종인데 만들어진 리드. **0이어야 정상** — 자격 없는 곳으로 소비자 개인정보가 넘어갑니다.';

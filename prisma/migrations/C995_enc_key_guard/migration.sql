-- =====================================================================
-- C995 — 암호화 열쇠 확인
--
--   ★ 찾은 문제
--     `affiliate.service.ts` 가 정산 계좌를 이렇게 저장합니다.
--
--       pgp_sym_encrypt($4, current_setting('app.enc_key', true))
--
--     그런데 `app.enc_key` 를 **넣는 곳이 어디에도 없습니다.**
--     넣지 않으면 current_setting 이 NULL 을 돌려주고,
--     pgp_sym_encrypt(…, NULL) 은 NULL 이 됩니다.
--     account_enc 가 NOT NULL 이라 **저장이 통째로 실패합니다.**
--
--     조용히 평문이 되는 것보다는 낫지만, 파트너가 정산 계좌를
--     등록하지 못한다는 뜻입니다. 오픈 후에 발견하면 늦습니다.
--
--   ★ 여기서 하는 것
--     1) 열쇠가 없으면 **왜 안 되는지 말해 주는** 오류를 냅니다.
--     2) 열쇠 없이 암호화된 척하는 값이 남지 않게 감시합니다.
--     열쇠 자체는 서버가 접속할 때 넣습니다 (아래 8부 안내).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 열쇠를 꺼내는 함수 — 없으면 분명한 오류
--
--    current_setting(…, true) 는 없어도 NULL 만 돌려줍니다.
--    그래서 무엇이 잘못됐는지 알 수 없습니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enc_key() RETURNS text AS $$
DECLARE
  v text;
BEGIN
  v := current_setting('app.enc_key', true);
  IF coalesce(btrim(v), '') = '' THEN
    RAISE EXCEPTION
      'ENC_KEY: 암호화 열쇠가 없습니다. 서버가 접속할 때 SET app.enc_key 를 해야 합니다 (AWS 절차서 7-3 참조)';
  END IF;
  IF length(v) < 16 THEN
    RAISE EXCEPTION 'ENC_KEY: 열쇠가 너무 짧습니다 (% 자) — 32자 이상을 쓰십시오', length(v);
  END IF;
  RETURN v;
END $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_enc_key() IS
'암호화 열쇠를 꺼냅니다. 없거나 짧으면 이유를 적어 거부합니다 — current_setting 만 쓰면 조용히 NULL 이 되어 원인을 찾기 어렵습니다.';

-- ---------------------------------------------------------------------
-- 2. 감시 — 열쇠 없이 저장된 흔적
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_enc_key_missing AS
SELECT 'partner_settlement_accounts' AS tbl, id::text AS row_id
  FROM partner_settlement_accounts
 WHERE account_enc IS NULL
UNION ALL
SELECT 'pii.lead_contacts', lead_id::text
  FROM pii.lead_contacts
 WHERE purged_at IS NULL
   AND name_enc IS NULL AND phone_enc IS NULL;

COMMENT ON VIEW v_enc_key_missing IS
'암호화돼야 하는데 비어 있는 값. **0이어야 정상** — 열쇠 없이 저장됐다는 뜻입니다.';

-- ---------------------------------------------------------------------
-- 3. 열쇠가 준비됐는지 보는 뷰 — 운영 화면에서 확인용
--
--    ★ 열쇠 자체는 절대 보여 주지 않습니다. 있는지 여부와 길이만.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_enc_key_status AS
SELECT
  coalesce(btrim(current_setting('app.enc_key', true)), '') <> '' AS is_set,
  length(coalesce(current_setting('app.enc_key', true), ''))     AS key_length;

COMMENT ON VIEW v_enc_key_status IS
'암호화 열쇠가 걸려 있는지. 열쇠 값은 보여 주지 않고 유무와 길이만 돌려줍니다.';

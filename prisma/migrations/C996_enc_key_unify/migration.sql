-- =====================================================================
-- C996 — 암호화 열쇠 통일
--
--   ★ 찾은 문제 — 열쇠 이름이 셋으로 갈려 있었습니다
--
--     app.enc_key   affiliate.service.ts (정산 계좌) · fn_enc_key
--     app.pii_key   fn_payout_add · fn_payout_reveal
--     인자로 전달    pii.fn_read_lead_contact (C994 에서 제가 만든 것)
--
--     운영에서 `app.enc_key` 만 넣으면 정산 계좌는 암호화되는데
--     **지급 계좌는 조용히 NULL 로 저장됩니다.** 둘 다 넣어야 하는지
--     아무 데도 적혀 있지 않았습니다.
--
--   ★ 여기서 하는 것
--     app.enc_key 하나로 모읍니다. app.pii_key 는 **뒤를 봐 줍니다** —
--     이미 그 이름으로 넣어 둔 환경이 있을 수 있어 갑자기 끊으면
--     지급이 멈춥니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 열쇠 꺼내기 — 새 이름 우선, 옛 이름 차선
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enc_key() RETURNS text AS $$
DECLARE
  v text;
BEGIN
  v := current_setting('app.enc_key', true);
  IF coalesce(btrim(v), '') = '' THEN
    -- 옛 이름 — 끊지 않고 받아 줍니다
    v := current_setting('app.pii_key', true);
  END IF;

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
'암호화 열쇠를 꺼냅니다. app.enc_key 를 먼저 보고, 없으면 옛 이름 app.pii_key 를 봅니다. 없거나 짧으면 이유를 적어 거부합니다.';

-- ---------------------------------------------------------------------
-- 2. 지급 계좌 함수도 같은 통로를 쓰게
--
--    current_setting 을 직접 부르면 열쇠가 없어도 NULL 로 조용히
--    넘어갑니다. fn_enc_key() 는 이유를 적고 멈춥니다.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
  src text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_payout_add', 'fn_payout_reveal')
  LOOP
    src := pg_get_functiondef(r.oid);
    src := replace(src, 'current_setting(''app.pii_key'', true)', 'fn_enc_key()');
    EXECUTE src;
    RAISE NOTICE '% 가 fn_enc_key() 를 쓰도록 바뀌었습니다', r.proname;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. 리드 연락처 열람도 같은 통로로
--
--    C994 에서는 열쇠를 인자로 받게 했습니다. 부르는 쪽이 열쇠를
--    알아야 해서, 코드 여러 곳에 열쇠가 퍼집니다.
--    인자를 없애고 서버 세션의 열쇠를 쓰게 합니다.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS pii.fn_read_lead_contact(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION pii.fn_read_lead_contact(
  p_lead_id  uuid,
  p_actor    uuid,
  p_reason   text
) RETURNS TABLE(name text, phone text, address text) AS $$
DECLARE
  v_purged timestamptz;
  v_key    text;
BEGIN
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'PRIVACY: 열람 사유를 적어야 합니다';
  END IF;

  v_key := fn_enc_key();   -- 없으면 여기서 멈춥니다

  SELECT purged_at INTO v_purged FROM pii.lead_contacts WHERE lead_id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRIVACY: 없는 리드입니다';
  END IF;
  IF v_purged IS NOT NULL THEN
    RAISE EXCEPTION 'PRIVACY: 파기된 리드입니다 (%)', v_purged;
  END IF;

  INSERT INTO audit.pii_access_logs
    (actor_account_id, lead_id, access_type, reason, occurred_at)
  VALUES (p_actor, p_lead_id, 'VIEW', p_reason, now());

  RETURN QUERY
  SELECT pgp_sym_decrypt(c.name_enc,    v_key)::text,
         pgp_sym_decrypt(c.phone_enc,   v_key)::text,
         pgp_sym_decrypt(c.address_enc, v_key)::text
    FROM pii.lead_contacts c
   WHERE c.lead_id = p_lead_id;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION pii.fn_read_lead_contact(uuid, uuid, text) IS
'리드 연락처를 복호화해 돌려주고 열람 기록을 남깁니다. 열쇠는 fn_enc_key() 가 세션에서 꺼냅니다 — 부르는 쪽이 열쇠를 알 필요가 없습니다.';

-- ---------------------------------------------------------------------
-- 4. 리드 연락처 저장도 통로를 둡니다
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pii.fn_save_lead_contact(
  p_lead_id  uuid,
  p_name     text,
  p_phone    text,
  p_address  text,
  p_memo     text DEFAULT NULL,
  p_days     int  DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_key  text := fn_enc_key();
  v_days int  := coalesce(p_days,
    (SELECT value::int FROM site_settings WHERE key = 'privacy.lead_retention_days'), 90);
BEGIN
  INSERT INTO pii.lead_contacts
    (lead_id, name_enc, phone_enc, address_enc, memo_enc,
     phone_hash, consent_at, retention_until)
  VALUES
    (p_lead_id,
     pgp_sym_encrypt(p_name,    v_key),
     pgp_sym_encrypt(p_phone,   v_key),
     pgp_sym_encrypt(p_address, v_key),
     CASE WHEN p_memo IS NULL THEN NULL ELSE pgp_sym_encrypt(p_memo, v_key) END,
     md5(regexp_replace(p_phone, '\D', '', 'g')),
     now(),
     current_date + v_days);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION pii.fn_save_lead_contact(uuid, text, text, text, text, int) IS
'리드 연락처를 암호화해 저장합니다. 보관 기한은 privacy.lead_retention_days 를 따릅니다. 동의 시각은 저장 시점으로 찍습니다.';

-- ---------------------------------------------------------------------
-- 5. 감시 — 열쇠 이름이 또 갈리지 않게
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_enc_key_direct_use AS
SELECT n.nspname || '.' || p.proname AS fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public', 'pii')
   AND p.proname <> 'fn_enc_key'
   AND p.prosrc LIKE '%current_setting(''app.pii_key''%';

COMMENT ON VIEW v_enc_key_direct_use IS
'열쇠를 fn_enc_key() 를 거치지 않고 직접 꺼내는 함수. **0이어야 정상** — 직접 꺼내면 열쇠가 없어도 조용히 NULL 이 됩니다.';

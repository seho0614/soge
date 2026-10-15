-- =====================================================================
-- C994 — 리드 개인정보 격리 (N-08)
--
--   리드관은 **소비자 개인정보 자체가 상품**입니다.
--   이름·전화번호가 업체로 넘어가므로, 넘어가기 전과 후를 모두
--   기록하고 기한이 지나면 지워야 합니다.
--
--   ★ 이미 있던 것 (만들지 않습니다)
--     audit.pii_access_logs   열람 감사 로그
--     pgcrypto                pgp_sym_encrypt / decrypt
--     job_schedules.pii_purge 파기 배치 (1일 1회)
--     scheduler.service.ts    pii.lead_contacts 를 지우는 코드
--
--   ★ 없던 것 — 이것을 만듭니다
--     pii 스키마가 **비어 있었습니다.**
--     배치 코드가 `pii.lead_contacts` 를 지우려 하는데 표가 없어
--     `.catch(() => [])` 로 조용히 넘어가고 있었습니다.
--     즉 리드를 받기 시작하면 **아무것도 파기되지 않습니다.**
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 리드 연락처 — public 이 아니라 pii 스키마에 둡니다
--
--    왜 나누는가: public 을 읽는 권한과 개인정보를 읽는 권한을
--    따로 줄 수 있습니다. 한 스키마에 섞으면 분리가 불가능합니다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pii.lead_contacts (
  lead_id          uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,

  name_enc         bytea,
  phone_enc        bytea,
  address_enc      bytea,
  memo_enc         bytea,

  -- 검색·중복확인용. 원문을 되돌릴 수 없습니다.
  phone_hash       text,

  collected_at     timestamptz NOT NULL DEFAULT now(),
  consent_at       timestamptz,          -- 동의 없이 수집하면 안 됩니다
  retention_until  date        NOT NULL, -- 이 날짜가 지나면 파기 대상
  purged_at        timestamptz,

  CONSTRAINT lead_contacts_retention_ck
    CHECK (retention_until > collected_at::date),
  -- 한 번 지운 것을 다시 채울 수 없습니다 (fn_invite_contact_purge 와 같은 원칙)
  CONSTRAINT lead_contacts_purged_empty_ck
    CHECK (purged_at IS NULL
           OR (name_enc IS NULL AND phone_enc IS NULL
               AND address_enc IS NULL AND memo_enc IS NULL))
);

COMMENT ON TABLE pii.lead_contacts IS
'리드의 소비자 연락처. public 이 아니라 pii 스키마에 둡니다 — 권한을 따로 주기 위해서입니다. retention_until 이 지나면 pii_purge 배치가 지웁니다.';
COMMENT ON COLUMN pii.lead_contacts.phone_hash IS
'중복 확인용 해시. 원문을 되돌릴 수 없습니다.';
COMMENT ON COLUMN pii.lead_contacts.consent_at IS
'수집 동의 시각. 비어 있으면 v_lead_no_consent 가 잡습니다.';

CREATE INDEX IF NOT EXISTS lead_contacts_retention_idx
  ON pii.lead_contacts (retention_until) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_contacts_phone_hash_idx
  ON pii.lead_contacts (phone_hash) WHERE purged_at IS NULL;

-- ---------------------------------------------------------------------
-- 2. 파기된 것을 되살리지 못하게
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pii.fn_lead_contact_no_revive() RETURNS trigger AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND (
       NEW.name_enc IS NOT NULL OR NEW.phone_enc IS NOT NULL
    OR NEW.address_enc IS NOT NULL OR NEW.memo_enc IS NOT NULL) THEN
    RAISE EXCEPTION 'PRIVACY: 파기된 리드 연락처를 다시 저장할 수 없습니다';
  END IF;
  -- 보관 기한을 뒤로 미루는 것도 막습니다. 미루면 파기가 영원히 안 옵니다.
  IF NEW.retention_until > OLD.retention_until THEN
    RAISE EXCEPTION 'PRIVACY: 보관 기한을 늘릴 수 없습니다 (% → %)',
      OLD.retention_until, NEW.retention_until;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_contact_no_revive ON pii.lead_contacts;
CREATE TRIGGER trg_lead_contact_no_revive
  BEFORE UPDATE ON pii.lead_contacts
  FOR EACH ROW EXECUTE FUNCTION pii.fn_lead_contact_no_revive();

-- ---------------------------------------------------------------------
-- 3. 삭제 금지 — 파기는 지우는 것이 아니라 비우는 것입니다
--
--    행을 지우면 "언제 파기했는지" 기록이 사라집니다.
--    감사에서 파기를 증명하지 못하면 안 한 것과 같습니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pii.fn_lead_contact_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PRIVACY: 리드 연락처 행은 지울 수 없습니다 — 파기는 내용을 비우고 purged_at 을 찍습니다';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_contact_no_delete ON pii.lead_contacts;
CREATE TRIGGER trg_lead_contact_no_delete
  BEFORE DELETE ON pii.lead_contacts
  FOR EACH ROW EXECUTE FUNCTION pii.fn_lead_contact_no_delete();

-- ---------------------------------------------------------------------
-- 4. 열람은 반드시 기록을 남깁니다
--
--    업체가 연락처를 보는 순간이 개인정보 제공 시점입니다.
--    이 함수를 거치지 않으면 복호화할 수 없게 합니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pii.fn_read_lead_contact(
  p_lead_id  uuid,
  p_actor    uuid,
  p_reason   text,
  p_key      text
) RETURNS TABLE(name text, phone text, address text) AS $$
DECLARE
  v_purged timestamptz;
BEGIN
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'PRIVACY: 열람 사유를 적어야 합니다';
  END IF;

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
  SELECT pgp_sym_decrypt(c.name_enc,    p_key)::text,
         pgp_sym_decrypt(c.phone_enc,   p_key)::text,
         pgp_sym_decrypt(c.address_enc, p_key)::text
    FROM pii.lead_contacts c
   WHERE c.lead_id = p_lead_id;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION pii.fn_read_lead_contact(uuid, uuid, text, text) IS
'리드 연락처를 복호화해 돌려주고 열람 기록을 남깁니다. 사유가 없으면 거부합니다. 파기된 건은 볼 수 없습니다.';

-- ---------------------------------------------------------------------
-- 5. 감시 뷰
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lead_purge_overdue AS
SELECT lead_id, retention_until, current_date - retention_until AS days_overdue
  FROM pii.lead_contacts
 WHERE purged_at IS NULL AND retention_until < current_date
 ORDER BY retention_until;

COMMENT ON VIEW public.v_lead_purge_overdue IS
'파기 기한을 넘긴 리드 연락처. **0이어야 정상** — 법정 보관 기한 초과입니다.';

CREATE OR REPLACE VIEW public.v_lead_no_consent AS
SELECT lead_id, collected_at
  FROM pii.lead_contacts
 WHERE consent_at IS NULL AND purged_at IS NULL;

COMMENT ON VIEW public.v_lead_no_consent IS
'동의 기록 없이 수집된 리드 연락처. **0이어야 정상** — 동의 없는 수집은 위법입니다.';

CREATE OR REPLACE VIEW public.v_lead_contact_unlogged AS
SELECT l.id AS lead_id, l.created_at
  FROM public.leads l
  JOIN pii.lead_contacts c ON c.lead_id = l.id
  JOIN public.lead_deliveries d ON d.lead_id = l.id
 WHERE c.purged_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM audit.pii_access_logs a
      WHERE a.lead_id = l.id AND a.access_type = 'VIEW');

COMMENT ON VIEW public.v_lead_contact_unlogged IS
'업체에 전달됐는데 열람 기록이 없는 리드. **0이어야 정상** — 기록 없이 개인정보가 나갔다는 뜻입니다.';

-- ---------------------------------------------------------------------
-- 6. 보관 기한 기본값 — 설정으로 바꿀 수 있게
-- ---------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open)
VALUES ('privacy.lead_retention_days', '90', 'GLOBAL',
        '리드 연락처 보관 일수. 지나면 pii_purge 배치가 지웁니다. 늘리려면 개인정보처리방침을 먼저 고치십시오.',
        false)
ON CONFLICT (key) DO NOTHING;

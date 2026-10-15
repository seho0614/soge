-- v10.28 (작업 지시서 4절 · 10/9 「진행」) — 안심소개 상담 신청에 이메일(필수).
--   ① 신청서가 이메일을 받고(형식 검사 · 서비스) 휴대폰과 같은 방식으로 암호화해 둡니다(consult_requests.contact_enc 의 JSON 안).
--   ② 휴대폰 확인을 마치고 업체 1곳에 배정되면 pii.lead_contacts.email_enc 로 옮깁니다(fn_consult_deliver).
--   ③ 업체가 「연락처 열기」를 한 뒤에만 이름 · 휴대폰과 함께 풀립니다(pii.fn_read_lead_contact — 열 때마다 열람 기록).
--      열기 전 요약 · 배정받지 않은 업체에는 없습니다.
--   ④ 파기 — 신청 6개월(fn_consult_purge 가 contact_enc 를 비움 = 이메일도) · 전달 90일(pii_purge 작업이 email_enc 도 비움 · 아래 제약).
--   동의 문구가 바뀌어 동의서 판을 올립니다(서비스 CONSENT_VERSION — 개인정보 보호법 17조 2항: 제공 항목은 동의 받을 때 알림).

ALTER TABLE pii.lead_contacts ADD COLUMN IF NOT EXISTS email_enc bytea;
ALTER TABLE pii.lead_contacts DROP CONSTRAINT IF EXISTS lead_contacts_purged_empty_ck;
ALTER TABLE pii.lead_contacts ADD CONSTRAINT lead_contacts_purged_empty_ck
  CHECK (purged_at IS NULL OR (name_enc IS NULL AND phone_enc IS NULL AND address_enc IS NULL AND memo_enc IS NULL AND email_enc IS NULL));

CREATE OR REPLACE FUNCTION pii.fn_lead_contact_no_revive() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND (
       NEW.name_enc IS NOT NULL OR NEW.phone_enc IS NOT NULL
    OR NEW.address_enc IS NOT NULL OR NEW.memo_enc IS NOT NULL OR NEW.email_enc IS NOT NULL) THEN
    RAISE EXCEPTION 'PRIVACY: 파기된 리드 연락처를 다시 저장할 수 없습니다';
  END IF;
  -- 보관 기한을 뒤로 미루는 것도 막습니다. 미루면 파기가 영원히 안 옵니다.
  IF NEW.retention_until > OLD.retention_until THEN
    RAISE EXCEPTION 'PRIVACY: 보관 기한을 늘릴 수 없습니다 (% → %)', OLD.retention_until, NEW.retention_until;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pii.fn_save_lead_email(p_lead_id uuid, p_email text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  IF p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'PRIVACY: 이메일 형식이 아닙니다'; END IF;
  UPDATE pii.lead_contacts SET email_enc = pgp_sym_encrypt(btrim(p_email), fn_enc_key())
   WHERE lead_id = p_lead_id AND purged_at IS NULL;
END $$;

/* 연락처 풀기 — 이메일을 함께 돌려줌(열 때마다 열람 기록은 그대로 한 줄) */
DROP FUNCTION IF EXISTS pii.fn_read_lead_contact(uuid, uuid, text);
CREATE FUNCTION pii.fn_read_lead_contact(p_lead_id uuid, p_actor uuid, p_reason text)
 RETURNS TABLE(name text, phone text, address text, email text)
 LANGUAGE plpgsql AS $$
DECLARE v_purged timestamptz; v_key text;
BEGIN
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'PRIVACY: 열람 사유를 적어야 합니다'; END IF;
  v_key := fn_enc_key();   -- 없으면 여기서 멈춥니다
  SELECT purged_at INTO v_purged FROM pii.lead_contacts WHERE lead_id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRIVACY: 없는 리드입니다'; END IF;
  IF v_purged IS NOT NULL THEN RAISE EXCEPTION 'PRIVACY: 파기된 리드입니다 (%)', v_purged; END IF;
  INSERT INTO audit.pii_access_logs (actor_account_id, lead_id, access_type, reason, occurred_at)
  VALUES (p_actor, p_lead_id, 'VIEW', p_reason, now());
  RETURN QUERY
  SELECT pgp_sym_decrypt(c.name_enc, v_key)::text, pgp_sym_decrypt(c.phone_enc, v_key)::text,
         pgp_sym_decrypt(c.address_enc, v_key)::text,
         CASE WHEN c.email_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(c.email_enc, v_key)::text END
    FROM pii.lead_contacts c WHERE c.lead_id = p_lead_id;
END $$;
COMMENT ON FUNCTION pii.fn_read_lead_contact(uuid, uuid, text) IS
'리드 연락처(이름 · 휴대폰 · 주소 · 이메일)를 복호화해 돌려주고 열람 기록을 남깁니다. 열쇠는 fn_enc_key() 가 세션에서 꺼냅니다 — 부르는 쪽이 열쇠를 알 필요가 없습니다.';

CREATE OR REPLACE FUNCTION public.fn_consult_deliver(p_request uuid)
 RETURNS TABLE(state text, partner_id uuid, lead_id uuid)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE
  r         consult_requests%ROWTYPE;
  v_partner uuid; v_lead uuid; v_name text; v_summary text;
  v_contact jsonb; v_target int; v_maxage int;
BEGIN
  SELECT cr.* INTO r FROM consult_requests cr WHERE cr.id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONSULT_NOT_FOUND: 상담 신청이 없습니다'; END IF;
  IF r.verified_at IS NULL THEN
    RAISE EXCEPTION 'CONSULT_UNVERIFIED: 휴대폰 확인 전에는 업체에 전달하지 않습니다';
  END IF;
  IF r.state = 'DELIVERED' THEN
    RETURN QUERY SELECT r.state, r.partner_id, r.lead_id; RETURN;
  END IF;
  IF r.state IN ('EXPIRED','PURGED') OR r.contact_enc IS NULL THEN
    RAISE EXCEPTION 'CONSULT_EXPIRED: 만료된 신청입니다 — 다시 신청해 주십시오';
  END IF;

  SELECT name INTO v_name FROM categories WHERE id = r.category_id;
  v_contact := pgp_sym_decrypt(r.contact_enc, fn_enc_key())::jsonb;
  /* 요약은 열람 전 업체에 무료로 보입니다 — 연락처가 섞인 메모는 요약으로 쓰지 않습니다(ck_leads_summary_no_phone) */
  v_summary := nullif(btrim(left(coalesce(r.memo, ''), 500)), '');
  IF v_summary IS NULL OR v_summary ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}' THEN
    v_summary := v_name || ' 상담 신청';
  END IF;
  v_target := fn_lead_setting_int('lead.assign.target', 1);
  v_maxage := fn_lead_setting_int('lead.assign.max_age_hours', 72);

  BEGIN
    INSERT INTO leads (category_id, sido, sigungu, summary,
                       assign_state, target_partners, assign_deadline, requester_account_id, source)
    VALUES (r.category_id, r.sido, r.sigungu, v_summary,
            'OPEN', v_target, now() + make_interval(hours => v_maxage), r.requester_account_id, 'WEB')
    RETURNING id INTO v_lead;
    PERFORM pii.fn_save_lead_contact(v_lead, v_contact->>'name', v_contact->>'phone', NULL,
                                     nullif(btrim(coalesce(r.memo, '')), ''));
    /* v10.28 — 신청자가 적은 이메일도 같은 곳(pii.lead_contacts)에 암호화해 둡니다 · 업체가 연락처를 열 때만 풀림 */
    IF nullif(btrim(coalesce(v_contact->>'email', '')), '') IS NOT NULL THEN
      PERFORM pii.fn_save_lead_email(v_lead, v_contact->>'email');
    END IF;
    SELECT a.partner_id INTO v_partner FROM fn_lead_assign(v_lead, 'AUTO', NULL) a LIMIT 1;
    IF v_partner IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'SGB01', MESSAGE = 'no partner';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'SGB01' THEN
      v_lead := NULL; v_partner := NULL;                   -- 리드 · 연락처 이관을 되돌립니다
    WHEN raise_exception THEN
      /* GATED 업종에 자격 승인 업체가 한 곳도 없으면 리드 생성 자체가 막힙니다 — 받을 업체 없음과 같습니다 */
      IF SQLERRM LIKE 'LEAD_GATED%' THEN v_lead := NULL; v_partner := NULL;
      ELSE RAISE; END IF;
  END;

  IF v_partner IS NULL THEN
    UPDATE consult_requests SET state = 'NO_PARTNER' WHERE id = r.id;
    RETURN QUERY SELECT 'NO_PARTNER'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  /* 배분되면 연락처는 pii.lead_contacts 한 곳에만 둡니다 */
  UPDATE consult_requests
     SET state = 'DELIVERED', lead_id = v_lead, partner_id = v_partner, contact_enc = NULL
   WHERE id = r.id;
  RETURN QUERY SELECT 'DELIVERED'::text, v_partner, v_lead;
END $function$;

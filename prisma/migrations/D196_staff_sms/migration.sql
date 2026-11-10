-- =====================================================================
-- D196 (v10.227 · docs/364) — 운영 화면 접속 인증 문자 길(알림톡 · 실패하면 문자)
--
--   ① staff_access 에 운영자 휴대폰(본인 확인 뒤에만 들어감) · 확인 시각
--   ② staff_phone_codes — 휴대폰 확인 번호(sha256 만 · 5분 · 5번)
--   ③ 알림톡 템플릿 STAFF_IP_OTP(운영 화면 접속 인증번호) · 보낸 기록 목적 STAFF_OTP
--   ④ 설정 admin.ip_verify_channel TELEGRAM(지금 그대로) · SMS · SMS_THEN_TELEGRAM(문자가 안 되면 텔레그램)
--
--   설정을 바꾸지 않으면 아무것도 바뀌지 않습니다. 지우는 문장 없음(검사 조건만 넓힘).
-- =====================================================================

-- 1. 운영자 휴대폰 ---------------------------------------------------------
ALTER TABLE public.staff_access ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.staff_access ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE public.staff_access DROP CONSTRAINT IF EXISTS ck_staff_access_phone;
ALTER TABLE public.staff_access ADD CONSTRAINT ck_staff_access_phone
  CHECK ((phone IS NULL AND phone_verified_at IS NULL) OR (phone ~ '^01[016789][0-9]{7,8}$' AND phone_verified_at IS NOT NULL));
COMMENT ON COLUMN public.staff_access.phone IS '운영자 휴대폰(숫자만 · D196) — 그 번호로 받은 확인 번호를 넣어야만 들어감(phone_verified_at). 접속 인증 문자 길에 씀. 화면 · 기록에는 끝 4자리만.';

-- 2. 휴대폰 확인 번호 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_phone_codes (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone       text NOT NULL CHECK (phone ~ '^01[016789][0-9]{7,8}$'),
  code_hash   text NOT NULL CHECK (length(code_hash) = 64),
  expires_at  timestamptz NOT NULL,
  tries       int NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_staff_phone_codes_acc ON public.staff_phone_codes (account_id, created_at DESC);
COMMENT ON TABLE public.staff_phone_codes IS
  '운영자 휴대폰 확인 번호(D196). code_hash = sha256(계정 · 번호 · 6자리) — 원래 번호는 저장하지 않음 · 5분 · 5번 틀리면 끝 · 1분에 한 번 · 하루 5번.';

-- 3. 알림톡 템플릿 · 보낸 기록 목적 --------------------------------------------
ALTER TABLE public.alimtalk_templates DROP CONSTRAINT IF EXISTS ck_alimtalk_tpl_code;
ALTER TABLE public.alimtalk_templates ADD CONSTRAINT ck_alimtalk_tpl_code
  CHECK (code IN ('CONSULT_OTP', 'HANDOFF_ADMIN', 'ORDER_STATUS', 'NOTICE_GENERAL', 'STAFF_IP_OTP'));
INSERT INTO public.alimtalk_templates (code, name) VALUES ('STAFF_IP_OTP', '운영 화면 접속 인증번호')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE public.alimtalk_sends DROP CONSTRAINT IF EXISTS ck_alimtalk_send_purpose;
ALTER TABLE public.alimtalk_sends ADD CONSTRAINT ck_alimtalk_send_purpose
  CHECK (purpose IN ('CONSULT_OTP', 'NOTIFY', 'TEST', 'STAFF_OTP'));

-- 4. 설정 --------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('admin.ip_verify_channel', 'TELEGRAM', 'ADMIN',
   '운영 화면 접속 인증번호 보내는 길(v10.227 · docs/364) — TELEGRAM(개인 대화 · 없으면 운영 대화방) · SMS(확인한 운영자 휴대폰 · 알림톡 STAFF_IP_OTP · 실패하면 문자) · SMS_THEN_TELEGRAM(문자가 안 되면 텔레그램). SUPER 만 · 접속 인증이 켜져 있으면 모든 운영자가 그 길로 받을 수 있어야 바뀜.',
   false, '^(TELEGRAM|SMS|SMS_THEN_TELEGRAM)$', 'TELEGRAM')
ON CONFLICT (key) DO NOTHING;

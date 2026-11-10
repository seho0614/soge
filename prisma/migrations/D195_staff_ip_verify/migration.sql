-- =====================================================================
-- D195 (v10.226 · docs/363) — 운영 화면 접속 인증(허용 IP 밖이면 그날 인증)
--
--   ① staff_ip_allow — 인증 없이 들어오는 허용 IP(SUPER 가 고침 · 메모 필수)
--   ② staff_ip_codes — 보낸 인증번호(원래 번호는 저장하지 않고 sha256 만 · 5분 · 틀린 횟수)
--   ③ staff_ip_passes — 인증한 운영자 · IP · 날짜(한국) — 그날 자정까지 유효 · 고칠 수 없음
--   ④ staff_access — 운영자별 인증번호 받을 곳(텔레그램 대화 번호 · 없으면 운영 대화방 ops.telegram_chat)
--   ⑤ 설정 admin.ip_verify off(오픈 전 인증 없이 · 켜기 SUPER) · 중요 설정 바뀜 알림에 더함
--
--   켜기 전(off)에는 아무것도 바뀌지 않습니다. 지우는 문장 없음.
-- =====================================================================

-- 1. 허용 IP -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_ip_allow (
  id          bigserial PRIMARY KEY,
  ip          inet NOT NULL UNIQUE,
  memo        text NOT NULL CHECK (length(btrim(memo)) BETWEEN 1 AND 100),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.staff_ip_allow IS
  '운영 화면 허용 IP(D195 · v10.226). 여기 있는 IP 에서는 접속 인증 없이 운영 API 를 씁니다(admin.ip_verify on 일 때만 봄). 한 주소씩(inet) · 메모 필수 · SUPER 가 운영 화면 「접속 인증」에서 더하고 뺌(감사 기록).';

-- 2. 보낸 인증번호 --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_ip_codes (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ip          inet NOT NULL,
  code_hash   text NOT NULL CHECK (length(code_hash) = 64),
  channel     text NOT NULL CHECK (channel IN ('TELEGRAM_ME', 'TELEGRAM_OPS', 'SMS')),
  expires_at  timestamptz NOT NULL,
  tries       int NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_staff_ip_codes_acc ON public.staff_ip_codes (account_id, created_at DESC);
COMMENT ON TABLE public.staff_ip_codes IS
  '운영 화면 접속 인증번호(D195). code_hash = sha256(계정 · IP · 6자리) — 원래 번호는 저장하지 않음 · 5분 · 5번 틀리면 그 번호는 못 씀(15분 동안 새 번호도 막음) · 1분에 한 번 · 하루 10번.';

-- 3. 인증한 운영자 · IP · 날짜 ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_ip_passes (
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ip          inet NOT NULL,
  day         date NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('TELEGRAM_ME', 'TELEGRAM_OPS', 'SMS')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, ip, day)
);
COMMENT ON TABLE public.staff_ip_passes IS
  '운영 화면 접속 인증 통과(D195). day = 한국 날짜 — 그날 자정까지 그 운영자 · IP 로 운영 API 를 씀. 고칠 수 없음(지우기는 계정 삭제 때만).';
DROP TRIGGER IF EXISTS trg_staff_ip_passes_ro ON public.staff_ip_passes;
CREATE TRIGGER trg_staff_ip_passes_ro BEFORE UPDATE ON public.staff_ip_passes
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

-- 4. 운영자별 받을 곳 -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_access (
  account_id     uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  telegram_chat  text CHECK (telegram_chat IS NULL OR telegram_chat ~ '^-?[0-9]{5,20}$'),
  updated_by     uuid REFERENCES public.accounts(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.staff_access IS
  '운영자별 접속 인증번호 받을 곳(D195). telegram_chat = 그 운영자 개인 텔레그램 대화 번호(봇에게 먼저 말을 걸어야 받음) · 비어 있으면 운영 대화방(ops.telegram_chat — 대화방 사람 모두 봄). 본인 또는 SUPER 가 고침.';

-- 5. 설정 --------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('admin.ip_verify', 'off', 'ADMIN',
   '운영 화면 접속 인증(v10.226 · docs/363) — on 이면 허용 IP(staff_ip_allow) 밖에서 운영 API 를 쓰기 전에 그날 한 번 인증번호(텔레그램)를 넣어야 함 · 한국 시간 자정까지 유효. off 는 오픈 전(인증 없이). 켜기는 SUPER · 텔레그램 봇 토큰과 모든 운영자의 받을 곳이 있어야 켜짐.',
   false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_setting_watch() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_old text := OLD.value;
  v_by  uuid;
BEGIN
  IF NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.key IN ('mall.order_open', 'signup.open', 'admin.mfa_required', 'mall.tenant', 'mall.tenant_apply', 'admin.ip_verify')
          OR NEW.key LIKE 'assume.%' OR NEW.key LIKE 'feature.%') THEN
    RETURN NEW;
  END IF;
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    v_by := NEW.updated_by;
  END IF;
  /* raised_at 은 clock_timestamp — (alert_code, raised_at) 가 유일이라 한 문장으로 두 키를 바꿀 때 now() 로 겹치지 않게(D179 와 같음) */
  INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
  VALUES ('SETTING_CHANGED', 'WARN', clock_timestamp(),
          format('중요 설정 바뀜 — %s: %s → %s', NEW.key, coalesce(nullif(v_old, ''), '(빈 값)'), coalesce(nullif(NEW.value, ''), '(빈 값)')),
          jsonb_build_object('key', NEW.key, 'from', v_old, 'to', NEW.value,
                             'by', v_by, 'via', CASE WHEN v_by IS NULL THEN 'DB' ELSE 'APP' END,
                             'dbUser', current_user,
                             'reason', nullif(current_setting('app.setting_reason', true), '')));
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_setting_watch() IS '중요 설정(주문 받기 · 입점 판매 · 입점 신청 · 가입 · 2단계 인증 · 운영 화면 접속 인증 · 간주 · 기능 스위치)이 바뀌면 운영 알림 SETTING_CHANGED(WARN) — D174 · D180 · D193 · D195';

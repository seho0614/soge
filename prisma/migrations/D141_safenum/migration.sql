-- =====================================================================
-- D141 — v10.145 (2026-10-28 · 050 안심번호 틀 · 설계 docs/218 · docs/221)
--
--   ① safe_numbers 칸 더함 — 받은 회원(account_id) · 방식(provider) · 업체 번호 id(vendor_id) · 돌려준 까닭
--      (표 · 통화 기록 call_logs · 트리거 fn_attribute_call 은 B 단계부터 있음 — 통화 → 소개 기록 CALL 90일)
--   ② call_logs 칸 더함 — 방식 · 업체 알림 번호(event_id · 같은 알림 한 번) · 통화 끝난 시각(업체 값)
--      call_logs 는 고칠 수 없는 표(trg_call_logs_ro) — 칸만 더하고 행은 넣기만
--   ③ safenum_events — 업체 통화 알림(웹훅) 받은 기록(서명 검사 · 중복 · 결과 · 본문 · 번호 저장 안 함)
--   ④ 연동 키 이름 ('SAFENUM','SAFENUM_WEBHOOK_SECRET')
--   ⑤ 설정 safenum.provider = NONE(지금과 같음 — 「준비 중」 안내) · safenum.hours 24 · safenum.daily 10
--   ⑥ 배치 safenum_release(60분) — 기한 지난 번호를 업체에 돌려줌
--   재실행 안전 · 자료를 지우지 않음.
-- =====================================================================

ALTER TABLE public.safe_numbers ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE public.safe_numbers ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.safe_numbers ADD COLUMN IF NOT EXISTS vendor_id text;
ALTER TABLE public.safe_numbers ADD COLUMN IF NOT EXISTS release_note text;
ALTER TABLE public.safe_numbers DROP CONSTRAINT IF EXISTS ck_safe_numbers_provider;
ALTER TABLE public.safe_numbers ADD CONSTRAINT ck_safe_numbers_provider CHECK (provider IS NULL OR provider IN ('MOCK', 'HTTP'));
CREATE INDEX IF NOT EXISTS idx_safe_numbers_account ON public.safe_numbers (account_id, issued_at DESC);

ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS event_id text;
ALTER TABLE public.call_logs ADD COLUMN IF NOT EXISTS ended_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_logs_event ON public.call_logs (provider, event_id) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.safenum_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  event_id text,
  sig_ok boolean NOT NULL,
  duplicate boolean NOT NULL DEFAULT false,
  result text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_safenum_evt_at ON public.safenum_events (received_at DESC);

ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY'), ('SAFENUM','SAFENUM_WEBHOOK_SECRET')));

/* fn_integ_secret_set — D139 그대로 + 안심번호 웹훅 비밀값도 「업체마다 다른 키」 칸(8 ~ 512자 · 빈칸 없음) */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_set(p_code text, p_name text, p_value text, p_actor uuid)
 RETURNS TABLE(o_name text, o_last4 text, o_updated_at timestamptz) LANGUAGE plpgsql AS $function$
/* 돌려주는 칸 이름에 o_ 를 붙입니다 — 표의 칸(name · last4 · updated_at)과 이름이 같으면 plpgsql 이 「모호함」으로 멈춥니다 */
DECLARE v text := btrim(coalesce(p_value, ''));
BEGIN
  IF p_name IN ('KMA_SERVICE_KEY', 'NTS_SERVICE_KEY') THEN
    /* 공공데이터포털 일반 인증키 — Decoding(+ / =) 또는 Encoding(%2B …) 어느 쪽이든 받습니다 */
    IF v !~ '^[A-Za-z0-9+/=%]{20,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 공공데이터포털 › 마이페이지 › 활용 신청 상세의 「일반 인증키(Decoding)」를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'ANTHROPIC_API_KEY' THEN
    /* v10.111 — API 키만(sk-ant-api…). 관리 키(sk-ant-admin…) · 사용자 키(sk-ant-usr…)는 쓰지 않습니다 */
    IF v !~ '^sk-ant-api[A-Za-z0-9_-]{20,250}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — Anthropic 콘솔 › API Keys 에서 만든 키(sk-ant-api 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_SECRET_KEY' THEN
    /* 토스페이먼츠 시크릿 키 — test_sk_ · live_sk_ (결제위젯은 gsk) */
    IF v !~ '^(test|live)_g?sk_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「시크릿 키」(test_sk_ · live_sk_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_CLIENT_KEY' THEN
    /* 결제창 클라이언트 키 — 브라우저에 나가는 공개 키(test_ck_ · live_ck_ · 결제위젯은 gck) */
    IF v !~ '^(test|live)_g?ck_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「클라이언트 키」(test_ck_ · live_ck_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'SMTP_PASS' THEN
    /* SES SMTP 비밀번호 — base64 모양 */
    IF v !~ '^[A-Za-z0-9+/=]{20,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 비밀번호를 붙여 넣으십시오(IAM 액세스 키가 아닙니다).';
    END IF;
  ELSIF p_name = 'SMTP_USER' THEN
    /* v10.140 — SES SMTP 사용자 이름(보통 AKIA 로 시작하는 20자 · 영문 대문자 · 숫자) */
    IF v !~ '^[A-Z0-9]{16,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 사용자 이름(영문 대문자 · 숫자)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name IN ('BANK_VERIFY_KEY', 'BROKER_LOOKUP_KEY', 'ETAX_KEY', 'PASS_API_KEY', 'ESIGN_API_KEY', 'ALIMTALK_KEY', 'SAFENUM_KEY',
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET') THEN
    /* 업체마다 모양이 달라 「빈칸 없는 영문 · 숫자 · 기호 8 ~ 512자」만 봅니다(PostgreSQL 정규식 반복 수는 255 까지라 길이는 따로) */
    IF length(v) NOT BETWEEN 8 AND 512 OR v !~ '^[!-~]+$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 업체에서 받은 키를 빈칸 없이 붙여 넣으십시오(8 ~ 512자).';
    END IF;
  ELSIF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY'), p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name NOT IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY') THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('safenum.provider', 'NONE', 'GLOBAL', '050 안심번호 방식(v10.145 · docs/221) — NONE 「준비 중」 안내(지금과 같음) · MOCK 가짜 번호(점검판 · 운영 서버에서는 못 고름) · HTTP 업체(키 · 웹훅 비밀값 · SAFENUM_URL) · 바꾸기는 SUPER', '^(NONE|MOCK|HTTP)$', 'NONE'),
  ('safenum.hours', '24', 'GLOBAL', '안심번호 한 번 받은 번호를 쓰는 시간(v10.145) — 지나면 업체에 돌려줌', '^([1-9]|[1-6][0-9]|7[0-2])$', '24'),
  ('safenum.daily', '10', 'GLOBAL', '회원 한 명이 하루에 새로 받을 수 있는 안심번호 수(v10.145 · 업체 요금)', '^[0-9]{1,3}$', '10')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('safenum_release', 60, NULL, NULL, NULL, true, '안심번호 돌려주기(v10.145) — 쓰는 시간(safenum.hours)이 지난 050 번호를 업체에 돌려줌')
ON CONFLICT (job) DO NOTHING;

COMMENT ON TABLE public.safenum_events IS '050 안심번호 업체 통화 알림(웹훅) 받은 기록(D141 · docs/221) — 서명 검사 · 중복 · 결과만(본문 · 전화번호 저장 안 함).';

-- 통화 → 소개 기록(B075 fn_attribute_call 고침) — 같은 회원이 24시간 안에 다시 걸면 소개 기록은 이미 있으므로 건너뜀.
-- 고치기 전에는 24시간 중복 막기(fn_attr_dedupe_24h · ATTR_DUP)에 걸려 통화 기록 · 웹훅까지 실패했다(업체가 같은 알림을 계속 다시 보냄).
CREATE OR REPLACE FUNCTION public.fn_attribute_call() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE sn record; vk text;
BEGIN
  SELECT * INTO sn FROM safe_numbers WHERE id = NEW.safe_number_id;
  IF sn.code IS NOT NULL THEN
    vk := coalesce(sn.visitor_key, NEW.caller_hash);
    IF NOT EXISTS (
         SELECT 1 FROM attribution_events e
          WHERE e.code = sn.code AND e.visitor_key = vk AND e.source = 'INTRO'
            AND e.occurred_at > NEW.occurred_at - interval '24 hours'
            AND e.occurred_at < NEW.occurred_at + interval '24 hours') THEN
      INSERT INTO attribution_events(code, visitor_key, channel, occurred_at, expires_at, raw)
      VALUES (sn.code, vk, 'CALL', NEW.occurred_at, NEW.occurred_at + interval '90 days',
              jsonb_build_object('safe_number_id', sn.id, 'duration_sec', NEW.duration_sec));
    END IF;
  END IF;
  RETURN NEW;
END $$;

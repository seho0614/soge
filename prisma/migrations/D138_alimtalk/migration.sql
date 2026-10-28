-- =====================================================================
-- D138 — v10.142 (2026-10-28 · 알림톡 연동 틀 · 설계 docs/213 · docs/215)
--
--   ① alimtalk_templates — 템플릿 4개(상담 인증번호 · 넘김 알림 · 주문 · 반품 상태 · 일반 알림) · 대행사 템플릿 코드 · 심의 상태
--      심의 「승인」된 템플릿만 보냄. 본문은 코드(src/common/alimtalk/alimtalk.templates.ts)가 기준 — 대행사에 같은 글로 등록
--   ② alimtalk_sends — 보낸 기록(목적 · 템플릿 · 받는 번호 끝 4자리만 · 결과 · 대행사 번호 · 실패 까닭)
--   ③ 연동 키 이름 ('ALIMTALK','ALIMTALK_SENDER_KEY') — 발신 프로필 키
--   ④ 설정 alimtalk.provider = NONE(지금과 같음) · alimtalk.test_daily = 20
--   ⑤ v_notify_channels 의 SMS 줄 — notify.sms_ready 또는 notify.alimtalk_ready(알림톡 켜기)가 on 이면 준비(둘 다 off 면 지금과 같음)
--   재실행 안전 · 자료를 지우지 않음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.alimtalk_templates (
  code text PRIMARY KEY,
  name text NOT NULL,
  vendor_code text,
  review_state text NOT NULL DEFAULT 'NONE',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_alimtalk_tpl_code CHECK (code IN ('CONSULT_OTP', 'HANDOFF_ADMIN', 'ORDER_STATUS', 'NOTICE_GENERAL')),
  CONSTRAINT ck_alimtalk_tpl_state CHECK (review_state IN ('NONE', 'REVIEW', 'APPROVED', 'REJECTED')),
  CONSTRAINT ck_alimtalk_tpl_vendor CHECK (vendor_code IS NULL OR vendor_code ~ '^[A-Za-z0-9_-]{1,60}$')
);
INSERT INTO public.alimtalk_templates (code, name) VALUES
  ('CONSULT_OTP', '상담 신청 인증번호'), ('HANDOFF_ADMIN', 'AI 상담 넘김 알림(운영자)'),
  ('ORDER_STATUS', '주문 · 반품 상태'), ('NOTICE_GENERAL', '알림 일반')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.alimtalk_sends (
  id bigserial PRIMARY KEY,
  purpose text NOT NULL,
  template_code text NOT NULL,
  to_last4 text,
  status text NOT NULL,
  provider text NOT NULL,
  provider_msg_id text,
  error_kind text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_alimtalk_send_purpose CHECK (purpose IN ('CONSULT_OTP', 'NOTIFY', 'TEST')),
  CONSTRAINT ck_alimtalk_send_status CHECK (status IN ('SENT', 'FAILED'))
);
CREATE INDEX IF NOT EXISTS idx_alimtalk_sends_at ON public.alimtalk_sends (created_at DESC);

ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY')));

/* fn_integ_secret_set — D137 그대로 + 알림톡 발신 프로필 키도 「업체마다 다른 키」 칸(8 ~ 512자 · 빈칸 없음) */
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
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID', 'ALIMTALK_SENDER_KEY') THEN
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
  ('alimtalk.provider', 'NONE', 'GLOBAL', '알림톡 방식(v10.142 · docs/215) — NONE 보내지 않음(지금과 같음) · MOCK 점검판(보내지 않고 기록만 · 운영 서버에서는 못 고름) · HTTP 대행사(키 · 발신 프로필 키 · ALIMTALK_URL) · 바꾸기는 SUPER', '^(NONE|MOCK|HTTP)$', 'NONE'),
  ('alimtalk.test_daily', '20', 'GLOBAL', '운영 화면 「알림톡」 시험 발송 하루 횟수(v10.142)', '^[0-9]{1,3}$', '20')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW public.v_notify_channels AS
 SELECT 'INAPP'::text AS channel,
    true AS ready,
    '항상 가능'::text AS note
UNION ALL
 SELECT 'EMAIL'::text AS channel,
    ( SELECT (lower(site_settings.value) = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key = 'notify.email_verified'::text)) AS ready,
    'SPF·DKIM 확인 후 켭니다. 인증 없이 보내면 스팸함으로 갑니다'::text AS note
UNION ALL
 SELECT 'SMS'::text AS channel,
    coalesce(( SELECT bool_or(lower(site_settings.value) = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key IN ('notify.sms_ready'::text, 'notify.alimtalk_ready'::text))), false) AS ready,
    '발송사 계약 후 켭니다 — v10.142 부터 알림톡 켜기(notify.alimtalk_ready)로도 열림(알림톡 일반 템플릿으로 보냄)'::text AS note
UNION ALL
 SELECT 'ALIMTALK'::text AS channel,
    ( SELECT (lower(site_settings.value) = 'on'::text)
           FROM public.site_settings
          WHERE (site_settings.key = 'notify.alimtalk_ready'::text)) AS ready,
    '카카오 템플릿 사전 승인 후 켭니다'::text AS note;

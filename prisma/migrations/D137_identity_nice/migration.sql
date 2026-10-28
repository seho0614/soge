-- =====================================================================
-- D137 — v10.141 (2026-10-28 · 본인인증 NICE 표준창 틀 · 설계 docs/213 · docs/214)
--
--   ① identity_verifications 에 칸 — 요청 번호(1회용) · 만료 · 방식(STUB · MOCK · NICE) · 이름 일치 · 실패 까닭 · 표준창 세션(암호화 · 끝나면 비움)
--      원문 CI · DI · 이름 · 생년월일은 저장하지 않음(CI 는 서버 열쇠 HMAC 해시만 — ci_hash)
--   ② 연동 키 이름 ('PASS','NICE_CLIENT_ID' · 'NICE_CLIENT_SECRET' · 'NICE_PRODUCT_ID') — 운영 화면 › 외부 연동 › 연동 키
--   ③ 설정 identity.provider = STUB(지금과 같음) · identity.ci_duplicate = warn · identity.min_age = 14 (대표 「추천대로」 10/28)
--   재실행 안전 · 자료를 지우지 않음 · 기존 stub-ci 기록 그대로.
-- =====================================================================

ALTER TABLE public.identity_verifications
  ADD COLUMN IF NOT EXISTS req_no text,
  ADD COLUMN IF NOT EXISTS req_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS adapter text,
  ADD COLUMN IF NOT EXISTS name_match boolean,
  ADD COLUMN IF NOT EXISTS fail_code text,
  ADD COLUMN IF NOT EXISTS session_enc bytea;
ALTER TABLE public.identity_verifications DROP CONSTRAINT IF EXISTS ck_idv_adapter;
ALTER TABLE public.identity_verifications ADD CONSTRAINT ck_idv_adapter CHECK (adapter IS NULL OR adapter IN ('STUB', 'MOCK', 'NICE'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_idv_req_no ON public.identity_verifications (req_no) WHERE req_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idv_ci_hash ON public.identity_verifications (ci_hash) WHERE ci_hash IS NOT NULL;

ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ALIMTALK','ALIMTALK_KEY'), ('SAFENUM','SAFENUM_KEY')));

/* fn_integ_secret_set — D136 그대로 + NICE 키 3개는 「업체마다 다른 키」 칸(8 ~ 512자 · 빈칸 없음) */
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
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID') THEN
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
  ('identity.provider', 'STUB', 'GLOBAL', '본인인증 방식(v10.141 · docs/214) — STUB 지금처럼 바로 통과(시험용 표시) · MOCK 점검판 가짜 표준창(운영 서버에서는 못 고름) · NICE 실제 표준창(키 3개 필요) · 바꾸기는 SUPER', '^(STUB|MOCK|NICE)$', 'STUB'),
  ('identity.ci_duplicate', 'warn', 'GLOBAL', '같은 사람(CI)이 다른 계정으로 본인인증 — warn 통과하고 운영 화면에 표시 · block 막음(v10.141)', '^(warn|block)$', 'warn'),
  ('identity.min_age', '14', 'GLOBAL', '본인인증 나이 하한(만 나이 · v10.141) — 미만이면 인증 실패 UNDER_AGE', '^[0-9]{1,2}$', '14')
ON CONFLICT (key) DO NOTHING;

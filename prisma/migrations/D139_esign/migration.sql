-- =====================================================================
-- D139 — v10.143 (2026-10-28 · 전자계약 연동 틀 · 설계 docs/216 · docs/217)
--
--   ① esign_documents — 전자서명 요청 한 건(계약 · 방식 · 업체 문서 id · 상태 · 계약서 지문 · 당사자별 서명 시각 · 서명 주소 · 오류)
--      한 계약에 대기(PENDING) 요청은 하나만. 업체 문서 id 는 방식마다 하나.
--   ② esign_events — 업체 완료 알림(웹훅) 받은 기록(서명 검사 · 중복 · 처리 결과) · 본문은 저장하지 않음(문서 id · 종류만)
--   ③ 연동 키 이름 ('ESIGN','ESIGN_WEBHOOK_SECRET') — 웹훅 서명 검사 비밀값
--   ④ 설정 esign.provider = STUB(지금과 같음) · esign.expire_days = 7
--   ⑤ 배치 esign_poll(10분) — 웹훅이 빠져도 대기 중 요청의 상태를 업체에 물어 맞춤 · 만료 처리
--   재실행 안전 · 자료를 지우지 않음. deal_contracts 의 esign_doc_id · esign_stub 는 그대로 씀(요청 중 표시 · 알림 트리거).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.esign_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.deal_contracts(id),
  deal_id uuid NOT NULL,
  provider text NOT NULL,
  doc_id text,
  state text NOT NULL DEFAULT 'PENDING',
  doc_hash text NOT NULL,
  buyer_signed_at timestamptz,
  seller_signed_at timestamptz,
  buyer_sign_url text,
  seller_sign_url text,
  error_kind text,
  error text,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_polled_at timestamptz,
  CONSTRAINT ck_esign_doc_provider CHECK (provider IN ('STUB', 'MOCK', 'HTTP')),
  CONSTRAINT ck_esign_doc_state CHECK (state IN ('PENDING', 'SIGNED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED')),
  CONSTRAINT ck_esign_doc_hash CHECK (doc_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esign_doc_pending ON public.esign_documents (contract_id) WHERE state = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS uq_esign_doc_vendor ON public.esign_documents (provider, doc_id) WHERE doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esign_doc_at ON public.esign_documents (created_at DESC);

CREATE TABLE IF NOT EXISTS public.esign_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  event_id text,
  doc_id text,
  kind text,
  sig_ok boolean NOT NULL,
  duplicate boolean NOT NULL DEFAULT false,
  result text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esign_evt ON public.esign_events (provider, event_id) WHERE sig_ok AND NOT duplicate AND event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esign_evt_at ON public.esign_events (received_at DESC);

ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY')));

/* fn_integ_secret_set — D138 그대로 + 전자계약 웹훅 비밀값도 「업체마다 다른 키」 칸(8 ~ 512자 · 빈칸 없음) */
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
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET') THEN
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
  ('esign.provider', 'STUB', 'GLOBAL', '전자계약 방식(v10.143 · docs/217) — STUB 화면 안 「서명」 단추(지금과 같음) · MOCK 가짜 서명 화면(점검판 · 운영 서버에서는 못 고름) · HTTP 업체(키 · 웹훅 비밀값 · ESIGN_URL) · MOCK · HTTP 면 「전자서명 요청」만 · 바꾸기는 SUPER', '^(STUB|MOCK|HTTP)$', 'STUB'),
  ('esign.expire_days', '7', 'GLOBAL', '전자서명 요청 만료 일수(v10.143) — 지나면 요청이 닫히고 다시 요청할 수 있음', '^([1-9]|[1-2][0-9]|30)$', '7')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('esign_poll', 10, NULL, NULL, NULL, true,
        '전자계약 상태 맞추기(v10.143) — 10분 넘게 대기 중인 요청을 업체에 물어 서명 · 거절 · 만료를 반영(웹훅이 빠져도) · 만료일 지난 요청 닫기')
ON CONFLICT (job) DO NOTHING;

COMMENT ON TABLE public.esign_documents IS '전자서명 요청(D139 · docs/217) — 계약서 지문(SHA-256)과 업체가 증명한 서명 시각. 한 계약에 대기 요청은 하나.';
COMMENT ON TABLE public.esign_events IS '전자계약 업체 완료 알림(웹훅) 받은 기록(D139) — 서명 검사 · 중복 · 처리 결과만(본문 · 개인정보 저장 안 함).';

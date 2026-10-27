-- =====================================================================
-- D128 — v10.128 (2026-10-27 · 외부 연동 키를 운영 화면에서 · docs/192)
--
--   대표 「외부 연동에서 key 등록 관리를 관리자에서 할 수 있도록 · .env 관리가 아님」 → 계획 「승인」(① 키만 · ② 구현 전 연동도 칸은 둠).
--   2026-10-17(map-kakao #7) 「운영 화면 키는 카카오 2개만 — 다른 연동은 결정이 필요」의 그 결정입니다.
--
--   ① integrations MAIL         외부 연동 표에 「메일(Amazon SES SMTP)」 줄 — 키(SMTP_PASS)를 받으려면 연동 줄이 있어야 함 · 오픈 차단에 넣지 않음
--   ② integration_secrets      받는 키 4 → 15(새 11): 전자결제(TOSS_SECRET_KEY · 결제창 TOSS_CLIENT_KEY) · 1원 계좌인증 · 국세청 사업자 진위 ·
--                              국토부 중개사 대조 · 전자세금계산서 · 메일 · 본인인증 · 전자계약 · 알림톡 · 050 안심번호
--   ③ fn_integ_secret_set       키 이름마다 형식 · 공개 키(결제창 · 카카오 JS)는 is_public · 비공개 키를 넣으면 연동 줄 「키 등록」 표시
--
--   값은 지금처럼 pgp_sym_encrypt(fn_enc_key()) 암호문만 · 화면 · 응답에는 끝 4자리만. 열쇠(ENC_KEY)는 .env 에만.
--   운영 화면에 넣은 키가 먼저, 없으면 .env — API 가 1분마다 · 저장 직후 다시 읽음(IntegrationSecretService).
--   자료를 지우지 않습니다 — 줄 1개 · 제약 1개 · 함수 1개. 재실행 안전. 아무 연동도 켜지 않습니다(간주 스위치 · 상태는 그대로).
-- =====================================================================

/* ── ① 외부 연동 표 — 메일 ─────────────────────────────────────────── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('MAIL', '메일(Amazon SES SMTP)', '인증번호 · 알림 메일 — 보내는지는 운영 설정 notify.email_verified 와 SMTP 주소 · 사용자 이름(.env)이 정함',
        'Amazon SES', 'NOT_STARTED', false, 'SMTP_PASS', NULL, false,
        'SES 콘솔 「SMTP 자격 증명」의 비밀번호를 운영 화면 › 외부 연동 › 「연동 키」에 넣습니다(암호화 저장 · SUPER). 주소(SMTP_HOST) · 사용자 이름(SMTP_USER)은 .env(docs/167).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 150))
ON CONFLICT (code) DO NOTHING;

/* ── ② 받는 키 이름 ────────────────────────────────────────────────── */
ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'),
    ('PASS','PASS_API_KEY'), ('ESIGN','ESIGN_API_KEY'), ('ALIMTALK','ALIMTALK_KEY'), ('SAFENUM','SAFENUM_KEY')));
COMMENT ON TABLE public.integration_secrets IS
  'v10.46 · v10.49 · v10.111 · v10.128 (docs/192) — 운영 화면(외부 연동 › 연동 키 · SUPER)에서 넣는 외부 연동 키. 값은 pgp_sym_encrypt(fn_enc_key()) 암호문만 — 열쇠(ENC_KEY)는 .env 에만 있어 DB 백업에는 암호문만 남습니다. 화면에는 끝 4자리만. 운영 화면 키가 먼저, 없으면 .env.';

/* ── ③ 넣기 — 키 이름마다 형식 ─────────────────────────────────────── */
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
  ELSIF p_name IN ('BANK_VERIFY_KEY', 'BROKER_LOOKUP_KEY', 'ETAX_KEY', 'PASS_API_KEY', 'ESIGN_API_KEY', 'ALIMTALK_KEY', 'SAFENUM_KEY') THEN
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

-- =====================================================================
-- D122 — v10.111 (2026-10-26 · AI 키를 운영 화면에서 · docs/173)
--
--   대표 결정(2026-10-26 「관리자 화면에서 관리 하도록 하여도 되니?」 → 계획 → 「개발 진행」)
--     2026-10-17 「운영 화면에서 넣는 키는 카카오 키 2개만」(map-kakao #7) · 2026-10-20 기상청 키 1개(D103) 에 이어
--     **Anthropic API 키 1개만큼** 더 넓힙니다. 결제 · 계좌 · 세금계산서 키는 지금처럼 .env 에만 둡니다.
--
--   ① integrations AGENT       외부 연동 표에 「AI(Anthropic Claude)」 줄 — 오픈을 막지 않음 · 발신 IP 등록 불필요
--   ② integration_secrets      받는 키에 ('AGENT','ANTHROPIC_API_KEY') 를 더함
--   ③ fn_integ_secret_set       키 이름마다 형식 — Anthropic API 키는 sk-ant-api 로 시작(콘솔 키 · 관리 키 · 사용자 키는 거절)
--
--   넣은 값은 pgp_sym_encrypt(fn_enc_key()) 암호문만 저장 · 화면 · 응답에는 끝 4자리만(D099 와 같은 열쇠).
--   키가 있어도 AI 를 부르는지는 지금처럼 fn_agent_allowed(스위치 · 월 상한)가 정합니다 — 이 마이그레이션은 아무것도 켜지 않습니다.
--   자료를 지우지 않습니다 — 줄 1개 · 제약 1개 바꿈 · 함수 1개 바꿈. 재실행 안전.
-- =====================================================================

/* ── ① 외부 연동 표 ────────────────────────────────────────────────── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('AGENT', 'AI(Anthropic Claude)', 'AI 에이전트 — 등록 글 · 게시판 번역 · 검수 보조(의견만) · AI 상담 안내. 부르는지는 AI 운영 › AI 에이전트의 스위치 · 월 상한이 정함',
        'Anthropic', 'NOT_STARTED', false, 'ANTHROPIC_API_KEY', NULL, false,
        'Anthropic 콘솔(console.anthropic.com) › API Keys 에서 만든 키(sk-ant-api…)를 운영 화면 › AI 운영 › AI 에이전트 › 「AI 키」에 넣습니다(암호화 저장 · SUPER). 운영 화면에 키가 없으면 .env 의 ANTHROPIC_API_KEY 를 씁니다(docs/173).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 140))
ON CONFLICT (code) DO NOTHING;

/* ── ② 받는 키 이름 ────────────────────────────────────────────────── */
ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY')));
COMMENT ON TABLE public.integration_secrets IS
  'v10.46 (docs/96) · v10.49 (docs/101) · v10.111 (docs/173) — 운영 화면에서 넣는 카카오맵 키 2개 · 기상청 키 1개 · Anthropic API 키 1개. 값은 pgp_sym_encrypt(fn_enc_key()) 암호문만 — 열쇠(ENC_KEY)는 .env 에만 있어 DB 백업에는 암호문만 남습니다. 화면에는 끝 4자리만.';

/* ── ③ 넣기 — 키 이름마다 형식 ─────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_set(p_code text, p_name text, p_value text, p_actor uuid)
 RETURNS TABLE(o_name text, o_last4 text, o_updated_at timestamptz) LANGUAGE plpgsql AS $function$
/* 돌려주는 칸 이름에 o_ 를 붙입니다 — 표의 칸(name · last4 · updated_at)과 이름이 같으면 plpgsql 이 「모호함」으로 멈춥니다 */
DECLARE v text := btrim(coalesce(p_value, ''));
BEGIN
  IF p_name = 'KMA_SERVICE_KEY' THEN
    /* 공공데이터포털 일반 인증키 — Decoding(+ / =) 또는 Encoding(%2B …) 어느 쪽이든 받습니다. 서버가 부를 때 한 번만 인코딩합니다 */
    IF v !~ '^[A-Za-z0-9+/=%]{20,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 공공데이터포털 › 마이페이지 › 활용 신청 상세의 「일반 인증키(Decoding)」를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'ANTHROPIC_API_KEY' THEN
    /* v10.111 — API 키만(sk-ant-api…). 관리 키(sk-ant-admin…) · 사용자 키(sk-ant-usr…)는 쓰지 않습니다 */
    IF v !~ '^sk-ant-api[A-Za-z0-9_-]{20,250}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — Anthropic 콘솔 › API Keys 에서 만든 키(sk-ant-api 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name = 'KAKAO_JS_KEY', p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name IN ('KAKAO_REST_KEY', 'KMA_SERVICE_KEY', 'ANTHROPIC_API_KEY') THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;

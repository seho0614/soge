-- =====================================================================
-- D103 — v10.49 (2026-10-20 · 메인 「오늘의 날씨」 · docs/101)
--
--   ① integrations WEATHER   외부 연동 표 11번째 줄 — 기상청 단기예보 조회서비스(공공데이터포털) · 오픈을 막지 않음
--   ② integration_secrets    받는 키에 ('WEATHER','KMA_SERVICE_KEY') 를 더함
--                             2026-10-20 대표 승인(v10.49 계획 「카카오맵과 같은 방식」) — 2026-10-17 「카카오 키 2개만」 결정을 이 키 하나만큼 넓힘.
--                             결제 · 계좌 · 세금계산서 키는 지금처럼 .env 에만 둡니다.
--   ③ fn_integ_secret_set     키 이름마다 형식 검사 — 공공데이터포털 인증키는 + / = % 가 들어 있어 카카오 형식으로는 거절됩니다
--   ④ weather.enabled         날씨 띠 스위치 — **처음 값 off**(켜기 전까지 메인은 지금과 같음)
--      weather.default_region 처음 고른 지역이 없을 때의 지역(SEOUL)
--
--   자료를 지우지 않습니다 — 줄 3개 · 제약 1개 바꿈 · 함수 1개 바꿈. 재실행 안전.
-- =====================================================================

/* ── ① 외부 연동 표 ────────────────────────────────────────────────── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('WEATHER', '날씨(기상청 단기예보)', '메인 「오늘의 날씨」 — 시 · 도 17곳의 지금 기온 · 하늘 · 최저 · 최고 · 강수확률 · 습도',
        '기상청(공공데이터포털)', 'NOT_STARTED', false, 'KMA_SERVICE_KEY', NULL, false,
        '공공데이터포털(data.go.kr) 「기상청_단기예보 조회서비스」 활용 신청 → 일반 인증키(Decoding)를 이 화면 아래 「날씨 키」에 넣습니다(암호화 저장). 날씨 사용은 처음에 꺼져 있습니다(docs/101).',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 130))
ON CONFLICT (code) DO NOTHING;

/* ── ② 받는 키 이름 ────────────────────────────────────────────────── */
ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY')));
COMMENT ON TABLE public.integration_secrets IS
  'v10.46 (docs/96) · v10.49 (docs/101) — 운영 화면에서 넣는 카카오맵 키 2개 · 기상청 키 1개. 값은 pgp_sym_encrypt(fn_enc_key()) 암호문만 — 열쇠(ENC_KEY)는 .env 에만 있어 DB 백업에는 암호문만 남습니다. 화면에는 끝 4자리만.';

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
  ELSIF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name = 'KAKAO_JS_KEY', p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name IN ('KAKAO_REST_KEY', 'KMA_SERVICE_KEY') THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;

/* ── ④ 날씨 스위치 · 기본 지역 ──────────────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('weather.enabled', 'off', 'GLOBAL',
        '메인 「오늘의 날씨」(v10.49 · docs/101). off 이면 날씨 띠를 그리지 않고 기상청도 부르지 않습니다 — 메인은 날씨 연동 전과 같습니다. 운영 화면 › 외부 연동 › 날씨 키에서 키를 넣고 「시험 호출」이 성공한 뒤 on 으로 바꾸십시오.',
        false, '^(on|off)$', 'on'),
       ('weather.default_region', 'SEOUL', 'GLOBAL',
        '메인 「오늘의 날씨」의 처음 지역(v10.49). 방문자가 지역을 고르면 그 브라우저는 고른 지역을 씁니다.',
        false, '^(SEOUL|BUSAN|DAEGU|INCHEON|GWANGJU|DAEJEON|ULSAN|SEJONG|GYEONGGI|GANGWON|CHUNGBUK|CHUNGNAM|JEONBUK|JEONNAM|GYEONGBUK|GYEONGNAM|JEJU)$', 'SEOUL')
ON CONFLICT (key) DO NOTHING;

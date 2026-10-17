-- =====================================================================
-- D099 — v10.46 (2026-10-17 · 카카오맵 지도 · docs/96)
--
--   ① listing_geo        매물 정확 좌표 — 본인 · 운영 API 만 읽음(공개 보기 · 공개 API 금지)
--   ② geo_region         시 · 구 중심 좌표 — 공개 화면의 「둘레 원」(실제 등록된 시 · 구만 생김)
--   ③ integration_secrets 카카오 키 2개만 — 운영 화면(SUPER)에서 넣고 **암호화해** 둠(fn_enc_key · 정산 계좌와 같은 열쇠)
--                         2026-10-17 대표 결정: 키를 운영 화면에서 관리 · 이 방식은 카카오 키 2개에만(결제 · 계좌 키는 .env 그대로)
--   ④ integrations MAP   외부 연동 표 10번째 줄 · 오픈을 막지 않음 · 발신 IP 등록 불필요
--   ⑤ map.enabled        지도 사용 스위치 — **처음 값 off**(켜기 전까지 화면 · 동작이 지금과 같음)
--   ⑥ job geo_backfill   좌표가 없거나 실패한 매물을 10분마다 50건씩
--   ⑦ 유출 검사 보기 2개  v_geo_exact_leak · v_secret_leak (verify-invariants 에서 0건이어야 함)
--
--   자료를 지우지 않습니다 — 새 표 3개 · 함수 2개 · 보기 2개 · 줄 3개. 재실행 안전.
-- =====================================================================

/* ── ① 매물 정확 좌표 ──────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.listing_geo (
  listing_id   uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'PENDING',
  lat          numeric(9,6),
  lng          numeric(9,6),
  source       text NOT NULL DEFAULT 'KAKAO_LOCAL',
  address_hash text NOT NULL,
  fail_kind    text,
  tries        integer NOT NULL DEFAULT 0,
  geocoded_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_listing_geo_status CHECK (status IN ('PENDING','OK','FAILED','NOT_FOUND')),
  CONSTRAINT ck_listing_geo_ok     CHECK (status <> 'OK' OR (lat IS NOT NULL AND lng IS NOT NULL)),
  CONSTRAINT ck_listing_geo_kr     CHECK (lat IS NULL OR (lat BETWEEN 33 AND 39 AND lng BETWEEN 124 AND 132))
);
CREATE INDEX IF NOT EXISTS idx_listing_geo_todo ON public.listing_geo (updated_at) WHERE status IN ('PENDING','FAILED');
COMMENT ON TABLE public.listing_geo IS
  'v10.46 (docs/96) — 매물 정확 좌표. 본인 · 운영 API 만 읽습니다. 공개 보기(v_*) · 공개 API 에 넣지 마십시오(v_geo_exact_leak).';

/* ── ② 시 · 구 중심 좌표 ───────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.geo_region (
  sido       text NOT NULL,
  sigungu    text NOT NULL,
  lat        numeric(9,6) NOT NULL,
  lng        numeric(9,6) NOT NULL,
  source     text NOT NULL DEFAULT 'KAKAO_LOCAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sido, sigungu),
  CONSTRAINT ck_geo_region_kr CHECK (lat BETWEEN 33 AND 39 AND lng BETWEEN 124 AND 132)
);
COMMENT ON TABLE public.geo_region IS
  'v10.46 (docs/96) — 시 · 구 중심(공개 화면의 둘레 원). 목록을 지어내지 않습니다 — 매물이 등록된 시 · 구만 카카오로 한 번 찾아 넣습니다.';

/* ── ④ 외부 연동 표 (③ 의 FK 대상이라 먼저) ─────────────────────────── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('MAP', '지도 · 주소 좌표(카카오맵)', '매물 소재지 주소 → 좌표 · 지도 표시(카카오 지도 JS · 로컬 REST)',
        'Kakao', 'NOT_STARTED', false, 'KAKAO_REST_KEY', NULL, false,
        '키는 이 화면 아래 「카카오맵 키」에서 넣습니다(암호화 저장 · 다시 보이지 않음). 카카오 콘솔에서 「카카오맵」 사용 · 사이트 도메인 등록이 먼저입니다(docs/96 4절). 지도 사용은 처음에 꺼져 있습니다.',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 120))
ON CONFLICT (code) DO NOTHING;

/* ── ③ 카카오 키 (암호화) ──────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.integration_secrets (
  integration_code text NOT NULL REFERENCES public.integrations(code),
  name             text NOT NULL,
  value_enc        bytea NOT NULL,
  last4            text NOT NULL,
  is_public        boolean NOT NULL DEFAULT false,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_code, name),
  /* 이 표는 카카오 키 2개만 받습니다(2026-10-17 대표 결정). 다른 연동 키를 넣으려면 이 제약부터 바꾸는 결정이 필요합니다 */
  CONSTRAINT ck_integ_secret_name CHECK ((integration_code, name) IN (('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'))),
  CONSTRAINT ck_integ_secret_last4 CHECK (char_length(last4) <= 4)
);
COMMENT ON TABLE public.integration_secrets IS
  'v10.46 (docs/96) — 운영 화면에서 넣는 카카오 키. 값은 pgp_sym_encrypt(fn_enc_key()) 암호문만 — 열쇠(ENC_KEY)는 .env 에만 있어 DB 백업에는 암호문만 남습니다. 화면에는 끝 4자리만.';

/* 넣기 — 값 검사 · 암호화 · 끝 4자리 · 연동 표 「키 등록」 표시를 한 곳에서 */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_set(p_code text, p_name text, p_value text, p_actor uuid)
 RETURNS TABLE(o_name text, o_last4 text, o_updated_at timestamptz) LANGUAGE plpgsql AS $function$
/* 돌려주는 칸 이름에 o_ 를 붙입니다 — 표의 칸(name · last4 · updated_at)과 이름이 같으면 plpgsql 이 「모호함」으로 멈춥니다 */
DECLARE v text := btrim(coalesce(p_value, ''));
BEGIN
  IF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name = 'KAKAO_JS_KEY', p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name = 'KAKAO_REST_KEY' THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;

/* 꺼내기 — 서버(geo.service)만 부릅니다. 없으면 NULL(그때 서버가 .env 값을 씁니다) */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_get(p_code text, p_name text)
 RETURNS text LANGUAGE sql STABLE AS $function$
  SELECT pgp_sym_decrypt(s.value_enc, public.fn_enc_key())
    FROM public.integration_secrets s WHERE s.integration_code = p_code AND s.name = p_name
$function$;

/* ── ⑤ 지도 사용 스위치 — 처음 off ─────────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('map.enabled', 'off', 'GLOBAL',
        '카카오 지도 사용(v10.46 · docs/96). off 이면 지도를 그리지 않고 좌표도 구하지 않습니다 — 화면은 지도 연동 전과 같습니다. 운영 화면 › 외부 연동 › 카카오맵 키에서 키를 넣고 「시험 호출」이 성공한 뒤 on 으로 바꾸십시오.',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

/* ── ⑥ 좌표 채우기 배치 ────────────────────────────────────────────── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('geo_backfill', 10, NULL, NULL, NULL, true,
        'v10.46 (docs/96) — 좌표가 없거나(PENDING) 실패한(FAILED · 3회 미만) 매물을 50건씩 카카오로 다시 찾습니다. 지도 사용(map.enabled)이 off 이거나 키가 없으면 아무것도 하지 않습니다.')
ON CONFLICT (job) DO NOTHING;

/* ── ⑦ 유출 검사 ──────────────────────────────────────────────────── */
-- 공개 보기(v_*)가 listing_geo 를 읽으면 줄이 나옵니다 → 통합 검정 실패
CREATE OR REPLACE VIEW public.v_geo_exact_leak AS
 SELECT DISTINCT u.view_name::text AS view_name
   FROM information_schema.view_table_usage u
  WHERE u.view_schema = 'public' AND u.table_name = 'listing_geo' AND u.view_name::text LIKE 'v\_%';

-- 어떤 보기도 integration_secrets 를 읽으면 안 됩니다
CREATE OR REPLACE VIEW public.v_secret_leak AS
 SELECT DISTINCT u.view_name::text AS view_name
   FROM information_schema.view_table_usage u
  WHERE u.view_schema = 'public' AND u.table_name = 'integration_secrets';

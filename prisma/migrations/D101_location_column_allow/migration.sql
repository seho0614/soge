-- =====================================================================
-- D101 — v10.47 (2026-10-19 · 위치기반 약관 폐기 판단 다시 함 · 대표 결정 A안)
--
--   2026-09-18 폐기 판단(legal.location_waived) 의 근거는 「좌표 컬럼 0개」였고, 검정 BR-05 · BZ-03 · open-check 가
--   좌표 컬럼이 생기면 잡도록 되어 있습니다. v10.46 · v10.47 이 좌표 8칸을 만들어 realcheck 에서 걸렸습니다(2026-10-19).
--
--   다시 한 판단(대표 2026-10-19 「A 안」 · decisions/map-kakao #12) — 폐기 유지
--     · 이용자 단말기(휴대폰) 위치는 서버로 받지도 저장하지도 않습니다(「현재 위치로」는 브라우저 안 · 설정 처음 off)
--     · 저장하는 좌표는 **움직이지 않는 장소의 주소를 바꾼 값**뿐입니다 — 매물 주소 · 시 · 구 중심 · 가게
--     · 「내 주변」(단말기 위치를 서버로)은 위치기반서비스사업 신고 뒤(map-kakao #10)
--     ★ 법률 확인 필요 — 확인 결과가 다르면 legal.location_waived 를 off 로 하고 약관 · 신고 절차를 밟습니다
--
--   ① location_column_allow  — 판단을 거친 좌표 칸 목록(사유 · 결정일). 여기 없는 좌표 칸이 생기면 지금처럼 다시 잡힙니다
--   ② v_location_columns · v_location_waiver_broken — 목록에 있는 칸은 빼고 셉니다(나머지 조건은 B080 그대로)
--   ③ legal.location_waived_note — 근거 문구를 새 판단으로
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================

/* ── ① 판단을 거친 좌표 칸 ─────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.location_column_allow (
  table_name  text NOT NULL,
  column_name text NOT NULL,
  reason      text NOT NULL,
  decided_at  date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_location_column_allow PRIMARY KEY (table_name, column_name),
  CONSTRAINT ck_location_column_allow_reason CHECK (length(btrim(reason)) >= 10)
);
COMMENT ON TABLE public.location_column_allow IS
  'v10.47 (D101) — 위치기반 약관 폐기 판단을 거친 좌표 칸. 이용자 단말기 위치가 아닌 「고정된 장소의 주소 → 좌표」만 올립니다. 여기 없는 좌표 칸은 BR-05 · BZ-03 · open-check 가 잡습니다. 줄을 더할 때는 대표 결정과 decisions/map-kakao 기록이 먼저입니다.';

INSERT INTO public.location_column_allow (table_name, column_name, reason, decided_at) VALUES
  ('listing_geo',   'lat', '매물 주소(도로명 · 지번)를 바꾼 좌표 — 남에게는 시 · 구 중심만 공개(v10.46 · D099)', DATE '2026-10-19'),
  ('listing_geo',   'lng', '매물 주소(도로명 · 지번)를 바꾼 좌표 — 남에게는 시 · 구 중심만 공개(v10.46 · D099)', DATE '2026-10-19'),
  ('geo_region',    'lat', '시 · 구 중심 좌표 — 사람 위치 아님(v10.46 · D099)', DATE '2026-10-19'),
  ('geo_region',    'lng', '시 · 구 중심 좌표 — 사람 위치 아님(v10.46 · D099)', DATE '2026-10-19'),
  ('town_places',   'lat', '공개된 영업장(식당 · 카페) 좌표 — 카카오 장소(v10.47 · D100)', DATE '2026-10-19'),
  ('town_places',   'lng', '공개된 영업장(식당 · 카페) 좌표 — 카카오 장소(v10.47 · D100)', DATE '2026-10-19'),
  ('v_town_places', 'lat', 'town_places 의 공개 보기(v10.47 · D100)', DATE '2026-10-19'),
  ('v_town_places', 'lng', 'town_places 의 공개 보기(v10.47 · D100)', DATE '2026-10-19')
ON CONFLICT (table_name, column_name) DO NOTHING;

/* ── ② 검정 보기 — 목록에 있는 칸만 뺍니다 ─────────────────────────── */
CREATE OR REPLACE VIEW public.v_location_columns AS
 SELECT c.table_name, c.column_name, c.data_type
   FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND (c.column_name ~* '^(lat|lng|lon|latitude|longitude|geohash)$'
         OR c.column_name ~* '_(lat|lng|lon|latitude|longitude)$'
         OR c.data_type IN ('point', 'geography', 'geometry'))
    AND NOT EXISTS (SELECT 1 FROM public.location_column_allow a
                     WHERE a.table_name = c.table_name AND a.column_name = c.column_name);

CREATE OR REPLACE VIEW public.v_location_waiver_broken AS
 SELECT c.table_name, c.column_name,
        '좌표 컬럼이 생겼습니다 — 위치기반 약관 폐기 판단을 다시 하십시오'::text AS note
   FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.column_name ~* '^(lat|lng|lon|longitude|latitude|geo_?(lat|lng|point))$'
    AND (SELECT s.value FROM public.site_settings s WHERE s.key = 'legal.location_waived') = 'on'
    AND NOT EXISTS (SELECT 1 FROM public.location_column_allow a
                     WHERE a.table_name = c.table_name AND a.column_name = c.column_name);

COMMENT ON VIEW public.v_location_columns IS
  '좌표 컬럼(판단을 거친 location_column_allow 제외). **0이어야 위치기반서비스가 아닙니다** — 하나라도 생기면 방통위 신고 대상이 될 수 있으니 법무에 확인하십시오.';
COMMENT ON VIEW public.v_location_waiver_broken IS
  '폐기 판단이 깨진 곳(location_column_allow 제외). **0이어야 합니다** — 단말기 위치를 담기 시작하면 위치정보법 대상이 되어 신고와 약관이 다시 필요합니다.';

/* ── ③ 폐기 근거 문구 ──────────────────────────────────────────────── */
UPDATE public.site_settings
   SET value = '단말기 위치 미수집 · 주소 직접 입력 · 좌표는 매물 · 가게 주소를 바꾼 값만(location_column_allow · 2026-10-19 재판단)',
       updated_at = now()
 WHERE key = 'legal.location_waived_note'
   AND value IS DISTINCT FROM '단말기 위치 미수집 · 주소 직접 입력 · 좌표는 매물 · 가게 주소를 바꾼 값만(location_column_allow · 2026-10-19 재판단)';

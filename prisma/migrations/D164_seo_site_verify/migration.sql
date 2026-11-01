-- =====================================================================
-- D164 · 검색 사이트 소유 확인 값 (v10.175 · 2026-11-02 · sgb-core docs/270)
--   대표 「다음 개발」 → 「모두」(11/2) · v10.174 sitemap 을 네이버 · 구글에 등록하려면 소유 확인이 먼저
--   ① seo.verify_google — 구글 서치 콘솔 「HTML 태그」 방식의 content 값
--   ② seo.verify_naver  — 네이버 서치어드바이저 「HTML 태그」 방식의 content 값
--   빈 값이면 태그를 넣지 않음 · 사용자 웹 머리(<head>)에 실림 → 공개 범위(GLOBAL) · 지우는 문장 없음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('seo.verify_google', '', 'GLOBAL',
   '구글 서치 콘솔 소유 확인(HTML 태그 방식)의 content 값(v10.175 · docs/270) — 빈 값이면 태그를 넣지 않음. 확인이 끝나도 지우지 마십시오(지우면 소유 확인이 풀림).',
   false, '^[A-Za-z0-9_-]{0,100}$', 'AbCdEf0123456789_xyz-AbCdEf0123456789'),
  ('seo.verify_naver', '', 'GLOBAL',
   '네이버 서치어드바이저 소유 확인(HTML 태그 방식)의 content 값(v10.175 · docs/270) — 빈 값이면 태그를 넣지 않음. 확인이 끝나도 지우지 마십시오.',
   false, '^[A-Za-z0-9_-]{0,100}$', '0123456789abcdef0123456789abcdef01234567')
ON CONFLICT (key) DO NOTHING;

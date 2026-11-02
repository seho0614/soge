-- =====================================================================
-- D165 · API 전체 요청 한도 (v10.176 · 2026-11-02 · sgb-core docs/273)
--   대표 「다음 개발」 → 「모두」(11/2) · 사용자 웹 전체 공개(domain-dns #11) 뒤 서버 1대 보호
--   ① 설정 abuse.api_per_ip_min(기본 600 · 0 = 끔) — IP 하나가 1분에 이 수를 넘게 API 를 부르면 429 API_RATE_LIMIT
--      내부 IP · 로그인한 운영자는 세지 않음 · 사용자 웹 화면(서버 렌더링)이 부르는 API 도 접속자 IP 로 셈
--   운영 전용(ADMIN 범위 — 공개 설정에 안 나감) · 지우는 문장 없음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('abuse.api_per_ip_min', '600', 'ADMIN',
   'IP 하나가 1분에 이 수를 넘게 API 를 부르면 429 「요청이 너무 많습니다」(v10.176 · docs/273) — 내부 IP · 로그인한 운영자는 세지 않음 · 0 이면 끔 · 바꾸면 1분 안에 반영.',
   false, '^[0-9]{1,5}$', '600')
ON CONFLICT (key) DO NOTHING;

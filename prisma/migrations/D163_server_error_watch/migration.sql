-- =====================================================================
-- D163 · 서버 오류 몰림 알림 (v10.174 · 2026-11-01 · sgb-core docs/268)
--   대표 「다음」 → 「모두」(11/1) · 사용자 웹 전체 공개(domain-dns #11) 뒤 지켜보기 보강
--   ① 설정 ops.server_error_per_10min(기본 20 · 0 = 끔) — 지난 10분 API 서버 오류(5xx)가 이 수 이상이면
--      운영 알림 SERVER_ERROR_SPIKE(10분 작업 launch_watch 가 봄 · 1시간에 한 번 · 많이 난 주소 5개)
--   운영 전용(ADMIN 범위 — 공개 설정에 안 나감) · 지우는 문장 없음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.server_error_per_10min', '20', 'ADMIN',
   '지난 10분 API 서버 오류(5xx)가 이 수 이상이면 운영 알림 SERVER_ERROR_SPIKE(v10.174 · docs/268) — 1시간에 한 번 · 0 이면 알리지 않음.',
   false, '^[0-9]{1,5}$', '20')
ON CONFLICT (key) DO NOTHING;

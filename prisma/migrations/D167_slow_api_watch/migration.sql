-- =====================================================================
-- D167 · 느린 응답 지켜보기 (v10.178 · 2026-11-02 · sgb-core docs/277)
--   대표 「다음개발」 → 「모두」(11/2) · 서버 1대(t3)에 손님이 늘 때 느려지는 것을 먼저 알기
--   ① 설정 ops.slow_p95_ms(기본 1500 · 0 = 끔) — 정기 작업 launch_watch(10분)가 지난 10분 API 응답의
--      느린 쪽 5% 기준 시간(p95)이 이 값(ms) 이상이고 요청이 50건 이상이면 운영 알림 SLOW_API(1시간에 한 번)
--   운영 전용(ADMIN 범위 — 공개 설정에 안 나감) · 지우는 문장 없음 · 재실행 안전
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.slow_p95_ms', '1500', 'ADMIN',
   '지난 10분 API 응답의 느린 쪽 5% 기준 시간(p95 · ms)이 이 값 이상이고 요청이 50건 이상이면 운영 알림 SLOW_API(v10.178 · docs/277) — 1시간에 한 번 · 0 이면 알리지 않음.',
   false, '^[0-9]{1,5}$', '1500')
ON CONFLICT (key) DO NOTHING;

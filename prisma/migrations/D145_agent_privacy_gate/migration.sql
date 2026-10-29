-- =====================================================================
-- D145 · AI 켜기 전 처리방침 확인 (v10.151 · 2026-10-29 · sgb-core docs/231)
--   대표 「서버에서 결정 관리자결정」(10/29) — 리허설(docs/228 발견 1): AI 전체가 처리방침 AI 고지(1.1) 게시 전에도 켜졌음
--   site_settings agent.require_privacy — on(처음 값)이면 서버가 AI 전체(agent.enabled) 켜기를
--   「개인정보처리방침 1.1 이상 게시」 전에는 거절(PRIVACY_FIRST) · off 면 지금처럼 경고만(안내판 ⚠)
--   바꾸기는 SUPER(agent.* 는 AI 설정 — v10.129) · 이미 켜진 AI 는 끄지 않음
--   재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음
-- =====================================================================

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('agent.require_privacy', 'on', 'GLOBAL',
   'AI 켜기 전 처리방침 확인 — on 이면 개인정보처리방침 1.1 이상(AI 고지 · 국외 이전)이 게시되기 전에는 AI 전체(agent.enabled)를 켤 수 없음(서버가 거절). off 면 경고만. 최고 관리자가 운영 화면 › AI 에이전트 › AI 스위치에서 바꿈.',
   '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

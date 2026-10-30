-- =====================================================================
-- D146 · 오픈 날 사고 막는 서버 잠금 2개 (v10.153 · 2026-10-30 · sgb-core docs/233)
--   오픈 리허설(docs/228 4절) 발견 5 · 발견 2 — 순서표(사람)에만 기대던 것을 서버가 막음(대표 「진행」 10/30 · v10.151 처리방침 잠금과 같은 모양)
--   ① identity.require_check — on(처음 값)이면 본인인증을 NICE 로 바꾸기 전에 최근 7일 안 「NICE 키 확인」 성공(스텁 아님)이 있어야 함
--      (틀린 키로 바꾸면 모든 가입 · 본인인증이 IDENTITY_UNAVAILABLE 로 막힘) — 서버 IDENTITY_CHECK_FIRST
--   ② etax.require_config — on(처음 값)이면 전자세금계산서 간주(assume.etax)를 끄기 전에 업체 주소 · 키(ETAX_URL · ETAX_KEY)가 있어야 함
--      (없이 끄면 발행이 ETAX_NOT_CONFIGURED 로 멈춤) — 서버 ETAX_CONFIG_FIRST
--   ③ integration_tests 에 본인인증(PASS) · 「NICE 키 확인」(NICE_TOKEN) 종류를 더함 — 키 확인은 토큰만 받음(표준창 · 비용 없음)
--   바꾸기는 SUPER · 되돌리는 쪽(STUB · 간주 다시 켜기)은 언제나 됨 · 재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음
-- =====================================================================

ALTER TABLE public.integration_tests DROP CONSTRAINT IF EXISTS ck_integ_test_code;
ALTER TABLE public.integration_tests ADD CONSTRAINT ck_integ_test_code CHECK (integration_code IN ('PG', 'BANK', 'PASS'));
ALTER TABLE public.integration_tests DROP CONSTRAINT IF EXISTS ck_integ_test_kind;
ALTER TABLE public.integration_tests ADD CONSTRAINT ck_integ_test_kind CHECK (kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM', 'NICE_TOKEN'));

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('identity.require_check', 'on', 'GLOBAL',
   '본인인증 NICE 바꾸기 전 키 확인 — on 이면 최근 7일 안 「NICE 키 확인」이 성공해야 identity.provider 를 NICE 로 바꿀 수 있음(서버가 거절). off 면 키 3개만 봄. 최고 관리자가 운영 화면 › 외부 연동 › 본인인증에서 바꿈.',
   '^(on|off)$', 'on'),
  ('etax.require_config', 'on', 'GLOBAL',
   '전자세금계산서 간주 끄기 전 설정 확인 — on 이면 업체 주소 · 키(ETAX_URL · ETAX_KEY)가 있어야 assume.etax 를 끌 수 있음(서버가 거절). off 면 연동 상태만 봄. 최고 관리자가 운영 화면 › 오픈 체크리스트 › 관리자 스위치에서 바꿈.',
   '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.integration_tests IS '연결 시험 기록(D140 · D146) — PG · BANK 를 LIVE 로 바꾸는 근거 · 본인인증 NICE 로 바꾸는 근거(PASS · NICE_TOKEN) — 모두 최근 7일 · 스텁 아님. 키 · 계좌번호 · 코드 원문은 저장하지 않음.';

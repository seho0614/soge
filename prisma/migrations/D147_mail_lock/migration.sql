-- =====================================================================
-- D147 · 메일 켜기 전 시험 메일 확인 잠금 (v10.154 · 2026-10-30 · sgb-core docs/234)
--   오픈 리허설(docs/228 4절) 발견 4 — 보내는 주소 · SMTP 설정 없이(또는 도착 확인 없이) 메일 스위치를 켜면
--   회원 화면은 「메일을 보냈습니다」인데 메일이 안 나감(비밀번호 찾기 · 상담 신청). 순서표(사람)에만 기대던 것을 서버가 막음 — D146 과 같은 모양
--   ① notify.require_mail_test — on(처음 값)이면 notify.email_verified 를 켜기 전에
--      SMTP_USER · SMTP_PASS · 보내는 주소가 있고(MAIL_CONFIG_FIRST) 최근 7일 안 시험 메일이 성공해야 함(MAIL_TEST_FIRST)
--   ② integration_tests 에 메일(MAIL) · 시험 메일(MAIL_TEST) 종류를 더함 — 받는 주소는 가린 것만(앞 2글자 · 도메인)
--   바꾸기는 SUPER · 메일 끄기는 언제나 됨 · 재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음(이미 켜져 있으면 그대로)
-- =====================================================================

ALTER TABLE public.integration_tests DROP CONSTRAINT IF EXISTS ck_integ_test_code;
ALTER TABLE public.integration_tests ADD CONSTRAINT ck_integ_test_code CHECK (integration_code IN ('PG', 'BANK', 'PASS', 'MAIL'));
ALTER TABLE public.integration_tests DROP CONSTRAINT IF EXISTS ck_integ_test_kind;
ALTER TABLE public.integration_tests ADD CONSTRAINT ck_integ_test_kind CHECK (kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM', 'NICE_TOKEN', 'MAIL_TEST'));

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('notify.require_mail_test', 'on', 'GLOBAL',
   '메일 켜기 전 시험 메일 확인 — on 이면 SMTP_USER · SMTP_PASS · 보내는 주소가 있고 최근 7일 안 시험 메일이 성공해야 notify.email_verified 를 켤 수 있음(서버가 거절). off 면 그대로 켜짐. 최고 관리자가 운영 화면 › 외부 연동 › 메일에서 바꿈.',
   '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.integration_tests IS '연결 시험 기록(D140 · D146 · D147) — PG · BANK 를 LIVE 로 바꾸는 근거 · 본인인증 NICE 로 바꾸는 근거(PASS · NICE_TOKEN) · 메일 스위치를 켜는 근거(MAIL · MAIL_TEST) — 모두 최근 7일 · 스텁 아님. 키 · 계좌번호 · 코드 원문 · 받는 주소 원문은 저장하지 않음.';

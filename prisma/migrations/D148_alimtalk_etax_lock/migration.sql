-- =====================================================================
-- D148 · 알림톡 켜기 전 시험 발송 확인 · 세금계산서 간주 끄기 전 시험 발행 (v10.155 · 2026-10-30 · sgb-core docs/235)
--   오픈 날 순서표(docs/228 5절) 8번 · 6번에서 사람에게만 맡기던 「시험 성공 뒤 켜기 · 끄기」를 서버가 막음 — D146 · D147 과 같은 모양
--   ① alimtalk.require_test — on(처음 값)이면 notify.alimtalk_ready 를 켜기 전에 최근 7일 안 지금 방식(MOCK · HTTP)으로
--      성공한 시험 발송(alimtalk_sends purpose TEST · SENT)이 있어야 함 — 서버 ALIMTALK_TEST_FIRST
--   ② etax.require_config(D146) 가 on 이면 assume.etax 를 끄기 전에 ETAX_URL · ETAX_KEY(그대로) + 최근 7일 안
--      「세금계산서 키 확인」(ETAX_KEY — 운영 주소에 없는 문서 조회 · 발행 없음) · 「시험 발행」(ETAX_TEST_ISSUE — 업체 시험 주소
--      ETAX_TEST_URL 로 1건 · 국세청 승인번호 24자리) 둘 다 성공해야 함 — 서버 ETAX_TEST_FIRST
--   ③ integration_tests 에 세금계산서(ETAX) · 두 종류를 더함 · 시험 발행 하루 횟수 integ.etax_test_daily = 3
--   바꾸기는 SUPER · 되돌리는 쪽(알림톡 끄기 · 간주 다시 켜기)은 언제나 됨 · 재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음(설명만 고침)
-- =====================================================================

ALTER TABLE public.integration_tests DROP CONSTRAINT IF EXISTS ck_integ_test_code;
ALTER TABLE public.integration_tests ADD CONSTRAINT ck_integ_test_code CHECK (integration_code IN ('PG', 'BANK', 'PASS', 'MAIL', 'ETAX'));
ALTER TABLE public.integration_tests DROP CONSTRAINT IF EXISTS ck_integ_test_kind;
ALTER TABLE public.integration_tests ADD CONSTRAINT ck_integ_test_kind CHECK (kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM', 'NICE_TOKEN', 'MAIL_TEST', 'ETAX_KEY', 'ETAX_TEST_ISSUE'));

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('alimtalk.require_test', 'on', 'GLOBAL',
   '알림톡 켜기 전 시험 발송 확인 — on 이면 최근 7일 안 지금 방식으로 성공한 시험 발송이 있어야 notify.alimtalk_ready 를 켤 수 있음(서버가 거절). off 면 방식 · 키 · 승인 템플릿만 봄. 최고 관리자가 운영 화면 › 외부 연동 › 알림톡에서 바꿈.',
   '^(on|off)$', 'on'),
  ('integ.etax_test_daily', '3', 'GLOBAL', '운영 화면 「결제 · 계좌 연결 확인」 세금계산서 시험 발행 하루 횟수(v10.155 · 업체 시험 주소로만)', '^[0-9]{1,2}$', '3')
ON CONFLICT (key) DO NOTHING;

UPDATE public.site_settings
   SET description = '전자세금계산서 간주 끄기 전 확인 — on 이면 업체 주소 · 키(ETAX_URL · ETAX_KEY)가 있고 최근 7일 안 「세금계산서 키 확인」 · 「시험 발행」이 성공해야 assume.etax 를 끌 수 있음(서버가 거절 · v10.155). off 면 연동 상태만 봄. 최고 관리자가 운영 화면 › 오픈 체크리스트 › 관리자 스위치에서 바꿈.'
 WHERE key = 'etax.require_config';

COMMENT ON TABLE public.integration_tests IS '연결 시험 기록(D140 · D146 · D147 · D148) — PG · BANK 를 LIVE 로 바꾸는 근거 · 본인인증 NICE 로 바꾸는 근거(PASS · NICE_TOKEN) · 메일 스위치를 켜는 근거(MAIL · MAIL_TEST) · 세금계산서 간주를 끄는 근거(ETAX · ETAX_KEY · ETAX_TEST_ISSUE) — 모두 최근 7일 · 스텁 아님. 키 · 계좌번호 · 코드 원문 · 받는 주소 원문은 저장하지 않음.';

-- =====================================================================
-- D140 — v10.144 (2026-10-28 · 결제 · 계좌인증 연결 확인 · 설계 docs/218 · docs/220)
--
--   ① integration_tests — 운영 화면에서 한 연결 시험 기록(연동 · 종류 · 결과 · 스텁 여부 · 오류 종류 · 계좌 끝 4자리 · 누가 · 언제)
--      1원 시험의 코드는 해시로만(code_hash) · 30분 안에 확인 · 확인하면 pending 을 내림
--   ② 설정 integ.bank_test_daily = 3 — 1원 시험 하루 횟수(우리 돈 1원 + 업체 요금)
--   PG · BANK 를 LIVE 로 바꾸려면 최근 7일 안에 성공한(스텁 아닌) 시험이 있어야 함 — 검사는 코드(SiteService.updateIntegration)
--   재실행 안전 · 자료를 지우지 않음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.integration_tests (
  id bigserial PRIMARY KEY,
  integration_code text NOT NULL,
  kind text NOT NULL,
  ok boolean NOT NULL,
  stub boolean NOT NULL DEFAULT false,
  error_kind text,
  detail text,
  key_mode text,
  account_last4 text,
  code_hash text,
  tx_id text,
  pending boolean NOT NULL DEFAULT false,
  tries int NOT NULL DEFAULT 0,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_integ_test_code CHECK (integration_code IN ('PG', 'BANK')),
  CONSTRAINT ck_integ_test_kind CHECK (kind IN ('PG_KEY', 'BANK_SEND', 'BANK_CONFIRM')),
  CONSTRAINT ck_integ_test_key_mode CHECK (key_mode IS NULL OR key_mode IN ('test', 'live')),
  CONSTRAINT ck_integ_test_last4 CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{1,4}$')
);
CREATE INDEX IF NOT EXISTS idx_integ_tests_at ON public.integration_tests (integration_code, created_at DESC);

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('integ.bank_test_daily', '3', 'GLOBAL', '운영 화면 「결제 · 계좌 연결 확인」 1원 시험 하루 횟수(v10.144 · 우리 돈 1원 + 업체 요금)', '^[0-9]{1,2}$', '3')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.integration_tests IS '결제 · 계좌인증 연결 시험 기록(D140 · docs/220) — PG · BANK 를 LIVE 로 바꾸는 근거(최근 7일 · 스텁 아님). 키 · 계좌번호 · 코드 원문은 저장하지 않음.';

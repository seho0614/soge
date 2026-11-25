-- =====================================================================
-- E001 (e1.1 · docs/001) ERP 데이터베이스 sgb_erp 첫 마이그레이션 — 설정 표
--
--   erp_settings  ERP 자기 설정(acct.* · hr.* · hra.* · ofc.* · erp.* — E2 ~ 에서 소개뱅크 site_settings 에서 옮겨 옴)
--                 값 꼴(value_pattern)이 있으면 트리거가 넣을 때 · 고칠 때 확인 · 바꾼 사람(소개뱅크 계정 번호 · 외래 키 없음)
--   erp.jobs_owner  정기 작업 주인(SGB = 소개뱅크가 돌림 · ERP = ERP 가 돌림) — E7 에서 넘김 · 처음 SGB
--   다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.erp_settings (
  key            text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z0-9_.]{1,80}$'),
  value          text,
  scope          text NOT NULL DEFAULT 'SUPER' CHECK (scope IN ('SUPER', 'ADMIN')),
  description    text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  value_pattern  text CHECK (value_pattern IS NULL OR char_length(value_pattern) <= 200),
  value_example  text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);
COMMENT ON TABLE public.erp_settings IS 'e1.1 (E001) ERP 자기 설정 — 바꾼 사람은 소개뱅크 계정 번호(외래 키 없음 · 확인은 코드)';

CREATE OR REPLACE FUNCTION public.fn_erp_settings_pattern() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.value_pattern IS NOT NULL AND NEW.value IS NOT NULL AND NEW.value !~ NEW.value_pattern THEN
    RAISE EXCEPTION USING MESSAGE = 'ERP_SETTING_PATTERN: 값 꼴이 맞지 않습니다 — ' || NEW.key;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_erp_settings_pattern ON public.erp_settings;
CREATE TRIGGER trg_erp_settings_pattern BEFORE INSERT OR UPDATE ON public.erp_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_erp_settings_pattern();

INSERT INTO public.erp_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('erp.jobs_owner', 'SGB', 'SUPER', '정기 작업 주인(e1.1 · docs/001) — SGB 면 소개뱅크가 회계 · 인사 정기 작업을 돌림(지금) · ERP 면 ERP 가 돌림(E7 에서 넘김) · 같은 날 두 번 돌지 않게 한 곳만', '^(SGB|ERP)$', 'ERP')
ON CONFLICT (key) DO NOTHING;

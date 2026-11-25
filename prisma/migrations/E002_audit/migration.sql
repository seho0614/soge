-- =====================================================================
-- E002 (e1.2 · docs/002) ERP 감사 기록 — 누가(소개뱅크 계정 번호) · 무엇을 · 언제 · 어디서
--   쌓기만(고치기 · 지우기를 트리거가 막음) · 계정 번호는 외래 키 없음(소개뱅크 DB 에 있음 · 확인은 introspect)
--   다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.erp_audit (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL,
  action      text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  target      text CHECK (target IS NULL OR char_length(target) <= 120),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text CHECK (ip IS NULL OR char_length(ip) <= 64),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS erp_audit_at ON public.erp_audit (at DESC);
CREATE INDEX IF NOT EXISTS erp_audit_account ON public.erp_audit (account_id, at DESC);
COMMENT ON TABLE public.erp_audit IS 'e1.2 (E002) ERP 감사 기록 — 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_erp_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'ERP_AUDIT_APPEND_ONLY: ERP 감사 기록은 고치거나 지울 수 없습니다';
END $fn$;
DROP TRIGGER IF EXISTS trg_erp_audit_append_only ON public.erp_audit;
CREATE TRIGGER trg_erp_audit_append_only BEFORE UPDATE OR DELETE ON public.erp_audit
  FOR EACH ROW EXECUTE FUNCTION public.fn_erp_audit_append_only();

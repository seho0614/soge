-- =====================================================================
-- D214 (v10.287 · docs/413) — 사이트 설정 바뀐 기록(전 · 후)
--
--   대표 승인(11/14 「백오피스 기능」 A): 운영 화면 정책 › 「전체 설정」 + 설정마다 바뀐 기록.
--   ① site_setting_changes — 설정 값이 바뀔 때마다 한 줄(DB 트리거 · 화면 · 서버 스크립트 · psql 모두 잡힘)
--      비밀 값(…secret · …token · …password · …api_key · 수금 계좌)은 가린 값만 남김(서버 화면과 같은 가림)
--      사유는 거래 설정 app.setting_reason(PATCH /admin/site-settings 의 reason)
--   ② 쌓기만 — 고치기 · 지우기 막음(fn_append_only_guard · APND)
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.site_setting_changes (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  before_val  text,
  after_val   text,
  secret      boolean NOT NULL DEFAULT false,
  changed_by  uuid,
  via         text NOT NULL DEFAULT 'APP' CHECK (via IN ('APP', 'DB')),
  db_user     text,
  reason      text,
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_site_setting_changes_key ON public.site_setting_changes (key, at DESC);
CREATE INDEX IF NOT EXISTS ix_site_setting_changes_at ON public.site_setting_changes (at DESC);
COMMENT ON TABLE public.site_setting_changes IS 'v10.287 (D214) 사이트 설정 바뀐 기록(전 · 후 · 누가 · 사유) — 비밀 값은 가린 값만 · 쌓기만';

/* 비밀 값 판단 · 가림 — AdminService.isSecretKey · mask 와 같은 규칙 */
CREATE OR REPLACE FUNCTION public.fn_setting_is_secret(p_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE AS $$
  SELECT p_key = 'company.bank_account' OR p_key ~ '(^|[._])(secret|token|password|api_key)$';
$$;

CREATE OR REPLACE FUNCTION public.fn_setting_mask(p_key text, p_val text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n int; seen int := 0; out text := ''; ch text; i int;
BEGIN
  IF p_val IS NULL OR p_val = '' THEN RETURN p_val; END IF;
  IF NOT public.fn_setting_is_secret(p_key) THEN RETURN p_val; END IF;
  IF p_key = 'company.bank_account' THEN
    n := length(regexp_replace(p_val, '\D', '', 'g'));
    FOR i IN 1..length(p_val) LOOP
      ch := substr(p_val, i, 1);
      IF ch ~ '\d' THEN
        seen := seen + 1;
        out := out || CASE WHEN seen > n - 4 THEN ch ELSE '*' END;
      ELSE
        out := out || ch;
      END IF;
    END LOOP;
    RETURN out;
  END IF;
  IF length(p_val) <= 6 THEN RETURN '******'; END IF;
  RETURN left(p_val, 3) || repeat('*', least(length(p_val) - 6, 12)) || right(p_val, 3);
END $$;

CREATE OR REPLACE FUNCTION public.fn_setting_history() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_by uuid;
BEGIN
  IF NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    v_by := NEW.updated_by;
  END IF;
  INSERT INTO public.site_setting_changes (key, before_val, after_val, secret, changed_by, via, db_user, reason)
  VALUES (NEW.key, public.fn_setting_mask(NEW.key, OLD.value), public.fn_setting_mask(NEW.key, NEW.value),
          public.fn_setting_is_secret(NEW.key), v_by,
          CASE WHEN v_by IS NULL THEN 'DB' ELSE 'APP' END, current_user,
          nullif(current_setting('app.setting_reason', true), ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_setting_history ON public.site_settings;
CREATE TRIGGER trg_setting_history AFTER UPDATE OF value ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_setting_history();

DROP TRIGGER IF EXISTS trg_site_setting_changes_ro ON public.site_setting_changes;
CREATE TRIGGER trg_site_setting_changes_ro BEFORE UPDATE OR DELETE ON public.site_setting_changes
  FOR EACH ROW EXECUTE FUNCTION public.fn_append_only_guard();

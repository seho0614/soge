-- =====================================================================
-- D174 (v10.195 · docs/306) — 중요 설정이 바뀌면 운영 알림
--
--   11/5 13:24 소개몰 「주문 받기」(mall.order_open)가 운영 화면에서 켜졌는데 4시간 넘게 아무도 몰랐음
--   (postcheck 로 처음 앎 · 주문 0건). 바뀌는 순간 운영 알림(ops_alerts · SETTING_CHANGED · WARN)을 남김.
--
--   대상 — mall.order_open · signup.open · admin.mfa_required · assume.* · feature.*
--   내용 — 무엇을 · 전 값 → 새 값 · 누가(updated_by · 운영 화면이 아닌 곳에서 바꿔 updated_at 이 그대로면 「직접 DB」) · 사유(app.setting_reason)
--   바꿀 때만(UPDATE) — 새 설정 줄을 넣는 마이그레이션은 알림을 만들지 않음
--   WARN 인 까닭 — CRITICAL 은 확인 전까지 배포 점검(deploy-check.sh)이 적용을 막음
--
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_setting_watch() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_old text := OLD.value;
  v_by  uuid;
BEGIN
  IF NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.key IN ('mall.order_open', 'signup.open', 'admin.mfa_required')
          OR NEW.key LIKE 'assume.%' OR NEW.key LIKE 'feature.%') THEN
    RETURN NEW;
  END IF;
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    v_by := NEW.updated_by;
  END IF;
  INSERT INTO public.ops_alerts (alert_code, severity, title, detail)
  VALUES ('SETTING_CHANGED', 'WARN',
          format('중요 설정 바뀜 — %s: %s → %s', NEW.key, coalesce(nullif(v_old, ''), '(빈 값)'), coalesce(nullif(NEW.value, ''), '(빈 값)')),
          jsonb_build_object('key', NEW.key, 'from', v_old, 'to', NEW.value,
                             'by', v_by, 'via', CASE WHEN v_by IS NULL THEN 'DB' ELSE 'APP' END,
                             'dbUser', current_user,
                             'reason', nullif(current_setting('app.setting_reason', true), '')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_setting_watch ON public.site_settings;
CREATE TRIGGER trg_setting_watch AFTER UPDATE OF value ON public.site_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_setting_watch();

COMMENT ON FUNCTION public.fn_setting_watch() IS '중요 설정(주문 받기 · 가입 · 2단계 인증 · 간주 · 기능 스위치)이 바뀌면 운영 알림 SETTING_CHANGED(WARN) — D174 · v10.195';

-- =====================================================================
-- D015 — 무료 요금제의 요청 열람 건수를 운영 설정과 한 값으로 (2026-10-02)
--
--   D011 · D013 으로 무료(BASIC) 회원과 구독 없는 일반 회원의 열람 건수는 운영 설정
--   request.view.free_monthly(기본 3)을 씁니다. 그런데 요금제 표(subscription_plans.request_views_per_month)의
--   BASIC 값은 5 로 남아 약관 초안 · 요금제 API · 시안 생성물이 「월 5건」으로 나왔습니다 — 같은 숫자가 두 곳에 있었습니다.
--
--   · 무료 요금제(monthly_price = 0)의 값을 설정값으로 맞추고,
--   · 운영이 설정을 바꾸면 같이 따라가게 합니다(트리거). 판정은 여전히 fn_request_view_limit 한 곳입니다.
--
--   재실행 안전.
-- =====================================================================
UPDATE public.subscription_plans
   SET request_views_per_month = fn_lead_setting_int('request.view.free_monthly', 3)
 WHERE monthly_price = 0
   AND request_views_per_month IS DISTINCT FROM fn_lead_setting_int('request.view.free_monthly', 3);

CREATE OR REPLACE FUNCTION public.fn_sync_free_plan_views() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key = 'request.view.free_monthly' AND NEW.value ~ '^[1-9][0-9]{0,3}$' THEN
    UPDATE public.subscription_plans SET request_views_per_month = NEW.value::int
     WHERE monthly_price = 0 AND request_views_per_month IS DISTINCT FROM NEW.value::int;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_free_plan_views ON public.site_settings;
CREATE TRIGGER trg_sync_free_plan_views AFTER INSERT OR UPDATE OF value ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_free_plan_views();

COMMENT ON COLUMN public.subscription_plans.request_views_per_month IS
  '월 요청 열람 건수(NULL = 무제한). 무료 요금제의 값은 운영 설정 request.view.free_monthly 를 따라갑니다(D015). 적용 여부는 request.view.limit · limit_from.';

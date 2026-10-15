-- =====================================================================
-- D013 — 요청 열람 한도: 무료 3건 · 홍보 기간 종료일 (2026-10-02 사장님 결정)
--
--   「최초 3개월간은 제한 없음(무료 회원만 있을 예정). 향후에는 관리자가 지정한다. 무료는 제한을 둘 예정 — 3회」
--
--   1. request.view.free_monthly 기본값 5 → **3** (운영이 이미 바꾼 값은 건드리지 않습니다 — 5 일 때만).
--   2. request.view.limit_from (새 설정) — 「홍보 기간 종료일」. 비워 두면 스위치(request.view.limit)만 봅니다.
--      날짜(YYYY-MM-DD)를 넣으면 **그날(한국 시간)부터 스위치가 off 여도 한도가 적용**됩니다.
--      오픈일 + 3개월을 넣어 두면 사람이 그날 켜는 것을 잊어도 됩니다. 운영이 언제든 바꾸거나 비울 수 있습니다.
--   3. fn_request_view_limit 가 위 둘을 반영합니다(판정은 여전히 이 함수 한 곳).
--
--   재실행 안전.
-- =====================================================================

UPDATE public.site_settings
   SET value = '3'
 WHERE key = 'request.view.free_monthly' AND value = '5';
UPDATE public.site_settings
   SET value_example = '3',
       description = '무료(BASIC) 회원과 구독 없는 일반 회원의 월 요청 열람 건수 — 둘에 똑같이 적용합니다(한도가 켜져 있을 때). 유료 요금제는 요금제 값을 씁니다.'
 WHERE key = 'request.view.free_monthly';
UPDATE public.site_settings
   SET description = '요청 상세 열람 한도. off = 홍보 기간(모든 회원 제한 없음) · on = 정식 서비스(한도 적용). off 여도 request.view.limit_from 날짜가 되면 적용됩니다.'
 WHERE key = 'request.view.limit';

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('request.view.limit_from', '', 'GLOBAL',
   '홍보 기간 종료일(선택, YYYY-MM-DD · 한국 시간). 이 날부터 요청 열람 한도가 자동으로 적용됩니다. 비우면 스위치(request.view.limit)만 봅니다.',
   '^$|^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$', '2027-01-01')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_request_view_limit(p_account uuid)
RETURNS TABLE (enabled boolean, basis text, lim int, used int)
LANGUAGE plpgsql STABLE AS $$
DECLARE s record; v_on boolean; v_from text;
BEGIN
  SELECT coalesce((SELECT value = 'on' FROM site_settings WHERE key = 'request.view.limit'), false) INTO v_on;
  IF NOT v_on THEN
    -- 홍보 기간 종료일이 지났으면 스위치가 꺼져 있어도 적용 (형식이 맞을 때만)
    SELECT value INTO v_from FROM site_settings WHERE key = 'request.view.limit_from';
    IF v_from ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
      BEGIN
        v_on := (now() AT TIME ZONE 'Asia/Seoul')::date >= v_from::date;
      EXCEPTION WHEN others THEN v_on := false;   -- 2월 30일 같은 없는 날짜
      END;
    END IF;
  END IF;

  SELECT sub.id, sub.request_views_used, p.monthly_price, p.request_views_per_month
    INTO s
    FROM subscriptions sub JOIN subscription_plans p ON p.code = sub.plan_code
   WHERE sub.account_id = p_account AND sub.status IN ('ACTIVE','PAST_DUE')
   LIMIT 1;

  IF s.id IS NOT NULL AND s.monthly_price > 0 THEN
    RETURN QUERY SELECT v_on, CASE WHEN v_on THEN 'PLAN' ELSE 'OFF' END,
                        s.request_views_per_month::int, s.request_views_used::int;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v_on, CASE WHEN v_on THEN 'FREE' ELSE 'OFF' END,
         fn_lead_setting_int('request.view.free_monthly', 3),
         (SELECT count(*)::int FROM request_views v
           WHERE v.viewer_account_id = p_account
             AND v.viewed_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'));
END $$;
COMMENT ON FUNCTION public.fn_request_view_limit(uuid) IS
  '회원의 요청 열람 한도 상태(D011 · D013). 무료 요금제와 구독 없는 회원은 같은 값(request.view.free_monthly, 기본 3). 스위치 on 또는 홍보 기간 종료일(request.view.limit_from) 이후면 적용.';

/* 화면이 「지금 한도가 적용 중인가」를 한 값으로 알 수 있게 — 공개 설정과 같은 판정 */
CREATE OR REPLACE FUNCTION public.fn_request_view_limit_on() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT enabled FROM fn_request_view_limit('00000000-0000-0000-0000-000000000000'::uuid)
$$;

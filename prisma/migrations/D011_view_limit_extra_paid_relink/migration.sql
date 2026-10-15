-- =====================================================================
-- D011 — 요청 열람 한도 스위치 · 유료 요금제 추가 소개코드 결제 · 재로그인 귀속
--        (2026-10-02 사장님 결정 3건)
--
--  1. 요청 열람 한도 — 「초기 홍보 기간은 제한 없음, 정식 서비스 때 제약. 관리자가 지정.
--                      무료(BASIC)와 일반 회원은 똑같이 적용하고 나중에 관리자가 바꿈」
--     · site_settings  request.view.limit        off(홍보 기간 — 모두 제한 없음) | on(정식 서비스)
--                      request.view.free_monthly  무료 요금제 · 구독 없는 일반 회원 공통 월 열람 건수
--     · 전에는 유효 구독이 있을 때만 세어, 소개코드를 받아 무료 BASIC 이 생긴 회원만 월 5건으로 묶였습니다.
--       이제 무료 요금제와 구독 없는 회원은 **같은 값**(위 설정)을 쓰고, 유료 요금제는 요금제 값을 씁니다.
--     · 운영 BO 「사이트 설정」에서 바꿉니다(기존 PATCH /admin/site-settings · 형식 검사 value_pattern).
--
--  2. 추가 소개코드 — 「유료 요금제(STANDARD · PRO)도 적용」
--     · 전에는 무료 요금제만 결제 후 발급이고 유료 요금제의 초과분은 청구처 없이 기록만 됐습니다.
--       이제 **모든 요금제**에서 초과분은 결제된 것만 들어갑니다(단가 0원이면 초과 개념 없음).
--
--  3. 귀속 — 「예전에 로그인했던 브라우저에서 로그아웃 상태로 소개 링크를 열고 다시 로그인하면 소개자가 빠짐 → 반영」
--     · visitor_identities 는 (방문자 키, 계정) 당 1행이라 다시 로그인해도 연결 시각이 옛날 그대로였고,
--       판정(fn_attribution_resolve)은 「유입 이후에 연결된 계정」만 봅니다.
--     · 유일 제약을 풀어 **유입 뒤의 로그인마다 연결을 한 줄 더** 남깁니다(추가만 — 고치거나 지우지 않음).
--       판정 함수는 그대로입니다. 쌓이는 양은 「유입 → 로그인」 1회당 1행입니다(엔진이 유입이 있을 때만 넣음).
--
--  재실행 안전.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 요청 열람 한도
-- ---------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('request.view.limit', 'off', 'GLOBAL',
   '요청 상세 열람 한도. off = 홍보 기간(모든 회원 제한 없음) · on = 정식 서비스(한도 적용). 운영이 바꿉니다.',
   '^(on|off)$', 'off'),
  ('request.view.free_monthly', '5', 'GLOBAL',
   '무료(BASIC) 회원과 구독 없는 일반 회원의 월 요청 열람 건수 — 둘에 똑같이 적용합니다(request.view.limit=on 일 때). 유료 요금제는 요금제 값을 씁니다.',
   '^[1-9][0-9]{0,3}$', '5')
ON CONFLICT (key) DO NOTHING;

/* 한 회원의 열람 한도 상태. 화면 안내와 트리거가 같은 함수를 씁니다(규칙이 두 곳에 있으면 어긋납니다).
 *   basis  OFF   한도 꺼짐(홍보 기간)
 *          FREE  무료 요금제 · 구독 없음 — request.view.free_monthly, 이번 달(한국 시간) 본 요청 수
 *          PLAN  유료 요금제 — 요금제 값(NULL = 무제한), 구독 기간의 사용량 */
CREATE OR REPLACE FUNCTION public.fn_request_view_limit(p_account uuid)
RETURNS TABLE (enabled boolean, basis text, lim int, used int)
LANGUAGE plpgsql STABLE AS $$
DECLARE s record; v_on boolean;
BEGIN
  SELECT coalesce((SELECT value = 'on' FROM site_settings WHERE key = 'request.view.limit'), false) INTO v_on;
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
         fn_lead_setting_int('request.view.free_monthly', 5),
         (SELECT count(*)::int FROM request_views v
           WHERE v.viewer_account_id = p_account
             AND v.viewed_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'));
END $$;
COMMENT ON FUNCTION public.fn_request_view_limit(uuid) IS
  '회원의 요청 열람 한도 상태(D011). 무료 요금제와 구독 없는 회원은 같은 값(request.view.free_monthly)을 씁니다.';

CREATE OR REPLACE FUNCTION public.fn_assert_view_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM fn_request_view_limit(NEW.viewer_account_id);
  IF q.enabled AND q.lim IS NOT NULL AND q.used >= q.lim THEN
    RAISE EXCEPTION 'view quota exceeded: 이번 달 요청 열람 한도(%건)를 모두 쓰셨습니다. %',
      q.lim,
      CASE WHEN q.basis = 'FREE' THEN '다음 달 1일에 다시 열립니다 — 유료 요금제는 더 많이 볼 수 있습니다.'
           ELSE '다음 결제일에 다시 열립니다 — 상위 요금제는 더 많이 볼 수 있습니다.' END;
  END IF;
  /* 구독 사용량은 한도가 꺼져 있어도 셉니다 — 구독 당일 환불 규칙(BL-02)이 이 값을 봅니다 */
  IF NEW.subscription_id IS NOT NULL THEN
    UPDATE subscriptions SET request_views_used = request_views_used + 1
     WHERE id = NEW.subscription_id;
  END IF;
  RETURN NEW;
END $$;

CREATE INDEX IF NOT EXISTS idx_request_views_viewer_month
  ON public.request_views (viewer_account_id, viewed_at);

-- ---------------------------------------------------------------------
-- 2. 추가 소개코드는 모든 요금제에서 결제된 것만
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_refcode_extra_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_price numeric; p record; v_used int;
BEGIN
  SELECT sp.extra_code_price INTO v_price
    FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.code = s.plan_code
   WHERE s.id = NEW.subscription_id;

  IF NEW.extra_payment_key IS NULL THEN
    IF NEW.is_extra AND coalesce(v_price, 0) > 0 THEN
      RAISE EXCEPTION 'REFCODE: 추가 소개코드는 결제 후에만 발급됩니다 (건당 %원)', v_price;
    END IF;
    RETURN NEW;
  END IF;

  -- 결제키가 붙은 코드 — 그 결제와 맞아야 합니다
  SELECT * INTO p FROM public.referral_code_payments WHERE payment_key = NEW.extra_payment_key;
  IF p IS NULL THEN
    RAISE EXCEPTION 'REFCODE: 없는 결제키입니다';
  END IF;
  IF p.account_id <> NEW.owner_account_id OR p.subscription_id <> NEW.subscription_id THEN
    RAISE EXCEPTION 'REFCODE: 다른 계정의 결제로 소개코드를 받을 수 없습니다';
  END IF;
  IF NEW.extra_amount <> p.unit_price THEN
    RAISE EXCEPTION 'REFCODE: 결제 단가와 코드 금액이 다릅니다 (% ≠ %)', NEW.extra_amount, p.unit_price;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rcp:' || NEW.extra_payment_key, 0));
  SELECT count(*) INTO v_used FROM public.referral_codes WHERE extra_payment_key = NEW.extra_payment_key;
  IF v_used >= p.code_count THEN
    RAISE EXCEPTION 'REFCODE: 이 결제로 받을 수 있는 소개코드(%건)를 이미 모두 받았습니다', p.code_count;
  END IF;
  RETURN NEW;
END $$;

-- 감시 뷰: 이 마이그레이션 뒤에 결제 없이 들어간 추가 코드. **0이어야 정상**.
CREATE OR REPLACE VIEW public.v_refcode_extra_unpaid AS
SELECT rc.id, rc.code, rc.owner_account_id, s.plan_code, rc.issued_at
  FROM referral_codes rc
  JOIN subscriptions s ON s.id = rc.subscription_id
  JOIN subscription_plans p ON p.code = s.plan_code
 WHERE rc.is_extra AND p.extra_code_price > 0 AND rc.extra_payment_key IS NULL
   AND rc.issued_at > (SELECT coalesce(min(applied_at), now()) FROM schema_migrations
                        WHERE name = 'D011_view_limit_extra_paid_relink');
COMMENT ON VIEW public.v_refcode_extra_unpaid IS
  '결제 없이 발급된 추가 소개코드(D011 이후). **0이어야 정상** — 그 전의 유료 요금제 초과분은 청구 전 기록으로 남아 있습니다.';

-- ---------------------------------------------------------------------
-- 3. 재로그인 귀속 — 유입 뒤의 로그인마다 연결 1행
-- ---------------------------------------------------------------------
ALTER TABLE public.visitor_identities DROP CONSTRAINT IF EXISTS visitor_identities_visitor_key_account_id_key;
CREATE INDEX IF NOT EXISTS idx_vi_pair_time ON public.visitor_identities (visitor_key, account_id, linked_at DESC);
COMMENT ON TABLE public.visitor_identities IS
  '방문자 키 ↔ 계정 연결(추가만). 같은 짝이 여러 줄일 수 있습니다 — 유입 뒤에 다시 로그인하면 한 줄 더 남깁니다(D011).';

-- =====================================================================
-- D179 (v10.201 · docs/318) — 운영자 낯선 로그인 알림 · 하루 요약 텔레그램
--
--   11/6 운영에서 「주문 받기」를 누가 켰는지 잡지 못함 · 운영자 2단계 인증은 꺼진 채(admin.mfa_required off).
--   운영 메일이 준비되지 않아(NO_SMTP) 하루 요약이 매일 만들어져도 아무에게도 가지 않음.
--
--   ① 설정 ops.staff_login_alert(on) · ops.telegram_digest(on)
--   ② fn_staff_login_watch — login_history 에 운영 역할(SUPER · ADMIN · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF) 계정의
--      성공 로그인이 들어오면, 지난 30일 그 계정 성공 로그인에 없던 IP 대역(앞 두 마디) 또는 브라우저 종류이거나
--      30일 안 기록이 없으면 운영 알림 STAFF_LOGIN_NEW(WARN). IP 는 login_history 처럼 앞 두 마디만 · 이메일은 앞 두 글자만.
--      알림을 남기지 못해도 로그인은 그대로(예외는 삼킴).
--   ③ fn_ops_alert_mail_pending · fn_ops_alert_push_pending — 급한 알림 대상에 STAFF_LOGIN_NEW 더함(나머지는 D177 · D178 그대로)
--
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 설정 -------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.staff_login_alert', 'on', 'ADMIN',
   '운영자 낯선 로그인 알림(v10.201 · docs/318) — on 이면 운영 역할 계정이 지난 30일에 없던 IP 대역(앞 두 마디) · 브라우저로 로그인할 때 운영 알림 STAFF_LOGIN_NEW(급한 알림 메일 · 텔레그램 대상). off 면 남기지 않음.',
   false, '^(on|off)$', 'on'),
  ('ops.telegram_digest', 'on', 'ADMIN',
   '운영 하루 요약을 텔레그램으로도(v10.201 · docs/318) — on 이면 매일 하루 요약을 급한 알림과 같은 대화방(ops.telegram_chat)으로 한 통. 대화방 · 봇 토큰이 없으면 보내지 않음.',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

-- ② 운영자 낯선 로그인 --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_staff_login_watch() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_roles text;
  v_email text;
  v_prior int;
  v_new_ip boolean;
  v_new_ua boolean;
  v_why text;
BEGIN
  IF NOT NEW.ok THEN RETURN NEW; END IF;
  BEGIN
    IF coalesce((SELECT value FROM public.site_settings WHERE key = 'ops.staff_login_alert'), 'on') <> 'on' THEN RETURN NEW; END IF;
    SELECT string_agg(r.role, '·' ORDER BY r.role) INTO v_roles
      FROM public.account_roles r
     WHERE r.account_id = NEW.account_id AND r.role IN ('SUPER', 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF');
    IF v_roles IS NULL THEN RETURN NEW; END IF;

    SELECT count(*)::int,
           NEW.ip_masked IS NOT NULL AND NOT bool_or(h.ip_masked IS NOT DISTINCT FROM NEW.ip_masked),
           NEW.ua_kind IS NOT NULL AND NOT bool_or(h.ua_kind IS NOT DISTINCT FROM NEW.ua_kind)
      INTO v_prior, v_new_ip, v_new_ua
      FROM public.login_history h
     WHERE h.account_id = NEW.account_id AND h.ok AND h.id <> NEW.id AND h.at > now() - interval '30 days';

    v_why := CASE WHEN v_prior = 0 THEN 'FIRST'
                  WHEN v_new_ip AND v_new_ua THEN 'NEW_IP_UA'
                  WHEN v_new_ip THEN 'NEW_IP'
                  WHEN v_new_ua THEN 'NEW_UA' END;
    IF v_why IS NULL THEN RETURN NEW; END IF;

    SELECT left(a.email::text, 2) || '***@' || split_part(a.email::text, '@', 2) INTO v_email
      FROM public.accounts a WHERE a.id = NEW.account_id;
    /* raised_at 은 clock_timestamp — (alert_code, raised_at) 가 유일이라 한 거래 안 두 번째 로그인이 now() 로 겹치지 않게 */
    INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
    VALUES ('STAFF_LOGIN_NEW', 'WARN', clock_timestamp(),
            format('운영자 낯선 로그인 — %s(%s) · %s · %s%s', coalesce(v_email, '?'), v_roles,
                   coalesce(NEW.ip_masked, 'IP 모름'), coalesce(NEW.ua_kind, '브라우저 모름'),
                   CASE v_why WHEN 'FIRST' THEN ' · 30일 안 첫 로그인' WHEN 'NEW_IP' THEN ' · 처음 보는 IP 대역'
                              WHEN 'NEW_UA' THEN ' · 처음 보는 브라우저' ELSE ' · 처음 보는 IP 대역 · 브라우저' END),
            jsonb_build_object('accountId', NEW.account_id, 'email', v_email, 'roles', v_roles,
                               'ip', NEW.ip_masked, 'ua', NEW.ua_kind, 'why', v_why, 'loginId', NEW.id));
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- 알림을 남기지 못해도 로그인 기록 · 로그인은 그대로
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_staff_login_watch ON public.login_history;
CREATE TRIGGER trg_staff_login_watch AFTER INSERT ON public.login_history
    FOR EACH ROW EXECUTE FUNCTION public.fn_staff_login_watch();

COMMENT ON FUNCTION public.fn_staff_login_watch() IS '운영 역할 계정이 지난 30일에 없던 IP 대역 · 브라우저로(또는 30일 만에) 로그인하면 운영 알림 STAFF_LOGIN_NEW(WARN) — D179 · v10.201';

-- ③ 급한 알림 대상에 STAFF_LOGIN_NEW ---------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · D179 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 운영자 낯선 로그인 · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_pending() IS '텔레그램으로 보낼 급한 운영 알림(D178 · D179 · 메일 fn_ops_alert_mail_pending 과 같은 기준 · 칸은 pushed_at).';

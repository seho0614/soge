-- =====================================================================
-- D197 (v10.228 · docs/366) — 운영 화면 접속 인증 경보
--
--   운영 Nginx 허용 IP 를 풀기 전에, 누가 어디서 인증하고 들어오는지 · 번호를 맞히려는 시도가 있는지를 바로 알게 합니다.
--
--   ① fn_staff_ip_pass_watch — staff_ip_passes 에 통과가 들어오면, 그 운영자가 지난 30일 같은 IP 대역
--      (IPv4 앞 두 마디 · IPv6 앞 32비트)으로 통과한 적이 없을 때 운영 알림 STAFF_IP_PASS_NEW(WARN)
--   ② fn_staff_ip_code_watch — staff_ip_codes
--      · tries 가 5 에 닿으면(15분 막힘) STAFF_IP_LOCKED(WARN)
--      · 그 운영자의 그날(한국 날짜) 열 번째 번호면 STAFF_IP_DAY_LIMIT(WARN — 그날 더 못 받음)
--   ③ fn_ops_alert_mail_pending · fn_ops_alert_push_pending — 급한 알림(메일 · 텔레그램) 대상에 세 종류 더함(나머지는 D182 그대로)
--
--   IP 는 대역만(203.0.*.*) · 이메일은 앞 두 글자만. 알림을 남기지 못해도 인증은 그대로(예외는 삼킴).
--   접속 인증(admin.ip_verify)이 꺼져 있으면 통과 · 번호가 생기지 않으므로 알림도 없습니다 — 따로 스위치를 두지 않음.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- 0. IP 대역 가리기 ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ip_band(p inet) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
              WHEN family(p) = 4 THEN split_part(host(p), '.', 1) || '.' || split_part(host(p), '.', 2) || '.*.*'
              ELSE host(network(set_masklen(p, 32))) || '/32' END
$$;
COMMENT ON FUNCTION public.fn_ip_band(inet) IS 'IP 를 대역으로 가림 — IPv4 앞 두 마디(203.0.*.*) · IPv6 앞 32비트(2001:db8::/32). 운영 알림에 쓰는 모양(D197).';

CREATE OR REPLACE FUNCTION public.fn_email_mask(p_account uuid) RETURNS text
    LANGUAGE sql STABLE AS $$
  SELECT left(a.email::text, 2) || '***@' || split_part(a.email::text, '@', 2) FROM public.accounts a WHERE a.id = p_account
$$;
COMMENT ON FUNCTION public.fn_email_mask(uuid) IS '계정 이메일을 앞 두 글자만 보이게(ad***@x.com) — 운영 알림용(D197 · D179 와 같은 모양).';

-- ① 처음 보는 대역으로 통과 ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_staff_ip_pass_watch() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_seen boolean;
  v_email text;
  v_band text;
BEGIN
  BEGIN
    SELECT EXISTS (SELECT 1 FROM public.staff_ip_passes p
                    WHERE p.account_id = NEW.account_id
                      AND NOT (p.ip = NEW.ip AND p.day = NEW.day)
                      AND p.verified_at > now() - interval '30 days'
                      AND family(p.ip) = family(NEW.ip)
                      AND p.ip <<= set_masklen(NEW.ip, CASE WHEN family(NEW.ip) = 4 THEN 16 ELSE 32 END)) INTO v_seen;
    IF v_seen THEN RETURN NEW; END IF;
    v_email := public.fn_email_mask(NEW.account_id);
    v_band := public.fn_ip_band(NEW.ip);
    INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
    VALUES ('STAFF_IP_PASS_NEW', 'WARN', clock_timestamp(),
            format('운영 화면 접속 인증 — %s · 처음 보는 대역 %s 에서 통과(%s)', coalesce(v_email, '?'), v_band,
                   CASE NEW.channel WHEN 'SMS' THEN '문자' WHEN 'TELEGRAM_ME' THEN '개인 텔레그램' ELSE '운영 대화방' END),
            jsonb_build_object('accountId', NEW.account_id, 'email', v_email, 'ip', v_band, 'channel', NEW.channel, 'day', NEW.day));
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- 알림을 남기지 못해도 통과는 그대로
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_staff_ip_pass_watch ON public.staff_ip_passes;
CREATE TRIGGER trg_staff_ip_pass_watch AFTER INSERT ON public.staff_ip_passes
    FOR EACH ROW EXECUTE FUNCTION public.fn_staff_ip_pass_watch();
COMMENT ON FUNCTION public.fn_staff_ip_pass_watch() IS '운영자가 지난 30일에 없던 IP 대역으로 접속 인증을 통과하면 운영 알림 STAFF_IP_PASS_NEW(WARN) — D197 · v10.228';

-- ② 5번 틀림 · 하루 한도 --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_staff_ip_code_watch() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
  v_today int;
  v_email text;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.tries >= 5 AND OLD.tries < 5 THEN
        v_email := public.fn_email_mask(NEW.account_id);
        INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
        VALUES ('STAFF_IP_LOCKED', 'WARN', clock_timestamp(),
                format('운영 화면 접속 인증번호 5번 틀림 — %s · %s · 15분 막음', coalesce(v_email, '?'), public.fn_ip_band(NEW.ip)),
                jsonb_build_object('accountId', NEW.account_id, 'email', v_email, 'ip', public.fn_ip_band(NEW.ip), 'codeId', NEW.id));
      END IF;
    ELSE
      SELECT count(*)::int INTO v_today FROM public.staff_ip_codes c
       WHERE c.account_id = NEW.account_id
         AND (c.created_at AT TIME ZONE 'Asia/Seoul')::date = (NEW.created_at AT TIME ZONE 'Asia/Seoul')::date;
      IF v_today = 10 THEN
        v_email := public.fn_email_mask(NEW.account_id);
        INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
        VALUES ('STAFF_IP_DAY_LIMIT', 'WARN', clock_timestamp(),
                format('운영 화면 접속 인증번호 하루 10번 닿음 — %s · %s · 오늘은 더 보내지 않음', coalesce(v_email, '?'), public.fn_ip_band(NEW.ip)),
                jsonb_build_object('accountId', NEW.account_id, 'email', v_email, 'ip', public.fn_ip_band(NEW.ip), 'count', v_today));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;   -- 알림을 남기지 못해도 번호 보내기 · 확인은 그대로
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_staff_ip_code_watch ON public.staff_ip_codes;
CREATE TRIGGER trg_staff_ip_code_watch AFTER INSERT OR UPDATE OF tries ON public.staff_ip_codes
    FOR EACH ROW EXECUTE FUNCTION public.fn_staff_ip_code_watch();
COMMENT ON FUNCTION public.fn_staff_ip_code_watch() IS '접속 인증번호 5번 틀림 STAFF_IP_LOCKED · 하루 10번째 번호 STAFF_IP_DAY_LIMIT(둘 다 WARN) — D197 · v10.228';

-- ③ 급한 알림 대상에 세 종류 -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · D179 · D181 · D182 · D197 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 운영자 낯선 로그인 · AI 사용 가능해짐 · AI 준비 덜 됨 · AI 상한 % · AI 다음 단계 · 접속 인증 처음 보는 대역 · 5번 틀림 · 하루 한도 · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_pending() IS '텔레그램으로 보낼 급한 운영 알림(D178 · D179 · D181 · D182 · D197 · 메일 fn_ops_alert_mail_pending 과 같은 기준 · 칸은 pushed_at).';

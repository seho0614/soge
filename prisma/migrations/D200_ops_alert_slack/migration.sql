-- =====================================================================
-- D200 (v10.237 · docs/377) — 급한 운영 알림 · 하루 요약을 슬랙으로도
--
--   텔레그램(D178 · D179)과 같은 알림을 같은 기준으로 슬랙 채널 한 곳에 보냄(텔레그램 · 메일과 따로 기록 — 하나가 안 돼도 나머지는 감).
--   ① 연동 키 SLACK_WEBHOOK_URL — 「메일」 연동 칸 아래(텔레그램 봇 토큰 옆 · 새 연동 줄을 만들지 않음).
--      형식 검사 「https://hooks.slack.com/services/…」 · 넣어도 메일 연동의 「키 등록」 표시는 바꾸지 않음.
--      웹훅 주소 하나에 채널 하나가 묶여 있어 받을 곳 설정은 따로 없음 — 주소가 없으면 꺼짐.
--   ② 설정 ops.slack_digest(on) — 하루 요약도 슬랙으로
--   ③ ops_alerts.slack_pushed_at · slack_repushed_at — 슬랙으로 보낸 시각(텔레그램 pushed_at · 메일 mailed_at 과 따로)
--   ④ fn_ops_alert_slack_pending · fn_ops_alert_slack_repush_pending · fn_ops_alert_slack_backlog
--      고르는 기준은 텔레그램 함수(D178 · D198)와 같고 칸만 다름
--
--   운영 화면 접속 인증번호(D195 · D196)는 슬랙으로 보내지 않음(공유 채널에 번호가 남음).
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 연동 키 ---------------------------------------------------------------
ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS ck_integ_secret_name;
ALTER TABLE public.integration_secrets ADD CONSTRAINT ck_integ_secret_name
  CHECK ((integration_code, name) IN (
    ('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'),
    ('PG','TOSS_SECRET_KEY'), ('PG','TOSS_CLIENT_KEY'), ('BANK','BANK_VERIFY_KEY'), ('NTS','NTS_SERVICE_KEY'),
    ('BROKER','BROKER_LOOKUP_KEY'), ('ETAX','ETAX_KEY'), ('MAIL','SMTP_PASS'), ('MAIL','SMTP_USER'),
    ('PASS','PASS_API_KEY'), ('PASS','NICE_CLIENT_ID'), ('PASS','NICE_CLIENT_SECRET'), ('PASS','NICE_PRODUCT_ID'), ('ESIGN','ESIGN_API_KEY'), ('ESIGN','ESIGN_WEBHOOK_SECRET'), ('ALIMTALK','ALIMTALK_KEY'), ('ALIMTALK','ALIMTALK_SENDER_KEY'), ('SAFENUM','SAFENUM_KEY'), ('SAFENUM','SAFENUM_WEBHOOK_SECRET'),
    ('MAIL','TELEGRAM_BOT_TOKEN'), ('MAIL','SLACK_WEBHOOK_URL')));

/* fn_integ_secret_set — D178 그대로 + 슬랙 웹훅 주소 형식 · 슬랙 주소도 메일 연동 「키 등록」 표시를 바꾸지 않음 */
CREATE OR REPLACE FUNCTION public.fn_integ_secret_set(p_code text, p_name text, p_value text, p_actor uuid)
 RETURNS TABLE(o_name text, o_last4 text, o_updated_at timestamptz) LANGUAGE plpgsql AS $function$
/* 돌려주는 칸 이름에 o_ 를 붙입니다 — 표의 칸(name · last4 · updated_at)과 이름이 같으면 plpgsql 이 「모호함」으로 멈춥니다 */
DECLARE v text := btrim(coalesce(p_value, ''));
BEGIN
  IF p_name IN ('KMA_SERVICE_KEY', 'NTS_SERVICE_KEY') THEN
    /* 공공데이터포털 일반 인증키 — Decoding(+ / =) 또는 Encoding(%2B …) 어느 쪽이든 받습니다 */
    IF v !~ '^[A-Za-z0-9+/=%]{20,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 공공데이터포털 › 마이페이지 › 활용 신청 상세의 「일반 인증키(Decoding)」를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'ANTHROPIC_API_KEY' THEN
    /* v10.111 — API 키만(sk-ant-api…). 관리 키(sk-ant-admin…) · 사용자 키(sk-ant-usr…)는 쓰지 않습니다 */
    IF v !~ '^sk-ant-api[A-Za-z0-9_-]{20,250}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — Anthropic 콘솔 › API Keys 에서 만든 키(sk-ant-api 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_SECRET_KEY' THEN
    /* 토스페이먼츠 시크릿 키 — test_sk_ · live_sk_ (결제위젯은 gsk) */
    IF v !~ '^(test|live)_g?sk_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「시크릿 키」(test_sk_ · live_sk_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TOSS_CLIENT_KEY' THEN
    /* 결제창 클라이언트 키 — 브라우저에 나가는 공개 키(test_ck_ · live_ck_ · 결제위젯은 gck) */
    IF v !~ '^(test|live)_g?ck_[A-Za-z0-9_]{8,200}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 토스페이먼츠 개발자센터 › API 키의 「클라이언트 키」(test_ck_ · live_ck_ 로 시작)를 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'SMTP_PASS' THEN
    /* SES SMTP 비밀번호 — base64 모양 */
    IF v !~ '^[A-Za-z0-9+/=]{20,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 비밀번호를 붙여 넣으십시오(IAM 액세스 키가 아닙니다).';
    END IF;
  ELSIF p_name = 'SMTP_USER' THEN
    /* v10.140 — SES SMTP 사용자 이름(보통 AKIA 로 시작하는 20자 · 영문 대문자 · 숫자) */
    IF v !~ '^[A-Z0-9]{16,128}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — SES 콘솔 › SMTP 설정 › 「SMTP 자격 증명」의 사용자 이름(영문 대문자 · 숫자)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'SLACK_WEBHOOK_URL' THEN
    /* v10.237 (D200) — 슬랙 앱 › Incoming Webhooks 가 준 주소「https://hooks.slack.com/services/T…/B…/…」 */
    IF v !~ '^https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]+$' OR length(v) > 300 THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 주소 형식이 아닙니다 — 슬랙 앱 › Incoming Webhooks 의 「Webhook URL」(https://hooks.slack.com/services/ 로 시작)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name = 'TELEGRAM_BOT_TOKEN' THEN
    /* v10.200 (D178) — BotFather 가 준 토큰「123456789:AA…」(숫자 · 쌍점 · 영문 · 숫자 · _ · -) */
    IF v !~ '^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 텔레그램 BotFather 가 준 토큰(숫자:영문 · 숫자 — 예 123456789:AA…)을 붙여 넣으십시오.';
    END IF;
  ELSIF p_name IN ('BANK_VERIFY_KEY', 'BROKER_LOOKUP_KEY', 'ETAX_KEY', 'PASS_API_KEY', 'ESIGN_API_KEY', 'ALIMTALK_KEY', 'SAFENUM_KEY',
                  'NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID', 'ALIMTALK_SENDER_KEY', 'ESIGN_WEBHOOK_SECRET', 'SAFENUM_WEBHOOK_SECRET') THEN
    /* 업체마다 모양이 달라 「빈칸 없는 영문 · 숫자 · 기호 8 ~ 512자」만 봅니다(PostgreSQL 정규식 반복 수는 255 까지라 길이는 따로) */
    IF length(v) NOT BETWEEN 8 AND 512 OR v !~ '^[!-~]+$' THEN
      RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 업체에서 받은 키를 빈칸 없이 붙여 넣으십시오(8 ~ 512자).';
    END IF;
  ELSIF v !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'INTEG_SECRET_FORMAT: 키 형식이 아닙니다 — 카카오 콘솔 「앱 키」에서 복사한 값(영문 · 숫자 16 ~ 128자)을 붙여 넣으십시오.';
  END IF;
  INSERT INTO public.integration_secrets AS s (integration_code, name, value_enc, last4, is_public, updated_by, updated_at)
  VALUES (p_code, p_name, pgp_sym_encrypt(v, public.fn_enc_key()), right(v, 4), p_name IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY'), p_actor, now())
  ON CONFLICT (integration_code, name) DO UPDATE
     SET value_enc = EXCLUDED.value_enc, last4 = EXCLUDED.last4, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF p_name NOT IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY', 'TELEGRAM_BOT_TOKEN', 'SLACK_WEBHOOK_URL') THEN
    UPDATE public.integrations SET secret_registered = true WHERE code = p_code;
  END IF;
  RETURN QUERY SELECT s.name, s.last4, s.updated_at FROM public.integration_secrets s
                WHERE s.integration_code = p_code AND s.name = p_name;
END $function$;

-- ② 하루 요약 ---------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('ops.slack_digest', 'on', 'ADMIN',
        '운영 하루 요약을 슬랙으로도(v10.237 · docs/377) — on 이면 매일 하루 요약을 급한 알림과 같은 슬랙 채널(웹훅 주소)로 한 통. 웹훅 주소가 없으면 보내지 않음.',
        false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

-- ③ 보낸 시각 -----------------------------------------------------------------
ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS slack_pushed_at timestamptz;
ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS slack_repushed_at timestamptz;
COMMENT ON COLUMN public.ops_alerts.slack_pushed_at IS '슬랙으로 보낸 시각(D200 · 텔레그램 pushed_at · 메일 mailed_at 과 따로).';
COMMENT ON COLUMN public.ops_alerts.slack_repushed_at IS '12시간 넘게 확인 안 한 CRITICAL 을 슬랙으로 다시 보낸 시각(D200 · 한 번만).';

/* 지금 있는 알림은 「보낸 것」으로 — 웹훅을 처음 넣은 순간 지난 24시간 알림이 한꺼번에 가지 않게(텔레그램은 미리보기 · 한꺼번에 확인으로 정리했지만 슬랙은 새로 켬) */
UPDATE public.ops_alerts SET slack_pushed_at = coalesce(pushed_at, raised_at) WHERE slack_pushed_at IS NULL;
UPDATE public.ops_alerts SET slack_repushed_at = coalesce(repushed_at, raised_at) WHERE slack_repushed_at IS NULL AND severity = 'CRITICAL';

-- ④ 고르는 함수(텔레그램과 같은 기준) -----------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_slack_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.slack_pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.slack_pushed_at > now() - interval '1 hour')
   ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_slack_pending() IS '슬랙으로 보낼 급한 운영 알림(D200 · 텔레그램 fn_ops_alert_push_pending 과 같은 기준 · 칸은 slack_pushed_at · CRITICAL 먼저 · 최근 순 50건).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_slack_repush_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.severity = 'CRITICAL' AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.slack_pushed_at IS NOT NULL AND o.slack_pushed_at < now() - interval '12 hours'
     AND o.slack_repushed_at IS NULL
     AND o.raised_at > now() - interval '48 hours'
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_slack_repush_pending() IS '슬랙으로 다시 보낼 긴급 알림(D200 · 텔레그램 fn_ops_alert_repush_pending 과 같은 기준 · 칸은 slack_pushed_at · slack_repushed_at).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_slack_backlog() RETURNS int
    LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public.ops_alerts o
   WHERE o.slack_pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.slack_pushed_at > now() - interval '1 hour')
$$;
COMMENT ON FUNCTION public.fn_ops_alert_slack_backlog() IS '슬랙으로 보낼 급한 운영 알림 전체 수(fn_ops_alert_slack_pending 과 같은 기준 · 50건 제한 없음) — D200 · v10.237';

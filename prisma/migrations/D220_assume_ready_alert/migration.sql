-- =====================================================================
-- D220 (v10.317 · docs/442) — 「간주 끌 수 있음」 운영 알림(ASSUME_READY)을 급한 알림 목록에
--
--   1시간마다 도는 점검(launch_watch)이 「간주 모드 끄는 순서」(v10.315)를 보고, 간주가 켜져 있는데
--   서버가 끌 때 보는 조건을 모두 갖춘 항목이 있으면 ASSUME_READY 한 줄(INFO · 처음 한 번 · 켜진 채면 7일마다 한 번).
--   메일 · 텔레그램 · 슬랙으로 가는 종류 목록(D198 · D200 함수 6개)에 ASSUME_READY 만 더함 — 고르는 기준 · 순서 · 50건은 그대로.
--   쌓인 데이터는 바꾸지 않음. 지우는 문장 없음. 재실행 안전(CREATE OR REPLACE).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · D179 · D181 · D182 · D197 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 운영자 낯선 로그인 · AI 사용 가능해짐 · AI 준비 덜 됨 · AI 상한 % · AI 다음 단계 · 접속 인증 처음 보는 대역 · 5번 틀림 · 하루 한도 · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통 · D198 부터 CRITICAL 먼저 · 최근 순 50건 · D220 간주 끌 수 있음(ASSUME_READY)).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_backlog() RETURNS int
    LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_backlog() IS '메일로 보낼 급한 운영 알림 전체 수(fn_ops_alert_mail_pending 과 같은 기준 · 50건 제한 없음) — D198 · v10.230';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
   ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_pending() IS '텔레그램으로 보낼 급한 운영 알림(D178 · D179 · D181 · D182 · D197 · 메일 fn_ops_alert_mail_pending 과 같은 기준 · 칸은 pushed_at · D198 부터 CRITICAL 먼저 · 최근 순 50건 · D220 간주 끌 수 있음(ASSUME_READY)).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_backlog() RETURNS int
    LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_backlog() IS '텔레그램으로 보낼 급한 운영 알림 전체 수(fn_ops_alert_push_pending 과 같은 기준 · 50건 제한 없음) — D198 · v10.230';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_slack_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.slack_pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.slack_pushed_at > now() - interval '1 hour')
   ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_slack_pending() IS '슬랙으로 보낼 급한 운영 알림(D200 · 텔레그램 fn_ops_alert_push_pending 과 같은 기준 · 칸은 slack_pushed_at · CRITICAL 먼저 · 최근 순 50건 · D220 간주 끌 수 있음(ASSUME_READY)).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_slack_backlog() RETURNS int
    LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public.ops_alerts o
   WHERE o.slack_pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.slack_pushed_at > now() - interval '1 hour')
$$;
COMMENT ON FUNCTION public.fn_ops_alert_slack_backlog() IS '슬랙으로 보낼 급한 운영 알림 전체 수(fn_ops_alert_slack_pending 과 같은 기준 · 50건 제한 없음) — D200 · v10.237';

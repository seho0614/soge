-- =====================================================================
-- D198 (v10.230 · docs/369) — 급한 운영 알림 대기 목록: CRITICAL 먼저 · 최근 순
--
--   D175 ~ D197 의 fn_ops_alert_mail_pending · fn_ops_alert_push_pending 는 오래된 순(id) 50건이라,
--   메일 · 텔레그램을 못 보내는 동안 하루 안에 50건 넘게 쌓이면 새 CRITICAL 이 목록에 들지 못했습니다.
--   ① 두 함수의 고르는 기준(종류 · 24시간 · 풀린 것 빼고 · 종류마다 1시간에 1통)은 그대로, 순서만 CRITICAL 먼저 → 최근 순
--   ② fn_ops_alert_mail_backlog · fn_ops_alert_push_backlog — 같은 기준의 전체 수(50건 제한 없음).
--      보내는 쪽이 「보내지 못한 알림 n건 더」 줄을 붙이는 데 씀. 남은 것은 24시간 안에는 다음 차례에 계속 보냄.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 대기 목록 순서 ---------------------------------------------------------------
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
   ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · D179 · D181 · D182 · D197 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 운영자 낯선 로그인 · AI 사용 가능해짐 · AI 준비 덜 됨 · AI 상한 % · AI 다음 단계 · 접속 인증 처음 보는 대역 · 5번 틀림 · 하루 한도 · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통 · D198 부터 CRITICAL 먼저 · 최근 순 50건).';

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
   ORDER BY (o.severity = 'CRITICAL') DESC, o.id DESC
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_pending() IS '텔레그램으로 보낼 급한 운영 알림(D178 · D179 · D181 · D182 · D197 · 메일 fn_ops_alert_mail_pending 과 같은 기준 · 칸은 pushed_at · D198 부터 CRITICAL 먼저 · 최근 순 50건).';

-- ② 같은 기준 전체 수 -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_backlog() RETURNS int
    LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_backlog() IS '메일로 보낼 급한 운영 알림 전체 수(fn_ops_alert_mail_pending 과 같은 기준 · 50건 제한 없음) — D198 · v10.230';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_backlog() RETURNS int
    LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY',
                                                      'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_backlog() IS '텔레그램으로 보낼 급한 운영 알림 전체 수(fn_ops_alert_push_pending 과 같은 기준 · 50건 제한 없음) — D198 · v10.230';

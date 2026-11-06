-- =====================================================================
-- D182 (v10.205 · docs/328) — AI 켜기 다음 단계 알림 · 처음 게시 약관 경고
--
--   AI 켜기 단계(GET /admin/agent/rollout)의 다음 단계가 「할 차례」(앞 단계 기준 넘음 · 아직 꺼짐)가 되면
--   정기 작업 launch_watch 가 운영 알림 AGENT_STEP_READY(정보 · 단계마다 한 번 · 서버 코드)를 남김.
--   여기서는 그 알림을 급한 알림 메일 · 텔레그램 대상에 더함(켜는 때를 놓치지 않게).
--   처음 게시 약관 경고(GET /admin/terms/{code}/publish-preview)는 DB 변경 없음.
--
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- 급한 알림 대상에 AGENT_STEP_READY ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · D179 · D181 · D182 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 운영자 낯선 로그인 · AI 사용 가능해짐 · AI 준비 덜 됨 · AI 상한 % · AI 다음 단계 · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_pending() IS '텔레그램으로 보낼 급한 운영 알림(D178 · D179 · D181 · D182 · 메일 fn_ops_alert_mail_pending 과 같은 기준 · 칸은 pushed_at).';

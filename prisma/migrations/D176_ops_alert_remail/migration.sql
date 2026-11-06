-- =====================================================================
-- D176 (v10.198 · docs/312) — 확인 안 한 긴급 알림 다시 메일 · 백업 실패도 메일
--
--   v10.197(D175) 은 급한 알림을 한 번만 메일로 보냄 — 메일이 와도 놓치면 그대로 묻힘.
--
--   ① ops_alerts.remailed_at — 다시 보낸 시각(한 번만)
--   ② fn_ops_alert_remail_pending() — 다시 보낼 것: CRITICAL · 확인 안 함 · 메일 보낸 지 12시간 넘음 · 아직 다시 안 보냄 ·
--      처음 생긴 지 48시간 안 · 50건까지
--   ③ fn_ops_alert_mail_pending() — 처음 보낼 종류에 올린 파일 백업 실패(UPLOADS_BACKUP_FAILED) · 묶음 깨짐(UPLOADS_BACKUP_BAD) 더함
--      (등급은 WARN 그대로 — CRITICAL 은 배포 점검을 막음). 결과 모양은 D175 와 같음
--
--   remailed_at 도 확인 잠금(fn_ops_alert_ack_guard)이 막는 칸이 아님. 지우는 문장 없음. 재실행 안전.
-- =====================================================================

ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS remailed_at timestamptz;
COMMENT ON COLUMN public.ops_alerts.remailed_at IS '확인 안 한 긴급 알림을 12시간 뒤 다시 메일로 보낸 시각(D176 · 한 번만).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · CRITICAL · SETTING_CHANGED · 백업 실패 · 24시간 안 · 종류마다 1시간에 1통).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_remail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.severity = 'CRITICAL' AND o.acknowledged_at IS NULL
     AND o.mailed_at IS NOT NULL AND o.mailed_at < now() - interval '12 hours'
     AND o.remailed_at IS NULL
     AND o.raised_at > now() - interval '48 hours'
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_remail_pending() IS '다시 메일로 보낼 긴급 알림(D176 · CRITICAL · 확인 안 함 · 보낸 지 12시간 넘음 · 한 번만 · 48시간 안).';

-- =====================================================================
-- D175 (v10.197 · docs/310) — 급한 운영 알림을 그 자리에서 메일로
--
--   11/5 「주문 받기」가 켜진 것을 4시간 넘게 몰랐음 — 알림은 운영 화면 · 다음 날 하루 요약에만 보였음.
--   정기 작업 launch_watch(10분)가 아래 알림을 ops.digest_to 로 메일(메일이 준비됐을 때만).
--
--   ① ops_alerts.mailed_at — 메일로 보낸 시각(두 번 보내지 않음 · 운영 화면 「메일 보냄」)
--   ② fn_ops_alert_mail_pending() — 보낼 것: CRITICAL 또는 SETTING_CHANGED · 확인 안 함 · 24시간 안 · 아직 안 보냄 ·
--      같은 종류를 지난 1시간 안에 보냈으면 그 종류는 다음에(1시간에 1통 · 그사이 것은 다음 메일에 묶임) · 50건까지
--
--   mailed_at 은 확인 잠금(fn_ops_alert_ack_guard)이 막는 칸이 아님 — 확인한 알림에도 적을 수 있음.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS mailed_at timestamptz;
COMMENT ON COLUMN public.ops_alerts.mailed_at IS '급한 알림을 메일(ops.digest_to)로 보낸 시각(D175 · 보내지 않았으면 비어 있음).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code = 'SETTING_CHANGED')
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · CRITICAL · SETTING_CHANGED · 24시간 안 · 종류마다 1시간에 1통).';

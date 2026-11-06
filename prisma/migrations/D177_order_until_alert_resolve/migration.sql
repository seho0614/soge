-- =====================================================================
-- D177 (v10.199 · docs/314) — 「주문 받기」 꺼질 시각 · 운영 알림 「풀림」 · 검수 기한 알림 묶기
--
--   11/5 · 11/6 운영에서 간주 결제가 켜진 채 「주문 받기」가 켜져 두 번 다 사람이 끄기를 잊음(postcheck 로 앎 · 주문 0건).
--   운영 알림 170건 중 160건 넘게 원인이 이미 없어진 옛 알림(검수 기한 넘김 · 백업 멈춤)이라 급한 알림이 묻힘.
--
--   ① 설정 mall.order_open_until — 간주 결제가 켜진 채 주문 받기를 켜면 서버가 적는 꺼질 시각(최대 24시간).
--      정기 작업(launch_watch · 10분마다)이 지나면 주문 받기를 끔. 사람이 직접 고치지 않음(API 가 막음).
--   ② ops_alerts.resolved_at · resolve_note — 원인이 없어지면 정기 작업이 적는 「풀림」. 사람의 「확인」 기록과 따로
--      (확인 잠금 fn_ops_alert_ack_guard 가 막는 칸이 아님). 확인 안 한 알림 수 · 메일 · 다시 메일 · 배포 점검은 풀린 것을 뺌
--   ③ fn_ops_alert_mail_pending · fn_ops_alert_remail_pending — 풀린 것 빼기(결과 모양은 D176 과 같음)
--   ④ fn_check_sla_alert — 확인 안 했고 풀리지 않은 같은 등급 REVIEW_SLA_BREACH 가 있으면 새 줄 대신 그 줄의 건수 · 마지막 시각(detail)만 고침 ·
--      넘긴 검수가 0건이면 「풀림」. 등록자 안내(REVIEW_SLA_DELAY)는 그대로
--
--   이미 쌓인 알림은 이 마이그레이션이 고치지 않음 — 적용 뒤 첫 정기 작업이 원인이 없어진 것에 「풀림」을 적음.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 꺼질 시각 ------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('mall.order_open_until', NULL, 'GLOBAL',
        '소개몰 주문 받기가 저절로 꺼질 시각(v10.199 · docs/314) — 간주 결제가 켜진 채 주문 받기를 켜면 서버가 적습니다(1 ~ 24시간 · 직접 고치지 않음). 정기 작업이 이 시각이 지나면 주문 받기를 끄고 운영 알림 ORDER_OPEN_EXPIRED 를 남깁니다.',
        false, NULL, '2026-11-06T15:00:00Z')
ON CONFLICT (key) DO NOTHING;

-- ② 풀림 -------------------------------------------------------------------
ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.ops_alerts ADD COLUMN IF NOT EXISTS resolve_note text;
ALTER TABLE public.ops_alerts DROP CONSTRAINT IF EXISTS ck_ops_alerts_resolve_note;
ALTER TABLE public.ops_alerts ADD CONSTRAINT ck_ops_alerts_resolve_note CHECK (resolve_note IS NULL OR length(resolve_note) <= 200);
COMMENT ON COLUMN public.ops_alerts.resolved_at IS '원인이 없어져 정기 작업이 적은 「풀림」 시각(D177 · 사람의 확인과 따로).';
COMMENT ON COLUMN public.ops_alerts.resolve_note IS '왜 풀렸는지(D177 · 200자).';
CREATE INDEX IF NOT EXISTS ix_ops_alerts_unresolved ON public.ops_alerts (alert_code) WHERE resolved_at IS NULL AND acknowledged_at IS NULL;

-- ③ 메일 · 다시 메일은 풀린 것을 뺌 ------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_remail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.severity = 'CRITICAL' AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.mailed_at IS NOT NULL AND o.mailed_at < now() - interval '12 hours'
     AND o.remailed_at IS NULL
     AND o.raised_at > now() - interval '48 hours'
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_remail_pending() IS '다시 메일로 보낼 긴급 알림(D176 · D177 · CRITICAL · 확인 안 함 · 풀리지 않음 · 보낸 지 12시간 넘음 · 한 번만 · 48시간 안).';

-- ④ 검수 기한 알림 묶기 · 풀림 ----------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_sla_alert() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n int; sev text; open_id bigint;
BEGIN
  SELECT count(*) INTO n FROM review_items
   WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now();
  IF n > 0 THEN
    sev := CASE WHEN n >= 20 THEN 'CRITICAL' ELSE 'WARN' END;
    /* v10.199 (D177) — 같은 등급의 확인 안 한 · 풀리지 않은 줄이 있으면 새 줄 대신 건수 · 마지막 시각만(제목은 확인 잠금이 막음) */
    SELECT id INTO open_id FROM ops_alerts
     WHERE alert_code = 'REVIEW_SLA_BREACH' AND severity = sev AND acknowledged_at IS NULL AND resolved_at IS NULL
     ORDER BY raised_at DESC LIMIT 1;
    IF open_id IS NOT NULL THEN
      UPDATE ops_alerts SET detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('count', n, 'lastSeen', now())
       WHERE id = open_id;
    ELSE
      INSERT INTO ops_alerts(alert_code, severity, title, detail)
      VALUES ('REVIEW_SLA_BREACH', sev, format('검수 SLA 위반 %s건', n), jsonb_build_object('count', n, 'lastSeen', now()))
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    UPDATE ops_alerts SET resolved_at = now(), resolve_note = '넘긴 검수가 0건이 됨'
     WHERE alert_code = 'REVIEW_SLA_BREACH' AND resolved_at IS NULL;
  END IF;
  /* v10.31 — 넘긴 건의 등록자에게 한 번만 안내합니다 */
  WITH due AS (
    UPDATE review_items SET sla_notified_at = now()
     WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now() AND sla_notified_at IS NULL
       AND submitted_by IS NOT NULL
    RETURNING submitted_by, target_type
  )
  INSERT INTO notifications (account_id, event_code, title, body, link_url)
  SELECT submitted_by, 'REVIEW_SLA_DELAY', '검수가 늦어지고 있습니다',
         CASE target_type WHEN 'REQUEST' THEN '올리신 요청' WHEN 'BUSINESS' THEN '사업자 신청' ELSE '올리신 매물' END
           || '의 검수가 24시간을 넘겼습니다. 순서대로 확인하고 있으니 조금만 기다려 주십시오. 결과는 바로 알려 드립니다.',
         '/my/listings'
    FROM due;
  RETURN n;
END $$;

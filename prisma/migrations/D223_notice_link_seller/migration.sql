-- =====================================================================
-- D223 v10.331 (docs/461) 소개몰 공지 알림 — 판매자는 판매자센터 › 소개몰 공지의 그 공지로
--   fn_notice_notify(D221) 를 그대로 다시 만들고, 알림 이동 주소(link_url)만 받는 사람마다 정함:
--   소개몰(HLT) 공지 + 받는 사람이 입점 판매자(TENANT · BRAND · ACTIVE · PAUSED) →
--   '/health/seller/center/notices#n-<공지 id>' · 그 밖은 지금처럼 '/community?board=NOTICE#n-<공지 id>'.
--   이미 보낸 알림은 그대로(옛 주소 — 소개광장 › 공지에서도 그대로 열림).
--   지우는 문장 없음. 재실행 안전(CREATE OR REPLACE).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_notice_notify(p_id uuid) RETURNS int
    LANGUAGE plpgsql AS $$
DECLARE n public.notices; c int; total int; batch int; cmin int;
BEGIN
  SELECT * INTO n FROM notices WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT n.notify OR n.notified_at IS NOT NULL OR n.published_at IS NULL OR n.published_at > now()
     OR (n.ends_at IS NOT NULL AND n.ends_at <= now()) THEN
    RETURN 0;
  END IF;
  batch := coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'notice.notify_batch'), 2000);
  cmin  := coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'notice.notify_confirm_min'), 1000);
  WITH pick AS (
    INSERT INTO notice_notified (notice_id, account_id)
    SELECT n.id, x FROM fn_notice_audience(n.grades) x
     WHERE NOT EXISTS (SELECT 1 FROM notice_notified z WHERE z.notice_id = n.id AND z.account_id = x)
     LIMIT batch
    ON CONFLICT DO NOTHING
    RETURNING account_id
  ), sent AS (
    INSERT INTO notifications (account_id, event_code, title, body, link_url)
    SELECT account_id, 'NOTICE_PUBLISHED', '새 공지 — ' || left(n.title, 80), left(n.body, 200), CASE WHEN n.gwan_code = 'HLT' AND EXISTS (SELECT 1 FROM hlt_sellers s WHERE s.account_id = pick.account_id AND s.type IN ('TENANT', 'BRAND') AND s.status IN ('ACTIVE', 'PAUSED'))
                THEN '/health/seller/center/notices#n-' ELSE '/community?board=NOTICE#n-' END || n.id::text FROM pick
    RETURNING 1
  )
  SELECT count(*) INTO c FROM sent;
  total := coalesce(n.notified_count, 0) + c;
  IF c < batch THEN
    UPDATE notices SET notified_at = now(), notified_count = total WHERE id = p_id;
    IF total >= cmin THEN
      INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
      VALUES ('NOTICE_NOTIFY_DONE', 'INFO', '공지 알림 ' || total || '명 보냄 — 「' || left(n.title, 60) || '」',
              jsonb_build_object('noticeId', n.id, 'sent', total, 'grades', n.grades), clock_timestamp());
    END IF;
  ELSE
    UPDATE notices SET notified_count = total WHERE id = p_id;   -- 남은 사람은 정기 작업 notice_schedule 이 이어 보냄
  END IF;
  RETURN c;
END $$;

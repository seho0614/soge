-- =====================================================================
-- D218 (v10.301 ~ 302 · docs/422 · 423) — 요율 시행 때 공지 열람 기록 고정 · 안 읽은 판매자 자동 다시 알림
--
--   대표 「다음」 → A · B · C 모두 · 계획 「승인 + 통과하면 병합」(11/15).
--   ① v10.301 시행 때 기록 고정 — 정기 작업 hlt_rate_schedule(매일 00:05)이 예약을 시행하는 순간(fn_hlt_rate_sched_apply 안 · 요율을 바꾸기 전)
--      판매자마다 대상 여부 · 처음 · 마지막 · 횟수 · 「시행 전에 읽음」(처음 펼친 때 ≤ 시행 시각) · 예약 안내 알림 때 · 다시 알림 수 · 메일 · 문자를
--      hlt_rate_read_snaps 에 굳힘(쌓기만 · 고치거나 지울 수 없음) · hlt_rate_schedules.reads_frozen_at(굳힌 때 · 대상 0 이어도 표시)
--      이미 시행된 예약은 기록 없음(그때 굳히지 않았음)
--   ② v10.302 자동 다시 알림 — 설정 hlt.rate_auto_remind_days(0 = 끔 · 처음 0 · 1 ~ 30 · 바꾸기 SUPER)
--      fn_hlt_rate_auto_remind(): 시행 n일 전이 된 게시 예약(게시 시각이 지난 공지)에 공지를 펼치지 않은 대상 판매자만 한 번 알림
--      예약마다 자동은 한 번(hlt_rate_reminds.auto) · 사람이 24시간 안에 다시 알렸으면 건너뜀(다음 날 다시 봄) · 보낼 곳이 없으면 기록 안 함
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 시행 때 열람 기록
ALTER TABLE public.hlt_rate_schedules ADD COLUMN IF NOT EXISTS reads_frozen_at timestamptz;
COMMENT ON COLUMN public.hlt_rate_schedules.reads_frozen_at IS 'v10.301 (D218) 시행 때 공지 열람 기록을 굳힌 때(hlt_rate_read_snaps) — 비면 기록 없음';

CREATE TABLE IF NOT EXISTS public.hlt_rate_read_snaps (
  schedule_id  uuid NOT NULL REFERENCES public.hlt_rate_schedules(id),
  seller_id    uuid NOT NULL REFERENCES public.hlt_sellers(id),
  code         text NOT NULL,
  name         text NOT NULL,
  status       text NOT NULL,
  target       boolean NOT NULL,
  first_at     timestamptz,
  last_at      timestamptz,
  reads        int NOT NULL DEFAULT 0 CHECK (reads >= 0),
  read_before  boolean NOT NULL,
  notified_at  timestamptz,
  reminds      int NOT NULL DEFAULT 0 CHECK (reminds >= 0),
  delivery     text,
  snap_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, seller_id)
);
COMMENT ON TABLE public.hlt_rate_read_snaps IS
  'v10.301 (D218) 요율 시행 때 굳힌 공지 열람 기록(입점 약관 제17조 4항 「30일 전 공지」 증거) — 쌓기만 · read_before = 처음 펼친 때가 시행 시각 이전';
DROP TRIGGER IF EXISTS trg_hlt_rate_read_snaps_guard ON public.hlt_rate_read_snaps;
CREATE TRIGGER trg_hlt_rate_read_snaps_guard BEFORE UPDATE OR DELETE ON public.hlt_rate_read_snaps
  FOR EACH ROW EXECUTE FUNCTION public.fn_append_only_guard();

CREATE OR REPLACE FUNCTION public.fn_hlt_rate_sched_freeze(p_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE r record; v_n integer := 0;
BEGIN
  SELECT * INTO r FROM hlt_rate_schedules WHERE id = p_id;
  IF NOT FOUND OR r.reads_frozen_at IS NOT NULL THEN RETURN 0; END IF;
  INSERT INTO hlt_rate_read_snaps (schedule_id, seller_id, code, name, status, target, first_at, last_at, reads, read_before, notified_at, reminds, delivery)
  WITH tgt AS (SELECT fn_hlt_rate_sched_sellers(r.scope, r.target) AS id),
       who AS (SELECT s.id, true AS target FROM hlt_sellers s WHERE s.id IN (SELECT id FROM tgt)
               UNION
               SELECT s.id, false FROM hlt_sellers s JOIN notice_reads nr ON nr.account_id = s.account_id AND nr.notice_id = r.notice_id
                WHERE s.id NOT IN (SELECT id FROM tgt))
  SELECT r.id, s.id, s.code, s.name, s.status, w.target, nr.first_at, nr.last_at, coalesce(nr.reads, 0),
         coalesce(nr.first_at <= r.effective_at, false),
         (SELECT min(h.at) FROM hlt_rate_notifications h JOIN notifications x ON x.id = h.notification_id
           WHERE h.schedule_id = r.id AND h.kind = 'SCHEDULE' AND x.account_id = s.account_id),
         (SELECT count(*)::int FROM hlt_rate_notifications h JOIN notifications x ON x.id = h.notification_id
           WHERE h.schedule_id = r.id AND h.kind = 'REMIND' AND x.account_id = s.account_id),
         (SELECT string_agg(DISTINCT CASE d.channel WHEN 'EMAIL' THEN '메일' WHEN 'SMS' THEN '문자' ELSE d.channel END || ' ' ||
                             CASE WHEN d.status IN ('SENT', 'DELIVERED') THEN '보냄' WHEN d.status = 'FAILED' THEN '실패' ELSE '대기' END, ' · ')
            FROM hlt_rate_notifications h JOIN notifications x ON x.id = h.notification_id JOIN notification_deliveries d ON d.notification_id = x.id
           WHERE h.schedule_id = r.id AND x.account_id = s.account_id)
    FROM who w JOIN hlt_sellers s ON s.id = w.id
    LEFT JOIN notice_reads nr ON nr.notice_id = r.notice_id AND nr.account_id = s.account_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE hlt_rate_schedules SET reads_frozen_at = now() WHERE id = p_id;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.fn_hlt_rate_sched_freeze(uuid) IS
  'v10.301 (D218) 요율 예약 시행 때 공지 열람 기록을 hlt_rate_read_snaps 에 굳힘(한 번만 · fn_hlt_rate_sched_apply 가 요율을 바꾸기 전에 부름)';

-- D208 fn_hlt_rate_sched_apply 그대로 + 맨 앞에 열람 기록 굳히기(대상 판매자는 요율을 바꾸기 전 기준)
CREATE OR REPLACE FUNCTION public.fn_hlt_rate_sched_apply() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE r record; v_from numeric; v_n integer := 0; v_show text;
BEGIN
  FOR r IN SELECT * FROM hlt_rate_schedules WHERE status = 'SCHEDULED' AND effective_at <= now()
            ORDER BY effective_at FOR UPDATE SKIP LOCKED LOOP
    PERFORM fn_hlt_rate_sched_freeze(r.id);   -- v10.301 (D218)
    IF r.scope = 'SELLER' THEN
      SELECT commission_rate INTO v_from FROM hlt_sellers WHERE id::text = r.target FOR UPDATE;
      UPDATE hlt_sellers SET commission_rate = r.to_rate, updated_at = now() WHERE id::text = r.target;
      IF FOUND AND v_from IS DISTINCT FROM r.to_rate THEN
        INSERT INTO hlt_seller_rate_changes (seller_id, from_rate, to_rate, reason, changed_by)
        VALUES (r.target::uuid, v_from, r.to_rate, '예약 시행 — ' || r.reason, r.created_by);
      END IF;
    ELSIF r.scope = 'TYPE' THEN
      SELECT rate INTO v_from FROM hlt_seller_type_rates WHERE seller_type = r.target FOR UPDATE;
      UPDATE hlt_seller_type_rates SET rate = r.to_rate, updated_by = r.created_by, updated_at = now() WHERE seller_type = r.target;
      IF FOUND AND v_from IS DISTINCT FROM r.to_rate THEN
        INSERT INTO hlt_type_rate_changes (seller_type, from_rate, to_rate, reason, changed_by)
        VALUES (r.target, v_from, r.to_rate, '예약 시행 — ' || r.reason, r.created_by);
      END IF;
    ELSE
      INSERT INTO hlt_commission_rates (category_code, rate, note, updated_by, updated_at)
      VALUES (r.target, r.to_rate, '예약 시행 — ' || r.reason, r.created_by, now())
      ON CONFLICT (category_code) DO UPDATE SET rate = EXCLUDED.rate, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now(),
             referral_pct = least(hlt_commission_rates.referral_pct, EXCLUDED.rate);
    END IF;
    v_show := CASE WHEN r.to_rate IS NULL THEN '다음 순서 요율' ELSE r.to_rate::text || '%' END;
    INSERT INTO notifications (account_id, event_code, title, body, link_url)
    SELECT s.account_id, 'SELLER_RATE_CHANGED', '판매 수수료율 변경이 시행되었습니다',
           '예고한 대로 오늘부터 들어오는 주문에 ' || v_show || ' 를 적용합니다(이미 받은 주문은 그대로) · 사유: ' || r.reason,
           '/health/seller/center'
      FROM hlt_sellers s
     WHERE s.id IN (SELECT fn_hlt_rate_sched_sellers(r.scope, r.target)) AND s.account_id IS NOT NULL;
    UPDATE hlt_rate_schedules SET status = 'APPLIED', applied_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.fn_hlt_rate_sched_apply() IS
  'v10.275 (D208) 시행 시각이 지난 요율 예약을 기본 표로 옮김(바꾼 기록 · 판매자 알림 · APPLIED) · v10.301 (D218) 그 전에 공지 열람 기록을 굳힘. 요율 계산은 fn_hlt_rate_for 가 시행 시각부터 이미 예약 값을 씀';

-- ② 자동 다시 알림
ALTER TABLE public.hlt_rate_reminds ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.hlt_rate_reminds.auto IS 'v10.302 (D218) 정기 작업이 보낸 자동 다시 알림(by_account 없음)';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hlt.rate_auto_remind_days', '0', 'ADMIN',
        '요율 공지 자동 다시 알림(v10.302 · docs/423) — 시행 n일 전에 예약 안내 공지를 펼치지 않은 대상 판매자에게 정기 작업(매일 00:05)이 한 번 알림. 0 = 끔 · 1 ~ 30 · 바꾸기는 최고 관리자.',
        false, '^([0-9]|[12][0-9]|30)$', '7')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_hlt_rate_auto_remind(OUT schedules integer, OUT sent integer)
    LANGUAGE plpgsql
    AS $$
DECLARE days integer; r record; v integer;
BEGIN
  schedules := 0; sent := 0;
  days := coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'hlt.rate_auto_remind_days'), 0);
  IF days <= 0 THEN RETURN; END IF;
  FOR r IN SELECT x.id, x.scope, x.target, x.notice_id, n.title,
                  to_char(x.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d
             FROM hlt_rate_schedules x JOIN notices n ON n.id = x.notice_id
            WHERE x.status = 'SCHEDULED' AND x.effective_at > now() AND x.effective_at <= now() + make_interval(days => days)
              AND n.published_at IS NOT NULL AND n.published_at <= now()
              AND NOT EXISTS (SELECT 1 FROM hlt_rate_reminds m WHERE m.schedule_id = x.id AND m.auto)
              AND NOT EXISTS (SELECT 1 FROM hlt_rate_reminds m WHERE m.schedule_id = x.id AND m.at > now() - interval '24 hours')
            ORDER BY x.effective_at FOR UPDATE OF x SKIP LOCKED LOOP
    WITH ins AS (
      INSERT INTO notifications (account_id, event_code, title, body, link_url)
      SELECT s.account_id, 'SELLER_RATE_SCHEDULED', '[다시 알림] 판매 수수료율 변경 예정 안내',
             r.d || ' 부터 판매 수수료율이 바뀝니다 — 판매자센터 「소개몰 공지」의 「' || coalesce(r.title, '') || '」를 확인해 주십시오(입점 약관 제17조 4항).',
             '/health/seller/center'
        FROM hlt_sellers s
       WHERE s.id IN (SELECT fn_hlt_rate_sched_sellers(r.scope, r.target)) AND s.account_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.notice_id = r.notice_id AND nr.account_id = s.account_id)
      RETURNING id),
    lk AS (INSERT INTO hlt_rate_notifications (notification_id, schedule_id, kind) SELECT id, r.id, 'REMIND' FROM ins ON CONFLICT DO NOTHING RETURNING 1)
    SELECT count(*)::int INTO v FROM ins;
    IF v > 0 THEN
      INSERT INTO hlt_rate_reminds (schedule_id, sent, by_account, auto) VALUES (r.id, v, NULL, true);
      schedules := schedules + 1; sent := sent + v;
    END IF;
  END LOOP;
END $$;
COMMENT ON FUNCTION public.fn_hlt_rate_auto_remind() IS
  'v10.302 (D218) 시행 n일 전(설정 hlt.rate_auto_remind_days · 0 = 끔) 예약 안내 공지를 펼치지 않은 대상 판매자에게 한 번 다시 알림 — 정기 작업 hlt_rate_schedule 이 부름';

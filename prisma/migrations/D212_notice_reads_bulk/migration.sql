-- =====================================================================
-- D212 (v10.283 ~ 285 · docs/411) — 요율 공지 열람 확인 · 대표 할 일 새 줄 · 공지 대량 알림 안전장치
--
--   대표 「다음 개발 후보 모두 추천」 → 「A → B → C 모두」 → 계획 「승인 + 통과하면 병합」(11/14).
--   ① v10.283 notice_reads — 판매자센터에서 공지를 펼친 때(처음 · 마지막 · 횟수) · 입점 약관 제17조 4항 「공지」를 봤다는 기록
--      hlt_rate_reminds — 「안 읽은 판매자에게 다시 알림」 보낸 기록(쌓기만 · 24시간에 한 번은 앱)
--   ② v10.284 대표 할 일 직접 확인 줄 rate-legal(요율 공지 방식 법무에 알리기) — owner_todo_marks 검사에 더함
--   ③ v10.285 공지 알림을 나눠 보냄 — 한 번에 notice.notify_batch(처음 2000)명 · 나머지는 정기 작업 notice_schedule(10분)이 이어 보냄 ·
--      같은 사람에게 두 번 안 감(notice_notified — 공지 · 받은 사람) · notice.notify_confirm_min(처음 1000)명 이상은
--      앱이 확인 문구를 받고 · 다 보내면 운영 알림 NOTICE_NOTIFY_DONE(INFO)
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.notice_reads (
  notice_id  uuid NOT NULL REFERENCES public.notices(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  first_at   timestamptz NOT NULL DEFAULT now(),
  last_at    timestamptz NOT NULL DEFAULT now(),
  reads      int NOT NULL DEFAULT 1 CHECK (reads >= 1),
  PRIMARY KEY (notice_id, account_id)
);
COMMENT ON TABLE public.notice_reads IS 'v10.283 (D212) 공지를 펼쳐 본 기록(판매자센터 「소개몰 공지」) — 처음 · 마지막 · 횟수 · 요율 공지 「읽음 n / 대상 m」';

CREATE TABLE IF NOT EXISTS public.hlt_rate_reminds (
  id          bigserial PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES public.hlt_rate_schedules(id),
  sent        int NOT NULL CHECK (sent >= 0),
  by_account  uuid REFERENCES public.accounts(id),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hlt_rate_reminds_sched ON public.hlt_rate_reminds (schedule_id, at DESC);
COMMENT ON TABLE public.hlt_rate_reminds IS 'v10.283 (D212) 요율 공지를 안 읽은 판매자에게 다시 알린 기록(쌓기만)';

CREATE OR REPLACE FUNCTION public.fn_append_only_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APND: 쌓기만 하는 기록이라 고치거나 지울 수 없습니다(%)', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_rate_reminds_guard ON public.hlt_rate_reminds;
CREATE TRIGGER trg_hlt_rate_reminds_guard BEFORE UPDATE OR DELETE ON public.hlt_rate_reminds
  FOR EACH ROW EXECUTE FUNCTION public.fn_append_only_guard();

-- ② 대표 할 일 직접 확인 줄 — rate-legal 더함
ALTER TABLE audit.owner_todo_marks DROP CONSTRAINT IF EXISTS owner_todo_marks_item_key_check;
ALTER TABLE audit.owner_todo_marks ADD CONSTRAINT owner_todo_marks_item_key_check CHECK (item_key IN ('plans', 'legal', 'ebs', 'rate-legal'));

-- ③ 공지 대량 알림
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('notice.notify_confirm_min', '1000', 'ADMIN',
   '공지 알림 확인 문구 기준(v10.285 · docs/411) — 받는 사람이 이 수 이상이면 공지 등록 · 게시 때 「모두에게 알림」을 입력해야 보냄.',
   false, '^[1-9][0-9]{0,6}$', '1000'),
  ('notice.notify_batch', '2000', 'ADMIN',
   '공지 알림 한 번에 보내는 수(v10.285 · docs/411) — 넘으면 정기 작업 notice_schedule(10분마다)이 나머지를 이어 보냄.',
   false, '^[1-9][0-9]{0,5}$', '2000')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.notice_notified (
  notice_id  uuid NOT NULL REFERENCES public.notices(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, account_id)
);
COMMENT ON TABLE public.notice_notified IS 'v10.285 (D212) 공지 알림을 받은 사람 — 나눠 보낼 때 같은 사람에게 두 번 가지 않게';

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
    SELECT account_id, 'NOTICE_PUBLISHED', '새 공지 — ' || left(n.title, 80), left(n.body, 200), '/support/notices' FROM pick
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
COMMENT ON FUNCTION public.fn_notice_notify(uuid) IS 'v10.281 (D211) · v10.285 (D212) 게시된 · 알림 고른 · 다 보내지 않은 공지면 한 번에 notice.notify_batch 명까지(같은 사람 두 번 없음) · 다 보내면 notified_at';

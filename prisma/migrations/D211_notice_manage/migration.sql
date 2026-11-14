-- =====================================================================
-- D211 (v10.280 ~ 282 · docs/410) — 공지 고치기 · 내리기 · 새 공지 알림 · 예약 게시 · 게시 기간
--
--   대표 「다음개발」 → 「A → B → C 모두」 → 계획 「승인 + 통과하면 병합」(11/14).
--   ① v10.280 고치기 · 내리기 — notices 에 끝 시각(ends_at) · 내린 사유 · 고친 사람 · 시각
--      notice_revisions — 고치기 · 내리기 · 다시 게시 때 그 전 내용(쌓기만 · 고칠 수 없음 · 지울 수 없음)
--      요율 예약 공지(D209 · hlt_rate_schedules 에 연결)는 게시한 뒤 제목 · 본문 · 등급 · 게시 · 끝 시각을 바꿀 수 없음(트리거)
--        — 입점 약관 제17조 4항 「30일 전 공지」의 증거
--   ② v10.281 새 공지 알림 — notices.notify · notified_at · notified_count · 알림 종류 NOTICE_PUBLISHED(수신 거부 가능)
--      fn_notice_audience(등급) — 받을 사람(전체 공개가 들면 없음 · 관리자 등급은 뺌 · 활동 중 계정 · 내 알림 끈 사람 뺌)
--      fn_notice_notify(공지) — 게시된 · 알림 고른 · 아직 안 보낸 공지면 한 번 보냄
--   ③ v10.282 예약 게시 · 게시 기간 — 게시 시각이 앞이면 예약 · 끝 시각이 지나면 안 보임 ·
--      정기 작업 notice_schedule(10분마다)이 예약 공지가 게시되면 알림을 보냄(fn_notice_notify_due)
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS ends_at        timestamptz;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS ended_reason   text;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS ended_by       uuid REFERENCES public.accounts(id);
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS updated_at     timestamptz;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS updated_by     uuid REFERENCES public.accounts(id);
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS notify         boolean NOT NULL DEFAULT false;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS notified_at    timestamptz;
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS notified_count int;
ALTER TABLE public.notices DROP CONSTRAINT IF EXISTS ck_notices_period;
ALTER TABLE public.notices ADD CONSTRAINT ck_notices_period CHECK (ends_at IS NULL OR published_at IS NULL OR ends_at > published_at);
COMMENT ON COLUMN public.notices.ends_at IS 'v10.280 · 282 (D211) 게시 끝 시각 — 지나면 어디에도 안 보임(끝 날짜 · 「내리기」는 지금 시각)';
COMMENT ON COLUMN public.notices.notify IS 'v10.281 (D211) 게시되면 그 등급 회원에게 「내 알림」(전체 공개 · 관리자 등급은 보내지 않음)';
CREATE INDEX IF NOT EXISTS idx_notices_notify_due ON public.notices (published_at) WHERE notify AND notified_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notice_revisions (
  id         bigserial PRIMARY KEY,
  notice_id  uuid NOT NULL REFERENCES public.notices(id),
  action     text NOT NULL CHECK (action IN ('EDIT', 'UNPUBLISH', 'REPUBLISH')),
  before     jsonb NOT NULL,
  reason     text,
  by_account uuid REFERENCES public.accounts(id),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notice_revisions_notice ON public.notice_revisions (notice_id, at DESC);
COMMENT ON TABLE public.notice_revisions IS 'v10.280 (D211) 공지 고친 기록 — 고치기 · 내리기 · 다시 게시 때 그 전 내용 · 사유(쌓기만)';

CREATE OR REPLACE FUNCTION public.fn_notice_revision_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NTCR: 공지 고친 기록은 고치거나 지울 수 없습니다';
END $$;
DROP TRIGGER IF EXISTS trg_notice_revision_guard ON public.notice_revisions;
CREATE TRIGGER trg_notice_revision_guard BEFORE UPDATE OR DELETE ON public.notice_revisions
  FOR EACH ROW EXECUTE FUNCTION public.fn_notice_revision_guard();

-- 요율 예약 공지는 게시한 뒤 잠금(고정 · 알림 칸만 바꿀 수 있음)
CREATE OR REPLACE FUNCTION public.fn_notice_lock_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = OLD.id OR r.cancel_notice_id = OLD.id) THEN
      RAISE EXCEPTION 'NTCL: 수수료율 변경 공지는 지울 수 없습니다';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.published_at IS NOT NULL AND OLD.published_at <= now()
     AND EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = OLD.id OR r.cancel_notice_id = OLD.id)
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.grades IS DISTINCT FROM OLD.grades
          OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
          OR NEW.gwan_code IS DISTINCT FROM OLD.gwan_code) THEN
    RAISE EXCEPTION 'NTCL: 게시한 수수료율 변경 공지는 고치거나 내릴 수 없습니다 — 입점 약관 제17조 4항 공지 기록';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notice_lock_guard ON public.notices;
CREATE TRIGGER trg_notice_lock_guard BEFORE UPDATE OR DELETE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.fn_notice_lock_guard();

INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('NOTICE_PUBLISHED', '새 공지', true, false, '안내 — 내 등급에 맞는 새 공지사항', 'info')
ON CONFLICT (event_code) DO NOTHING;

-- 받을 사람 — 전체 공개(PUBLIC)가 들면 모두라 보내지 않음 · 관리자(STAFF) 등급은 사용자 웹 알림에서 뺌
CREATE OR REPLACE FUNCTION public.fn_notice_audience(p_grades text[]) RETURNS SETOF uuid
    LANGUAGE sql STABLE AS $$
  SELECT a.id FROM accounts a
   WHERE NOT ('PUBLIC' = ANY(p_grades))
     AND a.status = 'ACTIVE'
     AND fn_notice_grades(a.id) && array_remove(p_grades, 'STAFF')
     AND NOT EXISTS (SELECT 1 FROM notification_preferences p
                      WHERE p.account_id = a.id AND p.event_code = 'NOTICE_PUBLISHED' AND p.channel = 'INAPP' AND NOT p.enabled);
$$;

CREATE OR REPLACE FUNCTION public.fn_notice_notify(p_id uuid) RETURNS int
    LANGUAGE plpgsql AS $$
DECLARE n public.notices; c int;
BEGIN
  SELECT * INTO n FROM notices WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT n.notify OR n.notified_at IS NOT NULL OR n.published_at IS NULL OR n.published_at > now()
     OR (n.ends_at IS NOT NULL AND n.ends_at <= now()) THEN
    RETURN 0;
  END IF;
  INSERT INTO notifications (account_id, event_code, title, body, link_url)
  SELECT x, 'NOTICE_PUBLISHED', '새 공지 — ' || left(n.title, 80), left(n.body, 200), '/support/notices'
    FROM fn_notice_audience(n.grades) x;
  GET DIAGNOSTICS c = ROW_COUNT;
  UPDATE notices SET notified_at = now(), notified_count = c WHERE id = p_id;
  RETURN c;
END $$;
COMMENT ON FUNCTION public.fn_notice_notify(uuid) IS 'v10.281 (D211) 게시된 · 알림 고른 · 아직 안 보낸 공지면 그 등급 회원에게 한 번(보낸 수)';

CREATE OR REPLACE FUNCTION public.fn_notice_notify_due() RETURNS TABLE (notices int, sent int)
    LANGUAGE plpgsql AS $$
DECLARE r record; k int := 0; s int := 0;
BEGIN
  FOR r IN SELECT id FROM public.notices
            WHERE notify AND notified_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
              AND (ends_at IS NULL OR ends_at > now())
            ORDER BY published_at LOOP
    k := k + 1; s := s + public.fn_notice_notify(r.id);
  END LOOP;
  notices := k; sent := s; RETURN NEXT;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('notice_schedule', 10, NULL, NULL, NULL, true, '예약 공지 알림 — 게시 시각이 된 공지 중 「알림 보냄」을 고른 것을 그 등급 회원에게(fn_notice_notify_due) · D211')
ON CONFLICT (job) DO NOTHING;

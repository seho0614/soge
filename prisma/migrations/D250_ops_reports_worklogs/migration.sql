-- v10.412 ~ 415 (docs/549 ~ 552) — 업무 보고(⑰): 일보 · 주보 · 월보 자동 요약 · 담당자 업무 일지 · 일지 현황판 · 보내기
--   대표 11/19 「일보 · 주보 · 월보 … 둘 다」 · 「개발 모두 진행」 · 「업무일지 현황판」.
--   report_snapshots · report_sends(쌓기만) · staff_worklogs(그날만 · 고치기 없음) · staff_worklog_reviews(쌓기만) · 설정 report.send(처음 off) · 정기 작업 ops_report(07:00).
--   보고 본문 · 보내기 · CSV 는 숫자만(개인정보 없음). 다시 돌려도 같음.

/* ── ① 보고 기록(일보 · 주보 · 월보) — 쌓기만 · 같은 기간을 다시 만들면 새 줄 (v10.412 · 413 · docs/549 · 550) ── */
CREATE TABLE IF NOT EXISTS public.report_snapshots (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('DAY', 'WEEK', 'MONTH')),
  period       text NOT NULL CHECK (period ~ '^\d{4}-\d{2}(-\d{2})?$'),
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  body         jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  source       text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('JOB', 'MANUAL')),
  made_by      uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rs_range CHECK (period_from <= period_to),
  CONSTRAINT ck_rs_period CHECK ((kind = 'MONTH') = (period ~ '^\d{4}-\d{2}$'))
);
CREATE INDEX IF NOT EXISTS ix_report_snapshots_kind ON public.report_snapshots (kind, period, id DESC);
COMMENT ON TABLE public.report_snapshots IS 'v10.412 (D250) 일보 · 주보 · 월보 — 그때 숫자를 그대로 남김(쌓기만 · 개인정보 없음 · 숫자만) · 정기 작업 ops_report(JOB) 또는 운영 화면 「지금 만들기」(MANUAL)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_snapshots_ro' AND tgrelid = 'public.report_snapshots'::regclass) THEN
    CREATE TRIGGER trg_report_snapshots_ro BEFORE UPDATE OR DELETE ON public.report_snapshots FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 보내기 기록(v10.415 · docs/552) — 채널마다 한 줄 · 쌓기만 */
CREATE TABLE IF NOT EXISTS public.report_sends (
  id           bigserial PRIMARY KEY,
  snapshot_id  bigint NOT NULL REFERENCES public.report_snapshots(id),
  channel      text NOT NULL CHECK (channel IN ('TELEGRAM', 'SLACK', 'MAIL')),
  result       text NOT NULL CHECK (char_length(result) BETWEEN 1 AND 60),
  sent_by      uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_report_sends_snap ON public.report_sends (snapshot_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_sends_ro' AND tgrelid = 'public.report_sends'::regclass) THEN
    CREATE TRIGGER trg_report_sends_ro BEFORE UPDATE OR DELETE ON public.report_sends FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ② 담당자 업무 일지(v10.414 · docs/551) — 그날(한국)만 쓰기 · 고치기 · 지우기 없음(덧붙임만) ── */
CREATE TABLE IF NOT EXISTS public.staff_worklogs (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  work_date   date NOT NULL,
  done        text NOT NULL CHECK (char_length(btrim(done)) BETWEEN 2 AND 2000),
  todo        text CHECK (todo IS NULL OR char_length(todo) <= 2000),
  blocked     text CHECK (blocked IS NULL OR char_length(blocked) <= 1000),
  minutes     integer CHECK (minutes IS NULL OR minutes BETWEEN 0 AND 1440),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_staff_worklogs_date ON public.staff_worklogs (work_date, account_id, id);
COMMENT ON TABLE public.staff_worklogs IS 'v10.414 (D250) 담당자 업무 일지 — 한 일 · 할 일 · 막힌 것 · 시간(분) · 그날(한국 날짜)만 넣음 · 고치기 · 지우기 없음(덧붙임은 새 줄)';
CREATE OR REPLACE FUNCTION public.fn_staff_worklog_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'WORKLOG_LOCKED: 업무 일지는 고치거나 지우지 않습니다(덧붙임만).'; END IF;
  IF NEW.work_date <> (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'WORKLOG_DATE: 업무 일지는 오늘(한국 날짜) 것만 씁니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_worklog_guard' AND tgrelid = 'public.staff_worklogs'::regclass) THEN
    CREATE TRIGGER trg_staff_worklog_guard BEFORE INSERT OR UPDATE OR DELETE ON public.staff_worklogs FOR EACH ROW EXECUTE FUNCTION public.fn_staff_worklog_guard();
  END IF;
END $$;

/* SUPER 확인(읽음 · 한 줄 답) — 일지마다 여러 번 · 쌓기만 */
CREATE TABLE IF NOT EXISTS public.staff_worklog_reviews (
  id           bigserial PRIMARY KEY,
  worklog_id   bigint NOT NULL REFERENCES public.staff_worklogs(id),
  reviewer_id  uuid NOT NULL REFERENCES public.accounts(id),
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_staff_worklog_reviews_log ON public.staff_worklog_reviews (worklog_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_staff_worklog_reviews_ro' AND tgrelid = 'public.staff_worklog_reviews'::regclass) THEN
    CREATE TRIGGER trg_staff_worklog_reviews_ro BEFORE UPDATE OR DELETE ON public.staff_worklog_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ③ 설정 · 정기 작업 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('report.send', 'off', 'ADMIN',
   '일보 · 주보 · 월보 보내기(v10.415 · docs/552) — on 이면 정기 작업 ops_report 가 만든 보고를 운영 알림 채널(텔레그램 · 슬랙 · 메일 ops.digest_to)로 보냄. 처음 꺼짐 · SUPER 만.',
   false, '^(on|off)$', 'off'),
  ('report.send_kinds', 'DAY,WEEK,MONTH', 'ADMIN',
   '보낼 보고 종류(v10.415) — DAY 일보 · WEEK 주보 · MONTH 월보를 쉼표로. SUPER 만.',
   false, '^(DAY|WEEK|MONTH)(,(DAY|WEEK|MONTH)){0,2}$', 'DAY,WEEK,MONTH')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('ops_report', 1440, 7, 0, NULL, true, '업무 보고 — 매일 07:00 전날 일보 · 월요일 지난주 주보 · 1일 지난달 월보(같은 기간 JOB 보고는 한 번) · report.send 가 on 이면 보냄 · D250 · v10.412')
ON CONFLICT (job) DO NOTHING;

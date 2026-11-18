-- v10.366 ~ 368 (docs/501 ~ 503) — 개인정보 대량 내려받기 승인 · 신고 처리 기한 경보 · DB 복원 시험 기록
--   대표 11/18 「다음개발」 → ① 회원 활동 한 줄 기록 ② 개인정보 대량 내려받기 승인 ③ 신고 처리 기한 경보 ④ DB 복원 시험 기록 「모두」 → 「승인 + 통과하면 병합」.
--   ① 칸 · 표 없음(회원 활동은 있는 표를 읽기만)
--   ② export_requests — 내려받기 4곳(POINT_REPORT · AUDIT_EXPORT · NOTICE_READS · RATE_READS) 요청 · 승인 · 한 번 쓰기(승인 뒤 24시간)
--      고치기는 「결정 한 번」 · 「쓰기 한 번」만 · 지우기 막음 · 요청자와 결정자가 같으면 solo(SUPER 가 혼자일 때)만
--   ③ 설정 ops.report_due_hours(24) — 열린 신고(OPEN · QUEUED)가 이 시간 넘으면 운영 알림 REPORT_OVERDUE
--   ④ restore_drills — 사람이 한 DB 복원 시험 결과(쌓기만) · 설정 ops.restore_drill_days(30) · 업무 안내 RESTORE_DRILL 1판
--   지우는 문장 없음 · 다시 돌려도 같음.

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.report_due_hours', '24', 'ADMIN',
   '신고 처리 기한(v10.367 · docs/502) — 열린 신고(접수 · 대기)가 이 시간을 넘으면 운영 알림 REPORT_OVERDUE · 「오늘 할 일」에 기한 넘김(1 ~ 168시간).',
   false, '^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$', '24'),
  ('ops.restore_drill_days', '30', 'ADMIN',
   'DB 복원 시험 주기(v10.368 · docs/503) — 마지막 복원 시험이 이 날 수보다 오래되면(한 번도 없으면) 운영 알림 RESTORE_DRILL_DUE(7 ~ 180일).',
   false, '^([7-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.export_requests (
  id           bigserial PRIMARY KEY,
  target       text NOT NULL CHECK (target IN ('POINT_REPORT', 'AUDIT_EXPORT', 'NOTICE_READS', 'RATE_READS')),
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 2 AND 200),
  requested_by uuid NOT NULL REFERENCES public.accounts(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  solo         boolean NOT NULL DEFAULT false,
  used_at      timestamptz,
  CONSTRAINT ck_export_requests_decided CHECK ((state = 'PENDING') = (decided_at IS NULL)),
  CONSTRAINT ck_export_requests_used CHECK (used_at IS NULL OR state = 'APPROVED')
);
CREATE INDEX IF NOT EXISTS ix_export_requests_requester ON public.export_requests (requested_by, requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_export_requests_pending ON public.export_requests (requested_at) WHERE state = 'PENDING';
COMMENT ON TABLE public.export_requests IS 'v10.366 (D238) 개인정보 대량 내려받기 승인 — 요청(사유) → 다른 SUPER 승인(SUPER 가 혼자면 solo 로 스스로) → 승인 뒤 24시간 안 한 번 내려받기(used_at) · 지우기 막음';
COMMENT ON COLUMN public.export_requests.solo IS '요청자 = 결정자(그때 SUPER 가 요청자 한 명뿐) — 월간 보안 보고에 따로 셈';

CREATE OR REPLACE FUNCTION public.fn_export_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EXPORT_REQUEST: 내려받기 요청은 지우지 않습니다.'; END IF;
  IF (NEW.target, NEW.reason, NEW.requested_by, NEW.requested_at) IS DISTINCT FROM (OLD.target, OLD.reason, OLD.requested_by, OLD.requested_at) THEN
    RAISE EXCEPTION 'EXPORT_REQUEST: 요청 내용은 바꿀 수 없습니다.';
  END IF;
  IF OLD.state = 'PENDING' AND NEW.state IN ('APPROVED', 'REJECTED') AND NEW.used_at IS NULL AND NEW.decided_by IS NOT NULL THEN
    IF NEW.decided_by = NEW.requested_by AND NOT NEW.solo THEN
      RAISE EXCEPTION 'EXPORT_REQUEST: 자기 요청은 다른 SUPER 가 승인합니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'APPROVED' AND OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
     AND (NEW.state, NEW.decided_by, NEW.decided_at, NEW.decide_note, NEW.solo) IS NOT DISTINCT FROM (OLD.state, OLD.decided_by, OLD.decided_at, OLD.decide_note, OLD.solo) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'EXPORT_REQUEST: 결정 한 번 · 내려받기 한 번만 기록합니다.';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_export_requests_guard' AND tgrelid = 'public.export_requests'::regclass) THEN
    CREATE TRIGGER trg_export_requests_guard BEFORE UPDATE OR DELETE ON public.export_requests FOR EACH ROW EXECUTE FUNCTION public.fn_export_requests_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.restore_drills (
  id         bigserial PRIMARY KEY,
  drill_date date NOT NULL,
  snapshot   text NOT NULL CHECK (char_length(snapshot) BETWEEN 2 AND 100),
  minutes    integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  rows_match boolean NOT NULL,
  ok         boolean NOT NULL,
  note       text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_restore_drills_date ON public.restore_drills (drill_date DESC);
COMMENT ON TABLE public.restore_drills IS 'v10.368 (D238) DB 복원 시험 기록 — 사람이 스냅샷을 새 DB 로 복원해 본 결과(한 날 · 스냅샷 · 걸린 분 · 행 수 대조 · 이상 여부) · 적기 SUPER · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_restore_drills_ro' AND tgrelid = 'public.restore_drills'::regclass) THEN
    CREATE TRIGGER trg_restore_drills_ro BEFORE UPDATE OR DELETE ON public.restore_drills FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.ops_guides (code, title, who, steps, note, sort_order, version)
SELECT 'RESTORE_DRILL', 'DB 복원 시험(월 1회)', 'SUPER',
       '[{"t": "AWS 콘솔 › RDS › 스냅샷에서 가장 최근 자동 스냅샷을 고릅니다."}, {"t": "「스냅샷 복원」으로 새 DB 를 만듭니다(이름 sgb-drill-날짜 · 가장 작은 크기 · 외부 접속 끔)."}, {"t": "복원이 끝날 때까지 걸린 분을 적어 둡니다."}, {"t": "운영 DB 와 새 DB 에서 accounts · listings · audit.audit_logs 행 수를 세어 비교합니다(스냅샷 뒤 늘어난 만큼 차이는 정상)."}, {"t": "아래 「복원 시험 기록」 칸에 날짜 · 스냅샷 이름 · 걸린 분 · 행 수 맞음 · 이상 여부를 적습니다.", "go": "ops-guide"}, {"t": "새 DB 를 지웁니다(마지막 스냅샷 만들지 않음) — 지우지 않으면 요금이 계속 나갑니다."}]'::jsonb,
       '운영 DB 는 건드리지 않습니다. 30일(설정 ops.restore_drill_days) 넘게 기록이 없으면 운영 알림 RESTORE_DRILL_DUE.', 120, 1
WHERE NOT EXISTS (SELECT 1 FROM public.ops_guides WHERE code = 'RESTORE_DRILL');

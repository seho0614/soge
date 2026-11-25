-- =====================================================================
-- E003 (e1.3 · docs/003) ERP 작업 실행기 — 정기 작업 목록 · 실행 기록
--   erp_jobs      작업마다 한 줄(이름 · 주기 · 켬 · 마지막 실행 · 결과) — 코드가 등록한 이름만(손으로 만든 줄은 돌지 않음)
--   erp_job_runs  실행 한 번마다(시작 · 끝 · 결과 · 메시지 · 누가 손으로 돌렸나) — 쌓기만(지우기는 90일 지난 것만 코드가)
--   겹침 막기는 pg_try_advisory_lock(작업 이름 해시) — 서버가 둘이어도 한 번만
--   주인 erp_settings erp.jobs_owner = ERP 일 때만 정기 실행(지금 SGB — 손 실행은 됨)
--   다시 돌려도 같음 · RAISE 없음
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.erp_jobs (
  name         text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{2,40}$'),
  schedule     text NOT NULL CHECK (schedule ~ '^(every [0-9]{1,4}m|daily [0-2][0-9]:[0-5][0-9])$'),
  enabled      boolean NOT NULL DEFAULT true,
  description  text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  last_run_at  timestamptz,
  last_ok      boolean,
  last_note    text CHECK (last_note IS NULL OR char_length(last_note) <= 500),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_jobs IS 'e1.3 (E003) ERP 정기 작업 — 주기 every Nm · daily HH:MM(한국 시각)';

CREATE TABLE IF NOT EXISTS public.erp_job_runs (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL REFERENCES public.erp_jobs(name),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  ok          boolean,
  note        text CHECK (note IS NULL OR char_length(note) <= 500),
  manual_by   uuid
);
CREATE INDEX IF NOT EXISTS erp_job_runs_job ON public.erp_job_runs (job, started_at DESC);

INSERT INTO public.erp_jobs (name, schedule, description) VALUES
  ('erp_heartbeat', 'every 10m', 'ERP 작업 실행기가 도는지 — 아무것도 바꾸지 않고 기록만(e1.3)'),
  ('erp_runs_purge', 'daily 04:40', '90일 지난 작업 실행 기록 지우기(e1.3)')
ON CONFLICT (name) DO NOTHING;

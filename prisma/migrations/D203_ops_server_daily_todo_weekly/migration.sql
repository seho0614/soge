-- =====================================================================
-- D203 (v10.248 · v10.249 · docs/386) — 서버 자원 하루 기록 · 대표 할 일 주간 알림
--
--   ① 표 ops_server_daily — 하루(한국 날짜) 한 줄: 디스크 사용 % · 남은 GB · 메모리 사용 %.
--      정기 작업 launch_watch(10분)가 그날 처음 잰 값을 적고 같은 날은 더 적지 않음(day 가 기본 키).
--      운영 화면 「서버 자원 추세」(최근 30일 · 85% 까지 남은 날 예상)와 하루 요약 한 줄이 읽음. 쌓기만(고치기 · 지우기는 DB 가 막음).
--   ② 설정 ops.owner_todo_weekly on — 매주 월요일 09:05 「대표 할 일」 중 아직인 줄만 텔레그램 · 슬랙으로(켜 둔 길만 · 모두 끝나면 안 보냄).
--   ③ 정기 작업 owner_todo_weekly(월요일 09:05 · 한국).
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ops_server_daily (
  day           date PRIMARY KEY,
  disk_pct      integer CHECK (disk_pct IS NULL OR disk_pct BETWEEN 0 AND 100),
  disk_free_gb  numeric(8,1) CHECK (disk_free_gb IS NULL OR disk_free_gb >= 0),
  mem_pct       integer NOT NULL CHECK (mem_pct BETWEEN 0 AND 100),
  measured_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ops_server_daily IS
  '서버 자원 하루 기록(D203 · v10.248). 한국 날짜마다 그날 처음 잰 디스크 사용 % · 남은 GB · 메모리 사용 % 한 줄 — 운영 화면 「서버 자원 추세」 · 하루 요약이 읽음. 고치거나 지울 수 없습니다.';
DROP TRIGGER IF EXISTS trg_ops_server_daily_ro ON public.ops_server_daily;
CREATE TRIGGER trg_ops_server_daily_ro BEFORE DELETE OR UPDATE ON public.ops_server_daily
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops.owner_todo_weekly', 'on', 'ADMIN',
   '대표 할 일 주간 알림(v10.249 · docs/386) — on 이면 매주 월요일 09:05 「대표 할 일」 중 아직인 줄만 텔레그램 · 슬랙으로(켜 둔 길만 · 모두 끝났으면 보내지 않음). off 면 보내지 않음.',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('owner_todo_weekly', 10080, 9, 5, 2, true, '대표 할 일 주간 알림 — 월요일 09:05 아직인 줄만 텔레그램 · 슬랙(ops.owner_todo_weekly · 켜 둔 길만 · 모두 끝나면 안 보냄) · 운영 알림 OWNER_TODO_WEEKLY · D203')
ON CONFLICT (job) DO NOTHING;

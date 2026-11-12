-- =====================================================================
-- D204 (v10.250 · docs/387) — 서버 오류(5xx) 30일 기록
--
--   지금까지 「최근 서버 오류」는 API 프로세스 메모리에서 1시간만 들고 있어 운영 적용 · 다시 띄우기 때마다 비었습니다.
--   ops_server_error_days — 날짜(한국) · 방법 · 주소(숫자 · uuid 지움 · 물음표 뒤 없음) · 오류 종류 · 응답 번호마다 건수 한 줄.
--   정기 작업 launch_watch(10분)가 메모리에 쌓인 건수를 더해 넣고(마지막 시각 · 가린 설명 · 요청 번호는 가장 최근 것으로) 30일 지난 줄을 지움.
--   남기는 것: 위 칸 · 건수 · 처음 · 마지막 시각 · 가린 설명(따옴표 값 · 이메일 · 긴 숫자 가림) · 요청 번호. 요청 내용 · 증표 · 회원 없음.
--   지우는 문장 없음(30일 지난 줄 지우기는 정기 작업이 함). 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ops_server_error_days (
  day              date NOT NULL,
  method           text NOT NULL CHECK (length(method) <= 8),
  path             text NOT NULL CHECK (length(path) <= 120),
  code             text NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  status           integer NOT NULL CHECK (status BETWEEN 500 AND 599),
  n                integer NOT NULL CHECK (n > 0),
  last_detail      text CHECK (last_detail IS NULL OR length(last_detail) <= 200),
  last_request_id  text CHECK (last_request_id IS NULL OR length(last_request_id) <= 64),
  first_at         timestamptz NOT NULL DEFAULT now(),
  last_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, method, path, code, status)
);
CREATE INDEX IF NOT EXISTS idx_ops_server_error_days_day ON public.ops_server_error_days (day DESC);
COMMENT ON TABLE public.ops_server_error_days IS
  '서버 오류(5xx) 날짜별 건수(D204 · v10.250) — 정기 작업 launch_watch 가 API 메모리의 오류를 10분마다 더함 · 30일 지나면 지움 · 요청 내용 · 회원 없음(설명은 값을 가림)';

-- =====================================================================
-- D222 v10.322 (docs/449) 소개광장 공지 「모두 읽음」 — 펼쳐 본 기록과 나눔
--   notice_reads 에 bulk 칸을 더함: true = 「모두 읽음」 단추로 읽음 표시만 함(펼치지 않음).
--   운영 화면 「펼쳐 본 회원 수」는 bulk 를 빼고 셈. 요율 변경 공지(hlt_rate_schedules
--   notice_id · cancel_notice_id)는 「모두 읽음」 대상이 아님(입점 약관 제17조 4항 증거).
--   나중에 실제로 펼치면 bulk = false 로 바뀜(처음 펼친 때부터 다시 셈).
--   지우는 문장 없음. 재실행 안전(ADD COLUMN IF NOT EXISTS).
-- =====================================================================

ALTER TABLE public.notice_reads ADD COLUMN IF NOT EXISTS bulk boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.notice_reads.bulk IS 'v10.322 (D222) true = 소개광장 「모두 읽음」으로 읽음 표시만(펼치지 않음) · 펼쳐 본 회원 수에서 뺌';

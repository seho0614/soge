-- =====================================================================
-- D113 — v10.89 멈춘 배치 점검(v_job_stale)이 주 1회 배치를 하루 주기로 보던 것 고침 (2026-10-24 · docs/143)
--
--   대표 결정(2026-10-24 「3」)
--
--   v_job_stale 은 「주기(every_min)의 3배가 지나도록 안 돈 배치」를 멈춘 것으로 봅니다.
--   settlement_audit(수요일 10:00 · at_dow 4)는 every_min 칸이 1440(하루)이라 3일 뒤부터 멈춤으로 떠
--   목 · 금 · 토 postcheck 에서 「멈춘 배치 1건」 거짓 실패가 났습니다(운영 v10.85 적용 2026-10-24 토 · 마지막 실행 10/21 수).
--   요일이 정해진 배치(at_dow)는 주기를 7일(10080분)로 보고 그 3배(21일)로 판단합니다.
--   배치가 언제 도는지(fn_jobs_due)는 바뀌지 않습니다. job_schedules 자료도 그대로입니다.
--
--   열 · 순서 · 이름은 그대로(CREATE OR REPLACE VIEW). postcheck.sh 가 이 뷰를 그대로 씁니다.
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
CREATE OR REPLACE VIEW public.v_job_stale AS
 SELECT s.job,
    s.description,
    s.every_min,
    max(r.started_at) AS last_run,
    (now() - max(r.started_at)) AS since,
    (max(r.started_at) IS NULL) AS never_ran
   FROM (public.job_schedules s
     LEFT JOIN public.job_runs r ON ((r.job = s.job)))
  WHERE s.is_active
  GROUP BY s.job, s.description, s.every_min, s.at_dow
 HAVING ((max(r.started_at) IS NULL) OR (max(r.started_at) < (now() - ((((CASE WHEN s.at_dow IS NOT NULL THEN 10080 ELSE s.every_min END) * 3) || ' minutes'::text))::interval)));   -- D113 — 요일 배치는 7일 주기

COMMENT ON VIEW public.v_job_stale IS '주기의 3배가 지나도록 안 돈 작업(요일이 정해진 작업은 7일 주기로 봄 · D113). 비어 있어야 정상입니다 — 구독 청구가 여기 뜨면 매출이 멈춘 것이고, pii_purge 가 뜨면 법적 문제입니다.';

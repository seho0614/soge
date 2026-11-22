-- =====================================================================
-- D307 (v10.627 · docs/771 · v10.631 · docs/775 · v10.634 · docs/778) 정기 작업 연속 실패 알림 · 권한 COMPARE 하루 요약 · 설명서 3만 자
--
--   ops.job_fail_streak : 같은 정기 작업이 이 수만큼 연달아 실패하면 운영 알림 JOB_FAILING(CRITICAL · 작업마다 한 번 · 다음 차례 성공이면 풀림)
--                         처음 3 · 0 = 끔 · 2 ~ 10 · 알림만이라 처음 값 있음
--   PERM_COMPARE_DIFF   : 설정 없음 — perm.mode = COMPARE 일 때만 정기 작업 sec2_tick 이 08시(한국) 뒤 어제 하루치를 한 번 알림(다름 있음 WARN · 0 INFO)
--   함수 fn_job_fail_watch(작업 · 성공) · fn_perm_compare_daily(시각) — 표 · 트리거 바꿈 없음 · 다시 돌려도 같음 · 지우는 문장 없음 · RAISE 글자에 퍼센트 기호 없음
-- =====================================================================
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('ops.job_fail_streak', '3', 'ADMIN', '정기 작업 연속 실패 알림(v10.627 · docs/771) — 같은 작업이 이 수만큼 연달아 실패하면 운영 알림 JOB_FAILING(CRITICAL · 작업마다 한 번 · 다음 차례 성공이면 풀림 · 이 판에 없는 작업은 WARN) · 0 = 끔 · 2 ~ 10 · 처음 3 · 알림만이라 처음 값 있음', false, '^(0|[2-9]|10)$', '3')
ON CONFLICT (key) DO NOTHING;

-- ── v10.627 정기 작업 연속 실패 확인 — tick() 이 차례마다 부름(job-fail-watch.ts) · 시험도 직접 부름 ─────────────
--   p_ok = true  → 그 작업의 풀리지 않은 JOB_FAILING 을 「다음 차례 성공」 으로 풂 · 돌려주는 값 = 푼 수 × -1
--   p_ok = false → 최근 끝난 차례 N개(ops.job_fail_streak)가 모두 실패면 알림 한 번(작업마다 풀리지 않은 것 하나) · 돌려주는 값 = 만든 수(0 · 1)
CREATE OR REPLACE FUNCTION public.fn_job_fail_watch(p_job text, p_ok boolean) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  n int := public.fn_setting_int('ops.job_fail_streak', 3);
  k int; bad int; last text; unk boolean; made int := 0;
BEGIN
  IF n IS NULL OR n <= 0 THEN RETURN 0; END IF;
  IF p_ok THEN
    UPDATE public.ops_alerts SET resolved_at = now(), resolve_note = '다음 차례 성공'
     WHERE alert_code = 'JOB_FAILING' AND resolved_at IS NULL AND detail->>'job' = p_job;
    GET DIAGNOSTICS k = ROW_COUNT;
    RETURN -k;
  END IF;
  SELECT count(*), count(*) FILTER (WHERE ok IS FALSE) INTO k, bad
    FROM (SELECT ok FROM public.job_runs WHERE job = p_job AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT n) x;
  IF k < n OR bad < n THEN RETURN 0; END IF;
  SELECT left(coalesce(detail, ''), 300) INTO last FROM public.job_runs WHERE job = p_job AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1;
  unk := last LIKE 'UNKNOWN_JOB%';
  INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
  SELECT 'JOB_FAILING', CASE WHEN unk THEN 'WARN' ELSE 'CRITICAL' END,
         '정기 작업 「' || p_job || '」 ' || n || '번 연속 실패 — 운영 알림 › 배치 실행 기록 확인 · 마지막 오류: ' || left(last, 120),
         jsonb_build_object('job', p_job, 'streak', n, 'last', last, 'unknown', unk), clock_timestamp()
   WHERE NOT EXISTS (SELECT 1 FROM public.ops_alerts WHERE alert_code = 'JOB_FAILING' AND resolved_at IS NULL AND detail->>'job' = p_job)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS made = ROW_COUNT;
  RETURN made;
END $fn$;
COMMENT ON FUNCTION public.fn_job_fail_watch(text, boolean) IS 'v10.627 (D307 · docs/771) 정기 작업 연속 실패 알림 JOB_FAILING — 실패면 최근 N차례(ops.job_fail_streak) 모두 실패일 때 한 번 · 성공이면 풂';

-- ── v10.631 권한 COMPARE 「다름」 하루 요약 — sec2_tick 이 10분마다 부름 · p_now 는 시험용(지난 날짜로 돌려 봄) ─────────────
--   perm.mode = COMPARE 일 때만 · p_now 의 한국 시각 08시 뒤 · 그 전날(한국) 하루치 · 그날 알림이 이미 있으면 건너뜀
--   돌려주는 값: -1 건너뜀 · 0 이상 = 그날 다름 수(알림 만듦)
CREATE OR REPLACE FUNCTION public.fn_perm_compare_daily(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  d date := (p_now AT TIME ZONE 'Asia/Seoul')::date - 1;
  t0 timestamptz; t1 timestamptz; total int; routes int; top jsonb; ttl text;
BEGIN
  IF coalesce((SELECT value FROM public.site_settings WHERE key = 'perm.mode'), 'ROLE') <> 'COMPARE' THEN RETURN -1; END IF;
  IF (p_now AT TIME ZONE 'Asia/Seoul')::time < time '08:00' THEN RETURN -1; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_alerts WHERE alert_code = 'PERM_COMPARE_DIFF' AND detail->>'day' = d::text) THEN RETURN -1; END IF;
  t0 := d::timestamp AT TIME ZONE 'Asia/Seoul'; t1 := (d + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  WITH g AS (
    SELECT method, pattern, diff, count(*)::int AS n FROM public.perm_shadow_log
     WHERE mode = 'COMPARE' AND diff IS NOT NULL AND created_at >= t0 AND created_at < t1
     GROUP BY method, pattern, diff)
  SELECT coalesce(sum(n), 0)::int, count(*)::int,
         coalesce((SELECT jsonb_agg(jsonb_build_object('method', method, 'pattern', pattern, 'diff', diff, 'n', n) ORDER BY n DESC, method, pattern)
                     FROM (SELECT * FROM g ORDER BY n DESC, method, pattern LIMIT 5) x), '[]'::jsonb)
    INTO total, routes, top FROM g;
  ttl := CASE WHEN total > 0
    THEN '권한 COMPARE 어제(' || d || ') 다름 ' || total || '건 · 주소 ' || routes || '곳 — 직원 · 권한 › 업무별 권한 › 판정 방식에서 확인'
    ELSE '권한 COMPARE 어제(' || d || ') 다름 0 — GROUPS 로 바꾸는 조건 하루치 채움(직원 · 권한 › 업무별 권한 › 판정 방식 점검표)' END;
  INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
  VALUES ('PERM_COMPARE_DIFF', CASE WHEN total > 0 THEN 'WARN' ELSE 'INFO' END, ttl,
          jsonb_build_object('day', d::text, 'total', total, 'routes', routes, 'top', top), clock_timestamp())
  ON CONFLICT DO NOTHING;
  RETURN total;
END $fn$;
COMMENT ON FUNCTION public.fn_perm_compare_daily(timestamptz) IS 'v10.631 (D307 · docs/775) 권한 COMPARE 다름 하루 요약 PERM_COMPARE_DIFF — COMPARE 일 때만 · 08시 뒤 어제 · 하루 한 번(다름 WARN · 0 INFO)';

-- ── v10.634 (docs/778) 사용자 설명서 저장 한도 2만 → 3만 자 — help_docs_body_len(D305)을 새 값으로(운영 화면 도움말 4만 자 그대로) ─────────────
--   이미 3만이면 건너뜀(다시 돌려도 같음) · 줄을 고치거나 지우지 않음
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.help_docs'::regclass AND conname = 'help_docs_body_len'
              AND pg_get_constraintdef(oid) NOT LIKE '%30000%') THEN
    ALTER TABLE public.help_docs DROP CONSTRAINT help_docs_body_len;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.help_docs'::regclass AND conname = 'help_docs_body_len') THEN
    ALTER TABLE public.help_docs ADD CONSTRAINT help_docs_body_len
      CHECK (char_length(body) >= 100 AND char_length(body) <= CASE WHEN code = 'ADMIN_GUIDE' THEN 40000 ELSE 30000 END);
  END IF;
END
$do$;

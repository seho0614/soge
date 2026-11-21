/* ── v10.585 (docs/727) 14차 운영 ① DB 복원 반자동 리허설 — 기존 「DB 복원 시험 기록」(D238 restore_drills)을 넓힘 ──
 *   ① restore_drills 에 칸 두 개: source(MANUAL 사람이 적음 · SCRIPT 스크립트 결과 붙여 넣음) · detail(스크립트가 센 표마다 행 수 · 도구 판 · 방식)
 *      · 쌓기만 트리거(trg_restore_drills_ro · fn_block_write)는 그대로 — 칸 더하기는 줄을 고치지 않음
 *   ② 설정 ops2.drill_tol_pct(5) — 스냅샷 뒤 늘어난 줄로 보는 차이 한도(퍼센트 · 서버가 행 수 맞음을 다시 셈)
 *   ③ 업무 안내 RESTORE_DRILL 새 판(스크립트 순서) — 이미 스크립트 판이 있으면 더하지 않음
 *   ④ ㉕ 권한(D258) — 새 주소 두 줄을 업무 ops-guide 에(복원 시험 기록이 있는 탭)
 *   지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음 */

ALTER TABLE public.restore_drills ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE public.restore_drills ADD COLUMN IF NOT EXISTS detail jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_restore_drills_source' AND conrelid = 'public.restore_drills'::regclass) THEN
    ALTER TABLE public.restore_drills ADD CONSTRAINT ck_restore_drills_source CHECK (source IN ('MANUAL', 'SCRIPT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_restore_drills_detail' AND conrelid = 'public.restore_drills'::regclass) THEN
    ALTER TABLE public.restore_drills ADD CONSTRAINT ck_restore_drills_detail
      CHECK (detail IS NULL OR (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 8000));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_restore_drills_script ON public.restore_drills (drill_date DESC) WHERE source = 'SCRIPT';
COMMENT ON COLUMN public.restore_drills.source IS 'v10.585 (docs/727) MANUAL 사람이 칸을 적음 · SCRIPT deploy/aws/restore-drill.sh 결과를 붙여 넣음(서버가 행 수 맞음을 다시 셈)';
COMMENT ON COLUMN public.restore_drills.detail IS 'v10.585 스크립트 결과 — {tool, mode(aws · console), tolPct, tables:[{name, src, drill}]} · 행 수만(회원 · 내용 없음)';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops2.drill_tol_pct', '5', 'ADMIN',
   'DB 복원 시험 행 수 차이 한도(v10.585 · docs/727) — 복원 DB 가 운영 DB 보다 많으면 다름 · 적은 것은 이 퍼센트(또는 100줄)까지 스냅샷 뒤 늘어난 것으로 봄(0 ~ 50).',
   false, '^([0-9]|[1-4][0-9]|50)$', '5')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.ops_guides (code, title, who, steps, note, sort_order, version)
SELECT 'RESTORE_DRILL', 'DB 복원 시험(월 1회)', 'SUPER',
       '[{"t": "운영 서버에서 ubuntu 로 bash ~/sgb/deploy/aws/restore-drill.sh 를 먼저 읽기만으로 돌려 순서를 봅니다."},
         {"t": "bash ~/sgb/deploy/aws/restore-drill.sh --run — 운영 DB 행 수를 먼저 셉니다(읽기만)."},
         {"t": "aws 명령이 있으면 스크립트가 가장 최근 자동 스냅샷을 새 DB(sgb-drill-날짜 · 외부 접속 끔)로 복원하고 끝날 때까지 기다립니다. 없으면 AWS 콘솔 › RDS › 스냅샷 복원을 누른 뒤 Enter, 다 되면 새 DB 주소를 넣습니다."},
         {"t": "스크립트가 새 DB 행 수를 세어 운영 DB 와 견주고(늘어난 만큼 차이는 정상) 걸린 분을 잽니다."},
         {"t": "화면 끝 「붙여 넣을 결과」 JSON 을 복사해 아래 「스크립트 결과 붙여 넣기」에 넣고 적습니다.", "go": "ops-guide"},
         {"t": "새 DB 를 지웁니다(aws 방식은 스크립트가 yes 를 받고 지움 · 콘솔 방식은 마지막 스냅샷 없이 직접 지움) — 지우지 않으면 요금이 계속 나갑니다."}]'::jsonb,
       '운영 DB 는 읽기만 합니다(복원 DB 주소가 운영 DB 와 같으면 스크립트가 멈춤). 스크립트 리허설은 개발 서버 tools/restore-drill-rehearse.sh(v10.585 · docs/727).',
       120, coalesce((SELECT max(version) FROM public.ops_guides WHERE code = 'RESTORE_DRILL'), 0) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.ops_guides WHERE code = 'RESTORE_DRILL' AND position('restore-drill.sh' in steps::text) > 0);

/* ㉕ 권한(D258) — 복원 시험 기록이 있는 업무 안내(ops-guide) 탭 · 보기 VIEW · 붙여 넣기 EDIT(서버 @Roles 는 SUPER) */
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/ops2/restore-drills/script', 'ops-guide', 'VIEW'),
  ('POST', '/admin/ops2/restore-drills/result', 'ops-guide', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

/* ── v10.587 (docs/729) 14차 운영 ③ 서버 오류 묶기 — 기존 「서버 오류 30일 기록」(D204 ops_server_error_days) 재사용 ──
 *   ops2_error_groups — 지문(방법 · 주소 · 오류 종류 · 응답 번호 · DB 오류 번호)마다 한 줄: 처음 · 마지막 · 모든 횟수 · 난 날 수 · 상태
 *     · 넣는 곳은 ops_server_error_days 의 트리거(정기 작업 launch_watch 가 10분마다 더할 때) — 서버 코드는 고치지 않음
 *     · 30일 기록이 지워져도 묶음 줄은 남음(지문 · 횟수 · 가린 설명뿐 — 요청 내용 · 회원 없음)
 *   처음 나면(또는 「고침」으로 둔 것이 다시 나면) 운영 알림 SERVER_ERROR_NEW · SERVER_ERROR_REOPEN(WARN)
 *     · 스위치 ops2.error_new_alert(처음 on — 알리기만 하는 것이라 켬 · 끄면 묶기만) · 한 시간 10건까지(넘으면 묶음 줄에 「알림 못 함」)
 *     · 「알리지 않음(MUTED)」은 다시 나도 알리지 않음
 *   ★ 트리거는 실패해도 오류를 내지 않음 — 넣기가 실패하면 launch_watch 가 건수를 되돌려 두 번 세기 때문
 *   이미 있는 30일 기록으로 처음 채움(알림 없음) · 지우는 문장 없음 · 다시 돌려도 같음 · RAISE 글자에 퍼센트 기호 없음 */

CREATE TABLE IF NOT EXISTS public.ops2_error_groups (
  fp              text PRIMARY KEY CHECK (fp ~ '^[0-9a-f]{32}$'),
  method          text NOT NULL CHECK (length(method) <= 8),
  path            text NOT NULL CHECK (length(path) <= 120),
  code            text NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  status          integer NOT NULL CHECK (status BETWEEN 500 AND 599),
  pg_code         text CHECK (pg_code IS NULL OR pg_code ~ '^[0-9A-Z]{5}$'),
  sample_detail   text CHECK (sample_detail IS NULL OR length(sample_detail) <= 200),
  last_request_id text CHECK (last_request_id IS NULL OR length(last_request_id) <= 64),
  first_at        timestamptz NOT NULL DEFAULT now(),
  last_at         timestamptz NOT NULL DEFAULT now(),
  last_day        date NOT NULL,
  total_n         bigint NOT NULL DEFAULT 0 CHECK (total_n >= 0),
  days_seen       integer NOT NULL DEFAULT 1 CHECK (days_seen >= 1),
  state           text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'ACK', 'MUTED', 'FIXED')),
  state_note      text CHECK (state_note IS NULL OR char_length(state_note) <= 200),
  state_by        uuid REFERENCES public.accounts(id),
  state_at        timestamptz,
  reopened_n      integer NOT NULL DEFAULT 0 CHECK (reopened_n >= 0),
  alerted_at      timestamptz,
  alert_skipped   boolean NOT NULL DEFAULT false,
  backfilled      boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_ops2_error_groups_last ON public.ops2_error_groups (last_at DESC);
CREATE INDEX IF NOT EXISTS ix_ops2_error_groups_open ON public.ops2_error_groups (last_at DESC) WHERE state = 'OPEN';
COMMENT ON TABLE public.ops2_error_groups IS
  'v10.587 (docs/729) 서버 오류 묶음 — 지문(방법 · 주소 · 종류 · 응답 · DB 오류 번호)마다 처음 · 마지막 · 횟수 · 상태 · ops_server_error_days 트리거가 채움 · 요청 내용 · 회원 없음';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops2.error_new_alert', 'on', 'ADMIN',
   '처음 보는 서버 오류 알림(v10.587 · docs/729) — on 이면 새 오류 묶음 · 고친 오류가 다시 나면 운영 알림 SERVER_ERROR_NEW · SERVER_ERROR_REOPEN(한 시간 10건까지) · off 면 묶기만.',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

/* 지문 — 방법 | 주소 | 종류 | 응답 | DB 오류 번호(가린 설명 앞 [42702] · 없으면 빈칸) */
CREATE OR REPLACE FUNCTION public.fn_ops2_error_fp(p_method text, p_path text, p_code text, p_status integer, p_detail text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(coalesce(p_method, '') || '|' || coalesce(p_path, '') || '|' || coalesce(p_code, '') || '|' || coalesce(p_status, 0)::text
             || '|' || coalesce(substring(coalesce(p_detail, '') from '^\[([0-9A-Z]{5})\]'), ''))
$$;

CREATE OR REPLACE FUNCTION public.fn_ops2_error_group_touch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_fp    text;
  v_pg    text;
  v_delta integer;
  v_new   boolean := false;
  v_reopen boolean := false;
  v_state text;
  v_on    boolean;
  v_recent integer;
  v_title text;
BEGIN
  BEGIN
    v_delta := CASE WHEN TG_OP = 'INSERT' THEN NEW.n ELSE NEW.n - OLD.n END;
    IF v_delta IS NULL OR v_delta <= 0 THEN RETURN NEW; END IF;
    v_fp := public.fn_ops2_error_fp(NEW.method, NEW.path, NEW.code, NEW.status, NEW.last_detail);
    v_pg := substring(coalesce(NEW.last_detail, '') from '^\[([0-9A-Z]{5})\]');

    INSERT INTO public.ops2_error_groups (fp, method, path, code, status, pg_code, sample_detail, last_request_id, first_at, last_at, last_day, total_n, days_seen)
    VALUES (v_fp, NEW.method, NEW.path, NEW.code, NEW.status, v_pg, NEW.last_detail, NEW.last_request_id, coalesce(NEW.first_at, now()), coalesce(NEW.last_at, now()), NEW.day, v_delta, 1)
    ON CONFLICT (fp) DO NOTHING
    RETURNING true INTO v_new;

    IF v_new IS NULL THEN
      v_new := false;
      SELECT state INTO v_state FROM public.ops2_error_groups WHERE fp = v_fp FOR UPDATE;
      v_reopen := v_state = 'FIXED';
      UPDATE public.ops2_error_groups
         SET total_n = total_n + v_delta,
             last_at = greatest(last_at, coalesce(NEW.last_at, now())),
             days_seen = days_seen + CASE WHEN NEW.day > last_day THEN 1 ELSE 0 END,
             last_day = greatest(last_day, NEW.day),
             sample_detail = coalesce(NEW.last_detail, sample_detail),
             last_request_id = coalesce(NEW.last_request_id, last_request_id),
             state = CASE WHEN v_reopen THEN 'OPEN' ELSE state END,
             state_note = CASE WHEN v_reopen THEN '고침으로 둔 뒤 다시 남' ELSE state_note END,
             state_by = CASE WHEN v_reopen THEN NULL ELSE state_by END,
             state_at = CASE WHEN v_reopen THEN clock_timestamp() ELSE state_at END,
             reopened_n = reopened_n + CASE WHEN v_reopen THEN 1 ELSE 0 END
       WHERE fp = v_fp;
    END IF;

    IF v_new OR v_reopen THEN
      v_on := coalesce((SELECT value FROM public.site_settings WHERE key = 'ops2.error_new_alert'), 'on') = 'on';
      IF v_on THEN
        SELECT count(*) INTO v_recent FROM public.ops_alerts
         WHERE alert_code IN ('SERVER_ERROR_NEW', 'SERVER_ERROR_REOPEN') AND raised_at > now() - interval '1 hour';
        IF v_recent < 10 THEN
          v_title := CASE WHEN v_reopen THEN '고친 서버 오류가 다시 납니다 — ' ELSE '처음 보는 서버 오류 — ' END
                     || NEW.method || ' ' || NEW.path || ' · ' || NEW.status || ' ' || NEW.code || coalesce(' [' || v_pg || ']', '')
                     || ' · 위험감지 › 서버 오류 › 오류 묶음';
          INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
          VALUES (CASE WHEN v_reopen THEN 'SERVER_ERROR_REOPEN' ELSE 'SERVER_ERROR_NEW' END, 'WARN', left(v_title, 300),
                  jsonb_build_object('fp', v_fp, 'method', NEW.method, 'path', NEW.path, 'code', NEW.code, 'status', NEW.status,
                                     'pgCode', v_pg, 'detail', NEW.last_detail, 'requestId', NEW.last_request_id), clock_timestamp())
          ON CONFLICT DO NOTHING;
          UPDATE public.ops2_error_groups SET alerted_at = clock_timestamp(), alert_skipped = false WHERE fp = v_fp;
        ELSE
          UPDATE public.ops2_error_groups SET alert_skipped = true WHERE fp = v_fp;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING USING MESSAGE = 'OPS2_ERROR_GROUP: 묶기 실패(건수 넣기는 그대로) ' || SQLERRM;
  END;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fn_ops2_error_group_touch() IS 'v10.587 (docs/729) ops_server_error_days 에 건수가 더해질 때 오류 묶음(ops2_error_groups)에 더함 · 처음 · 다시 나면 운영 알림 · 실패해도 오류 내지 않음';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ops2_error_group_touch' AND tgrelid = 'public.ops_server_error_days'::regclass) THEN
    CREATE TRIGGER trg_ops2_error_group_touch AFTER INSERT OR UPDATE OF n ON public.ops_server_error_days
      FOR EACH ROW EXECUTE FUNCTION public.fn_ops2_error_group_touch();
  END IF;
END $$;

/* 처음 채움 — 이미 있는 30일 기록(알림 없음 · backfilled) · 이미 묶음 줄이 있으면 건너뜀 */
INSERT INTO public.ops2_error_groups (fp, method, path, code, status, pg_code, sample_detail, last_request_id, first_at, last_at, last_day, total_n, days_seen, backfilled)
SELECT x.fp, x.method, x.path, x.code, x.status, x.pg, x.detail, x.rq, x.first_at, x.last_at, x.last_day, x.n, x.days, true
  FROM (
    SELECT public.fn_ops2_error_fp(e.method, e.path, e.code, e.status, e.last_detail) AS fp,
           min(e.method) AS method, min(e.path) AS path, min(e.code) AS code, min(e.status) AS status,
           min(substring(coalesce(e.last_detail, '') from '^\[([0-9A-Z]{5})\]')) AS pg,
           (array_agg(e.last_detail ORDER BY e.last_at DESC))[1] AS detail,
           (array_agg(e.last_request_id ORDER BY e.last_at DESC))[1] AS rq,
           min(e.first_at) AS first_at, max(e.last_at) AS last_at, max(e.day) AS last_day, sum(e.n)::bigint AS n, count(DISTINCT e.day)::int AS days
      FROM public.ops_server_error_days e
     GROUP BY 1
  ) x
ON CONFLICT (fp) DO NOTHING;

/* ㉕ 권한(D258) — 서버 오류 탭(server-errors)에 주소 두 줄 */
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/ops2/error-groups', 'server-errors', 'VIEW'),
  ('POST', '/admin/ops2/error-groups/{fp}/state', 'server-errors', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('ops2.error_new_alert', 'on', '그대로 — 알림이 너무 잦으면 묶음마다 「알리지 않음」을 먼저(스위치를 끄면 새 오류도 모름)', 'docs/729')
ON CONFLICT (key) DO NOTHING;
/* ── v10.588 (docs/730) 14차 운영 ④ 사용자 웹 느린 화면 측정(웹 바이탈) — 기존 「회원 화면 사용 통계」(D274) 방식을 따름 ──
 *   ops2_vitals — 한 줄 = 화면 하나에서 잰 값 하나(날 · 시 · 화면 주소 묶음 · 지표 · 값 · 등급)
 *     · 남기지 않는 것: 계정 · IP · 브라우저 정보 · 방문자 키 · 쿠키 · 물음표 뒤(주소의 번호 · 코드는 :id — D274 normPath 와 같은 묶기)
 *     · 보관 ops2.web_vitals_keep_days(30일) — 받는 길에서 한 시간에 한 번 지움
 *   스위치 ops2.web_vitals(처음 off · 켜기 SUPER — 전체 설정 SUPER 목록에 더함) · 표본 ops2.web_vitals_sample(10 퍼센트 · 탭마다 한 번)
 *     · 처리방침 1.2 게시 뒤 켬(「서비스 이용 기록 — 화면 표시 속도」 · 법무 확인 · docs/730 5절)
 *   ㉕ 권한(D258) — 새 탭 「화면 속도」(web-vitals · 위험감지 · 서버 오류 뒤) · 처음 변환 그룹 R_ADMIN(@Roles ADMIN · SUPER 와 같음)
 *   지우는 문장 없음 · 다시 돌려도 같음 · RAISE 없음 */

CREATE TABLE IF NOT EXISTS public.ops2_vitals (
  id      bigserial PRIMARY KEY,
  day     date NOT NULL,
  hour    smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  path    text NOT NULL CHECK (path ~ '^/[A-Za-z0-9/_:.-]{0,119}$'),
  metric  text NOT NULL CHECK (metric IN ('LCP', 'INP', 'CLS', 'FCP', 'TTFB')),
  value   numeric(12, 4) NOT NULL CHECK (value >= 0 AND value < 600000),
  rating  text NOT NULL CHECK (rating IN ('GOOD', 'NI', 'POOR'))
);
CREATE INDEX IF NOT EXISTS ix_ops2_vitals_day ON public.ops2_vitals (day, metric);
CREATE INDEX IF NOT EXISTS ix_ops2_vitals_path ON public.ops2_vitals (path, metric, day);
COMMENT ON TABLE public.ops2_vitals IS
  'v10.588 (docs/730) 사용자 웹 화면 속도(LCP · INP · CLS · FCP · TTFB) — 날 · 시 · 화면 주소 묶음 · 값 · 등급만(계정 · IP · 브라우저 정보 · 방문자 키 없음) · 보관 ops2.web_vitals_keep_days';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('ops2.web_vitals', 'off', 'GLOBAL',
   '사용자 웹 화면 속도 재기(v10.588 · docs/730) — 처음 off · on 이면 화면이 화면 주소 · 지표 · 값만 보냄(계정 · IP · 방문자 키 · 쿠키 없음 · DNT · GPC 존중) · 켜기 SUPER · 처리방침 1.2 게시 뒤.',
   false, '^(on|off)$', 'off'),
  ('ops2.web_vitals_sample', '10', 'GLOBAL',
   '화면 속도 표본(v10.588) — 브라우저 탭 100개 중 몇 개에서 잴지(1 ~ 100 · 탭마다 한 번 정함).',
   false, '^([1-9]|[1-9][0-9]|100)$', '10'),
  ('ops2.web_vitals_keep_days', '30', 'ADMIN',
   '화면 속도 보관 날 수(v10.588) — 지난 줄은 받는 길에서 한 시간에 한 번 지움(7 ~ 180).',
   false, '^([7-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('web-vitals', '화면 속도', 'admrsk', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 545)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'web-vitals', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/ops2/web-vitals', 'web-vitals', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('ops2.web_vitals', 'off', '처리방침 1.2 에 「화면 표시 속도(화면 주소 · 지표 값)」 게시 · 법무 확인 뒤 SUPER', 'docs/730')
ON CONFLICT (key) DO NOTHING;

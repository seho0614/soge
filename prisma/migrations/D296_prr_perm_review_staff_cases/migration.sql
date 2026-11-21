-- v10.566 (docs/708) — 권한 정기 점검 자동화: 분기 「거둘 후보」(90일 안 쓴 권한그룹 · 오래 로그인 안 함 · 외부 계정 기한 없음 · 역할 기한 지나고 권한 남음 · 기한 지난 권한 줄 · 퇴사자 권한) · SUPER 한 번에 거두기
--   대표 11/21 「모두 개발진행」. 앞머리 prr_. 다시 돌려도 같음. 표 · 칸을 지우지 않음.
--   RAISE 글자에 퍼센트 기호 없음 · 트리거 이름 고유 · 운영 알림은 clock_timestamp() · INV-9 · INV-11 낱말 칸 없음.
--   마이그레이션 번호는 메인이 정함(이 파일 다음에 prr_2_v10568_staff_cases.sql).

/* ── ① 업무 사용 기록 (prr_task_use) ─────────────────────────────────────────
 *   PermGuard 가 운영 역할 API 요청을 볼 때 그 주소의 업무(perm_route_map)를 계정마다 하루 한 번 「마지막 쓴 날」로 남김(SUPER 는 안 남김)
 *   「90일 안 쓴 권한그룹」 = 붙은 지 90일 넘었고 그 그룹이 여는 업무(fn_perm_group_expand)를 90일 동안 한 번도 안 씀
 *   주소 · 시각 · 내용은 남기지 않음(계정 · 업무 · 날짜만 · 개인정보 아님) */
CREATE TABLE IF NOT EXISTS public.prr_task_use (
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  task_key    text NOT NULL REFERENCES public.perm_tasks(key),
  last_on     date NOT NULL,
  PRIMARY KEY (account_id, task_key)
);
CREATE INDEX IF NOT EXISTS ix_prr_task_use_last ON public.prr_task_use (last_on);
COMMENT ON TABLE public.prr_task_use IS 'v10.566 (docs/708) 계정마다 업무(탭)를 마지막으로 쓴 날 — 권한 정기 점검 「안 쓴 권한그룹」 셈용 · 하루 한 번 고침';

/* ── ② 분기 거둘 후보 ───────────────────────────────────────────────────────────
 *   분기마다 한 묶음(quarter = 분기 첫날) · 다시 만들면 새 후보만 더하고 대상이 이미 없어진 열린 줄은 GONE
 *   결정(REVOKED 거둠 · KEPT 둠 · GONE 없어짐)은 한 번만 — 지우지 않음 */
CREATE TABLE IF NOT EXISTS public.prr_reviews (
  quarter         date PRIMARY KEY CHECK (extract(day FROM quarter) = 1 AND extract(month FROM quarter) IN (1, 4, 7, 10)),
  first_built_at  timestamptz NOT NULL DEFAULT now(),
  last_built_at   timestamptz NOT NULL DEFAULT now(),
  last_built_by   uuid REFERENCES public.accounts(id),
  runs            integer NOT NULL DEFAULT 1 CHECK (runs >= 1),
  counts          jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE public.prr_reviews IS 'v10.566 (docs/708) 분기 권한 점검 묶음 — 만든 때 · 횟수 · 종류별 수(정기 작업 prr_daily 또는 SUPER 「후보 다시 만들기」)';

CREATE TABLE IF NOT EXISTS public.prr_review_items (
  id           bigserial PRIMARY KEY,
  quarter      date NOT NULL REFERENCES public.prr_reviews(quarter),
  kind         text NOT NULL CHECK (kind IN ('LEFT_STAFF', 'LOGIN_IDLE', 'GROUP_IDLE', 'EXTERNAL_NO_EXPIRY', 'ROLE_GONE', 'EXPIRED_LEFTOVER')),
  account_id   uuid NOT NULL REFERENCES public.accounts(id),
  target_kind  text NOT NULL CHECK (target_kind IN ('ROLE', 'GROUP', 'OVERRIDE')),
  target       text NOT NULL CHECK (char_length(target) BETWEEN 1 AND 60),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  state        text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'REVOKED', 'KEPT', 'GONE')),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quarter, account_id, target_kind, target)
);
CREATE INDEX IF NOT EXISTS ix_prr_review_items_open ON public.prr_review_items (quarter) WHERE state = 'OPEN';
COMMENT ON TABLE public.prr_review_items IS 'v10.566 (docs/708) 분기 거둘 후보 한 줄 = 계정 하나의 역할 · 권한그룹 · 개별 권한 하나 · 결정은 한 번(OPEN → REVOKED · KEPT · GONE) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_prr_review_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PRR_ITEM_KEEP: 거둘 후보 기록은 지우지 않습니다.';
  END IF;
  IF OLD.state <> 'OPEN' THEN
    RAISE EXCEPTION 'PRR_ITEM_DECIDED: 이미 결정한 후보는 바꿀 수 없습니다.';
  END IF;
  IF NEW.quarter IS DISTINCT FROM OLD.quarter OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.target_kind IS DISTINCT FROM OLD.target_kind OR NEW.target IS DISTINCT FROM OLD.target THEN
    RAISE EXCEPTION 'PRR_ITEM_KEEP: 후보의 대상은 바꾸지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prr_review_item_guard' AND tgrelid = 'public.prr_review_items'::regclass) THEN
    CREATE TRIGGER trg_prr_review_item_guard BEFORE UPDATE OR DELETE ON public.prr_review_items FOR EACH ROW EXECUTE FUNCTION public.fn_prr_review_item_guard();
  END IF;
END $$;

/* ── ③ 설정 · 스위치 ─────────────────────────────────────────────────────────────
 *   안 쓴 기간은 기존 ops.role_idle_days(90 · v10.180 권한 점검과 같은 값)를 씀 — 새 설정 없음
 *   prr.use_since  업무 사용 기록을 모으기 시작한 날(이 마이그레이션 날 · 한국 날짜) — 이날부터 안 쓴 기간이 지나야 「안 쓴 권한그룹」을 셈(처음 90일은 셈하지 않음)
 *   prr.review_auto 처음 on — 후보를 만들고 알림만(거두기는 SUPER 가 화면에서) · 계약 「알림 · 표시만 하는 것은 on 가능」 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('prr.use_since', to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD'), 'ADMIN',
   'v10.566 업무 사용 기록을 모으기 시작한 날(마이그레이션 날) — 이날부터 ops.role_idle_days(처음 90)일이 지나야 권한 정기 점검이 「안 쓴 권한그룹」을 셉니다(그 전에는 오래 로그인 안 함 · 퇴사자 · 외부 계정만)', false,
   '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', '2026-11-21'),
  ('prr.review_auto', 'on', 'ADMIN',
   'v10.566 분기 거둘 후보 자동 만들기(정기 작업 prr_daily · 매일 09:20) — 후보 목록과 운영 알림 PRR_REVIEW_OPEN 만 · 거두기는 SUPER 가 직원 · 권한 › 거둘 후보에서. off 면 SUPER 가 「후보 다시 만들기」로', false,
   '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.opx_switch_docs (key, initial_value, cond, doc_ref) VALUES
  ('prr.review_auto', 'on', '알림 · 목록만 만드는 스위치라 처음 on(거두기는 늘 SUPER 가 사유와 함께) — 알림이 시끄러우면 off', 'docs/708')
ON CONFLICT (key) DO NOTHING;

/* ── ④ 새 탭 업무 · 권한 시드 (D258 · D291 모양 — GET = VIEW · 변경 = EDIT · R_ADMIN 은 staff-list 와 같게 4수준) ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort, description) VALUES
  ('perm-review', '거둘 후보', 'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1088, '분기 권한 정기 점검 — 안 쓴 권한그룹 · 오래 로그인 안 함 · 외부 계정 기한 · 퇴사자 권한 · 한 번에 거두기(v10.566 · 거두기 SUPER)')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT v.g, v.t, v.l FROM (VALUES
  ('R_ADMIN', 'perm-review', 'VIEW'), ('R_ADMIN', 'perm-review', 'EDIT'), ('R_ADMIN', 'perm-review', 'APPROVE'), ('R_ADMIN', 'perm-review', 'EXPORT')
) AS v(g, t, l)
WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = v.g) AND EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/staff/review', 'perm-review', 'VIEW'),
  ('POST', '/admin/staff/review/build', 'perm-review', 'EDIT'),
  ('POST', '/admin/staff/review/revoke', 'perm-review', 'EDIT'),
  ('POST', '/admin/staff/review/keep', 'perm-review', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

/* ── ⑤ 정기 작업 prr_daily (v10.566 · 568 함께) — 매일 09:20 · 분기 후보 다시 만들기(prr.review_auto on) · 입사 · 퇴사 흐름 기한 넘김 알림 ── */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('prr_daily', 1440, 9, 20, NULL, true, '권한 정기 점검 · 입사퇴사 — 매일 09:20 · 이번 분기 거둘 후보 다시 만들기(prr.review_auto on · 알림 PRR_REVIEW_OPEN 분기마다 한 번 · 0이면 풂) · 퇴사 흐름 기한 넘김 STAFF_LEAVE_OVERDUE · 입사 흐름 기한 넘김 STAFF_JOIN_OVERDUE(흐름마다 한 번) · v10.566 · 568')
ON CONFLICT (job) DO NOTHING;
-- v10.568 (docs/710) — 직원 입사 · 퇴사 흐름: 입사(직원 대장 → 운영 계정 초대 → 계정 연결 → 역할 · 권한그룹 → 근로계약서 → 의무교육) · 퇴사(퇴사일 → 운영 권한 거두기 → 장비 반납 → 퇴직금 추계 확인 → 서류 보관 기한)
--   대표 11/21 「모두 개발진행」. 앞머리 prr_. 다시 돌려도 같음. prr_1_v10566_perm_review.sql 뒤에.
--   단계 대부분은 기존 표를 보고 저절로 「됨」(직원 대장 · 역할 · 권한그룹 · 근로계약서 · 의무교육 · IT 자산) — 이 표에는 손으로 한 것 · 건너뜀만 남김.
--   흐름이 열려 있는 동안 운영 알림 STAFF_CASE_OPEN 이 풀리지 않음(끝내기 · 취소 때 풂). RAISE 글자에 퍼센트 기호 없음 · INV-9 · INV-11 낱말 칸 없음.

CREATE TABLE IF NOT EXISTS public.prr_cases (
  id            bigserial PRIMARY KEY,
  employee_id   bigint NOT NULL REFERENCES public.acct_employees(id),
  kind          text NOT NULL CHECK (kind IN ('JOIN', 'LEAVE')),
  state         text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'DONE', 'CANCELED')),
  target_on     date NOT NULL,
  invite_email  text CHECK (invite_email IS NULL OR (char_length(invite_email) <= 120 AND invite_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  invited_at    timestamptz,
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  opened_by     uuid REFERENCES public.accounts(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_by     uuid REFERENCES public.accounts(id),
  closed_at     timestamptz,
  close_note    text CHECK (close_note IS NULL OR char_length(close_note) <= 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prr_cases_open ON public.prr_cases (employee_id, kind) WHERE state = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_prr_cases_state ON public.prr_cases (state, opened_at DESC);
COMMENT ON TABLE public.prr_cases IS 'v10.568 (docs/710) 직원 입사 · 퇴사 흐름 — 직원 하나에 종류마다 열린 흐름 하나 · target_on = 입사일 · 퇴사일 · 초대 메일은 흐름이 끝나면 지움(초대한 때만 남김) · 지우지 않음';
COMMENT ON COLUMN public.prr_cases.invite_email IS 'v10.568 운영 계정 초대 메일(가입 짝 맞추기용) — 끝내기 · 취소 때 NULL';

CREATE TABLE IF NOT EXISTS public.prr_case_steps (
  case_id   bigint NOT NULL REFERENCES public.prr_cases(id),
  step      text NOT NULL CHECK (step IN ('INVITE', 'ACCOUNT', 'ROLE_GROUP', 'CONTRACT', 'TRAINING', 'ROLES', 'ASSETS', 'SEVERANCE', 'DOCS')),
  state     text NOT NULL CHECK (state IN ('DONE', 'SKIP')),
  note      text CHECK (note IS NULL OR char_length(note) <= 200),
  done_by   uuid REFERENCES public.accounts(id),
  done_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, step),
  CONSTRAINT ck_prr_case_step_skip_note CHECK (state <> 'SKIP' OR char_length(btrim(coalesce(note, ''))) >= 2)
);
COMMENT ON TABLE public.prr_case_steps IS 'v10.568 (docs/710) 흐름 단계 중 손으로 「됨」(초대 · 퇴직금 확인 · 서류 보관) · 「건너뜀」(사유 2자 이상)만 — 저절로 되는 단계는 기존 표를 봄';

/* 끝난 · 취소한 흐름의 단계는 바꾸지 않음 · 흐름은 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_prr_case_step_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  SELECT c.state INTO v_state FROM public.prr_cases c WHERE c.id = coalesce(NEW.case_id, OLD.case_id);
  IF v_state IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'PRR_CASE_CLOSED: 끝났거나 취소한 흐름의 단계는 바꾸지 않습니다.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prr_case_step_guard' AND tgrelid = 'public.prr_case_steps'::regclass) THEN
    CREATE TRIGGER trg_prr_case_step_guard BEFORE INSERT OR UPDATE OR DELETE ON public.prr_case_steps FOR EACH ROW EXECUTE FUNCTION public.fn_prr_case_step_guard();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fn_prr_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PRR_CASE_KEEP: 입사 · 퇴사 흐름은 지우지 않습니다(취소하십시오).';
  END IF;
  IF OLD.state <> 'OPEN' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.target_on IS DISTINCT FROM OLD.target_on OR NEW.employee_id IS DISTINCT FROM OLD.employee_id) THEN
    RAISE EXCEPTION 'PRR_CASE_CLOSED: 끝났거나 취소한 흐름은 다시 열지 않습니다(새로 여십시오).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prr_case_guard' AND tgrelid = 'public.prr_cases'::regclass) THEN
    CREATE TRIGGER trg_prr_case_guard BEFORE UPDATE OR DELETE ON public.prr_cases FOR EACH ROW EXECUTE FUNCTION public.fn_prr_case_guard();
  END IF;
END $$;

/* ── 설정(일반 원칙 값 · SUPER 고침 · 노무 · 세무 확인 권함) ─────────────────────────────
 *   prr.join_days      입사일 뒤 며칠 안에 입사 흐름을 끝낼지(처음 14) — 넘으면 STAFF_JOIN_OVERDUE(INFO · 흐름마다 한 번)
 *   prr.leave_grace    퇴사일 뒤 며칠 안에 퇴사 흐름을 끝낼지(처음 3) — 넘으면 STAFF_LEAVE_OVERDUE(WARN · 흐름마다 한 번)
 *   prr.keep_labor_years  근로계약서 · 근로자 명부 · 임금대장 · 퇴직 관련 서류 보관(근로기준법 42조 · 시행령 22조 — 3년 · 퇴직한 날부터)
 *   prr.keep_tax_years    급여 원천징수 장부 · 증빙 보관(국세기본법 85조의3 — 5년 · 법정신고기한부터 · 화면은 퇴사일부터 넉넉히 셈) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('prr.join_days', '14', 'ADMIN', 'v10.568 입사일 뒤 며칠 안에 입사 흐름(계정 · 역할 · 근로계약서 · 의무교육)을 끝낼지 — 넘으면 운영 알림 STAFF_JOIN_OVERDUE 한 번(1 ~ 60 · 처음 14)', false, '^([1-9]|[1-5][0-9]|60)$', '14'),
  ('prr.leave_grace', '3', 'ADMIN', 'v10.568 퇴사일 뒤 며칠 안에 퇴사 흐름(권한 거두기 · 장비 반납 · 퇴직금 · 서류)을 끝낼지 — 넘으면 운영 알림 STAFF_LEAVE_OVERDUE 한 번(0 ~ 30 · 처음 3)', false, '^([0-9]|[12][0-9]|30)$', '3'),
  ('prr.keep_labor_years', '3', 'ADMIN', 'v10.568 근로계약서 · 근로자 명부 · 임금대장 · 퇴직 관련 서류 보관 햇수(근로기준법 42조 일반 원칙 3년 · 퇴직한 날부터 · 노무 확인 권함 · 1 ~ 10)', false, '^([1-9]|10)$', '3'),
  ('prr.keep_tax_years', '5', 'ADMIN', 'v10.568 급여 원천징수 장부 · 증빙 보관 햇수(국세기본법 85조의3 일반 원칙 5년 · 세무 확인 권함 · 1 ~ 10)', false, '^([1-9]|10)$', '5')
ON CONFLICT (key) DO NOTHING;

/* ── 새 탭 업무 · 권한 시드 ── */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort, description) VALUES
  ('staff-cases', '입사 · 퇴사', 'acl', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1089, '직원 입사 · 퇴사 흐름 — 직원 대장 · 계정 초대 · 역할 · 근로계약서 · 의무교육 / 권한 거두기 · 장비 반납 · 퇴직금 · 서류 보관(v10.568 · 고치기 SUPER)')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT v.g, v.t, v.l FROM (VALUES
  ('R_ADMIN', 'staff-cases', 'VIEW'), ('R_ADMIN', 'staff-cases', 'EDIT'), ('R_ADMIN', 'staff-cases', 'APPROVE'), ('R_ADMIN', 'staff-cases', 'EXPORT')
) AS v(g, t, l)
WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = v.g) AND EXISTS (SELECT 1 FROM public.perm_tasks k WHERE k.key = v.t)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/staff/cases', 'staff-cases', 'VIEW'),
  ('GET', '/admin/staff/cases/{id}', 'staff-cases', 'VIEW'),
  ('POST', '/admin/staff/cases', 'staff-cases', 'EDIT'),
  ('POST', '/admin/staff/cases/{id}/invite', 'staff-cases', 'EDIT'),
  ('PUT', '/admin/staff/cases/{id}/steps/{step}', 'staff-cases', 'EDIT'),
  ('DELETE', '/admin/staff/cases/{id}/steps/{step}', 'staff-cases', 'EDIT'),
  ('POST', '/admin/staff/cases/{id}/revoke', 'staff-cases', 'EDIT'),
  ('POST', '/admin/staff/cases/{id}/close', 'staff-cases', 'EDIT'),
  ('POST', '/admin/staff/cases/{id}/cancel', 'staff-cases', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

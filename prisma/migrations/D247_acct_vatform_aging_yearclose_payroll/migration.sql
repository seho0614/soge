-- v10.400 ~ 403 (docs/537 ~ 540) — 회계 · 세무 5단계(⑭): 부가세 신고서 미리보기 · 받을 돈 · 갚을 돈 기간 분석 · 해 마감 · 다음 해 이월 · 급여 대장 · 4대보험
--   대표 11/19 17:30 ⑭ 「승인 + 통과하면 병합」.
--   ① 설정 · 정기 작업 acct_aging(ACCT_AGING_OVER)  ② 해 마감(acct_year_closings · 마감한 해 전표 막기 · 풀기 SUPER)  ③ 직원 · 급여 · 요율 · 간이세액표(주민등록번호 없음)
--   4대보험 요율 · 간이세액표는 초안 — 공단 고시 · 국세청 표 · 세무사(노무사) 확인. 다시 돌려도 같음.

/* ── ① 부가세 신고서 미리보기 (v10.400 · docs/537) — 표 없음 · 전자신고 세액공제 설정만 ──
 *   ② 받을 돈 · 갚을 돈 기간 분석 (v10.401 · docs/538) — 설정 · 정기 작업 acct_aging(매일 09:25) · 운영 알림 ACCT_AGING_OVER */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('acct.vat_efile_credit', '10000', 'ADMIN',
   '부가세 전자신고 세액공제(v10.400 · docs/537) — 확정 신고 때 납부세액에서 뺄 금액(원 · 처음 10,000 · 0 이면 안 뺌). 세법 기본값 초안 — 세무사 확인.',
   false, '^[0-9]{1,7}$', '10000'),
  ('acct.aging_alert_days', '90', 'ADMIN',
   '받을 돈 · 갚을 돈 오래됨 운영 알림 기준 일수(v10.401 · docs/538) — 이 일수를 넘긴 외상매출금 · 미지급금이 있으면 ACCT_AGING_OVER(거래처 · 계정마다 한 번 · 사라지면 풀림 · 30 ~ 365 · 처음 90).',
   false, '^([3-9][0-9]|[1-2][0-9]{2}|3[0-5][0-9]|36[0-5])$', '90'),
  ('acct.aging_alert', 'on', 'ADMIN',
   '받을 돈 · 갚을 돈 오래됨 운영 알림(v10.401) — off 면 알리지 않음(표는 그대로 봄).',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_aging', 1440, 9, 25, NULL, true, '받을 돈 · 갚을 돈 기간 분석 — 매일 09:25 · acct.aging_alert_days 넘은 외상매출금 · 미지급금 ACCT_AGING_OVER(거래처 · 계정마다 한 번 · 사라지면 풀림) · D247 · v10.401')
ON CONFLICT (job) DO NOTHING;

/* ── ③ 해 마감 · 다음 해 이월 (v10.402 · docs/539) ──────────────────────────────
 *   마감 = 그 해 수익 · 비용 계정을 0 으로 만들고 차액(순이익)을 이월이익잉여금(RETAINED · ⑬ D246)으로 넘기는 전표 YEAR_CLOSE(12-31 날짜).
 *   조건: 그 해 12개 달(전표 시작 달 전은 빼고) 모두 월 마감 · 이미 마감한 해가 아님.
 *   마감한 해는 전표를 넣지 못함(월 마감보다 한 겹 더) · SUPER 가 사유를 적고 풀면 반대 전표 YEAR_REOPEN · 다시 마감하면 새 YEAR_CLOSE.
 *   마감 뒤 다음 해 기초 잔액(⑬ acct_opening_sets · acct_opening)을 「초안(DRAFT)」으로 만듦 — 확정은 ⑬ 화면에서 SUPER. */
CREATE TABLE IF NOT EXISTS public.acct_year_closings (
  id          bigserial PRIMARY KEY,
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  action      text NOT NULL CHECK (action IN ('CLOSE', 'REOPEN')),
  net_income  bigint,
  revenue     bigint,
  expense     bigint,
  entry_id    bigint REFERENCES public.acct_entries(id),
  reason      text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_ayc_reopen_reason CHECK (action <> 'REOPEN' OR reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_ayc_year ON public.acct_year_closings (year, id DESC);
COMMENT ON TABLE public.acct_year_closings IS 'v10.402 (D247) 해 마감 · 풀기 기록 — 쌓기만 · 그 해 마지막 줄이 CLOSE 면 마감된 해(전표 넣기 막힘)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_year_closings_ro' AND tgrelid = 'public.acct_year_closings'::regclass) THEN
    CREATE TRIGGER trg_acct_year_closings_ro BEFORE UPDATE OR DELETE ON public.acct_year_closings FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_year_closed(p_year integer) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT action = 'CLOSE' FROM public.acct_year_closings WHERE year = p_year ORDER BY id DESC LIMIT 1), false)
$$;

/* D242 fn_acct_entries_closed 다시 — 달(ym) 셈 · 월 마감 막기 그대로 + 해 마감 막기 · 마감 전표(YEAR_CLOSE · YEAR_REOPEN)만 세션 표시가 있을 때 통과 */
CREATE OR REPLACE FUNCTION public.fn_acct_entries_closed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE yc boolean := NEW.source IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND coalesce(current_setting('sgb.acct_year_close', true), '') = 'on';
BEGIN
  NEW.ym := to_char(NEW.entry_date, 'YYYY-MM');   -- 달(YYYY-MM)은 날짜에서 · 마감 확인과 같은 값
  IF yc THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM acct_closings WHERE ym = NEW.ym) THEN
    RAISE EXCEPTION 'ACCT_CLOSED: % 은 마감한 달입니다.', to_char(NEW.entry_date, 'YYYY-MM');
  END IF;
  IF public.fn_acct_year_closed(extract(year FROM NEW.entry_date)::int) THEN
    RAISE EXCEPTION 'ACCT_YEAR_CLOSED: % 년은 해 마감을 했습니다.', extract(year FROM NEW.entry_date)::int;
  END IF;
  RETURN NEW;
END $$;

/* ── ④ 급여 대장 · 4대보험 (v10.403 · docs/540) ─────────────────────────────────
 *   직원(이름 · 입사 · 퇴사 · 월 기본급 · 부양가족 수 — 주민등록번호 · 계좌 받지 않음) · 달 급여(초안 → 확정 → 지급) · 줄마다 원천세 · 4대보험.
 *   요율 · 간이세액표는 해마다 바뀜 → 표(acct_payroll_rates · acct_wht_table)에 SUPER 가 넣음(코드에 박지 않음) · 처음 값은 초안(세무사 · 노무사 확인).
 *   간이세액표는 처음 비어 있음 — 국세청 표를 CSV 로 올림(없으면 소득세 0 으로 셈하고 화면에 「간이세액표 없음」).
 *   전표: 확정 PAYROLL(차변 직원급여 · 보험료(회사 몫) / 대변 예수금(원천세) · 예수금(4대보험) · 미지급금(실지급)) · 지급 PAYROLL_PAID(차변 미지급금 / 대변 보통예금). */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note) VALUES
  ('INS_PAYABLE',   '예수금(4대보험)',  'LIABILITY', '254', '예수금',  62, '급여에서 뗀 4대보험(본인 몫) + 회사 몫 — 내기 전 · v10.403'),
  ('EXP_INSURANCE', '보험료(4대보험 회사 몫)', 'EXPENSE', '821', '보험료', 215, '4대보험 회사 부담분 — v10.403 · 계정은 세무사 확인(복리후생비 · 세금과공과로 나누기도 함)')
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_employees (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  joined_on     date NOT NULL,
  left_on       date CHECK (left_on IS NULL OR left_on >= joined_on),
  monthly_base  bigint NOT NULL CHECK (monthly_base >= 0 AND monthly_base <= 100000000),
  nontax        bigint NOT NULL DEFAULT 0 CHECK (nontax >= 0 AND nontax <= 10000000),
  dependents    integer NOT NULL DEFAULT 1 CHECK (dependents BETWEEN 1 AND 11),
  memo          text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_employees IS 'v10.403 (D247) 급여 직원 — 이름 · 입사 · 퇴사 · 월 기본급 · 비과세(식대 등) · 부양가족 수(본인 포함) · 주민등록번호 · 계좌 받지 않음 · 지우지 않음(퇴사일)';
CREATE OR REPLACE FUNCTION public.fn_acct_employee_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_EMPLOYEE: 직원은 지우지 않습니다(퇴사일을 넣으십시오).'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_employee_guard' AND tgrelid = 'public.acct_employees'::regclass) THEN
    CREATE TRIGGER trg_acct_employee_guard BEFORE UPDATE OR DELETE ON public.acct_employees FOR EACH ROW EXECUTE FUNCTION public.fn_acct_employee_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_payroll_runs (
  id          bigserial PRIMARY KEY,
  ym          text NOT NULL UNIQUE CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pay_day     date NOT NULL,
  state       text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'FIXED', 'PAID')),
  created_by  uuid REFERENCES public.accounts(id),
  fixed_by    uuid REFERENCES public.accounts(id),
  fixed_at    timestamptz,
  paid_by     uuid REFERENCES public.accounts(id),
  paid_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_payroll_runs IS 'v10.403 (D247) 달 급여 — 초안(DRAFT · 줄 고침) → 확정(FIXED · SUPER · 전표 PAYROLL) → 지급(PAID · 전표 PAYROLL_PAID) · 앞으로만 · 지우지 않음';
CREATE TABLE IF NOT EXISTS public.acct_payroll_lines (
  id           bigserial PRIMARY KEY,
  run_id       bigint NOT NULL REFERENCES public.acct_payroll_runs(id),
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  gross        bigint NOT NULL CHECK (gross >= 0),
  nontax       bigint NOT NULL DEFAULT 0 CHECK (nontax >= 0),
  income_tax   bigint NOT NULL DEFAULT 0 CHECK (income_tax >= 0),
  local_tax    bigint NOT NULL DEFAULT 0 CHECK (local_tax >= 0),
  np           bigint NOT NULL DEFAULT 0 CHECK (np >= 0),
  hi           bigint NOT NULL DEFAULT 0 CHECK (hi >= 0),
  ltc          bigint NOT NULL DEFAULT 0 CHECK (ltc >= 0),
  ei           bigint NOT NULL DEFAULT 0 CHECK (ei >= 0),
  net          bigint NOT NULL,
  company_np   bigint NOT NULL DEFAULT 0 CHECK (company_np >= 0),
  company_hi   bigint NOT NULL DEFAULT 0 CHECK (company_hi >= 0),
  company_ltc  bigint NOT NULL DEFAULT 0 CHECK (company_ltc >= 0),
  company_ei   bigint NOT NULL DEFAULT 0 CHECK (company_ei >= 0),
  wht_missing  boolean NOT NULL DEFAULT false,
  UNIQUE (run_id, employee_id),
  CONSTRAINT ck_apl_net CHECK (net = gross - income_tax - local_tax - np - hi - ltc - ei)
);
COMMENT ON TABLE public.acct_payroll_lines IS 'v10.403 (D247) 급여 줄 — 지급액 · 비과세 · 소득세 · 지방소득세 · 4대보험(본인 · 회사) · 실지급(net = 지급액 − 공제) · 확정 뒤 고치지 못함';
CREATE INDEX IF NOT EXISTS ix_apl_employee ON public.acct_payroll_lines (employee_id, run_id);

CREATE OR REPLACE FUNCTION public.fn_acct_payroll_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ord CONSTANT text[] := ARRAY['DRAFT', 'FIXED', 'PAID'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PAYROLL: 급여 대장은 지우지 않습니다.'; END IF;
  IF NEW.ym <> OLD.ym THEN RAISE EXCEPTION 'ACCT_PAYROLL: 급여 달은 바꾸지 않습니다.'; END IF;
  IF array_position(ord, NEW.state) < array_position(ord, OLD.state) THEN RAISE EXCEPTION 'ACCT_PAYROLL: 급여 상태는 앞으로만 갑니다.'; END IF;
  IF OLD.state <> 'DRAFT' AND NEW.pay_day <> OLD.pay_day THEN RAISE EXCEPTION 'ACCT_PAYROLL_FIXED: 확정한 급여는 고치지 않습니다.'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_acct_payroll_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_payroll_runs WHERE id = coalesce(NEW.run_id, OLD.run_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCT_PAYROLL_FIXED: 확정한 급여는 고치지 않습니다.'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_payroll_run_guard' AND tgrelid = 'public.acct_payroll_runs'::regclass) THEN
    CREATE TRIGGER trg_acct_payroll_run_guard BEFORE UPDATE OR DELETE ON public.acct_payroll_runs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_payroll_run_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_payroll_line_guard' AND tgrelid = 'public.acct_payroll_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_payroll_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_payroll_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_payroll_line_guard();
  END IF;
END $$;

/* 요율 — 해마다 · key 정해진 것만 · 값은 % 또는 원 · SUPER */
CREATE TABLE IF NOT EXISTS public.acct_payroll_rates (
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  key         text NOT NULL CHECK (key IN ('np_rate', 'np_base_min', 'np_base_max', 'hi_rate', 'ltc_rate', 'ei_rate', 'ei_company_rate')),
  value       numeric NOT NULL CHECK (value >= 0),
  draft       boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, key)
);
COMMENT ON TABLE public.acct_payroll_rates IS 'v10.403 (D247) 4대보험 요율(본인 몫 % · 국민연금 기준소득 하한 · 상한 원 · 장기요양은 건강보험료의 %) — 해마다 SUPER · 처음 값은 초안(노무사 · 세무사 확인)';
/* 2026 초안 — 공단 공지로 꼭 확인 후 SUPER 가 고침(고치면 draft = false) */
INSERT INTO public.acct_payroll_rates (year, key, value) VALUES
  (2026, 'np_rate', 4.75), (2026, 'np_base_min', 400000), (2026, 'np_base_max', 6370000),
  (2026, 'hi_rate', 3.595), (2026, 'ltc_rate', 13.14), (2026, 'ei_rate', 0.9), (2026, 'ei_company_rate', 1.15)
ON CONFLICT (year, key) DO NOTHING;

/* 근로소득 간이세액표 — 월 과세 급여 구간(원 · 이상 ~ 미만) × 부양가족 수 → 소득세(원) · SUPER 가 CSV 로 · 처음 비어 있음 */
CREATE TABLE IF NOT EXISTS public.acct_wht_table (
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  wage_from   bigint NOT NULL CHECK (wage_from >= 0),
  wage_to     bigint NOT NULL,
  dependents  integer NOT NULL CHECK (dependents BETWEEN 1 AND 11),
  tax         bigint NOT NULL CHECK (tax >= 0),
  PRIMARY KEY (year, wage_from, dependents),
  CONSTRAINT ck_awt_range CHECK (wage_to > wage_from)
);
COMMENT ON TABLE public.acct_wht_table IS 'v10.403 (D247) 근로소득 간이세액표 — 국세청 표를 SUPER 가 CSV 로(해마다 · 올리면 그 해 전체를 바꿈) · 계약 칸 이름 from · to 는 예약어라 wage_from · wage_to';
CREATE TABLE IF NOT EXISTS public.acct_payroll_rate_log (
  id          bigserial PRIMARY KEY,
  year        integer NOT NULL,
  what        text NOT NULL,
  detail      jsonb,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_payroll_rate_log_ro' AND tgrelid = 'public.acct_payroll_rate_log'::regclass) THEN
    CREATE TRIGGER trg_acct_payroll_rate_log_ro BEFORE UPDATE OR DELETE ON public.acct_payroll_rate_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.pay_day', '25', 'ADMIN',
   '급여 지급일(v10.403 · docs/540) — 매달 이 날(1 ~ 28 · 처음 25 · 대표가 알려 주면 바꿈). 새 달 급여 대장의 지급일 처음 값 · 자금 흐름 나갈 돈.',
   false, '^([1-9]|1[0-9]|2[0-8])$', '25')
ON CONFLICT (key) DO NOTHING;


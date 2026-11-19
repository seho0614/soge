/* D259 (v10.445 ~ 448 · docs/582 ~ 585) ㉖ 인사 2 — 근태 · 휴가 신청 → 승인 · 급여명세서(메일 처음 off · 금액 없이 알림만) · 연말정산 자료 모음 */

/* ── v10.445 (D259 · docs/582) 근태 — 직원 ↔ 운영 계정 연결 · 출퇴근 기록(본인) · 관리자 확인 · 고침 기록 ── */
ALTER TABLE public.acct_employees ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_employees_account ON public.acct_employees (account_id) WHERE account_id IS NOT NULL;
COMMENT ON COLUMN public.acct_employees.account_id IS 'v10.445 (D259) 직원 본인의 운영 계정(내 근태 · 휴가 · 급여명세서) — SUPER 가 연결 · 한 계정은 한 직원';

CREATE TABLE IF NOT EXISTS public.acct_attendance (
  id            bigserial PRIMARY KEY,
  employee_id   bigint NOT NULL REFERENCES public.acct_employees(id),
  work_on       date NOT NULL,
  in_at         timestamptz NOT NULL,
  out_at        timestamptz,
  memo          text CHECK (memo IS NULL OR char_length(memo) <= 200),
  fixed         boolean NOT NULL DEFAULT false,
  confirmed_by  uuid REFERENCES public.accounts(id),
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_acct_attendance_day UNIQUE (employee_id, work_on),
  CONSTRAINT ck_acct_attendance_out CHECK (out_at IS NULL OR out_at > in_at),
  CONSTRAINT ck_acct_attendance_span CHECK (out_at IS NULL OR out_at - in_at <= interval '24 hours')
);
CREATE INDEX IF NOT EXISTS ix_acct_attendance_day ON public.acct_attendance (work_on, employee_id);
COMMENT ON TABLE public.acct_attendance IS 'v10.445 (D259) 근태 — 하루 한 줄(출근 · 퇴근) · 본인이 누름 · 확인(관리자 · 본인 아님) 뒤에는 못 고침 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.acct_attendance_fixes (
  id             bigserial PRIMARY KEY,
  attendance_id  bigint NOT NULL REFERENCES public.acct_attendance(id),
  before_in      timestamptz,
  before_out     timestamptz,
  after_in       timestamptz NOT NULL,
  after_out      timestamptz,
  reason         text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_attendance_fixes IS 'v10.445 (D259) 근태 고침 기록 — 관리자가 시각을 고칠 때마다 앞 · 뒤 · 사유 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_acct_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ATTEND: 근태 기록은 지우지 않습니다(고침 기록으로).'; END IF;
  IF (NEW.employee_id, NEW.work_on, NEW.created_at) IS DISTINCT FROM (OLD.employee_id, OLD.work_on, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_ATTEND: 직원 · 날짜는 바꾸지 않습니다.';
  END IF;
  IF OLD.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'ACCT_ATTEND_FIXED: 확인한 근태는 고치지 않습니다.'; END IF;
  /* 시각 고침은 고침 기록과 같은 거래 안에서만(sgb.attend_fix = on) — 퇴근을 처음 채우는 것은 늘 됨 */
  IF NEW.in_at IS DISTINCT FROM OLD.in_at OR (OLD.out_at IS NOT NULL AND NEW.out_at IS DISTINCT FROM OLD.out_at) THEN
    IF coalesce(current_setting('sgb.attend_fix', true), '') <> 'on' THEN
      RAISE EXCEPTION 'ACCT_ATTEND: 출퇴근 시각은 관리자 고침(사유)으로만 바꿉니다.';
    END IF;
    NEW.fixed := true;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_attendance_guard' AND tgrelid = 'public.acct_attendance'::regclass) THEN
    CREATE TRIGGER trg_acct_attendance_guard BEFORE UPDATE OR DELETE ON public.acct_attendance FOR EACH ROW EXECUTE FUNCTION public.fn_acct_attendance_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_attendance_fixes_ro' AND tgrelid = 'public.acct_attendance_fixes'::regclass) THEN
    CREATE TRIGGER trg_acct_attendance_fixes_ro BEFORE UPDATE OR DELETE ON public.acct_attendance_fixes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hr.work_start', '09:00', 'ADMIN', '근태 출근 기준 시각(v10.445 · D259) — 이 시각 뒤 출근은 달 집계에 「늦음」으로 셈(한국 시각 HH:MM)', false, '^([01][0-9]|2[0-3]):[0-5][0-9]$', '09:00')
ON CONFLICT (key) DO NOTHING;

/* ── v10.446 (D259 · docs/583) 휴가 신청 → 승인 — 승인하면 ⑮ 연차 쓴 날(acct_leave_uses)에 날마다 한 줄 · 취소는 음수 줄 ── */
CREATE TABLE IF NOT EXISTS public.acct_leave_requests (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  start_on     date NOT NULL,
  end_on       date NOT NULL,
  half         text NOT NULL DEFAULT 'FULL' CHECK (half IN ('FULL', 'AM', 'PM')),
  days         numeric(4,1) NOT NULL CHECK (days > 0 AND days <= 30),
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  state        text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED')),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_alr_range CHECK (end_on >= start_on AND end_on - start_on <= 40),
  CONSTRAINT ck_alr_half CHECK (half = 'FULL' OR (start_on = end_on AND days = 0.5))
);
CREATE INDEX IF NOT EXISTS ix_alr_state ON public.acct_leave_requests (state, start_on);
CREATE INDEX IF NOT EXISTS ix_alr_emp ON public.acct_leave_requests (employee_id, start_on);
COMMENT ON TABLE public.acct_leave_requests IS 'v10.446 (D259) 휴가 신청 — 본인 신청 → 관리자 승인(본인 아님) · 반려 · 취소 · 내용은 못 고침(취소하고 다시) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_acct_leave_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_LEAVE_REQ: 휴가 신청은 지우지 않습니다(취소로).'; END IF;
  IF (NEW.employee_id, NEW.start_on, NEW.end_on, NEW.half, NEW.days, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.start_on, OLD.end_on, OLD.half, OLD.days, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_LEAVE_REQ: 신청 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED')) OR (OLD.state = 'APPROVED' AND NEW.state = 'CANCELED')) THEN
      RAISE EXCEPTION 'ACCT_LEAVE_REQ_STATE: 휴가 신청 상태는 앞으로만 바뀝니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_leave_request_guard' AND tgrelid = 'public.acct_leave_requests'::regclass) THEN
    CREATE TRIGGER trg_acct_leave_request_guard BEFORE UPDATE OR DELETE ON public.acct_leave_requests FOR EACH ROW EXECUTE FUNCTION public.fn_acct_leave_request_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hr.leave_allow_negative', 'off', 'ADMIN', '남은 연차보다 많은 휴가 승인 허용(v10.446 · D259) — 처음 off(모자라면 승인 막음)', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ── v10.447 (D259 · docs/584) 급여명세서 — ⑭ 급여 대장(확정 · 지급) 줄을 그대로 보여 줌 · 알림 메일(금액 없음) 기록 ── */
CREATE TABLE IF NOT EXISTS public.acct_payslip_mails (
  id          bigserial PRIMARY KEY,
  line_id     bigint NOT NULL REFERENCES public.acct_payroll_lines(id),
  to_masked   text,
  result      text NOT NULL CHECK (result IN ('SENT', 'FAILED', 'NO_ACCOUNT', 'NOT_READY')),
  error       text CHECK (error IS NULL OR char_length(error) <= 300),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_payslip_mail_sent ON public.acct_payslip_mails (line_id) WHERE result = 'SENT';
COMMENT ON TABLE public.acct_payslip_mails IS 'v10.447 (D259) 급여명세서 알림 메일 — 금액은 메일에 넣지 않음(운영 화면 › 내 인사에서 봄) · 같은 줄은 한 번만 보냄 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_payslip_mails_ro' AND tgrelid = 'public.acct_payslip_mails'::regclass) THEN
    CREATE TRIGGER trg_acct_payslip_mails_ro BEFORE UPDATE OR DELETE ON public.acct_payslip_mails FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.payslip_mail', 'off', 'ADMIN', '급여명세서 알림 메일(v10.447 · D259) — 처음 off · on 이면 SUPER 가 「알림 보내기」로 연결된 직원 계정 메일에 「명세서가 나왔습니다」만(금액 없음)', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ── v10.448 (D259 · docs/585) 연말정산 자료 모음 — 회사 장부 값(해 합계 · 달별) + 직원 제출 서류 받음 표시(쌓기만) · 주민등록번호 받지 않음 ── */
CREATE TABLE IF NOT EXISTS public.acct_yearend_checks (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  year         integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  item         text NOT NULL CHECK (item IN ('SIMPLE_PDF', 'DEDUCTION_FORM', 'DEPENDENT', 'PREV_JOB', 'OTHER')),
  done         boolean NOT NULL,
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_acct_yearend_checks ON public.acct_yearend_checks (year, employee_id, item, id DESC);
COMMENT ON TABLE public.acct_yearend_checks IS 'v10.448 (D259) 연말정산 서류 받음 표시 — 간소화 자료 · 소득 · 세액공제신고서 · 부양가족 · 전 근무지 영수증 · 마지막 줄이 지금 상태 · 쌓기만(서류 파일은 받지 않음)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_yearend_checks_ro' AND tgrelid = 'public.acct_yearend_checks'::regclass) THEN
    CREATE TRIGGER trg_acct_yearend_checks_ro BEFORE UPDATE OR DELETE ON public.acct_yearend_checks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ㉖ (D259) 업무 권한(⑳ D258) — 새 탭 업무 · 처음 변환 그룹(R_) 범위 · 주소 → 업무
 *   hr-attend · hr-leave = 운영 관리자(R_ADMIN) · acct-payslip · acct-yearend = 지급 담당(R_PAYOUT) — @Roles 와 같은 범위(적용 날 보는 범위 같음)
 *   my-hr(내 인사)는 본인 것만 보는 화면이라 주소 맵에 넣지 않음(@Roles 만 · perm.guard 「맵에 없는 주소는 @Roles 만」) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hr-attend', '근태', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2450),
  ('hr-leave', '휴가 신청', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2460),
  ('acct-payslip', '급여명세서', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2470),
  ('acct-yearend', '연말정산 자료', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2480),
  ('my-hr', '내 인사', 'admoff', ARRAY['VIEW','EDIT'], 2490)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN', 'hr-attend'), ('R_ADMIN', 'hr-leave'), ('R_PAYOUT', 'acct-payslip'), ('R_PAYOUT', 'acct-yearend')) x(g, t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'my-hr', l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT'), ('R_REVIEWER'), ('R_PARTNER_MAL'), ('R_PARTNER_AFF')) x(g)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hr/attendance', 'hr-attend', 'VIEW'),
  ('POST', '/admin/hr/attendance/{id}/fix', 'hr-attend', 'EDIT'),
  ('POST', '/admin/hr/attendance/add', 'hr-attend', 'EDIT'),
  ('POST', '/admin/hr/attendance/confirm', 'hr-attend', 'APPROVE'),
  ('PUT', '/admin/hr/employees/{id}/account', 'hr-attend', 'APPROVE'),
  ('GET', '/admin/hr/leave', 'hr-leave', 'VIEW'),
  ('POST', '/admin/hr/leave/{id}/decide', 'hr-leave', 'APPROVE'),
  ('POST', '/admin/hr/leave/{id}/revoke', 'hr-leave', 'APPROVE'),
  ('GET', '/admin/acct/payslips', 'acct-payslip', 'VIEW'),
  ('GET', '/admin/acct/payslips/{lineId}', 'acct-payslip', 'VIEW'),
  ('POST', '/admin/acct/payslips/notify', 'acct-payslip', 'APPROVE'),
  ('GET', '/admin/acct/yearend', 'acct-yearend', 'VIEW'),
  ('POST', '/admin/acct/yearend/checks', 'acct-yearend', 'EDIT'),
  ('GET', '/admin/acct/yearend/export', 'acct-yearend', 'EXPORT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;


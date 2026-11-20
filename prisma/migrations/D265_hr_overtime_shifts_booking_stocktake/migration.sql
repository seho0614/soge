/* D265 (v10.471 ~ 474 · docs/609 ~ 612) ㉟ 인사 4 — 연장 · 야간 · 휴일 근로(주 52시간 경고 · 가산수당 → 급여) · 근무표 · 교대 · 회의실 · 장비 예약(겹침 막음) · 자산 실사(QR) */

/* D265 (v10.471 ~ 474 · docs/609 ~ 612) ㉟ 인사 4 — 연장 · 야간 · 휴일 근로 · 근무표 · 교대 · 회의실 · 장비 예약(겹치면 DB 가 막음) · 자산 실사(QR 라벨 · 없어진 자산 처분 전표)
 *   btree_gist 는 B010 · D092 에서 이미 켬 — 여기서는 「있으면 그대로」만(새 확장 아님 · 운영 영향 없음). */
CREATE EXTENSION IF NOT EXISTS btree_gist;

/* ── v10.471 (D265 · docs/609) 연장 · 야간 · 휴일 근로 — 신청(본인 · 관리자 대신) → 승인(관리자 · 본인 아님) · 주 52시간 경고 · 가산 수당을 급여 대장으로 ──
 *   시각은 한국 시각 · 끝이 시작보다 이르거나 같으면 다음 날 · 10분 ~ 16시간
 *   DB 가 정함(서버 계산을 믿지 않음): 분(minutes) · 야간 분(22:00 ~ 06:00 겹침 · night_min) · 날 종류(day_kind)
 *     WORKDAY 영업일(연장) · OFFDAY 토요일 = 무급 휴무일(연장 · hrx.sat_as_holiday off 일 때) · HOLIDAY 일요일 · 공휴일(휴일)
 *   한 직원의 살아 있는 신청(신청 · 승인)은 시간이 겹치지 않음(배제 제약 ex_hrx_ot_overlap)
 *   가산율 · 주 한도 · 통상시급 나눗수는 일반 원칙 값(근로기준법 제50 · 53 · 56조) · SUPER 고침 · 노무사 확인(docs/609) */
CREATE TABLE IF NOT EXISTS public.hrx_ot_requests (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  work_on      date NOT NULL,
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  minutes      integer NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 10 AND 960),
  night_min    integer NOT NULL DEFAULT 0 CHECK (night_min >= 0),
  day_kind     text NOT NULL DEFAULT 'WORKDAY' CHECK (day_kind IN ('WORKDAY', 'OFFDAY', 'HOLIDAY')),
  reason       text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  state        text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED')),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hxo_span CHECK (end_at > start_at AND end_at - start_at <= interval '16 hours'),
  CONSTRAINT ck_hxo_night CHECK (night_min <= minutes),
  CONSTRAINT ex_hrx_ot_overlap EXCLUDE USING gist (employee_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (state IN ('REQUESTED', 'APPROVED'))
);
CREATE INDEX IF NOT EXISTS ix_hxo_state ON public.hrx_ot_requests (state, work_on);
CREATE INDEX IF NOT EXISTS ix_hxo_emp ON public.hrx_ot_requests (employee_id, work_on);
COMMENT ON TABLE public.hrx_ot_requests IS 'v10.471 (D265) 연장 · 야간 · 휴일 근로 신청 — 분 · 야간 분 · 날 종류는 DB 가 셈 · 한 직원 시간 겹침 막음(배제 제약) · 승인(관리자 · 본인 아님) · 내용 못 고침 · 지우지 않음 · 급여 대장에 넘긴 승인은 취소 못 함';

/* 급여 대장에 넘긴 기록 — 신청 하나는 한 번만 · 넘긴 급여가 초안(DRAFT)일 때만 되돌림(지움) · 고치지 않음 */
CREATE TABLE IF NOT EXISTS public.hrx_ot_pay_links (
  id          bigserial PRIMARY KEY,
  request_id  bigint NOT NULL UNIQUE REFERENCES public.hrx_ot_requests(id),
  run_id      bigint NOT NULL REFERENCES public.acct_payroll_runs(id),
  line_id     bigint NOT NULL REFERENCES public.acct_payroll_lines(id),
  paid_min    integer NOT NULL CHECK (paid_min BETWEEN 0 AND 960),
  night_min   integer NOT NULL CHECK (night_min >= 0),
  hourly      bigint NOT NULL CHECK (hourly >= 0),
  amount      bigint NOT NULL CHECK (amount >= 0),
  basis       text NOT NULL CHECK (basis IN ('MIN', 'REQUEST')),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hxl_run ON public.hrx_ot_pay_links (run_id, line_id);
COMMENT ON TABLE public.hrx_ot_pay_links IS 'v10.471 (D265) 연장 근로 수당 → 급여 대장 넘김 — 신청 하나 한 번 · 넘긴 분 · 야간 분 · 통상시급 · 금액 · 기준(MIN 승인과 근태 중 작은 쪽 · REQUEST 승인 그대로) · 급여 초안일 때만 되돌림';

CREATE OR REPLACE FUNCTION public.fn_hrx_ot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_night numeric := 0; v_ws timestamptz; d integer; v_sat text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_OT: 연장 근로 신청은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'REQUESTED' THEN RAISE EXCEPTION 'HRX_OT_STATE: 새 신청은 신청 상태로 시작합니다.'; END IF;
    IF (NEW.start_at AT TIME ZONE 'Asia/Seoul')::date <> NEW.work_on THEN
      RAISE EXCEPTION 'HRX_OT_TIME: 시작 시각은 일한 날(한국 시각) 안이어야 합니다.';
    END IF;
    NEW.minutes := floor(extract(epoch FROM (NEW.end_at - NEW.start_at)) / 60)::integer;
    FOR d IN -1..1 LOOP
      v_ws := ((NEW.work_on + d) + time '22:00') AT TIME ZONE 'Asia/Seoul';
      v_night := v_night + greatest(0, extract(epoch FROM (least(NEW.end_at, v_ws + interval '8 hours') - greatest(NEW.start_at, v_ws))) / 60);
    END LOOP;
    NEW.night_min := floor(v_night)::integer;
    SELECT value INTO v_sat FROM public.site_settings WHERE key = 'hrx.sat_as_holiday';
    NEW.day_kind := CASE
      WHEN public.fn_is_business_day(NEW.work_on) THEN 'WORKDAY'
      WHEN extract(isodow FROM NEW.work_on) = 6 AND coalesce(v_sat, 'off') <> 'on'
           AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.day = NEW.work_on) THEN 'OFFDAY'
      ELSE 'HOLIDAY' END;
    NEW.decided_by := NULL; NEW.decided_at := NULL; NEW.decide_note := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.employee_id, NEW.work_on, NEW.start_at, NEW.end_at, NEW.minutes, NEW.night_min, NEW.day_kind, NEW.reason, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.work_on, OLD.start_at, OLD.end_at, OLD.minutes, OLD.night_min, OLD.day_kind, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_OT: 신청 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED')) OR (OLD.state = 'APPROVED' AND NEW.state = 'CANCELED')) THEN
      RAISE EXCEPTION 'HRX_OT_STATE: 신청 상태는 앞으로만 바뀝니다.';
    END IF;
    IF OLD.state = 'APPROVED' AND EXISTS (SELECT 1 FROM public.hrx_ot_pay_links l WHERE l.request_id = OLD.id) THEN
      RAISE EXCEPTION 'HRX_OT_PAID: 급여 대장에 넘긴 연장 근로는 취소하지 않습니다(급여 대장 넘김을 먼저 되돌림).';
    END IF;
  ELSIF (NEW.decided_by, NEW.decided_at, NEW.decide_note) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decide_note) THEN
    RAISE EXCEPTION 'HRX_OT_STATE: 처리 기록은 상태를 바꿀 때만 씁니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hrx_ot_pay_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'HRX_OT_PAY: 급여 대장 넘김 기록은 고치지 않습니다(되돌리고 다시).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT state INTO v_state FROM public.acct_payroll_runs WHERE id = NEW.run_id;
    IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'HRX_OT_PAY: 초안(확정 전) 급여 대장에만 넘깁니다.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hrx_ot_requests r WHERE r.id = NEW.request_id AND r.state = 'APPROVED') THEN
      RAISE EXCEPTION 'HRX_OT_PAY: 승인한 연장 근로만 넘깁니다.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.acct_payroll_lines l JOIN public.hrx_ot_requests r ON r.employee_id = l.employee_id
                    WHERE l.id = NEW.line_id AND l.run_id = NEW.run_id AND r.id = NEW.request_id) THEN
      RAISE EXCEPTION 'HRX_OT_PAY: 그 직원의 급여 줄이 아닙니다.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT state INTO v_state FROM public.acct_payroll_runs WHERE id = OLD.run_id;
  IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'HRX_OT_PAY: 확정한 급여에 넘긴 연장 근로는 되돌리지 않습니다.'; END IF;
  RETURN OLD;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_ot_guard' AND tgrelid = 'public.hrx_ot_requests'::regclass) THEN
    CREATE TRIGGER trg_hrx_ot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hrx_ot_requests FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_ot_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_ot_pay_guard' AND tgrelid = 'public.hrx_ot_pay_links'::regclass) THEN
    CREATE TRIGGER trg_hrx_ot_pay_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hrx_ot_pay_links FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_ot_pay_guard();
  END IF;
END $$;

/* 설정(일반 원칙 값 · SUPER 고침) — 서버 검사 정규식은 hrx-overtime.ts 의 같은 글자 */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('hrx.ot_rates', 'OT:50,NIGHT:50,HOL:50,HOL8:100', 'ADMIN', '연장 · 야간 · 휴일 근로 가산율(v10.471 · D265) — 통상임금에 더하는 % · OT 연장 · NIGHT 야간(22 ~ 06시) · HOL 휴일 8시간 안 · HOL8 휴일 8시간 넘음(근로기준법 제56조 일반 원칙 · 노무사 확인)', false, '^OT:[0-9]{1,3},NIGHT:[0-9]{1,3},HOL:[0-9]{1,3},HOL8:[0-9]{1,3}$', 'OT:50,NIGHT:50,HOL:50,HOL8:100'),
  ('hrx.week_limits', 'BASE:40,OT:12,WARN:48', 'ADMIN', '주 근로시간 한도(v10.471 · D265) — BASE 기본 · OT 연장(휴일 근로 포함) 한도 · WARN 이 시간을 넘으면 미리 경고(근로기준법 제50 · 53조 일반 원칙)', false, '^BASE:[0-9]{1,2},OT:[0-9]{1,2},WARN:[0-9]{1,2}$', 'BASE:40,OT:12,WARN:48'),
  ('hrx.std_month_hours', '209', 'ADMIN', '통상시급 나눗수(v10.471 · D265) — 통상시급 = 월 기본급 ÷ 이 시간(주 40시간 · 주휴 포함 월 209시간 일반 원칙)', false, '^(1[0-9]{2}|2[0-4][0-9])$', '209'),
  ('hrx.ot_over_block', 'on', 'ADMIN', '주 연장 한도 넘는 승인 막기(v10.471 · D265) — on 이면 그 주 승인한 연장 · 휴일 근로가 OT 한도를 넘는 승인을 막음', false, '^(on|off)$', 'on'),
  ('hrx.sat_as_holiday', 'off', 'ADMIN', '토요일을 휴일로 셈(v10.471 · D265) — off(처음)면 토요일은 무급 휴무일(연장 가산) · on 이면 휴일 가산(취업규칙에 따름)', false, '^(on|off)$', 'off'),
  ('hrx.ot_pay_basis', 'MIN', 'ADMIN', '연장 근로 수당 기준 시간(v10.471 · D265) — MIN(처음) 승인 시간과 근태(출퇴근) 겹친 시간 중 작은 쪽 · REQUEST 승인 시간 그대로', false, '^(MIN|REQUEST)$', 'MIN')
ON CONFLICT (key) DO NOTHING;

/* 정기 작업 — 이번 주 연장 · 휴일 근로가 WARN − BASE 시간을 넘은 직원 수를 운영 알림 HRX_OT_WEEK(주에 하나 · 이름 없이 수만) */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('hrx_ot_week', 1440, 9, 50, NULL, true, '주 52시간 경고 — 매일 09:50 · 이번 주 연장 · 휴일 근로(신청 · 승인)가 hrx.week_limits WARN − BASE 시간을 넘은 직원 수를 HRX_OT_WEEK 로(주에 하나 · 다음 주 · 0명이면 풀림) · D265 · v10.471')
ON CONFLICT (job) DO NOTHING;

/* ── v10.472 (D265 · docs/610) 근무표 · 교대 — 교대 유형(시작 · 끝 · 휴게) · 직원 × 날짜 한 칸 · 근태(㉖ acct_attendance)와 다름 표시 ──
 *   칸을 넣을 때 유형의 시각 · 휴게를 칸에 옮겨 적음(DB 가 유형에서 채움) — 나중에 유형을 고쳐도 지난 근무표는 그대로
 *   지난 날(한국 날짜 기준 7일 넘게 지난 칸)은 넣기 · 바꾸기 · 지우기 막음 — 근무표는 계획이라 지우기는 됨(그 전까지)
 *   유형은 지우지 않음(쓰지 않음으로) · 코드는 바꾸지 않음 */
CREATE TABLE IF NOT EXISTS public.hrx_shift_types (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  kind        text NOT NULL DEFAULT 'WORK' CHECK (kind IN ('WORK', 'OFF')),
  start_hm    text CHECK (start_hm IS NULL OR start_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_hm      text CHECK (end_hm IS NULL OR end_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  break_min   integer NOT NULL DEFAULT 0 CHECK (break_min BETWEEN 0 AND 240),
  active      boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 9999),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hxt_times CHECK ((kind = 'OFF' AND start_hm IS NULL AND end_hm IS NULL AND break_min = 0)
                              OR (kind = 'WORK' AND start_hm IS NOT NULL AND end_hm IS NOT NULL AND start_hm <> end_hm))
);
COMMENT ON TABLE public.hrx_shift_types IS 'v10.472 (D265) 교대 유형 — 근무(시작 · 끝 · 휴게 · 끝이 시작보다 이르면 다음 날) · 휴무 · 처음 5개(주간 · 조출 · 오후 · 야간 · 휴무) · SUPER 가 고치고 더함 · 지우지 않음';

INSERT INTO public.hrx_shift_types (code, name, kind, start_hm, end_hm, break_min, active, sort) VALUES
  ('DAY', '주간', 'WORK', '09:00', '18:00', 60, true, 10),
  ('EARLY', '조출', 'WORK', '07:00', '16:00', 60, true, 20),
  ('LATE', '오후', 'WORK', '13:00', '22:00', 60, true, 30),
  ('NIGHT', '야간', 'WORK', '22:00', '07:00', 60, true, 40),
  ('OFF', '휴무', 'OFF', NULL, NULL, 0, true, 90)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.hrx_shifts (
  id          bigserial PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES public.acct_employees(id),
  work_on     date NOT NULL,
  type_code   text NOT NULL REFERENCES public.hrx_shift_types(code),
  kind        text NOT NULL DEFAULT 'WORK' CHECK (kind IN ('WORK', 'OFF')),
  start_hm    text CHECK (start_hm IS NULL OR start_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_hm      text CHECK (end_hm IS NULL OR end_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  break_min   integer NOT NULL DEFAULT 0 CHECK (break_min BETWEEN 0 AND 240),
  note        text CHECK (note IS NULL OR char_length(note) <= 100),
  created_by  uuid REFERENCES public.accounts(id),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrx_shift_day UNIQUE (employee_id, work_on)
);
CREATE INDEX IF NOT EXISTS ix_hxs_day ON public.hrx_shifts (work_on, employee_id);
COMMENT ON TABLE public.hrx_shifts IS 'v10.472 (D265) 근무표 — 직원 × 날짜 한 칸 · 유형 시각 · 휴게를 옮겨 적음(DB) · 7일 넘게 지난 칸은 못 바꿈 · 근태와 비교는 화면(GET /admin/hrx/shifts)';

CREATE OR REPLACE FUNCTION public.fn_hrx_shift_types_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_SHIFT_TYPE: 교대 유형은 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.code, OLD.created_at) THEN RAISE EXCEPTION 'HRX_SHIFT_TYPE: 유형 코드 · 만든 시각은 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hrx_shifts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t public.hrx_shift_types; v_lock date := (now() AT TIME ZONE 'Asia/Seoul')::date - 7;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.work_on < v_lock THEN RAISE EXCEPTION 'HRX_SHIFT_PAST: 7일 넘게 지난 근무표는 지우지 않습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.work_on < v_lock OR (TG_OP = 'UPDATE' AND OLD.work_on < v_lock) THEN
    RAISE EXCEPTION 'HRX_SHIFT_PAST: 7일 넘게 지난 근무표는 넣거나 바꾸지 않습니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.employee_id, NEW.work_on, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.employee_id, OLD.work_on, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_SHIFT: 직원 · 날짜는 바꾸지 않습니다(지우고 다시).';
  END IF;
  SELECT * INTO t FROM public.hrx_shift_types WHERE code = NEW.type_code;
  IF t.code IS NULL OR (NOT t.active AND (TG_OP = 'INSERT' OR NEW.type_code IS DISTINCT FROM OLD.type_code)) THEN
    RAISE EXCEPTION 'HRX_SHIFT_TYPE: 쓰는 교대 유형만 넣습니다.';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.type_code IS DISTINCT FROM OLD.type_code THEN
    NEW.kind := t.kind; NEW.start_hm := t.start_hm; NEW.end_hm := t.end_hm; NEW.break_min := t.break_min;
  ELSIF (NEW.kind, NEW.start_hm, NEW.end_hm, NEW.break_min) IS DISTINCT FROM (OLD.kind, OLD.start_hm, OLD.end_hm, OLD.break_min) THEN
    RAISE EXCEPTION 'HRX_SHIFT: 칸 시각은 유형을 바꿔서 바꿉니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_shift_types_guard' AND tgrelid = 'public.hrx_shift_types'::regclass) THEN
    CREATE TRIGGER trg_hrx_shift_types_guard BEFORE UPDATE OR DELETE ON public.hrx_shift_types FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_shift_types_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_shifts_guard' AND tgrelid = 'public.hrx_shifts'::regclass) THEN
    CREATE TRIGGER trg_hrx_shifts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hrx_shifts FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_shifts_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hrx.shift_grace_min', '10', 'ADMIN', '근무표 · 근태 비교 여유(v10.472 · D265) — 교대 시작 뒤 · 끝 앞 이 분 안은 「늦음 · 일찍 감」으로 보지 않음(0 ~ 60)', false, '^([0-9]|[1-5][0-9]|60)$', '10')
ON CONFLICT (key) DO NOTHING;

/* ── v10.473 (D265 · docs/611) 회의실 · 장비 예약 — 자원(회의실 · 장비) · 시간대 예약 · 겹치면 DB 가 막음(배제 제약 ex_hrx_booking_overlap) ──
 *   예약 = [시작, 끝) 반열린 구간 — 10:00 ~ 11:00 과 11:00 ~ 12:00 은 겹치지 않음 · 취소한 예약은 겹침에서 빠짐
 *   예약 내용(자원 · 시각 · 제목)은 고치지 않음(취소하고 다시) · 지우지 않음 · 취소는 한 번
 *   자원은 지우지 않음(쓰지 않음으로) · 쓰지 않는 자원에는 새 예약 못 넣음
 *   ㉜ 사내 일정 캘린더(D263)에 「내 예약」으로 보이게 하는 읽기 함수는 hrx-booking.ts bookingCalItems(합칠 때 연결 · NOTES) */
CREATE TABLE IF NOT EXISTS public.hrx_resources (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL DEFAULT 'ROOM' CHECK (kind IN ('ROOM', 'EQUIP')),
  name        text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  location    text CHECK (location IS NULL OR char_length(location) <= 60),
  capacity    integer CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  active      boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 9999),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hrx_resources IS 'v10.473 (D265) 예약 자원 — 회의실(ROOM · 인원) · 장비(EQUIP) · ADMIN 이 넣고 고침 · 지우지 않음(쓰지 않음으로)';

CREATE TABLE IF NOT EXISTS public.hrx_bookings (
  id             bigserial PRIMARY KEY,
  resource_id    bigint NOT NULL REFERENCES public.hrx_resources(id),
  booked_by      uuid NOT NULL REFERENCES public.accounts(id),
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 200),
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  canceled_at    timestamptz,
  canceled_by    uuid REFERENCES public.accounts(id),
  cancel_reason  text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hxb_span CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours'),
  CONSTRAINT ck_hxb_cancel CHECK ((canceled_at IS NULL) = (canceled_by IS NULL)),
  CONSTRAINT ex_hrx_booking_overlap EXCLUDE USING gist (resource_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (canceled_at IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_hxb_time ON public.hrx_bookings (start_at, resource_id) WHERE canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_hxb_who ON public.hrx_bookings (booked_by, start_at);
COMMENT ON TABLE public.hrx_bookings IS 'v10.473 (D265) 회의실 · 장비 예약 — [시작, 끝) · 같은 자원 살아 있는 예약은 시간이 겹치지 않음(배제 제약 ex_hrx_booking_overlap) · 내용 못 고침 · 취소 한 번 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_hrx_resources_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_RESOURCE: 예약 자원은 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.kind, NEW.created_at) IS DISTINCT FROM (OLD.kind, OLD.created_at) THEN RAISE EXCEPTION 'HRX_RESOURCE: 자원 종류 · 만든 시각은 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hrx_bookings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_BOOKING: 예약은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.hrx_resources r WHERE r.id = NEW.resource_id AND r.active) THEN
      RAISE EXCEPTION 'HRX_BOOKING: 쓰지 않는 자원에는 예약하지 않습니다.';
    END IF;
    IF NEW.canceled_at IS NOT NULL THEN RAISE EXCEPTION 'HRX_BOOKING: 새 예약은 취소 상태로 넣지 않습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.resource_id, NEW.booked_by, NEW.title, NEW.memo, NEW.start_at, NEW.end_at, NEW.created_at)
     IS DISTINCT FROM (OLD.resource_id, OLD.booked_by, OLD.title, OLD.memo, OLD.start_at, OLD.end_at, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_BOOKING: 예약 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF OLD.canceled_at IS NOT NULL AND (NEW.canceled_at, NEW.canceled_by, NEW.cancel_reason) IS DISTINCT FROM (OLD.canceled_at, OLD.canceled_by, OLD.cancel_reason) THEN
    RAISE EXCEPTION 'HRX_BOOKING: 이미 취소한 예약입니다.';
  END IF;
  IF OLD.canceled_at IS NULL AND NEW.canceled_at IS NULL AND NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
    RAISE EXCEPTION 'HRX_BOOKING: 취소 사유는 취소할 때만 씁니다.';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_resources_guard' AND tgrelid = 'public.hrx_resources'::regclass) THEN
    CREATE TRIGGER trg_hrx_resources_guard BEFORE UPDATE OR DELETE ON public.hrx_resources FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_resources_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_bookings_guard' AND tgrelid = 'public.hrx_bookings'::regclass) THEN
    CREATE TRIGGER trg_hrx_bookings_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hrx_bookings FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_bookings_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('hrx.book_ahead_days', '90', 'ADMIN', '회의실 · 장비 예약 — 오늘부터 며칠 뒤까지 예약 받음(v10.473 · D265 · 1 ~ 365)', false, '^([1-9]|[1-9][0-9]|[1-2][0-9]{2}|3[0-5][0-9]|36[0-5])$', '90'),
  ('hrx.book_max_hours', '8', 'ADMIN', '회의실 · 장비 예약 — 한 번에 몇 시간까지(v10.473 · D265 · 1 ~ 24)', false, '^([1-9]|1[0-9]|2[0-4])$', '8')
ON CONFLICT (key) DO NOTHING;

/* ── v10.474 (D265 · docs/612) 자산 실사 — ⑬ 고정자산 대장(acct_assets)에 QR 라벨(자산 코드 SGB-AST-000123 · 화면에서 그림) · 실사 회차 · 찾음 · 없음 · 없어진 자산은 처분 전표로 ──
 *   회차를 열면 기준일까지 취득한 쓰는 자산(ACTIVE)이 모두 「확인 전」 줄로 들어감(자산 하나 한 줄)
 *   열린 회차만 찾음 · 없음을 적음 · 닫으면 못 고침 · 닫을 때 확인 전 줄은 없음으로(고른 경우만)
 *   닫은 회차의 「없음」 자산은 SUPER 가 처분(⑬ disposeAsset · 받은 돈 0 · 사유 실사) → 다음 전표 작업에서 ASSET_DISPOSE 처분 손실 전표 · 줄에 처분 시각
 *   회차 · 줄은 지우지 않음 */
CREATE TABLE IF NOT EXISTS public.hrx_stocktakes (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 60),
  as_of       date NOT NULL,
  state       text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_by   uuid REFERENCES public.accounts(id),
  closed_at   timestamptz,
  CONSTRAINT ck_hxk_closed CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL))
);
COMMENT ON TABLE public.hrx_stocktakes IS 'v10.474 (D265) 자산 실사 회차 — 기준일 · 열림 → 닫음(되돌리지 않음) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hrx_stocktake_lines (
  id            bigserial PRIMARY KEY,
  stocktake_id  bigint NOT NULL REFERENCES public.hrx_stocktakes(id),
  asset_id      bigint NOT NULL REFERENCES public.acct_assets(id),
  result        text NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'FOUND', 'MISSING')),
  location      text CHECK (location IS NULL OR char_length(location) <= 60),
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  checked_by    uuid REFERENCES public.accounts(id),
  checked_at    timestamptz,
  disposed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrx_stocktake_asset UNIQUE (stocktake_id, asset_id),
  CONSTRAINT ck_hxkl_disposed CHECK (disposed_at IS NULL OR result = 'MISSING')
);
CREATE INDEX IF NOT EXISTS ix_hxkl_asset ON public.hrx_stocktake_lines (asset_id, stocktake_id);
COMMENT ON TABLE public.hrx_stocktake_lines IS 'v10.474 (D265) 자산 실사 줄 — 확인 전 · 찾음(QR 읽기 · 손으로) · 없음 · 둔 곳 · 열린 회차만 고침 · 없음 자산 처분 시각(닫은 뒤 한 번) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_hrx_stocktakes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_STOCKTAKE: 실사 회차는 지우지 않습니다.'; END IF;
  IF (NEW.title, NEW.as_of, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.title, OLD.as_of, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_STOCKTAKE: 회차 이름 · 기준일은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 닫은 회차는 고치지 않습니다.'; END IF;
  IF NEW.state = 'CLOSED' AND EXISTS (SELECT 1 FROM public.hrx_stocktake_lines l WHERE l.stocktake_id = OLD.id AND l.result = 'PENDING') THEN
    RAISE EXCEPTION 'HRX_STOCKTAKE_PENDING: 확인 전 자산이 남아 있어 닫지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hrx_stocktake_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_STOCKTAKE: 실사 줄은 지우지 않습니다.'; END IF;
  SELECT state INTO v_state FROM public.hrx_stocktakes WHERE id = NEW.stocktake_id;
  IF TG_OP = 'INSERT' THEN
    IF v_state IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 열린 회차에만 자산을 넣습니다.'; END IF;
    IF NEW.disposed_at IS NOT NULL THEN RAISE EXCEPTION 'HRX_STOCKTAKE: 처분 시각은 닫은 뒤에 씁니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.stocktake_id, NEW.asset_id, NEW.created_at) IS DISTINCT FROM (OLD.stocktake_id, OLD.asset_id, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_STOCKTAKE: 회차 · 자산은 바꾸지 않습니다.';
  END IF;
  IF NEW.disposed_at IS DISTINCT FROM OLD.disposed_at THEN
    IF OLD.disposed_at IS NOT NULL OR v_state <> 'CLOSED' OR OLD.result <> 'MISSING'
       OR NOT EXISTS (SELECT 1 FROM public.acct_assets a WHERE a.id = OLD.asset_id AND a.state = 'DISPOSED') THEN
      RAISE EXCEPTION 'HRX_STOCKTAKE_DISPOSE: 처분 시각은 닫은 회차의 없음 자산을 처분한 뒤 한 번만 씁니다.';
    END IF;
    IF (NEW.result, NEW.location, NEW.note, NEW.checked_by, NEW.checked_at) IS DISTINCT FROM (OLD.result, OLD.location, OLD.note, OLD.checked_by, OLD.checked_at) THEN
      RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 닫은 회차 줄은 고치지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  /* 닫는 거래 안에서 확인 전 → 없음으로 바꾸는 것은 회차가 아직 열려 있을 때(닫기 전에) 함 */
  IF v_state <> 'OPEN' THEN RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 닫은 회차 줄은 고치지 않습니다.'; END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_stocktakes_guard' AND tgrelid = 'public.hrx_stocktakes'::regclass) THEN
    CREATE TRIGGER trg_hrx_stocktakes_guard BEFORE UPDATE OR DELETE ON public.hrx_stocktakes FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_stocktakes_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hrx_stocktake_lines_guard' AND tgrelid = 'public.hrx_stocktake_lines'::regclass) THEN
    CREATE TRIGGER trg_hrx_stocktake_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hrx_stocktake_lines FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_stocktake_lines_guard();
  END IF;
END $$;

/* ── ㉟ (D265) 업무 권한(⑳ D258) — 새 탭 4개 업무 · 처음 변환 그룹(R_) 범위 · 주소 → 업무
 *   hrx-overtime · hrx-shifts = 운영 관리자(R_ADMIN) — @Roles('ADMIN') 와 같은 범위
 *   hrx-booking  = 운영 역할 모두(R_ADMIN · R_PAYOUT · R_REVIEWER · R_PARTNER_MAL · R_PARTNER_AFF) 보기 · 예약(VIEW · EDIT) · 자원 관리(APPROVE)는 R_ADMIN 만
 *   hrx-stocktake = R_ADMIN · R_PAYOUT(고정자산 대장을 보는 지급 담당) — 처분(dispose)은 @Roles('SUPER')
 *   가산율 · 한도 고치기(PUT …/overtime/rules) · 교대 유형 고치기(PUT …/shifts/types/{code}) · 처분은 @Roles('SUPER') — SUPER 는 권한 검사를 늘 통과하므로 맵에는 APPROVE 로만
 *   내 연장 근로 · 내 근무표(/admin/me/hrx…)는 본인 것만 보는 주소라 맵에 넣지 않음(@Roles 만 · D259 my-hr 와 같음)
 *   세무사(R_ACCOUNTANT)는 넣지 않음 — 주소가 /admin/hrx 아래라 세무사 읽기(/admin/acct GET)에도 걸리지 않음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hrx-overtime', '연장 근로', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2600),
  ('hrx-shifts', '근무표', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2610),
  ('hrx-booking', '회의실 · 장비 예약', 'admoff', ARRAY['VIEW','EDIT','APPROVE'], 2620),
  ('hrx-stocktake', '자산 실사', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2630)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN', 'hrx-overtime'), ('R_ADMIN', 'hrx-shifts'), ('R_ADMIN', 'hrx-stocktake'), ('R_PAYOUT', 'hrx-stocktake')) x(g, t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'hrx-booking', l FROM (VALUES ('R_ADMIN'), ('R_PAYOUT'), ('R_REVIEWER'), ('R_PARTNER_MAL'), ('R_PARTNER_AFF')) x(g)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'hrx-booking', 'APPROVE' WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hrx/overtime', 'hrx-overtime', 'VIEW'),
  ('POST', '/admin/hrx/overtime', 'hrx-overtime', 'EDIT'),
  ('POST', '/admin/hrx/overtime/{id}/decide', 'hrx-overtime', 'APPROVE'),
  ('POST', '/admin/hrx/overtime/{id}/revoke', 'hrx-overtime', 'APPROVE'),
  ('PUT', '/admin/hrx/overtime/rules', 'hrx-overtime', 'APPROVE'),
  ('GET', '/admin/hrx/overtime/payroll', 'hrx-overtime', 'VIEW'),
  ('POST', '/admin/hrx/overtime/payroll', 'hrx-overtime', 'APPROVE'),
  ('POST', '/admin/hrx/overtime/payroll/undo', 'hrx-overtime', 'APPROVE'),
  ('GET', '/admin/hrx/shifts', 'hrx-shifts', 'VIEW'),
  ('PUT', '/admin/hrx/shifts', 'hrx-shifts', 'EDIT'),
  ('POST', '/admin/hrx/shifts/copy', 'hrx-shifts', 'EDIT'),
  ('PUT', '/admin/hrx/shifts/types/{code}', 'hrx-shifts', 'APPROVE'),
  ('GET', '/admin/hrx/booking', 'hrx-booking', 'VIEW'),
  ('POST', '/admin/hrx/booking', 'hrx-booking', 'EDIT'),
  ('POST', '/admin/hrx/booking/{id}/cancel', 'hrx-booking', 'EDIT'),
  ('POST', '/admin/hrx/booking/resources', 'hrx-booking', 'APPROVE'),
  ('PUT', '/admin/hrx/booking/resources/{id}', 'hrx-booking', 'APPROVE'),
  ('GET', '/admin/hrx/stocktakes', 'hrx-stocktake', 'VIEW'),
  ('POST', '/admin/hrx/stocktakes', 'hrx-stocktake', 'EDIT'),
  ('GET', '/admin/hrx/stocktakes/{id}', 'hrx-stocktake', 'VIEW'),
  ('POST', '/admin/hrx/stocktakes/{id}/scan', 'hrx-stocktake', 'EDIT'),
  ('PUT', '/admin/hrx/stocktakes/{id}/lines/{assetId}', 'hrx-stocktake', 'EDIT'),
  ('POST', '/admin/hrx/stocktakes/{id}/close', 'hrx-stocktake', 'APPROVE'),
  ('POST', '/admin/hrx/stocktakes/{id}/dispose', 'hrx-stocktake', 'APPROVE'),
  ('GET', '/admin/hrx/asset-labels', 'hrx-stocktake', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;


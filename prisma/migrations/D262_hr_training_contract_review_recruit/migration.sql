/* D262 (v10.458 ~ 461 · docs/596 ~ 599) ㉛ 인사 3 — 법정 의무교육 · 근로계약서 전자서명(간주 · 처음 off) · 인사 평가 · 목표 · 채용(지원자 서류 자동 파기) · 인사 전용 파일 용도 HR_DOC */

/* ── v10.458 (D262 · docs/596) 법정 의무교육 — 종류 · 주기 · 시간(일반 원칙 값 · SUPER 고침) · 직원별 이수(증빙 파일 인사 전용 HR_DOC) · 기한 알림 ──
 *   종류 4개(처음 값 · 일반 원칙): 성희롱 예방(연 1회 · 1시간) · 개인정보보호(연 1회 · 1시간) · 장애인 인식 개선(연 1회 · 1시간) · 산업안전보건 정기(반기 · 6시간)
 *   기간 = 연(YYYY) 또는 반기(YYYY-H1 · YYYY-H2) · 이수 = 그 기간 확인(CONFIRMED) 시간 합 ≥ 최소 시간
 *   본인 제출(SUBMITTED) → 관리자 확인(CONFIRMED · 본인 아님) · 잘못 넣은 줄은 무효(VOID · 사유) · 지우지 않음
 *   기한 N일(hr.training_due_days · 30) 전부터 운영 알림 HR_TRAINING_DUE · 지난 기간 미이수 HR_TRAINING_OVERDUE · 정기 작업 hr_training_due 매일 09:45
 *   법 조문 · 과태료 · 적용 사업장 범위는 노무사 확인 필요(docs/596). */
CREATE TABLE IF NOT EXISTS public.hr_training_kinds (
  code          text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,30}$'),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  basis         text CHECK (basis IS NULL OR char_length(basis) <= 200),
  cycle_months  integer NOT NULL DEFAULT 12 CHECK (cycle_months IN (6, 12)),
  min_hours     numeric(4,1) NOT NULL DEFAULT 1 CHECK (min_hours > 0 AND min_hours <= 40),
  active        boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 9999),
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hr_training_kinds IS 'v10.458 (D262) 법정 의무교육 종류 — 주기(6 · 12달) · 최소 시간 · 근거 · 처음 4개는 일반 원칙 값 · SUPER 가 고치고 더함 · 지우지 않음(쓰지 않음 표시) · created_at 전에 끝난 기간은 기한 지남 알림을 띄우지 않음';

INSERT INTO public.hr_training_kinds (code, name, basis, cycle_months, min_hours, active, sort) VALUES
  ('SEXUAL_HARASSMENT', '직장 내 성희롱 예방교육', '남녀고용평등법 제13조 · 시행령 제3조 — 연 1회 이상(일반 원칙 · 확인 필요)', 12, 1, true, 10),
  ('PRIVACY', '개인정보보호 교육', '개인정보 보호법 제28조(개인정보취급자 교육) · 내부 관리계획 — 연 1회 이상(일반 원칙 · 확인 필요)', 12, 1, true, 20),
  ('DISABILITY_AWARENESS', '직장 내 장애인 인식 개선 교육', '장애인고용촉진법 제5조의2 · 시행령 — 연 1회 이상 · 1시간 이상(일반 원칙 · 확인 필요)', 12, 1, true, 30),
  ('SAFETY', '산업안전보건 정기교육', '산업안전보건법 제29조 · 시행규칙 별표4 — 사무직 매 반기 6시간 이상(업종 · 규모별 적용 확인 필요)', 6, 6, true, 40)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_hr_training_kinds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_TRAINING_KIND: 교육 종류는 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.code, OLD.created_at) THEN RAISE EXCEPTION 'HR_TRAINING_KIND: 종류 코드 · 만든 시각은 바꾸지 않습니다.'; END IF;
  IF NEW.cycle_months IS DISTINCT FROM OLD.cycle_months
     AND EXISTS (SELECT 1 FROM public.hr_training_records r WHERE r.kind_code = OLD.code) THEN
    RAISE EXCEPTION 'HR_TRAINING_KIND_USED: 이수 기록이 있는 종류는 주기를 바꾸지 않습니다(새 종류로).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.hr_training_records (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  kind_code    text NOT NULL REFERENCES public.hr_training_kinds(code),
  period       text NOT NULL CHECK (period ~ '^[0-9]{4}(-H[12])?$'),
  done_on      date NOT NULL,
  hours        numeric(4,1) NOT NULL CHECK (hours > 0 AND hours <= 40),
  method       text NOT NULL DEFAULT 'ONLINE' CHECK (method IN ('ONLINE', 'CLASS', 'ETC')),
  provider     text CHECK (provider IS NULL OR char_length(provider) <= 100),
  file_id      uuid REFERENCES public.files(id),
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  state        text NOT NULL DEFAULT 'SUBMITTED' CHECK (state IN ('SUBMITTED', 'CONFIRMED', 'VOID')),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  void_reason  text CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 2 AND 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_htr_void CHECK (state <> 'VOID' OR void_reason IS NOT NULL),
  CONSTRAINT ck_htr_decided CHECK (state = 'SUBMITTED' OR decided_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_htr_period ON public.hr_training_records (kind_code, period, employee_id) WHERE state <> 'VOID';
CREATE INDEX IF NOT EXISTS ix_htr_emp ON public.hr_training_records (employee_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_htr_file ON public.hr_training_records (file_id) WHERE file_id IS NOT NULL;
COMMENT ON TABLE public.hr_training_records IS 'v10.458 (D262) 법정 의무교육 이수 — 직원 · 종류 · 기간 · 이수일 · 시간 · 증빙 파일(HR_DOC) · 본인 제출 → 관리자 확인(본인 아님) · 무효(사유) · 내용 못 고침 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_hr_training_records_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cycle integer; f public.files;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_TRAINING: 이수 기록은 지우지 않습니다(무효로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT cycle_months INTO v_cycle FROM public.hr_training_kinds WHERE code = NEW.kind_code;
    IF v_cycle = 12 AND NEW.period !~ '^[0-9]{4}$' OR v_cycle = 6 AND NEW.period !~ '^[0-9]{4}-H[12]$' THEN
      RAISE EXCEPTION 'HR_TRAINING_PERIOD: 기간이 종류 주기와 맞지 않습니다.';
    END IF;
    IF substr(NEW.period, 1, 4) <> to_char(NEW.done_on, 'YYYY') THEN
      RAISE EXCEPTION 'HR_TRAINING_PERIOD: 이수일이 기간 안에 있어야 합니다.';
    END IF;
    IF NEW.file_id IS NOT NULL THEN
      SELECT * INTO f FROM public.files WHERE id = NEW.file_id;
      IF f.id IS NULL OR f.purpose <> 'HR_DOC' OR f.status <> 'READY' THEN
        RAISE EXCEPTION 'HR_TRAINING_FILE: 증빙은 인사 서류 용도(HR_DOC)로 올린 파일(READY)만 붙입니다.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.employee_id, NEW.kind_code, NEW.period, NEW.done_on, NEW.hours, NEW.method, NEW.provider, NEW.file_id, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.kind_code, OLD.period, OLD.done_on, OLD.hours, OLD.method, OLD.provider, OLD.file_id, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_TRAINING: 이수 내용은 고치지 않습니다(무효로 하고 다시).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'SUBMITTED' AND NEW.state IN ('CONFIRMED', 'VOID')) OR (OLD.state = 'CONFIRMED' AND NEW.state = 'VOID')) THEN
      RAISE EXCEPTION 'HR_TRAINING_STATE: 이수 상태는 앞으로만 바뀝니다.';
    END IF;
  ELSIF (NEW.decided_by, NEW.decided_at, NEW.void_reason) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.void_reason) THEN
    RAISE EXCEPTION 'HR_TRAINING_STATE: 처리 기록은 상태를 바꿀 때만 씁니다.';
  END IF;
  RETURN NEW;
END $$;

/* 인사 서류(HR_DOC) 지우기 막음 — 공용 fn_files_acct_guard 를 다시 쓰지 않고 따로 트리거(다른 묶음과 겹치지 않게)
 *   의무교육 이수(무효 아님)에 붙은 증빙 · 파기 전 지원자 서류(파기는 지원자 줄에서 서류 번호를 먼저 비운 뒤 파일을 지움 — hr-recruit.ts purgeOne) */
CREATE OR REPLACE FUNCTION public.fn_hr_files_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' AND OLD.purpose = 'HR_DOC' THEN
    IF EXISTS (SELECT 1 FROM public.hr_training_records r WHERE r.file_id = OLD.id AND r.state <> 'VOID') THEN
      RAISE EXCEPTION 'FILE: 의무교육 이수에 붙은 증빙 파일은 지울 수 없습니다';
    END IF;
    IF to_regclass('public.hr_applicants') IS NOT NULL AND EXISTS (SELECT 1 FROM public.hr_applicants a WHERE OLD.id = ANY (a.file_ids)) THEN
      RAISE EXCEPTION 'FILE: 지원자에 붙은 서류는 지울 수 없습니다(불합격 · 철회 뒤 파기로)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_training_kinds_guard' AND tgrelid = 'public.hr_training_kinds'::regclass) THEN
    CREATE TRIGGER trg_hr_training_kinds_guard BEFORE UPDATE OR DELETE ON public.hr_training_kinds FOR EACH ROW EXECUTE FUNCTION public.fn_hr_training_kinds_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_training_records_guard' AND tgrelid = 'public.hr_training_records'::regclass) THEN
    CREATE TRIGGER trg_hr_training_records_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hr_training_records FOR EACH ROW EXECUTE FUNCTION public.fn_hr_training_records_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_files_guard' AND tgrelid = 'public.files'::regclass) THEN
    CREATE TRIGGER trg_hr_files_guard BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.fn_hr_files_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hr.training_due_days', '30', 'ADMIN', '법정 의무교육 기한 알림(v10.458 · D262) — 기간 끝 며칠 전부터 미이수 직원이 있으면 운영 알림 HR_TRAINING_DUE(1 ~ 180)', false, '^([1-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('hr_training_due', 1440, 9, 45, NULL, true, '법정 의무교육 기한 알림 — 매일 09:45 · 기간 끝 N일 전 HR_TRAINING_DUE · 지난 기간 미이수 HR_TRAINING_OVERDUE(종류 · 기간마다 한 번 · 모두 이수하면 풀림) · D262 · v10.458')
ON CONFLICT (job) DO NOTHING;

/* ── v10.459 (D262 · docs/597) 근로계약서 전자서명 — 양식(판 쌓기) · 직원별 계약서(본문 · 지문 고정) · 서명 · 서명본 보관 ──
 *   서명 길: 스위치 hr.contract_esign(처음 off) — off 면 간주(ASSUME · 운영 화면 › 사무 › 내 인사에서 본인이 이름을 적고 「서명」 · 법적 전자서명 아님 표시)
 *            on 이면 기존 전자계약 방식 esign.provider(STUB · MOCK · HTTP)를 그대로 — HTTP 는 기존 ESIGN 어댑터(HttpESign) · 키 없으면 NOT_READY
 *   서명본 = 보낸 때 고정한 본문 + SHA-256 지문 + 서명 시각 · 서명자 이름(서명 뒤 아무것도 못 고침 · 지우지 않음).
 *   근로기준법 제17조 필수 명시 사항(임금 · 소정근로시간 · 휴일 · 연차 · 장소 · 업무)을 처음 양식에 넣음 — 노무사 확인 필요(docs/597). */
CREATE TABLE IF NOT EXISTS public.hr_contract_templates (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,30}$'),
  version     integer NOT NULL CHECK (version >= 1),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  kind        text NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR', 'FIXED_TERM', 'PART_TIME')),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 20000),
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hr_contract_template UNIQUE (code, version)
);
COMMENT ON TABLE public.hr_contract_templates IS 'v10.459 (D262) 근로계약서 양식 — 코드 · 판(고치면 새 판) · 본문 자리표 {{이름}} 등 · 본문 못 고침 · 지우지 않음(쓰지 않음 표시만)';

INSERT INTO public.hr_contract_templates (code, version, name, kind, body) VALUES
('STANDARD', 1, '표준 근로계약서(기간의 정함이 없는 경우)', 'REGULAR',
'근로계약서

{{company}}(이하 「회사」)와 {{name}}(이하 「근로자」)은 다음과 같이 근로계약을 맺는다.

1. 근로 시작일: {{startOn}}부터 (계약 끝: {{endOn}})
2. 일하는 곳: {{place}}
3. 하는 일: {{duties}}
4. 소정근로시간: {{workTime}} (휴게시간 {{breakTime}})
5. 근무일 · 휴일: {{workDays}} 근무 · 주휴일 {{holiday}}
6. 임금
   - {{wageType}} {{wage}}원
   - 지급일: 매월 {{payDay}}일(휴일이면 전날)
   - 지급 방법: {{payMethod}}
7. 연차유급휴가: 근로기준법에서 정하는 바에 따라 준다.
8. 사회보험: 고용보험 · 산재보험 · 국민연금 · 건강보험에 가입한다.
9. 근로계약서 교부: 회사는 계약을 맺는 즉시 이 계약서를 근로자에게 준다(전자 문서로 줄 수 있음).
10. 그 밖의 사항은 근로기준법 · 취업규칙에 따른다.

{{signedOn}}
회사: {{company}}
근로자: {{name}}')
ON CONFLICT (code, version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_hr_contract_templates_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_CONTRACT_TEMPLATE: 양식은 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.version, NEW.name, NEW.kind, NEW.body, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.code, OLD.version, OLD.name, OLD.kind, OLD.body, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_CONTRACT_TEMPLATE: 양식 본문은 고치지 않습니다(새 판으로).';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.hr_contracts (
  id             bigserial PRIMARY KEY,
  employee_id    bigint NOT NULL REFERENCES public.acct_employees(id),
  template_id    bigint NOT NULL REFERENCES public.hr_contract_templates(id),
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  terms          jsonb NOT NULL DEFAULT '{}'::jsonb,
  body           text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 30000),
  doc_hash       text NOT NULL CHECK (doc_hash ~ '^[0-9a-f]{64}$'),
  state          text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'SENT', 'SIGNED', 'CANCELED')),
  sign_mode      text CHECK (sign_mode IS NULL OR sign_mode IN ('ASSUME', 'STUB', 'MOCK', 'HTTP')),
  vendor_doc_id  text CHECK (vendor_doc_id IS NULL OR char_length(vendor_doc_id) <= 200),
  sign_url       text CHECK (sign_url IS NULL OR char_length(sign_url) <= 1000),
  sent_by        uuid REFERENCES public.accounts(id),
  sent_at        timestamptz,
  signer_name    text CHECK (signer_name IS NULL OR char_length(btrim(signer_name)) BETWEEN 1 AND 40),
  signed_at      timestamptz,
  sign_evidence  jsonb,
  canceled_at    timestamptz,
  cancel_reason  text CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 2 AND 200),
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hrc_sent CHECK (state = 'DRAFT' OR state = 'CANCELED' OR (sent_at IS NOT NULL AND sign_mode IS NOT NULL)),
  CONSTRAINT ck_hrc_signed CHECK (state <> 'SIGNED' OR (signed_at IS NOT NULL AND signer_name IS NOT NULL)),
  CONSTRAINT ck_hrc_canceled CHECK (state <> 'CANCELED' OR (canceled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_hrc_emp ON public.hr_contracts (employee_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_hrc_state ON public.hr_contracts (state, id DESC);
COMMENT ON TABLE public.hr_contracts IS 'v10.459 (D262) 근로계약서 — 양식 + 조건으로 본문 고정 · 지문(SHA-256) · 보냄(서명 길 ASSUME · STUB · MOCK · HTTP) → 서명(서명본 보관) · 취소(사유) · 본문 못 고침 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_hr_contracts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_CONTRACT: 근로계약서는 지우지 않습니다(취소로).'; END IF;
  IF (NEW.employee_id, NEW.template_id, NEW.title, NEW.terms, NEW.body, NEW.doc_hash, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.template_id, OLD.title, OLD.terms, OLD.body, OLD.doc_hash, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_CONTRACT: 계약서 본문 · 조건은 고치지 않습니다(취소하고 새로).';
  END IF;
  IF OLD.state IN ('SIGNED', 'CANCELED') THEN RAISE EXCEPTION 'HR_CONTRACT_STATE: 서명 · 취소한 계약서는 바꾸지 않습니다.'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('SENT', 'CANCELED')) OR (OLD.state = 'SENT' AND NEW.state IN ('SIGNED', 'CANCELED'))) THEN
    RAISE EXCEPTION 'HR_CONTRACT_STATE: 계약서 상태는 앞으로만 바뀝니다.';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_contract_templates_guard' AND tgrelid = 'public.hr_contract_templates'::regclass) THEN
    CREATE TRIGGER trg_hr_contract_templates_guard BEFORE UPDATE OR DELETE ON public.hr_contract_templates FOR EACH ROW EXECUTE FUNCTION public.fn_hr_contract_templates_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_contracts_guard' AND tgrelid = 'public.hr_contracts'::regclass) THEN
    CREATE TRIGGER trg_hr_contracts_guard BEFORE UPDATE OR DELETE ON public.hr_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_hr_contracts_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hr.contract_esign', 'off', 'ADMIN', '근로계약서 전자서명 연동(v10.459 · D262) — 처음 off(간주 · 운영 화면 안에서 본인 서명 · 법적 전자서명 아님 표시) · on 이면 전자계약 방식(esign.provider)으로 · HTTP 는 ESIGN 키가 있어야 함(없으면 NOT_READY)', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ── v10.460 (D262 · docs/598) 인사 평가 · 목표 — 분기 차례(목표 → 평가 → 닫음) · 직원 목표(가중치) · 자기 평가 · 상사 평가(본인 아님) · 등급 ──
 *   차례 상태 GOALS(직원이 목표 적음) → REVIEW(자기 평가 · 상사 평가) → CLOSED(못 고침 · 직원에게 상사 점수 · 등급 보임)
 *   점수 1 ~ 5 · 가중 평균 → 등급 제안(hr.review_grade_cuts 처음 S 4.5 · A 3.5 · B 2.5 · C 1.5 · 그 아래 D · 회사 규정으로 SUPER 고침) · 상사가 등급을 골라 확정
 *   직원은 자기 것만 봄 · 차례 만들기 · 넘기기는 ADMIN(SUPER 늘 통과). */
CREATE TABLE IF NOT EXISTS public.hr_review_cycles (
  id           bigserial PRIMARY KEY,
  year         integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  quarter      integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 60),
  state        text NOT NULL DEFAULT 'GOALS' CHECK (state IN ('GOALS', 'REVIEW', 'CLOSED')),
  goal_due     date,
  review_due   date,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_by    uuid REFERENCES public.accounts(id),
  closed_at    timestamptz,
  CONSTRAINT uq_hr_review_cycle UNIQUE (year, quarter),
  CONSTRAINT ck_hrrc_due CHECK (review_due IS NULL OR goal_due IS NULL OR review_due >= goal_due),
  CONSTRAINT ck_hrrc_closed CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL))
);
COMMENT ON TABLE public.hr_review_cycles IS 'v10.460 (D262) 인사 평가 차례 — 해 · 분기 하나에 하나 · GOALS → REVIEW → CLOSED(앞으로만) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hr_review_goals (
  id           bigserial PRIMARY KEY,
  cycle_id     bigint NOT NULL REFERENCES public.hr_review_cycles(id),
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  measure      text CHECK (measure IS NULL OR char_length(measure) <= 200),
  weight       integer NOT NULL CHECK (weight BETWEEN 1 AND 100),
  self_score   smallint CHECK (self_score IS NULL OR self_score BETWEEN 1 AND 5),
  self_note    text CHECK (self_note IS NULL OR char_length(self_note) <= 300),
  mgr_score    smallint CHECK (mgr_score IS NULL OR mgr_score BETWEEN 1 AND 5),
  mgr_note     text CHECK (mgr_note IS NULL OR char_length(mgr_note) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hrrg_cycle_emp ON public.hr_review_goals (cycle_id, employee_id, id);
COMMENT ON TABLE public.hr_review_goals IS 'v10.460 (D262) 분기 목표 — 직원이 GOALS 때 적음(가중치 합 100) · REVIEW 때 자기 점수 · 상사 점수 · CLOSED 뒤 못 고침';

CREATE TABLE IF NOT EXISTS public.hr_review_results (
  cycle_id           bigint NOT NULL REFERENCES public.hr_review_cycles(id),
  employee_id        bigint NOT NULL REFERENCES public.acct_employees(id),
  self_comment       text CHECK (self_comment IS NULL OR char_length(self_comment) <= 1000),
  self_submitted_at  timestamptz,
  mgr_comment        text CHECK (mgr_comment IS NULL OR char_length(mgr_comment) <= 1000),
  mgr_avg            numeric(3,2) CHECK (mgr_avg IS NULL OR mgr_avg BETWEEN 1 AND 5),
  grade              text CHECK (grade IS NULL OR grade IN ('S', 'A', 'B', 'C', 'D')),
  reviewed_by        uuid REFERENCES public.accounts(id),
  reviewed_at        timestamptz,
  PRIMARY KEY (cycle_id, employee_id),
  CONSTRAINT ck_hrrr_grade CHECK (grade IS NULL OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
COMMENT ON TABLE public.hr_review_results IS 'v10.460 (D262) 평가 결과 — 자기 평가 의견 · 제출 시각 · 상사 의견 · 가중 평균 · 등급(상사 · 본인 아님) · CLOSED 뒤 못 고침 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_hr_review_cycles_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_REVIEW: 평가 차례는 지우지 않습니다.'; END IF;
  IF (NEW.year, NEW.quarter, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.year, OLD.quarter, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_REVIEW: 해 · 분기는 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'HR_REVIEW_CLOSED: 닫은 평가 차례는 바꾸지 않습니다.'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state = 'GOALS' AND NEW.state = 'REVIEW') OR (OLD.state = 'REVIEW' AND NEW.state = 'CLOSED')) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 평가 차례는 목표 → 평가 → 닫음 순서로만 넘어갑니다.';
  END IF;
  RETURN NEW;
END $$;

/* 목표: 차례 상태에 따라 고칠 수 있는 칸이 다름 — GOALS 는 목표 · 가중치만(점수 없음) · REVIEW 는 점수 · 의견만 · CLOSED 는 아무것도 */
CREATE OR REPLACE FUNCTION public.fn_hr_review_goals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.hr_review_cycles WHERE id = coalesce(NEW.cycle_id, OLD.cycle_id);
  IF v_state = 'CLOSED' THEN RAISE EXCEPTION 'HR_REVIEW_CLOSED: 닫은 평가의 목표는 바꾸지 않습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_state <> 'GOALS' THEN RAISE EXCEPTION 'HR_REVIEW_STATE: 목표는 목표 단계에서만 지웁니다.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_state <> 'GOALS' THEN RAISE EXCEPTION 'HR_REVIEW_STATE: 목표는 목표 단계에서만 넣습니다.'; END IF;
    IF NEW.self_score IS NOT NULL OR NEW.mgr_score IS NOT NULL THEN RAISE EXCEPTION 'HR_REVIEW_STATE: 목표 단계에는 점수를 넣지 않습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.cycle_id, NEW.employee_id, NEW.created_at) IS DISTINCT FROM (OLD.cycle_id, OLD.employee_id, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_REVIEW: 목표의 차례 · 직원은 바꾸지 않습니다.';
  END IF;
  IF v_state = 'GOALS' AND (NEW.self_score IS NOT NULL OR NEW.mgr_score IS NOT NULL OR NEW.self_note IS NOT NULL OR NEW.mgr_note IS NOT NULL) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 목표 단계에는 점수 · 의견을 넣지 않습니다.';
  END IF;
  IF v_state = 'REVIEW' AND (NEW.title, NEW.measure, NEW.weight) IS DISTINCT FROM (OLD.title, OLD.measure, OLD.weight) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 평가 단계에는 목표 · 가중치를 고치지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hr_review_results_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_REVIEW: 평가 결과는 지우지 않습니다.'; END IF;
  SELECT state INTO v_state FROM public.hr_review_cycles WHERE id = NEW.cycle_id;
  IF v_state = 'CLOSED' THEN RAISE EXCEPTION 'HR_REVIEW_CLOSED: 닫은 평가 결과는 바꾸지 않습니다.'; END IF;
  IF v_state = 'GOALS' AND (NEW.self_submitted_at IS NOT NULL OR NEW.grade IS NOT NULL) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 목표 단계에는 평가를 제출하지 않습니다.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.cycle_id, NEW.employee_id) IS DISTINCT FROM (OLD.cycle_id, OLD.employee_id) THEN RAISE EXCEPTION 'HR_REVIEW: 차례 · 직원은 바꾸지 않습니다.'; END IF;
    IF OLD.self_submitted_at IS NOT NULL AND (NEW.self_comment, NEW.self_submitted_at) IS DISTINCT FROM (OLD.self_comment, OLD.self_submitted_at) THEN
      RAISE EXCEPTION 'HR_REVIEW_SUBMITTED: 제출한 자기 평가는 고치지 않습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_review_cycles_guard' AND tgrelid = 'public.hr_review_cycles'::regclass) THEN
    CREATE TRIGGER trg_hr_review_cycles_guard BEFORE UPDATE OR DELETE ON public.hr_review_cycles FOR EACH ROW EXECUTE FUNCTION public.fn_hr_review_cycles_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_review_goals_guard' AND tgrelid = 'public.hr_review_goals'::regclass) THEN
    CREATE TRIGGER trg_hr_review_goals_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hr_review_goals FOR EACH ROW EXECUTE FUNCTION public.fn_hr_review_goals_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_review_results_guard' AND tgrelid = 'public.hr_review_results'::regclass) THEN
    CREATE TRIGGER trg_hr_review_results_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hr_review_results FOR EACH ROW EXECUTE FUNCTION public.fn_hr_review_results_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hr.review_grade_cuts', 'S:4.5,A:3.5,B:2.5,C:1.5', 'ADMIN', '인사 평가 등급 제안 기준(v10.460 · D262) — 상사 가중 평균(1 ~ 5)이 이 값 이상이면 그 등급 · 아래면 D · 회사 평가 규정으로 SUPER 고침(상사가 등급을 골라 확정)', false, '^S:[1-5](\.[0-9])?,A:[1-5](\.[0-9])?,B:[1-5](\.[0-9])?,C:[1-5](\.[0-9])?$', 'S:4.5,A:3.5,B:2.5,C:1.5')
ON CONFLICT (key) DO NOTHING;

/* ── v10.461 (D262 · docs/599) 채용 — 공고 · 지원자(최소 개인정보) · 면접 일정 · 합격 → 직원 대장 · 불합격 서류 자동 파기 ──
 *   지원자: 이름 · 메일 또는 휴대폰 · 경로 · 메모 · 서류 파일(인사 전용 용도 HR_DOC · 3개 · 열람 SUPER · ADMIN · 올린 사람만 — 지급 담당 · 세무사 · 검수 못 엶) — 주민등록번호 · 생년월일 · 사진 받지 않음
 *   단계 APPLIED → SCREEN → INTERVIEW → OFFER → HIRED(직원 대장 줄 만듦) · 끝나지 않은 단계에서 REJECTED · WITHDRAWN
 *   불합격 · 철회 = 파기 예정일(결정일 + hr.applicant_retention_days · 처음 180일) — 정기 작업 hr_applicant_purge(매일 04:50)가
 *   서류 파일 지움(DELETED · 저장소 바이트 지움) · 이름 「(파기됨)」 · 연락처 · 메모 · 면접 메모 비움 · 파기 기록(쌓기만) + 감사 기록 HR_APPLICANT_PURGE
 *   채용절차법 제11조(반환 청구 기간 14 ~ 180일) · 개인정보 보호법 제21조(파기) 일반 원칙 — 적용 사업장(상시 30명 이상) 등 확인 필요(docs/599). */
CREATE TABLE IF NOT EXISTS public.hr_job_postings (
  id           bigserial PRIMARY KEY,
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  dept         text CHECK (dept IS NULL OR char_length(dept) <= 60),
  emp_type     text NOT NULL DEFAULT 'REGULAR' CHECK (emp_type IN ('REGULAR', 'FIXED_TERM', 'PART_TIME', 'INTERN')),
  description  text CHECK (description IS NULL OR char_length(description) <= 4000),
  opens_on     date NOT NULL,
  closes_on    date NOT NULL,
  state        text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'OPEN', 'CLOSED')),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hjp_dates CHECK (closes_on >= opens_on AND closes_on - opens_on <= 366)
);
CREATE INDEX IF NOT EXISTS ix_hjp_state ON public.hr_job_postings (state, closes_on DESC);
COMMENT ON TABLE public.hr_job_postings IS 'v10.461 (D262) 채용 공고 — 제목 · 부서 · 고용 형태 · 기간 · DRAFT → OPEN → CLOSED · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hr_applicants (
  id           bigserial PRIMARY KEY,
  posting_id   bigint NOT NULL REFERENCES public.hr_job_postings(id),
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  email        text CHECK (email IS NULL OR (char_length(email) <= 200 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone        text CHECK (phone IS NULL OR phone ~ '^[0-9]{9,11}$'),
  source       text NOT NULL DEFAULT 'DIRECT' CHECK (source IN ('DIRECT', 'JOBSITE', 'REFERRAL', 'ETC')),
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 500),
  file_ids     uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(file_ids) <= 3),
  stage        text NOT NULL DEFAULT 'APPLIED' CHECK (stage IN ('APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN')),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  employee_id  bigint REFERENCES public.acct_employees(id),
  purge_due_on date,
  purged_at    timestamptz,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hap_hired CHECK ((stage = 'HIRED') = (employee_id IS NOT NULL)),
  CONSTRAINT ck_hap_contact CHECK (purged_at IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT ck_hap_purge_due CHECK (stage NOT IN ('REJECTED', 'WITHDRAWN') OR purge_due_on IS NOT NULL),
  CONSTRAINT ck_hap_purged CHECK (purged_at IS NULL OR (name = '(파기됨)' AND email IS NULL AND phone IS NULL AND memo IS NULL AND decide_note IS NULL AND cardinality(file_ids) = 0))
);
CREATE INDEX IF NOT EXISTS ix_hap_posting ON public.hr_applicants (posting_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_hap_purge ON public.hr_applicants (purge_due_on) WHERE purged_at IS NULL AND stage IN ('REJECTED', 'WITHDRAWN');
COMMENT ON TABLE public.hr_applicants IS 'v10.461 (D262) 지원자 — 이름 · 메일 또는 휴대폰 · 서류(HR_DOC 3개) · 단계 · 합격이면 직원 대장 번호 · 불합격 · 철회는 파기 예정일 뒤 자동 파기(개인정보 비움 · 줄은 남김)';

CREATE TABLE IF NOT EXISTS public.hr_interviews (
  id            bigserial PRIMARY KEY,
  applicant_id  bigint NOT NULL REFERENCES public.hr_applicants(id),
  at            timestamptz NOT NULL,
  place         text CHECK (place IS NULL OR char_length(place) <= 100),
  interviewers  text CHECK (interviewers IS NULL OR char_length(interviewers) <= 200),
  result        text CHECK (result IS NULL OR result IN ('PASS', 'FAIL', 'HOLD')),
  note          text CHECK (note IS NULL OR char_length(note) <= 500),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hiv_at ON public.hr_interviews (at);
CREATE INDEX IF NOT EXISTS ix_hiv_app ON public.hr_interviews (applicant_id, at);
COMMENT ON TABLE public.hr_interviews IS 'v10.461 (D262) 면접 일정 — 시각 · 장소 · 면접관 · 결과(PASS · FAIL · HOLD) · 메모(파기 때 비움) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hr_applicant_purges (
  id            bigserial PRIMARY KEY,
  applicant_id  bigint NOT NULL REFERENCES public.hr_applicants(id),
  posting_id    bigint NOT NULL REFERENCES public.hr_job_postings(id),
  stage         text NOT NULL,
  files         integer NOT NULL CHECK (files >= 0),
  reason        text NOT NULL CHECK (reason IN ('RETENTION', 'MANUAL')),
  purged_by     uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_applicant_purge ON public.hr_applicant_purges (applicant_id);
COMMENT ON TABLE public.hr_applicant_purges IS 'v10.461 (D262) 지원자 파기 기록 — 누가(정기 작업은 비움) · 언제 · 파일 수 · 까닭(보관 기간 RETENTION · 지금 파기 MANUAL) · 개인정보 없음 · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_hr_job_postings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_POSTING: 채용 공고는 지우지 않습니다(마감으로).'; END IF;
  IF (NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'HR_POSTING: 만든 사람 · 시각은 바꾸지 않습니다.'; END IF;
  IF OLD.state = 'CLOSED' AND NEW.state <> 'CLOSED' THEN RAISE EXCEPTION 'HR_POSTING_STATE: 마감한 공고는 다시 열지 않습니다(새 공고로).'; END IF;
  IF OLD.state = 'OPEN' AND NEW.state = 'DRAFT' THEN RAISE EXCEPTION 'HR_POSTING_STATE: 연 공고는 초안으로 돌리지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hr_applicants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_APPLICANT: 지원자 줄은 지우지 않습니다(파기는 개인정보만 비움).'; END IF;
  IF (NEW.posting_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.posting_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_APPLICANT: 공고 · 만든 사람은 바꾸지 않습니다.';
  END IF;
  IF OLD.purged_at IS NOT NULL THEN RAISE EXCEPTION 'HR_APPLICANT_PURGED: 파기한 지원자는 바꾸지 않습니다.'; END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF OLD.stage IN ('HIRED', 'REJECTED', 'WITHDRAWN') THEN RAISE EXCEPTION 'HR_APPLICANT_STATE: 끝난 지원자는 단계를 바꾸지 않습니다.'; END IF;
    IF NEW.stage NOT IN ('REJECTED', 'WITHDRAWN')
       AND array_position(ARRAY['APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED'], NEW.stage) <= array_position(ARRAY['APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED'], OLD.stage) THEN
      RAISE EXCEPTION 'HR_APPLICANT_STATE: 지원 단계는 앞으로만 바뀝니다.';
    END IF;
  END IF;
  IF NEW.purged_at IS NOT NULL AND (OLD.stage NOT IN ('REJECTED', 'WITHDRAWN') OR NEW.stage IS DISTINCT FROM OLD.stage) THEN
    RAISE EXCEPTION 'HR_APPLICANT_PURGE: 불합격 · 철회한 지원자만 파기합니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hr_interviews_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_INTERVIEW: 면접 일정은 지우지 않습니다.'; END IF;
  IF (NEW.applicant_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.applicant_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_INTERVIEW: 지원자는 바꾸지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_job_postings_guard' AND tgrelid = 'public.hr_job_postings'::regclass) THEN
    CREATE TRIGGER trg_hr_job_postings_guard BEFORE UPDATE OR DELETE ON public.hr_job_postings FOR EACH ROW EXECUTE FUNCTION public.fn_hr_job_postings_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_applicants_guard' AND tgrelid = 'public.hr_applicants'::regclass) THEN
    CREATE TRIGGER trg_hr_applicants_guard BEFORE UPDATE OR DELETE ON public.hr_applicants FOR EACH ROW EXECUTE FUNCTION public.fn_hr_applicants_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_interviews_guard' AND tgrelid = 'public.hr_interviews'::regclass) THEN
    CREATE TRIGGER trg_hr_interviews_guard BEFORE UPDATE OR DELETE ON public.hr_interviews FOR EACH ROW EXECUTE FUNCTION public.fn_hr_interviews_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hr_applicant_purges_ro' AND tgrelid = 'public.hr_applicant_purges'::regclass) THEN
    CREATE TRIGGER trg_hr_applicant_purges_ro BEFORE UPDATE OR DELETE ON public.hr_applicant_purges FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('hr.applicant_retention_days', '180', 'ADMIN', '불합격 · 철회 지원자 서류 보관 기간(v10.461 · D262) — 결정일부터 이 날수가 지나면 정기 작업이 서류 · 연락처를 파기(채용절차법 반환 청구 기간 14 ~ 180일 · 일반 원칙 · SUPER 고침)', false, '^(1[4-9]|[2-9][0-9]|1[0-7][0-9]|180)$', '180')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('hr_applicant_purge', 1440, 4, 50, NULL, true, '불합격 · 철회 지원자 서류 자동 파기 — 매일 04:50 · 파기 예정일 지난 지원자 서류 파일 · 연락처 비움 · 파기 기록 · 감사 기록 HR_APPLICANT_PURGE · D262 · v10.461')
ON CONFLICT (job) DO NOTHING;

/* ── ㉛ (D262) 업무 권한(⑳ D258) — 새 탭 4개 업무 · 처음 변환 그룹(R_) 범위 · 주소 → 업무
 *   hr-training · hr-contract · hr-review · hr-recruit = 운영 관리자(R_ADMIN) — @Roles('ADMIN') 와 같은 범위(적용 날 보는 범위 같음)
 *   교육 종류 고치기(PUT /admin/hr/training/kinds/{code})는 @Roles('SUPER') — SUPER 는 권한 검사를 늘 통과하므로 맵에는 APPROVE 로만 둠
 *   내 인사(/admin/me/hr/...) 새 주소는 본인 것만 보는 화면이라 맵에 넣지 않음(@Roles 만 · D259 my-hr 와 같음)
 *   세무사(R_ACCOUNTANT)는 넣지 않음 — 주소가 /admin/hr 아래라 세무사 읽기(/admin/acct GET)에도 걸리지 않음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hr-training', '법정 의무교육', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2500),
  ('hr-contract', '근로계약서', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2510),
  ('hr-review', '인사 평가', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2520),
  ('hr-recruit', '채용', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2530)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN', 'hr-training'), ('R_ADMIN', 'hr-contract'), ('R_ADMIN', 'hr-review'), ('R_ADMIN', 'hr-recruit')) x(g, t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hr/training', 'hr-training', 'VIEW'),
  ('GET', '/admin/hr/training/kinds', 'hr-training', 'VIEW'),
  ('PUT', '/admin/hr/training/kinds/{code}', 'hr-training', 'APPROVE'),
  ('POST', '/admin/hr/training/records', 'hr-training', 'EDIT'),
  ('POST', '/admin/hr/training/records/{id}/decide', 'hr-training', 'APPROVE'),
  ('POST', '/admin/hr/training/records/{id}/void', 'hr-training', 'APPROVE'),
  ('GET', '/admin/hr/contracts', 'hr-contract', 'VIEW'),
  ('GET', '/admin/hr/contracts/templates', 'hr-contract', 'VIEW'),
  ('POST', '/admin/hr/contracts/templates', 'hr-contract', 'APPROVE'),
  ('POST', '/admin/hr/contracts', 'hr-contract', 'EDIT'),
  ('GET', '/admin/hr/contracts/{id}', 'hr-contract', 'VIEW'),
  ('POST', '/admin/hr/contracts/{id}/send', 'hr-contract', 'APPROVE'),
  ('POST', '/admin/hr/contracts/{id}/check', 'hr-contract', 'EDIT'),
  ('POST', '/admin/hr/contracts/{id}/cancel', 'hr-contract', 'APPROVE'),
  ('GET', '/admin/hr/reviews', 'hr-review', 'VIEW'),
  ('POST', '/admin/hr/reviews', 'hr-review', 'EDIT'),
  ('GET', '/admin/hr/reviews/{id}', 'hr-review', 'VIEW'),
  ('POST', '/admin/hr/reviews/{id}/advance', 'hr-review', 'APPROVE'),
  ('PUT', '/admin/hr/reviews/{id}/employees/{employeeId}', 'hr-review', 'APPROVE'),
  ('GET', '/admin/hr/recruit', 'hr-recruit', 'VIEW'),
  ('POST', '/admin/hr/recruit/postings', 'hr-recruit', 'EDIT'),
  ('PUT', '/admin/hr/recruit/postings/{id}', 'hr-recruit', 'EDIT'),
  ('GET', '/admin/hr/recruit/postings/{id}', 'hr-recruit', 'VIEW'),
  ('POST', '/admin/hr/recruit/applicants', 'hr-recruit', 'EDIT'),
  ('POST', '/admin/hr/recruit/applicants/{id}/stage', 'hr-recruit', 'APPROVE'),
  ('POST', '/admin/hr/recruit/applicants/{id}/interviews', 'hr-recruit', 'EDIT'),
  ('PUT', '/admin/hr/recruit/interviews/{id}', 'hr-recruit', 'EDIT'),
  ('POST', '/admin/hr/recruit/applicants/{id}/hire', 'hr-recruit', 'APPROVE'),
  ('POST', '/admin/hr/recruit/applicants/{id}/purge', 'hr-recruit', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

/* ── ㉛ (D262 · 대표 11/20 결정) 인사 전용 파일 용도 HR_DOC — 의무교육 증빙 · 지원자 서류
 *   열람: 운영 관리자(ADMIN) · SUPER · 올린 사람(본인 — 직원이 올린 자기 이수증)만 · 지급 담당(PAYOUT) · 세무사(ACCOUNTANT) · 검수(REVIEWER) 못 엶
 *   올림: 운영 역할 누구나(직원 본인 이수증 · 관리자 지원자 서류) — file.service UPLOADERS(patches/1_wiring.md 5-2)
 *   ① ck_files_purpose — D253(최신) 목록 그대로 + HR_DOC  ② file_policies JPG · PNG · PDF 10MB
 *   ③ fn_file_can_read — D257(최신 정의 · D258 ~ D261 에서 다시 쓰지 않음) 그대로 복사 + HR_DOC 한 줄(검수 막음) — ㉜ · ㉝ 이 같은 함수를 다시 쓰면 합칠 때 겹침 확인 */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침 — D253 목록 그대로 + HR_DOC(D262). 빠지면 있는 파일이 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC','NOTICE_ATTACHMENT','ACCT_EVIDENCE','CORP_DOC','HR_DOC']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('HR_DOC', 'image/jpeg', 10485760, 'jpg'), ('HR_DOC', 'image/png', 10485760, 'png'),
  ('HR_DOC', 'application/pdf', 10485760, 'pdf')
ON CONFLICT DO NOTHING;

/* 파일 열람 — D257 정의 그대로 + HR_DOC 한 줄 */
CREATE OR REPLACE FUNCTION public.fn_file_can_read(p_file uuid, p_account uuid, p_roles text[])
 RETURNS text LANGUAGE plpgsql STABLE AS $function$
DECLARE
  f public.files;
  v_partner boolean;
BEGIN
  SELECT * INTO f FROM public.files WHERE id = p_file;
  IF f.id IS NULL OR f.status <> 'READY' OR p_account IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  IF f.owner_account_id = p_account THEN RETURN 'OK'; END IF;
  /* 심사 · 심의하는 사람 */
  IF p_roles && ARRAY['ADMIN','SUPER','REVIEWER'] THEN
    /* v10.425 — 사내 문서는 REVIEWER 에게 열지 않음 */
    IF f.purpose = 'CORP_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    /* v10.458 ~ 461 (D262) — 인사 서류(HR_DOC · 의무교육 증빙 · 지원자 서류)는 검수(REVIEWER)에게 열지 않음 · 지급 담당 · 세무사 분기에도 넣지 않음(본인 = 올린 사람은 위 주인 줄로 엶) */
    IF f.purpose = 'HR_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    RETURN 'OK';
  END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;
  /* v10.392 (D245) — 지급 담당은 회계 증빙 · v10.425 (D253) 사내 문서 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose IN ('ACCT_EVIDENCE', 'CORP_DOC') THEN RETURN 'OK'; END IF;
  /* v10.437 (D257) — 세무사 공유 계정은 회계 증빙만(사내 문서 · 회원 파일은 못 엶) */
  IF 'ACCOUNTANT' = ANY (p_roles) AND f.purpose = 'ACCT_EVIDENCE' THEN RETURN 'OK'; END IF;

  IF f.purpose = 'MARKETING_MATERIAL'
     AND EXISTS (SELECT 1 FROM public.marketing_materials m WHERE m.file_id = f.id AND m.state = 'APPROVED')
  OR f.purpose = 'PARTNER_GUIDE'
     AND EXISTS (SELECT 1 FROM public.partner_guides g WHERE g.file_id = f.id AND g.is_active) THEN
    SELECT EXISTS (SELECT 1 FROM public.partners p JOIN public.businesses b ON b.id = p.business_id
                    WHERE b.account_id = p_account AND p.aff_status = 'ACTIVE') INTO v_partner;
    RETURN CASE WHEN v_partner THEN 'OK' ELSE 'PARTNER_ONLY' END;
  END IF;
  /* v10.31 — 공개된 매물 · 요청의 사진 */
  IF f.purpose = 'LISTING_IMAGE' AND EXISTS (
       SELECT 1 FROM public.listing_media m JOIN public.listings l ON l.id = m.listing_id
        WHERE m.file_id = f.id AND l.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  IF f.purpose = 'REQUEST_IMAGE' AND EXISTS (
       SELECT 1 FROM public.requests r WHERE r.photo_file_id = f.id AND r.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  /* 등기부 · 중개 서류는 신청자와 운영만 봅니다 */
  RETURN 'NOT_FOUND';
END $function$;


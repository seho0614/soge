/* D269 (v10.486 ~ 489 · docs/624 ~ 627) ㊴ 법무 — 회사 인허가 · 신고 갱신 · 계약 검토 요청 · 소송 · 분쟁 대장 · 회사 보험 증권 · 만기 · 법무 전용 파일 용도 LGL_DOC */

/* ── D269 (v10.486 ~ 489 · docs/624 ~ 627) ㊴ 법무 — 회사 인허가 · 신고 갱신 · 계약 검토 요청 · 소송 · 분쟁 사건 대장 · 회사 보험 증권 · 만기 ──
 *   대표 11/20 「지금 바로 동시 착수」(㊴ ~ ㊶ 공동 계약).
 *   파일은 모두 법무 전용 파일 용도 LGL_DOC(대표 11/20 · JPG · PNG · PDF · 20MB · 올림 SUPER · ADMIN · 열람 ADMIN · SUPER · 올린 사람 · 보험 증권에 붙은 파일만 PAYOUT 도 · 세무사 · 검수 못 엶) — ck_files_purpose · file_policies · fn_file_can_read 는 sql/7_lgl_doc.sql(㉛ D262 정의 위에 더함).
 *   정기 작업 하나(lgl_due · 매일 09:50)가 인허가 갱신 · 사건 기일 · 보험 만기 · 검토 늦음 알림을 모두 봄.
 *   법 값(인허가 종류별 갱신 주기 · 근거)은 일반 원칙 처음 값 — SUPER 가 고침 · 법무 확인 필요(docs/624). */

/* 공용 — 붙이는 파일은 LGL_DOC · READY · 개수 상한 */
CREATE OR REPLACE FUNCTION public.fn_lgl_check_files(p_ids uuid[], p_max integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ids IS NULL THEN RETURN; END IF;
  IF cardinality(p_ids) > p_max THEN RAISE EXCEPTION 'LGL_FILE: 파일이 너무 많습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) x(id) LEFT JOIN public.files f ON f.id = x.id
              WHERE f.id IS NULL OR f.purpose <> 'LGL_DOC' OR f.status <> 'READY') THEN
    RAISE EXCEPTION 'LGL_FILE: 법무 서류 용도(LGL_DOC)로 올린 파일(READY)만 붙입니다.';
  END IF;
END $$;

/* ── v10.486 ① 인허가 종류(처음 값 · 일반 원칙 · SUPER 고침 · 법무 확인) ── */
CREATE TABLE IF NOT EXISTS public.lgl_license_kinds (
  code          text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,30}$'),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  authority     text CHECK (authority IS NULL OR char_length(authority) <= 100),
  cycle_months  integer CHECK (cycle_months IS NULL OR cycle_months BETWEEN 1 AND 120),
  basis         text CHECK (basis IS NULL OR char_length(basis) <= 300),
  active        boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 9999),
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lgl_license_kinds IS 'v10.486 (D269) 회사 인허가 · 신고 종류 — 기관 · 갱신(재신고 · 납부 · 교육) 주기(달 · 없으면 NULL) · 근거 · 처음 6개는 일반 원칙 값(법무 확인) · SUPER 가 고치고 더함 · 지우지 않음';

INSERT INTO public.lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort) VALUES
  ('MAIL_ORDER', '통신판매업 신고', '관할 시 · 군 · 구청', 12, '전자상거래법 제12조 — 신고 자체는 갱신 없음 · 변경 사항 15일 안 변경 신고 · 등록면허세 매년 1월 정기분 납부(일반 원칙 · 법무 확인)', true, 10),
  ('HFOOD_SALES', '건강기능식품 일반판매업 영업신고', '관할 시 · 군 · 구청', 12, '건강기능식품법 제6조 — 신고 갱신 없음 · 영업자 위생교육 매년(시행규칙 · 일반 원칙 · 법무 확인)', true, 20),
  ('TELECOM_VAS', '부가통신사업 신고', '과학기술정보통신부(중앙전파관리소)', NULL, '전기통신사업법 제22조 — 갱신 없음 · 변경 · 휴지 · 폐지 신고(일반 원칙 · 법무 확인)', true, 30),
  ('LOCATION_BIZ', '위치기반서비스사업 신고', '방송통신위원회', NULL, '위치정보법 제9조 — 갱신 없음 · 변경 신고(일반 원칙 · 법무 확인)', true, 40),
  ('BIZ_REG', '사업자등록', '관할 세무서', NULL, '부가가치세법 제8조 — 갱신 없음 · 정정 신고(일반 원칙 · 법무 확인)', true, 50),
  ('ETC', '그 밖 인허가 · 신고', NULL, NULL, '직접 적음', true, 90)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_lgl_license_kinds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_LICENSE_KIND: 인허가 종류는 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.code, OLD.created_at) THEN RAISE EXCEPTION 'LGL_LICENSE_KIND: 종류 코드 · 만든 시각은 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* 회사가 가진 인허가 · 신고 하나 */
CREATE TABLE IF NOT EXISTS public.lgl_licenses (
  id             bigserial PRIMARY KEY,
  kind_code      text NOT NULL REFERENCES public.lgl_license_kinds(code),
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  license_ref    text CHECK (license_ref IS NULL OR char_length(license_ref) <= 60),
  authority      text CHECK (authority IS NULL OR char_length(authority) <= 100),
  registered_on  date,
  cycle_months   integer CHECK (cycle_months IS NULL OR cycle_months BETWEEN 1 AND 120),
  next_due_on    date,
  owner_account  uuid REFERENCES public.accounts(id),
  file_ids       uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(file_ids) <= 5),
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 400),
  state          text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CLOSED')),
  closed_at      timestamptz,
  close_reason   text CHECK (close_reason IS NULL OR char_length(btrim(close_reason)) BETWEEN 2 AND 200),
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lgl_lic_closed CHECK ((state = 'ACTIVE' AND closed_at IS NULL) OR (state = 'CLOSED' AND closed_at IS NOT NULL AND close_reason IS NOT NULL)),
  CONSTRAINT ck_lgl_lic_due CHECK (next_due_on IS NULL OR registered_on IS NULL OR next_due_on >= registered_on)
);
CREATE INDEX IF NOT EXISTS ix_lgl_lic_due ON public.lgl_licenses (state, next_due_on);
COMMENT ON TABLE public.lgl_licenses IS 'v10.486 (D269) 회사 인허가 · 신고 — 종류 · 번호(license_ref) · 기관 · 신고일 · 갱신 주기 · 다음 갱신일 · 담당 · 서류(LGL_DOC 5개) · 끝냄(사유 · 되돌리지 않음) · 지우지 않음 · 다음 갱신일 60 · 30 · 7일 전 LGL_LICENSE_DUE';

CREATE TABLE IF NOT EXISTS public.lgl_license_renewals (
  id           bigserial PRIMARY KEY,
  license_id   bigint NOT NULL REFERENCES public.lgl_licenses(id),
  done_on      date NOT NULL,
  prev_due_on  date,
  next_due_on  date,
  file_ids     uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(file_ids) <= 5),
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lgl_lren_lic ON public.lgl_license_renewals (license_id, id DESC);
COMMENT ON TABLE public.lgl_license_renewals IS 'v10.486 (D269) 인허가 갱신 · 재신고 · 납부 기록 — 쌓기만(고치기 · 지우기 없음) · 기록하면 그 인허가의 다음 갱신일이 바뀌고 알림이 풀림';

CREATE OR REPLACE FUNCTION public.fn_lgl_licenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_LICENSE: 인허가는 지우지 않습니다(끝냄으로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
    RETURN NEW;
  END IF;
  IF (NEW.kind_code, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.kind_code, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_LICENSE: 종류 · 만든 사람은 바꾸지 않습니다(끝내고 새로).';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'LGL_LICENSE_STATE: 끝낸 인허가는 고치지 않습니다.'; END IF;
  IF NEW.file_ids IS DISTINCT FROM OLD.file_ids THEN PERFORM public.fn_lgl_check_files(NEW.file_ids, 5); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lgl_license_renewals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LGL_RENEWAL: 갱신 기록은 고치거나 지우지 않습니다(쌓기만).'; END IF;
  SELECT state INTO st FROM public.lgl_licenses WHERE id = NEW.license_id;
  IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'LGL_LICENSE_STATE: 끝낸 인허가에는 갱신을 기록하지 않습니다.'; END IF;
  IF NEW.next_due_on IS NOT NULL AND NEW.next_due_on <= NEW.done_on THEN RAISE EXCEPTION 'LGL_RENEWAL: 다음 갱신일은 처리일 뒤입니다.'; END IF;
  PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_license_kinds_guard' AND tgrelid = 'public.lgl_license_kinds'::regclass) THEN
    CREATE TRIGGER trg_lgl_license_kinds_guard BEFORE UPDATE OR DELETE ON public.lgl_license_kinds FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_license_kinds_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_licenses_guard' AND tgrelid = 'public.lgl_licenses'::regclass) THEN
    CREATE TRIGGER trg_lgl_licenses_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_licenses FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_licenses_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_license_renewals_guard' AND tgrelid = 'public.lgl_license_renewals'::regclass) THEN
    CREATE TRIGGER trg_lgl_license_renewals_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_license_renewals FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_license_renewals_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('lgl.license_alert_days', '60,30,7', 'ADMIN', '회사 인허가 갱신 알림(v10.486 · D269) — 다음 갱신일 며칠 전에 운영 알림 LGL_LICENSE_DUE 를 띄울지(쉼표로 1 ~ 5개 · 1 ~ 365 · 큰 수부터)', false, '^([1-9][0-9]{0,2})(,[1-9][0-9]{0,2}){0,4}$', '60,30,7')
ON CONFLICT (key) DO NOTHING;

/* ── v10.487 (D269 · docs/625) ② 계약 검토 요청 ──
 *   요청(REQUESTED · 계약서 파일 LGL_DOC 1 ~ 5개 · 검토 희망일) → 검토 의견(요청한 사람이 아닌 운영자 · 위험 낮음 · 보통 · 높음 · 외부 변호사 의견 옮김 표시)
 *   → 의견이 하나라도 있으면 REVIEWED → SUPER(요청한 사람 아님)가 승인(APPROVED) · 반려(REJECTED · 사유) · 요청한 사람 · SUPER 는 결정 전 취소(CANCELED).
 *   ⑯ 계약 대장(acct_contracts) 연결 — 요청 때 기존 계약(갱신 · 변경 · 해지) 또는 승인 뒤 대장에 넣은 계약을 연결(한 번 · 바꾸지 않음).
 *   검토 희망일이 지났는데 결정이 안 났으면 LGL_REVIEW_LATE(요청마다 한 번 · 결정 · 취소하면 풀림). */
CREATE TABLE IF NOT EXISTS public.lgl_contract_reviews (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  kind          text NOT NULL DEFAULT 'NEW' CHECK (kind IN ('NEW', 'RENEW', 'CHANGE', 'TERMINATE')),
  counterparty  text CHECK (counterparty IS NULL OR char_length(counterparty) <= 120),
  contract_id   bigint REFERENCES public.acct_contracts(id),
  amount        bigint CHECK (amount IS NULL OR (amount >= 0 AND amount <= 100000000000)),
  wanted_on     date,
  summary       text CHECK (summary IS NULL OR char_length(summary) <= 2000),
  file_ids      uuid[] NOT NULL CHECK (cardinality(file_ids) BETWEEN 1 AND 5),
  requested_by  uuid NOT NULL REFERENCES public.accounts(id),
  state         text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELED')),
  decided_by    uuid REFERENCES public.accounts(id),
  decided_at    timestamptz,
  decide_note   text CHECK (decide_note IS NULL OR char_length(decide_note) <= 400),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lgl_rv_decided CHECK (state NOT IN ('APPROVED', 'REJECTED', 'CANCELED') OR decided_at IS NOT NULL),
  CONSTRAINT ck_lgl_rv_reject CHECK (state <> 'REJECTED' OR char_length(btrim(coalesce(decide_note, ''))) >= 2),
  CONSTRAINT ck_lgl_rv_self CHECK (state NOT IN ('APPROVED', 'REJECTED') OR decided_by IS DISTINCT FROM requested_by)
);
CREATE INDEX IF NOT EXISTS ix_lgl_rv_state ON public.lgl_contract_reviews (state, id DESC);
CREATE INDEX IF NOT EXISTS ix_lgl_rv_contract ON public.lgl_contract_reviews (contract_id) WHERE contract_id IS NOT NULL;
COMMENT ON TABLE public.lgl_contract_reviews IS 'v10.487 (D269) 계약 검토 요청 — 계약서 파일(LGL_DOC) · 요청 → 검토 의견 → SUPER 승인 · 반려(요청한 사람 아님 · DB 가 막음) · ⑯ acct_contracts 연결(한 번) · 내용 못 고침 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.lgl_review_opinions (
  id          bigserial PRIMARY KEY,
  review_id   bigint NOT NULL REFERENCES public.lgl_contract_reviews(id),
  author      uuid NOT NULL REFERENCES public.accounts(id),
  risk        text NOT NULL DEFAULT 'MID' CHECK (risk IN ('LOW', 'MID', 'HIGH')),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 2 AND 4000),
  outside     boolean NOT NULL DEFAULT false,
  file_ids    uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(file_ids) <= 3),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lgl_rop_review ON public.lgl_review_opinions (review_id, id);
COMMENT ON TABLE public.lgl_review_opinions IS 'v10.487 (D269) 계약 검토 의견 — 쌓기만 · 요청한 사람은 못 씀(DB) · outside = 외부 변호사 의견을 옮겨 적음 · 수정본 파일(LGL_DOC 3개)';

CREATE OR REPLACE FUNCTION public.fn_lgl_contract_reviews_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_REVIEW: 검토 요청은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
    IF NEW.state <> 'REQUESTED' THEN RAISE EXCEPTION 'LGL_REVIEW_STATE: 새 요청은 요청 상태로만 들어갑니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.title, NEW.kind, NEW.counterparty, NEW.amount, NEW.wanted_on, NEW.summary, NEW.file_ids, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM (OLD.title, OLD.kind, OLD.counterparty, OLD.amount, OLD.wanted_on, OLD.summary, OLD.file_ids, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_REVIEW: 검토 요청 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF NEW.contract_id IS DISTINCT FROM OLD.contract_id AND OLD.contract_id IS NOT NULL THEN
    RAISE EXCEPTION 'LGL_REVIEW_LINK: 연결한 계약은 바꾸지 않습니다.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('REVIEWED', 'CANCELED'))
         OR (OLD.state = 'REVIEWED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED'))) THEN
      RAISE EXCEPTION 'LGL_REVIEW_STATE: 검토 요청 상태는 앞으로만 바뀝니다(승인 · 반려는 의견 뒤).';
    END IF;
  ELSIF (NEW.decided_by, NEW.decided_at, NEW.decide_note) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decide_note) THEN
    RAISE EXCEPTION 'LGL_REVIEW_STATE: 결정 기록은 상태를 바꿀 때만 씁니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lgl_review_opinions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r public.lgl_contract_reviews;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LGL_OPINION: 검토 의견은 고치거나 지우지 않습니다(쌓기만).'; END IF;
  SELECT * INTO r FROM public.lgl_contract_reviews WHERE id = NEW.review_id;
  IF r.id IS NULL OR r.state NOT IN ('REQUESTED', 'REVIEWED') THEN RAISE EXCEPTION 'LGL_REVIEW_STATE: 결정 · 취소한 요청에는 의견을 달지 않습니다.'; END IF;
  IF r.requested_by = NEW.author THEN RAISE EXCEPTION 'LGL_SELF: 요청한 사람은 자기 요청에 검토 의견을 쓰지 않습니다.'; END IF;
  PERFORM public.fn_lgl_check_files(NEW.file_ids, 3);
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_contract_reviews_guard' AND tgrelid = 'public.lgl_contract_reviews'::regclass) THEN
    CREATE TRIGGER trg_lgl_contract_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_contract_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_contract_reviews_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_review_opinions_guard' AND tgrelid = 'public.lgl_review_opinions'::regclass) THEN
    CREATE TRIGGER trg_lgl_review_opinions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_review_opinions FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_review_opinions_guard();
  END IF;
END $$;

/* ── v10.488 (D269 · docs/626) ③ 소송 · 분쟁 사건 대장 ──
 *   사건(번호 · 종류 · 우리 쪽 · 상대 · 기관 · 대리인 · 소가 · 서류 LGL_DOC 10개) · 기일(변론 · 기한 · 조정 · 그 밖 — 예정 → 끝남 · 취소)
 *   · 비용(대리인 보수 · 인지 · 송달료 · 공탁 · 그 밖 — 경비 청구(⑫ acct_expense_claims) 또는 매입(acct_purchases) 하나에 연결 · 무효만 · 같은 전표 두 번 연결 막음)
 *   · 결과(이김 · 짐 · 일부 · 합의 · 취하 · 각하 · 그 밖 — 끝내면 되돌리지 않음).
 *   기일 7 · 1일 전(lgl.hearing_alert_days) LGL_HEARING_DUE(기일 · 날짜 차례마다 한 번 · 끝남 · 취소면 풀림).
 *   회원끼리 거래 분쟁(거래 › 분쟁 disputes)과는 다른 것 — 회사가 당사자인 사건만. */
CREATE TABLE IF NOT EXISTS public.lgl_cases (
  id             bigserial PRIMARY KEY,
  case_ref       text CHECK (case_ref IS NULL OR char_length(case_ref) <= 60),
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  kind           text NOT NULL DEFAULT 'CIVIL' CHECK (kind IN ('CIVIL', 'CRIMINAL', 'ADMIN', 'LABOR', 'MEDIATION', 'CONSUMER', 'ETC')),
  our_side       text NOT NULL DEFAULT 'DEFENDANT' CHECK (our_side IN ('PLAINTIFF', 'DEFENDANT', 'APPLICANT', 'RESPONDENT', 'ETC')),
  counterparty   text CHECK (counterparty IS NULL OR char_length(counterparty) <= 120),
  forum          text CHECK (forum IS NULL OR char_length(forum) <= 100),
  counsel        text CHECK (counsel IS NULL OR char_length(counsel) <= 120),
  claim_amount   bigint CHECK (claim_amount IS NULL OR (claim_amount >= 0 AND claim_amount <= 1000000000000)),
  opened_on      date NOT NULL,
  file_ids       uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(file_ids) <= 10),
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 2000),
  state          text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  result         text CHECK (result IS NULL OR result IN ('WIN', 'LOSE', 'PARTIAL', 'SETTLED', 'WITHDRAWN', 'DISMISSED', 'ETC')),
  result_note    text CHECK (result_note IS NULL OR char_length(result_note) <= 1000),
  closed_on      date,
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lgl_case_closed CHECK ((state = 'OPEN' AND result IS NULL AND closed_on IS NULL) OR (state = 'CLOSED' AND result IS NOT NULL AND closed_on IS NOT NULL AND closed_on >= opened_on))
);
CREATE INDEX IF NOT EXISTS ix_lgl_case_state ON public.lgl_cases (state, id DESC);
COMMENT ON TABLE public.lgl_cases IS 'v10.488 (D269) 회사 소송 · 분쟁 사건 대장 — 사건 번호(case_ref) · 종류 · 우리 쪽 · 상대 · 기관(forum) · 대리인 · 소가 · 서류(LGL_DOC) · 결과(끝내면 되돌리지 않음) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.lgl_case_hearings (
  id          bigserial PRIMARY KEY,
  case_id     bigint NOT NULL REFERENCES public.lgl_cases(id),
  held_at     timestamptz NOT NULL,
  kind        text NOT NULL DEFAULT 'HEARING' CHECK (kind IN ('HEARING', 'DEADLINE', 'MEDIATION', 'ETC')),
  place       text CHECK (place IS NULL OR char_length(place) <= 100),
  note        text CHECK (note IS NULL OR char_length(note) <= 400),
  state       text NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED', 'DONE', 'CANCELED')),
  outcome     text CHECK (outcome IS NULL OR char_length(outcome) <= 400),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lgl_hear_at ON public.lgl_case_hearings (state, held_at);
CREATE INDEX IF NOT EXISTS ix_lgl_hear_case ON public.lgl_case_hearings (case_id, held_at);
COMMENT ON TABLE public.lgl_case_hearings IS 'v10.488 (D269) 사건 기일 · 기한 — 예정 → 끝남(결과 한 줄) · 취소 · 끝남 · 취소는 되돌리지 않음 · 7 · 1일 전 LGL_HEARING_DUE · 사내 일정(㉜)에 보임';

CREATE TABLE IF NOT EXISTS public.lgl_case_costs (
  id                bigserial PRIMARY KEY,
  case_id           bigint NOT NULL REFERENCES public.lgl_cases(id),
  kind              text NOT NULL DEFAULT 'COUNSEL' CHECK (kind IN ('COUNSEL', 'STAMP', 'SERVICE', 'DEPOSIT', 'ETC')),
  amount            bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000000),
  paid_on           date NOT NULL,
  expense_claim_id  bigint REFERENCES public.acct_expense_claims(id),
  purchase_id       bigint REFERENCES public.acct_purchases(id),
  note              text CHECK (note IS NULL OR char_length(note) <= 200),
  state             text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'VOID')),
  void_reason       text CHECK (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 2 AND 200),
  created_by        uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lgl_cost_one CHECK (expense_claim_id IS NULL OR purchase_id IS NULL),
  CONSTRAINT ck_lgl_cost_void CHECK (state <> 'VOID' OR void_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_lgl_cost_case ON public.lgl_case_costs (case_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lgl_cost_claim ON public.lgl_case_costs (expense_claim_id) WHERE expense_claim_id IS NOT NULL AND state = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_lgl_cost_purchase ON public.lgl_case_costs (purchase_id) WHERE purchase_id IS NOT NULL AND state = 'ACTIVE';
COMMENT ON TABLE public.lgl_case_costs IS 'v10.488 (D269) 사건 비용 — 대리인 보수 · 인지 · 송달료 · 공탁 · 그 밖 · 경비 청구 또는 매입 전표 하나에 연결(전표 자체는 그 화면이 만듦 · 여기는 사건별 모음) · 같은 전표 두 번 연결 막음 · 무효(사유)만 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_lgl_cases_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_CASE: 사건은 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 10);
    IF NEW.state <> 'OPEN' THEN RAISE EXCEPTION 'LGL_CASE_STATE: 새 사건은 진행 상태로만 들어갑니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.kind, NEW.opened_on, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.kind, OLD.opened_on, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_CASE: 사건 종류 · 시작일은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'LGL_CASE_STATE: 끝낸 사건은 고치지 않습니다.'; END IF;
  IF NEW.file_ids IS DISTINCT FROM OLD.file_ids THEN PERFORM public.fn_lgl_check_files(NEW.file_ids, 10); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lgl_case_hearings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_HEARING: 기일은 지우지 않습니다(취소로).'; END IF;
  SELECT state INTO st FROM public.lgl_cases WHERE id = NEW.case_id;
  IF TG_OP = 'INSERT' THEN
    IF st IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'LGL_CASE_STATE: 끝낸 사건에는 기일을 넣지 않습니다.'; END IF;
    IF NEW.state <> 'PLANNED' THEN RAISE EXCEPTION 'LGL_HEARING_STATE: 새 기일은 예정으로만 들어갑니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.case_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.case_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_HEARING: 사건은 바꾸지 않습니다.';
  END IF;
  IF OLD.state <> 'PLANNED' THEN RAISE EXCEPTION 'LGL_HEARING_STATE: 끝남 · 취소한 기일은 고치지 않습니다.'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lgl_case_costs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_COST: 비용 줄은 지우지 않습니다(무효로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT state INTO st FROM public.lgl_cases WHERE id = NEW.case_id;
    IF st IS NULL THEN RAISE EXCEPTION 'LGL_CASE: 없는 사건입니다.'; END IF;
    IF NEW.state <> 'ACTIVE' THEN RAISE EXCEPTION 'LGL_COST: 새 비용 줄은 유효 상태로만 들어갑니다.'; END IF;
    IF NEW.expense_claim_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.acct_expense_claims c WHERE c.id = NEW.expense_claim_id AND c.state IN ('REQUESTED', 'APPROVED', 'PAID')) THEN
      RAISE EXCEPTION 'LGL_COST_LINK: 반려 · 취소한 경비 청구에는 연결하지 않습니다.';
    END IF;
    IF NEW.purchase_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.acct_purchases p WHERE p.id = NEW.purchase_id AND p.state = 'ACTIVE') THEN
      RAISE EXCEPTION 'LGL_COST_LINK: 취소한 매입에는 연결하지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.case_id, NEW.kind, NEW.amount, NEW.paid_on, NEW.expense_claim_id, NEW.purchase_id, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.case_id, OLD.kind, OLD.amount, OLD.paid_on, OLD.expense_claim_id, OLD.purchase_id, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_COST: 비용 내용은 고치지 않습니다(무효로 하고 다시).';
  END IF;
  IF NOT (OLD.state = 'ACTIVE' AND NEW.state IN ('ACTIVE', 'VOID')) THEN RAISE EXCEPTION 'LGL_COST: 무효한 줄은 되돌리지 않습니다.'; END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_cases_guard' AND tgrelid = 'public.lgl_cases'::regclass) THEN
    CREATE TRIGGER trg_lgl_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_cases FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_cases_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_case_hearings_guard' AND tgrelid = 'public.lgl_case_hearings'::regclass) THEN
    CREATE TRIGGER trg_lgl_case_hearings_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_case_hearings FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_case_hearings_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_case_costs_guard' AND tgrelid = 'public.lgl_case_costs'::regclass) THEN
    CREATE TRIGGER trg_lgl_case_costs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_case_costs FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_case_costs_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('lgl.hearing_alert_days', '7,1', 'ADMIN', '소송 · 분쟁 기일 알림(v10.488 · D269) — 기일 며칠 전에 운영 알림 LGL_HEARING_DUE 를 띄울지(쉼표로 1 ~ 5개 · 1 ~ 365 · 큰 수부터)', false, '^([1-9][0-9]{0,2})(,[1-9][0-9]{0,2}){0,4}$', '7,1')
ON CONFLICT (key) DO NOTHING;

/* ── v10.489 (D269 · docs/627) ④ 회사 보험 증권 · 만기 ──
 *   증권(종류 · 보험사 · 증권 번호 · 보장 금액 · 보험료 · 기간 · 내는 방법 일시납 · 월납 · 회계 처리 선급비용 · 바로 비용 · 서류 LGL_DOC 5개)
 *   만기 30일(lgl.insurance_alert_days) 전 LGL_INSURANCE_DUE(증권마다 한 번 · 갱신 증권을 넣거나 끝내면 풀림) · 만기 지났는데 갱신 없이 유효면 급함.
 *   전표 초안 = 기존 수동 전표 요청(acct_manual_entries REQUESTED) — 쓴 사람이 아닌 SUPER 가 승인해야 장부에 들어감(D248 그대로):
 *     일시납 · 선급비용  보험료 낼 때 차변 선급비용 / 대변 보통예금 · 달마다 차변 보험료(회사 보험) / 대변 선급비용(기간 달 수로 나눔 · 마지막 달 끝수)
 *     일시납 · 바로 비용  보험료 낼 때 차변 보험료(회사 보험) / 대변 보통예금
 *     월납               달마다 차변 보험료(회사 보험) / 대변 보통예금(보험료 ÷ 달 수)
 *   같은 증권 · 같은 종류 · 같은 달 초안은 살아 있는(요청 · 승인) 수동 전표가 있으면 다시 만들지 않음(반려 · 취소면 다시 가능).
 *   계정 2개 더함(일반 계정과목 번호 · 일반 원칙 · 세무사 확인): 선급비용 PREPAID_EXP 133 · 보험료(회사 보험) EXP_INS_POLICY 821. */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('PREPAID_EXP',    '선급비용',           'ASSET',   '133', '선급비용', 135, '미리 낸 보험료 등 — 기간에 걸쳐 비용으로 넘김(v10.489 회사 보험 · 일반 원칙 · 세무사 확인)', false),
  ('EXP_INS_POLICY', '보험료(회사 보험)',  'EXPENSE', '821', '보험료',   216, '화재 · 배상책임 · 생산물 · 사이버 · 임원 배상 등 회사 보험료(4대보험 회사 몫 EXP_INSURANCE 와 따로 · v10.489)', false)
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.lgl_insurance_policies (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL DEFAULT 'LIABILITY' CHECK (kind IN ('FIRE', 'LIABILITY', 'PRODUCT', 'CYBER', 'DNO', 'CAR', 'GUARANTEE', 'EMPLOYEE', 'ETC')),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  insurer         text NOT NULL CHECK (char_length(btrim(insurer)) BETWEEN 1 AND 100),
  policy_ref      text CHECK (policy_ref IS NULL OR char_length(policy_ref) <= 60),
  coverage        bigint CHECK (coverage IS NULL OR (coverage >= 0 AND coverage <= 1000000000000)),
  premium         bigint NOT NULL CHECK (premium > 0 AND premium <= 10000000000),
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  pay_mode        text NOT NULL DEFAULT 'LUMP' CHECK (pay_mode IN ('LUMP', 'MONTHLY')),
  book_mode       text NOT NULL DEFAULT 'PREPAID' CHECK (book_mode IN ('PREPAID', 'EXPENSE')),
  renewed_from    bigint REFERENCES public.lgl_insurance_policies(id),
  file_ids        uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(file_ids) <= 5),
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 400),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ENDED')),
  ended_at        timestamptz,
  end_reason      text CHECK (end_reason IS NULL OR char_length(btrim(end_reason)) BETWEEN 2 AND 200),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lgl_ins_period CHECK (ends_on > starts_on AND ends_on <= starts_on + 3660),
  CONSTRAINT ck_lgl_ins_monthly CHECK (pay_mode <> 'MONTHLY' OR book_mode = 'EXPENSE'),
  CONSTRAINT ck_lgl_ins_ended CHECK ((state = 'ACTIVE' AND ended_at IS NULL) OR (state = 'ENDED' AND ended_at IS NOT NULL AND end_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_lgl_ins_end ON public.lgl_insurance_policies (state, ends_on);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lgl_ins_renewed ON public.lgl_insurance_policies (renewed_from) WHERE renewed_from IS NOT NULL;
COMMENT ON TABLE public.lgl_insurance_policies IS 'v10.489 (D269) 회사 보험 증권 — 종류 · 보험사 · 증권 번호(policy_ref) · 보장 · 보험료 · 기간 · 일시납 · 월납 · 선급비용 · 바로 비용 · 서류(LGL_DOC) · 갱신은 새 증권(renewed_from · 한 번) · 보험료 · 기간 못 고침 · 끝냄(사유) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.lgl_insurance_postings (
  id          bigserial PRIMARY KEY,
  policy_id   bigint NOT NULL REFERENCES public.lgl_insurance_policies(id),
  kind        text NOT NULL CHECK (kind IN ('PAY', 'AMORT', 'MONTHLY')),
  ym          text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount      bigint NOT NULL CHECK (amount > 0),
  manual_id   bigint NOT NULL REFERENCES public.acct_manual_entries(id),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lgl_ipost_policy ON public.lgl_insurance_postings (policy_id, kind, ym);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lgl_ipost_manual ON public.lgl_insurance_postings (manual_id);
COMMENT ON TABLE public.lgl_insurance_postings IS 'v10.489 (D269) 보험료 전표 초안 기록 — 증권 · 종류(PAY 낼 때 · AMORT 달마다 비용 넘김 · MONTHLY 월납) · 달 · 금액 · 수동 전표 요청 번호 · 쌓기만 · 살아 있는 초안이 있는 (증권 · 종류 · 달)은 다시 만들지 않음(DB)';

CREATE OR REPLACE FUNCTION public.fn_lgl_insurance_policies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev public.lgl_insurance_policies;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_INSURANCE: 보험 증권은 지우지 않습니다(끝냄으로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
    IF NEW.state <> 'ACTIVE' THEN RAISE EXCEPTION 'LGL_INSURANCE_STATE: 새 증권은 유효 상태로만 들어갑니다.'; END IF;
    IF NEW.renewed_from IS NOT NULL THEN
      SELECT * INTO prev FROM public.lgl_insurance_policies WHERE id = NEW.renewed_from;
      IF prev.id IS NULL THEN RAISE EXCEPTION 'LGL_INSURANCE_RENEW: 없는 증권을 갱신할 수 없습니다.'; END IF;
      IF NEW.starts_on < prev.starts_on THEN RAISE EXCEPTION 'LGL_INSURANCE_RENEW: 갱신 증권 시작일은 옛 증권 시작일 뒤입니다.'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.kind, NEW.premium, NEW.starts_on, NEW.ends_on, NEW.pay_mode, NEW.book_mode, NEW.renewed_from, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.kind, OLD.premium, OLD.starts_on, OLD.ends_on, OLD.pay_mode, OLD.book_mode, OLD.renewed_from, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_INSURANCE: 종류 · 보험료 · 기간 · 내는 방법 · 회계 처리는 고치지 않습니다(끝내고 새로).';
  END IF;
  IF OLD.state = 'ENDED' THEN RAISE EXCEPTION 'LGL_INSURANCE_STATE: 끝낸 증권은 고치지 않습니다.'; END IF;
  IF NEW.file_ids IS DISTINCT FROM OLD.file_ids THEN PERFORM public.fn_lgl_check_files(NEW.file_ids, 5); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_lgl_insurance_postings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LGL_POSTING: 보험료 전표 초안 기록은 고치거나 지우지 않습니다(쌓기만).'; END IF;
  IF EXISTS (SELECT 1 FROM public.lgl_insurance_postings p JOIN public.acct_manual_entries m ON m.id = p.manual_id
              WHERE p.policy_id = NEW.policy_id AND p.kind = NEW.kind AND p.ym = NEW.ym AND m.state IN ('REQUESTED', 'APPROVED')) THEN
    RAISE EXCEPTION 'LGL_POSTING_DUP: 그 달 같은 보험료 전표 초안이 이미 있습니다(반려 · 취소한 뒤 다시).';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_insurance_policies_guard' AND tgrelid = 'public.lgl_insurance_policies'::regclass) THEN
    CREATE TRIGGER trg_lgl_insurance_policies_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_insurance_policies FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_insurance_policies_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_insurance_postings_guard' AND tgrelid = 'public.lgl_insurance_postings'::regclass) THEN
    CREATE TRIGGER trg_lgl_insurance_postings_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lgl_insurance_postings FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_insurance_postings_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('lgl.insurance_alert_days', '30', 'ADMIN', '회사 보험 만기 알림(v10.489 · D269) — 만기 며칠 전부터 갱신 증권이 없으면 운영 알림 LGL_INSURANCE_DUE(1 ~ 180)', false, '^([1-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30')
ON CONFLICT (key) DO NOTHING;

/* ── D269 공용 — 붙은 법무 서류 지우기 막음 · 정기 작업 하나 ──
 *   파일 용도는 법무 전용 LGL_DOC(sql/7_lgl_doc.sql · 대표 11/20).
 *   공용 fn_files_acct_guard 는 다시 쓰지 않고 따로 트리거(다른 묶음과 겹치지 않게 · ㉛ trg_hr_files_guard 와 같은 방식). */
CREATE OR REPLACE FUNCTION public.fn_lgl_files_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' AND OLD.purpose = 'LGL_DOC' THEN
    IF EXISTS (SELECT 1 FROM public.lgl_licenses x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_license_renewals x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_contract_reviews x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_review_opinions x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_cases x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_insurance_policies x WHERE OLD.id = ANY (x.file_ids)) THEN
      RAISE EXCEPTION 'FILE: 법무 대장(인허가 · 계약 검토 · 사건 · 보험)에 붙은 서류는 지울 수 없습니다';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lgl_files_guard' AND tgrelid = 'public.files'::regclass) THEN
    CREATE TRIGGER trg_lgl_files_guard BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_files_guard();
  END IF;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('lgl_due', 1440, 9, 50, NULL, true, '법무 기한 알림 — 매일 09:50 · 인허가 갱신 60 · 30 · 7일 전 LGL_LICENSE_DUE · 사건 기일 7 · 1일 전 LGL_HEARING_DUE · 보험 만기 30일 전 LGL_INSURANCE_DUE · 계약 검토 희망일 지남 LGL_REVIEW_LATE(차례마다 한 번 · 처리하면 풀림) · D269 · v10.486 ~ 489')
ON CONFLICT (job) DO NOTHING;

/* ── ㊴ (D269) 업무 권한(⑳ D258) — 새 탭 4개 업무 · 처음 변환 그룹(R_) 범위 · 주소 → 업무
 *   lgl-licenses · lgl-reviews · lgl-cases · lgl-insurance = 업무그룹 사무(admoff · 사내 문서함 corp-docs 와 같은 묶음)
 *   운영 관리자(R_ADMIN) 4개 모두 — @Roles('ADMIN') 와 같은 범위(적용 날 보는 범위 같음)
 *   지급 담당(R_PAYOUT) 은 lgl-insurance 만 — @Roles('ADMIN', 'PAYOUT') 보험 목록 · @Roles('PAYOUT') 보험료 전표 초안과 같은 범위
 *   SUPER 만인 주소(종류 고치기 · 계약 검토 결정)는 SUPER 가 권한 검사를 늘 통과하므로 맵에는 APPROVE 로만 둠
 *   세무사(R_ACCOUNTANT)는 넣지 않음 — 주소가 /admin/legal 아래라 세무사 읽기(/admin/acct GET)에도 걸리지 않음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('lgl-licenses', '회사 인허가', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1070),
  ('lgl-reviews', '계약 검토', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1071),
  ('lgl-cases', '소송 · 분쟁', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1072),
  ('lgl-insurance', '회사 보험', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 1073)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, t, l FROM (VALUES ('R_ADMIN', 'lgl-licenses'), ('R_ADMIN', 'lgl-reviews'), ('R_ADMIN', 'lgl-cases'), ('R_ADMIN', 'lgl-insurance'), ('R_PAYOUT', 'lgl-insurance')) x(g, t)
  CROSS JOIN (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/legal/licenses', 'lgl-licenses', 'VIEW'),
  ('GET', '/admin/legal/licenses/{id}', 'lgl-licenses', 'VIEW'),
  ('POST', '/admin/legal/licenses', 'lgl-licenses', 'EDIT'),
  ('PUT', '/admin/legal/licenses/{id}', 'lgl-licenses', 'EDIT'),
  ('POST', '/admin/legal/licenses/{id}/renew', 'lgl-licenses', 'EDIT'),
  ('POST', '/admin/legal/licenses/{id}/close', 'lgl-licenses', 'APPROVE'),
  ('GET', '/admin/legal/license-kinds', 'lgl-licenses', 'VIEW'),
  ('PUT', '/admin/legal/license-kinds/{code}', 'lgl-licenses', 'APPROVE'),
  ('GET', '/admin/legal/due', 'lgl-licenses', 'VIEW'),
  ('GET', '/admin/legal/reviews', 'lgl-reviews', 'VIEW'),
  ('GET', '/admin/legal/reviews/{id}', 'lgl-reviews', 'VIEW'),
  ('POST', '/admin/legal/reviews', 'lgl-reviews', 'EDIT'),
  ('POST', '/admin/legal/reviews/{id}/opinions', 'lgl-reviews', 'EDIT'),
  ('POST', '/admin/legal/reviews/{id}/decide', 'lgl-reviews', 'APPROVE'),
  ('POST', '/admin/legal/reviews/{id}/cancel', 'lgl-reviews', 'EDIT'),
  ('POST', '/admin/legal/reviews/{id}/link', 'lgl-reviews', 'EDIT'),
  ('GET', '/admin/legal/cases', 'lgl-cases', 'VIEW'),
  ('GET', '/admin/legal/cases/{id}', 'lgl-cases', 'VIEW'),
  ('POST', '/admin/legal/cases', 'lgl-cases', 'EDIT'),
  ('PUT', '/admin/legal/cases/{id}', 'lgl-cases', 'EDIT'),
  ('POST', '/admin/legal/cases/{id}/hearings', 'lgl-cases', 'EDIT'),
  ('PUT', '/admin/legal/hearings/{id}', 'lgl-cases', 'EDIT'),
  ('POST', '/admin/legal/cases/{id}/costs', 'lgl-cases', 'EDIT'),
  ('POST', '/admin/legal/costs/{id}/void', 'lgl-cases', 'APPROVE'),
  ('POST', '/admin/legal/cases/{id}/close', 'lgl-cases', 'APPROVE'),
  ('GET', '/admin/legal/insurance', 'lgl-insurance', 'VIEW'),
  ('GET', '/admin/legal/insurance/{id}', 'lgl-insurance', 'VIEW'),
  ('POST', '/admin/legal/insurance', 'lgl-insurance', 'EDIT'),
  ('PUT', '/admin/legal/insurance/{id}', 'lgl-insurance', 'EDIT'),
  ('POST', '/admin/legal/insurance/{id}/end', 'lgl-insurance', 'APPROVE'),
  ('POST', '/admin/legal/insurance/{id}/journal', 'lgl-insurance', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

/* ── ㊴ (D269 · 대표 11/20 결정) 법무 전용 파일 용도 LGL_DOC — 인허가 · 계약 검토 · 사건 · 보험 서류
 *   열람: 운영 관리자(ADMIN) · SUPER · 올린 사람(본인) · 지급 담당(PAYOUT)은 보험 증권(lgl_insurance_policies.file_ids)에 붙은 파일만 · 세무사 · 검수 못 엶
 *   올림: SUPER · ADMIN(file.service UPLOADERS — patches/2_lgl_doc.md 2-2)
 *   ★ ㉛ D262(sql/6_hr_doc.sql)가 먼저 적용된다고 봄 — ck_files_purpose 목록 · fn_file_can_read 본문은 D262 정의를 그대로 복사하고 LGL_DOC 만 더함.
 *     D262 와 D269 사이에 다른 묶음이 이 두 개를 다시 쓰면 합칠 때 목록 · 분기를 합칠 것(나중 정의가 앞을 덮음).
 *   보험 증권 판정 = 「LGL_DOC 이면서 보험 증권에 붙은 파일」(따로 용도 LGL_INS 를 두지 않음 — NOTES 2절) */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침 — D262 목록 그대로 + LGL_DOC(D269). 빠지면 있는 파일이 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC','NOTICE_ATTACHMENT','ACCT_EVIDENCE','CORP_DOC','HR_DOC','LGL_DOC']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('LGL_DOC', 'image/jpeg', 20971520, 'jpg'), ('LGL_DOC', 'image/png', 20971520, 'png'),
  ('LGL_DOC', 'application/pdf', 20971520, 'pdf')
ON CONFLICT DO NOTHING;

/* 파일 열람 — D262 정의 그대로 + LGL_DOC 두 줄(검수 막음 · 지급 담당은 보험 증권만) */
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
    /* v10.486 ~ 489 (D269 · 대표 11/20) — 법무 서류(LGL_DOC · 인허가 · 계약 검토 · 사건 · 보험)는 검수(REVIEWER)에게 열지 않음 · 본인 = 올린 사람은 위 주인 줄로 엶 */
    IF f.purpose = 'LGL_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    RETURN 'OK';
  END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;
  /* v10.392 (D245) — 지급 담당은 회계 증빙 · v10.425 (D253) 사내 문서 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose IN ('ACCT_EVIDENCE', 'CORP_DOC') THEN RETURN 'OK'; END IF;
  /* v10.489 (D269 · 대표 11/20) — 지급 담당은 법무 서류 중 보험 증권에 붙은 파일만(보험료 처리) · 계약 검토 · 사건 · 인허가 서류는 못 엶 · 세무사 분기에는 넣지 않음 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose = 'LGL_DOC'
     AND EXISTS (SELECT 1 FROM public.lgl_insurance_policies x WHERE f.id = ANY (x.file_ids)) THEN RETURN 'OK'; END IF;
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


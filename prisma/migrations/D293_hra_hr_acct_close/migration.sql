/* =====================================================================
 * 13차 인사 · 회계 ① v10.581 (docs/723) 연차 사용 촉진 — 근로기준법 61조(일반 원칙 · 노무 확인 권함)
 *   연차 사용 기간 = 달력 해(1/1 ~ 12/31) — 연차 대장(acct_leave_grants.year)이 해마다라 그대로 씀(입사일 기준 회사는 노무 확인 뒤 바꿈)
 *   1차 — 사용 기간 끝나기 hra.leave_promo_first_months(6)개월 전부터 hra.leave_promo_reply_days(10)일 안에 직원마다 남은 연차를 알리고
 *         직원이 10일 안에 쓸 날(계획)을 적게 함(hra_leave_promos round 1 · ISSUED → PLANNED · 기한 지나면 NO_PLAN)
 *   2차 — 계획을 안 낸 직원에게 관리자가 쓸 날을 정해 알림(round 2 · DESIGNATED) — 사용 기간 끝나기 hra.leave_promo_second_months(2)개월 전까지
 *   본인 확인(acked_at) = 서면 촉구를 받았다는 기록 · 줄은 지우지 않음(기록) · 남은 연차 · 기한 값은 만들 때 고정
 *   1년 미만 직원(월 1일 연차)은 촉진 기준이 달라(3개월 · 1개월 전) 이번 판은 「대상 아님 · 노무 확인」으로만 보여 줌
 *   스위치 hra.leave_promo 처음 off — 켜면 정기 작업 hra_daily 가 1차 기간에 줄을 저절로 만들고 운영 알림 HRA_LEAVE_PROMO(할 일)
 *   이름 앞머리 hra_ · 트리거 이름 고유 · RAISE 글자에 퍼센트 기호 없음 · 다시 돌려도 같음
 * ===================================================================== */

CREATE TABLE IF NOT EXISTS public.hra_leave_promos (
  id                bigserial PRIMARY KEY,
  employee_id       bigint NOT NULL REFERENCES public.acct_employees(id),
  year              integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  round             smallint NOT NULL CHECK (round IN (1, 2)),
  unused_days       numeric(5,1) NOT NULL CHECK (unused_days >= 0 AND unused_days <= 100),
  issued_on         date NOT NULL,
  reply_due         date NOT NULL,
  state             text NOT NULL DEFAULT 'ISSUED' CHECK (state IN ('ISSUED', 'PLANNED', 'NO_PLAN', 'DESIGNATED')),
  plan_dates        date[] NOT NULL DEFAULT '{}'::date[] CHECK (cardinality(plan_dates) <= 40),
  planned_at        timestamptz,
  designated_dates  date[] NOT NULL DEFAULT '{}'::date[] CHECK (cardinality(designated_dates) <= 40),
  acked_at          timestamptz,
  note              text CHECK (note IS NULL OR char_length(note) <= 200),
  out_of_window     boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES public.accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year, round),
  CONSTRAINT ck_hra_lp_due CHECK (reply_due >= issued_on),
  CONSTRAINT ck_hra_lp_state CHECK (
       (round = 1 AND state IN ('ISSUED', 'PLANNED', 'NO_PLAN') AND cardinality(designated_dates) = 0)
    OR (round = 2 AND state = 'DESIGNATED' AND cardinality(designated_dates) >= 1)),
  CONSTRAINT ck_hra_lp_plan CHECK ((state = 'PLANNED') = (planned_at IS NOT NULL AND cardinality(plan_dates) >= 1) OR round = 2)
);
CREATE INDEX IF NOT EXISTS ix_hra_lp_year ON public.hra_leave_promos (year, round, state);
COMMENT ON TABLE public.hra_leave_promos IS 'v10.581 (docs/723) 연차 사용 촉진 기록 — 1차(남은 연차 알림 · 직원 계획) · 2차(관리자가 쓸 날 지정) · 본인 확인 시각 · 지우지 않음 · 직원 · 해 · 차례 · 남은 연차 · 알린 날은 고치지 않음(근로기준법 61조 · 노무 확인 권함)';

CREATE OR REPLACE FUNCTION public.fn_hra_leave_promo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_LEAVE_PROMO: 연차 촉진 기록은 지우지 않습니다.'; END IF;
  IF (NEW.employee_id, NEW.year, NEW.round, NEW.unused_days, NEW.issued_on, NEW.reply_due, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.year, OLD.round, OLD.unused_days, OLD.issued_on, OLD.reply_due, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 직원 · 해 · 차례 · 남은 연차 · 알린 날 · 기한은 고치지 않습니다.';
  END IF;
  IF OLD.state IN ('PLANNED', 'NO_PLAN', 'DESIGNATED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 정해진 상태는 되돌리지 않습니다.';
  END IF;
  IF OLD.state = 'PLANNED' AND NEW.plan_dates IS DISTINCT FROM OLD.plan_dates THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 낸 계획은 고치지 않습니다(휴가 신청으로 바꿔 씀).';
  END IF;
  IF OLD.round = 2 AND NEW.designated_dates IS DISTINCT FROM OLD.designated_dates THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 지정한 날은 고치지 않습니다.';
  END IF;
  IF OLD.acked_at IS NOT NULL AND NEW.acked_at IS DISTINCT FROM OLD.acked_at THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 확인 시각은 고치지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_leave_promo_guard' AND tgrelid = 'public.hra_leave_promos'::regclass) THEN
    CREATE TRIGGER trg_hra_leave_promo_guard BEFORE UPDATE OR DELETE ON public.hra_leave_promos FOR EACH ROW EXECUTE FUNCTION public.fn_hra_leave_promo_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('hra.leave_promo', 'off', 'ADMIN', '연차 사용 촉진 자동(v10.581 · docs/723) — 처음 off · on 이면 정기 작업 hra_daily 가 1차 기간에 남은 연차 알림 줄을 만들고 운영 알림 HRA_LEAVE_PROMO · 바꾸기는 SUPER', false, '^(on|off)$', 'off'),
  ('hra.leave_promo_first_months', '6', 'ADMIN', '연차 촉진 1차 — 사용 기간(달력 해) 끝나기 몇 개월 전(근로기준법 61조 일반 원칙 6 · 1 ~ 11 · SUPER)', false, '^([1-9]|1[01])$', '6'),
  ('hra.leave_promo_second_months', '2', 'ADMIN', '연차 촉진 2차 — 사용 기간 끝나기 몇 개월 전까지 쓸 날을 지정(일반 원칙 2 · 1 ~ 10 · 1차보다 작아야 · SUPER)', false, '^([1-9]|10)$', '2'),
  ('hra.leave_promo_reply_days', '10', 'ADMIN', '연차 촉진 — 1차 알림 기간이자 직원이 계획을 내는 날수(일반 원칙 10 · 1 ~ 30 · SUPER)', false, '^([1-9]|[12][0-9]|30)$', '10')
ON CONFLICT (key) DO NOTHING;

/* 정기 작업 하나로 13차 알림 셋(연차 촉진 · 꼭 읽을 공지 · 회계 마감 체크리스트) — 스위치가 꺼져 있으면 아무것도 넣지 않음 */
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('hra_daily', 1440, 9, 50, NULL, true, '13차 인사 · 회계 알림 — 매일 09:50 · 연차 촉진(hra.leave_promo) · 꼭 읽을 사내 공지 기한 지남(hra.lib_unread_alert) · 회계 마감 남은 일(hra.close_alert) · 모두 처음 off · v10.581 ~ 584')
ON CONFLICT (job) DO NOTHING;

/* ㉕ 권한(D258) — 연차 촉진은 근태 · 휴가 신청(hr-leave)과 같은 범위(ADMIN · SUPER) · 본인 화면(내 인사)은 주소 맵에 넣지 않음(my-hr 과 같음) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hra-leave-promo', '연차 사용 촉진', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2950)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'hra-leave-promo', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hr/leave-promo', 'hra-leave-promo', 'VIEW'),
  ('POST', '/admin/hr/leave-promo/issue', 'hra-leave-promo', 'EDIT'),
  ('POST', '/admin/hr/leave-promo/{id}/designate', 'hra-leave-promo', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * 13차 인사 · 회계 ② v10.582 (docs/724) 사내 자료실 · 공지 — 운영자만 · 권한그룹별 공개 범위 · 읽음 확인
 *   사내 문서함(D253 corp_docs)과 겹치지 않게 「공지 · 자료 · 읽음 확인」만 새로 — 자료 파일은 사내 문서함과 같은 용도(CORP_DOC · 올리기 SUPER · ADMIN)로 올리거나
 *   사내 문서함에 이미 있는 문서를 고르면(corp_doc_id) 그 문서의 가장 최근 판을 보여 줌(두 번 올리지 않음)
 *   공개 범위 audience = 권한그룹 키(perm_role_groups.key · D258) 배열 · 비면 운영 계정 모두(세무사 빠짐)
 *     그룹에 든 사람 = perm_account_groups(기한 안) 또는 그 그룹의 처음 역할(from_role)을 가진 계정(account_roles · 기한 안) · SUPER 는 늘
 *   파일 열기는 이 자료실 주소가 공개 범위를 보고 짧은 주소를 줌(fn_file_can_read 는 고치지 않음 · 매물 동영상 v10.526 과 같은 방식)
 *   읽음 확인 hra_lib_reads 는 쌓기만 · 꼭 읽기(must_read) + 기한(read_due) 지나면 운영 알림 HRA_LIB_UNREAD(hra.lib_unread_alert 처음 off)
 *   글은 지우지 않음(보관 끝 ARCHIVED · 사유) · 고친 기록 hra_lib_revisions 쌓기만 · 붙은 파일은 지울 수 없음(별도 트리거 · 파일 지킴 함수는 고치지 않음)
 *   새 파일 용도 없음(ck_files_purpose 안 고침) · 이름 앞머리 hra_ · 다시 돌려도 같음
 * ===================================================================== */

CREATE TABLE IF NOT EXISTS public.hra_lib_posts (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('NOTICE', 'FILE')),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  body            text CHECK (body IS NULL OR char_length(body) <= 20000),
  audience        text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(audience) <= 20),
  must_read       boolean NOT NULL DEFAULT false,
  read_due        date,
  pinned          boolean NOT NULL DEFAULT false,
  file_id         uuid REFERENCES public.files(id),
  corp_doc_id     bigint REFERENCES public.corp_docs(id),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  archived_at     timestamptz,
  archive_reason  text CHECK (archive_reason IS NULL OR char_length(btrim(archive_reason)) BETWEEN 2 AND 200),
  unread_alerted_at timestamptz,
  created_by      uuid NOT NULL REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hra_lib_kind CHECK ((kind = 'NOTICE' AND body IS NOT NULL AND char_length(btrim(body)) >= 2) OR (kind = 'FILE' AND (file_id IS NOT NULL OR corp_doc_id IS NOT NULL))),
  CONSTRAINT ck_hra_lib_one_file CHECK (NOT (file_id IS NOT NULL AND corp_doc_id IS NOT NULL)),
  CONSTRAINT ck_hra_lib_due CHECK (read_due IS NULL OR must_read),
  CONSTRAINT ck_hra_lib_archived CHECK ((state = 'ACTIVE' AND archived_at IS NULL) OR (state = 'ARCHIVED' AND archived_at IS NOT NULL AND archive_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_hra_lib_posts_state ON public.hra_lib_posts (state, pinned DESC, created_at DESC);
COMMENT ON TABLE public.hra_lib_posts IS 'v10.582 (docs/724) 사내 자료실 · 공지 — 공지(본문) · 자료(파일 CORP_DOC 또는 사내 문서함 문서) · 공개 범위(권한그룹 키 · 비면 운영 계정 모두) · 꼭 읽기 · 기한 · 지우지 않음(보관 끝)';

CREATE TABLE IF NOT EXISTS public.hra_lib_reads (
  post_id     bigint NOT NULL REFERENCES public.hra_lib_posts(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, account_id)
);
COMMENT ON TABLE public.hra_lib_reads IS 'v10.582 (docs/724) 사내 공지 읽음 확인 — 본인이 「읽었습니다」를 누른 시각 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.hra_lib_revisions (
  id          bigserial PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES public.hra_lib_posts(id),
  before      jsonb NOT NULL,
  by_account  uuid REFERENCES public.accounts(id),
  at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hra_lib_revisions IS 'v10.582 (docs/724) 사내 자료실 고친 기록(고치기 전 제목 · 본문 · 공개 범위 · 꼭 읽기 · 기한) · 쌓기만';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_lib_reads_ro' AND tgrelid = 'public.hra_lib_reads'::regclass) THEN
    CREATE TRIGGER trg_hra_lib_reads_ro BEFORE UPDATE OR DELETE ON public.hra_lib_reads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_lib_revisions_ro' AND tgrelid = 'public.hra_lib_revisions'::regclass) THEN
    CREATE TRIGGER trg_hra_lib_revisions_ro BEFORE UPDATE OR DELETE ON public.hra_lib_revisions FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 글 지킴 — 지우지 않음 · 종류 · 쓴 사람 · 파일은 바꾸지 않음 · 보관 끝은 되돌리지 않음 · 공개 범위 키는 있는 권한그룹만 · 파일은 CORP_DOC READY */
CREATE OR REPLACE FUNCTION public.fn_hra_lib_post_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f public.files; bad text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_LIB: 사내 자료실 글은 지우지 않습니다(보관 끝으로).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.kind, NEW.created_by, NEW.created_at, NEW.file_id, NEW.corp_doc_id) IS DISTINCT FROM (OLD.kind, OLD.created_by, OLD.created_at, OLD.file_id, OLD.corp_doc_id) THEN
      RAISE EXCEPTION 'HRA_LIB: 종류 · 쓴 사람 · 붙은 파일은 바꾸지 않습니다(새 글로).';
    END IF;
    IF OLD.state = 'ARCHIVED' AND (NEW.state, NEW.title, NEW.body, NEW.audience, NEW.must_read, NEW.read_due, NEW.pinned)
       IS DISTINCT FROM (OLD.state, OLD.title, OLD.body, OLD.audience, OLD.must_read, OLD.read_due, OLD.pinned) THEN
      RAISE EXCEPTION 'HRA_LIB: 보관 끝 글은 고치거나 되돌리지 않습니다.';
    END IF;
    NEW.updated_at := now();
  END IF;
  SELECT string_agg(a, ',') INTO bad FROM unnest(NEW.audience) a WHERE NOT EXISTS (SELECT 1 FROM public.perm_role_groups g WHERE g.key = a);
  IF bad IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE = 'HRA_LIB_AUDIENCE: 없는 권한그룹입니다(' || bad || ').'; END IF;
  IF TG_OP = 'INSERT' AND NEW.file_id IS NOT NULL THEN
    SELECT * INTO f FROM public.files WHERE id = NEW.file_id;
    IF f.id IS NULL OR f.purpose <> 'CORP_DOC' OR f.status <> 'READY' THEN RAISE EXCEPTION 'HRA_LIB_FILE: 사내 문서 용도(CORP_DOC)로 올린 파일(READY)만 붙입니다.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_lib_post_guard' AND tgrelid = 'public.hra_lib_posts'::regclass) THEN
    CREATE TRIGGER trg_hra_lib_post_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hra_lib_posts FOR EACH ROW EXECUTE FUNCTION public.fn_hra_lib_post_guard();
  END IF;
END $$;

/* 붙은 파일은 지울 수 없음 — 기존 파일 지킴 함수(fn_files_acct_guard)는 그대로 두고 따로 트리거 하나 */
CREATE OR REPLACE FUNCTION public.fn_hra_lib_file_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND EXISTS (SELECT 1 FROM public.hra_lib_posts p WHERE p.file_id = OLD.id) THEN
    RAISE EXCEPTION 'FILE: 사내 자료실에 붙은 파일은 지울 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_lib_file_keep' AND tgrelid = 'public.files'::regclass) THEN
    CREATE TRIGGER trg_hra_lib_file_keep BEFORE UPDATE OF status ON public.files FOR EACH ROW EXECUTE FUNCTION public.fn_hra_lib_file_keep();
  END IF;
END $$;

/* 이 계정이 이 글을 볼 수 있나 — SUPER 늘 · 비면 운영 역할(세무사 빠짐) · 아니면 권한그룹(직접 붙임 또는 처음 역할) · 모두 기한 안 */
CREATE OR REPLACE FUNCTION public.fn_hra_lib_can_read(p_post bigint, p_account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hra_lib_posts p
     WHERE p.id = p_post
       AND (EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = p_account AND r.role = 'SUPER' AND (r.expires_at IS NULL OR r.expires_at > now()))
         OR (cardinality(p.audience) = 0
             AND EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = p_account AND r.role IN ('ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF')
                           AND (r.expires_at IS NULL OR r.expires_at > now())))
         OR EXISTS (SELECT 1 FROM public.perm_account_groups g WHERE g.account_id = p_account AND g.group_key = ANY (p.audience) AND (g.expires_at IS NULL OR g.expires_at > now()))
         OR EXISTS (SELECT 1 FROM public.perm_role_groups g JOIN public.account_roles r ON r.role = g.from_role
                     WHERE g.key = ANY (p.audience) AND g.active AND r.account_id = p_account AND (r.expires_at IS NULL OR r.expires_at > now()))))
$$;
COMMENT ON FUNCTION public.fn_hra_lib_can_read(bigint, uuid) IS 'v10.582 (docs/724) 사내 자료실 공개 범위 — SUPER · 비면 운영 역할(세무사 빠짐) · 권한그룹(직접 · 처음 역할) · 기한 안';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('hra.lib_unread_alert', 'off', 'ADMIN', '사내 공지 꼭 읽기 기한 지남 알림(v10.582 · docs/724) — 처음 off · on 이면 정기 작업 hra_daily 가 기한 지난 꼭 읽을 공지마다 운영 알림 HRA_LIB_UNREAD 한 번(모두 읽거나 보관 끝이면 풀림) · 바꾸기는 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) — 읽기는 운영 역할 모두(본인 화면 · 주소 맵에 읽기 주소는 넣지 않음 · 내 인사와 같음) · 글쓰기 · 읽음 현황은 ADMIN(R_ADMIN) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hra-library', '사내 자료실 · 공지', 'admoff', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2955)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ADMIN', 'hra-library', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ADMIN')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT g, 'hra-library', 'VIEW' FROM (VALUES ('R_PAYOUT'), ('R_REVIEWER'), ('R_PARTNER_MAL'), ('R_PARTNER_AFF')) x(g)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = x.g)
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hra/library/manage', 'hra-library', 'EDIT'),
  ('POST', '/admin/hra/library', 'hra-library', 'EDIT'),
  ('PUT', '/admin/hra/library/{id}', 'hra-library', 'EDIT'),
  ('POST', '/admin/hra/library/{id}/archive', 'hra-library', 'EDIT'),
  ('GET', '/admin/hra/library/{id}/reads', 'hra-library', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * 13차 인사 · 회계 ③ v10.583 (docs/725) 급여 이체 파일 — 확정(FIXED) · 지급(PAID) 급여 → 은행 대량 이체 CSV
 *   직원 급여 계좌는 직원 대장(acct_employees · 계좌 받지 않음)에 넣지 않고 따로 hra_pay_banks — 암호문(pgp_sym_encrypt · fn_enc_key)만 · 화면 · API 는 끝 4자리
 *   칸 이름은 INV-11 감시 낱말(account_no · bank_code 등)을 쓰지 않음(bank · acct_enc · acct_tail) → v_inv11_violations 예외 줄 없음
 *   계좌를 바꾸면 바뀐 기록(hra_pay_bank_changes · 끝 4자리만 · 사유 · 쌓기만) + 운영 알림 HRA_PAY_BANK_CHANGED(INFO · 가로채기 막기용 알림만)
 *   은행 양식(hra_bank_formats) — 칸 순서 · 칸 이름 · 머리줄 · 날짜 모양을 SUPER 가 짝지음(전표 CSV 양식 v10.389 와 같은 방식) · 처음 「기본(은행 코드 · 계좌 · 금액 · 예금주 · 적요)」
 *   내려받기는 스위치 hra.payfile_export(처음 off) + 내려받기 승인(ExportGate · 대상 HRA_PAY_FILE) 뒤 한 번 · 내려받은 기록 hra_payfile_logs(SHA-256 · 줄 수 · 합계 · 쌓기만 · 계좌 원문 없음)
 *   대량 이체(v10.454 fin-transfer)로 바로 넘기지 않음 — 급여 지급 전표(PAYROLL_PAID)와 이체 지급 전표(TRANSFER_PAID)가 겹칠 수 있어서(문서 7절)
 *   이름 앞머리 hra_ · 다시 돌려도 같음
 * ===================================================================== */

CREATE TABLE IF NOT EXISTS public.hra_pay_banks (
  employee_id  bigint PRIMARY KEY REFERENCES public.acct_employees(id),
  bank         text NOT NULL CHECK (bank ~ '^[0-9]{3}$'),
  acct_enc     bytea NOT NULL,
  acct_tail    text NOT NULL CHECK (acct_tail ~ '^[0-9]{4}$'),
  holder       text NOT NULL CHECK (char_length(btrim(holder)) BETWEEN 1 AND 40),
  updated_by   uuid REFERENCES public.accounts(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hra_pay_banks IS 'v10.583 (docs/725) 직원 급여 받을 계좌 — 은행 코드(숫자 3) · 계좌 암호문(fn_enc_key) · 끝 4자리 · 예금주 · 지우지 않음(바꾸기만 · 바뀐 기록)';

CREATE TABLE IF NOT EXISTS public.hra_pay_bank_changes (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL REFERENCES public.acct_employees(id),
  bank_before  text,
  tail_before  text,
  bank_after   text NOT NULL,
  tail_after   text NOT NULL,
  reason       text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  changed_by   uuid REFERENCES public.accounts(id),
  changed_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hra_pay_bank_changes IS 'v10.583 (docs/725) 급여 계좌 바뀐 기록 — 은행 코드 · 끝 4자리만(원문 없음) · 사유 · 누가 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.hra_bank_formats (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  columns     jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) BETWEEN 1 AND 20),
  header      boolean NOT NULL DEFAULT true,
  date_style  text NOT NULL DEFAULT 'YYYYMMDD' CHECK (date_style IN ('YYYY-MM-DD', 'YYYYMMDD', 'YYYY/MM/DD', 'YYYY.MM.DD')),
  is_default  boolean NOT NULL DEFAULT false,
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hra_bank_formats_default ON public.hra_bank_formats (is_default) WHERE is_default;
COMMENT ON TABLE public.hra_bank_formats IS 'v10.583 (docs/725) 급여 이체 파일 양식 — 칸(field · 칸 이름) 순서 · 머리줄 · 날짜 모양 · 기본 하나 · SUPER 가 은행 양식에 맞춤';
INSERT INTO public.hra_bank_formats (name, columns, header, date_style, is_default, note)
SELECT '기본(은행 코드 · 계좌 · 금액 · 예금주 · 적요)',
       '[{"field":"bank","title":"은행코드"},{"field":"acct","title":"계좌번호"},{"field":"amount","title":"금액"},{"field":"holder","title":"예금주"},{"field":"memo","title":"받는분통장표시"}]'::jsonb,
       true, 'YYYYMMDD', true, '처음 양식 — 쓰는 은행의 대량 이체 양식(칸 순서 · 이름 · 머리줄)에 맞춰 SUPER 가 고칩니다.'
 WHERE NOT EXISTS (SELECT 1 FROM public.hra_bank_formats);

CREATE TABLE IF NOT EXISTS public.hra_payfile_logs (
  id           bigserial PRIMARY KEY,
  run_id       bigint NOT NULL REFERENCES public.acct_payroll_runs(id),
  ym           text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  format_id    bigint REFERENCES public.hra_bank_formats(id),
  format_name  text NOT NULL,
  lines        integer NOT NULL CHECK (lines >= 0),
  total        bigint NOT NULL CHECK (total >= 0),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ticket       bigint,
  made_by      uuid REFERENCES public.accounts(id),
  made_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hra_payfile_logs_run ON public.hra_payfile_logs (run_id, made_at DESC);
COMMENT ON TABLE public.hra_payfile_logs IS 'v10.583 (docs/725) 급여 이체 파일 내려받은 기록 — 달 · 양식 · 줄 수 · 합계 · 파일 SHA-256 · 승인 번호 · 누가 · 쌓기만(계좌 원문 없음)';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_pay_bank_changes_ro' AND tgrelid = 'public.hra_pay_bank_changes'::regclass) THEN
    CREATE TRIGGER trg_hra_pay_bank_changes_ro BEFORE UPDATE OR DELETE ON public.hra_pay_bank_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_payfile_logs_ro' AND tgrelid = 'public.hra_payfile_logs'::regclass) THEN
    CREATE TRIGGER trg_hra_payfile_logs_ro BEFORE UPDATE OR DELETE ON public.hra_payfile_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hra_pay_bank_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_PAY_BANK: 급여 계좌는 지우지 않습니다(바꾸기만 · 바뀐 기록).'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_pay_bank_keep' AND tgrelid = 'public.hra_pay_banks'::regclass) THEN
    CREATE TRIGGER trg_hra_pay_bank_keep BEFORE UPDATE OR DELETE ON public.hra_pay_banks FOR EACH ROW EXECUTE FUNCTION public.fn_hra_pay_bank_keep();
  END IF;
END $$;

/* 내려받기 승인 대상 HRA_PAY_FILE — D284 와 같은 방식(지금 목록에 한 낱말 더함 · 다시 돌려도 같음) */
DO $$
DECLARE d text; vals text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO d FROM pg_constraint c
   WHERE c.conname = 'export_requests_target_check' AND c.conrelid = 'public.export_requests'::regclass;
  IF d IS NULL OR position('''HRA_PAY_FILE''' IN d) > 0 THEN RETURN; END IF;
  SELECT array_agg((m.x)[1]) INTO vals FROM regexp_matches(d, '''([A-Z][A-Z0-9_]*)''', 'g') AS m(x);
  vals := coalesce(vals, ARRAY[]::text[]) || 'HRA_PAY_FILE'::text;
  ALTER TABLE public.export_requests DROP CONSTRAINT export_requests_target_check;
  EXECUTE 'ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check CHECK (target IN ('
          || (SELECT string_agg(quote_literal(u.v), ', ') FROM unnest(vals) AS u(v)) || '))';
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('hra.payfile_export', 'off', 'ADMIN', '급여 이체 파일 내려받기(v10.583 · docs/725) — 처음 off · on 이어도 내려받기 승인(HRA_PAY_FILE) 뒤 한 번 · 계좌 원문이 든 파일이라 바꾸기는 SUPER', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) — 급여 탭(acct-payroll)과 같은 범위 = 지급 담당(R_PAYOUT) · 세무사 · ADMIN 은 넣지 않음(주소 /admin/hra 라 세무사 읽기에도 안 걸림) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hra-payfile', '급여 이체 파일', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2960)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PAYOUT', 'hra-payfile', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_PAYOUT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hra/payfile', 'hra-payfile', 'VIEW'),
  ('PUT', '/admin/hra/pay-banks/{id}', 'hra-payfile', 'EDIT'),
  ('GET', '/admin/hra/bank-formats', 'hra-payfile', 'VIEW'),
  ('POST', '/admin/hra/bank-formats', 'hra-payfile', 'EDIT'),
  ('PUT', '/admin/hra/bank-formats/{id}', 'hra-payfile', 'EDIT'),
  ('GET', '/admin/hra/payfile/export', 'hra-payfile', 'EXPORT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;
/* =====================================================================
 * 13차 인사 · 회계 ④ v10.584 (docs/726) 회계 마감 체크리스트 — 달 마감 전 할 일을 저절로 셈 + 사람이 확인
 *   저절로 셈(AUTO) — 월 결산 요약(v10.390 monthSummary)의 자동 전표 실패 · 통장 맞춤 · 세금계산서 발행을 그대로 쓰고
 *                     매입(세금계산서 받기 미처리 · 법인카드 미분류) · 급여(확정) · 감가상각(그 달 줄) · 미수금(기간 분석 90일) · 경비 청구(승인 뒤 미지급)를 더함
 *   사람이 확인(MANUAL) — SUPER 가 항목을 더하고 끔 · 확인 줄은 쌓기만(hra_close_marks · 가장 최근 줄이 지금 상태)
 *   저절로 셈 항목도 「예외 확인」(사유 꼭)으로 넘길 수 있음(예: 감가상각 대상 없음) — 기록은 같은 표
 *   남은 일 알림 — 지난달을 아직 마감하지 않았고 마감일(acct.close_by_day) hra.close_alert_days_before(3)일 전부터 남은 일이 있으면 운영 알림 HRA_CLOSE_TODO(달마다 한 번 · 마감 · 모두 끝나면 풀림)
 *                 스위치 hra.close_alert 처음 off(알림만 하는 기능이지만 13차 스위치는 모두 처음 off 로 맞춤)
 *   이름 앞머리 hra_ · 다시 돌려도 같음
 * ===================================================================== */

CREATE TABLE IF NOT EXISTS public.hra_close_items (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label       text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 60),
  kind        text NOT NULL CHECK (kind IN ('AUTO', 'MANUAL')),
  where_ko    text CHECK (where_ko IS NULL OR char_length(where_ko) <= 60),
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hra_close_items IS 'v10.584 (docs/726) 회계 마감 체크리스트 항목 — AUTO(서버가 셈 · 시드만) · MANUAL(SUPER 가 더하고 끔) · 지우지 않음(끄기)';

INSERT INTO public.hra_close_items (key, label, kind, where_ko, sort) VALUES
  ('journal',      '자동 전표 실패 없음',               'AUTO',   '회계 › 전표', 10),
  ('bank',         '통장 줄 모두 맞춤',                 'AUTO',   '회계 › 은행 맞추기', 20),
  ('invoices',     '세금계산서 발행 끝',                'AUTO',   '회계 › 신고 자료', 30),
  ('purchase',     '매입 — 받은 세금계산서 · 법인카드 정리', 'AUTO', '회계 › 세금계산서 받기 · 경비 청구', 40),
  ('expense',      '경비 청구 — 승인 뒤 미지급 없음',    'AUTO',   '회계 › 경비 청구', 50),
  ('payroll',      '급여 확정',                        'AUTO',   '회계 › 급여', 60),
  ('depreciation', '감가상각 그 달 줄',                 'AUTO',   '회계 › 고정자산', 70),
  ('receivable',   '미수금 — 90일 넘은 받을 돈 확인',    'AUTO',   '회계 › 기간 분석 · 미수금 독촉', 80),
  ('cash_count',   '현금 시재 · 법인카드 영수증 맞춤',   'MANUAL', '회계 › 자금 흐름', 110),
  ('accountant',   '세무사에게 그 달 자료 공유',         'MANUAL', '회계 › 세무사', 120)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.hra_close_marks (
  id        bigserial PRIMARY KEY,
  ym        text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  item_key  text NOT NULL REFERENCES public.hra_close_items(key),
  done      boolean NOT NULL,
  note      text CHECK (note IS NULL OR char_length(note) <= 200),
  marked_by uuid REFERENCES public.accounts(id),
  marked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hra_close_marks ON public.hra_close_marks (ym, item_key, id DESC);
COMMENT ON TABLE public.hra_close_marks IS 'v10.584 (docs/726) 회계 마감 확인 줄 — 달 · 항목 · 확인함/풀기 · 메모(저절로 셈 항목의 예외 확인은 사유 꼭) · 누가 · 쌓기만(가장 최근 줄이 지금 상태)';

CREATE OR REPLACE FUNCTION public.fn_hra_close_items_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_CLOSE: 체크리스트 항목은 지우지 않습니다(끄기).'; END IF;
  IF (NEW.key, NEW.kind) IS DISTINCT FROM (OLD.key, OLD.kind) THEN RAISE EXCEPTION 'HRA_CLOSE: 항목 열쇠 · 종류는 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_close_items_keep' AND tgrelid = 'public.hra_close_items'::regclass) THEN
    CREATE TRIGGER trg_hra_close_items_keep BEFORE UPDATE OR DELETE ON public.hra_close_items FOR EACH ROW EXECUTE FUNCTION public.fn_hra_close_items_keep();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hra_close_marks_ro' AND tgrelid = 'public.hra_close_marks'::regclass) THEN
    CREATE TRIGGER trg_hra_close_marks_ro BEFORE UPDATE OR DELETE ON public.hra_close_marks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('hra.close_alert', 'off', 'ADMIN', '회계 마감 남은 일 알림(v10.584 · docs/726) — 처음 off · on 이면 정기 작업 hra_daily 가 지난달 마감일 N일 전부터 남은 일이 있으면 운영 알림 HRA_CLOSE_TODO(달마다 한 번) · 바꾸기는 SUPER', false, '^(on|off)$', 'off'),
  ('hra.close_alert_days_before', '3', 'ADMIN', '회계 마감 남은 일 알림 — 마감일(acct.close_by_day) 며칠 전부터(0 ~ 10 · 0 은 마감일 당일부터)', false, '^([0-9]|10)$', '3')
ON CONFLICT (key) DO NOTHING;

/* ㉕ 권한(D258) — 월 결산(acct-month)과 같은 범위 = 지급 담당(R_PAYOUT) · 세무사(R_ACCOUNTANT)는 읽기만(주소 /admin/acct GET) */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('acct-close-check', '마감 체크리스트', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2965)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PAYOUT', 'acct-close-check', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_PAYOUT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_ACCOUNTANT', 'acct-close-check', 'VIEW'
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_ACCOUNTANT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/acct/close-check', 'acct-close-check', 'VIEW'),
  ('POST', '/admin/acct/close-check/marks', 'acct-close-check', 'EDIT'),
  ('POST', '/admin/acct/close-check/items', 'acct-close-check', 'APPROVE'),
  ('PUT', '/admin/acct/close-check/items/{key}', 'acct-close-check', 'APPROVE')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

-- v10.424 ~ 427 (docs/561 ~ 564) — 결재 · 문서 · 화면(⑳): 결재선 여러 단계 · 내 결재함 · 사내 문서함(CORP_DOC · 만료 알림) · 상단바 상위 묶음 · 분기 · 연 예산
--   대표 11/19 20:35 「모두개발」. 마지막 결재 단계는 SUPER(기존 가드). 다시 돌려도 같음.

/* ── v10.424 (D253 · docs/561) 결재선 여러 단계 ─────────────────────────────
 *   품의(REQ) · 경비 청구(EXPENSE) · 수동 전표(MANUAL)에 금액 구간별 결재선(SUPER 가 정함).
 *   acct_approval_lines — 종류 · 금액 상한(비면 그 위 전부) · 단계 [{role} | {account}] 1 ~ 5 · 마지막 단계는 언제나 SUPER(기존 DB 가드가 SUPER 결재를 요구).
 *   acct_approval_steps — 단계 기록(쌓기만) · 본인 문서 결재 불가 · 같은 사람이 한 차례(round)에 두 단계 불가 · 순서대로만.
 *   마지막 단계 = 지금의 승인(기존 decide 함수 · 기존 DB 가드 그대로). 결재선이 없으면 지금처럼 SUPER 한 번.
 *   중간 단계 반려 = 그 차례를 끝냄(문서는 그대로 청구 상태 · 다시 1단계부터) · SUPER 는 언제든 바로 반려.
 * ------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_approval_lines (
  id          bigserial PRIMARY KEY,
  doc_kind    text NOT NULL CHECK (doc_kind IN ('REQ', 'EXPENSE', 'MANUAL')),
  upto        bigint CHECK (upto IS NULL OR (upto > 0 AND upto <= 100000000000)),
  steps       jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 5),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aal_kind_upto ON public.acct_approval_lines (doc_kind, coalesce(upto, 9223372036854775807));
COMMENT ON TABLE public.acct_approval_lines IS 'v10.424 (D253) 결재선 — 종류 · 금액 상한(비면 그 위) · 단계(역할 또는 사람 · 마지막은 SUPER) · SUPER 가 정함 · 비면 SUPER 한 번';

CREATE OR REPLACE FUNCTION public.fn_acct_approval_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb; i int;
BEGIN
  FOR i IN 0 .. jsonb_array_length(NEW.steps) - 1 LOOP
    s := NEW.steps -> i;
    IF jsonb_typeof(s) <> 'object' OR ((s ? 'role') = (s ? 'account')) THEN
      RAISE EXCEPTION 'APV_LINE: 단계마다 역할(role) 또는 사람(account) 하나를 적습니다.';
    END IF;
    IF s ? 'role' AND (s ->> 'role') NOT IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') THEN
      RAISE EXCEPTION 'APV_LINE: 모르는 역할입니다.';
    END IF;
    IF s ? 'account' AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id::text = (s ->> 'account')) THEN
      RAISE EXCEPTION 'APV_LINE: 없는 사람입니다.';
    END IF;
  END LOOP;
  IF coalesce(NEW.steps -> -1 ->> 'role', '') <> 'SUPER' THEN
    RAISE EXCEPTION 'APV_LINE_LAST: 마지막 단계는 SUPER 입니다(승인 효과는 SUPER 결재).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_approval_line_guard' AND tgrelid = 'public.acct_approval_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_approval_line_guard BEFORE INSERT OR UPDATE ON public.acct_approval_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_approval_line_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_approval_line_changes (
  id          bigserial PRIMARY KEY,
  doc_kind    text NOT NULL,
  before      jsonb,
  after       jsonb,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_approval_line_changes_ro' AND tgrelid = 'public.acct_approval_line_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_approval_line_changes_ro BEFORE UPDATE OR DELETE ON public.acct_approval_line_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 문서 주인 · 금액 · 상태(종류마다) */
CREATE OR REPLACE FUNCTION public.fn_acct_doc_info(p_kind text, p_id bigint, OUT owner uuid, OUT amount bigint, OUT state text)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_kind = 'REQ' THEN
    SELECT r.requester, r.amount, r.state INTO owner, amount, state FROM public.acct_requisitions r WHERE r.id = p_id;
  ELSIF p_kind = 'EXPENSE' THEN
    SELECT c.claimant, c.amount, c.state INTO owner, amount, state FROM public.acct_expense_claims c WHERE c.id = p_id;
  ELSIF p_kind = 'MANUAL' THEN
    SELECT m.created_by, (SELECT coalesce(sum((x ->> 'debit')::bigint), 0) FROM jsonb_array_elements(m.lines) x), m.state
      INTO owner, amount, state FROM public.acct_manual_entries m WHERE m.id = p_id;
  END IF;
END $$;

/* 그 종류 · 금액의 결재선(가장 작은 상한부터 · 없으면 NULL) */
CREATE OR REPLACE FUNCTION public.fn_acct_approval_need(p_kind text, p_amount bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT l.steps FROM public.acct_approval_lines l
   WHERE l.doc_kind = p_kind AND (l.upto IS NULL OR p_amount <= l.upto)
   ORDER BY coalesce(l.upto, 9223372036854775807) LIMIT 1
$$;

CREATE TABLE IF NOT EXISTS public.acct_approval_steps (
  id          bigserial PRIMARY KEY,
  doc_kind    text NOT NULL CHECK (doc_kind IN ('REQ', 'EXPENSE', 'MANUAL')),
  doc_id      bigint NOT NULL,
  round       integer NOT NULL CHECK (round >= 1),
  step_no     integer NOT NULL CHECK (step_no BETWEEN 1 AND 5),
  approver    uuid NOT NULL REFERENCES public.accounts(id),
  decision    text NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aas_doc ON public.acct_approval_steps (doc_kind, doc_id, round, step_no);
COMMENT ON TABLE public.acct_approval_steps IS 'v10.424 (D253) 결재 단계 기록 — 쌓기만 · 본인 불가 · 같은 차례에 같은 사람 두 단계 불가 · 순서대로 · 반려하면 그 차례 끝(다음 차례 = round + 1)';

CREATE OR REPLACE FUNCTION public.fn_acct_approval_step_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; need jsonb; s jsonb; cur_round int; done int;
BEGIN
  SELECT * INTO d FROM public.fn_acct_doc_info(NEW.doc_kind, NEW.doc_id);
  IF d.owner IS NULL THEN RAISE EXCEPTION 'APV_DOC: 없는 문서입니다.'; END IF;
  IF NEW.approver = d.owner THEN RAISE EXCEPTION 'APV_SELF: 본인 문서는 결재할 수 없습니다.'; END IF;
  SELECT 1 + count(*) FILTER (WHERE decision = 'REJECT') INTO cur_round FROM public.acct_approval_steps WHERE doc_kind = NEW.doc_kind AND doc_id = NEW.doc_id;
  IF NEW.round <> cur_round THEN RAISE EXCEPTION 'APV_ORDER: 결재 차례가 맞지 않습니다.'; END IF;
  SELECT count(*) INTO done FROM public.acct_approval_steps WHERE doc_kind = NEW.doc_kind AND doc_id = NEW.doc_id AND round = cur_round AND decision = 'APPROVE';
  IF NEW.step_no <> done + 1 THEN RAISE EXCEPTION 'APV_ORDER: 결재 차례가 맞지 않습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.acct_approval_steps WHERE doc_kind = NEW.doc_kind AND doc_id = NEW.doc_id AND round = cur_round AND approver = NEW.approver) THEN
    RAISE EXCEPTION 'APV_DUP: 같은 사람이 두 단계를 결재할 수 없습니다.';
  END IF;
  need := public.fn_acct_approval_need(NEW.doc_kind, d.amount);
  IF need IS NOT NULL AND NEW.step_no <= jsonb_array_length(need) THEN
    s := need -> (NEW.step_no - 1);
    IF s ? 'account' AND (s ->> 'account') <> NEW.approver::text AND NOT public.fn_has_role(NEW.approver, 'SUPER') THEN
      RAISE EXCEPTION 'APV_WHO: 이 단계 결재자가 아닙니다.';
    END IF;
    IF s ? 'role' AND NOT public.fn_has_role(NEW.approver, s ->> 'role') AND NOT public.fn_has_role(NEW.approver, 'SUPER') THEN
      RAISE EXCEPTION 'APV_WHO: 이 단계 결재자가 아닙니다.';
    END IF;
    /* 중간 단계는 청구 상태일 때만 · 마지막 단계(승인 · 반려 효과)는 기존 결재 뒤에 남김 */
    IF NEW.decision = 'APPROVE' AND NEW.step_no < jsonb_array_length(need) AND d.state <> 'REQUESTED' THEN RAISE EXCEPTION 'APV_STATE: 결재를 기다리는 문서가 아닙니다.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_approval_step_guard' AND tgrelid = 'public.acct_approval_steps'::regclass) THEN
    CREATE TRIGGER trg_acct_approval_step_guard BEFORE INSERT ON public.acct_approval_steps FOR EACH ROW EXECUTE FUNCTION public.fn_acct_approval_step_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_approval_steps_ro' AND tgrelid = 'public.acct_approval_steps'::regclass) THEN
    CREATE TRIGGER trg_acct_approval_steps_ro BEFORE UPDATE OR DELETE ON public.acct_approval_steps FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── v10.425 (D253 · docs/562) 사내 문서함 ─────────────────────────────────
 *   정관 · 등기부 · 인감 · 사업자등록 · 규정 · 인증서 · 그 밖 — 파일 용도 CORP_DOC(JPG · PNG · PDF · 20MB · 올림 SUPER · ADMIN · 열람 SUPER · ADMIN · PAYOUT).
 *   corp_docs(문서 · 분류 · 지우기 없음 · 보관 끝 표시만) · corp_doc_versions(판 · 쌓기만 · 새 판 올리면 옛 판은 보관).
 *   만료일 30일(acct.corp_doc_due_days) 전부터 운영 알림 CORP_DOC_DUE(판 하나에 한 번 · 새 판 · 보관 끝이면 풀림) · 정기 작업 corp_doc_due 매일 09:30.
 * ------------------------------------------------------------------------- */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침 — D245 목록 그대로 + CORP_DOC(D253). 빠지면 있는 파일이 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC','NOTICE_ATTACHMENT','ACCT_EVIDENCE','CORP_DOC']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('CORP_DOC', 'image/jpeg', 20971520, 'jpg'), ('CORP_DOC', 'image/png', 20971520, 'png'),
  ('CORP_DOC', 'application/pdf', 20971520, 'pdf')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.corp_docs (
  id              bigserial PRIMARY KEY,
  category        text NOT NULL CHECK (category IN ('ARTICLES', 'REGISTRY', 'SEAL', 'BIZ_REG', 'RULES', 'CERT', 'ETC')),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 400),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ARCHIVED')),
  archived_at     timestamptz,
  archive_reason  text CHECK (archive_reason IS NULL OR char_length(btrim(archive_reason)) BETWEEN 2 AND 200),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_cd_archived CHECK ((state = 'ACTIVE' AND archived_at IS NULL) OR (state = 'ARCHIVED' AND archived_at IS NOT NULL AND archive_reason IS NOT NULL))
);
COMMENT ON TABLE public.corp_docs IS 'v10.425 (D253) 사내 문서함 — 분류 · 제목 · 지우기 없음 · 보관 끝(ARCHIVED · 사유)만';

CREATE TABLE IF NOT EXISTS public.corp_doc_versions (
  id           bigserial PRIMARY KEY,
  doc_id       bigint NOT NULL REFERENCES public.corp_docs(id),
  version_no   integer NOT NULL CHECK (version_no >= 1),
  file_id      uuid NOT NULL REFERENCES public.files(id),
  issued_on    date,
  expires_on   date,
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  uploaded_by  uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, version_no),
  CONSTRAINT ck_cdv_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX IF NOT EXISTS ix_cdv_doc ON public.corp_doc_versions (doc_id, version_no DESC);
COMMENT ON TABLE public.corp_doc_versions IS 'v10.425 (D253) 사내 문서 판 — 쌓기만(새 판 올리면 옛 판은 보관 · 지우기 없음)';

CREATE OR REPLACE FUNCTION public.fn_corp_docs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CORP_DOC: 사내 문서는 지우지 않습니다(보관 끝으로 표시).'; END IF;
  IF (NEW.category, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.category, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'CORP_DOC: 분류는 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN RAISE EXCEPTION 'CORP_DOC: 보관 끝 문서는 되돌리지 않습니다.'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_corp_doc_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f public.files; st text;
BEGIN
  SELECT * INTO f FROM public.files WHERE id = NEW.file_id;
  IF f.id IS NULL OR f.purpose <> 'CORP_DOC' OR f.status <> 'READY' THEN RAISE EXCEPTION 'CORP_DOC_FILE: 사내 문서 용도로 올린 파일(READY)만 붙입니다.'; END IF;
  SELECT state INTO st FROM public.corp_docs WHERE id = NEW.doc_id;
  IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'CORP_DOC: 보관 끝 문서에는 새 판을 올리지 않습니다.'; END IF;
  IF NEW.version_no <> coalesce((SELECT max(version_no) FROM public.corp_doc_versions WHERE doc_id = NEW.doc_id), 0) + 1 THEN
    RAISE EXCEPTION 'CORP_DOC: 판 번호는 차례대로입니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_corp_docs_guard' AND tgrelid = 'public.corp_docs'::regclass) THEN
    CREATE TRIGGER trg_corp_docs_guard BEFORE UPDATE OR DELETE ON public.corp_docs FOR EACH ROW EXECUTE FUNCTION public.fn_corp_docs_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_corp_doc_versions_guard' AND tgrelid = 'public.corp_doc_versions'::regclass) THEN
    CREATE TRIGGER trg_corp_doc_versions_guard BEFORE INSERT ON public.corp_doc_versions FOR EACH ROW EXECUTE FUNCTION public.fn_corp_doc_versions_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_corp_doc_versions_ro' AND tgrelid = 'public.corp_doc_versions'::regclass) THEN
    CREATE TRIGGER trg_corp_doc_versions_ro BEFORE UPDATE OR DELETE ON public.corp_doc_versions FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 붙은 증빙 · 계약서 · 사내 문서 파일은 지울 수 없음 — D249 정의 + 사내 문서 한 줄 */
CREATE OR REPLACE FUNCTION public.fn_files_acct_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND (EXISTS (SELECT 1 FROM public.acct_purchases p WHERE OLD.id = ANY(p.attachments))
          OR (to_regclass('public.acct_expense_claims') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.acct_expense_claims c WHERE OLD.id = ANY(c.attachments) AND c.state <> 'CANCELED'))
          OR EXISTS (SELECT 1 FROM public.acct_contracts k WHERE OLD.id = ANY(k.attachments))) THEN
    RAISE EXCEPTION 'FILE: 매입 · 경비 청구 · 계약에 붙은 증빙 파일은 지울 수 없습니다';
  END IF;
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND EXISTS (SELECT 1 FROM public.corp_doc_versions v WHERE v.file_id = OLD.id) THEN
    RAISE EXCEPTION 'FILE: 사내 문서에 붙은 파일은 지울 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

/* 파일 열람 — D245(D173 + PAYOUT · ACCT_EVIDENCE) 그대로 + PAYOUT 은 사내 문서(CORP_DOC)도 엶(ADMIN · SUPER 는 이미 모두) */
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
    RETURN 'OK';
  END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;
  /* v10.392 (D245) — 지급 담당은 회계 증빙 · v10.425 (D253) 사내 문서 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose IN ('ACCT_EVIDENCE', 'CORP_DOC') THEN RETURN 'OK'; END IF;

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

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.corp_doc_due_days', '30', 'ADMIN', 'v10.425 사내 문서 만료 알림 — 만료 며칠 전부터 CORP_DOC_DUE(1 ~ 180)', false, '^([1-9]|[1-9][0-9]|1[0-7][0-9]|180)$', '30')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('corp_doc_due', 1440, 9, 30, NULL, true, '사내 문서 만료 알림 — 매일 09:30 · 만료 N일 전 CORP_DOC_DUE(판 하나에 한 번) · D253 · v10.425')
ON CONFLICT (job) DO NOTHING;


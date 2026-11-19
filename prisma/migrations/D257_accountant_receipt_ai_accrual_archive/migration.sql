-- v10.437 ~ 440 (docs/574 ~ 577) — 세무사 공유 계정(ACCOUNTANT · 읽기 전용 · 기한 · 2단계) · 영수증 사진 자동 입력(AI · 처음 꺼짐) · 고정비 자동 전표(처음 꺼짐) · 장부 보관 5년 · 내부통제 보고
--   대표 11/19 21:15 ㉔ 「승인 + 통과하면 병합」 · 22:05 세무사가 보는 범위 「급여 · 연락처 모두 보여 줌」. 다시 돌려도 같음.

/* ── ① v10.437 (docs/574) 세무사 공유 계정 — 운영 역할 ACCOUNTANT(읽기 전용 · 기한 꼭) ──────────────────
 *   D173(PARTNER_MAL · PARTNER_AFF 더한 방식) 그대로 — 역할 CHECK · 역할 기록 함수 · 보유자 보기에 한 단어.
 *   기한(D239 expires_at)이 없으면 거래 끝에 DB 가 막음(ACCOUNTANT_EXPIRY) · 지나면 로그인 때 역할에서 빠지고 매시간 정기 작업이 거둠.
 *   쓰기는 서버 권한 검사가 막음(회계 GET 만 · 질문 남기기 · 내려받기 요청만). 회원 개인정보 화면은 역할이 없어 못 봄. */
ALTER TABLE public.account_roles DROP CONSTRAINT IF EXISTS account_roles_role_check;
ALTER TABLE public.account_roles ADD CONSTRAINT account_roles_role_check
  CHECK (role = ANY (ARRAY['MEMBER','BIZ_OWNER','BIZ_STAFF','REVIEWER','ADMIN','PAYOUT','SUPER','PARTNER_MAL','PARTNER_AFF','ACCOUNTANT']));

CREATE OR REPLACE FUNCTION public.fn_role_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  r text := nullif(btrim(coalesce(current_setting('app.role_reason', true), '')), '');
  a text := current_setting('app.actor_id', true);
  who uuid := CASE WHEN a ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a::uuid END;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF','ACCOUNTANT') THEN
    INSERT INTO role_changes(account_id, role, action, reason, changed_by) VALUES (NEW.account_id, NEW.role, 'GRANT', r, who);
  ELSIF TG_OP = 'DELETE' AND OLD.role IN ('ADMIN','SUPER','REVIEWER','PAYOUT','PARTNER_MAL','PARTNER_AFF','ACCOUNTANT') THEN
    INSERT INTO role_changes(account_id, role, action, reason, changed_by) VALUES (OLD.account_id, OLD.role, 'REVOKE', r, who);
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE OR REPLACE VIEW public.v_role_holders AS
 SELECT a.id AS account_id,
    a.email,
    a.name,
    string_agg(r.role, ','::text ORDER BY r.role) AS roles,
    ( SELECT max(c.changed_at) AS max
           FROM public.role_changes c
          WHERE (c.account_id = a.id)) AS last_change
   FROM (public.accounts a
     JOIN public.account_roles r ON ((r.account_id = a.id)))
  WHERE (r.role = ANY (ARRAY['ADMIN'::text, 'SUPER'::text, 'REVIEWER'::text, 'PAYOUT'::text, 'PARTNER_MAL'::text, 'PARTNER_AFF'::text, 'ACCOUNTANT'::text]))
  GROUP BY a.id, a.email, a.name;

CREATE OR REPLACE FUNCTION public.fn_accountant_role_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e timestamptz;
BEGIN
  SELECT expires_at INTO e FROM public.account_roles WHERE account_id = NEW.account_id AND role = 'ACCOUNTANT';
  IF FOUND AND (e IS NULL OR e > now() + interval '366 days') THEN
    RAISE EXCEPTION 'ACCOUNTANT_EXPIRY: 세무사 계정은 기한(1 ~ 365일)을 꼭 두어야 합니다.';
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_accountant_role_expiry' AND tgrelid = 'public.account_roles'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_accountant_role_expiry AFTER INSERT OR UPDATE ON public.account_roles
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.role = 'ACCOUNTANT') EXECUTE FUNCTION public.fn_accountant_role_expiry();
  END IF;
END $$;

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

/* 접속 기록 · 질문 · 답(모두 쌓기만) */
CREATE TABLE IF NOT EXISTS public.acct_accountant_access (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  method      text NOT NULL CHECK (method IN ('GET', 'POST', 'PATCH', 'PUT', 'DELETE')),
  path        text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 300),
  ip          text,
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_aaa_acc ON public.acct_accountant_access (account_id, at DESC);
COMMENT ON TABLE public.acct_accountant_access IS 'v10.437 (D257) 세무사 공유 계정 접속 기록 — 운영 화면 API 를 부를 때마다 한 줄 · 쌓기만';
CREATE TABLE IF NOT EXISTS public.acct_accountant_notes (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  ym          text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  entry_id    bigint REFERENCES public.acct_entries(id),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 2 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aan_ym ON public.acct_accountant_notes (ym, id DESC);
CREATE TABLE IF NOT EXISTS public.acct_accountant_replies (
  id          bigserial PRIMARY KEY,
  note_id     bigint NOT NULL REFERENCES public.acct_accountant_notes(id),
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aar_note ON public.acct_accountant_replies (note_id, id);
COMMENT ON TABLE public.acct_accountant_notes IS 'v10.437 (D257) 세무사 질문 — 달 · 전표마다 · 쌓기만(SUPER 답은 acct_accountant_replies)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accountant_access_ro' AND tgrelid = 'public.acct_accountant_access'::regclass) THEN
    CREATE TRIGGER trg_acct_accountant_access_ro BEFORE UPDATE OR DELETE ON public.acct_accountant_access FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accountant_notes_ro' AND tgrelid = 'public.acct_accountant_notes'::regclass) THEN
    CREATE TRIGGER trg_acct_accountant_notes_ro BEFORE UPDATE OR DELETE ON public.acct_accountant_notes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accountant_replies_ro' AND tgrelid = 'public.acct_accountant_replies'::regclass) THEN
    CREATE TRIGGER trg_acct_accountant_replies_ro BEFORE UPDATE OR DELETE ON public.acct_accountant_replies FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ② v10.438 (docs/575) 영수증 사진 자동 입력 — AI 통로 RECEIPT(스위치 acct.receipt_ai · 처음 off) ──────────
 *   AI 전체(agent.enabled) · 월 상한(agent.monthly_cap_usd) 안에서만(fn_agent_allowed · D188 위에 한 줄).
 *   acct.receipt_ai_mode = ASSUME(간주 · 밖으로 안 나감 · 처음) | AI. 결과는 칸 채움 제안 — 저장은 사람이 확인한 뒤 매입 · 경비 넣기로. */
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE','BOARD','TOWN_PICK','RECEIPT'));

CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled'
                         WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled'   -- D118 번역
                         WHEN 'BOARD' THEN 'i18n.board_on_view'   -- D119 게시판 볼 때 번역
                         WHEN 'TOWN_PICK' THEN 'agent.town_pick.enabled'   -- D188 동네픽 AI
                         WHEN 'RECEIPT' THEN 'acct.receipt_ai' END;   -- D257 영수증 읽기
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.receipt_ai', 'off', 'ADMIN',
        'v10.438 (D257) 영수증 사진 자동 입력 — on 이면 매입 · 경비 증빙 그림에서 날짜 · 공급자 · 금액을 읽어 칸 채움 제안(저장은 사람이 확인) · AI 전체 스위치 · 월 상한 안에서만', false, '^(on|off)$', 'off'),
       ('acct.receipt_ai_mode', 'ASSUME', 'ADMIN',
        'v10.438 (D257) 영수증 읽기 방식 — ASSUME(간주 · 밖으로 안 나감) · AI(운영 화면 AI 키로 읽음)', false, '^(ASSUME|AI)$', 'ASSUME')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_receipt_reads (
  id          bigserial PRIMARY KEY,
  file_id     uuid NOT NULL REFERENCES public.files(id),
  mode        text NOT NULL CHECK (mode IN ('ASSUME', 'AI')),
  model       text,
  ok          boolean NOT NULL,
  result      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text CHECK (error IS NULL OR char_length(error) <= 300),
  in_tokens   integer NOT NULL DEFAULT 0,
  out_tokens  integer NOT NULL DEFAULT 0,
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_arr_file ON public.acct_receipt_reads (file_id, id DESC);
COMMENT ON TABLE public.acct_receipt_reads IS 'v10.438 (D257) 영수증 읽기 결과 — 파일마다 · 방식 · 모델 · 제안 칸(jsonb) · 토큰 · 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_receipt_reads_ro' AND tgrelid = 'public.acct_receipt_reads'::regclass) THEN
    CREATE TRIGGER trg_acct_receipt_reads_ro BEFORE UPDATE OR DELETE ON public.acct_receipt_reads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ③ v10.439 (docs/576) 고정비 자동 전표 — 계약(⑯ acct_contracts)의 달 금액 → 매달 1일 미지급 비용(CONTRACT_ACCRUE) ──
 *   계약마다 규칙(비용 계정 · 금액이 부가세 포함인지 · 켜기) · 달마다 한 줄(acct_contract_accruals · 계약 · 달 고유).
 *   그 달 같은 거래처(사업자번호)의 매입(⑫ acct_purchases)이 들어오면 맞춤 → 반대 전표(CONTRACT_ACCRUE_REV · 비용 두 번 막기).
 *   다음 달 말까지 매입이 안 들어온 줄은 운영 알림 ACCT_ACCRUAL_UNMATCHED. 설정 acct.contract_accrue 처음 off. */
CREATE TABLE IF NOT EXISTS public.acct_contract_accrual_rules (
  contract_id   bigint PRIMARY KEY REFERENCES public.acct_contracts(id),
  account_role  text NOT NULL REFERENCES public.acct_accounts(role),
  vat_included  boolean NOT NULL DEFAULT true,
  enabled       boolean NOT NULL DEFAULT true,
  updated_by    uuid REFERENCES public.accounts(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_contract_accrual_rules IS 'v10.439 (D257) 계약 고정비 전표 규칙 — 비용 계정(EXPENSE) · 달 금액이 부가세 포함이면 ÷ 1.1 을 비용으로 · 켜기';
CREATE OR REPLACE FUNCTION public.fn_acct_accrual_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM public.acct_accounts WHERE role = NEW.account_role) IS DISTINCT FROM 'EXPENSE' THEN
    RAISE EXCEPTION 'ACCRUAL_ROLE: 고정비는 비용 계정만 고릅니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accrual_rule_guard' AND tgrelid = 'public.acct_contract_accrual_rules'::regclass) THEN
    CREATE TRIGGER trg_acct_accrual_rule_guard BEFORE INSERT OR UPDATE ON public.acct_contract_accrual_rules FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accrual_rule_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_contract_accruals (
  id            bigserial PRIMARY KEY,
  contract_id   bigint NOT NULL REFERENCES public.acct_contracts(id),
  ym            text NOT NULL CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  account_role  text NOT NULL REFERENCES public.acct_accounts(role),
  amount        bigint NOT NULL CHECK (amount > 0),
  state         text NOT NULL DEFAULT 'ACCRUED' CHECK (state IN ('ACCRUED', 'MATCHED')),
  purchase_id   bigint REFERENCES public.acct_purchases(id),
  matched_by    text CHECK (matched_by IS NULL OR matched_by IN ('AUTO', 'MANUAL')),
  matched_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, ym),
  CONSTRAINT ck_aca_match CHECK ((state = 'ACCRUED' AND purchase_id IS NULL AND matched_at IS NULL) OR (state = 'MATCHED' AND purchase_id IS NOT NULL AND matched_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aca_purchase ON public.acct_contract_accruals (purchase_id) WHERE purchase_id IS NOT NULL;
COMMENT ON TABLE public.acct_contract_accruals IS 'v10.439 (D257) 계약 고정비 달 줄 — 계약 · 달 한 줄 · 미지급 비용 전표 CONTRACT_ACCRUE · 매입이 오면 MATCHED → 반대 전표 CONTRACT_ACCRUE_REV · 지우기 없음';
CREATE OR REPLACE FUNCTION public.fn_acct_accrual_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCRUAL_LOCKED: 고정비 줄은 지우지 않습니다.'; END IF;
  IF (NEW.contract_id, NEW.ym, NEW.account_role, NEW.amount, NEW.created_at) IS DISTINCT FROM (OLD.contract_id, OLD.ym, OLD.account_role, OLD.amount, OLD.created_at)
     OR OLD.state = 'MATCHED' THEN
    RAISE EXCEPTION 'ACCRUAL_LOCKED: 고정비 줄은 맞춤 한 번만 바꿉니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accrual_guard' AND tgrelid = 'public.acct_contract_accruals'::regclass) THEN
    CREATE TRIGGER trg_acct_accrual_guard BEFORE UPDATE OR DELETE ON public.acct_contract_accruals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accrual_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.contract_accrue', 'off', 'ADMIN',
        'v10.439 (D257) 고정비 자동 전표 — on 이면 매달 1일 계약 달 금액을 미지급 비용 전표로(같은 거래처 매입이 오면 반대 전표) · 다음 달 말까지 매입이 없으면 운영 알림', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_accrual', 1440, 1, 20, NULL, true, '고정비 자동 전표(D257) — 매일 01:20 · 이번 달 줄 만들기 · 매입 맞춤 · 빠진 매입 알림 · acct.contract_accrue off 면 맞춤만')
ON CONFLICT (job) DO NOTHING;

/* ── ④ v10.440 (docs/577) 장부 보관 · 내부통제 보고 ──────────────────────────────────────────────
 *   해 마감(⑭ fn_acct_year_closed) 뒤 그 해 장부 묶음 기록(acct_archives · 전표 수 · 줄 수 · 차변 합 · 전표 CSV sha256 · 증빙 파일 목록 sha256) — 쌓기만 · 지우기 없음
 *   (국세기본법 장부 · 증빙 5년 보관 — keep_until = 다음 해 1월 1일 + 5년 · 그 뒤에도 지우지 않음, 표시만).
 *   내려받기는 승인 대상 ACCT_ARCHIVE. 달마다 내부통제 보고는 계산(저장 없음) · ⑰ 월보 한 줄. */
CREATE TABLE IF NOT EXISTS public.acct_archives (
  id            bigserial PRIMARY KEY,
  year          integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  entries       integer NOT NULL,
  lines         integer NOT NULL,
  debit_sum     bigint NOT NULL,
  files         integer NOT NULL,
  csv_sha256    text NOT NULL CHECK (csv_sha256 ~ '^[0-9a-f]{64}$'),
  manifest      jsonb NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  keep_until    date NOT NULL,
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  actor_id      uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_aar_year ON public.acct_archives (year, id DESC);
COMMENT ON TABLE public.acct_archives IS 'v10.440 (D257) 장부 보관 기록 — 해 마감 뒤 그 해 전표 CSV · 증빙 목록의 sha256 · 같은 해 다시 만들면 새 줄(판) · 쌓기만 · 지우기 없음(5년 보관)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_archives_ro' AND tgrelid = 'public.acct_archives'::regclass) THEN
    CREATE TRIGGER trg_acct_archives_ro BEFORE UPDATE OR DELETE ON public.acct_archives FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 내려받기 승인 대상 — D246 목록 + ACCT_ARCHIVE */
ALTER TABLE public.export_requests DROP CONSTRAINT IF EXISTS export_requests_target_check;
ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check
  CHECK (target IN ('POINT_REPORT', 'AUDIT_EXPORT', 'NOTICE_READS', 'RATE_READS', 'ACCT_JOURNAL', 'ACCT_TAX', 'ACCT_LEDGER', 'ACCT_ARCHIVE'));

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.control_big_amount', '10000000', 'ADMIN',
        'v10.440 (D257) 내부통제 보고의 「큰 금액 전표」 기준(원 · 한 전표 차변 합)', false, '^[0-9]{4,12}$', '10000000')
ON CONFLICT (key) DO NOTHING;


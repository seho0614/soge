-- v10.404 ~ 407 (docs/541 ~ 544) — 회계 · 세무 6단계(⑮): PG 정산 맞추기 · 수동 전표 쓰기 · 결재 · 퇴직금 추계 · 연차 대장 · 법인세 추정 미리보기
--   대표 11/19 17:35 ⑮ 「승인 + 통과하면 병합」.
--   PG 입금 CSV(쌓기만) ↔ PG 정산 받을 돈 · 수수료 전표 · 수동 전표(쓴 사람 ≠ 승인 SUPER) · 퇴직급여충당부채 · 연차 · 법인세 세율 구간 설정.
--   세율 · 연차 일수 · 퇴직금 셈은 초안 — 세무사 · 노무사 확인. 다시 돌려도 같음.

-- v10.404 ~ 407 (docs/541 ~ 544) — ⑮ 회계 5단계: PG 정산 맞추기 · 수동 전표 결재 · 퇴직금 추계 · 연차 · 법인세 추정
--   대표 11/19 17:35 「승인 + 통과하면 병합」 · 운영 범위 v10.407(→ v10.411 한 번에).
--   ① 계정(퇴직급여충당부채 · 퇴직급여) · 증빙 그대로
--   ② PG 정산 — acct_pg_uploads(쌓기만) · acct_pg_txns(row_hash 고유 · 내용 못 고침 · 맞춤 칸만) · 전표 PG_SETTLE(정기 작업 acct_journal)
--   ③ 수동 전표 — acct_manual_entries(초안 → 요청 → 승인 · 반려 · 쓴 사람 ≠ 승인 SUPER · 승인되면 acct_entries source MANUAL)
--   ④ 퇴직금 · 연차 — acct_severance_runs(달마다 한 번 · 추계액 · 쌓기만) · acct_leave_grants · acct_leave_uses(쌓기만)
--   ⑤ 설정 acct.pg_* · acct.leave_* · acct.corp_tax_* · 정기 작업 acct_pg_check(하루 1번 09:25)
--   세율 · 요율 · 연차 일수는 초안 — 설정으로 SUPER 가 고침 · 세무사 · 노무사 확인.
--   마감한 해 막기는 ⑭ D247 fn_acct_entries_closed(fn_acct_year_closed) 가 DB 에서 함.
--   다시 돌려도 같음.

/* ── ① 계정 ── */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note) VALUES
  ('SEVERANCE_RES', '퇴직급여충당부채', 'LIABILITY', '295', '퇴직급여충당부채', 70,  '퇴직금 추계액(v10.406) — 달마다 추계액과 장부 잔액 차이만 전표'),
  ('EXP_SEVERANCE', '퇴직급여',         'EXPENSE',   '806', '퇴직급여',         215, '퇴직금 충당 · 실지급(v10.406)')
ON CONFLICT (role) DO NOTHING;

/* ── ② PG 정산 ── */
CREATE TABLE IF NOT EXISTS public.acct_pg_uploads (
  id           bigserial PRIMARY KEY,
  filename     text,
  pg_name      text CHECK (pg_name IS NULL OR char_length(pg_name) <= 40),
  rows_total   integer NOT NULL DEFAULT 0,
  rows_added   integer NOT NULL DEFAULT 0,
  rows_dup     integer NOT NULL DEFAULT 0,
  rows_bad     integer NOT NULL DEFAULT 0,
  uploaded_by  uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_pg_uploads IS 'v10.404 (D248) PG 정산 내역 CSV 올린 기록 — 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_pg_uploads_ro' AND tgrelid = 'public.acct_pg_uploads'::regclass) THEN
    CREATE TRIGGER trg_acct_pg_uploads_ro BEFORE UPDATE OR DELETE ON public.acct_pg_uploads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_pg_txns (
  id           bigserial PRIMARY KEY,
  upload_id    bigint NOT NULL REFERENCES public.acct_pg_uploads(id),
  paid_on      date NOT NULL,                       -- 결제(승인 · 취소)일
  settle_on    date NOT NULL,                       -- 정산(입금)일
  gross        bigint NOT NULL CHECK (gross <> 0),  -- 결제 금액(취소는 음수)
  fee          bigint NOT NULL DEFAULT 0,           -- PG 수수료(부가세 포함 · 취소는 음수일 수 있음)
  fee_vat      bigint NOT NULL DEFAULT 0,           -- 수수료 중 부가세
  net          bigint NOT NULL,                     -- 입금액 = 결제 금액 − 수수료
  pg_key       text CHECK (pg_key IS NULL OR char_length(pg_key) <= 80),   -- 거래 번호 · 주문 번호
  method       text CHECK (method IS NULL OR char_length(method) <= 40),
  row_hash     text NOT NULL UNIQUE,
  match_kind   text CHECK (match_kind IN ('ENTRY', 'IGNORE')),
  entry_id     bigint REFERENCES public.acct_entries(id),
  match_note   text CHECK (match_note IS NULL OR char_length(match_note) <= 200),
  matched_by   uuid REFERENCES public.accounts(id),
  matched_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_apt_net CHECK (net = gross - fee),
  CONSTRAINT ck_apt_vat CHECK (abs(fee_vat) <= abs(fee)),
  CONSTRAINT ck_apt_match CHECK (match_kind IS NULL OR (match_kind = 'ENTRY' AND entry_id IS NOT NULL) OR (match_kind = 'IGNORE' AND char_length(btrim(coalesce(match_note, ''))) >= 2))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_apt_entry ON public.acct_pg_txns (entry_id) WHERE entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_apt_settle ON public.acct_pg_txns (settle_on, id);
COMMENT ON TABLE public.acct_pg_txns IS 'v10.404 (D248) PG 정산 줄 — 결제 한 건마다 · 같은 줄 한 번(row_hash) · 내용 못 고침 · 지우지 않음 · 맞춤(PG 정산 받을 돈 전표)만 고침 · 전표 PG_SETTLE(보통예금 · 지급수수료 · 부가세대급금 / PG 정산 받을 돈)';

CREATE OR REPLACE FUNCTION public.fn_acct_pg_txn_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amt bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PG: PG 정산 줄은 지우지 않습니다.'; END IF;
  IF (NEW.upload_id, NEW.paid_on, NEW.settle_on, NEW.gross, NEW.fee, NEW.fee_vat, NEW.net, NEW.pg_key, NEW.row_hash)
     IS DISTINCT FROM (OLD.upload_id, OLD.paid_on, OLD.settle_on, OLD.gross, OLD.fee, OLD.fee_vat, OLD.net, OLD.pg_key, OLD.row_hash) THEN
    RAISE EXCEPTION 'ACCT_PG: PG 정산 줄 내용은 고치지 않습니다(맞춤만).';
  END IF;
  IF NEW.match_kind = 'ENTRY' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
    /* 그 전표에 PG 정산 받을 돈 줄이 같은 금액 · 같은 방향(결제 = 차변 · 취소 = 대변)으로 있어야 함 */
    SELECT CASE WHEN NEW.gross > 0 THEN sum(l.debit) ELSE sum(l.credit) END INTO amt
      FROM public.acct_lines l WHERE l.entry_id = NEW.entry_id AND l.role = 'PG_RECV';
    IF coalesce(amt, 0) <> abs(NEW.gross) THEN
      RAISE EXCEPTION 'ACCT_PG_MISMATCH: 그 전표의 PG 정산 받을 돈 금액이 다릅니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_pg_txn_guard' AND tgrelid = 'public.acct_pg_txns'::regclass) THEN
    CREATE TRIGGER trg_acct_pg_txn_guard BEFORE UPDATE OR DELETE ON public.acct_pg_txns FOR EACH ROW EXECUTE FUNCTION public.fn_acct_pg_txn_guard();
  END IF;
END $$;

/* ── ③ 수동 전표 ── */
CREATE TABLE IF NOT EXISTS public.acct_manual_entries (
  id           bigserial PRIMARY KEY,
  entry_date   date NOT NULL,
  memo         text NOT NULL CHECK (char_length(btrim(memo)) BETWEEN 2 AND 200),
  party        text CHECK (party IS NULL OR char_length(party) <= 120),
  evidence     text NOT NULL DEFAULT 'NONE' CHECK (evidence IN ('TAX_INVOICE', 'CARD_PG', 'CASH', 'NONE', 'CARD', 'SIMPLE')),
  lines        jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 2 AND 30),
  total        bigint NOT NULL CHECK (total > 0),
  state        text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED')),
  created_by   uuid NOT NULL REFERENCES public.accounts(id),
  decided_by   uuid REFERENCES public.accounts(id),
  decided_at   timestamptz,
  decide_note  text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  entry_id     bigint REFERENCES public.acct_entries(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ame_decided CHECK (state = 'REQUESTED' OR state = 'CANCELED' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_ame_entry CHECK ((state = 'APPROVED') = (entry_id IS NOT NULL)),
  CONSTRAINT ck_ame_reject CHECK (state <> 'REJECTED' OR char_length(btrim(coalesce(decide_note, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_ame_state ON public.acct_manual_entries (state, id DESC);
COMMENT ON TABLE public.acct_manual_entries IS 'v10.405 (D248) 수동 전표 — 자동으로 안 잡히는 거래(임대료 · 대출 등) · 요청 → SUPER 승인(쓴 사람 아님)이면 acct_entries(source MANUAL) · 반려 사유 · 내용 못 고침(취소 뒤 다시)';

CREATE OR REPLACE FUNCTION public.fn_acct_manual_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_MANUAL: 수동 전표 요청은 지우지 않습니다(취소).'; END IF;
  IF (NEW.entry_date, NEW.memo, NEW.party, NEW.evidence, NEW.lines, NEW.total, NEW.created_by)
     IS DISTINCT FROM (OLD.entry_date, OLD.memo, OLD.party, OLD.evidence, OLD.lines, OLD.total, OLD.created_by) THEN
    RAISE EXCEPTION 'ACCT_MANUAL: 수동 전표 내용은 고치지 않습니다(취소하고 다시 쓰십시오).';
  END IF;
  IF OLD.state <> 'REQUESTED' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'ACCT_MANUAL_STATE: 이미 처리한 수동 전표입니다.';
  END IF;
  IF NEW.state IN ('APPROVED', 'REJECTED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.decided_by = NEW.created_by THEN
      RAISE EXCEPTION 'ACCT_MANUAL_SELF: 자기가 쓴 수동 전표는 승인 · 반려하지 못합니다.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.account_roles r WHERE r.account_id = NEW.decided_by AND r.role = 'SUPER') THEN
      RAISE EXCEPTION 'ACCT_MANUAL_ROLE: 수동 전표 승인 · 반려는 SUPER 만 합니다.';
    END IF;
  END IF;
  IF NEW.state = 'APPROVED' AND OLD.state <> 'APPROVED' THEN
    IF NOT EXISTS (SELECT 1 FROM public.acct_entries e WHERE e.id = NEW.entry_id AND e.source = 'MANUAL' AND e.source_key = NEW.id::text) THEN
      RAISE EXCEPTION 'ACCT_MANUAL: 승인된 수동 전표의 전표가 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_manual_guard' AND tgrelid = 'public.acct_manual_entries'::regclass) THEN
    CREATE TRIGGER trg_acct_manual_guard BEFORE UPDATE OR DELETE ON public.acct_manual_entries FOR EACH ROW EXECUTE FUNCTION public.fn_acct_manual_guard();
  END IF;
END $$;

/* 마감한 해 막기는 ⑭ D247 fn_acct_entries_closed · fn_acct_year_closed 가 함(여기서 따로 걸지 않음 — 수동 전표 서비스는 요청 · 승인 때 미리 확인) */

/* ── ④ 퇴직금 추계 · 연차 ── */
CREATE TABLE IF NOT EXISTS public.acct_severance_runs (
  id           bigserial PRIMARY KEY,
  ym           text NOT NULL UNIQUE CHECK (ym ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  estimate     bigint NOT NULL CHECK (estimate >= 0),    -- 그 달 말 추계액 합계
  book_before  bigint NOT NULL,                          -- 전표 전 장부 잔액(퇴직급여충당부채)
  diff         bigint NOT NULL,                          -- 넣은 전표 금액(+ 충당 · − 환입)
  detail       jsonb NOT NULL DEFAULT '[]'::jsonb,       -- 직원별(이름 · 근속일 · 1일 평균임금 · 추계액 · 대상 여부)
  entry_id     bigint REFERENCES public.acct_entries(id),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_severance_runs IS 'v10.406 (D248) 퇴직금 추계 — 달마다 한 번 · 추계액과 장부 잔액 차이만 전표(SEVERANCE_ACCRUE) · 쌓기만 · 계산 방식은 노무사 확인(초안)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_severance_runs_ro' AND tgrelid = 'public.acct_severance_runs'::regclass) THEN
    CREATE TRIGGER trg_acct_severance_runs_ro BEFORE UPDATE OR DELETE ON public.acct_severance_runs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 연차 — 해마다 생긴 날(grant) · 쓴 날(use) 쌓기만 · 남은 날 = 생긴 날 − 쓴 날. 직원은 ⑭ acct_employees(FK 는 걸지 않고 번호만 — ⑭ 와 순서 상관없게) */
CREATE TABLE IF NOT EXISTS public.acct_leave_grants (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL,
  year         integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  days         numeric(5,1) NOT NULL CHECK (days <> 0 AND abs(days) <= 40),
  note         text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 2 AND 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_alg_emp ON public.acct_leave_grants (employee_id, year);
CREATE TABLE IF NOT EXISTS public.acct_leave_uses (
  id           bigserial PRIMARY KEY,
  employee_id  bigint NOT NULL,
  used_on      date NOT NULL,
  days         numeric(4,1) NOT NULL CHECK (days <> 0 AND abs(days) <= 30),   -- 취소는 음수 줄
  note         text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_alu_emp ON public.acct_leave_uses (employee_id, used_on);
COMMENT ON TABLE public.acct_leave_grants IS 'v10.406 (D248) 연차 생긴 날 — 쌓기만(바로잡기는 음수 줄 · 사유) · 일수 기준은 설정 acct.leave_*(초안 · 노무사 확인)';
COMMENT ON TABLE public.acct_leave_uses IS 'v10.406 (D248) 연차 쓴 날 — 쌓기만(취소는 음수 줄)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_leave_grants_ro' AND tgrelid = 'public.acct_leave_grants'::regclass) THEN
    CREATE TRIGGER trg_acct_leave_grants_ro BEFORE UPDATE OR DELETE ON public.acct_leave_grants FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_leave_uses_ro' AND tgrelid = 'public.acct_leave_uses'::regclass) THEN
    CREATE TRIGGER trg_acct_leave_uses_ro BEFORE UPDATE OR DELETE ON public.acct_leave_uses FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ⑤ 설정 · 정기 작업 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('acct.pg_unsettled_days', '7', 'ADMIN',
   'PG 정산 안 들어온 결제 알림(v10.404 · docs/541) — PG 정산 받을 돈 전표가 이 일수 지나도 PG 정산 줄과 맞지 않으면 운영 알림 ACCT_PG_UNSETTLED(1 ~ 60 · 처음 7).',
   false, '^([1-9]|[1-5][0-9]|60)$', '7'),
  ('acct.pg_match_days', '2', 'ADMIN',
   'PG 정산 맞추기 날짜 폭(v10.404) — 결제일과 전표 날짜가 이 일수 안이면 후보(0 ~ 7 · 처음 2).',
   false, '^[0-7]$', '2'),
  ('acct.leave_base_days', '15', 'ADMIN',
   '연차 기본 일수(v10.406 · 초안 · 노무사 확인) — 1년 이상 근무 때 해마다 생기는 날(처음 15).',
   false, '^([1-9]|[1-2][0-9]|30)$', '15'),
  ('acct.leave_max_days', '25', 'ADMIN',
   '연차 최대 일수(v10.406 · 초안) — 근속 2년마다 1일 더하되 이 날까지(처음 25).',
   false, '^([1-9]|[1-3][0-9]|40)$', '25'),
  ('acct.leave_first_year_monthly', '1', 'ADMIN',
   '1년 미만 근무 때 한 달 개근마다 생기는 날(v10.406 · 초안 · 처음 1 · 최대 11일).',
   false, '^[0-3]$', '1'),
  ('acct.corp_tax_brackets', '200000000:9,20000000000:19,300000000000:21,*:24', 'ADMIN',
   '법인세 세율 구간(v10.407 · 초안 · 세무사 확인) — 「과세표준 상한:세율%」 쉼표로 · 마지막은 *. 해마다 세법이 바뀌면 SUPER 가 고침.',
   false, '^([0-9]{1,15}:[0-9]{1,2}(\.[0-9])?,){0,9}\*:[0-9]{1,2}(\.[0-9])?$', '200000000:9,20000000000:19,300000000000:21,*:24'),
  ('acct.corp_local_rate', '10', 'ADMIN',
   '법인 지방소득세 = 법인세의 몇 %(v10.407 · 초안 · 처음 10).',
   false, '^[0-9]{1,2}$', '10'),
  ('acct.corp_fiscal_end', '12', 'ADMIN',
   '사업연도 끝 달(v10.407 · 처음 12) — 중간예납 기한 = 사업연도 시작 6개월 뒤 달 말 · 확정 신고 = 끝 달 3개월 뒤 달 말.',
   false, '^([1-9]|1[0-2])$', '12')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_pg_check', 1440, 9, 25, NULL, true, 'PG 정산 안 들어온 결제 알림 — 매일 09:25 · PG 정산 받을 돈 전표가 acct.pg_unsettled_days 지나도 PG 정산 줄과 맞지 않으면 ACCT_PG_UNSETTLED · D248 · v10.404')
ON CONFLICT (job) DO NOTHING;

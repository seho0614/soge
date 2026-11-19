-- v10.408 ~ 411 (docs/545 ~ 548) — 회계 · 세무 7단계(⑯): 거래처 대장 · 계약 대장 · 만기 알림 · 품의 · 전자결재 · 무역 1단계 수입 건 관리
--   대표 11/19 17:55 ⑯ 「승인 + 통과하면 병합」(18:30 보류 물음에 「아니 진행」).
--   거래처(계좌 끝 4자리만) · 계약(계약서 파일 · 만기 30일 전 ACCT_CONTRACT_DUE · 달 고정비 → 자금 흐름) · 품의(SUPER 결재 · 본인 불가) · 수입(발주 → 선적 → 통관 → 입고 · 관세 · 운임 → 재고 원가 · 수입 부가세 전표).
--   수입 신고는 관세사. 다시 돌려도 같음.

/* ── v10.408 (D249 · docs/545) 거래처 대장 ─────────────────────────────
 *   acct_parties — 매입처 · 매출처 한 곳(사업자번호 · 담당 · 계좌는 은행 이름 + 끝 4자리만)
 *   연결: 광고주(advertisers.id) · 입점 판매자(hlt_sellers.id) · 매입(acct_purchases.supplier_biz_no 같은 번호)
 *   지우지 않음(닫기만) · 사업자번호는 하나에 한 거래처
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_parties (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('SUPPLIER', 'CUSTOMER', 'BOTH')),
  name           text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  biz_no         text CHECK (biz_no IS NULL OR biz_no ~ '^[0-9]{10}$'),
  contact_name   text CHECK (contact_name IS NULL OR char_length(contact_name) <= 40),
  contact_phone  text CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9-]{7,20}$'),
  contact_email  text CHECK (contact_email IS NULL OR char_length(contact_email) <= 120),
  bank_name      text CHECK (bank_name IS NULL OR char_length(bank_name) <= 20),
  account_last4  text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
  advertiser_id  uuid REFERENCES public.advertisers(id),
  seller_id      uuid REFERENCES public.hlt_sellers(id),
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 200),
  state          text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CLOSED')),
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.accounts(id),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_parties_biz ON public.acct_parties (biz_no) WHERE biz_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_parties_adv ON public.acct_parties (advertiser_id) WHERE advertiser_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_parties_seller ON public.acct_parties (seller_id) WHERE seller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_acct_parties_name ON public.acct_parties (lower(name));
COMMENT ON TABLE public.acct_parties IS 'v10.408 (D249) 거래처 대장 — 매입처 · 매출처 · 광고주 · 입점 판매자 연결 · 계좌는 끝 4자리만 · 지우지 않음(닫기)';

CREATE OR REPLACE FUNCTION public.fn_acct_party_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PARTY: 거래처는 지우지 않습니다(닫기만).'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_party_guard' AND tgrelid = 'public.acct_parties'::regclass) THEN
    CREATE TRIGGER trg_acct_party_guard BEFORE UPDATE OR DELETE ON public.acct_parties FOR EACH ROW EXECUTE FUNCTION public.fn_acct_party_guard();
  END IF;
END $$;

/* ── v10.409 (D249 · docs/546) 계약 대장 · 만기 알림 ──────────────────
 *   acct_contracts — 임대 · 용역 · 서버 · 구독 · 기타 계약(거래처 · 기간 · 자동 갱신 · 달 금액 · 계약서 파일 ACCT_EVIDENCE)
 *   만기 notice_days(처음 30)일 전부터 운영 알림 ACCT_CONTRACT_DUE(같은 계약 · 같은 만기일 한 번 · 만기가 지나거나 끝내면 풀림)
 *   달 금액이 있으면 ⑫ 자금 흐름 예정(acct_cash_plans · OUT · MONTHLY · 만기까지)을 함께 넣고, 끝내면 그 예정을 취소
 *   지우지 않음 · 금액 · 시작일은 고치지 않음(끝내고 새로) · 연장은 만기일만(사유)
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_contracts (
  id              bigserial PRIMARY KEY,
  party_id        bigint REFERENCES public.acct_parties(id),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  kind            text NOT NULL CHECK (kind IN ('RENT', 'SERVICE', 'SERVER', 'SUBSCRIPTION', 'OTHER')),
  start_on        date NOT NULL,
  end_on          date,
  auto_renew      boolean NOT NULL DEFAULT false,
  notice_days     integer NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 1 AND 180),
  monthly_amount  bigint NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0 AND monthly_amount <= 10000000000),
  pay_day         integer CHECK (pay_day IS NULL OR pay_day BETWEEN 1 AND 28),
  cash_plan_id    bigint REFERENCES public.acct_cash_plans(id),
  attachments     uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(attachments) <= 5),
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 200),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'ENDED')),
  end_note        text,
  ended_at        timestamptz,
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_acn_period CHECK (end_on IS NULL OR end_on >= start_on),
  CONSTRAINT ck_acn_pay CHECK (monthly_amount = 0 OR pay_day IS NOT NULL),
  CONSTRAINT ck_acn_end CHECK ((state = 'ACTIVE' AND ended_at IS NULL) OR (state = 'ENDED' AND ended_at IS NOT NULL AND char_length(btrim(coalesce(end_note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_acct_contracts_end ON public.acct_contracts (state, end_on);
COMMENT ON TABLE public.acct_contracts IS 'v10.409 (D249) 계약 대장 — 만기 알림 ACCT_CONTRACT_DUE · 달 금액은 자금 흐름 예정(MONTHLY) · 지우지 않음 · 금액 · 시작일 못 고침';

CREATE TABLE IF NOT EXISTS public.acct_contract_changes (
  id           bigserial PRIMARY KEY,
  contract_id  bigint NOT NULL REFERENCES public.acct_contracts(id),
  action       text NOT NULL CHECK (action IN ('CREATE', 'RENEW', 'END')),
  before_end   date,
  after_end    date,
  reason       text,
  actor_id     uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_contract_changes_ro' AND tgrelid = 'public.acct_contract_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_contract_changes_ro BEFORE UPDATE OR DELETE ON public.acct_contract_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_CONTRACT: 계약은 지우지 않습니다(끝내기만).'; END IF;
  IF OLD.state = 'ENDED' THEN RAISE EXCEPTION 'ACCT_CONTRACT: 끝낸 계약은 고치지 않습니다.'; END IF;
  IF (NEW.start_on, NEW.monthly_amount, NEW.kind, NEW.created_at) IS DISTINCT FROM (OLD.start_on, OLD.monthly_amount, OLD.kind, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_CONTRACT: 시작일 · 달 금액 · 종류는 고치지 않습니다(끝내고 새로 넣기).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_contract_guard' AND tgrelid = 'public.acct_contracts'::regclass) THEN
    CREATE TRIGGER trg_acct_contract_guard BEFORE UPDATE OR DELETE ON public.acct_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_contract_guard();
  END IF;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_contracts', 1440, 9, 25, NULL, true, '계약 만기 N일 전 운영 알림 ACCT_CONTRACT_DUE(같은 계약 · 만기 한 번 · 지나면 풀림) · D249 · v10.409')
ON CONFLICT (job) DO NOTHING;

/* 붙은 증빙 파일 지우기 막음 — D245(매입 · 경비 청구) + 계약서(acct_contracts.attachments) */
CREATE OR REPLACE FUNCTION public.fn_files_acct_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND (EXISTS (SELECT 1 FROM public.acct_purchases p WHERE OLD.id = ANY(p.attachments))
          OR (to_regclass('public.acct_expense_claims') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.acct_expense_claims c WHERE OLD.id = ANY(c.attachments) AND c.state <> 'CANCELED'))
          OR EXISTS (SELECT 1 FROM public.acct_contracts k WHERE OLD.id = ANY(k.attachments))) THEN
    RAISE EXCEPTION 'FILE: 매입 · 경비 청구 · 계약에 붙은 증빙 파일은 지울 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

/* ── v10.410 (D249 · docs/547) 품의 · 전자결재 ────────────────────────
 *   acct_requisitions — 쓰기 전 지출 품의(운영자 누구나 · 금액 · 계정 · 사유 · 쓸 날) → SUPER 결재(본인 품의 불가) → 승인된 품의를 매입 · 경비 청구에 「씀」으로 연결
 *   연결 금액이 품의 금액 × (1 + acct.req_tolerance_pct%)를 넘으면 막음(다시 품의) · 상태 앞으로만 · 내용 고치지 않음 · 지우지 않음
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_requisitions (
  id            bigserial PRIMARY KEY,
  requester     uuid NOT NULL REFERENCES public.accounts(id),
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  amount        bigint NOT NULL CHECK (amount > 0 AND amount <= 10000000000),
  account_role  text NOT NULL REFERENCES public.acct_accounts(role),
  reason        text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 400),
  needed_on     date,
  state         text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'APPROVED', 'REJECTED', 'USED', 'CANCELED')),
  decided_by    uuid REFERENCES public.accounts(id),
  decided_at    timestamptz,
  decide_note   text CHECK (decide_note IS NULL OR char_length(decide_note) <= 200),
  used_kind     text CHECK (used_kind IS NULL OR used_kind IN ('PURCHASE', 'EXPENSE')),
  used_ref      bigint,
  used_amount   bigint,
  used_by       uuid REFERENCES public.accounts(id),
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_areq_decided CHECK (state IN ('REQUESTED', 'CANCELED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_areq_reject CHECK (state <> 'REJECTED' OR char_length(btrim(coalesce(decide_note, ''))) >= 2),
  CONSTRAINT ck_areq_used CHECK (state <> 'USED' OR (used_kind IS NOT NULL AND used_ref IS NOT NULL AND used_amount IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_acct_req_state ON public.acct_requisitions (state, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_acct_req_requester ON public.acct_requisitions (requester, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_req_used ON public.acct_requisitions (used_kind, used_ref) WHERE used_ref IS NOT NULL;
COMMENT ON TABLE public.acct_requisitions IS 'v10.410 (D249) 품의 · 전자결재 — SUPER 결재(본인 불가) · 승인된 품의를 매입 · 경비 청구 하나에 연결 · 상태 앞으로만 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_acct_requisition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_REQ: 품의는 지우지 않습니다.'; END IF;
  IF (NEW.requester, NEW.title, NEW.amount, NEW.account_role, NEW.reason, NEW.needed_on, NEW.created_at)
     IS DISTINCT FROM (OLD.requester, OLD.title, OLD.amount, OLD.account_role, OLD.reason, OLD.needed_on, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_REQ: 품의 내용은 고치지 않습니다(취소하고 새로).';
  END IF;
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED')) OR (OLD.state = 'APPROVED' AND NEW.state IN ('USED', 'CANCELED'))) THEN
    RAISE EXCEPTION 'ACCT_REQ_STATE: 품의 상태는 앞으로만 바뀝니다.';
  END IF;
  IF NEW.state IN ('APPROVED', 'REJECTED') THEN
    IF NEW.decided_by IS NULL OR NOT fn_has_role(NEW.decided_by, 'SUPER') THEN RAISE EXCEPTION 'ACCT_REQ_SUPER: 품의 결재는 SUPER 만 합니다.'; END IF;
    IF NEW.decided_by = NEW.requester THEN RAISE EXCEPTION 'ACCT_REQ_SELF: 본인 품의는 결재할 수 없습니다.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_requisition_guard' AND tgrelid = 'public.acct_requisitions'::regclass) THEN
    CREATE TRIGGER trg_acct_requisition_guard BEFORE UPDATE OR DELETE ON public.acct_requisitions FOR EACH ROW EXECUTE FUNCTION public.fn_acct_requisition_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.req_tolerance_pct', '10', 'ADMIN', '품의 금액보다 이만큼(%)까지 더 써도 연결 허용 — 넘으면 다시 품의(v10.410 · D249)', false, '^([0-9]|[1-4][0-9]|50)$', '10')
ON CONFLICT (key) DO NOTHING;

/* ── v10.411 (D249 · docs/548) 무역 1단계 · 수입 건 관리 ──────────────
 *   acct_imports — 수입 한 건(거래처 · 품목 · 통화 · 환율 · 관세 · 수입 부가세 · 운임 · 기타 비용 · B/L · 관세사)
 *   상태 ORDERED 발주 → SHIPPED 선적 → CUSTOMS 통관 → RECEIVED 입고(앞으로만 · 통관 전에만 CANCELED)
 *   acct_import_lines — 들어올 직판 상품 옵션 · 수량 · 외화 금액
 *   입고 때: 물품(외화 × 환율) + 관세 + 운임 + 기타 비용을 물품 금액 비율로 나눠 ⑫ 재고 수불부 IN(원가) → 자동 전표 STOCK_IN(차변 상품 / 대변 미지급금)
 *            수입 부가세는 전표 IMPORT_VAT(차변 부가세대급금 / 대변 미지급금 · 수입세금계산서) — 원가에 넣지 않음
 *   수출입 신고는 관세사 · 유니패스 연동 없음 · 관세율 · 환율은 사람이 넣음
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_imports (
  id              bigserial PRIMARY KEY,
  party_id        bigint REFERENCES public.acct_parties(id),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  fx_rate         numeric(12,4) CHECK (fx_rate IS NULL OR fx_rate > 0),
  duty            bigint NOT NULL DEFAULT 0 CHECK (duty >= 0),
  import_vat      bigint NOT NULL DEFAULT 0 CHECK (import_vat >= 0),
  freight         bigint NOT NULL DEFAULT 0 CHECK (freight >= 0),
  other_cost      bigint NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  goods_krw       bigint,
  bl_no           text CHECK (bl_no IS NULL OR char_length(bl_no) <= 40),
  broker_name     text CHECK (broker_name IS NULL OR char_length(broker_name) <= 60),
  decl_no         text CHECK (decl_no IS NULL OR char_length(decl_no) <= 40),
  state           text NOT NULL DEFAULT 'ORDERED' CHECK (state IN ('ORDERED', 'SHIPPED', 'CUSTOMS', 'RECEIVED', 'CANCELED')),
  ordered_on      date NOT NULL,
  shipped_on      date,
  customs_on      date,
  received_on     date,
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 200),
  cancel_note     text,
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aim_customs CHECK (state NOT IN ('CUSTOMS', 'RECEIVED') OR (customs_on IS NOT NULL AND fx_rate IS NOT NULL)),
  CONSTRAINT ck_aim_received CHECK (state <> 'RECEIVED' OR (received_on IS NOT NULL AND goods_krw IS NOT NULL)),
  CONSTRAINT ck_aim_cancel CHECK (state <> 'CANCELED' OR char_length(btrim(coalesce(cancel_note, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_acct_imports_state ON public.acct_imports (state, ordered_on DESC);
COMMENT ON TABLE public.acct_imports IS 'v10.411 (D249) 수입 건 — 발주 → 선적 → 통관 → 입고(앞으로만) · 입고 때 재고 원가(물품 + 관세 + 운임 + 기타) · 수입 부가세는 부가세대급금 · 신고는 관세사';

CREATE TABLE IF NOT EXISTS public.acct_import_lines (
  id              bigserial PRIMARY KEY,
  import_id       bigint NOT NULL REFERENCES public.acct_imports(id),
  option_id       uuid NOT NULL REFERENCES public.hlt_product_options(id),
  qty             integer NOT NULL CHECK (qty > 0 AND qty <= 1000000),
  foreign_amount  numeric(14,2) NOT NULL CHECK (foreign_amount >= 0),
  landed_cost     bigint,
  UNIQUE (import_id, option_id)
);
COMMENT ON TABLE public.acct_import_lines IS 'v10.411 (D249) 수입 건 품목 — 직판 상품 옵션 · 수량 · 외화 금액 · 입고 때 원가(landed_cost)';

CREATE OR REPLACE FUNCTION public.fn_acct_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rk int; ok int;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_IMPORT: 수입 건은 지우지 않습니다(취소만).'; END IF;
  IF OLD.state IN ('RECEIVED', 'CANCELED') THEN RAISE EXCEPTION 'ACCT_IMPORT: 입고 · 취소한 수입 건은 고치지 않습니다.'; END IF;
  IF (NEW.ordered_on, NEW.created_at, NEW.currency) IS DISTINCT FROM (OLD.ordered_on, OLD.created_at, OLD.currency) THEN
    RAISE EXCEPTION 'ACCT_IMPORT: 발주일 · 통화는 고치지 않습니다.';
  END IF;
  IF NEW.state = 'CANCELED' AND OLD.state NOT IN ('ORDERED', 'SHIPPED') THEN
    RAISE EXCEPTION 'ACCT_IMPORT_STATE: 통관한 수입 건은 취소하지 않습니다.';
  END IF;
  IF OLD.state = 'CUSTOMS' AND (NEW.import_vat, NEW.customs_on) IS DISTINCT FROM (OLD.import_vat, OLD.customs_on) THEN
    RAISE EXCEPTION 'ACCT_IMPORT: 통관 뒤에는 수입 부가세 · 통관일을 고치지 않습니다.';
  END IF;
  IF NEW.state <> OLD.state AND NEW.state <> 'CANCELED' THEN
    rk := array_position(ARRAY['ORDERED', 'SHIPPED', 'CUSTOMS', 'RECEIVED'], OLD.state);
    ok := array_position(ARRAY['ORDERED', 'SHIPPED', 'CUSTOMS', 'RECEIVED'], NEW.state);
    IF ok IS NULL OR ok <= rk THEN RAISE EXCEPTION 'ACCT_IMPORT_STATE: 수입 건 상태는 앞으로만 바뀝니다.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_import_guard' AND tgrelid = 'public.acct_imports'::regclass) THEN
    CREATE TRIGGER trg_acct_import_guard BEFORE UPDATE OR DELETE ON public.acct_imports FOR EACH ROW EXECUTE FUNCTION public.fn_acct_import_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_import_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_imports WHERE id = coalesce(NEW.import_id, OLD.import_id);
  IF TG_OP = 'UPDATE' AND (NEW.import_id, NEW.option_id, NEW.qty, NEW.foreign_amount) IS NOT DISTINCT FROM (OLD.import_id, OLD.option_id, OLD.qty, OLD.foreign_amount)
     AND st IN ('CUSTOMS', 'RECEIVED') THEN
    RETURN NEW;   -- 입고 때 원가(landed_cost)만 채움
  END IF;
  IF st NOT IN ('ORDERED', 'SHIPPED') THEN RAISE EXCEPTION 'ACCT_IMPORT: 통관 뒤에는 품목을 고치지 않습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_import_line_guard' AND tgrelid = 'public.acct_import_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_import_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_import_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_import_line_guard();
  END IF;
END $$;


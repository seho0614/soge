-- v10.388 ~ 391 (docs/525 ~ 528) — 회계 · 세무 2단계(⑪): 은행 거래 내역 맞추기 · 전표 양식 맞춤 · 월 결산 · 신고 기한 알림 · 전자세금계산서(광고 청구 · 입점 수수료)
--   대표 11/19 06:20 「승인 + 통과하면 병합」.
--   ① v10.388 acct_bank_uploads · acct_bank_txns — 통장 거래 내역 CSV 올리기(같은 줄은 한 번) · 전표의 보통예금 줄과 맞추기(금액 · 날짜 ±N일 · 이름)
--   ② v10.389 acct_export_formats — 전표 CSV 양식(칸 순서 · 칸 이름 · 날짜 모양 · 차변/대변 칸 또는 구분 + 금액) · 기본 양식 하나
--   ③ v10.390 신고 기한(원천세 매월 10일 · 부가세 1 · 4 · 7 · 10월 25일) N일 전 · 마감 안 한 지난달 운영 알림 — 정기 작업 acct_deadline(매일 09:15)
--   ④ v10.391 acct_tax_invoices — 광고 청구 · 입점 수수료 세금계산서 발행 요청 줄(전자세금계산서 전송 칸 · 가드는 정액 노출 · 리드 캐시와 같음)
--   다시 돌려도 같음 · 지우는 문장은 전송 기록 종류 CHECK 를 넓히는 한 줄뿐(DROP CONSTRAINT IF EXISTS → 바로 다시 ADD).

/* ── ① 은행 거래 내역 ── */
CREATE TABLE IF NOT EXISTS public.acct_bank_uploads (
  id           bigserial PRIMARY KEY,
  filename     text CHECK (filename IS NULL OR char_length(filename) <= 200),
  bank         text CHECK (bank IS NULL OR char_length(bank) <= 40),
  rows_total   integer NOT NULL CHECK (rows_total >= 0),
  rows_added   integer NOT NULL CHECK (rows_added >= 0),
  rows_dup     integer NOT NULL CHECK (rows_dup >= 0),
  rows_bad     integer NOT NULL DEFAULT 0 CHECK (rows_bad >= 0),
  uploaded_by  uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_bank_uploads IS 'v10.388 (D244) 통장 거래 내역 올린 기록 — 파일 이름 · 은행 · 줄 수(새로 · 이미 있음 · 못 읽음) · 누가 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.acct_bank_txns (
  id            bigserial PRIMARY KEY,
  upload_id     bigint NOT NULL REFERENCES public.acct_bank_uploads(id),
  tx_date       date NOT NULL,
  deposit       bigint NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  withdraw      bigint NOT NULL DEFAULT 0 CHECK (withdraw >= 0),
  balance       bigint,
  counterparty  text CHECK (counterparty IS NULL OR char_length(counterparty) <= 120),
  memo          text CHECK (memo IS NULL OR char_length(memo) <= 200),
  row_hash      text NOT NULL UNIQUE CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  match_kind    text CHECK (match_kind IS NULL OR match_kind IN ('ENTRY', 'IGNORE')),
  entry_id      bigint REFERENCES public.acct_entries(id),
  match_note    text CHECK (match_note IS NULL OR char_length(match_note) <= 200),
  matched_by    uuid REFERENCES public.accounts(id),
  matched_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_abt_one CHECK ((deposit > 0) <> (withdraw > 0)),
  CONSTRAINT ck_abt_match CHECK (
       (match_kind IS NULL AND entry_id IS NULL AND matched_at IS NULL)
    OR (match_kind = 'ENTRY' AND entry_id IS NOT NULL AND matched_at IS NOT NULL)
    OR (match_kind = 'IGNORE' AND entry_id IS NULL AND matched_at IS NOT NULL AND char_length(btrim(coalesce(match_note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_abt_date ON public.acct_bank_txns (tx_date, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_abt_entry ON public.acct_bank_txns (entry_id) WHERE entry_id IS NOT NULL;
COMMENT ON TABLE public.acct_bank_txns IS 'v10.388 (D244) 통장 거래 한 줄 — 입금 또는 출금 하나 · 같은 줄(날짜 · 금액 · 잔액 · 상대 · 메모 · 같은 날 순번)은 한 번(row_hash) · 전표 하나와 맞춤(ENTRY · 전표당 한 줄) 또는 맞출 것 없음(IGNORE · 사유) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_acct_bank_txn_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_BANK: 통장 거래 줄은 지우지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.upload_id, NEW.tx_date, NEW.deposit, NEW.withdraw, NEW.balance, NEW.counterparty, NEW.memo, NEW.row_hash, NEW.created_at)
     IS DISTINCT FROM (OLD.upload_id, OLD.tx_date, OLD.deposit, OLD.withdraw, OLD.balance, OLD.counterparty, OLD.memo, OLD.row_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_BANK: 통장 거래 내용은 고치지 않습니다(맞춤만).';
  END IF;
  /* 맞춘 전표는 같은 방향 · 같은 금액의 보통예금 줄이 있어야 합니다 */
  IF NEW.match_kind = 'ENTRY' AND NOT EXISTS (
       SELECT 1 FROM acct_lines l WHERE l.entry_id = NEW.entry_id AND l.role = 'CASH'
          AND ((NEW.deposit > 0 AND l.debit = NEW.deposit) OR (NEW.withdraw > 0 AND l.credit = NEW.withdraw))) THEN
    RAISE EXCEPTION 'ACCT_BANK_MISMATCH: 전표 % 에 같은 금액의 보통예금 % 줄이 없습니다.', NEW.entry_id, CASE WHEN NEW.deposit > 0 THEN '차변' ELSE '대변' END;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_bank_txn_guard' AND tgrelid = 'public.acct_bank_txns'::regclass) THEN
    CREATE TRIGGER trg_acct_bank_txn_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_bank_txns FOR EACH ROW EXECUTE FUNCTION public.fn_acct_bank_txn_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_bank_uploads_ro' AND tgrelid = 'public.acct_bank_uploads'::regclass) THEN
    CREATE TRIGGER trg_acct_bank_uploads_ro BEFORE UPDATE OR DELETE ON public.acct_bank_uploads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── ② 전표 CSV 양식 ── */
CREATE TABLE IF NOT EXISTS public.acct_export_formats (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  columns     jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) BETWEEN 1 AND 20),
  date_style  text NOT NULL DEFAULT 'YYYY-MM-DD' CHECK (date_style IN ('YYYY-MM-DD', 'YYYYMMDD', 'YYYY/MM/DD', 'YYYY.MM.DD')),
  dc_style    text NOT NULL DEFAULT 'SPLIT' CHECK (dc_style IN ('SPLIT', 'SIGN')),
  dc_debit    text NOT NULL DEFAULT '차변' CHECK (char_length(dc_debit) BETWEEN 1 AND 10),
  dc_credit   text NOT NULL DEFAULT '대변' CHECK (char_length(dc_credit) BETWEEN 1 AND 10),
  header      boolean NOT NULL DEFAULT true,
  is_default  boolean NOT NULL DEFAULT false,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aef_default ON public.acct_export_formats (is_default) WHERE is_default;
COMMENT ON TABLE public.acct_export_formats IS 'v10.389 (D244) 전표 CSV 양식 — 칸(field · 칸 이름) 순서 · 날짜 모양 · 차변/대변 두 칸(SPLIT) 또는 구분 칸 + 금액(SIGN) · 기본 하나(SUPER)';

INSERT INTO public.acct_export_formats (name, columns, date_style, dc_style, is_default)
VALUES ('일반 양식', '[{"field":"date","title":"일자"},{"field":"no","title":"전표번호"},{"field":"line","title":"줄"},{"field":"code","title":"계정코드"},{"field":"name","title":"계정명"},{"field":"debit","title":"차변"},{"field":"credit","title":"대변"},{"field":"party","title":"거래처"},{"field":"memo","title":"적요"},{"field":"evidence","title":"증빙"},{"field":"src","title":"근거"}]'::jsonb,
        'YYYY-MM-DD', 'SPLIT', true)
ON CONFLICT (name) DO NOTHING;

/* ── ③ 설정 · 정기 작업 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('acct.bank_match_days', '3', 'ADMIN',
   '은행 거래 맞추기 날짜 폭(v10.388 · docs/525) — 통장 날짜와 전표 날짜가 이 일수 안이면 후보(1 ~ 14 · 처음 3).',
   false, '^([1-9]|1[0-4])$', '3'),
  ('acct.deadline_alert', 'on', 'ADMIN',
   '신고 기한 운영 알림(v10.390 · docs/527) — 원천세(매월 10일) · 부가세(acct.vat_months 의 25일) N일 전 · 지난달 마감 안 함. off 면 알리지 않음.',
   false, '^(on|off)$', 'on'),
  ('acct.deadline_days_before', '3', 'ADMIN',
   '신고 기한 며칠 전에 알릴지(v10.390 · 1 ~ 7 · 처음 3). 기한이 주말 · 공휴일이면 다음 영업일이 기한입니다.',
   false, '^[1-7]$', '3'),
  ('acct.vat_months', '1,4,7,10', 'ADMIN',
   '부가세 신고 달(v10.390) — 그 달 25일이 기한. 처음 1 · 4 · 7 · 10월(예정 · 확정 신고). 쉼표로 1 ~ 12.',
   false, '^(1[0-2]|[1-9])(,(1[0-2]|[1-9])){0,11}$', '1,4,7,10'),
  ('acct.close_by_day', '10', 'ADMIN',
   '지난달 마감 기한 날(v10.390) — 이 날(한국) 뒤에도 지난달을 마감하지 않았으면 운영 알림 ACCT_UNCLOSED(1 ~ 28 · 처음 10).',
   false, '^([1-9]|1[0-9]|2[0-8])$', '10')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_deadline', 1440, 9, 15, NULL, true, '신고 기한 · 마감 알림 — 매일 09:15 · 원천세(10일) · 부가세(25일) N일 전 ACCT_DEADLINE · 지난달 마감 안 함 ACCT_UNCLOSED · D244 · v10.390')
ON CONFLICT (job) DO NOTHING;

/* ── ④ 광고 청구 · 입점 수수료 세금계산서 ── */
CREATE TABLE IF NOT EXISTS public.acct_tax_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('AD', 'COMMISSION')),
  source_id      uuid NOT NULL,
  state          text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'ISSUED', 'CANCELED')),
  supply         bigint NOT NULL CHECK (supply > 0),
  vat            bigint NOT NULL CHECK (vat >= 0),
  total          bigint NOT NULL,
  buyer_name     text NOT NULL CHECK (char_length(btrim(buyer_name)) BETWEEN 1 AND 120),
  buyer_biz_no   text CHECK (buyer_biz_no IS NULL OR buyer_biz_no ~ '^[0-9]{3}-[0-9]{2}-[0-9]{5}$'),
  item           text NOT NULL CHECK (char_length(item) BETWEEN 1 AND 100),
  invoice_no     text UNIQUE,
  issued_on      date,
  issued_by      uuid REFERENCES public.accounts(id),
  requested_by   uuid REFERENCES public.accounts(id),
  cancel_reason  text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  etax_mode        text,
  etax_status      text,
  etax_doc_key     text,
  etax_approval_no text,
  etax_amend_approval_no text,
  etax_error       text,
  etax_attempts    int NOT NULL DEFAULT 0,
  etax_adapter     text,
  etax_sent_at     timestamptz,
  etax_result_at   timestamptz,
  CONSTRAINT ck_ati_total CHECK (total = supply + vat),
  CONSTRAINT ck_ati_issued CHECK (state <> 'ISSUED' OR (invoice_no IS NOT NULL AND issued_on IS NOT NULL)),
  CONSTRAINT ck_acct_tax_invoices_etax CHECK (
        (etax_mode IS NULL OR etax_mode IN ('MANUAL','ASSUMED','ASP'))
    AND (etax_status IS NULL OR etax_status IN ('ASSUMED','SENDING','SENT','FAILED','CANCELED'))
    AND (etax_adapter IS NULL OR etax_adapter IN ('assume','http'))
    AND (etax_approval_no IS NULL OR etax_approval_no ~ '^[0-9]{24}$')
    AND (etax_amend_approval_no IS NULL OR etax_amend_approval_no ~ '^[0-9]{24}$')
    AND (etax_status IS DISTINCT FROM 'SENT' OR etax_approval_no IS NOT NULL)
    AND (etax_status IS DISTINCT FROM 'ASSUMED' OR (etax_approval_no IS NULL AND etax_mode = 'ASSUMED'))
    AND (etax_mode IS DISTINCT FROM 'MANUAL' OR etax_status IS NULL)
    AND (etax_status IS NULL OR etax_doc_key IS NOT NULL)
    AND etax_attempts >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ati_source ON public.acct_tax_invoices (kind, source_id) WHERE state <> 'CANCELED';
CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_tax_invoices_etax_doc ON public.acct_tax_invoices (etax_doc_key) WHERE etax_doc_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_acct_tax_invoices_etax_appr ON public.acct_tax_invoices (etax_approval_no) WHERE etax_approval_no IS NOT NULL;
COMMENT ON TABLE public.acct_tax_invoices IS 'v10.391 (D244) 광고 청구(AD · ad_invoices) · 입점 수수료(COMMISSION · hlt_settlements 수수료 + 수수료 부가세) 세금계산서 — 발행 요청(금액 · 공급받는 자를 그때 값으로 고정) → 전자세금계산서(간주 · 업체) · 근거마다 하나(취소 뒤 다시) · 지우지 않음';

/* 금액 · 공급받는 자 · 근거는 고치지 않음 · 발행한 줄은 취소로만 */
CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_TAX_INVOICE: 세금계산서 줄은 지우지 않습니다(취소로).'; END IF;
  IF (NEW.kind, NEW.source_id, NEW.supply, NEW.vat, NEW.total, NEW.buyer_name, NEW.buyer_biz_no, NEW.item, NEW.created_at, NEW.requested_by)
     IS DISTINCT FROM (OLD.kind, OLD.source_id, OLD.supply, OLD.vat, OLD.total, OLD.buyer_name, OLD.buyer_biz_no, OLD.item, OLD.created_at, OLD.requested_by) THEN
    RAISE EXCEPTION 'ACCT_TAX_INVOICE_FIXED: 금액 · 공급받는 자 · 근거는 고칠 수 없습니다(취소하고 다시 요청).';
  END IF;
  IF OLD.state = 'CANCELED' AND NEW.state <> 'CANCELED' THEN RAISE EXCEPTION 'ACCT_TAX_INVOICE: 취소한 요청은 되돌리지 않습니다.'; END IF;
  IF OLD.state = 'ISSUED' AND NEW.state = 'REQUESTED' THEN RAISE EXCEPTION 'ACCT_TAX_INVOICE: 발행한 세금계산서는 요청으로 되돌리지 않습니다.'; END IF;
  IF OLD.state = 'ISSUED' AND (NEW.invoice_no, NEW.issued_on) IS DISTINCT FROM (OLD.invoice_no, OLD.issued_on) THEN
    RAISE EXCEPTION 'ACCT_TAX_INVOICE: 발행 번호 · 발행일은 고치지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

/* 발행되면 근거 표에 번호를 적어 둠(광고 청구서 세금계산서 번호 · 정산 세금계산서 상태) — 이미 손으로 적은 번호는 그대로 */
CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_issued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'ISSUED' AND OLD.state IS DISTINCT FROM 'ISSUED' THEN
    IF NEW.kind = 'AD' THEN
      UPDATE ad_invoices SET tax_invoice_no = NEW.invoice_no WHERE id = NEW.source_id AND coalesce(btrim(tax_invoice_no), '') = '';
    ELSE
      UPDATE hlt_settlements SET invoice_state = 'ISSUED', invoice_no = NEW.invoice_no, invoice_issued_at = now()
       WHERE id = NEW.source_id AND invoice_state <> 'ISSUED';
    END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tax_invoice_guard' AND tgrelid = 'public.acct_tax_invoices'::regclass) THEN
    CREATE TRIGGER trg_acct_tax_invoice_guard BEFORE UPDATE OR DELETE ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_invoice_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tax_invoice_etax' AND tgrelid = 'public.acct_tax_invoices'::regclass) THEN
    CREATE TRIGGER trg_acct_tax_invoice_etax BEFORE UPDATE ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_etax_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tax_invoice_issued' AND tgrelid = 'public.acct_tax_invoices'::regclass) THEN
    CREATE TRIGGER trg_acct_tax_invoice_issued AFTER UPDATE OF state ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_invoice_issued();
  END IF;
END $$;

/* 전자세금계산서 전송 기록 — 종류 둘 더함 */
ALTER TABLE public.etax_send_log DROP CONSTRAINT IF EXISTS etax_send_log_invoice_kind_check;
ALTER TABLE public.etax_send_log ADD CONSTRAINT etax_send_log_invoice_kind_check CHECK (invoice_kind IN ('DIRECTORY', 'LEAD_CASH', 'AD', 'COMMISSION'));

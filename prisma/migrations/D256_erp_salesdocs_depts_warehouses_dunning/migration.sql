-- v10.433 ~ 436 (docs/570 ~ 573) — 내부 ERP 완성(㉓): 견적서 · 거래명세서 · 발주서 · 부서 · 프로젝트별 손익 · 창고 여러 곳 · 재고 이동 · 바코드 · 미수금 독촉 · 입금 예정
--   대표 11/19 「이카운트 연동은 보류 → 그냥 내부 시스템으로」. 다시 돌려도 같음.

/* ── v10.433 (docs/570) 견적서 · 주문서 · 거래명세서 ─────────────────────────
 *   대표 11/19 「이카운트 연동은 보류 → 그냥 내부 시스템으로」.
 *   acct_sales_docs — 견적(QUOTE) → 주문(ORDER) → 거래명세서(STATEMENT) · 번호 Q/O/S-YYMM-0001 · 쌓기만(내용 못 고침 · 고치기는 새 판).
 *   거래명세서 확정(ACCEPTED) → 매출 전표 SALES_DOC(차변 외상매출금 / 대변 매출 · 부가세예수금) · 세금계산서 발행 요청(acct_tax_invoices kind SALES_DOC).
 * ------------------------------------------------------------------- */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('REV_SALES', '매출(견적 · 거래명세서)', 'REVENUE', '404', '용역매출', 175, '거래명세서 확정 매출 — v10.433(종류에 따라 문서에서 다른 매출 계정 고름)', false)
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_doc_counters (
  kind  text NOT NULL CHECK (kind IN ('QUOTE', 'ORDER', 'STATEMENT')),
  ym    text NOT NULL CHECK (ym ~ '^[0-9]{4}$'),
  last  integer NOT NULL DEFAULT 0 CHECK (last >= 0),
  PRIMARY KEY (kind, ym)
);
COMMENT ON TABLE public.acct_doc_counters IS 'v10.433 (D256) 문서 번호 — 종류 · 달(YYMM)마다 1부터';

CREATE TABLE IF NOT EXISTS public.acct_sales_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('QUOTE', 'ORDER', 'STATEMENT')),
  doc_no         text NOT NULL CHECK (doc_no ~ '^[QOS]-[0-9]{4}-[0-9]{4,6}$'),
  rev            integer NOT NULL DEFAULT 1 CHECK (rev BETWEEN 1 AND 99),
  root_id        uuid,
  prev_id        uuid REFERENCES public.acct_sales_docs(id),
  parent_id      uuid REFERENCES public.acct_sales_docs(id),
  party_id       bigint NOT NULL REFERENCES public.acct_parties(id),
  title          text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  issued_on      date NOT NULL,
  valid_until    date,
  due_on         date,
  revenue_role   text NOT NULL DEFAULT 'REV_SALES' REFERENCES public.acct_accounts(role),
  supply         bigint NOT NULL CHECK (supply >= 0),
  vat            bigint NOT NULL CHECK (vat >= 0),
  total          bigint NOT NULL,
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 400),
  state          text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'SENT', 'ACCEPTED', 'CANCELED')),
  superseded_by  uuid REFERENCES public.acct_sales_docs(id),
  accepted_at    timestamptz,
  canceled_at    timestamptz,
  cancel_reason  text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  tax_invoice_id uuid,
  tax_invoice_no text,
  created_by     uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_asd_total CHECK (total = supply + vat),
  CONSTRAINT ck_asd_cancel CHECK (state <> 'CANCELED' OR (canceled_at IS NOT NULL AND char_length(btrim(coalesce(cancel_reason, ''))) >= 2)),
  CONSTRAINT ck_asd_accept CHECK (state <> 'ACCEPTED' OR accepted_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asd_no_rev ON public.acct_sales_docs (doc_no, rev);
CREATE INDEX IF NOT EXISTS ix_asd_party ON public.acct_sales_docs (party_id, issued_on DESC);
CREATE INDEX IF NOT EXISTS ix_asd_kind_state ON public.acct_sales_docs (kind, state, issued_on DESC);
COMMENT ON TABLE public.acct_sales_docs IS 'v10.433 (D256) 견적서 · 주문서 · 거래명세서 — 내용은 못 고침(고치기 = 새 판 rev+1 · 옛 판 superseded_by) · 상태만 앞으로 · 거래명세서 확정 = 매출 전표 · 세금계산서 요청';

CREATE TABLE IF NOT EXISTS public.acct_sales_doc_lines (
  id          bigserial PRIMARY KEY,
  doc_id      uuid NOT NULL REFERENCES public.acct_sales_docs(id),
  seq         integer NOT NULL CHECK (seq BETWEEN 1 AND 100),
  item        text NOT NULL CHECK (char_length(btrim(item)) BETWEEN 1 AND 120),
  spec        text CHECK (spec IS NULL OR char_length(spec) <= 80),
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit        text CHECK (unit IS NULL OR char_length(unit) <= 10),
  unit_price  bigint NOT NULL CHECK (unit_price >= 0),
  supply      bigint NOT NULL CHECK (supply >= 0),
  vat         bigint NOT NULL CHECK (vat >= 0),
  tax_type    text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_type IN ('TAXABLE', 'EXEMPT', 'ZERO')),
  option_id   uuid REFERENCES public.hlt_product_options(id),
  UNIQUE (doc_id, seq)
);
COMMENT ON TABLE public.acct_sales_doc_lines IS 'v10.433 (D256) 문서 품목 줄 — 쌓기만(고치기는 새 판) · 과세 · 면세 · 영세';

CREATE OR REPLACE FUNCTION public.fn_acct_sales_doc_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_DOC: 문서는 지우지 않습니다(취소로).'; END IF;
  IF (NEW.kind, NEW.doc_no, NEW.rev, NEW.root_id, NEW.prev_id, NEW.parent_id, NEW.party_id, NEW.title, NEW.issued_on, NEW.valid_until, NEW.due_on,
      NEW.revenue_role, NEW.supply, NEW.vat, NEW.total, NEW.memo, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.kind, OLD.doc_no, OLD.rev, OLD.root_id, OLD.prev_id, OLD.parent_id, OLD.party_id, OLD.title, OLD.issued_on, OLD.valid_until, OLD.due_on,
      OLD.revenue_role, OLD.supply, OLD.vat, OLD.total, OLD.memo, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_DOC_FIXED: 문서 내용은 고칠 수 없습니다(새 판으로).';
  END IF;
  IF OLD.state = 'CANCELED' AND NEW.state <> 'CANCELED' THEN RAISE EXCEPTION 'ACCT_DOC_STATE: 취소한 문서는 되돌리지 않습니다.'; END IF;
  IF OLD.state = 'ACCEPTED' AND NEW.state NOT IN ('ACCEPTED', 'CANCELED') THEN RAISE EXCEPTION 'ACCT_DOC_STATE: 확정한 문서는 앞 상태로 되돌리지 않습니다.'; END IF;
  IF OLD.state = 'SENT' AND NEW.state = 'DRAFT' THEN RAISE EXCEPTION 'ACCT_DOC_STATE: 보낸 문서는 초안으로 되돌리지 않습니다.'; END IF;
  IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN RAISE EXCEPTION 'ACCT_DOC_FIXED: 새 판 연결은 바꾸지 않습니다.'; END IF;
  IF OLD.tax_invoice_id IS NOT NULL AND NEW.tax_invoice_id IS DISTINCT FROM OLD.tax_invoice_id
     AND NOT EXISTS (SELECT 1 FROM public.acct_tax_invoices t WHERE t.id = OLD.tax_invoice_id AND t.state = 'CANCELED') THEN   -- 취소한 요청은 새 요청으로 바꿀 수 있음
    RAISE EXCEPTION 'ACCT_DOC_FIXED: 세금계산서 연결은 바꾸지 않습니다.'; END IF;
  IF NEW.state = 'CANCELED' AND OLD.state = 'ACCEPTED' AND OLD.tax_invoice_no IS NOT NULL THEN
    RAISE EXCEPTION 'ACCT_DOC_STATE: 세금계산서를 발행한 거래명세서는 취소할 수 없습니다(수정 세금계산서 먼저).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_sales_doc_guard' AND tgrelid = 'public.acct_sales_docs'::regclass) THEN
    CREATE TRIGGER trg_acct_sales_doc_guard BEFORE UPDATE OR DELETE ON public.acct_sales_docs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_sales_doc_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_sales_doc_lines_ro' AND tgrelid = 'public.acct_sales_doc_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_sales_doc_lines_ro BEFORE UPDATE OR DELETE ON public.acct_sales_doc_lines FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 세금계산서 요청 종류에 거래명세서(SALES_DOC) — 발행되면 문서에 번호를 적음 */
ALTER TABLE public.acct_tax_invoices DROP CONSTRAINT IF EXISTS acct_tax_invoices_kind_check;
ALTER TABLE public.acct_tax_invoices ADD CONSTRAINT acct_tax_invoices_kind_check CHECK (kind IN ('AD', 'COMMISSION', 'SALES_DOC'));
ALTER TABLE public.etax_send_log DROP CONSTRAINT IF EXISTS etax_send_log_invoice_kind_check;
ALTER TABLE public.etax_send_log ADD CONSTRAINT etax_send_log_invoice_kind_check CHECK (invoice_kind IN ('DIRECTORY', 'LEAD_CASH', 'AD', 'COMMISSION', 'SALES_DOC'));
CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_issued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'ISSUED' AND OLD.state IS DISTINCT FROM 'ISSUED' THEN
    IF NEW.kind = 'AD' THEN
      UPDATE ad_invoices SET tax_invoice_no = NEW.invoice_no WHERE id = NEW.source_id AND coalesce(btrim(tax_invoice_no), '') = '';
    ELSIF NEW.kind = 'COMMISSION' THEN
      UPDATE hlt_settlements SET invoice_state = 'ISSUED', invoice_no = NEW.invoice_no, invoice_issued_at = now()
       WHERE id = NEW.source_id AND invoice_state <> 'ISSUED';
    ELSIF NEW.kind = 'SALES_DOC' THEN   -- v10.433 (D256)
      UPDATE acct_sales_docs SET tax_invoice_no = NEW.invoice_no WHERE id = NEW.source_id AND tax_invoice_no IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;

/* ── v10.434 (docs/571) 부서 · 프로젝트별 손익 ───────────────────────────
 *   전표 줄(acct_lines)은 쌓기만이라 칸을 더해 고칠 수 없음 → 꼬리표는 전표(acct_entries) 단위로 따로 둠:
 *   ① 전표 꼬리표 acct_entry_tags(사람이 정함 · 바꾼 기록) ② 근거 꼬리표 acct_source_tags(전표 만들기 전 매입 · 경비 · 수동 전표에 미리)
 *   ③ 돈 흐름 기본 부서 acct_rule_dept · 셀 때 ① > ② > ③ 차례(v_acct_line_tags).
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_depts (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  active     boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.acct_projects (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,30}$'),
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  dept_id    bigint REFERENCES public.acct_depts(id),
  starts_on  date,
  ends_on    date,
  closed     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aproj_period CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
COMMENT ON TABLE public.acct_depts IS 'v10.434 (D256) 부서(관 · 사업부) — 지우지 않음(쓰지 않음 표시)';
COMMENT ON TABLE public.acct_projects IS 'v10.434 (D256) 프로젝트 — 기간 · 끝남 · 부서(선택)';
INSERT INTO public.acct_depts (code, name, sort) VALUES ('HQ', '본사 공통', 0) ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_rule_dept (
  source     text PRIMARY KEY CHECK (source ~ '^[A-Z][A-Z_]{1,39}$'),
  dept_id    bigint NOT NULL REFERENCES public.acct_depts(id),
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.acct_source_tags (
  source     text NOT NULL CHECK (source ~ '^[A-Z][A-Z_]{1,39}$'),
  source_key text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 120),
  dept_id    bigint REFERENCES public.acct_depts(id),
  project_id bigint REFERENCES public.acct_projects(id),
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_key),
  CONSTRAINT ck_ast_any CHECK (dept_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.acct_entry_tags (
  entry_id   bigint PRIMARY KEY REFERENCES public.acct_entries(id),
  dept_id    bigint REFERENCES public.acct_depts(id),
  project_id bigint REFERENCES public.acct_projects(id),
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aet_any CHECK (dept_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.acct_tag_changes (
  id         bigserial PRIMARY KEY,
  target     text NOT NULL CHECK (target IN ('ENTRY', 'SOURCE', 'RULE')),
  target_key text NOT NULL,
  before     jsonb,
  after      jsonb,
  reason     text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id   uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_tag_changes IS 'v10.434 (D256) 부서 · 프로젝트 꼬리표 바꾼 기록 — 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tag_changes_ro' AND tgrelid = 'public.acct_tag_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_tag_changes_ro BEFORE UPDATE OR DELETE ON public.acct_tag_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_acct_line_tags AS
SELECT l.id AS line_id, l.entry_id, l.role, l.debit, l.credit, e.ym, e.entry_date, e.source,
       coalesce(t.dept_id, s.dept_id, r.dept_id) AS dept_id,
       coalesce(t.project_id, s.project_id) AS project_id
  FROM public.acct_lines l
  JOIN public.acct_entries e ON e.id = l.entry_id
  LEFT JOIN public.acct_entry_tags t ON t.entry_id = e.id
  LEFT JOIN public.acct_source_tags s ON s.source = e.source AND s.source_key = e.source_key
  LEFT JOIN public.acct_rule_dept r ON r.source = e.source;
COMMENT ON VIEW public.v_acct_line_tags IS 'v10.434 (D256) 전표 줄 + 부서 · 프로젝트(전표 꼬리표 > 근거 꼬리표 > 돈 흐름 기본 부서)';

/* ── v10.435 (docs/572) 창고 여러 곳 · 재고 이동 · 바코드 ─────────────────
 *   이동평균 원가는 회사 전체(옵션마다) 그대로 · 창고는 수량만 나눔.
 *   수불부(acct_stock_moves)는 쌓기만이라 옛 줄을 고칠 수 없음 → warehouse_id 비어 있으면 「본 창고」로 셈.
 *   창고 간 이동은 acct_stock_transfers(쌓기만 · 원가 전표 없음 · 회사 전체 수량 · 금액 그대로).
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_warehouses (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  address    text CHECK (address IS NULL OR char_length(address) <= 200),
  is_main    boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_awh_main ON public.acct_warehouses (is_main) WHERE is_main;
INSERT INTO public.acct_warehouses (code, name, is_main)
SELECT 'MAIN', '본 창고', true WHERE NOT EXISTS (SELECT 1 FROM public.acct_warehouses WHERE is_main);
COMMENT ON TABLE public.acct_warehouses IS 'v10.435 (D256) 창고 — 본 창고 하나는 늘 있음(수불부 창고 빈 줄 = 본 창고)';

ALTER TABLE public.acct_stock_moves ADD COLUMN IF NOT EXISTS warehouse_id bigint REFERENCES public.acct_warehouses(id);
COMMENT ON COLUMN public.acct_stock_moves.warehouse_id IS 'v10.435 — 창고(비면 본 창고) · 이동평균은 회사 전체';

CREATE TABLE IF NOT EXISTS public.acct_stock_transfers (
  id         bigserial PRIMARY KEY,
  option_id  uuid NOT NULL REFERENCES public.hlt_product_options(id),
  from_wh    bigint NOT NULL REFERENCES public.acct_warehouses(id),
  to_wh      bigint NOT NULL REFERENCES public.acct_warehouses(id),
  qty        integer NOT NULL CHECK (qty > 0),
  moved_on   date NOT NULL,
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ast_wh CHECK (from_wh <> to_wh)
);
CREATE INDEX IF NOT EXISTS ix_ast_option ON public.acct_stock_transfers (option_id, id);
COMMENT ON TABLE public.acct_stock_transfers IS 'v10.435 (D256) 창고 간 이동(MOVE_OUT 보낸 창고 · MOVE_IN 받은 창고를 한 줄로) — 쌓기만 · 원가 전표 없음';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_stock_transfers_ro' AND tgrelid = 'public.acct_stock_transfers'::regclass) THEN
    CREATE TRIGGER trg_acct_stock_transfers_ro BEFORE UPDATE OR DELETE ON public.acct_stock_transfers FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 창고 × 옵션 수량 — 수불부(창고 비면 본 창고) + 이동 */
CREATE OR REPLACE VIEW public.v_acct_wh_stock AS
WITH main AS (SELECT id FROM public.acct_warehouses WHERE is_main LIMIT 1),
q AS (
  SELECT m.option_id, coalesce(m.warehouse_id, (SELECT id FROM main)) AS wh_id, m.qty FROM public.acct_stock_moves m
  UNION ALL SELECT t.option_id, t.from_wh, -t.qty FROM public.acct_stock_transfers t
  UNION ALL SELECT t.option_id, t.to_wh, t.qty FROM public.acct_stock_transfers t
)
SELECT option_id, wh_id, sum(qty)::int AS qty FROM q GROUP BY option_id, wh_id;
COMMENT ON VIEW public.v_acct_wh_stock IS 'v10.435 (D256) 창고별 수량(수불부 + 창고 간 이동) — 원가 장부 기준 · 판매 출고(창고 비면 본 창고)';

CREATE TABLE IF NOT EXISTS public.acct_barcodes (
  option_id  uuid PRIMARY KEY REFERENCES public.hlt_product_options(id),
  code       text NOT NULL UNIQUE CHECK (code ~ '^[0-9A-Z-]{4,32}$'),
  created_by uuid REFERENCES public.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_barcodes IS 'v10.435 (D256) 직판 옵션 바코드(Code128 · 글자 그대로) — 한 번 정하면 바꾸지 않음';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_barcodes_ro' AND tgrelid = 'public.acct_barcodes'::regclass) THEN
    CREATE TRIGGER trg_acct_barcodes_ro BEFORE UPDATE OR DELETE ON public.acct_barcodes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── v10.436 (docs/573) 미수금 독촉 · 입금 예정 ──────────────────────────
 *   거래처별 받을 돈(⑭ 기간 분석) · 단계(1 안내 · 2 독촉 · 3 최종) · 단계별 메일 문안 · 보내기(처음 꺼짐 · 기존 메일 길) · 보낸 기록(쌓기만)
 *   입금 예정 → ⑫ 자금 흐름 예정(acct_cash_plans IN) · 연체 이자는 셈하지 않음.
 * ------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS public.acct_dunning_templates (
  stage      integer PRIMARY KEY CHECK (stage BETWEEN 1 AND 3),
  days       integer NOT NULL CHECK (days BETWEEN 1 AND 365),
  subject    text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 2 AND 120),
  body       text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 3000),
  updated_by uuid REFERENCES public.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_dunning_templates IS 'v10.436 (D256) 독촉 단계 문안 — 가장 오래된 받을 돈이 days 일 넘으면 그 단계 · 글자 {party} {amount} {oldest} {days} {company} {phone}';
INSERT INTO public.acct_dunning_templates (stage, days, subject, body) VALUES
  (1, 30, '[{company}] 대금 결제 안내', E'{party} 담당자님께\n\n{oldest} 부터 남아 있는 대금 {amount}원이 아직 확인되지 않았습니다.\n이미 보내셨다면 이 메일은 무시해 주십시오.\n\n문의: {phone}\n{company}'),
  (2, 60, '[{company}] 미결제 대금 독촉', E'{party} 담당자님께\n\n{oldest} 부터 {days}일이 지난 대금 {amount}원이 남아 있습니다.\n결제 예정일을 회신해 주시면 감사하겠습니다.\n\n문의: {phone}\n{company}'),
  (3, 90, '[{company}] 미결제 대금 최종 안내', E'{party} 담당자님께\n\n{oldest} 부터 {days}일이 지난 대금 {amount}원이 남아 있어 마지막으로 안내드립니다.\n회신이 없으면 거래 조건을 다시 협의해야 할 수 있습니다.\n\n문의: {phone}\n{company}')
ON CONFLICT (stage) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_dunning_sends (
  id          bigserial PRIMARY KEY,
  party_id    bigint REFERENCES public.acct_parties(id),
  party_name  text NOT NULL,
  stage       integer NOT NULL CHECK (stage BETWEEN 1 AND 3),
  oldest      date,
  amount      bigint NOT NULL CHECK (amount >= 0),
  to_masked   text,
  result      text NOT NULL CHECK (result IN ('SENT', 'FAILED', 'NO_EMAIL', 'NOT_READY', 'PREVIEW')),
  error       text,
  by_job      boolean NOT NULL DEFAULT false,
  sent_by     uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ads_party ON public.acct_dunning_sends (party_name, stage, oldest);
COMMENT ON TABLE public.acct_dunning_sends IS 'v10.436 (D256) 독촉 보낸 기록 — 쌓기만 · 받는 주소는 가린 값만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_dunning_sends_ro' AND tgrelid = 'public.acct_dunning_sends'::regclass) THEN
    CREATE TRIGGER trg_acct_dunning_sends_ro BEFORE UPDATE OR DELETE ON public.acct_dunning_sends FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_receipt_promises (
  id            bigserial PRIMARY KEY,
  party_id      bigint REFERENCES public.acct_parties(id),
  party_name    text NOT NULL CHECK (char_length(btrim(party_name)) BETWEEN 1 AND 120),
  amount        bigint NOT NULL CHECK (amount > 0),
  due_on        date NOT NULL,
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  cash_plan_id  bigint REFERENCES public.acct_cash_plans(id),
  state         text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'KEPT', 'BROKEN', 'CANCELED')),
  closed_note   text CHECK (closed_note IS NULL OR char_length(closed_note) <= 200),
  created_by    uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
COMMENT ON TABLE public.acct_receipt_promises IS 'v10.436 (D256) 입금 예정(거래처가 약속한 날) — 자금 흐름 예정(IN)과 연결 · 지키면 KEPT · 어기면 BROKEN';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.dunning', 'off', 'ADMIN', '미수금 독촉 메일 자동 보내기(v10.436 · D256) — 처음 off · on 이면 매일 09:35 단계가 올라간 거래처에 한 번(메일 준비가 된 때만)', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_dunning', 1440, 9, 35, NULL, true, '미수금 독촉(acct.dunning on 일 때만 메일) · 입금 예정 지난 것 BROKEN 표시 · D256 · v10.436')
ON CONFLICT (job) DO NOTHING;


/* INV-11 미아 참조 검사를 낱말 경계로 — acct_tax_invoices(있는 표)를 옛 tax_invoices(없는 표)로 잘못 잡지 않게.
   public.tax_invoices · 줄 맨 앞 · 공백 뒤 등 진짜 참조는 그대로 잡음. 열 이름 · 순서 같음(CREATE OR REPLACE). */
CREATE OR REPLACE VIEW public.v_dangling_refs AS
 SELECT p.proname AS routine,
    t.tbl AS missing_table
   FROM (pg_proc p
     CROSS JOIN ( VALUES ('bank_accounts'::text), ('payment_transactions'::text), ('tax_invoices'::text), ('deal_payment_records'::text), ('settlement_batches'::text), ('ledger_entries'::text)) t(tbl))
  WHERE ((p.pronamespace = ('public'::regnamespace)::oid) AND (p.prosrc ~ (('(^|[^a-z0-9_])'::text || t.tbl) || '([^a-z0-9_]|$)'::text)));

-- v10.428 ~ 431 (docs/565 ~ 568) — 무역 2 · 대시보드(㉑): 수출(영세율 · 외환차손익) · 국내 구매 발주 · 경영 대시보드 추세 · 지역 상위 5 · 거래처 휴폐업 조회(처음 꺼짐)
--   대표 11/19 20:35 「모두개발」. 다시 돌려도 같음.

/* ── v10.428 (docs/565) 무역 2단계 — 수출 · 국내 구매 발주 ─────────────────
 *   계정 3개(일반 계정과목 번호 · 일반 원칙 · draft = false): 수출 매출 REV_EXPORT 401(상품매출 · 영세율) · 외환차익 FX_GAIN 907 · 외환차손 FX_LOSS 952.
 *   acct_exports(수주 → 선적 → 수출신고 수리 → 대금 회수 · 앞으로만 · 선적 전에만 취소) · acct_export_lines(직판 옵션 또는 글자 품목 · 선적 뒤 못 고침)
 *   acct_pos(발주 → 입고 · 입고 전에만 취소) · acct_po_lines(입고 뒤 못 고침).
 * ------------------------------------------------------------------- */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('REV_EXPORT', '수출 매출(영세율)', 'REVENUE', '401', '상품매출', 165, '수출 선적 기준 매출 · 부가세 0%(영세율) — v10.428', false),
  ('FX_GAIN',    '외환차익',          'REVENUE', '907', '외환차익', 920, '외화 매출채권 회수 때 환율 차이(이익) — v10.428', false),
  ('FX_LOSS',    '외환차손',          'EXPENSE', '952', '외환차손', 960, '외화 매출채권 회수 때 환율 차이(손실) — v10.428', false)
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_exports (
  id           bigserial PRIMARY KEY,
  party_id     bigint REFERENCES public.acct_parties(id),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  currency     text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  incoterms    text CHECK (incoterms IS NULL OR incoterms ~ '^[A-Z]{3}$'),
  fx_rate      numeric(12,4) CHECK (fx_rate IS NULL OR fx_rate > 0),
  sale_krw     bigint CHECK (sale_krw IS NULL OR sale_krw >= 0),
  paid_krw     bigint CHECK (paid_krw IS NULL OR paid_krw > 0),
  bl_no        text CHECK (bl_no IS NULL OR char_length(bl_no) <= 40),
  decl_no      text CHECK (decl_no IS NULL OR char_length(decl_no) BETWEEN 5 AND 40),
  state        text NOT NULL DEFAULT 'ORDERED' CHECK (state IN ('ORDERED', 'SHIPPED', 'CLEARED', 'PAID', 'CANCELED')),
  ordered_on   date NOT NULL,
  shipped_on   date,
  cleared_on   date,
  paid_on      date,
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 200),
  cancel_note  text,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aex_shipped CHECK (state IN ('ORDERED', 'CANCELED') OR (shipped_on IS NOT NULL AND fx_rate IS NOT NULL AND sale_krw IS NOT NULL)),
  CONSTRAINT ck_aex_cleared CHECK (state NOT IN ('CLEARED') OR decl_no IS NOT NULL),
  CONSTRAINT ck_aex_paid    CHECK (state <> 'PAID' OR (paid_on IS NOT NULL AND paid_krw IS NOT NULL)),
  CONSTRAINT ck_aex_cancel  CHECK (state <> 'CANCELED' OR char_length(btrim(coalesce(cancel_note, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_acct_exports_state ON public.acct_exports (state, ordered_on DESC);
COMMENT ON TABLE public.acct_exports IS 'v10.428 (D254) 수출 건 — 수주 → 선적(매출 · 선적일 환율 · 재고 출고) → 수출신고 수리(영세율 근거 번호) → 대금 회수(환율 차이) · 앞으로만';

CREATE TABLE IF NOT EXISTS public.acct_export_lines (
  id              bigserial PRIMARY KEY,
  export_id       bigint NOT NULL REFERENCES public.acct_exports(id),
  option_id       uuid REFERENCES public.hlt_product_options(id),
  item            text CHECK (item IS NULL OR char_length(btrim(item)) BETWEEN 2 AND 100),
  qty             integer NOT NULL CHECK (qty > 0 AND qty <= 1000000),
  foreign_amount  numeric(14,2) NOT NULL CHECK (foreign_amount >= 0),
  CONSTRAINT ck_ael_what CHECK (option_id IS NOT NULL OR item IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ael_option ON public.acct_export_lines (export_id, option_id) WHERE option_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_acct_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rk int; ok int;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_EXPORT: 수출 건은 지우지 않습니다(취소만).'; END IF;
  IF OLD.state IN ('PAID', 'CANCELED') THEN RAISE EXCEPTION 'ACCT_EXPORT: 대금 회수 · 취소한 수출 건은 고치지 않습니다.'; END IF;
  IF (NEW.ordered_on, NEW.created_at, NEW.currency) IS DISTINCT FROM (OLD.ordered_on, OLD.created_at, OLD.currency) THEN
    RAISE EXCEPTION 'ACCT_EXPORT: 수주일 · 통화는 고치지 않습니다.';
  END IF;
  IF NEW.state = 'CANCELED' AND OLD.state <> 'ORDERED' THEN
    RAISE EXCEPTION 'ACCT_EXPORT_STATE: 선적한 수출 건은 취소하지 않습니다.';
  END IF;
  IF OLD.state <> 'ORDERED' AND (NEW.fx_rate, NEW.sale_krw, NEW.shipped_on) IS DISTINCT FROM (OLD.fx_rate, OLD.sale_krw, OLD.shipped_on) THEN
    RAISE EXCEPTION 'ACCT_EXPORT: 선적 뒤에는 환율 · 매출 금액 · 선적일을 고치지 않습니다.';
  END IF;
  IF NEW.state <> OLD.state AND NEW.state <> 'CANCELED' THEN
    rk := array_position(ARRAY['ORDERED', 'SHIPPED', 'CLEARED', 'PAID'], OLD.state);
    ok := array_position(ARRAY['ORDERED', 'SHIPPED', 'CLEARED', 'PAID'], NEW.state);
    IF ok IS NULL OR ok <= rk THEN RAISE EXCEPTION 'ACCT_EXPORT_STATE: 수출 건 상태는 앞으로만 바뀝니다.'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_export_guard' AND tgrelid = 'public.acct_exports'::regclass) THEN
    CREATE TRIGGER trg_acct_export_guard BEFORE UPDATE OR DELETE ON public.acct_exports FOR EACH ROW EXECUTE FUNCTION public.fn_acct_export_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_export_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_exports WHERE id = coalesce(NEW.export_id, OLD.export_id);
  IF st IS DISTINCT FROM 'ORDERED' THEN
    RAISE EXCEPTION 'ACCT_EXPORT: 선적한 수출 건의 품목은 고치지 않습니다.';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_export_line_guard' AND tgrelid = 'public.acct_export_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_export_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_export_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_export_line_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_pos (
  id              bigserial PRIMARY KEY,
  party_id        bigint NOT NULL REFERENCES public.acct_parties(id),
  title           text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 100),
  state           text NOT NULL DEFAULT 'ORDERED' CHECK (state IN ('ORDERED', 'RECEIVED', 'CANCELED')),
  ordered_on      date NOT NULL,
  received_on     date,
  purchase_id     bigint REFERENCES public.acct_purchases(id),
  requisition_id  bigint REFERENCES public.acct_requisitions(id),
  memo            text CHECK (memo IS NULL OR char_length(memo) <= 200),
  cancel_note     text,
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_apo_received CHECK (state <> 'RECEIVED' OR (received_on IS NOT NULL AND purchase_id IS NOT NULL)),
  CONSTRAINT ck_apo_cancel   CHECK (state <> 'CANCELED' OR char_length(btrim(coalesce(cancel_note, ''))) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_acct_pos_state ON public.acct_pos (state, ordered_on DESC);
COMMENT ON TABLE public.acct_pos IS 'v10.428 (D254) 국내 구매 발주 — 발주 → 입고(⑫ 매입 한 건 자동 · 직판 옵션 품목 재고 IN · purchase_id) · 입고 전에만 취소';

CREATE TABLE IF NOT EXISTS public.acct_po_lines (
  id          bigserial PRIMARY KEY,
  po_id       bigint NOT NULL REFERENCES public.acct_pos(id),
  option_id   uuid REFERENCES public.hlt_product_options(id),
  item        text CHECK (item IS NULL OR char_length(btrim(item)) BETWEEN 2 AND 100),
  qty         integer NOT NULL CHECK (qty > 0 AND qty <= 1000000),
  unit_price  bigint NOT NULL CHECK (unit_price >= 0 AND unit_price <= 10000000000),
  CONSTRAINT ck_apl_what CHECK (option_id IS NOT NULL OR item IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public.fn_acct_po_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PO: 발주는 지우지 않습니다(취소만).'; END IF;
  IF OLD.state <> 'ORDERED' THEN RAISE EXCEPTION 'ACCT_PO: 입고 · 취소한 발주는 고치지 않습니다.'; END IF;
  IF (NEW.party_id, NEW.ordered_on, NEW.created_at) IS DISTINCT FROM (OLD.party_id, OLD.ordered_on, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_PO: 거래처 · 발주일은 고치지 않습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_po_guard' AND tgrelid = 'public.acct_pos'::regclass) THEN
    CREATE TRIGGER trg_acct_po_guard BEFORE UPDATE OR DELETE ON public.acct_pos FOR EACH ROW EXECUTE FUNCTION public.fn_acct_po_guard();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.fn_acct_po_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_pos WHERE id = coalesce(NEW.po_id, OLD.po_id);
  IF st IS DISTINCT FROM 'ORDERED' THEN
    RAISE EXCEPTION 'ACCT_PO: 입고 · 취소한 발주의 품목은 고치지 않습니다.';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_po_line_guard' AND tgrelid = 'public.acct_po_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_po_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_po_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_po_line_guard();
  END IF;
END $$;

/* ── v10.431 (docs/568) 거래처 휴폐업 조회 ────────────────────────────── */
ALTER TABLE public.acct_parties ADD COLUMN IF NOT EXISTS biz_status text;
ALTER TABLE public.acct_parties ADD COLUMN IF NOT EXISTS biz_checked_at timestamptz;
ALTER TABLE public.acct_parties ADD COLUMN IF NOT EXISTS biz_detail text;
ALTER TABLE public.acct_parties ADD COLUMN IF NOT EXISTS biz_stub boolean;
ALTER TABLE public.acct_parties DROP CONSTRAINT IF EXISTS ck_acct_parties_biz_status;
ALTER TABLE public.acct_parties ADD CONSTRAINT ck_acct_parties_biz_status
  CHECK ((biz_status IS NULL OR biz_status IN ('VALID', 'SUSPENDED', 'CLOSED', 'UNKNOWN')) AND (biz_detail IS NULL OR char_length(biz_detail) <= 200));
COMMENT ON COLUMN public.acct_parties.biz_status IS 'v10.431 국세청 사업자 상태(VALID 계속 · SUSPENDED 휴업 · CLOSED 폐업 · UNKNOWN) · biz_stub = 간주(키 없음) 결과';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('acct.biz_status_check', 'off', 'ADMIN',
        '거래처 휴폐업 조회(국세청 · 공공데이터포털 키 NTS_SERVICE_KEY) — on 이면 거래처 화면 「조회」 · 매일 06:10 30일 지난 거래처 50곳 다시 조회 · 휴업 · 폐업이면 운영 알림(v10.431 · D254 · 처음 off)',
        false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_biz_check', 1440, 6, 10, NULL, true, '거래처 휴폐업 다시 조회(acct.biz_status_check on 일 때만 · 30일 지난 50곳 · 휴업 · 폐업 ACCT_PARTY_CLOSED) · D254 · v10.431')
ON CONFLICT (job) DO NOTHING;


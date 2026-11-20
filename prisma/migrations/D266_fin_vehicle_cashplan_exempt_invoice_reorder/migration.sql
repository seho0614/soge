/* D266 (v10.475 ~ 478 · docs/613 ~ 616) ㊱ 사무 · 자금 — 업무용 차량 운행기록부 · 12개월 자금 계획 · 전자계산서(면세 · off · 간주) · 안전 재고 · 재주문(발주 초안) */

/* D266 (v10.475 ~ 478 · docs/613 ~ 616) ㊱ 사무 · 자금 — 업무용 차량 운행기록부 · 12개월 자금 계획(표 없음 · 원래 자료에서 셈) · 전자계산서(면세 · 세금계산서 구조 재사용 · 처음 off · 간주) · 안전 재고 · 재주문(발주 초안)
 *   마이그레이션 #304 · prisma/migrations/D266_fin_vehicle_cashplan_exempt_invoice_reorder/migration.sql(한 파일)
 *   다시 돌려도 같음 · 지우는 문장은 CHECK 를 넓히는 줄뿐(DROP CONSTRAINT IF EXISTS → 바로 다시 ADD) · 외부 연동 수 그대로 15(ETAX 재사용 · 연동 줄 더하지 않음) */

/* ── ① 업무용 차량 운행기록부 (v10.475 · docs/613) ─────────────────────────────────────
 *   차량(번호 · 이름 · 구분 · 소유 방식 · 업무전용 자동차보험 · 처분일) · 운행(날짜 · 운전자 · 부서 · 목적 출퇴근 / 업무 / 비업무 · 출발 · 도착 · 계기판 전 · 후 → 거리)
 *   비용(주유 · 정비 · 보험 · 세금 · 리스 · 감가상각(상당액) · 통행료 · 기타 · ⑫ 매입 번호를 걸 수 있음 — 같은 매입은 한 번)
 *   해마다 업무 사용 비율 = (출퇴근 + 업무) 거리 ÷ 전체 거리 · 운행기록부가 없으면 비용 한도(acct.vehicle_nolog_limit) ÷ 비용
 *   감가상각비 연 한도(acct.vehicle_dep_limit · 넘은 몫은 이월) · 보유 달 수로 나눔(월할) — 값은 일반 원칙(법인세법 시행령 50조의2) · SUPER 고침 · 세무사 확인
 *   전표는 만들지 않음(비용 전표는 ⑫ 매입 · 경비 청구가 이미 잡음 — 이 대장은 손금 인정 셈 · 운행기록부 서식만) · 지우지 않음(취소 · 사유) */
CREATE TABLE IF NOT EXISTS public.acct_vehicles (
  id               bigserial PRIMARY KEY,
  plate            text NOT NULL UNIQUE CHECK (plate ~ '^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$'),
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  car_class        text NOT NULL DEFAULT 'PASSENGER' CHECK (car_class IN ('PASSENGER', 'EXCLUDED')),
  ownership        text NOT NULL DEFAULT 'OWNED' CHECK (ownership IN ('OWNED', 'LEASE', 'RENT')),
  acquired_on      date NOT NULL,
  disposed_on      date,
  acquire_cost     bigint NOT NULL DEFAULT 0 CHECK (acquire_cost BETWEEN 0 AND 10000000000),
  biz_insurance    boolean NOT NULL DEFAULT false,
  insurance_until  date,
  active           boolean NOT NULL DEFAULT true,
  memo             text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by       uuid REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_acct_vehicle_dispose CHECK (disposed_on IS NULL OR disposed_on >= acquired_on)
);
COMMENT ON TABLE public.acct_vehicles IS 'v10.475 (D266) 업무용 차량 — 번호(바꾸지 않음) · 구분(PASSENGER 업무용승용차 규정 대상 · EXCLUDED 경차 · 9인승 이상 · 화물 등) · 소유(자가 · 리스 · 렌트) · 업무전용 자동차보험 · 처분일 · 지우지 않음(끔)';

CREATE TABLE IF NOT EXISTS public.acct_vehicle_trips (
  id           bigserial PRIMARY KEY,
  vehicle_id   bigint NOT NULL REFERENCES public.acct_vehicles(id),
  trip_on      date NOT NULL,
  driver       text NOT NULL CHECK (char_length(btrim(driver)) BETWEEN 1 AND 40),
  dept         text CHECK (dept IS NULL OR char_length(dept) <= 40),
  purpose      text NOT NULL CHECK (purpose IN ('COMMUTE', 'BUSINESS', 'PERSONAL')),
  from_place   text CHECK (from_place IS NULL OR char_length(from_place) <= 60),
  to_place     text CHECK (to_place IS NULL OR char_length(to_place) <= 60),
  odo_start    integer NOT NULL CHECK (odo_start BETWEEN 0 AND 9999999),
  odo_end      integer NOT NULL CHECK (odo_end BETWEEN 0 AND 9999999),
  distance     integer GENERATED ALWAYS AS (odo_end - odo_start) STORED,
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 200),
  state        text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CANCELED')),
  cancel_note  text,
  canceled_at  timestamptz,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_acct_vtrip_odo CHECK (odo_end > odo_start AND odo_end - odo_start <= 3000),
  CONSTRAINT ck_acct_vtrip_cancel CHECK ((state = 'ACTIVE' AND canceled_at IS NULL) OR (state = 'CANCELED' AND canceled_at IS NOT NULL AND char_length(btrim(coalesce(cancel_note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_acct_vtrips_vehicle ON public.acct_vehicle_trips (vehicle_id, trip_on, id);
COMMENT ON TABLE public.acct_vehicle_trips IS 'v10.475 (D266) 차량 운행 — 날짜 · 운전자 · 부서 · 목적(출퇴근 · 업무 = 업무 사용 · 비업무) · 출발 · 도착 · 계기판 전 · 후 · 거리(계산 칸) · 고치지 않음(취소 · 사유) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.acct_vehicle_costs (
  id           bigserial PRIMARY KEY,
  vehicle_id   bigint NOT NULL REFERENCES public.acct_vehicles(id),
  cost_on      date NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('FUEL', 'REPAIR', 'INSURANCE', 'TAX', 'LEASE', 'DEPRECIATION', 'TOLL', 'OTHER')),
  amount       bigint NOT NULL CHECK (amount BETWEEN 1 AND 10000000000),
  liters       numeric(8,2) CHECK (liters IS NULL OR (liters > 0 AND liters <= 10000)),
  purchase_id  bigint REFERENCES public.acct_purchases(id),
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 200),
  state        text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CANCELED')),
  cancel_note  text,
  canceled_at  timestamptz,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_acct_vcost_cancel CHECK ((state = 'ACTIVE' AND canceled_at IS NULL) OR (state = 'CANCELED' AND canceled_at IS NOT NULL AND char_length(btrim(coalesce(cancel_note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_acct_vcosts_vehicle ON public.acct_vehicle_costs (vehicle_id, cost_on, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_vcosts_purchase ON public.acct_vehicle_costs (purchase_id) WHERE purchase_id IS NOT NULL AND state = 'ACTIVE';
COMMENT ON TABLE public.acct_vehicle_costs IS 'v10.475 (D266) 차량 비용 — 주유 · 정비 · 보험 · 세금 · 리스 · 감가상각(상당액) · 통행료 · 기타 · ⑫ 매입 번호(같은 매입은 한 번) · 전표 없음(손금 인정 셈 자료) · 고치지 않음(취소 · 사유)';

CREATE OR REPLACE FUNCTION public.fn_acct_vehicle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_VEHICLE: 차량은 지우지 않습니다(끄거나 처분일을 넣으십시오).'; END IF;
  IF (NEW.plate, NEW.created_at, NEW.created_by) IS DISTINCT FROM (OLD.plate, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'ACCT_VEHICLE: 차량 번호는 바꾸지 않습니다(새 차량으로 넣으십시오).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* 운행 · 비용 줄 — 넣기만 · 바꾸기는 「취소」(ACTIVE → CANCELED · 사유)만 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_acct_vehicle_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_VEHICLE_LINE: 운행 · 비용 줄은 지우지 않습니다(취소로).'; END IF;
  IF NOT (OLD.state = 'ACTIVE' AND NEW.state = 'CANCELED') THEN
    RAISE EXCEPTION 'ACCT_VEHICLE_LINE: 운행 · 비용 줄은 고치지 않습니다(취소하고 새로 넣으십시오).';
  END IF;
  /* distance 는 계산 칸 — BEFORE 트리거의 NEW 에는 아직 값이 없어 빼고 비교(odo 두 칸이 같으면 거리도 같음) */
  IF (to_jsonb(NEW) - 'state' - 'cancel_note' - 'canceled_at' - 'distance') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'cancel_note' - 'canceled_at' - 'distance') THEN
    RAISE EXCEPTION 'ACCT_VEHICLE_LINE: 취소할 때는 상태 · 사유만 바꿉니다.';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_vehicle_guard' AND tgrelid = 'public.acct_vehicles'::regclass) THEN
    CREATE TRIGGER trg_acct_vehicle_guard BEFORE UPDATE OR DELETE ON public.acct_vehicles FOR EACH ROW EXECUTE FUNCTION public.fn_acct_vehicle_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_vehicle_trip_guard' AND tgrelid = 'public.acct_vehicle_trips'::regclass) THEN
    CREATE TRIGGER trg_acct_vehicle_trip_guard BEFORE UPDATE OR DELETE ON public.acct_vehicle_trips FOR EACH ROW EXECUTE FUNCTION public.fn_acct_vehicle_line_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_vehicle_cost_guard' AND tgrelid = 'public.acct_vehicle_costs'::regclass) THEN
    CREATE TRIGGER trg_acct_vehicle_cost_guard BEFORE UPDATE OR DELETE ON public.acct_vehicle_costs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_vehicle_line_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.vehicle_nolog_limit', '15000000', 'ADMIN', '업무용 차량(v10.475 · D266) — 운행기록부를 쓰지 않은 해의 차량 관련 비용 인정 한도(원 · 1대 · 12달 기준 · 보유 달 수로 나눔) · 일반 원칙(법인세법 시행령 50조의2) 1,500만 원 · 세무사 확인 · SUPER 고침', false, '^[0-9]{1,10}$', '15000000'),
  ('acct.vehicle_dep_limit', '8000000', 'ADMIN', '업무용 차량(v10.475) — 업무 사용 감가상각비(리스 · 렌트는 상당액) 연 한도(원 · 1대 · 보유 달 수로 나눔 · 넘은 몫은 다음 해로 이월) · 일반 원칙 800만 원 · 세무사 확인 · SUPER 고침', false, '^[0-9]{1,10}$', '8000000')
ON CONFLICT (key) DO NOTHING;


/* ── ② 12개월 자금 계획 (v10.476 · docs/614) — 표 없음 ───────────────────────────────────
 *   ⑫ 90일 자금 흐름(확정된 돈) + 그 뒤 달의 예정(acct_cash_plans · 계약 고정비 포함) + 급여(⑭ 급여 대장 · 직원 기본급 추정) +
 *   세금 기한(원천세 · 부가세 — 장부에서 셈) + 예상 매출(㉘ 매출 목표 또는 ㉝ 영업 기회 가중) 을 달마다 모아 셈 — 데이터를 따로 저장하지 않음
 *   달 말 예상 잔액이 acct.cash_floor 밑인 달이 있으면 운영 알림 ACCT_CASHPLAN_SHORT(처음 모자라는 달 하나 · 바뀌면 새로 · 넉넉해지면 풀림)
 *   acct.cashplan_sales           TARGET | CRM | NONE(처음 TARGET — 매출 목표 「회사 전체」)
 *   acct.cashplan_collect_months  매출이 돈으로 들어오기까지 달 수(0 ~ 3 · 처음 1)
 *   acct.cashplan_alert           on | off(처음 on · 회사 안 알림만) */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.cashplan_sales', 'TARGET', 'ADMIN', '12개월 자금 계획(v10.476 · D266) — 예상 매출 기준: TARGET 매출 목표(회사 전체) · CRM 영업 기회 가중(상담 10 · 견적 30 · 계약 70%) · NONE 넣지 않음', false, '^(TARGET|CRM|NONE)$', 'TARGET'),
  ('acct.cashplan_collect_months', '1', 'ADMIN', '12개월 자금 계획(v10.476) — 예상 매출이 통장에 들어오기까지 달 수(0 ~ 3 · 처음 1 = 다음 달)', false, '^[0-3]$', '1'),
  ('acct.cashplan_alert', 'on', 'ADMIN', '12개월 자금 계획 운영 알림(v10.476) — on 이면 매일 09:35 달 말 예상 잔액이 acct.cash_floor 밑인 첫 달을 ACCT_CASHPLAN_SHORT 로 · off 면 있던 알림 풂', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_cashplan', 1440, 9, 35, NULL, true, '12개월 자금 계획 — 매일 09:35 · 달 말 예상 잔액이 acct.cash_floor 밑인 첫 달 ACCT_CASHPLAN_SHORT(넉넉해지면 풀림) · D266 · v10.476')
ON CONFLICT (job) DO NOTHING;


/* ── ③ 전자계산서(면세) 발행 (v10.477 · docs/615) ───────────────────────────────────────
 *   세금계산서 표(acct_tax_invoices)에 종류 EXEMPT 를 더함 — 부가세 0 · 근거 = 확정한 거래명세서(acct_sales_docs)의 면세(EXEMPT) 품목 공급가 합
 *   발행은 ㉒ 전자세금계산서 어댑터 그대로(EtaxService · assume.etax on 이면 간주 · 승인번호 없음) — 외부 연동 줄을 더하지 않음
 *   acct.exempt_invoice on | off(처음 off) — off 면 요청 · 발행을 받지 않고, 거래명세서 세금계산서는 전과 같이(면세 품목도 한 장) */
ALTER TABLE public.acct_tax_invoices DROP CONSTRAINT IF EXISTS acct_tax_invoices_kind_check;
ALTER TABLE public.acct_tax_invoices ADD CONSTRAINT acct_tax_invoices_kind_check CHECK (kind IN ('AD', 'COMMISSION', 'SALES_DOC', 'EXEMPT'));
ALTER TABLE public.acct_tax_invoices DROP CONSTRAINT IF EXISTS ck_ati_exempt_vat;
ALTER TABLE public.acct_tax_invoices ADD CONSTRAINT ck_ati_exempt_vat CHECK (kind <> 'EXEMPT' OR vat = 0);
ALTER TABLE public.etax_send_log DROP CONSTRAINT IF EXISTS etax_send_log_invoice_kind_check;
ALTER TABLE public.etax_send_log ADD CONSTRAINT etax_send_log_invoice_kind_check CHECK (invoice_kind IN ('DIRECTORY', 'LEAD_CASH', 'AD', 'COMMISSION', 'SALES_DOC', 'EXEMPT'));

ALTER TABLE public.acct_sales_docs ADD COLUMN IF NOT EXISTS exempt_invoice_id uuid;
ALTER TABLE public.acct_sales_docs ADD COLUMN IF NOT EXISTS exempt_invoice_no text;
COMMENT ON COLUMN public.acct_sales_docs.exempt_invoice_id IS 'v10.477 (D266) 면세 품목 전자계산서 요청(acct_tax_invoices kind EXEMPT) — 취소한 요청만 새 요청으로 바꿈';
COMMENT ON COLUMN public.acct_sales_docs.exempt_invoice_no IS 'v10.477 (D266) 전자계산서 발행 번호(간주면 「간주-문서번호」) — 발행되면 트리거가 적음 · 있으면 거래명세서 취소 못 함';

/* 전자계산서 요청 넣을 때 — 확정한 거래명세서 · 마지막 판 · 공급가 = 그 문서 면세 품목 공급가 합(서버와 같은 셈) */
CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_exempt_chk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record; v_exempt bigint;
BEGIN
  IF NEW.kind <> 'EXEMPT' THEN RETURN NEW; END IF;
  SELECT kind, state, superseded_by INTO d FROM public.acct_sales_docs WHERE id = NEW.source_id;
  IF d.kind IS DISTINCT FROM 'STATEMENT' OR d.state IS DISTINCT FROM 'ACCEPTED' OR d.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'ACCT_EXEMPT_INVOICE: 확정한 거래명세서(마지막 판)만 전자계산서를 요청합니다.';
  END IF;
  SELECT coalesce(sum(supply), 0) INTO v_exempt FROM public.acct_sales_doc_lines WHERE doc_id = NEW.source_id AND tax_type = 'EXEMPT';
  IF v_exempt <= 0 OR NEW.supply <> v_exempt THEN
    RAISE EXCEPTION 'ACCT_EXEMPT_INVOICE: 전자계산서 공급가는 거래명세서 면세 품목 공급가 합과 같아야 합니다.';
  END IF;
  RETURN NEW;
END $$;

/* 발행되면 근거 표에 번호(D256 그대로 + EXEMPT) */
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
    ELSIF NEW.kind = 'EXEMPT' THEN      -- v10.477 (D266) 전자계산서(면세)
      UPDATE acct_sales_docs SET exempt_invoice_no = NEW.invoice_no WHERE id = NEW.source_id AND exempt_invoice_no IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;

/* 거래명세서 — 전자계산서 연결은 취소한 요청일 때만 바꿈 · 발행한 전자계산서가 있으면 거래명세서 취소 못 함 · 발행 번호는 한 번만 */
CREATE OR REPLACE FUNCTION public.fn_acct_sales_doc_exempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.exempt_invoice_id IS NOT NULL AND NEW.exempt_invoice_id IS DISTINCT FROM OLD.exempt_invoice_id
     AND NOT EXISTS (SELECT 1 FROM public.acct_tax_invoices t WHERE t.id = OLD.exempt_invoice_id AND t.state = 'CANCELED') THEN
    RAISE EXCEPTION 'ACCT_DOC_FIXED: 전자계산서 연결은 바꾸지 않습니다.';
  END IF;
  IF OLD.exempt_invoice_no IS NOT NULL AND NEW.exempt_invoice_no IS DISTINCT FROM OLD.exempt_invoice_no THEN
    RAISE EXCEPTION 'ACCT_DOC_FIXED: 전자계산서 발행 번호는 고치지 않습니다.';
  END IF;
  IF NEW.state = 'CANCELED' AND OLD.state = 'ACCEPTED' AND OLD.exempt_invoice_no IS NOT NULL THEN
    RAISE EXCEPTION 'ACCT_DOC_STATE: 전자계산서를 발행한 거래명세서는 취소할 수 없습니다(수정 전자계산서 먼저).';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_tax_invoice_exempt_chk' AND tgrelid = 'public.acct_tax_invoices'::regclass) THEN
    CREATE TRIGGER trg_acct_tax_invoice_exempt_chk BEFORE INSERT ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_invoice_exempt_chk();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_sales_doc_exempt_guard' AND tgrelid = 'public.acct_sales_docs'::regclass) THEN
    CREATE TRIGGER trg_acct_sales_doc_exempt_guard BEFORE UPDATE ON public.acct_sales_docs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_sales_doc_exempt_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.exempt_invoice', 'off', 'ADMIN', '전자계산서(면세) 발행(v10.477 · D266) — 처음 off · on 이면 확정한 거래명세서의 면세 품목을 전자계산서로 따로 요청 · 발행(㉒ 전자세금계산서 어댑터 · assume.etax on 이면 간주)하고 세금계산서는 과세 · 영세 품목만 · 켜기 SUPER · 세무사 확인', false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;


/* ── ④ 안전 재고 · 재주문 (v10.478 · docs/616) ───────────────────────────────────────────
 *   직판 상품 옵션마다 최소 재고 · 재주문 수량 · 매입처 · 단가(규칙) — 판매용 재고(hlt_product_options.stock) + 발주 중(㉑ acct_pos ORDERED) 이 최소 밑이면
 *   운영 알림 STOCK_REORDER(옵션마다 하나 · 올라가면 풀림) + 재주문 초안(매입처마다 열린 초안 하나 · 품목 줄) — 초안은 사람이 「발주로 넣기」를 눌러야 ㉑ 발주가 됨(자동 발주 · 보내기 없음)
 *   acct.reorder on | off(처음 on · 규칙이 없으면 아무것도 안 함 · 회사 안 알림 · 초안만) */
CREATE TABLE IF NOT EXISTS public.acct_stock_rules (
  option_id    uuid PRIMARY KEY REFERENCES public.hlt_product_options(id),
  min_qty      integer NOT NULL CHECK (min_qty BETWEEN 0 AND 1000000),
  reorder_qty  integer NOT NULL CHECK (reorder_qty BETWEEN 1 AND 1000000),
  party_id     bigint REFERENCES public.acct_parties(id),
  unit_price   bigint CHECK (unit_price IS NULL OR unit_price BETWEEN 0 AND 10000000000),
  active       boolean NOT NULL DEFAULT true,
  memo         text CHECK (memo IS NULL OR char_length(memo) <= 200),
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.accounts(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_stock_rules IS 'v10.478 (D266) 안전 재고 규칙 — 직판 옵션마다 최소 재고 · 재주문 수량 · 매입처 · 단가(비우면 재고 평균 단가) · 끔 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.acct_reorder_drafts (
  id              bigserial PRIMARY KEY,
  party_id        bigint REFERENCES public.acct_parties(id),
  state           text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'CONVERTED', 'DISMISSED')),
  po_id           bigint REFERENCES public.acct_pos(id),
  made_by_job     boolean NOT NULL DEFAULT true,
  dismiss_note    text,
  done_by         uuid REFERENCES public.accounts(id),
  done_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ard_converted CHECK (state <> 'CONVERTED' OR (po_id IS NOT NULL AND done_at IS NOT NULL)),
  CONSTRAINT ck_ard_dismissed CHECK (state <> 'DISMISSED' OR (done_at IS NOT NULL AND char_length(btrim(coalesce(dismiss_note, ''))) >= 2))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ard_open_party ON public.acct_reorder_drafts ((coalesce(party_id, 0))) WHERE state = 'DRAFT';
COMMENT ON TABLE public.acct_reorder_drafts IS 'v10.478 (D266) 재주문 초안 — 매입처마다 열린 초안 하나 · 사람이 「발주로 넣기」(㉑ acct_pos · po_id) 또는 「버림」(사유) · 자동 발주 없음 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.acct_reorder_draft_lines (
  id            bigserial PRIMARY KEY,
  draft_id      bigint NOT NULL REFERENCES public.acct_reorder_drafts(id),
  option_id     uuid NOT NULL REFERENCES public.hlt_product_options(id),
  qty           integer NOT NULL CHECK (qty BETWEEN 1 AND 1000000),
  unit_price    bigint NOT NULL CHECK (unit_price BETWEEN 0 AND 10000000000),
  position_qty  integer NOT NULL DEFAULT 0,
  min_qty       integer NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, option_id)
);
COMMENT ON TABLE public.acct_reorder_draft_lines IS 'v10.478 (D266) 재주문 초안 품목 — 옵션 · 수량 · 단가 · 그때 재고 위치(판매용 + 발주 중) · 최소 · 초안(DRAFT)에서만 넣고 고치고 뺌';

/* 규칙 — 직판 옵션만 · 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_acct_stock_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_STOCK_RULE: 안전 재고 규칙은 지우지 않습니다(끄십시오).'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hlt_product_options o JOIN public.hlt_products p ON p.id = o.product_id
                   JOIN public.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.id = NEW.option_id) THEN
    RAISE EXCEPTION 'ACCT_STOCK_RULE: 직판 상품 옵션에만 안전 재고를 둡니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

/* 초안 — 끝난 초안은 그대로 · 상태는 DRAFT → CONVERTED · DISMISSED 만 · 매입처는 DRAFT 에서만 */
CREATE OR REPLACE FUNCTION public.fn_acct_reorder_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_REORDER: 재주문 초안은 지우지 않습니다(버림으로).'; END IF;
  IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'ACCT_REORDER: 발주로 넣었거나 버린 초안은 고치지 않습니다.'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.made_by_job IS DISTINCT FROM OLD.made_by_job THEN
    RAISE EXCEPTION 'ACCT_REORDER: 초안을 만든 기록은 고치지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_acct_reorder_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_reorder_drafts WHERE id = coalesce(NEW.draft_id, OLD.draft_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCT_REORDER: 끝난 초안의 품목은 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.draft_id, NEW.option_id) IS DISTINCT FROM (OLD.draft_id, OLD.option_id) THEN
    RAISE EXCEPTION 'ACCT_REORDER: 초안 · 옵션은 바꾸지 않습니다(빼고 새로).';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_stock_rule_guard' AND tgrelid = 'public.acct_stock_rules'::regclass) THEN
    CREATE TRIGGER trg_acct_stock_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_stock_rules FOR EACH ROW EXECUTE FUNCTION public.fn_acct_stock_rule_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_reorder_draft_guard' AND tgrelid = 'public.acct_reorder_drafts'::regclass) THEN
    CREATE TRIGGER trg_acct_reorder_draft_guard BEFORE UPDATE OR DELETE ON public.acct_reorder_drafts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_reorder_draft_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_reorder_line_guard' AND tgrelid = 'public.acct_reorder_draft_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_reorder_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_reorder_draft_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_reorder_line_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('acct.reorder', 'on', 'ADMIN', '안전 재고 · 재주문(v10.478 · D266) — on 이면 매시간 판매용 재고 + 발주 중이 최소 밑인 직판 옵션을 운영 알림(STOCK_REORDER) · 재주문 초안(발주는 사람이 넣음) · 규칙이 없으면 아무것도 안 함', false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_reorder', 60, NULL, NULL, NULL, true, '안전 재고 · 재주문 — 매시간 · 판매용 재고 + 발주 중 < 최소면 STOCK_REORDER · 매입처별 재주문 초안(자동 발주 없음) · D266 · v10.478')
ON CONFLICT (job) DO NOTHING;


/* ── ⑤ ㉕ 권한(D258) 시드에 새 탭 4개 — gen_seed.py 와 같은 규칙
 *   acct-vehicle(SUPER · PAYOUT · ADMIN) · acct-cashplan(SUPER · PAYOUT) · acct-exemptinv(SUPER · PAYOUT) · acct-reorder(SUPER · PAYOUT · ADMIN)
 *   세무사(ACCOUNTANT)는 acct- 탭 중 지급 담당이 보는 것 = 4개 모두 보기 · 내려받기
 *   주소 규칙: GET = VIEW · /run 끝 · /send = APPROVE · 그 밖 변경 = EDIT */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('acct-vehicle', '업무용 차량', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2700),
  ('acct-cashplan', '자금 계획 12개월', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2710),
  ('acct-exemptinv', '전자계산서(면세)', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2720),
  ('acct-reorder', '안전 재고 · 재주문', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2730)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'acct-vehicle', 'VIEW'), ('R_ADMIN', 'acct-vehicle', 'EDIT'), ('R_ADMIN', 'acct-vehicle', 'APPROVE'), ('R_ADMIN', 'acct-vehicle', 'EXPORT'),
  ('R_ADMIN', 'acct-reorder', 'VIEW'), ('R_ADMIN', 'acct-reorder', 'EDIT'), ('R_ADMIN', 'acct-reorder', 'APPROVE'), ('R_ADMIN', 'acct-reorder', 'EXPORT'),
  ('R_PAYOUT', 'acct-vehicle', 'VIEW'), ('R_PAYOUT', 'acct-vehicle', 'EDIT'), ('R_PAYOUT', 'acct-vehicle', 'APPROVE'), ('R_PAYOUT', 'acct-vehicle', 'EXPORT'),
  ('R_PAYOUT', 'acct-cashplan', 'VIEW'), ('R_PAYOUT', 'acct-cashplan', 'EDIT'), ('R_PAYOUT', 'acct-cashplan', 'APPROVE'), ('R_PAYOUT', 'acct-cashplan', 'EXPORT'),
  ('R_PAYOUT', 'acct-exemptinv', 'VIEW'), ('R_PAYOUT', 'acct-exemptinv', 'EDIT'), ('R_PAYOUT', 'acct-exemptinv', 'APPROVE'), ('R_PAYOUT', 'acct-exemptinv', 'EXPORT'),
  ('R_PAYOUT', 'acct-reorder', 'VIEW'), ('R_PAYOUT', 'acct-reorder', 'EDIT'), ('R_PAYOUT', 'acct-reorder', 'APPROVE'), ('R_PAYOUT', 'acct-reorder', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-vehicle', 'VIEW'), ('R_ACCOUNTANT', 'acct-vehicle', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-cashplan', 'VIEW'), ('R_ACCOUNTANT', 'acct-cashplan', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-exemptinv', 'VIEW'), ('R_ACCOUNTANT', 'acct-exemptinv', 'EXPORT'),
  ('R_ACCOUNTANT', 'acct-reorder', 'VIEW'), ('R_ACCOUNTANT', 'acct-reorder', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/acct/vehicles', 'acct-vehicle', 'VIEW'),
  ('GET', '/admin/acct/vehicles/{id}', 'acct-vehicle', 'VIEW'),
  ('POST', '/admin/acct/vehicles', 'acct-vehicle', 'EDIT'),
  ('PUT', '/admin/acct/vehicles/{id}', 'acct-vehicle', 'EDIT'),
  ('POST', '/admin/acct/vehicles/{id}/trips', 'acct-vehicle', 'EDIT'),
  ('POST', '/admin/acct/vehicles/{id}/trips/{tripId}/cancel', 'acct-vehicle', 'EDIT'),
  ('POST', '/admin/acct/vehicles/{id}/costs', 'acct-vehicle', 'EDIT'),
  ('POST', '/admin/acct/vehicles/{id}/costs/{costId}/cancel', 'acct-vehicle', 'EDIT'),
  ('GET', '/admin/acct/cash-plan', 'acct-cashplan', 'VIEW'),
  ('GET', '/admin/acct/exempt-invoices', 'acct-exemptinv', 'VIEW'),
  ('POST', '/admin/acct/exempt-invoices', 'acct-exemptinv', 'EDIT'),
  ('POST', '/admin/acct/exempt-invoices/{id}/send', 'acct-exemptinv', 'APPROVE'),
  ('POST', '/admin/acct/exempt-invoices/{id}/cancel', 'acct-exemptinv', 'EDIT'),
  ('GET', '/admin/acct/reorder', 'acct-reorder', 'VIEW'),
  ('PUT', '/admin/acct/reorder/rules/{optionId}', 'acct-reorder', 'EDIT'),
  ('POST', '/admin/acct/reorder/run', 'acct-reorder', 'APPROVE'),
  ('PUT', '/admin/acct/reorder/drafts/{id}/lines', 'acct-reorder', 'EDIT'),
  ('POST', '/admin/acct/reorder/drafts/{id}/convert', 'acct-reorder', 'EDIT'),
  ('POST', '/admin/acct/reorder/drafts/{id}/dismiss', 'acct-reorder', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;


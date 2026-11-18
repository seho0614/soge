-- v10.381 ~ 384 (docs/517 ~ 520) — 회계 · 세무 1단계: 계정표 · 자동 전표 · 월 마감 · 신고 자료 · 경영 보고서
--   대표 11/19 「회계 관리, 세무관리」 → 「바로 1단계 개발」 · 장부 = 회계 프로그램 직접(세무사랑 · 기타) · 원하는 것 4개 모두 · 직판 부가세 「상품마다 표시」
--   → 계획 「승인 + 통과하면 병합」.
--   ① acct_accounts — 전표에 쓰는 계정(역할 · 이름 · 회계 프로그램 코드) · 코드 · 이름만 고침(SUPER)
--   ② acct_entries · acct_lines — 돈 흐름(근거 · 근거 번호)마다 전표 한 장 · 차변 = 대변(미룬 검사) · 쌓기만 · 마감한 달에는 넣지 못함
--   ③ acct_closings — 월 마감(한 번 · 쌓기만)
--   ④ hlt_products.tax_type · hlt_order_items.tax_type(주문 때 상품 값을 옮겨 둠) — 과세(TAXABLE) · 면세(EXEMPT) · 처음 과세
--   ⑤ 설정 acct.* · 정기 작업 acct_journal(매시간) · 내려받기 승인 대상 ACCT_JOURNAL · ACCT_TAX
--   전표 규칙 · 계정 코드는 초안 — 세무사 확인 뒤 운영 화면에서 코드만 고칩니다.
--   다시 돌려도 같음 · 지우는 문장은 내려받기 대상 CHECK 를 넓히는 한 줄뿐(DROP CONSTRAINT IF EXISTS → 바로 다시 ADD).

/* ── ① 계정 ── */
CREATE TABLE IF NOT EXISTS public.acct_accounts (
  role        text PRIMARY KEY CHECK (role ~ '^[A-Z][A-Z_]{1,39}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  kind        text NOT NULL CHECK (kind IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE')),
  ext_code    text CHECK (ext_code IS NULL OR ext_code ~ '^[0-9A-Za-z._-]{1,20}$'),
  ext_name    text CHECK (ext_name IS NULL OR char_length(ext_name) <= 60),
  sort        integer NOT NULL DEFAULT 0,
  note        text,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_accounts IS 'v10.381 (D242) 전표 계정 — 역할(role)은 고정 · 회계 프로그램 계정 코드(ext_code) · 이름(ext_name)만 SUPER 가 고침(초안 · 세무사 확인)';

CREATE OR REPLACE FUNCTION public.fn_acct_accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ACCOUNT: 계정은 지우지 않습니다.'; END IF;
  IF (NEW.role, NEW.kind) IS DISTINCT FROM (OLD.role, OLD.kind) THEN
    RAISE EXCEPTION 'ACCT_ACCOUNT: 계정 역할 · 종류는 고치지 않습니다(회계 프로그램 코드 · 이름만).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accounts_guard' AND tgrelid = 'public.acct_accounts'::regclass) THEN
    CREATE TRIGGER trg_acct_accounts_guard BEFORE UPDATE OR DELETE ON public.acct_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accounts_guard();
  END IF;
END $$;

INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note) VALUES
  ('CASH',            '보통예금',                 'ASSET',     '103', '보통예금',     10, '계좌 입금 · 출금(광고 입금 · 정액 노출 입금 · 포인트 출금 실지급)'),
  ('PG_RECV',         'PG 정산 받을 돈',          'ASSET',     '120', '미수금',       20, '카드 · PG 결제 승인 뒤 PG 사가 넣어 줄 돈(구독 · 소개코드 · 소개몰 직판 · 리드 캐시 충전)'),
  ('AR',              '외상매출금',               'ASSET',     '108', '외상매출금',   30, '광고 청구서 · 입점 수수료(받기 전)'),
  ('ADV',             '선수금',                   'LIABILITY', '259', '선수금',       40, '지금 쓰지 않음 — 리드 캐시는 충전 때 매출(11/19 대표)'),
  ('VAT_OUT',         '부가세예수금',             'LIABILITY', '255', '부가세예수금', 50, '매출 부가세'),
  ('WHT',             '예수금(원천세)',           'LIABILITY', '254', '예수금',       60, '포인트 출금 원천징수(소득세 · 지방소득세)'),
  ('REV_SUB',         '구독 매출',                'REVENUE',   '404', '용역매출',     100, '요금제 구독'),
  ('REV_REFCODE',     '소개코드 매출',            'REVENUE',   '404', '용역매출',     110, '소개코드 묶음 결제'),
  ('REV_AD',          '광고 매출',                'REVENUE',   '404', '용역매출',     120, '광고 청구서(공급가)'),
  ('REV_LEAD',        '리드 매출',                'REVENUE',   '404', '용역매출',     130, '리드 캐시 충전 때(11/19 대표 「충전 때 매출」 · 보너스 캐시는 매출 아님) · 환급은 반대'),
  ('REV_DIRECTORY',   '정액 노출 매출',           'REVENUE',   '404', '용역매출',     140, '상담 디렉터리 정액 노출'),
  ('REV_COMMISSION',  '입점 수수료 매출',         'REVENUE',   '411', '수수료수익',   150, '소개몰 입점 판매자 정산 수수료(판매 대금은 판매자 돈 · 우리 장부에 넣지 않음)'),
  ('REV_MALL',        '상품 매출(과세)',          'REVENUE',   '401', '상품매출',     160, '소개몰 직판 · 과세 상품 · 배송비'),
  ('REV_MALL_EXEMPT', '상품 매출(면세)',          'REVENUE',   '401', '상품매출',     170, '소개몰 직판 · 면세 상품'),
  ('EXP_PROMO',       '추천 수당',                'EXPENSE',   NULL,  '추천수당',     200, '추천 보상 포인트 현금 출금 = 수당(11/19 대표) · 총액(원천세 포함) · 사업소득 3.3% · 계정 코드는 코드표를 받으면 채움')
ON CONFLICT (role) DO NOTHING;

/* ── ② 전표 ── */
CREATE TABLE IF NOT EXISTS public.acct_entries (
  id          bigserial PRIMARY KEY,
  entry_date  date NOT NULL,
  ym          text NOT NULL DEFAULT '',
  source      text NOT NULL CHECK (source ~ '^[A-Z][A-Z_]{1,39}$'),
  source_key  text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 120),
  memo        text CHECK (memo IS NULL OR char_length(memo) <= 200),
  party       text CHECK (party IS NULL OR char_length(party) <= 120),
  evidence    text NOT NULL DEFAULT 'NONE' CHECK (evidence IN ('TAX_INVOICE', 'CARD_PG', 'CASH', 'NONE')),
  late        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_key)
);
CREATE INDEX IF NOT EXISTS ix_acct_entries_ym ON public.acct_entries (ym, entry_date, id);
COMMENT ON TABLE public.acct_entries IS 'v10.382 (D242) 자동 전표 — 돈 흐름(source · source_key)마다 한 장 · 같은 근거는 한 번 · 마감한 달이면 오늘 날짜로(late) · 쌓기만 · 바로잡기는 반대 전표';

CREATE TABLE IF NOT EXISTS public.acct_lines (
  id        bigserial PRIMARY KEY,
  entry_id  bigint NOT NULL REFERENCES public.acct_entries(id),
  role      text NOT NULL REFERENCES public.acct_accounts(role),
  debit     bigint NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit    bigint NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CONSTRAINT ck_acct_lines_one CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX IF NOT EXISTS ix_acct_lines_entry ON public.acct_lines (entry_id);
CREATE INDEX IF NOT EXISTS ix_acct_lines_role ON public.acct_lines (role, entry_id);
COMMENT ON TABLE public.acct_lines IS 'v10.382 (D242) 전표 줄 — 한 줄은 차변 또는 대변 하나 · 전표마다 차변 합 = 대변 합(거래 끝에 검사) · 쌓기만';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_entries_ro' AND tgrelid = 'public.acct_entries'::regclass) THEN
    CREATE TRIGGER trg_acct_entries_ro BEFORE UPDATE OR DELETE ON public.acct_entries FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_lines_ro' AND tgrelid = 'public.acct_lines'::regclass) THEN
    CREATE TRIGGER trg_acct_lines_ro BEFORE UPDATE OR DELETE ON public.acct_lines FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* 차변 = 대변 — 줄을 다 넣은 거래 끝에 봄 · 줄 없는 전표도 막음 */
CREATE OR REPLACE FUNCTION public.fn_acct_balance_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n int; eid bigint;
BEGIN
  -- 표마다 칸이 달라 CASE 한 줄로 쓰면 acct_entries 에서 NEW.entry_id 를 못 찾음 → IF 로 나눔
  IF TG_TABLE_NAME = 'acct_entries' THEN eid := NEW.id; ELSE eid := NEW.entry_id; END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM acct_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'ACCT_UNBALANCED: 전표 % 차변 % · 대변 % · 줄 %', eid, d, c, n;
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_lines_balance' AND tgrelid = 'public.acct_lines'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_acct_lines_balance AFTER INSERT ON public.acct_lines DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.fn_acct_balance_check();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_entries_balance' AND tgrelid = 'public.acct_entries'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_acct_entries_balance AFTER INSERT ON public.acct_entries DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.fn_acct_balance_check();
  END IF;
END $$;

/* ── ③ 월 마감 ── */
CREATE TABLE IF NOT EXISTS public.acct_closings (
  ym         text PRIMARY KEY CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  entries    integer NOT NULL CHECK (entries >= 0),
  debit_sum  bigint NOT NULL CHECK (debit_sum >= 0),
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  closed_by  uuid REFERENCES public.accounts(id),
  closed_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_closings IS 'v10.382 (D242) 월 마감 — 달마다 한 번(전표 수 · 차변 합) · 쌓기만 · 마감한 달에는 전표를 넣지 못함(늦게 온 돈 흐름은 오늘 날짜 · late)';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_closings_ro' AND tgrelid = 'public.acct_closings'::regclass) THEN
    CREATE TRIGGER trg_acct_closings_ro BEFORE UPDATE OR DELETE ON public.acct_closings FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_entries_closed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.ym := to_char(NEW.entry_date, 'YYYY-MM');   -- 달(YYYY-MM)은 날짜에서 · 마감 확인과 같은 값
  IF EXISTS (SELECT 1 FROM acct_closings WHERE ym = NEW.ym) THEN
    RAISE EXCEPTION 'ACCT_CLOSED: % 은 마감한 달입니다.', to_char(NEW.entry_date, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_entries_closed' AND tgrelid = 'public.acct_entries'::regclass) THEN
    CREATE TRIGGER trg_acct_entries_closed BEFORE INSERT ON public.acct_entries FOR EACH ROW EXECUTE FUNCTION public.fn_acct_entries_closed();
  END IF;
END $$;

/* ── ④ 상품 과세 · 면세 ── */
ALTER TABLE public.hlt_products ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_type IN ('TAXABLE', 'EXEMPT'));
COMMENT ON COLUMN public.hlt_products.tax_type IS 'v10.383 (D242) 부가세 — 과세(TAXABLE · 처음) · 면세(EXEMPT) · 운영(ADMIN · SUPER)이 상품마다 고름 · 주문 줄에 옮겨 둠';
ALTER TABLE public.hlt_order_items ADD COLUMN IF NOT EXISTS tax_type text NOT NULL DEFAULT 'TAXABLE' CHECK (tax_type IN ('TAXABLE', 'EXEMPT'));
COMMENT ON COLUMN public.hlt_order_items.tax_type IS 'v10.383 (D242) 주문 때 상품의 과세 · 면세(나중에 상품을 고쳐도 그 주문은 그대로)';

CREATE OR REPLACE FUNCTION public.fn_hlt_item_tax_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.tax_type := coalesce((SELECT p.tax_type FROM hlt_products p WHERE p.id = NEW.product_id), 'TAXABLE');
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_item_tax_type' AND tgrelid = 'public.hlt_order_items'::regclass) THEN
    CREATE TRIGGER trg_hlt_item_tax_type BEFORE INSERT ON public.hlt_order_items FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_item_tax_type();
  END IF;
END $$;

/* ── ⑤ 설정 · 정기 작업 · 내려받기 대상 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('acct.start_on', '2026-11-01', 'ADMIN',
   '자동 전표 시작일(v10.382 · docs/518) — 이 날(한국) 뒤 돈 흐름만 전표로 만듦. 회계 프로그램에 이미 넣은 달은 빼도록 고칩니다(SUPER).',
   false, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', '2026-11-01'),
  ('acct.include_stub', 'off', 'ADMIN',
   '시험 결제(간주 · stub)도 전표로 만들기(v10.382) — 처음 off. 간주 결제가 켜진 동안은 실제 돈이 아니므로 off 를 권합니다(SUPER).',
   false, '^(on|off)$', 'off'),
  ('acct.sub_vat_included', 'on', 'ADMIN',
   '구독 · 소개코드 결제한 금액에 부가세가 들어 있음(v10.381) — 11/19 대표 「부가세 별도」 → 결제는 요금 + 부가세(⑩)이므로 결제 금액 ÷ 11 을 부가세로 나눔(on). off 면 나누지 않음(SUPER).',
   false, '^(on|off)$', 'on'),
  ('acct.commission_vat_included', 'off', 'ADMIN',
   '입점 수수료에 부가세가 들어 있음(v10.381) — 11/19 대표 「부가세 별도」 → off: 수수료가 공급가이고 부가세 10% 를 더 받음 · on 이면 수수료 ÷ 11 을 부가세로 나눔(SUPER).',
   false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_journal', 60, NULL, NULL, NULL, true, '자동 전표 — 시작일 뒤 아직 전표가 없는 돈 흐름을 전표로(같은 근거는 한 번 · 마감한 달이면 오늘 날짜) · D242 · v10.382')
ON CONFLICT (job) DO NOTHING;

ALTER TABLE public.export_requests DROP CONSTRAINT IF EXISTS export_requests_target_check;
ALTER TABLE public.export_requests ADD CONSTRAINT export_requests_target_check
  CHECK (target IN ('POINT_REPORT', 'AUDIT_EXPORT', 'NOTICE_READS', 'RATE_READS', 'ACCT_JOURNAL', 'ACCT_TAX'));

/* 자동 전표가 쓰는 작은 함수 둘 — 시작 시각(한국 자정) · 시험 결제를 넣을지 */
CREATE OR REPLACE FUNCTION public.fn_acct_from() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (coalesce(nullif((SELECT value FROM site_settings WHERE key = 'acct.start_on'), ''), '2026-11-01')::date)::timestamp AT TIME ZONE 'Asia/Seoul'
$$;
CREATE OR REPLACE FUNCTION public.fn_acct_stub_ok(p_stub boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT coalesce(p_stub, false) OR coalesce((SELECT value FROM site_settings WHERE key = 'acct.include_stub'), 'off') = 'on'
$$;
COMMENT ON FUNCTION public.fn_acct_from() IS 'v10.382 (D242) 자동 전표 시작 시각 — acct.start_on(한국 날짜) 0시';
COMMENT ON FUNCTION public.fn_acct_stub_ok(boolean) IS 'v10.382 (D242) 시험 결제(stub)를 전표로 만들지 — acct.include_stub';

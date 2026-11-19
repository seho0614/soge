-- v10.392 ~ 395 (docs/529 ~ 532) — 회계 · 세무 3단계(⑫): 전표 규칙 고치기 · 세무사랑 양식 · 확인표 · 매입 · 경비 청구 · 법인카드 · 자금 흐름 90일 · 직판 재고 수불부
--   대표 11/19 12:50 ⑫ 「승인 + 통과하면 병합」 · 17:45 「자동전표양식 및 규칙 만들어서 적용」(⑫ 에 더함).
--   ① 계정 · 증빙 · 규칙 고치기 · 세무사랑 양식  ② 매입(acct_purchases · 증빙 파일 ACCT_EVIDENCE)  ③ 경비 청구 · 법인카드
--   ④ 자금 흐름(잔액 · 예정 · 정기 작업 acct_cashflow)  ⑤ 재고 수불부(acct_stock_moves · 이동평균 · 정기 작업 acct_stock)
--   계정 코드 · 규칙 · 세율은 초안 — 세무사 확인 뒤 운영 화면에서 고침. 다시 돌려도 같음.

/* ── ① 전표 계정 · 규칙 고치기 · 세무사랑 양식 (v10.392 · docs/529) ─────────────────
 *   대표 11/19 「자동전표양식 및 규칙 만들어서 적용」 → 4가지 모두 · ⑫ 에 더함.
 *   계정 코드는 일반 계정과목 번호 초안 — 세무사 확인 뒤 운영 화면에서 코드만 고침.
 *   규칙 고치기는 「계정 자리」 · 증빙만(금액 계산은 코드) · 같은 종류 계정으로만 · 다음 전표부터.
 * ------------------------------------------------------------------------------- */

/* 증빙 — 법인카드(CARD) · 간이영수증(SIMPLE) 더함 */
ALTER TABLE public.acct_entries DROP CONSTRAINT IF EXISTS acct_entries_evidence_check;
ALTER TABLE public.acct_entries ADD CONSTRAINT acct_entries_evidence_check
  CHECK (evidence IN ('TAX_INVOICE', 'CARD_PG', 'CASH', 'NONE', 'CARD', 'SIMPLE'));

/* 계정 — SUPER 가 더할 수 있음(역할 U_ 로 시작) · 기본 계정은 처음부터 */
ALTER TABLE public.acct_accounts ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;
ALTER TABLE public.acct_accounts ADD COLUMN IF NOT EXISTS draft boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.acct_accounts.draft IS 'v10.392 — 계정 코드가 초안(세무사 확인 전)이면 true · 코드를 고치면 false';

INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note) VALUES
  ('VAT_IN',        '부가세대급금',           'ASSET',     '135', '부가세대급금',   55, '매입 부가세(공제되는 것) — v10.392'),
  ('INVENTORY',     '상품',                   'ASSET',     '146', '상품',           25, '소개몰 직판 재고(이동평균) — v10.395'),
  ('AP',            '미지급금',               'LIABILITY', '253', '미지급금',       45, '매입 · 경비 청구(주기 전) — v10.392 · 393'),
  ('CARD_AP',       '미지급금(법인카드)',     'LIABILITY', '253', '미지급금',       46, '법인카드 사용(카드 대금 내기 전) — v10.393'),
  ('COGS',          '상품매출원가',           'EXPENSE',   '451', '상품매출원가',   190, '직판 출고 원가(이동평균) — v10.395'),
  ('EXP_SALARY',    '직원급여',               'EXPENSE',   '802', '직원급여',       210, '급여 — v10.403 에서 씀'),
  ('EXP_WELFARE',   '복리후생비',             'EXPENSE',   '811', '복리후생비',     220, '식대 · 경조사 등'),
  ('EXP_TRAVEL',    '여비교통비',             'EXPENSE',   '812', '여비교통비',     230, '교통 · 출장'),
  ('EXP_ENTERTAIN', '기업업무추진비',         'EXPENSE',   '813', '기업업무추진비', 240, '옛 접대비 — 매입 부가세 공제 안 됨'),
  ('EXP_COMM',      '통신비',                 'EXPENSE',   '814', '통신비',         250, '전화 · 인터넷'),
  ('EXP_TAXES',     '세금과공과',             'EXPENSE',   '817', '세금과공과',     260, '면허세 · 협회비 등'),
  ('EXP_RENT',      '지급임차료',             'EXPENSE',   '819', '지급임차료',     270, '사무실 임대료'),
  ('EXP_SUPPLIES',  '소모품비',               'EXPENSE',   '830', '소모품비',       280, '사무용품'),
  ('EXP_FEE',       '지급수수료',             'EXPENSE',   '831', '지급수수료',     290, 'PG 수수료 · 세무 · 법무 · 서버(클라우드) 등'),
  ('EXP_AD',        '광고선전비',             'EXPENSE',   '833', '광고선전비',     300, '외부 광고'),
  ('EXP_ETC',       '잡비',                   'EXPENSE',   '848', '잡비',           390, '그 밖의 비용')
ON CONFLICT (role) DO NOTHING;
/* 비어 있던 추천 수당 코드 — 지급수수료(초안) */
UPDATE public.acct_accounts SET ext_code = '831', ext_name = '지급수수료', note = coalesce(note, '') || ' · v10.392 코드 초안 831(지급수수료)'
 WHERE role = 'EXP_PROMO' AND ext_code IS NULL;

CREATE OR REPLACE FUNCTION public.fn_acct_accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ACCOUNT: 계정은 지우지 않습니다.'; END IF;
  IF (NEW.role, NEW.kind, NEW.custom) IS DISTINCT FROM (OLD.role, OLD.kind, OLD.custom) THEN
    RAISE EXCEPTION 'ACCT_ACCOUNT: 계정 역할 · 종류는 고치지 않습니다(회계 프로그램 코드 · 이름만).';
  END IF;
  IF NEW.ext_code IS DISTINCT FROM OLD.ext_code OR NEW.ext_name IS DISTINCT FROM OLD.ext_name THEN NEW.draft := false; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.fn_acct_accounts_ins_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.custom AND NEW.role !~ '^U_[A-Z][A-Z0-9_]{1,30}$' THEN
    RAISE EXCEPTION 'ACCT_ACCOUNT: 더하는 계정 역할은 U_ 로 시작하는 대문자입니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_accounts_ins_guard' AND tgrelid = 'public.acct_accounts'::regclass) THEN
    CREATE TRIGGER trg_acct_accounts_ins_guard BEFORE INSERT ON public.acct_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accounts_ins_guard();
  END IF;
END $$;

/* 규칙 고치기 — 돈 흐름(source)의 계정 자리(from_role) → 쓸 계정(to_role) · 증빙 바꾸기 */
CREATE TABLE IF NOT EXISTS public.acct_rule_maps (
  source      text NOT NULL CHECK (source ~ '^[A-Z][A-Z_]{1,39}$'),
  from_role   text NOT NULL REFERENCES public.acct_accounts(role),
  to_role     text NOT NULL REFERENCES public.acct_accounts(role),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, from_role)
);
COMMENT ON TABLE public.acct_rule_maps IS 'v10.392 (D245) 전표 규칙 고치기 — 돈 흐름마다 계정 자리를 같은 종류 다른 계정으로(SUPER · 다음 전표부터)';
CREATE TABLE IF NOT EXISTS public.acct_rule_evidence (
  source      text PRIMARY KEY CHECK (source ~ '^[A-Z][A-Z_]{1,39}$'),
  evidence    text NOT NULL CHECK (evidence IN ('TAX_INVOICE', 'CARD_PG', 'CASH', 'NONE', 'CARD', 'SIMPLE')),
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.acct_rule_changes (
  id          bigserial PRIMARY KEY,
  source      text NOT NULL,
  slot        text NOT NULL,
  before      text,
  after       text,
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 200),
  actor_id    uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_rule_changes IS 'v10.392 (D245) 전표 규칙 바꾼 기록 — 쌓기만';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_rule_changes_block' AND tgrelid = 'public.acct_rule_changes'::regclass) THEN
    CREATE TRIGGER trg_acct_rule_changes_block BEFORE UPDATE OR DELETE ON public.acct_rule_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_acct_rule_map_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k1 text; k2 text;
BEGIN
  SELECT kind INTO k1 FROM public.acct_accounts WHERE role = NEW.from_role;
  SELECT kind INTO k2 FROM public.acct_accounts WHERE role = NEW.to_role;
  IF k1 IS DISTINCT FROM k2 THEN
    RAISE EXCEPTION 'ACCT_RULE_KIND: 같은 종류 계정으로만 바꿉니다(자산은 자산 · 매출은 매출).';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_rule_map_guard' AND tgrelid = 'public.acct_rule_maps'::regclass) THEN
    CREATE TRIGGER trg_acct_rule_map_guard BEFORE INSERT OR UPDATE ON public.acct_rule_maps FOR EACH ROW EXECUTE FUNCTION public.fn_acct_rule_map_guard();
  END IF;
END $$;

/* 세무사랑 일반전표 양식 — 월 · 일 · 구분(3 차변 · 4 대변) · 계정 · 거래처 · 적요 · 차변 · 대변
 *   세무사랑 [회계관리 › 기타전표입력 › 엑셀자료일반전표전송] 「F11 엑셀작업 › 엑셀서식올리기(포맷)」에서 처음 한 번 칸을 짝지음.
 *   칸 순서는 공개 자료로 확인하지 못함 — 양식 파일을 받으면 맞춰 고침. 기본 양식이 손대지 않은 「일반 양식」일 때만 기본으로 바꿈. */
INSERT INTO public.acct_export_formats (name, columns, date_style, dc_style, dc_debit, dc_credit, is_default)
VALUES ('세무사랑 일반전표', '[{"field":"month","title":"월"},{"field":"day","title":"일"},{"field":"dc","title":"구분"},{"field":"code","title":"계정코드"},{"field":"name","title":"계정과목"},{"field":"blank","title":"거래처코드"},{"field":"party","title":"거래처명"},{"field":"memo","title":"적요"},{"field":"debit","title":"차변"},{"field":"credit","title":"대변"}]'::jsonb,
        'YYYY-MM-DD', 'SPLIT', '3', '4', false)
ON CONFLICT (name) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.acct_export_formats WHERE is_default AND name = '일반 양식' AND updated_by IS NULL) THEN
    UPDATE public.acct_export_formats SET is_default = false WHERE is_default;
    UPDATE public.acct_export_formats SET is_default = true WHERE name = '세무사랑 일반전표';
  END IF;
END $$;

/* ── v10.392 (docs/529) 매입 관리 ───────────────────────────────────────
 *   acct_purchases — 매입 세금계산서 · 카드 · 현금영수증 · 간이영수증 · 쌓기만(금액 · 날짜 못 고침 · 지우지 않음 · 취소만)
 *   증빙 파일 용도 ACCT_EVIDENCE(JPG · PNG · PDF · 10MB) · 붙은 파일은 지울 수 없음 · PAYOUT 도 엶
 *   ※ 앞(① 계정)에서 VAT_IN · AP · CARD_AP · EXP_* 를 넣은 뒤에 와야 함(pay_role 참조)
 * ------------------------------------------------------------------- */
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS ck_files_purpose;
ALTER TABLE public.files ADD CONSTRAINT ck_files_purpose
  /* 합침 — D217 목록 그대로 + ACCT_EVIDENCE(D245). 빠지면 있는 파일이 있는 DB 에서 실패합니다 */
  CHECK (purpose = ANY (ARRAY['OWNERSHIP_DOC','MARKETING_MATERIAL','PARTNER_GUIDE','PRODUCT_IMAGE','PARTNER_MEDIA',
                              'LISTING_IMAGE','REQUEST_IMAGE','INQUIRY_ATTACHMENT','BROKER_DOC','NOTICE_ATTACHMENT','ACCT_EVIDENCE']));
INSERT INTO public.file_policies (purpose, content_type, max_bytes, ext) VALUES
  ('ACCT_EVIDENCE', 'image/jpeg', 10485760, 'jpg'), ('ACCT_EVIDENCE', 'image/png', 10485760, 'png'),
  ('ACCT_EVIDENCE', 'application/pdf', 10485760, 'pdf')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.acct_purchases (
  id               bigserial PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('TAX_INVOICE', 'CARD', 'CASH', 'SIMPLE')),
  issued_on        date NOT NULL,
  supplier_name    text NOT NULL CHECK (char_length(supplier_name) BETWEEN 1 AND 120),
  supplier_biz_no  text CHECK (supplier_biz_no IS NULL OR supplier_biz_no ~ '^[0-9]{10}$'),
  item             text NOT NULL CHECK (char_length(item) BETWEEN 1 AND 120),
  supply           bigint NOT NULL CHECK (supply > 0),
  vat              bigint NOT NULL DEFAULT 0 CHECK (vat >= 0 AND vat <= supply),
  total            bigint NOT NULL,
  deductible       boolean NOT NULL DEFAULT false,
  account_role     text NOT NULL REFERENCES public.acct_accounts(role),
  pay_role         text NOT NULL REFERENCES public.acct_accounts(role) CHECK (pay_role IN ('CASH', 'AP', 'CARD_AP')),
  memo             text CHECK (memo IS NULL OR char_length(memo) <= 200),
  attachments      uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(attachments) <= 5),
  state            text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CANCELED')),
  cancel_reason    text,
  canceled_by      uuid REFERENCES public.accounts(id),
  canceled_at      timestamptz,
  created_by       uuid REFERENCES public.accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ap_total     CHECK (total = supply + vat),
  CONSTRAINT ck_ap_simple    CHECK (kind <> 'SIMPLE' OR (vat = 0 AND NOT deductible)),
  CONSTRAINT ck_ap_taxinv    CHECK (kind <> 'TAX_INVOICE' OR supplier_biz_no IS NOT NULL),
  CONSTRAINT ck_ap_deduct    CHECK (NOT deductible OR vat > 0),
  CONSTRAINT ck_ap_cancel    CHECK ((state = 'ACTIVE' AND cancel_reason IS NULL AND canceled_at IS NULL)
                                 OR (state = 'CANCELED' AND char_length(btrim(coalesce(cancel_reason, ''))) BETWEEN 2 AND 200 AND canceled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_acct_purchases_issued ON public.acct_purchases (issued_on, id);
CREATE INDEX IF NOT EXISTS ix_acct_purchases_biz ON public.acct_purchases (supplier_biz_no, issued_on) WHERE state = 'ACTIVE';
COMMENT ON TABLE public.acct_purchases IS 'v10.392 (D245) 매입 — 세금계산서 · 카드 · 현금영수증 · 간이영수증(공제 안 됨) · 쌓기만(금액 · 날짜 못 고침 · 취소만 · 사유) · 전표 PURCHASE · 취소는 반대 전표 PURCHASE_CANCEL · 공제 · 계정은 세무사 확인';

CREATE OR REPLACE FUNCTION public.fn_acct_purchase_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PURCHASE: 매입은 지우지 않습니다 — 취소(사유)하십시오.'; END IF;
  SELECT role, kind INTO a FROM public.acct_accounts WHERE role = NEW.account_role;
  IF a.kind NOT IN ('EXPENSE', 'ASSET') OR NEW.account_role IN ('CASH', 'PG_RECV', 'AR', 'VAT_IN') THEN
    RAISE EXCEPTION 'ACCT_PURCHASE: 매입 계정은 비용 또는 자산 계정입니다.';
  END IF;
  IF NEW.deductible AND NEW.account_role = 'EXP_ENTERTAIN' THEN
    RAISE EXCEPTION 'ACCT_PURCHASE: 기업업무추진비는 부가세 공제가 안 됩니다.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.kind, NEW.issued_on, NEW.supplier_name, NEW.supplier_biz_no, NEW.item, NEW.supply, NEW.vat, NEW.total, NEW.deductible,
        NEW.account_role, NEW.pay_role, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.kind, OLD.issued_on, OLD.supplier_name, OLD.supplier_biz_no, OLD.item, OLD.supply, OLD.vat, OLD.total, OLD.deductible,
        OLD.account_role, OLD.pay_role, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'ACCT_PURCHASE: 넣은 매입의 금액 · 날짜 · 계정은 고치지 않습니다 — 취소 뒤 다시 넣으십시오.';
    END IF;
    IF OLD.state = 'CANCELED' AND (NEW.state, NEW.cancel_reason, NEW.canceled_at, NEW.attachments) IS DISTINCT FROM (OLD.state, OLD.cancel_reason, OLD.canceled_at, OLD.attachments) THEN
      RAISE EXCEPTION 'ACCT_PURCHASE: 취소한 매입은 고치지 않습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_purchase_guard' AND tgrelid = 'public.acct_purchases'::regclass) THEN
    CREATE TRIGGER trg_acct_purchase_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_acct_purchase_guard();
  END IF;
END $$;

-- 매입에 붙은 증빙 파일은 지울 수 없음(fn_files_guard 는 그대로 두고 따로 지킴)
CREATE OR REPLACE FUNCTION public.fn_files_acct_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND (EXISTS (SELECT 1 FROM public.acct_purchases p WHERE OLD.id = ANY(p.attachments))
          OR (to_regclass('public.acct_expense_claims') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.acct_expense_claims c WHERE OLD.id = ANY(c.attachments) AND c.state <> 'CANCELED'))) THEN
    RAISE EXCEPTION 'FILE: 매입 · 경비 청구에 붙은 증빙 파일은 지울 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_files_acct_guard ON public.files;
CREATE TRIGGER trg_files_acct_guard BEFORE UPDATE OF status ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.fn_files_acct_guard();

-- 파일 열람 — D173 그대로 + 지급 담당(PAYOUT)은 회계 증빙(ACCT_EVIDENCE)을 엶
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
  IF p_roles && ARRAY['ADMIN','SUPER','REVIEWER'] THEN RETURN 'OK'; END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;
  /* v10.392 (D245) — 지급 담당은 회계 증빙 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose = 'ACCT_EVIDENCE' THEN RETURN 'OK'; END IF;

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

/* ── v10.393 (D245 · docs/530) 경비 청구 · 법인카드 ─────────────────────────────
 *   ① acct_expense_claims — 운영자가 개인 돈으로 쓴 경비 청구 · SUPER 승인(본인 청구 불가) · 지급(PAYOUT · 본인 불가)
 *      상태는 앞으로만: REQUESTED → APPROVED → PAID / REQUESTED → REJECTED · CANCELED · 내용은 고치지 않음(취소 뒤 다시 청구)
 *      간이영수증(SIMPLE)은 매입세액 공제 안 됨 → 부가세 0
 *   ② acct_card_uploads · acct_card_txns — 법인카드 이용 내역 CSV(카드사 홈페이지 「이용 내역 → 엑셀 저장」) · 같은 줄은 한 번
 *      줄마다 계정 · 공제 여부를 고르고 「장부에 넣기」(BOOKED · 되돌리지 않음) 또는 「넣지 않음」(IGNORED · 사유)
 *      카드 대금 결제(통장 출금)는 ⑪ 은행 맞추기에서 수동 전표 · 맞출 것 없음으로 처리 — 여기서는 미지급금(법인카드) 대변까지
 *   전표(앱 · 정기 작업 acct_journal): EXPENSE_APPROVED · EXPENSE_PAID · CARD_TXN
 *   첨부는 files 용도 ACCT_EVIDENCE(purchase.sql 에서 정의 · 공용) · 3개까지
 *   다시 돌려도 같음 · 지우는 문장 없음.
 * ------------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS public.acct_expense_claims (
  id             bigserial PRIMARY KEY,
  claimant       uuid NOT NULL REFERENCES public.accounts(id),
  spent_on       date NOT NULL,
  account_role   text NOT NULL REFERENCES public.acct_accounts(role),
  amount         bigint NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  vat            bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  evidence       text NOT NULL CHECK (evidence IN ('CARD', 'CASH', 'SIMPLE', 'TAX_INVOICE')),
  item           text NOT NULL CHECK (char_length(btrim(item)) BETWEEN 2 AND 100),
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 400),
  attachments    uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(attachments) <= 3),
  state          text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELED')),
  decided_by     uuid REFERENCES public.accounts(id),
  decided_at     timestamptz,
  reject_reason  text CHECK (reject_reason IS NULL OR char_length(reject_reason) <= 200),
  paid_by        uuid REFERENCES public.accounts(id),
  paid_at        timestamptz,
  canceled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aec_vat CHECK (vat * 11 <= amount + 10),
  CONSTRAINT ck_aec_simple CHECK (evidence <> 'SIMPLE' OR vat = 0),
  CONSTRAINT ck_aec_state CHECK (
       (state = 'REQUESTED' AND decided_at IS NULL AND paid_at IS NULL AND canceled_at IS NULL)
    OR (state = 'APPROVED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND paid_at IS NULL)
    OR (state = 'REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND char_length(btrim(coalesce(reject_reason, ''))) >= 2)
    OR (state = 'PAID' AND decided_at IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL)
    OR (state = 'CANCELED' AND decided_at IS NULL AND canceled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_aec_state ON public.acct_expense_claims (state, spent_on, id);
CREATE INDEX IF NOT EXISTS ix_aec_claimant ON public.acct_expense_claims (claimant, id);
COMMENT ON TABLE public.acct_expense_claims IS 'v10.393 (D245) 경비 청구 — 운영자 개인 돈으로 쓴 경비 · SUPER 승인(본인 청구 불가) · 지급(본인 불가) · 상태 앞으로만 · 내용 고치지 않음 · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_acct_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_EXPENSE: 경비 청구는 지우지 않습니다(취소 · 반려).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'REQUESTED' THEN RAISE EXCEPTION 'ACCT_EXPENSE: 경비 청구는 「청구」 상태로만 넣습니다.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM acct_accounts a WHERE a.role = NEW.account_role AND a.kind = 'EXPENSE') THEN
      RAISE EXCEPTION 'ACCT_EXPENSE_ROLE: 경비 청구 계정은 비용 계정이어야 합니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.claimant, NEW.spent_on, NEW.account_role, NEW.amount, NEW.vat, NEW.evidence, NEW.item, NEW.memo, NEW.attachments, NEW.created_at)
     IS DISTINCT FROM (OLD.claimant, OLD.spent_on, OLD.account_role, OLD.amount, OLD.vat, OLD.evidence, OLD.item, OLD.memo, OLD.attachments, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_EXPENSE: 청구 내용은 고치지 않습니다(취소하고 다시 청구).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED'))
    OR (OLD.state = 'APPROVED' AND NEW.state = 'PAID')) THEN
    RAISE EXCEPTION 'ACCT_EXPENSE_STATE: % 에서 % 로 바꿀 수 없습니다.', OLD.state, NEW.state;
  END IF;
  IF NEW.state = OLD.state AND (NEW.decided_by, NEW.decided_at, NEW.reject_reason, NEW.paid_by, NEW.paid_at, NEW.canceled_at)
     IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.reject_reason, OLD.paid_by, OLD.paid_at, OLD.canceled_at) THEN
    RAISE EXCEPTION 'ACCT_EXPENSE_STATE: 상태가 같으면 처리 기록을 고치지 않습니다.';
  END IF;
  IF NEW.state IN ('APPROVED', 'REJECTED') AND OLD.state = 'REQUESTED' THEN
    IF NEW.decided_by = NEW.claimant THEN RAISE EXCEPTION 'EXPENSE_SELF: 본인 경비 청구는 승인 · 반려할 수 없습니다.'; END IF;
    IF NOT fn_has_role(NEW.decided_by, 'SUPER') THEN RAISE EXCEPTION 'ACCT_EXPENSE_SUPER: 경비 승인 · 반려는 SUPER 만 합니다.'; END IF;
  END IF;
  IF NEW.state = 'PAID' AND OLD.state = 'APPROVED' AND NEW.paid_by = NEW.claimant THEN
    RAISE EXCEPTION 'EXPENSE_SELF: 본인 경비는 본인이 지급 처리할 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_expense_guard' AND tgrelid = 'public.acct_expense_claims'::regclass) THEN
    CREATE TRIGGER trg_acct_expense_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_expense_claims FOR EACH ROW EXECUTE FUNCTION public.fn_acct_expense_guard();
  END IF;
END $$;

/* ── ② 법인카드 ── */
CREATE TABLE IF NOT EXISTS public.acct_card_uploads (
  id           bigserial PRIMARY KEY,
  filename     text CHECK (filename IS NULL OR char_length(filename) <= 200),
  card         text CHECK (card IS NULL OR char_length(card) <= 40),
  rows_total   integer NOT NULL CHECK (rows_total >= 0),
  rows_added   integer NOT NULL CHECK (rows_added >= 0),
  rows_dup     integer NOT NULL CHECK (rows_dup >= 0),
  rows_bad     integer NOT NULL DEFAULT 0 CHECK (rows_bad >= 0),
  uploaded_by  uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acct_card_uploads IS 'v10.393 (D245) 법인카드 이용 내역 올린 기록 — 파일 · 카드 · 줄 수(새로 · 이미 있음 · 못 읽음) · 누가 · 쌓기만';

CREATE TABLE IF NOT EXISTS public.acct_card_txns (
  id            bigserial PRIMARY KEY,
  upload_id     bigint NOT NULL REFERENCES public.acct_card_uploads(id),
  used_on       date NOT NULL,
  merchant      text CHECK (merchant IS NULL OR char_length(merchant) <= 120),
  amount        bigint NOT NULL CHECK (amount <> 0),
  approval_no   text CHECK (approval_no IS NULL OR char_length(approval_no) <= 40),
  card_tail     text CHECK (card_tail IS NULL OR card_tail ~ '^[0-9*]{1,4}$'),
  row_hash      text NOT NULL UNIQUE CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  state         text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'BOOKED', 'IGNORED')),
  account_role  text REFERENCES public.acct_accounts(role),
  deductible    boolean NOT NULL DEFAULT false,
  vat           bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  note          text CHECK (note IS NULL OR char_length(note) <= 200),
  booked_by     uuid REFERENCES public.accounts(id),
  booked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_act_vat CHECK (vat * 11 <= abs(amount) + 10 AND (deductible OR vat = 0)),
  CONSTRAINT ck_act_state CHECK (
       (state = 'OPEN' AND booked_at IS NULL)
    OR (state = 'BOOKED' AND account_role IS NOT NULL AND booked_by IS NOT NULL AND booked_at IS NOT NULL)
    OR (state = 'IGNORED' AND booked_at IS NOT NULL AND char_length(btrim(coalesce(note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_act_date ON public.acct_card_txns (used_on, id);
COMMENT ON TABLE public.acct_card_txns IS 'v10.393 (D245) 법인카드 이용 한 줄 — 음수는 취소 · 같은 줄은 한 번(row_hash) · 장부에 넣기(BOOKED · 계정 · 공제 여부 · 되돌리지 않음) 또는 넣지 않음(IGNORED · 사유) · 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_acct_card_txn_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_CARD: 카드 이용 줄은 지우지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.upload_id, NEW.used_on, NEW.merchant, NEW.amount, NEW.approval_no, NEW.card_tail, NEW.row_hash, NEW.created_at)
       IS DISTINCT FROM (OLD.upload_id, OLD.used_on, OLD.merchant, OLD.amount, OLD.approval_no, OLD.card_tail, OLD.row_hash, OLD.created_at) THEN
      RAISE EXCEPTION 'ACCT_CARD: 카드 이용 내용은 고치지 않습니다.';
    END IF;
    IF OLD.state = 'BOOKED' THEN RAISE EXCEPTION 'ACCT_CARD_BOOKED: 장부에 넣은 줄은 바꾸지 않습니다(바로잡기는 수동 전표).'; END IF;
  ELSIF NEW.state <> 'OPEN' THEN
    RAISE EXCEPTION 'ACCT_CARD: 카드 이용 줄은 「남음」 상태로만 넣습니다.';
  END IF;
  IF NEW.state = 'BOOKED' AND NOT EXISTS (SELECT 1 FROM acct_accounts a WHERE a.role = NEW.account_role AND a.kind IN ('EXPENSE', 'ASSET')) THEN
    RAISE EXCEPTION 'ACCT_CARD_ROLE: 카드 이용은 비용 또는 자산 계정으로만 넣습니다.';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_card_txn_guard' AND tgrelid = 'public.acct_card_txns'::regclass) THEN
    CREATE TRIGGER trg_acct_card_txn_guard BEFORE INSERT OR UPDATE OR DELETE ON public.acct_card_txns FOR EACH ROW EXECUTE FUNCTION public.fn_acct_card_txn_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_card_uploads_ro' AND tgrelid = 'public.acct_card_uploads'::regclass) THEN
    CREATE TRIGGER trg_acct_card_uploads_ro BEFORE UPDATE OR DELETE ON public.acct_card_uploads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

/* ── v10.394 (docs/531) 자금 흐름 90일 ──
 *   acct_cash_balances — 직접 넣은 잔액(SUPER · 쌓기만 · 고치면 새 줄)
 *   acct_cash_plans    — 예정 들고 남(한 번 · 매달) · 지우지 않음 · 취소만(사유)
 *   설정 acct.pg_settle_days · acct.card_pay_day · acct.ap_pay_days · acct.seller_pay_days · acct.cash_floor · acct.cash_alert
 *   정기 작업 acct_cashflow(매일 09:20) — 가장 낮은 날 잔액이 기준 밑이면 운영 알림 ACCT_CASH_SHORT
 */
CREATE TABLE IF NOT EXISTS public.acct_cash_balances (
  id          bigserial PRIMARY KEY,
  as_of       date NOT NULL,
  amount      bigint NOT NULL CHECK (abs(amount) <= 1000000000000),
  source      text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'BANK')),
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_acct_cash_balances_asof ON public.acct_cash_balances (as_of DESC, id DESC);
COMMENT ON TABLE public.acct_cash_balances IS 'v10.394 (D245) 자금 흐름 시작 잔액 — 직접 넣은 잔액(SUPER) · 쌓기만 · 통장 CSV 마지막 잔액이 더 최근이면 그것을 씀';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_cash_balances_ro' AND tgrelid = 'public.acct_cash_balances'::regclass) THEN
    CREATE TRIGGER trg_acct_cash_balances_ro BEFORE UPDATE OR DELETE ON public.acct_cash_balances FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.acct_cash_plans (
  id           bigserial PRIMARY KEY,
  due_on       date NOT NULL,
  direction    text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount       bigint NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  memo         text NOT NULL CHECK (char_length(btrim(memo)) BETWEEN 2 AND 100),
  repeat       text NOT NULL DEFAULT 'NONE' CHECK (repeat IN ('NONE', 'MONTHLY')),
  until_on     date,
  state        text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CANCELED')),
  cancel_note  text,
  created_by   uuid REFERENCES public.accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  canceled_by  uuid REFERENCES public.accounts(id),
  canceled_at  timestamptz,
  CONSTRAINT ck_acp_until CHECK (until_on IS NULL OR (repeat = 'MONTHLY' AND until_on >= due_on)),
  CONSTRAINT ck_acp_cancel CHECK ((state = 'ACTIVE' AND canceled_at IS NULL) OR (state = 'CANCELED' AND canceled_at IS NOT NULL AND char_length(btrim(coalesce(cancel_note, ''))) >= 2))
);
CREATE INDEX IF NOT EXISTS ix_acct_cash_plans_due ON public.acct_cash_plans (due_on) WHERE state = 'ACTIVE';
COMMENT ON TABLE public.acct_cash_plans IS 'v10.394 (D245) 자금 흐름 예정 들고 남(한 번 · 매달) — 지우지 않음 · 내용은 고치지 않음 · 취소만(사유)';

CREATE OR REPLACE FUNCTION public.fn_acct_cash_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CASH_PLAN: 예정은 지우지 않습니다(취소만).'; END IF;
  IF (NEW.due_on, NEW.direction, NEW.amount, NEW.memo, NEW.repeat, NEW.until_on, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.due_on, OLD.direction, OLD.amount, OLD.memo, OLD.repeat, OLD.until_on, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'CASH_PLAN: 예정 내용은 고치지 않습니다(취소하고 새로 넣기).';
  END IF;
  IF OLD.state = 'CANCELED' THEN RAISE EXCEPTION 'CASH_PLAN: 이미 취소한 예정입니다.'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_cash_plan_guard' AND tgrelid = 'public.acct_cash_plans'::regclass) THEN
    CREATE TRIGGER trg_acct_cash_plan_guard BEFORE UPDATE OR DELETE ON public.acct_cash_plans FOR EACH ROW EXECUTE FUNCTION public.fn_acct_cash_plan_guard();
  END IF;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('acct.pg_settle_days', '2', 'ADMIN',
   '자금 흐름 — PG 결제 뒤 며칠(영업일)에 통장에 들어오는지(v10.394 · docs/531 · 0 ~ 14 · 처음 2). PG 사 계약을 보고 맞추십시오.',
   false, '^([0-9]|1[0-4])$', '2'),
  ('acct.card_pay_day', '15', 'ADMIN',
   '자금 흐름 — 법인카드 결제일(v10.394 · 1 ~ 28 · 처음 15). 그 달 쓴 것은 다음 달 이 날(영업일 아니면 다음 영업일) 나감.',
   false, '^([1-9]|1[0-9]|2[0-8])$', '15'),
  ('acct.ap_pay_days', '30', 'ADMIN',
   '자금 흐름 — 미지급금(매입 · 경비)을 전표 날 며칠 뒤에 갚는지(v10.394 · 0 ~ 120 · 처음 30).',
   false, '^([0-9]|[1-9][0-9]|1[01][0-9]|120)$', '30'),
  ('acct.seller_pay_days', '3', 'ADMIN',
   '자금 흐름 — 입점 판매자 정산을 확정 며칠 뒤(영업일 아니면 다음 영업일)에 지급하는지(v10.394 · 0 ~ 30 · 처음 3).',
   false, '^([0-9]|[12][0-9]|30)$', '3'),
  ('acct.cash_floor', '0', 'ADMIN',
   '자금 흐름 — 이 금액(원) 밑으로 내려가는 날이 90일 안에 있으면 운영 알림 ACCT_CASH_SHORT(v10.394 · 처음 0 = 마이너스일 때만).',
   false, '^[0-9]{1,13}$', '5000000'),
  ('acct.cash_alert', 'on', 'ADMIN',
   '자금 흐름 운영 알림(v10.394) — off 면 ACCT_CASH_SHORT 를 넣지 않음(있던 것은 풀림).',
   false, '^(on|off)$', 'on')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_cashflow', 1440, 9, 20, NULL, true, '자금 흐름 90일 — 매일 09:20 · 가장 낮은 날 잔액이 acct.cash_floor 밑이면 ACCT_CASH_SHORT(하루 한 번 · 넉넉해지면 풀림) · D245 · v10.394')
ON CONFLICT (job) DO NOTHING;

/* ── v10.395 (docs/532) 직판 재고 수불부 — 이동평균 · 매출원가 전표 ──
 *   판매용 재고(hlt_product_options.stock)는 그대로 · 이 표는 회계용 원가 장부(옵션마다).
 *   계산(남은 수량 · 금액 · 평균 · 원가 0 출고)은 트리거가 함 · 쌓기만 · 고치기는 실사 조정(ADJUST)으로.
 *   매입 번호 purchase_id 는 숫자만(⑫ acct_purchases 와 FK 없음 — 매입 전표가 「상품」으로 잡았으면 입고 전표 없음). */
CREATE TABLE IF NOT EXISTS public.acct_stock_moves (
  id              bigserial PRIMARY KEY,
  option_id       uuid NOT NULL REFERENCES public.hlt_product_options(id),
  product_id      uuid REFERENCES public.hlt_products(id),
  moved_on        date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('IN', 'OUT_SALE', 'RETURN', 'ADJUST')),
  qty             integer NOT NULL,
  unit_cost       numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  amount          bigint NOT NULL,
  qty_after       integer NOT NULL CHECK (qty_after >= 0),
  amount_after    bigint NOT NULL CHECK (amount_after >= 0),
  avg_cost_after  numeric(14,2) NOT NULL DEFAULT 0,
  zero_cost       boolean NOT NULL DEFAULT false,
  source_key      text NOT NULL CHECK (char_length(source_key) BETWEEN 1 AND 80),
  purchase_id     bigint,
  note            text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by      uuid REFERENCES public.accounts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_asm_source UNIQUE (kind, source_key),
  CONSTRAINT ck_asm_sign CHECK ((kind IN ('IN', 'RETURN') AND qty > 0) OR (kind = 'OUT_SALE' AND qty < 0) OR (kind = 'ADJUST' AND qty <> 0)),
  CONSTRAINT ck_asm_adjust_note CHECK (kind <> 'ADJUST' OR char_length(coalesce(note, '')) >= 2)
);
CREATE INDEX IF NOT EXISTS ix_asm_option ON public.acct_stock_moves (option_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_asm_product_day ON public.acct_stock_moves (product_id, moved_on);
COMMENT ON TABLE public.acct_stock_moves IS 'v10.395 (D245) 직판 재고 수불부 — 옵션마다 이동평균 원가 · IN 입고 · OUT_SALE 결제 승인 출고(자동) · RETURN 취소 · 반품 반입(자동) · ADJUST 실사 조정(SUPER · 사유) · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_acct_stock_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pq integer; pa bigint; take integer; cost bigint; v_type text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'ACCT_STOCK: 재고 수불부는 쌓기만 합니다 — 실사 조정으로 바로잡으십시오.';
  END IF;
  SELECT o.product_id, s.type INTO NEW.product_id, v_type
    FROM public.hlt_product_options o JOIN public.hlt_products p ON p.id = o.product_id LEFT JOIN public.hlt_sellers s ON s.id = p.seller_id
   WHERE o.id = NEW.option_id;
  IF coalesce(v_type, '') <> 'DIRECT' THEN
    RAISE EXCEPTION 'ACCT_STOCK: 직판 상품만 재고 수불부에 적습니다.';
  END IF;
  /* 옵션마다 차례대로(같은 옵션 동시 입력이 같은 앞 줄을 보지 않게) */
  PERFORM pg_advisory_xact_lock(hashtext('acct_stock:' || NEW.option_id::text));
  SELECT qty_after, amount_after INTO pq, pa FROM public.acct_stock_moves WHERE option_id = NEW.option_id ORDER BY id DESC LIMIT 1;
  pq := coalesce(pq, 0); pa := coalesce(pa, 0);
  NEW.zero_cost := false;

  IF NEW.qty > 0 THEN
    /* 들어옴 — IN(단가 필수) · RETURN(나갈 때 원가 amount 그대로 · 없으면 단가) · ADJUST 늘림(지금 평균 · 재고 없으면 단가 필수) */
    IF NEW.kind = 'IN' AND coalesce(NEW.unit_cost, 0) <= 0 THEN
      RAISE EXCEPTION 'ACCT_STOCK: 입고 단가는 0보다 커야 합니다.';
    END IF;
    IF NEW.kind = 'ADJUST' AND coalesce(NEW.unit_cost, 0) <= 0 THEN
      IF pq <= 0 THEN RAISE EXCEPTION 'ACCT_STOCK: 재고가 없을 때 늘리는 조정은 단가가 있어야 합니다.'; END IF;
      NEW.unit_cost := round(pa::numeric / pq, 2);
    END IF;
    IF NEW.kind = 'RETURN' AND NEW.amount IS NOT NULL AND NEW.amount >= 0 THEN
      NEW.unit_cost := round(NEW.amount::numeric / NEW.qty, 2);
    ELSE
      NEW.unit_cost := coalesce(NEW.unit_cost, 0);
      NEW.amount := round(NEW.qty * NEW.unit_cost);
    END IF;
    NEW.qty_after := pq + NEW.qty;
    NEW.amount_after := pa + NEW.amount;
  ELSE
    /* 나감 — 평균 단가로 · 모자라면 남은 만큼만 원가 · 나머지는 원가 0(판매는 막지 않음) · 실사 줄임은 0 아래 못 감 */
    IF NEW.kind = 'ADJUST' AND pq + NEW.qty < 0 THEN
      RAISE EXCEPTION 'ACCT_STOCK: 실사 조정으로 재고가 0 아래로 갈 수 없습니다(지금 %개).', pq;
    END IF;
    take := least(-NEW.qty, greatest(pq, 0));
    cost := CASE WHEN take >= pq THEN pa ELSE round(pa::numeric * take / pq)::bigint END;
    NEW.zero_cost := take < -NEW.qty;
    NEW.amount := -cost;
    NEW.unit_cost := round(cost::numeric / (-NEW.qty), 2);
    NEW.qty_after := pq - take;
    NEW.amount_after := pa - cost;
  END IF;
  NEW.avg_cost_after := CASE WHEN NEW.qty_after > 0 THEN round(NEW.amount_after::numeric / NEW.qty_after, 2) ELSE 0 END;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_acct_stock_move' AND tgrelid = 'public.acct_stock_moves'::regclass) THEN
    CREATE TRIGGER trg_acct_stock_move BEFORE INSERT OR UPDATE OR DELETE ON public.acct_stock_moves FOR EACH ROW EXECUTE FUNCTION public.fn_acct_stock_move();
  END IF;
END $$;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('acct_stock', 60, NULL, NULL, NULL, true, '직판 재고 수불부 — 결제 승인 → 출고 · 취소 · 반품 → 반입(이동평균 원가) · 재고 없이 나가면 STOCK_NEGATIVE · D245 · v10.395')
ON CONFLICT (job) DO NOTHING;


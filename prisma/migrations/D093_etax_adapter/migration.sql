-- =====================================================================
-- D093 — v10.34 국세청 전자세금계산서 전송: 연결 자리(어댑터) + 간주 모드 (2026-10-11 대표 결정)
--
--   업체(ASP · 예: 팝빌 · 바로빌)는 아직 정하지 않았고 계약 · 공동인증서 · 키가 없습니다.
--   그래서 「연결 자리」만 만듭니다 — 다른 외부 연동(BANK · BROKER · PG)과 같은 모양:
--     ① integrations 에 ETAX(오픈 차단 · NOT_STARTED · 키 이름 ETAX_KEY — 값은 환경 변수에만)
--     ② 설정 assume.etax (기본 on) — 국세청에 보내지 않고 「간주 발행」으로 기록합니다.
--        assume.% 이므로 v_open_blockers(오픈 체크리스트 「간주 모드 켜짐」)에 저절로 올라갑니다 — 연동 뒤 off 필수.
--     ③ 대상 두 표에 전송 결과 칸(etax_*) — 소개뱅크(운영 법인)가 발행하는 세금계산서만:
--          consult_directory_invoices (v10.33 · D092 법률 · 세무 정액 노출료)
--          lead_cash_invoices         (D076 리드 이용료)
--        소개자가 발행하는 정산 세금계산서(settlements.tax_invoice_*)는 발행 주체가 소개자라 대상이 아닙니다(손대지 않음).
--     ④ 전송 기록 etax_send_log (append-only) — 시도마다 1줄(어댑터 · 결과 · 오류 · 걸린 시간 · 누가).
--
--   간주 발행은 승인번호를 지어내지 않습니다 — etax_approval_no 는 비고(NULL), 내부 문서 번호(etax_doc_key)와 「간주」 표시만 남습니다.
--   손으로 번호 넣기(연동 전 임시 방식)는 etax_mode = 'MANUAL' 로 구분합니다.
--   재실행 안전.
-- =====================================================================

/* ── ① 외부 연동 표 ─────────────────────────────────────────────────── */
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, secret_key_name, lead_time_weeks, blocks_open, memo, sort_order)
VALUES ('ETAX', '전자세금계산서', '국세청 전자세금계산서 전송 — 소개뱅크(운영 법인)가 발행하는 세금계산서(법률 · 세무 정액 노출료 · 리드 이용료)',
        NULL, 'NOT_STARTED', true, 'ETAX_KEY', NULL, true,
        '업체(ASP) 미정 — 계약 · 공동인증서 · 키 없음. 연동 전에는 assume.etax(간주) — 국세청에 보내지 않고 「간주 발행」으로 기록합니다. 업체를 정하면 docs/전자세금계산서_연동절차.md (v10.34 · D093)',
        coalesce((SELECT max(sort_order) + 10 FROM public.integrations), 110))
ON CONFLICT (code) DO NOTHING;

/* ── ② 간주 스위치 ─────────────────────────────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('assume.etax', 'on', 'GLOBAL',
        '전자세금계산서 간주 모드. **on 이면 국세청에 전송하지 않습니다** — 운영이 「발행」을 누르면 「간주 발행」으로만 기록합니다(승인번호 없음). 업체(ASP) 연동 · 시험 전송을 마친 뒤 off 로 바꾸십시오. on 인 채로는 열 수 없습니다.',
        false, '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

/* ── ③ 전송 결과 칸 — 두 표에 같은 이름 · 같은 규칙 ──────────────────── */
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consult_directory_invoices', 'lead_cash_invoices'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS etax_mode        text,
      ADD COLUMN IF NOT EXISTS etax_status      text,
      ADD COLUMN IF NOT EXISTS etax_doc_key     text,
      ADD COLUMN IF NOT EXISTS etax_approval_no text,
      ADD COLUMN IF NOT EXISTS etax_amend_approval_no text,
      ADD COLUMN IF NOT EXISTS etax_error       text,
      ADD COLUMN IF NOT EXISTS etax_attempts    int NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS etax_adapter     text,
      ADD COLUMN IF NOT EXISTS etax_sent_at     timestamptz,
      ADD COLUMN IF NOT EXISTS etax_result_at   timestamptz', t);
    /* 제약은 이름으로 한 번만 */
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_' || t || '_etax') THEN
      EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
          (etax_mode IS NULL OR etax_mode IN ('MANUAL','ASSUMED','ASP'))
      AND (etax_status IS NULL OR etax_status IN ('ASSUMED','SENDING','SENT','FAILED','CANCELED'))
      AND (etax_adapter IS NULL OR etax_adapter IN ('assume','http'))
      AND (etax_approval_no IS NULL OR etax_approval_no ~ '^[0-9]{24}$')
      AND (etax_amend_approval_no IS NULL OR etax_amend_approval_no ~ '^[0-9]{24}$')
      AND (etax_status IS DISTINCT FROM 'SENT' OR etax_approval_no IS NOT NULL)
      AND (etax_status IS DISTINCT FROM 'ASSUMED' OR (etax_approval_no IS NULL AND etax_mode = 'ASSUMED'))
      AND (etax_mode IS DISTINCT FROM 'MANUAL' OR etax_status IS NULL)
      AND (etax_status IS NULL OR etax_doc_key IS NOT NULL)
      AND etax_attempts >= 0)$f$, t, 'ck_' || t || '_etax');
    END IF;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (etax_doc_key) WHERE etax_doc_key IS NOT NULL', 'ux_' || t || '_etax_doc', t);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (etax_approval_no) WHERE etax_approval_no IS NOT NULL', 'ux_' || t || '_etax_appr', t);
  END LOOP;
END $$;

COMMENT ON COLUMN public.consult_directory_invoices.etax_mode IS 'v10.34 발행 방식 — MANUAL(연동 전 임시 · 손으로 번호) · ASSUMED(간주 발행 · 국세청 전송 없음) · ASP(업체 어댑터로 전송) (D093)';
COMMENT ON COLUMN public.consult_directory_invoices.etax_status IS 'v10.34 국세청 전송 상태 — ASSUMED · SENDING(보내는 중 · 승인 대기) · SENT · FAILED · CANCELED. 손으로 넣은 줄은 비움 (D093)';
COMMENT ON COLUMN public.consult_directory_invoices.etax_doc_key IS 'v10.34 우리 쪽 문서 번호(업체에 보내는 관리 번호) — 다시 보내도 같은 번호라 업체 쪽 중복 발행을 막습니다 (D093)';
COMMENT ON COLUMN public.consult_directory_invoices.etax_approval_no IS 'v10.34 국세청 승인번호 24자리(숫자만 저장 · 화면은 8-8-8). 간주 발행이면 비어 있습니다 — 지어내지 않습니다 (D093)';
COMMENT ON COLUMN public.consult_directory_invoices.etax_amend_approval_no IS 'v10.34 취소 · 수정 발행 때 업체가 돌려준 수정세금계산서 승인번호 (D093)';
COMMENT ON COLUMN public.consult_directory_invoices.etax_error IS 'v10.34 마지막 전송 실패 사유(업체 문구 · 시간 초과 등 — 키 · 개인정보 없음) (D093)';
COMMENT ON COLUMN public.lead_cash_invoices.etax_mode IS 'v10.34 발행 방식 — MANUAL · ASSUMED · ASP (D093 · consult_directory_invoices 와 같은 규칙)';
COMMENT ON COLUMN public.lead_cash_invoices.etax_status IS 'v10.34 국세청 전송 상태 — ASSUMED · SENDING · SENT · FAILED · CANCELED (D093)';
COMMENT ON COLUMN public.lead_cash_invoices.etax_doc_key IS 'v10.34 우리 쪽 문서 번호(업체 관리 번호 · 중복 발행 막음) (D093)';
COMMENT ON COLUMN public.lead_cash_invoices.etax_approval_no IS 'v10.34 국세청 승인번호 24자리 — 간주 발행이면 비어 있음 (D093)';

/* 이미 손으로 번호를 넣어 발행된 줄은 「손으로(MANUAL)」로 표시합니다 — 국세청 전송 기록이 없다는 사실 그대로 */
UPDATE public.lead_cash_invoices SET etax_mode = 'MANUAL' WHERE state = 'ISSUED' AND etax_mode IS NULL;
-- consult_directory_invoices 는 발행된 줄을 고칠 수 없게 막혀 있어(아래 가드) 가드를 바꾼 뒤 채웁니다.

/* ── 법률 · 세무 노출료 세금계산서 가드 — 발행된 줄은 그대로, 전송 결과(etax_*)만 기록할 수 있게 ── */
CREATE OR REPLACE FUNCTION public.fn_directory_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table: consult_directory_invoices — 세금계산서 발행 요청은 지울 수 없습니다';
  END IF;
  /* v10.34 (D093) — 발행된 줄은 발행 칸 · 금액 · 당사자를 고칠 수 없습니다. 국세청 전송 결과(etax_*)만 적습니다 */
  IF OLD.state = 'ISSUED' AND
     (NEW.state, NEW.invoice_no, NEW.issued_on, NEW.issued_by, NEW.issued_at,
      NEW.period_id, NEW.entry_id, NEW.partner_id, NEW.supplier_name, NEW.supplier_biz_no, NEW.buyer_name, NEW.buyer_biz_no,
      NEW.supply, NEW.vat, NEW.total, NEW.created_at)
     IS DISTINCT FROM
     (OLD.state, OLD.invoice_no, OLD.issued_on, OLD.issued_by, OLD.issued_at,
      OLD.period_id, OLD.entry_id, OLD.partner_id, OLD.supplier_name, OLD.supplier_biz_no, OLD.buyer_name, OLD.buyer_biz_no,
      OLD.supply, OLD.vat, OLD.total, OLD.created_at) THEN
    RAISE EXCEPTION 'DIRECTORY_INVOICE_ISSUED: 이미 발행된 세금계산서입니다(번호 %)', OLD.invoice_no;
  END IF;
  IF (NEW.period_id, NEW.entry_id, NEW.partner_id, NEW.supplier_name, NEW.supplier_biz_no, NEW.buyer_name, NEW.buyer_biz_no,
      NEW.supply, NEW.vat, NEW.total, NEW.created_at)
     IS DISTINCT FROM
     (OLD.period_id, OLD.entry_id, OLD.partner_id, OLD.supplier_name, OLD.supplier_biz_no, OLD.buyer_name, OLD.buyer_biz_no,
      OLD.supply, OLD.vat, OLD.total, OLD.created_at) THEN
    RAISE EXCEPTION 'DIRECTORY_INVOICE_FIXED: 금액 · 공급자 · 공급받는 자는 고칠 수 없습니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

UPDATE public.consult_directory_invoices SET etax_mode = 'MANUAL' WHERE state = 'ISSUED' AND etax_mode IS NULL;

/* ── 두 표 공통 — 전송 결과 가드: 승인번호 · 문서 번호는 한 번 정해지면 그대로 · 보낸(SENT) 줄은 취소로만 ── */
CREATE OR REPLACE FUNCTION public.fn_etax_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.etax_doc_key IS NOT NULL AND NEW.etax_doc_key IS DISTINCT FROM OLD.etax_doc_key THEN
    RAISE EXCEPTION 'ETAX_FIXED: 문서 번호(%)는 바꿀 수 없습니다 — 다시 보내도 같은 번호를 씁니다', OLD.etax_doc_key;
  END IF;
  IF OLD.etax_approval_no IS NOT NULL AND NEW.etax_approval_no IS DISTINCT FROM OLD.etax_approval_no THEN
    RAISE EXCEPTION 'ETAX_FIXED: 국세청 승인번호는 바꾸거나 지울 수 없습니다';
  END IF;
  IF OLD.etax_status = 'SENT' AND NEW.etax_status NOT IN ('SENT', 'CANCELED') THEN
    RAISE EXCEPTION 'ETAX_SENT: 국세청에 보낸 세금계산서는 취소 · 수정 발행으로만 바꿉니다';
  END IF;
  IF OLD.etax_status = 'CANCELED' AND NEW.etax_status IS DISTINCT FROM 'CANCELED' THEN
    RAISE EXCEPTION 'ETAX_SENT: 취소된 세금계산서는 되돌릴 수 없습니다';
  END IF;
  IF OLD.etax_mode = 'MANUAL' AND NEW.etax_mode IS DISTINCT FROM 'MANUAL' THEN
    RAISE EXCEPTION 'ETAX_MANUAL: 손으로 발행 번호를 넣은 줄은 전송하지 않습니다 — 중복 발행이 됩니다';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dir_invoice_etax ON public.consult_directory_invoices;
CREATE TRIGGER trg_dir_invoice_etax BEFORE UPDATE ON public.consult_directory_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_etax_guard();
DROP TRIGGER IF EXISTS trg_lead_cash_invoice_etax ON public.lead_cash_invoices;
CREATE TRIGGER trg_lead_cash_invoice_etax BEFORE UPDATE ON public.lead_cash_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_etax_guard();

/* ── ④ 전송 기록 — 시도마다 1줄 · 고치거나 지울 수 없음 ───────────────── */
CREATE TABLE IF NOT EXISTS public.etax_send_log (
  id            bigserial PRIMARY KEY,
  invoice_kind  text NOT NULL CHECK (invoice_kind IN ('DIRECTORY', 'LEAD_CASH')),
  invoice_id    uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('ISSUE', 'STATUS', 'CANCEL')),
  adapter       text NOT NULL CHECK (adapter IN ('assume', 'http')),
  doc_key       text NOT NULL,
  result        text NOT NULL CHECK (result IN ('ASSUMED', 'SENDING', 'SENT', 'FAILED', 'CANCELED', 'NOT_FOUND')),
  approval_no   text CHECK (approval_no IS NULL OR approval_no ~ '^[0-9]{24}$'),
  error_kind    text,
  error         text,
  http_status   int,
  duration_ms   int,
  actor_id      uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_etax_log_invoice ON public.etax_send_log (invoice_kind, invoice_id, created_at DESC);
COMMENT ON TABLE public.etax_send_log IS
  'v10.34 전자세금계산서 전송 시도 기록(D093) — 발행 · 상태 조회 · 취소마다 1줄. 어댑터(assume 간주 · http 업체) · 결과 · 오류 · 걸린 시간 · 누가. 키 · 요청 본문은 남기지 않습니다. 고치거나 지울 수 없습니다.';

CREATE OR REPLACE FUNCTION public.fn_etax_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: etax_send_log — 전송 기록은 고치거나 지울 수 없습니다';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_etax_log_append_only ON public.etax_send_log;
CREATE TRIGGER trg_etax_log_append_only BEFORE UPDATE OR DELETE ON public.etax_send_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_etax_log_append_only();

COMMENT ON TABLE public.consult_directory_invoices IS
  'v10.33 법률 · 세무 정액 노출료 세금계산서 발행 요청(입금 확인마다 1건). 공급자 = 소개하는 자(운영 법인) · 공급받는 자 = 노출료를 낸 업체(그때의 상호 · 사업자번호). 운영이 「발행」(v10.34 어댑터 — 간주 또는 업체 전송 · etax_*) 또는 발행 번호를 손으로 넣으면(MANUAL) ISSUED.';
COMMENT ON TABLE public.lead_cash_invoices IS
  '리드 이용료 세금계산서 발행 요청(D076) — 달마다 유상 잔액 실사용액(부가세 포함 금액을 공급가액 · 세액으로 나눔). v10.34 국세청 전송 결과 etax_*(D093).';

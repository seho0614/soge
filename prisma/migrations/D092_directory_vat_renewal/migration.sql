-- =====================================================================
-- D092 — v10.33 법률 · 세무 월 정액 노출: 부가세 별도 · 기간 연장(A안) · 세금계산서 (2026-10-11 대표 결정)
--
--   ① 월 노출료 300,000원 **부가세 별도** — 「월 300,000원 (부가세 별도)」.
--      부가세 = 공급가액 × 10% · 1원 미만 절사(fn_directory_vat). 합계 = 공급가액 + 부가세.
--      consult_directory_entries 에 최근 입금의 개월수 · 공급가액 · 부가세 · 합계를 둡니다.
--   ② 기간 연장 A안 — 노출 중(ACTIVE) 업체가 「연장 신청」(개월수) → RENEW_REQUESTED(노출은 계속)
--      → 운영 입금 확인 → 새 기간 = 기존 종료일 다음 날부터. 금액은 연장 신청 때의 기준 금액(v10.12 규칙 —
--      기준 금액을 바꿔도 이미 켠 노출 · 이미 낸 신청의 금액은 그대로). 반려는 사유 5자 이상.
--      기간 이력(consult_directory_periods)은 지우거나 고칠 수 없고, 겹치면 DB 가 거부합니다(EXCLUDE) ·
--      연장은 이전 종료일 다음 날에서만 시작합니다(빈 날 없음).
--      만료 7일 전 업체에 안내(fn_notify → 알림 · notify_dispatch 가 메일로) · 연장 입금 확인 없이 종료일이
--      지나면 자동 종료(정기 작업 directory_expiry).
--   ③ 세금계산서 — 입금 확인(처음 · 연장)마다 발행 요청 1줄(consult_directory_invoices).
--      공급자 = 소개하는 자(운영 법인 · 설정 footer.company_name · footer.biz_reg_no) → 공급받는 자 = 노출료를 낸 업체.
--      운영이 발행 번호 · 발행일을 넣으면 「발행됨」. 국세청 전자세금계산서 연동은 하지 않습니다(오픈 차단 외부 연동 영역).
--      선례: D076 lead_cash_invoices 와 같은 모양.
--   ④ 매출(D081 v_monthly_revenue) — 노출료 매출은 **공급가액**(부가세는 매출이 아님) · 입금 확인 달.
--      이 마이그레이션 전에 켠 항목은 「이전 기록(LEGACY)」 회차로 옮기고 매출 계산은 전과 같게 둡니다.
--
--   소개 대가 금지(D019) 그대로 — 기간 정액만, 클릭 · 연락 · 성사 건수와 잇는 칸 없음.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

/* ── 0. 계산 규칙 (한곳) ─────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION public.fn_directory_vat(p_supply numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT floor(p_supply * 0.1)::bigint $$;
COMMENT ON FUNCTION public.fn_directory_vat(numeric) IS 'v10.33 — 정액 노출료 부가세 = 공급가액 × 10% · 1원 미만 절사';

CREATE OR REPLACE FUNCTION public.fn_directory_period_to(p_from date, p_months int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$ SELECT ((p_from + make_interval(months => p_months))::date - 1) $$;
COMMENT ON FUNCTION public.fn_directory_period_to(date, int) IS 'v10.33 — 시작일부터 N개월 노출의 마지막 날(다음 회차는 그 다음 날부터)';

/* ── 1. 노출 항목 — 부가세 · 개월수 · 연장 신청 상태 ─────────────────── */
ALTER TABLE public.consult_directory_entries
  ADD COLUMN IF NOT EXISTS months            int,
  ADD COLUMN IF NOT EXISTS supply_amount     bigint,
  ADD COLUMN IF NOT EXISTS vat_amount        bigint,
  ADD COLUMN IF NOT EXISTS total_amount      bigint,
  ADD COLUMN IF NOT EXISTS end_notice_for date;
COMMENT ON COLUMN public.consult_directory_entries.monthly_fee   IS '월 노출료 공급가액(원 · 부가세 별도). 최근 입금 확인 때의 금액';
COMMENT ON COLUMN public.consult_directory_entries.months        IS 'v10.33 최근 입금 확인의 개월수(1~12)';
COMMENT ON COLUMN public.consult_directory_entries.supply_amount IS 'v10.33 최근 입금 확인의 공급가액 = 월 노출료 × 개월수';
COMMENT ON COLUMN public.consult_directory_entries.vat_amount    IS 'v10.33 최근 입금 확인의 부가세 = 공급가액 × 10%(1원 미만 절사)';
COMMENT ON COLUMN public.consult_directory_entries.total_amount  IS 'v10.33 최근 입금 확인의 합계(입금액) = 공급가액 + 부가세';
COMMENT ON COLUMN public.consult_directory_entries.paid_from     IS '이어진 노출 기간의 첫날(연장하면 그대로)';
COMMENT ON COLUMN public.consult_directory_entries.paid_to       IS '확인된 마지막 회차의 마지막 날(연장하면 늘어남)';
COMMENT ON COLUMN public.consult_directory_entries.end_notice_for IS 'v10.33 만료 7일 전 안내를 보낸 종료일(같은 종료일에 두 번 보내지 않음)';

ALTER TABLE public.consult_directory_entries DROP CONSTRAINT IF EXISTS consult_directory_entries_state_check;
ALTER TABLE public.consult_directory_entries ADD CONSTRAINT consult_directory_entries_state_check
  CHECK (state IN ('PENDING','ACTIVE','RENEW_REQUESTED','ENDED','REJECTED'));
ALTER TABLE public.consult_directory_entries DROP CONSTRAINT IF EXISTS ck_directory_active;
ALTER TABLE public.consult_directory_entries ADD CONSTRAINT ck_directory_active
  CHECK (state NOT IN ('ACTIVE','RENEW_REQUESTED') OR (monthly_fee IS NOT NULL AND paid_from IS NOT NULL
        AND paid_to IS NOT NULL AND paid_to >= paid_from AND length(btrim(coalesce(payment_ref, ''))) > 0));
ALTER TABLE public.consult_directory_entries DROP CONSTRAINT IF EXISTS ck_directory_amounts;
ALTER TABLE public.consult_directory_entries ADD CONSTRAINT ck_directory_amounts
  CHECK ((months IS NULL AND supply_amount IS NULL AND vat_amount IS NULL AND total_amount IS NULL)
      OR (months BETWEEN 1 AND 12 AND supply_amount > 0 AND supply_amount = monthly_fee * months
          AND vat_amount = public.fn_directory_vat(supply_amount) AND total_amount = supply_amount + vat_amount));

/* 노출 판정 — ACTIVE 와 RENEW_REQUESTED(연장 신청 중 · 노출 계속)를 같은 「켜진」 상태로 봅니다 */
CREATE OR REPLACE FUNCTION public.fn_directory_guard() RETURNS trigger AS $$
DECLARE v_mode text; v_qual text; v_biz uuid; v_pstatus text; v_on boolean; v_was_on boolean;
BEGIN
  SELECT c.consult_mode, coalesce(r.qual_code, r.code)
    INTO v_mode, v_qual
    FROM categories c
    LEFT JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
   WHERE c.id = NEW.category_id AND c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED';
  IF v_mode IS DISTINCT FROM 'LISTING_FEE' THEN
    RAISE EXCEPTION 'DIRECTORY_CATEGORY: 정액 노출은 법률 · 세무 같은 정액 노출형 업종에서만 씁니다';
  END IF;
  v_on := NEW.state IN ('ACTIVE','RENEW_REQUESTED');
  v_was_on := TG_OP = 'UPDATE' AND OLD.state IN ('ACTIVE','RENEW_REQUESTED');
  IF v_on AND (NOT v_was_on OR OLD.paid_to IS DISTINCT FROM NEW.paid_to) THEN
    SELECT p.business_id, p.status INTO v_biz, v_pstatus FROM partners p WHERE p.id = NEW.partner_id;
    IF v_pstatus IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'DIRECTORY_PARTNER: 입점 승인된 파트너만 노출할 수 있습니다';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM mal_partner_axes ax WHERE ax.business_id = v_biz AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED') THEN
      RAISE EXCEPTION 'DIRECTORY_AXIS: 안심소개 상담 축 입점 승인이 먼저입니다';
    END IF;
    IF v_qual IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM qualification_reviews q WHERE q.business_id = v_biz AND q.category_code = v_qual AND q.state = 'APPROVED') THEN
      RAISE EXCEPTION 'DIRECTORY_QUALIFICATION: 자격 심사(%)를 통과해야 노출할 수 있습니다', v_qual;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

/* ── 2. 연장 신청 ────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS public.consult_directory_renewals (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id      uuid NOT NULL REFERENCES public.consult_directory_entries(id),
  months        int  NOT NULL CHECK (months BETWEEN 1 AND 12),
  monthly_fee   numeric NOT NULL CHECK (monthly_fee > 0 AND monthly_fee = trunc(monthly_fee)),
  supply_amount bigint NOT NULL,
  vat_amount    bigint NOT NULL,
  total_amount  bigint NOT NULL,
  state         text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','CONFIRMED','REJECTED','CANCELED')),
  requested_by  uuid REFERENCES public.accounts(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  payment_ref   text,
  reason        text,
  decided_by    uuid REFERENCES public.accounts(id),
  decided_at    timestamptz,
  CONSTRAINT ck_dir_renew_amounts CHECK (supply_amount = monthly_fee * months AND vat_amount = public.fn_directory_vat(supply_amount)
                                         AND total_amount = supply_amount + vat_amount),
  CONSTRAINT ck_dir_renew_confirm CHECK (state <> 'CONFIRMED' OR length(btrim(coalesce(payment_ref, ''))) > 0),
  CONSTRAINT ck_dir_renew_reject  CHECK (state NOT IN ('REJECTED','CANCELED') OR length(btrim(coalesce(reason, ''))) >= 5),
  CONSTRAINT ck_dir_renew_decided CHECK (state = 'REQUESTED' OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dir_renewal_open ON public.consult_directory_renewals(entry_id) WHERE state = 'REQUESTED';
COMMENT ON TABLE public.consult_directory_renewals IS
  'v10.33 정액 노출 연장 신청(A안). 신청 때의 기준 금액 · 개월수 · 공급가액 · 부가세 · 합계를 그대로 적습니다. 열린 신청은 항목마다 하나. 반려 · 취소는 사유 5자 이상.';

/* ── 3. 노출 기간 이력(회차) — 지우거나 고칠 수 없음 · 겹치지 않음 · 연장은 빈 날 없이 ── */
CREATE TABLE IF NOT EXISTS public.consult_directory_periods (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id      uuid NOT NULL REFERENCES public.consult_directory_entries(id),
  seq           int  NOT NULL CHECK (seq >= 1),
  kind          text NOT NULL CHECK (kind IN ('INITIAL','RENEWAL','LEGACY')),
  renewal_id    uuid UNIQUE REFERENCES public.consult_directory_renewals(id),
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  months        int,
  monthly_fee   numeric,
  supply_amount bigint,
  vat_amount    bigint,
  total_amount  bigint,
  payment_ref   text,
  confirmed_by  uuid,
  confirmed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, seq),
  CONSTRAINT ck_dir_period_range CHECK (period_to >= period_from),
  CONSTRAINT ck_dir_period_paid CHECK (kind = 'LEGACY' OR (
       months BETWEEN 1 AND 12 AND monthly_fee > 0 AND monthly_fee = trunc(monthly_fee)
   AND supply_amount = monthly_fee * months AND vat_amount = public.fn_directory_vat(supply_amount)
   AND total_amount = supply_amount + vat_amount AND length(btrim(coalesce(payment_ref, ''))) > 0
   AND period_to = public.fn_directory_period_to(period_from, months))),
  CONSTRAINT ck_dir_period_renewal CHECK ((kind = 'RENEWAL') = (renewal_id IS NOT NULL)),
  CONSTRAINT ex_dir_period_overlap EXCLUDE USING gist (entry_id WITH =, daterange(period_from, period_to, '[]') WITH &&)
);
COMMENT ON TABLE public.consult_directory_periods IS
  'v10.33 정액 노출 기간 이력(회차). 입금 확인마다 1줄(INITIAL 처음 · RENEWAL 연장 · LEGACY D092 전 기록). 같은 항목의 기간은 겹칠 수 없고(EXCLUDE) 연장은 이전 종료일 다음 날부터만. 지우거나 고칠 수 없습니다.';

CREATE OR REPLACE FUNCTION public.fn_directory_period_before() RETURNS trigger AS $$
DECLARE v_seq int; v_last date; v_paid_to date;
BEGIN
  SELECT paid_to INTO v_paid_to FROM consult_directory_entries WHERE id = NEW.entry_id FOR UPDATE;
  SELECT max(seq), max(period_to) INTO v_seq, v_last FROM consult_directory_periods WHERE entry_id = NEW.entry_id;
  NEW.seq := coalesce(v_seq, 0) + 1;
  /* 연장은 「지금 노출의 마지막 날」 다음 날부터 — 이력이 없는 옛 항목(시드 등)은 항목의 종료일을 씁니다 */
  IF NEW.kind = 'RENEWAL' THEN v_last := greatest(v_last, v_paid_to); END IF;
  IF NEW.kind = 'RENEWAL' AND (v_last IS NULL OR NEW.period_from <> v_last + 1) THEN
    RAISE EXCEPTION 'DIRECTORY_PERIOD_CHAIN: 연장 기간은 이전 종료일(%)의 다음 날부터여야 합니다 — 겹치거나 빈 날이 생깁니다', coalesce(v_last::text, '없음');
  END IF;
  IF NEW.kind = 'INITIAL' AND v_last IS NOT NULL AND NEW.period_from <= v_last THEN
    RAISE EXCEPTION 'DIRECTORY_PERIOD_OVERLAP: 이전 노출 기간(~%)과 겹칩니다 — % 부터 켤 수 있습니다', v_last, v_last + 1;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dir_period_before ON public.consult_directory_periods;
CREATE TRIGGER trg_dir_period_before BEFORE INSERT ON public.consult_directory_periods
  FOR EACH ROW EXECUTE FUNCTION public.fn_directory_period_before();

CREATE OR REPLACE FUNCTION public.fn_directory_period_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: consult_directory_periods — 노출 기간 이력은 고치거나 지울 수 없습니다';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dir_period_immutable ON public.consult_directory_periods;
CREATE TRIGGER trg_dir_period_immutable BEFORE UPDATE OR DELETE ON public.consult_directory_periods
  FOR EACH ROW EXECUTE FUNCTION public.fn_directory_period_immutable();

/* ── 4. 세금계산서 발행 요청 — 입금 확인(처음 · 연장)마다 1줄 ─────────── */
CREATE TABLE IF NOT EXISTS public.consult_directory_invoices (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id       uuid NOT NULL UNIQUE REFERENCES public.consult_directory_periods(id),
  entry_id        uuid NOT NULL REFERENCES public.consult_directory_entries(id),
  partner_id      uuid NOT NULL REFERENCES public.partners(id),
  supplier_name   text NOT NULL,
  supplier_biz_no text NOT NULL,
  buyer_name      text NOT NULL,
  buyer_biz_no    text NOT NULL,
  supply          bigint NOT NULL CHECK (supply > 0),
  vat             bigint NOT NULL CHECK (vat >= 0),
  total           bigint NOT NULL,
  state           text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED','ISSUED')),
  invoice_no      text UNIQUE,
  issued_on       date,
  issued_by       uuid REFERENCES public.accounts(id),
  issued_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_dci_sum    CHECK (supply + vat = total AND vat = public.fn_directory_vat(supply)),
  CONSTRAINT ck_dci_issued CHECK (state <> 'ISSUED' OR (length(btrim(coalesce(invoice_no, ''))) > 0 AND issued_on IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_dci_partner ON public.consult_directory_invoices(partner_id, created_at DESC);
COMMENT ON TABLE public.consult_directory_invoices IS
  'v10.33 법률 · 세무 정액 노출료 세금계산서 발행 요청(입금 확인마다 1건). 공급자 = 소개하는 자(운영 법인) · 공급받는 자 = 노출료를 낸 업체(그때의 상호 · 사업자번호). 운영이 발행 번호를 넣으면 ISSUED. 국세청 전송 연동 전.';

CREATE OR REPLACE FUNCTION public.fn_directory_invoice_on_period() RETURNS trigger AS $$
DECLARE v_sname text; v_sno text; v_pid uuid; v_bname text; v_bno text;
BEGIN
  SELECT nullif(btrim(value), '') INTO v_sname FROM site_settings WHERE key = 'footer.company_name';
  SELECT nullif(btrim(value), '') INTO v_sno   FROM site_settings WHERE key = 'footer.biz_reg_no';
  IF v_sname IS NULL OR v_sno IS NULL THEN
    RAISE EXCEPTION 'DIRECTORY_INVOICE: 세금계산서 공급자(운영 법인) 정보가 없습니다 — 설정 footer.company_name · footer.biz_reg_no 를 먼저 채워 주십시오';
  END IF;
  SELECT p.id, b.company_name, b.biz_reg_no INTO v_pid, v_bname, v_bno
    FROM consult_directory_entries d JOIN partners p ON p.id = d.partner_id JOIN businesses b ON b.id = p.business_id
   WHERE d.id = NEW.entry_id;
  INSERT INTO consult_directory_invoices (period_id, entry_id, partner_id, supplier_name, supplier_biz_no,
                                          buyer_name, buyer_biz_no, supply, vat, total)
  VALUES (NEW.id, NEW.entry_id, v_pid, v_sname, v_sno, v_bname, v_bno, NEW.supply_amount, NEW.vat_amount, NEW.total_amount);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dir_period_invoice ON public.consult_directory_periods;
CREATE TRIGGER trg_dir_period_invoice AFTER INSERT ON public.consult_directory_periods
  FOR EACH ROW WHEN (NEW.kind <> 'LEGACY') EXECUTE FUNCTION public.fn_directory_invoice_on_period();

/* 발행 요청 → 발행됨 한 번만. 금액 · 당사자는 고칠 수 없고 줄을 지울 수 없습니다 */
CREATE OR REPLACE FUNCTION public.fn_directory_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table: consult_directory_invoices — 세금계산서 발행 요청은 지울 수 없습니다';
  END IF;
  IF OLD.state = 'ISSUED' THEN
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
DROP TRIGGER IF EXISTS trg_dir_invoice_guard ON public.consult_directory_invoices;
CREATE TRIGGER trg_dir_invoice_guard BEFORE UPDATE OR DELETE ON public.consult_directory_invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_directory_invoice_guard();

/* ── 5. 지금 켜진 항목의 이전 기록을 1회차(LEGACY)로 옮김 — 금액을 지어내지 않습니다(개월수 · 부가세 칸은 비움) ── */
INSERT INTO public.consult_directory_periods (entry_id, kind, period_from, period_to, monthly_fee, payment_ref, confirmed_by, confirmed_at)
SELECT d.id, 'LEGACY', d.paid_from, d.paid_to, d.monthly_fee, d.payment_ref, d.decided_by, coalesce(d.decided_at, d.created_at)
  FROM public.consult_directory_entries d
 WHERE d.paid_from IS NOT NULL AND d.paid_to IS NOT NULL AND d.monthly_fee IS NOT NULL AND d.payment_ref IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.consult_directory_periods x WHERE x.entry_id = d.id);

/* ── 6. 처리 함수 — 한 문장(한 트랜잭션)으로 항목 · 회차 · 연장 신청 · 세금계산서 줄이 함께 바뀝니다 ── */

/* 처음 켜기(입금 확인). 금액을 비우면 기준 금액(D020) */
CREATE OR REPLACE FUNCTION public.fn_directory_activate(p_entry uuid, p_fee numeric, p_from date, p_months int, p_ref text, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e consult_directory_entries; v_fee numeric; v_to date; v_supply bigint; v_vat bigint; v_pid uuid;
BEGIN
  SELECT * INTO e FROM consult_directory_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND OR e.state <> 'PENDING' THEN
    RAISE EXCEPTION 'NOT_ACTIVATABLE: 심사 중인 항목만 켤 수 있습니다 — 노출 중인 항목의 기간은 업체의 연장 신청 → 입금 확인으로 늘립니다';
  END IF;
  v_fee := coalesce(p_fee, fn_directory_base_fee());
  IF v_fee IS NULL THEN
    RAISE EXCEPTION 'DIRECTORY_FEE: 기준 금액이 등록돼 있지 않습니다 — 월 노출료를 적거나 기준 금액을 먼저 등록해 주십시오';
  END IF;
  IF v_fee <= 0 OR v_fee <> trunc(v_fee) THEN
    RAISE EXCEPTION 'DIRECTORY_FEE: 월 노출료(공급가액)는 1원 이상 원 단위로 적어 주십시오';
  END IF;
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'DIRECTORY_PERIOD: 개월수는 1~12 입니다';
  END IF;
  IF length(btrim(coalesce(p_ref, ''))) = 0 THEN
    RAISE EXCEPTION 'DIRECTORY_PAYMENT: 입금 확인 근거(입금자 · 거래번호)를 적어 주십시오';
  END IF;
  v_to := fn_directory_period_to(p_from, p_months);
  v_supply := (v_fee * p_months)::bigint; v_vat := fn_directory_vat(v_supply);
  UPDATE consult_directory_entries
     SET state = 'ACTIVE', monthly_fee = v_fee, months = p_months, supply_amount = v_supply, vat_amount = v_vat,
         total_amount = v_supply + v_vat, paid_from = p_from, paid_to = v_to, payment_ref = btrim(p_ref),
         reason = NULL, decided_by = p_actor, decided_at = now(), end_notice_for = NULL
   WHERE id = p_entry;
  INSERT INTO consult_directory_periods (entry_id, kind, period_from, period_to, months, monthly_fee,
                                         supply_amount, vat_amount, total_amount, payment_ref, confirmed_by)
  VALUES (p_entry, 'INITIAL', p_from, v_to, p_months, v_fee, v_supply, v_vat, v_supply + v_vat, btrim(p_ref), p_actor)
  RETURNING id INTO v_pid;
  RETURN v_pid;
END $$;

/* 연장 신청(업체) — 노출 중(ACTIVE)이고 기간이 남아 있을 때. 금액은 지금(신청 때)의 기준 금액 */
CREATE OR REPLACE FUNCTION public.fn_directory_renew_request(p_entry uuid, p_months int, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e consult_directory_entries; v_fee numeric; v_supply bigint; v_vat bigint; v_id uuid;
BEGIN
  SELECT * INTO e FROM consult_directory_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIRECTORY_NOT_FOUND: 정액 노출 항목이 없습니다'; END IF;
  IF e.state = 'RENEW_REQUESTED' THEN
    RAISE EXCEPTION 'DIRECTORY_RENEW_OPEN: 이미 연장 신청을 냈습니다 — 입금이 확인되면 기간이 이어집니다';
  END IF;
  IF e.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'DIRECTORY_RENEW_STATE: 노출 중인 항목만 연장 신청을 할 수 있습니다';
  END IF;
  IF e.paid_to < (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'DIRECTORY_RENEW_LAPSED: 노출 기간이 이미 끝났습니다 — 다시 노출 신청을 해 주십시오';
  END IF;
  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'DIRECTORY_PERIOD: 개월수는 1~12 입니다';
  END IF;
  v_fee := fn_directory_base_fee();
  IF v_fee IS NULL THEN
    RAISE EXCEPTION 'DIRECTORY_FEE: 기준 금액이 등록돼 있지 않아 연장 신청을 받을 수 없습니다 — 고객센터로 문의해 주십시오';
  END IF;
  v_supply := (v_fee * p_months)::bigint; v_vat := fn_directory_vat(v_supply);
  INSERT INTO consult_directory_renewals (entry_id, months, monthly_fee, supply_amount, vat_amount, total_amount, requested_by)
  VALUES (p_entry, p_months, v_fee, v_supply, v_vat, v_supply + v_vat, p_actor) RETURNING id INTO v_id;
  UPDATE consult_directory_entries SET state = 'RENEW_REQUESTED' WHERE id = p_entry;
  RETURN v_id;
END $$;

/* 연장 입금 확인(운영) — 새 기간 = 기존 종료일 다음 날부터 · 금액은 신청 때 적은 금액 */
CREATE OR REPLACE FUNCTION public.fn_directory_renew_confirm(p_entry uuid, p_ref text, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e consult_directory_entries; r consult_directory_renewals; v_last date; v_from date; v_to date; v_pid uuid;
BEGIN
  SELECT * INTO e FROM consult_directory_entries WHERE id = p_entry FOR UPDATE;
  SELECT * INTO r FROM consult_directory_renewals WHERE entry_id = p_entry AND state = 'REQUESTED' FOR UPDATE;
  IF e.id IS NULL OR e.state <> 'RENEW_REQUESTED' OR r.id IS NULL THEN
    RAISE EXCEPTION 'DIRECTORY_RENEW_NONE: 확인할 연장 신청이 없습니다';
  END IF;
  IF length(btrim(coalesce(p_ref, ''))) = 0 THEN
    RAISE EXCEPTION 'DIRECTORY_PAYMENT: 입금 확인 근거(입금자 · 거래번호)를 적어 주십시오';
  END IF;
  SELECT max(period_to) INTO v_last FROM consult_directory_periods WHERE entry_id = p_entry;
  v_from := greatest(v_last, e.paid_to) + 1;   -- 기존 종료일 다음 날(빈 날 · 겹침 없음 — trg_dir_period_before 가 다시 봄)
  v_to := fn_directory_period_to(v_from, r.months);
  UPDATE consult_directory_renewals SET state = 'CONFIRMED', payment_ref = btrim(p_ref), decided_by = p_actor, decided_at = now()
   WHERE id = r.id;
  INSERT INTO consult_directory_periods (entry_id, kind, renewal_id, period_from, period_to, months, monthly_fee,
                                         supply_amount, vat_amount, total_amount, payment_ref, confirmed_by)
  VALUES (p_entry, 'RENEWAL', r.id, v_from, v_to, r.months, r.monthly_fee, r.supply_amount, r.vat_amount, r.total_amount,
          btrim(p_ref), p_actor)
  RETURNING id INTO v_pid;
  UPDATE consult_directory_entries
     SET state = 'ACTIVE', paid_to = v_to, monthly_fee = r.monthly_fee, months = r.months, supply_amount = r.supply_amount,
         vat_amount = r.vat_amount, total_amount = r.total_amount, payment_ref = btrim(p_ref),
         decided_by = p_actor, decided_at = now(), end_notice_for = NULL
   WHERE id = p_entry;
  RETURN v_pid;
END $$;

/* 연장 반려(운영) — 사유 5자 이상 · 노출은 지금 기간까지 그대로 */
CREATE OR REPLACE FUNCTION public.fn_directory_renew_reject(p_entry uuid, p_reason text, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r consult_directory_renewals;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'DIRECTORY_REASON: 사유를 5자 이상 적어 주십시오 — 업체에게 그대로 보입니다';
  END IF;
  PERFORM 1 FROM consult_directory_entries WHERE id = p_entry FOR UPDATE;
  SELECT * INTO r FROM consult_directory_renewals WHERE entry_id = p_entry AND state = 'REQUESTED' FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'DIRECTORY_RENEW_NONE: 반려할 연장 신청이 없습니다'; END IF;
  UPDATE consult_directory_renewals SET state = 'REJECTED', reason = btrim(p_reason), decided_by = p_actor, decided_at = now()
   WHERE id = r.id;
  UPDATE consult_directory_entries SET state = 'ACTIVE' WHERE id = p_entry AND state = 'RENEW_REQUESTED';
  RETURN r.id;
END $$;

/* 반려 · 종료되면 열린 연장 신청을 닫습니다(노출이 끝났으니 입금 확인할 것이 없음) */
CREATE OR REPLACE FUNCTION public.fn_directory_close_renewal() RETURNS trigger AS $$
BEGIN
  UPDATE consult_directory_renewals
     SET state = 'CANCELED', decided_at = now(), decided_by = NEW.decided_by,
         reason = '노출이 끝나 연장 신청을 닫았습니다 — ' || coalesce(NEW.reason, '')
   WHERE entry_id = NEW.id AND state = 'REQUESTED';
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dir_close_renewal ON public.consult_directory_entries;
CREATE TRIGGER trg_dir_close_renewal AFTER UPDATE OF state ON public.consult_directory_entries
  FOR EACH ROW WHEN (NEW.state IN ('ENDED','REJECTED') AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION public.fn_directory_close_renewal();

/* ── 7. 알림 — 만료 7일 전 · 자동 종료 · 연장 처리 결과 (fn_notify → 알림, notify_dispatch 가 메일로) ── */
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis, tone) VALUES
  ('DIRECTORY_EXPIRING',      '정액 노출 만료 7일 전', false, false, '유상 계약 기간 안내', 'warn'),
  ('DIRECTORY_ENDED',         '정액 노출 기간 종료',   false, false, '유상 계약 기간 안내', 'info'),
  ('DIRECTORY_RENEW_DECIDED', '정액 노출 연장 처리',   false, false, '유상 계약 · 입금 확인', 'ok')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables) VALUES
  ('DIRECTORY_EXPIRING_INAPP', 'INAPP', '정액 노출이 {daysLeft}일 뒤 끝납니다',
   '{name}({category}) 노출 기간이 {paidTo}에 끝납니다. 이어서 노출하려면 「내 매물」에서 연장 신청을 하고 안내된 금액(부가세 포함)을 입금해 주십시오. 연장 입금이 확인되지 않으면 종료일 다음 날 노출이 자동으로 끝납니다.',
   '["name","category","paidTo","daysLeft"]'::jsonb),
  ('DIRECTORY_ENDED_INAPP', 'INAPP', '정액 노출 기간이 끝났습니다',
   '{name}({category}) 노출 기간({paidTo}까지)이 끝나 노출을 마쳤습니다. 다시 노출하려면 「내 매물」에서 신청해 주십시오.',
   '["name","category","paidTo"]'::jsonb),
  ('DIRECTORY_RENEW_DECIDED_INAPP', 'INAPP', '정액 노출 연장 {result}',
   '{name}({category}) — {detail}',
   '["name","category","result","detail"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

/* 정기 작업 — 만료 7일 전 안내(종료일 7일 안 · 같은 종료일에 한 번) · 종료일이 지난 항목 자동 종료 */
CREATE OR REPLACE FUNCTION public.fn_directory_expiry_tick(p_today date DEFAULT NULL)
RETURNS TABLE(noticed int, ended int) LANGUAGE plpgsql AS $$
DECLARE v_today date := coalesce(p_today, (now() AT TIME ZONE 'Asia/Seoul')::date); x record; n1 int := 0; n2 int := 0;
BEGIN
  FOR x IN
    SELECT d.id, d.display_name, d.paid_to, c.name AS cname, b.account_id
      FROM consult_directory_entries d
      JOIN categories c ON c.id = d.category_id
      JOIN partners p ON p.id = d.partner_id JOIN businesses b ON b.id = p.business_id
     WHERE d.state = 'ACTIVE' AND d.paid_to BETWEEN v_today AND v_today + 7
       AND d.end_notice_for IS DISTINCT FROM d.paid_to
     FOR UPDATE OF d
  LOOP
    PERFORM fn_notify(x.account_id, 'DIRECTORY_EXPIRING',
      jsonb_build_object('name', x.display_name, 'category', x.cname, 'paidTo', x.paid_to::text,
                         'daysLeft', (x.paid_to - v_today)::text), '/partner/listings');
    UPDATE consult_directory_entries SET end_notice_for = x.paid_to WHERE id = x.id;
    n1 := n1 + 1;
  END LOOP;
  FOR x IN
    SELECT d.id, d.display_name, d.paid_to, c.name AS cname, b.account_id
      FROM consult_directory_entries d
      JOIN categories c ON c.id = d.category_id
      JOIN partners p ON p.id = d.partner_id JOIN businesses b ON b.id = p.business_id
     WHERE d.state IN ('ACTIVE','RENEW_REQUESTED') AND d.paid_to < v_today
     FOR UPDATE OF d
  LOOP
    UPDATE consult_directory_entries
       SET state = 'ENDED', reason = '노출 기간(' || x.paid_to::text || '까지)이 끝나 자동 종료했습니다 — 연장 입금 확인 없음',
           decided_by = NULL, decided_at = now()
     WHERE id = x.id;
    PERFORM fn_notify(x.account_id, 'DIRECTORY_ENDED',
      jsonb_build_object('name', x.display_name, 'category', x.cname, 'paidTo', x.paid_to::text), '/partner/listings');
    n2 := n2 + 1;
  END LOOP;
  RETURN QUERY SELECT n1, n2;
END $$;
COMMENT ON FUNCTION public.fn_directory_expiry_tick(date) IS
  'v10.33 정기 작업 directory_expiry — 종료일 7일 안의 노출 중(연장 신청 전) 항목에 안내(종료일마다 한 번) · 종료일이 지난 항목(연장 입금 확인 없음)을 ENDED 로.';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('directory_expiry', 1440, 9, 5, NULL, true,
        '법률 · 세무 정액 노출 — 만료 7일 전 업체 안내(알림 · 메일) · 연장 입금 확인 없이 종료일이 지난 노출을 자동 종료합니다.')
ON CONFLICT (job) DO NOTHING;

/* ── 8. 공개 · 관찰 뷰 — 연장 신청 중(RENEW_REQUESTED)도 노출은 계속 ──────── */
CREATE OR REPLACE VIEW public.v_consult_directory_public AS
SELECT d.id, d.category_id, d.display_name, d.intro, d.contact_phone, d.website_url, d.sido
  FROM consult_directory_entries d
  JOIN partners p ON p.id = d.partner_id AND p.status = 'ACTIVE'
  JOIN categories c ON c.id = d.category_id AND c.consult_mode = 'LISTING_FEE' AND c.status = 'APPROVED'
  LEFT JOIN restricted_industries r ON r.code = c.restricted_code AND r.gwan_code = c.gwan_code AND r.is_active
 WHERE d.state IN ('ACTIVE','RENEW_REQUESTED')
   AND (now() AT TIME ZONE 'Asia/Seoul')::date BETWEEN d.paid_from AND d.paid_to
   AND EXISTS (SELECT 1 FROM mal_partner_axes ax WHERE ax.business_id = p.business_id AND ax.axis = 'CONSULT' AND ax.state = 'APPROVED')
   AND (r.code IS NULL OR EXISTS (SELECT 1 FROM qualification_reviews q
          WHERE q.business_id = p.business_id AND q.state = 'APPROVED' AND q.category_code = coalesce(r.qual_code, r.code)));
COMMENT ON VIEW public.v_consult_directory_public IS
  '지금 노출되는 법률 · 세무 정액 노출 항목(노출 중 · 연장 신청 중). 기간이 지나거나 자격 · 입점이 풀리면 자동으로 빠집니다. 금액 칸 없음(v10.12).';

CREATE OR REPLACE VIEW public.v_consult_directory_lapsed AS
SELECT d.id, d.partner_id, d.category_id, d.paid_to
  FROM consult_directory_entries d
 WHERE d.state IN ('ACTIVE','RENEW_REQUESTED') AND d.paid_to < (now() AT TIME ZONE 'Asia/Seoul')::date;

/* ── 9. 매출(D081) — 노출료는 공급가액 · 입금 확인 달. LEGACY 회차는 전과 같은 계산 ── */
CREATE OR REPLACE VIEW v_monthly_revenue AS
WITH src AS (
  SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')::date AS month, 'SUBSCRIPTION' AS kind, amount::numeric AS amount
    FROM subscription_invoices WHERE paid_at IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', coalesce(completed_at, processed_at) AT TIME ZONE 'Asia/Seoul')::date, 'SUBSCRIPTION', -amount
    FROM subscription_refunds WHERE state = 'SUCCEEDED' AND coalesce(completed_at, processed_at) IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')::date, 'REFCODE', amount
    FROM referral_code_payments WHERE paid_at IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', coalesce(billed_at, incurred_at) AT TIME ZONE 'Asia/Seoul')::date, 'LEAD_FEE', amount
    FROM lead_fees WHERE voided_at IS NULL AND state <> 'VOIDED'
  UNION ALL
  SELECT date_trunc('month', paid_at AT TIME ZONE 'Asia/Seoul')::date, 'AD', amount
    FROM ad_payments WHERE paid_at IS NOT NULL
  UNION ALL
  /* v10.33 — 입금 확인(처음 · 연장)마다 공급가액(부가세 별도 — 부가세는 매출이 아님) */
  SELECT date_trunc('month', confirmed_at AT TIME ZONE 'Asia/Seoul')::date, 'DIRECTORY', supply_amount::numeric
    FROM consult_directory_periods WHERE kind <> 'LEGACY'
  UNION ALL
  /* D092 전 기록 — D081 과 같은 계산(시작 달 · 월 노출료 1번) */
  SELECT date_trunc('month', coalesce(period_from::timestamptz, confirmed_at) AT TIME ZONE 'Asia/Seoul')::date, 'DIRECTORY', monthly_fee
    FROM consult_directory_periods WHERE kind = 'LEGACY' AND monthly_fee IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', period_to)::date, 'HEALTH_COMMISSION', commission
    FROM hlt_settlements WHERE status IN ('CONFIRMED','PAID','CARRIED')
)
SELECT month, kind, sum(amount)::bigint AS amount FROM src WHERE month IS NOT NULL GROUP BY month, kind;
COMMENT ON VIEW v_monthly_revenue IS 'v10.31 — 월별 실제 매출(한국 시간). 소개비는 매출이 아님(INV-11). v10.33 법률 · 세무 노출료는 공급가액(부가세 별도)';

COMMENT ON TABLE public.consult_directory_entries IS
  '법률 · 세무 월 정액 노출. 기간 정액만 있고 클릭 · 연락 · 성사 건수와 잇는 칸이 없습니다(D019 · 소개 대가 금지). 리드를 만들지 않습니다. v10.33 부가세 별도 · 연장 신청(RENEW_REQUESTED) · 회차 이력(consult_directory_periods) · 세금계산서(consult_directory_invoices).';

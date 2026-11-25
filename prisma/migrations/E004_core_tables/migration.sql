-- E004 소개뱅크 → ERP 표 구조 (tools/gen-erp-schema.py 가 만듦 · 손으로 고치지 않음 · docs/006)
-- 표 171 · 함수 133 · 조회 3 · 지운 외래 키 216(docs/e2-fk-dropped.tsv)
SET check_function_bodies = off;
SET search_path = public;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== 함수 =====
CREATE OR REPLACE FUNCTION public.fn_acct_accounts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ACCOUNT: 계정은 지우지 않습니다.'; END IF;
  IF (NEW.role, NEW.kind, NEW.custom) IS DISTINCT FROM (OLD.role, OLD.kind, OLD.custom) THEN
    RAISE EXCEPTION 'ACCT_ACCOUNT: 계정 역할 · 종류는 고치지 않습니다(회계 프로그램 코드 · 이름만).';
  END IF;
  IF NEW.ext_code IS DISTINCT FROM OLD.ext_code OR NEW.ext_name IS DISTINCT FROM OLD.ext_name THEN NEW.draft := false; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_accounts_ins_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.custom AND NEW.role !~ '^U_[A-Z][A-Z_]{1,30}$' THEN
    RAISE EXCEPTION 'ACCT_ACCOUNT: 더하는 계정 역할은 U_ 로 시작하는 대문자입니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_accrual_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCRUAL_LOCKED: 고정비 줄은 지우지 않습니다.'; END IF;
  IF (NEW.contract_id, NEW.ym, NEW.account_role, NEW.amount, NEW.created_at) IS DISTINCT FROM (OLD.contract_id, OLD.ym, OLD.account_role, OLD.amount, OLD.created_at)
     OR OLD.state = 'MATCHED' THEN
    RAISE EXCEPTION 'ACCRUAL_LOCKED: 고정비 줄은 맞춤 한 번만 바꿉니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_accrual_rule_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (SELECT kind FROM public.acct_accounts WHERE role = NEW.account_role) IS DISTINCT FROM 'EXPENSE' THEN
    RAISE EXCEPTION 'ACCRUAL_ROLE: 고정비는 비용 계정만 고릅니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_approval_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE s jsonb; i int;
BEGIN
  FOR i IN 0 .. jsonb_array_length(NEW.steps) - 1 LOOP
    s := NEW.steps -> i;
    IF jsonb_typeof(s) <> 'object' OR ((s ? 'role') = (s ? 'account')) THEN
      RAISE EXCEPTION 'APV_LINE: 단계마다 역할(role) 또는 사람(account) 하나를 적습니다.';
    END IF;
    IF s ? 'role' AND (s ->> 'role') NOT IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') THEN
      RAISE EXCEPTION 'APV_LINE: 모르는 역할입니다.';
    END IF;
    IF s ? 'account' AND NOT EXISTS (SELECT 1 FROM svc.accounts a WHERE a.id::text = (s ->> 'account')) THEN
      RAISE EXCEPTION 'APV_LINE: 없는 사람입니다.';
    END IF;
  END LOOP;
  IF coalesce(NEW.steps -> -1 ->> 'role', '') <> 'SUPER' THEN
    RAISE EXCEPTION 'APV_LINE_LAST: 마지막 단계는 SUPER 입니다(승인 효과는 SUPER 결재).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_approval_need(p_kind text, p_amount bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT l.steps FROM public.acct_approval_lines l
   WHERE l.doc_kind = p_kind AND (l.upto IS NULL OR p_amount <= l.upto)
   ORDER BY coalesce(l.upto, 9223372036854775807) LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.fn_acct_approval_step_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE d record; need jsonb; s jsonb; cur_round int; done int;
BEGIN
  SELECT * INTO d FROM public.fn_acct_doc_info(NEW.doc_kind, NEW.doc_id);
  IF d.owner IS NULL THEN RAISE EXCEPTION 'APV_DOC: 없는 문서입니다.'; END IF;
  IF NEW.approver = d.owner THEN RAISE EXCEPTION 'APV_SELF: 본인 문서는 결재할 수 없습니다.'; END IF;
  SELECT 1 + count(*) FILTER (WHERE decision = 'REJECT') INTO cur_round FROM public.acct_approval_steps WHERE doc_kind = NEW.doc_kind AND doc_id = NEW.doc_id;
  IF NEW.round <> cur_round THEN RAISE EXCEPTION 'APV_ORDER: 결재 차례가 맞지 않습니다.'; END IF;
  SELECT count(*) INTO done FROM public.acct_approval_steps WHERE doc_kind = NEW.doc_kind AND doc_id = NEW.doc_id AND round = cur_round AND decision = 'APPROVE';
  IF NEW.step_no <> done + 1 THEN RAISE EXCEPTION 'APV_ORDER: 결재 차례가 맞지 않습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.acct_approval_steps WHERE doc_kind = NEW.doc_kind AND doc_id = NEW.doc_id AND round = cur_round AND approver = NEW.approver) THEN
    RAISE EXCEPTION 'APV_DUP: 같은 사람이 두 단계를 결재할 수 없습니다.';
  END IF;
  need := public.fn_acct_approval_need(NEW.doc_kind, d.amount);
  IF need IS NOT NULL AND NEW.step_no <= jsonb_array_length(need) THEN
    s := need -> (NEW.step_no - 1);
    IF s ? 'account' AND (s ->> 'account') <> NEW.approver::text AND NOT public.fn_has_role(NEW.approver, 'SUPER') THEN
      RAISE EXCEPTION 'APV_WHO: 이 단계 결재자가 아닙니다.';
    END IF;
    IF s ? 'role' AND NOT public.fn_has_role(NEW.approver, s ->> 'role') AND NOT public.fn_has_role(NEW.approver, 'SUPER') THEN
      RAISE EXCEPTION 'APV_WHO: 이 단계 결재자가 아닙니다.';
    END IF;
    /* 중간 단계는 청구 상태일 때만 · 마지막 단계(승인 · 반려 효과)는 기존 결재 뒤에 남김 */
    IF NEW.decision = 'APPROVE' AND NEW.step_no < jsonb_array_length(need) AND d.state <> 'REQUESTED' THEN RAISE EXCEPTION 'APV_STATE: 결재를 기다리는 문서가 아닙니다.'; END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_asset_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE k text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ASSET: 고정자산은 지우지 않습니다 — 처분하십시오.'; END IF;
  SELECT kind INTO k FROM public.acct_accounts WHERE role = NEW.account_role;
  IF k IS DISTINCT FROM 'ASSET' OR NEW.account_role IN ('CASH', 'PG_RECV', 'AR', 'VAT_IN', 'INVENTORY', 'ACC_DEPR') THEN
    RAISE EXCEPTION 'ACCT_ASSET: 고정자산 계정은 자산 계정입니다(현금 · 받을 돈 · 재고 · 누계액 빼고).';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'DISPOSED' THEN RAISE EXCEPTION 'ACCT_ASSET_DISPOSED: 처분한 고정자산은 고칠 수 없습니다.'; END IF;
    IF (NEW.acquired_on, NEW.cost, NEW.residual, NEW.life_months, NEW.method, NEW.account_role, NEW.pay_role, NEW.purchase_id, NEW.from_role, NEW.prior_depr, NEW.prior_months)
       IS DISTINCT FROM (OLD.acquired_on, OLD.cost, OLD.residual, OLD.life_months, OLD.method, OLD.account_role, OLD.pay_role, OLD.purchase_id, OLD.from_role, OLD.prior_depr, OLD.prior_months)
       AND EXISTS (SELECT 1 FROM public.acct_depreciations WHERE asset_id = OLD.id) THEN
      RAISE EXCEPTION 'ACCT_ASSET: 상각을 시작한 자산은 취득가 · 내용연수 · 방법을 고칠 수 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_attendance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_ATTEND: 근태 기록은 지우지 않습니다(고침 기록으로).'; END IF;
  IF (NEW.employee_id, NEW.work_on, NEW.created_at) IS DISTINCT FROM (OLD.employee_id, OLD.work_on, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_ATTEND: 직원 · 날짜는 바꾸지 않습니다.';
  END IF;
  IF OLD.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'ACCT_ATTEND_FIXED: 확인한 근태는 고치지 않습니다.'; END IF;
  /* 시각 고침은 고침 기록과 같은 거래 안에서만(sgb.attend_fix = on) — 퇴근을 처음 채우는 것은 늘 됨 */
  IF NEW.in_at IS DISTINCT FROM OLD.in_at OR (OLD.out_at IS NOT NULL AND NEW.out_at IS DISTINCT FROM OLD.out_at) THEN
    IF coalesce(current_setting('sgb.attend_fix', true), '') <> 'on' THEN
      RAISE EXCEPTION 'ACCT_ATTEND: 출퇴근 시각은 관리자 고침(사유)으로만 바꿉니다.';
    END IF;
    NEW.fixed := true;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_balance_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE d bigint; c bigint; n int; eid bigint;
BEGIN
  -- 표마다 칸이 달라 CASE 한 줄로 쓰면 acct_entries 에서 NEW.entry_id 를 못 찾음 → IF 로 나눔
  IF TG_TABLE_NAME = 'acct_entries' THEN eid := NEW.id; ELSE eid := NEW.entry_id; END IF;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM acct_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'ACCT_UNBALANCED: 전표 % 차변 % · 대변 % · 줄 %', eid, d, c, n;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_bank_feed_acc_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_BANK_FEED: 등록한 계좌는 지우지 않습니다(끄십시오).'; END IF;
  IF (NEW.bank_std, NEW.fintech_enc, NEW.fintech_hash, NEW.acct_last4, NEW.created_at) IS DISTINCT FROM (OLD.bank_std, OLD.fintech_enc, OLD.fintech_hash, OLD.acct_last4, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_BANK_FEED: 은행 · 핀테크이용번호 · 끝 4자리는 바꾸지 않습니다(끄고 새로 등록).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_bank_txn_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_budget_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE k text;
BEGIN
  SELECT kind INTO k FROM public.acct_accounts WHERE role = NEW.role;
  IF k IS NULL OR k NOT IN ('EXPENSE', 'REVENUE') THEN RAISE EXCEPTION 'ACCT_BUDGET: 예산은 비용 · 매출 계정에만 둡니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_card_txn_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_cash_plan_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CASH_PLAN: 예정은 지우지 않습니다(취소만).'; END IF;
  IF (NEW.due_on, NEW.direction, NEW.amount, NEW.memo, NEW.repeat, NEW.until_on, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.due_on, OLD.direction, OLD.amount, OLD.memo, OLD.repeat, OLD.until_on, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'CASH_PLAN: 예정 내용은 고치지 않습니다(취소하고 새로 넣기).';
  END IF;
  IF OLD.state = 'CANCELED' THEN RAISE EXCEPTION 'CASH_PLAN: 이미 취소한 예정입니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_contract_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_CONTRACT: 계약은 지우지 않습니다(끝내기만).'; END IF;
  IF OLD.state = 'ENDED' THEN RAISE EXCEPTION 'ACCT_CONTRACT: 끝낸 계약은 고치지 않습니다.'; END IF;
  IF (NEW.start_on, NEW.monthly_amount, NEW.kind, NEW.created_at) IS DISTINCT FROM (OLD.start_on, OLD.monthly_amount, OLD.kind, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_CONTRACT: 시작일 · 달 금액 · 종류는 고치지 않습니다(끝내고 새로 넣기).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_doc_info(p_kind text, p_id bigint, OUT owner uuid, OUT amount bigint, OUT state text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF p_kind = 'REQ' THEN
    SELECT r.requester, r.amount, r.state INTO owner, amount, state FROM public.acct_requisitions r WHERE r.id = p_id;
  ELSIF p_kind = 'EXPENSE' THEN
    SELECT c.claimant, c.amount, c.state INTO owner, amount, state FROM public.acct_expense_claims c WHERE c.id = p_id;
  ELSIF p_kind = 'MANUAL' THEN
    SELECT m.created_by, (SELECT coalesce(sum((x ->> 'debit')::bigint), 0) FROM jsonb_array_elements(m.lines) x), m.state
      INTO owner, amount, state FROM public.acct_manual_entries m WHERE m.id = p_id;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_employee_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_EMPLOYEE: 직원은 지우지 않습니다(퇴사일을 넣으십시오).'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_entries_closed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE yc boolean := NEW.source IN ('YEAR_CLOSE', 'YEAR_REOPEN') AND coalesce(current_setting('sgb.acct_year_close', true), '') = 'on';
BEGIN
  NEW.ym := to_char(NEW.entry_date, 'YYYY-MM');   -- 달(YYYY-MM)은 날짜에서 · 마감 확인과 같은 값
  IF yc THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM acct_closings WHERE ym = NEW.ym) THEN
    RAISE EXCEPTION 'ACCT_CLOSED: % 은 마감한 달입니다.', to_char(NEW.entry_date, 'YYYY-MM');
  END IF;
  IF public.fn_acct_year_closed(extract(year FROM NEW.entry_date)::int) THEN
    RAISE EXCEPTION 'ACCT_YEAR_CLOSED: % 년은 해 마감을 했습니다.', extract(year FROM NEW.entry_date)::int;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_entry_reversal_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text; v_entry bigint; v_src text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ACCT_REVERSE: 반대 전표 기록은 쌓기만 합니다.'; END IF;
  SELECT state, entry_id INTO v_state, v_entry FROM public.acct_manual_entries WHERE id = NEW.manual_id;
  IF v_state IS DISTINCT FROM 'APPROVED' OR v_entry IS DISTINCT FROM NEW.entry_id THEN
    RAISE EXCEPTION 'ACCT_REVERSE: 승인된 수동 전표만 반대 전표를 만듭니다.';
  END IF;
  SELECT source INTO v_src FROM public.acct_entries WHERE id = NEW.reverse_entry_id;
  IF v_src IS DISTINCT FROM 'MANUAL_REVERSE' THEN RAISE EXCEPTION 'ACCT_REVERSE: 반대 전표 종류가 맞지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_expense_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_export_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_export_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_exports WHERE id = coalesce(NEW.export_id, OLD.export_id);
  IF st IS DISTINCT FROM 'ORDERED' THEN
    RAISE EXCEPTION 'ACCT_EXPORT: 선적한 수출 건의 품목은 고치지 않습니다.';
  END IF;
  RETURN coalesce(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_fx_reval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ACCT_FXREVAL: 환산 평가 기록은 쌓기만 합니다.'; END IF;
  IF NEW.as_of <> (to_date(NEW.ym || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date THEN
    RAISE EXCEPTION 'ACCT_FXREVAL: 평가일은 그 달 말일입니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_import_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_import_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_leave_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_LEAVE_REQ: 휴가 신청은 지우지 않습니다(취소로).'; END IF;
  IF (NEW.employee_id, NEW.start_on, NEW.end_on, NEW.half, NEW.days, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.start_on, OLD.end_on, OLD.half, OLD.days, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_LEAVE_REQ: 신청 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED')) OR (OLD.state = 'APPROVED' AND NEW.state = 'CANCELED')) THEN
      RAISE EXCEPTION 'ACCT_LEAVE_REQ_STATE: 휴가 신청 상태는 앞으로만 바뀝니다.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_manual_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    IF NOT EXISTS (SELECT 1 FROM svc.account_roles r WHERE r.account_id = NEW.decided_by AND r.role = 'SUPER') THEN
      RAISE EXCEPTION 'ACCT_MANUAL_ROLE: 수동 전표 승인 · 반려는 SUPER 만 합니다.';
    END IF;
  END IF;
  IF NEW.state = 'APPROVED' AND OLD.state <> 'APPROVED' THEN
    IF NOT EXISTS (SELECT 1 FROM public.acct_entries e WHERE e.id = NEW.entry_id AND e.source = 'MANUAL' AND e.source_key = NEW.id::text) THEN
      RAISE EXCEPTION 'ACCT_MANUAL: 승인된 수동 전표의 전표가 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_opening_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text; sid bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'ACCT_OPENING: 기초 잔액 줄은 고치지 않습니다(지우고 다시 넣기 · 확정 전만).'; END IF;
  IF TG_OP = 'DELETE' THEN sid := OLD.set_id; ELSE sid := NEW.set_id; END IF;
  SELECT state INTO st FROM public.acct_opening_sets WHERE id = sid;
  IF st = 'FIXED' THEN RAISE EXCEPTION 'ACCT_OPENING_FIXED: 확정한 기초 잔액은 고칠 수 없습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_opening_set_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE d bigint; c bigint; n int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'FIXED' THEN RAISE EXCEPTION 'ACCT_OPENING_FIXED: 확정한 기초 잔액은 고칠 수 없습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'FIXED' THEN RAISE EXCEPTION 'ACCT_OPENING_FIXED: 확정한 기초 잔액은 고칠 수 없습니다.'; END IF;
  IF NEW.as_of IS DISTINCT FROM OLD.as_of THEN RAISE EXCEPTION 'ACCT_OPENING: 기준일은 고치지 않습니다(새 판).'; END IF;
  IF NEW.state = 'FIXED' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM public.acct_opening WHERE set_id = NEW.id;
    IF n = 0 OR d <> c THEN
      RAISE EXCEPTION 'ACCT_OPENING_UNBALANCED: 기초 잔액 차변 % · 대변 % 이 같지 않습니다(줄 %).', d, c, n;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_party_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PARTY: 거래처는 지우지 않습니다(닫기만).'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_payroll_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_payroll_runs WHERE id = coalesce(NEW.run_id, OLD.run_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCT_PAYROLL_FIXED: 확정한 급여는 고치지 않습니다.'; END IF;
  RETURN coalesce(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_payroll_run_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE ord CONSTANT text[] := ARRAY['DRAFT', 'FIXED', 'PAID'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PAYROLL: 급여 대장은 지우지 않습니다.'; END IF;
  IF NEW.ym <> OLD.ym THEN RAISE EXCEPTION 'ACCT_PAYROLL: 급여 달은 바꾸지 않습니다.'; END IF;
  IF array_position(ord, NEW.state) < array_position(ord, OLD.state) THEN RAISE EXCEPTION 'ACCT_PAYROLL: 급여 상태는 앞으로만 갑니다.'; END IF;
  IF OLD.state <> 'DRAFT' AND NEW.pay_day <> OLD.pay_day THEN RAISE EXCEPTION 'ACCT_PAYROLL_FIXED: 확정한 급여는 고치지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_pg_txn_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_po_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_PO: 발주는 지우지 않습니다(취소만).'; END IF;
  IF OLD.state <> 'ORDERED' THEN RAISE EXCEPTION 'ACCT_PO: 입고 · 취소한 발주는 고치지 않습니다.'; END IF;
  IF (NEW.party_id, NEW.ordered_on, NEW.created_at) IS DISTINCT FROM (OLD.party_id, OLD.ordered_on, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_PO: 거래처 · 발주일은 고치지 않습니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_po_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_pos WHERE id = coalesce(NEW.po_id, OLD.po_id);
  IF st IS DISTINCT FROM 'ORDERED' THEN
    RAISE EXCEPTION 'ACCT_PO: 입고 · 취소한 발주의 품목은 고치지 않습니다.';
  END IF;
  RETURN coalesce(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_purchase_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_reorder_draft_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_REORDER: 재주문 초안은 지우지 않습니다(버림으로).'; END IF;
  IF OLD.state <> 'DRAFT' THEN RAISE EXCEPTION 'ACCT_REORDER: 발주로 넣었거나 버린 초안은 고치지 않습니다.'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.made_by_job IS DISTINCT FROM OLD.made_by_job THEN
    RAISE EXCEPTION 'ACCT_REORDER: 초안을 만든 기록은 고치지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_reorder_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  SELECT state INTO st FROM public.acct_reorder_drafts WHERE id = coalesce(NEW.draft_id, OLD.draft_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCT_REORDER: 끝난 초안의 품목은 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.draft_id, NEW.option_id) IS DISTINCT FROM (OLD.draft_id, OLD.option_id) THEN
    RAISE EXCEPTION 'ACCT_REORDER: 초안 · 옵션은 바꾸지 않습니다(빼고 새로).';
  END IF;
  RETURN coalesce(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_req_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE q record; tol int; lim bigint; used bigint; mine bigint; v_kind text;   -- v_ 앞머리: acct_purchases.kind 칸과 이름이 겹치면 plpgsql 이 모호하다고 막음
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.requisition_id IS NOT NULL AND NEW.requisition_id IS DISTINCT FROM OLD.requisition_id THEN
    RAISE EXCEPTION 'REQ_LINK_FIXED: 붙인 품의는 바꾸지 않습니다(취소하고 다시 넣으십시오).';
  END IF;
  IF NEW.requisition_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.requisition_id IS NOT DISTINCT FROM NEW.requisition_id THEN RETURN NEW; END IF;
  SELECT id, amount, state INTO q FROM public.acct_requisitions WHERE id = NEW.requisition_id FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'REQ_STATE: 없는 품의입니다.'; END IF;
  IF q.state NOT IN ('APPROVED', 'USED') THEN RAISE EXCEPTION 'REQ_STATE: 승인된 품의에만 붙입니다.'; END IF;
  tol := coalesce((SELECT value FROM svc.site_settings WHERE key = 'acct.req_tolerance_pct'), '10')::int;
  lim := floor(q.amount * (100 + tol) / 100.0)::bigint;
  IF TG_TABLE_NAME = 'acct_purchases' THEN v_kind := 'PURCHASE'; mine := NEW.total; ELSE v_kind := 'EXPENSE'; mine := NEW.amount; END IF;
  used := coalesce((SELECT sum(p.total) FROM public.acct_purchases p WHERE p.requisition_id = q.id AND p.state = 'ACTIVE' AND NOT (v_kind = 'PURCHASE' AND p.id = NEW.id)), 0)
        + coalesce((SELECT sum(c.amount) FROM public.acct_expense_claims c WHERE c.requisition_id = q.id AND c.state IN ('REQUESTED', 'APPROVED', 'PAID') AND NOT (v_kind = 'EXPENSE' AND c.id = NEW.id)), 0);
  IF used + mine > lim THEN
    RAISE EXCEPTION 'REQ_OVER: 품의 금액(허용 비율 포함)을 넘습니다 — 다시 품의하십시오.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_req_link_used()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_kind text; amt bigint; who uuid;
BEGIN
  IF NEW.requisition_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.requisition_id IS NOT DISTINCT FROM NEW.requisition_id) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'acct_purchases' THEN v_kind := 'PURCHASE'; amt := NEW.total; who := NEW.created_by; ELSE v_kind := 'EXPENSE'; amt := NEW.amount; who := NEW.claimant; END IF;
  UPDATE public.acct_requisitions SET state = 'USED', used_kind = v_kind, used_ref = NEW.id, used_amount = amt, used_by = who, used_at = now()
   WHERE id = NEW.requisition_id AND state = 'APPROVED'
     AND NOT EXISTS (SELECT 1 FROM public.acct_requisitions x WHERE x.used_kind = v_kind AND x.used_ref = NEW.id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_requisition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_rule_map_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE k1 text; k2 text;
BEGIN
  SELECT kind INTO k1 FROM public.acct_accounts WHERE role = NEW.from_role;
  SELECT kind INTO k2 FROM public.acct_accounts WHERE role = NEW.to_role;
  IF k1 IS DISTINCT FROM k2 THEN
    RAISE EXCEPTION 'ACCT_RULE_KIND: 같은 종류 계정으로만 바꿉니다(자산은 자산 · 매출은 매출).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_sales_doc_exempt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_sales_doc_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_stock_move()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE pq integer; pa bigint; take integer; cost bigint; v_type text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'ACCT_STOCK: 재고 수불부는 쌓기만 합니다 — 실사 조정으로 바로잡으십시오.';
  END IF;
  SELECT o.product_id, s.type INTO NEW.product_id, v_type
    FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id LEFT JOIN svc.hlt_sellers s ON s.id = p.seller_id
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_stock_rule_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_STOCK_RULE: 안전 재고 규칙은 지우지 않습니다(끄십시오).'; END IF;
  IF NOT EXISTS (SELECT 1 FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id
                   JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.id = NEW.option_id) THEN
    RAISE EXCEPTION 'ACCT_STOCK_RULE: 직판 상품 옵션에만 안전 재고를 둡니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_tax_inbox_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'TAXINBOX_LOCKED: 가져온 세금계산서 줄은 지우지 않습니다.'; END IF;
  IF (NEW.approval_no, NEW.issued_on, NEW.supplier_biz_no, NEW.supplier_name, NEW.item, NEW.supply, NEW.vat, NEW.exempt, NEW.source, NEW.provider, NEW.row_hash, NEW.created_at)
     IS DISTINCT FROM (OLD.approval_no, OLD.issued_on, OLD.supplier_biz_no, OLD.supplier_name, OLD.item, OLD.supply, OLD.vat, OLD.exempt, OLD.source, OLD.provider, OLD.row_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'TAXINBOX_LOCKED: 가져온 세금계산서 내용은 고치지 않습니다.';
  END IF;
  IF OLD.state <> 'NEW' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'TAXINBOX_STATE: 이미 처리한 줄입니다.';
  END IF;
  IF OLD.state <> 'NEW' AND (NEW.purchase_id, NEW.ignore_note) IS DISTINCT FROM (OLD.purchase_id, OLD.ignore_note) THEN
    RAISE EXCEPTION 'TAXINBOX_STATE: 이미 처리한 줄입니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_exempt_chk()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_tax_invoice_issued()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_transfer_approval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text; v_by uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'ACCT_TRANSFER: 승인 기록은 고치거나 지우지 않습니다.'; END IF;
  SELECT state, created_by INTO v_state, v_by FROM public.acct_transfer_batches WHERE id = NEW.batch_id;
  IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 승인을 기다리는 묶음이 아닙니다.'; END IF;
  IF NEW.approver = v_by THEN RAISE EXCEPTION 'ACCT_TRANSFER_SELF: 만든 사람은 승인하지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_transfer_batch_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_n integer; v_sum bigint; v_apv integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_TRANSFER: 이체 묶음은 지우지 않습니다(취소로).'; END IF;
  IF (NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ACCT_TRANSFER: 만든 사람 · 시각은 고치지 않습니다.';
  END IF;
  IF OLD.state <> 'DRAFT' AND (NEW.title, NEW.pay_on, NEW.item_count, NEW.total) IS DISTINCT FROM (OLD.title, OLD.pay_on, OLD.item_count, OLD.total) THEN
    RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 승인 뒤에는 묶음 내용을 고치지 않습니다.';
  END IF;
  IF OLD.state = 'CHECKING' AND (NEW.mode, NEW.sent_by, NEW.sent_at, NEW.approved_at) IS DISTINCT FROM (OLD.mode, OLD.sent_by, OLD.sent_at, OLD.approved_at) THEN
    RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 보낸 기록은 고치지 않습니다.';
  END IF;
  IF OLD.state IN ('SENT', 'PARTIAL', 'FAILED', 'CANCELED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 끝난 이체 묶음은 고치지 않습니다.';
  END IF;
  IF NEW.state <> OLD.state THEN
    IF NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('APPROVED', 'CANCELED'))
         OR (OLD.state = 'APPROVED' AND NEW.state IN ('CHECKING', 'CANCELED'))
         OR (OLD.state = 'CHECKING' AND NEW.state IN ('SENT', 'PARTIAL', 'FAILED'))) THEN
      RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 이체 묶음 상태는 앞으로만 바뀝니다.';
    END IF;
    IF NEW.state = 'APPROVED' THEN
      SELECT count(*), coalesce(sum(amount), 0) INTO v_n, v_sum FROM public.acct_transfer_items WHERE batch_id = NEW.id;
      SELECT count(*) INTO v_apv FROM public.acct_transfer_approvals WHERE batch_id = NEW.id AND approver <> NEW.created_by;
      IF v_n = 0 OR v_n <> NEW.item_count OR v_sum <> NEW.total THEN RAISE EXCEPTION 'ACCT_TRANSFER: 줄 수 · 합계가 묶음과 다릅니다.'; END IF;
      IF v_apv < 2 THEN RAISE EXCEPTION 'ACCT_TRANSFER_APPROVE: 만든 사람이 아닌 2명이 승인해야 합니다.'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_transfer_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.acct_transfer_batches WHERE id = coalesce(NEW.batch_id, OLD.batch_id);
  IF TG_OP = 'UPDATE'
     AND (NEW.batch_id, NEW.party_id, NEW.payee, NEW.bank_code, NEW.acct_no_enc, NEW.acct_last4, NEW.amount, NEW.pay_role, NEW.memo, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.batch_id, OLD.party_id, OLD.payee, OLD.bank_code, OLD.acct_no_enc, OLD.acct_last4, OLD.amount, OLD.pay_role, OLD.memo, OLD.created_at) THEN
    /* 거래고유번호 — 승인된 묶음에서 한 번만 · 바꾸거나 지우지 않음 */
    IF NEW.bank_tran_id IS DISTINCT FROM OLD.bank_tran_id THEN
      IF OLD.bank_tran_id IS NOT NULL OR v_state <> 'APPROVED' OR OLD.result IS NOT NULL OR NEW.result IS DISTINCT FROM OLD.result THEN
        RAISE EXCEPTION 'ACCT_TRANSFER: 거래고유번호는 보낼 때 한 번만 정합니다.';
      END IF;
      RETURN NEW;
    END IF;
    /* 결과 — 없음 → 결과(APPROVED · CHECKING) · PENDING → OK · FAIL · ASSUMED(CHECKING) · 확정된 결과는 고치지 않음 */
    IF OLD.result IS NULL AND NEW.result IS NOT NULL AND v_state IN ('APPROVED', 'CHECKING') THEN RETURN NEW; END IF;
    IF OLD.result = 'PENDING' AND NEW.result IN ('OK', 'FAIL', 'ASSUMED') AND v_state = 'CHECKING' THEN RETURN NEW; END IF;
    IF OLD.result IS NOT DISTINCT FROM NEW.result AND OLD.result = 'PENDING' AND v_state = 'CHECKING' THEN RETURN NEW; END IF;   -- 처리 중 메모만
    IF OLD.result IS NOT NULL THEN RAISE EXCEPTION 'ACCT_TRANSFER: 확정된 이체 결과는 고치지 않습니다.'; END IF;
  END IF;
  IF coalesce(v_state, '') <> 'DRAFT' THEN RAISE EXCEPTION 'ACCT_TRANSFER_STATE: 승인 뒤에는 이체 줄을 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.batch_id <> OLD.batch_id THEN RAISE EXCEPTION 'ACCT_TRANSFER: 줄을 다른 묶음으로 옮기지 않습니다.'; END IF;
  IF TG_OP <> 'DELETE' AND NEW.result IS NOT NULL THEN RAISE EXCEPTION 'ACCT_TRANSFER: 결과는 보낼 때만 채웁니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_vehicle_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACCT_VEHICLE: 차량은 지우지 않습니다(끄거나 처분일을 넣으십시오).'; END IF;
  IF (NEW.plate, NEW.created_at, NEW.created_by) IS DISTINCT FROM (OLD.plate, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'ACCT_VEHICLE: 차량 번호는 바꾸지 않습니다(새 차량으로 넣으십시오).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_vehicle_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_acct_year_closed(p_year integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT coalesce((SELECT action = 'CLOSE' FROM public.acct_year_closings WHERE year = p_year ORDER BY id DESC LIMIT 1), false)
$function$;

CREATE OR REPLACE FUNCTION public.fn_block_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'append-only table: % on % is forbidden', TG_OP, TG_TABLE_NAME;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_bzx_card_txn_notice()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.bzx_card_notices (txn_id, card_tail, used_on, merchant, amount, holder_id)
    VALUES (NEW.id, NEW.card_tail, NEW.used_on, NEW.merchant, NEW.amount,
            (SELECT l.holder_id FROM public.acct_card_limits l WHERE l.card_tail = NEW.card_tail AND l.active))
    ON CONFLICT (txn_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'BZX_CARD_NOTICE: 알림 대기에 넣지 못함(카드 줄은 그대로)';
  END;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_corp_doc_versions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE f public.files; st text;
BEGIN
  SELECT * INTO f FROM svc.files WHERE id = NEW.file_id;
  IF f.id IS NULL OR f.purpose <> 'CORP_DOC' OR f.status <> 'READY' THEN RAISE EXCEPTION 'CORP_DOC_FILE: 사내 문서 용도로 올린 파일(READY)만 붙입니다.'; END IF;
  SELECT state INTO st FROM public.corp_docs WHERE id = NEW.doc_id;
  IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'CORP_DOC: 보관 끝 문서에는 새 판을 올리지 않습니다.'; END IF;
  IF NEW.version_no <> coalesce((SELECT max(version_no) FROM public.corp_doc_versions WHERE doc_id = NEW.doc_id), 0) + 1 THEN
    RAISE EXCEPTION 'CORP_DOC: 판 번호는 차례대로입니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_corp_docs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CORP_DOC: 사내 문서는 지우지 않습니다(보관 끝으로 표시).'; END IF;
  IF (NEW.category, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.category, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'CORP_DOC: 분류는 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'ARCHIVED' AND NEW.state <> 'ARCHIVED' THEN RAISE EXCEPTION 'CORP_DOC: 보관 끝 문서는 되돌리지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_etax_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.fn_file_can_read(p_file uuid, p_account uuid, p_roles text[])
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  f public.files;
  v_partner boolean;
BEGIN
  SELECT * INTO f FROM svc.files WHERE id = p_file;
  IF f.id IS NULL OR f.status <> 'READY' OR p_account IS NULL THEN RETURN 'NOT_FOUND'; END IF;
  IF f.owner_account_id = p_account THEN RETURN 'OK'; END IF;
  /* v10.615 (docs/757) perm.mode GROUPS — 업무 권한으로도 엶(아래 역할 줄은 그대로 · 넓히기만 · ROLE · COMPARE 는 pgx_groups_task 가 늘 거짓)
   *   검수 큐 보기 = ADMIN · REVIEWER 줄과 같은 범위(사내 · 인사 · 법무 서류 빼고) · 사내 문서함 보기 = ADMIN · PAYOUT · 인사 3탭 보기 = ADMIN · 법무 3탭(보험 빼고) 보기 = ADMIN
   *   파트너 보기 = ADMIN · 안심 파트너 담당 · 제휴 고치기 이상 = ADMIN · 제휴 파트너 담당(제휴 보기는 지급 담당도 가져 넓어지므로 고치기) */
  IF f.purpose NOT IN ('CORP_DOC', 'HR_DOC', 'LGL_DOC') AND public.pgx_groups_task(p_account, ARRAY['queue'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose = 'CORP_DOC' AND public.pgx_groups_task(p_account, ARRAY['corp-docs'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose = 'HR_DOC' AND public.pgx_groups_task(p_account, ARRAY['hr-training', 'hr-recruit', 'hr-contract'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose = 'LGL_DOC' AND public.pgx_groups_task(p_account, ARRAY['lgl-reviews', 'lgl-cases', 'lgl-licenses'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose IN ('BROKER_DOC', 'PARTNER_MEDIA') AND public.pgx_groups_task(p_account, ARRAY['partners'], ARRAY['VIEW']) THEN RETURN 'OK'; END IF;
  IF f.purpose IN ('MARKETING_MATERIAL', 'PARTNER_GUIDE') AND public.pgx_groups_task(p_account, ARRAY['affiliates'], ARRAY['EDIT', 'APPROVE']) THEN RETURN 'OK'; END IF;
  /* 심사 · 심의하는 사람 */
  IF p_roles && ARRAY['ADMIN','SUPER','REVIEWER'] THEN
    /* v10.425 — 사내 문서는 REVIEWER 에게 열지 않음 */
    IF f.purpose = 'CORP_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    /* v10.458 ~ 461 (D262) — 인사 서류(HR_DOC · 의무교육 증빙 · 지원자 서류)는 검수(REVIEWER)에게 열지 않음 · 지급 담당 · 세무사 분기에도 넣지 않음(본인 = 올린 사람은 위 주인 줄로 엶) */
    IF f.purpose = 'HR_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    /* v10.486 ~ 489 (D269 · 대표 11/20) — 법무 서류(LGL_DOC · 인허가 · 계약 검토 · 사건 · 보험)는 검수(REVIEWER)에게 열지 않음 · 본인 = 올린 사람은 위 주인 줄로 엶 */
    IF f.purpose = 'LGL_DOC' AND NOT (p_roles && ARRAY['ADMIN','SUPER']) THEN RETURN 'NOT_FOUND'; END IF;
    RETURN 'OK';
  END IF;
  /* v10.194 (D173) — 파트너 담당은 자기 쪽 서류만 */
  IF 'PARTNER_MAL' = ANY (p_roles) AND f.purpose IN ('BROKER_DOC','PARTNER_MEDIA') THEN RETURN 'OK'; END IF;
  IF 'PARTNER_AFF' = ANY (p_roles) AND f.purpose IN ('MARKETING_MATERIAL','PARTNER_GUIDE') THEN RETURN 'OK'; END IF;
  /* v10.392 (D245) — 지급 담당은 회계 증빙 · v10.425 (D253) 사내 문서 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose IN ('ACCT_EVIDENCE', 'CORP_DOC') THEN RETURN 'OK'; END IF;
  /* v10.489 (D269 · 대표 11/20) — 지급 담당은 법무 서류 중 보험 증권에 붙은 파일만(보험료 처리) · 계약 검토 · 사건 · 인허가 서류는 못 엶 · 세무사 분기에는 넣지 않음 */
  IF 'PAYOUT' = ANY (p_roles) AND f.purpose = 'LGL_DOC'
     AND EXISTS (SELECT 1 FROM public.lgl_insurance_policies x WHERE f.id = ANY (x.file_ids)) THEN RETURN 'OK'; END IF;
  /* v10.437 (D257) — 세무사 공유 계정은 회계 증빙만(사내 문서 · 회원 파일은 못 엶) */
  IF 'ACCOUNTANT' = ANY (p_roles) AND f.purpose = 'ACCT_EVIDENCE' THEN RETURN 'OK'; END IF;

  IF f.purpose = 'MARKETING_MATERIAL'
     AND EXISTS (SELECT 1 FROM svc.marketing_materials m WHERE m.file_id = f.id AND m.state = 'APPROVED')
  OR f.purpose = 'PARTNER_GUIDE'
     AND EXISTS (SELECT 1 FROM svc.partner_guides g WHERE g.file_id = f.id AND g.is_active) THEN
    SELECT EXISTS (SELECT 1 FROM svc.partners p JOIN svc.businesses b ON b.id = p.business_id
                    WHERE b.account_id = p_account AND p.aff_status = 'ACTIVE') INTO v_partner;
    RETURN CASE WHEN v_partner THEN 'OK' ELSE 'PARTNER_ONLY' END;
  END IF;
  /* v10.31 — 공개된 매물 · 요청의 사진 */
  IF f.purpose = 'LISTING_IMAGE' AND EXISTS (
       SELECT 1 FROM svc.listing_media m JOIN svc.listings l ON l.id = m.listing_id
        WHERE m.file_id = f.id AND l.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  IF f.purpose = 'REQUEST_IMAGE' AND EXISTS (
       SELECT 1 FROM svc.requests r WHERE r.photo_file_id = f.id AND r.status = 'PUBLISHED') THEN RETURN 'OK'; END IF;
  /* 등기부 · 중개 서류는 신청자와 운영만 봅니다 */
  RETURN 'NOT_FOUND';
END $function$;

CREATE OR REPLACE FUNCTION public.fn_files_acct_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND (EXISTS (SELECT 1 FROM public.acct_purchases p WHERE OLD.id = ANY(p.attachments))
          OR (to_regclass('public.acct_expense_claims') IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.acct_expense_claims c WHERE OLD.id = ANY(c.attachments) AND c.state <> 'CANCELED'))
          OR EXISTS (SELECT 1 FROM public.acct_contracts k WHERE OLD.id = ANY(k.attachments))) THEN
    RAISE EXCEPTION 'FILE: 매입 · 경비 청구 · 계약에 붙은 증빙 파일은 지울 수 없습니다';
  END IF;
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND EXISTS (SELECT 1 FROM public.corp_doc_versions v WHERE v.file_id = OLD.id) THEN
    RAISE EXCEPTION 'FILE: 사내 문서에 붙은 파일은 지울 수 없습니다';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_has_role(p_account uuid, VARIADIC p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p_account IS NOT NULL AND EXISTS (
    SELECT 1 FROM svc.account_roles r
     WHERE r.account_id = p_account
       AND (r.role = 'SUPER' OR r.role = ANY (p_roles)))
$function$;

CREATE OR REPLACE FUNCTION public.fn_hr_applicants_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_APPLICANT: 지원자 줄은 지우지 않습니다(파기는 개인정보만 비움).'; END IF;
  IF (NEW.posting_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.posting_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_APPLICANT: 공고 · 만든 사람은 바꾸지 않습니다.';
  END IF;
  IF OLD.purged_at IS NOT NULL THEN RAISE EXCEPTION 'HR_APPLICANT_PURGED: 파기한 지원자는 바꾸지 않습니다.'; END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF OLD.stage IN ('HIRED', 'REJECTED', 'WITHDRAWN') THEN RAISE EXCEPTION 'HR_APPLICANT_STATE: 끝난 지원자는 단계를 바꾸지 않습니다.'; END IF;
    IF NEW.stage NOT IN ('REJECTED', 'WITHDRAWN')
       AND array_position(ARRAY['APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED'], NEW.stage) <= array_position(ARRAY['APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED'], OLD.stage) THEN
      RAISE EXCEPTION 'HR_APPLICANT_STATE: 지원 단계는 앞으로만 바뀝니다.';
    END IF;
  END IF;
  IF NEW.purged_at IS NOT NULL AND (OLD.stage NOT IN ('REJECTED', 'WITHDRAWN') OR NEW.stage IS DISTINCT FROM OLD.stage) THEN
    RAISE EXCEPTION 'HR_APPLICANT_PURGE: 불합격 · 철회한 지원자만 파기합니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_contract_templates_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_CONTRACT_TEMPLATE: 양식은 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.version, NEW.name, NEW.kind, NEW.body, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.code, OLD.version, OLD.name, OLD.kind, OLD.body, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_CONTRACT_TEMPLATE: 양식 본문은 고치지 않습니다(새 판으로).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_contracts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_CONTRACT: 근로계약서는 지우지 않습니다(취소로).'; END IF;
  IF (NEW.employee_id, NEW.template_id, NEW.title, NEW.terms, NEW.body, NEW.doc_hash, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.template_id, OLD.title, OLD.terms, OLD.body, OLD.doc_hash, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_CONTRACT: 계약서 본문 · 조건은 고치지 않습니다(취소하고 새로).';
  END IF;
  IF OLD.state IN ('SIGNED', 'CANCELED') THEN RAISE EXCEPTION 'HR_CONTRACT_STATE: 서명 · 취소한 계약서는 바꾸지 않습니다.'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('SENT', 'CANCELED')) OR (OLD.state = 'SENT' AND NEW.state IN ('SIGNED', 'CANCELED'))) THEN
    RAISE EXCEPTION 'HR_CONTRACT_STATE: 계약서 상태는 앞으로만 바뀝니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_files_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' AND OLD.purpose = 'HR_DOC' THEN
    IF EXISTS (SELECT 1 FROM public.hr_training_records r WHERE r.file_id = OLD.id AND r.state <> 'VOID') THEN
      RAISE EXCEPTION 'FILE: 의무교육 이수에 붙은 증빙 파일은 지울 수 없습니다';
    END IF;
    IF to_regclass('public.hr_applicants') IS NOT NULL AND EXISTS (SELECT 1 FROM public.hr_applicants a WHERE OLD.id = ANY (a.file_ids)) THEN
      RAISE EXCEPTION 'FILE: 지원자에 붙은 서류는 지울 수 없습니다(불합격 · 철회 뒤 파기로)';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_interviews_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_INTERVIEW: 면접 일정은 지우지 않습니다.'; END IF;
  IF (NEW.applicant_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.applicant_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_INTERVIEW: 지원자는 바꾸지 않습니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_job_postings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_POSTING: 채용 공고는 지우지 않습니다(마감으로).'; END IF;
  IF (NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'HR_POSTING: 만든 사람 · 시각은 바꾸지 않습니다.'; END IF;
  IF OLD.state = 'CLOSED' AND NEW.state <> 'CLOSED' THEN RAISE EXCEPTION 'HR_POSTING_STATE: 마감한 공고는 다시 열지 않습니다(새 공고로).'; END IF;
  IF OLD.state = 'OPEN' AND NEW.state = 'DRAFT' THEN RAISE EXCEPTION 'HR_POSTING_STATE: 연 공고는 초안으로 돌리지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_review_cycles_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_REVIEW: 평가 차례는 지우지 않습니다.'; END IF;
  IF (NEW.year, NEW.quarter, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.year, OLD.quarter, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_REVIEW: 해 · 분기는 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'HR_REVIEW_CLOSED: 닫은 평가 차례는 바꾸지 않습니다.'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT ((OLD.state = 'GOALS' AND NEW.state = 'REVIEW') OR (OLD.state = 'REVIEW' AND NEW.state = 'CLOSED')) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 평가 차례는 목표 → 평가 → 닫음 순서로만 넘어갑니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_review_goals_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.hr_review_cycles WHERE id = coalesce(NEW.cycle_id, OLD.cycle_id);
  IF v_state = 'CLOSED' THEN RAISE EXCEPTION 'HR_REVIEW_CLOSED: 닫은 평가의 목표는 바꾸지 않습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_state <> 'GOALS' THEN RAISE EXCEPTION 'HR_REVIEW_STATE: 목표는 목표 단계에서만 지웁니다.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_state <> 'GOALS' THEN RAISE EXCEPTION 'HR_REVIEW_STATE: 목표는 목표 단계에서만 넣습니다.'; END IF;
    IF NEW.self_score IS NOT NULL OR NEW.mgr_score IS NOT NULL THEN RAISE EXCEPTION 'HR_REVIEW_STATE: 목표 단계에는 점수를 넣지 않습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.cycle_id, NEW.employee_id, NEW.created_at) IS DISTINCT FROM (OLD.cycle_id, OLD.employee_id, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_REVIEW: 목표의 차례 · 직원은 바꾸지 않습니다.';
  END IF;
  IF v_state = 'GOALS' AND (NEW.self_score IS NOT NULL OR NEW.mgr_score IS NOT NULL OR NEW.self_note IS NOT NULL OR NEW.mgr_note IS NOT NULL) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 목표 단계에는 점수 · 의견을 넣지 않습니다.';
  END IF;
  IF v_state = 'REVIEW' AND (NEW.title, NEW.measure, NEW.weight) IS DISTINCT FROM (OLD.title, OLD.measure, OLD.weight) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 평가 단계에는 목표 · 가중치를 고치지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_review_results_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_REVIEW: 평가 결과는 지우지 않습니다.'; END IF;
  SELECT state INTO v_state FROM public.hr_review_cycles WHERE id = NEW.cycle_id;
  IF v_state = 'CLOSED' THEN RAISE EXCEPTION 'HR_REVIEW_CLOSED: 닫은 평가 결과는 바꾸지 않습니다.'; END IF;
  IF v_state = 'GOALS' AND (NEW.self_submitted_at IS NOT NULL OR NEW.grade IS NOT NULL) THEN
    RAISE EXCEPTION 'HR_REVIEW_STATE: 목표 단계에는 평가를 제출하지 않습니다.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.cycle_id, NEW.employee_id) IS DISTINCT FROM (OLD.cycle_id, OLD.employee_id) THEN RAISE EXCEPTION 'HR_REVIEW: 차례 · 직원은 바꾸지 않습니다.'; END IF;
    IF OLD.self_submitted_at IS NOT NULL AND (NEW.self_comment, NEW.self_submitted_at) IS DISTINCT FROM (OLD.self_comment, OLD.self_submitted_at) THEN
      RAISE EXCEPTION 'HR_REVIEW_SUBMITTED: 제출한 자기 평가는 고치지 않습니다.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_training_kinds_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_TRAINING_KIND: 교육 종류는 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.code, OLD.created_at) THEN RAISE EXCEPTION 'HR_TRAINING_KIND: 종류 코드 · 만든 시각은 바꾸지 않습니다.'; END IF;
  IF NEW.cycle_months IS DISTINCT FROM OLD.cycle_months
     AND EXISTS (SELECT 1 FROM public.hr_training_records r WHERE r.kind_code = OLD.code) THEN
    RAISE EXCEPTION 'HR_TRAINING_KIND_USED: 이수 기록이 있는 종류는 주기를 바꾸지 않습니다(새 종류로).';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hr_training_records_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_cycle integer; f public.files;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HR_TRAINING: 이수 기록은 지우지 않습니다(무효로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT cycle_months INTO v_cycle FROM public.hr_training_kinds WHERE code = NEW.kind_code;
    IF v_cycle = 12 AND NEW.period !~ '^[0-9]{4}$' OR v_cycle = 6 AND NEW.period !~ '^[0-9]{4}-H[12]$' THEN
      RAISE EXCEPTION 'HR_TRAINING_PERIOD: 기간이 종류 주기와 맞지 않습니다.';
    END IF;
    IF substr(NEW.period, 1, 4) <> to_char(NEW.done_on, 'YYYY') THEN
      RAISE EXCEPTION 'HR_TRAINING_PERIOD: 이수일이 기간 안에 있어야 합니다.';
    END IF;
    IF NEW.file_id IS NOT NULL THEN
      SELECT * INTO f FROM svc.files WHERE id = NEW.file_id;
      IF f.id IS NULL OR f.purpose <> 'HR_DOC' OR f.status <> 'READY' THEN
        RAISE EXCEPTION 'HR_TRAINING_FILE: 증빙은 인사 서류 용도(HR_DOC)로 올린 파일(READY)만 붙입니다.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.employee_id, NEW.kind_code, NEW.period, NEW.done_on, NEW.hours, NEW.method, NEW.provider, NEW.file_id, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.kind_code, OLD.period, OLD.done_on, OLD.hours, OLD.method, OLD.provider, OLD.file_id, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HR_TRAINING: 이수 내용은 고치지 않습니다(무효로 하고 다시).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'SUBMITTED' AND NEW.state IN ('CONFIRMED', 'VOID')) OR (OLD.state = 'CONFIRMED' AND NEW.state = 'VOID')) THEN
      RAISE EXCEPTION 'HR_TRAINING_STATE: 이수 상태는 앞으로만 바뀝니다.';
    END IF;
  ELSIF (NEW.decided_by, NEW.decided_at, NEW.void_reason) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.void_reason) THEN
    RAISE EXCEPTION 'HR_TRAINING_STATE: 처리 기록은 상태를 바꿀 때만 씁니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hra_close_items_keep()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_CLOSE: 체크리스트 항목은 지우지 않습니다(끄기).'; END IF;
  IF (NEW.key, NEW.kind) IS DISTINCT FROM (OLD.key, OLD.kind) THEN RAISE EXCEPTION 'HRA_CLOSE: 항목 열쇠 · 종류는 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hra_leave_promo_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_LEAVE_PROMO: 연차 촉진 기록은 지우지 않습니다.'; END IF;
  IF (NEW.employee_id, NEW.year, NEW.round, NEW.unused_days, NEW.issued_on, NEW.reply_due, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.year, OLD.round, OLD.unused_days, OLD.issued_on, OLD.reply_due, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 직원 · 해 · 차례 · 남은 연차 · 알린 날 · 기한은 고치지 않습니다.';
  END IF;
  IF OLD.state IN ('PLANNED', 'NO_PLAN', 'DESIGNATED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 정해진 상태는 되돌리지 않습니다.';
  END IF;
  IF OLD.state = 'PLANNED' AND NEW.plan_dates IS DISTINCT FROM OLD.plan_dates THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 낸 계획은 고치지 않습니다(휴가 신청으로 바꿔 씀).';
  END IF;
  IF OLD.round = 2 AND NEW.designated_dates IS DISTINCT FROM OLD.designated_dates THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 지정한 날은 고치지 않습니다.';
  END IF;
  IF OLD.acked_at IS NOT NULL AND NEW.acked_at IS DISTINCT FROM OLD.acked_at THEN
    RAISE EXCEPTION 'HRA_LEAVE_PROMO: 확인 시각은 고치지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hra_lib_can_read(p_post bigint, p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.hra_lib_posts p
     WHERE p.id = p_post
       AND (EXISTS (SELECT 1 FROM svc.account_roles r WHERE r.account_id = p_account AND r.role = 'SUPER' AND (r.expires_at IS NULL OR r.expires_at > now()))
         OR (cardinality(p.audience) = 0
             AND EXISTS (SELECT 1 FROM svc.account_roles r WHERE r.account_id = p_account AND r.role IN ('ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF')
                           AND (r.expires_at IS NULL OR r.expires_at > now())))
         OR EXISTS (SELECT 1 FROM svc.perm_account_groups g WHERE g.account_id = p_account AND g.group_key = ANY (p.audience) AND (g.expires_at IS NULL OR g.expires_at > now()))
         OR EXISTS (SELECT 1 FROM svc.perm_role_groups g JOIN svc.account_roles r ON r.role = g.from_role
                     WHERE g.key = ANY (p.audience) AND g.active AND r.account_id = p_account AND (r.expires_at IS NULL OR r.expires_at > now()))))
$function$;

CREATE OR REPLACE FUNCTION public.fn_hra_lib_file_keep()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED'
     AND EXISTS (SELECT 1 FROM public.hra_lib_posts p WHERE p.file_id = OLD.id) THEN
    RAISE EXCEPTION 'FILE: 사내 자료실에 붙은 파일은 지울 수 없습니다';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hra_lib_post_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE f public.files; bad text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_LIB: 사내 자료실 글은 지우지 않습니다(보관 끝으로).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.kind, NEW.created_by, NEW.created_at, NEW.file_id, NEW.corp_doc_id) IS DISTINCT FROM (OLD.kind, OLD.created_by, OLD.created_at, OLD.file_id, OLD.corp_doc_id) THEN
      RAISE EXCEPTION 'HRA_LIB: 종류 · 쓴 사람 · 붙은 파일은 바꾸지 않습니다(새 글로).';
    END IF;
    IF OLD.state = 'ARCHIVED' AND (NEW.state, NEW.title, NEW.body, NEW.audience, NEW.must_read, NEW.read_due, NEW.pinned)
       IS DISTINCT FROM (OLD.state, OLD.title, OLD.body, OLD.audience, OLD.must_read, OLD.read_due, OLD.pinned) THEN
      RAISE EXCEPTION 'HRA_LIB: 보관 끝 글은 고치거나 되돌리지 않습니다.';
    END IF;
    NEW.updated_at := now();
  END IF;
  SELECT string_agg(a, ',') INTO bad FROM unnest(NEW.audience) a WHERE NOT EXISTS (SELECT 1 FROM svc.perm_role_groups g WHERE g.key = a);
  IF bad IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE = 'HRA_LIB_AUDIENCE: 없는 권한그룹입니다(' || bad || ').'; END IF;
  IF TG_OP = 'INSERT' AND NEW.file_id IS NOT NULL THEN
    SELECT * INTO f FROM svc.files WHERE id = NEW.file_id;
    IF f.id IS NULL OR f.purpose <> 'CORP_DOC' OR f.status <> 'READY' THEN RAISE EXCEPTION 'HRA_LIB_FILE: 사내 문서 용도(CORP_DOC)로 올린 파일(READY)만 붙입니다.'; END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hra_pay_bank_keep()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRA_PAY_BANK: 급여 계좌는 지우지 않습니다(바꾸기만 · 바뀐 기록).'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_bookings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_BOOKING: 예약은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.hrx_resources r WHERE r.id = NEW.resource_id AND r.active) THEN
      RAISE EXCEPTION 'HRX_BOOKING: 쓰지 않는 자원에는 예약하지 않습니다.';
    END IF;
    IF NEW.canceled_at IS NOT NULL THEN RAISE EXCEPTION 'HRX_BOOKING: 새 예약은 취소 상태로 넣지 않습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.resource_id, NEW.booked_by, NEW.title, NEW.memo, NEW.start_at, NEW.end_at, NEW.created_at)
     IS DISTINCT FROM (OLD.resource_id, OLD.booked_by, OLD.title, OLD.memo, OLD.start_at, OLD.end_at, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_BOOKING: 예약 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF OLD.canceled_at IS NOT NULL AND (NEW.canceled_at, NEW.canceled_by, NEW.cancel_reason) IS DISTINCT FROM (OLD.canceled_at, OLD.canceled_by, OLD.cancel_reason) THEN
    RAISE EXCEPTION 'HRX_BOOKING: 이미 취소한 예약입니다.';
  END IF;
  IF OLD.canceled_at IS NULL AND NEW.canceled_at IS NULL AND NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
    RAISE EXCEPTION 'HRX_BOOKING: 취소 사유는 취소할 때만 씁니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_ot_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_night numeric := 0; v_ws timestamptz; d integer; v_sat text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_OT: 연장 근로 신청은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'REQUESTED' THEN RAISE EXCEPTION 'HRX_OT_STATE: 새 신청은 신청 상태로 시작합니다.'; END IF;
    IF (NEW.start_at AT TIME ZONE 'Asia/Seoul')::date <> NEW.work_on THEN
      RAISE EXCEPTION 'HRX_OT_TIME: 시작 시각은 일한 날(한국 시각) 안이어야 합니다.';
    END IF;
    NEW.minutes := floor(extract(epoch FROM (NEW.end_at - NEW.start_at)) / 60)::integer;
    FOR d IN -1..1 LOOP
      v_ws := ((NEW.work_on + d) + time '22:00') AT TIME ZONE 'Asia/Seoul';
      v_night := v_night + greatest(0, extract(epoch FROM (least(NEW.end_at, v_ws + interval '8 hours') - greatest(NEW.start_at, v_ws))) / 60);
    END LOOP;
    NEW.night_min := floor(v_night)::integer;
    SELECT value INTO v_sat FROM svc.site_settings WHERE key = 'hrx.sat_as_holiday';
    NEW.day_kind := CASE
      WHEN public.fn_is_business_day(NEW.work_on) THEN 'WORKDAY'
      WHEN extract(isodow FROM NEW.work_on) = 6 AND coalesce(v_sat, 'off') <> 'on'
           AND NOT EXISTS (SELECT 1 FROM svc.public_holidays h WHERE h.day = NEW.work_on) THEN 'OFFDAY'
      ELSE 'HOLIDAY' END;
    NEW.decided_by := NULL; NEW.decided_at := NULL; NEW.decide_note := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.employee_id, NEW.work_on, NEW.start_at, NEW.end_at, NEW.minutes, NEW.night_min, NEW.day_kind, NEW.reason, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.employee_id, OLD.work_on, OLD.start_at, OLD.end_at, OLD.minutes, OLD.night_min, OLD.day_kind, OLD.reason, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_OT: 신청 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED')) OR (OLD.state = 'APPROVED' AND NEW.state = 'CANCELED')) THEN
      RAISE EXCEPTION 'HRX_OT_STATE: 신청 상태는 앞으로만 바뀝니다.';
    END IF;
    IF OLD.state = 'APPROVED' AND EXISTS (SELECT 1 FROM public.hrx_ot_pay_links l WHERE l.request_id = OLD.id) THEN
      RAISE EXCEPTION 'HRX_OT_PAID: 급여 대장에 넘긴 연장 근로는 취소하지 않습니다(급여 대장 넘김을 먼저 되돌림).';
    END IF;
  ELSIF (NEW.decided_by, NEW.decided_at, NEW.decide_note) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decide_note) THEN
    RAISE EXCEPTION 'HRX_OT_STATE: 처리 기록은 상태를 바꿀 때만 씁니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_ot_pay_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'HRX_OT_PAY: 급여 대장 넘김 기록은 고치지 않습니다(되돌리고 다시).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT state INTO v_state FROM public.acct_payroll_runs WHERE id = NEW.run_id;
    IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'HRX_OT_PAY: 초안(확정 전) 급여 대장에만 넘깁니다.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hrx_ot_requests r WHERE r.id = NEW.request_id AND r.state = 'APPROVED') THEN
      RAISE EXCEPTION 'HRX_OT_PAY: 승인한 연장 근로만 넘깁니다.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.acct_payroll_lines l JOIN public.hrx_ot_requests r ON r.employee_id = l.employee_id
                    WHERE l.id = NEW.line_id AND l.run_id = NEW.run_id AND r.id = NEW.request_id) THEN
      RAISE EXCEPTION 'HRX_OT_PAY: 그 직원의 급여 줄이 아닙니다.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT state INTO v_state FROM public.acct_payroll_runs WHERE id = OLD.run_id;
  IF v_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'HRX_OT_PAY: 확정한 급여에 넘긴 연장 근로는 되돌리지 않습니다.'; END IF;
  RETURN OLD;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_resources_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_RESOURCE: 예약 자원은 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.kind, NEW.created_at) IS DISTINCT FROM (OLD.kind, OLD.created_at) THEN RAISE EXCEPTION 'HRX_RESOURCE: 자원 종류 · 만든 시각은 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_shift_types_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_SHIFT_TYPE: 교대 유형은 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.code, OLD.created_at) THEN RAISE EXCEPTION 'HRX_SHIFT_TYPE: 유형 코드 · 만든 시각은 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_shifts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE t public.hrx_shift_types; v_lock date := (now() AT TIME ZONE 'Asia/Seoul')::date - 7;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.work_on < v_lock THEN RAISE EXCEPTION 'HRX_SHIFT_PAST: 7일 넘게 지난 근무표는 지우지 않습니다.'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.work_on < v_lock OR (TG_OP = 'UPDATE' AND OLD.work_on < v_lock) THEN
    RAISE EXCEPTION 'HRX_SHIFT_PAST: 7일 넘게 지난 근무표는 넣거나 바꾸지 않습니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.employee_id, NEW.work_on, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.employee_id, OLD.work_on, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_SHIFT: 직원 · 날짜는 바꾸지 않습니다(지우고 다시).';
  END IF;
  SELECT * INTO t FROM public.hrx_shift_types WHERE code = NEW.type_code;
  IF t.code IS NULL OR (NOT t.active AND (TG_OP = 'INSERT' OR NEW.type_code IS DISTINCT FROM OLD.type_code)) THEN
    RAISE EXCEPTION 'HRX_SHIFT_TYPE: 쓰는 교대 유형만 넣습니다.';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.type_code IS DISTINCT FROM OLD.type_code THEN
    NEW.kind := t.kind; NEW.start_hm := t.start_hm; NEW.end_hm := t.end_hm; NEW.break_min := t.break_min;
  ELSIF (NEW.kind, NEW.start_hm, NEW.end_hm, NEW.break_min) IS DISTINCT FROM (OLD.kind, OLD.start_hm, OLD.end_hm, OLD.break_min) THEN
    RAISE EXCEPTION 'HRX_SHIFT: 칸 시각은 유형을 바꿔서 바꿉니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_stocktake_lines_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_STOCKTAKE: 실사 줄은 지우지 않습니다.'; END IF;
  SELECT state INTO v_state FROM public.hrx_stocktakes WHERE id = NEW.stocktake_id;
  IF TG_OP = 'INSERT' THEN
    IF v_state IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 열린 회차에만 자산을 넣습니다.'; END IF;
    IF NEW.disposed_at IS NOT NULL THEN RAISE EXCEPTION 'HRX_STOCKTAKE: 처분 시각은 닫은 뒤에 씁니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.stocktake_id, NEW.asset_id, NEW.created_at) IS DISTINCT FROM (OLD.stocktake_id, OLD.asset_id, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_STOCKTAKE: 회차 · 자산은 바꾸지 않습니다.';
  END IF;
  IF NEW.disposed_at IS DISTINCT FROM OLD.disposed_at THEN
    IF OLD.disposed_at IS NOT NULL OR v_state <> 'CLOSED' OR OLD.result <> 'MISSING'
       OR NOT EXISTS (SELECT 1 FROM public.acct_assets a WHERE a.id = OLD.asset_id AND a.state = 'DISPOSED') THEN
      RAISE EXCEPTION 'HRX_STOCKTAKE_DISPOSE: 처분 시각은 닫은 회차의 없음 자산을 처분한 뒤 한 번만 씁니다.';
    END IF;
    IF (NEW.result, NEW.location, NEW.note, NEW.checked_by, NEW.checked_at) IS DISTINCT FROM (OLD.result, OLD.location, OLD.note, OLD.checked_by, OLD.checked_at) THEN
      RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 닫은 회차 줄은 고치지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  /* 닫는 거래 안에서 확인 전 → 없음으로 바꾸는 것은 회차가 아직 열려 있을 때(닫기 전에) 함 */
  IF v_state <> 'OPEN' THEN RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 닫은 회차 줄은 고치지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_hrx_stocktakes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HRX_STOCKTAKE: 실사 회차는 지우지 않습니다.'; END IF;
  IF (NEW.title, NEW.as_of, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.title, OLD.as_of, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'HRX_STOCKTAKE: 회차 이름 · 기준일은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'HRX_STOCKTAKE_CLOSED: 닫은 회차는 고치지 않습니다.'; END IF;
  IF NEW.state = 'CLOSED' AND EXISTS (SELECT 1 FROM public.hrx_stocktake_lines l WHERE l.stocktake_id = OLD.id AND l.result = 'PENDING') THEN
    RAISE EXCEPTION 'HRX_STOCKTAKE_PENDING: 확인 전 자산이 남아 있어 닫지 않습니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_is_business_day(p_day date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT extract(isodow FROM p_day) NOT IN (6, 7) AND NOT EXISTS (SELECT 1 FROM svc.public_holidays h WHERE h.day = p_day);
$function$;

CREATE OR REPLACE FUNCTION public.fn_its_asset_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ITS_ASSET: IT 자산은 지우지 않습니다(해지하십시오).'; END IF;
  IF OLD.state = 'CANCELED' AND (NEW.state, NEW.name, NEW.cost_amount, NEW.billing_cycle, NEW.renew_on) IS DISTINCT FROM (OLD.state, OLD.name, OLD.cost_amount, OLD.billing_cycle, OLD.renew_on) THEN
    RAISE EXCEPTION 'ITS_ASSET_STATE: 해지한 자산은 고치지 않습니다(새로 넣으십시오).';
  END IF;
  IF (NEW.kind, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.kind, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ITS_ASSET: 종류 · 넣은 사람은 바꾸지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_its_key_rotated()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.its_key_life AS l (integration_code, key_name, rotated_at, rotated_by, rotate_source, expires_on, updated_at)
    VALUES (NEW.integration_code, NEW.name, now(), NEW.updated_by, 'ADMIN_KEY', NULL, now())
    ON CONFLICT (integration_code, key_name) DO UPDATE
       SET rotated_at = now(), rotated_by = EXCLUDED.rotated_by, rotate_source = 'ADMIN_KEY', expires_on = NULL, updated_at = now();
    INSERT INTO public.its_key_events (integration_code, key_name, kind, detail, actor)
    VALUES (NEW.integration_code, NEW.name, 'ROTATED', jsonb_build_object('source', 'ADMIN_KEY'), NEW.updated_by);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'its_key_life: 교체 표시를 남기지 못했습니다(키 저장은 그대로).';
  END;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_its_suggest_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ITS_SUGGEST: 제안은 지우지 않습니다.'; END IF;
  IF (NEW.category, NEW.title, NEW.body, NEW.is_anon, NEW.author_id, NEW.created_on, NEW.created_at, NEW.receipt_hash)
     IS DISTINCT FROM (OLD.category, OLD.title, OLD.body, OLD.is_anon, OLD.author_id, OLD.created_on, OLD.created_at, OLD.receipt_hash) THEN
    RAISE EXCEPTION 'ITS_SUGGEST: 제안 내용 · 익명 여부 · 쓴 사람 · 날짜는 바꾸지 않습니다.';
  END IF;
  IF OLD.state IN ('DECLINED', 'DONE') AND (NEW.state, NEW.answer) IS DISTINCT FROM (OLD.state, OLD.answer) THEN
    RAISE EXCEPTION 'ITS_SUGGEST_STATE: 끝난 제안은 바꾸지 않습니다.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'RECEIVED' AND NEW.state IN ('REVIEWING', 'ADOPTED', 'DECLINED'))
    OR (OLD.state = 'REVIEWING' AND NEW.state IN ('RECEIVED', 'ADOPTED', 'DECLINED'))
    OR (OLD.state = 'ADOPTED' AND NEW.state = 'DONE')) THEN
    RAISE EXCEPTION 'ITS_SUGGEST_STATE: 그 상태로는 옮길 수 없습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_its_suggest_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.created_on := (now() AT TIME ZONE 'Asia/Seoul')::date;
  IF NEW.is_anon THEN
    NEW.author_id := NULL;      -- 익명: 쓴 사람을 남기지 않음(서버가 보내도 지움)
    NEW.created_at := NULL;     -- 익명: 시각을 남기지 않음(날짜만)
  ELSE
    NEW.created_at := now();
    NEW.receipt_hash := NULL;
  END IF;
  NEW.state := 'RECEIVED'; NEW.answer := NULL; NEW.answered_at := NULL; NEW.answered_by := NULL;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_its_survey_answer_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE s record; q record; v jsonb; k text; today date := (now() AT TIME ZONE 'Asia/Seoul')::date; n int;
BEGIN
  SELECT * INTO s FROM public.its_surveys WHERE id = NEW.survey_id;
  IF s.id IS NULL OR s.state <> 'OPEN' OR today < s.opens_on OR today > s.closes_on THEN
    RAISE EXCEPTION 'ITS_SURVEY_CLOSED: 지금 받는 설문이 아닙니다.';
  END IF;
  IF s.is_anon THEN
    NEW.account_id := NULL;   -- 익명: 누가 냈는지 답에 남기지 않음(낸 사실은 its_survey_takers 에만 · 시각 없음)
  ELSIF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 이름을 밝히는 설문은 계정이 있어야 합니다.';
  END IF;
  FOR k IN SELECT jsonb_object_keys(NEW.answers) LOOP
    IF k !~ '^[0-9]{1,18}$' OR NOT EXISTS (SELECT 1 FROM public.its_survey_questions x WHERE x.survey_id = s.id AND x.id = k::bigint) THEN
      RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 이 설문에 없는 질문의 답이 있습니다.';
    END IF;
  END LOOP;
  FOR q IN SELECT * FROM public.its_survey_questions x WHERE x.survey_id = s.id ORDER BY x.ord LOOP
    v := NEW.answers -> q.id::text;
    IF v IS NULL OR v = 'null'::jsonb THEN
      IF q.required THEN RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 꼭 답할 질문이 비었습니다.'; END IF;
      CONTINUE;
    END IF;
    IF q.qtype = 'SINGLE' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 고를 수 있는 답이 아닙니다.';
      END IF;
      IF (v #>> '{}')::int >= cardinality(q.options) THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 고를 수 있는 답이 아닙니다.';
      END IF;
    ELSIF q.qtype = 'MULTI' THEN
      IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) < 1 OR jsonb_array_length(v) > cardinality(q.options) THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 여럿 고르기 답 모양이 아닙니다.';
      END IF;
      SELECT count(*) INTO n FROM jsonb_array_elements(v) e
       WHERE CASE WHEN jsonb_typeof(e) = 'number' AND (e #>> '{}') ~ '^[0-9]{1,2}$' THEN (e #>> '{}')::int >= cardinality(q.options) ELSE true END;
      IF n > 0 OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(v) e) <> jsonb_array_length(v) THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 여럿 고르기 답 모양이 아닙니다.';
      END IF;
    ELSIF q.qtype = 'SCALE' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 점수가 범위 밖입니다.';
      END IF;
      IF (v #>> '{}')::int NOT BETWEEN 1 AND q.scale_max THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 점수가 범위 밖입니다.';
      END IF;
    ELSE
      IF jsonb_typeof(v) <> 'string' OR char_length(v #>> '{}') > 1000 THEN
        RAISE EXCEPTION 'ITS_SURVEY_ANSWER: 글 답은 1000자까지입니다.';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_its_survey_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ITS_SURVEY: 설문은 지우지 않습니다(취소하십시오).'; END IF;
  IF (NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'ITS_SURVEY: 만든 사람은 바꾸지 않습니다.';
  END IF;
  IF OLD.state IN ('CLOSED', 'CANCELED') AND (NEW.state, NEW.title, NEW.intro, NEW.is_anon, NEW.audience, NEW.opens_on, NEW.closes_on)
     IS DISTINCT FROM (OLD.state, OLD.title, OLD.intro, OLD.is_anon, OLD.audience, OLD.opens_on, OLD.closes_on) THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 마감 · 취소한 설문은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'OPEN' AND (NEW.title, NEW.intro, NEW.is_anon, NEW.audience, NEW.opens_on) IS DISTINCT FROM (OLD.title, OLD.intro, OLD.is_anon, OLD.audience, OLD.opens_on) THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 받는 중인 설문은 마감일만 늦출 수 있습니다.';
  END IF;
  IF OLD.state = 'OPEN' AND NEW.closes_on < OLD.closes_on THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 받는 중인 설문의 마감일은 앞당기지 않습니다(지금 마감하십시오).';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'DRAFT' AND NEW.state IN ('OPEN', 'CANCELED'))
    OR (OLD.state = 'OPEN' AND NEW.state IN ('CLOSED', 'CANCELED'))) THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 그 상태로는 옮길 수 없습니다.';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state = 'OPEN' AND NOT EXISTS (SELECT 1 FROM public.its_survey_questions q WHERE q.survey_id = NEW.id) THEN
    RAISE EXCEPTION 'ITS_SURVEY_EMPTY: 질문이 하나도 없는 설문은 열지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_its_survey_q_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  SELECT s.state INTO st FROM public.its_surveys s WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.survey_id ELSE NEW.survey_id END;
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'ITS_SURVEY_STATE: 질문은 고치는 중(DRAFT)인 설문에서만 바꿉니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.survey_id IS DISTINCT FROM OLD.survey_id THEN
    RAISE EXCEPTION 'ITS_SURVEY: 질문을 다른 설문으로 옮기지 않습니다.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_case_costs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_COST: 비용 줄은 지우지 않습니다(무효로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT state INTO st FROM public.lgl_cases WHERE id = NEW.case_id;
    IF st IS NULL THEN RAISE EXCEPTION 'LGL_CASE: 없는 사건입니다.'; END IF;
    IF NEW.state <> 'ACTIVE' THEN RAISE EXCEPTION 'LGL_COST: 새 비용 줄은 유효 상태로만 들어갑니다.'; END IF;
    IF NEW.expense_claim_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.acct_expense_claims c WHERE c.id = NEW.expense_claim_id AND c.state IN ('REQUESTED', 'APPROVED', 'PAID')) THEN
      RAISE EXCEPTION 'LGL_COST_LINK: 반려 · 취소한 경비 청구에는 연결하지 않습니다.';
    END IF;
    IF NEW.purchase_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.acct_purchases p WHERE p.id = NEW.purchase_id AND p.state = 'ACTIVE') THEN
      RAISE EXCEPTION 'LGL_COST_LINK: 취소한 매입에는 연결하지 않습니다.';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.case_id, NEW.kind, NEW.amount, NEW.paid_on, NEW.expense_claim_id, NEW.purchase_id, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.case_id, OLD.kind, OLD.amount, OLD.paid_on, OLD.expense_claim_id, OLD.purchase_id, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_COST: 비용 내용은 고치지 않습니다(무효로 하고 다시).';
  END IF;
  IF NOT (OLD.state = 'ACTIVE' AND NEW.state IN ('ACTIVE', 'VOID')) THEN RAISE EXCEPTION 'LGL_COST: 무효한 줄은 되돌리지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_case_hearings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_HEARING: 기일은 지우지 않습니다(취소로).'; END IF;
  SELECT state INTO st FROM public.lgl_cases WHERE id = NEW.case_id;
  IF TG_OP = 'INSERT' THEN
    IF st IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'LGL_CASE_STATE: 끝낸 사건에는 기일을 넣지 않습니다.'; END IF;
    IF NEW.state <> 'PLANNED' THEN RAISE EXCEPTION 'LGL_HEARING_STATE: 새 기일은 예정으로만 들어갑니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.case_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.case_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_HEARING: 사건은 바꾸지 않습니다.';
  END IF;
  IF OLD.state <> 'PLANNED' THEN RAISE EXCEPTION 'LGL_HEARING_STATE: 끝남 · 취소한 기일은 고치지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_cases_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_CASE: 사건은 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 10);
    IF NEW.state <> 'OPEN' THEN RAISE EXCEPTION 'LGL_CASE_STATE: 새 사건은 진행 상태로만 들어갑니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.kind, NEW.opened_on, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.kind, OLD.opened_on, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_CASE: 사건 종류 · 시작일은 바꾸지 않습니다.';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'LGL_CASE_STATE: 끝낸 사건은 고치지 않습니다.'; END IF;
  IF NEW.file_ids IS DISTINCT FROM OLD.file_ids THEN PERFORM public.fn_lgl_check_files(NEW.file_ids, 10); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_check_files(p_ids uuid[], p_max integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF p_ids IS NULL THEN RETURN; END IF;
  IF cardinality(p_ids) > p_max THEN RAISE EXCEPTION 'LGL_FILE: 파일이 너무 많습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) x(id) LEFT JOIN svc.files f ON f.id = x.id
              WHERE f.id IS NULL OR f.purpose <> 'LGL_DOC' OR f.status <> 'READY') THEN
    RAISE EXCEPTION 'LGL_FILE: 법무 서류 용도(LGL_DOC)로 올린 파일(READY)만 붙입니다.';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_contract_reviews_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_REVIEW: 검토 요청은 지우지 않습니다(취소로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
    IF NEW.state <> 'REQUESTED' THEN RAISE EXCEPTION 'LGL_REVIEW_STATE: 새 요청은 요청 상태로만 들어갑니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.title, NEW.kind, NEW.counterparty, NEW.amount, NEW.wanted_on, NEW.summary, NEW.file_ids, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM (OLD.title, OLD.kind, OLD.counterparty, OLD.amount, OLD.wanted_on, OLD.summary, OLD.file_ids, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_REVIEW: 검토 요청 내용은 고치지 않습니다(취소하고 다시).';
  END IF;
  IF NEW.contract_id IS DISTINCT FROM OLD.contract_id AND OLD.contract_id IS NOT NULL THEN
    RAISE EXCEPTION 'LGL_REVIEW_LINK: 연결한 계약은 바꾸지 않습니다.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NOT ((OLD.state = 'REQUESTED' AND NEW.state IN ('REVIEWED', 'CANCELED'))
         OR (OLD.state = 'REVIEWED' AND NEW.state IN ('APPROVED', 'REJECTED', 'CANCELED'))) THEN
      RAISE EXCEPTION 'LGL_REVIEW_STATE: 검토 요청 상태는 앞으로만 바뀝니다(승인 · 반려는 의견 뒤).';
    END IF;
  ELSIF (NEW.decided_by, NEW.decided_at, NEW.decide_note) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decide_note) THEN
    RAISE EXCEPTION 'LGL_REVIEW_STATE: 결정 기록은 상태를 바꿀 때만 씁니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_files_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'DELETED' AND OLD.status IS DISTINCT FROM 'DELETED' AND OLD.purpose = 'LGL_DOC' THEN
    IF EXISTS (SELECT 1 FROM public.lgl_licenses x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_license_renewals x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_contract_reviews x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_review_opinions x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_cases x WHERE OLD.id = ANY (x.file_ids))
       OR EXISTS (SELECT 1 FROM public.lgl_insurance_policies x WHERE OLD.id = ANY (x.file_ids)) THEN
      RAISE EXCEPTION 'FILE: 법무 대장(인허가 · 계약 검토 · 사건 · 보험)에 붙은 서류는 지울 수 없습니다';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_insurance_policies_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE prev public.lgl_insurance_policies;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_INSURANCE: 보험 증권은 지우지 않습니다(끝냄으로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
    IF NEW.state <> 'ACTIVE' THEN RAISE EXCEPTION 'LGL_INSURANCE_STATE: 새 증권은 유효 상태로만 들어갑니다.'; END IF;
    IF NEW.renewed_from IS NOT NULL THEN
      SELECT * INTO prev FROM public.lgl_insurance_policies WHERE id = NEW.renewed_from;
      IF prev.id IS NULL THEN RAISE EXCEPTION 'LGL_INSURANCE_RENEW: 없는 증권을 갱신할 수 없습니다.'; END IF;
      IF NEW.starts_on < prev.starts_on THEN RAISE EXCEPTION 'LGL_INSURANCE_RENEW: 갱신 증권 시작일은 옛 증권 시작일 뒤입니다.'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.kind, NEW.premium, NEW.starts_on, NEW.ends_on, NEW.pay_mode, NEW.book_mode, NEW.renewed_from, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.kind, OLD.premium, OLD.starts_on, OLD.ends_on, OLD.pay_mode, OLD.book_mode, OLD.renewed_from, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_INSURANCE: 종류 · 보험료 · 기간 · 내는 방법 · 회계 처리는 고치지 않습니다(끝내고 새로).';
  END IF;
  IF OLD.state = 'ENDED' THEN RAISE EXCEPTION 'LGL_INSURANCE_STATE: 끝낸 증권은 고치지 않습니다.'; END IF;
  IF NEW.file_ids IS DISTINCT FROM OLD.file_ids THEN PERFORM public.fn_lgl_check_files(NEW.file_ids, 5); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_insurance_postings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LGL_POSTING: 보험료 전표 초안 기록은 고치거나 지우지 않습니다(쌓기만).'; END IF;
  IF EXISTS (SELECT 1 FROM public.lgl_insurance_postings p JOIN public.acct_manual_entries m ON m.id = p.manual_id
              WHERE p.policy_id = NEW.policy_id AND p.kind = NEW.kind AND p.ym = NEW.ym AND m.state IN ('REQUESTED', 'APPROVED')) THEN
    RAISE EXCEPTION 'LGL_POSTING_DUP: 그 달 같은 보험료 전표 초안이 이미 있습니다(반려 · 취소한 뒤 다시).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_license_kinds_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_LICENSE_KIND: 인허가 종류는 지우지 않습니다(쓰지 않음으로).'; END IF;
  IF (NEW.code, NEW.created_at) IS DISTINCT FROM (OLD.code, OLD.created_at) THEN RAISE EXCEPTION 'LGL_LICENSE_KIND: 종류 코드 · 만든 시각은 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_license_renewals_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LGL_RENEWAL: 갱신 기록은 고치거나 지우지 않습니다(쌓기만).'; END IF;
  SELECT state INTO st FROM public.lgl_licenses WHERE id = NEW.license_id;
  IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'LGL_LICENSE_STATE: 끝낸 인허가에는 갱신을 기록하지 않습니다.'; END IF;
  IF NEW.next_due_on IS NOT NULL AND NEW.next_due_on <= NEW.done_on THEN RAISE EXCEPTION 'LGL_RENEWAL: 다음 갱신일은 처리일 뒤입니다.'; END IF;
  PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_licenses_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'LGL_LICENSE: 인허가는 지우지 않습니다(끝냄으로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_lgl_check_files(NEW.file_ids, 5);
    RETURN NEW;
  END IF;
  IF (NEW.kind_code, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.kind_code, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'LGL_LICENSE: 종류 · 만든 사람은 바꾸지 않습니다(끝내고 새로).';
  END IF;
  IF OLD.state = 'CLOSED' THEN RAISE EXCEPTION 'LGL_LICENSE_STATE: 끝낸 인허가는 고치지 않습니다.'; END IF;
  IF NEW.file_ids IS DISTINCT FROM OLD.file_ids THEN PERFORM public.fn_lgl_check_files(NEW.file_ids, 5); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_lgl_review_opinions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE r public.lgl_contract_reviews;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'LGL_OPINION: 검토 의견은 고치거나 지우지 않습니다(쌓기만).'; END IF;
  SELECT * INTO r FROM public.lgl_contract_reviews WHERE id = NEW.review_id;
  IF r.id IS NULL OR r.state NOT IN ('REQUESTED', 'REVIEWED') THEN RAISE EXCEPTION 'LGL_REVIEW_STATE: 결정 · 취소한 요청에는 의견을 달지 않습니다.'; END IF;
  IF r.requested_by = NEW.author THEN RAISE EXCEPTION 'LGL_SELF: 요청한 사람은 자기 요청에 검토 의견을 쓰지 않습니다.'; END IF;
  PERFORM public.fn_lgl_check_files(NEW.file_ids, 3);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ofc_event_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OFC_EVENT: 일정은 지우지 않습니다(지움 표시만).'; END IF;
  IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'OFC_EVENT_REMOVED: 지운 일정은 고치지 않습니다.'; END IF;
  IF (NEW.scope, NEW.owner_id, NEW.created_at) IS DISTINCT FROM (OLD.scope, OLD.owner_id, OLD.created_at) THEN
    RAISE EXCEPTION 'OFC_EVENT: 일정 종류 · 넣은 사람은 바꾸지 않습니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ofc_task_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OFC_TASK: 업무 요청은 지우지 않습니다(취소하십시오).'; END IF;
  IF (NEW.title, NEW.body, NEW.requester, NEW.created_at) IS DISTINCT FROM (OLD.title, OLD.body, OLD.requester, OLD.created_at) THEN
    RAISE EXCEPTION 'OFC_TASK: 제목 · 내용 · 요청한 사람은 고치지 않습니다(댓글로 덧붙이십시오).';
  END IF;
  IF OLD.state IN ('CANCELED') AND (NEW.state, NEW.assignee, NEW.due_on, NEW.priority) IS DISTINCT FROM (OLD.state, OLD.assignee, OLD.due_on, OLD.priority) THEN
    RAISE EXCEPTION 'OFC_TASK_STATE: 취소한 업무는 바꾸지 않습니다.';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'REQUESTED' AND NEW.state IN ('DOING', 'DONE', 'CANCELED'))
    OR (OLD.state = 'DOING' AND NEW.state IN ('REQUESTED', 'DONE', 'CANCELED'))
    OR (OLD.state = 'DONE' AND NEW.state = 'DOING')) THEN
    RAISE EXCEPTION 'OFC_TASK_STATE: 그 상태로는 옮길 수 없습니다.';
  END IF;
  IF OLD.state = 'DONE' AND NEW.state = 'DONE' AND NEW.assignee IS DISTINCT FROM OLD.assignee THEN
    RAISE EXCEPTION 'OFC_TASK_STATE: 끝난 업무는 담당을 바꾸지 않습니다(다시 열고 바꾸십시오).';
  END IF;
  IF NEW.state <> 'DONE' THEN NEW.done_at := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ofc_trip_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'OFC_TRIP: 출장 신청은 지우지 않습니다(취소하십시오).'; END IF;
  IF (NEW.traveler, NEW.destination, NEW.region, NEW.purpose, NEW.depart_on, NEW.return_on, NEW.transport_est, NEW.estimate, NEW.basis, NEW.requisition_id, NEW.created_at)
     IS DISTINCT FROM (OLD.traveler, OLD.destination, OLD.region, OLD.purpose, OLD.depart_on, OLD.return_on, OLD.transport_est, OLD.estimate, OLD.basis, OLD.requisition_id, OLD.created_at) THEN
    RAISE EXCEPTION 'OFC_TRIP: 출장 내용은 고치지 않습니다(취소하고 새로 신청하십시오).';
  END IF;
  IF OLD.state = 'CANCELED' THEN RAISE EXCEPTION 'OFC_TRIP_STATE: 취소한 출장은 바꾸지 않습니다.'; END IF;
  IF OLD.state = 'SETTLED' AND NEW.state <> 'SETTLED' THEN RAISE EXCEPTION 'OFC_TRIP_STATE: 정산한 출장은 취소하지 않습니다.'; END IF;
  IF NEW.claim_id IS DISTINCT FROM OLD.claim_id AND NOT EXISTS (SELECT 1 FROM public.ofc_trip_settlements s WHERE s.trip_id = NEW.id AND s.claim_id = NEW.claim_id) THEN
    RAISE EXCEPTION 'OFC_TRIP_CLAIM: 정산 줄이 없는 경비 청구는 붙이지 않습니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ofc_trip_settle_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE t record; c record;
BEGIN
  SELECT id, traveler, requisition_id, state INTO t FROM public.ofc_trips WHERE id = NEW.trip_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'OFC_TRIP: 없는 출장입니다.'; END IF;
  IF t.state = 'CANCELED' THEN RAISE EXCEPTION 'OFC_TRIP_STATE: 취소한 출장은 정산하지 않습니다.'; END IF;
  SELECT id, claimant, requisition_id, state INTO c FROM public.acct_expense_claims WHERE id = NEW.claim_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'OFC_TRIP_CLAIM: 없는 경비 청구입니다.'; END IF;
  IF c.claimant <> t.traveler OR c.requisition_id IS DISTINCT FROM t.requisition_id THEN
    RAISE EXCEPTION 'OFC_TRIP_CLAIM: 출장 간 사람 · 출장 품의의 경비 청구만 정산에 붙입니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ofc_trip_settlements s JOIN public.acct_expense_claims x ON x.id = s.claim_id
              WHERE s.trip_id = NEW.trip_id AND x.state IN ('REQUESTED', 'APPROVED', 'PAID')) THEN
    RAISE EXCEPTION 'OFC_TRIP_DOUBLE: 이 출장은 이미 여비를 청구했습니다(반려 · 취소된 뒤에만 다시 정산).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_perm_effective(p_account uuid)
 RETURNS TABLE(task_key text, level text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT x.task_key, x.level FROM (
    SELECT e.task_key, e.level
      FROM svc.perm_account_groups g JOIN svc.perm_role_groups r ON r.key = g.group_key AND r.active
      CROSS JOIN LATERAL public.fn_perm_group_expand(g.group_key) e
     WHERE g.account_id = p_account AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT o.task_key, o.level FROM svc.perm_account_overrides o
     WHERE o.account_id = p_account AND o.effect = 'ALLOW' AND (o.expires_at IS NULL OR o.expires_at > now())
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM svc.perm_account_overrides d
                     WHERE d.account_id = p_account AND d.effect = 'DENY' AND d.task_key = x.task_key AND d.level = x.level
                       AND (d.expires_at IS NULL OR d.expires_at > now()))
$function$;

CREATE OR REPLACE FUNCTION public.fn_perm_group_expand(p_group text)
 RETURNS TABLE(task_key text, level text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT y.task_key, y.level FROM (
    SELECT i.task_key, i.level FROM svc.perm_role_group_items i WHERE i.group_key = p_group AND i.effect = 'ALLOW'
    UNION
    SELECT gi.task_key, s.level
      FROM svc.perm_role_group_sets s
      JOIN svc.perm_task_groups tg ON tg.key = s.task_group_key AND tg.active
      JOIN svc.perm_task_group_items gi ON gi.group_key = s.task_group_key
      JOIN svc.perm_tasks t ON t.key = gi.task_key AND t.active AND s.level = ANY (t.levels)
     WHERE s.group_key = p_group
  ) y
  WHERE NOT EXISTS (SELECT 1 FROM svc.perm_role_group_items d
                     WHERE d.group_key = p_group AND d.effect = 'DENY' AND d.task_key = y.task_key AND d.level = y.level)
$function$;

CREATE OR REPLACE FUNCTION public.fn_prr_case_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PRR_CASE_KEEP: 입사 · 퇴사 흐름은 지우지 않습니다(취소하십시오).';
  END IF;
  IF OLD.state <> 'OPEN' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.target_on IS DISTINCT FROM OLD.target_on OR NEW.employee_id IS DISTINCT FROM OLD.employee_id) THEN
    RAISE EXCEPTION 'PRR_CASE_CLOSED: 끝났거나 취소한 흐름은 다시 열지 않습니다(새로 여십시오).';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_prr_case_step_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  SELECT c.state INTO v_state FROM public.prr_cases c WHERE c.id = coalesce(NEW.case_id, OLD.case_id);
  IF v_state IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'PRR_CASE_CLOSED: 끝났거나 취소한 흐름의 단계는 바꾸지 않습니다.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_prr_review_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PRR_ITEM_KEEP: 거둘 후보 기록은 지우지 않습니다.';
  END IF;
  IF OLD.state <> 'OPEN' THEN
    RAISE EXCEPTION 'PRR_ITEM_DECIDED: 이미 결정한 후보는 바꿀 수 없습니다.';
  END IF;
  IF NEW.quarter IS DISTINCT FROM OLD.quarter OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.target_kind IS DISTINCT FROM OLD.target_kind OR NEW.target IS DISTINCT FROM OLD.target THEN
    RAISE EXCEPTION 'PRR_ITEM_KEEP: 후보의 대상은 바꾸지 않습니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_claim_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE lo record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_CLAIM: 클레임은 지우지 않습니다(반려로).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('CLOSED', 'REJECTED') THEN RAISE EXCEPTION 'QLT_CLAIM: 끝내거나 반려한 클레임은 고치지 않습니다.'; END IF;
    IF (NEW.received_on, NEW.product_id, NEW.created_at) IS DISTINCT FROM (OLD.received_on, OLD.product_id, OLD.created_at) THEN
      RAISE EXCEPTION 'QLT_CLAIM: 접수일 · 상품은 바꾸지 않습니다.';
    END IF;
    IF NEW.sup_return_qty < OLD.sup_return_qty THEN RAISE EXCEPTION 'QLT_CLAIM: 공급사 반품 수량은 줄지 않습니다.'; END IF;
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT option_id, product_id INTO lo FROM public.qlt_lots WHERE id = NEW.lot_id;
    IF lo.product_id IS DISTINCT FROM NEW.product_id OR (NEW.option_id IS NOT NULL AND lo.option_id IS DISTINCT FROM NEW.option_id) THEN
      RAISE EXCEPTION 'QLT_CLAIM: 로트가 그 상품 · 옵션의 것이 아닙니다.';
    END IF;
  END IF;
  IF NEW.option_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM svc.hlt_product_options WHERE id = NEW.option_id AND product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'QLT_CLAIM: 옵션이 그 상품의 것이 아닙니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_cnt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_CNT: 실사 회차는 지우지 않습니다.'; END IF;
  IF OLD.state = 'CLOSED' AND NEW.state <> 'CLOSED' THEN RAISE EXCEPTION 'QLT_CNT: 닫은 실사는 다시 열지 않습니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_cnt_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_CNT: 실사 줄은 지우지 않습니다.'; END IF;
  SELECT state INTO v_state FROM public.qlt_lot_counts WHERE id = NEW.count_id;
  IF TG_OP = 'INSERT' THEN
    IF v_state <> 'OPEN' THEN RAISE EXCEPTION 'QLT_CNT: 닫은 실사에는 줄을 더하지 않습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.count_id <> OLD.count_id OR NEW.lot_id <> OLD.lot_id OR NEW.expected <> OLD.expected THEN
    RAISE EXCEPTION 'QLT_CNT: 실사 줄의 회차 · 로트 · 열 때 수량은 바꾸지 않습니다.';
  END IF;
  IF v_state = 'CLOSED' AND (NEW.counted IS DISTINCT FROM OLD.counted OR NEW.book_qty IS DISTINCT FROM OLD.book_qty OR NEW.note IS DISTINCT FROM OLD.note) THEN
    RAISE EXCEPTION 'QLT_CNT: 닫은 실사는 고치지 않습니다.';
  END IF;
  IF v_state = 'OPEN' AND NEW.adjusted_at IS NOT NULL THEN
    RAISE EXCEPTION 'QLT_CNT: 차이 조정은 실사를 닫은 뒤에 합니다.';
  END IF;
  IF OLD.adjusted_at IS NOT NULL AND (NEW.adjusted_at IS DISTINCT FROM OLD.adjusted_at OR NEW.adjust_move_id IS DISTINCT FROM OLD.adjust_move_id) THEN
    RAISE EXCEPTION 'QLT_CNT: 이미 조정한 줄입니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_lot_first_move()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.qlt_lot_moves (lot_id, kind, qty, move_id, note, created_by)
  VALUES (NEW.id, CASE WHEN NEW.in_kind = 'MOVE' THEN 'IN' ELSE 'OPEN' END, NEW.in_qty, NEW.in_move_id, '로트 등록', NEW.created_by);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_lot_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_type text; mv record; used integer; bal integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_LOT: 로트는 지우지 않습니다(끝내기만).'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT o.product_id, s.type INTO NEW.product_id, v_type
      FROM svc.hlt_product_options o JOIN svc.hlt_products p ON p.id = o.product_id LEFT JOIN svc.hlt_sellers s ON s.id = p.seller_id
     WHERE o.id = NEW.option_id;
    IF coalesce(v_type, '') <> 'DIRECT' THEN RAISE EXCEPTION 'QLT_LOT: 직판 상품 옵션만 로트를 둡니다.'; END IF;
    IF NEW.in_move_id IS NOT NULL THEN
      SELECT option_id, kind, qty INTO mv FROM public.acct_stock_moves WHERE id = NEW.in_move_id;
      IF mv.option_id IS DISTINCT FROM NEW.option_id OR NOT (mv.kind = 'IN' OR (mv.kind = 'ADJUST' AND mv.qty > 0)) THEN
        RAISE EXCEPTION 'QLT_LOT: 같은 옵션의 입고(또는 늘리는 실사) 줄만 로트로 나눕니다.';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('qlt_lot_in:' || NEW.in_move_id::text));
      SELECT coalesce(sum(in_qty), 0) INTO used FROM public.qlt_lots WHERE in_move_id = NEW.in_move_id;
      IF used + NEW.in_qty > mv.qty THEN RAISE EXCEPTION 'QLT_LOT: 로트 수량 합이 그 입고 줄 수량을 넘습니다.'; END IF;
    END IF;
    NEW.state := 'OK';
    RETURN NEW;
  END IF;
  IF (NEW.option_id, NEW.product_id, NEW.lot_no, NEW.made_on, NEW.expires_on, NEW.in_kind, NEW.in_qty, NEW.in_move_id, NEW.po_id, NEW.created_at)
     IS DISTINCT FROM (OLD.option_id, OLD.product_id, OLD.lot_no, OLD.made_on, OLD.expires_on, OLD.in_kind, OLD.in_qty, OLD.in_move_id, OLD.po_id, OLD.created_at) THEN
    RAISE EXCEPTION 'QLT_LOT: 로트 번호 · 날짜 · 들어온 수량은 고치지 않습니다(로트 조정 · 새 로트로).';
  END IF;
  IF NEW.state <> OLD.state THEN
    IF OLD.state = 'CLOSED' OR (OLD.state = 'RECALL' AND NEW.state <> 'CLOSED') THEN
      RAISE EXCEPTION 'QLT_LOT: 회수 로트는 끝내기만 · 끝낸 로트는 그대로입니다.';
    END IF;
    IF NEW.state = 'CLOSED' THEN
      SELECT qty_after INTO bal FROM public.qlt_lot_moves WHERE lot_id = NEW.id ORDER BY id DESC LIMIT 1;
      IF coalesce(bal, 0) <> 0 THEN RAISE EXCEPTION 'QLT_LOT: 남은 수량이 0 일 때만 끝냅니다.'; END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_lot_move()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text; pq integer;
BEGIN
  SELECT state INTO st FROM public.qlt_lots WHERE id = NEW.lot_id FOR UPDATE;
  IF st IS NULL THEN RAISE EXCEPTION 'QLT_LOT: 없는 로트입니다.'; END IF;
  IF st = 'CLOSED' AND NEW.qty < 0 THEN RAISE EXCEPTION 'QLT_LOT: 끝낸 로트에서는 내보내지 않습니다.'; END IF;
  SELECT qty_after INTO pq FROM public.qlt_lot_moves WHERE lot_id = NEW.lot_id ORDER BY id DESC LIMIT 1;
  NEW.qty_after := coalesce(pq, 0) + NEW.qty;
  IF NEW.qty_after < 0 THEN RAISE EXCEPTION 'QLT_LOT: 로트 남은 수량이 모자랍니다.'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_lot_pick_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.consumed_move_id IS NOT NULL THEN RAISE EXCEPTION 'QLT_PICK: 출고에 쓴 로트 지정은 바꾸지 않습니다.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (NEW.order_item_id, NEW.lot_id) IS DISTINCT FROM (OLD.order_item_id, OLD.lot_id) THEN RAISE EXCEPTION 'QLT_PICK: 주문 줄 · 로트는 바꾸지 않습니다(지우고 다시).'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_lot_product_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_LOT: 로트 관리 기록은 지우지 않습니다(끄기만).'; END IF;
  SELECT s.type INTO v_type FROM svc.hlt_products p LEFT JOIN svc.hlt_sellers s ON s.id = p.seller_id WHERE p.id = NEW.product_id;
  IF coalesce(v_type, '') <> 'DIRECT' THEN RAISE EXCEPTION 'QLT_LOT: 직판 상품만 로트 관리를 켭니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.active AND NOT OLD.active THEN NEW.on_at := now(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_po_due_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE st text; od date;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_PO_DUE: 납기일은 지우지 않습니다.'; END IF;
  SELECT state, ordered_on INTO st, od FROM public.acct_pos WHERE id = NEW.po_id;
  IF st IS DISTINCT FROM 'ORDERED' THEN
    RAISE EXCEPTION 'QLT_PO_DUE: 발주 상태인 것만 납기일을 넣고 고칩니다(입고 · 취소 뒤에는 그대로).';
  END IF;
  IF NEW.due_on < od THEN RAISE EXCEPTION 'QLT_PO_DUE: 납기일은 발주일 뒤여야 합니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.po_id <> OLD.po_id THEN RAISE EXCEPTION 'QLT_PO_DUE: 발주 번호는 바꾸지 않습니다.'; END IF;
  NEW.set_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_sup_eval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE k text;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'QLT_EVAL: 평가는 지우지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'FINAL' THEN RAISE EXCEPTION 'QLT_EVAL: 확정한 평가는 고치지 않습니다.'; END IF;
    IF (NEW.party_id, NEW.period) IS DISTINCT FROM (OLD.party_id, OLD.period) THEN RAISE EXCEPTION 'QLT_EVAL: 거래처 · 분기는 바꾸지 않습니다.'; END IF;
  END IF;
  SELECT kind INTO k FROM public.acct_parties WHERE id = NEW.party_id;
  IF k IS NULL OR k NOT IN ('SUPPLIER', 'BOTH') THEN RAISE EXCEPTION 'QLT_EVAL: 매입처(공급사) 거래처만 평가합니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_qlt_sup_return_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.kind = 'SUP_RETURN' AND NEW.zero_cost THEN
    RAISE EXCEPTION 'QLT_RETURN: 재고가 모자라 공급사 반품을 적을 수 없습니다.';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sal_opp_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_kind text; v_party bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SAL_OPP_STATE: 영업 기회는 지우지 않습니다(실패로 닫으십시오).'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.stage = 'WON' THEN RAISE EXCEPTION 'SAL_OPP_STATE: 성사한 영업 기회는 고치지 않습니다.'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.party_id IS DISTINCT FROM OLD.party_id THEN RAISE EXCEPTION 'SAL_OPP_STATE: 거래처는 바꾸지 않습니다(새 기회로).'; END IF;
  IF NEW.quote_doc_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.quote_doc_id IS DISTINCT FROM OLD.quote_doc_id) THEN
    SELECT kind, party_id INTO v_kind, v_party FROM public.acct_sales_docs WHERE id = NEW.quote_doc_id;
    IF v_kind IS DISTINCT FROM 'QUOTE' OR v_party IS DISTINCT FROM NEW.party_id THEN
      RAISE EXCEPTION 'SAL_OPP_QUOTE: 같은 거래처의 견적서만 연결합니다.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_staff_left_role()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_roles text[];
BEGIN
  IF NEW.left_on IS NULL OR NEW.account_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.left_on IS NOT NULL AND OLD.account_id IS NOT DISTINCT FROM NEW.account_id THEN RETURN NEW; END IF;
  BEGIN
    SELECT array_agg(r.role ORDER BY r.role) INTO v_roles FROM svc.account_roles r
     WHERE r.account_id = NEW.account_id AND r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT');
    IF v_roles IS NULL THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM svc.ops_alerts o WHERE o.alert_code = 'STAFF_LEFT_ROLE' AND o.resolved_at IS NULL AND o.detail->>'accountId' = NEW.account_id::text) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
    VALUES ('STAFF_LEFT_ROLE', 'WARN',
            left('퇴사(예정 포함) 직원 계정에 운영 역할 남음 — ' || NEW.name || ' · ' || array_to_string(v_roles, ', ') || ' · 직원 · 권한 › 운영자 목록에서 거두기', 280),
            jsonb_build_object('employeeId', NEW.id, 'accountId', NEW.account_id::text, 'roles', to_jsonb(v_roles), 'leftOn', NEW.left_on::text),
            clock_timestamp())
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE WARNING USING MESSAGE = 'staff left alert skipped ' || SQLERRM;
  END;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.pgx_groups_task(p_account uuid, p_tasks text[], p_levels text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF p_account IS NULL OR p_tasks IS NULL OR p_levels IS NULL THEN RETURN false; END IF;
  IF coalesce((SELECT s.value FROM svc.site_settings s WHERE s.key = 'perm.mode'), 'ROLE') <> 'GROUPS' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM svc.account_roles r
                  WHERE r.account_id = p_account AND r.role IN ('ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')
                    AND (r.expires_at IS NULL OR r.expires_at > now())) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.fn_perm_effective(p_account) e WHERE e.task_key = ANY (p_tasks) AND e.level = ANY (p_levels));
END $function$;

-- ===== 표 =====
CREATE TABLE public.acct_accountant_access (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    ip text,
    at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT acct_accountant_access_method_check CHECK ((method = ANY (ARRAY['GET'::text, 'POST'::text, 'PATCH'::text, 'PUT'::text, 'DELETE'::text]))),
    CONSTRAINT acct_accountant_access_path_check CHECK (((char_length(path) >= 1) AND (char_length(path) <= 300)))
);
ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN id SET (pg_attver=166055528);
ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN account_id SET (pg_attver=166055528);
ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN method SET (pg_attver=166055528);
ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN path SET (pg_attver=166055528);
ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN ip SET (pg_attver=166055528);
ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN at SET (pg_attver=166055528);



CREATE SEQUENCE public.acct_accountant_access_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_accountant_access_id_seq OWNED BY public.acct_accountant_access.id;



CREATE TABLE public.acct_accountant_notes (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    ym text NOT NULL,
    entry_id bigint,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_accountant_notes_body_check CHECK (((char_length(btrim(body)) >= 2) AND (char_length(btrim(body)) <= 1000))),
    CONSTRAINT acct_accountant_notes_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN id SET (pg_attver=166086080);
ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN account_id SET (pg_attver=166086080);
ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN ym SET (pg_attver=166086080);
ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN entry_id SET (pg_attver=166086080);
ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN body SET (pg_attver=166086080);
ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN created_at SET (pg_attver=166086080);



CREATE SEQUENCE public.acct_accountant_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_accountant_notes_id_seq OWNED BY public.acct_accountant_notes.id;



CREATE TABLE public.acct_accountant_replies (
    id bigint NOT NULL,
    note_id bigint NOT NULL,
    account_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_accountant_replies_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 1000)))
);
ALTER TABLE ONLY public.acct_accountant_replies ALTER COLUMN id SET (pg_attver=166120520);
ALTER TABLE ONLY public.acct_accountant_replies ALTER COLUMN note_id SET (pg_attver=166120520);
ALTER TABLE ONLY public.acct_accountant_replies ALTER COLUMN account_id SET (pg_attver=166120520);
ALTER TABLE ONLY public.acct_accountant_replies ALTER COLUMN body SET (pg_attver=166120520);
ALTER TABLE ONLY public.acct_accountant_replies ALTER COLUMN created_at SET (pg_attver=166120520);



CREATE SEQUENCE public.acct_accountant_replies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_accountant_replies_id_seq OWNED BY public.acct_accountant_replies.id;



CREATE TABLE public.acct_accounts (
    role text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    ext_code text,
    ext_name text,
    sort integer DEFAULT 0 NOT NULL,
    note text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom boolean DEFAULT false NOT NULL,
    draft boolean DEFAULT true NOT NULL,
    CONSTRAINT acct_accounts_ext_code_check CHECK (((ext_code IS NULL) OR (ext_code ~ '^[0-9A-Za-z._-]{1,20}$'::text))),
    CONSTRAINT acct_accounts_ext_name_check CHECK (((ext_name IS NULL) OR (char_length(ext_name) <= 60))),
    CONSTRAINT acct_accounts_kind_check CHECK ((kind = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'EQUITY'::text, 'REVENUE'::text, 'EXPENSE'::text]))),
    CONSTRAINT acct_accounts_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 60))),
    CONSTRAINT acct_accounts_role_check CHECK ((role ~ '^[A-Z][A-Z_]{1,39}$'::text))
);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN role SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN name SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN kind SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN ext_code SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN ext_name SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN sort SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN note SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN updated_by SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN updated_at SET (pg_attver=162077992);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN custom SET (pg_attver=162597448);
ALTER TABLE ONLY public.acct_accounts ALTER COLUMN draft SET (pg_attver=162598776);



CREATE TABLE public.acct_approval_line_changes (
    id bigint NOT NULL,
    doc_kind text NOT NULL,
    before jsonb,
    after jsonb,
    reason text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_approval_line_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN id SET (pg_attver=164799048);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN doc_kind SET (pg_attver=164799048);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN before SET (pg_attver=164799048);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN after SET (pg_attver=164799048);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN reason SET (pg_attver=164799048);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN actor_id SET (pg_attver=164799048);
ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN created_at SET (pg_attver=164799048);



CREATE SEQUENCE public.acct_approval_line_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_approval_line_changes_id_seq OWNED BY public.acct_approval_line_changes.id;



CREATE TABLE public.acct_approval_lines (
    id bigint NOT NULL,
    doc_kind text NOT NULL,
    upto bigint,
    steps jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_approval_lines_doc_kind_check CHECK ((doc_kind = ANY (ARRAY['REQ'::text, 'EXPENSE'::text, 'MANUAL'::text]))),
    CONSTRAINT acct_approval_lines_steps_check CHECK (((jsonb_typeof(steps) = 'array'::text) AND ((jsonb_array_length(steps) >= 1) AND (jsonb_array_length(steps) <= 5)))),
    CONSTRAINT acct_approval_lines_upto_check CHECK (((upto IS NULL) OR ((upto > 0) AND (upto <= '100000000000'::bigint))))
);
ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN id SET (pg_attver=164758616);
ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN doc_kind SET (pg_attver=164758616);
ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN upto SET (pg_attver=164758616);
ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN steps SET (pg_attver=164758616);
ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN updated_by SET (pg_attver=164758616);
ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN updated_at SET (pg_attver=164758616);



CREATE SEQUENCE public.acct_approval_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_approval_lines_id_seq OWNED BY public.acct_approval_lines.id;



CREATE TABLE public.acct_approval_steps (
    id bigint NOT NULL,
    doc_kind text NOT NULL,
    doc_id bigint NOT NULL,
    round integer NOT NULL,
    step_no integer NOT NULL,
    approver uuid NOT NULL,
    decision text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_approval_steps_decision_check CHECK ((decision = ANY (ARRAY['APPROVE'::text, 'REJECT'::text]))),
    CONSTRAINT acct_approval_steps_doc_kind_check CHECK ((doc_kind = ANY (ARRAY['REQ'::text, 'EXPENSE'::text, 'MANUAL'::text]))),
    CONSTRAINT acct_approval_steps_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_approval_steps_round_check CHECK ((round >= 1)),
    CONSTRAINT acct_approval_steps_step_no_check CHECK (((step_no >= 1) AND (step_no <= 5)))
);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN id SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN doc_kind SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN doc_id SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN round SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN step_no SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN approver SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN decision SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN note SET (pg_attver=164829304);
ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN created_at SET (pg_attver=164829304);



CREATE SEQUENCE public.acct_approval_steps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_approval_steps_id_seq OWNED BY public.acct_approval_steps.id;



CREATE TABLE public.acct_archives (
    id bigint NOT NULL,
    year integer NOT NULL,
    entries integer NOT NULL,
    lines integer NOT NULL,
    debit_sum bigint NOT NULL,
    files integer NOT NULL,
    csv_sha256 text NOT NULL,
    manifest jsonb NOT NULL,
    manifest_sha256 text NOT NULL,
    keep_until date NOT NULL,
    note text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT acct_archives_csv_sha256_check CHECK ((csv_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT acct_archives_manifest_sha256_check CHECK ((manifest_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT acct_archives_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_archives_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN id SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN year SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN entries SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN lines SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN debit_sum SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN files SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN csv_sha256 SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN manifest SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN manifest_sha256 SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN keep_until SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN note SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN actor_id SET (pg_attver=166292568);
ALTER TABLE ONLY public.acct_archives ALTER COLUMN created_at SET (pg_attver=166292568);



CREATE SEQUENCE public.acct_archives_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_archives_id_seq OWNED BY public.acct_archives.id;



CREATE TABLE public.acct_assets (
    id bigint NOT NULL,
    name text NOT NULL,
    category text,
    acquired_on date NOT NULL,
    cost bigint NOT NULL,
    residual bigint DEFAULT 0 NOT NULL,
    life_months integer NOT NULL,
    method text DEFAULT 'STRAIGHT'::text NOT NULL,
    account_role text DEFAULT 'FIXED_ASSET'::text NOT NULL,
    pay_role text DEFAULT 'NONE'::text NOT NULL,
    purchase_id bigint,
    from_role text,
    prior_depr bigint DEFAULT 0 NOT NULL,
    prior_months integer DEFAULT 0 NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    disposed_on date,
    dispose_amount bigint,
    dispose_role text,
    dispose_reason text,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_assets_category_check CHECK (((category IS NULL) OR (char_length(category) <= 40))),
    CONSTRAINT acct_assets_cost_check CHECK ((cost > 0)),
    CONSTRAINT acct_assets_dispose_amount_check CHECK (((dispose_amount IS NULL) OR (dispose_amount >= 0))),
    CONSTRAINT acct_assets_dispose_role_check CHECK (((dispose_role IS NULL) OR (dispose_role = ANY (ARRAY['CASH'::text, 'AR'::text])))),
    CONSTRAINT acct_assets_life_months_check CHECK (((life_months >= 1) AND (life_months <= 600))),
    CONSTRAINT acct_assets_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_assets_method_check CHECK ((method = ANY (ARRAY['STRAIGHT'::text, 'DECLINING'::text]))),
    CONSTRAINT acct_assets_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT acct_assets_pay_role_check CHECK ((pay_role = ANY (ARRAY['CASH'::text, 'AP'::text, 'NONE'::text, 'PURCHASE'::text]))),
    CONSTRAINT acct_assets_prior_depr_check CHECK ((prior_depr >= 0)),
    CONSTRAINT acct_assets_prior_months_check CHECK ((prior_months >= 0)),
    CONSTRAINT acct_assets_residual_check CHECK ((residual >= 0)),
    CONSTRAINT acct_assets_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'DISPOSED'::text]))),
    CONSTRAINT ck_aa_dispose CHECK ((((state = 'ACTIVE'::text) AND (disposed_on IS NULL) AND (dispose_amount IS NULL)) OR ((state = 'DISPOSED'::text) AND (disposed_on IS NOT NULL) AND (dispose_amount IS NOT NULL) AND (dispose_role IS NOT NULL) AND ((char_length(btrim(COALESCE(dispose_reason, ''::text))) >= 2) AND (char_length(btrim(COALESCE(dispose_reason, ''::text))) <= 200))))),
    CONSTRAINT ck_aa_prior CHECK (((prior_depr <= (cost - residual)) AND (prior_months <= life_months))),
    CONSTRAINT ck_aa_purchase CHECK (((pay_role = 'PURCHASE'::text) = (purchase_id IS NOT NULL))),
    CONSTRAINT ck_aa_residual CHECK ((residual < cost))
);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN id SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN name SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN category SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN acquired_on SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN cost SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN residual SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN life_months SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN method SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN account_role SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN pay_role SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN purchase_id SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN from_role SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN prior_depr SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN prior_months SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN state SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN disposed_on SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN dispose_amount SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN dispose_role SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN dispose_reason SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN memo SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN created_by SET (pg_attver=163276832);
ALTER TABLE ONLY public.acct_assets ALTER COLUMN created_at SET (pg_attver=163276832);



CREATE SEQUENCE public.acct_assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_assets_id_seq OWNED BY public.acct_assets.id;



CREATE TABLE public.acct_attendance (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    work_on date NOT NULL,
    in_at timestamp with time zone NOT NULL,
    out_at timestamp with time zone,
    memo text,
    fixed boolean DEFAULT false NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_attendance_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT ck_acct_attendance_out CHECK (((out_at IS NULL) OR (out_at > in_at))),
    CONSTRAINT ck_acct_attendance_span CHECK (((out_at IS NULL) OR ((out_at - in_at) <= '24:00:00'::interval)))
);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN id SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN employee_id SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN work_on SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN in_at SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN out_at SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN memo SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN fixed SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN confirmed_by SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN confirmed_at SET (pg_attver=167216752);
ALTER TABLE ONLY public.acct_attendance ALTER COLUMN created_at SET (pg_attver=167216752);



CREATE TABLE public.acct_attendance_fixes (
    id bigint NOT NULL,
    attendance_id bigint NOT NULL,
    before_in timestamp with time zone,
    before_out timestamp with time zone,
    after_in timestamp with time zone NOT NULL,
    after_out timestamp with time zone,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_attendance_fixes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN id SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN attendance_id SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN before_in SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN before_out SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN after_in SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN after_out SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN reason SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN created_by SET (pg_attver=167261760);
ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN created_at SET (pg_attver=167261760);



CREATE SEQUENCE public.acct_attendance_fixes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_attendance_fixes_id_seq OWNED BY public.acct_attendance_fixes.id;



CREATE SEQUENCE public.acct_attendance_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_attendance_id_seq OWNED BY public.acct_attendance.id;



CREATE TABLE public.acct_bank_feed_accounts (
    id bigint NOT NULL,
    label text NOT NULL,
    bank_std text NOT NULL,
    fintech_enc bytea NOT NULL,
    fintech_hash text NOT NULL,
    acct_last4 text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    last_result text,
    last_error text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_bank_feed_accounts_acct_last4_check CHECK ((acct_last4 ~ '^[0-9]{4}$'::text)),
    CONSTRAINT acct_bank_feed_accounts_bank_std_check CHECK ((bank_std ~ '^[0-9]{3}$'::text)),
    CONSTRAINT acct_bank_feed_accounts_fintech_hash_check CHECK ((fintech_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT acct_bank_feed_accounts_label_check CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 40))),
    CONSTRAINT acct_bank_feed_accounts_last_error_check CHECK (((last_error IS NULL) OR (char_length(last_error) <= 300))),
    CONSTRAINT acct_bank_feed_accounts_last_result_check CHECK (((last_result IS NULL) OR (last_result = ANY (ARRAY['OK'::text, 'FAIL'::text]))))
);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN id SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN label SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN bank_std SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN fintech_enc SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN fintech_hash SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN acct_last4 SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN active SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN last_run_at SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN last_result SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN last_error SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN created_by SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN created_at SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN updated_by SET (pg_attver=169100416);
ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN updated_at SET (pg_attver=169100416);



CREATE SEQUENCE public.acct_bank_feed_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_bank_feed_accounts_id_seq OWNED BY public.acct_bank_feed_accounts.id;



CREATE TABLE public.acct_bank_feed_runs (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    mode text NOT NULL,
    result text NOT NULL,
    rows_total integer DEFAULT 0 NOT NULL,
    rows_added integer DEFAULT 0 NOT NULL,
    rows_dup integer DEFAULT 0 NOT NULL,
    upload_id bigint,
    error text,
    run_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_bank_feed_runs_error_check CHECK (((error IS NULL) OR (char_length(error) <= 300))),
    CONSTRAINT acct_bank_feed_runs_mode_check CHECK ((mode = ANY (ARRAY['ASSUME'::text, 'LIVE'::text]))),
    CONSTRAINT acct_bank_feed_runs_result_check CHECK ((result = ANY (ARRAY['OK'::text, 'FAIL'::text]))),
    CONSTRAINT acct_bank_feed_runs_rows_added_check CHECK ((rows_added >= 0)),
    CONSTRAINT acct_bank_feed_runs_rows_dup_check CHECK ((rows_dup >= 0)),
    CONSTRAINT acct_bank_feed_runs_rows_total_check CHECK ((rows_total >= 0)),
    CONSTRAINT ck_abfr_range CHECK (((to_date >= from_date) AND ((to_date - from_date) <= 31)))
);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN id SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN account_id SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN from_date SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN to_date SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN mode SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN result SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN rows_total SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN rows_added SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN rows_dup SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN upload_id SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN error SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN run_by SET (pg_attver=169147296);
ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN created_at SET (pg_attver=169147296);



CREATE SEQUENCE public.acct_bank_feed_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_bank_feed_runs_id_seq OWNED BY public.acct_bank_feed_runs.id;



CREATE TABLE public.acct_bank_txns (
    id bigint NOT NULL,
    upload_id bigint NOT NULL,
    tx_date date NOT NULL,
    deposit bigint DEFAULT 0 NOT NULL,
    withdraw bigint DEFAULT 0 NOT NULL,
    balance bigint,
    counterparty text,
    memo text,
    row_hash text NOT NULL,
    match_kind text,
    entry_id bigint,
    match_note text,
    matched_by uuid,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_bank_txns_counterparty_check CHECK (((counterparty IS NULL) OR (char_length(counterparty) <= 120))),
    CONSTRAINT acct_bank_txns_deposit_check CHECK ((deposit >= 0)),
    CONSTRAINT acct_bank_txns_match_kind_check CHECK (((match_kind IS NULL) OR (match_kind = ANY (ARRAY['ENTRY'::text, 'IGNORE'::text])))),
    CONSTRAINT acct_bank_txns_match_note_check CHECK (((match_note IS NULL) OR (char_length(match_note) <= 200))),
    CONSTRAINT acct_bank_txns_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_bank_txns_row_hash_check CHECK ((row_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT acct_bank_txns_withdraw_check CHECK ((withdraw >= 0)),
    CONSTRAINT ck_abt_match CHECK ((((match_kind IS NULL) AND (entry_id IS NULL) AND (matched_at IS NULL)) OR ((match_kind = 'ENTRY'::text) AND (entry_id IS NOT NULL) AND (matched_at IS NOT NULL)) OR ((match_kind = 'IGNORE'::text) AND (entry_id IS NULL) AND (matched_at IS NOT NULL) AND (char_length(btrim(COALESCE(match_note, ''::text))) >= 2)))),
    CONSTRAINT ck_abt_one CHECK (((deposit > 0) <> (withdraw > 0)))
);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN id SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN upload_id SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN tx_date SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN deposit SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN withdraw SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN balance SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN counterparty SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN memo SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN row_hash SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN match_kind SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN entry_id SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN match_note SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN matched_by SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN matched_at SET (pg_attver=162389632);
ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN created_at SET (pg_attver=162389632);



CREATE SEQUENCE public.acct_bank_txns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_bank_txns_id_seq OWNED BY public.acct_bank_txns.id;



CREATE TABLE public.acct_bank_uploads (
    id bigint NOT NULL,
    filename text,
    bank text,
    rows_total integer NOT NULL,
    rows_added integer NOT NULL,
    rows_dup integer NOT NULL,
    rows_bad integer DEFAULT 0 NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_bank_uploads_bank_check CHECK (((bank IS NULL) OR (char_length(bank) <= 40))),
    CONSTRAINT acct_bank_uploads_filename_check CHECK (((filename IS NULL) OR (char_length(filename) <= 200))),
    CONSTRAINT acct_bank_uploads_rows_added_check CHECK ((rows_added >= 0)),
    CONSTRAINT acct_bank_uploads_rows_bad_check CHECK ((rows_bad >= 0)),
    CONSTRAINT acct_bank_uploads_rows_dup_check CHECK ((rows_dup >= 0)),
    CONSTRAINT acct_bank_uploads_rows_total_check CHECK ((rows_total >= 0))
);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN id SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN filename SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN bank SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN rows_total SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN rows_added SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN rows_dup SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN rows_bad SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN uploaded_by SET (pg_attver=162349408);
ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN created_at SET (pg_attver=162349408);



CREATE SEQUENCE public.acct_bank_uploads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_bank_uploads_id_seq OWNED BY public.acct_bank_uploads.id;



CREATE TABLE public.acct_barcodes (
    option_id uuid NOT NULL,
    code text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_barcodes_code_check CHECK ((code ~ '^[0-9A-Z-]{4,32}$'::text))
);
ALTER TABLE ONLY public.acct_barcodes ALTER COLUMN option_id SET (pg_attver=165829216);
ALTER TABLE ONLY public.acct_barcodes ALTER COLUMN code SET (pg_attver=165829216);
ALTER TABLE ONLY public.acct_barcodes ALTER COLUMN created_by SET (pg_attver=165829216);
ALTER TABLE ONLY public.acct_barcodes ALTER COLUMN created_at SET (pg_attver=165829216);



CREATE TABLE public.acct_budget_changes (
    id bigint NOT NULL,
    ym text NOT NULL,
    role text NOT NULL,
    before bigint,
    after bigint,
    reason text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_budget_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN id SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN ym SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN role SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN before SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN after SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN reason SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN actor_id SET (pg_attver=163436104);
ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN created_at SET (pg_attver=163436104);



CREATE SEQUENCE public.acct_budget_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_budget_changes_id_seq OWNED BY public.acct_budget_changes.id;



CREATE TABLE public.acct_budgets (
    ym text NOT NULL,
    role text NOT NULL,
    amount bigint NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_budgets_amount_check CHECK ((amount > 0)),
    CONSTRAINT acct_budgets_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.acct_budgets ALTER COLUMN ym SET (pg_attver=163400808);
ALTER TABLE ONLY public.acct_budgets ALTER COLUMN role SET (pg_attver=163400808);
ALTER TABLE ONLY public.acct_budgets ALTER COLUMN amount SET (pg_attver=163400808);
ALTER TABLE ONLY public.acct_budgets ALTER COLUMN updated_by SET (pg_attver=163400808);
ALTER TABLE ONLY public.acct_budgets ALTER COLUMN updated_at SET (pg_attver=163400808);



CREATE TABLE public.acct_card_limit_changes (
    id bigint NOT NULL,
    card_tail text NOT NULL,
    before jsonb,
    after jsonb NOT NULL,
    reason text NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_card_limit_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN id SET (pg_attver=167628328);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN card_tail SET (pg_attver=167628328);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN before SET (pg_attver=167628328);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN after SET (pg_attver=167628328);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN reason SET (pg_attver=167628328);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN changed_by SET (pg_attver=167628328);
ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN changed_at SET (pg_attver=167628328);



CREATE SEQUENCE public.acct_card_limit_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_card_limit_changes_id_seq OWNED BY public.acct_card_limit_changes.id;



CREATE TABLE public.acct_card_limits (
    card_tail text NOT NULL,
    name text NOT NULL,
    holder_id uuid,
    monthly_limit bigint NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_card_limits_card_tail_check CHECK ((card_tail ~ '^[0-9*]{1,4}$'::text)),
    CONSTRAINT acct_card_limits_monthly_limit_check CHECK (((monthly_limit >= 1) AND (monthly_limit <= '1000000000000'::bigint))),
    CONSTRAINT acct_card_limits_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40)))
);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN card_tail SET (pg_attver=167594608);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN name SET (pg_attver=167594608);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN holder_id SET (pg_attver=167594608);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN monthly_limit SET (pg_attver=167594608);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN active SET (pg_attver=167594608);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN updated_by SET (pg_attver=167594608);
ALTER TABLE ONLY public.acct_card_limits ALTER COLUMN updated_at SET (pg_attver=167594608);



CREATE TABLE public.acct_card_txns (
    id bigint NOT NULL,
    upload_id bigint NOT NULL,
    used_on date NOT NULL,
    merchant text,
    amount bigint NOT NULL,
    approval_no text,
    card_tail text,
    row_hash text NOT NULL,
    state text DEFAULT 'OPEN'::text NOT NULL,
    account_role text,
    deductible boolean DEFAULT false NOT NULL,
    vat bigint DEFAULT 0 NOT NULL,
    note text,
    booked_by uuid,
    booked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_card_txns_amount_check CHECK ((amount <> 0)),
    CONSTRAINT acct_card_txns_approval_no_check CHECK (((approval_no IS NULL) OR (char_length(approval_no) <= 40))),
    CONSTRAINT acct_card_txns_card_tail_check CHECK (((card_tail IS NULL) OR (card_tail ~ '^[0-9*]{1,4}$'::text))),
    CONSTRAINT acct_card_txns_merchant_check CHECK (((merchant IS NULL) OR (char_length(merchant) <= 120))),
    CONSTRAINT acct_card_txns_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_card_txns_row_hash_check CHECK ((row_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT acct_card_txns_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'BOOKED'::text, 'IGNORED'::text]))),
    CONSTRAINT acct_card_txns_vat_check CHECK ((vat >= 0)),
    CONSTRAINT ck_act_state CHECK ((((state = 'OPEN'::text) AND (booked_at IS NULL)) OR ((state = 'BOOKED'::text) AND (account_role IS NOT NULL) AND (booked_by IS NOT NULL) AND (booked_at IS NOT NULL)) OR ((state = 'IGNORED'::text) AND (booked_at IS NOT NULL) AND (char_length(btrim(COALESCE(note, ''::text))) >= 2)))),
    CONSTRAINT ck_act_vat CHECK ((((vat * 11) <= (abs(amount) + 10)) AND (deductible OR (vat = 0))))
);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN id SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN upload_id SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN used_on SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN merchant SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN amount SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN approval_no SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN card_tail SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN row_hash SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN state SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN account_role SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN deductible SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN vat SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN note SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN booked_by SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN booked_at SET (pg_attver=162918072);
ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN created_at SET (pg_attver=162918072);



CREATE SEQUENCE public.acct_card_txns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_card_txns_id_seq OWNED BY public.acct_card_txns.id;



CREATE TABLE public.acct_card_uploads (
    id bigint NOT NULL,
    filename text,
    card text,
    rows_total integer NOT NULL,
    rows_added integer NOT NULL,
    rows_dup integer NOT NULL,
    rows_bad integer DEFAULT 0 NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_card_uploads_card_check CHECK (((card IS NULL) OR (char_length(card) <= 40))),
    CONSTRAINT acct_card_uploads_filename_check CHECK (((filename IS NULL) OR (char_length(filename) <= 200))),
    CONSTRAINT acct_card_uploads_rows_added_check CHECK ((rows_added >= 0)),
    CONSTRAINT acct_card_uploads_rows_bad_check CHECK ((rows_bad >= 0)),
    CONSTRAINT acct_card_uploads_rows_dup_check CHECK ((rows_dup >= 0)),
    CONSTRAINT acct_card_uploads_rows_total_check CHECK ((rows_total >= 0))
);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN id SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN filename SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN card SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN rows_total SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN rows_added SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN rows_dup SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN rows_bad SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN uploaded_by SET (pg_attver=162878616);
ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN created_at SET (pg_attver=162878616);



CREATE SEQUENCE public.acct_card_uploads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_card_uploads_id_seq OWNED BY public.acct_card_uploads.id;



CREATE TABLE public.acct_cash_balances (
    id bigint NOT NULL,
    as_of date NOT NULL,
    amount bigint NOT NULL,
    source text DEFAULT 'MANUAL'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_cash_balances_amount_check CHECK ((abs(amount) <= '1000000000000'::bigint)),
    CONSTRAINT acct_cash_balances_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_cash_balances_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'BANK'::text])))
);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN id SET (pg_attver=162984472);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN as_of SET (pg_attver=162984472);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN amount SET (pg_attver=162984472);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN source SET (pg_attver=162984472);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN note SET (pg_attver=162984472);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN created_by SET (pg_attver=162984472);
ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN created_at SET (pg_attver=162984472);



CREATE SEQUENCE public.acct_cash_balances_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_cash_balances_id_seq OWNED BY public.acct_cash_balances.id;



CREATE TABLE public.acct_cash_plans (
    id bigint NOT NULL,
    due_on date NOT NULL,
    direction text NOT NULL,
    amount bigint NOT NULL,
    memo text NOT NULL,
    repeat text DEFAULT 'NONE'::text NOT NULL,
    until_on date,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    cancel_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    canceled_by uuid,
    canceled_at timestamp with time zone,
    CONSTRAINT acct_cash_plans_amount_check CHECK (((amount > 0) AND (amount <= '1000000000000'::bigint))),
    CONSTRAINT acct_cash_plans_direction_check CHECK ((direction = ANY (ARRAY['IN'::text, 'OUT'::text]))),
    CONSTRAINT acct_cash_plans_memo_check CHECK (((char_length(btrim(memo)) >= 2) AND (char_length(btrim(memo)) <= 100))),
    CONSTRAINT acct_cash_plans_repeat_check CHECK ((repeat = ANY (ARRAY['NONE'::text, 'MONTHLY'::text]))),
    CONSTRAINT acct_cash_plans_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CANCELED'::text]))),
    CONSTRAINT ck_acp_cancel CHECK ((((state = 'ACTIVE'::text) AND (canceled_at IS NULL)) OR ((state = 'CANCELED'::text) AND (canceled_at IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2)))),
    CONSTRAINT ck_acp_until CHECK (((until_on IS NULL) OR ((repeat = 'MONTHLY'::text) AND (until_on >= due_on))))
);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN id SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN due_on SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN direction SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN amount SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN memo SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN repeat SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN until_on SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN state SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN cancel_note SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN created_by SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN created_at SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN canceled_by SET (pg_attver=163017752);
ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN canceled_at SET (pg_attver=163017752);



CREATE SEQUENCE public.acct_cash_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_cash_plans_id_seq OWNED BY public.acct_cash_plans.id;



CREATE TABLE public.acct_closings (
    ym text NOT NULL,
    entries integer NOT NULL,
    debit_sum bigint NOT NULL,
    note text,
    closed_by uuid,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_closings_debit_sum_check CHECK ((debit_sum >= 0)),
    CONSTRAINT acct_closings_entries_check CHECK ((entries >= 0)),
    CONSTRAINT acct_closings_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_closings_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.acct_closings ALTER COLUMN ym SET (pg_attver=162209184);
ALTER TABLE ONLY public.acct_closings ALTER COLUMN entries SET (pg_attver=162209184);
ALTER TABLE ONLY public.acct_closings ALTER COLUMN debit_sum SET (pg_attver=162209184);
ALTER TABLE ONLY public.acct_closings ALTER COLUMN note SET (pg_attver=162209184);
ALTER TABLE ONLY public.acct_closings ALTER COLUMN closed_by SET (pg_attver=162209184);
ALTER TABLE ONLY public.acct_closings ALTER COLUMN closed_at SET (pg_attver=162209184);



CREATE TABLE public.acct_contract_accrual_rules (
    contract_id bigint NOT NULL,
    account_role text NOT NULL,
    vat_included boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.acct_contract_accrual_rules ALTER COLUMN contract_id SET (pg_attver=166200720);
ALTER TABLE ONLY public.acct_contract_accrual_rules ALTER COLUMN account_role SET (pg_attver=166200720);
ALTER TABLE ONLY public.acct_contract_accrual_rules ALTER COLUMN vat_included SET (pg_attver=166200720);
ALTER TABLE ONLY public.acct_contract_accrual_rules ALTER COLUMN enabled SET (pg_attver=166200720);
ALTER TABLE ONLY public.acct_contract_accrual_rules ALTER COLUMN updated_by SET (pg_attver=166200720);
ALTER TABLE ONLY public.acct_contract_accrual_rules ALTER COLUMN updated_at SET (pg_attver=166200720);



CREATE TABLE public.acct_contract_accruals (
    id bigint NOT NULL,
    contract_id bigint NOT NULL,
    ym text NOT NULL,
    account_role text NOT NULL,
    amount bigint NOT NULL,
    state text DEFAULT 'ACCRUED'::text NOT NULL,
    purchase_id bigint,
    matched_by text,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_contract_accruals_amount_check CHECK ((amount > 0)),
    CONSTRAINT acct_contract_accruals_matched_by_check CHECK (((matched_by IS NULL) OR (matched_by = ANY (ARRAY['AUTO'::text, 'MANUAL'::text])))),
    CONSTRAINT acct_contract_accruals_state_check CHECK ((state = ANY (ARRAY['ACCRUED'::text, 'MATCHED'::text]))),
    CONSTRAINT acct_contract_accruals_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT ck_aca_match CHECK ((((state = 'ACCRUED'::text) AND (purchase_id IS NULL) AND (matched_at IS NULL)) OR ((state = 'MATCHED'::text) AND (purchase_id IS NOT NULL) AND (matched_at IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN id SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN contract_id SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN ym SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN account_role SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN amount SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN state SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN purchase_id SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN matched_by SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN matched_at SET (pg_attver=166234672);
ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN created_at SET (pg_attver=166234672);



CREATE SEQUENCE public.acct_contract_accruals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_contract_accruals_id_seq OWNED BY public.acct_contract_accruals.id;



CREATE TABLE public.acct_contract_changes (
    id bigint NOT NULL,
    contract_id bigint NOT NULL,
    action text NOT NULL,
    before_end date,
    after_end date,
    reason text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_contract_changes_action_check CHECK ((action = ANY (ARRAY['CREATE'::text, 'RENEW'::text, 'END'::text])))
);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN id SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN contract_id SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN action SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN before_end SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN after_end SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN reason SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN actor_id SET (pg_attver=164225440);
ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN created_at SET (pg_attver=164225440);



CREATE SEQUENCE public.acct_contract_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_contract_changes_id_seq OWNED BY public.acct_contract_changes.id;



CREATE TABLE public.acct_contracts (
    id bigint NOT NULL,
    party_id bigint,
    title text NOT NULL,
    kind text NOT NULL,
    start_on date NOT NULL,
    end_on date,
    auto_renew boolean DEFAULT false NOT NULL,
    notice_days integer DEFAULT 30 NOT NULL,
    monthly_amount bigint DEFAULT 0 NOT NULL,
    pay_day integer,
    cash_plan_id bigint,
    attachments uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    end_note text,
    ended_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_contracts_attachments_check CHECK ((cardinality(attachments) <= 5)),
    CONSTRAINT acct_contracts_kind_check CHECK ((kind = ANY (ARRAY['RENT'::text, 'SERVICE'::text, 'SERVER'::text, 'SUBSCRIPTION'::text, 'OTHER'::text]))),
    CONSTRAINT acct_contracts_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_contracts_monthly_amount_check CHECK (((monthly_amount >= 0) AND (monthly_amount <= '10000000000'::bigint))),
    CONSTRAINT acct_contracts_notice_days_check CHECK (((notice_days >= 1) AND (notice_days <= 180))),
    CONSTRAINT acct_contracts_pay_day_check CHECK (((pay_day IS NULL) OR ((pay_day >= 1) AND (pay_day <= 28)))),
    CONSTRAINT acct_contracts_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'ENDED'::text]))),
    CONSTRAINT acct_contracts_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100))),
    CONSTRAINT ck_acn_end CHECK ((((state = 'ACTIVE'::text) AND (ended_at IS NULL)) OR ((state = 'ENDED'::text) AND (ended_at IS NOT NULL) AND (char_length(btrim(COALESCE(end_note, ''::text))) >= 2)))),
    CONSTRAINT ck_acn_pay CHECK (((monthly_amount = 0) OR (pay_day IS NOT NULL))),
    CONSTRAINT ck_acn_period CHECK (((end_on IS NULL) OR (end_on >= start_on)))
);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN id SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN party_id SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN title SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN kind SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN start_on SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN end_on SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN auto_renew SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN notice_days SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN monthly_amount SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN pay_day SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN cash_plan_id SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN attachments SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN memo SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN state SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN end_note SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN ended_at SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN created_by SET (pg_attver=164158176);
ALTER TABLE ONLY public.acct_contracts ALTER COLUMN created_at SET (pg_attver=164158176);



CREATE SEQUENCE public.acct_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_contracts_id_seq OWNED BY public.acct_contracts.id;



CREATE TABLE public.acct_depreciations (
    id bigint NOT NULL,
    asset_id bigint NOT NULL,
    ym text NOT NULL,
    amount bigint NOT NULL,
    book_after bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_depreciations_amount_check CHECK ((amount > 0)),
    CONSTRAINT acct_depreciations_book_after_check CHECK ((book_after >= 0)),
    CONSTRAINT acct_depreciations_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN id SET (pg_attver=163363904);
ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN asset_id SET (pg_attver=163363904);
ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN ym SET (pg_attver=163363904);
ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN amount SET (pg_attver=163363904);
ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN book_after SET (pg_attver=163363904);
ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN created_at SET (pg_attver=163363904);



CREATE SEQUENCE public.acct_depreciations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_depreciations_id_seq OWNED BY public.acct_depreciations.id;



CREATE TABLE public.acct_depts (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_depts_code_check CHECK ((code ~ '^[A-Z0-9_]{2,20}$'::text)),
    CONSTRAINT acct_depts_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 60)))
);
ALTER TABLE ONLY public.acct_depts ALTER COLUMN id SET (pg_attver=165534968);
ALTER TABLE ONLY public.acct_depts ALTER COLUMN code SET (pg_attver=165534968);
ALTER TABLE ONLY public.acct_depts ALTER COLUMN name SET (pg_attver=165534968);
ALTER TABLE ONLY public.acct_depts ALTER COLUMN active SET (pg_attver=165534968);
ALTER TABLE ONLY public.acct_depts ALTER COLUMN sort SET (pg_attver=165534968);
ALTER TABLE ONLY public.acct_depts ALTER COLUMN created_at SET (pg_attver=165534968);



CREATE SEQUENCE public.acct_depts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_depts_id_seq OWNED BY public.acct_depts.id;



CREATE TABLE public.acct_doc_counters (
    kind text NOT NULL,
    ym text NOT NULL,
    last integer DEFAULT 0 NOT NULL,
    CONSTRAINT acct_doc_counters_kind_check CHECK ((kind = ANY (ARRAY['QUOTE'::text, 'ORDER'::text, 'STATEMENT'::text]))),
    CONSTRAINT acct_doc_counters_last_check CHECK ((last >= 0)),
    CONSTRAINT acct_doc_counters_ym_check CHECK ((ym ~ '^[0-9]{4}$'::text))
);
ALTER TABLE ONLY public.acct_doc_counters ALTER COLUMN kind SET (pg_attver=165366664);
ALTER TABLE ONLY public.acct_doc_counters ALTER COLUMN ym SET (pg_attver=165366664);
ALTER TABLE ONLY public.acct_doc_counters ALTER COLUMN last SET (pg_attver=165366664);



CREATE TABLE public.acct_dunning_sends (
    id bigint NOT NULL,
    party_id bigint,
    party_name text NOT NULL,
    stage integer NOT NULL,
    oldest date,
    amount bigint NOT NULL,
    to_masked text,
    result text NOT NULL,
    error text,
    by_job boolean DEFAULT false NOT NULL,
    sent_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_dunning_sends_amount_check CHECK ((amount >= 0)),
    CONSTRAINT acct_dunning_sends_result_check CHECK ((result = ANY (ARRAY['SENT'::text, 'FAILED'::text, 'NO_EMAIL'::text, 'NOT_READY'::text, 'PREVIEW'::text]))),
    CONSTRAINT acct_dunning_sends_stage_check CHECK (((stage >= 1) AND (stage <= 3)))
);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN id SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN party_id SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN party_name SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN stage SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN oldest SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN amount SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN to_masked SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN result SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN error SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN by_job SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN sent_by SET (pg_attver=165890248);
ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN created_at SET (pg_attver=165890248);



CREATE SEQUENCE public.acct_dunning_sends_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_dunning_sends_id_seq OWNED BY public.acct_dunning_sends.id;



CREATE TABLE public.acct_dunning_templates (
    stage integer NOT NULL,
    days integer NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_dunning_templates_body_check CHECK (((char_length(btrim(body)) >= 10) AND (char_length(btrim(body)) <= 3000))),
    CONSTRAINT acct_dunning_templates_days_check CHECK (((days >= 1) AND (days <= 365))),
    CONSTRAINT acct_dunning_templates_stage_check CHECK (((stage >= 1) AND (stage <= 3))),
    CONSTRAINT acct_dunning_templates_subject_check CHECK (((char_length(btrim(subject)) >= 2) AND (char_length(btrim(subject)) <= 120)))
);
ALTER TABLE ONLY public.acct_dunning_templates ALTER COLUMN stage SET (pg_attver=165856480);
ALTER TABLE ONLY public.acct_dunning_templates ALTER COLUMN days SET (pg_attver=165856480);
ALTER TABLE ONLY public.acct_dunning_templates ALTER COLUMN subject SET (pg_attver=165856480);
ALTER TABLE ONLY public.acct_dunning_templates ALTER COLUMN body SET (pg_attver=165856480);
ALTER TABLE ONLY public.acct_dunning_templates ALTER COLUMN updated_by SET (pg_attver=165856480);
ALTER TABLE ONLY public.acct_dunning_templates ALTER COLUMN updated_at SET (pg_attver=165856480);



CREATE TABLE public.acct_employees (
    id bigint NOT NULL,
    name text NOT NULL,
    joined_on date NOT NULL,
    left_on date,
    monthly_base bigint NOT NULL,
    nontax bigint DEFAULT 0 NOT NULL,
    dependents integer DEFAULT 1 NOT NULL,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid,
    CONSTRAINT acct_employees_check CHECK (((left_on IS NULL) OR (left_on >= joined_on))),
    CONSTRAINT acct_employees_dependents_check CHECK (((dependents >= 1) AND (dependents <= 11))),
    CONSTRAINT acct_employees_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_employees_monthly_base_check CHECK (((monthly_base >= 0) AND (monthly_base <= 100000000))),
    CONSTRAINT acct_employees_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
    CONSTRAINT acct_employees_nontax_check CHECK (((nontax >= 0) AND (nontax <= 10000000)))
);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN id SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN name SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN joined_on SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN left_on SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN monthly_base SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN nontax SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN dependents SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN memo SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN created_by SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN created_at SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN updated_at SET (pg_attver=163532504);
ALTER TABLE ONLY public.acct_employees ALTER COLUMN account_id SET (pg_attver=167203816);



CREATE SEQUENCE public.acct_employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_employees_id_seq OWNED BY public.acct_employees.id;



CREATE TABLE public.acct_entries (
    id bigint NOT NULL,
    entry_date date NOT NULL,
    ym text DEFAULT ''::text NOT NULL,
    source text NOT NULL,
    source_key text NOT NULL,
    memo text,
    party text,
    evidence text DEFAULT 'NONE'::text NOT NULL,
    late boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_entries_evidence_check CHECK ((evidence = ANY (ARRAY['TAX_INVOICE'::text, 'CARD_PG'::text, 'CASH'::text, 'NONE'::text, 'CARD'::text, 'SIMPLE'::text]))),
    CONSTRAINT acct_entries_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_entries_party_check CHECK (((party IS NULL) OR (char_length(party) <= 120))),
    CONSTRAINT acct_entries_source_check CHECK ((source ~ '^[A-Z][A-Z_]{1,39}$'::text)),
    CONSTRAINT acct_entries_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 120)))
);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN id SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN entry_date SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN ym SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN source SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN source_key SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN memo SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN party SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN evidence SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN late SET (pg_attver=162118448);
ALTER TABLE ONLY public.acct_entries ALTER COLUMN created_at SET (pg_attver=162118448);



CREATE SEQUENCE public.acct_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_entries_id_seq OWNED BY public.acct_entries.id;



CREATE TABLE public.acct_entry_reversals (
    id bigint NOT NULL,
    manual_id bigint NOT NULL,
    entry_id bigint NOT NULL,
    reverse_entry_id bigint NOT NULL,
    reverse_on date NOT NULL,
    reason text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_entry_reversals_reason_check CHECK (((char_length(btrim(reason)) >= 5) AND (char_length(btrim(reason)) <= 200))),
    CONSTRAINT ck_aer_two CHECK ((entry_id <> reverse_entry_id))
);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN id SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN manual_id SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN entry_id SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN reverse_entry_id SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN reverse_on SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN reason SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN created_by SET (pg_attver=167468768);
ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN created_at SET (pg_attver=167468768);



CREATE SEQUENCE public.acct_entry_reversals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_entry_reversals_id_seq OWNED BY public.acct_entry_reversals.id;



CREATE TABLE public.acct_entry_tags (
    entry_id bigint NOT NULL,
    dept_id bigint,
    project_id bigint,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_aet_any CHECK (((dept_id IS NOT NULL) OR (project_id IS NOT NULL)))
);
ALTER TABLE ONLY public.acct_entry_tags ALTER COLUMN entry_id SET (pg_attver=165663864);
ALTER TABLE ONLY public.acct_entry_tags ALTER COLUMN dept_id SET (pg_attver=165663864);
ALTER TABLE ONLY public.acct_entry_tags ALTER COLUMN project_id SET (pg_attver=165663864);
ALTER TABLE ONLY public.acct_entry_tags ALTER COLUMN updated_by SET (pg_attver=165663864);
ALTER TABLE ONLY public.acct_entry_tags ALTER COLUMN updated_at SET (pg_attver=165663864);



CREATE TABLE public.acct_expense_claims (
    id bigint NOT NULL,
    claimant uuid NOT NULL,
    spent_on date NOT NULL,
    account_role text NOT NULL,
    amount bigint NOT NULL,
    vat bigint DEFAULT 0 NOT NULL,
    evidence text NOT NULL,
    item text NOT NULL,
    memo text,
    attachments uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    reject_reason text,
    paid_by uuid,
    paid_at timestamp with time zone,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    requisition_id bigint,
    CONSTRAINT acct_expense_claims_amount_check CHECK (((amount > 0) AND (amount <= 100000000))),
    CONSTRAINT acct_expense_claims_attachments_check CHECK ((cardinality(attachments) <= 3)),
    CONSTRAINT acct_expense_claims_evidence_check CHECK ((evidence = ANY (ARRAY['CARD'::text, 'CASH'::text, 'SIMPLE'::text, 'TAX_INVOICE'::text]))),
    CONSTRAINT acct_expense_claims_item_check CHECK (((char_length(btrim(item)) >= 2) AND (char_length(btrim(item)) <= 100))),
    CONSTRAINT acct_expense_claims_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT acct_expense_claims_reject_reason_check CHECK (((reject_reason IS NULL) OR (char_length(reject_reason) <= 200))),
    CONSTRAINT acct_expense_claims_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'PAID'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_expense_claims_vat_check CHECK ((vat >= 0)),
    CONSTRAINT ck_aec_simple CHECK (((evidence <> 'SIMPLE'::text) OR (vat = 0))),
    CONSTRAINT ck_aec_state CHECK ((((state = 'REQUESTED'::text) AND (decided_at IS NULL) AND (paid_at IS NULL) AND (canceled_at IS NULL)) OR ((state = 'APPROVED'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (paid_at IS NULL)) OR ((state = 'REJECTED'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL) AND (char_length(btrim(COALESCE(reject_reason, ''::text))) >= 2)) OR ((state = 'PAID'::text) AND (decided_at IS NOT NULL) AND (paid_by IS NOT NULL) AND (paid_at IS NOT NULL)) OR ((state = 'CANCELED'::text) AND (decided_at IS NULL) AND (canceled_at IS NOT NULL)))),
    CONSTRAINT ck_aec_vat CHECK (((vat * 11) <= (amount + 10)))
);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN id SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN claimant SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN spent_on SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN account_role SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN amount SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN vat SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN evidence SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN item SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN memo SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN attachments SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN state SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN decided_by SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN decided_at SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN reject_reason SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN paid_by SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN paid_at SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN canceled_at SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN created_at SET (pg_attver=162804304);
ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN requisition_id SET (pg_attver=164652032);



CREATE SEQUENCE public.acct_expense_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_expense_claims_id_seq OWNED BY public.acct_expense_claims.id;



CREATE TABLE public.acct_export_formats (
    id bigint NOT NULL,
    name text NOT NULL,
    columns jsonb NOT NULL,
    date_style text DEFAULT 'YYYY-MM-DD'::text NOT NULL,
    dc_style text DEFAULT 'SPLIT'::text NOT NULL,
    dc_debit text DEFAULT '차변'::text NOT NULL,
    dc_credit text DEFAULT '대변'::text NOT NULL,
    header boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_export_formats_columns_check CHECK (((jsonb_typeof(columns) = 'array'::text) AND ((jsonb_array_length(columns) >= 1) AND (jsonb_array_length(columns) <= 20)))),
    CONSTRAINT acct_export_formats_date_style_check CHECK ((date_style = ANY (ARRAY['YYYY-MM-DD'::text, 'YYYYMMDD'::text, 'YYYY/MM/DD'::text, 'YYYY.MM.DD'::text]))),
    CONSTRAINT acct_export_formats_dc_credit_check CHECK (((char_length(dc_credit) >= 1) AND (char_length(dc_credit) <= 10))),
    CONSTRAINT acct_export_formats_dc_debit_check CHECK (((char_length(dc_debit) >= 1) AND (char_length(dc_debit) <= 10))),
    CONSTRAINT acct_export_formats_dc_style_check CHECK ((dc_style = ANY (ARRAY['SPLIT'::text, 'SIGN'::text]))),
    CONSTRAINT acct_export_formats_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40)))
);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN id SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN name SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN columns SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN date_style SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN dc_style SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN dc_debit SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN dc_credit SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN header SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN is_default SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN updated_by SET (pg_attver=162458128);
ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN updated_at SET (pg_attver=162458128);



CREATE SEQUENCE public.acct_export_formats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_export_formats_id_seq OWNED BY public.acct_export_formats.id;



CREATE TABLE public.acct_export_lines (
    id bigint NOT NULL,
    export_id bigint NOT NULL,
    option_id uuid,
    item text,
    qty integer NOT NULL,
    foreign_amount numeric(14,2) NOT NULL,
    CONSTRAINT acct_export_lines_foreign_amount_check CHECK ((foreign_amount >= (0)::numeric)),
    CONSTRAINT acct_export_lines_item_check CHECK (((item IS NULL) OR ((char_length(btrim(item)) >= 2) AND (char_length(btrim(item)) <= 100)))),
    CONSTRAINT acct_export_lines_qty_check CHECK (((qty > 0) AND (qty <= 1000000))),
    CONSTRAINT ck_ael_what CHECK (((option_id IS NOT NULL) OR (item IS NOT NULL)))
);
ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN id SET (pg_attver=165062776);
ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN export_id SET (pg_attver=165062776);
ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN option_id SET (pg_attver=165062776);
ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN item SET (pg_attver=165062776);
ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN qty SET (pg_attver=165062776);
ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN foreign_amount SET (pg_attver=165062776);



CREATE SEQUENCE public.acct_export_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_export_lines_id_seq OWNED BY public.acct_export_lines.id;



CREATE TABLE public.acct_exports (
    id bigint NOT NULL,
    party_id bigint,
    title text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    incoterms text,
    fx_rate numeric(12,4),
    sale_krw bigint,
    paid_krw bigint,
    bl_no text,
    decl_no text,
    state text DEFAULT 'ORDERED'::text NOT NULL,
    ordered_on date NOT NULL,
    shipped_on date,
    cleared_on date,
    paid_on date,
    memo text,
    cancel_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_exports_bl_no_check CHECK (((bl_no IS NULL) OR (char_length(bl_no) <= 40))),
    CONSTRAINT acct_exports_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT acct_exports_decl_no_check CHECK (((decl_no IS NULL) OR ((char_length(decl_no) >= 5) AND (char_length(decl_no) <= 40)))),
    CONSTRAINT acct_exports_fx_rate_check CHECK (((fx_rate IS NULL) OR (fx_rate > (0)::numeric))),
    CONSTRAINT acct_exports_incoterms_check CHECK (((incoterms IS NULL) OR (incoterms ~ '^[A-Z]{3}$'::text))),
    CONSTRAINT acct_exports_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_exports_paid_krw_check CHECK (((paid_krw IS NULL) OR (paid_krw > 0))),
    CONSTRAINT acct_exports_sale_krw_check CHECK (((sale_krw IS NULL) OR (sale_krw >= 0))),
    CONSTRAINT acct_exports_state_check CHECK ((state = ANY (ARRAY['ORDERED'::text, 'SHIPPED'::text, 'CLEARED'::text, 'PAID'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_exports_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100))),
    CONSTRAINT ck_aex_cancel CHECK (((state <> 'CANCELED'::text) OR (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2))),
    CONSTRAINT ck_aex_cleared CHECK (((state <> 'CLEARED'::text) OR (decl_no IS NOT NULL))),
    CONSTRAINT ck_aex_paid CHECK (((state <> 'PAID'::text) OR ((paid_on IS NOT NULL) AND (paid_krw IS NOT NULL)))),
    CONSTRAINT ck_aex_shipped CHECK (((state = ANY (ARRAY['ORDERED'::text, 'CANCELED'::text])) OR ((shipped_on IS NOT NULL) AND (fx_rate IS NOT NULL) AND (sale_krw IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN id SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN party_id SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN title SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN currency SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN incoterms SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN fx_rate SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN sale_krw SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN paid_krw SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN bl_no SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN decl_no SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN state SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN ordered_on SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN shipped_on SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN cleared_on SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN paid_on SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN memo SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN cancel_note SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN created_by SET (pg_attver=164996536);
ALTER TABLE ONLY public.acct_exports ALTER COLUMN created_at SET (pg_attver=164996536);



CREATE SEQUENCE public.acct_exports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_exports_id_seq OWNED BY public.acct_exports.id;



CREATE TABLE public.acct_fx_revals (
    id bigint NOT NULL,
    ym text NOT NULL,
    as_of date NOT NULL,
    rates jsonb NOT NULL,
    items jsonb NOT NULL,
    gain bigint DEFAULT 0 NOT NULL,
    loss bigint DEFAULT 0 NOT NULL,
    entry_id bigint,
    reverse_entry_id bigint,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_fx_revals_gain_check CHECK ((gain >= 0)),
    CONSTRAINT acct_fx_revals_items_check CHECK ((jsonb_typeof(items) = 'array'::text)),
    CONSTRAINT acct_fx_revals_loss_check CHECK ((loss >= 0)),
    CONSTRAINT acct_fx_revals_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_fx_revals_rates_check CHECK ((jsonb_typeof(rates) = 'object'::text)),
    CONSTRAINT acct_fx_revals_ym_check CHECK ((ym ~ '^\d{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT ck_afr_entries CHECK (((((gain + loss) = 0) = (entry_id IS NULL)) AND ((entry_id IS NULL) = (reverse_entry_id IS NULL))))
);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN id SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN ym SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN as_of SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN rates SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN items SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN gain SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN loss SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN entry_id SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN reverse_entry_id SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN note SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN created_by SET (pg_attver=167526096);
ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN created_at SET (pg_attver=167526096);



CREATE SEQUENCE public.acct_fx_revals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_fx_revals_id_seq OWNED BY public.acct_fx_revals.id;



CREATE TABLE public.acct_import_lines (
    id bigint NOT NULL,
    import_id bigint NOT NULL,
    option_id uuid NOT NULL,
    qty integer NOT NULL,
    foreign_amount numeric(14,2) NOT NULL,
    landed_cost bigint,
    CONSTRAINT acct_import_lines_foreign_amount_check CHECK ((foreign_amount >= (0)::numeric)),
    CONSTRAINT acct_import_lines_qty_check CHECK (((qty > 0) AND (qty <= 1000000)))
);
ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN id SET (pg_attver=164423424);
ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN import_id SET (pg_attver=164423424);
ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN option_id SET (pg_attver=164423424);
ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN qty SET (pg_attver=164423424);
ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN foreign_amount SET (pg_attver=164423424);
ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN landed_cost SET (pg_attver=164423424);



CREATE SEQUENCE public.acct_import_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_import_lines_id_seq OWNED BY public.acct_import_lines.id;



CREATE TABLE public.acct_imports (
    id bigint NOT NULL,
    party_id bigint,
    title text NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    fx_rate numeric(12,4),
    duty bigint DEFAULT 0 NOT NULL,
    import_vat bigint DEFAULT 0 NOT NULL,
    freight bigint DEFAULT 0 NOT NULL,
    other_cost bigint DEFAULT 0 NOT NULL,
    goods_krw bigint,
    bl_no text,
    broker_name text,
    decl_no text,
    state text DEFAULT 'ORDERED'::text NOT NULL,
    ordered_on date NOT NULL,
    shipped_on date,
    customs_on date,
    received_on date,
    memo text,
    cancel_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_imports_bl_no_check CHECK (((bl_no IS NULL) OR (char_length(bl_no) <= 40))),
    CONSTRAINT acct_imports_broker_name_check CHECK (((broker_name IS NULL) OR (char_length(broker_name) <= 60))),
    CONSTRAINT acct_imports_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT acct_imports_decl_no_check CHECK (((decl_no IS NULL) OR (char_length(decl_no) <= 40))),
    CONSTRAINT acct_imports_duty_check CHECK ((duty >= 0)),
    CONSTRAINT acct_imports_freight_check CHECK ((freight >= 0)),
    CONSTRAINT acct_imports_fx_rate_check CHECK (((fx_rate IS NULL) OR (fx_rate > (0)::numeric))),
    CONSTRAINT acct_imports_import_vat_check CHECK ((import_vat >= 0)),
    CONSTRAINT acct_imports_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_imports_other_cost_check CHECK ((other_cost >= 0)),
    CONSTRAINT acct_imports_state_check CHECK ((state = ANY (ARRAY['ORDERED'::text, 'SHIPPED'::text, 'CUSTOMS'::text, 'RECEIVED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_imports_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100))),
    CONSTRAINT ck_aim_cancel CHECK (((state <> 'CANCELED'::text) OR (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2))),
    CONSTRAINT ck_aim_customs CHECK (((state <> ALL (ARRAY['CUSTOMS'::text, 'RECEIVED'::text])) OR ((customs_on IS NOT NULL) AND (fx_rate IS NOT NULL)))),
    CONSTRAINT ck_aim_received CHECK (((state <> 'RECEIVED'::text) OR ((received_on IS NOT NULL) AND (goods_krw IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN id SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN party_id SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN title SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN currency SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN fx_rate SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN duty SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN import_vat SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN freight SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN other_cost SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN goods_krw SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN bl_no SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN broker_name SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN decl_no SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN state SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN ordered_on SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN shipped_on SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN customs_on SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN received_on SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN memo SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN cancel_note SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN created_by SET (pg_attver=164350592);
ALTER TABLE ONLY public.acct_imports ALTER COLUMN created_at SET (pg_attver=164350592);



CREATE SEQUENCE public.acct_imports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_imports_id_seq OWNED BY public.acct_imports.id;



CREATE TABLE public.acct_insurance_done (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    kind text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_insurance_done_kind_check CHECK ((kind = ANY (ARRAY['ACQ'::text, 'LOSS'::text]))),
    CONSTRAINT acct_insurance_done_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);
ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN id SET (pg_attver=164714280);
ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN employee_id SET (pg_attver=164714280);
ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN kind SET (pg_attver=164714280);
ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN note SET (pg_attver=164714280);
ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN created_by SET (pg_attver=164714280);
ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN created_at SET (pg_attver=164714280);



CREATE SEQUENCE public.acct_insurance_done_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_insurance_done_id_seq OWNED BY public.acct_insurance_done.id;



CREATE TABLE public.acct_leave_grants (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    year integer NOT NULL,
    days numeric(5,1) NOT NULL,
    note text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_leave_grants_days_check CHECK (((days <> (0)::numeric) AND (abs(days) <= (40)::numeric))),
    CONSTRAINT acct_leave_grants_note_check CHECK (((char_length(btrim(note)) >= 2) AND (char_length(btrim(note)) <= 200))),
    CONSTRAINT acct_leave_grants_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN id SET (pg_attver=163996208);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN employee_id SET (pg_attver=163996208);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN year SET (pg_attver=163996208);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN days SET (pg_attver=163996208);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN note SET (pg_attver=163996208);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN created_by SET (pg_attver=163996208);
ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN created_at SET (pg_attver=163996208);



CREATE SEQUENCE public.acct_leave_grants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_leave_grants_id_seq OWNED BY public.acct_leave_grants.id;



CREATE TABLE public.acct_leave_requests (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    start_on date NOT NULL,
    end_on date NOT NULL,
    half text DEFAULT 'FULL'::text NOT NULL,
    days numeric(4,1) NOT NULL,
    note text,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_leave_requests_days_check CHECK (((days > (0)::numeric) AND (days <= (30)::numeric))),
    CONSTRAINT acct_leave_requests_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 200))),
    CONSTRAINT acct_leave_requests_half_check CHECK ((half = ANY (ARRAY['FULL'::text, 'AM'::text, 'PM'::text]))),
    CONSTRAINT acct_leave_requests_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_leave_requests_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELED'::text]))),
    CONSTRAINT ck_alr_half CHECK (((half = 'FULL'::text) OR ((start_on = end_on) AND (days = 0.5)))),
    CONSTRAINT ck_alr_range CHECK (((end_on >= start_on) AND ((end_on - start_on) <= 40)))
);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN id SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN employee_id SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN start_on SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN end_on SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN half SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN days SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN note SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN state SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN decided_by SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN decided_at SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN decide_note SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN created_by SET (pg_attver=167298216);
ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN created_at SET (pg_attver=167298216);



CREATE SEQUENCE public.acct_leave_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_leave_requests_id_seq OWNED BY public.acct_leave_requests.id;



CREATE TABLE public.acct_leave_uses (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    used_on date NOT NULL,
    days numeric(4,1) NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_leave_uses_days_check CHECK (((days <> (0)::numeric) AND (abs(days) <= (30)::numeric))),
    CONSTRAINT acct_leave_uses_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN id SET (pg_attver=164029616);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN employee_id SET (pg_attver=164029616);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN used_on SET (pg_attver=164029616);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN days SET (pg_attver=164029616);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN note SET (pg_attver=164029616);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN created_by SET (pg_attver=164029616);
ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN created_at SET (pg_attver=164029616);



CREATE SEQUENCE public.acct_leave_uses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_leave_uses_id_seq OWNED BY public.acct_leave_uses.id;



CREATE TABLE public.acct_lines (
    id bigint NOT NULL,
    entry_id bigint NOT NULL,
    role text NOT NULL,
    debit bigint DEFAULT 0 NOT NULL,
    credit bigint DEFAULT 0 NOT NULL,
    CONSTRAINT acct_lines_credit_check CHECK ((credit >= 0)),
    CONSTRAINT acct_lines_debit_check CHECK ((debit >= 0)),
    CONSTRAINT ck_acct_lines_one CHECK (((debit > 0) <> (credit > 0)))
);
ALTER TABLE ONLY public.acct_lines ALTER COLUMN id SET (pg_attver=162163088);
ALTER TABLE ONLY public.acct_lines ALTER COLUMN entry_id SET (pg_attver=162163088);
ALTER TABLE ONLY public.acct_lines ALTER COLUMN role SET (pg_attver=162163088);
ALTER TABLE ONLY public.acct_lines ALTER COLUMN debit SET (pg_attver=162163088);
ALTER TABLE ONLY public.acct_lines ALTER COLUMN credit SET (pg_attver=162163088);



CREATE SEQUENCE public.acct_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_lines_id_seq OWNED BY public.acct_lines.id;



CREATE TABLE public.acct_manual_entries (
    id bigint NOT NULL,
    entry_date date NOT NULL,
    memo text NOT NULL,
    party text,
    evidence text DEFAULT 'NONE'::text NOT NULL,
    lines jsonb NOT NULL,
    total bigint NOT NULL,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    created_by uuid NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    entry_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_manual_entries_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 200))),
    CONSTRAINT acct_manual_entries_evidence_check CHECK ((evidence = ANY (ARRAY['TAX_INVOICE'::text, 'CARD_PG'::text, 'CASH'::text, 'NONE'::text, 'CARD'::text, 'SIMPLE'::text]))),
    CONSTRAINT acct_manual_entries_lines_check CHECK (((jsonb_typeof(lines) = 'array'::text) AND ((jsonb_array_length(lines) >= 2) AND (jsonb_array_length(lines) <= 30)))),
    CONSTRAINT acct_manual_entries_memo_check CHECK (((char_length(btrim(memo)) >= 2) AND (char_length(btrim(memo)) <= 200))),
    CONSTRAINT acct_manual_entries_party_check CHECK (((party IS NULL) OR (char_length(party) <= 120))),
    CONSTRAINT acct_manual_entries_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_manual_entries_total_check CHECK ((total > 0)),
    CONSTRAINT ck_ame_decided CHECK (((state = 'REQUESTED'::text) OR (state = 'CANCELED'::text) OR ((decided_by IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT ck_ame_entry CHECK (((state = 'APPROVED'::text) = (entry_id IS NOT NULL))),
    CONSTRAINT ck_ame_reject CHECK (((state <> 'REJECTED'::text) OR (char_length(btrim(COALESCE(decide_note, ''::text))) >= 2)))
);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN id SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN entry_date SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN memo SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN party SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN evidence SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN lines SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN total SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN state SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN created_by SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN decided_by SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN decided_at SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN decide_note SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN entry_id SET (pg_attver=163887536);
ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN created_at SET (pg_attver=163887536);



CREATE SEQUENCE public.acct_manual_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_manual_entries_id_seq OWNED BY public.acct_manual_entries.id;



CREATE TABLE public.acct_opening (
    id bigint NOT NULL,
    set_id bigint NOT NULL,
    role text NOT NULL,
    debit bigint DEFAULT 0 NOT NULL,
    credit bigint DEFAULT 0 NOT NULL,
    memo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_opening_credit_check CHECK ((credit >= 0)),
    CONSTRAINT acct_opening_debit_check CHECK ((debit >= 0)),
    CONSTRAINT acct_opening_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 120))),
    CONSTRAINT ck_ao_one CHECK (((debit > 0) <> (credit > 0)))
);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN id SET (pg_attver=163227416);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN set_id SET (pg_attver=163227416);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN role SET (pg_attver=163227416);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN debit SET (pg_attver=163227416);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN credit SET (pg_attver=163227416);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN memo SET (pg_attver=163227416);
ALTER TABLE ONLY public.acct_opening ALTER COLUMN created_at SET (pg_attver=163227416);



CREATE SEQUENCE public.acct_opening_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_opening_id_seq OWNED BY public.acct_opening.id;



CREATE TABLE public.acct_opening_sets (
    id bigint NOT NULL,
    as_of date NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fixed_by uuid,
    fixed_at timestamp with time zone,
    CONSTRAINT acct_opening_sets_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_opening_sets_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'FIXED'::text]))),
    CONSTRAINT ck_aos_fixed CHECK ((((state = 'DRAFT'::text) AND (fixed_at IS NULL)) OR ((state = 'FIXED'::text) AND (fixed_at IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN id SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN as_of SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN state SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN note SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN created_by SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN created_at SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN fixed_by SET (pg_attver=163185240);
ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN fixed_at SET (pg_attver=163185240);



CREATE SEQUENCE public.acct_opening_sets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_opening_sets_id_seq OWNED BY public.acct_opening_sets.id;



CREATE TABLE public.acct_parties (
    id bigint NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    biz_no text,
    contact_name text,
    contact_phone text,
    contact_email text,
    bank_name text,
    account_last4 text,
    advertiser_id uuid,
    seller_id uuid,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    biz_status text,
    biz_checked_at timestamp with time zone,
    biz_detail text,
    biz_stub boolean,
    CONSTRAINT acct_parties_account_last4_check CHECK (((account_last4 IS NULL) OR (account_last4 ~ '^[0-9]{4}$'::text))),
    CONSTRAINT acct_parties_bank_name_check CHECK (((bank_name IS NULL) OR (char_length(bank_name) <= 20))),
    CONSTRAINT acct_parties_biz_no_check CHECK (((biz_no IS NULL) OR (biz_no ~ '^[0-9]{10}$'::text))),
    CONSTRAINT acct_parties_contact_email_check CHECK (((contact_email IS NULL) OR (char_length(contact_email) <= 120))),
    CONSTRAINT acct_parties_contact_name_check CHECK (((contact_name IS NULL) OR (char_length(contact_name) <= 40))),
    CONSTRAINT acct_parties_contact_phone_check CHECK (((contact_phone IS NULL) OR (contact_phone ~ '^[0-9-]{7,20}$'::text))),
    CONSTRAINT acct_parties_kind_check CHECK ((kind = ANY (ARRAY['SUPPLIER'::text, 'CUSTOMER'::text, 'BOTH'::text]))),
    CONSTRAINT acct_parties_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_parties_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 120))),
    CONSTRAINT acct_parties_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text]))),
    CONSTRAINT ck_acct_parties_biz_status CHECK ((((biz_status IS NULL) OR (biz_status = ANY (ARRAY['VALID'::text, 'SUSPENDED'::text, 'CLOSED'::text, 'UNKNOWN'::text]))) AND ((biz_detail IS NULL) OR (char_length(biz_detail) <= 200))))
);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN id SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN kind SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN name SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN biz_no SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN contact_name SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN contact_phone SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN contact_email SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN bank_name SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN account_last4 SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN advertiser_id SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN seller_id SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN memo SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN state SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN created_by SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN created_at SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN updated_by SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN updated_at SET (pg_attver=164083440);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN biz_status SET (pg_attver=165208856);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN biz_checked_at SET (pg_attver=165209296);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN biz_detail SET (pg_attver=165209744);
ALTER TABLE ONLY public.acct_parties ALTER COLUMN biz_stub SET (pg_attver=165210184);



CREATE SEQUENCE public.acct_parties_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_parties_id_seq OWNED BY public.acct_parties.id;



CREATE TABLE public.acct_payroll_lines (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    gross bigint NOT NULL,
    nontax bigint DEFAULT 0 NOT NULL,
    income_tax bigint DEFAULT 0 NOT NULL,
    local_tax bigint DEFAULT 0 NOT NULL,
    np bigint DEFAULT 0 NOT NULL,
    hi bigint DEFAULT 0 NOT NULL,
    ltc bigint DEFAULT 0 NOT NULL,
    ei bigint DEFAULT 0 NOT NULL,
    net bigint NOT NULL,
    company_np bigint DEFAULT 0 NOT NULL,
    company_hi bigint DEFAULT 0 NOT NULL,
    company_ltc bigint DEFAULT 0 NOT NULL,
    company_ei bigint DEFAULT 0 NOT NULL,
    wht_missing boolean DEFAULT false NOT NULL,
    company_ia bigint DEFAULT 0 NOT NULL,
    CONSTRAINT acct_payroll_lines_company_ei_check CHECK ((company_ei >= 0)),
    CONSTRAINT acct_payroll_lines_company_hi_check CHECK ((company_hi >= 0)),
    CONSTRAINT acct_payroll_lines_company_ltc_check CHECK ((company_ltc >= 0)),
    CONSTRAINT acct_payroll_lines_company_np_check CHECK ((company_np >= 0)),
    CONSTRAINT acct_payroll_lines_ei_check CHECK ((ei >= 0)),
    CONSTRAINT acct_payroll_lines_gross_check CHECK ((gross >= 0)),
    CONSTRAINT acct_payroll_lines_hi_check CHECK ((hi >= 0)),
    CONSTRAINT acct_payroll_lines_income_tax_check CHECK ((income_tax >= 0)),
    CONSTRAINT acct_payroll_lines_local_tax_check CHECK ((local_tax >= 0)),
    CONSTRAINT acct_payroll_lines_ltc_check CHECK ((ltc >= 0)),
    CONSTRAINT acct_payroll_lines_nontax_check CHECK ((nontax >= 0)),
    CONSTRAINT acct_payroll_lines_np_check CHECK ((np >= 0)),
    CONSTRAINT ck_apl_company_ia CHECK ((company_ia >= 0)),
    CONSTRAINT ck_apl_net CHECK ((net = ((((((gross - income_tax) - local_tax) - np) - hi) - ltc) - ei)))
);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN id SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN run_id SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN employee_id SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN gross SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN nontax SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN income_tax SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN local_tax SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN np SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN hi SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN ltc SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN ei SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN net SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN company_np SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN company_hi SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN company_ltc SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN company_ei SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN wht_missing SET (pg_attver=163623432);
ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN company_ia SET (pg_attver=164746568);



CREATE SEQUENCE public.acct_payroll_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_payroll_lines_id_seq OWNED BY public.acct_payroll_lines.id;



CREATE TABLE public.acct_payroll_rate_log (
    id bigint NOT NULL,
    year integer NOT NULL,
    what text NOT NULL,
    detail jsonb,
    reason text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_payroll_rate_log_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN id SET (pg_attver=163744200);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN year SET (pg_attver=163744200);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN what SET (pg_attver=163744200);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN detail SET (pg_attver=163744200);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN reason SET (pg_attver=163744200);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN actor_id SET (pg_attver=163744200);
ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN created_at SET (pg_attver=163744200);



CREATE SEQUENCE public.acct_payroll_rate_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_payroll_rate_log_id_seq OWNED BY public.acct_payroll_rate_log.id;



CREATE TABLE public.acct_payroll_rates (
    year integer NOT NULL,
    key text NOT NULL,
    value numeric NOT NULL,
    draft boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_payroll_rates_key_check CHECK ((key = ANY (ARRAY['np_rate'::text, 'np_base_min'::text, 'np_base_max'::text, 'hi_rate'::text, 'ltc_rate'::text, 'ei_rate'::text, 'ei_company_rate'::text, 'ia_company_rate'::text]))),
    CONSTRAINT acct_payroll_rates_value_check CHECK ((value >= (0)::numeric)),
    CONSTRAINT acct_payroll_rates_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);
ALTER TABLE ONLY public.acct_payroll_rates ALTER COLUMN year SET (pg_attver=163690968);
ALTER TABLE ONLY public.acct_payroll_rates ALTER COLUMN key SET (pg_attver=163690968);
ALTER TABLE ONLY public.acct_payroll_rates ALTER COLUMN value SET (pg_attver=163690968);
ALTER TABLE ONLY public.acct_payroll_rates ALTER COLUMN draft SET (pg_attver=163690968);
ALTER TABLE ONLY public.acct_payroll_rates ALTER COLUMN updated_by SET (pg_attver=163690968);
ALTER TABLE ONLY public.acct_payroll_rates ALTER COLUMN updated_at SET (pg_attver=163690968);



CREATE TABLE public.acct_payroll_runs (
    id bigint NOT NULL,
    ym text NOT NULL,
    pay_day date NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    created_by uuid,
    fixed_by uuid,
    fixed_at timestamp with time zone,
    paid_by uuid,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_payroll_runs_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'FIXED'::text, 'PAID'::text]))),
    CONSTRAINT acct_payroll_runs_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN id SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN ym SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN pay_day SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN state SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN created_by SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN fixed_by SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN fixed_at SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN paid_by SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN paid_at SET (pg_attver=163579016);
ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN created_at SET (pg_attver=163579016);



CREATE SEQUENCE public.acct_payroll_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_payroll_runs_id_seq OWNED BY public.acct_payroll_runs.id;



CREATE TABLE public.acct_payslip_mails (
    id bigint NOT NULL,
    line_id bigint NOT NULL,
    to_masked text,
    result text NOT NULL,
    error text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_payslip_mails_error_check CHECK (((error IS NULL) OR (char_length(error) <= 300))),
    CONSTRAINT acct_payslip_mails_result_check CHECK ((result = ANY (ARRAY['SENT'::text, 'FAILED'::text, 'NO_ACCOUNT'::text, 'NOT_READY'::text])))
);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN id SET (pg_attver=167364816);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN line_id SET (pg_attver=167364816);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN to_masked SET (pg_attver=167364816);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN result SET (pg_attver=167364816);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN error SET (pg_attver=167364816);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN created_by SET (pg_attver=167364816);
ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN created_at SET (pg_attver=167364816);



CREATE SEQUENCE public.acct_payslip_mails_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_payslip_mails_id_seq OWNED BY public.acct_payslip_mails.id;



CREATE TABLE public.acct_pg_txns (
    id bigint NOT NULL,
    upload_id bigint NOT NULL,
    paid_on date NOT NULL,
    settle_on date NOT NULL,
    gross bigint NOT NULL,
    fee bigint DEFAULT 0 NOT NULL,
    fee_vat bigint DEFAULT 0 NOT NULL,
    net bigint NOT NULL,
    pg_key text,
    method text,
    row_hash text NOT NULL,
    match_kind text,
    entry_id bigint,
    match_note text,
    matched_by uuid,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_pg_txns_gross_check CHECK ((gross <> 0)),
    CONSTRAINT acct_pg_txns_match_kind_check CHECK ((match_kind = ANY (ARRAY['ENTRY'::text, 'IGNORE'::text]))),
    CONSTRAINT acct_pg_txns_match_note_check CHECK (((match_note IS NULL) OR (char_length(match_note) <= 200))),
    CONSTRAINT acct_pg_txns_method_check CHECK (((method IS NULL) OR (char_length(method) <= 40))),
    CONSTRAINT acct_pg_txns_pg_key_check CHECK (((pg_key IS NULL) OR (char_length(pg_key) <= 80))),
    CONSTRAINT ck_apt_match CHECK (((match_kind IS NULL) OR ((match_kind = 'ENTRY'::text) AND (entry_id IS NOT NULL)) OR ((match_kind = 'IGNORE'::text) AND (char_length(btrim(COALESCE(match_note, ''::text))) >= 2)))),
    CONSTRAINT ck_apt_net CHECK ((net = (gross - fee))),
    CONSTRAINT ck_apt_vat CHECK ((abs(fee_vat) <= abs(fee)))
);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN id SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN upload_id SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN paid_on SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN settle_on SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN gross SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN fee SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN fee_vat SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN net SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN pg_key SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN method SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN row_hash SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN match_kind SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN entry_id SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN match_note SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN matched_by SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN matched_at SET (pg_attver=163821560);
ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN created_at SET (pg_attver=163821560);



CREATE SEQUENCE public.acct_pg_txns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_pg_txns_id_seq OWNED BY public.acct_pg_txns.id;



CREATE TABLE public.acct_pg_uploads (
    id bigint NOT NULL,
    filename text,
    pg_name text,
    rows_total integer DEFAULT 0 NOT NULL,
    rows_added integer DEFAULT 0 NOT NULL,
    rows_dup integer DEFAULT 0 NOT NULL,
    rows_bad integer DEFAULT 0 NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_pg_uploads_pg_name_check CHECK (((pg_name IS NULL) OR (char_length(pg_name) <= 40)))
);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN id SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN filename SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN pg_name SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN rows_total SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN rows_added SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN rows_dup SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN rows_bad SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN uploaded_by SET (pg_attver=163790608);
ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN created_at SET (pg_attver=163790608);



CREATE SEQUENCE public.acct_pg_uploads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_pg_uploads_id_seq OWNED BY public.acct_pg_uploads.id;



CREATE TABLE public.acct_po_lines (
    id bigint NOT NULL,
    po_id bigint NOT NULL,
    option_id uuid,
    item text,
    qty integer NOT NULL,
    unit_price bigint NOT NULL,
    CONSTRAINT acct_po_lines_item_check CHECK (((item IS NULL) OR ((char_length(btrim(item)) >= 2) AND (char_length(btrim(item)) <= 100)))),
    CONSTRAINT acct_po_lines_qty_check CHECK (((qty > 0) AND (qty <= 1000000))),
    CONSTRAINT acct_po_lines_unit_price_check CHECK (((unit_price >= 0) AND (unit_price <= '10000000000'::bigint))),
    CONSTRAINT ck_apl_what CHECK (((option_id IS NOT NULL) OR (item IS NOT NULL)))
);
ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN id SET (pg_attver=165162712);
ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN po_id SET (pg_attver=165162712);
ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN option_id SET (pg_attver=165162712);
ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN item SET (pg_attver=165162712);
ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN qty SET (pg_attver=165162712);
ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN unit_price SET (pg_attver=165162712);



CREATE SEQUENCE public.acct_po_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_po_lines_id_seq OWNED BY public.acct_po_lines.id;



CREATE TABLE public.acct_pos (
    id bigint NOT NULL,
    party_id bigint NOT NULL,
    title text NOT NULL,
    state text DEFAULT 'ORDERED'::text NOT NULL,
    ordered_on date NOT NULL,
    received_on date,
    purchase_id bigint,
    requisition_id bigint,
    memo text,
    cancel_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_pos_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_pos_state_check CHECK ((state = ANY (ARRAY['ORDERED'::text, 'RECEIVED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_pos_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100))),
    CONSTRAINT ck_apo_cancel CHECK (((state <> 'CANCELED'::text) OR (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2))),
    CONSTRAINT ck_apo_received CHECK (((state <> 'RECEIVED'::text) OR ((received_on IS NOT NULL) AND (purchase_id IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN id SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN party_id SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN title SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN state SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN ordered_on SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN received_on SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN purchase_id SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN requisition_id SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN memo SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN cancel_note SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN created_by SET (pg_attver=165105432);
ALTER TABLE ONLY public.acct_pos ALTER COLUMN created_at SET (pg_attver=165105432);



CREATE SEQUENCE public.acct_pos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_pos_id_seq OWNED BY public.acct_pos.id;



CREATE TABLE public.acct_projects (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    dept_id bigint,
    starts_on date,
    ends_on date,
    closed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_projects_code_check CHECK ((code ~ '^[A-Z0-9_-]{2,30}$'::text)),
    CONSTRAINT acct_projects_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 80))),
    CONSTRAINT ck_aproj_period CHECK (((ends_on IS NULL) OR (starts_on IS NULL) OR (ends_on >= starts_on)))
);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN id SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN code SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN name SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN dept_id SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN starts_on SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN ends_on SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN closed SET (pg_attver=165566152);
ALTER TABLE ONLY public.acct_projects ALTER COLUMN created_at SET (pg_attver=165566152);



CREATE SEQUENCE public.acct_projects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_projects_id_seq OWNED BY public.acct_projects.id;



CREATE TABLE public.acct_purchases (
    id bigint NOT NULL,
    kind text NOT NULL,
    issued_on date NOT NULL,
    supplier_name text NOT NULL,
    supplier_biz_no text,
    item text NOT NULL,
    supply bigint NOT NULL,
    vat bigint DEFAULT 0 NOT NULL,
    total bigint NOT NULL,
    deductible boolean DEFAULT false NOT NULL,
    account_role text NOT NULL,
    pay_role text NOT NULL,
    memo text,
    attachments uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    cancel_reason text,
    canceled_by uuid,
    canceled_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    requisition_id bigint,
    CONSTRAINT acct_purchases_attachments_check CHECK ((cardinality(attachments) <= 5)),
    CONSTRAINT acct_purchases_check CHECK (((vat >= 0) AND (vat <= supply))),
    CONSTRAINT acct_purchases_item_check CHECK (((char_length(item) >= 1) AND (char_length(item) <= 120))),
    CONSTRAINT acct_purchases_kind_check CHECK ((kind = ANY (ARRAY['TAX_INVOICE'::text, 'CARD'::text, 'CASH'::text, 'SIMPLE'::text]))),
    CONSTRAINT acct_purchases_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_purchases_pay_role_check CHECK ((pay_role = ANY (ARRAY['CASH'::text, 'AP'::text, 'CARD_AP'::text]))),
    CONSTRAINT acct_purchases_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_purchases_supplier_biz_no_check CHECK (((supplier_biz_no IS NULL) OR (supplier_biz_no ~ '^[0-9]{10}$'::text))),
    CONSTRAINT acct_purchases_supplier_name_check CHECK (((char_length(supplier_name) >= 1) AND (char_length(supplier_name) <= 120))),
    CONSTRAINT acct_purchases_supply_check CHECK ((supply > 0)),
    CONSTRAINT ck_ap_cancel CHECK ((((state = 'ACTIVE'::text) AND (cancel_reason IS NULL) AND (canceled_at IS NULL)) OR ((state = 'CANCELED'::text) AND ((char_length(btrim(COALESCE(cancel_reason, ''::text))) >= 2) AND (char_length(btrim(COALESCE(cancel_reason, ''::text))) <= 200)) AND (canceled_at IS NOT NULL)))),
    CONSTRAINT ck_ap_deduct CHECK (((NOT deductible) OR (vat > 0))),
    CONSTRAINT ck_ap_simple CHECK (((kind <> 'SIMPLE'::text) OR ((vat = 0) AND (NOT deductible)))),
    CONSTRAINT ck_ap_taxinv CHECK (((kind <> 'TAX_INVOICE'::text) OR (supplier_biz_no IS NOT NULL))),
    CONSTRAINT ck_ap_total CHECK ((total = (supply + vat)))
);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN id SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN kind SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN issued_on SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN supplier_name SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN supplier_biz_no SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN item SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN supply SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN vat SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN total SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN deductible SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN account_role SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN pay_role SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN memo SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN attachments SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN state SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN cancel_reason SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN canceled_by SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN canceled_at SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN created_by SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN created_at SET (pg_attver=162703224);
ALTER TABLE ONLY public.acct_purchases ALTER COLUMN requisition_id SET (pg_attver=164647264);



CREATE SEQUENCE public.acct_purchases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_purchases_id_seq OWNED BY public.acct_purchases.id;



CREATE TABLE public.acct_receipt_promises (
    id bigint NOT NULL,
    party_id bigint,
    party_name text NOT NULL,
    amount bigint NOT NULL,
    due_on date NOT NULL,
    note text,
    cash_plan_id bigint,
    state text DEFAULT 'OPEN'::text NOT NULL,
    closed_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT acct_receipt_promises_amount_check CHECK ((amount > 0)),
    CONSTRAINT acct_receipt_promises_closed_note_check CHECK (((closed_note IS NULL) OR (char_length(closed_note) <= 200))),
    CONSTRAINT acct_receipt_promises_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_receipt_promises_party_name_check CHECK (((char_length(btrim(party_name)) >= 1) AND (char_length(btrim(party_name)) <= 120))),
    CONSTRAINT acct_receipt_promises_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'KEPT'::text, 'BROKEN'::text, 'CANCELED'::text])))
);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN id SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN party_id SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN party_name SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN amount SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN due_on SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN note SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN cash_plan_id SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN state SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN closed_note SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN created_by SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN created_at SET (pg_attver=165942304);
ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN closed_at SET (pg_attver=165942304);



CREATE SEQUENCE public.acct_receipt_promises_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_receipt_promises_id_seq OWNED BY public.acct_receipt_promises.id;



CREATE TABLE public.acct_receipt_reads (
    id bigint NOT NULL,
    file_id uuid NOT NULL,
    mode text NOT NULL,
    model text,
    ok boolean NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    in_tokens integer DEFAULT 0 NOT NULL,
    out_tokens integer DEFAULT 0 NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT acct_receipt_reads_error_check CHECK (((error IS NULL) OR (char_length(error) <= 300))),
    CONSTRAINT acct_receipt_reads_mode_check CHECK ((mode = ANY (ARRAY['ASSUME'::text, 'AI'::text])))
);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN id SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN file_id SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN mode SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN model SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN ok SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN result SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN error SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN in_tokens SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN out_tokens SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN actor_id SET (pg_attver=166161376);
ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN created_at SET (pg_attver=166161376);



CREATE SEQUENCE public.acct_receipt_reads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_receipt_reads_id_seq OWNED BY public.acct_receipt_reads.id;



CREATE TABLE public.acct_reorder_draft_lines (
    id bigint NOT NULL,
    draft_id bigint NOT NULL,
    option_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_price bigint NOT NULL,
    position_qty integer DEFAULT 0 NOT NULL,
    min_qty integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_reorder_draft_lines_min_qty_check CHECK ((min_qty >= 0)),
    CONSTRAINT acct_reorder_draft_lines_qty_check CHECK (((qty >= 1) AND (qty <= 1000000))),
    CONSTRAINT acct_reorder_draft_lines_unit_price_check CHECK (((unit_price >= 0) AND (unit_price <= '10000000000'::bigint)))
);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN id SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN draft_id SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN option_id SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN qty SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN unit_price SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN position_qty SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN min_qty SET (pg_attver=170236728);
ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN created_at SET (pg_attver=170236728);



CREATE SEQUENCE public.acct_reorder_draft_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_reorder_draft_lines_id_seq OWNED BY public.acct_reorder_draft_lines.id;



CREATE TABLE public.acct_reorder_drafts (
    id bigint NOT NULL,
    party_id bigint,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    po_id bigint,
    made_by_job boolean DEFAULT true NOT NULL,
    dismiss_note text,
    done_by uuid,
    done_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_reorder_drafts_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'CONVERTED'::text, 'DISMISSED'::text]))),
    CONSTRAINT ck_ard_converted CHECK (((state <> 'CONVERTED'::text) OR ((po_id IS NOT NULL) AND (done_at IS NOT NULL)))),
    CONSTRAINT ck_ard_dismissed CHECK (((state <> 'DISMISSED'::text) OR ((done_at IS NOT NULL) AND (char_length(btrim(COALESCE(dismiss_note, ''::text))) >= 2))))
);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN id SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN party_id SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN state SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN po_id SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN made_by_job SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN dismiss_note SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN done_by SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN done_at SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN created_at SET (pg_attver=170186472);
ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN updated_at SET (pg_attver=170186472);



CREATE SEQUENCE public.acct_reorder_drafts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_reorder_drafts_id_seq OWNED BY public.acct_reorder_drafts.id;



CREATE TABLE public.acct_requisitions (
    id bigint NOT NULL,
    requester uuid NOT NULL,
    title text NOT NULL,
    amount bigint NOT NULL,
    account_role text NOT NULL,
    reason text NOT NULL,
    needed_on date,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    used_kind text,
    used_ref bigint,
    used_amount bigint,
    used_by uuid,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_requisitions_amount_check CHECK (((amount > 0) AND (amount <= '10000000000'::bigint))),
    CONSTRAINT acct_requisitions_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 200))),
    CONSTRAINT acct_requisitions_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 400))),
    CONSTRAINT acct_requisitions_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'USED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_requisitions_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100))),
    CONSTRAINT acct_requisitions_used_kind_check CHECK (((used_kind IS NULL) OR (used_kind = ANY (ARRAY['PURCHASE'::text, 'EXPENSE'::text])))),
    CONSTRAINT ck_areq_decided CHECK (((state = ANY (ARRAY['REQUESTED'::text, 'CANCELED'::text])) OR ((decided_by IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT ck_areq_reject CHECK (((state <> 'REJECTED'::text) OR (char_length(btrim(COALESCE(decide_note, ''::text))) >= 2))),
    CONSTRAINT ck_areq_used CHECK (((state <> 'USED'::text) OR ((used_kind IS NOT NULL) AND (used_ref IS NOT NULL) AND (used_amount IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN id SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN requester SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN title SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN amount SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN account_role SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN reason SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN needed_on SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN state SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN decided_by SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN decided_at SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN decide_note SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN used_kind SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN used_ref SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN used_amount SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN used_by SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN used_at SET (pg_attver=164274016);
ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN created_at SET (pg_attver=164274016);



CREATE SEQUENCE public.acct_requisitions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_requisitions_id_seq OWNED BY public.acct_requisitions.id;



CREATE TABLE public.acct_rule_changes (
    id bigint NOT NULL,
    source text NOT NULL,
    slot text NOT NULL,
    before text,
    after text,
    reason text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_rule_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN id SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN source SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN slot SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN before SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN after SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN reason SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN actor_id SET (pg_attver=162668040);
ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN created_at SET (pg_attver=162668040);



CREATE SEQUENCE public.acct_rule_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_rule_changes_id_seq OWNED BY public.acct_rule_changes.id;



CREATE TABLE public.acct_rule_dept (
    source text NOT NULL,
    dept_id bigint NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_rule_dept_source_check CHECK ((source ~ '^[A-Z][A-Z_]{1,39}$'::text))
);
ALTER TABLE ONLY public.acct_rule_dept ALTER COLUMN source SET (pg_attver=165598960);
ALTER TABLE ONLY public.acct_rule_dept ALTER COLUMN dept_id SET (pg_attver=165598960);
ALTER TABLE ONLY public.acct_rule_dept ALTER COLUMN updated_by SET (pg_attver=165598960);
ALTER TABLE ONLY public.acct_rule_dept ALTER COLUMN updated_at SET (pg_attver=165598960);



CREATE TABLE public.acct_rule_evidence (
    source text NOT NULL,
    evidence text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_rule_evidence_evidence_check CHECK ((evidence = ANY (ARRAY['TAX_INVOICE'::text, 'CARD_PG'::text, 'CASH'::text, 'NONE'::text, 'CARD'::text, 'SIMPLE'::text]))),
    CONSTRAINT acct_rule_evidence_source_check CHECK ((source ~ '^[A-Z][A-Z_]{1,39}$'::text))
);
ALTER TABLE ONLY public.acct_rule_evidence ALTER COLUMN source SET (pg_attver=162642472);
ALTER TABLE ONLY public.acct_rule_evidence ALTER COLUMN evidence SET (pg_attver=162642472);
ALTER TABLE ONLY public.acct_rule_evidence ALTER COLUMN updated_by SET (pg_attver=162642472);
ALTER TABLE ONLY public.acct_rule_evidence ALTER COLUMN updated_at SET (pg_attver=162642472);



CREATE TABLE public.acct_rule_maps (
    source text NOT NULL,
    from_role text NOT NULL,
    to_role text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_rule_maps_source_check CHECK ((source ~ '^[A-Z][A-Z_]{1,39}$'::text))
);
ALTER TABLE ONLY public.acct_rule_maps ALTER COLUMN source SET (pg_attver=162609976);
ALTER TABLE ONLY public.acct_rule_maps ALTER COLUMN from_role SET (pg_attver=162609976);
ALTER TABLE ONLY public.acct_rule_maps ALTER COLUMN to_role SET (pg_attver=162609976);
ALTER TABLE ONLY public.acct_rule_maps ALTER COLUMN updated_by SET (pg_attver=162609976);
ALTER TABLE ONLY public.acct_rule_maps ALTER COLUMN updated_at SET (pg_attver=162609976);



CREATE TABLE public.acct_sales_doc_lines (
    id bigint NOT NULL,
    doc_id uuid NOT NULL,
    seq integer NOT NULL,
    item text NOT NULL,
    spec text,
    qty numeric(14,3) NOT NULL,
    unit text,
    unit_price bigint NOT NULL,
    supply bigint NOT NULL,
    vat bigint NOT NULL,
    tax_type text DEFAULT 'TAXABLE'::text NOT NULL,
    option_id uuid,
    CONSTRAINT acct_sales_doc_lines_item_check CHECK (((char_length(btrim(item)) >= 1) AND (char_length(btrim(item)) <= 120))),
    CONSTRAINT acct_sales_doc_lines_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT acct_sales_doc_lines_seq_check CHECK (((seq >= 1) AND (seq <= 100))),
    CONSTRAINT acct_sales_doc_lines_spec_check CHECK (((spec IS NULL) OR (char_length(spec) <= 80))),
    CONSTRAINT acct_sales_doc_lines_supply_check CHECK ((supply >= 0)),
    CONSTRAINT acct_sales_doc_lines_tax_type_check CHECK ((tax_type = ANY (ARRAY['TAXABLE'::text, 'EXEMPT'::text, 'ZERO'::text]))),
    CONSTRAINT acct_sales_doc_lines_unit_check CHECK (((unit IS NULL) OR (char_length(unit) <= 10))),
    CONSTRAINT acct_sales_doc_lines_unit_price_check CHECK ((unit_price >= 0)),
    CONSTRAINT acct_sales_doc_lines_vat_check CHECK ((vat >= 0))
);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN id SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN doc_id SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN seq SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN item SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN spec SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN qty SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN unit SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN unit_price SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN supply SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN vat SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN tax_type SET (pg_attver=165475384);
ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN option_id SET (pg_attver=165475384);



CREATE SEQUENCE public.acct_sales_doc_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_sales_doc_lines_id_seq OWNED BY public.acct_sales_doc_lines.id;



CREATE TABLE public.acct_sales_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    doc_no text NOT NULL,
    rev integer DEFAULT 1 NOT NULL,
    root_id uuid,
    prev_id uuid,
    parent_id uuid,
    party_id bigint NOT NULL,
    title text NOT NULL,
    issued_on date NOT NULL,
    valid_until date,
    due_on date,
    revenue_role text DEFAULT 'REV_SALES'::text NOT NULL,
    supply bigint NOT NULL,
    vat bigint NOT NULL,
    total bigint NOT NULL,
    memo text,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    superseded_by uuid,
    accepted_at timestamp with time zone,
    canceled_at timestamp with time zone,
    cancel_reason text,
    tax_invoice_id uuid,
    tax_invoice_no text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    exempt_invoice_id uuid,
    exempt_invoice_no text,
    CONSTRAINT acct_sales_docs_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (char_length(cancel_reason) <= 200))),
    CONSTRAINT acct_sales_docs_doc_no_check CHECK ((doc_no ~ '^[QOS]-[0-9]{4}-[0-9]{4,6}$'::text)),
    CONSTRAINT acct_sales_docs_kind_check CHECK ((kind = ANY (ARRAY['QUOTE'::text, 'ORDER'::text, 'STATEMENT'::text]))),
    CONSTRAINT acct_sales_docs_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT acct_sales_docs_rev_check CHECK (((rev >= 1) AND (rev <= 99))),
    CONSTRAINT acct_sales_docs_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'SENT'::text, 'ACCEPTED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_sales_docs_supply_check CHECK ((supply >= 0)),
    CONSTRAINT acct_sales_docs_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 120))),
    CONSTRAINT acct_sales_docs_vat_check CHECK ((vat >= 0)),
    CONSTRAINT ck_asd_accept CHECK (((state <> 'ACCEPTED'::text) OR (accepted_at IS NOT NULL))),
    CONSTRAINT ck_asd_cancel CHECK (((state <> 'CANCELED'::text) OR ((canceled_at IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_reason, ''::text))) >= 2)))),
    CONSTRAINT ck_asd_total CHECK ((total = (supply + vat)))
);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN id SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN kind SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN doc_no SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN rev SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN root_id SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN prev_id SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN parent_id SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN party_id SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN title SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN issued_on SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN valid_until SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN due_on SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN revenue_role SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN supply SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN vat SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN total SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN memo SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN state SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN superseded_by SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN accepted_at SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN canceled_at SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN cancel_reason SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN tax_invoice_id SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN tax_invoice_no SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN created_by SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN created_at SET (pg_attver=165389920);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN exempt_invoice_id SET (pg_attver=170116784);
ALTER TABLE ONLY public.acct_sales_docs ALTER COLUMN exempt_invoice_no SET (pg_attver=170117232);



CREATE TABLE public.acct_sales_targets (
    id bigint NOT NULL,
    ym text NOT NULL,
    axis text NOT NULL,
    dept_id bigint,
    owner_id uuid,
    amount bigint NOT NULL,
    memo text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_sales_targets_amount_check CHECK (((amount >= 0) AND (amount <= '1000000000000'::bigint))),
    CONSTRAINT acct_sales_targets_axis_check CHECK ((axis = ANY (ARRAY['TOTAL'::text, 'DEPT'::text, 'OWNER'::text]))),
    CONSTRAINT acct_sales_targets_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_sales_targets_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT ck_ast_axis CHECK ((((axis = 'TOTAL'::text) AND (dept_id IS NULL) AND (owner_id IS NULL)) OR ((axis = 'DEPT'::text) AND (dept_id IS NOT NULL) AND (owner_id IS NULL)) OR ((axis = 'OWNER'::text) AND (owner_id IS NOT NULL) AND (dept_id IS NULL))))
);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN id SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN ym SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN axis SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN dept_id SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN owner_id SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN amount SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN memo SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN updated_by SET (pg_attver=167850176);
ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN updated_at SET (pg_attver=167850176);



CREATE SEQUENCE public.acct_sales_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_sales_targets_id_seq OWNED BY public.acct_sales_targets.id;



CREATE TABLE public.acct_severance_runs (
    id bigint NOT NULL,
    ym text NOT NULL,
    estimate bigint NOT NULL,
    book_before bigint NOT NULL,
    diff bigint NOT NULL,
    detail jsonb DEFAULT '[]'::jsonb NOT NULL,
    entry_id bigint,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_severance_runs_estimate_check CHECK ((estimate >= 0)),
    CONSTRAINT acct_severance_runs_ym_check CHECK ((ym ~ '^\d{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN id SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN ym SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN estimate SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN book_before SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN diff SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN detail SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN entry_id SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN created_by SET (pg_attver=163960392);
ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN created_at SET (pg_attver=163960392);



CREATE SEQUENCE public.acct_severance_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_severance_runs_id_seq OWNED BY public.acct_severance_runs.id;



CREATE TABLE public.acct_source_tags (
    source text NOT NULL,
    source_key text NOT NULL,
    dept_id bigint,
    project_id bigint,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_source_tags_source_check CHECK ((source ~ '^[A-Z][A-Z_]{1,39}$'::text)),
    CONSTRAINT acct_source_tags_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 120))),
    CONSTRAINT ck_ast_any CHECK (((dept_id IS NOT NULL) OR (project_id IS NOT NULL)))
);
ALTER TABLE ONLY public.acct_source_tags ALTER COLUMN source SET (pg_attver=165627080);
ALTER TABLE ONLY public.acct_source_tags ALTER COLUMN source_key SET (pg_attver=165627080);
ALTER TABLE ONLY public.acct_source_tags ALTER COLUMN dept_id SET (pg_attver=165627080);
ALTER TABLE ONLY public.acct_source_tags ALTER COLUMN project_id SET (pg_attver=165627080);
ALTER TABLE ONLY public.acct_source_tags ALTER COLUMN updated_by SET (pg_attver=165627080);
ALTER TABLE ONLY public.acct_source_tags ALTER COLUMN updated_at SET (pg_attver=165627080);



CREATE TABLE public.acct_stock_moves (
    id bigint NOT NULL,
    option_id uuid NOT NULL,
    product_id uuid,
    moved_on date NOT NULL,
    kind text NOT NULL,
    qty integer NOT NULL,
    unit_cost numeric(14,2) DEFAULT 0 NOT NULL,
    amount bigint NOT NULL,
    qty_after integer NOT NULL,
    amount_after bigint NOT NULL,
    avg_cost_after numeric(14,2) DEFAULT 0 NOT NULL,
    zero_cost boolean DEFAULT false NOT NULL,
    source_key text NOT NULL,
    purchase_id bigint,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    warehouse_id bigint,
    CONSTRAINT acct_stock_moves_amount_after_check CHECK ((amount_after >= 0)),
    CONSTRAINT acct_stock_moves_kind_check CHECK ((kind = ANY (ARRAY['IN'::text, 'OUT_SALE'::text, 'RETURN'::text, 'ADJUST'::text, 'SUP_RETURN'::text]))),
    CONSTRAINT acct_stock_moves_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_stock_moves_qty_after_check CHECK ((qty_after >= 0)),
    CONSTRAINT acct_stock_moves_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 80))),
    CONSTRAINT acct_stock_moves_unit_cost_check CHECK ((unit_cost >= (0)::numeric)),
    CONSTRAINT ck_asm_adjust_note CHECK (((kind <> 'ADJUST'::text) OR (char_length(COALESCE(note, ''::text)) >= 2))),
    CONSTRAINT ck_asm_sign CHECK ((((kind = ANY (ARRAY['IN'::text, 'RETURN'::text])) AND (qty > 0)) OR ((kind = ANY (ARRAY['OUT_SALE'::text, 'SUP_RETURN'::text])) AND (qty < 0)) OR ((kind = 'ADJUST'::text) AND (qty <> 0))))
);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN id SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN option_id SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN product_id SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN moved_on SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN kind SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN qty SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN unit_cost SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN amount SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN qty_after SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN amount_after SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN avg_cost_after SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN zero_cost SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN source_key SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN purchase_id SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN note SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN created_by SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN created_at SET (pg_attver=163076264);
ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN warehouse_id SET (pg_attver=165768528);



CREATE SEQUENCE public.acct_stock_moves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_stock_moves_id_seq OWNED BY public.acct_stock_moves.id;



CREATE TABLE public.acct_stock_rules (
    option_id uuid NOT NULL,
    min_qty integer NOT NULL,
    reorder_qty integer NOT NULL,
    party_id bigint,
    unit_price bigint,
    active boolean DEFAULT true NOT NULL,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_stock_rules_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_stock_rules_min_qty_check CHECK (((min_qty >= 0) AND (min_qty <= 1000000))),
    CONSTRAINT acct_stock_rules_reorder_qty_check CHECK (((reorder_qty >= 1) AND (reorder_qty <= 1000000))),
    CONSTRAINT acct_stock_rules_unit_price_check CHECK (((unit_price IS NULL) OR ((unit_price >= 0) AND (unit_price <= '10000000000'::bigint))))
);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN option_id SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN min_qty SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN reorder_qty SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN party_id SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN unit_price SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN active SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN memo SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN created_by SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN created_at SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN updated_by SET (pg_attver=170127616);
ALTER TABLE ONLY public.acct_stock_rules ALTER COLUMN updated_at SET (pg_attver=170127616);



CREATE TABLE public.acct_stock_transfers (
    id bigint NOT NULL,
    option_id uuid NOT NULL,
    from_wh bigint NOT NULL,
    to_wh bigint NOT NULL,
    qty integer NOT NULL,
    moved_on date NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_stock_transfers_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_stock_transfers_qty_check CHECK ((qty > 0)),
    CONSTRAINT ck_ast_wh CHECK ((from_wh <> to_wh))
);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN id SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN option_id SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN from_wh SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN to_wh SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN qty SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN moved_on SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN note SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN created_by SET (pg_attver=165778424);
ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN created_at SET (pg_attver=165778424);



CREATE SEQUENCE public.acct_stock_transfers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_stock_transfers_id_seq OWNED BY public.acct_stock_transfers.id;



CREATE TABLE public.acct_tag_changes (
    id bigint NOT NULL,
    target text NOT NULL,
    target_key text NOT NULL,
    before jsonb,
    after jsonb,
    reason text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_tag_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200))),
    CONSTRAINT acct_tag_changes_target_check CHECK ((target = ANY (ARRAY['ENTRY'::text, 'SOURCE'::text, 'RULE'::text])))
);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN id SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN target SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN target_key SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN before SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN after SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN reason SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN actor_id SET (pg_attver=165694696);
ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN created_at SET (pg_attver=165694696);



CREATE SEQUENCE public.acct_tag_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_tag_changes_id_seq OWNED BY public.acct_tag_changes.id;



CREATE TABLE public.acct_target_changes (
    id bigint NOT NULL,
    ym text NOT NULL,
    axis text NOT NULL,
    target_key text NOT NULL,
    before bigint,
    after bigint NOT NULL,
    reason text NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_target_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN id SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN ym SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN axis SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN target_key SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN before SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN after SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN reason SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN changed_by SET (pg_attver=167901456);
ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN changed_at SET (pg_attver=167901456);



CREATE SEQUENCE public.acct_target_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_target_changes_id_seq OWNED BY public.acct_target_changes.id;



CREATE TABLE public.acct_tax_inbox (
    id bigint NOT NULL,
    approval_no text NOT NULL,
    issued_on date NOT NULL,
    supplier_biz_no text,
    supplier_name text NOT NULL,
    item text NOT NULL,
    supply bigint NOT NULL,
    vat bigint NOT NULL,
    exempt boolean DEFAULT false NOT NULL,
    source text NOT NULL,
    provider text NOT NULL,
    row_hash text NOT NULL,
    state text DEFAULT 'NEW'::text NOT NULL,
    purchase_id bigint,
    ignore_note text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_tax_inbox_approval_no_check CHECK ((approval_no ~ '^[0-9]{24}$'::text)),
    CONSTRAINT acct_tax_inbox_ignore_note_check CHECK (((ignore_note IS NULL) OR ((char_length(btrim(ignore_note)) >= 2) AND (char_length(btrim(ignore_note)) <= 200)))),
    CONSTRAINT acct_tax_inbox_item_check CHECK (((char_length(item) >= 1) AND (char_length(item) <= 120))),
    CONSTRAINT acct_tax_inbox_provider_check CHECK ((provider = ANY (ARRAY['GENERIC'::text, 'POPBILL'::text, 'BAROBILL'::text]))),
    CONSTRAINT acct_tax_inbox_row_hash_check CHECK ((row_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT acct_tax_inbox_source_check CHECK ((source = ANY (ARRAY['ASSUME'::text, 'PROVIDER'::text]))),
    CONSTRAINT acct_tax_inbox_state_check CHECK ((state = ANY (ARRAY['NEW'::text, 'BOOKED'::text, 'IGNORED'::text]))),
    CONSTRAINT acct_tax_inbox_supplier_biz_no_check CHECK (((supplier_biz_no IS NULL) OR (supplier_biz_no ~ '^[0-9]{10}$'::text))),
    CONSTRAINT acct_tax_inbox_supplier_name_check CHECK (((char_length(supplier_name) >= 1) AND (char_length(supplier_name) <= 120))),
    CONSTRAINT acct_tax_inbox_supply_check CHECK ((supply >= 0)),
    CONSTRAINT acct_tax_inbox_vat_check CHECK ((vat >= 0)),
    CONSTRAINT ck_ati_state CHECK ((((state = 'NEW'::text) AND (purchase_id IS NULL) AND (ignore_note IS NULL)) OR ((state = 'BOOKED'::text) AND (purchase_id IS NOT NULL)) OR ((state = 'IGNORED'::text) AND (ignore_note IS NOT NULL) AND (purchase_id IS NULL))))
);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN id SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN approval_no SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN issued_on SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN supplier_biz_no SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN supplier_name SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN item SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN supply SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN vat SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN exempt SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN source SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN provider SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN row_hash SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN state SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN purchase_id SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN ignore_note SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN decided_by SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN decided_at SET (pg_attver=165243280);
ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN created_at SET (pg_attver=165243280);



CREATE TABLE public.acct_tax_inbox_fetches (
    id bigint NOT NULL,
    from_on date NOT NULL,
    to_on date NOT NULL,
    mode text NOT NULL,
    provider text NOT NULL,
    got integer DEFAULT 0 NOT NULL,
    added integer DEFAULT 0 NOT NULL,
    dup integer DEFAULT 0 NOT NULL,
    skipped integer DEFAULT 0 NOT NULL,
    error text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_tax_inbox_fetches_added_check CHECK ((added >= 0)),
    CONSTRAINT acct_tax_inbox_fetches_check CHECK ((to_on >= from_on)),
    CONSTRAINT acct_tax_inbox_fetches_dup_check CHECK ((dup >= 0)),
    CONSTRAINT acct_tax_inbox_fetches_error_check CHECK (((error IS NULL) OR (char_length(error) <= 200))),
    CONSTRAINT acct_tax_inbox_fetches_got_check CHECK ((got >= 0)),
    CONSTRAINT acct_tax_inbox_fetches_mode_check CHECK ((mode = ANY (ARRAY['ASSUME'::text, 'LIVE'::text]))),
    CONSTRAINT acct_tax_inbox_fetches_provider_check CHECK ((provider = ANY (ARRAY['GENERIC'::text, 'POPBILL'::text, 'BAROBILL'::text]))),
    CONSTRAINT acct_tax_inbox_fetches_skipped_check CHECK ((skipped >= 0))
);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN id SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN from_on SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN to_on SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN mode SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN provider SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN got SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN added SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN dup SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN skipped SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN error SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN created_by SET (pg_attver=165311544);
ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN created_at SET (pg_attver=165311544);



CREATE SEQUENCE public.acct_tax_inbox_fetches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_tax_inbox_fetches_id_seq OWNED BY public.acct_tax_inbox_fetches.id;



CREATE SEQUENCE public.acct_tax_inbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_tax_inbox_id_seq OWNED BY public.acct_tax_inbox.id;



CREATE TABLE public.acct_tax_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    source_id uuid NOT NULL,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    supply bigint NOT NULL,
    vat bigint NOT NULL,
    total bigint NOT NULL,
    buyer_name text NOT NULL,
    buyer_biz_no text,
    item text NOT NULL,
    invoice_no text,
    issued_on date,
    issued_by uuid,
    requested_by uuid,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    etax_mode text,
    etax_status text,
    etax_doc_key text,
    etax_approval_no text,
    etax_amend_approval_no text,
    etax_error text,
    etax_attempts integer DEFAULT 0 NOT NULL,
    etax_adapter text,
    etax_sent_at timestamp with time zone,
    etax_result_at timestamp with time zone,
    CONSTRAINT acct_tax_invoices_buyer_biz_no_check CHECK (((buyer_biz_no IS NULL) OR (buyer_biz_no ~ '^[0-9]{3}-[0-9]{2}-[0-9]{5}$'::text))),
    CONSTRAINT acct_tax_invoices_buyer_name_check CHECK (((char_length(btrim(buyer_name)) >= 1) AND (char_length(btrim(buyer_name)) <= 120))),
    CONSTRAINT acct_tax_invoices_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (char_length(cancel_reason) <= 200))),
    CONSTRAINT acct_tax_invoices_item_check CHECK (((char_length(item) >= 1) AND (char_length(item) <= 100))),
    CONSTRAINT acct_tax_invoices_kind_check CHECK ((kind = ANY (ARRAY['AD'::text, 'COMMISSION'::text, 'SALES_DOC'::text, 'EXEMPT'::text]))),
    CONSTRAINT acct_tax_invoices_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'ISSUED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_tax_invoices_supply_check CHECK ((supply > 0)),
    CONSTRAINT acct_tax_invoices_vat_check CHECK ((vat >= 0)),
    CONSTRAINT ck_acct_tax_invoices_etax CHECK ((((etax_mode IS NULL) OR (etax_mode = ANY (ARRAY['MANUAL'::text, 'ASSUMED'::text, 'ASP'::text]))) AND ((etax_status IS NULL) OR (etax_status = ANY (ARRAY['ASSUMED'::text, 'SENDING'::text, 'SENT'::text, 'FAILED'::text, 'CANCELED'::text]))) AND ((etax_adapter IS NULL) OR (etax_adapter = ANY (ARRAY['assume'::text, 'http'::text]))) AND ((etax_approval_no IS NULL) OR (etax_approval_no ~ '^[0-9]{24}$'::text)) AND ((etax_amend_approval_no IS NULL) OR (etax_amend_approval_no ~ '^[0-9]{24}$'::text)) AND ((etax_status IS DISTINCT FROM 'SENT'::text) OR (etax_approval_no IS NOT NULL)) AND ((etax_status IS DISTINCT FROM 'ASSUMED'::text) OR ((etax_approval_no IS NULL) AND (etax_mode = 'ASSUMED'::text))) AND ((etax_mode IS DISTINCT FROM 'MANUAL'::text) OR (etax_status IS NULL)) AND ((etax_status IS NULL) OR (etax_doc_key IS NOT NULL)) AND (etax_attempts >= 0))),
    CONSTRAINT ck_ati_exempt_vat CHECK (((kind <> 'EXEMPT'::text) OR (vat = 0))),
    CONSTRAINT ck_ati_issued CHECK (((state <> 'ISSUED'::text) OR ((invoice_no IS NOT NULL) AND (issued_on IS NOT NULL)))),
    CONSTRAINT ck_ati_total CHECK ((total = (supply + vat)))
);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN id SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN kind SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN source_id SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN state SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN supply SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN vat SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN total SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN buyer_name SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN buyer_biz_no SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN item SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN invoice_no SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN issued_on SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN issued_by SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN requested_by SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN cancel_reason SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN created_at SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_mode SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_status SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_doc_key SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_approval_no SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_amend_approval_no SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_error SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_attempts SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_adapter SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_sent_at SET (pg_attver=162506376);
ALTER TABLE ONLY public.acct_tax_invoices ALTER COLUMN etax_result_at SET (pg_attver=162506376);



CREATE TABLE public.acct_transfer_approvals (
    batch_id bigint NOT NULL,
    approver uuid NOT NULL,
    note text,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_transfer_approvals_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);
ALTER TABLE ONLY public.acct_transfer_approvals ALTER COLUMN batch_id SET (pg_attver=167804848);
ALTER TABLE ONLY public.acct_transfer_approvals ALTER COLUMN approver SET (pg_attver=167804848);
ALTER TABLE ONLY public.acct_transfer_approvals ALTER COLUMN note SET (pg_attver=167804848);
ALTER TABLE ONLY public.acct_transfer_approvals ALTER COLUMN approved_at SET (pg_attver=167804848);



CREATE TABLE public.acct_transfer_batches (
    id bigint NOT NULL,
    title text NOT NULL,
    pay_on date NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    mode text,
    item_count integer DEFAULT 0 NOT NULL,
    total bigint DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    sent_by uuid,
    sent_at timestamp with time zone,
    canceled_at timestamp with time zone,
    cancel_note text,
    CONSTRAINT acct_transfer_batches_cancel_note_check CHECK (((cancel_note IS NULL) OR (char_length(cancel_note) <= 200))),
    CONSTRAINT acct_transfer_batches_item_count_check CHECK (((item_count >= 0) AND (item_count <= 200))),
    CONSTRAINT acct_transfer_batches_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['ASSUME'::text, 'LIVE'::text])))),
    CONSTRAINT acct_transfer_batches_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'CHECKING'::text, 'SENT'::text, 'PARTIAL'::text, 'FAILED'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_transfer_batches_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 80))),
    CONSTRAINT acct_transfer_batches_total_check CHECK ((total >= 0)),
    CONSTRAINT ck_atb_approved CHECK (((state <> 'APPROVED'::text) OR (approved_at IS NOT NULL))),
    CONSTRAINT ck_atb_cancel CHECK (((state <> 'CANCELED'::text) OR ((canceled_at IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2)))),
    CONSTRAINT ck_atb_sent CHECK (((state <> ALL (ARRAY['CHECKING'::text, 'SENT'::text, 'PARTIAL'::text, 'FAILED'::text])) OR ((sent_at IS NOT NULL) AND (mode IS NOT NULL) AND (approved_at IS NOT NULL))))
);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN id SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN title SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN pay_on SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN state SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN mode SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN item_count SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN total SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN created_by SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN created_at SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN approved_at SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN sent_by SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN sent_at SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN canceled_at SET (pg_attver=167668760);
ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN cancel_note SET (pg_attver=167668760);



CREATE SEQUENCE public.acct_transfer_batches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_transfer_batches_id_seq OWNED BY public.acct_transfer_batches.id;



CREATE TABLE public.acct_transfer_items (
    id bigint NOT NULL,
    batch_id bigint NOT NULL,
    party_id bigint,
    payee text NOT NULL,
    bank_code text NOT NULL,
    acct_no_enc bytea NOT NULL,
    acct_last4 text NOT NULL,
    amount bigint NOT NULL,
    pay_role text DEFAULT 'AP'::text NOT NULL,
    memo text,
    result text,
    bank_tran_id text,
    bank_rsp_code text,
    result_code text,
    result_msg text,
    bank_tx_id text,
    done_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_transfer_items_acct_last4_check CHECK ((acct_last4 ~ '^[0-9]{4}$'::text)),
    CONSTRAINT acct_transfer_items_amount_check CHECK (((amount >= 1) AND (amount <= 1000000000))),
    CONSTRAINT acct_transfer_items_bank_code_check CHECK ((bank_code ~ '^[0-9]{3}$'::text)),
    CONSTRAINT acct_transfer_items_bank_rsp_code_check CHECK (((bank_rsp_code IS NULL) OR (char_length(bank_rsp_code) <= 10))),
    CONSTRAINT acct_transfer_items_bank_tran_id_check CHECK (((bank_tran_id IS NULL) OR (bank_tran_id ~ '^[A-Za-z0-9]{10}U[0-9]{9}$'::text))),
    CONSTRAINT acct_transfer_items_bank_tx_id_check CHECK (((bank_tx_id IS NULL) OR (char_length(bank_tx_id) <= 60))),
    CONSTRAINT acct_transfer_items_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 20))),
    CONSTRAINT acct_transfer_items_payee_check CHECK (((char_length(btrim(payee)) >= 1) AND (char_length(btrim(payee)) <= 40))),
    CONSTRAINT acct_transfer_items_result_check CHECK (((result IS NULL) OR (result = ANY (ARRAY['OK'::text, 'FAIL'::text, 'ASSUMED'::text, 'HOLD'::text, 'PENDING'::text])))),
    CONSTRAINT acct_transfer_items_result_code_check CHECK (((result_code IS NULL) OR (char_length(result_code) <= 40))),
    CONSTRAINT acct_transfer_items_result_msg_check CHECK (((result_msg IS NULL) OR (char_length(result_msg) <= 200))),
    CONSTRAINT ck_ati_done CHECK (((result IS NULL) = (done_at IS NULL)))
);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN id SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN batch_id SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN party_id SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN payee SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN bank_code SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN acct_no_enc SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN acct_last4 SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN amount SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN pay_role SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN memo SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN result SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN bank_tran_id SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN bank_rsp_code SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN result_code SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN result_msg SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN bank_tx_id SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN done_at SET (pg_attver=167739520);
ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN created_at SET (pg_attver=167739520);



CREATE SEQUENCE public.acct_transfer_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_transfer_items_id_seq OWNED BY public.acct_transfer_items.id;



CREATE TABLE public.acct_vehicle_costs (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    cost_on date NOT NULL,
    kind text NOT NULL,
    amount bigint NOT NULL,
    liters numeric(8,2),
    purchase_id bigint,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    cancel_note text,
    canceled_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_vehicle_costs_amount_check CHECK (((amount >= 1) AND (amount <= '10000000000'::bigint))),
    CONSTRAINT acct_vehicle_costs_kind_check CHECK ((kind = ANY (ARRAY['FUEL'::text, 'REPAIR'::text, 'INSURANCE'::text, 'TAX'::text, 'LEASE'::text, 'DEPRECIATION'::text, 'TOLL'::text, 'OTHER'::text]))),
    CONSTRAINT acct_vehicle_costs_liters_check CHECK (((liters IS NULL) OR ((liters > (0)::numeric) AND (liters <= (10000)::numeric)))),
    CONSTRAINT acct_vehicle_costs_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_vehicle_costs_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CANCELED'::text]))),
    CONSTRAINT ck_acct_vcost_cancel CHECK ((((state = 'ACTIVE'::text) AND (canceled_at IS NULL)) OR ((state = 'CANCELED'::text) AND (canceled_at IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2))))
);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN id SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN vehicle_id SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN cost_on SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN kind SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN amount SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN liters SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN purchase_id SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN memo SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN state SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN cancel_note SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN canceled_at SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN created_by SET (pg_attver=170048008);
ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN created_at SET (pg_attver=170048008);



CREATE SEQUENCE public.acct_vehicle_costs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_vehicle_costs_id_seq OWNED BY public.acct_vehicle_costs.id;



CREATE TABLE public.acct_vehicle_trips (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    trip_on date NOT NULL,
    driver text NOT NULL,
    dept text,
    purpose text NOT NULL,
    from_place text,
    to_place text,
    odo_start integer NOT NULL,
    odo_end integer NOT NULL,
    distance integer GENERATED ALWAYS AS ((odo_end - odo_start)) STORED,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    cancel_note text,
    canceled_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_vehicle_trips_dept_check CHECK (((dept IS NULL) OR (char_length(dept) <= 40))),
    CONSTRAINT acct_vehicle_trips_driver_check CHECK (((char_length(btrim(driver)) >= 1) AND (char_length(btrim(driver)) <= 40))),
    CONSTRAINT acct_vehicle_trips_from_place_check CHECK (((from_place IS NULL) OR (char_length(from_place) <= 60))),
    CONSTRAINT acct_vehicle_trips_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_vehicle_trips_odo_end_check CHECK (((odo_end >= 0) AND (odo_end <= 9999999))),
    CONSTRAINT acct_vehicle_trips_odo_start_check CHECK (((odo_start >= 0) AND (odo_start <= 9999999))),
    CONSTRAINT acct_vehicle_trips_purpose_check CHECK ((purpose = ANY (ARRAY['COMMUTE'::text, 'BUSINESS'::text, 'PERSONAL'::text]))),
    CONSTRAINT acct_vehicle_trips_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CANCELED'::text]))),
    CONSTRAINT acct_vehicle_trips_to_place_check CHECK (((to_place IS NULL) OR (char_length(to_place) <= 60))),
    CONSTRAINT ck_acct_vtrip_cancel CHECK ((((state = 'ACTIVE'::text) AND (canceled_at IS NULL)) OR ((state = 'CANCELED'::text) AND (canceled_at IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2)))),
    CONSTRAINT ck_acct_vtrip_odo CHECK (((odo_end > odo_start) AND ((odo_end - odo_start) <= 3000)))
);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN id SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN vehicle_id SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN trip_on SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN driver SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN dept SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN purpose SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN from_place SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN to_place SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN odo_start SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN odo_end SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN distance SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN memo SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN state SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN cancel_note SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN canceled_at SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN created_by SET (pg_attver=169988080);
ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN created_at SET (pg_attver=169988080);



CREATE SEQUENCE public.acct_vehicle_trips_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_vehicle_trips_id_seq OWNED BY public.acct_vehicle_trips.id;



CREATE TABLE public.acct_vehicles (
    id bigint NOT NULL,
    plate text NOT NULL,
    name text NOT NULL,
    car_class text DEFAULT 'PASSENGER'::text NOT NULL,
    ownership text DEFAULT 'OWNED'::text NOT NULL,
    acquired_on date NOT NULL,
    disposed_on date,
    acquire_cost bigint DEFAULT 0 NOT NULL,
    biz_insurance boolean DEFAULT false NOT NULL,
    insurance_until date,
    active boolean DEFAULT true NOT NULL,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_vehicles_acquire_cost_check CHECK (((acquire_cost >= 0) AND (acquire_cost <= '10000000000'::bigint))),
    CONSTRAINT acct_vehicles_car_class_check CHECK ((car_class = ANY (ARRAY['PASSENGER'::text, 'EXCLUDED'::text]))),
    CONSTRAINT acct_vehicles_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT acct_vehicles_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
    CONSTRAINT acct_vehicles_ownership_check CHECK ((ownership = ANY (ARRAY['OWNED'::text, 'LEASE'::text, 'RENT'::text]))),
    CONSTRAINT acct_vehicles_plate_check CHECK ((plate ~ '^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$'::text)),
    CONSTRAINT ck_acct_vehicle_dispose CHECK (((disposed_on IS NULL) OR (disposed_on >= acquired_on)))
);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN id SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN plate SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN name SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN car_class SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN ownership SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN acquired_on SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN disposed_on SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN acquire_cost SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN biz_insurance SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN insurance_until SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN active SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN memo SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN created_by SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN created_at SET (pg_attver=169939088);
ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN updated_at SET (pg_attver=169939088);



CREATE SEQUENCE public.acct_vehicles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_vehicles_id_seq OWNED BY public.acct_vehicles.id;



CREATE TABLE public.acct_warehouses (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    address text,
    is_main boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_warehouses_address_check CHECK (((address IS NULL) OR (char_length(address) <= 200))),
    CONSTRAINT acct_warehouses_code_check CHECK ((code ~ '^[A-Z0-9_-]{2,20}$'::text)),
    CONSTRAINT acct_warehouses_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 60)))
);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN id SET (pg_attver=165738000);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN code SET (pg_attver=165738000);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN name SET (pg_attver=165738000);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN address SET (pg_attver=165738000);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN is_main SET (pg_attver=165738000);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN active SET (pg_attver=165738000);
ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN created_at SET (pg_attver=165738000);



CREATE SEQUENCE public.acct_warehouses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_warehouses_id_seq OWNED BY public.acct_warehouses.id;



CREATE TABLE public.acct_wht_table (
    year integer NOT NULL,
    wage_from bigint NOT NULL,
    wage_to bigint NOT NULL,
    dependents integer NOT NULL,
    tax bigint NOT NULL,
    CONSTRAINT acct_wht_table_dependents_check CHECK (((dependents >= 1) AND (dependents <= 11))),
    CONSTRAINT acct_wht_table_tax_check CHECK ((tax >= 0)),
    CONSTRAINT acct_wht_table_wage_from_check CHECK ((wage_from >= 0)),
    CONSTRAINT acct_wht_table_year_check CHECK (((year >= 2000) AND (year <= 2100))),
    CONSTRAINT ck_awt_range CHECK ((wage_to > wage_from))
);
ALTER TABLE ONLY public.acct_wht_table ALTER COLUMN year SET (pg_attver=163722920);
ALTER TABLE ONLY public.acct_wht_table ALTER COLUMN wage_from SET (pg_attver=163722920);
ALTER TABLE ONLY public.acct_wht_table ALTER COLUMN wage_to SET (pg_attver=163722920);
ALTER TABLE ONLY public.acct_wht_table ALTER COLUMN dependents SET (pg_attver=163722920);
ALTER TABLE ONLY public.acct_wht_table ALTER COLUMN tax SET (pg_attver=163722920);



CREATE TABLE public.acct_year_closings (
    id bigint NOT NULL,
    year integer NOT NULL,
    action text NOT NULL,
    net_income bigint,
    revenue bigint,
    expense bigint,
    entry_id bigint,
    reason text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT acct_year_closings_action_check CHECK ((action = ANY (ARRAY['CLOSE'::text, 'REOPEN'::text]))),
    CONSTRAINT acct_year_closings_reason_check CHECK (((reason IS NULL) OR ((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))),
    CONSTRAINT acct_year_closings_year_check CHECK (((year >= 2000) AND (year <= 2100))),
    CONSTRAINT ck_ayc_reopen_reason CHECK (((action <> 'REOPEN'::text) OR (reason IS NOT NULL)))
);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN id SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN year SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN action SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN net_income SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN revenue SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN expense SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN entry_id SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN reason SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN actor_id SET (pg_attver=163483688);
ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN created_at SET (pg_attver=163483688);



CREATE SEQUENCE public.acct_year_closings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_year_closings_id_seq OWNED BY public.acct_year_closings.id;



CREATE TABLE public.acct_yearend_checks (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    year integer NOT NULL,
    item text NOT NULL,
    done boolean NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acct_yearend_checks_item_check CHECK ((item = ANY (ARRAY['SIMPLE_PDF'::text, 'DEDUCTION_FORM'::text, 'DEPENDENT'::text, 'PREV_JOB'::text, 'OTHER'::text]))),
    CONSTRAINT acct_yearend_checks_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT acct_yearend_checks_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN id SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN employee_id SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN year SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN item SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN done SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN note SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN created_by SET (pg_attver=167400584);
ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN created_at SET (pg_attver=167400584);



CREATE SEQUENCE public.acct_yearend_checks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.acct_yearend_checks_id_seq OWNED BY public.acct_yearend_checks.id;



CREATE TABLE public.corp_doc_versions (
    id bigint NOT NULL,
    doc_id bigint NOT NULL,
    version_no integer NOT NULL,
    file_id uuid NOT NULL,
    issued_on date,
    expires_on date,
    note text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_cdv_dates CHECK (((expires_on IS NULL) OR (issued_on IS NULL) OR (expires_on >= issued_on))),
    CONSTRAINT corp_doc_versions_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT corp_doc_versions_version_no_check CHECK ((version_no >= 1))
);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN id SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN doc_id SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN version_no SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN file_id SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN issued_on SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN expires_on SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN note SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN uploaded_by SET (pg_attver=164922744);
ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN created_at SET (pg_attver=164922744);



CREATE SEQUENCE public.corp_doc_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.corp_doc_versions_id_seq OWNED BY public.corp_doc_versions.id;



CREATE TABLE public.corp_docs (
    id bigint NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    archived_at timestamp with time zone,
    archive_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_cd_archived CHECK ((((state = 'ACTIVE'::text) AND (archived_at IS NULL)) OR ((state = 'ARCHIVED'::text) AND (archived_at IS NOT NULL) AND (archive_reason IS NOT NULL)))),
    CONSTRAINT corp_docs_archive_reason_check CHECK (((archive_reason IS NULL) OR ((char_length(btrim(archive_reason)) >= 2) AND (char_length(btrim(archive_reason)) <= 200)))),
    CONSTRAINT corp_docs_category_check CHECK ((category = ANY (ARRAY['ARTICLES'::text, 'REGISTRY'::text, 'SEAL'::text, 'BIZ_REG'::text, 'RULES'::text, 'CERT'::text, 'ETC'::text]))),
    CONSTRAINT corp_docs_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT corp_docs_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'ARCHIVED'::text]))),
    CONSTRAINT corp_docs_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN id SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN category SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN title SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN memo SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN state SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN archived_at SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN archive_reason SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN created_by SET (pg_attver=164873224);
ALTER TABLE ONLY public.corp_docs ALTER COLUMN created_at SET (pg_attver=164873224);



CREATE SEQUENCE public.corp_docs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.corp_docs_id_seq OWNED BY public.corp_docs.id;



CREATE TABLE public.hr_applicant_purges (
    id bigint NOT NULL,
    applicant_id bigint NOT NULL,
    posting_id bigint NOT NULL,
    stage text NOT NULL,
    files integer NOT NULL,
    reason text NOT NULL,
    purged_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_applicant_purges_files_check CHECK ((files >= 0)),
    CONSTRAINT hr_applicant_purges_reason_check CHECK ((reason = ANY (ARRAY['RETENTION'::text, 'MANUAL'::text])))
);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN id SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN applicant_id SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN posting_id SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN stage SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN files SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN reason SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN purged_by SET (pg_attver=168536800);
ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN created_at SET (pg_attver=168536800);



CREATE SEQUENCE public.hr_applicant_purges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_applicant_purges_id_seq OWNED BY public.hr_applicant_purges.id;



CREATE TABLE public.hr_applicants (
    id bigint NOT NULL,
    posting_id bigint NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    source text DEFAULT 'DIRECT'::text NOT NULL,
    memo text,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    stage text DEFAULT 'APPLIED'::text NOT NULL,
    decided_at timestamp with time zone,
    decide_note text,
    employee_id bigint,
    purge_due_on date,
    purged_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hap_contact CHECK (((purged_at IS NOT NULL) OR (email IS NOT NULL) OR (phone IS NOT NULL))),
    CONSTRAINT ck_hap_hired CHECK (((stage = 'HIRED'::text) = (employee_id IS NOT NULL))),
    CONSTRAINT ck_hap_purge_due CHECK (((stage <> ALL (ARRAY['REJECTED'::text, 'WITHDRAWN'::text])) OR (purge_due_on IS NOT NULL))),
    CONSTRAINT ck_hap_purged CHECK (((purged_at IS NULL) OR ((name = '(파기됨)'::text) AND (email IS NULL) AND (phone IS NULL) AND (memo IS NULL) AND (decide_note IS NULL) AND (cardinality(file_ids) = 0)))),
    CONSTRAINT hr_applicants_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 200))),
    CONSTRAINT hr_applicants_email_check CHECK (((email IS NULL) OR ((char_length(email) <= 200) AND (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)))),
    CONSTRAINT hr_applicants_file_ids_check CHECK ((cardinality(file_ids) <= 3)),
    CONSTRAINT hr_applicants_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 500))),
    CONSTRAINT hr_applicants_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
    CONSTRAINT hr_applicants_phone_check CHECK (((phone IS NULL) OR (phone ~ '^[0-9]{9,11}$'::text))),
    CONSTRAINT hr_applicants_source_check CHECK ((source = ANY (ARRAY['DIRECT'::text, 'JOBSITE'::text, 'REFERRAL'::text, 'ETC'::text]))),
    CONSTRAINT hr_applicants_stage_check CHECK ((stage = ANY (ARRAY['APPLIED'::text, 'SCREEN'::text, 'INTERVIEW'::text, 'OFFER'::text, 'HIRED'::text, 'REJECTED'::text, 'WITHDRAWN'::text])))
);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN id SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN posting_id SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN name SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN email SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN phone SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN source SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN memo SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN file_ids SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN stage SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN decided_at SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN decide_note SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN employee_id SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN purge_due_on SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN purged_at SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN created_by SET (pg_attver=168420896);
ALTER TABLE ONLY public.hr_applicants ALTER COLUMN created_at SET (pg_attver=168420896);



CREATE SEQUENCE public.hr_applicants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_applicants_id_seq OWNED BY public.hr_applicants.id;



CREATE TABLE public.hr_contract_templates (
    id bigint NOT NULL,
    code text NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'REGULAR'::text NOT NULL,
    body text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_contract_templates_body_check CHECK (((char_length(body) >= 20) AND (char_length(body) <= 20000))),
    CONSTRAINT hr_contract_templates_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,30}$'::text)),
    CONSTRAINT hr_contract_templates_kind_check CHECK ((kind = ANY (ARRAY['REGULAR'::text, 'FIXED_TERM'::text, 'PART_TIME'::text]))),
    CONSTRAINT hr_contract_templates_name_check CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 60))),
    CONSTRAINT hr_contract_templates_version_check CHECK ((version >= 1))
);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN id SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN code SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN version SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN name SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN kind SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN body SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN active SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN created_by SET (pg_attver=168097224);
ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN created_at SET (pg_attver=168097224);



CREATE SEQUENCE public.hr_contract_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_contract_templates_id_seq OWNED BY public.hr_contract_templates.id;



CREATE TABLE public.hr_contracts (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    template_id bigint NOT NULL,
    title text NOT NULL,
    terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    body text NOT NULL,
    doc_hash text NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    sign_mode text,
    vendor_doc_id text,
    sign_url text,
    sent_by uuid,
    sent_at timestamp with time zone,
    signer_name text,
    signed_at timestamp with time zone,
    sign_evidence jsonb,
    canceled_at timestamp with time zone,
    cancel_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hrc_canceled CHECK (((state <> 'CANCELED'::text) OR ((canceled_at IS NOT NULL) AND (cancel_reason IS NOT NULL)))),
    CONSTRAINT ck_hrc_sent CHECK (((state = 'DRAFT'::text) OR (state = 'CANCELED'::text) OR ((sent_at IS NOT NULL) AND (sign_mode IS NOT NULL)))),
    CONSTRAINT ck_hrc_signed CHECK (((state <> 'SIGNED'::text) OR ((signed_at IS NOT NULL) AND (signer_name IS NOT NULL)))),
    CONSTRAINT hr_contracts_body_check CHECK (((char_length(body) >= 20) AND (char_length(body) <= 30000))),
    CONSTRAINT hr_contracts_cancel_reason_check CHECK (((cancel_reason IS NULL) OR ((char_length(btrim(cancel_reason)) >= 2) AND (char_length(btrim(cancel_reason)) <= 200)))),
    CONSTRAINT hr_contracts_doc_hash_check CHECK ((doc_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hr_contracts_sign_mode_check CHECK (((sign_mode IS NULL) OR (sign_mode = ANY (ARRAY['ASSUME'::text, 'STUB'::text, 'MOCK'::text, 'HTTP'::text])))),
    CONSTRAINT hr_contracts_sign_url_check CHECK (((sign_url IS NULL) OR (char_length(sign_url) <= 1000))),
    CONSTRAINT hr_contracts_signer_name_check CHECK (((signer_name IS NULL) OR ((char_length(btrim(signer_name)) >= 1) AND (char_length(btrim(signer_name)) <= 40)))),
    CONSTRAINT hr_contracts_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'SENT'::text, 'SIGNED'::text, 'CANCELED'::text]))),
    CONSTRAINT hr_contracts_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100))),
    CONSTRAINT hr_contracts_vendor_doc_id_check CHECK (((vendor_doc_id IS NULL) OR (char_length(vendor_doc_id) <= 200)))
);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN id SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN employee_id SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN template_id SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN title SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN terms SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN body SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN doc_hash SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN state SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN sign_mode SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN vendor_doc_id SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN sign_url SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN sent_by SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN sent_at SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN signer_name SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN signed_at SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN sign_evidence SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN canceled_at SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN cancel_reason SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN created_by SET (pg_attver=168140456);
ALTER TABLE ONLY public.hr_contracts ALTER COLUMN created_at SET (pg_attver=168140456);



CREATE SEQUENCE public.hr_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_contracts_id_seq OWNED BY public.hr_contracts.id;



CREATE TABLE public.hr_interviews (
    id bigint NOT NULL,
    applicant_id bigint NOT NULL,
    at timestamp with time zone NOT NULL,
    place text,
    interviewers text,
    result text,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_interviews_interviewers_check CHECK (((interviewers IS NULL) OR (char_length(interviewers) <= 200))),
    CONSTRAINT hr_interviews_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT hr_interviews_place_check CHECK (((place IS NULL) OR (char_length(place) <= 100))),
    CONSTRAINT hr_interviews_result_check CHECK (((result IS NULL) OR (result = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'HOLD'::text]))))
);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN id SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN applicant_id SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN at SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN place SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN interviewers SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN result SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN note SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN created_by SET (pg_attver=168495344);
ALTER TABLE ONLY public.hr_interviews ALTER COLUMN created_at SET (pg_attver=168495344);



CREATE SEQUENCE public.hr_interviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_interviews_id_seq OWNED BY public.hr_interviews.id;



CREATE TABLE public.hr_job_postings (
    id bigint NOT NULL,
    title text NOT NULL,
    dept text,
    emp_type text DEFAULT 'REGULAR'::text NOT NULL,
    description text,
    opens_on date NOT NULL,
    closes_on date NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hjp_dates CHECK (((closes_on >= opens_on) AND ((closes_on - opens_on) <= 366))),
    CONSTRAINT hr_job_postings_dept_check CHECK (((dept IS NULL) OR (char_length(dept) <= 60))),
    CONSTRAINT hr_job_postings_description_check CHECK (((description IS NULL) OR (char_length(description) <= 4000))),
    CONSTRAINT hr_job_postings_emp_type_check CHECK ((emp_type = ANY (ARRAY['REGULAR'::text, 'FIXED_TERM'::text, 'PART_TIME'::text, 'INTERN'::text]))),
    CONSTRAINT hr_job_postings_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'OPEN'::text, 'CLOSED'::text]))),
    CONSTRAINT hr_job_postings_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN id SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN title SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN dept SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN emp_type SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN description SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN opens_on SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN closes_on SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN state SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN created_by SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN created_at SET (pg_attver=168374304);
ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN updated_at SET (pg_attver=168374304);



CREATE SEQUENCE public.hr_job_postings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_job_postings_id_seq OWNED BY public.hr_job_postings.id;



CREATE TABLE public.hr_review_cycles (
    id bigint NOT NULL,
    year integer NOT NULL,
    quarter integer NOT NULL,
    title text NOT NULL,
    state text DEFAULT 'GOALS'::text NOT NULL,
    goal_due date,
    review_due date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT ck_hrrc_closed CHECK (((state = 'CLOSED'::text) = (closed_at IS NOT NULL))),
    CONSTRAINT ck_hrrc_due CHECK (((review_due IS NULL) OR (goal_due IS NULL) OR (review_due >= goal_due))),
    CONSTRAINT hr_review_cycles_quarter_check CHECK (((quarter >= 1) AND (quarter <= 4))),
    CONSTRAINT hr_review_cycles_state_check CHECK ((state = ANY (ARRAY['GOALS'::text, 'REVIEW'::text, 'CLOSED'::text]))),
    CONSTRAINT hr_review_cycles_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 60))),
    CONSTRAINT hr_review_cycles_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN id SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN year SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN quarter SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN title SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN state SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN goal_due SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN review_due SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN created_by SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN created_at SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN closed_by SET (pg_attver=168225256);
ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN closed_at SET (pg_attver=168225256);



CREATE SEQUENCE public.hr_review_cycles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_review_cycles_id_seq OWNED BY public.hr_review_cycles.id;



CREATE TABLE public.hr_review_goals (
    id bigint NOT NULL,
    cycle_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    title text NOT NULL,
    measure text,
    weight integer NOT NULL,
    self_score smallint,
    self_note text,
    mgr_score smallint,
    mgr_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_review_goals_measure_check CHECK (((measure IS NULL) OR (char_length(measure) <= 200))),
    CONSTRAINT hr_review_goals_mgr_note_check CHECK (((mgr_note IS NULL) OR (char_length(mgr_note) <= 300))),
    CONSTRAINT hr_review_goals_mgr_score_check CHECK (((mgr_score IS NULL) OR ((mgr_score >= 1) AND (mgr_score <= 5)))),
    CONSTRAINT hr_review_goals_self_note_check CHECK (((self_note IS NULL) OR (char_length(self_note) <= 300))),
    CONSTRAINT hr_review_goals_self_score_check CHECK (((self_score IS NULL) OR ((self_score >= 1) AND (self_score <= 5)))),
    CONSTRAINT hr_review_goals_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 120))),
    CONSTRAINT hr_review_goals_weight_check CHECK (((weight >= 1) AND (weight <= 100)))
);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN id SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN cycle_id SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN employee_id SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN title SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN measure SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN weight SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN self_score SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN self_note SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN mgr_score SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN mgr_note SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN created_at SET (pg_attver=168276664);
ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN updated_at SET (pg_attver=168276664);



CREATE SEQUENCE public.hr_review_goals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_review_goals_id_seq OWNED BY public.hr_review_goals.id;



CREATE TABLE public.hr_review_results (
    cycle_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    self_comment text,
    self_submitted_at timestamp with time zone,
    mgr_comment text,
    mgr_avg numeric(3,2),
    grade text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT ck_hrrr_grade CHECK (((grade IS NULL) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT hr_review_results_grade_check CHECK (((grade IS NULL) OR (grade = ANY (ARRAY['S'::text, 'A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT hr_review_results_mgr_avg_check CHECK (((mgr_avg IS NULL) OR ((mgr_avg >= (1)::numeric) AND (mgr_avg <= (5)::numeric)))),
    CONSTRAINT hr_review_results_mgr_comment_check CHECK (((mgr_comment IS NULL) OR (char_length(mgr_comment) <= 1000))),
    CONSTRAINT hr_review_results_self_comment_check CHECK (((self_comment IS NULL) OR (char_length(self_comment) <= 1000)))
);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN cycle_id SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN employee_id SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN self_comment SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN self_submitted_at SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN mgr_comment SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN mgr_avg SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN grade SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN reviewed_by SET (pg_attver=168321712);
ALTER TABLE ONLY public.hr_review_results ALTER COLUMN reviewed_at SET (pg_attver=168321712);



CREATE TABLE public.hr_training_kinds (
    code text NOT NULL,
    name text NOT NULL,
    basis text,
    cycle_months integer DEFAULT 12 NOT NULL,
    min_hours numeric(4,1) DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hr_training_kinds_basis_check CHECK (((basis IS NULL) OR (char_length(basis) <= 200))),
    CONSTRAINT hr_training_kinds_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,30}$'::text)),
    CONSTRAINT hr_training_kinds_cycle_months_check CHECK ((cycle_months = ANY (ARRAY[6, 12]))),
    CONSTRAINT hr_training_kinds_min_hours_check CHECK (((min_hours > (0)::numeric) AND (min_hours <= (40)::numeric))),
    CONSTRAINT hr_training_kinds_name_check CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 60))),
    CONSTRAINT hr_training_kinds_sort_check CHECK (((sort >= 0) AND (sort <= 9999)))
);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN code SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN name SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN basis SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN cycle_months SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN min_hours SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN active SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN sort SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN updated_by SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN updated_at SET (pg_attver=167973192);
ALTER TABLE ONLY public.hr_training_kinds ALTER COLUMN created_at SET (pg_attver=167973192);



CREATE TABLE public.hr_training_records (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    kind_code text NOT NULL,
    period text NOT NULL,
    done_on date NOT NULL,
    hours numeric(4,1) NOT NULL,
    method text DEFAULT 'ONLINE'::text NOT NULL,
    provider text,
    file_id uuid,
    note text,
    state text DEFAULT 'SUBMITTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    void_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_htr_decided CHECK (((state = 'SUBMITTED'::text) OR (decided_at IS NOT NULL))),
    CONSTRAINT ck_htr_void CHECK (((state <> 'VOID'::text) OR (void_reason IS NOT NULL))),
    CONSTRAINT hr_training_records_hours_check CHECK (((hours > (0)::numeric) AND (hours <= (40)::numeric))),
    CONSTRAINT hr_training_records_method_check CHECK ((method = ANY (ARRAY['ONLINE'::text, 'CLASS'::text, 'ETC'::text]))),
    CONSTRAINT hr_training_records_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT hr_training_records_period_check CHECK ((period ~ '^[0-9]{4}(-H[12])?$'::text)),
    CONSTRAINT hr_training_records_provider_check CHECK (((provider IS NULL) OR (char_length(provider) <= 100))),
    CONSTRAINT hr_training_records_state_check CHECK ((state = ANY (ARRAY['SUBMITTED'::text, 'CONFIRMED'::text, 'VOID'::text]))),
    CONSTRAINT hr_training_records_void_reason_check CHECK (((void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 2) AND (char_length(btrim(void_reason)) <= 200))))
);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN id SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN employee_id SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN kind_code SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN period SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN done_on SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN hours SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN method SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN provider SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN file_id SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN note SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN state SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN decided_by SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN decided_at SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN void_reason SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN created_by SET (pg_attver=168017392);
ALTER TABLE ONLY public.hr_training_records ALTER COLUMN created_at SET (pg_attver=168017392);



CREATE SEQUENCE public.hr_training_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hr_training_records_id_seq OWNED BY public.hr_training_records.id;



CREATE TABLE public.hra_bank_formats (
    id bigint NOT NULL,
    name text NOT NULL,
    columns jsonb NOT NULL,
    header boolean DEFAULT true NOT NULL,
    date_style text DEFAULT 'YYYYMMDD'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    note text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hra_bank_formats_columns_check CHECK (((jsonb_typeof(columns) = 'array'::text) AND ((jsonb_array_length(columns) >= 1) AND (jsonb_array_length(columns) <= 20)))),
    CONSTRAINT hra_bank_formats_date_style_check CHECK ((date_style = ANY (ARRAY['YYYY-MM-DD'::text, 'YYYYMMDD'::text, 'YYYY/MM/DD'::text, 'YYYY.MM.DD'::text]))),
    CONSTRAINT hra_bank_formats_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
    CONSTRAINT hra_bank_formats_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN id SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN name SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN columns SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN header SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN date_style SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN is_default SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN note SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN updated_by SET (pg_attver=179680976);
ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN updated_at SET (pg_attver=179680976);



CREATE SEQUENCE public.hra_bank_formats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_bank_formats_id_seq OWNED BY public.hra_bank_formats.id;



CREATE TABLE public.hra_close_items (
    key text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    where_ko text,
    sort integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hra_close_items_key_check CHECK ((key ~ '^[a-z][a-z0-9_]{1,30}$'::text)),
    CONSTRAINT hra_close_items_kind_check CHECK ((kind = ANY (ARRAY['AUTO'::text, 'MANUAL'::text]))),
    CONSTRAINT hra_close_items_label_check CHECK (((char_length(btrim(label)) >= 2) AND (char_length(btrim(label)) <= 60))),
    CONSTRAINT hra_close_items_where_ko_check CHECK (((where_ko IS NULL) OR (char_length(where_ko) <= 60)))
);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN key SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN label SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN kind SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN where_ko SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN sort SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN active SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN updated_by SET (pg_attver=179782016);
ALTER TABLE ONLY public.hra_close_items ALTER COLUMN updated_at SET (pg_attver=179782016);



CREATE TABLE public.hra_close_marks (
    id bigint NOT NULL,
    ym text NOT NULL,
    item_key text NOT NULL,
    done boolean NOT NULL,
    note text,
    marked_by uuid,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hra_close_marks_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT hra_close_marks_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN id SET (pg_attver=179821808);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN ym SET (pg_attver=179821808);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN item_key SET (pg_attver=179821808);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN done SET (pg_attver=179821808);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN note SET (pg_attver=179821808);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN marked_by SET (pg_attver=179821808);
ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN marked_at SET (pg_attver=179821808);



CREATE SEQUENCE public.hra_close_marks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_close_marks_id_seq OWNED BY public.hra_close_marks.id;



CREATE TABLE public.hra_leave_promos (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    year integer NOT NULL,
    round smallint NOT NULL,
    unused_days numeric(5,1) NOT NULL,
    issued_on date NOT NULL,
    reply_due date NOT NULL,
    state text DEFAULT 'ISSUED'::text NOT NULL,
    plan_dates date[] DEFAULT '{}'::date[] NOT NULL,
    planned_at timestamp with time zone,
    designated_dates date[] DEFAULT '{}'::date[] NOT NULL,
    acked_at timestamp with time zone,
    note text,
    out_of_window boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hra_lp_due CHECK ((reply_due >= issued_on)),
    CONSTRAINT ck_hra_lp_plan CHECK ((((state = 'PLANNED'::text) = ((planned_at IS NOT NULL) AND (cardinality(plan_dates) >= 1))) OR (round = 2))),
    CONSTRAINT ck_hra_lp_state CHECK ((((round = 1) AND (state = ANY (ARRAY['ISSUED'::text, 'PLANNED'::text, 'NO_PLAN'::text])) AND (cardinality(designated_dates) = 0)) OR ((round = 2) AND (state = 'DESIGNATED'::text) AND (cardinality(designated_dates) >= 1)))),
    CONSTRAINT hra_leave_promos_designated_dates_check CHECK ((cardinality(designated_dates) <= 40)),
    CONSTRAINT hra_leave_promos_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT hra_leave_promos_plan_dates_check CHECK ((cardinality(plan_dates) <= 40)),
    CONSTRAINT hra_leave_promos_round_check CHECK ((round = ANY (ARRAY[1, 2]))),
    CONSTRAINT hra_leave_promos_state_check CHECK ((state = ANY (ARRAY['ISSUED'::text, 'PLANNED'::text, 'NO_PLAN'::text, 'DESIGNATED'::text]))),
    CONSTRAINT hra_leave_promos_unused_days_check CHECK (((unused_days >= (0)::numeric) AND (unused_days <= (100)::numeric))),
    CONSTRAINT hra_leave_promos_year_check CHECK (((year >= 2000) AND (year <= 2100)))
);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN id SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN employee_id SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN year SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN round SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN unused_days SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN issued_on SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN reply_due SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN state SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN plan_dates SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN planned_at SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN designated_dates SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN acked_at SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN note SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN out_of_window SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN created_by SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN created_at SET (pg_attver=179402368);
ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN updated_at SET (pg_attver=179402368);



CREATE SEQUENCE public.hra_leave_promos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_leave_promos_id_seq OWNED BY public.hra_leave_promos.id;



CREATE TABLE public.hra_lib_posts (
    id bigint NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    audience text[] DEFAULT '{}'::text[] NOT NULL,
    must_read boolean DEFAULT false NOT NULL,
    read_due date,
    pinned boolean DEFAULT false NOT NULL,
    file_id uuid,
    corp_doc_id bigint,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    archived_at timestamp with time zone,
    archive_reason text,
    unread_alerted_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hra_lib_archived CHECK ((((state = 'ACTIVE'::text) AND (archived_at IS NULL)) OR ((state = 'ARCHIVED'::text) AND (archived_at IS NOT NULL) AND (archive_reason IS NOT NULL)))),
    CONSTRAINT ck_hra_lib_due CHECK (((read_due IS NULL) OR must_read)),
    CONSTRAINT ck_hra_lib_kind CHECK ((((kind = 'NOTICE'::text) AND (body IS NOT NULL) AND (char_length(btrim(body)) >= 2)) OR ((kind = 'FILE'::text) AND ((file_id IS NOT NULL) OR (corp_doc_id IS NOT NULL))))),
    CONSTRAINT ck_hra_lib_one_file CHECK ((NOT ((file_id IS NOT NULL) AND (corp_doc_id IS NOT NULL)))),
    CONSTRAINT hra_lib_posts_archive_reason_check CHECK (((archive_reason IS NULL) OR ((char_length(btrim(archive_reason)) >= 2) AND (char_length(btrim(archive_reason)) <= 200)))),
    CONSTRAINT hra_lib_posts_audience_check CHECK ((cardinality(audience) <= 20)),
    CONSTRAINT hra_lib_posts_body_check CHECK (((body IS NULL) OR (char_length(body) <= 20000))),
    CONSTRAINT hra_lib_posts_kind_check CHECK ((kind = ANY (ARRAY['NOTICE'::text, 'FILE'::text]))),
    CONSTRAINT hra_lib_posts_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'ARCHIVED'::text]))),
    CONSTRAINT hra_lib_posts_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 120)))
);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN id SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN kind SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN title SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN body SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN audience SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN must_read SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN read_due SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN pinned SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN file_id SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN corp_doc_id SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN state SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN archived_at SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN archive_reason SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN unread_alerted_at SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN created_by SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN created_at SET (pg_attver=179481928);
ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN updated_at SET (pg_attver=179481928);



CREATE SEQUENCE public.hra_lib_posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_lib_posts_id_seq OWNED BY public.hra_lib_posts.id;



CREATE TABLE public.hra_lib_reads (
    post_id bigint NOT NULL,
    account_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.hra_lib_reads ALTER COLUMN post_id SET (pg_attver=179543328);
ALTER TABLE ONLY public.hra_lib_reads ALTER COLUMN account_id SET (pg_attver=179543328);
ALTER TABLE ONLY public.hra_lib_reads ALTER COLUMN read_at SET (pg_attver=179543328);



CREATE TABLE public.hra_lib_revisions (
    id bigint NOT NULL,
    post_id bigint NOT NULL,
    before jsonb NOT NULL,
    by_account uuid,
    at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.hra_lib_revisions ALTER COLUMN id SET (pg_attver=179568136);
ALTER TABLE ONLY public.hra_lib_revisions ALTER COLUMN post_id SET (pg_attver=179568136);
ALTER TABLE ONLY public.hra_lib_revisions ALTER COLUMN before SET (pg_attver=179568136);
ALTER TABLE ONLY public.hra_lib_revisions ALTER COLUMN by_account SET (pg_attver=179568136);
ALTER TABLE ONLY public.hra_lib_revisions ALTER COLUMN at SET (pg_attver=179568136);



CREATE SEQUENCE public.hra_lib_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_lib_revisions_id_seq OWNED BY public.hra_lib_revisions.id;



CREATE TABLE public.hra_pay_bank_changes (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    bank_before text,
    tail_before text,
    bank_after text NOT NULL,
    tail_after text NOT NULL,
    reason text NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hra_pay_bank_changes_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200)))
);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN id SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN employee_id SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN bank_before SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN tail_before SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN bank_after SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN tail_after SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN reason SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN changed_by SET (pg_attver=179648504);
ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN changed_at SET (pg_attver=179648504);



CREATE SEQUENCE public.hra_pay_bank_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_pay_bank_changes_id_seq OWNED BY public.hra_pay_bank_changes.id;



CREATE TABLE public.hra_pay_banks (
    employee_id bigint NOT NULL,
    bank text NOT NULL,
    acct_enc bytea NOT NULL,
    acct_tail text NOT NULL,
    holder text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hra_pay_banks_acct_tail_check CHECK ((acct_tail ~ '^[0-9]{4}$'::text)),
    CONSTRAINT hra_pay_banks_bank_check CHECK ((bank ~ '^[0-9]{3}$'::text)),
    CONSTRAINT hra_pay_banks_holder_check CHECK (((char_length(btrim(holder)) >= 1) AND (char_length(btrim(holder)) <= 40)))
);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN employee_id SET (pg_attver=179611368);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN bank SET (pg_attver=179611368);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN acct_enc SET (pg_attver=179611368);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN acct_tail SET (pg_attver=179611368);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN holder SET (pg_attver=179611368);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN updated_by SET (pg_attver=179611368);
ALTER TABLE ONLY public.hra_pay_banks ALTER COLUMN updated_at SET (pg_attver=179611368);



CREATE TABLE public.hra_payfile_logs (
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    ym text NOT NULL,
    format_id bigint,
    format_name text NOT NULL,
    lines integer NOT NULL,
    total bigint NOT NULL,
    sha256 text NOT NULL,
    ticket bigint,
    made_by uuid,
    made_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hra_payfile_logs_lines_check CHECK ((lines >= 0)),
    CONSTRAINT hra_payfile_logs_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT hra_payfile_logs_total_check CHECK ((total >= 0)),
    CONSTRAINT hra_payfile_logs_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN id SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN run_id SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN ym SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN format_id SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN format_name SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN lines SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN total SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN sha256 SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN ticket SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN made_by SET (pg_attver=179728840);
ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN made_at SET (pg_attver=179728840);



CREATE SEQUENCE public.hra_payfile_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hra_payfile_logs_id_seq OWNED BY public.hra_payfile_logs.id;



CREATE TABLE public.hrx_bookings (
    id bigint NOT NULL,
    resource_id bigint NOT NULL,
    booked_by uuid NOT NULL,
    title text NOT NULL,
    memo text,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    canceled_at timestamp with time zone,
    canceled_by uuid,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hxb_cancel CHECK (((canceled_at IS NULL) = (canceled_by IS NULL))),
    CONSTRAINT ck_hxb_span CHECK (((end_at > start_at) AND ((end_at - start_at) <= '24:00:00'::interval))),
    CONSTRAINT hrx_bookings_cancel_reason_check CHECK (((cancel_reason IS NULL) OR (char_length(cancel_reason) <= 200))),
    CONSTRAINT hrx_bookings_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT hrx_bookings_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 80)))
);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN id SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN resource_id SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN booked_by SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN title SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN memo SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN start_at SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN end_at SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN canceled_at SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN canceled_by SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN cancel_reason SET (pg_attver=169737032);
ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN created_at SET (pg_attver=169737032);



CREATE SEQUENCE public.hrx_bookings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_bookings_id_seq OWNED BY public.hrx_bookings.id;



CREATE TABLE public.hrx_ot_pay_links (
    id bigint NOT NULL,
    request_id bigint NOT NULL,
    run_id bigint NOT NULL,
    line_id bigint NOT NULL,
    paid_min integer NOT NULL,
    night_min integer NOT NULL,
    hourly bigint NOT NULL,
    amount bigint NOT NULL,
    basis text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hrx_ot_pay_links_amount_check CHECK ((amount >= 0)),
    CONSTRAINT hrx_ot_pay_links_basis_check CHECK ((basis = ANY (ARRAY['MIN'::text, 'REQUEST'::text]))),
    CONSTRAINT hrx_ot_pay_links_hourly_check CHECK ((hourly >= 0)),
    CONSTRAINT hrx_ot_pay_links_night_min_check CHECK ((night_min >= 0)),
    CONSTRAINT hrx_ot_pay_links_paid_min_check CHECK (((paid_min >= 0) AND (paid_min <= 960)))
);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN id SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN request_id SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN run_id SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN line_id SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN paid_min SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN night_min SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN hourly SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN amount SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN basis SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN created_by SET (pg_attver=169516056);
ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN created_at SET (pg_attver=169516056);



CREATE SEQUENCE public.hrx_ot_pay_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_ot_pay_links_id_seq OWNED BY public.hrx_ot_pay_links.id;



CREATE TABLE public.hrx_ot_requests (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    work_on date NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    minutes integer DEFAULT 0 NOT NULL,
    night_min integer DEFAULT 0 NOT NULL,
    day_kind text DEFAULT 'WORKDAY'::text NOT NULL,
    reason text NOT NULL,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hxo_night CHECK ((night_min <= minutes)),
    CONSTRAINT ck_hxo_span CHECK (((end_at > start_at) AND ((end_at - start_at) <= '16:00:00'::interval))),
    CONSTRAINT hrx_ot_requests_day_kind_check CHECK ((day_kind = ANY (ARRAY['WORKDAY'::text, 'OFFDAY'::text, 'HOLIDAY'::text]))),
    CONSTRAINT hrx_ot_requests_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 200))),
    CONSTRAINT hrx_ot_requests_minutes_check CHECK (((minutes >= 10) AND (minutes <= 960))),
    CONSTRAINT hrx_ot_requests_night_min_check CHECK ((night_min >= 0)),
    CONSTRAINT hrx_ot_requests_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 200))),
    CONSTRAINT hrx_ot_requests_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELED'::text])))
);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN id SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN employee_id SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN work_on SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN start_at SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN end_at SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN minutes SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN night_min SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN day_kind SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN reason SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN state SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN decided_by SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN decided_at SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN decide_note SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN created_by SET (pg_attver=169451616);
ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN created_at SET (pg_attver=169451616);



CREATE SEQUENCE public.hrx_ot_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_ot_requests_id_seq OWNED BY public.hrx_ot_requests.id;



CREATE TABLE public.hrx_resources (
    id bigint NOT NULL,
    kind text DEFAULT 'ROOM'::text NOT NULL,
    name text NOT NULL,
    location text,
    capacity integer,
    note text,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hrx_resources_capacity_check CHECK (((capacity IS NULL) OR ((capacity >= 1) AND (capacity <= 500)))),
    CONSTRAINT hrx_resources_kind_check CHECK ((kind = ANY (ARRAY['ROOM'::text, 'EQUIP'::text]))),
    CONSTRAINT hrx_resources_location_check CHECK (((location IS NULL) OR (char_length(location) <= 60))),
    CONSTRAINT hrx_resources_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 40))),
    CONSTRAINT hrx_resources_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT hrx_resources_sort_check CHECK (((sort >= 0) AND (sort <= 9999)))
);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN id SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN kind SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN name SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN location SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN capacity SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN note SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN active SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN sort SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN updated_by SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN updated_at SET (pg_attver=169686608);
ALTER TABLE ONLY public.hrx_resources ALTER COLUMN created_at SET (pg_attver=169686608);



CREATE SEQUENCE public.hrx_resources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_resources_id_seq OWNED BY public.hrx_resources.id;



CREATE TABLE public.hrx_shift_types (
    code text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'WORK'::text NOT NULL,
    start_hm text,
    end_hm text,
    break_min integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hxt_times CHECK ((((kind = 'OFF'::text) AND (start_hm IS NULL) AND (end_hm IS NULL) AND (break_min = 0)) OR ((kind = 'WORK'::text) AND (start_hm IS NOT NULL) AND (end_hm IS NOT NULL) AND (start_hm <> end_hm)))),
    CONSTRAINT hrx_shift_types_break_min_check CHECK (((break_min >= 0) AND (break_min <= 240))),
    CONSTRAINT hrx_shift_types_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,15}$'::text)),
    CONSTRAINT hrx_shift_types_end_hm_check CHECK (((end_hm IS NULL) OR (end_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
    CONSTRAINT hrx_shift_types_kind_check CHECK ((kind = ANY (ARRAY['WORK'::text, 'OFF'::text]))),
    CONSTRAINT hrx_shift_types_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 30))),
    CONSTRAINT hrx_shift_types_sort_check CHECK (((sort >= 0) AND (sort <= 9999))),
    CONSTRAINT hrx_shift_types_start_hm_check CHECK (((start_hm IS NULL) OR (start_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text)))
);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN code SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN name SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN kind SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN start_hm SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN end_hm SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN break_min SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN active SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN sort SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN updated_by SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN updated_at SET (pg_attver=169577304);
ALTER TABLE ONLY public.hrx_shift_types ALTER COLUMN created_at SET (pg_attver=169577304);



CREATE TABLE public.hrx_shifts (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    work_on date NOT NULL,
    type_code text NOT NULL,
    kind text DEFAULT 'WORK'::text NOT NULL,
    start_hm text,
    end_hm text,
    break_min integer DEFAULT 0 NOT NULL,
    note text,
    created_by uuid,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hrx_shifts_break_min_check CHECK (((break_min >= 0) AND (break_min <= 240))),
    CONSTRAINT hrx_shifts_end_hm_check CHECK (((end_hm IS NULL) OR (end_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
    CONSTRAINT hrx_shifts_kind_check CHECK ((kind = ANY (ARRAY['WORK'::text, 'OFF'::text]))),
    CONSTRAINT hrx_shifts_note_check CHECK (((note IS NULL) OR (char_length(note) <= 100))),
    CONSTRAINT hrx_shifts_start_hm_check CHECK (((start_hm IS NULL) OR (start_hm ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text)))
);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN id SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN employee_id SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN work_on SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN type_code SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN kind SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN start_hm SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN end_hm SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN break_min SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN note SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN created_by SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN updated_by SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN updated_at SET (pg_attver=169626808);
ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN created_at SET (pg_attver=169626808);



CREATE SEQUENCE public.hrx_shifts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_shifts_id_seq OWNED BY public.hrx_shifts.id;



CREATE TABLE public.hrx_stocktake_lines (
    id bigint NOT NULL,
    stocktake_id bigint NOT NULL,
    asset_id bigint NOT NULL,
    result text DEFAULT 'PENDING'::text NOT NULL,
    location text,
    note text,
    checked_by uuid,
    checked_at timestamp with time zone,
    disposed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_hxkl_disposed CHECK (((disposed_at IS NULL) OR (result = 'MISSING'::text))),
    CONSTRAINT hrx_stocktake_lines_location_check CHECK (((location IS NULL) OR (char_length(location) <= 60))),
    CONSTRAINT hrx_stocktake_lines_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT hrx_stocktake_lines_result_check CHECK ((result = ANY (ARRAY['PENDING'::text, 'FOUND'::text, 'MISSING'::text])))
);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN id SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN stocktake_id SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN asset_id SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN result SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN location SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN note SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN checked_by SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN checked_at SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN disposed_at SET (pg_attver=169839480);
ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN created_at SET (pg_attver=169839480);



CREATE SEQUENCE public.hrx_stocktake_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_stocktake_lines_id_seq OWNED BY public.hrx_stocktake_lines.id;



CREATE TABLE public.hrx_stocktakes (
    id bigint NOT NULL,
    title text NOT NULL,
    as_of date NOT NULL,
    state text DEFAULT 'OPEN'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT ck_hxk_closed CHECK (((state = 'CLOSED'::text) = (closed_at IS NOT NULL))),
    CONSTRAINT hrx_stocktakes_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT hrx_stocktakes_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))),
    CONSTRAINT hrx_stocktakes_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 60)))
);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN id SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN title SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN as_of SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN state SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN note SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN created_by SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN created_at SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN closed_by SET (pg_attver=169801848);
ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN closed_at SET (pg_attver=169801848);



CREATE SEQUENCE public.hrx_stocktakes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.hrx_stocktakes_id_seq OWNED BY public.hrx_stocktakes.id;



CREATE TABLE public.its_assets (
    id bigint NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    vendor text,
    asset_tag text,
    seats integer DEFAULT 0 NOT NULL,
    seats_used integer DEFAULT 0 NOT NULL,
    owner_id uuid,
    billing_cycle text DEFAULT 'MONTHLY'::text NOT NULL,
    cost_amount bigint DEFAULT 0 NOT NULL,
    renew_on date,
    auto_renew boolean DEFAULT true NOT NULL,
    cash_plan boolean DEFAULT true NOT NULL,
    cash_plan_id bigint,
    cash_plan_sig text,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    canceled_on date,
    cancel_reason text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_its_asset_cancel CHECK ((((state = 'ACTIVE'::text) AND (canceled_on IS NULL)) OR ((state = 'CANCELED'::text) AND (canceled_on IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_reason, ''::text))) >= 2)))),
    CONSTRAINT ck_its_asset_free CHECK (((billing_cycle <> 'FREE'::text) OR (cost_amount = 0))),
    CONSTRAINT ck_its_asset_renew CHECK (((billing_cycle <> ALL (ARRAY['MONTHLY'::text, 'YEARLY'::text])) OR (renew_on IS NOT NULL))),
    CONSTRAINT its_assets_asset_tag_check CHECK (((asset_tag IS NULL) OR (asset_tag ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'::text))),
    CONSTRAINT its_assets_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['MONTHLY'::text, 'YEARLY'::text, 'ONCE'::text, 'FREE'::text]))),
    CONSTRAINT its_assets_cost_amount_check CHECK (((cost_amount >= 0) AND (cost_amount <= 1000000000))),
    CONSTRAINT its_assets_kind_check CHECK ((kind = ANY (ARRAY['SAAS'::text, 'LICENSE'::text, 'CLOUD'::text, 'DOMAIN'::text, 'DEVICE'::text, 'OTHER'::text]))),
    CONSTRAINT its_assets_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT its_assets_name_check CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 80))),
    CONSTRAINT its_assets_seats_check CHECK (((seats >= 0) AND (seats <= 100000))),
    CONSTRAINT its_assets_seats_used_check CHECK (((seats_used >= 0) AND (seats_used <= 100000))),
    CONSTRAINT its_assets_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CANCELED'::text]))),
    CONSTRAINT its_assets_vendor_check CHECK (((vendor IS NULL) OR (char_length(vendor) <= 80)))
);
ALTER TABLE ONLY public.its_assets ALTER COLUMN id SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN kind SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN name SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN vendor SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN asset_tag SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN seats SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN seats_used SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN owner_id SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN billing_cycle SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN cost_amount SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN renew_on SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN auto_renew SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN cash_plan SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN cash_plan_id SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN cash_plan_sig SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN memo SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN state SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN canceled_on SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN cancel_reason SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN created_by SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN updated_by SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN created_at SET (pg_attver=172025240);
ALTER TABLE ONLY public.its_assets ALTER COLUMN updated_at SET (pg_attver=172025240);



CREATE SEQUENCE public.its_assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.its_assets_id_seq OWNED BY public.its_assets.id;



CREATE TABLE public.its_key_events (
    id bigint NOT NULL,
    integration_code text NOT NULL,
    key_name text NOT NULL,
    kind text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor uuid,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT its_key_events_kind_check CHECK ((kind = ANY (ARRAY['ROTATED'::text, 'MANUAL_ROTATED'::text, 'LIFE_SET'::text])))
);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN id SET (pg_attver=171989696);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN integration_code SET (pg_attver=171989696);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN key_name SET (pg_attver=171989696);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN kind SET (pg_attver=171989696);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN detail SET (pg_attver=171989696);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN actor SET (pg_attver=171989696);
ALTER TABLE ONLY public.its_key_events ALTER COLUMN at SET (pg_attver=171989696);



CREATE SEQUENCE public.its_key_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.its_key_events_id_seq OWNED BY public.its_key_events.id;



CREATE TABLE public.its_key_life (
    integration_code text NOT NULL,
    key_name text NOT NULL,
    expires_on date,
    rotate_days integer,
    rotated_at timestamp with time zone,
    rotated_by uuid,
    rotate_source text,
    owner_note text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_its_key_rotated CHECK (((rotated_at IS NULL) = (rotate_source IS NULL))),
    CONSTRAINT its_key_life_key_name_check CHECK ((key_name ~ '^[A-Z][A-Z0-9_]{2,59}$'::text)),
    CONSTRAINT its_key_life_owner_note_check CHECK (((owner_note IS NULL) OR (char_length(owner_note) <= 200))),
    CONSTRAINT its_key_life_rotate_days_check CHECK (((rotate_days IS NULL) OR ((rotate_days >= 7) AND (rotate_days <= 1095)))),
    CONSTRAINT its_key_life_rotate_source_check CHECK (((rotate_source IS NULL) OR (rotate_source = ANY (ARRAY['ADMIN_KEY'::text, 'MANUAL'::text]))))
);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN integration_code SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN key_name SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN expires_on SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN rotate_days SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN rotated_at SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN rotated_by SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN rotate_source SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN owner_note SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN updated_by SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN created_at SET (pg_attver=171946800);
ALTER TABLE ONLY public.its_key_life ALTER COLUMN updated_at SET (pg_attver=171946800);



CREATE TABLE public.its_suggestion_log (
    id bigint NOT NULL,
    suggestion_id uuid NOT NULL,
    from_state text NOT NULL,
    to_state text NOT NULL,
    note text,
    actor uuid,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT its_suggestion_log_note_check CHECK (((note IS NULL) OR (char_length(note) <= 2000)))
);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN id SET (pg_attver=172183216);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN suggestion_id SET (pg_attver=172183216);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN from_state SET (pg_attver=172183216);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN to_state SET (pg_attver=172183216);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN note SET (pg_attver=172183216);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN actor SET (pg_attver=172183216);
ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN at SET (pg_attver=172183216);



CREATE SEQUENCE public.its_suggestion_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.its_suggestion_log_id_seq OWNED BY public.its_suggestion_log.id;



CREATE TABLE public.its_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    is_anon boolean NOT NULL,
    author_id uuid,
    created_on date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date NOT NULL,
    created_at timestamp with time zone,
    receipt_hash text,
    state text DEFAULT 'RECEIVED'::text NOT NULL,
    answer text,
    answered_at timestamp with time zone,
    answered_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_its_sug_anon CHECK (((is_anon AND (author_id IS NULL) AND (created_at IS NULL)) OR ((NOT is_anon) AND (author_id IS NOT NULL) AND (created_at IS NOT NULL) AND (receipt_hash IS NULL)))),
    CONSTRAINT ck_its_sug_answer CHECK (((state = ANY (ARRAY['RECEIVED'::text, 'REVIEWING'::text])) OR ((answer IS NOT NULL) AND (answered_at IS NOT NULL)))),
    CONSTRAINT its_suggestions_answer_check CHECK (((answer IS NULL) OR ((char_length(btrim(answer)) >= 2) AND (char_length(btrim(answer)) <= 2000)))),
    CONSTRAINT its_suggestions_body_check CHECK (((char_length(btrim(body)) >= 10) AND (char_length(btrim(body)) <= 3000))),
    CONSTRAINT its_suggestions_category_check CHECK ((category = ANY (ARRAY['WORK'::text, 'SYSTEM'::text, 'WELFARE'::text, 'SAFETY'::text, 'OTHER'::text]))),
    CONSTRAINT its_suggestions_receipt_hash_check CHECK (((receipt_hash IS NULL) OR (receipt_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT its_suggestions_state_check CHECK ((state = ANY (ARRAY['RECEIVED'::text, 'REVIEWING'::text, 'ADOPTED'::text, 'DECLINED'::text, 'DONE'::text]))),
    CONSTRAINT its_suggestions_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN id SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN category SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN title SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN body SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN is_anon SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN author_id SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN created_on SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN created_at SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN receipt_hash SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN state SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN answer SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN answered_at SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN answered_by SET (pg_attver=172105720);
ALTER TABLE ONLY public.its_suggestions ALTER COLUMN updated_at SET (pg_attver=172105720);



CREATE TABLE public.its_survey_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    survey_id bigint NOT NULL,
    account_id uuid,
    answers jsonb NOT NULL,
    CONSTRAINT its_survey_answers_answers_check CHECK ((jsonb_typeof(answers) = 'object'::text))
);
ALTER TABLE ONLY public.its_survey_answers ALTER COLUMN id SET (pg_attver=172315856);
ALTER TABLE ONLY public.its_survey_answers ALTER COLUMN survey_id SET (pg_attver=172315856);
ALTER TABLE ONLY public.its_survey_answers ALTER COLUMN account_id SET (pg_attver=172315856);
ALTER TABLE ONLY public.its_survey_answers ALTER COLUMN answers SET (pg_attver=172315856);



CREATE TABLE public.its_survey_questions (
    id bigint NOT NULL,
    survey_id bigint NOT NULL,
    ord integer NOT NULL,
    qtype text NOT NULL,
    body text NOT NULL,
    options text[] DEFAULT ARRAY[]::text[] NOT NULL,
    scale_max integer,
    required boolean DEFAULT true NOT NULL,
    CONSTRAINT ck_its_q_options CHECK ((((qtype = ANY (ARRAY['SINGLE'::text, 'MULTI'::text])) AND ((cardinality(options) >= 2) AND (cardinality(options) <= 12)) AND (scale_max IS NULL)) OR ((qtype = 'SCALE'::text) AND (cardinality(options) = 0) AND ((scale_max >= 3) AND (scale_max <= 10))) OR ((qtype = 'TEXT'::text) AND (cardinality(options) = 0) AND (scale_max IS NULL)))),
    CONSTRAINT its_survey_questions_body_check CHECK (((char_length(btrim(body)) >= 2) AND (char_length(btrim(body)) <= 300))),
    CONSTRAINT its_survey_questions_ord_check CHECK (((ord >= 1) AND (ord <= 30))),
    CONSTRAINT its_survey_questions_qtype_check CHECK ((qtype = ANY (ARRAY['SINGLE'::text, 'MULTI'::text, 'SCALE'::text, 'TEXT'::text])))
);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN id SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN survey_id SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN ord SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN qtype SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN body SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN options SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN scale_max SET (pg_attver=172266440);
ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN required SET (pg_attver=172266440);



CREATE SEQUENCE public.its_survey_questions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.its_survey_questions_id_seq OWNED BY public.its_survey_questions.id;



CREATE TABLE public.its_survey_takers (
    survey_id bigint NOT NULL,
    account_id uuid NOT NULL
);
ALTER TABLE ONLY public.its_survey_takers ALTER COLUMN survey_id SET (pg_attver=172300112);
ALTER TABLE ONLY public.its_survey_takers ALTER COLUMN account_id SET (pg_attver=172300112);



CREATE TABLE public.its_surveys (
    id bigint NOT NULL,
    title text NOT NULL,
    intro text,
    is_anon boolean DEFAULT true NOT NULL,
    audience text[] DEFAULT ARRAY[]::text[] NOT NULL,
    opens_on date NOT NULL,
    closes_on date NOT NULL,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    opened_at timestamp with time zone,
    closed_at timestamp with time zone,
    cancel_note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_its_survey_closed CHECK (((state <> 'CLOSED'::text) OR (closed_at IS NOT NULL))),
    CONSTRAINT ck_its_survey_open CHECK (((state = 'DRAFT'::text) OR (state = 'CANCELED'::text) OR (opened_at IS NOT NULL))),
    CONSTRAINT ck_its_survey_range CHECK (((closes_on >= opens_on) AND ((closes_on - opens_on) <= 92))),
    CONSTRAINT its_surveys_audience_check CHECK ((audience <@ ARRAY['SUPER'::text, 'ADMIN'::text, 'PAYOUT'::text, 'REVIEWER'::text, 'PARTNER_MAL'::text, 'PARTNER_AFF'::text])),
    CONSTRAINT its_surveys_cancel_note_check CHECK (((cancel_note IS NULL) OR (char_length(cancel_note) <= 200))),
    CONSTRAINT its_surveys_intro_check CHECK (((intro IS NULL) OR (char_length(intro) <= 1000))),
    CONSTRAINT its_surveys_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'OPEN'::text, 'CLOSED'::text, 'CANCELED'::text]))),
    CONSTRAINT its_surveys_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN id SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN title SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN intro SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN is_anon SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN audience SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN opens_on SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN closes_on SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN state SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN created_by SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN created_at SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN opened_at SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN closed_at SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN cancel_note SET (pg_attver=172217496);
ALTER TABLE ONLY public.its_surveys ALTER COLUMN updated_at SET (pg_attver=172217496);



CREATE SEQUENCE public.its_surveys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.its_surveys_id_seq OWNED BY public.its_surveys.id;



CREATE TABLE public.lgl_case_costs (
    id bigint NOT NULL,
    case_id bigint NOT NULL,
    kind text DEFAULT 'COUNSEL'::text NOT NULL,
    amount bigint NOT NULL,
    paid_on date NOT NULL,
    expense_claim_id bigint,
    purchase_id bigint,
    note text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    void_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_lgl_cost_one CHECK (((expense_claim_id IS NULL) OR (purchase_id IS NULL))),
    CONSTRAINT ck_lgl_cost_void CHECK (((state <> 'VOID'::text) OR (void_reason IS NOT NULL))),
    CONSTRAINT lgl_case_costs_amount_check CHECK (((amount > 0) AND (amount <= '10000000000'::bigint))),
    CONSTRAINT lgl_case_costs_kind_check CHECK ((kind = ANY (ARRAY['COUNSEL'::text, 'STAMP'::text, 'SERVICE'::text, 'DEPOSIT'::text, 'ETC'::text]))),
    CONSTRAINT lgl_case_costs_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT lgl_case_costs_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'VOID'::text]))),
    CONSTRAINT lgl_case_costs_void_reason_check CHECK (((void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 2) AND (char_length(btrim(void_reason)) <= 200))))
);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN id SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN case_id SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN kind SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN amount SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN paid_on SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN expense_claim_id SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN purchase_id SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN note SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN state SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN void_reason SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN created_by SET (pg_attver=171680464);
ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN created_at SET (pg_attver=171680464);



CREATE SEQUENCE public.lgl_case_costs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_case_costs_id_seq OWNED BY public.lgl_case_costs.id;



CREATE TABLE public.lgl_case_hearings (
    id bigint NOT NULL,
    case_id bigint NOT NULL,
    held_at timestamp with time zone NOT NULL,
    kind text DEFAULT 'HEARING'::text NOT NULL,
    place text,
    note text,
    state text DEFAULT 'PLANNED'::text NOT NULL,
    outcome text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lgl_case_hearings_kind_check CHECK ((kind = ANY (ARRAY['HEARING'::text, 'DEADLINE'::text, 'MEDIATION'::text, 'ETC'::text]))),
    CONSTRAINT lgl_case_hearings_note_check CHECK (((note IS NULL) OR (char_length(note) <= 400))),
    CONSTRAINT lgl_case_hearings_outcome_check CHECK (((outcome IS NULL) OR (char_length(outcome) <= 400))),
    CONSTRAINT lgl_case_hearings_place_check CHECK (((place IS NULL) OR (char_length(place) <= 100))),
    CONSTRAINT lgl_case_hearings_state_check CHECK ((state = ANY (ARRAY['PLANNED'::text, 'DONE'::text, 'CANCELED'::text])))
);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN id SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN case_id SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN held_at SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN kind SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN place SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN note SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN state SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN outcome SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN created_by SET (pg_attver=171635400);
ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN created_at SET (pg_attver=171635400);



CREATE SEQUENCE public.lgl_case_hearings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_case_hearings_id_seq OWNED BY public.lgl_case_hearings.id;



CREATE TABLE public.lgl_cases (
    id bigint NOT NULL,
    case_ref text,
    title text NOT NULL,
    kind text DEFAULT 'CIVIL'::text NOT NULL,
    our_side text DEFAULT 'DEFENDANT'::text NOT NULL,
    counterparty text,
    forum text,
    counsel text,
    claim_amount bigint,
    opened_on date NOT NULL,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    memo text,
    state text DEFAULT 'OPEN'::text NOT NULL,
    result text,
    result_note text,
    closed_on date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_lgl_case_closed CHECK ((((state = 'OPEN'::text) AND (result IS NULL) AND (closed_on IS NULL)) OR ((state = 'CLOSED'::text) AND (result IS NOT NULL) AND (closed_on IS NOT NULL) AND (closed_on >= opened_on)))),
    CONSTRAINT lgl_cases_case_ref_check CHECK (((case_ref IS NULL) OR (char_length(case_ref) <= 60))),
    CONSTRAINT lgl_cases_claim_amount_check CHECK (((claim_amount IS NULL) OR ((claim_amount >= 0) AND (claim_amount <= '1000000000000'::bigint)))),
    CONSTRAINT lgl_cases_counsel_check CHECK (((counsel IS NULL) OR (char_length(counsel) <= 120))),
    CONSTRAINT lgl_cases_counterparty_check CHECK (((counterparty IS NULL) OR (char_length(counterparty) <= 120))),
    CONSTRAINT lgl_cases_file_ids_check CHECK ((cardinality(file_ids) <= 10)),
    CONSTRAINT lgl_cases_forum_check CHECK (((forum IS NULL) OR (char_length(forum) <= 100))),
    CONSTRAINT lgl_cases_kind_check CHECK ((kind = ANY (ARRAY['CIVIL'::text, 'CRIMINAL'::text, 'ADMIN'::text, 'LABOR'::text, 'MEDIATION'::text, 'CONSUMER'::text, 'ETC'::text]))),
    CONSTRAINT lgl_cases_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 2000))),
    CONSTRAINT lgl_cases_our_side_check CHECK ((our_side = ANY (ARRAY['PLAINTIFF'::text, 'DEFENDANT'::text, 'APPLICANT'::text, 'RESPONDENT'::text, 'ETC'::text]))),
    CONSTRAINT lgl_cases_result_check CHECK (((result IS NULL) OR (result = ANY (ARRAY['WIN'::text, 'LOSE'::text, 'PARTIAL'::text, 'SETTLED'::text, 'WITHDRAWN'::text, 'DISMISSED'::text, 'ETC'::text])))),
    CONSTRAINT lgl_cases_result_note_check CHECK (((result_note IS NULL) OR (char_length(result_note) <= 1000))),
    CONSTRAINT lgl_cases_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))),
    CONSTRAINT lgl_cases_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN id SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN case_ref SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN title SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN kind SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN our_side SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN counterparty SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN forum SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN counsel SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN claim_amount SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN opened_on SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN file_ids SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN memo SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN state SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN result SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN result_note SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN closed_on SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN created_by SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN created_at SET (pg_attver=171563104);
ALTER TABLE ONLY public.lgl_cases ALTER COLUMN updated_at SET (pg_attver=171563104);



CREATE SEQUENCE public.lgl_cases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_cases_id_seq OWNED BY public.lgl_cases.id;



CREATE TABLE public.lgl_contract_reviews (
    id bigint NOT NULL,
    title text NOT NULL,
    kind text DEFAULT 'NEW'::text NOT NULL,
    counterparty text,
    contract_id bigint,
    amount bigint,
    wanted_on date,
    summary text,
    file_ids uuid[] NOT NULL,
    requested_by uuid NOT NULL,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_lgl_rv_decided CHECK (((state <> ALL (ARRAY['APPROVED'::text, 'REJECTED'::text, 'CANCELED'::text])) OR (decided_at IS NOT NULL))),
    CONSTRAINT ck_lgl_rv_reject CHECK (((state <> 'REJECTED'::text) OR (char_length(btrim(COALESCE(decide_note, ''::text))) >= 2))),
    CONSTRAINT ck_lgl_rv_self CHECK (((state <> ALL (ARRAY['APPROVED'::text, 'REJECTED'::text])) OR (decided_by IS DISTINCT FROM requested_by))),
    CONSTRAINT lgl_contract_reviews_amount_check CHECK (((amount IS NULL) OR ((amount >= 0) AND (amount <= '100000000000'::bigint)))),
    CONSTRAINT lgl_contract_reviews_counterparty_check CHECK (((counterparty IS NULL) OR (char_length(counterparty) <= 120))),
    CONSTRAINT lgl_contract_reviews_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 400))),
    CONSTRAINT lgl_contract_reviews_file_ids_check CHECK (((cardinality(file_ids) >= 1) AND (cardinality(file_ids) <= 5))),
    CONSTRAINT lgl_contract_reviews_kind_check CHECK ((kind = ANY (ARRAY['NEW'::text, 'RENEW'::text, 'CHANGE'::text, 'TERMINATE'::text]))),
    CONSTRAINT lgl_contract_reviews_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'REVIEWED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELED'::text]))),
    CONSTRAINT lgl_contract_reviews_summary_check CHECK (((summary IS NULL) OR (char_length(summary) <= 2000))),
    CONSTRAINT lgl_contract_reviews_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN id SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN title SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN kind SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN counterparty SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN contract_id SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN amount SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN wanted_on SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN summary SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN file_ids SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN requested_by SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN state SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN decided_by SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN decided_at SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN decide_note SET (pg_attver=171446312);
ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN created_at SET (pg_attver=171446312);



CREATE SEQUENCE public.lgl_contract_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_contract_reviews_id_seq OWNED BY public.lgl_contract_reviews.id;



CREATE TABLE public.lgl_insurance_policies (
    id bigint NOT NULL,
    kind text DEFAULT 'LIABILITY'::text NOT NULL,
    title text NOT NULL,
    insurer text NOT NULL,
    policy_ref text,
    coverage bigint,
    premium bigint NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    pay_mode text DEFAULT 'LUMP'::text NOT NULL,
    book_mode text DEFAULT 'PREPAID'::text NOT NULL,
    renewed_from bigint,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    ended_at timestamp with time zone,
    end_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_lgl_ins_ended CHECK ((((state = 'ACTIVE'::text) AND (ended_at IS NULL)) OR ((state = 'ENDED'::text) AND (ended_at IS NOT NULL) AND (end_reason IS NOT NULL)))),
    CONSTRAINT ck_lgl_ins_monthly CHECK (((pay_mode <> 'MONTHLY'::text) OR (book_mode = 'EXPENSE'::text))),
    CONSTRAINT ck_lgl_ins_period CHECK (((ends_on > starts_on) AND (ends_on <= (starts_on + 3660)))),
    CONSTRAINT lgl_insurance_policies_book_mode_check CHECK ((book_mode = ANY (ARRAY['PREPAID'::text, 'EXPENSE'::text]))),
    CONSTRAINT lgl_insurance_policies_coverage_check CHECK (((coverage IS NULL) OR ((coverage >= 0) AND (coverage <= '1000000000000'::bigint)))),
    CONSTRAINT lgl_insurance_policies_end_reason_check CHECK (((end_reason IS NULL) OR ((char_length(btrim(end_reason)) >= 2) AND (char_length(btrim(end_reason)) <= 200)))),
    CONSTRAINT lgl_insurance_policies_file_ids_check CHECK ((cardinality(file_ids) <= 5)),
    CONSTRAINT lgl_insurance_policies_insurer_check CHECK (((char_length(btrim(insurer)) >= 1) AND (char_length(btrim(insurer)) <= 100))),
    CONSTRAINT lgl_insurance_policies_kind_check CHECK ((kind = ANY (ARRAY['FIRE'::text, 'LIABILITY'::text, 'PRODUCT'::text, 'CYBER'::text, 'DNO'::text, 'CAR'::text, 'GUARANTEE'::text, 'EMPLOYEE'::text, 'ETC'::text]))),
    CONSTRAINT lgl_insurance_policies_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT lgl_insurance_policies_pay_mode_check CHECK ((pay_mode = ANY (ARRAY['LUMP'::text, 'MONTHLY'::text]))),
    CONSTRAINT lgl_insurance_policies_policy_ref_check CHECK (((policy_ref IS NULL) OR (char_length(policy_ref) <= 60))),
    CONSTRAINT lgl_insurance_policies_premium_check CHECK (((premium > 0) AND (premium <= '10000000000'::bigint))),
    CONSTRAINT lgl_insurance_policies_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'ENDED'::text]))),
    CONSTRAINT lgl_insurance_policies_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN id SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN kind SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN title SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN insurer SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN policy_ref SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN coverage SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN premium SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN starts_on SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN ends_on SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN pay_mode SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN book_mode SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN renewed_from SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN file_ids SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN memo SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN state SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN ended_at SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN end_reason SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN created_by SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN created_at SET (pg_attver=171760832);
ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN updated_at SET (pg_attver=171760832);



CREATE SEQUENCE public.lgl_insurance_policies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_insurance_policies_id_seq OWNED BY public.lgl_insurance_policies.id;



CREATE TABLE public.lgl_insurance_postings (
    id bigint NOT NULL,
    policy_id bigint NOT NULL,
    kind text NOT NULL,
    ym text NOT NULL,
    amount bigint NOT NULL,
    manual_id bigint NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lgl_insurance_postings_amount_check CHECK ((amount > 0)),
    CONSTRAINT lgl_insurance_postings_kind_check CHECK ((kind = ANY (ARRAY['PAY'::text, 'AMORT'::text, 'MONTHLY'::text]))),
    CONSTRAINT lgl_insurance_postings_ym_check CHECK ((ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN id SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN policy_id SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN kind SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN ym SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN amount SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN manual_id SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN created_by SET (pg_attver=171837080);
ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN created_at SET (pg_attver=171837080);



CREATE SEQUENCE public.lgl_insurance_postings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_insurance_postings_id_seq OWNED BY public.lgl_insurance_postings.id;



CREATE TABLE public.lgl_license_kinds (
    code text NOT NULL,
    name text NOT NULL,
    authority text,
    cycle_months integer,
    basis text,
    active boolean DEFAULT true NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lgl_license_kinds_authority_check CHECK (((authority IS NULL) OR (char_length(authority) <= 100))),
    CONSTRAINT lgl_license_kinds_basis_check CHECK (((basis IS NULL) OR (char_length(basis) <= 300))),
    CONSTRAINT lgl_license_kinds_code_check CHECK ((code ~ '^[A-Z][A-Z0-9_]{1,30}$'::text)),
    CONSTRAINT lgl_license_kinds_cycle_months_check CHECK (((cycle_months IS NULL) OR ((cycle_months >= 1) AND (cycle_months <= 120)))),
    CONSTRAINT lgl_license_kinds_name_check CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 60))),
    CONSTRAINT lgl_license_kinds_sort_check CHECK (((sort >= 0) AND (sort <= 9999)))
);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN code SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN name SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN authority SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN cycle_months SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN basis SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN active SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN sort SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN updated_by SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN updated_at SET (pg_attver=171292128);
ALTER TABLE ONLY public.lgl_license_kinds ALTER COLUMN created_at SET (pg_attver=171292128);



CREATE TABLE public.lgl_license_renewals (
    id bigint NOT NULL,
    license_id bigint NOT NULL,
    done_on date NOT NULL,
    prev_due_on date,
    next_due_on date,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lgl_license_renewals_file_ids_check CHECK ((cardinality(file_ids) <= 5)),
    CONSTRAINT lgl_license_renewals_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN id SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN license_id SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN done_on SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN prev_due_on SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN next_due_on SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN file_ids SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN note SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN created_by SET (pg_attver=171403840);
ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN created_at SET (pg_attver=171403840);



CREATE SEQUENCE public.lgl_license_renewals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_license_renewals_id_seq OWNED BY public.lgl_license_renewals.id;



CREATE TABLE public.lgl_licenses (
    id bigint NOT NULL,
    kind_code text NOT NULL,
    title text NOT NULL,
    license_ref text,
    authority text,
    registered_on date,
    cycle_months integer,
    next_due_on date,
    owner_account uuid,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    memo text,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    closed_at timestamp with time zone,
    close_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_lgl_lic_closed CHECK ((((state = 'ACTIVE'::text) AND (closed_at IS NULL)) OR ((state = 'CLOSED'::text) AND (closed_at IS NOT NULL) AND (close_reason IS NOT NULL)))),
    CONSTRAINT ck_lgl_lic_due CHECK (((next_due_on IS NULL) OR (registered_on IS NULL) OR (next_due_on >= registered_on))),
    CONSTRAINT lgl_licenses_authority_check CHECK (((authority IS NULL) OR (char_length(authority) <= 100))),
    CONSTRAINT lgl_licenses_close_reason_check CHECK (((close_reason IS NULL) OR ((char_length(btrim(close_reason)) >= 2) AND (char_length(btrim(close_reason)) <= 200)))),
    CONSTRAINT lgl_licenses_cycle_months_check CHECK (((cycle_months IS NULL) OR ((cycle_months >= 1) AND (cycle_months <= 120)))),
    CONSTRAINT lgl_licenses_file_ids_check CHECK ((cardinality(file_ids) <= 5)),
    CONSTRAINT lgl_licenses_license_ref_check CHECK (((license_ref IS NULL) OR (char_length(license_ref) <= 60))),
    CONSTRAINT lgl_licenses_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT lgl_licenses_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text]))),
    CONSTRAINT lgl_licenses_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN id SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN kind_code SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN title SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN license_ref SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN authority SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN registered_on SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN cycle_months SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN next_due_on SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN owner_account SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN file_ids SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN memo SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN state SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN closed_at SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN close_reason SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN created_by SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN created_at SET (pg_attver=171333464);
ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN updated_at SET (pg_attver=171333464);



CREATE SEQUENCE public.lgl_licenses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_licenses_id_seq OWNED BY public.lgl_licenses.id;



CREATE TABLE public.lgl_review_opinions (
    id bigint NOT NULL,
    review_id bigint NOT NULL,
    author uuid NOT NULL,
    risk text DEFAULT 'MID'::text NOT NULL,
    body text NOT NULL,
    outside boolean DEFAULT false NOT NULL,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lgl_review_opinions_body_check CHECK (((char_length(btrim(body)) >= 2) AND (char_length(btrim(body)) <= 4000))),
    CONSTRAINT lgl_review_opinions_file_ids_check CHECK ((cardinality(file_ids) <= 3)),
    CONSTRAINT lgl_review_opinions_risk_check CHECK ((risk = ANY (ARRAY['LOW'::text, 'MID'::text, 'HIGH'::text])))
);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN id SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN review_id SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN author SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN risk SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN body SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN outside SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN file_ids SET (pg_attver=171514240);
ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN created_at SET (pg_attver=171514240);



CREATE SEQUENCE public.lgl_review_opinions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.lgl_review_opinions_id_seq OWNED BY public.lgl_review_opinions.id;



CREATE TABLE public.ofc_events (
    id bigint NOT NULL,
    scope text NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    start_on date NOT NULL,
    end_on date NOT NULL,
    at_time text,
    memo text,
    removed_at timestamp with time zone,
    removed_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_ofe_range CHECK (((end_on >= start_on) AND ((end_on - start_on) <= 92))),
    CONSTRAINT ck_ofe_removed CHECK (((removed_at IS NULL) = (removed_by IS NULL))),
    CONSTRAINT ofc_events_at_time_check CHECK (((at_time IS NULL) OR (at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text))),
    CONSTRAINT ofc_events_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT ofc_events_scope_check CHECK ((scope = ANY (ARRAY['PERSONAL'::text, 'COMPANY'::text]))),
    CONSTRAINT ofc_events_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 80)))
);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN id SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN scope SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN owner_id SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN title SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN start_on SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN end_on SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN at_time SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN memo SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN removed_at SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN removed_by SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN updated_by SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN created_at SET (pg_attver=168643480);
ALTER TABLE ONLY public.ofc_events ALTER COLUMN updated_at SET (pg_attver=168643480);



CREATE SEQUENCE public.ofc_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.ofc_events_id_seq OWNED BY public.ofc_events.id;



CREATE TABLE public.ofc_notify_prefs (
    account_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    kinds text[] DEFAULT ARRAY['OPS'::text, 'APV'::text, 'TASK'::text] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ofc_notify_prefs_kinds_check CHECK ((kinds <@ ARRAY['OPS'::text, 'APV'::text, 'TASK'::text]))
);
ALTER TABLE ONLY public.ofc_notify_prefs ALTER COLUMN account_id SET (pg_attver=168922768);
ALTER TABLE ONLY public.ofc_notify_prefs ALTER COLUMN enabled SET (pg_attver=168922768);
ALTER TABLE ONLY public.ofc_notify_prefs ALTER COLUMN kinds SET (pg_attver=168922768);
ALTER TABLE ONLY public.ofc_notify_prefs ALTER COLUMN updated_at SET (pg_attver=168922768);



CREATE TABLE public.ofc_task_comments (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    author uuid,
    kind text DEFAULT 'COMMENT'::text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ofc_task_comments_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 1000))),
    CONSTRAINT ofc_task_comments_kind_check CHECK ((kind = ANY (ARRAY['COMMENT'::text, 'STATE'::text, 'ASSIGN'::text])))
);
ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN id SET (pg_attver=168767576);
ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN task_id SET (pg_attver=168767576);
ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN author SET (pg_attver=168767576);
ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN kind SET (pg_attver=168767576);
ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN body SET (pg_attver=168767576);
ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN created_at SET (pg_attver=168767576);



CREATE SEQUENCE public.ofc_task_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.ofc_task_comments_id_seq OWNED BY public.ofc_task_comments.id;



CREATE TABLE public.ofc_tasks (
    id bigint NOT NULL,
    title text NOT NULL,
    body text,
    requester uuid NOT NULL,
    assignee uuid NOT NULL,
    state text DEFAULT 'REQUESTED'::text NOT NULL,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    due_on date,
    started_at timestamp with time zone,
    done_at timestamp with time zone,
    canceled_at timestamp with time zone,
    cancel_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_oft_cancel CHECK (((state <> 'CANCELED'::text) OR ((canceled_at IS NOT NULL) AND (char_length(btrim(COALESCE(cancel_note, ''::text))) >= 2)))),
    CONSTRAINT ck_oft_done CHECK (((state <> 'DONE'::text) OR (done_at IS NOT NULL))),
    CONSTRAINT ofc_tasks_body_check CHECK (((body IS NULL) OR (char_length(body) <= 2000))),
    CONSTRAINT ofc_tasks_cancel_note_check CHECK (((cancel_note IS NULL) OR (char_length(cancel_note) <= 200))),
    CONSTRAINT ofc_tasks_priority_check CHECK ((priority = ANY (ARRAY['NORMAL'::text, 'HIGH'::text]))),
    CONSTRAINT ofc_tasks_state_check CHECK ((state = ANY (ARRAY['REQUESTED'::text, 'DOING'::text, 'DONE'::text, 'CANCELED'::text]))),
    CONSTRAINT ofc_tasks_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN id SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN title SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN body SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN requester SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN assignee SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN state SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN priority SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN due_on SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN started_at SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN done_at SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN canceled_at SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN cancel_note SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN created_at SET (pg_attver=168706744);
ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN updated_at SET (pg_attver=168706744);



CREATE SEQUENCE public.ofc_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.ofc_tasks_id_seq OWNED BY public.ofc_tasks.id;



CREATE TABLE public.ofc_trip_settlements (
    id bigint NOT NULL,
    trip_id bigint NOT NULL,
    claim_id bigint NOT NULL,
    amount bigint NOT NULL,
    detail jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ofc_trip_settlements_amount_check CHECK (((amount >= 1) AND (amount <= 100000000)))
);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN id SET (pg_attver=168878888);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN trip_id SET (pg_attver=168878888);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN claim_id SET (pg_attver=168878888);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN amount SET (pg_attver=168878888);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN detail SET (pg_attver=168878888);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN created_by SET (pg_attver=168878888);
ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN created_at SET (pg_attver=168878888);



CREATE SEQUENCE public.ofc_trip_settlements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.ofc_trip_settlements_id_seq OWNED BY public.ofc_trip_settlements.id;



CREATE TABLE public.ofc_trips (
    id bigint NOT NULL,
    traveler uuid NOT NULL,
    destination text NOT NULL,
    region text NOT NULL,
    purpose text NOT NULL,
    depart_on date NOT NULL,
    return_on date NOT NULL,
    transport_est bigint DEFAULT 0 NOT NULL,
    estimate bigint NOT NULL,
    basis jsonb NOT NULL,
    requisition_id bigint NOT NULL,
    state text DEFAULT 'PLANNED'::text NOT NULL,
    claim_id bigint,
    settled_at timestamp with time zone,
    canceled_at timestamp with time zone,
    cancel_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_otr_cancel CHECK (((state <> 'CANCELED'::text) OR ((canceled_at IS NOT NULL) AND (claim_id IS NULL)))),
    CONSTRAINT ck_otr_range CHECK (((return_on >= depart_on) AND ((return_on - depart_on) <= 30))),
    CONSTRAINT ck_otr_settled CHECK (((state <> 'SETTLED'::text) OR ((claim_id IS NOT NULL) AND (settled_at IS NOT NULL)))),
    CONSTRAINT ofc_trips_cancel_note_check CHECK (((cancel_note IS NULL) OR (char_length(cancel_note) <= 200))),
    CONSTRAINT ofc_trips_destination_check CHECK (((char_length(btrim(destination)) >= 2) AND (char_length(btrim(destination)) <= 60))),
    CONSTRAINT ofc_trips_estimate_check CHECK (((estimate >= 1) AND (estimate <= 100000000))),
    CONSTRAINT ofc_trips_purpose_check CHECK (((char_length(btrim(purpose)) >= 2) AND (char_length(btrim(purpose)) <= 300))),
    CONSTRAINT ofc_trips_region_check CHECK ((region = ANY (ARRAY['SEOUL'::text, 'METRO'::text, 'OTHER'::text]))),
    CONSTRAINT ofc_trips_state_check CHECK ((state = ANY (ARRAY['PLANNED'::text, 'SETTLED'::text, 'CANCELED'::text]))),
    CONSTRAINT ofc_trips_transport_est_check CHECK (((transport_est >= 0) AND (transport_est <= 10000000)))
);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN id SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN traveler SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN destination SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN region SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN purpose SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN depart_on SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN return_on SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN transport_est SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN estimate SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN basis SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN requisition_id SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN state SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN claim_id SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN settled_at SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN canceled_at SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN cancel_note SET (pg_attver=168808384);
ALTER TABLE ONLY public.ofc_trips ALTER COLUMN created_at SET (pg_attver=168808384);



CREATE SEQUENCE public.ofc_trips_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.ofc_trips_id_seq OWNED BY public.ofc_trips.id;



CREATE TABLE public.prr_case_steps (
    case_id bigint NOT NULL,
    step text NOT NULL,
    state text NOT NULL,
    note text,
    done_by uuid,
    done_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_prr_case_step_skip_note CHECK (((state <> 'SKIP'::text) OR (char_length(btrim(COALESCE(note, ''::text))) >= 2))),
    CONSTRAINT prr_case_steps_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT prr_case_steps_state_check CHECK ((state = ANY (ARRAY['DONE'::text, 'SKIP'::text]))),
    CONSTRAINT prr_case_steps_step_check CHECK ((step = ANY (ARRAY['INVITE'::text, 'ACCOUNT'::text, 'ROLE_GROUP'::text, 'CONTRACT'::text, 'TRAINING'::text, 'ROLES'::text, 'ASSETS'::text, 'SEVERANCE'::text, 'DOCS'::text])))
);
ALTER TABLE ONLY public.prr_case_steps ALTER COLUMN case_id SET (pg_attver=180558848);
ALTER TABLE ONLY public.prr_case_steps ALTER COLUMN step SET (pg_attver=180558848);
ALTER TABLE ONLY public.prr_case_steps ALTER COLUMN state SET (pg_attver=180558848);
ALTER TABLE ONLY public.prr_case_steps ALTER COLUMN note SET (pg_attver=180558848);
ALTER TABLE ONLY public.prr_case_steps ALTER COLUMN done_by SET (pg_attver=180558848);
ALTER TABLE ONLY public.prr_case_steps ALTER COLUMN done_at SET (pg_attver=180558848);



CREATE TABLE public.prr_cases (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    kind text NOT NULL,
    state text DEFAULT 'OPEN'::text NOT NULL,
    target_on date NOT NULL,
    invite_email text,
    invited_at timestamp with time zone,
    note text,
    opened_by uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    close_note text,
    CONSTRAINT prr_cases_close_note_check CHECK (((close_note IS NULL) OR (char_length(close_note) <= 200))),
    CONSTRAINT prr_cases_invite_email_check CHECK (((invite_email IS NULL) OR ((char_length(invite_email) <= 120) AND (invite_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)))),
    CONSTRAINT prr_cases_kind_check CHECK ((kind = ANY (ARRAY['JOIN'::text, 'LEAVE'::text]))),
    CONSTRAINT prr_cases_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT prr_cases_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'DONE'::text, 'CANCELED'::text])))
);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN id SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN employee_id SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN kind SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN state SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN target_on SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN invite_email SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN invited_at SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN note SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN opened_by SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN opened_at SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN closed_by SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN closed_at SET (pg_attver=180503888);
ALTER TABLE ONLY public.prr_cases ALTER COLUMN close_note SET (pg_attver=180503888);



CREATE SEQUENCE public.prr_cases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.prr_cases_id_seq OWNED BY public.prr_cases.id;



CREATE TABLE public.prr_review_items (
    id bigint NOT NULL,
    quarter date NOT NULL,
    kind text NOT NULL,
    account_id uuid NOT NULL,
    target_kind text NOT NULL,
    target text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    state text DEFAULT 'OPEN'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decide_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prr_review_items_decide_note_check CHECK (((decide_note IS NULL) OR (char_length(decide_note) <= 200))),
    CONSTRAINT prr_review_items_kind_check CHECK ((kind = ANY (ARRAY['LEFT_STAFF'::text, 'LOGIN_IDLE'::text, 'GROUP_IDLE'::text, 'EXTERNAL_NO_EXPIRY'::text, 'ROLE_GONE'::text, 'EXPIRED_LEFTOVER'::text]))),
    CONSTRAINT prr_review_items_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'REVOKED'::text, 'KEPT'::text, 'GONE'::text]))),
    CONSTRAINT prr_review_items_target_check CHECK (((char_length(target) >= 1) AND (char_length(target) <= 60))),
    CONSTRAINT prr_review_items_target_kind_check CHECK ((target_kind = ANY (ARRAY['ROLE'::text, 'GROUP'::text, 'OVERRIDE'::text])))
);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN id SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN quarter SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN kind SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN account_id SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN target_kind SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN target SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN detail SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN state SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN decided_by SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN decided_at SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN decide_note SET (pg_attver=180441624);
ALTER TABLE ONLY public.prr_review_items ALTER COLUMN created_at SET (pg_attver=180441624);



CREATE SEQUENCE public.prr_review_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.prr_review_items_id_seq OWNED BY public.prr_review_items.id;



CREATE TABLE public.prr_reviews (
    quarter date NOT NULL,
    first_built_at timestamp with time zone DEFAULT now() NOT NULL,
    last_built_at timestamp with time zone DEFAULT now() NOT NULL,
    last_built_by uuid,
    runs integer DEFAULT 1 NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT prr_reviews_quarter_check CHECK (((EXTRACT(day FROM quarter) = (1)::numeric) AND (EXTRACT(month FROM quarter) = ANY (ARRAY[(1)::numeric, (4)::numeric, (7)::numeric, (10)::numeric])))),
    CONSTRAINT prr_reviews_runs_check CHECK ((runs >= 1))
);
ALTER TABLE ONLY public.prr_reviews ALTER COLUMN quarter SET (pg_attver=180413944);
ALTER TABLE ONLY public.prr_reviews ALTER COLUMN first_built_at SET (pg_attver=180413944);
ALTER TABLE ONLY public.prr_reviews ALTER COLUMN last_built_at SET (pg_attver=180413944);
ALTER TABLE ONLY public.prr_reviews ALTER COLUMN last_built_by SET (pg_attver=180413944);
ALTER TABLE ONLY public.prr_reviews ALTER COLUMN runs SET (pg_attver=180413944);
ALTER TABLE ONLY public.prr_reviews ALTER COLUMN counts SET (pg_attver=180413944);



CREATE TABLE public.prr_task_use (
    account_id uuid NOT NULL,
    task_key text NOT NULL,
    last_on date NOT NULL
);
ALTER TABLE ONLY public.prr_task_use ALTER COLUMN account_id SET (pg_attver=180386440);
ALTER TABLE ONLY public.prr_task_use ALTER COLUMN task_key SET (pg_attver=180386440);
ALTER TABLE ONLY public.prr_task_use ALTER COLUMN last_on SET (pg_attver=180386440);



CREATE TABLE public.qlt_claim_logs (
    id bigint NOT NULL,
    claim_id bigint NOT NULL,
    kind text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT qlt_claim_logs_kind_check CHECK ((kind = ANY (ARRAY['CREATE'::text, 'EDIT'::text, 'STATE'::text, 'RETURN'::text, 'CLOSE'::text]))),
    CONSTRAINT qlt_claim_logs_note_check CHECK (((note IS NULL) OR (char_length(note) <= 400)))
);
ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN id SET (pg_attver=172859552);
ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN claim_id SET (pg_attver=172859552);
ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN kind SET (pg_attver=172859552);
ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN note SET (pg_attver=172859552);
ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN created_by SET (pg_attver=172859552);
ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN created_at SET (pg_attver=172859552);



CREATE SEQUENCE public.qlt_claim_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_claim_logs_id_seq OWNED BY public.qlt_claim_logs.id;



CREATE TABLE public.qlt_claims (
    id bigint NOT NULL,
    received_on date NOT NULL,
    source text NOT NULL,
    product_id uuid NOT NULL,
    option_id uuid,
    lot_id bigint,
    party_id bigint,
    order_id uuid,
    qty integer NOT NULL,
    defect_type text NOT NULL,
    title text NOT NULL,
    detail text,
    cause text,
    action text,
    state text DEFAULT 'OPEN'::text NOT NULL,
    close_note text,
    closed_at timestamp with time zone,
    sup_return_qty integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_qlt_claim_closed CHECK (((state = ANY (ARRAY['CLOSED'::text, 'REJECTED'::text])) = (closed_at IS NOT NULL))),
    CONSTRAINT ck_qlt_claim_done CHECK (((state <> 'CLOSED'::text) OR ((char_length(btrim(COALESCE(cause, ''::text))) >= 2) AND (char_length(btrim(COALESCE(action, ''::text))) >= 2)))),
    CONSTRAINT ck_qlt_claim_reject CHECK (((state <> 'REJECTED'::text) OR (char_length(btrim(COALESCE(close_note, ''::text))) >= 2))),
    CONSTRAINT ck_qlt_claim_return CHECK ((sup_return_qty <= qty)),
    CONSTRAINT qlt_claims_action_check CHECK (((action IS NULL) OR (char_length(action) <= 1000))),
    CONSTRAINT qlt_claims_cause_check CHECK (((cause IS NULL) OR (char_length(cause) <= 1000))),
    CONSTRAINT qlt_claims_close_note_check CHECK (((close_note IS NULL) OR (char_length(close_note) <= 400))),
    CONSTRAINT qlt_claims_defect_type_check CHECK ((defect_type = ANY (ARRAY['DAMAGE'::text, 'EXPIRY'::text, 'FOREIGN'::text, 'LABEL'::text, 'QUALITY'::text, 'MISSING'::text, 'OTHER'::text]))),
    CONSTRAINT qlt_claims_detail_check CHECK (((detail IS NULL) OR (char_length(detail) <= 2000))),
    CONSTRAINT qlt_claims_qty_check CHECK (((qty >= 1) AND (qty <= 1000000))),
    CONSTRAINT qlt_claims_source_check CHECK ((source = ANY (ARRAY['CUSTOMER'::text, 'INSPECTION'::text, 'SUPPLIER'::text, 'INTERNAL'::text]))),
    CONSTRAINT qlt_claims_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'CHECKING'::text, 'ACTION'::text, 'CLOSED'::text, 'REJECTED'::text]))),
    CONSTRAINT qlt_claims_sup_return_qty_check CHECK ((sup_return_qty >= 0)),
    CONSTRAINT qlt_claims_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 100)))
);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN id SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN received_on SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN source SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN product_id SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN option_id SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN lot_id SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN party_id SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN order_id SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN qty SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN defect_type SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN title SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN detail SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN cause SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN action SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN state SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN close_note SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN closed_at SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN sup_return_qty SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN created_by SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN created_at SET (pg_attver=172762160);
ALTER TABLE ONLY public.qlt_claims ALTER COLUMN updated_at SET (pg_attver=172762160);



CREATE SEQUENCE public.qlt_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_claims_id_seq OWNED BY public.qlt_claims.id;



CREATE TABLE public.qlt_lot_count_lines (
    count_id bigint NOT NULL,
    lot_id bigint NOT NULL,
    expected integer NOT NULL,
    counted integer,
    book_qty integer,
    counted_by uuid,
    counted_at timestamp with time zone,
    note text,
    added_late boolean DEFAULT false NOT NULL,
    adjusted_at timestamp with time zone,
    adjust_move_id bigint,
    CONSTRAINT ck_qlt_cnt_line_adj CHECK (((adjusted_at IS NULL) OR (counted IS NOT NULL))),
    CONSTRAINT ck_qlt_cnt_line_pair CHECK ((((counted IS NULL) = (counted_at IS NULL)) AND ((counted IS NULL) = (book_qty IS NULL)))),
    CONSTRAINT qlt_lot_count_lines_book_qty_check CHECK (((book_qty IS NULL) OR (book_qty >= 0))),
    CONSTRAINT qlt_lot_count_lines_counted_check CHECK (((counted IS NULL) OR ((counted >= 0) AND (counted <= 1000000)))),
    CONSTRAINT qlt_lot_count_lines_expected_check CHECK ((expected >= 0)),
    CONSTRAINT qlt_lot_count_lines_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200)))
);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN count_id SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN lot_id SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN expected SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN counted SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN book_qty SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN counted_by SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN counted_at SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN note SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN added_late SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN adjusted_at SET (pg_attver=176837552);
ALTER TABLE ONLY public.qlt_lot_count_lines ALTER COLUMN adjust_move_id SET (pg_attver=176837552);



CREATE TABLE public.qlt_lot_counts (
    id bigint NOT NULL,
    title text NOT NULL,
    state text DEFAULT 'OPEN'::text NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    CONSTRAINT ck_qlt_cnt_closed CHECK (((state = 'CLOSED'::text) = (closed_at IS NOT NULL))),
    CONSTRAINT qlt_lot_counts_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT qlt_lot_counts_state_check CHECK ((state = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))),
    CONSTRAINT qlt_lot_counts_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 60)))
);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN id SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN title SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN state SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN note SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN created_by SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN created_at SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN closed_by SET (pg_attver=176800472);
ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN closed_at SET (pg_attver=176800472);



CREATE SEQUENCE public.qlt_lot_counts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_lot_counts_id_seq OWNED BY public.qlt_lot_counts.id;



CREATE TABLE public.qlt_lot_moves (
    id bigint NOT NULL,
    lot_id bigint NOT NULL,
    kind text NOT NULL,
    qty integer NOT NULL,
    qty_after integer DEFAULT 0 NOT NULL,
    move_id bigint,
    order_item_id uuid,
    claim_id bigint,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_qlt_lot_move_sign CHECK ((((kind = ANY (ARRAY['IN'::text, 'OPEN'::text, 'RETURN'::text])) AND (qty > 0)) OR ((kind = ANY (ARRAY['OUT'::text, 'SUP_RETURN'::text])) AND (qty < 0)) OR ((kind = 'ADJUST'::text) AND (qty <> 0)))),
    CONSTRAINT qlt_lot_moves_kind_check CHECK ((kind = ANY (ARRAY['IN'::text, 'OPEN'::text, 'OUT'::text, 'RETURN'::text, 'ADJUST'::text, 'SUP_RETURN'::text]))),
    CONSTRAINT qlt_lot_moves_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT qlt_lot_moves_qty_after_check CHECK ((qty_after >= 0))
);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN id SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN lot_id SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN kind SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN qty SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN qty_after SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN move_id SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN order_item_id SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN claim_id SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN note SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN created_by SET (pg_attver=172616608);
ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN created_at SET (pg_attver=172616608);



CREATE SEQUENCE public.qlt_lot_moves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_lot_moves_id_seq OWNED BY public.qlt_lot_moves.id;



CREATE TABLE public.qlt_lot_picks (
    id bigint NOT NULL,
    order_item_id uuid NOT NULL,
    lot_id bigint NOT NULL,
    qty integer NOT NULL,
    consumed_move_id bigint,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT qlt_lot_picks_qty_check CHECK (((qty >= 1) AND (qty <= 1000000)))
);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN id SET (pg_attver=172702312);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN order_item_id SET (pg_attver=172702312);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN lot_id SET (pg_attver=172702312);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN qty SET (pg_attver=172702312);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN consumed_move_id SET (pg_attver=172702312);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN created_by SET (pg_attver=172702312);
ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN created_at SET (pg_attver=172702312);



CREATE SEQUENCE public.qlt_lot_picks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_lot_picks_id_seq OWNED BY public.qlt_lot_picks.id;



CREATE TABLE public.qlt_lot_products (
    product_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    on_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.qlt_lot_products ALTER COLUMN product_id SET (pg_attver=172508552);
ALTER TABLE ONLY public.qlt_lot_products ALTER COLUMN active SET (pg_attver=172508552);
ALTER TABLE ONLY public.qlt_lot_products ALTER COLUMN on_at SET (pg_attver=172508552);
ALTER TABLE ONLY public.qlt_lot_products ALTER COLUMN updated_by SET (pg_attver=172508552);
ALTER TABLE ONLY public.qlt_lot_products ALTER COLUMN updated_at SET (pg_attver=172508552);



CREATE TABLE public.qlt_lots (
    id bigint NOT NULL,
    option_id uuid NOT NULL,
    product_id uuid,
    lot_no text NOT NULL,
    made_on date,
    expires_on date NOT NULL,
    in_kind text NOT NULL,
    in_qty integer NOT NULL,
    in_move_id bigint,
    party_id bigint,
    po_id bigint,
    state text DEFAULT 'OK'::text NOT NULL,
    state_note text,
    memo text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_qlt_lot_dates CHECK (((made_on IS NULL) OR (made_on <= expires_on))),
    CONSTRAINT ck_qlt_lot_in CHECK (((in_kind = 'MOVE'::text) = (in_move_id IS NOT NULL))),
    CONSTRAINT ck_qlt_lot_note CHECK (((state <> ALL (ARRAY['HOLD'::text, 'RECALL'::text])) OR (char_length(btrim(COALESCE(state_note, ''::text))) >= 2))),
    CONSTRAINT qlt_lots_in_kind_check CHECK ((in_kind = ANY (ARRAY['MOVE'::text, 'OPEN'::text]))),
    CONSTRAINT qlt_lots_in_qty_check CHECK (((in_qty >= 1) AND (in_qty <= 1000000))),
    CONSTRAINT qlt_lots_lot_no_check CHECK ((lot_no ~ '^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$'::text)),
    CONSTRAINT qlt_lots_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 200))),
    CONSTRAINT qlt_lots_state_check CHECK ((state = ANY (ARRAY['OK'::text, 'HOLD'::text, 'RECALL'::text, 'CLOSED'::text]))),
    CONSTRAINT qlt_lots_state_note_check CHECK (((state_note IS NULL) OR (char_length(state_note) <= 200)))
);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN id SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN option_id SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN product_id SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN lot_no SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN made_on SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN expires_on SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN in_kind SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN in_qty SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN in_move_id SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN party_id SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN po_id SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN state SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN state_note SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN memo SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN created_by SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN created_at SET (pg_attver=172532608);
ALTER TABLE ONLY public.qlt_lots ALTER COLUMN updated_at SET (pg_attver=172532608);



CREATE SEQUENCE public.qlt_lots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_lots_id_seq OWNED BY public.qlt_lots.id;



CREATE TABLE public.qlt_move_marks (
    move_id bigint NOT NULL,
    mark text NOT NULL,
    short_qty integer DEFAULT 0 NOT NULL,
    note text,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_qlt_mark_short CHECK (((mark = 'SHORT'::text) = (short_qty > 0))),
    CONSTRAINT qlt_move_marks_mark_check CHECK ((mark = ANY (ARRAY['DONE'::text, 'SHORT'::text, 'SKIP'::text]))),
    CONSTRAINT qlt_move_marks_note_check CHECK (((note IS NULL) OR (char_length(note) <= 200))),
    CONSTRAINT qlt_move_marks_short_qty_check CHECK ((short_qty >= 0))
);
ALTER TABLE ONLY public.qlt_move_marks ALTER COLUMN move_id SET (pg_attver=172671312);
ALTER TABLE ONLY public.qlt_move_marks ALTER COLUMN mark SET (pg_attver=172671312);
ALTER TABLE ONLY public.qlt_move_marks ALTER COLUMN short_qty SET (pg_attver=172671312);
ALTER TABLE ONLY public.qlt_move_marks ALTER COLUMN note SET (pg_attver=172671312);
ALTER TABLE ONLY public.qlt_move_marks ALTER COLUMN marked_at SET (pg_attver=172671312);



CREATE TABLE public.qlt_po_due (
    po_id bigint NOT NULL,
    due_on date NOT NULL,
    set_by uuid,
    set_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.qlt_po_due ALTER COLUMN po_id SET (pg_attver=172403624);
ALTER TABLE ONLY public.qlt_po_due ALTER COLUMN due_on SET (pg_attver=172403624);
ALTER TABLE ONLY public.qlt_po_due ALTER COLUMN set_by SET (pg_attver=172403624);
ALTER TABLE ONLY public.qlt_po_due ALTER COLUMN set_at SET (pg_attver=172403624);



CREATE TABLE public.qlt_sup_evals (
    id bigint NOT NULL,
    party_id bigint NOT NULL,
    period text NOT NULL,
    po_count integer DEFAULT 0 NOT NULL,
    on_time integer DEFAULT 0 NOT NULL,
    late_days numeric(6,1) DEFAULT 0 NOT NULL,
    claim_count integer DEFAULT 0 NOT NULL,
    delivery_score smallint NOT NULL,
    quality_score smallint NOT NULL,
    price_score smallint NOT NULL,
    response_score smallint NOT NULL,
    weights text NOT NULL,
    total numeric(5,1) NOT NULL,
    grade text NOT NULL,
    memo text,
    state text DEFAULT 'DRAFT'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    CONSTRAINT ck_qlt_sup_eval_final CHECK (((state = 'FINAL'::text) = (confirmed_at IS NOT NULL))),
    CONSTRAINT ck_qlt_sup_eval_on_time CHECK ((on_time <= po_count)),
    CONSTRAINT qlt_sup_evals_claim_count_check CHECK ((claim_count >= 0)),
    CONSTRAINT qlt_sup_evals_delivery_score_check CHECK (((delivery_score >= 0) AND (delivery_score <= 100))),
    CONSTRAINT qlt_sup_evals_grade_check CHECK ((grade = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text]))),
    CONSTRAINT qlt_sup_evals_late_days_check CHECK ((late_days >= (0)::numeric)),
    CONSTRAINT qlt_sup_evals_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT qlt_sup_evals_on_time_check CHECK ((on_time >= 0)),
    CONSTRAINT qlt_sup_evals_period_check CHECK ((period ~ '^[0-9]{4}-Q[1-4]$'::text)),
    CONSTRAINT qlt_sup_evals_po_count_check CHECK ((po_count >= 0)),
    CONSTRAINT qlt_sup_evals_price_score_check CHECK (((price_score >= 0) AND (price_score <= 100))),
    CONSTRAINT qlt_sup_evals_quality_score_check CHECK (((quality_score >= 0) AND (quality_score <= 100))),
    CONSTRAINT qlt_sup_evals_response_score_check CHECK (((response_score >= 0) AND (response_score <= 100))),
    CONSTRAINT qlt_sup_evals_state_check CHECK ((state = ANY (ARRAY['DRAFT'::text, 'FINAL'::text]))),
    CONSTRAINT qlt_sup_evals_total_check CHECK (((total >= (0)::numeric) AND (total <= (100)::numeric))),
    CONSTRAINT qlt_sup_evals_weights_check CHECK ((weights ~ '^[0-9]{1,3},[0-9]{1,3},[0-9]{1,3},[0-9]{1,3}$'::text))
);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN id SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN party_id SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN period SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN po_count SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN on_time SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN late_days SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN claim_count SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN delivery_score SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN quality_score SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN price_score SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN response_score SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN weights SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN total SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN grade SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN memo SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN state SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN created_by SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN created_at SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN updated_at SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN confirmed_by SET (pg_attver=172426136);
ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN confirmed_at SET (pg_attver=172426136);



CREATE SEQUENCE public.qlt_sup_evals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.qlt_sup_evals_id_seq OWNED BY public.qlt_sup_evals.id;



CREATE TABLE public.sal_opp_logs (
    id bigint NOT NULL,
    opp_id bigint NOT NULL,
    kind text NOT NULL,
    from_stage text,
    to_stage text,
    note text,
    actor uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sal_opp_logs_kind_check CHECK ((kind = ANY (ARRAY['CREATE'::text, 'STAGE'::text, 'NOTE'::text, 'EDIT'::text, 'QUOTE'::text]))),
    CONSTRAINT sal_opp_logs_note_check CHECK (((note IS NULL) OR (char_length(note) <= 400)))
);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN id SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN opp_id SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN kind SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN from_stage SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN to_stage SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN note SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN actor SET (pg_attver=169060344);
ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN created_at SET (pg_attver=169060344);



CREATE SEQUENCE public.sal_opp_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.sal_opp_logs_id_seq OWNED BY public.sal_opp_logs.id;



CREATE TABLE public.sal_opps (
    id bigint NOT NULL,
    party_id bigint NOT NULL,
    title text NOT NULL,
    stage text DEFAULT 'LEAD'::text NOT NULL,
    expected_amount bigint DEFAULT 0 NOT NULL,
    owner_id uuid,
    next_action text,
    next_action_on date,
    expected_close_on date,
    quote_doc_id uuid,
    memo text,
    lost_reason text,
    closed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_sal_opp_closed CHECK (((stage = ANY (ARRAY['WON'::text, 'LOST'::text])) = (closed_at IS NOT NULL))),
    CONSTRAINT ck_sal_opp_lost CHECK (((stage <> 'LOST'::text) OR (char_length(btrim(COALESCE(lost_reason, ''::text))) >= 2))),
    CONSTRAINT sal_opps_expected_amount_check CHECK (((expected_amount >= 0) AND (expected_amount <= '1000000000000'::bigint))),
    CONSTRAINT sal_opps_lost_reason_check CHECK (((lost_reason IS NULL) OR (char_length(lost_reason) <= 200))),
    CONSTRAINT sal_opps_memo_check CHECK (((memo IS NULL) OR (char_length(memo) <= 400))),
    CONSTRAINT sal_opps_next_action_check CHECK (((next_action IS NULL) OR (char_length(next_action) <= 200))),
    CONSTRAINT sal_opps_stage_check CHECK ((stage = ANY (ARRAY['LEAD'::text, 'QUOTE'::text, 'CONTRACT'::text, 'WON'::text, 'LOST'::text]))),
    CONSTRAINT sal_opps_title_check CHECK (((char_length(btrim(title)) >= 2) AND (char_length(btrim(title)) <= 120)))
);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN id SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN party_id SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN title SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN stage SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN expected_amount SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN owner_id SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN next_action SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN next_action_on SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN expected_close_on SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN quote_doc_id SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN memo SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN lost_reason SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN closed_at SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN created_by SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN created_at SET (pg_attver=168994800);
ALTER TABLE ONLY public.sal_opps ALTER COLUMN updated_at SET (pg_attver=168994800);



CREATE SEQUENCE public.sal_opps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



ALTER SEQUENCE public.sal_opps_id_seq OWNED BY public.sal_opps.id;



ALTER TABLE ONLY public.acct_accountant_access ALTER COLUMN id SET DEFAULT nextval('public.acct_accountant_access_id_seq'::regclass);



ALTER TABLE ONLY public.acct_accountant_notes ALTER COLUMN id SET DEFAULT nextval('public.acct_accountant_notes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_accountant_replies ALTER COLUMN id SET DEFAULT nextval('public.acct_accountant_replies_id_seq'::regclass);



ALTER TABLE ONLY public.acct_approval_line_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_approval_line_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_approval_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_approval_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_approval_steps ALTER COLUMN id SET DEFAULT nextval('public.acct_approval_steps_id_seq'::regclass);



ALTER TABLE ONLY public.acct_archives ALTER COLUMN id SET DEFAULT nextval('public.acct_archives_id_seq'::regclass);



ALTER TABLE ONLY public.acct_assets ALTER COLUMN id SET DEFAULT nextval('public.acct_assets_id_seq'::regclass);



ALTER TABLE ONLY public.acct_attendance ALTER COLUMN id SET DEFAULT nextval('public.acct_attendance_id_seq'::regclass);



ALTER TABLE ONLY public.acct_attendance_fixes ALTER COLUMN id SET DEFAULT nextval('public.acct_attendance_fixes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_bank_feed_accounts ALTER COLUMN id SET DEFAULT nextval('public.acct_bank_feed_accounts_id_seq'::regclass);



ALTER TABLE ONLY public.acct_bank_feed_runs ALTER COLUMN id SET DEFAULT nextval('public.acct_bank_feed_runs_id_seq'::regclass);



ALTER TABLE ONLY public.acct_bank_txns ALTER COLUMN id SET DEFAULT nextval('public.acct_bank_txns_id_seq'::regclass);



ALTER TABLE ONLY public.acct_bank_uploads ALTER COLUMN id SET DEFAULT nextval('public.acct_bank_uploads_id_seq'::regclass);



ALTER TABLE ONLY public.acct_budget_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_budget_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_card_limit_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_card_limit_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_card_txns ALTER COLUMN id SET DEFAULT nextval('public.acct_card_txns_id_seq'::regclass);



ALTER TABLE ONLY public.acct_card_uploads ALTER COLUMN id SET DEFAULT nextval('public.acct_card_uploads_id_seq'::regclass);



ALTER TABLE ONLY public.acct_cash_balances ALTER COLUMN id SET DEFAULT nextval('public.acct_cash_balances_id_seq'::regclass);



ALTER TABLE ONLY public.acct_cash_plans ALTER COLUMN id SET DEFAULT nextval('public.acct_cash_plans_id_seq'::regclass);



ALTER TABLE ONLY public.acct_contract_accruals ALTER COLUMN id SET DEFAULT nextval('public.acct_contract_accruals_id_seq'::regclass);



ALTER TABLE ONLY public.acct_contract_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_contract_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_contracts ALTER COLUMN id SET DEFAULT nextval('public.acct_contracts_id_seq'::regclass);



ALTER TABLE ONLY public.acct_depreciations ALTER COLUMN id SET DEFAULT nextval('public.acct_depreciations_id_seq'::regclass);



ALTER TABLE ONLY public.acct_depts ALTER COLUMN id SET DEFAULT nextval('public.acct_depts_id_seq'::regclass);



ALTER TABLE ONLY public.acct_dunning_sends ALTER COLUMN id SET DEFAULT nextval('public.acct_dunning_sends_id_seq'::regclass);



ALTER TABLE ONLY public.acct_employees ALTER COLUMN id SET DEFAULT nextval('public.acct_employees_id_seq'::regclass);



ALTER TABLE ONLY public.acct_entries ALTER COLUMN id SET DEFAULT nextval('public.acct_entries_id_seq'::regclass);



ALTER TABLE ONLY public.acct_entry_reversals ALTER COLUMN id SET DEFAULT nextval('public.acct_entry_reversals_id_seq'::regclass);



ALTER TABLE ONLY public.acct_expense_claims ALTER COLUMN id SET DEFAULT nextval('public.acct_expense_claims_id_seq'::regclass);



ALTER TABLE ONLY public.acct_export_formats ALTER COLUMN id SET DEFAULT nextval('public.acct_export_formats_id_seq'::regclass);



ALTER TABLE ONLY public.acct_export_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_export_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_exports ALTER COLUMN id SET DEFAULT nextval('public.acct_exports_id_seq'::regclass);



ALTER TABLE ONLY public.acct_fx_revals ALTER COLUMN id SET DEFAULT nextval('public.acct_fx_revals_id_seq'::regclass);



ALTER TABLE ONLY public.acct_import_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_import_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_imports ALTER COLUMN id SET DEFAULT nextval('public.acct_imports_id_seq'::regclass);



ALTER TABLE ONLY public.acct_insurance_done ALTER COLUMN id SET DEFAULT nextval('public.acct_insurance_done_id_seq'::regclass);



ALTER TABLE ONLY public.acct_leave_grants ALTER COLUMN id SET DEFAULT nextval('public.acct_leave_grants_id_seq'::regclass);



ALTER TABLE ONLY public.acct_leave_requests ALTER COLUMN id SET DEFAULT nextval('public.acct_leave_requests_id_seq'::regclass);



ALTER TABLE ONLY public.acct_leave_uses ALTER COLUMN id SET DEFAULT nextval('public.acct_leave_uses_id_seq'::regclass);



ALTER TABLE ONLY public.acct_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_manual_entries ALTER COLUMN id SET DEFAULT nextval('public.acct_manual_entries_id_seq'::regclass);



ALTER TABLE ONLY public.acct_opening ALTER COLUMN id SET DEFAULT nextval('public.acct_opening_id_seq'::regclass);



ALTER TABLE ONLY public.acct_opening_sets ALTER COLUMN id SET DEFAULT nextval('public.acct_opening_sets_id_seq'::regclass);



ALTER TABLE ONLY public.acct_parties ALTER COLUMN id SET DEFAULT nextval('public.acct_parties_id_seq'::regclass);



ALTER TABLE ONLY public.acct_payroll_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_payroll_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_payroll_rate_log ALTER COLUMN id SET DEFAULT nextval('public.acct_payroll_rate_log_id_seq'::regclass);



ALTER TABLE ONLY public.acct_payroll_runs ALTER COLUMN id SET DEFAULT nextval('public.acct_payroll_runs_id_seq'::regclass);



ALTER TABLE ONLY public.acct_payslip_mails ALTER COLUMN id SET DEFAULT nextval('public.acct_payslip_mails_id_seq'::regclass);



ALTER TABLE ONLY public.acct_pg_txns ALTER COLUMN id SET DEFAULT nextval('public.acct_pg_txns_id_seq'::regclass);



ALTER TABLE ONLY public.acct_pg_uploads ALTER COLUMN id SET DEFAULT nextval('public.acct_pg_uploads_id_seq'::regclass);



ALTER TABLE ONLY public.acct_po_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_po_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_pos ALTER COLUMN id SET DEFAULT nextval('public.acct_pos_id_seq'::regclass);



ALTER TABLE ONLY public.acct_projects ALTER COLUMN id SET DEFAULT nextval('public.acct_projects_id_seq'::regclass);



ALTER TABLE ONLY public.acct_purchases ALTER COLUMN id SET DEFAULT nextval('public.acct_purchases_id_seq'::regclass);



ALTER TABLE ONLY public.acct_receipt_promises ALTER COLUMN id SET DEFAULT nextval('public.acct_receipt_promises_id_seq'::regclass);



ALTER TABLE ONLY public.acct_receipt_reads ALTER COLUMN id SET DEFAULT nextval('public.acct_receipt_reads_id_seq'::regclass);



ALTER TABLE ONLY public.acct_reorder_draft_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_reorder_draft_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_reorder_drafts ALTER COLUMN id SET DEFAULT nextval('public.acct_reorder_drafts_id_seq'::regclass);



ALTER TABLE ONLY public.acct_requisitions ALTER COLUMN id SET DEFAULT nextval('public.acct_requisitions_id_seq'::regclass);



ALTER TABLE ONLY public.acct_rule_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_rule_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_sales_doc_lines ALTER COLUMN id SET DEFAULT nextval('public.acct_sales_doc_lines_id_seq'::regclass);



ALTER TABLE ONLY public.acct_sales_targets ALTER COLUMN id SET DEFAULT nextval('public.acct_sales_targets_id_seq'::regclass);



ALTER TABLE ONLY public.acct_severance_runs ALTER COLUMN id SET DEFAULT nextval('public.acct_severance_runs_id_seq'::regclass);



ALTER TABLE ONLY public.acct_stock_moves ALTER COLUMN id SET DEFAULT nextval('public.acct_stock_moves_id_seq'::regclass);



ALTER TABLE ONLY public.acct_stock_transfers ALTER COLUMN id SET DEFAULT nextval('public.acct_stock_transfers_id_seq'::regclass);



ALTER TABLE ONLY public.acct_tag_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_tag_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_target_changes ALTER COLUMN id SET DEFAULT nextval('public.acct_target_changes_id_seq'::regclass);



ALTER TABLE ONLY public.acct_tax_inbox ALTER COLUMN id SET DEFAULT nextval('public.acct_tax_inbox_id_seq'::regclass);



ALTER TABLE ONLY public.acct_tax_inbox_fetches ALTER COLUMN id SET DEFAULT nextval('public.acct_tax_inbox_fetches_id_seq'::regclass);



ALTER TABLE ONLY public.acct_transfer_batches ALTER COLUMN id SET DEFAULT nextval('public.acct_transfer_batches_id_seq'::regclass);



ALTER TABLE ONLY public.acct_transfer_items ALTER COLUMN id SET DEFAULT nextval('public.acct_transfer_items_id_seq'::regclass);



ALTER TABLE ONLY public.acct_vehicle_costs ALTER COLUMN id SET DEFAULT nextval('public.acct_vehicle_costs_id_seq'::regclass);



ALTER TABLE ONLY public.acct_vehicle_trips ALTER COLUMN id SET DEFAULT nextval('public.acct_vehicle_trips_id_seq'::regclass);



ALTER TABLE ONLY public.acct_vehicles ALTER COLUMN id SET DEFAULT nextval('public.acct_vehicles_id_seq'::regclass);



ALTER TABLE ONLY public.acct_warehouses ALTER COLUMN id SET DEFAULT nextval('public.acct_warehouses_id_seq'::regclass);



ALTER TABLE ONLY public.acct_year_closings ALTER COLUMN id SET DEFAULT nextval('public.acct_year_closings_id_seq'::regclass);



ALTER TABLE ONLY public.acct_yearend_checks ALTER COLUMN id SET DEFAULT nextval('public.acct_yearend_checks_id_seq'::regclass);



ALTER TABLE ONLY public.corp_doc_versions ALTER COLUMN id SET DEFAULT nextval('public.corp_doc_versions_id_seq'::regclass);



ALTER TABLE ONLY public.corp_docs ALTER COLUMN id SET DEFAULT nextval('public.corp_docs_id_seq'::regclass);



ALTER TABLE ONLY public.hr_applicant_purges ALTER COLUMN id SET DEFAULT nextval('public.hr_applicant_purges_id_seq'::regclass);



ALTER TABLE ONLY public.hr_applicants ALTER COLUMN id SET DEFAULT nextval('public.hr_applicants_id_seq'::regclass);



ALTER TABLE ONLY public.hr_contract_templates ALTER COLUMN id SET DEFAULT nextval('public.hr_contract_templates_id_seq'::regclass);



ALTER TABLE ONLY public.hr_contracts ALTER COLUMN id SET DEFAULT nextval('public.hr_contracts_id_seq'::regclass);



ALTER TABLE ONLY public.hr_interviews ALTER COLUMN id SET DEFAULT nextval('public.hr_interviews_id_seq'::regclass);



ALTER TABLE ONLY public.hr_job_postings ALTER COLUMN id SET DEFAULT nextval('public.hr_job_postings_id_seq'::regclass);



ALTER TABLE ONLY public.hr_review_cycles ALTER COLUMN id SET DEFAULT nextval('public.hr_review_cycles_id_seq'::regclass);



ALTER TABLE ONLY public.hr_review_goals ALTER COLUMN id SET DEFAULT nextval('public.hr_review_goals_id_seq'::regclass);



ALTER TABLE ONLY public.hr_training_records ALTER COLUMN id SET DEFAULT nextval('public.hr_training_records_id_seq'::regclass);



ALTER TABLE ONLY public.hra_bank_formats ALTER COLUMN id SET DEFAULT nextval('public.hra_bank_formats_id_seq'::regclass);



ALTER TABLE ONLY public.hra_close_marks ALTER COLUMN id SET DEFAULT nextval('public.hra_close_marks_id_seq'::regclass);



ALTER TABLE ONLY public.hra_leave_promos ALTER COLUMN id SET DEFAULT nextval('public.hra_leave_promos_id_seq'::regclass);



ALTER TABLE ONLY public.hra_lib_posts ALTER COLUMN id SET DEFAULT nextval('public.hra_lib_posts_id_seq'::regclass);



ALTER TABLE ONLY public.hra_lib_revisions ALTER COLUMN id SET DEFAULT nextval('public.hra_lib_revisions_id_seq'::regclass);



ALTER TABLE ONLY public.hra_pay_bank_changes ALTER COLUMN id SET DEFAULT nextval('public.hra_pay_bank_changes_id_seq'::regclass);



ALTER TABLE ONLY public.hra_payfile_logs ALTER COLUMN id SET DEFAULT nextval('public.hra_payfile_logs_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_bookings ALTER COLUMN id SET DEFAULT nextval('public.hrx_bookings_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_ot_pay_links ALTER COLUMN id SET DEFAULT nextval('public.hrx_ot_pay_links_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_ot_requests ALTER COLUMN id SET DEFAULT nextval('public.hrx_ot_requests_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_resources ALTER COLUMN id SET DEFAULT nextval('public.hrx_resources_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_shifts ALTER COLUMN id SET DEFAULT nextval('public.hrx_shifts_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_stocktake_lines ALTER COLUMN id SET DEFAULT nextval('public.hrx_stocktake_lines_id_seq'::regclass);



ALTER TABLE ONLY public.hrx_stocktakes ALTER COLUMN id SET DEFAULT nextval('public.hrx_stocktakes_id_seq'::regclass);



ALTER TABLE ONLY public.its_assets ALTER COLUMN id SET DEFAULT nextval('public.its_assets_id_seq'::regclass);



ALTER TABLE ONLY public.its_key_events ALTER COLUMN id SET DEFAULT nextval('public.its_key_events_id_seq'::regclass);



ALTER TABLE ONLY public.its_suggestion_log ALTER COLUMN id SET DEFAULT nextval('public.its_suggestion_log_id_seq'::regclass);



ALTER TABLE ONLY public.its_survey_questions ALTER COLUMN id SET DEFAULT nextval('public.its_survey_questions_id_seq'::regclass);



ALTER TABLE ONLY public.its_surveys ALTER COLUMN id SET DEFAULT nextval('public.its_surveys_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_case_costs ALTER COLUMN id SET DEFAULT nextval('public.lgl_case_costs_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_case_hearings ALTER COLUMN id SET DEFAULT nextval('public.lgl_case_hearings_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_cases ALTER COLUMN id SET DEFAULT nextval('public.lgl_cases_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_contract_reviews ALTER COLUMN id SET DEFAULT nextval('public.lgl_contract_reviews_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_insurance_policies ALTER COLUMN id SET DEFAULT nextval('public.lgl_insurance_policies_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_insurance_postings ALTER COLUMN id SET DEFAULT nextval('public.lgl_insurance_postings_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_license_renewals ALTER COLUMN id SET DEFAULT nextval('public.lgl_license_renewals_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_licenses ALTER COLUMN id SET DEFAULT nextval('public.lgl_licenses_id_seq'::regclass);



ALTER TABLE ONLY public.lgl_review_opinions ALTER COLUMN id SET DEFAULT nextval('public.lgl_review_opinions_id_seq'::regclass);



ALTER TABLE ONLY public.ofc_events ALTER COLUMN id SET DEFAULT nextval('public.ofc_events_id_seq'::regclass);



ALTER TABLE ONLY public.ofc_task_comments ALTER COLUMN id SET DEFAULT nextval('public.ofc_task_comments_id_seq'::regclass);



ALTER TABLE ONLY public.ofc_tasks ALTER COLUMN id SET DEFAULT nextval('public.ofc_tasks_id_seq'::regclass);



ALTER TABLE ONLY public.ofc_trip_settlements ALTER COLUMN id SET DEFAULT nextval('public.ofc_trip_settlements_id_seq'::regclass);



ALTER TABLE ONLY public.ofc_trips ALTER COLUMN id SET DEFAULT nextval('public.ofc_trips_id_seq'::regclass);



ALTER TABLE ONLY public.prr_cases ALTER COLUMN id SET DEFAULT nextval('public.prr_cases_id_seq'::regclass);



ALTER TABLE ONLY public.prr_review_items ALTER COLUMN id SET DEFAULT nextval('public.prr_review_items_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_claim_logs ALTER COLUMN id SET DEFAULT nextval('public.qlt_claim_logs_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_claims ALTER COLUMN id SET DEFAULT nextval('public.qlt_claims_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_lot_counts ALTER COLUMN id SET DEFAULT nextval('public.qlt_lot_counts_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_lot_moves ALTER COLUMN id SET DEFAULT nextval('public.qlt_lot_moves_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_lot_picks ALTER COLUMN id SET DEFAULT nextval('public.qlt_lot_picks_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_lots ALTER COLUMN id SET DEFAULT nextval('public.qlt_lots_id_seq'::regclass);



ALTER TABLE ONLY public.qlt_sup_evals ALTER COLUMN id SET DEFAULT nextval('public.qlt_sup_evals_id_seq'::regclass);



ALTER TABLE ONLY public.sal_opp_logs ALTER COLUMN id SET DEFAULT nextval('public.sal_opp_logs_id_seq'::regclass);



ALTER TABLE ONLY public.sal_opps ALTER COLUMN id SET DEFAULT nextval('public.sal_opps_id_seq'::regclass);



ALTER TABLE ONLY public.acct_accountant_access
    ADD CONSTRAINT acct_accountant_access_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_accountant_notes
    ADD CONSTRAINT acct_accountant_notes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_accountant_replies
    ADD CONSTRAINT acct_accountant_replies_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_accounts
    ADD CONSTRAINT acct_accounts_pkey PRIMARY KEY (role);



ALTER TABLE ONLY public.acct_approval_line_changes
    ADD CONSTRAINT acct_approval_line_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_approval_lines
    ADD CONSTRAINT acct_approval_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_approval_steps
    ADD CONSTRAINT acct_approval_steps_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_archives
    ADD CONSTRAINT acct_archives_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_assets
    ADD CONSTRAINT acct_assets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_assets
    ADD CONSTRAINT acct_assets_purchase_id_key UNIQUE (purchase_id);



ALTER TABLE ONLY public.acct_attendance_fixes
    ADD CONSTRAINT acct_attendance_fixes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_attendance
    ADD CONSTRAINT acct_attendance_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_bank_feed_accounts
    ADD CONSTRAINT acct_bank_feed_accounts_fintech_hash_key UNIQUE (fintech_hash);



ALTER TABLE ONLY public.acct_bank_feed_accounts
    ADD CONSTRAINT acct_bank_feed_accounts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_bank_feed_runs
    ADD CONSTRAINT acct_bank_feed_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_bank_txns
    ADD CONSTRAINT acct_bank_txns_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_bank_txns
    ADD CONSTRAINT acct_bank_txns_row_hash_key UNIQUE (row_hash);



ALTER TABLE ONLY public.acct_bank_uploads
    ADD CONSTRAINT acct_bank_uploads_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_barcodes
    ADD CONSTRAINT acct_barcodes_code_key UNIQUE (code);



ALTER TABLE ONLY public.acct_barcodes
    ADD CONSTRAINT acct_barcodes_pkey PRIMARY KEY (option_id);



ALTER TABLE ONLY public.acct_budget_changes
    ADD CONSTRAINT acct_budget_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_budgets
    ADD CONSTRAINT acct_budgets_pkey PRIMARY KEY (ym, role);



ALTER TABLE ONLY public.acct_card_limit_changes
    ADD CONSTRAINT acct_card_limit_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_card_limits
    ADD CONSTRAINT acct_card_limits_pkey PRIMARY KEY (card_tail);



ALTER TABLE ONLY public.acct_card_txns
    ADD CONSTRAINT acct_card_txns_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_card_txns
    ADD CONSTRAINT acct_card_txns_row_hash_key UNIQUE (row_hash);



ALTER TABLE ONLY public.acct_card_uploads
    ADD CONSTRAINT acct_card_uploads_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_cash_balances
    ADD CONSTRAINT acct_cash_balances_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_cash_plans
    ADD CONSTRAINT acct_cash_plans_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_closings
    ADD CONSTRAINT acct_closings_pkey PRIMARY KEY (ym);



ALTER TABLE ONLY public.acct_contract_accrual_rules
    ADD CONSTRAINT acct_contract_accrual_rules_pkey PRIMARY KEY (contract_id);



ALTER TABLE ONLY public.acct_contract_accruals
    ADD CONSTRAINT acct_contract_accruals_contract_id_ym_key UNIQUE (contract_id, ym);



ALTER TABLE ONLY public.acct_contract_accruals
    ADD CONSTRAINT acct_contract_accruals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_contract_changes
    ADD CONSTRAINT acct_contract_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_contracts
    ADD CONSTRAINT acct_contracts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_depreciations
    ADD CONSTRAINT acct_depreciations_asset_id_ym_key UNIQUE (asset_id, ym);



ALTER TABLE ONLY public.acct_depreciations
    ADD CONSTRAINT acct_depreciations_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_depts
    ADD CONSTRAINT acct_depts_code_key UNIQUE (code);



ALTER TABLE ONLY public.acct_depts
    ADD CONSTRAINT acct_depts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_doc_counters
    ADD CONSTRAINT acct_doc_counters_pkey PRIMARY KEY (kind, ym);



ALTER TABLE ONLY public.acct_dunning_sends
    ADD CONSTRAINT acct_dunning_sends_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_dunning_templates
    ADD CONSTRAINT acct_dunning_templates_pkey PRIMARY KEY (stage);



ALTER TABLE ONLY public.acct_employees
    ADD CONSTRAINT acct_employees_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_entries
    ADD CONSTRAINT acct_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_entries
    ADD CONSTRAINT acct_entries_source_source_key_key UNIQUE (source, source_key);



ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_entry_id_key UNIQUE (entry_id);



ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_manual_id_key UNIQUE (manual_id);



ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_reverse_entry_id_key UNIQUE (reverse_entry_id);



ALTER TABLE ONLY public.acct_entry_tags
    ADD CONSTRAINT acct_entry_tags_pkey PRIMARY KEY (entry_id);



ALTER TABLE ONLY public.acct_expense_claims
    ADD CONSTRAINT acct_expense_claims_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_export_formats
    ADD CONSTRAINT acct_export_formats_name_key UNIQUE (name);



ALTER TABLE ONLY public.acct_export_formats
    ADD CONSTRAINT acct_export_formats_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_export_lines
    ADD CONSTRAINT acct_export_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_exports
    ADD CONSTRAINT acct_exports_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_fx_revals
    ADD CONSTRAINT acct_fx_revals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_fx_revals
    ADD CONSTRAINT acct_fx_revals_ym_key UNIQUE (ym);



ALTER TABLE ONLY public.acct_import_lines
    ADD CONSTRAINT acct_import_lines_import_id_option_id_key UNIQUE (import_id, option_id);



ALTER TABLE ONLY public.acct_import_lines
    ADD CONSTRAINT acct_import_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_imports
    ADD CONSTRAINT acct_imports_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_insurance_done
    ADD CONSTRAINT acct_insurance_done_employee_id_kind_key UNIQUE (employee_id, kind);



ALTER TABLE ONLY public.acct_insurance_done
    ADD CONSTRAINT acct_insurance_done_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_leave_grants
    ADD CONSTRAINT acct_leave_grants_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_leave_requests
    ADD CONSTRAINT acct_leave_requests_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_leave_uses
    ADD CONSTRAINT acct_leave_uses_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_lines
    ADD CONSTRAINT acct_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_manual_entries
    ADD CONSTRAINT acct_manual_entries_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_opening
    ADD CONSTRAINT acct_opening_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_opening_sets
    ADD CONSTRAINT acct_opening_sets_as_of_key UNIQUE (as_of);



ALTER TABLE ONLY public.acct_opening_sets
    ADD CONSTRAINT acct_opening_sets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_parties
    ADD CONSTRAINT acct_parties_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_payroll_lines
    ADD CONSTRAINT acct_payroll_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_payroll_lines
    ADD CONSTRAINT acct_payroll_lines_run_id_employee_id_key UNIQUE (run_id, employee_id);



ALTER TABLE ONLY public.acct_payroll_rate_log
    ADD CONSTRAINT acct_payroll_rate_log_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_payroll_rates
    ADD CONSTRAINT acct_payroll_rates_pkey PRIMARY KEY (year, key);



ALTER TABLE ONLY public.acct_payroll_runs
    ADD CONSTRAINT acct_payroll_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_payroll_runs
    ADD CONSTRAINT acct_payroll_runs_ym_key UNIQUE (ym);



ALTER TABLE ONLY public.acct_payslip_mails
    ADD CONSTRAINT acct_payslip_mails_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_pg_txns
    ADD CONSTRAINT acct_pg_txns_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_pg_txns
    ADD CONSTRAINT acct_pg_txns_row_hash_key UNIQUE (row_hash);



ALTER TABLE ONLY public.acct_pg_uploads
    ADD CONSTRAINT acct_pg_uploads_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_po_lines
    ADD CONSTRAINT acct_po_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_pos
    ADD CONSTRAINT acct_pos_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_projects
    ADD CONSTRAINT acct_projects_code_key UNIQUE (code);



ALTER TABLE ONLY public.acct_projects
    ADD CONSTRAINT acct_projects_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_purchases
    ADD CONSTRAINT acct_purchases_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_receipt_promises
    ADD CONSTRAINT acct_receipt_promises_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_receipt_reads
    ADD CONSTRAINT acct_receipt_reads_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_reorder_draft_lines
    ADD CONSTRAINT acct_reorder_draft_lines_draft_id_option_id_key UNIQUE (draft_id, option_id);



ALTER TABLE ONLY public.acct_reorder_draft_lines
    ADD CONSTRAINT acct_reorder_draft_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_reorder_drafts
    ADD CONSTRAINT acct_reorder_drafts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_requisitions
    ADD CONSTRAINT acct_requisitions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_rule_changes
    ADD CONSTRAINT acct_rule_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_rule_dept
    ADD CONSTRAINT acct_rule_dept_pkey PRIMARY KEY (source);



ALTER TABLE ONLY public.acct_rule_evidence
    ADD CONSTRAINT acct_rule_evidence_pkey PRIMARY KEY (source);



ALTER TABLE ONLY public.acct_rule_maps
    ADD CONSTRAINT acct_rule_maps_pkey PRIMARY KEY (source, from_role);



ALTER TABLE ONLY public.acct_sales_doc_lines
    ADD CONSTRAINT acct_sales_doc_lines_doc_id_seq_key UNIQUE (doc_id, seq);



ALTER TABLE ONLY public.acct_sales_doc_lines
    ADD CONSTRAINT acct_sales_doc_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_sales_docs
    ADD CONSTRAINT acct_sales_docs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_sales_targets
    ADD CONSTRAINT acct_sales_targets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_severance_runs
    ADD CONSTRAINT acct_severance_runs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_severance_runs
    ADD CONSTRAINT acct_severance_runs_ym_key UNIQUE (ym);



ALTER TABLE ONLY public.acct_source_tags
    ADD CONSTRAINT acct_source_tags_pkey PRIMARY KEY (source, source_key);



ALTER TABLE ONLY public.acct_stock_moves
    ADD CONSTRAINT acct_stock_moves_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_stock_rules
    ADD CONSTRAINT acct_stock_rules_pkey PRIMARY KEY (option_id);



ALTER TABLE ONLY public.acct_stock_transfers
    ADD CONSTRAINT acct_stock_transfers_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_tag_changes
    ADD CONSTRAINT acct_tag_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_target_changes
    ADD CONSTRAINT acct_target_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_tax_inbox
    ADD CONSTRAINT acct_tax_inbox_approval_no_key UNIQUE (approval_no);



ALTER TABLE ONLY public.acct_tax_inbox_fetches
    ADD CONSTRAINT acct_tax_inbox_fetches_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_tax_inbox
    ADD CONSTRAINT acct_tax_inbox_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_tax_invoices
    ADD CONSTRAINT acct_tax_invoices_invoice_no_key UNIQUE (invoice_no);



ALTER TABLE ONLY public.acct_tax_invoices
    ADD CONSTRAINT acct_tax_invoices_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_transfer_approvals
    ADD CONSTRAINT acct_transfer_approvals_pkey PRIMARY KEY (batch_id, approver);



ALTER TABLE ONLY public.acct_transfer_batches
    ADD CONSTRAINT acct_transfer_batches_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_transfer_items
    ADD CONSTRAINT acct_transfer_items_bank_tran_id_key UNIQUE (bank_tran_id);



ALTER TABLE ONLY public.acct_transfer_items
    ADD CONSTRAINT acct_transfer_items_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_vehicle_costs
    ADD CONSTRAINT acct_vehicle_costs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_vehicle_trips
    ADD CONSTRAINT acct_vehicle_trips_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_vehicles
    ADD CONSTRAINT acct_vehicles_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_vehicles
    ADD CONSTRAINT acct_vehicles_plate_key UNIQUE (plate);



ALTER TABLE ONLY public.acct_warehouses
    ADD CONSTRAINT acct_warehouses_code_key UNIQUE (code);



ALTER TABLE ONLY public.acct_warehouses
    ADD CONSTRAINT acct_warehouses_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_wht_table
    ADD CONSTRAINT acct_wht_table_pkey PRIMARY KEY (year, wage_from, dependents);



ALTER TABLE ONLY public.acct_year_closings
    ADD CONSTRAINT acct_year_closings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_yearend_checks
    ADD CONSTRAINT acct_yearend_checks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.corp_doc_versions
    ADD CONSTRAINT corp_doc_versions_doc_id_version_no_key UNIQUE (doc_id, version_no);



ALTER TABLE ONLY public.corp_doc_versions
    ADD CONSTRAINT corp_doc_versions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.corp_docs
    ADD CONSTRAINT corp_docs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_bookings
    ADD CONSTRAINT ex_hrx_booking_overlap EXCLUDE USING gist (resource_id WITH =, tstzrange(start_at, end_at, '[)'::text) WITH &&) WHERE ((canceled_at IS NULL));



ALTER TABLE ONLY public.hrx_ot_requests
    ADD CONSTRAINT ex_hrx_ot_overlap EXCLUDE USING gist (employee_id WITH =, tstzrange(start_at, end_at, '[)'::text) WITH &&) WHERE ((state = ANY (ARRAY['REQUESTED'::text, 'APPROVED'::text])));



ALTER TABLE ONLY public.hr_applicant_purges
    ADD CONSTRAINT hr_applicant_purges_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_applicants
    ADD CONSTRAINT hr_applicants_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_contract_templates
    ADD CONSTRAINT hr_contract_templates_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_contracts
    ADD CONSTRAINT hr_contracts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_interviews
    ADD CONSTRAINT hr_interviews_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_job_postings
    ADD CONSTRAINT hr_job_postings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_review_cycles
    ADD CONSTRAINT hr_review_cycles_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_review_goals
    ADD CONSTRAINT hr_review_goals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hr_review_results
    ADD CONSTRAINT hr_review_results_pkey PRIMARY KEY (cycle_id, employee_id);



ALTER TABLE ONLY public.hr_training_kinds
    ADD CONSTRAINT hr_training_kinds_pkey PRIMARY KEY (code);



ALTER TABLE ONLY public.hr_training_records
    ADD CONSTRAINT hr_training_records_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_bank_formats
    ADD CONSTRAINT hra_bank_formats_name_key UNIQUE (name);



ALTER TABLE ONLY public.hra_bank_formats
    ADD CONSTRAINT hra_bank_formats_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_close_items
    ADD CONSTRAINT hra_close_items_pkey PRIMARY KEY (key);



ALTER TABLE ONLY public.hra_close_marks
    ADD CONSTRAINT hra_close_marks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_leave_promos
    ADD CONSTRAINT hra_leave_promos_employee_id_year_round_key UNIQUE (employee_id, year, round);



ALTER TABLE ONLY public.hra_leave_promos
    ADD CONSTRAINT hra_leave_promos_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_lib_posts
    ADD CONSTRAINT hra_lib_posts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_lib_reads
    ADD CONSTRAINT hra_lib_reads_pkey PRIMARY KEY (post_id, account_id);



ALTER TABLE ONLY public.hra_lib_revisions
    ADD CONSTRAINT hra_lib_revisions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_pay_bank_changes
    ADD CONSTRAINT hra_pay_bank_changes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hra_pay_banks
    ADD CONSTRAINT hra_pay_banks_pkey PRIMARY KEY (employee_id);



ALTER TABLE ONLY public.hra_payfile_logs
    ADD CONSTRAINT hra_payfile_logs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_bookings
    ADD CONSTRAINT hrx_bookings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_ot_pay_links
    ADD CONSTRAINT hrx_ot_pay_links_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_ot_pay_links
    ADD CONSTRAINT hrx_ot_pay_links_request_id_key UNIQUE (request_id);



ALTER TABLE ONLY public.hrx_ot_requests
    ADD CONSTRAINT hrx_ot_requests_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_resources
    ADD CONSTRAINT hrx_resources_name_key UNIQUE (name);



ALTER TABLE ONLY public.hrx_resources
    ADD CONSTRAINT hrx_resources_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_shift_types
    ADD CONSTRAINT hrx_shift_types_pkey PRIMARY KEY (code);



ALTER TABLE ONLY public.hrx_shifts
    ADD CONSTRAINT hrx_shifts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_stocktake_lines
    ADD CONSTRAINT hrx_stocktake_lines_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.hrx_stocktakes
    ADD CONSTRAINT hrx_stocktakes_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_assets
    ADD CONSTRAINT its_assets_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_key_events
    ADD CONSTRAINT its_key_events_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_key_life
    ADD CONSTRAINT its_key_life_pkey PRIMARY KEY (integration_code, key_name);



ALTER TABLE ONLY public.its_suggestion_log
    ADD CONSTRAINT its_suggestion_log_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_suggestions
    ADD CONSTRAINT its_suggestions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_suggestions
    ADD CONSTRAINT its_suggestions_receipt_hash_key UNIQUE (receipt_hash);



ALTER TABLE ONLY public.its_survey_answers
    ADD CONSTRAINT its_survey_answers_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_survey_questions
    ADD CONSTRAINT its_survey_questions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.its_survey_questions
    ADD CONSTRAINT its_survey_questions_survey_id_ord_key UNIQUE (survey_id, ord);



ALTER TABLE ONLY public.its_survey_takers
    ADD CONSTRAINT its_survey_takers_pkey PRIMARY KEY (survey_id, account_id);



ALTER TABLE ONLY public.its_surveys
    ADD CONSTRAINT its_surveys_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_case_costs
    ADD CONSTRAINT lgl_case_costs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_case_hearings
    ADD CONSTRAINT lgl_case_hearings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_cases
    ADD CONSTRAINT lgl_cases_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_contract_reviews
    ADD CONSTRAINT lgl_contract_reviews_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_insurance_policies
    ADD CONSTRAINT lgl_insurance_policies_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_insurance_postings
    ADD CONSTRAINT lgl_insurance_postings_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_license_kinds
    ADD CONSTRAINT lgl_license_kinds_pkey PRIMARY KEY (code);



ALTER TABLE ONLY public.lgl_license_renewals
    ADD CONSTRAINT lgl_license_renewals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_licenses
    ADD CONSTRAINT lgl_licenses_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.lgl_review_opinions
    ADD CONSTRAINT lgl_review_opinions_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ofc_events
    ADD CONSTRAINT ofc_events_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ofc_notify_prefs
    ADD CONSTRAINT ofc_notify_prefs_pkey PRIMARY KEY (account_id);



ALTER TABLE ONLY public.ofc_task_comments
    ADD CONSTRAINT ofc_task_comments_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ofc_tasks
    ADD CONSTRAINT ofc_tasks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ofc_trip_settlements
    ADD CONSTRAINT ofc_trip_settlements_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ofc_trips
    ADD CONSTRAINT ofc_trips_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.prr_case_steps
    ADD CONSTRAINT prr_case_steps_pkey PRIMARY KEY (case_id, step);



ALTER TABLE ONLY public.prr_cases
    ADD CONSTRAINT prr_cases_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.prr_review_items
    ADD CONSTRAINT prr_review_items_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.prr_review_items
    ADD CONSTRAINT prr_review_items_quarter_account_id_target_kind_target_key UNIQUE (quarter, account_id, target_kind, target);



ALTER TABLE ONLY public.prr_reviews
    ADD CONSTRAINT prr_reviews_pkey PRIMARY KEY (quarter);



ALTER TABLE ONLY public.prr_task_use
    ADD CONSTRAINT prr_task_use_pkey PRIMARY KEY (account_id, task_key);



ALTER TABLE ONLY public.qlt_claim_logs
    ADD CONSTRAINT qlt_claim_logs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.qlt_claims
    ADD CONSTRAINT qlt_claims_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.qlt_lot_count_lines
    ADD CONSTRAINT qlt_lot_count_lines_pkey PRIMARY KEY (count_id, lot_id);



ALTER TABLE ONLY public.qlt_lot_counts
    ADD CONSTRAINT qlt_lot_counts_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.qlt_lot_moves
    ADD CONSTRAINT qlt_lot_moves_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.qlt_lot_picks
    ADD CONSTRAINT qlt_lot_picks_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.qlt_lot_products
    ADD CONSTRAINT qlt_lot_products_pkey PRIMARY KEY (product_id);



ALTER TABLE ONLY public.qlt_lots
    ADD CONSTRAINT qlt_lots_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.qlt_move_marks
    ADD CONSTRAINT qlt_move_marks_pkey PRIMARY KEY (move_id);



ALTER TABLE ONLY public.qlt_po_due
    ADD CONSTRAINT qlt_po_due_pkey PRIMARY KEY (po_id);



ALTER TABLE ONLY public.qlt_sup_evals
    ADD CONSTRAINT qlt_sup_evals_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sal_opp_logs
    ADD CONSTRAINT sal_opp_logs_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.sal_opps
    ADD CONSTRAINT sal_opps_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.acct_attendance
    ADD CONSTRAINT uq_acct_attendance_day UNIQUE (employee_id, work_on);



ALTER TABLE ONLY public.acct_stock_moves
    ADD CONSTRAINT uq_asm_source UNIQUE (kind, source_key);



ALTER TABLE ONLY public.hr_contract_templates
    ADD CONSTRAINT uq_hr_contract_template UNIQUE (code, version);



ALTER TABLE ONLY public.hr_review_cycles
    ADD CONSTRAINT uq_hr_review_cycle UNIQUE (year, quarter);



ALTER TABLE ONLY public.hrx_shifts
    ADD CONSTRAINT uq_hrx_shift_day UNIQUE (employee_id, work_on);



ALTER TABLE ONLY public.hrx_stocktake_lines
    ADD CONSTRAINT uq_hrx_stocktake_asset UNIQUE (stocktake_id, asset_id);



ALTER TABLE ONLY public.qlt_lots
    ADD CONSTRAINT uq_qlt_lot_no UNIQUE (option_id, lot_no);



ALTER TABLE ONLY public.qlt_lot_picks
    ADD CONSTRAINT uq_qlt_lot_pick UNIQUE (order_item_id, lot_id);



ALTER TABLE ONLY public.qlt_sup_evals
    ADD CONSTRAINT uq_qlt_sup_eval UNIQUE (party_id, period);



CREATE INDEX ix_aaa_acc ON public.acct_accountant_access USING btree (account_id, at DESC);



CREATE INDEX ix_aan_ym ON public.acct_accountant_notes USING btree (ym, id DESC);



CREATE INDEX ix_aar_note ON public.acct_accountant_replies USING btree (note_id, id);



CREATE INDEX ix_aar_year ON public.acct_archives USING btree (year, id DESC);



CREATE INDEX ix_aas_doc ON public.acct_approval_steps USING btree (doc_kind, doc_id, round, step_no);



CREATE INDEX ix_abfr_acc ON public.acct_bank_feed_runs USING btree (account_id, id DESC);



CREATE INDEX ix_abt_date ON public.acct_bank_txns USING btree (tx_date, id);



CREATE INDEX ix_acct_assets_state ON public.acct_assets USING btree (state, acquired_on);



CREATE INDEX ix_acct_attendance_day ON public.acct_attendance USING btree (work_on, employee_id);



CREATE INDEX ix_acct_cash_balances_asof ON public.acct_cash_balances USING btree (as_of DESC, id DESC);



CREATE INDEX ix_acct_cash_plans_due ON public.acct_cash_plans USING btree (due_on) WHERE (state = 'ACTIVE'::text);



CREATE INDEX ix_acct_contracts_end ON public.acct_contracts USING btree (state, end_on);



CREATE INDEX ix_acct_entries_party ON public.acct_entries USING btree (party, entry_date, id);



CREATE INDEX ix_acct_entries_ym ON public.acct_entries USING btree (ym, entry_date, id);



CREATE INDEX ix_acct_expense_claims_req ON public.acct_expense_claims USING btree (requisition_id) WHERE (requisition_id IS NOT NULL);



CREATE INDEX ix_acct_exports_state ON public.acct_exports USING btree (state, ordered_on DESC);



CREATE INDEX ix_acct_imports_state ON public.acct_imports USING btree (state, ordered_on DESC);



CREATE INDEX ix_acct_lines_entry ON public.acct_lines USING btree (entry_id);



CREATE INDEX ix_acct_lines_role ON public.acct_lines USING btree (role, entry_id);



CREATE INDEX ix_acct_lines_role_entry ON public.acct_lines USING btree (role, entry_id);



CREATE INDEX ix_acct_opening_set ON public.acct_opening USING btree (set_id, role);



CREATE INDEX ix_acct_parties_name ON public.acct_parties USING btree (lower(name));



CREATE INDEX ix_acct_pos_state ON public.acct_pos USING btree (state, ordered_on DESC);



CREATE INDEX ix_acct_purchases_biz ON public.acct_purchases USING btree (supplier_biz_no, issued_on) WHERE (state = 'ACTIVE'::text);



CREATE INDEX ix_acct_purchases_issued ON public.acct_purchases USING btree (issued_on, id);



CREATE INDEX ix_acct_purchases_req ON public.acct_purchases USING btree (requisition_id) WHERE (requisition_id IS NOT NULL);



CREATE INDEX ix_acct_req_requester ON public.acct_requisitions USING btree (requester, created_at DESC);



CREATE INDEX ix_acct_req_state ON public.acct_requisitions USING btree (state, created_at DESC);



CREATE INDEX ix_acct_tax_inbox_day ON public.acct_tax_inbox USING btree (issued_on, id);



CREATE INDEX ix_acct_vcosts_vehicle ON public.acct_vehicle_costs USING btree (vehicle_id, cost_on, id);



CREATE INDEX ix_acct_vtrips_vehicle ON public.acct_vehicle_trips USING btree (vehicle_id, trip_on, id);



CREATE INDEX ix_acct_yearend_checks ON public.acct_yearend_checks USING btree (year, employee_id, item, id DESC);



CREATE INDEX ix_act_date ON public.acct_card_txns USING btree (used_on, id);



CREATE INDEX ix_act_tail_day ON public.acct_card_txns USING btree (card_tail, used_on);



CREATE INDEX ix_ads_party ON public.acct_dunning_sends USING btree (party_name, stage, oldest);



CREATE INDEX ix_aec_claimant ON public.acct_expense_claims USING btree (claimant, id);



CREATE INDEX ix_aec_state ON public.acct_expense_claims USING btree (state, spent_on, id);



CREATE INDEX ix_aer_created ON public.acct_entry_reversals USING btree (created_at DESC);



CREATE INDEX ix_alg_emp ON public.acct_leave_grants USING btree (employee_id, year);



CREATE INDEX ix_alr_emp ON public.acct_leave_requests USING btree (employee_id, start_on);



CREATE INDEX ix_alr_state ON public.acct_leave_requests USING btree (state, start_on);



CREATE INDEX ix_alu_emp ON public.acct_leave_uses USING btree (employee_id, used_on);



CREATE INDEX ix_ame_state ON public.acct_manual_entries USING btree (state, id DESC);



CREATE INDEX ix_apl_employee ON public.acct_payroll_lines USING btree (employee_id, run_id);



CREATE INDEX ix_apt_settle ON public.acct_pg_txns USING btree (settle_on, id);



CREATE INDEX ix_arr_file ON public.acct_receipt_reads USING btree (file_id, id DESC);



CREATE INDEX ix_asd_kind_state ON public.acct_sales_docs USING btree (kind, state, issued_on DESC);



CREATE INDEX ix_asd_party ON public.acct_sales_docs USING btree (party_id, issued_on DESC);



CREATE INDEX ix_asm_option ON public.acct_stock_moves USING btree (option_id, id DESC);



CREATE INDEX ix_asm_product_day ON public.acct_stock_moves USING btree (product_id, moved_on);



CREATE INDEX ix_ast_option ON public.acct_stock_transfers USING btree (option_id, id);



CREATE INDEX ix_atb_state ON public.acct_transfer_batches USING btree (state, pay_on DESC);



CREATE INDEX ix_ati_batch ON public.acct_transfer_items USING btree (batch_id, id);



CREATE INDEX ix_ayc_year ON public.acct_year_closings USING btree (year, id DESC);



CREATE INDEX ix_cdv_doc ON public.corp_doc_versions USING btree (doc_id, version_no DESC);



CREATE INDEX ix_hap_posting ON public.hr_applicants USING btree (posting_id, id DESC);



CREATE INDEX ix_hap_purge ON public.hr_applicants USING btree (purge_due_on) WHERE ((purged_at IS NULL) AND (stage = ANY (ARRAY['REJECTED'::text, 'WITHDRAWN'::text])));



CREATE INDEX ix_hiv_app ON public.hr_interviews USING btree (applicant_id, at);



CREATE INDEX ix_hiv_at ON public.hr_interviews USING btree (at);



CREATE INDEX ix_hjp_state ON public.hr_job_postings USING btree (state, closes_on DESC);



CREATE INDEX ix_hra_close_marks ON public.hra_close_marks USING btree (ym, item_key, id DESC);



CREATE INDEX ix_hra_lib_posts_state ON public.hra_lib_posts USING btree (state, pinned DESC, created_at DESC);



CREATE INDEX ix_hra_lp_year ON public.hra_leave_promos USING btree (year, round, state);



CREATE INDEX ix_hra_payfile_logs_run ON public.hra_payfile_logs USING btree (run_id, made_at DESC);



CREATE INDEX ix_hrc_emp ON public.hr_contracts USING btree (employee_id, id DESC);



CREATE INDEX ix_hrc_state ON public.hr_contracts USING btree (state, id DESC);



CREATE INDEX ix_hrrg_cycle_emp ON public.hr_review_goals USING btree (cycle_id, employee_id, id);



CREATE INDEX ix_htr_emp ON public.hr_training_records USING btree (employee_id, id DESC);



CREATE INDEX ix_htr_file ON public.hr_training_records USING btree (file_id) WHERE (file_id IS NOT NULL);



CREATE INDEX ix_htr_period ON public.hr_training_records USING btree (kind_code, period, employee_id) WHERE (state <> 'VOID'::text);



CREATE INDEX ix_hxb_time ON public.hrx_bookings USING btree (start_at, resource_id) WHERE (canceled_at IS NULL);



CREATE INDEX ix_hxb_who ON public.hrx_bookings USING btree (booked_by, start_at);



CREATE INDEX ix_hxkl_asset ON public.hrx_stocktake_lines USING btree (asset_id, stocktake_id);



CREATE INDEX ix_hxl_run ON public.hrx_ot_pay_links USING btree (run_id, line_id);



CREATE INDEX ix_hxo_emp ON public.hrx_ot_requests USING btree (employee_id, work_on);



CREATE INDEX ix_hxo_state ON public.hrx_ot_requests USING btree (state, work_on);



CREATE INDEX ix_hxs_day ON public.hrx_shifts USING btree (work_on, employee_id);



CREATE INDEX ix_its_assets_renew ON public.its_assets USING btree (renew_on) WHERE (state = 'ACTIVE'::text);



CREATE INDEX ix_its_key_events_key ON public.its_key_events USING btree (integration_code, key_name, id DESC);



CREATE INDEX ix_its_sug_author ON public.its_suggestions USING btree (author_id, created_on DESC) WHERE (author_id IS NOT NULL);



CREATE INDEX ix_its_sug_log ON public.its_suggestion_log USING btree (suggestion_id, id);



CREATE INDEX ix_its_sug_state ON public.its_suggestions USING btree (state, created_on DESC);



CREATE INDEX ix_its_survey_answers ON public.its_survey_answers USING btree (survey_id);



CREATE INDEX ix_its_surveys_state ON public.its_surveys USING btree (state, closes_on);



CREATE INDEX ix_lgl_case_state ON public.lgl_cases USING btree (state, id DESC);



CREATE INDEX ix_lgl_cost_case ON public.lgl_case_costs USING btree (case_id, id);



CREATE INDEX ix_lgl_hear_at ON public.lgl_case_hearings USING btree (state, held_at);



CREATE INDEX ix_lgl_hear_case ON public.lgl_case_hearings USING btree (case_id, held_at);



CREATE INDEX ix_lgl_ins_end ON public.lgl_insurance_policies USING btree (state, ends_on);



CREATE INDEX ix_lgl_ipost_policy ON public.lgl_insurance_postings USING btree (policy_id, kind, ym);



CREATE INDEX ix_lgl_lic_due ON public.lgl_licenses USING btree (state, next_due_on);



CREATE INDEX ix_lgl_lren_lic ON public.lgl_license_renewals USING btree (license_id, id DESC);



CREATE INDEX ix_lgl_rop_review ON public.lgl_review_opinions USING btree (review_id, id);



CREATE INDEX ix_lgl_rv_contract ON public.lgl_contract_reviews USING btree (contract_id) WHERE (contract_id IS NOT NULL);



CREATE INDEX ix_lgl_rv_state ON public.lgl_contract_reviews USING btree (state, id DESC);



CREATE INDEX ix_ofe_owner ON public.ofc_events USING btree (owner_id, start_on);



CREATE INDEX ix_ofe_range ON public.ofc_events USING btree (start_on, end_on) WHERE (removed_at IS NULL);



CREATE INDEX ix_oft_assignee ON public.ofc_tasks USING btree (assignee, state, due_on);



CREATE INDEX ix_oft_due ON public.ofc_tasks USING btree (due_on) WHERE (state = ANY (ARRAY['REQUESTED'::text, 'DOING'::text]));



CREATE INDEX ix_oft_requester ON public.ofc_tasks USING btree (requester, state, created_at DESC);



CREATE INDEX ix_oftc_task ON public.ofc_task_comments USING btree (task_id, id);



CREATE INDEX ix_otr_range ON public.ofc_trips USING btree (depart_on, return_on) WHERE (state <> 'CANCELED'::text);



CREATE INDEX ix_otr_traveler ON public.ofc_trips USING btree (traveler, depart_on DESC);



CREATE INDEX ix_ots_trip ON public.ofc_trip_settlements USING btree (trip_id, id);



CREATE INDEX ix_prr_cases_state ON public.prr_cases USING btree (state, opened_at DESC);



CREATE INDEX ix_prr_review_items_open ON public.prr_review_items USING btree (quarter) WHERE (state = 'OPEN'::text);



CREATE INDEX ix_prr_task_use_last ON public.prr_task_use USING btree (last_on);



CREATE INDEX ix_qlt_claim_logs ON public.qlt_claim_logs USING btree (claim_id, id);



CREATE INDEX ix_qlt_claims_lot ON public.qlt_claims USING btree (lot_id) WHERE (lot_id IS NOT NULL);



CREATE INDEX ix_qlt_claims_party ON public.qlt_claims USING btree (party_id, received_on);



CREATE INDEX ix_qlt_claims_repeat ON public.qlt_claims USING btree (product_id, defect_type, received_on);



CREATE INDEX ix_qlt_claims_state ON public.qlt_claims USING btree (state, received_on DESC);



CREATE INDEX ix_qlt_cnt_lines_lot ON public.qlt_lot_count_lines USING btree (lot_id);



CREATE INDEX ix_qlt_lot_moves_item ON public.qlt_lot_moves USING btree (order_item_id) WHERE (order_item_id IS NOT NULL);



CREATE INDEX ix_qlt_lot_moves_lot ON public.qlt_lot_moves USING btree (lot_id, id DESC);



CREATE INDEX ix_qlt_lots_expiry ON public.qlt_lots USING btree (expires_on) WHERE (state = ANY (ARRAY['OK'::text, 'HOLD'::text]));



CREATE INDEX ix_qlt_lots_move ON public.qlt_lots USING btree (in_move_id) WHERE (in_move_id IS NOT NULL);



CREATE INDEX ix_qlt_lots_option ON public.qlt_lots USING btree (option_id, expires_on, id);



CREATE INDEX ix_qlt_sup_evals_period ON public.qlt_sup_evals USING btree (period, grade);



CREATE INDEX ix_sal_opp_logs_opp ON public.sal_opp_logs USING btree (opp_id, id);



CREATE INDEX ix_sal_opps_owner ON public.sal_opps USING btree (owner_id, stage);



CREATE INDEX ix_sal_opps_party ON public.sal_opps USING btree (party_id);



CREATE INDEX ix_sal_opps_stage ON public.sal_opps USING btree (stage, next_action_on);



CREATE UNIQUE INDEX uq_aal_kind_upto ON public.acct_approval_lines USING btree (doc_kind, COALESCE(upto, '9223372036854775807'::bigint));



CREATE UNIQUE INDEX uq_abt_entry ON public.acct_bank_txns USING btree (entry_id) WHERE (entry_id IS NOT NULL);



CREATE UNIQUE INDEX uq_aca_purchase ON public.acct_contract_accruals USING btree (purchase_id) WHERE (purchase_id IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_employees_account ON public.acct_employees USING btree (account_id) WHERE (account_id IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_parties_adv ON public.acct_parties USING btree (advertiser_id) WHERE (advertiser_id IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_parties_biz ON public.acct_parties USING btree (biz_no) WHERE (biz_no IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_parties_seller ON public.acct_parties USING btree (seller_id) WHERE (seller_id IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_payslip_mail_sent ON public.acct_payslip_mails USING btree (line_id) WHERE (result = 'SENT'::text);



CREATE UNIQUE INDEX uq_acct_req_used ON public.acct_requisitions USING btree (used_kind, used_ref) WHERE (used_ref IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_tax_inbox_purchase ON public.acct_tax_inbox USING btree (purchase_id) WHERE (purchase_id IS NOT NULL);



CREATE UNIQUE INDEX uq_acct_vcosts_purchase ON public.acct_vehicle_costs USING btree (purchase_id) WHERE ((purchase_id IS NOT NULL) AND (state = 'ACTIVE'::text));



CREATE UNIQUE INDEX uq_aef_default ON public.acct_export_formats USING btree (is_default) WHERE is_default;



CREATE UNIQUE INDEX uq_ael_option ON public.acct_export_lines USING btree (export_id, option_id) WHERE (option_id IS NOT NULL);



CREATE UNIQUE INDEX uq_apt_entry ON public.acct_pg_txns USING btree (entry_id) WHERE (entry_id IS NOT NULL);



CREATE UNIQUE INDEX uq_ard_open_party ON public.acct_reorder_drafts USING btree (COALESCE(party_id, (0)::bigint)) WHERE (state = 'DRAFT'::text);



CREATE UNIQUE INDEX uq_asd_no_rev ON public.acct_sales_docs USING btree (doc_no, rev);



CREATE UNIQUE INDEX uq_ast_target ON public.acct_sales_targets USING btree (ym, axis, COALESCE(dept_id, (0)::bigint), COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));



CREATE UNIQUE INDEX uq_ati_source ON public.acct_tax_invoices USING btree (kind, source_id) WHERE (state <> 'CANCELED'::text);



CREATE UNIQUE INDEX uq_awh_main ON public.acct_warehouses USING btree (is_main) WHERE is_main;



CREATE UNIQUE INDEX uq_hr_applicant_purge ON public.hr_applicant_purges USING btree (applicant_id);



CREATE UNIQUE INDEX uq_hra_bank_formats_default ON public.hra_bank_formats USING btree (is_default) WHERE is_default;



CREATE UNIQUE INDEX uq_otr_claim ON public.ofc_trips USING btree (claim_id) WHERE (claim_id IS NOT NULL);



CREATE UNIQUE INDEX uq_otr_req ON public.ofc_trips USING btree (requisition_id);



CREATE UNIQUE INDEX uq_ots_claim ON public.ofc_trip_settlements USING btree (claim_id);



CREATE UNIQUE INDEX uq_prr_cases_open ON public.prr_cases USING btree (employee_id, kind) WHERE (state = 'OPEN'::text);



CREATE UNIQUE INDEX uq_qlt_cnt_one_open ON public.qlt_lot_counts USING btree (state) WHERE (state = 'OPEN'::text);



CREATE UNIQUE INDEX uq_qlt_lot_move ON public.qlt_lot_moves USING btree (move_id, lot_id) WHERE (move_id IS NOT NULL);



CREATE UNIQUE INDEX ux_acct_tax_invoices_etax_appr ON public.acct_tax_invoices USING btree (etax_approval_no) WHERE (etax_approval_no IS NOT NULL);



CREATE UNIQUE INDEX ux_acct_tax_invoices_etax_doc ON public.acct_tax_invoices USING btree (etax_doc_key) WHERE (etax_doc_key IS NOT NULL);



CREATE UNIQUE INDEX ux_its_assets_tag ON public.its_assets USING btree (asset_tag) WHERE (asset_tag IS NOT NULL);



CREATE UNIQUE INDEX ux_its_survey_answers_named ON public.its_survey_answers USING btree (survey_id, account_id) WHERE (account_id IS NOT NULL);



CREATE UNIQUE INDEX ux_lgl_cost_claim ON public.lgl_case_costs USING btree (expense_claim_id) WHERE ((expense_claim_id IS NOT NULL) AND (state = 'ACTIVE'::text));



CREATE UNIQUE INDEX ux_lgl_cost_purchase ON public.lgl_case_costs USING btree (purchase_id) WHERE ((purchase_id IS NOT NULL) AND (state = 'ACTIVE'::text));



CREATE UNIQUE INDEX ux_lgl_ins_renewed ON public.lgl_insurance_policies USING btree (renewed_from) WHERE (renewed_from IS NOT NULL);



CREATE UNIQUE INDEX ux_lgl_ipost_manual ON public.lgl_insurance_postings USING btree (manual_id);



CREATE TRIGGER trg_acct_accountant_access_ro BEFORE DELETE OR UPDATE ON public.acct_accountant_access FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_accountant_notes_ro BEFORE DELETE OR UPDATE ON public.acct_accountant_notes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_accountant_replies_ro BEFORE DELETE OR UPDATE ON public.acct_accountant_replies FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_accounts_guard BEFORE DELETE OR UPDATE ON public.acct_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accounts_guard();



CREATE TRIGGER trg_acct_accounts_ins_guard BEFORE INSERT ON public.acct_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accounts_ins_guard();



CREATE TRIGGER trg_acct_accrual_guard BEFORE DELETE OR UPDATE ON public.acct_contract_accruals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accrual_guard();



CREATE TRIGGER trg_acct_accrual_rule_guard BEFORE INSERT OR UPDATE ON public.acct_contract_accrual_rules FOR EACH ROW EXECUTE FUNCTION public.fn_acct_accrual_rule_guard();



CREATE TRIGGER trg_acct_approval_line_changes_ro BEFORE DELETE OR UPDATE ON public.acct_approval_line_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_approval_line_guard BEFORE INSERT OR UPDATE ON public.acct_approval_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_approval_line_guard();



CREATE TRIGGER trg_acct_approval_step_guard BEFORE INSERT ON public.acct_approval_steps FOR EACH ROW EXECUTE FUNCTION public.fn_acct_approval_step_guard();



CREATE TRIGGER trg_acct_approval_steps_ro BEFORE DELETE OR UPDATE ON public.acct_approval_steps FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_archives_ro BEFORE DELETE OR UPDATE ON public.acct_archives FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_asset_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_assets FOR EACH ROW EXECUTE FUNCTION public.fn_acct_asset_guard();



CREATE TRIGGER trg_acct_attendance_fixes_ro BEFORE DELETE OR UPDATE ON public.acct_attendance_fixes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_attendance_guard BEFORE DELETE OR UPDATE ON public.acct_attendance FOR EACH ROW EXECUTE FUNCTION public.fn_acct_attendance_guard();



CREATE TRIGGER trg_acct_bank_feed_acc_guard BEFORE DELETE OR UPDATE ON public.acct_bank_feed_accounts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_bank_feed_acc_guard();



CREATE TRIGGER trg_acct_bank_feed_runs_ro BEFORE DELETE OR UPDATE ON public.acct_bank_feed_runs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_bank_txn_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_bank_txns FOR EACH ROW EXECUTE FUNCTION public.fn_acct_bank_txn_guard();



CREATE TRIGGER trg_acct_bank_uploads_ro BEFORE DELETE OR UPDATE ON public.acct_bank_uploads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_barcodes_ro BEFORE DELETE OR UPDATE ON public.acct_barcodes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_budget_changes_block BEFORE DELETE OR UPDATE ON public.acct_budget_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_budget_guard BEFORE INSERT OR UPDATE ON public.acct_budgets FOR EACH ROW EXECUTE FUNCTION public.fn_acct_budget_guard();



CREATE TRIGGER trg_acct_card_limit_changes_ro BEFORE DELETE OR UPDATE ON public.acct_card_limit_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_card_txn_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_card_txns FOR EACH ROW EXECUTE FUNCTION public.fn_acct_card_txn_guard();



CREATE TRIGGER trg_acct_card_uploads_ro BEFORE DELETE OR UPDATE ON public.acct_card_uploads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_cash_balances_ro BEFORE DELETE OR UPDATE ON public.acct_cash_balances FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_cash_plan_guard BEFORE DELETE OR UPDATE ON public.acct_cash_plans FOR EACH ROW EXECUTE FUNCTION public.fn_acct_cash_plan_guard();



CREATE TRIGGER trg_acct_closings_ro BEFORE DELETE OR UPDATE ON public.acct_closings FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_contract_changes_ro BEFORE DELETE OR UPDATE ON public.acct_contract_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_contract_guard BEFORE DELETE OR UPDATE ON public.acct_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_contract_guard();



CREATE TRIGGER trg_acct_depreciations_block BEFORE DELETE OR UPDATE ON public.acct_depreciations FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_dunning_sends_ro BEFORE DELETE OR UPDATE ON public.acct_dunning_sends FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_employee_guard BEFORE DELETE OR UPDATE ON public.acct_employees FOR EACH ROW EXECUTE FUNCTION public.fn_acct_employee_guard();



CREATE CONSTRAINT TRIGGER trg_acct_entries_balance AFTER INSERT ON public.acct_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_acct_balance_check();



CREATE TRIGGER trg_acct_entries_closed BEFORE INSERT ON public.acct_entries FOR EACH ROW EXECUTE FUNCTION public.fn_acct_entries_closed();



CREATE TRIGGER trg_acct_entries_ro BEFORE DELETE OR UPDATE ON public.acct_entries FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_entry_reversal_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_entry_reversals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_entry_reversal_guard();



CREATE TRIGGER trg_acct_expense_claims_req_link BEFORE INSERT OR UPDATE OF requisition_id ON public.acct_expense_claims FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_guard();



CREATE TRIGGER trg_acct_expense_claims_req_used AFTER INSERT OR UPDATE OF requisition_id ON public.acct_expense_claims FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_used();



CREATE TRIGGER trg_acct_expense_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_expense_claims FOR EACH ROW EXECUTE FUNCTION public.fn_acct_expense_guard();



CREATE TRIGGER trg_acct_export_guard BEFORE DELETE OR UPDATE ON public.acct_exports FOR EACH ROW EXECUTE FUNCTION public.fn_acct_export_guard();



CREATE TRIGGER trg_acct_export_line_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_export_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_export_line_guard();



CREATE TRIGGER trg_acct_fx_reval_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_fx_revals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_fx_reval_guard();



CREATE TRIGGER trg_acct_import_guard BEFORE DELETE OR UPDATE ON public.acct_imports FOR EACH ROW EXECUTE FUNCTION public.fn_acct_import_guard();



CREATE TRIGGER trg_acct_import_line_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_import_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_import_line_guard();



CREATE TRIGGER trg_acct_insurance_done_ro BEFORE DELETE OR UPDATE ON public.acct_insurance_done FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_leave_grants_ro BEFORE DELETE OR UPDATE ON public.acct_leave_grants FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_leave_request_guard BEFORE DELETE OR UPDATE ON public.acct_leave_requests FOR EACH ROW EXECUTE FUNCTION public.fn_acct_leave_request_guard();



CREATE TRIGGER trg_acct_leave_uses_ro BEFORE DELETE OR UPDATE ON public.acct_leave_uses FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE CONSTRAINT TRIGGER trg_acct_lines_balance AFTER INSERT ON public.acct_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fn_acct_balance_check();



CREATE TRIGGER trg_acct_lines_ro BEFORE DELETE OR UPDATE ON public.acct_lines FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_manual_guard BEFORE DELETE OR UPDATE ON public.acct_manual_entries FOR EACH ROW EXECUTE FUNCTION public.fn_acct_manual_guard();



CREATE TRIGGER trg_acct_opening_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_opening FOR EACH ROW EXECUTE FUNCTION public.fn_acct_opening_guard();



CREATE TRIGGER trg_acct_opening_set_guard BEFORE DELETE OR UPDATE ON public.acct_opening_sets FOR EACH ROW EXECUTE FUNCTION public.fn_acct_opening_set_guard();



CREATE TRIGGER trg_acct_party_guard BEFORE DELETE OR UPDATE ON public.acct_parties FOR EACH ROW EXECUTE FUNCTION public.fn_acct_party_guard();



CREATE TRIGGER trg_acct_payroll_line_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_payroll_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_payroll_line_guard();



CREATE TRIGGER trg_acct_payroll_rate_log_ro BEFORE DELETE OR UPDATE ON public.acct_payroll_rate_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_payroll_run_guard BEFORE DELETE OR UPDATE ON public.acct_payroll_runs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_payroll_run_guard();



CREATE TRIGGER trg_acct_payslip_mails_ro BEFORE DELETE OR UPDATE ON public.acct_payslip_mails FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_pg_txn_guard BEFORE DELETE OR UPDATE ON public.acct_pg_txns FOR EACH ROW EXECUTE FUNCTION public.fn_acct_pg_txn_guard();



CREATE TRIGGER trg_acct_pg_uploads_ro BEFORE DELETE OR UPDATE ON public.acct_pg_uploads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_po_guard BEFORE DELETE OR UPDATE ON public.acct_pos FOR EACH ROW EXECUTE FUNCTION public.fn_acct_po_guard();



CREATE TRIGGER trg_acct_po_line_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_po_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_po_line_guard();



CREATE TRIGGER trg_acct_purchase_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_acct_purchase_guard();



CREATE TRIGGER trg_acct_purchases_req_link BEFORE INSERT OR UPDATE OF requisition_id ON public.acct_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_guard();



CREATE TRIGGER trg_acct_purchases_req_used AFTER INSERT OR UPDATE OF requisition_id ON public.acct_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_acct_req_link_used();



CREATE TRIGGER trg_acct_receipt_reads_ro BEFORE DELETE OR UPDATE ON public.acct_receipt_reads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_reorder_draft_guard BEFORE DELETE OR UPDATE ON public.acct_reorder_drafts FOR EACH ROW EXECUTE FUNCTION public.fn_acct_reorder_draft_guard();



CREATE TRIGGER trg_acct_reorder_line_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_reorder_draft_lines FOR EACH ROW EXECUTE FUNCTION public.fn_acct_reorder_line_guard();



CREATE TRIGGER trg_acct_requisition_guard BEFORE DELETE OR UPDATE ON public.acct_requisitions FOR EACH ROW EXECUTE FUNCTION public.fn_acct_requisition_guard();



CREATE TRIGGER trg_acct_rule_changes_block BEFORE DELETE OR UPDATE ON public.acct_rule_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_rule_map_guard BEFORE INSERT OR UPDATE ON public.acct_rule_maps FOR EACH ROW EXECUTE FUNCTION public.fn_acct_rule_map_guard();



CREATE TRIGGER trg_acct_sales_doc_exempt_guard BEFORE UPDATE ON public.acct_sales_docs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_sales_doc_exempt_guard();



CREATE TRIGGER trg_acct_sales_doc_guard BEFORE DELETE OR UPDATE ON public.acct_sales_docs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_sales_doc_guard();



CREATE TRIGGER trg_acct_sales_doc_lines_ro BEFORE DELETE OR UPDATE ON public.acct_sales_doc_lines FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_severance_runs_ro BEFORE DELETE OR UPDATE ON public.acct_severance_runs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_stock_move BEFORE INSERT OR DELETE OR UPDATE ON public.acct_stock_moves FOR EACH ROW EXECUTE FUNCTION public.fn_acct_stock_move();



CREATE TRIGGER trg_acct_stock_rule_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_stock_rules FOR EACH ROW EXECUTE FUNCTION public.fn_acct_stock_rule_guard();



CREATE TRIGGER trg_acct_stock_transfers_ro BEFORE DELETE OR UPDATE ON public.acct_stock_transfers FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_tag_changes_ro BEFORE DELETE OR UPDATE ON public.acct_tag_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_target_changes_ro BEFORE DELETE OR UPDATE ON public.acct_target_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_tax_inbox_fetches_ro BEFORE DELETE OR UPDATE ON public.acct_tax_inbox_fetches FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_tax_inbox_guard BEFORE DELETE OR UPDATE ON public.acct_tax_inbox FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_inbox_guard();



CREATE TRIGGER trg_acct_tax_invoice_etax BEFORE UPDATE ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_etax_guard();



CREATE TRIGGER trg_acct_tax_invoice_exempt_chk BEFORE INSERT ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_invoice_exempt_chk();



CREATE TRIGGER trg_acct_tax_invoice_guard BEFORE DELETE OR UPDATE ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_invoice_guard();



CREATE TRIGGER trg_acct_tax_invoice_issued AFTER UPDATE OF state ON public.acct_tax_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_acct_tax_invoice_issued();



CREATE TRIGGER trg_acct_transfer_approval_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_transfer_approvals FOR EACH ROW EXECUTE FUNCTION public.fn_acct_transfer_approval_guard();



CREATE TRIGGER trg_acct_transfer_batch_guard BEFORE DELETE OR UPDATE ON public.acct_transfer_batches FOR EACH ROW EXECUTE FUNCTION public.fn_acct_transfer_batch_guard();



CREATE TRIGGER trg_acct_transfer_item_guard BEFORE INSERT OR DELETE OR UPDATE ON public.acct_transfer_items FOR EACH ROW EXECUTE FUNCTION public.fn_acct_transfer_item_guard();



CREATE TRIGGER trg_acct_vehicle_cost_guard BEFORE DELETE OR UPDATE ON public.acct_vehicle_costs FOR EACH ROW EXECUTE FUNCTION public.fn_acct_vehicle_line_guard();



CREATE TRIGGER trg_acct_vehicle_guard BEFORE DELETE OR UPDATE ON public.acct_vehicles FOR EACH ROW EXECUTE FUNCTION public.fn_acct_vehicle_guard();



CREATE TRIGGER trg_acct_vehicle_trip_guard BEFORE DELETE OR UPDATE ON public.acct_vehicle_trips FOR EACH ROW EXECUTE FUNCTION public.fn_acct_vehicle_line_guard();



CREATE TRIGGER trg_acct_year_closings_ro BEFORE DELETE OR UPDATE ON public.acct_year_closings FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_acct_yearend_checks_ro BEFORE DELETE OR UPDATE ON public.acct_yearend_checks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_bzx_card_txn_notice AFTER INSERT ON public.acct_card_txns FOR EACH ROW EXECUTE FUNCTION public.fn_bzx_card_txn_notice();



CREATE TRIGGER trg_corp_doc_versions_guard BEFORE INSERT ON public.corp_doc_versions FOR EACH ROW EXECUTE FUNCTION public.fn_corp_doc_versions_guard();



CREATE TRIGGER trg_corp_doc_versions_ro BEFORE DELETE OR UPDATE ON public.corp_doc_versions FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_corp_docs_guard BEFORE DELETE OR UPDATE ON public.corp_docs FOR EACH ROW EXECUTE FUNCTION public.fn_corp_docs_guard();



CREATE TRIGGER trg_hr_applicant_purges_ro BEFORE DELETE OR UPDATE ON public.hr_applicant_purges FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_hr_applicants_guard BEFORE DELETE OR UPDATE ON public.hr_applicants FOR EACH ROW EXECUTE FUNCTION public.fn_hr_applicants_guard();



CREATE TRIGGER trg_hr_contract_templates_guard BEFORE DELETE OR UPDATE ON public.hr_contract_templates FOR EACH ROW EXECUTE FUNCTION public.fn_hr_contract_templates_guard();



CREATE TRIGGER trg_hr_contracts_guard BEFORE DELETE OR UPDATE ON public.hr_contracts FOR EACH ROW EXECUTE FUNCTION public.fn_hr_contracts_guard();



CREATE TRIGGER trg_hr_interviews_guard BEFORE DELETE OR UPDATE ON public.hr_interviews FOR EACH ROW EXECUTE FUNCTION public.fn_hr_interviews_guard();



CREATE TRIGGER trg_hr_job_postings_guard BEFORE DELETE OR UPDATE ON public.hr_job_postings FOR EACH ROW EXECUTE FUNCTION public.fn_hr_job_postings_guard();



CREATE TRIGGER trg_hr_review_cycles_guard BEFORE DELETE OR UPDATE ON public.hr_review_cycles FOR EACH ROW EXECUTE FUNCTION public.fn_hr_review_cycles_guard();



CREATE TRIGGER trg_hr_review_goals_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hr_review_goals FOR EACH ROW EXECUTE FUNCTION public.fn_hr_review_goals_guard();



CREATE TRIGGER trg_hr_review_results_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hr_review_results FOR EACH ROW EXECUTE FUNCTION public.fn_hr_review_results_guard();



CREATE TRIGGER trg_hr_training_kinds_guard BEFORE DELETE OR UPDATE ON public.hr_training_kinds FOR EACH ROW EXECUTE FUNCTION public.fn_hr_training_kinds_guard();



CREATE TRIGGER trg_hr_training_records_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hr_training_records FOR EACH ROW EXECUTE FUNCTION public.fn_hr_training_records_guard();



CREATE TRIGGER trg_hra_close_items_keep BEFORE DELETE OR UPDATE ON public.hra_close_items FOR EACH ROW EXECUTE FUNCTION public.fn_hra_close_items_keep();



CREATE TRIGGER trg_hra_close_marks_ro BEFORE DELETE OR UPDATE ON public.hra_close_marks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_hra_leave_promo_guard BEFORE DELETE OR UPDATE ON public.hra_leave_promos FOR EACH ROW EXECUTE FUNCTION public.fn_hra_leave_promo_guard();



CREATE TRIGGER trg_hra_lib_post_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hra_lib_posts FOR EACH ROW EXECUTE FUNCTION public.fn_hra_lib_post_guard();



CREATE TRIGGER trg_hra_lib_reads_ro BEFORE DELETE OR UPDATE ON public.hra_lib_reads FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_hra_lib_revisions_ro BEFORE DELETE OR UPDATE ON public.hra_lib_revisions FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_hra_pay_bank_changes_ro BEFORE DELETE OR UPDATE ON public.hra_pay_bank_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_hra_pay_bank_keep BEFORE DELETE OR UPDATE ON public.hra_pay_banks FOR EACH ROW EXECUTE FUNCTION public.fn_hra_pay_bank_keep();



CREATE TRIGGER trg_hra_payfile_logs_ro BEFORE DELETE OR UPDATE ON public.hra_payfile_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_hrx_bookings_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hrx_bookings FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_bookings_guard();



CREATE TRIGGER trg_hrx_ot_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hrx_ot_requests FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_ot_guard();



CREATE TRIGGER trg_hrx_ot_pay_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hrx_ot_pay_links FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_ot_pay_guard();



CREATE TRIGGER trg_hrx_resources_guard BEFORE DELETE OR UPDATE ON public.hrx_resources FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_resources_guard();



CREATE TRIGGER trg_hrx_shift_types_guard BEFORE DELETE OR UPDATE ON public.hrx_shift_types FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_shift_types_guard();



CREATE TRIGGER trg_hrx_shifts_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hrx_shifts FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_shifts_guard();



CREATE TRIGGER trg_hrx_stocktake_lines_guard BEFORE INSERT OR DELETE OR UPDATE ON public.hrx_stocktake_lines FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_stocktake_lines_guard();



CREATE TRIGGER trg_hrx_stocktakes_guard BEFORE DELETE OR UPDATE ON public.hrx_stocktakes FOR EACH ROW EXECUTE FUNCTION public.fn_hrx_stocktakes_guard();



CREATE TRIGGER trg_its_asset_guard BEFORE DELETE OR UPDATE ON public.its_assets FOR EACH ROW EXECUTE FUNCTION public.fn_its_asset_guard();



CREATE TRIGGER trg_its_key_events_ro BEFORE DELETE OR UPDATE ON public.its_key_events FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_its_suggest_guard BEFORE DELETE OR UPDATE ON public.its_suggestions FOR EACH ROW EXECUTE FUNCTION public.fn_its_suggest_guard();



CREATE TRIGGER trg_its_suggest_insert BEFORE INSERT ON public.its_suggestions FOR EACH ROW EXECUTE FUNCTION public.fn_its_suggest_insert();



CREATE TRIGGER trg_its_suggestion_log_ro BEFORE DELETE OR UPDATE ON public.its_suggestion_log FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_its_survey_answer_guard BEFORE INSERT ON public.its_survey_answers FOR EACH ROW EXECUTE FUNCTION public.fn_its_survey_answer_guard();



CREATE TRIGGER trg_its_survey_answers_ro BEFORE DELETE OR UPDATE ON public.its_survey_answers FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_its_survey_guard BEFORE DELETE OR UPDATE ON public.its_surveys FOR EACH ROW EXECUTE FUNCTION public.fn_its_survey_guard();



CREATE TRIGGER trg_its_survey_q_guard BEFORE INSERT OR DELETE OR UPDATE ON public.its_survey_questions FOR EACH ROW EXECUTE FUNCTION public.fn_its_survey_q_guard();



CREATE TRIGGER trg_its_survey_takers_ro BEFORE DELETE OR UPDATE ON public.its_survey_takers FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_lgl_case_costs_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_case_costs FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_case_costs_guard();



CREATE TRIGGER trg_lgl_case_hearings_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_case_hearings FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_case_hearings_guard();



CREATE TRIGGER trg_lgl_cases_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_cases FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_cases_guard();



CREATE TRIGGER trg_lgl_contract_reviews_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_contract_reviews FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_contract_reviews_guard();



CREATE TRIGGER trg_lgl_insurance_policies_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_insurance_policies FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_insurance_policies_guard();



CREATE TRIGGER trg_lgl_insurance_postings_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_insurance_postings FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_insurance_postings_guard();



CREATE TRIGGER trg_lgl_license_kinds_guard BEFORE DELETE OR UPDATE ON public.lgl_license_kinds FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_license_kinds_guard();



CREATE TRIGGER trg_lgl_license_renewals_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_license_renewals FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_license_renewals_guard();



CREATE TRIGGER trg_lgl_licenses_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_licenses FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_licenses_guard();



CREATE TRIGGER trg_lgl_review_opinions_guard BEFORE INSERT OR DELETE OR UPDATE ON public.lgl_review_opinions FOR EACH ROW EXECUTE FUNCTION public.fn_lgl_review_opinions_guard();



CREATE TRIGGER trg_ofc_event_guard BEFORE DELETE OR UPDATE ON public.ofc_events FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_event_guard();



CREATE TRIGGER trg_ofc_task_comments_ro BEFORE DELETE OR UPDATE ON public.ofc_task_comments FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_ofc_task_guard BEFORE DELETE OR UPDATE ON public.ofc_tasks FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_task_guard();



CREATE TRIGGER trg_ofc_trip_guard BEFORE DELETE OR UPDATE ON public.ofc_trips FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_trip_guard();



CREATE TRIGGER trg_ofc_trip_settle_guard BEFORE INSERT ON public.ofc_trip_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_ofc_trip_settle_guard();



CREATE TRIGGER trg_ofc_trip_settlements_ro BEFORE DELETE OR UPDATE ON public.ofc_trip_settlements FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_prr_case_guard BEFORE DELETE OR UPDATE ON public.prr_cases FOR EACH ROW EXECUTE FUNCTION public.fn_prr_case_guard();



CREATE TRIGGER trg_prr_case_step_guard BEFORE INSERT OR DELETE OR UPDATE ON public.prr_case_steps FOR EACH ROW EXECUTE FUNCTION public.fn_prr_case_step_guard();



CREATE TRIGGER trg_prr_review_item_guard BEFORE DELETE OR UPDATE ON public.prr_review_items FOR EACH ROW EXECUTE FUNCTION public.fn_prr_review_item_guard();



CREATE TRIGGER trg_qlt_claim_guard BEFORE INSERT OR DELETE OR UPDATE ON public.qlt_claims FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_claim_guard();



CREATE TRIGGER trg_qlt_claim_logs_ro BEFORE DELETE OR UPDATE ON public.qlt_claim_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_qlt_cnt_guard BEFORE DELETE OR UPDATE ON public.qlt_lot_counts FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_cnt_guard();



CREATE TRIGGER trg_qlt_cnt_line_guard BEFORE INSERT OR DELETE OR UPDATE ON public.qlt_lot_count_lines FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_cnt_line_guard();



CREATE TRIGGER trg_qlt_lot_first_move AFTER INSERT ON public.qlt_lots FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_first_move();



CREATE TRIGGER trg_qlt_lot_guard BEFORE INSERT OR DELETE OR UPDATE ON public.qlt_lots FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_guard();



CREATE TRIGGER trg_qlt_lot_move BEFORE INSERT ON public.qlt_lot_moves FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_move();



CREATE TRIGGER trg_qlt_lot_moves_ro BEFORE DELETE OR UPDATE ON public.qlt_lot_moves FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_qlt_lot_pick_guard BEFORE DELETE OR UPDATE ON public.qlt_lot_picks FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_pick_guard();



CREATE TRIGGER trg_qlt_lot_product_guard BEFORE INSERT OR DELETE OR UPDATE ON public.qlt_lot_products FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_lot_product_guard();



CREATE TRIGGER trg_qlt_move_marks_ro BEFORE DELETE OR UPDATE ON public.qlt_move_marks FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_qlt_po_due_guard BEFORE INSERT OR DELETE OR UPDATE ON public.qlt_po_due FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_po_due_guard();



CREATE TRIGGER trg_qlt_sup_eval_guard BEFORE INSERT OR DELETE OR UPDATE ON public.qlt_sup_evals FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_sup_eval_guard();



CREATE TRIGGER trg_qlt_sup_return_guard BEFORE INSERT ON public.acct_stock_moves FOR EACH ROW EXECUTE FUNCTION public.fn_qlt_sup_return_guard();



CREATE TRIGGER trg_sal_opp_guard BEFORE INSERT OR DELETE OR UPDATE ON public.sal_opps FOR EACH ROW EXECUTE FUNCTION public.fn_sal_opp_guard();



CREATE TRIGGER trg_sal_opp_logs_ro BEFORE DELETE OR UPDATE ON public.sal_opp_logs FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();



CREATE TRIGGER trg_staff_left_role AFTER UPDATE OF left_on, account_id ON public.acct_employees FOR EACH ROW EXECUTE FUNCTION public.fn_staff_left_role();









ALTER TABLE ONLY public.acct_accountant_notes
    ADD CONSTRAINT acct_accountant_notes_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);






ALTER TABLE ONLY public.acct_accountant_replies
    ADD CONSTRAINT acct_accountant_replies_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.acct_accountant_notes(id);


















ALTER TABLE ONLY public.acct_assets
    ADD CONSTRAINT acct_assets_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);






ALTER TABLE ONLY public.acct_assets
    ADD CONSTRAINT acct_assets_from_role_fkey FOREIGN KEY (from_role) REFERENCES public.acct_accounts(role);






ALTER TABLE ONLY public.acct_attendance
    ADD CONSTRAINT acct_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.acct_attendance_fixes
    ADD CONSTRAINT acct_attendance_fixes_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES public.acct_attendance(id);












ALTER TABLE ONLY public.acct_bank_feed_runs
    ADD CONSTRAINT acct_bank_feed_runs_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.acct_bank_feed_accounts(id);






ALTER TABLE ONLY public.acct_bank_feed_runs
    ADD CONSTRAINT acct_bank_feed_runs_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.acct_bank_uploads(id);



ALTER TABLE ONLY public.acct_bank_txns
    ADD CONSTRAINT acct_bank_txns_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);






ALTER TABLE ONLY public.acct_bank_txns
    ADD CONSTRAINT acct_bank_txns_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.acct_bank_uploads(id);















ALTER TABLE ONLY public.acct_budgets
    ADD CONSTRAINT acct_budgets_role_fkey FOREIGN KEY (role) REFERENCES public.acct_accounts(role);















ALTER TABLE ONLY public.acct_card_txns
    ADD CONSTRAINT acct_card_txns_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);






ALTER TABLE ONLY public.acct_card_txns
    ADD CONSTRAINT acct_card_txns_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.acct_card_uploads(id);


















ALTER TABLE ONLY public.acct_contract_accrual_rules
    ADD CONSTRAINT acct_contract_accrual_rules_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);



ALTER TABLE ONLY public.acct_contract_accrual_rules
    ADD CONSTRAINT acct_contract_accrual_rules_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.acct_contracts(id);






ALTER TABLE ONLY public.acct_contract_accruals
    ADD CONSTRAINT acct_contract_accruals_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);



ALTER TABLE ONLY public.acct_contract_accruals
    ADD CONSTRAINT acct_contract_accruals_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.acct_contracts(id);



ALTER TABLE ONLY public.acct_contract_accruals
    ADD CONSTRAINT acct_contract_accruals_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.acct_purchases(id);






ALTER TABLE ONLY public.acct_contract_changes
    ADD CONSTRAINT acct_contract_changes_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.acct_contracts(id);



ALTER TABLE ONLY public.acct_contracts
    ADD CONSTRAINT acct_contracts_cash_plan_id_fkey FOREIGN KEY (cash_plan_id) REFERENCES public.acct_cash_plans(id);






ALTER TABLE ONLY public.acct_contracts
    ADD CONSTRAINT acct_contracts_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.acct_depreciations
    ADD CONSTRAINT acct_depreciations_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.acct_assets(id);



ALTER TABLE ONLY public.acct_dunning_sends
    ADD CONSTRAINT acct_dunning_sends_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);


















ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_manual_id_fkey FOREIGN KEY (manual_id) REFERENCES public.acct_manual_entries(id);



ALTER TABLE ONLY public.acct_entry_reversals
    ADD CONSTRAINT acct_entry_reversals_reverse_entry_id_fkey FOREIGN KEY (reverse_entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_entry_tags
    ADD CONSTRAINT acct_entry_tags_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.acct_depts(id);



ALTER TABLE ONLY public.acct_entry_tags
    ADD CONSTRAINT acct_entry_tags_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_entry_tags
    ADD CONSTRAINT acct_entry_tags_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.acct_projects(id);






ALTER TABLE ONLY public.acct_expense_claims
    ADD CONSTRAINT acct_expense_claims_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);












ALTER TABLE ONLY public.acct_expense_claims
    ADD CONSTRAINT acct_expense_claims_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES public.acct_requisitions(id);






ALTER TABLE ONLY public.acct_export_lines
    ADD CONSTRAINT acct_export_lines_export_id_fkey FOREIGN KEY (export_id) REFERENCES public.acct_exports(id);









ALTER TABLE ONLY public.acct_exports
    ADD CONSTRAINT acct_exports_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);






ALTER TABLE ONLY public.acct_fx_revals
    ADD CONSTRAINT acct_fx_revals_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_fx_revals
    ADD CONSTRAINT acct_fx_revals_reverse_entry_id_fkey FOREIGN KEY (reverse_entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_import_lines
    ADD CONSTRAINT acct_import_lines_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.acct_imports(id);









ALTER TABLE ONLY public.acct_imports
    ADD CONSTRAINT acct_imports_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);






ALTER TABLE ONLY public.acct_insurance_done
    ADD CONSTRAINT acct_insurance_done_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);












ALTER TABLE ONLY public.acct_leave_requests
    ADD CONSTRAINT acct_leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);






ALTER TABLE ONLY public.acct_lines
    ADD CONSTRAINT acct_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_lines
    ADD CONSTRAINT acct_lines_role_fkey FOREIGN KEY (role) REFERENCES public.acct_accounts(role);









ALTER TABLE ONLY public.acct_manual_entries
    ADD CONSTRAINT acct_manual_entries_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_opening
    ADD CONSTRAINT acct_opening_role_fkey FOREIGN KEY (role) REFERENCES public.acct_accounts(role);



ALTER TABLE ONLY public.acct_opening
    ADD CONSTRAINT acct_opening_set_id_fkey FOREIGN KEY (set_id) REFERENCES public.acct_opening_sets(id);





















ALTER TABLE ONLY public.acct_payroll_lines
    ADD CONSTRAINT acct_payroll_lines_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.acct_payroll_lines
    ADD CONSTRAINT acct_payroll_lines_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.acct_payroll_runs(id);





















ALTER TABLE ONLY public.acct_payslip_mails
    ADD CONSTRAINT acct_payslip_mails_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.acct_payroll_lines(id);



ALTER TABLE ONLY public.acct_pg_txns
    ADD CONSTRAINT acct_pg_txns_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);






ALTER TABLE ONLY public.acct_pg_txns
    ADD CONSTRAINT acct_pg_txns_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.acct_pg_uploads(id);









ALTER TABLE ONLY public.acct_po_lines
    ADD CONSTRAINT acct_po_lines_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.acct_pos(id);






ALTER TABLE ONLY public.acct_pos
    ADD CONSTRAINT acct_pos_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.acct_pos
    ADD CONSTRAINT acct_pos_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.acct_purchases(id);



ALTER TABLE ONLY public.acct_pos
    ADD CONSTRAINT acct_pos_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES public.acct_requisitions(id);



ALTER TABLE ONLY public.acct_projects
    ADD CONSTRAINT acct_projects_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.acct_depts(id);



ALTER TABLE ONLY public.acct_purchases
    ADD CONSTRAINT acct_purchases_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);









ALTER TABLE ONLY public.acct_purchases
    ADD CONSTRAINT acct_purchases_pay_role_fkey FOREIGN KEY (pay_role) REFERENCES public.acct_accounts(role);



ALTER TABLE ONLY public.acct_purchases
    ADD CONSTRAINT acct_purchases_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES public.acct_requisitions(id);



ALTER TABLE ONLY public.acct_receipt_promises
    ADD CONSTRAINT acct_receipt_promises_cash_plan_id_fkey FOREIGN KEY (cash_plan_id) REFERENCES public.acct_cash_plans(id);






ALTER TABLE ONLY public.acct_receipt_promises
    ADD CONSTRAINT acct_receipt_promises_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);









ALTER TABLE ONLY public.acct_reorder_draft_lines
    ADD CONSTRAINT acct_reorder_draft_lines_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.acct_reorder_drafts(id);









ALTER TABLE ONLY public.acct_reorder_drafts
    ADD CONSTRAINT acct_reorder_drafts_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.acct_reorder_drafts
    ADD CONSTRAINT acct_reorder_drafts_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.acct_pos(id);



ALTER TABLE ONLY public.acct_requisitions
    ADD CONSTRAINT acct_requisitions_account_role_fkey FOREIGN KEY (account_role) REFERENCES public.acct_accounts(role);















ALTER TABLE ONLY public.acct_rule_dept
    ADD CONSTRAINT acct_rule_dept_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.acct_depts(id);









ALTER TABLE ONLY public.acct_rule_maps
    ADD CONSTRAINT acct_rule_maps_from_role_fkey FOREIGN KEY (from_role) REFERENCES public.acct_accounts(role);



ALTER TABLE ONLY public.acct_rule_maps
    ADD CONSTRAINT acct_rule_maps_to_role_fkey FOREIGN KEY (to_role) REFERENCES public.acct_accounts(role);






ALTER TABLE ONLY public.acct_sales_doc_lines
    ADD CONSTRAINT acct_sales_doc_lines_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.acct_sales_docs(id);









ALTER TABLE ONLY public.acct_sales_docs
    ADD CONSTRAINT acct_sales_docs_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.acct_sales_docs(id);



ALTER TABLE ONLY public.acct_sales_docs
    ADD CONSTRAINT acct_sales_docs_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.acct_sales_docs
    ADD CONSTRAINT acct_sales_docs_prev_id_fkey FOREIGN KEY (prev_id) REFERENCES public.acct_sales_docs(id);



ALTER TABLE ONLY public.acct_sales_docs
    ADD CONSTRAINT acct_sales_docs_revenue_role_fkey FOREIGN KEY (revenue_role) REFERENCES public.acct_accounts(role);



ALTER TABLE ONLY public.acct_sales_docs
    ADD CONSTRAINT acct_sales_docs_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.acct_sales_docs(id);



ALTER TABLE ONLY public.acct_sales_targets
    ADD CONSTRAINT acct_sales_targets_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.acct_depts(id);












ALTER TABLE ONLY public.acct_severance_runs
    ADD CONSTRAINT acct_severance_runs_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);



ALTER TABLE ONLY public.acct_source_tags
    ADD CONSTRAINT acct_source_tags_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.acct_depts(id);



ALTER TABLE ONLY public.acct_source_tags
    ADD CONSTRAINT acct_source_tags_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.acct_projects(id);















ALTER TABLE ONLY public.acct_stock_moves
    ADD CONSTRAINT acct_stock_moves_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.acct_warehouses(id);









ALTER TABLE ONLY public.acct_stock_rules
    ADD CONSTRAINT acct_stock_rules_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);









ALTER TABLE ONLY public.acct_stock_transfers
    ADD CONSTRAINT acct_stock_transfers_from_wh_fkey FOREIGN KEY (from_wh) REFERENCES public.acct_warehouses(id);






ALTER TABLE ONLY public.acct_stock_transfers
    ADD CONSTRAINT acct_stock_transfers_to_wh_fkey FOREIGN KEY (to_wh) REFERENCES public.acct_warehouses(id);















ALTER TABLE ONLY public.acct_tax_inbox
    ADD CONSTRAINT acct_tax_inbox_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.acct_purchases(id);












ALTER TABLE ONLY public.acct_transfer_approvals
    ADD CONSTRAINT acct_transfer_approvals_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.acct_transfer_batches(id);









ALTER TABLE ONLY public.acct_transfer_items
    ADD CONSTRAINT acct_transfer_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.acct_transfer_batches(id);



ALTER TABLE ONLY public.acct_transfer_items
    ADD CONSTRAINT acct_transfer_items_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.acct_transfer_items
    ADD CONSTRAINT acct_transfer_items_pay_role_fkey FOREIGN KEY (pay_role) REFERENCES public.acct_accounts(role);






ALTER TABLE ONLY public.acct_vehicle_costs
    ADD CONSTRAINT acct_vehicle_costs_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.acct_purchases(id);



ALTER TABLE ONLY public.acct_vehicle_costs
    ADD CONSTRAINT acct_vehicle_costs_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.acct_vehicles(id);






ALTER TABLE ONLY public.acct_vehicle_trips
    ADD CONSTRAINT acct_vehicle_trips_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.acct_vehicles(id);









ALTER TABLE ONLY public.acct_year_closings
    ADD CONSTRAINT acct_year_closings_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acct_entries(id);






ALTER TABLE ONLY public.acct_yearend_checks
    ADD CONSTRAINT acct_yearend_checks_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.corp_doc_versions
    ADD CONSTRAINT corp_doc_versions_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.corp_docs(id);












ALTER TABLE ONLY public.qlt_lot_moves
    ADD CONSTRAINT fk_qlt_lot_moves_claim FOREIGN KEY (claim_id) REFERENCES public.qlt_claims(id);



ALTER TABLE ONLY public.hr_applicant_purges
    ADD CONSTRAINT hr_applicant_purges_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.hr_applicants(id);



ALTER TABLE ONLY public.hr_applicant_purges
    ADD CONSTRAINT hr_applicant_purges_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES public.hr_job_postings(id);









ALTER TABLE ONLY public.hr_applicants
    ADD CONSTRAINT hr_applicants_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.hr_applicants
    ADD CONSTRAINT hr_applicants_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES public.hr_job_postings(id);









ALTER TABLE ONLY public.hr_contracts
    ADD CONSTRAINT hr_contracts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);






ALTER TABLE ONLY public.hr_contracts
    ADD CONSTRAINT hr_contracts_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.hr_contract_templates(id);



ALTER TABLE ONLY public.hr_interviews
    ADD CONSTRAINT hr_interviews_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.hr_applicants(id);















ALTER TABLE ONLY public.hr_review_goals
    ADD CONSTRAINT hr_review_goals_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.hr_review_cycles(id);



ALTER TABLE ONLY public.hr_review_goals
    ADD CONSTRAINT hr_review_goals_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.hr_review_results
    ADD CONSTRAINT hr_review_results_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.hr_review_cycles(id);



ALTER TABLE ONLY public.hr_review_results
    ADD CONSTRAINT hr_review_results_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);















ALTER TABLE ONLY public.hr_training_records
    ADD CONSTRAINT hr_training_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);






ALTER TABLE ONLY public.hr_training_records
    ADD CONSTRAINT hr_training_records_kind_code_fkey FOREIGN KEY (kind_code) REFERENCES public.hr_training_kinds(code);









ALTER TABLE ONLY public.hra_close_marks
    ADD CONSTRAINT hra_close_marks_item_key_fkey FOREIGN KEY (item_key) REFERENCES public.hra_close_items(key);









ALTER TABLE ONLY public.hra_leave_promos
    ADD CONSTRAINT hra_leave_promos_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.hra_lib_posts
    ADD CONSTRAINT hra_lib_posts_corp_doc_id_fkey FOREIGN KEY (corp_doc_id) REFERENCES public.corp_docs(id);












ALTER TABLE ONLY public.hra_lib_reads
    ADD CONSTRAINT hra_lib_reads_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.hra_lib_posts(id);






ALTER TABLE ONLY public.hra_lib_revisions
    ADD CONSTRAINT hra_lib_revisions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.hra_lib_posts(id);






ALTER TABLE ONLY public.hra_pay_bank_changes
    ADD CONSTRAINT hra_pay_bank_changes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.hra_pay_banks
    ADD CONSTRAINT hra_pay_banks_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);






ALTER TABLE ONLY public.hra_payfile_logs
    ADD CONSTRAINT hra_payfile_logs_format_id_fkey FOREIGN KEY (format_id) REFERENCES public.hra_bank_formats(id);






ALTER TABLE ONLY public.hra_payfile_logs
    ADD CONSTRAINT hra_payfile_logs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.acct_payroll_runs(id);









ALTER TABLE ONLY public.hrx_bookings
    ADD CONSTRAINT hrx_bookings_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.hrx_resources(id);






ALTER TABLE ONLY public.hrx_ot_pay_links
    ADD CONSTRAINT hrx_ot_pay_links_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.acct_payroll_lines(id);



ALTER TABLE ONLY public.hrx_ot_pay_links
    ADD CONSTRAINT hrx_ot_pay_links_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.hrx_ot_requests(id);



ALTER TABLE ONLY public.hrx_ot_pay_links
    ADD CONSTRAINT hrx_ot_pay_links_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.acct_payroll_runs(id);









ALTER TABLE ONLY public.hrx_ot_requests
    ADD CONSTRAINT hrx_ot_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);












ALTER TABLE ONLY public.hrx_shifts
    ADD CONSTRAINT hrx_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);



ALTER TABLE ONLY public.hrx_shifts
    ADD CONSTRAINT hrx_shifts_type_code_fkey FOREIGN KEY (type_code) REFERENCES public.hrx_shift_types(code);






ALTER TABLE ONLY public.hrx_stocktake_lines
    ADD CONSTRAINT hrx_stocktake_lines_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.acct_assets(id);






ALTER TABLE ONLY public.hrx_stocktake_lines
    ADD CONSTRAINT hrx_stocktake_lines_stocktake_id_fkey FOREIGN KEY (stocktake_id) REFERENCES public.hrx_stocktakes(id);









ALTER TABLE ONLY public.its_assets
    ADD CONSTRAINT its_assets_cash_plan_id_fkey FOREIGN KEY (cash_plan_id) REFERENCES public.acct_cash_plans(id);
























ALTER TABLE ONLY public.its_suggestion_log
    ADD CONSTRAINT its_suggestion_log_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.its_suggestions(id);












ALTER TABLE ONLY public.its_survey_answers
    ADD CONSTRAINT its_survey_answers_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.its_surveys(id);



ALTER TABLE ONLY public.its_survey_questions
    ADD CONSTRAINT its_survey_questions_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.its_surveys(id);






ALTER TABLE ONLY public.its_survey_takers
    ADD CONSTRAINT its_survey_takers_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.its_surveys(id);






ALTER TABLE ONLY public.lgl_case_costs
    ADD CONSTRAINT lgl_case_costs_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.lgl_cases(id);






ALTER TABLE ONLY public.lgl_case_costs
    ADD CONSTRAINT lgl_case_costs_expense_claim_id_fkey FOREIGN KEY (expense_claim_id) REFERENCES public.acct_expense_claims(id);



ALTER TABLE ONLY public.lgl_case_costs
    ADD CONSTRAINT lgl_case_costs_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.acct_purchases(id);



ALTER TABLE ONLY public.lgl_case_hearings
    ADD CONSTRAINT lgl_case_hearings_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.lgl_cases(id);









ALTER TABLE ONLY public.lgl_contract_reviews
    ADD CONSTRAINT lgl_contract_reviews_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.acct_contracts(id);












ALTER TABLE ONLY public.lgl_insurance_policies
    ADD CONSTRAINT lgl_insurance_policies_renewed_from_fkey FOREIGN KEY (renewed_from) REFERENCES public.lgl_insurance_policies(id);






ALTER TABLE ONLY public.lgl_insurance_postings
    ADD CONSTRAINT lgl_insurance_postings_manual_id_fkey FOREIGN KEY (manual_id) REFERENCES public.acct_manual_entries(id);



ALTER TABLE ONLY public.lgl_insurance_postings
    ADD CONSTRAINT lgl_insurance_postings_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.lgl_insurance_policies(id);









ALTER TABLE ONLY public.lgl_license_renewals
    ADD CONSTRAINT lgl_license_renewals_license_id_fkey FOREIGN KEY (license_id) REFERENCES public.lgl_licenses(id);






ALTER TABLE ONLY public.lgl_licenses
    ADD CONSTRAINT lgl_licenses_kind_code_fkey FOREIGN KEY (kind_code) REFERENCES public.lgl_license_kinds(code);









ALTER TABLE ONLY public.lgl_review_opinions
    ADD CONSTRAINT lgl_review_opinions_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.lgl_contract_reviews(id);


















ALTER TABLE ONLY public.ofc_task_comments
    ADD CONSTRAINT ofc_task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.ofc_tasks(id);









ALTER TABLE ONLY public.ofc_trip_settlements
    ADD CONSTRAINT ofc_trip_settlements_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.acct_expense_claims(id);






ALTER TABLE ONLY public.ofc_trip_settlements
    ADD CONSTRAINT ofc_trip_settlements_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.ofc_trips(id);



ALTER TABLE ONLY public.ofc_trips
    ADD CONSTRAINT ofc_trips_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.acct_expense_claims(id);



ALTER TABLE ONLY public.ofc_trips
    ADD CONSTRAINT ofc_trips_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES public.acct_requisitions(id);






ALTER TABLE ONLY public.prr_case_steps
    ADD CONSTRAINT prr_case_steps_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.prr_cases(id);









ALTER TABLE ONLY public.prr_cases
    ADD CONSTRAINT prr_cases_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.acct_employees(id);












ALTER TABLE ONLY public.prr_review_items
    ADD CONSTRAINT prr_review_items_quarter_fkey FOREIGN KEY (quarter) REFERENCES public.prr_reviews(quarter);












ALTER TABLE ONLY public.qlt_claim_logs
    ADD CONSTRAINT qlt_claim_logs_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.qlt_claims(id);









ALTER TABLE ONLY public.qlt_claims
    ADD CONSTRAINT qlt_claims_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.qlt_lots(id);









ALTER TABLE ONLY public.qlt_claims
    ADD CONSTRAINT qlt_claims_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);






ALTER TABLE ONLY public.qlt_lot_count_lines
    ADD CONSTRAINT qlt_lot_count_lines_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.qlt_lot_counts(id);






ALTER TABLE ONLY public.qlt_lot_count_lines
    ADD CONSTRAINT qlt_lot_count_lines_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.qlt_lots(id);












ALTER TABLE ONLY public.qlt_lot_moves
    ADD CONSTRAINT qlt_lot_moves_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.qlt_lots(id);



ALTER TABLE ONLY public.qlt_lot_moves
    ADD CONSTRAINT qlt_lot_moves_move_id_fkey FOREIGN KEY (move_id) REFERENCES public.acct_stock_moves(id);






ALTER TABLE ONLY public.qlt_lot_picks
    ADD CONSTRAINT qlt_lot_picks_consumed_move_id_fkey FOREIGN KEY (consumed_move_id) REFERENCES public.acct_stock_moves(id);






ALTER TABLE ONLY public.qlt_lot_picks
    ADD CONSTRAINT qlt_lot_picks_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.qlt_lots(id);















ALTER TABLE ONLY public.qlt_lots
    ADD CONSTRAINT qlt_lots_in_move_id_fkey FOREIGN KEY (in_move_id) REFERENCES public.acct_stock_moves(id);






ALTER TABLE ONLY public.qlt_lots
    ADD CONSTRAINT qlt_lots_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.qlt_lots
    ADD CONSTRAINT qlt_lots_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.acct_pos(id);






ALTER TABLE ONLY public.qlt_move_marks
    ADD CONSTRAINT qlt_move_marks_move_id_fkey FOREIGN KEY (move_id) REFERENCES public.acct_stock_moves(id);



ALTER TABLE ONLY public.qlt_po_due
    ADD CONSTRAINT qlt_po_due_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.acct_pos(id);












ALTER TABLE ONLY public.qlt_sup_evals
    ADD CONSTRAINT qlt_sup_evals_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);






ALTER TABLE ONLY public.sal_opp_logs
    ADD CONSTRAINT sal_opp_logs_opp_id_fkey FOREIGN KEY (opp_id) REFERENCES public.sal_opps(id);









ALTER TABLE ONLY public.sal_opps
    ADD CONSTRAINT sal_opps_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.acct_parties(id);



ALTER TABLE ONLY public.sal_opps
    ADD CONSTRAINT sal_opps_quote_doc_id_fkey FOREIGN KEY (quote_doc_id) REFERENCES public.acct_sales_docs(id);

-- ===== 조회 =====
CREATE OR REPLACE VIEW public.v_acct_line_tags AS
 SELECT l.id AS line_id,
    l.entry_id,
    l.role,
    l.debit,
    l.credit,
    e.ym,
    e.entry_date,
    e.source,
    COALESCE(t.dept_id, s.dept_id, r.dept_id) AS dept_id,
    COALESCE(t.project_id, s.project_id) AS project_id
   FROM acct_lines l
     JOIN acct_entries e ON e.id = l.entry_id
     LEFT JOIN acct_entry_tags t ON t.entry_id = e.id
     LEFT JOIN acct_source_tags s ON s.source = e.source AND s.source_key = e.source_key
     LEFT JOIN acct_rule_dept r ON r.source = e.source;

CREATE OR REPLACE VIEW public.v_acct_wh_stock AS
 WITH main AS (
         SELECT acct_warehouses.id
           FROM acct_warehouses
          WHERE acct_warehouses.is_main
         LIMIT 1
        ), q AS (
         SELECT m.option_id,
            COALESCE(m.warehouse_id, ( SELECT main.id
                   FROM main)) AS wh_id,
            m.qty
           FROM acct_stock_moves m
        UNION ALL
         SELECT t.option_id,
            t.from_wh,
            - t.qty
           FROM acct_stock_transfers t
        UNION ALL
         SELECT t.option_id,
            t.to_wh,
            t.qty
           FROM acct_stock_transfers t
        )
 SELECT option_id,
    wh_id,
    sum(qty)::integer AS qty
   FROM q
  GROUP BY option_id, wh_id;

CREATE OR REPLACE VIEW public.v_qlt_lot_qty AS
 SELECT id AS lot_id,
    option_id,
    COALESCE(( SELECT m.qty_after
           FROM qlt_lot_moves m
          WHERE m.lot_id = l.id
          ORDER BY m.id DESC
         LIMIT 1), 0) AS qty
   FROM qlt_lots l;

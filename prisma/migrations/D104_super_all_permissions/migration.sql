-- =====================================================================
-- D104 — v10.51 (2026-10-21 결정 · SUPER 는 모든 권한 · docs/104)
--
--   ① fn_has_role(계정, 역할...)  DB 쪽 역할 검사의 공통 함수 — SUPER 는 언제나 참.
--                                  앞으로 트리거 · 함수에서 역할을 볼 때는 account_roles 를 직접 읽지 말고 이 함수를 씁니다.
--   ② fn_adx_statement_flow       퍼블리셔 명세서 집행(PAID)을 「PAYOUT 만」 → 「PAYOUT 또는 SUPER」로.
--                                  승인(APPROVED)도 같은 함수로 바꿈(전과 같이 ADMIN · SUPER).
--
--   그대로 두는 것(권한이 아니라 통제):
--     · 2인 원칙 — 신청자 ≠ 승인자 ≠ 집행자(ADX), 확정한 사람 ≠ 지급한 사람(fn_payout_two_person).
--       SUPER 도 자기가 확정 · 승인한 건은 지급하지 못합니다.
--     · 지급 게이트(adx.payout_gate) · 원장 일치 · 이체 참조 필수.
--     · 마지막 SUPER 회수 금지 · ADMIN/PAYOUT 겸직 금지(SUPER 는 이미 예외).
--
--   자료를 지우지 않습니다 — 함수 1개 더함 · 함수 1개 바꿈. 재실행 안전.
-- =====================================================================

/* ── ① 공통 역할 검사 ──────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION fn_has_role(p_account uuid, VARIADIC p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_account IS NOT NULL AND EXISTS (
    SELECT 1 FROM account_roles r
     WHERE r.account_id = p_account
       AND (r.role = 'SUPER' OR r.role = ANY (p_roles)))
$$;
COMMENT ON FUNCTION fn_has_role(uuid, text[]) IS
  '2026-10-21 결정 — SUPER 는 모든 권한(앞으로 생기는 권한 포함). 역할 검사는 이 함수로 — SUPER 는 언제나 참. 서버의 hasRole(src/core/auth.ts)과 같은 규칙.';

/* ── ② 퍼블리셔 명세서 — 신청 → 승인 → 집행 · 2인 원칙 · 게이트 · 원장 (D084 에서 역할 검사만 바꿈) ── */
CREATE OR REPLACE FUNCTION fn_adx_statement_flow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_items bigint;
BEGIN
  IF NEW.status = OLD.status THEN
    IF (NEW.gross, NEW.withholding, NEW.net, NEW.confirmed_revenue) IS DISTINCT FROM (OLD.gross, OLD.withholding, OLD.net, OLD.confirmed_revenue)
       AND OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ADX_STMT: 신청된 명세서의 금액은 바꿀 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'REQUESTED' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'ADX_STMT: 마감된(초안) 명세서만 신청할 수 있습니다'; END IF;
    IF NEW.requested_by IS NULL THEN RAISE EXCEPTION 'ADX_STMT: 신청자가 없습니다'; END IF;
    IF EXISTS (SELECT 1 FROM adx_publishers p WHERE p.id = NEW.publisher_id AND p.status = 'HOLD') THEN
      RAISE EXCEPTION 'ADX_STMT: 보류 중인 퍼블리셔는 신청할 수 없습니다';
    END IF;
    NEW.requested_at := now();
  ELSIF NEW.status = 'APPROVED' THEN
    IF OLD.status <> 'REQUESTED' THEN RAISE EXCEPTION 'ADX_STMT: 신청된 명세서만 승인할 수 있습니다'; END IF;
    IF NEW.approved_by IS NULL OR NEW.approved_by = OLD.requested_by THEN
      RAISE EXCEPTION 'ADX_STMT: 자기가 신청한 것을 자기가 승인할 수 없습니다(2인 원칙)';
    END IF;
    IF NOT fn_has_role(NEW.approved_by, 'ADMIN') THEN
      RAISE EXCEPTION 'ADX_STMT: 운영(ADMIN · SUPER)만 승인할 수 있습니다';
    END IF;
    NEW.approved_at := now();
  ELSIF NEW.status = 'PAID' THEN
    IF OLD.status <> 'APPROVED' THEN RAISE EXCEPTION 'ADX_STMT: 승인 상태가 아니면 집행할 수 없습니다'; END IF;
    IF fn_adx_setting('adx.payout_gate', 'closed') <> 'open' THEN
      RAISE EXCEPTION 'ADX_GATE: 지급 게이트가 닫혀 있습니다 — 전자금융업 확인 전에는 돈이 나가지 않습니다';
    END IF;
    IF NEW.paid_by IS NULL OR NEW.paid_by IN (OLD.approved_by, OLD.requested_by) THEN
      RAISE EXCEPTION 'ADX_STMT: 승인 · 신청한 사람은 집행할 수 없습니다(2인 원칙)';
    END IF;
    IF NOT fn_has_role(NEW.paid_by, 'PAYOUT') THEN
      RAISE EXCEPTION 'ADX_STMT: 지급 담당(PAYOUT · SUPER)만 집행할 수 있습니다';
    END IF;
    IF coalesce(btrim(NEW.paid_ref), '') = '' THEN RAISE EXCEPTION 'ADX_STMT: 이체 참조(은행 거래번호)를 적어 주십시오'; END IF;
    SELECT coalesce(sum(amount), 0) INTO v_items FROM adx_statement_items WHERE statement_id = NEW.id;
    IF v_items <> NEW.confirmed_revenue THEN
      RAISE EXCEPTION 'ADX_LEDGER: 명세서 항목 합계(%)와 확정 수익(%)이 다릅니다 — 원장 불일치로 지급을 막습니다', v_items, NEW.confirmed_revenue;
    END IF;
    NEW.paid_at := now();
  ELSIF NEW.status = 'CARRIED' OR NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'ADX_STMT: 이 상태로 되돌릴 수 없습니다';
  END IF;
  RETURN NEW;
END $$;

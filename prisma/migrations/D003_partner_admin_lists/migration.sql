-- =====================================================================
-- D003 — 파트너 운영 목록 (2026-10-02)
--
--   1. 입점 반려에는 사유가 필요합니다 (SB-ADM-PTN-020)
--      C998 이 partners.status 에 'REJECTED' 를 열었지만 사유 강제가 없었습니다.
--      사유는 제휴 심사와 같은 자리(suspended_reason)에 둡니다.
--   2. 리드 이용료 반려 신청 (T-04, SB-PTC-CTR-330 → SB-ADM-PTN-050)
--      파트너가 신청하고, 운영이 인정(무효) 또는 기각합니다.
--      전에는 신청을 받을 자리가 없어 "고객센터로 알려 주십시오" 였습니다.
--
--   재실행 안전 (IF NOT EXISTS · CREATE OR REPLACE · DROP TRIGGER IF EXISTS).
-- =====================================================================

/* ── 1. 입점 반려 사유 ─────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION fn_partner_reject_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'REJECTED' AND coalesce(btrim(NEW.suspended_reason), '') = '' THEN
    RAISE EXCEPTION
      'PARTNER: 입점 반려에는 사유가 필요합니다 — 무엇을 갖춰야 다시 신청할 수 있는지 알아야 합니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_reject_guard ON partners;
CREATE TRIGGER trg_partner_reject_guard BEFORE INSERT OR UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION fn_partner_reject_guard();

/* ── 2. 리드 이용료 반려 신청 ──────────────────────────────────────────
 *
 * ★ 이용료는 열람 시점에 생깁니다(정보 이용료). 그래서 "미열람" 조건은
 *   이 모델에서 성립하지 않습니다 — 반려 대상은 **열람한 뒤 알게 된
 *   리드 자체의 결함**(허위 · 연락 불가 · 중복 · 범위 밖)뿐입니다.
 *   상담 결렬은 사유가 아닙니다 — 그것까지 판정하면 플랫폼이 거래 당사자가 됩니다.
 *
 * 자격 (트리거가 집행)
 *   - 리드 접수(delivered_at) 72시간 이내
 *   - 이용료 한 건에 신청 한 번 (기각된 건을 다시 내지 못합니다)
 *   - 월 한도: 당월 신청 수 < max(1, ceil(당월 수신 건수 × 15%))
 *     한도가 없으면 확인비용을 내지 않고 리드만 소진하는 경로가 열립니다.
 */
CREATE TABLE IF NOT EXISTS lead_fee_disputes (
  id              bigserial PRIMARY KEY,
  fee_id          bigint NOT NULL UNIQUE REFERENCES lead_fees(id) ON DELETE CASCADE,
  partner_id      uuid   NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  reason_code     text   NOT NULL CHECK (reason_code IN
                    ('FALSE_INFO','UNREACHABLE','DUPLICATE','OUT_OF_SCOPE')),
  reason          text   NOT NULL,
  evidence        text,
  state           text   NOT NULL DEFAULT 'REQUESTED'
                    CHECK (state IN ('REQUESTED','ACCEPTED','DISMISSED')),
  rule_code       text   REFERENCES risk_rules(code),
  decision_reason text,
  decided_by      uuid   REFERENCES accounts(id),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_fee_disputes_state
  ON lead_fee_disputes(state, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_fee_disputes_partner
  ON lead_fee_disputes(partner_id, created_at DESC);

COMMENT ON TABLE lead_fee_disputes IS
  '리드 이용료 반려 신청(T-04). 파트너 신청 → 운영 인정(이용료 무효, 위험감지 규칙 근거) 또는 기각(사유). D003';
COMMENT ON COLUMN lead_fee_disputes.reason_code IS
  'FALSE_INFO(허위 정보) · UNREACHABLE(연락 불가) · DUPLICATE(중복 리드) · OUT_OF_SCOPE(지역·분야 밖). 상담 결렬은 사유가 아님';

CREATE OR REPLACE FUNCTION fn_lead_fee_dispute_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fee   lead_fees%ROWTYPE;
  v_deliv timestamptz;
  v_recv  int;
  v_used  int;
  v_cap   int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_fee FROM lead_fees WHERE id = NEW.fee_id;
    IF NOT FOUND OR v_fee.partner_id <> NEW.partner_id THEN
      RAISE EXCEPTION 'LEADFEE: 내 이용료가 아닙니다';
    END IF;
    IF v_fee.state = 'VOIDED' THEN
      RAISE EXCEPTION 'LEADFEE: 이미 무효 처리된 이용료입니다';
    END IF;
    IF coalesce(btrim(NEW.reason), '') = '' THEN
      RAISE EXCEPTION 'LEADFEE: 반려 사유를 구체적으로 적어 주십시오 — 무엇이 사실과 달랐는지';
    END IF;

    SELECT delivered_at INTO v_deliv FROM lead_deliveries WHERE id = v_fee.delivery_id;
    IF v_deliv < now() - interval '72 hours' THEN
      RAISE EXCEPTION 'LEADFEE: 리드 접수 후 72시간이 지나 반려를 신청할 수 없습니다';
    END IF;

    SELECT count(*) INTO v_recv FROM lead_deliveries
     WHERE partner_id = NEW.partner_id
       AND delivered_at >= date_trunc('month', now());
    SELECT count(*) INTO v_used FROM lead_fee_disputes
     WHERE partner_id = NEW.partner_id
       AND created_at >= date_trunc('month', now());
    v_cap := greatest(1, ceil(v_recv * 0.15)::int);
    IF v_used >= v_cap THEN
      RAISE EXCEPTION 'LEADFEE: 이번 달 반려 신청 한도(수신 %건의 15%%, %건)를 넘었습니다', v_recv, v_cap;
    END IF;

    NEW.state := 'REQUESTED';
    NEW.rule_code := NULL; NEW.decision_reason := NULL;
    NEW.decided_by := NULL; NEW.decided_at := NULL;
    RETURN NEW;
  END IF;

  /* UPDATE — 판정은 한 번뿐이고, 신청 내용은 바꾸지 못합니다. */
  IF NEW.fee_id <> OLD.fee_id OR NEW.partner_id <> OLD.partner_id
     OR NEW.reason_code <> OLD.reason_code OR NEW.reason <> OLD.reason
     OR NEW.evidence IS DISTINCT FROM OLD.evidence OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'LEADFEE: 신청 내용은 바꿀 수 없습니다';
  END IF;
  IF OLD.state <> 'REQUESTED' THEN
    IF NEW.state <> OLD.state OR NEW.rule_code IS DISTINCT FROM OLD.rule_code
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
      RAISE EXCEPTION 'LEADFEE: 이미 판정된 신청입니다';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state = 'ACCEPTED' THEN
    IF coalesce(btrim(NEW.rule_code), '') = '' THEN
      RAISE EXCEPTION 'LEADFEE: 인정에는 위험감지 규칙 근거가 필요합니다';
    END IF;
  ELSIF NEW.state = 'DISMISSED' THEN
    IF coalesce(btrim(NEW.decision_reason), '') = '' THEN
      RAISE EXCEPTION 'LEADFEE: 기각에는 사유가 필요합니다 — 파트너에게 그대로 보입니다';
    END IF;
  END IF;
  IF NEW.state <> 'REQUESTED' THEN
    IF NEW.decided_by IS NULL THEN
      RAISE EXCEPTION 'LEADFEE: 판정자가 필요합니다';
    END IF;
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_fee_dispute_guard ON lead_fee_disputes;
CREATE TRIGGER trg_lead_fee_dispute_guard BEFORE INSERT OR UPDATE ON lead_fee_disputes
  FOR EACH ROW EXECUTE FUNCTION fn_lead_fee_dispute_guard();

/* 인정 = 이용료 무효. 앱이 두 번 쓰지 않도록 여기서 한 번에 맞춥니다.
 * 무효 가드(fn_lead_fee_void_guard)가 규칙 근거를 다시 봅니다. */
CREATE OR REPLACE FUNCTION fn_lead_fee_dispute_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'ACCEPTED' AND OLD.state = 'REQUESTED' THEN
    UPDATE lead_fees SET state = 'VOIDED', void_rule = NEW.rule_code
     WHERE id = NEW.fee_id AND state <> 'VOIDED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_fee_dispute_apply ON lead_fee_disputes;
CREATE TRIGGER trg_lead_fee_dispute_apply AFTER UPDATE ON lead_fee_disputes
  FOR EACH ROW EXECUTE FUNCTION fn_lead_fee_dispute_apply();

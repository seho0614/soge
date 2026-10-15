-- =====================================================================
-- C997 — 운영 결정 반영 (2026-10-01 사장님 회신)
--
--   Q1 지급 담당(PAYOUT) 화면     → 지급 대기열 뷰 · 확정자/지급자 기록 · 2인 원칙
--   Q2 개인 회원 거래 확정         → (API 역할 조정 — DB 변경 없음)
--   Q3 기능 OFF 시 확정 후 INQUIRY → 양측 확인이 모이면 거래를 CONFIRMED 로
--   Q4 제휴 정산 계좌 본인인증     → 본인인증 안 된 계정의 계좌 등록 차단
--   Q5 운영 계정 사용자 웹 전체    → (API 역할 조정 — DB 변경 없음)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Q3. 양측 확인 → 거래 확정
--
--   ★ 전에는 계약서 서명(fn_auto_confirm_on_contract)으로만 CONFIRMED 가
--     되었습니다. 소개비·성사수수료가 꺼져 있어 계약서를 쓰지 않는 거래는
--     **양측이 확인을 눌러도 INQUIRY 로 남았습니다**(9/30 기능 검증 실측).
--     후기 · 거래 모니터링 · 성사 통계가 전부 이 상태를 봅니다.
--
--   규칙
--     · 두 당사자의 확인(deal_confirmations 2행)이 모이면 CONFIRMED · confirm_mode='BOTH'
--     · 분쟁 중(DISPUTED) · 취소(CANCELLED) · 이미 확정(CONFIRMED · SETTLED)은 건드리지 않습니다
--     · 소개비 기능이 켜져 있고 소개자가 있는데 약정액이 없으면 **확정하지 않습니다**
--       — 소개비를 정하기 전에 확정하면 정산 근거가 사라집니다
--     · 소개비가 켜져 있고 약정액이 있으면 계약서 경로와 똑같이 정산을 만듭니다
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_confirm_when_both() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d record; biz record;
BEGIN
  IF (SELECT count(*) FROM deal_confirmations WHERE deal_id = NEW.deal_id) < 2 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO d FROM deals WHERE id = NEW.deal_id FOR UPDATE;
  IF d.status IN ('CONFIRMED','SETTLED','CANCELLED','DISPUTED') THEN RETURN NEW; END IF;

  IF fn_feature_on('referral_fee') AND d.introducer_account_id IS NOT NULL
     AND d.agreed_fee IS NULL THEN
    RETURN NEW;   -- 소개비 약정이 먼저입니다
  END IF;

  UPDATE deals
     SET status = 'CONFIRMED', confirmed_at = now(),
         confirm_mode = CASE WHEN NEW.source = 'AUTO_7D' THEN 'AUTO' ELSE 'BOTH' END
   WHERE id = d.id;

  IF fn_feature_on('referral_fee')
     AND d.introducer_account_id IS NOT NULL AND d.agreed_fee IS NOT NULL THEN
    SELECT * INTO biz FROM businesses
     WHERE account_id = d.introducer_account_id AND verified_at IS NOT NULL LIMIT 1;
    IF biz.id IS NOT NULL THEN
      INSERT INTO settlements(deal_id, payee_account_id, payee_business_id, amount, status)
      VALUES (d.id, d.introducer_account_id, biz.id, d.agreed_fee, 'REQUESTED')
      ON CONFLICT (deal_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_confirm_when_both ON deal_confirmations;
CREATE TRIGGER trg_confirm_when_both AFTER INSERT ON deal_confirmations
  FOR EACH ROW EXECUTE FUNCTION fn_confirm_when_both();

COMMENT ON FUNCTION fn_confirm_when_both() IS
  'Q3(2026-10-01): 양측 확인이 모이면 거래를 CONFIRMED 로. 소개비가 켜져 있고 약정이 없으면 기다립니다.';

-- 이미 양측이 확인했는데 INQUIRY 등에 남아 있는 거래를 정리합니다(개발 · 운영 공통, 재실행 안전)
UPDATE deals d
   SET status = 'CONFIRMED', confirmed_at = now(), confirm_mode = 'BOTH'
 WHERE d.status IN ('INQUIRY','NEGOTIATING','CONTRACTED','PAYMENT_REPORTED')
   AND (SELECT count(*) FROM deal_confirmations c WHERE c.deal_id = d.id) >= 2
   AND NOT (fn_feature_on('referral_fee') AND d.introducer_account_id IS NOT NULL AND d.agreed_fee IS NULL);

-- ---------------------------------------------------------------------
-- Q1. 지급 — 확정자 · 지급자 · 이체 참조 · 2인 원칙
--
--   확정(CONFIRMED)은 운영(ADMIN), 지급(PAID)은 지급 담당(PAYOUT)이 합니다.
--   같은 사람이 둘 다 하면 사고가 나도 되돌릴 근거가 없습니다 —
--   역할 겸직은 이미 fn_duty 가 막고, 여기서는 **건 단위로도** 막습니다.
-- ---------------------------------------------------------------------
ALTER TABLE partner_settlements
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by      uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS paid_ref     text;

ALTER TABLE hlt_settlements
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS paid_ref     text;

CREATE OR REPLACE FUNCTION fn_payout_two_person() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n jsonb; o jsonb; st_new text; st_old text;
BEGIN
  /* 두 표의 상태 열 이름이 다릅니다(state · status). NEW.status 를 직접 쓰면
     partner_settlements 에서 "no field status" 로 멈추므로 jsonb 로 읽습니다. */
  n := to_jsonb(NEW); o := to_jsonb(OLD);
  st_new := coalesce(n->>'state', n->>'status');
  st_old := coalesce(o->>'state', o->>'status');
  IF st_new = st_old THEN RETURN NEW; END IF;

  IF st_new = 'PAID' THEN
    IF n->>'paid_by' IS NULL AND TG_TABLE_NAME = 'partner_settlements' THEN
      RAISE EXCEPTION 'PAYOUT: 지급자를 남겨야 합니다 — 사고가 나면 누가 보냈는지 알아야 합니다';
    END IF;
    IF n->>'paid_by' IS NOT NULL AND n->>'confirmed_by' IS NOT NULL
       AND n->>'paid_by' = n->>'confirmed_by' THEN
      RAISE EXCEPTION 'PAYOUT: 확정한 사람이 지급할 수 없습니다 — 2인 원칙';
    END IF;
  END IF;
  RETURN NEW;
END $$;

/* 확정 · 지급 시각 — 표마다 따로 채웁니다 (hlt 는 fn_hlt_settle_flow 가 이미 채움) */
CREATE OR REPLACE FUNCTION fn_pstl_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF NEW.state = 'CONFIRMED' THEN NEW.confirmed_at := coalesce(NEW.confirmed_at, now()); END IF;
  IF NEW.state = 'PAID'      THEN NEW.paid_at      := coalesce(NEW.paid_at, now());      END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pstl_stamp ON partner_settlements;
CREATE TRIGGER trg_pstl_stamp BEFORE UPDATE ON partner_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_pstl_stamp();

DROP TRIGGER IF EXISTS trg_pstl_two_person ON partner_settlements;
CREATE TRIGGER trg_pstl_two_person BEFORE UPDATE ON partner_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_payout_two_person();
DROP TRIGGER IF EXISTS trg_hlts_two_person ON hlt_settlements;
CREATE TRIGGER trg_hlts_two_person BEFORE UPDATE ON hlt_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_payout_two_person();

-- 지급 담당 대기열 — 확정됐고 아직 안 나간 것. ready=false 면 왜 못 보내는지 blocker 에 적습니다.
CREATE OR REPLACE VIEW v_payout_queue AS
SELECT 'PARTNER'::text AS kind, s.id, s.track AS sub, b.company_name AS payee,
       s.period_from, s.period_to, s.net_amount AS amount, s.state AS status,
       s.confirmed_by, s.confirmed_at,
       (a.verified_at IS NOT NULL) AS ready,
       CASE WHEN a.id IS NULL THEN '정산 계좌 없음'
            WHEN a.verified_at IS NULL THEN '계좌 1원 인증 전'
            ELSE NULL END AS blocker,
       a.bank_name, a.account_last4, a.holder_name
  FROM partner_settlements s
  JOIN partners p ON p.id = s.partner_id
  JOIN businesses b ON b.id = p.business_id
  LEFT JOIN partner_settlement_accounts a ON a.partner_id = s.partner_id
 WHERE s.state = 'CONFIRMED'
UNION ALL
SELECT 'HEALTH', h.id, sl.type, sl.name,
       h.period_from, h.period_to, h.net_amount, h.status,
       h.confirmed_by, h.confirmed_at,
       (h.net_amount >= 0 AND (sl.type = 'DIRECT' OR coalesce(btrim(sl.submerchant_id),'') <> '')),
       CASE WHEN h.net_amount < 0 THEN '정산액 음수 — 이월 대상'
            WHEN NOT (sl.type = 'DIRECT' OR coalesce(btrim(sl.submerchant_id),'') <> '') THEN '하위가맹점 ID 없음'
            ELSE NULL END,
       NULL, NULL, NULL
  FROM hlt_settlements h
  JOIN hlt_sellers sl ON sl.id = h.seller_id
 WHERE h.status = 'CONFIRMED';

COMMENT ON VIEW v_payout_queue IS
  'Q1(2026-10-01): 지급 담당 대기열. 제휴 파트너(PARTNER) · 건강몰 판매자(HEALTH). ready=false 면 blocker 를 해소해야 지급됩니다.';

-- ---------------------------------------------------------------------
-- Q4. 제휴 정산 계좌 — 본인인증 필수
--
--   계좌 명의와 회원이 같은 사람인지 확인할 첫 단계입니다. 본인인증 없이
--   계좌를 받으면 남의 계좌로 수수료가 나갈 수 있습니다.
--   API 게이트(IDENTITY_VERIFIED)가 먼저 막고, 여기는 마지막 방어선입니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pstl_account_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM partners p
      JOIN businesses b ON b.id = p.business_id
      JOIN accounts ac  ON ac.id = b.account_id
     WHERE p.id = NEW.partner_id AND ac.identity_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'IDENTITY: 본인인증을 먼저 하십시오 — 정산 계좌는 본인 확인 뒤에 등록할 수 있습니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pstl_account_identity ON partner_settlement_accounts;
CREATE TRIGGER trg_pstl_account_identity BEFORE INSERT OR UPDATE OF bank_code, account_enc, holder_name
  ON partner_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION fn_pstl_account_identity();

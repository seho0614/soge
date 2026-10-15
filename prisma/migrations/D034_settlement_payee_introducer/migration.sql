-- v10.27 (G-120) — 정산의 받는 사람은 그 거래의 소개자입니다.
--   전에는 정산 규칙(fn_assert_settlement_rules)이 확정 · 금액 · 인증 사업자만 보고 받는 사람이 소개자인지는 보지 않아,
--   인증된 사업자면 남의 거래의 받는 사람으로 정산 행을 만들 수 있었습니다(소개비 기능이 꺼져 있어 지금은 INV-9 에서 막힘).
--   자동 생성(fn_confirm_when_both)은 늘 소개자를 받는 사람으로 넣으므로 그 경로는 그대로입니다.
--   새 행을 넣을 때와 받는 사람을 바꿀 때만 봅니다(이미 있는 행의 상태 바꾸기는 그대로 — 10/8 기준 어긋난 행 0건).
CREATE OR REPLACE FUNCTION public.fn_assert_settlement_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE d record; b record;
BEGIN
  SELECT * INTO d FROM deals WHERE id = NEW.deal_id;
  IF d.status NOT IN ('CONFIRMED','SETTLED') THEN
    RAISE EXCEPTION 'INV-3 violated: deal % is % (must be CONFIRMED)', d.id, d.status;
  END IF;
  IF d.agreed_fee IS NULL OR NEW.amount <> d.agreed_fee THEN
    RAISE EXCEPTION 'INV-9 violated: settlement amount % <> agreed_fee %',
      NEW.amount, d.agreed_fee;
  END IF;
  /* G-120 — 받는 사람 = 그 거래의 소개자 */
  IF (TG_OP = 'INSERT' OR NEW.payee_account_id IS DISTINCT FROM OLD.payee_account_id)
     AND NEW.payee_account_id IS DISTINCT FROM d.introducer_account_id THEN
    RAISE EXCEPTION 'INV-9R violated (G-120): payee % is not the introducer of deal %', NEW.payee_account_id, d.id;
  END IF;
  SELECT * INTO b FROM businesses WHERE id = NEW.payee_business_id;
  IF b.verified_at IS NULL THEN
    RAISE EXCEPTION 'INV-10 violated: payee business % is not verified', b.id;
  END IF;
  IF b.account_id <> NEW.payee_account_id THEN
    RAISE EXCEPTION 'payee business does not belong to payee account';
  END IF;
  RETURN NEW;
END $$;

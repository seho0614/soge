-- v10.31 (w6) — 정산 승인 단계(D080)의 빈틈 막기.
--   D080 의 승인 검사(trg_settlement_approval)는 UPDATE 에만 걸려 있어, 새 정산을 처음부터 APPROVED · PAID 로 INSERT 하면
--   운영 승인 없이 지급 표시까지 건너뛸 수 있었습니다(공격 검정 C-04e 로 확인).
--   새 정산은 「승인 대기(REQUESTED)」로만 만들 수 있게 합니다 — 서버 · 자동 확정 함수(fn_auto_confirm_on_contract ·
--   fn_confirm_when_both) · 정산 신청은 모두 REQUESTED 로 넣으므로 동작은 같습니다.
CREATE OR REPLACE FUNCTION public.fn_settlement_insert_requested() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'REQUESTED' THEN
    RAISE EXCEPTION 'STL_APPROVE: 새 정산은 승인 대기(REQUESTED)로만 만들 수 있습니다 — 승인 · 지급 표시는 그 뒤 단계입니다';
  END IF;
  NEW.approved_by := NULL; NEW.approved_at := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_settlement_insert_requested ON settlements;
CREATE TRIGGER trg_settlement_insert_requested BEFORE INSERT ON settlements
  FOR EACH ROW EXECUTE FUNCTION fn_settlement_insert_requested();

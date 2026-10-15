-- =====================================================================
-- D030 — 자금수탁 감시(INV-11)의 예외에 교환 배송비 결제의 거래번호 (v10.26 · 2026-10-08)
--
--   D027 이 만든 교환 배송비 결제 표(hlt_exchange_fees)에 결제사 거래번호(pg_tid)가 있습니다.
--   INV-11 은 「남의 돈을 받아 두는(자금수탁) 칸이 스키마 어디에도 없어야 한다」는 감시이고, 예외는 소개몰 주문 결제(hlt_payments.pg_tid)뿐이었습니다.
--   교환 배송비도 **소개몰(직판)에서 회사가 판매자로서 받는 회사의 돈**이라 주문 결제와 같은 이유로 예외입니다 — 중개 거래의 대금을 맡아 두는 것이 아닙니다.
--   (통합 검정 INV-11 · 공격 검정 D-02 가 v10.26 전수 검정에서 이 칸을 잡음 — 감시는 그대로 두고 예외 한 줄만 더함.)
--   예외는 표 · 칸 이름을 정확히 적습니다(다른 hlt_ 표의 같은 칸은 여전히 걸림). 재실행 안전.
-- =====================================================================
CREATE OR REPLACE VIEW public.v_inv11_violations AS
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name ~ 'account_no|bank_code|pg_provider|pg_tid|escrow|vaccount|card_no'
   AND NOT (table_name = 'hlt_payments' AND column_name = 'pg_tid')
   /* v10.26 — 소개몰(직판) 교환 배송비 결제의 거래번호. 회사가 판매자로서 받는 돈(주문 결제와 같음) */
   AND NOT (table_name = 'hlt_exchange_fees' AND column_name = 'pg_tid')
   /* ★ 파트너 정산 계좌는 **우리가 돈을 보내는 곳**입니다.
    *   남의 돈을 받아 두는 것이 아니라 우리 돈을 내보내는 것이라
    *   자금수탁이 아닙니다(법무 확인 2026-09-22). */
   AND table_name <> 'partner_settlement_accounts';

COMMENT ON VIEW public.v_inv11_violations IS
  'INV-11 위반 — 자금을 수탁하는 컬럼. **0이어야 합니다.** '
  '예외: 소개몰(직판) 결제의 거래번호(hlt_payments · hlt_exchange_fees — 회사가 판매자로서 받는 돈) · '
  '파트너 정산 계좌(우리가 **돈을 보내는 곳**)';

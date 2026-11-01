-- =====================================================================
-- D158 · 소개몰 입점 5단계 — 결제대행사 하위가맹점 · 지급 요청 틀(간주 모드 · 실제 결제대행사 호출 없음) (v10.169 · 2026-11-01 · sgb-core docs/260)
--   대표 결정(11/1 · decisions/mall-return-refund #15 A — 판매대금은 판매자에게 직접 귀속 · 회사는 남의 돈을 보관하지 않음 · business-entity #12)
--   ① hlt_payout_requests   정산서 하나에 지급 요청 하나 — 결제대행사에 「이 판매자 하위가맹점으로 지급」을 요청한 기록(금액 = 정산서 지급액 · 결과 · 참조 번호 · 시험 여부)
--      지우기 금지(돈 기록) · 금액은 정산서와 같아야 함 · 입점 판매자 정산서만(직판은 회사 매출이라 지급 없음)
--   ② hlt_sellers.submerchant_at   하위가맹점 등록 시각(운영이 결제대행사 화면에서 받은 번호를 적거나 · 간주 모드에서 시험 번호)
--   실제 결제대행사 연동(하위가맹점 등록 · 지급대행 API)은 계약 뒤 — 지금은 assume.payment 가 on 일 때만 시험(stub)으로 「지급됨」을 남김
-- =====================================================================

ALTER TABLE public.hlt_sellers ADD COLUMN IF NOT EXISTS submerchant_at timestamptz;

CREATE TABLE IF NOT EXISTS public.hlt_payout_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL UNIQUE REFERENCES public.hlt_settlements(id) ON DELETE RESTRICT,
  seller_id     uuid NOT NULL REFERENCES public.hlt_sellers(id) ON DELETE RESTRICT,
  amount        bigint NOT NULL CHECK (amount > 0),
  state         text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY', 'DONE', 'FAILED')),
  provider      text NOT NULL,
  submerchant_id text NOT NULL,
  ref           text,
  stub          boolean NOT NULL DEFAULT false,
  error         text,
  requested_by  uuid REFERENCES public.accounts(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_hlt_payout_seller ON public.hlt_payout_requests (seller_id, created_at DESC);
COMMENT ON TABLE public.hlt_payout_requests IS '소개몰 입점 지급 요청(D158) — 결제대행사가 판매자 하위가맹점으로 지급(회사는 돈을 보관하지 않음 · 결정 A) · 정산서마다 하나 · 지우기 금지';

CREATE OR REPLACE FUNCTION public.fn_hlt_payout_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE st record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HLTS: 지급 요청 기록은 지울 수 없습니다';
  END IF;
  SELECT s.net_amount, s.status, h.type INTO st FROM hlt_settlements s JOIN hlt_sellers h ON h.id = s.seller_id WHERE s.id = NEW.settlement_id;
  IF st.type = 'DIRECT' THEN
    RAISE EXCEPTION 'HLTS: 직판 정산서는 지급 요청이 없습니다';
  END IF;
  IF NEW.amount <> st.net_amount THEN
    RAISE EXCEPTION 'HLTS: 지급 요청 금액이 정산서 지급액과 다릅니다';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'DONE' THEN
    RAISE EXCEPTION 'HLTS: 끝난 지급 요청은 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_payout_guard ON public.hlt_payout_requests;
CREATE TRIGGER trg_hlt_payout_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_payout_guard();

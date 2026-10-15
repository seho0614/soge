-- =====================================================================
-- D010 — 일반 회원 소개코드 · 초과분 결제 · 소개코드 유입 기록 (2026-10-02 「소개코드는 시안대로」)
--
--   전에는
--     · 초과 소개코드(is_extra)가 **결제 없이 기록만** 됐습니다. 청구하는 곳이 없어
--       무료(BASIC) 회원에게 건당 30,000원을 외상으로 주는 구조였습니다.
--     · 소개코드 유입(attribution_events)을 기록하는 길이 없었습니다(엔진 record 를 부르는 곳 0).
--       그래서 같은 방문자가 새로고침만 해도 몇 번이든 쌓일 수 있는 구조를 막을 장치도 없었습니다.
--
--   이 파일이 만드는 것
--     1. referral_code_payments   초과 소개코드 결제(결제키 1건 = 1행 · 재사용 불가 · 수정/삭제 불가)
--     2. referral_codes.extra_payment_key · extra_amount   코드 행에 결제키 · 건당 금액
--     3. trg_refcode_extra_paid   무료 요금제의 초과 코드는 **결제된 것만** 들어갑니다
--                                 (결제 행의 계정 · 구독 · 건수 · 단가와 맞아야 함)
--     4. trg_attr_dedupe_24h      같은 방문자 · 같은 코드의 소개 유입은 24시간에 1번
--
--   바꾸지 않는 것
--     · INV-8(trg_refcode_inv8) — 구독 없는 코드는 계속 DB 가 막습니다.
--     · 유료 요금제(STANDARD · PRO)의 초과 코드 — 지금처럼 is_extra 표시만 합니다(청구처 미정, 보고서 참고).
--     · 광고 귀속(source='AD') — 중복 판정 대상이 아닙니다.
--
--   재실행 안전 — IF NOT EXISTS · CREATE OR REPLACE · DROP TRIGGER IF EXISTS 만 씁니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 초과 소개코드 결제
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_code_payments (
  payment_key     text PRIMARY KEY,                       -- PG 결제 승인 키. 같은 키로 두 번 발급하지 않습니다
  order_id        text NOT NULL UNIQUE,                   -- 결제창 주문번호
  account_id      uuid NOT NULL REFERENCES public.accounts(id),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id),
  unit_price      numeric(12,0) NOT NULL CHECK (unit_price > 0),
  code_count      int NOT NULL CHECK (code_count BETWEEN 1 AND 10),
  amount          numeric(12,0) NOT NULL,
  stub            boolean NOT NULL DEFAULT false,          -- 결제 키가 없는 환경의 시험 결제
  paid_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rcp_amount CHECK (amount = unit_price * code_count),
  CONSTRAINT ck_rcp_key CHECK (btrim(payment_key) <> '' AND btrim(order_id) <> '')
);
CREATE INDEX IF NOT EXISTS idx_rcp_account ON public.referral_code_payments (account_id, paid_at DESC);
COMMENT ON TABLE public.referral_code_payments IS
  'D010 초과 소개코드 결제. 결제키 1건 = 1행(재사용 불가). 소개비가 아니라 회원이 플랫폼에 내는 코드 요금입니다(INV-11).';

DROP TRIGGER IF EXISTS trg_rcp_ro ON public.referral_code_payments;
CREATE TRIGGER trg_rcp_ro BEFORE UPDATE OR DELETE ON public.referral_code_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();

-- ---------------------------------------------------------------------
-- 2. 코드 행에 결제키 · 건당 금액
-- ---------------------------------------------------------------------
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS extra_payment_key text REFERENCES public.referral_code_payments(payment_key);
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS extra_amount numeric(12,0);

ALTER TABLE public.referral_codes DROP CONSTRAINT IF EXISTS ck_refcode_extra_paid_shape;
ALTER TABLE public.referral_codes ADD CONSTRAINT ck_refcode_extra_paid_shape
  CHECK ((extra_payment_key IS NULL) = (extra_amount IS NULL)
         AND (extra_payment_key IS NULL OR is_extra));
CREATE INDEX IF NOT EXISTS idx_refcodes_payment ON public.referral_codes (extra_payment_key)
  WHERE extra_payment_key IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. 무료 요금제의 초과 코드는 결제된 것만
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_refcode_extra_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_price numeric; v_free boolean; p record; v_used int;
BEGIN
  SELECT (sp.monthly_price = 0), sp.extra_code_price INTO v_free, v_price
    FROM public.subscriptions s JOIN public.subscription_plans sp ON sp.code = s.plan_code
   WHERE s.id = NEW.subscription_id;

  IF NEW.extra_payment_key IS NULL THEN
    IF NEW.is_extra AND coalesce(v_free, false) THEN
      RAISE EXCEPTION 'REFCODE: 무료 요금제의 추가 소개코드는 결제 후에만 발급됩니다 (건당 %원)', v_price;
    END IF;
    RETURN NEW;
  END IF;

  -- 결제키가 붙은 코드 — 그 결제와 맞아야 합니다
  SELECT * INTO p FROM public.referral_code_payments WHERE payment_key = NEW.extra_payment_key;
  IF p IS NULL THEN
    RAISE EXCEPTION 'REFCODE: 없는 결제키입니다';
  END IF;
  IF p.account_id <> NEW.owner_account_id OR p.subscription_id <> NEW.subscription_id THEN
    RAISE EXCEPTION 'REFCODE: 다른 계정의 결제로 소개코드를 받을 수 없습니다';
  END IF;
  IF NEW.extra_amount <> p.unit_price THEN
    RAISE EXCEPTION 'REFCODE: 결제 단가와 코드 금액이 다릅니다 (% ≠ %)', NEW.extra_amount, p.unit_price;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rcp:' || NEW.extra_payment_key, 0));
  SELECT count(*) INTO v_used FROM public.referral_codes WHERE extra_payment_key = NEW.extra_payment_key;
  IF v_used >= p.code_count THEN
    RAISE EXCEPTION 'REFCODE: 이 결제로 받을 수 있는 소개코드(%건)를 이미 모두 받았습니다', p.code_count;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_refcode_extra_paid ON public.referral_codes;
CREATE TRIGGER trg_refcode_extra_paid BEFORE INSERT ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.fn_refcode_extra_paid();

-- ---------------------------------------------------------------------
-- 4. 같은 방문자 · 같은 코드의 소개 유입은 24시간에 1번
--
--    새로고침 · 링크 반복 클릭으로 유입 수(touches)가 부풀지 않게 합니다.
--    first-touch 판정(fn_attribution_resolve)은 가장 이른 유입만 보므로 결과가 바뀌지 않습니다.
--    동시에 두 요청이 와도 하나만 들어가도록 (코드, 방문자) 단위로 잠급니다.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_attr_dedupe_24h()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM 'INTRO' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attr:' || NEW.code || '|' || NEW.visitor_key, 0));
  IF EXISTS (
       SELECT 1 FROM public.attribution_events e
        WHERE e.code = NEW.code AND e.visitor_key = NEW.visitor_key AND e.source = 'INTRO'
          AND e.occurred_at >  NEW.occurred_at - interval '24 hours'
          AND e.occurred_at <  NEW.occurred_at + interval '24 hours') THEN
    RAISE EXCEPTION 'ATTR_DUP: 같은 방문자의 같은 소개코드 유입은 24시간에 한 번만 기록합니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_attr_dedupe_24h ON public.attribution_events;
CREATE TRIGGER trg_attr_dedupe_24h BEFORE INSERT ON public.attribution_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_attr_dedupe_24h();

CREATE INDEX IF NOT EXISTS idx_attr_code_visitor ON public.attribution_events (code, visitor_key, occurred_at);

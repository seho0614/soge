-- =====================================================================
-- D022 — 결제 · 환불의 실제 결과와 DB 를 같게, 다시 시도해도 한 번만 반영 (2026-10-06 · v10.18)
--
--   고치는 것 (설계안 4건 + 대조하다 찾은 것)
--     ① 정기결제 재시도가 성공하면 기존 청구서를 갱신 — 기간마다 청구서 1건. 결제사 결과가 불명확하면 PENDING 으로 두고
--        새 결제를 보내지 않습니다(주문번호로 조회해 복구). 결제사의 paymentKey 와 우리 주문번호(order_id)를 따로 둡니다.
--     ② 구독 환불은 결제사 취소를 확인한 뒤에만 완료 — 환불 요청(subscription_refunds)을 따로 두고, 접수 자격과 완료 시각을 나눕니다.
--     ③ 같은 요청은 작업 전에 선점 — idempotency_records 에 상태 · 본문 해시 · HTTP 상태를 둡니다.
--     ④ 결제 실패(PAST_DUE) 상태에서도 해지 — 해지가 확정된 뒤에는 새 청구를 잡지 못합니다(DB 가 막음).
--     ⑤ (찾은 것) 환불이 구독 상태를 CANCELED 로 써서 제약(CANCELLED)에 걸려 늘 실패 → 코드에서 고침. 여기서는 그 뒤의 규칙을 둡니다.
--     ⑥ (찾은 것) 환불 자격의 「결제 당일」이 UTC 날짜 기준 → 한국 날짜 · 실제 결제 시각(paid_at) 기준.
--        「이용」에 소개코드 발급이 빠져 있던 것(codes_used_this_period 를 올리는 곳이 없음)을 실제 발급 수로 셉니다.
--     ⑦ (찾은 것) 청구서의 기간 시작이 밀리초로 잘려 구독의 기간 끝(마이크로초)과 달라지던 것 — 기존 실패 줄을 맞춥니다.
--
--   막는 것은 DB 가 합니다 — API 를 거치지 않는 경로도 같은 규칙을 탑니다.
--   기존 마이그레이션은 고치지 않습니다. 재실행 안전.
-- =====================================================================

-- 1. 청구서 ---------------------------------------------------------------
ALTER TABLE public.subscription_invoices
  ADD COLUMN IF NOT EXISTS order_id    text,
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS pg_status   text,
  ADD COLUMN IF NOT EXISTS checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_stub     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscription_invoices.payment_key IS '결제사가 준 결제 키(paymentKey). 환불 · 대조에 씁니다. 우리 주문번호는 order_id';
COMMENT ON COLUMN public.subscription_invoices.order_id    IS '결제사에 보낸 우리 주문번호. 시도마다 새로 만듭니다 — 결과가 불명확하면 이 번호로 결제사에 조회합니다';
COMMENT ON COLUMN public.subscription_invoices.claimed_at  IS '이 청구를 잡은(PENDING 으로 바꾼) 실제 시각(구독 줄을 잠근 상태에서 찍음 — 해지 시각과 앞뒤가 맞습니다). 잡힌 동안에는 다른 청구가 나가지 않습니다';
COMMENT ON COLUMN public.subscription_invoices.pg_status   IS '결제사에서 마지막으로 확인한 상태 · 확인이 필요한 사유(AMOUNT_MISMATCH 등)';
COMMENT ON COLUMN public.subscription_invoices.checked_at  IS '결제사에 마지막으로 조회한 시각';
COMMENT ON COLUMN public.subscription_invoices.refunded_at IS '환불 완료 시각(결제사 취소 확인 뒤)';
COMMENT ON COLUMN public.subscription_invoices.is_stub     IS '결제사 열쇠 없는 방식(스텁)으로 만든 청구인가. 스텁 방식의 서버는 이 표시가 있는 청구 · 환불만 닫습니다 — 실제 결제사에서 일어난 일은 스텁이 알 수 없습니다';

-- 기존 자료 ① 정기결제 줄은 payment_key 자리에 우리 주문번호가 들어 있습니다 → 자리를 옮깁니다(실제 결제 키는 조회로 채웁니다)
UPDATE public.subscription_invoices
   SET order_id = payment_key, payment_key = NULL
 WHERE billing_key_id IS NOT NULL AND payment_key LIKE 'sub\_%' AND order_id IS NULL;

-- 기존 자료 ② 밀리초로 잘린 기간 시작을 구독의 기간 끝에 맞춥니다(아직 결제되지 않은 줄만 — 결제 완료 줄은 기간을 바꾸지 않습니다)
UPDATE public.subscription_invoices i
   SET period_start = s.current_period_end
  FROM public.subscriptions s
 WHERE s.id = i.subscription_id AND i.status IN ('FAILED', 'PENDING')
   AND i.period_start <> s.current_period_end
   AND i.period_start = date_trunc('milliseconds', s.current_period_end)
   AND NOT EXISTS (SELECT 1 FROM public.subscription_invoices x WHERE x.subscription_id = i.subscription_id AND x.period_start = s.current_period_end);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (SELECT payment_key FROM public.subscription_invoices
                                WHERE payment_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1) t;
  IF n > 0 THEN
    RAISE EXCEPTION 'BILLING: (D022) 같은 결제 키가 청구서 여러 줄에 들어 있습니다(%종) — 결제 1건이 두 번 쓰인 것입니다. 먼저 확인해 주십시오: SELECT payment_key, count(*) FROM subscription_invoices GROUP BY 1 HAVING count(*) > 1', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_order_id    ON public.subscription_invoices (order_id)    WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_payment_key ON public.subscription_invoices (payment_key) WHERE payment_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_pending ON public.subscription_invoices (claimed_at) WHERE status = 'PENDING';

-- 2. 청구 시도 기록 — 「결과 불명확」 · 「회원 탓이 아닌 실패」를 따로 적습니다 ---------------
--    UNKNOWN  결제사 답을 받지 못함(승인됐을 수 있음)
--    SYSTEM   우리 쪽 문제로 청구되지 않음(연동 설정 오류 · 요청이 결제사에 닿지 않음) — 회원의 유예 기간에 세지 않습니다
ALTER TABLE public.billing_attempts DROP CONSTRAINT IF EXISTS billing_attempts_result_check;
ALTER TABLE public.billing_attempts ADD CONSTRAINT billing_attempts_result_check
  CHECK (result = ANY (ARRAY['PAID'::text, 'RETRYABLE'::text, 'TERMINAL'::text, 'NO_METHOD'::text, 'UNKNOWN'::text, 'SYSTEM'::text]));
COMMENT ON COLUMN public.billing_attempts.result IS 'PAID 승인 · RETRYABLE 거절(다시 시도할 만함) · TERMINAL 거절(카드를 바꿔야 함) · NO_METHOD 결제 수단 없음 · UNKNOWN 결과 불명확 · SYSTEM 우리 쪽 문제(회원 탓 아님)';

-- 3. 환불 요청 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES public.subscriptions(id),
  invoice_id       uuid NOT NULL REFERENCES public.subscription_invoices(id),
  account_id       uuid NOT NULL REFERENCES public.accounts(id),
  amount           numeric(14,0) NOT NULL CHECK (amount > 0),
  reason           text NOT NULL CHECK (btrim(reason) <> ''),
  state            text NOT NULL DEFAULT 'REQUESTED'
                   CHECK (state = ANY (ARRAY['REQUESTED'::text, 'PROCESSING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'UNKNOWN'::text])),
  eligibility      jsonb,
  pg_idem_key      text,
  pg_status        text,
  pg_transaction_key text,
  canceled_amount  numeric(14,0),
  failure_code     text,
  failure_reason   text,
  attempts         integer NOT NULL DEFAULT 0,
  is_stub          boolean NOT NULL DEFAULT false,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  checked_at       timestamptz,
  completed_at     timestamptz
);
COMMENT ON TABLE  public.subscription_refunds IS '구독 환불 요청. 결제사 취소를 확인한 뒤에만 SUCCEEDED 가 됩니다 — 그 전에는 구독 · 청구서를 환불로 바꾸지 않습니다';
COMMENT ON COLUMN public.subscription_refunds.state IS 'REQUESTED 접수 · PROCESSING 결제사에 취소 요청 중 · SUCCEEDED 취소 확인(환불 완료) · FAILED 결제사가 거절(확정) · UNKNOWN 결과 확인 중(응답 지연 · 연결 끊김)';
COMMENT ON COLUMN public.subscription_refunds.eligibility IS '접수 시점의 자격 근거 — 결제한 날 · 그때까지의 이용 수. 완료 시각과 무관하게 이 값으로 판단합니다';
COMMENT ON COLUMN public.subscription_refunds.pg_idem_key IS '결제사 취소 요청의 멱등 키(sub-refund-<id>) — 같은 요청을 다시 보내도 결제사는 한 번만 취소합니다';
CREATE INDEX IF NOT EXISTS idx_sub_refund_sub ON public.subscription_refunds (subscription_id, requested_at);
-- 청구서 하나에 살아 있는(실패가 아닌) 환불 요청은 하나 — 같은 환불을 두 번 접수할 수 없습니다
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_refund_live ON public.subscription_refunds (invoice_id) WHERE state <> 'FAILED';
CREATE INDEX IF NOT EXISTS idx_sub_refund_open ON public.subscription_refunds (requested_at) WHERE state IN ('REQUESTED', 'PROCESSING', 'UNKNOWN');

-- 4. 환불 자격 — 한 곳에서 판단 ----------------------------------------------
--    근거: 이번 기간의 결제 완료 청구서 · 결제한 날(한국 날짜) · 이용 수(요청 열람 + 이번 기간에 받은 소개코드)
CREATE OR REPLACE FUNCTION public.fn_refund_basis(p_sub uuid)
RETURNS TABLE(invoice_id uuid, amount numeric, paid_on date, used integer, has_payment boolean)
LANGUAGE sql STABLE AS $$
  SELECT i.id, i.amount,
         (coalesce(i.paid_at, i.period_start) AT TIME ZONE 'Asia/Seoul')::date,
         coalesce(s.request_views_used, 0) + coalesce(s.codes_used_this_period, 0)
           + (SELECT count(*)::int FROM public.referral_codes rc
               WHERE rc.subscription_id = s.id AND rc.issued_at >= s.current_period_start),
         (i.payment_key IS NOT NULL OR i.order_id IS NOT NULL)
    FROM public.subscriptions s
    JOIN public.subscription_invoices i
      ON i.subscription_id = s.id AND i.status = 'PAID'
         /* 고치기 전에 만든 첫 결제 청구서는 기간 시작이 밀리초로 잘려 있습니다 — 그것도 「이번 기간」으로 봅니다 */
     AND (i.period_start = s.current_period_start OR i.period_start = date_trunc('milliseconds', s.current_period_start))
   WHERE s.id = p_sub
   ORDER BY (i.period_start = s.current_period_start) DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.fn_refund_eligible(p_sub uuid)
RETURNS TABLE(eligible boolean, reason text)
LANGUAGE plpgsql STABLE AS $function$
DECLARE s record; b record; v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = p_sub;
  IF s IS NULL THEN
    RETURN QUERY SELECT false, '없는 구독입니다'; RETURN;
  END IF;
  IF s.refunded_at IS NOT NULL THEN
    RETURN QUERY SELECT false, '이미 환불된 구독입니다'; RETURN;
  END IF;
  IF s.status NOT IN ('ACTIVE', 'PAST_DUE') THEN
    RETURN QUERY SELECT false, '이용 중인 구독이 아닙니다'; RETURN;
  END IF;

  SELECT * INTO b FROM fn_refund_basis(p_sub);
  IF b.invoice_id IS NULL THEN
    RETURN QUERY SELECT false, '이번 기간에 결제한 내역이 없습니다'; RETURN;
  END IF;

  /* ① 결제 당일인가 — 한국 날짜 · 실제 결제한 날 기준
     (전에는 DB 시간대(UTC) 날짜라 오전 9시에 날이 바뀌었고, 늦게 결제된 갱신분은 결제한 날에도 환불이 안 됐습니다) */
  IF b.paid_on <> v_today THEN
    RETURN QUERY SELECT false,
      '환불은 결제 당일에만 가능합니다 (결제일 ' || to_char(b.paid_on, 'YYYY-MM-DD') || ')';
    RETURN;
  END IF;

  /* ② 당일이어도 **쓰셨으면** 안 됩니다.
     리드를 열람하면 상대의 연락처가 이미 열립니다 — 되돌릴 수 없습니다. 소개코드를 받은 것도 이용입니다. */
  IF b.used > 0 THEN
    RETURN QUERY SELECT false,
      '이미 이용하신 구독은 환불할 수 없습니다 (이용 ' || b.used || '건)';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, '환불 가능합니다'::text;
END $function$;

-- 5. 환불 요청의 규칙 ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sub_refund_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b record; e record; s record;
BEGIN
  IF NEW.state <> 'REQUESTED' THEN
    RAISE EXCEPTION 'REFUND: 환불 요청은 접수(REQUESTED) 상태로만 만들 수 있습니다';
  END IF;
  SELECT * INTO s FROM subscriptions WHERE id = NEW.subscription_id FOR UPDATE;
  IF s IS NULL OR s.account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'REFUND: 본인의 구독이 아닙니다';
  END IF;
  SELECT * INTO e FROM fn_refund_eligible(NEW.subscription_id);
  IF NOT e.eligible THEN
    RAISE EXCEPTION 'REFUND: %', e.reason;
  END IF;
  SELECT * INTO b FROM fn_refund_basis(NEW.subscription_id);
  IF b.invoice_id <> NEW.invoice_id THEN
    RAISE EXCEPTION 'REFUND: 이번 기간의 결제 완료 청구서가 아닙니다';
  END IF;
  IF b.amount <> NEW.amount THEN
    RAISE EXCEPTION 'REFUND: 환불 금액은 결제 금액과 같아야 합니다 (결제 % · 요청 %)', b.amount, NEW.amount;
  END IF;
  NEW.eligibility := jsonb_build_object('paidOn', to_char(b.paid_on, 'YYYY-MM-DD'), 'used', b.used,
                                        'checkedAt', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00');
  NEW.pg_idem_key := 'sub-refund-' || NEW.id::text;
  NEW.attempts := 0; NEW.completed_at := NULL; NEW.canceled_amount := NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sub_refund_insert ON public.subscription_refunds;
CREATE TRIGGER trg_sub_refund_insert BEFORE INSERT ON public.subscription_refunds
  FOR EACH ROW EXECUTE FUNCTION public.fn_sub_refund_insert();

CREATE OR REPLACE FUNCTION public.fn_sub_refund_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.eligibility IS DISTINCT FROM OLD.eligibility
     OR NEW.pg_idem_key IS DISTINCT FROM OLD.pg_idem_key THEN
    RAISE EXCEPTION 'REFUND: 접수된 환불 요청의 대상 · 금액 · 접수 시각 · 자격 근거는 바꿀 수 없습니다';
  END IF;
  IF OLD.state IN ('SUCCEEDED', 'FAILED') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'REFUND: 끝난 환불 요청(%)의 상태는 바꿀 수 없습니다', OLD.state;
  END IF;
  IF NEW.state = 'REQUESTED' AND OLD.state <> 'REQUESTED' THEN
    RAISE EXCEPTION 'REFUND: 접수 상태로 되돌릴 수 없습니다';
  END IF;
  IF NEW.state = 'SUCCEEDED' AND OLD.state <> 'SUCCEEDED' THEN
    /* 결제사가 취소한 금액이 결제 금액과 같아야 완료입니다 */
    IF NEW.canceled_amount IS DISTINCT FROM NEW.amount THEN
      RAISE EXCEPTION 'REFUND: 결제사가 취소한 금액(%)이 환불 금액(%)과 다릅니다 — 완료로 적을 수 없습니다', coalesce(NEW.canceled_amount::text, '없음'), NEW.amount;
    END IF;
    NEW.completed_at := coalesce(NEW.completed_at, now());
  END IF;
  IF NEW.state = 'FAILED' AND OLD.state <> 'FAILED' THEN
    IF coalesce(btrim(NEW.failure_reason), '') = '' THEN
      RAISE EXCEPTION 'REFUND: 실패 사유를 적어야 합니다';
    END IF;
    NEW.completed_at := coalesce(NEW.completed_at, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sub_refund_update ON public.subscription_refunds;
CREATE TRIGGER trg_sub_refund_update BEFORE UPDATE ON public.subscription_refunds
  FOR EACH ROW EXECUTE FUNCTION public.fn_sub_refund_update();

CREATE OR REPLACE FUNCTION public.fn_sub_refund_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REFUND: 환불 요청 기록은 지울 수 없습니다';
END $$;
DROP TRIGGER IF EXISTS trg_sub_refund_no_delete ON public.subscription_refunds;
CREATE TRIGGER trg_sub_refund_no_delete BEFORE DELETE ON public.subscription_refunds
  FOR EACH ROW EXECUTE FUNCTION public.fn_sub_refund_no_delete();

-- 6. 구독 — 환불 완료 · 처리 중의 규칙 -----------------------------------------
--    전: 「환불 시각의 날짜 = 결제일」 → 당일에 접수된 환불이 자정을 넘겨 끝나면 저장할 수 없었습니다.
--    지금: 자격은 접수할 때(환불 요청을 만들 때) 판단하고, 완료는 「결제사 취소를 확인한 환불 요청이 있는가」만 봅니다.
CREATE OR REPLACE FUNCTION public.fn_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_open boolean;
BEGIN
  /* 환불 처리 중(접수 · 요청 중 · 결과 확인 중)에는 그 구독의 유료 이용 · 갱신을 막습니다 */
  IF NEW.request_views_used > OLD.request_views_used
     OR NEW.codes_used_this_period > OLD.codes_used_this_period
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     OR NEW.plan_code IS DISTINCT FROM OLD.plan_code THEN
    SELECT EXISTS (SELECT 1 FROM subscription_refunds r
                    WHERE r.subscription_id = NEW.id AND r.state IN ('REQUESTED', 'PROCESSING', 'UNKNOWN')) INTO v_open;
    IF v_open THEN
      RAISE EXCEPTION 'REFUND: 환불 처리 중인 구독은 이용 · 갱신 · 변경할 수 없습니다 — 환불 결과가 나온 뒤에 다시 해 주십시오';
    END IF;
  END IF;

  IF NEW.refunded_at IS NULL OR OLD.refunded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM subscription_refunds r
                   JOIN subscription_invoices i ON i.id = r.invoice_id
                  WHERE r.subscription_id = NEW.id AND r.state = 'SUCCEEDED'
                    AND (i.period_start = NEW.current_period_start
                         OR i.period_start = date_trunc('milliseconds', NEW.current_period_start))) THEN
    RAISE EXCEPTION 'REFUND: 결제사 취소가 확인된 환불 요청이 없습니다 — 환불 완료로 적을 수 없습니다';
  END IF;

  IF coalesce(NEW.request_views_used,0) + coalesce(NEW.codes_used_this_period,0) > 0 THEN
    RAISE EXCEPTION
      'REFUND: 이미 이용하신 구독은 환불할 수 없습니다 — 열람한 연락처는 되돌릴 수 없습니다';
  END IF;

  IF coalesce(btrim(NEW.refund_reason), '') = '' THEN
    RAISE EXCEPTION 'REFUND: 환불 사유를 적어야 합니다';
  END IF;
  RETURN NEW;
END $function$;

-- 환불 처리 중에는 그 구독으로 소개코드도 받지 못합니다
CREATE OR REPLACE FUNCTION public.fn_refcode_refund_block() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM subscription_refunds r
        WHERE r.subscription_id = NEW.subscription_id AND r.state IN ('REQUESTED', 'PROCESSING', 'UNKNOWN')) THEN
    RAISE EXCEPTION 'REFUND: 환불 처리 중인 구독으로는 소개코드를 받을 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refcode_refund_block ON public.referral_codes;
CREATE TRIGGER trg_refcode_refund_block BEFORE INSERT ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.fn_refcode_refund_block();

-- 7. 청구서 — 상태가 갈 수 있는 길 · 청구를 잡을 때의 규칙 -----------------------
CREATE OR REPLACE FUNCTION public.fn_invoice_paid_lock() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE s record;
BEGIN
  IF OLD.status = 'PAID' THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end   IS DISTINCT FROM OLD.period_end
       OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
      RAISE EXCEPTION 'BILLING: 결제 완료된 청구의 금액·기간은 변경할 수 없습니다';
    END IF;
    /* 결제 완료 → 환불 말고는 갈 곳이 없습니다 (실패 · 대기로 되돌리면 같은 기간이 다시 청구됩니다) */
    IF NEW.status NOT IN ('PAID', 'REFUNDED') THEN
      RAISE EXCEPTION 'BILLING: 결제 완료된 청구는 환불(REFUNDED)로만 바꿀 수 있습니다';
    END IF;
    IF NEW.payment_key IS DISTINCT FROM OLD.payment_key AND OLD.payment_key IS NOT NULL THEN
      RAISE EXCEPTION 'BILLING: 결제 완료된 청구의 결제 키는 바꿀 수 없습니다';
    END IF;
  END IF;
  IF OLD.status = 'REFUNDED' AND NEW.status <> 'REFUNDED' THEN
    RAISE EXCEPTION 'BILLING: 환불된 청구의 상태는 바꿀 수 없습니다';
  END IF;

  /* 환불 완료 — 결제사 취소가 확인된 환불 요청이 있어야 합니다 */
  IF NEW.status = 'REFUNDED' AND OLD.status <> 'REFUNDED' THEN
    IF NOT EXISTS (SELECT 1 FROM subscription_refunds r WHERE r.invoice_id = NEW.id AND r.state = 'SUCCEEDED') THEN
      RAISE EXCEPTION 'BILLING: 결제사 취소가 확인된 환불 요청이 없습니다 — 청구를 환불로 바꿀 수 없습니다';
    END IF;
    NEW.refunded_at := coalesce(NEW.refunded_at, now());
  END IF;

  /* 결제 완료로 바꿀 때 — 결제 근거(주문번호나 결제 키)가 있어야 합니다 */
  IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN
    IF NEW.payment_key IS NULL AND NEW.order_id IS NULL THEN
      RAISE EXCEPTION 'BILLING: 결제 근거(결제 키 · 주문번호) 없이 결제 완료로 바꿀 수 없습니다';
    END IF;
    NEW.paid_at := coalesce(NEW.paid_at, now());
  END IF;

  /* 청구를 잡을 때(→ PENDING) — 해지가 확정됐거나 환불 처리 중이면 잡을 수 없습니다.
     구독 줄을 잠가 「해지」와 순서를 정합니다: 해지가 먼저 끝났으면 여기서 막힙니다. */
  IF NEW.status = 'PENDING' AND OLD.status <> 'PENDING' THEN
    SELECT * INTO s FROM subscriptions WHERE id = NEW.subscription_id FOR UPDATE;
    IF s.cancel_at IS NOT NULL THEN
      RAISE EXCEPTION 'BILLING: 해지한 구독은 새로 청구할 수 없습니다';
    END IF;
    IF s.status NOT IN ('ACTIVE', 'PAST_DUE') THEN
      RAISE EXCEPTION 'BILLING: 이용 중인 구독이 아니어서 청구할 수 없습니다 (%)', s.status;
    END IF;
    IF EXISTS (SELECT 1 FROM subscription_refunds r WHERE r.subscription_id = NEW.subscription_id AND r.state IN ('REQUESTED', 'PROCESSING', 'UNKNOWN')) THEN
      RAISE EXCEPTION 'BILLING: 환불 처리 중인 구독은 청구할 수 없습니다';
    END IF;
    NEW.claimed_at := coalesce(NEW.claimed_at, clock_timestamp());
  END IF;
  RETURN NEW;
END $function$;

/* 새 청구서를 만들 때 — 기존 규칙(해지 뒤 시작하는 기간 · 무료 요금제 · 음수) + 「잡는 청구」의 규칙 */
CREATE OR REPLACE FUNCTION public.fn_invoice_not_cancelled() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE s record; v_price numeric;
BEGIN
  SELECT sub.*, p.monthly_price AS price INTO s
    FROM subscriptions sub JOIN subscription_plans p ON p.code = sub.plan_code
   WHERE sub.id = NEW.subscription_id
   FOR UPDATE OF sub;
  v_price := s.price;

  IF s.cancel_at IS NOT NULL AND NEW.period_start >= s.cancel_at THEN
    RAISE EXCEPTION 'BILLING: 해지 예약된 구독은 청구할 수 없습니다';
  END IF;
  IF coalesce(v_price, 0) = 0 AND NEW.amount > 0 THEN
    RAISE EXCEPTION 'BILLING: 무료 요금제에 금액을 청구할 수 없습니다';
  END IF;
  IF NEW.amount < 0 THEN
    RAISE EXCEPTION 'BILLING: 청구액은 음수일 수 없습니다';
  END IF;

  IF NEW.status = 'PENDING' THEN
    IF s.cancel_at IS NOT NULL THEN
      RAISE EXCEPTION 'BILLING: 해지한 구독은 새로 청구할 수 없습니다';
    END IF;
    IF s.status NOT IN ('ACTIVE', 'PAST_DUE') THEN
      RAISE EXCEPTION 'BILLING: 이용 중인 구독이 아니어서 청구할 수 없습니다 (%)', s.status;
    END IF;
    IF EXISTS (SELECT 1 FROM subscription_refunds r WHERE r.subscription_id = NEW.subscription_id AND r.state IN ('REQUESTED', 'PROCESSING', 'UNKNOWN')) THEN
      RAISE EXCEPTION 'BILLING: 환불 처리 중인 구독은 청구할 수 없습니다';
    END IF;
    NEW.claimed_at := coalesce(NEW.claimed_at, clock_timestamp());
  END IF;
  IF NEW.status = 'PAID' AND NEW.payment_key IS NULL AND NEW.order_id IS NULL THEN
    RAISE EXCEPTION 'BILLING: 결제 근거(결제 키 · 주문번호) 없이 결제 완료 청구서를 만들 수 없습니다';
  END IF;
  IF NEW.status = 'REFUNDED' THEN
    RAISE EXCEPTION 'BILLING: 환불된 청구서를 바로 만들 수 없습니다';
  END IF;
  RETURN NEW;
END $function$;

-- 8. 청구 대상 — 환불 처리 중인 구독은 뺍니다 ------------------------------------
CREATE OR REPLACE VIEW public.v_billing_due AS
 WITH today AS (
         SELECT a.subscription_id,
            count(*) AS tries,
            bool_or(a.result = 'TERMINAL'::text) AS had_terminal
           FROM billing_attempts a
          WHERE a.attempted_at >= date_trunc('day'::text, now())
          GROUP BY a.subscription_id
        )
 SELECT s.id AS subscription_id,
    s.account_id,
    s.plan_code,
    p.name AS plan_name,
    p.monthly_price AS amount,
    s.current_period_end AS due_at,
    s.current_period_end AS next_period_start,
    s.current_period_end + '30 days'::interval AS next_period_end,
    b.id AS billing_key_id,
    s.status,
    COALESCE(t.tries, 0::bigint) AS tries_today,
        CASE
            WHEN COALESCE(t.had_terminal, false) THEN fn_setting_int('billing.terminal_retry_per_day'::text, 1)
            ELSE fn_setting_int('billing.retry_per_day'::text, 10)
        END AS retry_cap
   FROM subscriptions s
     JOIN subscription_plans p ON p.code = s.plan_code
     LEFT JOIN billing_keys b ON b.account_id = s.account_id AND b.status = 'ACTIVE'::text
     LEFT JOIN today t ON t.subscription_id = s.id
  WHERE (s.status = ANY (ARRAY['ACTIVE'::text, 'PAST_DUE'::text])) AND s.current_period_end <= now() AND p.monthly_price > 0::numeric AND s.cancel_at IS NULL AND (s.promo_ends_at IS NULL OR s.promo_ends_at <= now()) AND NOT (EXISTS ( SELECT 1
           FROM subscription_invoices i
          WHERE i.subscription_id = s.id AND i.period_start = s.current_period_end AND (i.status = ANY (ARRAY['PENDING'::text, 'PAID'::text]))))
    AND NOT (EXISTS ( SELECT 1 FROM subscription_refunds r
          WHERE r.subscription_id = s.id AND (r.state = ANY (ARRAY['REQUESTED'::text, 'PROCESSING'::text, 'UNKNOWN'::text]))))
    AND COALESCE(t.tries, 0::bigint) <
        CASE
            WHEN COALESCE(t.had_terminal, false) THEN fn_setting_int('billing.terminal_retry_per_day'::text, 1)
            ELSE fn_setting_int('billing.retry_per_day'::text, 10)
        END;

-- 확인이 필요한 것 — 운영이 봅니다(비어 있어야 정상)
CREATE OR REPLACE VIEW public.v_billing_pending AS
 SELECT i.id AS invoice_id, i.subscription_id, s.account_id, i.period_start, i.amount, i.attempt,
        i.order_id, i.pg_status, i.claimed_at, i.checked_at, now() - i.claimed_at AS waiting
   FROM subscription_invoices i JOIN subscriptions s ON s.id = i.subscription_id
  WHERE i.status = 'PENDING';
COMMENT ON VIEW public.v_billing_pending IS '결제사 결과를 아직 확정하지 못한 청구. 배치가 주문번호로 조회해 닫습니다 — 오래 남아 있으면 사람이 봐야 합니다';

CREATE OR REPLACE VIEW public.v_sub_refund_open AS
 SELECT r.id AS refund_id, r.subscription_id, r.account_id, r.invoice_id, r.amount, r.state, r.pg_status,
        r.attempts, r.requested_at, r.processed_at, r.checked_at, now() - r.requested_at AS waiting
   FROM subscription_refunds r
  WHERE r.state IN ('REQUESTED', 'PROCESSING', 'UNKNOWN');
COMMENT ON VIEW public.v_sub_refund_open IS '끝나지 않은 구독 환불. 배치가 결제사에 조회해 닫습니다 — 오래 남아 있으면 사람이 봐야 합니다';

-- 9. 같은 요청은 한 번만 ------------------------------------------------------
ALTER TABLE public.idempotency_records
  ADD COLUMN IF NOT EXISTS account_id   uuid,
  ADD COLUMN IF NOT EXISTS route        text,
  ADD COLUMN IF NOT EXISTS raw_key      text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS state        text NOT NULL DEFAULT 'SUCCEEDED',
  ADD COLUMN IF NOT EXISTS http_status  integer,
  ADD COLUMN IF NOT EXISTS started_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS error        jsonb,
  ADD COLUMN IF NOT EXISTS pay_ref      jsonb;
ALTER TABLE public.idempotency_records DROP CONSTRAINT IF EXISTS idempotency_records_state_check;
ALTER TABLE public.idempotency_records ADD CONSTRAINT idempotency_records_state_check
  CHECK (state = ANY (ARRAY['PROCESSING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'UNKNOWN'::text]));
UPDATE public.idempotency_records SET started_at = created_at, completed_at = created_at
 WHERE completed_at IS NULL AND state = 'SUCCEEDED' AND route IS NULL;
COMMENT ON TABLE  public.idempotency_records IS '같은 요청을 한 번만 처리하기 위한 기록. 작업을 시작하기 전에 줄을 넣어 선점합니다';
COMMENT ON COLUMN public.idempotency_records.key          IS '사용자:작업 경로:요청 키 (고치기 전에 쌓인 줄은 사용자:요청 키)';
COMMENT ON COLUMN public.idempotency_records.request_hash IS '요청 본문의 해시 — 같은 키로 다른 내용이 오면 거절합니다';
COMMENT ON COLUMN public.idempotency_records.state        IS 'PROCESSING 처리 중 · SUCCEEDED 끝남(저장된 응답을 돌려줌) · FAILED 확정 실패(외부 결제 없음 — 다시 할 수 있음) · UNKNOWN 외부 결제 결과가 불명확(다시 오면 결제 결과부터 대조)';
COMMENT ON COLUMN public.idempotency_records.pay_ref      IS '이 요청이 건드린 외부 결제(결제 키 · 주문번호 · 금액) — 결과 대조에 씁니다';
CREATE INDEX IF NOT EXISTS idx_idem_open ON public.idempotency_records (started_at) WHERE state IN ('PROCESSING', 'UNKNOWN');

CREATE OR REPLACE VIEW public.v_idempotency_open AS
 SELECT key, account_id, route, state, attempts, started_at, completed_at, pay_ref, error, now() - started_at AS waiting
   FROM idempotency_records
  WHERE state IN ('PROCESSING', 'UNKNOWN');
COMMENT ON VIEW public.v_idempotency_open IS '끝나지 않았거나 결과가 불명확한 요청. 외부 결제가 걸린 것(pay_ref)은 결제 결과를 확인해야 합니다';

-- 10. 감시 뷰 — 새 규칙에 맞춥니다 (비어 있어야 정상) ---------------------------------
--   환불 위반: 전에는 「환불 시각의 날짜(UTC) = 기간 시작의 날짜」로 봤습니다. 자격은 접수할 때 판단하므로
--   ① 결제사 취소가 확인된 환불 요청 없이 환불로 적힌 구독 ② 접수 때의 근거가 당일 · 미이용이 아닌 환불을 잡습니다.
--   (이 마이그레이션 전에 환불로 적힌 줄은 그때의 기준 그대로 봅니다.)
CREATE OR REPLACE VIEW public.v_refund_violation AS
 SELECT s.id,
    s.account_id,
    s.plan_code,
    COALESCE((r.eligibility ->> 'paidOn')::date, (s.current_period_start AT TIME ZONE 'Asia/Seoul')::date) AS paid_on,
    (COALESCE(r.requested_at, s.refunded_at) AT TIME ZONE 'Asia/Seoul')::date AS refunded_on,
    COALESCE((r.eligibility ->> 'used')::integer, COALESCE(s.request_views_used, 0) + COALESCE(s.codes_used_this_period, 0)) AS used
   FROM public.subscriptions s
   LEFT JOIN LATERAL ( SELECT x.id, x.eligibility, x.requested_at
           FROM public.subscription_refunds x
          WHERE x.subscription_id = s.id AND x.state = 'SUCCEEDED'
          ORDER BY x.completed_at DESC
         LIMIT 1) r ON true
  WHERE s.refunded_at IS NOT NULL
    AND CASE
          WHEN r.id IS NOT NULL THEN
               (r.eligibility ->> 'paidOn')::date IS DISTINCT FROM (r.requested_at AT TIME ZONE 'Asia/Seoul')::date
            OR COALESCE((r.eligibility ->> 'used')::integer, 1) > 0
          WHEN s.refunded_at < COALESCE(( SELECT m.applied_at FROM public.schema_migrations m WHERE m.name = 'D022_billing_integrity'), '-infinity'::timestamptz) THEN
               s.current_period_start::date <> s.refunded_at::date
            OR COALESCE(s.request_views_used, 0) + COALESCE(s.codes_used_this_period, 0) > 0
          ELSE true      -- 결제사 취소가 확인된 환불 요청이 없는데 환불로 적혀 있음
        END;
COMMENT ON VIEW public.v_refund_violation IS '조건을 벗어난 구독 환불 — 결제사 취소 확인 없이 환불로 적혔거나, 접수 때 당일 · 미이용이 아니었던 것. 비어 있어야 정상';

--   해지 뒤 청구: 「해지 뒤에 시작하는 기간」에 더해 「해지가 확정된 뒤에 잡힌 청구」도 잡습니다
CREATE OR REPLACE VIEW public.v_billing_after_cancel AS
 SELECT i.id AS invoice_id,
    i.subscription_id,
    i.period_start,
    s.cancel_at
   FROM public.subscription_invoices i
     JOIN public.subscriptions s ON s.id = i.subscription_id
  WHERE s.cancel_at IS NOT NULL
    AND (i.period_start >= s.cancel_at OR i.claimed_at > s.cancel_at)
    AND (i.status = ANY (ARRAY['PENDING'::text, 'PAID'::text]));

--   결제 · 환불 기록이 서로 맞는가 — 한 트랜잭션으로 같이 바뀌어야 하는 것들이 어긋나 있으면 여기 나옵니다
CREATE OR REPLACE VIEW public.v_billing_integrity AS
 SELECT 'REFUNDED_WITHOUT_PG'::text AS kind, i.id AS ref_id, i.subscription_id,
        '청구서가 환불(REFUNDED)인데 결제사 취소가 확인된 환불 요청이 없습니다'::text AS detail
   FROM public.subscription_invoices i
  WHERE i.status = 'REFUNDED'
    AND NOT EXISTS (SELECT 1 FROM public.subscription_refunds r WHERE r.invoice_id = i.id AND r.state = 'SUCCEEDED')
 UNION ALL
 SELECT 'REFUND_NOT_APPLIED', r.id, r.subscription_id,
        '환불 요청은 완료(SUCCEEDED)인데 청구서 · 구독이 환불로 바뀌지 않았습니다'
   FROM public.subscription_refunds r
   JOIN public.subscription_invoices i ON i.id = r.invoice_id
   JOIN public.subscriptions s ON s.id = r.subscription_id
  WHERE r.state = 'SUCCEEDED' AND (i.status <> 'REFUNDED' OR s.refunded_at IS NULL OR s.status <> 'CANCELLED')
 UNION ALL
 SELECT 'PAID_WITHOUT_EVIDENCE', i.id, i.subscription_id,
        '결제 완료(PAID) 청구서에 결제 근거(결제 키 · 주문번호)가 없습니다'
   FROM public.subscription_invoices i
  WHERE i.status = 'PAID' AND i.payment_key IS NULL AND i.order_id IS NULL
 UNION ALL
 SELECT 'PAID_NOT_APPLIED', i.id, i.subscription_id,
        '결제는 승인됐는데 구독 기간에 반영하지 못했습니다 — 결제사 관리자 화면과 대조해 주십시오'
   FROM public.subscription_invoices i
  WHERE i.pg_status = 'PAID_NOT_APPLIED';
COMMENT ON VIEW public.v_billing_integrity IS '결제 · 환불 기록의 어긋남. 비어 있어야 정상 — 줄이 있으면 결제사의 실제 결과와 DB 가 다릅니다';

-- 11. 환불 결과 알림 — 「환불 결과 확인 중」으로 답을 받은 회원이 나중에 결과를 알 수 있게 --------------
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES
  ('SUBSCRIPTION_REFUND_DONE',   '구독 환불 완료', false, true, '계약 이행에 관한 통지'),
  ('SUBSCRIPTION_REFUND_FAILED', '구독 환불 실패', false, true, '계약 이행에 관한 통지')
ON CONFLICT (event_code) DO NOTHING;
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES
  ('SUBSCRIPTION_REFUND_DONE_INAPP', 'INAPP', '구독 환불이 완료되었습니다',
   '{amount}원 환불이 완료되었습니다. 결제사에서 결제 취소를 확인했습니다. 카드사에 따라 영업일 기준 3~5일 안에 반영됩니다.', '["amount"]', true),
  ('SUBSCRIPTION_REFUND_FAILED_INAPP', 'INAPP', '구독 환불이 처리되지 않았습니다',
   '결제사가 결제 취소를 받아들이지 않았습니다({reason}). 구독과 결제는 그대로입니다. 다시 신청하시거나 고객센터로 문의해 주세요.', '["reason"]', true)
ON CONFLICT (code) DO NOTHING;

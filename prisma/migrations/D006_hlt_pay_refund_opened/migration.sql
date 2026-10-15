-- =====================================================================
-- D006 — 소개뱅크몰 결제 실연동 · 환불 · 개봉 반품 재고 미복구
--
--   1. 결제 실연동 (토스페이먼츠 표준 결제창)
--      READY → 결제창 → 성공 주소(paymentKey · orderId · amount) → 서버 승인(confirm)
--      승인되면 hlt_payments.state = 'PAID' → fn_hlt_pay_apply 가 주문을 PAID 로 바꿉니다.
--      가상계좌는 승인 응답이 WAITING_FOR_DEPOSIT — READY 로 두고 계좌 정보만 남깁니다.
--      입금 알림(웹훅)은 본문을 믿지 않고 토스에서 결제를 다시 조회해 반영합니다.
--
--   2. 환불
--      취소·반품 승인 → 결제 취소(토스 /cancel) → hlt_returns REFUNDED.
--      ★ 결제 CANCELED 는 fn_hlt_pay_apply 가 **주문 취소**로 옮깁니다. 그래서 앱은
--        주문을 먼저 CANCELED·RETURNED 로 닫은 뒤에 결제를 CANCELED 로 바꿉니다
--        (닫힌 주문은 그 트리거가 건드리지 않습니다 — 반품이 취소로 바뀌지 않습니다).
--
--   3. 개봉 반품은 재고로 잡지 않음 (사장님 결정 2026-10-02)
--      운영이 승인할 때 개봉 여부를 판정합니다. 개봉이면 주문은 RETURNED 가 되지만
--      재고는 되돌리지 않고 restock_skipped = 'OPENED' 로 이유를 남깁니다.
--      불변식: 취소·반품 주문은 restocked_at 또는 restock_skipped 중 **정확히 하나**.
--
--   바꾸지 않는 것
--     · fn_hlt_pay_apply (D002) — 순서로 해결합니다
--     · fn_hlt_return_guard · fn_hlt_return_judge (D002)
--   재실행 안전: IF NOT EXISTS · DROP ... IF EXISTS · CREATE OR REPLACE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 결제 — PG 거래 키 · 상태 원문 · 가상계좌
-- ---------------------------------------------------------------------
ALTER TABLE hlt_payments ADD COLUMN IF NOT EXISTS payment_key text;
ALTER TABLE hlt_payments ADD COLUMN IF NOT EXISTS pg_status text;
ALTER TABLE hlt_payments ADD COLUMN IF NOT EXISTS stub boolean NOT NULL DEFAULT false;
ALTER TABLE hlt_payments ADD COLUMN IF NOT EXISTS vbank jsonb;
ALTER TABLE hlt_payments ADD COLUMN IF NOT EXISTS vbank_secret text;
ALTER TABLE hlt_payments ADD COLUMN IF NOT EXISTS canceled_amount bigint;

COMMENT ON COLUMN hlt_payments.payment_key IS
  '토스 paymentKey. 같은 키로 두 번 승인해도 같은 결과(멱등)를 돌려주는 기준입니다.';
COMMENT ON COLUMN hlt_payments.pg_status IS
  'PG 가 알려 준 상태 원문 (DONE · WAITING_FOR_DEPOSIT · CANCELED · EXPIRED …). state 는 우리 상태입니다.';
COMMENT ON COLUMN hlt_payments.stub IS
  '결제 키(TOSS_SECRET_KEY) 없이 스텁으로 승인된 건. 실제 돈이 오가지 않았습니다 — 화면에 "시험 결제" 로 보입니다.';
COMMENT ON COLUMN hlt_payments.vbank IS
  '가상계좌 안내 {bankCode, accountNumber, customerName, dueDate}. 입금 전까지 READY 입니다.';
COMMENT ON COLUMN hlt_payments.vbank_secret IS
  '가상계좌 입금 알림(DEPOSIT_CALLBACK)의 secret 대조값. 화면·API 로 내보내지 않습니다.';
COMMENT ON COLUMN hlt_payments.canceled_amount IS '환불(결제 취소)된 금액';

CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_payments_key
  ON hlt_payments (payment_key) WHERE payment_key IS NOT NULL;
/* 주문 하나에 승인된 결제는 하나 — 두 번 받으면 두 번 환불해야 합니다 */
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_payments_paid
  ON hlt_payments (order_id) WHERE state = 'PAID';

/* 승인 · 환불 기록은 거래 키가 있어야 합니다 — 무엇을 승인·취소했는지 PG 에 물을 수 없으면 대사가 안 됩니다.
 * 이전 데이터(CANCELED 25건)는 결제 연동 전 준비 건이라 키가 없습니다 → 새로 PAID 가 되는 것만 봅니다. */
ALTER TABLE hlt_payments DROP CONSTRAINT IF EXISTS ck_hlt_pay_paid_key;
ALTER TABLE hlt_payments ADD CONSTRAINT ck_hlt_pay_paid_key
  CHECK (state <> 'PAID' OR (payment_key IS NOT NULL AND approved_at IS NOT NULL));

-- ---------------------------------------------------------------------
-- 2. 취소 · 반품 — 개봉 여부 · 환불 실패 기록
-- ---------------------------------------------------------------------
ALTER TABLE hlt_returns ADD COLUMN IF NOT EXISTS customer_opened boolean;
ALTER TABLE hlt_returns ADD COLUMN IF NOT EXISTS opened boolean;
ALTER TABLE hlt_returns ADD COLUMN IF NOT EXISTS refund_error text;
ALTER TABLE hlt_returns ADD COLUMN IF NOT EXISTS refund_tried_at timestamptz;

COMMENT ON COLUMN hlt_returns.customer_opened IS
  '고객이 신청할 때 적은 개봉 여부 — 참고용입니다. 판정은 opened(운영)입니다.';
COMMENT ON COLUMN hlt_returns.opened IS
  '운영 판정 개봉 여부. 반품 승인 때 필수. true 면 재고로 되돌리지 않습니다(hlt_orders.restock_skipped).';
COMMENT ON COLUMN hlt_returns.refund_error IS
  '마지막 환불 실패 사유(PG 응답). 승인(APPROVED)에 머물러 있고 다시 시도할 수 있습니다.';

/* 발송 전 취소는 개봉일 수 없습니다 */
ALTER TABLE hlt_returns DROP CONSTRAINT IF EXISTS ck_hlt_returns_cancel_opened;
ALTER TABLE hlt_returns ADD CONSTRAINT ck_hlt_returns_cancel_opened
  CHECK (kind <> 'CANCEL' OR (coalesce(opened, false) = false AND coalesce(customer_opened, false) = false));
/* 환불 완료면 금액 · 시각이 있어야 합니다 */
ALTER TABLE hlt_returns DROP CONSTRAINT IF EXISTS ck_hlt_returns_refunded;
ALTER TABLE hlt_returns ADD CONSTRAINT ck_hlt_returns_refunded
  CHECK (state <> 'REFUNDED' OR (refund_amount IS NOT NULL AND refund_amount >= 0 AND refunded_at IS NOT NULL));

/* 반품 승인은 개봉 판정과 함께 — 이 마이그레이션 뒤에 승인되는 것부터 봅니다(이전 승인 11건은 판정 기록이 없습니다) */
CREATE OR REPLACE FUNCTION fn_hlt_return_opened_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'RETURN' AND NEW.state = 'APPROVED'
     AND coalesce(OLD.state, 'REQUESTED') = 'REQUESTED' AND NEW.opened IS NULL THEN
    RAISE EXCEPTION 'HLTR: 반품 승인에는 개봉 여부 판정이 필요합니다 — 개봉이면 재고로 되돌리지 않습니다';
  END IF;
  /* 판정은 한 번 — 승인 뒤에 바꾸면 재고와 어긋납니다 */
  IF TG_OP = 'UPDATE' AND OLD.state <> 'REQUESTED' AND NEW.opened IS DISTINCT FROM OLD.opened THEN
    RAISE EXCEPTION 'HLTR: 처리된 신청의 개봉 판정은 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_return_opened ON hlt_returns;
CREATE TRIGGER trg_hlt_return_opened BEFORE INSERT OR UPDATE ON hlt_returns
  FOR EACH ROW EXECUTE FUNCTION fn_hlt_return_opened_guard();

-- ---------------------------------------------------------------------
-- 3. 주문 — 재고 미복구 사유 · 재고 되돌림 트리거 개정
-- ---------------------------------------------------------------------
ALTER TABLE hlt_orders ADD COLUMN IF NOT EXISTS restock_skipped text;
COMMENT ON COLUMN hlt_orders.restock_skipped IS
  '재고로 되돌리지 않은 이유. OPENED = 개봉 반품(재판매 불가, 사장님 결정 2026-10-02). restocked_at 과 둘 중 하나만.';
ALTER TABLE hlt_orders DROP CONSTRAINT IF EXISTS ck_hlt_orders_restock_skipped;
ALTER TABLE hlt_orders ADD CONSTRAINT ck_hlt_orders_restock_skipped
  CHECK (restock_skipped IS NULL
         OR (restock_skipped IN ('OPENED') AND status = 'RETURNED' AND restocked_at IS NULL));

CREATE OR REPLACE FUNCTION fn_hlt_order_restock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  /* 한 번 적힌 되돌림 시각 · 미복구 사유는 지우거나 바꿀 수 없습니다 */
  IF OLD.restocked_at IS NOT NULL THEN
    NEW.restocked_at := OLD.restocked_at;
  END IF;
  IF OLD.restock_skipped IS NOT NULL THEN
    NEW.restock_skipped := OLD.restock_skipped;
  END IF;

  /* 취소·반품은 끝 상태입니다. 되살리면 재고를 다시 빼야 하는데 그 경로가 없습니다 */
  IF OLD.status IN ('CANCELED','RETURNED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'HLTO: 취소·반품된 주문은 상태를 바꿀 수 없습니다 — 새로 주문해 주십시오 (%)', OLD.order_no;
  END IF;

  /* D006 — 미복구 사유는 반품으로 닫히는 그 순간에만 붙일 수 있습니다.
   * 이미 되돌린 재고를 "개봉이었다" 로 바꾸면 재고와 기록이 어긋납니다. */
  IF NEW.restock_skipped IS NOT NULL AND OLD.restock_skipped IS NULL THEN
    IF NEW.status <> 'RETURNED' THEN
      RAISE EXCEPTION 'HLTO: 재고 미복구(개봉)는 반품에만 붙일 수 있습니다 — 발송 전 취소는 개봉일 수 없습니다 (%)', OLD.order_no;
    END IF;
    IF OLD.status IN ('CANCELED','RETURNED') THEN
      RAISE EXCEPTION 'HLTO: 이미 닫힌 주문의 재고 처리는 바꿀 수 없습니다 (%)', OLD.order_no;
    END IF;
  END IF;

  IF NEW.status IN ('CANCELED','RETURNED') AND OLD.restocked_at IS NULL
     AND NEW.restock_skipped IS NULL THEN
    UPDATE hlt_products p
       SET stock = p.stock + x.q
      FROM (SELECT product_id, sum(qty)::int AS q
              FROM hlt_order_items WHERE order_id = NEW.id
             GROUP BY product_id) x
     WHERE p.id = x.product_id;
    NEW.restocked_at := now();
  END IF;
  RETURN NEW;
END $$;
/* 트리거 자체는 D002 의 것을 그대로 씁니다(함수만 교체) */

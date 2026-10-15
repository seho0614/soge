-- v10.28 (G-147 · G-194) — 소개몰 발송 처리 · 구매확정 (10/9 답: 운영자가 송장을 직접 넣음 · 배송 완료 7일 뒤 자동 확정 · 구매자가 먼저 누를 수 있음)
--
--   1. 주문 상태에 「구매확정(CONFIRMED)」 — 배송 완료(DELIVERED)에서만 · 처리 중인 취소 · 반품 신청이 없을 때만.
--      누가 · 언제 확정했는지(confirmed_by BUYER · AUTO · confirmed_at)를 남깁니다.
--   2. 구매확정 뒤에도 **법정 기간 안의 반품 · 교환 신청은 받습니다**(단순 변심은 청약철회 기간 · 상품 하자 · 표시와 다름 · 오배송은 받은 날부터 3개월 —
--      전자상거래법 17조). 구매확정이 그 권리를 없애지 않게 판정 함수(fn_hlt_return_judge)는 그대로 두고, 반품 승인이 CONFIRMED 도 받게 합니다(서비스).
--   3. 정산 대상(v_hlt_settle_ready · v_hlt_settlement_ready)에 구매확정 주문을 넣습니다 — 전에는 DELIVERED 만 봐서 확정하면 정산에서 빠졌을 것.
--   4. 자동 확정 기한 — 배송 완료 날(한국 날짜)부터 max(7, 그 주문 상품의 청약철회 일수)일이 지난 다음 날. 단순 변심 청약철회 기간을 줄이지 않습니다.
--   5. 송장 — 배송 기록(hlt_shipments)은 쌓기만 합니다. 송장 고치기도 새 줄(PICKED · note 「송장 고침」). 배송중일 때만(서비스 · 아래 트리거).
--      배송 기록에 누가 넣었는지(created_by)를 남깁니다(전: 없음).

ALTER TABLE hlt_orders DROP CONSTRAINT IF EXISTS hlt_orders_status_check;
ALTER TABLE hlt_orders ADD CONSTRAINT hlt_orders_status_check
  CHECK (status = ANY (ARRAY['PENDING','PAID','PREPARING','SHIPPED','DELIVERED','CONFIRMED','CANCELED','RETURNED']));
ALTER TABLE hlt_orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE hlt_orders ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE hlt_orders DROP CONSTRAINT IF EXISTS ck_hlt_orders_confirmed_by;
ALTER TABLE hlt_orders ADD CONSTRAINT ck_hlt_orders_confirmed_by CHECK (confirmed_by IS NULL OR confirmed_by IN ('BUYER','AUTO'));
ALTER TABLE hlt_orders DROP CONSTRAINT IF EXISTS ck_hlt_orders_confirmed;
ALTER TABLE hlt_orders ADD CONSTRAINT ck_hlt_orders_confirmed
  CHECK (status <> 'CONFIRMED' OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND delivered_at IS NOT NULL));

ALTER TABLE hlt_shipments ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES accounts(id);

/* 자동 확정 기한 — 배송 완료 날 + max(7, 청약철회 일수) 일이 지난 다음 날 0시(한국) */
CREATE OR REPLACE FUNCTION public.fn_hlt_confirm_due(p_order uuid) RETURNS timestamptz
  LANGUAGE sql STABLE AS $$
  SELECT ((((o.delivered_at AT TIME ZONE 'Asia/Seoul')::date)
           + greatest(7, coalesce((SELECT max(w.days) FROM hlt_order_items i JOIN withdrawal_rules w ON w.code = i.withdrawal_code
                                    WHERE i.order_id = o.id), 7)) + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
    FROM hlt_orders o WHERE o.id = p_order AND o.delivered_at IS NOT NULL
$$;

/* 상태 바꾸기 지킴 — 구매확정은 배송 완료에서만 · 처리 중인 신청이 없을 때만 · 확정 뒤에는 반품(RETURNED)만 */
CREATE OR REPLACE FUNCTION public.fn_hlt_order_confirm_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' AND OLD.status IS DISTINCT FROM 'CONFIRMED' THEN
    IF OLD.status <> 'DELIVERED' THEN
      RAISE EXCEPTION 'HLTC: 배송 완료된 주문만 구매확정할 수 있습니다 (% · %)', OLD.order_no, OLD.status;
    END IF;
    IF EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = OLD.id AND r.state IN ('REQUESTED','APPROVED')) THEN
      RAISE EXCEPTION 'HLTC: 처리 중인 취소·반품 신청이 있어 구매확정할 수 없습니다 (%)', OLD.order_no;
    END IF;
    NEW.confirmed_at := coalesce(NEW.confirmed_at, now());
  END IF;
  IF OLD.status = 'CONFIRMED' AND NEW.status NOT IN ('CONFIRMED','RETURNED') THEN
    RAISE EXCEPTION 'HLTC: 구매확정한 주문은 반품으로만 닫을 수 있습니다 (% → %)', OLD.order_no, NEW.status;
  END IF;
  /* 확정 기록은 지우거나 바꾸지 않습니다 */
  IF OLD.confirmed_at IS NOT NULL THEN NEW.confirmed_at := OLD.confirmed_at; NEW.confirmed_by := OLD.confirmed_by; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_order_confirm_guard ON hlt_orders;
CREATE TRIGGER trg_hlt_order_confirm_guard BEFORE UPDATE OF status, confirmed_at, confirmed_by ON hlt_orders
  FOR EACH ROW EXECUTE FUNCTION fn_hlt_order_confirm_guard();

/* 배송 기록 — 확정 · 취소 · 반품된 주문에는 더 넣지 않음 · 송장 고치기는 배송중(SHIPPED)일 때만 */
CREATE OR REPLACE FUNCTION public.fn_hlt_ship_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  SELECT status, order_no INTO o FROM hlt_orders WHERE id = NEW.order_id;
  IF o.status IN ('CONFIRMED','CANCELED','RETURNED') THEN
    RAISE EXCEPTION 'HLTS: % 주문에는 배송 기록을 넣을 수 없습니다 (%)', o.status, o.order_no;
  END IF;
  IF NEW.note LIKE '송장 고침%' AND o.status <> 'SHIPPED' THEN
    RAISE EXCEPTION 'HLTS: 송장은 배송중일 때만 고칠 수 있습니다 (% · %)', o.order_no, o.status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hlt_ship_guard ON hlt_shipments;
CREATE TRIGGER trg_hlt_ship_guard BEFORE INSERT ON hlt_shipments FOR EACH ROW EXECUTE FUNCTION fn_hlt_ship_guard();

/* 배송 기록은 쌓기만 — 고치거나 지우지 않음 */
CREATE OR REPLACE FUNCTION public.fn_hlt_ship_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HLTS: 배송 기록은 고치거나 지울 수 없습니다 — 새 기록을 넣어 주십시오';
END $$;
DROP TRIGGER IF EXISTS trg_hlt_ship_append_only ON hlt_shipments;
CREATE TRIGGER trg_hlt_ship_append_only BEFORE UPDATE OR DELETE ON hlt_shipments FOR EACH ROW EXECUTE FUNCTION fn_hlt_ship_append_only();

/* 정산 대상에 구매확정 주문을 넣음(기한 · 조건은 전과 같음) */
CREATE OR REPLACE VIEW public.v_hlt_settle_ready AS
 SELECT id AS order_id, seller_id, order_no, goods_amount,
    ( SELECT COALESCE(sum(i.commission_amount), (0)::numeric) FROM hlt_order_items i WHERE i.order_id = o.id) AS commission,
    delivered_at, (delivered_at + '7 days'::interval) AS confirm_at
   FROM hlt_orders o
  WHERE o.status IN ('DELIVERED','CONFIRMED') AND o.delivered_at IS NOT NULL AND o.delivered_at < (now() - '7 days'::interval)
    AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items si WHERE si.order_id = o.id AND si.kind = 'SALE')
    AND NOT EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state = ANY (ARRAY['APPROVED','REFUNDED']));

CREATE OR REPLACE VIEW public.v_hlt_settlement_ready AS
 SELECT o.seller_id, s.code AS seller_code, s.name AS seller_name, count(*) AS orders, sum(o.goods_amount) AS gross,
    sum(( SELECT COALESCE(sum(i.commission_amount), (0)::numeric) FROM hlt_order_items i WHERE i.order_id = o.id)) AS commission
   FROM hlt_orders o JOIN hlt_sellers s ON s.id = o.seller_id
  WHERE o.status IN ('DELIVERED','CONFIRMED') AND o.delivered_at < (now() - '7 days'::interval)
    AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items si WHERE si.order_id = o.id)
  GROUP BY o.seller_id, s.code, s.name;

/* 자동 확정 — 하루 1회(job_schedules). 처리 중인 신청이 있는 주문은 건너뜀(신청이 끝난 뒤 다음 날 다시 봄) */
CREATE OR REPLACE FUNCTION public.fn_hlt_auto_confirm() RETURNS integer
  LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH due AS (
    SELECT o.id FROM hlt_orders o
     WHERE o.status = 'DELIVERED' AND o.delivered_at IS NOT NULL AND now() >= fn_hlt_confirm_due(o.id)
       AND NOT EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('REQUESTED','APPROVED'))
     FOR UPDATE SKIP LOCKED)
  UPDATE hlt_orders o SET status = 'CONFIRMED', confirmed_at = now(), confirmed_by = 'AUTO' FROM due WHERE o.id = due.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

INSERT INTO job_schedules (job, every_min, at_hour, at_minute, is_active, description)
VALUES ('hlt_auto_confirm', 1440, 4, 10, true, '소개몰 구매확정 — 배송 완료 7일(청약철회 기간이 더 길면 그 기간) 뒤 자동 확정 · 처리 중인 신청이 있으면 건너뜀')
ON CONFLICT (job) DO NOTHING;

-- v10.28 — 소개몰 순위 집계 (10/9 답: 판매 수량 · 최근 7일 · 하루 1회 · 화면에 기준과 기간을 적음)
--   SALES_7D  「오늘의 건강상품」 — 어제까지 7일(한국 날짜) 결제된 주문의 상품별 판매 수량
--   ORDERS_7D 「많이 찾는 상품」 — 같은 기간 그 상품이 들어간 주문 건수(한 주문에 여러 개를 사도 1)
--   취소 · 반품으로 닫힌 주문은 세지 않음 · 지금 판매 중(ON_SALE)인 상품만 · 판매가 0이면 그 칸은 비움(값을 지어 넣지 않음).
--   하루 한 번(작업 hlt_rank) 그날 것을 새로 만듦 — 같은 날 다시 돌려도 같은 결과(그날 것을 지우고 다시 넣음).

CREATE TABLE IF NOT EXISTS hlt_rankings (
  snapshot_date date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('SALES_7D','ORDERS_7D')),
  rank          int  NOT NULL CHECK (rank BETWEEN 1 AND 20),
  product_id    uuid NOT NULL REFERENCES hlt_products(id) ON DELETE CASCADE,
  qty           int  NOT NULL CHECK (qty > 0),
  orders        int  NOT NULL CHECK (orders > 0),
  basis_from    date NOT NULL,
  basis_to      date NOT NULL,
  made_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, kind, rank),
  UNIQUE (snapshot_date, kind, product_id),
  CHECK (basis_to >= basis_from)
);

CREATE OR REPLACE FUNCTION public.fn_hlt_rank_build() RETURNS integer
  LANGUAGE plpgsql AS $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Seoul')::date; f date := d - 7; t date := d - 1; n int;
BEGIN
  DELETE FROM hlt_rankings WHERE snapshot_date = d;
  WITH s AS (
    SELECT i.product_id, sum(i.qty)::int AS qty, count(DISTINCT i.order_id)::int AS orders
      FROM hlt_order_items i
      JOIN hlt_orders o ON o.id = i.order_id
      JOIN hlt_products p ON p.id = i.product_id AND p.status = 'ON_SALE'
     WHERE o.paid_at IS NOT NULL AND o.status NOT IN ('PENDING','CANCELED','RETURNED')
       AND (o.paid_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN f AND t
     GROUP BY i.product_id)
  INSERT INTO hlt_rankings (snapshot_date, kind, rank, product_id, qty, orders, basis_from, basis_to)
  SELECT d, 'SALES_7D', rk, product_id, qty, orders, f, t
    FROM (SELECT *, row_number() OVER (ORDER BY qty DESC, orders DESC, product_id) AS rk FROM s) x WHERE rk <= 10
  UNION ALL
  SELECT d, 'ORDERS_7D', rk, product_id, qty, orders, f, t
    FROM (SELECT *, row_number() OVER (ORDER BY orders DESC, qty DESC, product_id) AS rk FROM s) y WHERE rk <= 10;
  GET DIAGNOSTICS n = ROW_COUNT;
  /* 오래된 날의 집계는 30일만 남김 */
  DELETE FROM hlt_rankings WHERE snapshot_date < d - 30;
  RETURN n;
END $$;

INSERT INTO job_schedules (job, every_min, at_hour, at_minute, is_active, description)
VALUES ('hlt_rank', 1440, 5, 0, true, '소개몰 순위 — 어제까지 7일 판매 수량 · 주문 건수(취소 · 반품 제외 · 판매 중 상품만)')
ON CONFLICT (job) DO NOTHING;

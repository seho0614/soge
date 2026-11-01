-- =====================================================================
-- D157 · 소개몰 입점 4단계 — 주 1회 자동 정산 마감 · 정산 항목 · 환불 조정 · 판매수수료 세금계산서 틀 (v10.168 · 2026-11-01 · sgb-core docs/259)
--   대표 결정(11/1 · decisions/mall-return-refund #15 — D 정산 주 1회 · B 수수료율 오픈 전 · E 계산서 방향 세무사 확인 뒤)
--   ① fn_hlt_settle_close(마감 시작일)   한 번에: 판매자마다 정산서 + **정산 항목(SALE · 주문마다)** + 정산 뒤 환불된 주문의 조정(REFUND) + 이월
--      ★ 고친 결함 — 전에는 마감이 정산 항목을 남기지 않아, 다음 주 마감 때 같은 주문이 다시 집계됐음(v_hlt_settle_ready 는 항목으로 거름)
--   ② 정기 작업 hlt_settle_weekly   월요일 03:20(한국 시간) 지난주 월요일부터 7일을 마감
--   ③ hlt_settlements 칸 더함   invoice_state(NOT_NEEDED · REQUESTED · ISSUED) · invoice_no · invoice_issued_at — 판매수수료 세금계산서(입점 약관 제21조)
--      방향은 설정 mall.invoice_direction(기본 COMPANY_TO_SELLER · 세무사 확인 뒤 바꿈) · 실제 발행(국세청 전송)은 연동 전이라 운영이 번호를 적음
--   직판(DIRECT) 정산서는 계산서가 필요 없음(NOT_NEEDED). 돈은 움직이지 않음(지급은 결제대행사 · v10.169 틀). 재실행 안전 · 지우는 문장 없음
-- =====================================================================

ALTER TABLE public.hlt_settlements ADD COLUMN IF NOT EXISTS invoice_state text NOT NULL DEFAULT 'NOT_NEEDED';
ALTER TABLE public.hlt_settlements ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.hlt_settlements ADD COLUMN IF NOT EXISTS invoice_issued_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hlt_settlements_invoice') THEN
    ALTER TABLE public.hlt_settlements ADD CONSTRAINT ck_hlt_settlements_invoice
      CHECK (invoice_state IN ('NOT_NEEDED', 'REQUESTED', 'ISSUED') AND (invoice_state <> 'ISSUED' OR length(btrim(coalesce(invoice_no, ''))) >= 4));
  END IF;
END $$;
COMMENT ON COLUMN public.hlt_settlements.invoice_state IS '판매수수료 세금계산서(D157) — NOT_NEEDED 직판 · 수수료 0 · REQUESTED 발행할 것 · ISSUED 발행함(번호 · 시각). 방향은 설정 mall.invoice_direction';

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('mall.invoice_direction', 'COMPANY_TO_SELLER', 'GLOBAL',
        '소개몰 입점 판매수수료 세금계산서 방향(v10.168 · docs/259) — COMPANY_TO_SELLER 회사가 판매자에게(수수료는 회사가 공급하는 용역) · SELLER_TO_COMPANY. 세무사 확인 뒤 정함(decisions/mall-return-refund #15 E).',
        false, '^(COMPANY_TO_SELLER|SELLER_TO_COMPANY)$', 'COMPANY_TO_SELLER')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_hlt_settle_close(p_from date) RETURNS TABLE (created integer, carried integer)
    LANGUAGE plpgsql
    AS $$
DECLARE s record; v_id uuid; v_gross bigint; v_fee bigint; v_ref bigint; v_in bigint; v_net bigint; n_c int := 0; n_k int := 0;
BEGIN
  IF p_from IS NULL OR extract(isodow FROM p_from) <> 1 THEN
    RAISE EXCEPTION 'HLTS: 정산 시작일은 월요일이어야 합니다';
  END IF;
  /* 마감할 판매자 — 정산 대상 주문이 있거나, 정산한 주문 중 환불돼 조정할 것이 있는 판매자 */
  FOR s IN
    SELECT DISTINCT x.seller_id, h.type
      FROM (SELECT seller_id FROM v_hlt_settle_ready
            UNION
            SELECT o.seller_id FROM hlt_orders o
              JOIN hlt_settlement_items si ON si.order_id = o.id AND si.kind = 'SALE'
             WHERE EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('APPROVED', 'REFUNDED'))
               AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND')) x
      JOIN hlt_sellers h ON h.id = x.seller_id
     WHERE NOT EXISTS (SELECT 1 FROM hlt_settlements t WHERE t.seller_id = x.seller_id AND t.period_from = p_from)
  LOOP
    SELECT coalesce(sum(goods_amount), 0), coalesce(sum(commission), 0) INTO v_gross, v_fee FROM v_hlt_settle_ready WHERE seller_id = s.seller_id;
    /* 정산 뒤 환불 — 판매자가 받은 몫(상품 금액 − 수수료)을 되돌림 · 수수료는 회사가 돌려줌(입점 약관 제20조) */
    SELECT coalesce(sum(si.goods_amount - si.commission), 0) INTO v_ref
      FROM hlt_settlement_items si JOIN hlt_orders o ON o.id = si.order_id
     WHERE o.seller_id = s.seller_id AND si.kind = 'SALE'
       AND EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('APPROVED', 'REFUNDED'))
       AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND');
    SELECT coalesce((SELECT t.carried_out FROM hlt_settlements t WHERE t.seller_id = s.seller_id AND t.period_from = p_from - 7), 0) INTO v_in;
    v_net := v_gross - v_fee - v_ref + v_in;
    INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, commission, refund_amount, carried_in, net_amount, carried_out, status, invoice_state)
    VALUES (s.seller_id, p_from, p_from + 7, v_gross, v_fee, v_ref, v_in, v_net, 0, 'DRAFT',
            CASE WHEN s.type = 'DIRECT' OR v_fee <= 0 THEN 'NOT_NEEDED' ELSE 'REQUESTED' END)
    RETURNING id INTO v_id;
    INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, net_amount, kind)
    SELECT v_id, r.order_id, r.goods_amount, r.commission, r.goods_amount - r.commission, 'SALE' FROM v_hlt_settle_ready r WHERE r.seller_id = s.seller_id;
    INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, net_amount, kind)
    SELECT v_id, si.order_id, si.goods_amount, si.commission, -(si.goods_amount - si.commission), 'REFUND'
      FROM hlt_settlement_items si JOIN hlt_orders o ON o.id = si.order_id
     WHERE o.seller_id = s.seller_id AND si.kind = 'SALE' AND si.settlement_id <> v_id
       AND EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('APPROVED', 'REFUNDED'))
       AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND');
    n_c := n_c + 1;
    /* 음수는 지급하지 않고 다음 주로 넘김 — 판매자 계좌에서 빼 올 수 없음 */
    IF v_net < 0 THEN
      UPDATE hlt_settlements SET carried_out = net_amount, status = 'CARRIED' WHERE id = v_id;
      n_k := n_k + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT n_c, n_k;
END $$;
COMMENT ON FUNCTION public.fn_hlt_settle_close(date) IS '소개몰 주 정산 마감(D157) — 정산서 · 정산 항목(SALE · REFUND) · 이월을 한 번에. 같은 판매자 · 같은 주는 한 번만';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('hlt_settle_weekly', 10080, 3, 20, 2, true, '소개몰 주 정산 마감 — 월요일 03:20 에 지난주 월요일부터 7일(배송 완료 + 7일 지난 주문 · 정산 뒤 환불 조정 · 이월) · D157')
ON CONFLICT (job) DO NOTHING;

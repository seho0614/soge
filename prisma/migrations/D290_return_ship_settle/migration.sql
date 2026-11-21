-- D290 (v10.560 · docs/701) 9차 반품 배송비 정산 — 대표 11/21 계획 승인 · 「수수료 없음」
--   회원 사정 반품(단순 변심 · 잘못 주문)의 환불 = 결제 금액 − 왕복 배송비(hlt_returns.ship_deduction · D009 · 판매자 값 D156).
--   지금까지 뺀 배송비가 회사에 남고 판매자에게 가지 않았음 → 입점(TENANT · BRAND) 주문이면 주 정산에서 판매자에게 줌.
--   ① 정산 항목 kind 에 RETURN_SHIP 더함(+ship_deduction · 수수료 0 · 수수료 부가세 0) · 반품 한 건에 한 번(return_id 고유)
--   ② 정산서 칸 return_ship_amount(반품 배송비 합) · 지급액 = 매출 − 수수료 − 수수료 부가세 − 환불 + 이월 + 반품 배송비
--   ③ fn_hlt_settle_close — D243 판 그대로 + RETURN_SHIP(정산 전 반품 · 정산 뒤 반품 모두 · 그 판매자를 그 주 정산 대상에 넣음)
--   ④ 정산 줄 검사 두 곳(fn_hlt_settle_guard · fn_hlt_settlement_guard) 식에 반품 배송비 더함 · 알림 글은 옛 글 그대로(사전 · 시험이 글자로 봄)
--   ⑤ 판매자 월 정산서(D281) — 칸 return_ship_amount · 셈 returnShip
--   직판(DIRECT)은 그대로 — 뺀 배송비는 회사 몫(직판은 회사가 판매자).
--   다시 돌려도 같음(ADD COLUMN IF NOT EXISTS · CREATE OR REPLACE · CREATE UNIQUE INDEX IF NOT EXISTS · DROP CONSTRAINT IF EXISTS 뒤 바로 ADD)
--   지우는 문장은 고친 CHECK 를 다시 거는 것뿐 · INV-9 · INV-11 감시 낱말 칸 없음

-- ── ① 정산 항목 ──
ALTER TABLE public.hlt_settlement_items ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.hlt_returns(id);
COMMENT ON COLUMN public.hlt_settlement_items.return_id IS 'RETURN_SHIP 항목의 반품(D290) — 반품 한 건에 한 번(ux_hltsi_return_ship) · 다른 항목은 비어 있음';

ALTER TABLE public.hlt_settlement_items DROP CONSTRAINT IF EXISTS hlt_stl_item_kind_check;
ALTER TABLE public.hlt_settlement_items ADD CONSTRAINT hlt_stl_item_kind_check
  CHECK (kind = ANY (ARRAY['SALE'::text, 'REFUND'::text, 'RETURN_SHIP'::text]));

ALTER TABLE public.hlt_settlement_items DROP CONSTRAINT IF EXISTS ck_hltsi_return_ship;
ALTER TABLE public.hlt_settlement_items ADD CONSTRAINT ck_hltsi_return_ship
  CHECK ((kind = 'RETURN_SHIP') = (return_id IS NOT NULL)
         AND (kind <> 'RETURN_SHIP' OR (goods_amount > 0 AND commission = 0 AND commission_vat = 0 AND net_amount = goods_amount)));

CREATE UNIQUE INDEX IF NOT EXISTS ux_hltsi_return_ship ON public.hlt_settlement_items (return_id) WHERE kind = 'RETURN_SHIP';

-- ── ② 정산서 칸 ──
ALTER TABLE public.hlt_settlements ADD COLUMN IF NOT EXISTS return_ship_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_settlements DROP CONSTRAINT IF EXISTS ck_hlts_return_ship;
ALTER TABLE public.hlt_settlements ADD CONSTRAINT ck_hlts_return_ship CHECK (return_ship_amount >= 0);
COMMENT ON COLUMN public.hlt_settlements.return_ship_amount IS '반품 배송비(D290 · v10.560) — 입점 주문 회원 사정 반품에서 환불 때 뺀 왕복 배송비 합 · 판매자 몫 · 수수료 없음 · 지급액에 더함';

-- ── ④ 정산 줄 검사 — 지급액 = 매출 − 수수료 − 수수료 부가세 − 환불 + 이월 + 반품 배송비 ──
--    알림 글 자리 넷째(이월)에는 이월 + 반품 배송비를 넣음(글은 옛 글 그대로 — server-text 사전 · test_v1127 이 글자로 봄)
CREATE OR REPLACE FUNCTION public.fn_hlt_settle_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.net_amount <> NEW.gross_amount - NEW.commission - NEW.commission_vat - NEW.refund_amount + NEW.carried_in + NEW.return_ship_amount THEN
    RAISE EXCEPTION
      'HLTS: 정산액이 맞지 않습니다 — 매출 % - 수수료 % - 환불 % + 이월 % ≠ 지급액 %',
      NEW.gross_amount, NEW.commission + NEW.commission_vat, NEW.refund_amount, NEW.carried_in + NEW.return_ship_amount, NEW.net_amount;
  END IF;

  /* 음수면 지급하지 않고 다음 주로 넘깁니다 — 계좌에서 빼 올 수 없습니다. */
  IF NEW.net_amount < 0 AND NEW.status = 'PAID' THEN
    RAISE EXCEPTION 'HLTS: 정산액이 음수입니다 — 지급이 아니라 이월해야 합니다';
  END IF;

  /* 지급하려면 보낼 곳이 있어야 합니다. */
  IF NEW.status = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM hlt_sellers s
     WHERE s.id = NEW.seller_id
       AND (s.type = 'DIRECT' OR coalesce(btrim(s.submerchant_id),'') <> '')) THEN
    RAISE EXCEPTION
      'HLTS: 하위가맹점 ID 가 없습니다 — 어디로 보낼지 모릅니다 (PG 계약 뒤 채우십시오)';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hlt_settlement_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.net_amount <> NEW.gross_amount - NEW.commission - NEW.commission_vat - NEW.refund_amount + NEW.carried_in + NEW.return_ship_amount THEN
    RAISE EXCEPTION
      'HLTS: 정산 합계가 맞지 않습니다 — 매출 % - 수수료 % - 환불 % + 이월 % ≠ %',
      NEW.gross_amount, NEW.commission + NEW.commission_vat, NEW.refund_amount, NEW.carried_in + NEW.return_ship_amount, NEW.net_amount;
  END IF;

  /* 음수면 지급하지 않고 넘깁니다. */
  IF NEW.net_amount < 0 AND NEW.status = 'PAID' THEN
    RAISE EXCEPTION 'HLTS: 정산액이 음수입니다 — 지급할 수 없습니다. 다음 주로 넘기십시오';
  END IF;

  /* 하위가맹점이 없으면 지급이 안 됩니다. */
  IF NEW.status = 'PAID' AND NOT EXISTS (
    SELECT 1 FROM hlt_sellers
     WHERE id = NEW.seller_id
       AND (type = 'DIRECT' OR coalesce(btrim(submerchant_id),'') <> '')
  ) THEN
    RAISE EXCEPTION
      'HLTS: 하위가맹점 ID 가 없습니다 — PG 계약 뒤에 채우셔야 지급됩니다';
  END IF;

  RETURN NEW;
END $$;

-- ── 아직 정산하지 않은 반품 배송비(입점 주문 · 환불 끝남 · 뺀 배송비 > 0 · RETURN_SHIP 항목 없음) ──
--    주 정산 함수 · 운영 화면 「반품 배송비 대기」가 같이 봄
CREATE OR REPLACE VIEW public.v_hlt_return_ship_ready AS
 SELECT r.id AS return_id, r.order_id, o.seller_id, o.order_no, r.ship_deduction::bigint AS amount, r.refunded_at
   FROM public.hlt_returns r
   JOIN public.hlt_orders o ON o.id = r.order_id
   JOIN public.hlt_sellers h ON h.id = o.seller_id AND h.type IN ('TENANT', 'BRAND')
  WHERE r.state = 'REFUNDED' AND r.ship_deduction > 0
    AND NOT EXISTS (SELECT 1 FROM public.hlt_settlement_items x WHERE x.return_id = r.id AND x.kind = 'RETURN_SHIP');
COMMENT ON VIEW public.v_hlt_return_ship_ready IS '정산할 반품 배송비(D290) — 입점(일반 입점 · 브랜드 직영관) 주문의 회원 사정 반품 · 환불 끝남 · 아직 RETURN_SHIP 항목 없음. 직판은 회사 몫이라 없음. 주 정산 마감 때 판매자에게 +금액(수수료 없음)';

-- ── ③ 주 정산 마감 — D243 판 그대로 + RETURN_SHIP ──
CREATE OR REPLACE FUNCTION public.fn_hlt_settle_close(p_from date) RETURNS TABLE (created integer, carried integer)
    LANGUAGE plpgsql
    AS $$
DECLARE s record; v_id uuid; v_gross bigint; v_fee bigint; v_fvat bigint; v_ref bigint; v_in bigint; v_rs bigint; v_net bigint; v_sep boolean; n_c int := 0; n_k int := 0;
BEGIN
  IF p_from IS NULL OR extract(isodow FROM p_from) <> 1 THEN
    RAISE EXCEPTION 'HLTS: 정산 시작일은 월요일이어야 합니다';
  END IF;
  /* D243 — 정산 주가 부가세 별도 시작일 뒤면 수수료 부가세를 뺌 */
  v_sep := public.fn_vat_separate(p_from::timestamp AT TIME ZONE 'Asia/Seoul');
  FOR s IN
    SELECT DISTINCT x.seller_id, h.type
      FROM (SELECT seller_id FROM v_hlt_settle_ready
            UNION
            SELECT o.seller_id FROM hlt_orders o
              JOIN hlt_settlement_items si ON si.order_id = o.id AND si.kind = 'SALE'
             WHERE EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('APPROVED', 'REFUNDED'))
               AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND')
            UNION
            /* D290 — 정산할 반품 배송비가 있는 입점 판매자(정산 전 반품이라 SALE 이 없어도) */
            SELECT rs.seller_id FROM v_hlt_return_ship_ready rs) x
      JOIN hlt_sellers h ON h.id = x.seller_id
     WHERE NOT EXISTS (SELECT 1 FROM hlt_settlements t WHERE t.seller_id = x.seller_id AND t.period_from = p_from)
  LOOP
    SELECT coalesce(sum(goods_amount), 0), coalesce(sum(commission), 0),
           coalesce(sum(CASE WHEN v_sep AND s.type <> 'DIRECT' THEN public.fn_vat10(commission) ELSE 0 END), 0)
      INTO v_gross, v_fee, v_fvat FROM v_hlt_settle_ready WHERE seller_id = s.seller_id;
    /* 정산 뒤 환불 — 판매자가 받은 몫(상품 금액 − 수수료 − 수수료 부가세)을 되돌림 · 수수료와 그 부가세는 회사가 돌려줌(입점 약관 제20조) */
    SELECT coalesce(sum(si.goods_amount - si.commission - si.commission_vat), 0) INTO v_ref
      FROM hlt_settlement_items si JOIN hlt_orders o ON o.id = si.order_id
     WHERE o.seller_id = s.seller_id AND si.kind = 'SALE'
       AND EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('APPROVED', 'REFUNDED'))
       AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND');
    SELECT coalesce((SELECT t.carried_out FROM hlt_settlements t WHERE t.seller_id = s.seller_id AND t.period_from = p_from - 7), 0) INTO v_in;
    /* D290 — 반품 배송비: 환불 때 뺀 왕복 배송비는 입점 판매자 몫(수수료 · 수수료 부가세 없음) · 직판은 회사 몫이라 0 */
    SELECT coalesce(sum(rs.amount), 0) INTO v_rs FROM v_hlt_return_ship_ready rs WHERE rs.seller_id = s.seller_id AND s.type <> 'DIRECT';
    v_net := v_gross - v_fee - v_fvat - v_ref + v_in + v_rs;
    INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, commission, commission_vat, refund_amount, carried_in, return_ship_amount, net_amount, carried_out, status, invoice_state)
    VALUES (s.seller_id, p_from, p_from + 7, v_gross, v_fee, v_fvat, v_ref, v_in, v_rs, v_net, 0, 'DRAFT',
            CASE WHEN s.type = 'DIRECT' OR v_fee <= 0 THEN 'NOT_NEEDED' ELSE 'REQUESTED' END)
    RETURNING id INTO v_id;
    INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, commission_vat, net_amount, kind)
    SELECT v_id, r.order_id, r.goods_amount, r.commission, x.fv, r.goods_amount - r.commission - x.fv, 'SALE'
      FROM v_hlt_settle_ready r
     CROSS JOIN LATERAL (SELECT CASE WHEN v_sep AND s.type <> 'DIRECT' THEN public.fn_vat10(r.commission) ELSE 0 END AS fv) x
     WHERE r.seller_id = s.seller_id;
    INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, commission_vat, net_amount, kind)
    SELECT v_id, si.order_id, si.goods_amount, si.commission, si.commission_vat, -(si.goods_amount - si.commission - si.commission_vat), 'REFUND'
      FROM hlt_settlement_items si JOIN hlt_orders o ON o.id = si.order_id
     WHERE o.seller_id = s.seller_id AND si.kind = 'SALE' AND si.settlement_id <> v_id
       AND EXISTS (SELECT 1 FROM hlt_returns r WHERE r.order_id = o.id AND r.state IN ('APPROVED', 'REFUNDED'))
       AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND');
    /* D290 — 반품 한 건에 RETURN_SHIP 한 줄(+금액) · 고유 색인 ux_hltsi_return_ship 이 두 번을 막음 */
    IF v_rs > 0 THEN
      INSERT INTO hlt_settlement_items (settlement_id, order_id, goods_amount, commission, commission_vat, net_amount, kind, return_id)
      SELECT v_id, rs.order_id, rs.amount, 0, 0, rs.amount, 'RETURN_SHIP', rs.return_id
        FROM v_hlt_return_ship_ready rs WHERE rs.seller_id = s.seller_id;
    END IF;
    n_c := n_c + 1;
    /* 음수는 지급하지 않고 다음 주로 넘김 — 판매자 계좌에서 빼 올 수 없음 */
    IF v_net < 0 THEN
      UPDATE hlt_settlements SET carried_out = net_amount, status = 'CARRIED' WHERE id = v_id;
      n_k := n_k + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT n_c, n_k;
END $$;
COMMENT ON FUNCTION public.fn_hlt_settle_close(date) IS '소개몰 주 정산 마감(D157 · D243 수수료 부가세 · D290 반품 배송비) — 정산서 · 정산 항목(SALE · REFUND · RETURN_SHIP) · 이월을 한 번에. 같은 판매자 · 같은 주는 한 번만 · 반품 배송비는 반품 한 건에 한 번';

-- ── ⑤ 판매자 월 정산서(D281) — 반품 배송비 칸 · 셈 ──
ALTER TABLE public.hlt_seller_statements ADD COLUMN IF NOT EXISTS return_ship_amount bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.hlt_seller_statements.return_ship_amount IS '반품 배송비 합(D290 · v10.560) — 그 달 주 정산서 return_ship_amount 합 · 지급액 합계(net_amount)에 이미 들어 있음';

CREATE OR REPLACE FUNCTION public.fn_hlt_statement_calc(p_seller uuid, p_ym text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_from date; v_to date; r jsonb;
BEGIN
  IF p_ym IS NULL OR p_ym !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'HLT_STMT_YM: 정산 달은 YYYY-MM 으로 주십시오.'; END IF;
  v_from := (p_ym || '-01')::date;
  v_to := (v_from + interval '1 month')::date;
  SELECT jsonb_build_object(
           'weeks', count(*)::int,
           'gross', coalesce(sum(st.gross_amount), 0)::bigint,
           'fee', coalesce(sum(st.commission), 0)::bigint,
           'feeVat', coalesce(sum(st.commission_vat), 0)::bigint,
           'refund', coalesce(sum(st.refund_amount), 0)::bigint,
           'returnShip', coalesce(sum(st.return_ship_amount), 0)::bigint,
           'carriedIn', coalesce((array_agg(st.carried_in ORDER BY st.period_from))[1], 0)::bigint,
           'net', coalesce(sum(st.net_amount), 0)::bigint,
           'carriedOut', coalesce((array_agg(st.carried_out ORDER BY st.period_from DESC))[1], 0)::bigint,
           'paid', coalesce(sum(st.net_amount) FILTER (WHERE st.status = 'PAID'), 0)::bigint,
           'lines', coalesce(jsonb_agg(jsonb_build_object(
               'id', st.id, 'from', st.period_from, 'to', st.period_to, 'gross', st.gross_amount, 'fee', st.commission, 'feeVat', st.commission_vat,
               'refund', st.refund_amount, 'returnShip', st.return_ship_amount, 'carriedIn', st.carried_in, 'net', st.net_amount, 'carriedOut', st.carried_out, 'status', st.status,
               'invoiceState', st.invoice_state, 'invoiceNo', st.invoice_no,
               'items', (SELECT count(*) FROM public.hlt_settlement_items i WHERE i.settlement_id = st.id)) ORDER BY st.period_from), '[]'::jsonb))
    INTO r
    FROM public.hlt_settlements st
   WHERE st.seller_id = p_seller AND st.period_from >= v_from AND st.period_from < v_to;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hlt_statement_make(p_seller uuid, p_ym text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c jsonb; v_id bigint; v_state text; v_type text;
BEGIN
  SELECT type INTO v_type FROM public.hlt_sellers WHERE id = p_seller;
  IF v_type IS NULL OR v_type NOT IN ('TENANT', 'BRAND') THEN RAISE EXCEPTION 'HLT_STMT_SELLER: 입점 판매자(일반 입점 · 브랜드 직영관)만 월 정산서를 만듭니다.'; END IF;
  SELECT id, mail_state INTO v_id, v_state FROM public.hlt_seller_statements WHERE seller_id = p_seller AND ym = p_ym FOR UPDATE;
  IF v_state = 'SENT' THEN RAISE EXCEPTION 'HLT_STMT_SENT: 메일로 보낸 월 정산서는 바꾸지 않습니다(같은 달은 한 번만 보냅니다).'; END IF;
  c := public.fn_hlt_statement_calc(p_seller, p_ym);
  IF v_id IS NULL THEN
    INSERT INTO public.hlt_seller_statements (seller_id, ym, weeks, gross_amount, fee_amount, fee_vat, refund_amount, return_ship_amount, carried_in, net_amount, carried_out, paid_amount, lines)
    VALUES (p_seller, p_ym, (c->>'weeks')::int, (c->>'gross')::bigint, (c->>'fee')::bigint, (c->>'feeVat')::bigint, (c->>'refund')::bigint, (c->>'returnShip')::bigint,
            (c->>'carriedIn')::bigint, (c->>'net')::bigint, (c->>'carriedOut')::bigint, (c->>'paid')::bigint, c->'lines')
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.hlt_seller_statements
       SET weeks = (c->>'weeks')::int, gross_amount = (c->>'gross')::bigint, fee_amount = (c->>'fee')::bigint, fee_vat = (c->>'feeVat')::bigint,
           refund_amount = (c->>'refund')::bigint, return_ship_amount = (c->>'returnShip')::bigint, carried_in = (c->>'carriedIn')::bigint, net_amount = (c->>'net')::bigint,
           carried_out = (c->>'carriedOut')::bigint, paid_amount = (c->>'paid')::bigint, lines = c->'lines', remade_at = clock_timestamp()
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;


/* ── v10.559 (docs/698) 사원 카드 — ㉕ 권한(D258) 시드 · D290 끝에 붙임(사원 카드는 표 · 칸 · 설정 없음 · 이 시드만) ──
 *   업무 hr-card(회계 · 읽기만이지만 수준 넷은 다른 업무와 같은 모양) · 처음 변환 그룹은 @Roles 와 같은 범위 = 지급 담당(R_PAYOUT) · SUPER 는 늘 통과
 *   운영 관리자(R_ADMIN) · 세무사(R_ACCOUNTANT)는 넣지 않음 — @Roles('SUPER', 'PAYOUT') · 주소가 /admin/hr 아래라 세무사 읽기(/admin/acct GET)에도 안 걸림
 *   직원 고르기 목록 GET /admin/acct/employees 는 급여(acct-payroll)에 이미 있음 — 넓히기로 사원 카드만 받은 사람도 고르기가 되게 hr-card VIEW 한 줄 더함
 *   감사 이름 HR_CARD_VIEW 는 등록하는 표가 없음(@Audit 글자만) · 다시 돌려도 같음 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hr-card', '사원 카드', 'admacc', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 2945)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.perm_role_group_items (group_key, task_key, level)
SELECT 'R_PAYOUT', 'hr-card', l FROM (VALUES ('VIEW'), ('EDIT'), ('APPROVE'), ('EXPORT')) y(l)
 WHERE EXISTS (SELECT 1 FROM public.perm_role_groups r WHERE r.key = 'R_PAYOUT')
ON CONFLICT DO NOTHING;

INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/hr/employees/{id}/card', 'hr-card', 'VIEW'),
  ('GET', '/admin/acct/employees', 'hr-card', 'VIEW')
ON CONFLICT (method, pattern, task_key) DO NOTHING;

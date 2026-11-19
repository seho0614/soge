-- v10.385 ~ 387 (docs/521 ~ 523) — 부가세 별도(요금 + 부가세 10%)
--   대표 11/19 세무 답 「부가세는 별도」 → ⑩ 계획 「승인 + 통과하면 병합」 · 법무 확인 끝남.
--   시작일 설정 vat.separate_from(SUPER · 처음 비어 있음 = 지금과 같음). 시작일(한국 날짜 00:00) 뒤 결제 · 정산부터 바뀜.
--   ① v10.385 구독 · 소개코드 결제 = 요금 + 부가세 — subscription_invoices.supply · vat · referral_code_payments.vat · v_billing_due 금액
--   ② v10.386 입점 정산 — 수수료 부가세(commission_vat)를 판매자 받을 돈에서 뺌 · 정산 뒤 환불이면 돌려줌
--   ③ v10.387 리드 캐시 충전 = 충전 금액 + 부가세 — 지갑에는 충전 금액만 · 충전 때 세금계산서 요청 줄(charge_id) · 환불은 부가세 몫도 함께 취소
--   부가세 = 내림(공급가 × 10%) — 정액 노출(fn_directory_vat · D092)과 같은 셈.
--   다시 돌려도 같음 · 지우는 문장은 고친 CHECK · UNIQUE 를 다시 거는 것뿐(DROP ... IF EXISTS → 바로 다시 ADD).

/* ── 설정 · 셈 ── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('vat.separate_from', '', 'ADMIN',
        '부가세 별도 시작일(v10.385 · docs/521) — 이 날(한국 00:00)부터 구독 · 소개코드 결제 = 요금 + 부가세 10%, 입점 정산에서 수수료 부가세를 뺌, 리드 캐시 충전 = 금액 + 부가세(충전 때 세금계산서). 비우면 지금과 같음. 공지 · 약관 게시 뒤 SUPER 가 오늘 이후 날짜로만.',
        false, '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$', '2026-12-01')
ON CONFLICT (key) DO NOTHING;

/* 그 시각에 부가세 별도인지 */
CREATE OR REPLACE FUNCTION public.fn_vat_separate(p_at timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(p_at >= (nullif(btrim((SELECT value FROM site_settings WHERE key = 'vat.separate_from')), '')::date)::timestamp AT TIME ZONE 'Asia/Seoul', false) $$;
/* 공급가 → 부가세(내림 10%) */
CREATE OR REPLACE FUNCTION public.fn_vat10(p_supply numeric) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT floor(greatest(coalesce(p_supply, 0), 0) * 0.1)::bigint $$;

/* ── ① 구독 · 소개코드 ── */
ALTER TABLE public.subscription_invoices ADD COLUMN IF NOT EXISTS supply numeric(14,0);
ALTER TABLE public.subscription_invoices ADD COLUMN IF NOT EXISTS vat numeric(14,0);
ALTER TABLE public.subscription_invoices DROP CONSTRAINT IF EXISTS ck_si_vat;
ALTER TABLE public.subscription_invoices ADD CONSTRAINT ck_si_vat CHECK (vat IS NULL OR (vat >= 0 AND supply >= 0 AND supply + vat = amount));
COMMENT ON COLUMN public.subscription_invoices.vat IS '부가세 별도로 청구한 부가세(D243) — 비어 있으면 시작일 전 청구(amount 하나)';

ALTER TABLE public.referral_code_payments ADD COLUMN IF NOT EXISTS vat numeric(12,0) NOT NULL DEFAULT 0;
ALTER TABLE public.referral_code_payments DROP CONSTRAINT IF EXISTS ck_rcp_vat;
ALTER TABLE public.referral_code_payments ADD CONSTRAINT ck_rcp_vat CHECK (vat >= 0);
ALTER TABLE public.referral_code_payments DROP CONSTRAINT IF EXISTS ck_rcp_amount;
ALTER TABLE public.referral_code_payments ADD CONSTRAINT ck_rcp_amount CHECK (amount = unit_price * code_count + vat);

/* 청구 대상 — 금액 = 묶인 요금(공급가) + 그때 부가세 별도면 부가세 · supply · vat 칸은 끝에 더함(D184 의 나머지는 그대로) */
CREATE OR REPLACE VIEW public.v_billing_due AS
 WITH today AS (
         SELECT a.subscription_id,
            count(*) AS tries,
            bool_or((a.result = 'TERMINAL'::text)) AS had_terminal
           FROM public.billing_attempts a
          WHERE (a.attempted_at >= date_trunc('day'::text, now()))
          GROUP BY a.subscription_id
        )
 SELECT s.id AS subscription_id,
    s.account_id,
    np.code AS plan_code,
    np.name AS plan_name,
    ((public.fn_sub_price(s.locked_price, s.locked_plan_code, np.code, np.monthly_price))
      + CASE WHEN public.fn_vat_separate(now()) THEN public.fn_vat10(public.fn_sub_price(s.locked_price, s.locked_plan_code, np.code, np.monthly_price)) ELSE 0 END)::numeric(14,0) AS amount,
    s.current_period_end AS due_at,
    s.current_period_end AS next_period_start,
    (s.current_period_end + '30 days'::interval) AS next_period_end,
    b.id AS billing_key_id,
    s.status,
    COALESCE(t.tries, (0)::bigint) AS tries_today,
        CASE
            WHEN COALESCE(t.had_terminal, false) THEN public.fn_setting_int('billing.terminal_retry_per_day'::text, 1)
            ELSE public.fn_setting_int('billing.retry_per_day'::text, 10)
        END AS retry_cap,
    s.plan_code AS current_plan_code,
    (public.fn_sub_price(s.locked_price, s.locked_plan_code, np.code, np.monthly_price))::numeric(14,0) AS supply,
    (CASE WHEN public.fn_vat_separate(now()) THEN public.fn_vat10(public.fn_sub_price(s.locked_price, s.locked_plan_code, np.code, np.monthly_price)) END)::numeric(14,0) AS vat
   FROM ((((public.subscriptions s
     JOIN public.subscription_plans p ON ((p.code = s.plan_code)))
     JOIN public.subscription_plans np ON ((np.code = COALESCE(s.next_plan_code, s.plan_code))))
     LEFT JOIN public.billing_keys b ON (((b.account_id = s.account_id) AND (b.status = 'ACTIVE'::text))))
     LEFT JOIN today t ON ((t.subscription_id = s.id)))
  WHERE ((s.status = ANY (ARRAY['ACTIVE'::text, 'PAST_DUE'::text])) AND (s.current_period_end <= now()) AND (p.monthly_price > (0)::numeric) AND (np.monthly_price > (0)::numeric) AND (s.cancel_at IS NULL) AND ((s.promo_ends_at IS NULL) OR (s.promo_ends_at <= now())) AND (NOT (EXISTS ( SELECT 1
           FROM public.subscription_invoices i
          WHERE ((i.subscription_id = s.id) AND (i.period_start = s.current_period_end) AND (i.status = ANY (ARRAY['PENDING'::text, 'PAID'::text])))))) AND (NOT (EXISTS ( SELECT 1
           FROM public.subscription_refunds r
          WHERE ((r.subscription_id = s.id) AND (r.state = ANY (ARRAY['REQUESTED'::text, 'PROCESSING'::text, 'UNKNOWN'::text])))))) AND (COALESCE(t.tries, (0)::bigint) <
        CASE
            WHEN COALESCE(t.had_terminal, false) THEN public.fn_setting_int('billing.terminal_retry_per_day'::text, 1)
            ELSE public.fn_setting_int('billing.retry_per_day'::text, 10)
        END));

/* ── ② 입점 정산 — 수수료 부가세 ── */
ALTER TABLE public.hlt_settlements ADD COLUMN IF NOT EXISTS commission_vat bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_settlement_items ADD COLUMN IF NOT EXISTS commission_vat bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_settlements DROP CONSTRAINT IF EXISTS ck_hlts_commission_vat;
ALTER TABLE public.hlt_settlements ADD CONSTRAINT ck_hlts_commission_vat CHECK (commission_vat >= 0);
ALTER TABLE public.hlt_settlement_items DROP CONSTRAINT IF EXISTS ck_hltsi_commission_vat;
ALTER TABLE public.hlt_settlement_items ADD CONSTRAINT ck_hltsi_commission_vat CHECK (commission_vat >= 0);
COMMENT ON COLUMN public.hlt_settlements.commission_vat IS '수수료 부가세(D243) — 정산 시작일이 부가세 별도 시작일 뒤이고 직판이 아니면 주문마다 내림(수수료 × 10%) 합 · 판매자 받을 돈에서 뺌';

CREATE OR REPLACE FUNCTION public.fn_hlt_settle_close(p_from date) RETURNS TABLE (created integer, carried integer)
    LANGUAGE plpgsql
    AS $$
DECLARE s record; v_id uuid; v_gross bigint; v_fee bigint; v_fvat bigint; v_ref bigint; v_in bigint; v_net bigint; v_sep boolean; n_c int := 0; n_k int := 0;
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
               AND NOT EXISTS (SELECT 1 FROM hlt_settlement_items sr WHERE sr.order_id = o.id AND sr.kind = 'REFUND')) x
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
    v_net := v_gross - v_fee - v_fvat - v_ref + v_in;
    INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, commission, commission_vat, refund_amount, carried_in, net_amount, carried_out, status, invoice_state)
    VALUES (s.seller_id, p_from, p_from + 7, v_gross, v_fee, v_fvat, v_ref, v_in, v_net, 0, 'DRAFT',
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
    n_c := n_c + 1;
    /* 음수는 지급하지 않고 다음 주로 넘김 — 판매자 계좌에서 빼 올 수 없음 */
    IF v_net < 0 THEN
      UPDATE hlt_settlements SET carried_out = net_amount, status = 'CARRIED' WHERE id = v_id;
      n_k := n_k + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT n_c, n_k;
END $$;
COMMENT ON FUNCTION public.fn_hlt_settle_close(date) IS '소개몰 주 정산 마감(D157 · D243 수수료 부가세) — 정산서 · 정산 항목(SALE · REFUND) · 이월을 한 번에. 같은 판매자 · 같은 주는 한 번만';

/* ── ③ 리드 캐시 충전 — 부가세 · 충전 때 세금계산서 ── */
ALTER TABLE public.lead_cash_charges ADD COLUMN IF NOT EXISTS vat bigint NOT NULL DEFAULT 0;
ALTER TABLE public.lead_cash_charges ADD COLUMN IF NOT EXISTS vat_refunded bigint NOT NULL DEFAULT 0;
ALTER TABLE public.lead_cash_charges DROP CONSTRAINT IF EXISTS ck_lcc_vat;
ALTER TABLE public.lead_cash_charges ADD CONSTRAINT ck_lcc_vat CHECK (vat >= 0 AND vat_refunded >= 0 AND vat_refunded <= vat);
COMMENT ON COLUMN public.lead_cash_charges.vat IS '충전 부가세(D243) — 결제 = amount + vat · 지갑(유상 잔액)에는 amount 만';
ALTER TABLE public.lead_cash_refund_parts ADD COLUMN IF NOT EXISTS vat bigint NOT NULL DEFAULT 0;
ALTER TABLE public.lead_cash_refund_parts DROP CONSTRAINT IF EXISTS ck_lcrp_vat;
ALTER TABLE public.lead_cash_refund_parts ADD CONSTRAINT ck_lcrp_vat CHECK (vat >= 0);

ALTER TABLE public.lead_cash_invoices ADD COLUMN IF NOT EXISTS charge_id uuid REFERENCES public.lead_cash_charges(id);
ALTER TABLE public.lead_cash_invoices DROP CONSTRAINT IF EXISTS lead_cash_invoices_partner_id_ym_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lci_partner_ym_usage ON public.lead_cash_invoices (partner_id, ym) WHERE charge_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lci_charge ON public.lead_cash_invoices (charge_id) WHERE charge_id IS NOT NULL;
COMMENT ON COLUMN public.lead_cash_invoices.charge_id IS '충전 한 건의 세금계산서(D243 · 부가세 별도 뒤) — 비어 있으면 그 전처럼 달마다 사용액';

/* 충전이 끝나면(DONE) 부가세가 있는 충전은 세금계산서 요청 줄 하나 */
CREATE OR REPLACE FUNCTION public.fn_lead_cash_charge_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'DONE' AND OLD.state IS DISTINCT FROM 'DONE' AND NEW.vat > 0 THEN
    INSERT INTO lead_cash_invoices (partner_id, ym, total, supply, vat, charge_id)
    VALUES (NEW.partner_id, to_char(coalesce(NEW.approved_at, now()) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM'), NEW.amount + NEW.vat, NEW.amount, NEW.vat, NEW.id)
    ON CONFLICT (charge_id) WHERE charge_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lead_cash_charge_invoice' AND tgrelid = 'public.lead_cash_charges'::regclass) THEN
    CREATE TRIGGER trg_lead_cash_charge_invoice AFTER UPDATE OF state ON public.lead_cash_charges FOR EACH ROW EXECUTE FUNCTION public.fn_lead_cash_charge_invoice();
  END IF;
END $$;

/* 달마다 사용액 세금계산서 — 부가세 별도 시작일 전 사용분만(그 뒤 충전은 충전 때 발행) */
CREATE OR REPLACE FUNCTION public.fn_lead_cash_invoice_month(p_ym text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_sep timestamptz; v_n int;
BEGIN
  IF p_ym !~ '^[0-9]{4}-[0-9]{2}$' THEN RAISE EXCEPTION 'LEADCASH: 달은 YYYY-MM 입니다'; END IF;
  v_from := (p_ym || '-01')::date::timestamp AT TIME ZONE 'Asia/Seoul';
  v_to   := ((p_ym || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul';
  IF v_to > now() THEN RAISE EXCEPTION 'LEADCASH: 끝나지 않은 달(%)은 만들 수 없습니다', p_ym; END IF;
  v_sep := (nullif(btrim((SELECT value FROM site_settings WHERE key = 'vat.separate_from')), '')::date)::timestamp AT TIME ZONE 'Asia/Seoul';
  IF v_sep IS NOT NULL AND v_sep < v_to THEN v_to := greatest(v_sep, v_from); END IF;
  INSERT INTO lead_cash_invoices(partner_id, ym, total, supply, vat)
  SELECT e.partner_id, p_ym, x.t, round(x.t / 1.1)::bigint, x.t - round(x.t / 1.1)::bigint
    FROM (SELECT e.partner_id, sum(l.amount)::bigint AS t
            FROM lead_cash_entries e JOIN lead_cash_lines l ON l.entry_id = e.id
           WHERE l.account = 'PARTNER_PAID' AND e.kind IN ('USE','RESTORE')
             AND e.created_at >= v_from AND e.created_at < v_to
           GROUP BY e.partner_id) x
    JOIN (SELECT DISTINCT partner_id FROM lead_cash_entries) e ON e.partner_id = x.partner_id
   WHERE x.t > 0
  ON CONFLICT (partner_id, ym) WHERE charge_id IS NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ⑦ v10.386 — 정산 줄 검사 두 곳(B075 fn_hlt_settle_guard · fn_hlt_settlement_guard)에 수수료 부가세를 넣습니다
--    지급액 = 매출 − 수수료 − 수수료 부가세 − 환불 + 이월 · 알림 글의 「수수료」 자리에는 수수료 + 수수료 부가세
CREATE OR REPLACE FUNCTION public.fn_hlt_settle_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.net_amount <> NEW.gross_amount - NEW.commission - NEW.commission_vat - NEW.refund_amount + NEW.carried_in THEN
    RAISE EXCEPTION
      'HLTS: 정산액이 맞지 않습니다 — 매출 % - 수수료 % - 환불 % + 이월 % ≠ 지급액 %',
      NEW.gross_amount, NEW.commission + NEW.commission_vat, NEW.refund_amount, NEW.carried_in, NEW.net_amount;
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
  IF NEW.net_amount <> NEW.gross_amount - NEW.commission - NEW.commission_vat - NEW.refund_amount + NEW.carried_in THEN
    RAISE EXCEPTION
      'HLTS: 정산 합계가 맞지 않습니다 — 매출 % - 수수료 % - 환불 % + 이월 % ≠ %',
      NEW.gross_amount, NEW.commission + NEW.commission_vat, NEW.refund_amount, NEW.carried_in, NEW.net_amount;
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

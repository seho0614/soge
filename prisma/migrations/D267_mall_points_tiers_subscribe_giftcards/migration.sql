/* D267 (v10.479 ~ 482 · docs/617 ~ 620) ㊲ 소개몰 회원 혜택 — 적립금 · 회원 등급 · 정기 배송 · 상품권(모두 off · 법무 · 세무 확인) */

/* D267 (v10.479 ~ 482 · docs/617 ~ 620) ㊲ 소개몰 회원 혜택 — 적립금 · 회원 등급 · 정기 배송 · 상품권
 *   → prisma/migrations/D267_mall_points_tiers_subscribe_giftcards/migration.sql (#305 · 한 파일)
 *   다시 돌려도 같음 · 지우는 문장은 CHECK 를 넓히는 두 줄뿐(hlt_orders_total_check DROP IF EXISTS → 바로 다시 ADD)
 *   ★ 앞 묶음 ㉝(D264 · hlt_orders.discount_amount · 쿠폰)에 기댐 — 결제 금액 = 상품 + 배송비 − 쿠폰 − 적립금 − 상품권
 *   스위치는 모두 처음 off: mall.points · mall.tiers · mall.subscribe · mall.giftcard (「주문 받기」 mall.order_open 도 운영은 꺼짐)
 *   적립금(회원 포인트 D190 point_ledger · point_cashouts)과 **다른 장부** — 현금화 · 출금 없음 · 소개몰 직판 주문에만 씀 */

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hlt_orders' AND column_name = 'discount_amount') THEN
    RAISE EXCEPTION 'D267: 앞 묶음 D264(소개몰 쿠폰 · hlt_orders.discount_amount)를 먼저 적용해야 합니다.';
  END IF;
END $$;


/* ── ⓪ 주문 칸 — 적립금 · 상품권으로 낸 금액(주문할 때 한 번 정함) ─────────────────────────── */
ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS point_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS gift_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE public.hlt_orders DROP CONSTRAINT IF EXISTS hlt_orders_total_check;
ALTER TABLE public.hlt_orders ADD CONSTRAINT hlt_orders_total_check
  CHECK (discount_amount >= 0 AND point_amount >= 0 AND gift_amount >= 0 AND discount_amount <= goods_amount
         AND total = goods_amount + ship_fee - discount_amount - point_amount - gift_amount AND total >= 0);
COMMENT ON COLUMN public.hlt_orders.point_amount IS 'v10.479 (D267) 적립금으로 낸 금액(원) — 주문할 때 한 번(fn_hlt_benefit_apply) · total = 상품 + 배송비 − 쿠폰 − 적립금 − 상품권 · 취소 · 반품되면 적립금은 되돌림(이 칸은 그대로 · 기록)';
COMMENT ON COLUMN public.hlt_orders.gift_amount IS 'v10.482 (D267) 상품권으로 낸 금액(원) — 주문할 때 한 번 · 취소 · 반품되면 상품권 잔액을 되돌림(이 칸은 그대로 · 기록)';


/* ── ① 적립금 (v10.479 · docs/617) ────────────────────────────────────────────────
 *   묶음(lot) 단위 — 적립 · 운영 지급 · 되돌림마다 한 묶음(금액 · 남은 금액 · 소멸 시각) · 쓸 때는 소멸이 가까운 묶음부터
 *   구매확정(CONFIRMED · 구매자 · 자동 모두) 때 DB 가 적립: (상품 − 쿠폰 − 적립금 사용) × 적립률(등급이 켜져 있으면 등급 적립률) ÷ 100 · 직판만
 *   기록(hlt_point_txns)은 쌓기만 · 금액은 늘 양수(종류로 방향) · 남은 금액은 음수가 될 수 없음(CHECK) */
CREATE TABLE IF NOT EXISTS public.hlt_point_lots (
  id             bigserial PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  source         text NOT NULL CHECK (source IN ('EARN', 'ADMIN', 'RESTORE')),
  order_id       uuid REFERENCES public.hlt_orders(id),
  amount         bigint NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  remaining      bigint NOT NULL CHECK (remaining >= 0),
  expires_at     timestamptz NOT NULL,
  closed_reason  text CHECK (closed_reason IS NULL OR closed_reason IN ('EXPIRED', 'REVOKED')),
  closed_at      timestamptz,
  notified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_point_lot_rem CHECK (remaining <= amount),
  CONSTRAINT ck_hlt_point_lot_closed CHECK ((closed_reason IS NULL) = (closed_at IS NULL)),
  CONSTRAINT ck_hlt_point_lot_closed0 CHECK (closed_reason IS NULL OR remaining = 0),
  CONSTRAINT ck_hlt_point_lot_earn CHECK (source <> 'EARN' OR order_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_point_lot_earn ON public.hlt_point_lots (order_id) WHERE source = 'EARN';
CREATE INDEX IF NOT EXISTS ix_hlt_point_lot_acc ON public.hlt_point_lots (account_id, expires_at) WHERE remaining > 0;
COMMENT ON TABLE public.hlt_point_lots IS 'v10.479 (D267) 소개몰 적립금 묶음 — 구매확정 적립(EARN · 주문 하나에 하나) · 운영 지급(ADMIN) · 소멸 뒤 되돌림(RESTORE) · 남은 금액 · 소멸 시각 · 닫힘(소멸 · 회수) · 지우지 않음 · 회원 포인트(D190)와 다른 장부';

CREATE TABLE IF NOT EXISTS public.hlt_point_uses (
  id           bigserial PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES public.hlt_orders(id),
  lot_id       bigint NOT NULL REFERENCES public.hlt_point_lots(id),
  account_id   uuid NOT NULL REFERENCES public.accounts(id),
  amount       bigint NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  restored_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, lot_id)
);
COMMENT ON TABLE public.hlt_point_uses IS 'v10.479 (D267) 주문에 쓴 적립금(묶음별) — 주문이 취소 · 반품되면 그 묶음으로 되돌림(restored_at · 이미 소멸한 묶음이면 새 RESTORE 묶음) · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hlt_point_txns (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.accounts(id),
  kind        text NOT NULL CHECK (kind IN ('EARN', 'USE', 'RESTORE', 'REVOKE', 'EXPIRE', 'ADJUST_ADD', 'ADJUST_SUB')),
  amount      bigint NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  order_id    uuid REFERENCES public.hlt_orders(id),
  lot_id      bigint REFERENCES public.hlt_point_lots(id),
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 200),
  actor       uuid REFERENCES public.accounts(id),
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_hlt_point_txns_acc ON public.hlt_point_txns (account_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_hlt_point_txns_order ON public.hlt_point_txns (order_id) WHERE order_id IS NOT NULL;
COMMENT ON TABLE public.hlt_point_txns IS 'v10.479 (D267) 소개몰 적립금 기록 — 적립 · 사용 · 되돌림 · 회수(반품) · 소멸 · 운영 지급 · 운영 회수 · 금액은 양수(종류가 방향) · 쌓기만 · 전표 MALL_POINT_EARN · MALL_POINT_LAPSE 근거';

/* 묶음 지킴 — 지우지 않음 · 회원 · 근거 · 금액 · 소멸 시각은 바꾸지 않음 · 닫힌 묶음은 다시 열지 않음 */
CREATE OR REPLACE FUNCTION public.fn_hlt_point_lot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_POINT: 적립금 묶음은 지우지 않습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.remaining <> NEW.amount OR NEW.closed_at IS NOT NULL THEN RAISE EXCEPTION 'HLT_POINT: 새 적립금 묶음은 남은 금액을 금액과 같게 넣습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.account_id, NEW.source, NEW.order_id, NEW.amount, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM (OLD.account_id, OLD.source, OLD.order_id, OLD.amount, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'HLT_POINT: 적립금 묶음의 회원 · 근거 · 금액 · 소멸 시각은 바꾸지 않습니다.';
  END IF;
  IF OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.remaining <> 0) THEN
    RAISE EXCEPTION 'HLT_POINT: 소멸 · 회수한 적립금 묶음은 다시 열지 않습니다.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hlt_point_use_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_POINT: 적립금 쓴 기록은 지우지 않습니다.'; END IF;
  IF (NEW.order_id, NEW.lot_id, NEW.account_id, NEW.amount, NEW.created_at) IS DISTINCT FROM (OLD.order_id, OLD.lot_id, OLD.account_id, OLD.amount, OLD.created_at)
     OR OLD.restored_at IS NOT NULL OR NEW.restored_at IS NULL THEN
    RAISE EXCEPTION 'HLT_POINT: 적립금 쓴 기록은 되돌림(restored_at)만 적습니다.';
  END IF;
  RETURN NEW;
END $$;

/* 설정 읽기(무늬가 틀리면 처음 값) */
CREATE OR REPLACE FUNCTION public.fn_hlt_setting_num(p_key text, p_default numeric) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT CASE WHEN value ~ '^[0-9]+(\.[0-9]+)?$' THEN value::numeric END FROM public.site_settings WHERE key = p_key), p_default)
$$;
CREATE OR REPLACE FUNCTION public.fn_hlt_setting_on(p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT value = 'on' FROM public.site_settings WHERE key = p_key), false)
$$;

/* 적립금 남은 합(소멸 시각 전 · 닫히지 않은 묶음) */
CREATE OR REPLACE FUNCTION public.fn_hlt_point_balance(p_account uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(remaining), 0)::bigint FROM public.hlt_point_lots
   WHERE account_id = p_account AND remaining > 0 AND closed_at IS NULL AND expires_at > now()
$$;

/* 적립금 빼기 — 소멸이 가까운 묶음부터 · 모자라면 통째로 막음 · 주문이면 묶음별 쓴 기록 */
CREATE OR REPLACE FUNCTION public.fn_hlt_point_take(p_account uuid, p_amount bigint, p_order uuid, p_kind text, p_reason text, p_actor uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE l record; v_left bigint := p_amount; v_take bigint;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN RAISE EXCEPTION 'HLT_POINT_AMOUNT: 적립금은 1원 이상 씁니다.'; END IF;
  IF p_kind NOT IN ('USE', 'ADJUST_SUB') THEN RAISE EXCEPTION 'HLT_POINT: 빼는 종류가 아닙니다.'; END IF;
  FOR l IN SELECT id, remaining FROM public.hlt_point_lots
            WHERE account_id = p_account AND remaining > 0 AND closed_at IS NULL AND expires_at > now()
            ORDER BY expires_at, id FOR UPDATE LOOP
    v_take := least(v_left, l.remaining);
    UPDATE public.hlt_point_lots SET remaining = remaining - v_take WHERE id = l.id;
    IF p_order IS NOT NULL THEN
      INSERT INTO public.hlt_point_uses (order_id, lot_id, account_id, amount) VALUES (p_order, l.id, p_account, v_take);
    END IF;
    v_left := v_left - v_take;
    EXIT WHEN v_left = 0;
  END LOOP;
  IF v_left > 0 THEN RAISE EXCEPTION 'HLT_POINT_SHORT: 적립금이 모자랍니다.'; END IF;
  INSERT INTO public.hlt_point_txns (account_id, kind, amount, order_id, reason, actor) VALUES (p_account, p_kind, p_amount, p_order, p_reason, p_actor);
  RETURN p_amount;
END $$;

/* 구매확정 적립 — 직판 · mall.points on · 주문 하나에 한 번(다시 불러도 같음) · 등급이 켜져 있으면 등급 적립률 */
CREATE OR REPLACE FUNCTION public.fn_hlt_point_earn(p_order uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE o record; v_rate numeric; v_tr numeric; v_base bigint; v_amt bigint; v_days integer; v_lot bigint;
BEGIN
  IF NOT public.fn_hlt_setting_on('mall.points') THEN RETURN 0; END IF;
  SELECT o2.id, o2.account_id, o2.goods_amount, o2.discount_amount, o2.point_amount, s.type AS seller_type INTO o
    FROM public.hlt_orders o2 LEFT JOIN public.hlt_sellers s ON s.id = o2.seller_id WHERE o2.id = p_order;
  IF o.id IS NULL OR o.seller_type IS DISTINCT FROM 'DIRECT' THEN RETURN 0; END IF;
  v_base := o.goods_amount - o.discount_amount - o.point_amount;
  IF v_base <= 0 THEN RETURN 0; END IF;
  v_rate := least(20, public.fn_hlt_setting_num('mall.points_rate', 1));
  IF public.fn_hlt_setting_on('mall.tiers') THEN
    SELECT t.earn_rate INTO v_tr FROM public.hlt_member_tiers m JOIN public.hlt_tiers t ON t.code = m.tier_code AND t.active WHERE m.account_id = o.account_id;
    IF v_tr IS NULL THEN SELECT t.earn_rate INTO v_tr FROM public.hlt_tiers t WHERE t.active ORDER BY t.min_amount, t.sort LIMIT 1; END IF;
    v_rate := coalesce(v_tr, v_rate);
  END IF;
  v_amt := floor(v_base * v_rate / 100)::bigint;
  IF v_amt < 1 THEN RETURN 0; END IF;
  v_days := greatest(30, least(1825, public.fn_hlt_setting_num('mall.points_valid_days', 365)::integer));
  INSERT INTO public.hlt_point_lots (account_id, source, order_id, amount, remaining, expires_at)
  VALUES (o.account_id, 'EARN', o.id, v_amt, v_amt, now() + make_interval(days => v_days))
  ON CONFLICT (order_id) WHERE source = 'EARN' DO NOTHING RETURNING id INTO v_lot;
  IF v_lot IS NULL THEN RETURN 0; END IF;
  INSERT INTO public.hlt_point_txns (account_id, kind, amount, order_id, lot_id, detail)
  VALUES (o.account_id, 'EARN', v_amt, o.id, v_lot, jsonb_build_object('base', v_base, 'rate', v_rate, 'days', v_days));
  RETURN v_amt;
END $$;

/* 반품(구매확정 뒤) — 그 주문으로 적립한 묶음의 남은 금액만 회수 · 이미 쓴 몫(모자람)은 운영 알림 */
CREATE OR REPLACE FUNCTION public.fn_hlt_point_revoke(p_order uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE l record; v_short bigint;
BEGIN
  SELECT id, account_id, amount, remaining, closed_at INTO l FROM public.hlt_point_lots WHERE order_id = p_order AND source = 'EARN' FOR UPDATE;
  IF l.id IS NULL OR l.closed_at IS NOT NULL THEN RETURN 0; END IF;
  UPDATE public.hlt_point_lots SET remaining = 0, closed_reason = 'REVOKED', closed_at = clock_timestamp() WHERE id = l.id;
  v_short := l.amount - l.remaining;
  IF l.remaining > 0 THEN
    INSERT INTO public.hlt_point_txns (account_id, kind, amount, order_id, lot_id, reason, detail)
    VALUES (l.account_id, 'REVOKE', l.remaining, p_order, l.id, '반품 — 적립 회수', jsonb_build_object('earned', l.amount, 'short', v_short));
  END IF;
  IF v_short > 0 THEN
    INSERT INTO public.ops_alerts (alert_code, severity, title, detail, raised_at)
    VALUES ('MALL_POINT_REVOKE_SHORT', 'WARN',
            '소개몰 반품 — 적립금 일부를 이미 써서 다 회수하지 못함(' || v_short || '원) — 소개몰 › 적립금',
            jsonb_build_object('order', p_order, 'account', l.account_id, 'earned', l.amount, 'short', v_short), clock_timestamp())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN l.remaining;
END $$;

/* 취소 · 반품 — 쓴 적립금 되돌림(그 묶음 · 이미 소멸 · 회수된 묶음이면 새 RESTORE 묶음 · 되돌림 유효 mall.benefit_restore_days) */
CREATE OR REPLACE FUNCTION public.fn_hlt_point_restore(p_order uuid, p_why text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE u record; v_sum bigint := 0; v_acc uuid; v_lot bigint; v_days integer;
BEGIN
  v_days := greatest(1, least(180, public.fn_hlt_setting_num('mall.benefit_restore_days', 30)::integer));
  FOR u IN SELECT pu.id, pu.lot_id, pu.account_id, pu.amount, l.closed_at, l.expires_at
             FROM public.hlt_point_uses pu JOIN public.hlt_point_lots l ON l.id = pu.lot_id
            WHERE pu.order_id = p_order AND pu.restored_at IS NULL ORDER BY pu.id FOR UPDATE OF pu, l LOOP
    IF u.closed_at IS NULL AND u.expires_at > now() THEN
      UPDATE public.hlt_point_lots SET remaining = remaining + u.amount WHERE id = u.lot_id;
      v_lot := u.lot_id;
    ELSE
      INSERT INTO public.hlt_point_lots (account_id, source, order_id, amount, remaining, expires_at)
      VALUES (u.account_id, 'RESTORE', p_order, u.amount, u.amount, now() + make_interval(days => v_days)) RETURNING id INTO v_lot;
    END IF;
    UPDATE public.hlt_point_uses SET restored_at = clock_timestamp() WHERE id = u.id;
    v_sum := v_sum + u.amount; v_acc := u.account_id;
  END LOOP;
  IF v_sum > 0 THEN
    INSERT INTO public.hlt_point_txns (account_id, kind, amount, order_id, reason) VALUES (v_acc, 'RESTORE', v_sum, p_order, p_why);
  END IF;
  RETURN v_sum;
END $$;


/* ── ② 회원 등급 (v10.480 · docs/618) ────────────────────────────────────────────
 *   등급 = 코드 · 이름 · 기준 구매액(최근 mall.tier_months 개월 구매확정 직판 주문의 상품 − 쿠폰) · 적립률 · 혜택 글 · 켬
 *   매일 05:20 다시 셈(mall.tiers on 일 때 · 운영이 정한 회원(manual)은 건너뜀) · 바뀐 기록은 쌓기만 · 등급은 지우지 않음(끔) */
CREATE TABLE IF NOT EXISTS public.hlt_tiers (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
  min_amount  bigint NOT NULL DEFAULT 0 CHECK (min_amount BETWEEN 0 AND 1000000000),
  earn_rate   numeric(4,1) NOT NULL DEFAULT 1 CHECK (earn_rate BETWEEN 0 AND 20),
  benefit     text CHECK (benefit IS NULL OR char_length(benefit) <= 200),
  sort        integer NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 9999),
  active      boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES public.accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.hlt_tiers IS 'v10.480 (D267) 소개몰 회원 등급 — 코드 · 이름 · 기준 구매액 · 적립률(0 ~ 20 · 소수 한 자리) · 혜택 글 · 켬 · 지우지 않음(끔) · 처음 값은 초안(운영이 고침)';

CREATE TABLE IF NOT EXISTS public.hlt_member_tiers (
  account_id     uuid PRIMARY KEY REFERENCES public.accounts(id),
  tier_code      text NOT NULL REFERENCES public.hlt_tiers(code),
  period_amount  bigint NOT NULL DEFAULT 0 CHECK (period_amount >= 0),
  manual         boolean NOT NULL DEFAULT false,
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 200),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.accounts(id)
);
CREATE INDEX IF NOT EXISTS ix_hlt_member_tiers_code ON public.hlt_member_tiers (tier_code);
COMMENT ON TABLE public.hlt_member_tiers IS 'v10.480 (D267) 회원별 지금 등급 — 기간 구매액 · 운영이 정함(manual · 사유 · 다시 셈에서 건너뜀) · 셈한 때';

CREATE TABLE IF NOT EXISTS public.hlt_tier_changes (
  id             bigserial PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  from_code      text,
  to_code        text,
  period_amount  bigint NOT NULL DEFAULT 0 CHECK (period_amount >= 0),
  by_job         boolean NOT NULL DEFAULT true,
  reason         text CHECK (reason IS NULL OR char_length(reason) <= 200),
  actor          uuid REFERENCES public.accounts(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_hlt_tier_changes_acc ON public.hlt_tier_changes (account_id, id DESC);
COMMENT ON TABLE public.hlt_tier_changes IS 'v10.480 (D267) 회원 등급 바뀐 기록 — 정기 작업 · 운영(사유) · 쌓기만';

CREATE OR REPLACE FUNCTION public.fn_hlt_tier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_TIER: 회원 등급은 지우지 않습니다(끄기로).'; END IF;
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'HLT_TIER: 등급 코드는 바꾸지 않습니다.'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

INSERT INTO public.hlt_tiers (code, name, min_amount, earn_rate, benefit, sort) VALUES
  ('BASIC',  '일반',  0,       1.0, '구매확정 적립 1%', 10),
  ('SILVER', '실버',  300000,  2.0, '구매확정 적립 2%', 20),
  ('GOLD',   '골드',  1000000, 3.0, '구매확정 적립 3%', 30)
ON CONFLICT (code) DO NOTHING;


/* ── ③ 정기 배송 (v10.481 · docs/619) ─────────────────────────────────────────────
 *   회원이 직판 상품 옵션 · 수량 · 배송지 · 주기(14 · 28 · 30 · 60 · 90일)를 정하면 다음 결제일에 주문 · 정기 결제(기존 결제 어댑터 · 처음 간주 ASSUME)
 *   건너뛰기(다음 한 번) · 멈춤 · 해지(끝) · 실패하면 다음 날 다시(mall.subscribe_retry 번 실패하면 멈춤 · 운영 알림 MALL_SUBSCRIBE_FAIL)
 *   매일 07:10 — mall.subscribe on 이고 「주문 받기」(mall.order_open) on 일 때만 */
CREATE TABLE IF NOT EXISTS public.hlt_subscriptions (
  id             bigserial PRIMARY KEY,
  account_id     uuid NOT NULL REFERENCES public.accounts(id),
  product_id     uuid NOT NULL REFERENCES public.hlt_products(id),
  option_id      uuid NOT NULL REFERENCES public.hlt_product_options(id),
  qty            integer NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 10),
  address_id     uuid NOT NULL REFERENCES public.hlt_addresses(id),
  cycle_days     integer NOT NULL CHECK (cycle_days IN (14, 28, 30, 60, 90)),
  next_on        date NOT NULL,
  state          text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'PAUSED', 'CANCELED')),
  skip_next      boolean NOT NULL DEFAULT false,
  fail_count     integer NOT NULL DEFAULT 0 CHECK (fail_count BETWEEN 0 AND 100),
  runs           integer NOT NULL DEFAULT 0 CHECK (runs >= 0),
  last_order_id  uuid REFERENCES public.hlt_orders(id),
  cancel_reason  text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  canceled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hlt_sub_canceled CHECK ((state = 'CANCELED') = (canceled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_sub_live ON public.hlt_subscriptions (account_id, option_id) WHERE state <> 'CANCELED';
CREATE INDEX IF NOT EXISTS ix_hlt_sub_due ON public.hlt_subscriptions (next_on) WHERE state = 'ACTIVE';
COMMENT ON TABLE public.hlt_subscriptions IS 'v10.481 (D267) 소개몰 정기 배송 — 회원 · 직판 상품 옵션 · 수량 · 배송지 · 주기 · 다음 결제일 · 건너뛰기 · 멈춤 · 해지(끝) · 실패 수 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hlt_subscription_runs (
  id          bigserial PRIMARY KEY,
  sub_id      bigint NOT NULL REFERENCES public.hlt_subscriptions(id),
  run_on      date NOT NULL,
  state       text NOT NULL CHECK (state IN ('ORDERED', 'PAID', 'SKIPPED', 'FAILED')),
  order_id    uuid REFERENCES public.hlt_orders(id),
  amount      bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  stub        boolean NOT NULL DEFAULT false,
  detail      text CHECK (detail IS NULL OR char_length(detail) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sub_id, run_on)
);
COMMENT ON TABLE public.hlt_subscription_runs IS 'v10.481 (D267) 정기 배송 회차 — 날짜마다 한 번 · 주문함(ORDERED) → 결제됨(PAID) · 실패(FAILED) · 건너뜀(SKIPPED) · 간주 결제(stub) · 지우지 않음';

ALTER TABLE public.hlt_orders ADD COLUMN IF NOT EXISTS subscription_id bigint REFERENCES public.hlt_subscriptions(id);
COMMENT ON COLUMN public.hlt_orders.subscription_id IS 'v10.481 (D267) 정기 배송으로 만든 주문이면 그 정기 배송';

CREATE OR REPLACE FUNCTION public.fn_hlt_sub_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; v_ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_SUB: 정기 배송은 지우지 않습니다(해지로).'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'CANCELED' THEN RAISE EXCEPTION 'HLT_SUB_CANCELED: 해지한 정기 배송은 고치지 않습니다.'; END IF;
    IF (NEW.account_id, NEW.product_id, NEW.option_id, NEW.created_at) IS DISTINCT FROM (OLD.account_id, OLD.product_id, OLD.option_id, OLD.created_at) THEN
      RAISE EXCEPTION 'HLT_SUB: 정기 배송의 회원 · 상품 · 옵션은 바꾸지 않습니다(해지하고 새로).';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.address_id IS DISTINCT FROM OLD.address_id THEN
    SELECT s.type INTO v_type FROM public.hlt_products p JOIN public.hlt_sellers s ON s.id = p.seller_id WHERE p.id = NEW.product_id;
    IF v_type IS DISTINCT FROM 'DIRECT' THEN RAISE EXCEPTION 'HLT_SUB_DIRECT_ONLY: 정기 배송은 직판 상품만 됩니다.'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.hlt_product_options o WHERE o.id = NEW.option_id AND o.product_id = NEW.product_id) INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'HLT_SUB: 이 상품의 옵션이 아닙니다.'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.hlt_addresses a WHERE a.id = NEW.address_id AND a.account_id = NEW.account_id AND a.deleted_at IS NULL) INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'HLT_SUB_ADDRESS: 본인 배송지만 고를 수 있습니다.'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_hlt_sub_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_SUB: 정기 배송 회차는 지우지 않습니다.'; END IF;
  IF (NEW.sub_id, NEW.run_on, NEW.created_at) IS DISTINCT FROM (OLD.sub_id, OLD.run_on, OLD.created_at)
     OR NOT (OLD.state = 'ORDERED' AND NEW.state IN ('PAID', 'FAILED')) THEN
    RAISE EXCEPTION 'HLT_SUB: 정기 배송 회차는 주문함 → 결제됨 · 실패로만 바꿉니다.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;


/* ── ④ 상품권 (v10.482 · docs/620) ─────────────────────────────────────────────────
 *   운영이 발행(판매 SOLD · 판촉 PROMO) · 코드는 발행 때 한 번만 보임(DB 에는 sha256 지문 · 끝 4자리만) · 액면 1천 ~ 100만 원 · 유효 기간(처음 5년)
 *   주문할 때 코드로 잔액에서 씀(직판 · mall.giftcard on · 최소 1원은 결제) · 취소 · 반품되면 잔액 되돌림 · 소멸 · 무효(안 쓴 것) · 잔액 환불 기록
 *   회계: 판매 = 선수금(GIFT_ADV) · 쓰면 매출 · 소멸 = 잡이익 — 초안(세무사 확인) · 선불전자지급수단 해당 여부 · 잔액 환불 기준은 법무 확인 */
CREATE TABLE IF NOT EXISTS public.hlt_giftcards (
  id             bigserial PRIMARY KEY,
  code_hash      text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  code_tail      text NOT NULL CHECK (code_tail ~ '^[A-Z0-9]{4}$'),
  batch_no       text NOT NULL CHECK (batch_no ~ '^GC[0-9]{8}-[0-9]{4,8}$'),
  kind           text NOT NULL CHECK (kind IN ('SOLD', 'PROMO')),
  face_amount    bigint NOT NULL CHECK (face_amount BETWEEN 1000 AND 1000000),
  balance        bigint NOT NULL CHECK (balance >= 0),
  state          text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'EXPIRED', 'VOID', 'REFUNDED')),
  expires_at     timestamptz NOT NULL,
  buyer_name     text CHECK (buyer_name IS NULL OR char_length(buyer_name) <= 40),
  memo           text CHECK (memo IS NULL OR char_length(memo) <= 200),
  issued_by      uuid REFERENCES public.accounts(id),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  closed_reason  text CHECK (closed_reason IS NULL OR char_length(closed_reason) <= 200),
  CONSTRAINT ck_hlt_gift_bal CHECK (balance <= face_amount),
  CONSTRAINT ck_hlt_gift_closed CHECK ((state = 'ACTIVE') = (closed_at IS NULL)),
  CONSTRAINT ck_hlt_gift_closed0 CHECK (state = 'ACTIVE' OR balance = 0)
);
CREATE INDEX IF NOT EXISTS ix_hlt_giftcards_batch ON public.hlt_giftcards (batch_no);
CREATE INDEX IF NOT EXISTS ix_hlt_giftcards_exp ON public.hlt_giftcards (expires_at) WHERE state = 'ACTIVE';
COMMENT ON TABLE public.hlt_giftcards IS 'v10.482 (D267) 소개몰 상품권 — 코드 지문(sha256 · 원문 없음) · 끝 4자리 · 발행 묶음 · 판매 · 판촉 · 액면 · 잔액(음수 없음 · 액면 이하) · 유효 기간 · 소멸 · 무효 · 잔액 환불 · 지우지 않음';

CREATE TABLE IF NOT EXISTS public.hlt_giftcard_txns (
  id          bigserial PRIMARY KEY,
  card_id     bigint NOT NULL REFERENCES public.hlt_giftcards(id),
  kind        text NOT NULL CHECK (kind IN ('ISSUE', 'USE', 'RESTORE', 'EXPIRE', 'VOID', 'REFUND')),
  amount      bigint NOT NULL CHECK (amount BETWEEN 1 AND 1000000),
  order_id    uuid REFERENCES public.hlt_orders(id),
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 200),
  actor       uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_gift_txn_use ON public.hlt_giftcard_txns (order_id) WHERE kind = 'USE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_hlt_gift_txn_restore ON public.hlt_giftcard_txns (order_id) WHERE kind = 'RESTORE';
CREATE INDEX IF NOT EXISTS ix_hlt_gift_txns_card ON public.hlt_giftcard_txns (card_id, id);
COMMENT ON TABLE public.hlt_giftcard_txns IS 'v10.482 (D267) 상품권 기록 — 발행 · 사용(주문 하나에 하나) · 되돌림 · 소멸 · 무효 · 잔액 환불 · 금액 양수 · 쌓기만 · 전표 MALL_GIFT_* 근거';

/* 코드 지문 — 붙임표 · 띄어쓰기 빼고 대문자 · sha256(PG16 기본 함수) */
CREATE OR REPLACE FUNCTION public.fn_hlt_gift_hash(p_code text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

/* 상품권 지킴 — 지우지 않음 · 코드 · 종류 · 액면 · 발행은 바꾸지 않음 · 잔액 · 상태는 상품권 함수(app.hlt_gift = 1)만 */
CREATE OR REPLACE FUNCTION public.fn_hlt_gift_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'HLT_GIFT: 상품권은 지우지 않습니다(무효로).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> NEW.face_amount OR NEW.state <> 'ACTIVE' THEN RAISE EXCEPTION 'HLT_GIFT: 새 상품권은 잔액을 액면과 같게 · 쓸 수 있음으로 넣습니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.code_hash, NEW.code_tail, NEW.batch_no, NEW.kind, NEW.face_amount, NEW.issued_by, NEW.issued_at)
     IS DISTINCT FROM (OLD.code_hash, OLD.code_tail, OLD.batch_no, OLD.kind, OLD.face_amount, OLD.issued_by, OLD.issued_at) THEN
    RAISE EXCEPTION 'HLT_GIFT: 상품권 코드 · 종류 · 액면 · 발행 기록은 바꾸지 않습니다.';
  END IF;
  IF (NEW.balance, NEW.state, NEW.expires_at, NEW.closed_at) IS DISTINCT FROM (OLD.balance, OLD.state, OLD.expires_at, OLD.closed_at)
     AND coalesce(current_setting('app.hlt_gift', true), '') <> '1' THEN
    RAISE EXCEPTION 'HLT_GIFT: 상품권 잔액 · 상태는 사용 · 되돌림 · 소멸 · 무효 · 환불로만 바뀝니다.';
  END IF;
  RETURN NEW;
END $$;

/* 무효(안 쓴 것만) · 잔액 환불 · 소멸 — 잔액을 0 으로 · 기록 한 줄 */
CREATE OR REPLACE FUNCTION public.fn_hlt_gift_close(p_card bigint, p_kind text, p_reason text, p_actor uuid) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c record; v_state text;
BEGIN
  IF p_kind NOT IN ('EXPIRE', 'VOID', 'REFUND') THEN RAISE EXCEPTION 'HLT_GIFT: 닫는 종류가 아닙니다.'; END IF;
  SELECT * INTO c FROM public.hlt_giftcards WHERE id = p_card FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'HLT_GIFT_CODE: 없는 상품권입니다.'; END IF;
  IF c.state <> 'ACTIVE' THEN RAISE EXCEPTION 'HLT_GIFT_STATE: 이미 닫힌 상품권입니다.'; END IF;
  IF p_kind = 'VOID' AND EXISTS (SELECT 1 FROM public.hlt_giftcard_txns t WHERE t.card_id = c.id AND t.kind = 'USE') THEN
    RAISE EXCEPTION 'HLT_GIFT_USED: 한 번이라도 쓴 상품권은 무효로 하지 않습니다(잔액 환불로).';
  END IF;
  IF p_kind = 'REFUND' AND c.kind = 'PROMO' THEN RAISE EXCEPTION 'HLT_GIFT_PROMO_REFUND: 판촉으로 드린 상품권은 잔액 환불이 없습니다(무효 · 소멸로).'; END IF;
  IF p_kind = 'REFUND' AND c.balance < 1 THEN RAISE EXCEPTION 'HLT_GIFT_EMPTY: 돌려드릴 잔액이 없습니다.'; END IF;
  v_state := CASE p_kind WHEN 'EXPIRE' THEN 'EXPIRED' WHEN 'VOID' THEN 'VOID' ELSE 'REFUNDED' END;
  PERFORM set_config('app.hlt_gift', '1', true);
  UPDATE public.hlt_giftcards SET balance = 0, state = v_state, closed_at = clock_timestamp(), closed_reason = left(p_reason, 200) WHERE id = c.id;
  PERFORM set_config('app.hlt_gift', '', true);
  IF c.balance > 0 THEN
    INSERT INTO public.hlt_giftcard_txns (card_id, kind, amount, reason, actor) VALUES (c.id, p_kind, c.balance, left(p_reason, 200), p_actor);
  END IF;
  RETURN c.balance;
END $$;

/* 취소 · 반품 — 그 주문에 쓴 상품권 잔액을 되돌림(닫힌 상품권이면 다시 열고 유효 기간을 되돌림 유효일 만큼 늘림 · 법무 확인) */
CREATE OR REPLACE FUNCTION public.fn_hlt_gift_restore(p_order uuid, p_why text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE t record; v_days integer;
BEGIN
  SELECT u.card_id, u.amount INTO t FROM public.hlt_giftcard_txns u
   WHERE u.order_id = p_order AND u.kind = 'USE'
     AND NOT EXISTS (SELECT 1 FROM public.hlt_giftcard_txns r WHERE r.order_id = p_order AND r.kind = 'RESTORE');
  IF t.card_id IS NULL THEN RETURN 0; END IF;
  v_days := greatest(1, least(180, public.fn_hlt_setting_num('mall.benefit_restore_days', 30)::integer));
  PERFORM 1 FROM public.hlt_giftcards WHERE id = t.card_id FOR UPDATE;
  PERFORM set_config('app.hlt_gift', '1', true);
  UPDATE public.hlt_giftcards
     SET balance = least(face_amount, balance + t.amount), state = 'ACTIVE', closed_at = NULL, closed_reason = NULL,
         expires_at = greatest(expires_at, now() + make_interval(days => v_days))
   WHERE id = t.card_id;
  PERFORM set_config('app.hlt_gift', '', true);
  INSERT INTO public.hlt_giftcard_txns (card_id, kind, amount, order_id, reason) VALUES (t.card_id, 'RESTORE', t.amount, p_order, p_why);
  RETURN t.amount;
END $$;


/* ── ⑤ 주문에 혜택 쓰기 · 주문 칸 지킴 · 상태가 바뀔 때(적립 · 되돌림 · 회수) ───────────────────────── */

/* 주문할 때 한 번 — 적립금(p_points) · 상품권(p_gift_hash) · 직판 · 결제 전 본인 주문 · 쿠폰(㉝) 뒤 금액에서 · 최소 1원은 결제(결제 금액 > 0 · hlt_pay_amount_check) */
CREATE OR REPLACE FUNCTION public.fn_hlt_benefit_apply(p_order uuid, p_account uuid, p_points bigint, p_gift_hash text)
RETURNS TABLE (point_amount bigint, gift_amount bigint, total bigint, gift_tail text) LANGUAGE plpgsql AS $$
DECLARE o record; c record; v_room bigint; v_pt bigint := 0; v_gc bigint := 0; v_min bigint; v_tail text;
BEGIN
  SELECT o2.id, o2.account_id, o2.status, o2.total, o2.point_amount, o2.gift_amount, s.type AS seller_type INTO o
    FROM public.hlt_orders o2 LEFT JOIN public.hlt_sellers s ON s.id = o2.seller_id WHERE o2.id = p_order FOR UPDATE OF o2;
  IF o.id IS NULL OR o.account_id <> p_account OR o.status <> 'PENDING' THEN RAISE EXCEPTION 'HLT_BENEFIT: 결제 전 본인 주문에만 적립금 · 상품권을 씁니다.'; END IF;
  IF o.point_amount <> 0 OR o.gift_amount <> 0 THEN RAISE EXCEPTION 'HLT_BENEFIT: 이 주문에는 이미 적립금 · 상품권을 썼습니다.'; END IF;
  IF coalesce(p_points, 0) < 0 THEN RAISE EXCEPTION 'HLT_POINT_AMOUNT: 적립금은 0원 이상입니다.'; END IF;
  IF coalesce(p_points, 0) = 0 AND p_gift_hash IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, o.total, NULL::text; RETURN;
  END IF;
  IF o.seller_type IS DISTINCT FROM 'DIRECT' THEN RAISE EXCEPTION 'HLT_BENEFIT_DIRECT_ONLY: 적립금 · 상품권은 직판 상품 주문에만 씁니다.'; END IF;
  v_room := o.total - 1;
  IF coalesce(p_points, 0) > 0 THEN
    IF NOT public.fn_hlt_setting_on('mall.points') THEN RAISE EXCEPTION 'HLT_POINT_OFF: 지금은 적립금을 쓰지 않습니다.'; END IF;
    v_min := public.fn_hlt_setting_num('mall.points_min_use', 1000)::bigint;
    IF p_points < v_min THEN RAISE EXCEPTION 'HLT_POINT_MIN: 적립금은 정해진 최소 금액부터 씁니다.'; END IF;
    IF p_points > v_room THEN RAISE EXCEPTION 'HLT_POINT_OVER: 적립금은 결제 금액에서 1원을 남기고 쓸 수 있습니다.'; END IF;
    PERFORM public.fn_hlt_point_take(p_account, p_points, p_order, 'USE', NULL, p_account);
    v_pt := p_points; v_room := v_room - v_pt;
  END IF;
  IF p_gift_hash IS NOT NULL THEN
    IF NOT public.fn_hlt_setting_on('mall.giftcard') THEN RAISE EXCEPTION 'HLT_GIFT_OFF: 지금은 상품권을 받지 않습니다.'; END IF;
    SELECT * INTO c FROM public.hlt_giftcards g WHERE g.code_hash = p_gift_hash FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'HLT_GIFT_CODE: 없는 상품권입니다.'; END IF;
    IF c.state <> 'ACTIVE' OR c.expires_at <= now() THEN RAISE EXCEPTION 'HLT_GIFT_STATE: 쓸 수 없는 상품권입니다(유효 기간 · 무효 · 환불).'; END IF;
    IF c.balance < 1 THEN RAISE EXCEPTION 'HLT_GIFT_EMPTY: 상품권 잔액이 없습니다.'; END IF;
    v_gc := least(c.balance, v_room);
    IF v_gc < 1 THEN RAISE EXCEPTION 'HLT_GIFT_OVER: 결제할 금액이 없어 상품권을 쓰지 않습니다(최소 1원 결제).'; END IF;
    PERFORM set_config('app.hlt_gift', '1', true);
    UPDATE public.hlt_giftcards SET balance = balance - v_gc WHERE id = c.id;
    PERFORM set_config('app.hlt_gift', '', true);
    INSERT INTO public.hlt_giftcard_txns (card_id, kind, amount, order_id, actor) VALUES (c.id, 'USE', v_gc, p_order, p_account);
    v_tail := c.code_tail;
  END IF;
  PERFORM set_config('app.hlt_benefit', '1', true);
  UPDATE public.hlt_orders h SET point_amount = v_pt, gift_amount = v_gc, total = h.total - v_pt - v_gc WHERE h.id = p_order;
  PERFORM set_config('app.hlt_benefit', '', true);
  RETURN QUERY SELECT v_pt, v_gc, o.total - v_pt - v_gc, v_tail;
END $$;

/* 주문의 적립금 · 상품권 칸 — 넣을 때 0 · 바꾸기는 fn_hlt_benefit_apply 가 한 번만(결제 전) */
CREATE OR REPLACE FUNCTION public.fn_hlt_order_benefit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.point_amount <> 0 OR NEW.gift_amount <> 0 THEN RAISE EXCEPTION 'HLT_BENEFIT: 주문의 적립금 · 상품권 금액은 주문을 넣은 뒤 정합니다.'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.point_amount, NEW.gift_amount) IS DISTINCT FROM (OLD.point_amount, OLD.gift_amount)
     AND (coalesce(current_setting('app.hlt_benefit', true), '') <> '1' OR OLD.point_amount <> 0 OR OLD.gift_amount <> 0 OR OLD.status <> 'PENDING') THEN
    RAISE EXCEPTION 'HLT_BENEFIT: 주문의 적립금 · 상품권 금액은 주문할 때 한 번만 정합니다.';
  END IF;
  RETURN NEW;
END $$;

/* 주문 상태 — 구매확정이면 적립 · 취소 · 반품이면 쓴 적립금 · 상품권 되돌림(쿠폰 되돌림 ㉝ 과 같은 자리) · 확정 뒤 반품이면 적립 회수 */
CREATE OR REPLACE FUNCTION public.fn_hlt_benefit_on_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_why text;
BEGIN
  IF NEW.status = 'CONFIRMED' AND OLD.status IS DISTINCT FROM 'CONFIRMED' THEN
    PERFORM public.fn_hlt_point_earn(NEW.id);
  END IF;
  IF NEW.status IN ('CANCELED', 'RETURNED') AND OLD.status NOT IN ('CANCELED', 'RETURNED') THEN
    v_why := CASE WHEN NEW.status = 'CANCELED' THEN '주문 취소' ELSE '반품' END;
    PERFORM public.fn_hlt_point_restore(NEW.id, v_why);
    PERFORM public.fn_hlt_gift_restore(NEW.id, v_why);
    PERFORM public.fn_hlt_point_revoke(NEW.id);
  END IF;
  RETURN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_point_lot_guard' AND tgrelid = 'public.hlt_point_lots'::regclass) THEN
    CREATE TRIGGER trg_hlt_point_lot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_point_lots FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_point_lot_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_point_use_guard' AND tgrelid = 'public.hlt_point_uses'::regclass) THEN
    CREATE TRIGGER trg_hlt_point_use_guard BEFORE UPDATE OR DELETE ON public.hlt_point_uses FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_point_use_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_point_txns_ro' AND tgrelid = 'public.hlt_point_txns'::regclass) THEN
    CREATE TRIGGER trg_hlt_point_txns_ro BEFORE UPDATE OR DELETE ON public.hlt_point_txns FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_tier_guard' AND tgrelid = 'public.hlt_tiers'::regclass) THEN
    CREATE TRIGGER trg_hlt_tier_guard BEFORE UPDATE OR DELETE ON public.hlt_tiers FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_tier_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_tier_changes_ro' AND tgrelid = 'public.hlt_tier_changes'::regclass) THEN
    CREATE TRIGGER trg_hlt_tier_changes_ro BEFORE UPDATE OR DELETE ON public.hlt_tier_changes FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_sub_guard' AND tgrelid = 'public.hlt_subscriptions'::regclass) THEN
    CREATE TRIGGER trg_hlt_sub_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_subscriptions FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_sub_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_sub_run_guard' AND tgrelid = 'public.hlt_subscription_runs'::regclass) THEN
    CREATE TRIGGER trg_hlt_sub_run_guard BEFORE UPDATE OR DELETE ON public.hlt_subscription_runs FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_sub_run_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_gift_guard' AND tgrelid = 'public.hlt_giftcards'::regclass) THEN
    CREATE TRIGGER trg_hlt_gift_guard BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_giftcards FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_gift_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_gift_txns_ro' AND tgrelid = 'public.hlt_giftcard_txns'::regclass) THEN
    CREATE TRIGGER trg_hlt_gift_txns_ro BEFORE UPDATE OR DELETE ON public.hlt_giftcard_txns FOR EACH ROW EXECUTE FUNCTION public.fn_block_write();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_order_benefit_guard' AND tgrelid = 'public.hlt_orders'::regclass) THEN
    CREATE TRIGGER trg_hlt_order_benefit_guard BEFORE INSERT OR UPDATE OF point_amount, gift_amount ON public.hlt_orders FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_order_benefit_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hlt_benefit_on_status' AND tgrelid = 'public.hlt_orders'::regclass) THEN
    CREATE TRIGGER trg_hlt_benefit_on_status AFTER UPDATE OF status ON public.hlt_orders FOR EACH ROW EXECUTE FUNCTION public.fn_hlt_benefit_on_status();
  END IF;
END $$;


/* ── ⑥ 계정(초안 · 세무사 확인) — 적립금 충당부채 · 상품권 선수금 · 판매촉진비 · 상품권 소멸 잡이익 ─────────── */
INSERT INTO public.acct_accounts (role, name, kind, ext_code, ext_name, sort, note, draft) VALUES
  ('GIFT_ADV',        '선수금(소개몰 상품권)',               'LIABILITY', '259', '선수금',     42,  '소개몰 상품권 판매 · 판촉 발행 — 쓰면 매출로 · 소멸이면 잡이익 · v10.482 · 판촉 발행을 선수금으로 둘지(충당부채) 세무사 확인', true),
  ('MALL_POINT_LIAB', '적립금 충당부채(소개몰)',             'LIABILITY', NULL,  '충당부채',   66,  '소개몰 구매확정 적립금 — 쓰면 줄고 · 소멸 · 회수면 환입 · v10.479 · 계정 코드 · 충당부채 · 이연수익(K-IFRS 1115) 중 무엇으로 둘지 세무사 확인', true),
  ('EXP_MALL_PROMO',  '판매촉진비(소개몰 적립금 · 판촉 상품권)', 'EXPENSE',   NULL,  '판매촉진비', 205, '소개몰 적립금 적립 · 판촉 상품권 발행 — 소멸 · 회수는 환입(대변) · v10.479 · 계정 코드 세무사 확인', true),
  ('INC_GIFT_LAPSE',  '잡이익(소개몰 상품권 소멸)',          'REVENUE',   '930', '잡이익',     185, '판매한 상품권 유효 기간 지남 · 잔액 소멸 — v10.482 · 소멸 시효 · 잔액 환불 기준(법무) · 계정 세무사 확인', true)
ON CONFLICT (role) DO NOTHING;


/* ── ⑦ 설정(모두 처음 off · 값은 초안 — 운영이 고침) · 정기 작업 3개 ───────────────────────────── */
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example) VALUES
  ('mall.points', 'off', 'ADMIN', '소개몰 적립금(v10.479 · D267) — 처음 off · on 이면 구매확정 때 적립 · 주문서에서 적립금 사용(직판 주문만) · 운영 지급 · 회수 · 소멸은 꺼져도 됨', false, '^(on|off)$', 'off'),
  ('mall.points_rate', '1', 'ADMIN', '소개몰 기본 적립률(퍼센트 · 0 ~ 20 · 소수 한 자리 · 처음 1 · v10.479) — 회원 등급(mall.tiers)이 켜져 있으면 등급 적립률', false, '^(20|1[0-9]|[0-9])(\.[0-9])?$', '1'),
  ('mall.points_valid_days', '365', 'ADMIN', '소개몰 적립금 유효 기간(일 · 30 ~ 1825 · 처음 365 · v10.479) — 지나면 매일 00:20 소멸 · 30일 전에 회원 알림', false, '^(3[0-9]|[4-9][0-9]|[1-9][0-9]{2}|1[0-7][0-9]{2}|18[01][0-9]|182[0-5])$', '365'),
  ('mall.points_min_use', '1000', 'ADMIN', '소개몰 적립금 최소 사용(원 · 0 ~ 1,000,000 · 처음 1,000 · v10.479)', false, '^([0-9]{1,6}|1000000)$', '1000'),
  ('mall.benefit_restore_days', '30', 'ADMIN', '취소 · 반품으로 되돌린 적립금 · 상품권이 이미 소멸했을 때 다시 쓸 수 있는 날(일 · 1 ~ 180 · 처음 30 · v10.479)', false, '^([1-9][0-9]?|1[0-7][0-9]|180)$', '30'),
  ('mall.tiers', 'off', 'ADMIN', '소개몰 회원 등급(v10.480 · D267) — 처음 off · on 이면 매일 05:20 기간 구매액으로 등급을 다시 셈 · 적립률을 등급 적립률로', false, '^(on|off)$', 'off'),
  ('mall.tier_months', '6', 'ADMIN', '소개몰 회원 등급 기간(개월 · 1 ~ 12 · 처음 6 · v10.480) — 최근 이 기간 구매확정 직판 주문의 상품 − 쿠폰 금액', false, '^([1-9]|1[0-2])$', '6'),
  ('mall.subscribe', 'off', 'ADMIN', '소개몰 정기 배송(v10.481 · D267) — 처음 off · on 이고 주문 받기(mall.order_open) on 이면 매일 07:10 결제일이 된 정기 배송을 주문 · 결제 · 회원 신청도 이때만', false, '^(on|off)$', 'off'),
  ('mall.subscribe_mode', 'ASSUME', 'ADMIN', '정기 배송 결제 방식(v10.481) — ASSUME(간주 · 실제 청구 없음 · 처음) · LIVE(카드 자동결제 등록 키로 결제대행사 청구)', false, '^(ASSUME|LIVE)$', 'ASSUME'),
  ('mall.subscribe_retry', '3', 'ADMIN', '정기 배송 결제 실패 다시 하기(번 · 1 ~ 5 · 처음 3 · v10.481) — 이만큼 이어서 실패하면 멈춤 · 운영 알림', false, '^[1-5]$', '3'),
  ('mall.giftcard', 'off', 'ADMIN', '소개몰 상품권 받기(v10.482 · D267) — 처음 off · on 이면 주문서에서 상품권 코드로 결제(직판 주문만) · 발행 · 조회 · 무효 · 환불은 꺼져도 됨 · 법무 확인 뒤 켬', false, '^(on|off)$', 'off'),
  ('mall.giftcard_valid_days', '1825', 'ADMIN', '소개몰 상품권 유효 기간(일 · 365 ~ 3650 · 처음 1825 = 5년 · v10.482 · 상품권 표준약관 기준 확인 필요)', false, '^(36[5-9]|3[7-9][0-9]|[4-9][0-9]{2}|[1-2][0-9]{3}|3[0-5][0-9]{2}|36[0-4][0-9]|3650)$', '1825')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES
  ('mall_benefit_expire', 1440, 0, 20, NULL, true, '소개몰 적립금 · 상품권 소멸 — 매일 00:20 · 유효 기간 지난 적립금 묶음 · 상품권 잔액 소멸 · 적립금 30일 전 회원 알림(mall.points on 일 때) · D267 · v10.479'),
  ('mall_tier_recalc', 1440, 5, 20, NULL, true, '소개몰 회원 등급 다시 셈 — 매일 05:20 · 최근 mall.tier_months 개월 구매액(mall.tiers on 일 때) · D267 · v10.480'),
  ('mall_subscribe', 1440, 7, 10, NULL, true, '소개몰 정기 배송 — 매일 07:10 · 결제일이 된 정기 배송 주문 · 결제(mall.subscribe · mall.order_open on 일 때 · 처음 간주) · D267 · v10.481')
ON CONFLICT (job) DO NOTHING;


/* ── ⑧ ㉕ 권한(D258) 시드에 새 탭 4개 — 소개몰 탭(따로 적지 않은 탭 = ADMIN · SUPER)과 같은 규칙
 *   주소 규칙(gen_seed.py 와 같음): GET = VIEW · /run · /close 끝 = APPROVE · 그 밖 변경 = EDIT · 이름 = 탭 이름 · 순서 = 소개몰 묶음 안 차례 */
INSERT INTO public.perm_tasks (key, name, group_key, levels, sort) VALUES
  ('hlt-points', '적립금', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 280),
  ('hlt-tiers', '회원 등급', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 290),
  ('hlt-subscribe', '정기 배송', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 300),
  ('hlt-giftcards', '상품권', 'admhlt', ARRAY['VIEW','EDIT','APPROVE','EXPORT'], 310)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.perm_role_group_items (group_key, task_key, level) VALUES
  ('R_ADMIN', 'hlt-points', 'VIEW'), ('R_ADMIN', 'hlt-points', 'EDIT'), ('R_ADMIN', 'hlt-points', 'APPROVE'), ('R_ADMIN', 'hlt-points', 'EXPORT'),
  ('R_ADMIN', 'hlt-tiers', 'VIEW'), ('R_ADMIN', 'hlt-tiers', 'EDIT'), ('R_ADMIN', 'hlt-tiers', 'APPROVE'), ('R_ADMIN', 'hlt-tiers', 'EXPORT'),
  ('R_ADMIN', 'hlt-subscribe', 'VIEW'), ('R_ADMIN', 'hlt-subscribe', 'EDIT'), ('R_ADMIN', 'hlt-subscribe', 'APPROVE'), ('R_ADMIN', 'hlt-subscribe', 'EXPORT'),
  ('R_ADMIN', 'hlt-giftcards', 'VIEW'), ('R_ADMIN', 'hlt-giftcards', 'EDIT'), ('R_ADMIN', 'hlt-giftcards', 'APPROVE'), ('R_ADMIN', 'hlt-giftcards', 'EXPORT')
ON CONFLICT DO NOTHING;
INSERT INTO public.perm_route_map (method, pattern, task_key, level) VALUES
  ('GET', '/admin/health/points', 'hlt-points', 'VIEW'),
  ('POST', '/admin/health/points/adjust', 'hlt-points', 'EDIT'),
  ('GET', '/admin/health/tiers', 'hlt-tiers', 'VIEW'),
  ('POST', '/admin/health/tiers', 'hlt-tiers', 'EDIT'),
  ('PUT', '/admin/health/tiers/{code}', 'hlt-tiers', 'EDIT'),
  ('PUT', '/admin/health/tiers/member/{accountId}', 'hlt-tiers', 'EDIT'),
  ('POST', '/admin/health/tiers/run', 'hlt-tiers', 'APPROVE'),
  ('GET', '/admin/health/subscriptions', 'hlt-subscribe', 'VIEW'),
  ('POST', '/admin/health/subscriptions/{id}/state', 'hlt-subscribe', 'EDIT'),
  ('POST', '/admin/health/subscriptions/run', 'hlt-subscribe', 'APPROVE'),
  ('GET', '/admin/health/giftcards', 'hlt-giftcards', 'VIEW'),
  ('POST', '/admin/health/giftcards', 'hlt-giftcards', 'EDIT'),
  ('GET', '/admin/health/giftcards/{id}', 'hlt-giftcards', 'VIEW'),
  ('POST', '/admin/health/giftcards/{id}/close', 'hlt-giftcards', 'APPROVE'),
  ('POST', '/admin/health/giftcards/lookup', 'hlt-giftcards', 'EDIT')
ON CONFLICT (method, pattern, task_key) DO NOTHING;


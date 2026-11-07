-- =====================================================================
-- D184 — 요금제 금액 · 한도를 운영 화면에서 · 올린 금액은 새 구독부터 (v10.207 · 2026-11-07)
--
--   대표 「운영 화면에서 바꾸게」(subscription-referral-code 미정 3 · #13 — 금액은 오픈 전에 정함).
--   전에는 요금제 값이 마이그레이션(B900 · D060)에만 있어 바꾸려면 새 판을 올려야 했습니다.
--
--   ① 구독에 「묶인 금액」 locked_price · locked_plan_code — 요금제 금액을 **올리면** 그 요금제를 쓰는
--      이용 중인 구독에 옛 금액을 묶음(이미 묶여 있으면 더 낮은 값 그대로). 갱신 결제는 묶인 금액과
--      지금 금액 중 **작은 값**(v_billing_due) — 말없이 더 많이 빠져나가지 않게.
--      **내리면** 모두에게 다음 결제부터(묶인 금액이 새 금액 이상이면 묶음을 풂).
--      요금제가 바뀌면(다음 요금제 적용 · 다시 구독) 묶음은 풀림(트리거) — 새 요금제는 그때 금액.
--   ② 변경 기록 subscription_plan_changes(누가 · 언제 · 전 → 후 · 사유 · 묶은 수) — 지우지 않음.
--   ③ fn_plan_update — 한 거래로 값 바꾸기 + 묶기 + 기록. 무료 ↔ 유료 전환 · 음수는 막음.
--
--   요금제를 새로 만들거나 지우지 않음. 무료 요금제 열람 한도는 지금처럼 운영 설정을 따름(D015).
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

-- ① 묶인 금액 --------------------------------------------------------
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS locked_price numeric(14,0);
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS locked_plan_code text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS locked_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sub_locked_price') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT chk_sub_locked_price
      CHECK ((locked_price IS NULL AND locked_plan_code IS NULL) OR (locked_price >= 0 AND locked_plan_code IS NOT NULL));
  END IF;
END $$;
COMMENT ON COLUMN public.subscriptions.locked_price IS
  '요금제 금액을 올렸을 때 이 구독에 묶인 옛 금액(D184). 갱신 결제는 이 값과 지금 금액 중 작은 값. 요금제가 바뀌면 풀림';
COMMENT ON COLUMN public.subscriptions.locked_plan_code IS '묶인 금액이 적용되는 요금제(D184) — plan_code 와 같을 때만 씀';

/* 이 구독이 다음에 낼 금액 — 화면 · 청구가 같은 셈을 씀 */
CREATE OR REPLACE FUNCTION public.fn_sub_price(p_locked numeric, p_locked_plan text, p_plan text, p_price numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_locked IS NOT NULL AND p_locked_plan = p_plan THEN LEAST(p_locked, p_price) ELSE p_price END
$$;

/* 요금제가 바뀌면 묶음을 풂(다음 요금제 적용 · 다시 구독) */
CREATE OR REPLACE FUNCTION public.fn_sub_lock_clear() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_code IS DISTINCT FROM OLD.plan_code AND NEW.locked_plan_code IS DISTINCT FROM NEW.plan_code THEN
    NEW.locked_price := NULL; NEW.locked_plan_code := NULL; NEW.locked_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sub_lock_clear ON public.subscriptions;
CREATE TRIGGER trg_sub_lock_clear BEFORE UPDATE OF plan_code ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.fn_sub_lock_clear();

-- ② 변경 기록 --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plan_changes (
  id          bigserial PRIMARY KEY,
  plan_code   text NOT NULL REFERENCES public.subscription_plans(code),
  before      jsonb NOT NULL,
  after       jsonb NOT NULL,
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 2 AND 200),
  locked      int NOT NULL DEFAULT 0,
  lowered     int NOT NULL DEFAULT 0,
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_plan_changes_at ON public.subscription_plan_changes (changed_at DESC);
COMMENT ON TABLE public.subscription_plan_changes IS '요금제 금액 · 한도 변경 기록(D184 · 운영 화면 SUPER) — 지우지 않음';

CREATE OR REPLACE FUNCTION public.fn_plan_change_no_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PLAN: 요금제 변경 기록은 고치거나 지울 수 없습니다.';
END $$;
DROP TRIGGER IF EXISTS trg_plan_change_no_edit ON public.subscription_plan_changes;
CREATE TRIGGER trg_plan_change_no_edit BEFORE UPDATE OR DELETE ON public.subscription_plan_changes
  FOR EACH ROW EXECUTE FUNCTION public.fn_plan_change_no_edit();

-- ③ 값 바꾸기 · 묶기 · 기록 -------------------------------------------
/*  p 는 바꿀 칸만 담은 jsonb — monthly_price · included_codes · extra_code_price · proposal_limit ·
 *  request_views_per_month · listing_slots · priority_slot_count · success_fee (null 은 「무제한」인 칸만 허용)
 *  돌려줌: locked(이번에 옛 금액을 묶은 구독 수) · lowered(내린 금액이 다음 결제부터 적용되는 구독 수) */
CREATE OR REPLACE FUNCTION public.fn_plan_update(p_code text, p jsonb, p_reason text, p_actor uuid)
RETURNS TABLE (locked int, lowered int) LANGUAGE plpgsql AS $$
DECLARE
  o public.subscription_plans%ROWTYPE;
  n public.subscription_plans%ROWTYPE;
  v_locked int := 0; v_lowered int := 0;
BEGIN
  SELECT * INTO o FROM public.subscription_plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN: 없는 요금제입니다.'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 2 THEN RAISE EXCEPTION 'PLAN: 바꾸는 사유를 적어 주십시오.'; END IF;
  n := o;
  IF p ? 'monthly_price'           THEN n.monthly_price           := (p->>'monthly_price')::numeric; END IF;
  IF p ? 'included_codes'          THEN n.included_codes          := (p->>'included_codes')::int; END IF;
  IF p ? 'extra_code_price'        THEN n.extra_code_price        := (p->>'extra_code_price')::numeric; END IF;
  IF p ? 'proposal_limit'          THEN n.proposal_limit          := (p->>'proposal_limit')::int; END IF;
  IF p ? 'request_views_per_month' THEN n.request_views_per_month := (p->>'request_views_per_month')::int; END IF;
  IF p ? 'listing_slots'           THEN n.listing_slots           := (p->>'listing_slots')::int; END IF;
  IF p ? 'priority_slot_count'     THEN n.priority_slot_count     := (p->>'priority_slot_count')::int; END IF;
  IF p ? 'success_fee'             THEN n.success_fee             := (p->>'success_fee')::numeric; END IF;

  IF n.monthly_price IS NULL OR n.monthly_price < 0 THEN RAISE EXCEPTION 'PLAN: 월 요금은 0 이상이어야 합니다.'; END IF;
  IF (o.monthly_price = 0) <> (n.monthly_price = 0) THEN
    RAISE EXCEPTION 'PLAN: 무료 요금제와 유료 요금제를 서로 바꿀 수 없습니다.';
  END IF;
  IF o.monthly_price = 0 AND p ? 'request_views_per_month' AND n.request_views_per_month IS DISTINCT FROM o.request_views_per_month THEN
    RAISE EXCEPTION 'PLAN: 무료 요금제의 열람 한도는 운영 설정 request.view.free_monthly 를 따릅니다.';
  END IF;
  IF n.included_codes IS NULL OR n.included_codes < 0 OR n.extra_code_price IS NULL OR n.extra_code_price < 0
     OR coalesce(n.proposal_limit, 0) < 0 OR coalesce(n.request_views_per_month, 0) < 0 OR coalesce(n.listing_slots, 0) < 0
     OR n.priority_slot_count IS NULL OR n.priority_slot_count < 0 OR n.success_fee IS NULL OR n.success_fee < 0 THEN
    RAISE EXCEPTION 'PLAN: 건수 · 금액은 0 이상이어야 합니다.';
  END IF;

  IF n.monthly_price > o.monthly_price THEN
    /* 올림 — 이용 중인 구독에 옛 금액을 묶음(이미 묶인 더 낮은 값은 그대로) */
    UPDATE public.subscriptions s
       SET locked_price = CASE WHEN s.locked_plan_code = p_code AND s.locked_price IS NOT NULL
                               THEN LEAST(s.locked_price, o.monthly_price) ELSE o.monthly_price END,
           locked_plan_code = p_code, locked_at = coalesce(CASE WHEN s.locked_plan_code = p_code THEN s.locked_at END, now())
     WHERE s.plan_code = p_code AND s.status IN ('ACTIVE', 'PAST_DUE');
    GET DIAGNOSTICS v_locked = ROW_COUNT;
  ELSIF n.monthly_price < o.monthly_price THEN
    /* 내림 — 모두 다음 결제부터 새 금액(묶인 값이 새 금액 이상이면 묶음을 풂) */
    SELECT count(*)::int INTO v_lowered FROM public.subscriptions s
     WHERE s.plan_code = p_code AND s.status IN ('ACTIVE', 'PAST_DUE')
       AND public.fn_sub_price(s.locked_price, s.locked_plan_code, s.plan_code, o.monthly_price) > n.monthly_price;
    UPDATE public.subscriptions s SET locked_price = NULL, locked_plan_code = NULL, locked_at = NULL
     WHERE s.locked_plan_code = p_code AND s.locked_price >= n.monthly_price;
  END IF;

  UPDATE public.subscription_plans SET
    monthly_price = n.monthly_price, included_codes = n.included_codes, extra_code_price = n.extra_code_price,
    proposal_limit = n.proposal_limit, request_views_per_month = n.request_views_per_month,
    listing_slots = n.listing_slots, priority_slot_count = n.priority_slot_count, success_fee = n.success_fee
   WHERE code = p_code;

  INSERT INTO public.subscription_plan_changes (plan_code, before, after, reason, locked, lowered, changed_by)
  VALUES (p_code, to_jsonb(o), to_jsonb(n), btrim(p_reason), v_locked, v_lowered, p_actor);

  RETURN QUERY SELECT v_locked, v_lowered;
END $$;

-- ④ 청구 대상 — 묶인 금액을 씀(D032 의 나머지는 그대로) ------------------------
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
    (public.fn_sub_price(s.locked_price, s.locked_plan_code, np.code, np.monthly_price))::numeric(14,0) AS amount,
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
    s.plan_code AS current_plan_code
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

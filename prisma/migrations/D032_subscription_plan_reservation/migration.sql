-- =====================================================================
-- D032 — 구독 요금제 바꾸기 = 「다음 결제일부터 예약」 (v10.27 · G-189 · 10/8 답 ③ 「3 맞음」)
--
--   유료 구독 중에 요금제를 바꾸면(올리기 · 내리기 모두) 지금은 결제하지 않고, 다음 결제일에 새 요금제로 청구 · 적용합니다.
--   전에는 바꾸는 즉시 새 30일이 시작되고 새 요금을 다시 받았습니다(남은 기간을 잃음 · 같은 달 두 번 결제).
--   처음 유료로 들어오는 경우(무료 · 구독 없음 → 유료)는 그대로 지금 결제하고 오늘부터 시작합니다.
--
--   subscriptions.next_plan_code · next_plan_at   예약한 요금제와 예약한 때(없으면 NULL)
--   subscription_invoices.plan_code              그 청구서가 어느 요금제의 값인가(정기결제가 예약 요금제로 청구할 때 적음)
--   v_billing_due                                예약이 있으면 예약 요금제의 이름 · 금액으로 청구 대상을 냅니다
--                                                (예약이 무료면 청구하지 않고 — 기간 끝에 무료로 바꾸는 일은 정기결제 배치가 합니다)
--   결제 실패면 기존 연체(PAST_DUE) 규칙 그대로 — 예약 요금제는 결제가 성공해야 적용됩니다(10/8 확인 ②).
--   재실행 안전.
-- =====================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS next_plan_code text,
  ADD COLUMN IF NOT EXISTS next_plan_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_next_plan_code_fkey') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_next_plan_code_fkey
      FOREIGN KEY (next_plan_code) REFERENCES public.subscription_plans(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sub_next_plan') THEN
    -- 지금 요금제와 같은 것은 예약이 아닙니다 · 예약 때는 예약 시각이 있어야 합니다
    ALTER TABLE public.subscriptions ADD CONSTRAINT chk_sub_next_plan
      CHECK (next_plan_code IS NULL OR (next_plan_code <> plan_code AND next_plan_at IS NOT NULL));
  END IF;
END $$;

ALTER TABLE public.subscription_invoices ADD COLUMN IF NOT EXISTS plan_code text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_invoices_plan_code_fkey') THEN
    ALTER TABLE public.subscription_invoices ADD CONSTRAINT subscription_invoices_plan_code_fkey
      FOREIGN KEY (plan_code) REFERENCES public.subscription_plans(code);
  END IF;
END $$;

COMMENT ON COLUMN public.subscriptions.next_plan_code IS '다음 결제일부터 쓸 요금제(예약). 결제가 성공해야 plan_code 로 옮겨 갑니다 — G-189';
COMMENT ON COLUMN public.subscriptions.next_plan_at IS '요금제 예약을 한 시각';
COMMENT ON COLUMN public.subscription_invoices.plan_code IS '이 청구서가 어느 요금제의 값인가(예약 요금제로 청구하면 그 요금제) — G-189';

-- 청구 대상: 예약이 있으면 예약 요금제(np)의 이름 · 금액. 열 순서는 그대로(기존 열 뒤에 current_plan_code 를 덧붙임).
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
    np.monthly_price AS amount,
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

COMMENT ON VIEW public.v_billing_due IS '정기결제 청구 대상 — 예약 요금제가 있으면 그 요금제의 금액(G-189). 예약이 무료면 청구하지 않음(배치가 기간 끝에 무료로 바꿈)';

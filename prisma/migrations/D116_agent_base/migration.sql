-- =====================================================================
-- D116 — v10.94 AI 에이전트 0단계 틀 (2026-10-24 · docs/149 · docs/151)
--
--   대표 결정(2026-10-24 「추천대로」 — ai-agent #11 ~ #16)
--
--   ① 대화 · 메시지 · AI 검수 의견 · 하루 사용량 표 — 모두 비어 있음
--   ② 모델 요금표 agent_model_prices — 2026-10-06 Anthropic 공개 요금 사본(계약 전 다시 확인 · 운영자가 고칠 수 있음)
--   ③ fn_agent_allowed(통로) — 스위치 · 월 상한을 DB 가 봄. 상한이 0 이면 아무것도 부르지 않음
--   ④ fn_agent_record_usage — 사용량 · 비용을 쌓고, 이번 달 비용이 상한에 닿으면 agent.enabled 를 끄고 운영 경보(CRITICAL)
--   ⑤ 스위치 전부 off · 월 상한 0 — 이번 판에서는 아무것도 부르지 않습니다(모델 연결은 1단계)
--   AI 는 승인 · 반려 · 확정 · 지급을 하지 않습니다(결정 #7) — AI 의견은 따로 쌓고 검수 상태를 바꾸지 않음
--
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     text NOT NULL CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE')),
  account_id  uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  guest_key   text,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','HANDED_OFF','CLOSED')),
  inquiry_id  uuid REFERENCES public.inquiries(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL DEFAULT now() + interval '90 days'
);
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id   uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('user','assistant','tool')),
  body              text NOT NULL,
  model             text,
  input_tokens      int, output_tokens int, cache_read_tokens int,
  stop_reason       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_review_opinions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_item_id uuid NOT NULL REFERENCES public.review_items(id),
  suggestion     text NOT NULL CHECK (suggestion IN ('APPROVE','REJECT','UNSURE')),
  reason_codes   text[],
  note           text,
  model          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_item_id, model)
);
CREATE TABLE IF NOT EXISTS public.agent_model_prices (
  model              text PRIMARY KEY CHECK (model ~ '^claude-[a-z0-9-]+$'),
  input_per_m        numeric(10,4) NOT NULL CHECK (input_per_m >= 0),
  output_per_m       numeric(10,4) NOT NULL CHECK (output_per_m >= 0),
  cache_read_per_m   numeric(10,4) NOT NULL CHECK (cache_read_per_m >= 0),
  as_of              date NOT NULL,
  note               text
);
INSERT INTO public.agent_model_prices (model, input_per_m, output_per_m, cache_read_per_m, as_of, note) VALUES
  ('claude-haiku-5-5',  0.10,  0.50, 0.01, '2026-10-06', '입력 10만 토큰 이하 요금 — 넘으면 0.50 / 2.50 · 계약 전 확인'),
  ('claude-sonnet-5-5', 2.00, 10.00, 0.20, '2026-10-06', '계약 전 확인'),
  ('claude-opus-5-5',   4.00, 20.00, 0.20, '2026-10-06', '계약 전 확인')
ON CONFLICT (model) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.agent_usage_daily (
  day            date NOT NULL,
  channel        text NOT NULL CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE')),
  model          text NOT NULL,
  requests       int NOT NULL DEFAULT 0,
  input_tokens   bigint NOT NULL DEFAULT 0,
  output_tokens  bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cost_usd       numeric(12,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (day, channel, model)
);

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('agent.enabled', 'off', 'GLOBAL', 'AI 에이전트 전체 — off 면 아무것도 부르지 않음 · 월 상한에 닿으면 저절로 off(docs/149)', '^(on|off)$', 'off'),
  ('agent.review_shadow.enabled', 'off', 'GLOBAL', 'AI 검수 보조(병행) — 의견만 저장 · 검수 상태는 바꾸지 않음(1단계)', '^(on|off)$', 'off'),
  ('agent.chat.enabled', 'off', 'GLOBAL', 'AI 고객응대 안내(2단계) — 법무 3건 회신 뒤', '^(on|off)$', 'off'),
  ('agent.chat.member_lookup.enabled', 'off', 'GLOBAL', 'AI 고객응대 내 정보 조회(3단계 · 읽기만)', '^(on|off)$', 'off'),
  ('agent.monthly_cap_usd', '0', 'GLOBAL', 'AI 월 상한(달러) — 0 이면 아무것도 부르지 않음 · 닿으면 agent.enabled off', '^[0-9]{1,6}(\.[0-9]{1,2})?$', '10'),
  ('agent.guest_daily_limit', '20', 'GLOBAL', '비회원 하루 AI 상담 횟수', '^[0-9]{1,5}$', '20'),
  ('agent.member_daily_limit', '100', 'GLOBAL', '회원 하루 AI 상담 횟수', '^[0-9]{1,5}$', '100'),
  ('agent.review_model', 'claude-sonnet-5-5', 'GLOBAL', 'AI 검수 보조 모델(agent_model_prices 에 있는 것)', '^claude-[a-z0-9-]+$', 'claude-sonnet-5-5'),
  ('agent.chat_model', 'claude-haiku-5-5', 'GLOBAL', 'AI 고객응대 모델(agent_model_prices 에 있는 것)', '^claude-[a-z0-9-]+$', 'claude-haiku-5-5')
ON CONFLICT (key) DO NOTHING;

-- 이번 달(한국 시각) 비용
CREATE OR REPLACE FUNCTION public.fn_agent_month_cost() RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM public.agent_usage_daily
   WHERE day >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date
$$;

-- 이 통로로 지금 불러도 되는가 — 스위치 · 월 상한
CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled' END;
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;

-- 사용량 · 비용 쌓기 — 상한에 닿으면 전체 끄고 운영 경보
CREATE OR REPLACE FUNCTION public.fn_agent_record_usage(p_channel text, p_model text, p_in int, p_out int, p_cache int DEFAULT 0)
  RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE pr public.agent_model_prices; v_cost numeric; v_cap numeric; v_month numeric;
BEGIN
  SELECT * INTO pr FROM public.agent_model_prices WHERE model = p_model;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT: 요금표에 없는 모델입니다 (%)', p_model; END IF;
  IF least(coalesce(p_in,0), coalesce(p_out,0), coalesce(p_cache,0)) < 0 THEN RAISE EXCEPTION 'AGENT: 토큰 수는 0 이상'; END IF;
  v_cost := (coalesce(p_in,0) * pr.input_per_m + coalesce(p_out,0) * pr.output_per_m + coalesce(p_cache,0) * pr.cache_read_per_m) / 1000000.0;
  INSERT INTO public.agent_usage_daily (day, channel, model, requests, input_tokens, output_tokens, cache_read_tokens, cost_usd)
  VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, p_channel, p_model, 1, coalesce(p_in,0), coalesce(p_out,0), coalesce(p_cache,0), v_cost)
  ON CONFLICT (day, channel, model) DO UPDATE SET
    requests = agent_usage_daily.requests + 1,
    input_tokens = agent_usage_daily.input_tokens + EXCLUDED.input_tokens,
    output_tokens = agent_usage_daily.output_tokens + EXCLUDED.output_tokens,
    cache_read_tokens = agent_usage_daily.cache_read_tokens + EXCLUDED.cache_read_tokens,
    cost_usd = agent_usage_daily.cost_usd + EXCLUDED.cost_usd;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  v_month := public.fn_agent_month_cost();
  IF v_cap > 0 AND v_month >= v_cap
     AND (SELECT value FROM site_settings WHERE key = 'agent.enabled') = 'on' THEN
    UPDATE public.site_settings SET value = 'off', updated_at = now() WHERE key = 'agent.enabled';
    INSERT INTO public.ops_alerts (alert_code, severity, title, detail)
    VALUES ('AGENT_CAP_REACHED', 'CRITICAL', format('AI 월 상한 %s달러에 닿아 AI 에이전트를 껐습니다', v_cap),
            jsonb_build_object('cap', v_cap, 'month_cost', round(v_month, 4)))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_cost;
END $$;

-- AI 검수 의견 ↔ 사람 결정 일치(최근 14일)
CREATE OR REPLACE VIEW public.v_ai_review_agreement AS
 SELECT o.model,
        count(*) FILTER (WHERE r.status IN ('APPROVED','REJECTED')) AS decided,
        count(*) FILTER (WHERE (o.suggestion = 'APPROVE' AND r.status = 'APPROVED') OR (o.suggestion = 'REJECT' AND r.status = 'REJECTED')) AS agreed,
        count(*) FILTER (WHERE o.suggestion = 'UNSURE') AS unsure,
        round(100.0 * count(*) FILTER (WHERE (o.suggestion = 'APPROVE' AND r.status = 'APPROVED') OR (o.suggestion = 'REJECT' AND r.status = 'REJECTED'))
              / nullif(count(*) FILTER (WHERE r.status IN ('APPROVED','REJECTED') AND o.suggestion <> 'UNSURE'), 0), 1) AS agree_pct
   FROM public.ai_review_opinions o JOIN public.review_items r ON r.id = o.review_item_id
  WHERE o.created_at > now() - interval '14 days'
  GROUP BY o.model;

COMMENT ON TABLE public.ai_review_opinions IS 'AI 검수 의견(병행) — 저장만 합니다. 검수 상태는 사람만 바꿉니다(ai-agent #7 · D116).';
COMMENT ON TABLE public.agent_model_prices IS 'AI 모델 요금(100만 토큰당 달러) — 2026-10-06 공개 요금 사본 · 계약 전 확인 · 비용 집계에 씀.';
COMMENT ON FUNCTION public.fn_agent_allowed(text) IS '스위치 · 월 상한을 보고 지금 불러도 되는지(ok · reason). 상한 0 이면 CAP_ZERO.';

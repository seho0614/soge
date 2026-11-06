-- =====================================================================
-- D181 (v10.204 · docs/326) — AI 가동 지켜보기 · AI 상한 80% 경고
--
--   처리방침(국외 이전 조항) 게시로 AI 잠금이 처음 풀림(11/11 예정). 지금은 월 상한 100% 에 닿아 AI 가 꺼진 뒤에야 알림이 옴.
--
--   ① 설정 agent.cap_warn_pct(80) — 이번 달 AI 비용이 상한의 이 % 에 닿으면 운영 알림 AGENT_CAP_NEAR(WARN · 그달 한 번)
--   ② fn_agent_record_usage — ① 을 더함(나머지 · 100% 에서 끄기는 D116 그대로)
--   ③ fn_agent_watch_state() — AI 잠금이 풀렸나 · 「AI 사용 가능해짐」 남겼나 · 3일 안 시행 예정 처리방침(국외 이전 조항) · 그 판 「준비 덜 됨」 남겼나 ·
--      월 상한 · 스위치(정기 작업 launch_watch 가 읽고 AI 키를 더해 판단 — 서버 코드)
--   ④ fn_ops_alert_mail_pending · fn_ops_alert_push_pending — 급한 알림 대상에 AGENT_LIVE · AGENT_READY_GAP · AGENT_CAP_NEAR
--      (AI 사용 가능해짐 · AI 준비 덜 됨 은 정기 작업 launch_watch 가 남김 — 서버 코드)
--
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

-- ① 설정 -------------------------------------------------------------------
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES
  ('agent.cap_warn_pct', '80', 'GLOBAL',
   'AI 월 상한 미리 알림(v10.204 · docs/326) — 이번 달 AI 비용이 월 상한(agent.monthly_cap_usd)의 이 % 에 닿으면 운영 알림 AGENT_CAP_NEAR(경고 · 급한 알림 메일 · 텔레그램 대상 · 그달 한 번). 1 ~ 99.',
   false, '^([1-9]|[1-9][0-9])$', '80')
ON CONFLICT (key) DO NOTHING;

-- ② 사용량 · 비용 쌓기 — 상한 % 에 닿으면 경고(그달 한 번) · 상한에 닿으면 전체 끄고 운영 경보(D116 그대로) ----
CREATE OR REPLACE FUNCTION public.fn_agent_record_usage(p_channel text, p_model text, p_in int, p_out int, p_cache int DEFAULT 0)
  RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE pr public.agent_model_prices; v_cost numeric; v_cap numeric; v_month numeric; v_warn numeric; v_ym text;
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
  /* D181 — 상한의 agent.cap_warn_pct % (기본 80) · 그달(한국 날짜) 한 번 */
  v_warn := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.cap_warn_pct'), '')::numeric, 80);
  v_ym := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM');
  IF v_cap > 0 AND v_month >= v_cap * v_warn / 100 AND v_month < v_cap
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts WHERE alert_code = 'AGENT_CAP_NEAR' AND detail->>'month' = v_ym) THEN
    INSERT INTO public.ops_alerts (alert_code, severity, raised_at, title, detail)
    VALUES ('AGENT_CAP_NEAR', 'WARN', clock_timestamp(),
            format('AI 이번 달 비용이 월 상한의 %s%%에 닿았습니다 — %s달러 / 상한 %s달러 · 상한에 닿으면 AI 가 저절로 꺼집니다(운영 화면 › AI 에이전트에서 상한 확인)',
                   floor(100 * v_month / v_cap), round(v_month, 2), v_cap),
            jsonb_build_object('month', v_ym, 'cap', v_cap, 'month_cost', round(v_month, 4), 'warn_pct', v_warn));
  END IF;
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

-- ③ AI 가동 지켜보기 상태 ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agent_watch_state()
RETURNS TABLE (unlocked boolean, privacy_ver text, live_sent boolean, upcoming_ver text, upcoming_day text, gap_sent boolean,
               cap text, enabled boolean, review boolean, chat boolean)
    LANGUAGE sql STABLE AS $$
  WITH up AS (
    SELECT u.version, to_char(u.effective_from AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day
      FROM public.v_terms_upcoming u
     WHERE u.code = 'PRIVACY' AND u.effective_from <= now() + interval '3 days'
       AND u.body ~ '(^|\n)#{1,4}[^\n]*국외 이전'
     ORDER BY u.effective_from LIMIT 1)
  SELECT public.fn_privacy_ai_ready(),
         (SELECT version FROM public.v_terms_current WHERE code = 'PRIVACY'),
         EXISTS (SELECT 1 FROM public.ops_alerts WHERE alert_code = 'AGENT_LIVE'),
         (SELECT version FROM up), (SELECT day FROM up),
         EXISTS (SELECT 1 FROM public.ops_alerts o, up WHERE o.alert_code = 'AGENT_READY_GAP' AND o.detail->>'version' = up.version),
         coalesce(nullif((SELECT value FROM public.site_settings WHERE key = 'agent.monthly_cap_usd'), ''), '0'),
         coalesce((SELECT value FROM public.site_settings WHERE key = 'agent.enabled'), 'off') = 'on',
         coalesce((SELECT value FROM public.site_settings WHERE key = 'agent.review_shadow.enabled'), 'off') = 'on',
         coalesce((SELECT value FROM public.site_settings WHERE key = 'agent.chat.enabled'), 'off') = 'on'
$$;
COMMENT ON FUNCTION public.fn_agent_watch_state() IS 'AI 가동 지켜보기(D181 · v10.204) — 잠금 풀림(fn_privacy_ai_ready) · AGENT_LIVE 남김 · 3일 안 시행 예정 처리방침(국외 이전 조항) · 그 판 AGENT_READY_GAP 남김 · 상한 · 스위치. 키는 서버가 더함.';

-- ④ 급한 알림 대상에 AI 알림 3종 ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.mailed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.mailed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_mail_pending() IS '메일로 보낼 급한 운영 알림(D175 · D176 · D177 · D179 · D181 · CRITICAL · SETTING_CHANGED · 백업 실패 · 주문 받기 저절로 꺼짐 · 운영자 낯선 로그인 · AI 사용 가능해짐 · AI 준비 덜 됨 · AI 상한 % · 풀린 것 빼고 · 24시간 안 · 종류마다 1시간에 1통).';

CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()
RETURNS TABLE (id bigint, alert_code text, severity text, title text, raised_at timestamptz)
    LANGUAGE sql STABLE AS $$
  SELECT o.id, o.alert_code, o.severity, o.title, o.raised_at
    FROM public.ops_alerts o
   WHERE o.pushed_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL
     AND o.raised_at > now() - interval '24 hours'
     AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
                                                      'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR'))
     AND NOT EXISTS (SELECT 1 FROM public.ops_alerts m
                      WHERE m.alert_code = o.alert_code AND m.pushed_at > now() - interval '1 hour')
   ORDER BY o.id
   LIMIT 50
$$;
COMMENT ON FUNCTION public.fn_ops_alert_push_pending() IS '텔레그램으로 보낼 급한 운영 알림(D178 · D179 · D181 · 메일 fn_ops_alert_mail_pending 과 같은 기준 · 칸은 pushed_at).';

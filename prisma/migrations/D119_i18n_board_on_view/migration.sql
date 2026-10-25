-- =====================================================================
-- D119 — v10.105 다국어 3-3 소개광장 글 · 댓글 볼 때 번역 (2026-10-25 · docs/148 §3-3 · docs/163)
--
--   대표 결정(2026-10-25 3-3 계획 「승인」 — 누를 때만 번역 · 하루 회원 30 · 비회원 10 · 금칙어에 걸린 칸은 원문)
--
--   ① AI 통로에 게시판(BOARD) — fn_agent_allowed 가 스위치 i18n.board_on_view(D115 · 꺼짐) · AI 전체 · 월 상한을 봄(사용량은 따로 보이게)
--   ② 하루 횟수 board_translate_usage(날 · 사람) — fn_board_translate_take 가 한도 안이면 1 올리고 true(한 번에 · 동시에 눌러도 넘지 않음)
--   ③ 횟수 설정 i18n.board_daily_member(30) · i18n.board_daily_guest(10) · 비회원 전체 i18n.board_daily_guest_total(300 · 방문자 키를 바꿔 가며 쓰는 것을 막음)
--   ④ 실패하면 되돌리는 fn_board_translate_give
--
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE','BOARD'));

CREATE TABLE IF NOT EXISTS public.board_translate_usage (
  day   date NOT NULL,
  who   text NOT NULL CHECK (who ~ '^(A|V):[A-Za-z0-9-]{8,64}$' OR who = 'G:ALL'),   -- A:회원 id · V:방문자 키 · G:ALL 비회원 전체
  n     int NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, who)
);

-- 하루 한도 안이면 1 올리고 true — 넘으면 false(올리지 않음)
CREATE OR REPLACE FUNCTION public.fn_board_translate_take(p_who text, p_limit int) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN RETURN false; END IF;
  INSERT INTO public.board_translate_usage (day, who, n) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, p_who, 1)
  ON CONFLICT (day, who) DO UPDATE SET n = board_translate_usage.n + 1 WHERE board_translate_usage.n < p_limit
  RETURNING n INTO v;
  RETURN v IS NOT NULL;
END $$;

-- 실패하면 되돌림(0 아래로는 내려가지 않음)
CREATE OR REPLACE FUNCTION public.fn_board_translate_give(p_who text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.board_translate_usage SET n = greatest(n - 1, 0)
   WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND who = p_who
$$;

-- 이 통로로 지금 불러도 되는가 — 스위치 · 월 상한 (D116 + TRANSLATE(D118) + BOARD)
CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled'
                         WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled'   -- D118 번역
                         WHEN 'BOARD' THEN 'i18n.board_on_view' END;   -- D119 게시판 볼 때 번역
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;



INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('i18n.board_daily_member', '30', 'GLOBAL', '소개광장 볼 때 번역 — 회원 하루 횟수(3-3 · docs/163)', '^[0-9]{1,4}$', '30'),
  ('i18n.board_daily_guest', '10', 'GLOBAL', '소개광장 볼 때 번역 — 비회원(방문자) 하루 횟수', '^[0-9]{1,4}$', '10'),
  ('i18n.board_daily_guest_total', '300', 'GLOBAL', '소개광장 볼 때 번역 — 비회원 모두 합쳐 하루 횟수(넘으면 비회원은 다음 날까지 못 씀 · AI 전체 월 상한을 지킴)', '^[0-9]{1,5}$', '300')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.board_translate_usage IS '소개광장 볼 때 번역 하루 횟수(D119 · docs/163) — 회원은 A:id · 비회원은 V:방문자 키.';

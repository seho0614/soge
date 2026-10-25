-- =====================================================================
-- D121 — v10.109 AI 에이전트 2단계 고객응대 ① 안내 — 서버 (2026-10-25 · docs/149 §3-5 · docs/170)
--
--   대표 결정(2026-10-25 「1」 → 계획 · 법무 회신: 국외 이전 고지 함 · AI 고지 함 · **대화 보관 5년**)
--
--   ① 하루 횟수 agent_chat_usage(날 · 사람) — fn_agent_chat_take 가 한도 안이면 1 올리고 true(동시에 보내도 넘지 않음) · 실패하면 fn_agent_chat_give
--   ② 횟수 설정 — 회원 agent.member_daily_limit(D116 · 손대지 않았으면 100 → 30) · 비회원 agent.guest_daily_limit(D116 · 20) · **비회원 전체 agent.guest_daily_total(300 · 새로)**
--      · **비회원 접속 IP 하나 agent.guest_daily_per_ip(60 · 새로)** — 쿠키를 지워 가며 방문자 키를 새로 받아도 한 사람이 비회원 전체를 다 쓰지 못하게(IP 는 해시로만 남김)
--   ③ 대화 보관 agent.chat_retention_days(1825 = 5년) — 대화를 만들 때 purge_after 에 씀 · 표의 기본값도 5년으로
--   ④ 배치 agent_chat_purge(매일 04:20) — 보관 기간이 지난 대화 · 메시지를 지움(메시지는 대화와 함께 · ON DELETE CASCADE) · 오래된 하루 횟수 줄도
--   ⑤ 스위치 agent.chat.enabled(D116 · 꺼짐) · 통로 SITE_CHAT(D116 fn_agent_allowed) 그대로 — 켜기 전에는 아무것도 부르지 않음
--
--   자료를 지우지 않습니다(이 마이그레이션 자체는). 재실행 안전.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.agent_chat_usage (
  day   date NOT NULL,
  who   text NOT NULL CHECK (who ~ '^(A|V):[A-Za-z0-9-]{8,64}$' OR who ~ '^I:[0-9a-f]{16}$' OR who = 'G:ALL'),   -- A:회원 id · V:방문자 키 · I:접속 IP 해시 · G:ALL 비회원 전체
  n     int NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, who)
);

-- 하루 한도 안이면 1 올리고 true — 넘으면 false(올리지 않음)
CREATE OR REPLACE FUNCTION public.fn_agent_chat_take(p_who text, p_limit int) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN RETURN false; END IF;
  INSERT INTO public.agent_chat_usage (day, who, n) VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, p_who, 1)
  ON CONFLICT (day, who) DO UPDATE SET n = agent_chat_usage.n + 1 WHERE agent_chat_usage.n < p_limit
  RETURNING n INTO v;
  RETURN v IS NOT NULL;
END $$;

-- 실패하면 되돌림(0 아래로는 내려가지 않음)
CREATE OR REPLACE FUNCTION public.fn_agent_chat_give(p_who text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.agent_chat_usage SET n = greatest(n - 1, 0)
   WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND who = p_who
$$;

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('agent.guest_daily_total', '300', 'GLOBAL', '비회원 모두 합쳐 하루 AI 상담 횟수(넘으면 비회원은 다음 날까지 · 방문자 키를 바꿔 가며 쓰는 것을 막음 · docs/170)', '^[0-9]{1,5}$', '300'),
  ('agent.guest_daily_per_ip', '60', 'GLOBAL', '비회원 접속 IP 하나의 하루 AI 상담 횟수(사무실처럼 한 IP 를 여럿이 쓰는 곳을 생각해 방문자 한도보다 넉넉히 · docs/170)', '^[0-9]{1,5}$', '60'),
  ('agent.chat_retention_days', '1825', 'GLOBAL', 'AI 상담 대화 보관 일수 — 1825 = 5년(2026-10-25 법무 회신 · 대화를 만들 때 정해짐 · 처리방침과 같아야 함)', '^[0-9]{1,5}$', '1825')
ON CONFLICT (key) DO NOTHING;
-- 회원 하루 횟수 — D116 기본값(100)을 그대로 두었을 때만 계획값 30 으로(운영자가 바꾼 값은 건드리지 않음)
UPDATE public.site_settings SET value = '30', value_example = '30' WHERE key = 'agent.member_daily_limit' AND value = '100';

ALTER TABLE public.agent_conversations ALTER COLUMN purge_after SET DEFAULT now() + interval '1825 days';

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('agent_chat_purge', 1440, 4, 20, NULL, true,
        'AI 상담 대화 정리 — 보관 기간(agent.chat_retention_days · 5년)이 지난 대화 · 메시지와 90일 지난 하루 횟수 줄을 지움')
ON CONFLICT (job) DO NOTHING;

COMMENT ON TABLE public.agent_chat_usage IS 'AI 상담(고객응대 안내) 하루 횟수(D121 · docs/170) — 회원은 A:id · 비회원은 V:방문자 키 · I:접속 IP 해시 · G:ALL 비회원 전체.';

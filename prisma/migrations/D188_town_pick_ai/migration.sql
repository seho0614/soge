-- =====================================================================
-- D188 — 동네픽 AI 큐레이션(꺼진 채) (v10.211 · 2026-11-07)
--
--   대표 「동네픽 AI 큐레이션」 · 자료는 「회원 글 + 맛집」 · 보일 곳 A(소개광장 맨 위)(11/7 「승인」 · community 미정 1).
--
--   ① town_pick_candidates — 하루 한 번 시군구별로 최근 회원 글(후기 · 질문) · 맛집 글 가운데 AI 가 고른 후보와 한 줄 소개.
--      운영자가 승인(고쳐서 승인 가능)한 것만 공개 · 거절은 사유. 같은 글은 한 번만 후보. 지우지 않음.
--   ② v_town_picks_public — 승인 · 원글이 아직 공개 · 30일 안 — 소개광장 맨 위 「동네픽」 줄.
--   ③ AI 통로 TOWN_PICK — 스위치 agent.town_pick.enabled(처음 off) · AI 전체(agent.enabled) · 월 상한 안에서만.
--   ④ 매일 06:00(한국) 작업 town_pick_daily — 꺼져 있으면 아무것도 부르지 않음.
--   재실행 안전. 표 · 자료를 지우는 문장 없음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.town_pick_candidates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES public.posts(id),
  source       text NOT NULL CHECK (source IN ('PLAZA', 'FOOD')),
  region       text NOT NULL CHECK (length(region) BETWEEN 2 AND 60),
  headline     text NOT NULL CHECK (length(headline) BETWEEN 2 AND 60),
  summary      text NOT NULL CHECK (length(summary) BETWEEN 2 AND 300),
  engine       text NOT NULL CHECK (engine IN ('CLAUDE', 'MOCK', 'N8N')),
  model        text,
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid,
  reject_note  text CHECK (reject_note IS NULL OR length(reject_note) <= 300),
  CONSTRAINT ux_town_pick_post UNIQUE (post_id)
);
CREATE INDEX IF NOT EXISTS ix_town_pick_state ON public.town_pick_candidates (state, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_town_pick_region ON public.town_pick_candidates (region, decided_at DESC) WHERE state = 'APPROVED';
COMMENT ON TABLE public.town_pick_candidates IS
  '동네픽 AI 후보(D188) — AI 가 고르고 운영자가 승인한 것만 공개. 같은 글은 한 번. 지우지 않음 · 대기 → 승인 / 거절 한 번';

CREATE OR REPLACE FUNCTION public.fn_town_pick_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'TOWNPICK: 동네픽 후보 기록은 지울 수 없습니다.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING' THEN RAISE EXCEPTION 'TOWNPICK: 동네픽 후보는 대기로 시작합니다.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.post_id <> OLD.post_id OR NEW.engine <> OLD.engine OR NEW.source <> OLD.source OR NEW.region <> OLD.region THEN
    RAISE EXCEPTION 'TOWNPICK: 동네픽 후보의 원글 · 지역은 바꿀 수 없습니다.';
  END IF;
  IF OLD.state <> 'PENDING' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.headline IS DISTINCT FROM OLD.headline OR NEW.summary IS DISTINCT FROM OLD.summary) THEN
    RAISE EXCEPTION 'TOWNPICK: 이미 처리한 동네픽 후보입니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_town_pick_guard ON public.town_pick_candidates;
CREATE TRIGGER trg_town_pick_guard BEFORE INSERT OR UPDATE OR DELETE ON public.town_pick_candidates
  FOR EACH ROW EXECUTE FUNCTION public.fn_town_pick_guard();

CREATE OR REPLACE VIEW public.v_town_picks_public AS
  SELECT c.id, c.post_id, c.source, c.region, c.headline, c.summary, c.decided_at, p.board, p.title AS post_title
    FROM public.town_pick_candidates c
    JOIN public.posts p ON p.id = c.post_id
   WHERE c.state = 'APPROVED' AND p.state = 'PUBLISHED' AND c.decided_at > now() - interval '30 days';
COMMENT ON VIEW public.v_town_picks_public IS '공개 동네픽(D188) — 승인 · 원글 공개 중 · 30일 안';

-- AI 통로 TOWN_PICK (D119 위에 한 줄 더함)
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE','BOARD','TOWN_PICK'));

CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled'
                         WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled'   -- D118 번역
                         WHEN 'BOARD' THEN 'i18n.board_on_view'   -- D119 게시판 볼 때 번역
                         WHEN 'TOWN_PICK' THEN 'agent.town_pick.enabled' END;   -- D188 동네픽 AI
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;

INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, value_pattern, value_example)
VALUES ('agent.town_pick.enabled', 'off', 'GLOBAL',
        '동네픽 AI 큐레이션(v10.211 · D188 · docs/336) — on 이면 매일 06:00 시군구별로 최근 회원 글 · 맛집 글에서 AI 가 후보를 고름(운영자가 승인한 것만 공개). AI 전체 스위치 · 월 상한 안에서만.',
        false, '^(on|off)$', 'off'),
       ('agent.town_pick.regions_daily', '10', 'GLOBAL',
        '동네픽 AI 하루에 볼 시군구 수(v10.211 · D188) — 최근 글이 많은 곳부터. 0 이면 고르지 않음.',
        false, '^([0-9]|[1-4][0-9]|50)$', '10')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('town_pick_daily', 1440, 6, 0, NULL, true,
        '동네픽 AI 후보(D188) — 매일 06:00 시군구별 최근 회원 글 · 맛집 글에서 AI 가 후보를 고름(승인 전 비공개) · 스위치 · 월 상한이 막으면 아무것도 하지 않음')
ON CONFLICT (job) DO NOTHING;

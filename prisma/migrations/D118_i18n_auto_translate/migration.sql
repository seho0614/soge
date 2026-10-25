-- =====================================================================
-- D118 — v10.104 다국어 3-2 등록 글 자동 번역 (2026-10-25 · docs/148 §3-3 · docs/162)
--
--   대표 결정(2026-10-25 3-2 계획 「승인」 — 월 상한은 AI 전체 하나(agent.monthly_cap_usd) · 모델 Haiku 5.5 · 번역문 금칙어면 사람 승인 대기)
--
--   ① 번역 작업 줄 translation_jobs — 매물 · 요청(LISTING · REQUEST) × 언어 한 줄 · 대기 → 처리 중 → 끝 / 보류 / 실패
--   ② 넣는 때(DB 트리거) — 손님에게 보이게 될 때(PUBLISHED) · 보이는 동안 제목 · 본문이 고쳐질 때. 자동 번역 스위치가 꺼져 있으면 넣지 않음
--   ③ AI 통로에 번역(TRANSLATE) — fn_agent_allowed 가 스위치 i18n.auto_translate.enabled · AI 전체 스위치 · 월 상한을 봄(D116 그대로 · 상한에 닿으면 DB 가 AI 전체를 끔)
--   ④ 번역 줄 엔진에 MOCK(점검판 시험 엔진) — 밖으로 나가지 않는 시험 번역을 그대로 표시
--   ⑤ 스위치 i18n.auto_translate.enabled(off) · i18n.auto_langs(en) · i18n.translate_model(claude-haiku-5-5) · 배치 translate_jobs(1분)
--
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
ALTER TABLE public.agent_usage_daily DROP CONSTRAINT IF EXISTS agent_usage_daily_channel_check;
ALTER TABLE public.agent_usage_daily ADD CONSTRAINT agent_usage_daily_channel_check
  CHECK (channel IN ('SITE_CHAT','REVIEW_SHADOW','AUDIT','SETTLE','TRANSLATE'));

ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_engine_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_engine_check
  CHECK (engine IN ('MANUAL','CLAUDE','N8N','MOCK'));

CREATE TABLE IF NOT EXISTS public.translation_jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_type  text NOT NULL CHECK (target_type IN ('LISTING','REQUEST')),
  target_id    text NOT NULL,
  lang         text NOT NULL REFERENCES public.i18n_langs(code) CHECK (lang <> 'ko'),
  state        text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','DONE','HELD','FAILED')),
  attempts     int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text,
  result       text,                 -- AUTO_APPROVED · DRAFT(금칙어 — 사람 승인 대기) · SKIPPED(사람이 승인한 번역이 있음)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, lang)
);
CREATE INDEX IF NOT EXISTS idx_translation_jobs_queue ON public.translation_jobs (state, updated_at) WHERE state IN ('QUEUED','RUNNING');

-- 작업 넣기(같은 글 · 언어는 한 줄 — 다시 넣으면 대기로 되돌림 · 시도 횟수 0)
CREATE OR REPLACE FUNCTION public.fn_translation_enqueue(p_type text, p_id text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_langs text[]; n int := 0;
BEGIN
  IF coalesce((SELECT value FROM site_settings WHERE key = 'i18n.auto_translate.enabled'), 'off') <> 'on' THEN RETURN 0; END IF;
  v_langs := string_to_array(replace(coalesce((SELECT value FROM site_settings WHERE key = 'i18n.auto_langs'), 'en'), ' ', ''), ',');
  INSERT INTO public.translation_jobs (target_type, target_id, lang)
  SELECT p_type, p_id, l.code FROM public.i18n_langs l WHERE l.code = ANY(v_langs) AND l.code <> 'ko'
  ON CONFLICT (target_type, target_id, lang) DO UPDATE
    SET state = 'QUEUED', attempts = 0, last_error = NULL, result = NULL, updated_at = now()
    WHERE translation_jobs.state <> 'RUNNING';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.fn_translation_enqueue_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PUBLISHED'
       OR OLD.title IS DISTINCT FROM NEW.title OR OLD.body IS DISTINCT FROM NEW.body) THEN
    PERFORM public.fn_translation_enqueue(TG_ARGV[0], NEW.id::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_listing_translation_enqueue ON public.listings;
CREATE TRIGGER trg_listing_translation_enqueue AFTER INSERT OR UPDATE OF status, title, body ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.fn_translation_enqueue_trg('LISTING');
DROP TRIGGER IF EXISTS trg_request_translation_enqueue ON public.requests;
CREATE TRIGGER trg_request_translation_enqueue AFTER INSERT OR UPDATE OF status, title, body ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_translation_enqueue_trg('REQUEST');

-- 이 통로로 지금 불러도 되는가 — 스위치 · 월 상한 (D116 + TRANSLATE)
CREATE OR REPLACE FUNCTION public.fn_agent_allowed(p_channel text, OUT ok boolean, OUT reason text)
  LANGUAGE plpgsql STABLE AS $$
DECLARE v_cap numeric; v_sw text;
BEGIN
  ok := false;
  IF coalesce((SELECT value FROM site_settings WHERE key = 'agent.enabled'), 'off') <> 'on' THEN reason := 'AGENT_OFF'; RETURN; END IF;
  v_sw := CASE p_channel WHEN 'REVIEW_SHADOW' THEN 'agent.review_shadow.enabled' WHEN 'SITE_CHAT' THEN 'agent.chat.enabled'
                         WHEN 'TRANSLATE' THEN 'i18n.auto_translate.enabled' END;   -- D118 번역
  IF v_sw IS NULL THEN reason := 'CHANNEL_NOT_READY'; RETURN; END IF;
  IF coalesce((SELECT value FROM site_settings WHERE key = v_sw), 'off') <> 'on' THEN reason := 'CHANNEL_OFF'; RETURN; END IF;
  v_cap := coalesce(nullif((SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'), '')::numeric, 0);
  IF v_cap <= 0 THEN reason := 'CAP_ZERO'; RETURN; END IF;
  IF public.fn_agent_month_cost() >= v_cap THEN reason := 'CAP_REACHED'; RETURN; END IF;
  ok := true; reason := NULL;
END $$;


INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('i18n.auto_translate.enabled', 'off', 'GLOBAL', '등록 글(매물 · 요청) 자동 번역(3-2 · docs/162) — 켜려면 AI 전체(agent.enabled) · 월 상한(agent.monthly_cap_usd)도', '^(on|off)$', 'off'),
  ('i18n.auto_langs', 'en', 'GLOBAL', '자동 번역할 언어(쉼표로 · 켜진 언어만 손님에게 보임)', '^[a-z]{2}(,[a-z]{2})*$', 'en'),
  ('i18n.translate_model', 'claude-haiku-5-5', 'GLOBAL', '자동 번역 모델(agent_model_prices 에 있는 것)', '^claude-[a-z0-9-]+$', 'claude-haiku-5-5')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('translate_jobs', 1, NULL, NULL, NULL, true,
        '등록 글 자동 번역(3-2) — 대기 줄을 몇 건씩 번역 · 스위치 · 월 상한이 막으면 아무것도 하지 않음')
ON CONFLICT (job) DO NOTHING;

COMMENT ON TABLE public.translation_jobs IS '등록 글 자동 번역 작업 줄(D118 · docs/162) — 매물 · 요청 × 언어 한 줄. 결과 번역은 content_translations(AUTO_APPROVED · 금칙어면 DRAFT).';

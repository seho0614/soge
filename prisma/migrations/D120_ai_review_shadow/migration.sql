-- =====================================================================
-- D120 — v10.106 AI 에이전트 1단계 검수 보조(병행) (2026-10-25 · docs/149 §3-4 · docs/165)
--
--   대표 결정(2026-10-25 「1 2 3 4 5」 → 계획 「승인」 — 모델 Sonnet 5.5 · 꺼진 채 · 켜기 전 외부 AI 위탁 고지 검토)
--
--   ① 배치 review_shadow(5분) — 검수 대기 매물 · 요청에 AI 의견을 ai_review_opinions(D116)에 저장만
--      스위치 agent.review_shadow.enabled · AI 전체 · 월 상한(D116 fn_agent_allowed 그대로)이 막으면 아무것도 하지 않음
--   ② AI 는 검수 상태를 바꾸지 않습니다(ai-agent #7) — 의견 표에 쓰기만 하는 트리거 · 함수는 없습니다(서비스가 INSERT)
--   ③ 의견 표에 엔진 칸(MOCK · CLAUDE)과 들어간 사유 코드 검사(정해진 목록 안)
--
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
ALTER TABLE public.ai_review_opinions ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'CLAUDE';
ALTER TABLE public.ai_review_opinions DROP CONSTRAINT IF EXISTS ai_review_opinions_engine_check;
ALTER TABLE public.ai_review_opinions ADD CONSTRAINT ai_review_opinions_engine_check CHECK (engine IN ('CLAUDE','MOCK','N8N'));
CREATE INDEX IF NOT EXISTS idx_ai_review_opinions_item ON public.ai_review_opinions (review_item_id, created_at DESC);

INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description)
VALUES ('review_shadow', 5, NULL, NULL, NULL, true,
        'AI 검수 보조(병행 · 1단계) — 검수 대기 매물 · 요청에 AI 의견을 저장만(검수 상태는 바꾸지 않음) · 스위치 · 월 상한이 막으면 아무것도 하지 않음')
ON CONFLICT (job) DO NOTHING;

COMMENT ON COLUMN public.ai_review_opinions.engine IS 'AI 의견을 만든 엔진(CLAUDE · 점검판 시험 MOCK) · D120';

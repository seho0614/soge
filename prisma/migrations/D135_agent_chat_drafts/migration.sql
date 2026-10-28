-- =====================================================================
-- D135 — v10.139 (2026-10-28 · AI 상담 4단계 신청서 초안 · docs/209 · 설계 docs/208)
--
--   ① agent_drafts — AI 상담이 만든 신청서 초안(1:1 문의 · 건강몰 취소 · 반품 · 교환). **초안만** — 접수는 회원이 신청 화면에서 직접.
--      7일 뒤(expires_at) 배치 agent_chat_purge 가 초안 내용(fields)을 비움 · 숫자(만듦 · 열어 봄 · 제출)는 대화와 함께 지워짐(5년).
--   ② agent_tool_calls.tool 에 초안 도구 2개(draft_inquiry · draft_return)를 더함(조회 기록과 같이 값 없이 칸 이름만).
--   ③ 스위치 agent.chat.drafts.enabled — 꺼짐. 3단계 「내 정보 조회」가 켜져 있어야 동작.
--   재실행 안전 · 자료를 지우지 않음.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.agent_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('INQUIRY','HLT_RETURN')),
  fields          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  submitted_at    timestamptz,
  submitted_ref   text,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX IF NOT EXISTS agent_drafts_conv_idx ON public.agent_drafts (conversation_id);
CREATE INDEX IF NOT EXISTS agent_drafts_account_idx ON public.agent_drafts (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_drafts_created_idx ON public.agent_drafts (created_at);
COMMENT ON TABLE public.agent_drafts IS 'v10.139 AI 상담 4단계 — 신청서 초안(접수는 회원이 화면에서 · 7일 뒤 내용 비움 · 대화와 함께 지워짐)';

ALTER TABLE public.agent_tool_calls DROP CONSTRAINT IF EXISTS agent_tool_calls_tool_check;
ALTER TABLE public.agent_tool_calls ADD CONSTRAINT agent_tool_calls_tool_check
  CHECK (tool IN ('my_orders','my_returns','my_reviews','my_inquiries','my_subscription','draft_inquiry','draft_return'));

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('agent.chat.drafts.enabled', 'off', 'GLOBAL', 'AI 고객응대 신청서 초안(4단계 · 초안만 · 접수는 회원이 화면에서) — 내 정보 조회가 켜져 있어야 동작', '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

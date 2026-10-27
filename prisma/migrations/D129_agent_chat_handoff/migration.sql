-- =====================================================================
-- D129 — v10.131 (2026-10-27 · AI 상담 「답 · 넘김 비율」 · docs/197)
--
--   대표 「2 결정 항목 추천대로」(결정 기록 ai-agent #20 ①) — AI 상담 1주 운영 결과를 숫자로 보려면
--   AI 답마다 「담당자에게 넘기기를 권했는지」가 있어야 함. 지금은 거절 · 잘림 · 모양 틀림 · 금칙어(stop_reason)만 남고
--   AI 가 스스로 넘기기를 권한 것은 남지 않음 → agent_messages 에 칸 하나.
--
--   handoff  AI 답(assistant)이 담당자에게 넘기기를 권했나 — 이 판부터 채움 · 전의 줄은 비어 있음(NULL = 기록 전)
--   자료를 지우지 않습니다 · 칸 하나 더함 · 재실행 안전.
-- =====================================================================
ALTER TABLE public.agent_messages ADD COLUMN IF NOT EXISTS handoff boolean;
COMMENT ON COLUMN public.agent_messages.handoff IS
  'v10.131 — AI 답(assistant)이 담당자에게 넘기기를 권했나(정해진 문장 · 거절 · 잘림 포함). NULL = 이 칸이 생기기 전 답 · 손님 질문(user) 줄은 늘 NULL';

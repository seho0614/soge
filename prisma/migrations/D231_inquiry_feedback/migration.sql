-- v10.341 (docs/474) — 1:1 문의 답변 만족도(「해결됨 / 아직 해결 안 됨」) · 「아직」이면 다시 열림
--   대표 11/17 「다음개발」 → ② 답변 만족도 · 「승인 + 통과하면 병합」. 지우는 문장 없음 · 다시 돌려도 같음.
ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS feedback text CHECK (feedback IS NULL OR feedback IN ('RESOLVED', 'UNRESOLVED'));
ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS feedback_at timestamptz;
ALTER TABLE public.inquiries ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0);
COMMENT ON COLUMN public.inquiries.feedback IS 'v10.341 (D231) 회원이 답변에 남긴 만족도 — RESOLVED 해결됨 · UNRESOLVED 아직 해결 안 됨(문의가 다시 열림). 운영자가 다시 답하면 비움';
COMMENT ON COLUMN public.inquiries.reopen_count IS 'v10.341 (D231) 회원이 「아직 해결 안 됨」으로 다시 연 횟수';

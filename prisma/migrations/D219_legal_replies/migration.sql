-- =====================================================================
-- D219 (v10.314 · docs/438) — 법무 회신 기록 legal_replies
--   법무 검토 묶음(v10.201 · 부록 v10.311)에 물은 것의 답을 운영 화면 관 관리 › 「약관」 › 「법무 회신」에 적음(SUPER).
--   주제(RATE_NOTICE 요율 인상 공지 방식 · PRIVACY 처리방침 · HLT_SELLER 입점 약관 · OTHER) · 물음 번호 · 답(OK 맞음 · FIX 고쳐야 함 · NOTE 의견만) ·
--   의견 · 확인한 사람 · 답한 날. 쌓기만(고치거나 지울 수 없음 — 다시 적으면 새 줄이 가장 최근 답) · 감사 기록 LEGAL_REPLY.
--   지우는 문장 없음. 재실행 안전.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.legal_replies (
  id          bigserial PRIMARY KEY,
  topic       text NOT NULL CHECK (topic IN ('RATE_NOTICE', 'PRIVACY', 'HLT_SELLER', 'OTHER')),
  q_no        integer NOT NULL CHECK (q_no BETWEEN 1 AND 20),
  answer      text NOT NULL CHECK (answer IN ('OK', 'FIX', 'NOTE')),
  opinion     text CHECK (opinion IS NULL OR length(opinion) <= 2000),
  reviewer    text NOT NULL CHECK (length(btrim(reviewer)) BETWEEN 1 AND 100),
  replied_on  date NOT NULL,
  created_by  uuid REFERENCES public.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.legal_replies IS
  'v10.314 (D219) 법무 회신 — 법무 검토 묶음 물음의 답(주제 · 물음 번호 · 답 · 의견 · 확인한 사람 · 답한 날) · 쌓기만 · 같은 물음은 가장 최근 줄이 지금 답';
CREATE INDEX IF NOT EXISTS idx_legal_replies_topic ON public.legal_replies (topic, q_no, created_at DESC);

DROP TRIGGER IF EXISTS trg_legal_replies_guard ON public.legal_replies;
CREATE TRIGGER trg_legal_replies_guard BEFORE UPDATE OR DELETE ON public.legal_replies
  FOR EACH ROW EXECUTE FUNCTION public.fn_append_only_guard();

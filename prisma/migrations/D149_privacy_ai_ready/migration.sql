-- =====================================================================
-- D149 · AI 켜기 전 처리방침 확인을 「판 번호」 → 「국외 이전 조항이 든 처리방침이 게시됨」으로 (v10.156 · 2026-10-30 · sgb-core docs/237)
--   운영 확인(10/30 · v10.155 적용 뒤): 처리방침은 1.0 이 한 번도 게시되지 않았고, D131 · D132 가 그 1.0 초안 글을
--   AI 고지 · 국외 이전(제6조)이 든 새 글로 바꿔 두었음 → 그 글을 게시해도 판이 1.0 이라 「1.1 이상」 조건(D145)에 걸려 AI 를 켤 수 없음.
--   ① fn_privacy_ai_ready() — 게시된 처리방침 본문에 「국외 이전」이 든 제목 줄(# ~ ####)이 있으면 true.
--      서버 잠금(PRIVACY_FIRST) · AI 켜기 단계 안내판(TERMS) · postcheck 가 같은 판단을 씀(판 번호와 상관없음)
--   ② agent.require_privacy 설명만 고침(값은 그대로)
--   재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_privacy_ai_ready() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.terms
     WHERE code = 'PRIVACY' AND status = 'PUBLISHED'
       AND body ~ '(^|\n)#{1,4}[^\n]*국외 이전')
$$;

COMMENT ON FUNCTION public.fn_privacy_ai_ready() IS 'AI 켜기 조건(D145 · D149) — 게시된 개인정보처리방침에 국외 이전 조항(제목 줄)이 있음. 판 번호는 보지 않음';

UPDATE public.site_settings
   SET description = 'AI 켜기 전 처리방침 확인 — on 이면 국외 이전 조항(AI 고지 · 제6조)이 든 개인정보처리방침이 게시되기 전에는 AI 전체(agent.enabled)를 켤 수 없음(서버가 거절 · 판 번호와 상관없음 · v10.156). off 면 경고만. 최고 관리자가 운영 화면 › AI 에이전트 › AI 스위치에서 바꿈.'
 WHERE key = 'agent.require_privacy';

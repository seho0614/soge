-- =====================================================================
-- D150 · 게시 · 보관된 약관 판의 글을 고치지 못하게 (v10.157 · 2026-10-31 · sgb-core docs/239)
--   게시된 판(PUBLISHED)과 보관된 판(ARCHIVED)은 회원 동의 기록의 근거 — 글이 바뀌면 「무엇에 동의했는지」가 사라짐.
--   전에는 초안 저장 API(PUT /admin/terms/{code})가 같은 판 번호면 ON CONFLICT 로 본문을 덮었고, DB 도 막지 않았음.
--   ① fn_terms_published_lock() — 게시 · 보관 판의 제목 · 본문 · 코드 · 판 번호 · 필수 여부를 바꾸는 UPDATE 를 거절(TERM_LOCKED)
--      게시하는 순간(초안 → 게시)의 〔시행일〕 채우기는 OLD 가 초안이라 그대로 됨 · 상태(게시 → 보관) · 막힌 까닭 · 표시 순서는 바꿀 수 있음
--      DB 를 직접 고쳐야 할 때(법무 지시로 오탈자 정정 등 · 사람이 · 기록을 남김)만 그 거래에서 SET LOCAL sgb.terms_fix = on — API 는 쓰지 않음(D143 sgb.files_move 와 같은 방식)
--   재실행 안전 · 지우는 문장 없음 · 기존 값 바꾸지 않음
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_terms_published_lock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF coalesce(current_setting('sgb.terms_fix', true), '') = 'on' THEN RETURN NEW; END IF;
  IF OLD.status IN ('PUBLISHED', 'ARCHIVED')
     AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title
          OR NEW.code IS DISTINCT FROM OLD.code OR NEW.version IS DISTINCT FROM OLD.version
          OR NEW.is_required IS DISTINCT FROM OLD.is_required) THEN
    RAISE EXCEPTION 'TERM_LOCKED: 게시되었거나 보관된 약관 판(% %)은 고칠 수 없습니다 — 새 판 번호로 저장하십시오', OLD.code, OLD.version;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.fn_terms_published_lock() IS '게시 · 보관된 약관 판의 글 · 판 번호 · 필수 여부는 바꾸지 못함(동의 기록의 근거 · D150 · v10.157)';

DROP TRIGGER IF EXISTS trg_terms_published_lock ON public.terms;
CREATE TRIGGER trg_terms_published_lock BEFORE UPDATE ON public.terms
    FOR EACH ROW EXECUTE FUNCTION public.fn_terms_published_lock();

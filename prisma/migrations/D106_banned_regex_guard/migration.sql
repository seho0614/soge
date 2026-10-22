-- =====================================================================
-- D106 — v10.69 (2026-10-22 · 자동검수 점검 ① 금칙어 정규식 안전장치 · docs/125)
--
--   점검판 DB 에서 확인한 것: 금칙어(banned_words)에 정규식(REGEX) 줄을 넣을 때 문법을 보지 않아
--   `(` 같은 잘못된 줄 하나로 —
--     · 차단(BLOCK) 이면 매물 등록 · 제목/본문 수정 · 요청 저장이 모두 `invalid regular expression` 오류
--     · 주의(WARN) 이면 검수 넣기(review_items · 자동검수 판정)가 같은 오류 → 매물 등록이 멈춤
--
--   ① fn_is_valid_regex — 정규식 문법이 맞는지(틀리면 false · 오류를 내지 않음)
--   ② fn_regex_hit — 맞춤 검사. 문법이 틀린 줄은 「안 걸림」으로 봄(이미 들어 있는 줄 · 트리거를 거치지 않은 줄 대비)
--   ③ fn_check_banned_words — REGEX 맞춤을 ② 로(EXACT · CONTAINS · 관 · 빈 줄 규칙은 그대로)
--   ④ 트리거 trg_banned_words_regex — 켜진 REGEX 줄은 문법이 맞아야 저장(넣기 · 고치기 · 다시 켜기)
--      → 'BANNED_REGEX: …' 로 막음(DbErrorFilter 가 422 · 읽을 수 있는 말로 넘김)
--   ⑤ 이미 들어 있는 잘못된 REGEX 줄은 끔(is_active = false · 지우지 않음) — 알림(NOTICE)으로 개수를 남김
--
--   자료를 지우지 않습니다. 재실행 안전(CREATE OR REPLACE · DROP TRIGGER IF EXISTS).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_is_valid_regex(p_re text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  PERFORM '' ~* p_re;
  RETURN true;
EXCEPTION WHEN invalid_regular_expression THEN
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.fn_regex_hit(p_text text, p_re text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN p_text ~* p_re;
EXCEPTION WHEN invalid_regular_expression THEN
  RETURN false;            -- 잘못된 줄 하나가 등록 전체를 멈추지 않게 — 저장은 ④ 가 막습니다
END $$;

CREATE OR REPLACE FUNCTION public.fn_check_banned_words(p_text text, p_gwan text) RETURNS TABLE(word text, severity text)
    LANGUAGE sql STABLE
    AS $$
  SELECT b.word, b.severity
    FROM banned_words b
   WHERE b.is_active
     AND (b.gwan_code IS NULL OR b.gwan_code = p_gwan)
     AND btrim(b.word) <> ''            -- 빈 규칙은 전건 적중을 만듭니다
     AND CASE b.match_type
           WHEN 'EXACT'    THEN p_text = b.word
           -- lower() + position() : 대소문자 무시 + 문자 그대로 비교
           WHEN 'CONTAINS' THEN position(lower(b.word) in lower(p_text)) > 0
           WHEN 'REGEX'    THEN fn_regex_hit(p_text, b.word)   -- D106 — 전: p_text ~* b.word (잘못된 줄이면 오류)
           ELSE false
         END;
$$;

CREATE OR REPLACE FUNCTION public.fn_banned_word_regex_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_active AND NEW.match_type = 'REGEX' AND NOT fn_is_valid_regex(NEW.word) THEN
    RAISE EXCEPTION 'BANNED_REGEX: 정규식 문법이 맞지 않습니다 — 「%」. 괄호 · 대괄호 짝을 확인하거나 「포함(CONTAINS)」으로 넣으십시오.', NEW.word;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_banned_words_regex ON public.banned_words;
CREATE TRIGGER trg_banned_words_regex BEFORE INSERT OR UPDATE ON public.banned_words
  FOR EACH ROW EXECUTE FUNCTION public.fn_banned_word_regex_guard();

DO $$
DECLARE n int;
BEGIN
  UPDATE public.banned_words SET is_active = false, updated_at = now()
   WHERE is_active AND match_type = 'REGEX' AND NOT fn_is_valid_regex(word);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'D106 — 문법이 틀린 정규식 금칙어 %줄을 껐습니다(지우지 않음).', n; END IF;
END $$;

COMMENT ON FUNCTION public.fn_is_valid_regex(text) IS '정규식 문법이 맞는지 — 틀리면 false(오류 없음) · D106';
COMMENT ON FUNCTION public.fn_regex_hit(text, text) IS '정규식 맞춤 — 문법이 틀린 줄은 안 걸림(등록 전체가 멈추지 않게) · D106';
COMMENT ON TRIGGER trg_banned_words_regex ON public.banned_words IS '켜진 REGEX 금칙어는 문법이 맞아야 저장 — BANNED_REGEX · D106';

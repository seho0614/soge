-- =====================================================================
-- D115 — v10.93 다국어 1단계 기반 (2026-10-24 · docs/148 · docs/150)
--
--   대표 결정(2026-10-24 「추천대로」 — multilingual-i18n #12 ~ #16)
--
--   ① 언어 목록 i18n_langs — 한국어만 켜짐 · 영어(1차) 외 6개는 꺼진 채(아랍어는 좌우 반전 표시)
--   ② 콘텐츠 번역 content_translations — 원문 표는 건드리지 않고 옆 표에 「칸 하나 = 줄 하나」
--      원문 해시(source_hash = md5)가 지금 원문과 다르면 낡음(STALE) — 화면에는 승인된 · 낡지 않은 줄만(3단계부터)
--   ③ fn_i18n_source(대상, 번호, 칸) — 지금 원문 · 관 코드(금칙어 검사용). 받는 대상 · 칸은 여기 적힌 것만
--   ④ 회원이 고른 언어 accounts.preferred_lang
--   ⑤ 스위치 i18n.enabled(off) · i18n.engine(MANUAL) · i18n.board_on_view(off) — 손님 화면은 바뀌지 않음
--
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.i18n_langs (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z]{2}$'),
  name       text NOT NULL,
  native     text NOT NULL,
  rtl        boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO public.i18n_langs (code, name, native, rtl, is_active, sort_order) VALUES
  ('ko', '한국어', '한국어', false, true, 0),
  ('en', '영어', 'English', false, false, 1),
  ('ja', '일본어', '日本語', false, false, 2),
  ('de', '독일어', 'Deutsch', false, false, 3),
  ('fr', '프랑스어', 'Français', false, false, 4),
  ('id', '인도네시아어', 'Bahasa Indonesia', false, false, 5),
  ('vi', '베트남어', 'Tiếng Việt', false, false, 6),
  ('ar', '아랍어', 'العربية', true, false, 7)
ON CONFLICT (code) DO NOTHING;

-- 한국어는 원문이라 끌 수 없습니다
CREATE OR REPLACE FUNCTION public.fn_i18n_lang_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.code = 'ko' AND (NOT NEW.is_active OR NEW.code <> 'ko') THEN
    RAISE EXCEPTION 'I18N: 한국어(원문)는 끄거나 바꿀 수 없습니다';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_i18n_lang_guard ON public.i18n_langs;
CREATE TRIGGER trg_i18n_lang_guard BEFORE UPDATE ON public.i18n_langs FOR EACH ROW EXECUTE FUNCTION public.fn_i18n_lang_guard();

CREATE TABLE IF NOT EXISTS public.content_translations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_type   text NOT NULL CHECK (target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT')),
  target_id     text NOT NULL,
  field         text NOT NULL,
  lang          text NOT NULL REFERENCES public.i18n_langs(code),
  text          text NOT NULL CHECK (length(btrim(text)) > 0),
  source_hash   text NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','AUTO_APPROVED','MACHINE','REJECTED')),
  engine        text NOT NULL DEFAULT 'MANUAL' CHECK (engine IN ('MANUAL','CLAUDE','N8N')),
  translated_by uuid REFERENCES public.accounts(id),
  translated_at timestamptz NOT NULL DEFAULT now(),
  approved_by   uuid REFERENCES public.accounts(id),
  approved_at   timestamptz,
  reject_reason text,
  CONSTRAINT content_translations_not_ko CHECK (lang <> 'ko'),
  CONSTRAINT content_translations_reject_reason CHECK (status <> 'REJECTED' OR length(btrim(coalesce(reject_reason, ''))) > 0),
  UNIQUE (target_type, target_id, field, lang)
);
CREATE INDEX IF NOT EXISTS idx_content_translations_queue ON public.content_translations (status, lang, translated_at DESC);

-- 지금 원문 · 관 — 받는 대상 · 칸은 여기 적힌 것만(없으면 NULL)
CREATE OR REPLACE FUNCTION public.fn_i18n_source(p_type text, p_id text, p_field text, OUT src text, OUT gwan text)
  LANGUAGE plpgsql STABLE AS $$
BEGIN
  src := NULL; gwan := NULL;
  IF p_type IN ('NOTICE','FAQ','LISTING','REQUEST','POST','COMMENT') AND p_id !~* '^[0-9a-f-]{36}$' THEN RETURN; END IF;
  CASE p_type
    WHEN 'NOTICE'  THEN IF p_field IN ('title','body') THEN
        SELECT CASE p_field WHEN 'title' THEN n.title ELSE n.body END, n.gwan_code INTO src, gwan FROM notices n WHERE n.id = p_id::uuid; END IF;
    WHEN 'FAQ'     THEN IF p_field IN ('question','answer') THEN
        SELECT CASE p_field WHEN 'question' THEN f.question ELSE f.answer END, f.gwan_code INTO src, gwan FROM faqs f WHERE f.id = p_id::uuid; END IF;
    WHEN 'TERM'    THEN IF p_field IN ('title','body') AND p_id ~ '^[^@]+@[^@]+$' THEN
        SELECT CASE p_field WHEN 'title' THEN t.title ELSE t.body END, t.gwan_code INTO src, gwan FROM terms t
         WHERE t.code = split_part(p_id, '@', 1) AND t.version = split_part(p_id, '@', 2); END IF;
    WHEN 'LISTING' THEN IF p_field IN ('title','body') THEN
        SELECT CASE p_field WHEN 'title' THEN l.title ELSE l.body END, l.gwan_code INTO src, gwan FROM listings l WHERE l.id = p_id::uuid; END IF;
    WHEN 'REQUEST' THEN IF p_field IN ('title','body') THEN
        SELECT CASE p_field WHEN 'title' THEN r.title ELSE r.body END, r.gwan_code INTO src, gwan FROM requests r WHERE r.id = p_id::uuid; END IF;
    WHEN 'POST'    THEN IF p_field IN ('title','body') THEN
        SELECT CASE p_field WHEN 'title' THEN p.title ELSE p.body END INTO src FROM posts p WHERE p.id = p_id::uuid; END IF;
    WHEN 'COMMENT' THEN IF p_field = 'body' THEN
        SELECT c.body INTO src FROM post_comments c WHERE c.id = p_id::uuid; END IF;
    ELSE NULL;
  END CASE;
END $$;

-- 번역 줄 + 지금 원문 + 낡음
CREATE OR REPLACE VIEW public.v_translation_state AS
 SELECT t.id, t.target_type, t.target_id, t.field, t.lang, t.text, t.status, t.engine,
        t.translated_by, t.translated_at, t.approved_by, t.approved_at, t.reject_reason,
        s.src AS source_text, s.gwan AS gwan_code,
        (s.src IS NULL) AS source_missing,
        (s.src IS NOT NULL AND md5(s.src) <> t.source_hash) AS is_stale
   FROM public.content_translations t
   CROSS JOIN LATERAL public.fn_i18n_source(t.target_type, t.target_id, t.field) s;

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS preferred_lang text REFERENCES public.i18n_langs(code);

INSERT INTO public.site_settings (key, value, scope, description, value_pattern, value_example) VALUES
  ('i18n.enabled', 'off', 'GLOBAL', '다국어 — 켜면 언어 단추 · 번역이 손님 화면에 나감(오픈 뒤 · docs/148)', '^(on|off)$', 'off'),
  ('i18n.engine', 'MANUAL', 'GLOBAL', '번역 엔진 — MANUAL(운영자가 넣음) · CLAUDE · N8N (docs/148 3-5)', '^(MANUAL|CLAUDE|N8N)$', 'MANUAL'),
  ('i18n.board_on_view', 'off', 'GLOBAL', '소개광장 글 · 댓글을 볼 때 번역(3단계 · docs/148 3-3)', '^(on|off)$', 'off')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.i18n_langs IS '다국어 언어 목록. 한국어(원문)만 처음부터 켜짐 · 끌 수 없음(D115).';
COMMENT ON TABLE public.content_translations IS '콘텐츠 번역 — 원문 칸 하나에 언어 하나 한 줄. 승인된 · 낡지 않은 줄만 손님 화면에(D115 · docs/148).';
COMMENT ON VIEW public.v_translation_state IS '번역 줄 + 지금 원문 + 낡음(원문 해시가 바뀜). 낡은 줄은 승인할 수 없고 화면에 나가지 않습니다.';

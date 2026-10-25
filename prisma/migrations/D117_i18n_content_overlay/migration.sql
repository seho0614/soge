-- =====================================================================
-- D117 — v10.103 다국어 3-1 운영 글 번역을 손님 화면에 (2026-10-25 · docs/148 §3-3 · docs/161)
--
--   대표 결정(2026-10-25 「3 2 1」 → 3단계 계획 · 법률 회신 「번역해도 문제없음」)
--
--   ① 번역 대상에 분류 이름(CATEGORY · 칸 name · 번호 = categories.id)과 소개몰 상품(HLT_PRODUCT · 칸 name · summary · 번호 = 상품 코드)을 더함
--   ② fn_i18n_source 를 같은 목록으로 다시 만듦(D115 의 대상 · 칸은 그대로)
--   ③ 손님 화면은 「승인 · 낡지 않은 줄」만 원문 대신 씀 — 고르는 일은 API(I18nService.overlay)가 합니다. 이 파일은 표 · 함수만
--
--   자료를 지우지 않습니다. 재실행 안전.
-- =====================================================================
ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_target_type_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_target_type_check
  CHECK (target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT','CATEGORY','HLT_PRODUCT'));

-- 지금 원문 · 관 — 받는 대상 · 칸은 여기 적힌 것만(없으면 NULL) · D115 + CATEGORY · HLT_PRODUCT
CREATE OR REPLACE FUNCTION public.fn_i18n_source(p_type text, p_id text, p_field text, OUT src text, OUT gwan text)
  LANGUAGE plpgsql STABLE AS $$
BEGIN
  src := NULL; gwan := NULL;
  IF p_type IN ('NOTICE','FAQ','LISTING','REQUEST','POST','COMMENT','CATEGORY') AND p_id !~* '^[0-9a-f-]{36}$' THEN RETURN; END IF;
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
    WHEN 'CATEGORY' THEN IF p_field = 'name' THEN
        SELECT c.name, c.gwan_code INTO src, gwan FROM categories c WHERE c.id = p_id::uuid; END IF;
    WHEN 'HLT_PRODUCT' THEN IF p_field IN ('name','summary') THEN
        SELECT CASE p_field WHEN 'name' THEN p.name ELSE p.summary END, 'HLT' INTO src, gwan FROM hlt_products p WHERE p.code = p_id; END IF;
    ELSE NULL;
  END CASE;
END $$;


-- 손님 화면이 찾는 길(대상 · 언어 · 번호) — 승인된 줄만 보므로 부분 색인
CREATE INDEX IF NOT EXISTS idx_content_translations_live ON public.content_translations (target_type, lang, target_id)
  WHERE status IN ('APPROVED','AUTO_APPROVED','MACHINE');

COMMENT ON TABLE public.content_translations IS '콘텐츠 번역 — 원문 칸 하나에 언어 하나 한 줄. 승인된 · 낡지 않은 줄만 손님 화면에(D115 · D117 · docs/148 · docs/161).';

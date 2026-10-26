-- =====================================================================
-- D124 — v10.118 (2026-10-26 · 관심 성향 문항 · 보기 · 세그먼트 이름을 번역 대상으로 · docs/182)
--
--   대표 「나머지 개발」 4번. 관심 성향 화면의 문항 · 보기 · 세그먼트 이름 · 설명은 DB 의 한국어 그대로라 영어 화면에서도 한국어였습니다.
--   운영 글 번역 틀(D115 · D117)에 대상 셋을 더해, 운영자가 「관 관리 › 번역 › 원문 목록」에서 번역을 넣고 승인하게 합니다.
--
--   ① content_translations 대상에 PROFILE_Q(문항 · 칸 question · 번호 = 문항 코드) · PROFILE_OPT(보기 · 칸 label · 번호 = 「문항:보기」)
--      · AD_SEGMENT(세그먼트 · 칸 name · description · 번호 = 세그먼트 코드)
--   ② fn_i18n_source 에 같은 셋 — 나머지(D117 까지)는 그대로
--   재실행 안전 · 자료를 바꾸지 않습니다. 다국어(i18n.enabled)가 꺼져 있으면 손님 화면은 그대로입니다.
-- =====================================================================

ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_target_type_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_target_type_check
  CHECK (target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT','CATEGORY','HLT_PRODUCT',
                         'PROFILE_Q','PROFILE_OPT','AD_SEGMENT'));

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
    /* v10.118 (D124) — 관심 성향 */
    WHEN 'PROFILE_Q' THEN IF p_field = 'question' THEN
        SELECT q.question INTO src FROM profile_questions q WHERE q.code = p_id; END IF;
    WHEN 'PROFILE_OPT' THEN IF p_field = 'label' AND p_id ~ '^[^:]+:[^:]+$' THEN
        SELECT o.label INTO src FROM profile_options o
         WHERE o.question_code = split_part(p_id, ':', 1) AND o.code = split_part(p_id, ':', 2); END IF;
    WHEN 'AD_SEGMENT' THEN IF p_field IN ('name','description') THEN
        SELECT CASE p_field WHEN 'name' THEN s.name ELSE s.description END INTO src FROM ad_segments s WHERE s.code = p_id; END IF;
    ELSE NULL;
  END CASE;
END $$;

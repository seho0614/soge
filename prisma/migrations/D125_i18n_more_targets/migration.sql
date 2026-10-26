-- =====================================================================
-- D125 — v10.119 (2026-10-26 · 영어 화면에 남은 한국어 · DB 글을 번역 대상으로 · docs/183)
--
--   대표 「나머지 개발」 5번(추천대로 · 승인). 영어 화면 점검에서 DB 에 한국어로만 있는 글이 남았습니다.
--   운영 글 번역 틀(D115 · D117 · D124)에 대상을 더해, 운영자가 「관 관리 › 번역 › 원문 목록」에서 번역을 넣고 승인하게 합니다.
--
--   ① content_translations 대상에 FOOTER_LINK(바닥줄 링크 · 칸 label · 번호 = 링크 번호)
--      · SETTING(사이트 설정 · 칸 value · 번호 = 설정 키 — legal.intermediary_notice · legal.direct_notice 둘만)
--      · POLL(투표 · 칸 title · description) · POLL_OPT(투표 보기 · 칸 label · sub)
--      · INGREDIENT(소개몰 성분 · 칸 name · 번호 = 성분 코드) · HLT_CONCERN(고민 · 칸 name · 번호 = 고민 코드)
--      상담 분류는 이미 CATEGORY 대상이라 마이그레이션 없이 API 에서 얹습니다.
--   ② fn_i18n_source 에 같은 대상 — 나머지(D124 까지)는 그대로
--   ③ v_footer_links 끝에 id 칸 — 번역을 링크 번호로 찾습니다(앞 칸 · 순서 · 거르기는 그대로)
--   재실행 안전 · 자료를 바꾸지 않습니다. 다국어(i18n.enabled)가 꺼져 있으면 손님 화면은 그대로입니다.
-- =====================================================================

ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_target_type_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_target_type_check
  CHECK (target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT','CATEGORY','HLT_PRODUCT',
                         'PROFILE_Q','PROFILE_OPT','AD_SEGMENT',
                         'FOOTER_LINK','SETTING','POLL','POLL_OPT','INGREDIENT','HLT_CONCERN'));

CREATE OR REPLACE FUNCTION public.fn_i18n_source(p_type text, p_id text, p_field text, OUT src text, OUT gwan text)
  LANGUAGE plpgsql STABLE AS $$
BEGIN
  src := NULL; gwan := NULL;
  IF p_type = 'FOOTER_LINK' AND p_id !~ '^[0-9]{1,9}$' THEN RETURN; END IF;
  IF p_type IN ('NOTICE','FAQ','LISTING','REQUEST','POST','COMMENT','CATEGORY','POLL','POLL_OPT') AND p_id !~* '^[0-9a-f-]{36}$' THEN RETURN; END IF;
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
    /* v10.119 (D125) — 바닥줄 링크 · 법정 고지 · 투표 · 소개몰 성분 · 고민 */
    WHEN 'FOOTER_LINK' THEN IF p_field = 'label' THEN
        SELECT f.label INTO src FROM footer_links f WHERE f.id = p_id::int; END IF;
    WHEN 'SETTING' THEN IF p_field = 'value' AND p_id IN ('legal.intermediary_notice','legal.direct_notice') THEN
        SELECT s.value INTO src FROM site_settings s WHERE s.key = p_id; END IF;
    WHEN 'POLL' THEN IF p_field IN ('title','description') THEN
        SELECT CASE p_field WHEN 'title' THEN p.title ELSE p.description END INTO src FROM polls p WHERE p.id = p_id::uuid; END IF;
    WHEN 'POLL_OPT' THEN IF p_field IN ('label','sub') THEN
        SELECT CASE p_field WHEN 'label' THEN o.label ELSE o.sub END INTO src FROM poll_options o WHERE o.id = p_id::uuid; END IF;
    WHEN 'INGREDIENT' THEN IF p_field = 'name' THEN
        SELECT g.name, 'HLT' INTO src, gwan FROM ingredients g WHERE g.code = p_id; END IF;
    WHEN 'HLT_CONCERN' THEN IF p_field = 'name' THEN
        SELECT k.name, 'HLT' INTO src, gwan FROM hlt_concerns k WHERE k.code = p_id; END IF;
    ELSE NULL;
  END CASE;
END $$;

CREATE OR REPLACE VIEW public.v_footer_links AS
 SELECT f.section,
    f.label,
    f.target_type,
    f.target_ref,
    f.sort_order,
        CASE
            WHEN (f.target_type = 'TERM'::text) THEN (EXISTS ( SELECT 1
               FROM terms t
              WHERE ((t.code = f.target_ref) AND (t.status = 'PUBLISHED'::text))))
            WHEN (f.target_type = 'NONE'::text) THEN false
            ELSE true
        END AS available,
    COALESCE(f.tip, ( SELECT t.blocked_by
           FROM terms t
          WHERE (t.code = f.target_ref)
          ORDER BY t.effective_from DESC
         LIMIT 1), f.blocked_by) AS tip,
    f.id
   FROM footer_links f
  WHERE f.is_active
  ORDER BY f.sort_order;

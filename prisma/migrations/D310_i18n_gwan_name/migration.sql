-- =====================================================================
-- D310 (v10.647 · docs/792) 관 이름 번역 — 운영 화면에서 만든 새 관도 영어 등 다른 언어 이름
--
--   대표 11/24 「새 관 후속 ② 새 관 다른 언어 이름」. 처음 관은 사용자 웹 사전(header.gwan.*)으로 번역하지만,
--   새 관은 사전에 없어 다른 언어에서도 한국어 이름이 나왔음 → 번역 대상 GWAN(칸 name · description · 번호 = 관 코드)을 더함.
--   번역 검수(관 관리 › 번역 검수)에서 초안 · 승인하면 공개 /gwans 가 그 언어 이름을 줌.
--   번역 대상 목록(CHECK) 한 줄 더함 · 원문 함수 fn_i18n_source 에 GWAN 한 가지 더함(나머지는 D126 그대로) · 지우는 문장 없음 · 다시 돌려도 같음
-- =====================================================================

ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_target_type_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_target_type_check
  CHECK (target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT','CATEGORY','HLT_PRODUCT',
                         'PROFILE_Q','PROFILE_OPT','AD_SEGMENT',
                         'FOOTER_LINK','SETTING','POLL','POLL_OPT','INGREDIENT','HLT_CONCERN',
                         'NOTIFY_EVENT','REPORT_REASON','PLAN','INTRO_GRADE','GWAN_FORM','UI_MESSAGE','AD_PLACEMENT',
                         'GWAN'));

CREATE OR REPLACE FUNCTION public.fn_i18n_source(p_type text, p_id text, p_field text, OUT src text, OUT gwan text)
  LANGUAGE plpgsql STABLE AS $$
BEGIN
  src := NULL; gwan := NULL;
  IF p_type = 'FOOTER_LINK' AND p_id !~ '^[0-9]{1,9}$' THEN RETURN; END IF;
  IF p_type IN ('NOTICE','FAQ','LISTING','REQUEST','POST','COMMENT','CATEGORY','POLL','POLL_OPT','AD_PLACEMENT') AND p_id !~* '^[0-9a-f-]{36}$' THEN RETURN; END IF;
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
    WHEN 'SETTING' THEN IF p_field = 'value' AND p_id IN ('legal.intermediary_notice','legal.direct_notice','footer.company_name') THEN   -- v10.132 상호(D130 그대로)
        SELECT s.value INTO src FROM site_settings s WHERE s.key = p_id; END IF;
    WHEN 'POLL' THEN IF p_field IN ('title','description') THEN
        SELECT CASE p_field WHEN 'title' THEN p.title ELSE p.description END INTO src FROM polls p WHERE p.id = p_id::uuid; END IF;
    WHEN 'POLL_OPT' THEN IF p_field IN ('label','sub') THEN
        SELECT CASE p_field WHEN 'label' THEN o.label ELSE o.sub END INTO src FROM poll_options o WHERE o.id = p_id::uuid; END IF;
    WHEN 'INGREDIENT' THEN IF p_field = 'name' THEN
        SELECT g.name, 'HLT' INTO src, gwan FROM ingredients g WHERE g.code = p_id; END IF;
    WHEN 'HLT_CONCERN' THEN IF p_field = 'name' THEN
        SELECT k.name, 'HLT' INTO src, gwan FROM hlt_concerns k WHERE k.code = p_id; END IF;
    /* v10.123 (D126) — 알림 종류 · 신고 사유 · 요금제 · 소개자 등급 · 업무 등록 안내 · 화면 고정 문구 · 광고 자리 */
    WHEN 'NOTIFY_EVENT' THEN IF p_field IN ('name','legal_basis') THEN
        SELECT CASE p_field WHEN 'name' THEN n.name ELSE n.legal_basis END INTO src FROM notification_event_policies n WHERE n.event_code = p_id; END IF;
    WHEN 'REPORT_REASON' THEN IF p_field = 'label' THEN
        SELECT r.label, r.gwan_code INTO src, gwan FROM report_reasons r WHERE r.code = p_id; END IF;
    WHEN 'PLAN' THEN IF p_field IN ('name','features') THEN
        SELECT CASE p_field WHEN 'name' THEN s.name ELSE nullif(array_to_string(s.features, E'\n'), '') END INTO src FROM subscription_plans s WHERE s.code = p_id; END IF;
    WHEN 'INTRO_GRADE' THEN IF p_field IN ('name','criteria','benefit','next_hint') THEN
        SELECT CASE p_field WHEN 'name' THEN g.name WHEN 'criteria' THEN g.criteria WHEN 'benefit' THEN g.benefit ELSE g.next_hint END
          INTO src FROM introducer_grades g WHERE g.code = p_id; END IF;
    WHEN 'GWAN_FORM' THEN IF p_field IN ('subject','title_hint','body_hint','notice') AND p_id ~ '^[A-Z]+:[A-Z]+$' THEN
        SELECT CASE p_field WHEN 'subject' THEN c.subject WHEN 'title_hint' THEN c.title_hint WHEN 'body_hint' THEN c.body_hint ELSE c.notice END, c.gwan_code
          INTO src, gwan FROM gwan_form_copy c WHERE c.gwan_code = split_part(p_id, ':', 1) AND c.role = split_part(p_id, ':', 2); END IF;
    WHEN 'UI_MESSAGE' THEN IF p_field = 'message' THEN
        SELECT m.message INTO src FROM ui_messages m WHERE m.code = p_id; END IF;
    WHEN 'AD_PLACEMENT' THEN IF p_field IN ('title','body','cta') THEN
        SELECT CASE p_field WHEN 'title' THEN a.title WHEN 'body' THEN a.body ELSE a.cta END INTO src FROM ad_placements a WHERE a.id = p_id::uuid; END IF;
    /* v10.647 (D310 · docs/792) 관 이름 · 설명 — 운영 화면에서 만든 새 관도 다른 언어 이름(번역 검수) */
    WHEN 'GWAN' THEN IF p_field IN ('name','description') THEN
        SELECT CASE p_field WHEN 'name' THEN g.name ELSE g.description END, g.code INTO src, gwan FROM gwans g WHERE g.code = p_id; END IF;
    ELSE NULL;
  END CASE;
END $$;

-- =====================================================================
-- D130 — v10.132 (2026-10-27 · 법정 표기 영어 — 영어 화면 바닥줄의 상호 · docs/198)
--
--   대표 「4.1 · 법정 표기 영어 — 소리 나는 대로 표기」. 바닥줄 상호(site_settings footer.company_name)를 번역 대상(SETTING)에 더하고
--   영어 초안을 **승인 대기(DRAFT)** 로 넣음 — 등기된 영문 이름이 아니므로 **법무 확인 뒤 운영 화면 › 번역에서 승인**해야 손님 화면에 나감.
--   ① fn_i18n_source — SETTING 에 footer.company_name(D126 판 그대로 + 이 키 하나)
--   ② 초안 1줄 — 지금 상호 값 기준(값이 비었으면 넣지 않음 · 이미 있으면 그대로)
--   자료를 지우지 않습니다 · 재실행 안전.
-- =====================================================================

/* ── ① 원문 함수 ───────────────────────────────────────────────────── */
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
    WHEN 'SETTING' THEN IF p_field = 'value' AND p_id IN ('legal.intermediary_notice','legal.direct_notice','footer.company_name') THEN   -- v10.132 상호
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
    ELSE NULL;
  END CASE;
END $$;

/* ── ② 영어 초안(승인 대기) ─────────────────────────────────────────── */
INSERT INTO public.content_translations (target_type, target_id, field, lang, text, source_hash, status, engine)
SELECT 'SETTING', 'footer.company_name', 'value', 'en',
       CASE WHEN s.value LIKE '%소개뱅크%' THEN 'Korea Biohealthcare Co., Ltd. — SoGaeBank Division' ELSE 'Korea Biohealthcare Co., Ltd.' END,
       md5(s.value), 'DRAFT', 'MANUAL'
  FROM public.site_settings s
 WHERE s.key = 'footer.company_name' AND coalesce(btrim(s.value), '') <> '' AND s.value LIKE '%한국바이오헬스케어%'
ON CONFLICT (target_type, target_id, field, lang) DO NOTHING;

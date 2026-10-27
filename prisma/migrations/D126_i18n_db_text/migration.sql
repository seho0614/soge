-- =====================================================================
-- D126 — v10.123 (2026-10-27 · DB 기준표 문구의 영어 · docs/187)
--
--   대표 「둘다」 · 「가」(2026-10-26 · 27). v10.122(docs/186)에서 남긴 ③ — DB 기준표에 한국어로만 있는 글을 번역 대상으로.
--   ① content_translations 대상에 7개 더함(번호 = 그 표의 코드 · 칸)
--      NOTIFY_EVENT(알림 종류 · name · legal_basis · 번호 = event_code) · REPORT_REASON(신고 사유 · label · code)
--      · PLAN(요금제 · name · features — 혜택 줄을 줄바꿈으로 이은 글 · code) · INTRO_GRADE(소개자 등급 · name · criteria · benefit · next_hint · code)
--      · GWAN_FORM(업무 등록 안내 · subject · title_hint · body_hint · notice · 번호 = 「관 코드:역할」) · UI_MESSAGE(화면 고정 문구 · message · code)
--      · AD_PLACEMENT(광고 자리 소재 · title · body · cta · 번호 = 소재 id)
--   ② fn_i18n_source 에 같은 대상 — 나머지(D125 까지)는 그대로
--   ③ 영어 초안(대표 결정 「가」) — **승인 대기(DRAFT)** 로만 넣음. 승인 전에는 화면에 나가지 않습니다(운영 화면 「관 관리 › 번역」에서 고쳐 승인).
--      지금 원문이 초안을 쓴 원문과 **글자까지 같은 칸만** 넣습니다(운영에서 고친 문구 · 없는 소재는 건너뜀) · 이미 번역 줄이 있으면 그대로.
--   재실행 안전 · 원문 자료는 바꾸지 않습니다. 다국어(i18n.enabled)가 꺼져 있으면 손님 화면은 그대로입니다.
-- =====================================================================

ALTER TABLE public.content_translations DROP CONSTRAINT IF EXISTS content_translations_target_type_check;
ALTER TABLE public.content_translations ADD CONSTRAINT content_translations_target_type_check
  CHECK (target_type IN ('NOTICE','FAQ','TERM','LISTING','REQUEST','POST','COMMENT','CATEGORY','HLT_PRODUCT',
                         'PROFILE_Q','PROFILE_OPT','AD_SEGMENT',
                         'FOOTER_LINK','SETTING','POLL','POLL_OPT','INGREDIENT','HLT_CONCERN',
                         'NOTIFY_EVENT','REPORT_REASON','PLAN','INTRO_GRADE','GWAN_FORM','UI_MESSAGE','AD_PLACEMENT'));

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

-- ③ 영어 초안 216칸 — (대상, 번호, 칸, 초안을 쓴 한국어 원문, 영어)
INSERT INTO public.content_translations (target_type, target_id, field, lang, text, source_hash, status, engine)
SELECT v.t, v.id, v.f, 'en', v.en, md5(s.src), 'DRAFT', 'MANUAL'
  FROM (VALUES
  ('AD_PLACEMENT', '2609c033-16a3-4919-ab68-eec285fd146d', 'body', 'INV-6 제한업종. 등록 단계에서 거부되었고 슬롯 지정 자체가 열리지 않습니다.', 'INV-6 restricted category. Rejected at registration, so no slot can be assigned.'),
  ('AD_PLACEMENT', '2609c033-16a3-4919-ab68-eec285fd146d', 'title', '(등록 거부) 대부 광고 소재', '(Rejected) Loan ad creative'),
  ('AD_PLACEMENT', '31ed3bbb-5d69-4f14-b16a-3f45d9dc458b', 'body', '상권 분석과 예상 매출을 먼저 확인하고 결정하십시오.', 'Check the trade-area analysis and expected sales before you decide.'),
  ('AD_PLACEMENT', '31ed3bbb-5d69-4f14-b16a-3f45d9dc458b', 'cta', '상권 보기', 'View trade area'),
  ('AD_PLACEMENT', '31ed3bbb-5d69-4f14-b16a-3f45d9dc458b', 'title', '가맹 상담 전에 점포부터 보십시오', 'See the store before the franchise consultation'),
  ('AD_PLACEMENT', '6792bc7e-7f6d-4b80-a9ca-51154b8a55c1', 'body', '실측 후 3일 안에 견적 3건. 공사 중 매출 손실을 줄이는 야간 시공도 가능합니다.', 'Three quotes within 3 days of measuring. Night work is available to reduce lost sales during construction.'),
  ('AD_PLACEMENT', '6792bc7e-7f6d-4b80-a9ca-51154b8a55c1', 'cta', '견적 3건 받기', 'Get 3 quotes'),
  ('AD_PLACEMENT', '6792bc7e-7f6d-4b80-a9ca-51154b8a55c1', 'title', '상가 인테리어 견적 3곳 비교', 'Compare 3 quotes for shop interiors'),
  ('AD_PLACEMENT', '6f6cbf4a-9c38-4320-8222-e7b06c8fedb4', 'body', '평수와 업종만 알려주시면 시공사 3곳 견적을 한 번에 받습니다.', 'Just tell us the floor area and business type to get quotes from 3 contractors at once.'),
  ('AD_PLACEMENT', '6f6cbf4a-9c38-4320-8222-e7b06c8fedb4', 'cta', '견적 비교', 'Compare quotes'),
  ('AD_PLACEMENT', '6f6cbf4a-9c38-4320-8222-e7b06c8fedb4', 'title', '상가 인테리어 견적 3곳 비교', 'Compare 3 quotes for shop interiors'),
  ('AD_PLACEMENT', '78c0ca67-a41b-47db-86f9-3378815dcd3c', 'body', '업종 · 지역을 등록하면 그에 맞는 소개 요청이 옵니다. 소개비는 당사자끼리 — 플랫폼 공제 0%.', 'Register your business type and region to receive matching referral requests. Referral fees are between the parties — 0% platform deduction.'),
  ('AD_PLACEMENT', '78c0ca67-a41b-47db-86f9-3378815dcd3c', 'cta', '공급자 등록', 'Register as a supplier'),
  ('AD_PLACEMENT', '78c0ca67-a41b-47db-86f9-3378815dcd3c', 'title', '공급자로 등록하고 맞는 요청을 먼저 받으십시오', 'Register as a supplier and get matching requests first'),
  ('AD_PLACEMENT', '7b5db57a-670f-4d99-975a-2f731e5c0d21', 'body', '공장 · 창고 지붕 1,000평 이상이면 설치비 0원. 20년 임대료를 먼저 계산해 드립니다.', 'Factory or warehouse roofs over 1,000 pyeong install for free. We calculate 20 years of rent for you first.'),
  ('AD_PLACEMENT', '7b5db57a-670f-4d99-975a-2f731e5c0d21', 'cta', '수익 계산해 보기', 'Calculate your income'),
  ('AD_PLACEMENT', '7b5db57a-670f-4d99-975a-2f731e5c0d21', 'title', '지붕만 빌려주면 임대 수익으로 돌아옵니다', 'Lend us your roof and earn rental income'),
  ('AD_PLACEMENT', '901840b3-b302-4c1e-9e67-2d9c1aca45e4', 'body', '상담 페이지 하나로 문의를 받고, 응대는 카톡으로 이어집니다.', 'Take inquiries on a single consultation page and continue the conversation on KakaoTalk.'),
  ('AD_PLACEMENT', '901840b3-b302-4c1e-9e67-2d9c1aca45e4', 'cta', '사례 보기', 'See examples'),
  ('AD_PLACEMENT', '901840b3-b302-4c1e-9e67-2d9c1aca45e4', 'title', '홈페이지 없이 견적 문의만 받는 방법', 'Get quote requests without a website'),
  ('AD_PLACEMENT', '94392804-a30c-4b2d-ad13-ca31dfec10dc', 'body', '수도권 4개 센터 · 당일 출고. 물량 구간별 단가표를 먼저 보내 드립니다.', '4 centers in the capital area · same-day dispatch. We send our volume-tier rate card first.'),
  ('AD_PLACEMENT', '94392804-a30c-4b2d-ad13-ca31dfec10dc', 'cta', '단가표 요청', 'Request rate card'),
  ('AD_PLACEMENT', '94392804-a30c-4b2d-ad13-ca31dfec10dc', 'title', '월 3,000박스부터 3PL 단가 협상', '3PL rates negotiable from 3,000 boxes a month'),
  ('AD_PLACEMENT', '9bf7fb47-a82c-496c-8002-c41f83c66830', 'body', '플랫폼 공제 0%. 소개코드가 붙은 건은 성사 시 전액 소개자에게 갑니다.', '0% platform deduction. On deals with a referral code, the full fee goes to the referrer.'),
  ('AD_PLACEMENT', '9bf7fb47-a82c-496c-8002-c41f83c66830', 'cta', '소개합니다', 'Make a referral'),
  ('AD_PLACEMENT', '9bf7fb47-a82c-496c-8002-c41f83c66830', 'title', '소개비는 한 푼도 떼지 않습니다', 'We never take a cut of your referral fee'),
  ('AD_PLACEMENT', '9d502804-dd56-4d11-8573-b6d84f9674e7', 'body', '권리금 조정 가능 매물만 모았습니다. 중개보수는 성사 후에만 받습니다.', 'Only listings with negotiable key money. Brokerage fees are charged only after the deal closes.'),
  ('AD_PLACEMENT', '9d502804-dd56-4d11-8573-b6d84f9674e7', 'cta', '매물 보기', 'View listings'),
  ('AD_PLACEMENT', '9d502804-dd56-4d11-8573-b6d84f9674e7', 'title', '해운대 상가 · 이번 주 신규 12건', 'Haeundae shops · 12 new this week'),
  ('AD_PLACEMENT', 'a6661299-ad49-426c-96ed-2959629c33e7', 'body', '보관 · 피킹 · 배송을 한 곳에서. 물량에 따라 단가가 내려갑니다.', 'Storage, picking and delivery in one place. Rates drop as volume grows.'),
  ('AD_PLACEMENT', 'a6661299-ad49-426c-96ed-2959629c33e7', 'cta', '단가표 받기', 'Get rate card'),
  ('AD_PLACEMENT', 'a6661299-ad49-426c-96ed-2959629c33e7', 'title', '월 3,000박스부터 3PL 단가 협상', '3PL rates negotiable from 3,000 boxes a month'),
  ('AD_PLACEMENT', 'a66dfc08-837c-4905-8c43-3c7e190a781f', 'body', '검색 노출부터 상담 접수까지 2주. B2B 업종 전용 랜딩 템플릿 12종.', 'Two weeks from search exposure to consultation intake. 12 landing templates for B2B businesses.'),
  ('AD_PLACEMENT', 'a66dfc08-837c-4905-8c43-3c7e190a781f', 'cta', '템플릿 보기', 'View templates'),
  ('AD_PLACEMENT', 'a66dfc08-837c-4905-8c43-3c7e190a781f', 'title', '홈페이지 없이 견적 문의만 받는 방법', 'Get quote requests without a website'),
  ('AD_PLACEMENT', 'ae30f539-5db4-4b9d-b035-ee4e98db7752', 'body', '사업자번호만 있으면 휴폐업 · 체납 · 소송 이력을 한 번에 봅니다.', 'With just a business registration number, see closure, tax arrears and litigation history at once.'),
  ('AD_PLACEMENT', 'ae30f539-5db4-4b9d-b035-ee4e98db7752', 'cta', '조회해 보기', 'Look it up'),
  ('AD_PLACEMENT', 'ae30f539-5db4-4b9d-b035-ee4e98db7752', 'title', '계약 전에 상대 회사 재무를 확인하십시오', 'Check the other company''s finances before you sign'),
  ('AD_PLACEMENT', 'af13e1b2-89d6-42a7-b12f-805e32c07ab4', 'body', '권리금 · 월세 · 예상 매출을 같은 표에서 비교합니다. 브랜드 32곳 자료 무료.', 'Compare key money, rent and expected sales in one table. Data on 32 brands, free.'),
  ('AD_PLACEMENT', 'af13e1b2-89d6-42a7-b12f-805e32c07ab4', 'cta', '점포 비교표 받기', 'Get the store comparison'),
  ('AD_PLACEMENT', 'af13e1b2-89d6-42a7-b12f-805e32c07ab4', 'title', '가맹 상담 전에 점포부터 보십시오', 'See the store before the franchise consultation'),
  ('AD_PLACEMENT', 'cd43a282-a2e6-4731-8291-082cc31105b0', 'body', '업종별 예상 세액과 절세 항목을 1페이지로. 기장 계약 없이도 봐 드립니다.', 'Expected tax and tax-saving items for your business type on one page. No bookkeeping contract needed.'),
  ('AD_PLACEMENT', 'cd43a282-a2e6-4731-8291-082cc31105b0', 'cta', '예상 세액 보기', 'See expected tax'),
  ('AD_PLACEMENT', 'cd43a282-a2e6-4731-8291-082cc31105b0', 'title', '창업 첫 해 세금, 미리 계산해 드립니다', 'We''ll calculate your first-year startup tax in advance'),
  ('AD_PLACEMENT', 'ebd37aea-6f7f-4873-888c-f63d79777f2c', 'body', '업종과 예상 매출만 알려주시면 1년 치 세금을 미리 보여 드립니다.', 'Tell us your business type and expected sales, and we show you a year of taxes in advance.'),
  ('AD_PLACEMENT', 'ebd37aea-6f7f-4873-888c-f63d79777f2c', 'cta', '예상 세액 보기', 'See expected tax'),
  ('AD_PLACEMENT', 'ebd37aea-6f7f-4873-888c-f63d79777f2c', 'title', '창업 첫 해 세금, 미리 계산해 드립니다', 'We''ll calculate your first-year startup tax in advance'),
  ('AD_PLACEMENT', 'ee9f4a27-9313-4f1f-951d-37dd35ea997b', 'body', '공장 · 창고 지붕 1,000평 이상이면 설치비 0원. 20년 임대료를 먼저 계산해 드립니다.', 'Factory or warehouse roofs over 1,000 pyeong install for free. We calculate 20 years of rent for you first.'),
  ('AD_PLACEMENT', 'ee9f4a27-9313-4f1f-951d-37dd35ea997b', 'cta', '수익 계산해 보기', 'Calculate your income'),
  ('AD_PLACEMENT', 'ee9f4a27-9313-4f1f-951d-37dd35ea997b', 'title', '지붕만 빌려주면 임대 수익으로 돌아옵니다', 'Lend us your roof and earn rental income'),
  ('AD_PLACEMENT', 'fe03b3f1-ce2f-4fdf-8ad9-d2ce754a8cf2', 'body', '의료법 제27조 · 심의필 번호를 확인하기 전에는 어떤 슬롯에도 배정되지 않습니다.', 'Not assigned to any slot until compliance with Article 27 of the Medical Service Act and the ad review approval number are confirmed.'),
  ('AD_PLACEMENT', 'fe03b3f1-ce2f-4fdf-8ad9-d2ce754a8cf2', 'title', '(심의 대기) 의료 광고 소재', '(Awaiting review) Medical ad creative'),
  ('GWAN_FORM', 'BIZ:OFFER', 'body_hint', '업종·투자 규모·지원 내용을 적어 주세요', 'Describe the business type, investment size and support offered'),
  ('GWAN_FORM', 'BIZ:OFFER', 'notice', '프랜차이즈·창업 기회를 소개하고 소개비를 받습니다.', 'Refer franchise and startup opportunities and receive a referral fee.'),
  ('GWAN_FORM', 'BIZ:OFFER', 'subject', '사업 기회', 'Business opportunity'),
  ('GWAN_FORM', 'BIZ:OFFER', 'title_hint', '어떤 사업 기회인가요?', 'What business opportunity is it?'),
  ('GWAN_FORM', 'BIZ:REQUEST', 'body_hint', '관심 업종과 예산을 적어 주세요', 'Describe the business types you are interested in and your budget'),
  ('GWAN_FORM', 'BIZ:REQUEST', 'notice', '찾는 사업 기회를 올리면 소개자가 제안합니다.', 'Post the business opportunity you are looking for, and referrers will make proposals.'),
  ('GWAN_FORM', 'BIZ:REQUEST', 'subject', '사업 기회', 'Business opportunity'),
  ('GWAN_FORM', 'BIZ:REQUEST', 'title_hint', '어떤 사업을 찾으시나요?', 'What kind of business are you looking for?'),
  ('GWAN_FORM', 'EARN:OFFER', 'body_hint', '아는 사람·기업·상품을 적어 주세요. 연락처는 적지 않으셔도 됩니다.', 'Describe the person, company or product you know. You don''t need to include contact details.'),
  ('GWAN_FORM', 'EARN:OFFER', 'notice', '아는 사람이 있다면 이미 소개자입니다. 상대방이 동의해야 연결되며, 동의 전에는 연락처가 전달되지 않습니다.', 'If you know someone, you are already a referrer. A connection is made only with the other person''s consent, and contact details are not shared before consent.'),
  ('GWAN_FORM', 'EARN:OFFER', 'subject', '소개할 것', 'What you can refer'),
  ('GWAN_FORM', 'EARN:OFFER', 'title_hint', '무엇을 소개하실 수 있나요?', 'What can you refer?'),
  ('GWAN_FORM', 'EARN:REQUEST', 'body_hint', '지역·분야·조건을 적어 주세요. 구체적일수록 소개자가 찾기 쉽습니다.', 'Describe the region, field and conditions. The more specific, the easier it is for referrers to find.'),
  ('GWAN_FORM', 'EARN:REQUEST', 'notice', '개인회원도 요청할 수 있습니다. 소개자가 "제가 알아요"로 응답하면 연결이 시작됩니다.', 'Individual members can make requests too. The connection starts when a referrer answers "I know someone".'),
  ('GWAN_FORM', 'EARN:REQUEST', 'subject', '찾는 것', 'What you are looking for'),
  ('GWAN_FORM', 'EARN:REQUEST', 'title_hint', '어떤 사람이나 기업을 찾으시나요?', 'What person or company are you looking for?'),
  ('GWAN_FORM', 'HLT:OFFER', 'body_hint', '품목 · 규격 · 인증 여부 · 유통기한을 적어 주십시오. 건강기능식품이면 인정받은 기능성만 적으실 수 있습니다.', 'Enter the item, specifications, certification and expiry date. For health functional foods, list only the approved functions.'),
  ('GWAN_FORM', 'HLT:OFFER', 'notice', '★ 효능을 단정하는 표현은 등록되지 않습니다 — "완치 · 치료 · 암 예방 · 부작용 없음 · 의사 추천"은 식품표시광고법 제8조 위반입니다. 인정받은 기능성("면역력 증진에 도움을 줄 수 있음")은 그대로 적으셔도 됩니다. 의약품과 의료 서비스는 이 관에서 취급하지 않습니다.', '★ Claims that assert efficacy cannot be registered — "cure · treatment · cancer prevention · no side effects · doctor recommended" violate Article 8 of the Food Labeling and Advertising Act. Approved functions (e.g. "may help support immunity") may be stated as they are. Medicines and medical services are not handled in this section.'),
  ('GWAN_FORM', 'HLT:OFFER', 'subject', '건강상품', 'Health product'),
  ('GWAN_FORM', 'HLT:OFFER', 'title_hint', '어떤 건강상품인가요?', 'What health product is it?'),
  ('GWAN_FORM', 'HLT:REQUEST', 'body_hint', '용도 · 수량 · 납품 주기 · 인증 요건을 적어 주십시오.', 'Enter the purpose, quantity, delivery cycle and certification requirements.'),
  ('GWAN_FORM', 'HLT:REQUEST', 'notice', '건강기능식품은 인증 여부를 함께 적으시면 맞는 곳을 더 빨리 찾습니다. 의약품은 이 관에서 소개하실 수 없습니다.', 'For health functional foods, including the certification status helps find a match faster. Medicines cannot be referred in this section.'),
  ('GWAN_FORM', 'HLT:REQUEST', 'subject', '건강상품', 'Health product'),
  ('GWAN_FORM', 'HLT:REQUEST', 'title_hint', '어떤 건강상품을 찾으시나요?', 'What health product are you looking for?'),
  ('GWAN_FORM', 'LED:OFFER', 'body_hint', '받으실 지역과 업종을 고르세요.', 'Choose the regions and business types you want to receive.'),
  ('GWAN_FORM', 'LED:OFFER', 'notice', '문의를 받으시려면 업종별 자격 확인이 필요합니다. 받으신 건마다 리드료가 부과됩니다.', 'To receive inquiries, you need a qualification check for each business type. A lead fee is charged for each inquiry you receive.'),
  ('GWAN_FORM', 'LED:OFFER', 'subject', '상담 문의', 'Consultation inquiry'),
  ('GWAN_FORM', 'LED:OFFER', 'title_hint', '어떤 문의를 받으시겠습니까?', 'What inquiries will you receive?'),
  ('GWAN_FORM', 'LED:REQUEST', 'body_hint', '지역과 원하시는 조건을 적어 주세요. 연락처는 암호화되어 저장됩니다.', 'Describe the region and the conditions you want. Your contact details are stored encrypted.'),
  ('GWAN_FORM', 'LED:REQUEST', 'notice', '남기신 문의는 해당 업종의 자격을 확인받은 업체에만 전달됩니다. 연락처는 전달 전까지 공개되지 않습니다.', 'Your inquiry is sent only to companies verified for that business type. Your contact details are not disclosed until then.'),
  ('GWAN_FORM', 'LED:REQUEST', 'subject', '상담 문의', 'Consultation inquiry'),
  ('GWAN_FORM', 'LED:REQUEST', 'title_hint', '어떤 상담이 필요하신가요?', 'What consultation do you need?'),
  ('GWAN_FORM', 'MAL:OFFER', 'body_hint', '위치·면적·조건을 적어 주세요', 'Describe the location, area and conditions'),
  ('GWAN_FORM', 'MAL:OFFER', 'notice', '부동산·장비를 소개하고 소개비를 받습니다. 중개보수가 아닌 소개비입니다.', 'Refer real estate or equipment and receive a referral fee. This is a referral fee, not a brokerage fee.'),
  ('GWAN_FORM', 'MAL:OFFER', 'subject', '매물', 'Listing'),
  ('GWAN_FORM', 'MAL:OFFER', 'title_hint', '어떤 매물인가요?', 'What listing is it?'),
  ('GWAN_FORM', 'MAL:REQUEST', 'body_hint', '원하는 위치와 조건을 적어 주세요', 'Describe the location and conditions you want'),
  ('GWAN_FORM', 'MAL:REQUEST', 'notice', '찾는 매물을 올리면 소개자가 제안합니다.', 'Post the listing you are looking for, and referrers will make proposals.'),
  ('GWAN_FORM', 'MAL:REQUEST', 'subject', '매물', 'Listing'),
  ('GWAN_FORM', 'MAL:REQUEST', 'title_hint', '어떤 매물을 찾으시나요?', 'What listing are you looking for?'),
  ('GWAN_FORM', 'MNY:OFFER', 'body_hint', '사양·조건·인수 가능 시기를 적어 주세요', 'Describe the specifications, conditions and when it can be taken over'),
  ('GWAN_FORM', 'MNY:OFFER', 'notice', '상품·서비스를 소개하고 소개비를 받습니다. 등록 후 검수를 거쳐 노출됩니다.', 'Refer products or services and receive a referral fee. It goes live after review.'),
  ('GWAN_FORM', 'MNY:OFFER', 'subject', '상품·서비스', 'Product · service'),
  ('GWAN_FORM', 'MNY:OFFER', 'title_hint', '무엇을 소개하시나요?', 'What are you referring?'),
  ('GWAN_FORM', 'MNY:REQUEST', 'body_hint', '필요한 사양과 조건을 적어 주세요', 'Describe the specifications and conditions you need'),
  ('GWAN_FORM', 'MNY:REQUEST', 'notice', '필요한 상품·서비스를 올리면 소개자가 제안합니다.', 'Post the product or service you need, and referrers will make proposals.'),
  ('GWAN_FORM', 'MNY:REQUEST', 'subject', '상품·서비스', 'Product · service'),
  ('GWAN_FORM', 'MNY:REQUEST', 'title_hint', '무엇을 찾으시나요?', 'What are you looking for?'),
  ('INTRO_GRADE', 'EXPERT', 'benefit', '검색 우선노출', 'Priority in search'),
  ('INTRO_GRADE', 'EXPERT', 'criteria', '특정 분야 유효 연결 3건', '3 valid connections in one field'),
  ('INTRO_GRADE', 'EXPERT', 'name', '전문 소개자', 'Expert referrer'),
  ('INTRO_GRADE', 'EXPERT', 'next_hint', '수락률 70% 이상 · 좋은 평가면 우수 소개자', 'Top referrer with 70%+ acceptance and good reviews'),
  ('INTRO_GRADE', 'REGION_PARTNER', 'benefit', '지역 페이지 노출', 'Shown on regional pages'),
  ('INTRO_GRADE', 'REGION_PARTNER', 'criteria', '지역 활동 기준 충족', 'Meets regional activity criteria'),
  ('INTRO_GRADE', 'REGION_PARTNER', 'name', '지역 파트너', 'Regional partner'),
  ('INTRO_GRADE', 'SEED', 'benefit', '기본 요청 확인', 'View basic requests'),
  ('INTRO_GRADE', 'SEED', 'criteria', '본인인증 · 프로필 완료', 'Identity verified · profile completed'),
  ('INTRO_GRADE', 'SEED', 'name', '새싹 소개자', 'Sprout referrer'),
  ('INTRO_GRADE', 'SEED', 'next_hint', '첫 유효 연결 1건이면 인증 소개자', 'Verified referrer after your first valid connection'),
  ('INTRO_GRADE', 'TOP', 'benefit', '요청 우선배정', 'Priority request assignment'),
  ('INTRO_GRADE', 'TOP', 'criteria', '수락률 70% 이상 · 좋은 평가', '70%+ acceptance · good reviews'),
  ('INTRO_GRADE', 'TOP', 'name', '우수 소개자', 'Top referrer'),
  ('INTRO_GRADE', 'TOP', 'next_hint', '지역 활동 기준을 채우면 지역 파트너', 'Regional partner once you meet regional activity criteria'),
  ('INTRO_GRADE', 'VERIFIED', 'benefit', '인증배지 · 맞춤 알림', 'Verified badge · tailored alerts'),
  ('INTRO_GRADE', 'VERIFIED', 'criteria', '첫 유효 연결 완료', 'First valid connection completed'),
  ('INTRO_GRADE', 'VERIFIED', 'name', '인증 소개자', 'Verified referrer'),
  ('INTRO_GRADE', 'VERIFIED', 'next_hint', '유효 연결 3건이면 전문 소개자', 'Expert referrer after 3 valid connections'),
  ('NOTIFY_EVENT', 'BADGE_EXPIRING', 'name', '급구 만료 임박', 'Urgent badge expiring soon'),
  ('NOTIFY_EVENT', 'BADGE_GRANTED', 'name', '배지 부여', 'Badge granted'),
  ('NOTIFY_EVENT', 'BADGE_REJECTED', 'name', '배지 반려', 'Badge rejected'),
  ('NOTIFY_EVENT', 'BIZAXIS_REQUEST', 'name', '창업 축 문의 도착', 'Startup inquiry received'),
  ('NOTIFY_EVENT', 'BIZQUICK_OFFER', 'name', '빠른 매칭 제안 도착', 'Quick match proposal received'),
  ('NOTIFY_EVENT', 'BIZ_CHANGE_DECIDED', 'name', '사업자 정보 변경 처리', 'Business info change processed'),
  ('NOTIFY_EVENT', 'BUSINESS_APPROVED', 'name', '사업자 인증 완료', 'Business verification completed'),
  ('NOTIFY_EVENT', 'BUSINESS_REJECTED', 'name', '사업자 인증 반려', 'Business verification rejected'),
  ('NOTIFY_EVENT', 'CONTRACT_ISSUED', 'name', '계약서 발급', 'Contract issued'),
  ('NOTIFY_EVENT', 'CONTRACT_NUDGE', 'legal_basis', '계약 이행에 관한 통지', 'Notice on contract performance'),
  ('NOTIFY_EVENT', 'CONTRACT_NUDGE', 'name', '계약 확인 요청', 'Contract confirmation request'),
  ('NOTIFY_EVENT', 'CONTRACT_SIGN_REQUIRED', 'name', '서명 요청', 'Signature request'),
  ('NOTIFY_EVENT', 'DEAL_CONFIRMED', 'name', '성사 확정', 'Deal confirmed'),
  ('NOTIFY_EVENT', 'DIRECTORY_ENDED', 'legal_basis', '유상 계약 기간 안내', 'Notice of paid contract period'),
  ('NOTIFY_EVENT', 'DIRECTORY_ENDED', 'name', '정액 노출 기간 종료', 'Flat-rate listing period ended'),
  ('NOTIFY_EVENT', 'DIRECTORY_EXPIRING', 'legal_basis', '유상 계약 기간 안내', 'Notice of paid contract period'),
  ('NOTIFY_EVENT', 'DIRECTORY_EXPIRING', 'name', '정액 노출 만료 7일 전', 'Flat-rate listing ends in 7 days'),
  ('NOTIFY_EVENT', 'DIRECTORY_RENEW_DECIDED', 'legal_basis', '유상 계약 · 입금 확인', 'Paid contract · payment confirmation'),
  ('NOTIFY_EVENT', 'DIRECTORY_RENEW_DECIDED', 'name', '정액 노출 연장 처리', 'Flat-rate listing renewal processed'),
  ('NOTIFY_EVENT', 'DISPUTE_OPENED', 'name', '분쟁 접수', 'Dispute received'),
  ('NOTIFY_EVENT', 'DISPUTE_RESOLVED', 'name', '분쟁 처리 완료', 'Dispute resolved'),
  ('NOTIFY_EVENT', 'FULFILL_CONFIRM_REQUEST', 'name', '이행 확인 요청', 'Fulfilment confirmation request'),
  ('NOTIFY_EVENT', 'INQUIRY_ANSWERED', 'name', '문의 답변', 'Inquiry answered'),
  ('NOTIFY_EVENT', 'INQUIRY_RECEIVED', 'name', '새 문의', 'New inquiry'),
  ('NOTIFY_EVENT', 'INTRO_INVITE', 'legal_basis', '수신자 동의를 구하는 안내. 동의 전에는 연락처가 요청자에게 전달되지 않습니다.', 'A notice asking for the recipient''s consent. Contact details are not shared with the requester before consent.'),
  ('NOTIFY_EVENT', 'INTRO_INVITE', 'name', '소개 초대', 'Referral invitation'),
  ('NOTIFY_EVENT', 'LISTING_APPROVED', 'name', '등록 승인', 'Listing approved'),
  ('NOTIFY_EVENT', 'LISTING_REJECTED', 'name', '등록 반려', 'Listing rejected'),
  ('NOTIFY_EVENT', 'LISTING_RESTRICTED', 'name', '제한업종 지정으로 노출 중단', 'Hidden due to restricted category'),
  ('NOTIFY_EVENT', 'LISTING_SUBMITTED', 'name', '등록 접수', 'Listing received'),
  ('NOTIFY_EVENT', 'LOGIN_LOCKED', 'legal_basis', '계정 보안 — 남이 비밀번호를 맞혀 보는 중일 수 있습니다', 'Account security — someone may be trying to guess your password'),
  ('NOTIFY_EVENT', 'LOGIN_LOCKED', 'name', '로그인 잠금', 'Login locked'),
  ('NOTIFY_EVENT', 'MESSAGE_RECEIVED', 'name', '새 메시지', 'New message'),
  ('NOTIFY_EVENT', 'NOTICE_PUBLISHED', 'name', '공지 등록', 'Notice posted'),
  ('NOTIFY_EVENT', 'PASSWORD_CHANGED', 'legal_basis', '계정 보안 — 본인이 바꾸지 않았으면 바로 알아야 합니다', 'Account security — you need to know right away if you didn''t change it'),
  ('NOTIFY_EVENT', 'PASSWORD_CHANGED', 'name', '비밀번호 변경', 'Password changed'),
  ('NOTIFY_EVENT', 'PAYMENT_REPORTED', 'name', '대금 지급 신고', 'Payment reported'),
  ('NOTIFY_EVENT', 'POSTING_SUSPENDED', 'legal_basis', '이용약관 제12조(이용 제한 — 사유 통지)', 'Terms of Service Article 12 (usage restriction — notice of reason)'),
  ('NOTIFY_EVENT', 'POSTING_SUSPENDED', 'name', '등록 일시 정지', 'Posting temporarily suspended'),
  ('NOTIFY_EVENT', 'PROMO_ENDING', 'legal_basis', 'B-14 자동 유료 전환 고지', 'B-14 notice of automatic switch to paid plan'),
  ('NOTIFY_EVENT', 'PROMO_ENDING', 'name', '무료 기간 종료 예정', 'Free period ending soon'),
  ('NOTIFY_EVENT', 'PROPOSAL_RECEIVED', 'name', '소개 제안 도착', 'Referral proposal received'),
  ('NOTIFY_EVENT', 'QUOTA_EXCEEDED', 'name', '이용 한도 도달', 'Usage limit reached'),
  ('NOTIFY_EVENT', 'REVIEW_SLA_DELAY', 'legal_basis', '이용약관 제6조 ②(영업일 기준 24시간)', 'Terms of Service Article 6 ② (within one business day)'),
  ('NOTIFY_EVENT', 'REVIEW_SLA_DELAY', 'name', '검수 지연 안내', 'Review delay notice'),
  ('NOTIFY_EVENT', 'SAFE_TRADE_AGREE', 'legal_basis', '거래 당사자 확인 절차', 'Procedure to confirm the parties to the deal'),
  ('NOTIFY_EVENT', 'SAFE_TRADE_AGREE', 'name', '안전거래 합의 요청', 'Safe trade agreement request'),
  ('NOTIFY_EVENT', 'SETTLEMENT_BLOCKED_INDIVIDUAL', 'name', '받을 계좌 확인 필요', 'Payout account needs checking'),
  ('NOTIFY_EVENT', 'SETTLEMENT_HELD', 'name', '분쟁으로 정산 보류', 'Settlement held due to dispute'),
  ('NOTIFY_EVENT', 'SETTLEMENT_PAID', 'name', '정산 지급 완료', 'Settlement paid'),
  ('NOTIFY_EVENT', 'SETTLEMENT_REQUESTED', 'name', '정산 신청 접수', 'Settlement request received'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_CARD_UNUSABLE', 'legal_basis', '계약 이행에 관한 통지', 'Notice on contract performance'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_CARD_UNUSABLE', 'name', '결제 수단 사용 불가', 'Payment method unusable'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_NO_METHOD', 'legal_basis', '계약 이행에 관한 통지', 'Notice on contract performance'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_NO_METHOD', 'name', '결제 수단 미등록', 'No payment method registered'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_PAYMENT_FAILED', 'name', '결제 실패', 'Payment failed'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_REFUND_DONE', 'legal_basis', '계약 이행에 관한 통지', 'Notice on contract performance'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_REFUND_DONE', 'name', '구독 환불 완료', 'Subscription refund completed'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_REFUND_FAILED', 'legal_basis', '계약 이행에 관한 통지', 'Notice on contract performance'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_REFUND_FAILED', 'name', '구독 환불 실패', 'Subscription refund failed'),
  ('NOTIFY_EVENT', 'SUBSCRIPTION_RENEWED', 'name', '구독 갱신', 'Subscription renewed'),
  ('NOTIFY_EVENT', 'SUCCESS_STORY_CONSENT', 'legal_basis', '거래 상대 정보 공개 동의', 'Consent to disclose the other party''s information'),
  ('NOTIFY_EVENT', 'SUCCESS_STORY_CONSENT', 'name', '성공 사례 공개 동의 요청', 'Success story disclosure consent request'),
  ('PLAN', 'BASIC', 'features', '소개코드 발급 없음
소개 제안 월 10건
목록 · 상세 열람', 'No referral codes issued
10 referral proposals a month
View lists · details'),
  ('PLAN', 'BASIC', 'name', '베이직', 'Basic'),
  ('PLAN', 'PRO', 'features', '소개코드 월 15건
소개 제안 무제한
우선 노출
전담 CS', '15 referral codes a month
Unlimited referral proposals
Priority exposure
Dedicated CS'),
  ('PLAN', 'PRO', 'name', '프로', 'Pro'),
  ('PLAN', 'STANDARD', 'features', '소개코드 월 3건
소개 제안 월 50건
등록 무제한
정산 신청', '3 referral codes a month
50 referral proposals a month
Unlimited listings
Settlement requests'),
  ('PLAN', 'STANDARD', 'name', '스탠다드', 'Standard'),
  ('REPORT_REASON', 'BIZ_REVENUE', 'label', '매출을 부풀렸습니다', 'Revenue is inflated'),
  ('REPORT_REASON', 'CONTACT', 'label', '연락처 · 외부 유도', 'Contact details · off-platform solicitation'),
  ('REPORT_REASON', 'DUPLICATE', 'label', '같은 내용 반복 등록', 'Same content posted repeatedly'),
  ('REPORT_REASON', 'FAKE', 'label', '허위 · 과장된 내용', 'False · exaggerated content'),
  ('REPORT_REASON', 'HLT_EFFICACY', 'label', '효능을 과장했습니다', 'Efficacy is exaggerated'),
  ('REPORT_REASON', 'MAL_FAKE', 'label', '없는 매물입니다', 'The listing does not exist'),
  ('REPORT_REASON', 'MNY_QUALITY', 'label', '설명과 물건이 다릅니다', 'The item differs from the description'),
  ('REPORT_REASON', 'OTHER', 'label', '기타', 'Other'),
  ('REPORT_REASON', 'RESTRICTED', 'label', '등록할 수 없는 업종', 'Prohibited business type'),
  ('REPORT_REASON', 'SPAM', 'label', '광고 · 도배', 'Advertising · spam'),
  ('REPORT_REASON', 'WRONG_CAT', 'label', '업종이 맞지 않음', 'Wrong business category'),
  ('UI_MESSAGE', 'AD_NOTICE', 'message', '광고 영역은 유료 노출입니다.', 'Ad areas are paid placements.'),
  ('UI_MESSAGE', 'BUSINESS_ONLY', 'message', '개인 회원도 본인인증으로 모든 업무를 하실 수 있습니다. 사업자 인증은 사업자로 소개비(세금계산서)를 받으실 때 하시면 됩니다.', 'Individual members can do everything after identity verification. Business verification is only needed when you receive referral fees (tax invoices) as a business.'),
  ('UI_MESSAGE', 'CTA_ATTRIBUTION', 'message', '대화가 시작되면 소개코드가 발급됩니다', 'A referral code is issued when the conversation starts'),
  ('UI_MESSAGE', 'CTA_ATTRIBUTION_NOTE', 'message', '1:1 대화가 시작되는 순간 소개코드가 발급되고 귀속이 시작됩니다 (INV-2). 전화나 외부 연락으로 진행하면 귀속되지 않습니다.', 'The referral code is issued and attribution begins the moment a 1:1 conversation starts (INV-2). Deals made by phone or other outside contact are not attributed.'),
  ('UI_MESSAGE', 'DISPUTE_HOLD', 'message', '접수하면 해당 거래의 정산이 자동으로 보류됩니다.', 'Once filed, that deal''s settlement is automatically put on hold.'),
  ('UI_MESSAGE', 'EDIT_REREVIEW', 'message', '수정하면 다시 검수를 받습니다. 부여된 배지도 회수됩니다.', 'Editing sends it for review again. Any badges granted are also withdrawn.'),
  ('UI_MESSAGE', 'FEE_A12_DETAIL', 'message', '소개비는 요율표로 산정하지 않습니다 (A-12). 1:1 대화에서 당사자끼리 정합니다.', 'Referral fees are not set by a rate table (A-12). The parties agree on them in the 1:1 conversation.'),
  ('UI_MESSAGE', 'FEE_A12_LIST', 'message', '소개비는 요율표가 아니라 당사자 협의로 정합니다 (A-12)', 'Referral fees are agreed between the parties, not set by a rate table (A-12)'),
  ('UI_MESSAGE', 'FEE_NOT_CALCULATED', 'message', '플랫폼이 계산하지 않습니다. 최종 금액은 당사자 합의로 정해집니다.', 'The platform does not calculate this. The final amount is agreed between the parties.'),
  ('UI_MESSAGE', 'MANUAL_REVIEW', 'message', '신청하면 담당자가 확인합니다. 자동 승인되지 않습니다.', 'A staff member reviews your application. It is not approved automatically.'),
  ('UI_MESSAGE', 'NO_DEDUCTION', 'message', '소개비는 공제 없이 전액 지급됩니다.', 'Referral fees are paid in full with no deduction.'),
  ('UI_MESSAGE', 'QNA_MASKED', 'message', '공개 문의는 누구나 볼 수 있습니다. 연락처는 자동으로 가려집니다.', 'Public questions are visible to everyone. Contact details are hidden automatically.'),
  ('UI_MESSAGE', 'REVIEW_SLA_NOTE', 'message', '등록하면 검수를 거칩니다. 영업일 기준 24시간 이내에 처리되고, 반려되면 사유와 수정 가이드가 함께 옵니다.', 'Registrations are reviewed within one business day (24 hours, counting business days only). If rejected, you receive the reason and a guide to fix it.'),
  ('UI_MESSAGE', 'RE_EXPOSURE_A07', 'message', '부동산은 소개비가 아니라 노출료입니다 (A-07). 금액 체계가 아직 정해지지 않아 이 관의 부동산 건은 정산이 생성되지 않습니다.', 'For real estate this is a listing fee, not a referral fee (A-07). The fee structure is not set yet, so no settlements are created for real estate deals in this section.'),
  ('UI_MESSAGE', 'STUB_NOTICE', 'message', '연동 준비 중 — 실제 확인이 이루어지지 않았습니다.', 'Integration in preparation — no actual verification has been done.'),
  ('UI_MESSAGE', 'THIN_CONTENT_HINT', 'message', '30자 미만이면 담당자가 확인합니다. 자세히 적을수록 빨리 노출됩니다.', 'If it is under 30 characters, a staff member reviews it. The more detail you give, the faster it goes live.'),
  ('UI_MESSAGE', 'VERIFIED_DOC_SCOPE', 'message', '서류의 존재와 일치만 확인합니다. 거래의 안전을 보증하지 않습니다.', 'We only check that documents exist and match. This does not guarantee the safety of the deal.')
  ) AS v(t, id, f, ko, en)
  CROSS JOIN LATERAL public.fn_i18n_source(v.t, v.id, v.f) s
 WHERE s.src = v.ko
   AND EXISTS (SELECT 1 FROM public.i18n_langs l WHERE l.code = 'en')
ON CONFLICT (target_type, target_id, field, lang) DO NOTHING;

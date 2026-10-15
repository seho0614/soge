-- =====================================================================
-- B900_reference_data
--
-- 기준 데이터. 관 · 요금제 · 금칙어 · 코드 라벨 · 약관 · 알림 문구 등
-- 서비스가 동작하려면 반드시 있어야 하는 값들입니다.
--
-- 검증된 상태(불변식 135 · 공격 37 · 문서 22 통과)에서 생성된 기준선입니다.
-- 손으로 고치지 마십시오.
-- 스키마를 바꾸려면 prisma/migrations/ 에 새 파일을 추가하십시오.
-- =====================================================================

-- 트리거가 이 적재를 막지 않도록 잠시 내립니다.
SET session_replication_role = 'replica';

INSERT INTO public.gwans (code, name, description, is_active, opened_at, sort_order, parent_code, is_primary, is_hub, sale_mode) VALUES ('MNY', '소개머니', '기업 간 재화·서비스 소개', true, NULL, 2, 'EARN', false, false, 'BROKER');
INSERT INTO public.gwans (code, name, description, is_active, opened_at, sort_order, parent_code, is_primary, is_hub, sale_mode) VALUES ('MAL', '소개몰', '부동산·장비 등 고정자산 소개', true, NULL, 3, 'EARN', false, false, 'BROKER');
INSERT INTO public.gwans (code, name, description, is_active, opened_at, sort_order, parent_code, is_primary, is_hub, sale_mode) VALUES ('BIZ', '소개창업', '프랜차이즈·창업 소개', true, NULL, 4, 'EARN', false, false, 'BROKER');
INSERT INTO public.gwans (code, name, description, is_active, opened_at, sort_order, parent_code, is_primary, is_hub, sale_mode) VALUES ('EARN', '소개하고 벌기', '내가 아는 사람과 기업을 필요한 곳에 연결하고 소개비를 받습니다', true, NULL, 0, NULL, true, true, 'BROKER');
INSERT INTO public.gwans (code, name, description, is_active, opened_at, sort_order, parent_code, is_primary, is_hub, sale_mode) VALUES ('HLT', '건강몰', '건강식품 · 건강기능식품 · 운동 재활 용품을 소개로 잇습니다. 의약품과 의료기기는 취급하지 않습니다.', true, NULL, 5, NULL, false, false, 'DIRECT');
INSERT INTO public.gwans (code, name, description, is_active, opened_at, sort_order, parent_code, is_primary, is_hub, sale_mode) VALUES ('LED', '소개리드', '리드관 (흡수안 채택 시 활성화)', false, NULL, 6, 'EARN', false, false, 'BROKER');
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('HERO', NULL, '메인 히어로 광고 칸', 780, 421, true, '메인 상단 — 영상이 있던 자리(780×421). 성향 세그먼트별로 다른 소재가 나갑니다.', '780×421', false);
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('ENTRY', NULL, '메인 진입 전면 광고', 560, 360, true, '메인 진입 시 1회. 오늘 하루 보지 않기를 누르면 그날은 뜨지 않습니다.', '560×360', false);
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('FLOAT', NULL, '우측 하단 플로팅 배너', 300, 120, true, '메인 · 관 랜딩. 닫으면 그 세션 동안 뜨지 않습니다.', '300×120', false);
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('RECS', NULL, 'AI 추천 상단 스폰서', NULL, NULL, true, '추천 목록 위. 점수 계산에 넣지 않고 ''광고''로 따로 표기합니다.', '목록형', false);
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('INFEED', NULL, '목록 인피드', 360, 270, true, '관 목록 · 검색 결과 · 소개받기 목록. N건마다 1개가 카드 모양으로 섞입니다. **추천 점수에 넣지 않고 "광고"로 따로 표기합니다** — 섞이면 목록 신뢰가 무너집니다.', '{"every":8,"maxPerView":3,"label":"광고"}', false);
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('GHERO', NULL, '관 랜딩 상단', 780, 421, true, '소개머니 · 소개몰 · 소개창업 상단. 메인 HERO 와 같은 규격이며 **관을 옮길 때마다** 노출됩니다.', '{"perGwan":1}', false);
INSERT INTO public.ad_slots (code, gwan_code, name, width, height, is_active, placement, spec, in_ranking) VALUES ('DTAIL', NULL, '상세 하단', 680, 200, true, '상품 · 매물 상세 맨 아래. 다 보고 "비슷한 걸 더 볼까" 하는 자리라 **노출 수는 적어도 클릭률이 높습니다.**', '{"below":"contact"}', false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('7b5db57a-670f-4d99-975a-2f731e5c0d21', 'HERO', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2027-09-30 23:59:59+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-101', '세바코리아 (SEBA SUN)', '에너지', '지붕만 빌려주면 임대 수익으로 돌아옵니다', '공장 · 창고 지붕 1,000평 이상이면 설치비 0원. 20년 임대료를 먼저 계산해 드립니다.', '수익 계산해 보기', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('af13e1b2-89d6-42a7-b12f-805e32c07ab4', 'HERO', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2027-09-30 23:59:59+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-102', '한빛프랜차이즈', '창업', '가맹 상담 전에 점포부터 보십시오', '권리금 · 월세 · 예상 매출을 같은 표에서 비교합니다. 브랜드 32곳 자료 무료.', '점포 비교표 받기', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('94392804-a30c-4b2d-ad13-ca31dfec10dc', 'HERO', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2026-10-31 23:59:59+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-103', '대한풀필먼트', '물류', '월 3,000박스부터 3PL 단가 협상', '수도권 4개 센터 · 당일 출고. 물량 구간별 단가표를 먼저 보내 드립니다.', '단가표 요청', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('6792bc7e-7f6d-4b80-a9ca-51154b8a55c1', 'HERO', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2027-09-30 23:59:59+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-104', '현장인테리어', '시공', '상가 인테리어 견적 3곳 비교', '실측 후 3일 안에 견적 3건. 공사 중 매출 손실을 줄이는 야간 시공도 가능합니다.', '견적 3건 받기', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('a66dfc08-837c-4905-8c43-3c7e190a781f', 'HERO', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2027-09-30 23:59:59+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-105', '클릭웍스', 'IT · 마케팅', '홈페이지 없이 견적 문의만 받는 방법', '검색 노출부터 상담 접수까지 2주. B2B 업종 전용 랜딩 템플릿 12종.', '템플릿 보기', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('9bf7fb47-a82c-496c-8002-c41f83c66830', 'ENTRY', NULL, NULL, NULL, NULL, NULL, 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-106', '소개뱅크 (자사)', '자사', '소개비는 한 푼도 떼지 않습니다', '플랫폼 공제 0%. 소개코드가 붙은 건은 성사 시 전액 소개자에게 갑니다.', '소개합니다', 'reg', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('2609c033-16a3-4919-ab68-eec285fd146d', NULL, NULL, NULL, NULL, NULL, NULL, 'BLOCKED', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-108', '신용머니대부', '대부', '(등록 거부) 대부 광고 소재', 'INV-6 제한업종. 등록 단계에서 거부되었고 슬롯 지정 자체가 열리지 않습니다.', NULL, NULL, true, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('cd43a282-a2e6-4731-8291-082cc31105b0', 'FLOAT', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2027-09-30 23:59:59+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-109', '세무법인 정도', '세무', '창업 첫 해 세금, 미리 계산해 드립니다', '업종별 예상 세액과 절세 항목을 1페이지로. 기장 계약 없이도 봐 드립니다.', '예상 세액 보기', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('ebd37aea-6f7f-4873-888c-f63d79777f2c', 'DTAIL', NULL, NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 2180, 131, '2026-09-14 07:01:43.012413+00', 'AD-206', '정도세무법인 (데모)', '세무', '창업 첫 해 세금, 미리 계산해 드립니다', '업종과 예상 매출만 알려주시면 1년 치 세금을 미리 보여 드립니다.', '예상 세액 보기', '/biz', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('6f6cbf4a-9c38-4320-8222-e7b06c8fedb4', 'INFEED', NULL, NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 12460, 402, '2026-09-14 07:01:43.012413+00', 'AD-202', '현장인테리어 (데모)', '시공', '상가 인테리어 견적 3곳 비교', '평수와 업종만 알려주시면 시공사 3곳 견적을 한 번에 받습니다.', '견적 비교', '/money', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('31ed3bbb-5d69-4f14-b16a-3f45d9dc458b', 'INFEED', NULL, NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 9870, 241, '2026-09-14 07:01:43.012413+00', 'AD-203', '한빛프랜차이즈 (데모)', '창업', '가맹 상담 전에 점포부터 보십시오', '상권 분석과 예상 매출을 먼저 확인하고 결정하십시오.', '상권 보기', '/biz', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('ee9f4a27-9313-4f1f-951d-37dd35ea997b', 'GHERO', NULL, NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 6240, 268, '2026-09-14 07:01:43.012413+00', 'AD-204', '세바코리아 (데모)', '에너지', '지붕만 빌려주면 임대 수익으로 돌아옵니다', '공장 · 창고 지붕 1,000평 이상이면 설치비 0원. 20년 임대료를 먼저 계산해 드립니다.', '수익 계산해 보기', '/money', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('901840b3-b302-4c1e-9e67-2d9c1aca45e4', 'GHERO', NULL, NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 4910, 152, '2026-09-14 07:01:43.012413+00', 'AD-205', '클릭웍스 (데모)', 'IT · 마케팅', '홈페이지 없이 견적 문의만 받는 방법', '상담 페이지 하나로 문의를 받고, 응대는 카톡으로 이어집니다.', '사례 보기', '/biz', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('ae30f539-5db4-4b9d-b035-ee4e98db7752', 'DTAIL', NULL, NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 1740, 96, '2026-09-14 07:01:43.012413+00', 'AD-207', '안심보증 (데모)', '금융', '계약 전에 상대 회사 재무를 확인하십시오', '사업자번호만 있으면 휴폐업 · 체납 · 소송 이력을 한 번에 봅니다.', '조회해 보기', '/money', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('9d502804-dd56-4d11-8573-b6d84f9674e7', 'RECS', NULL, NULL, NULL, '2026-09-01 00:00:00+00', '2026-12-14 00:00:00+00', 'ACTIVE', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-110', '부산상가전문 리얼티', '부동산', '해운대 상가 · 이번 주 신규 12건', '권리금 조정 가능 매물만 모았습니다. 중개보수는 성사 후에만 받습니다.', '매물 보기', NULL, false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('a6661299-ad49-426c-96ed-2959629c33e7', 'INFEED', 'a41219a7-2837-4d48-b653-82f68f28a4c7', NULL, NULL, '2026-09-14 00:00:00+00', '2026-12-13 00:00:00+00', 'ACTIVE', 14820, 385, '2026-09-14 07:01:43.012413+00', 'AD-201', '대한풀필먼트 (데모)', '물류', '월 3,000박스부터 3PL 단가 협상', '보관 · 피킹 · 배송을 한 곳에서. 물량에 따라 단가가 내려갑니다.', '단가표 받기', '/money', false, NULL, NULL, false);
INSERT INTO public.ad_placements (id, slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status, impressions, clicks, created_at, creative_code, advertiser, category, title, body, cta, landing_route, is_regulated, review_no, review_confirmed_at, attribution_enabled) VALUES ('fe03b3f1-ce2f-4fdf-8ad9-d2ce754a8cf2', NULL, NULL, NULL, NULL, NULL, NULL, 'DRAFT', 0, 0, '2026-09-08 12:52:02.71329+00', 'AD-107', '하나로의원', '의료', '(심의 대기) 의료 광고 소재', '의료법 제27조 · 심의필 번호를 확인하기 전에는 어떤 슬롯에도 배정되지 않습니다.', NULL, NULL, true, NULL, NULL, false);
INSERT INTO public.ad_segments (code, name, description, sort_order) VALUES ('SEG-A', '부동산 · 점포 매수 관심', '상가 · 건물 · 점포 매물과 권리금 거래를 우선으로 봅니다.', 0);
INSERT INTO public.ad_segments (code, name, description, sort_order) VALUES ('SEG-B', '창업 · 가맹 준비', '가맹 브랜드와 점포 양수도, 초기 자금을 함께 봅니다.', 1);
INSERT INTO public.ad_segments (code, name, description, sort_order) VALUES ('SEG-C', '공급망 · 물류 확장', '납품처 · 물류 · 창고를 늘리는 단계입니다.', 2);
INSERT INTO public.ad_segments (code, name, description, sort_order) VALUES ('SEG-D', '시공 · 설비 수요', '인테리어 · 설비 · 시공 업체를 찾습니다.', 3);
INSERT INTO public.ad_segments (code, name, description, sort_order) VALUES ('SEG-E', '디지털 전환 · 마케팅', '홈페이지 · 광고 · 시스템 구축을 검토합니다.', 4);
INSERT INTO public.ad_segments (code, name, description, sort_order) VALUES ('SEG-F', '에너지 · 자산 운용', '태양광 · 발전 · 유휴자산 수익화에 관심이 있습니다.', 5);
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('7b5db57a-670f-4d99-975a-2f731e5c0d21', 'SEG-F');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('7b5db57a-670f-4d99-975a-2f731e5c0d21', 'SEG-A');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('af13e1b2-89d6-42a7-b12f-805e32c07ab4', 'SEG-B');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('af13e1b2-89d6-42a7-b12f-805e32c07ab4', 'SEG-A');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('94392804-a30c-4b2d-ad13-ca31dfec10dc', 'SEG-C');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('6792bc7e-7f6d-4b80-a9ca-51154b8a55c1', 'SEG-D');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('6792bc7e-7f6d-4b80-a9ca-51154b8a55c1', 'SEG-A');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('a66dfc08-837c-4905-8c43-3c7e190a781f', 'SEG-E');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('cd43a282-a2e6-4731-8291-082cc31105b0', 'SEG-B');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('cd43a282-a2e6-4731-8291-082cc31105b0', 'SEG-F');
INSERT INTO public.ad_creative_segments (creative_id, segment_code) VALUES ('9d502804-dd56-4d11-8573-b6d84f9674e7', 'SEG-A');
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('7ac7d9f5-982a-4e91-96dd-3c341654f125', 'DTAIL', 'WEEK', NULL, 0, true, '도입가 미정 — 3주 실적(실제 노출·클릭)으로 산정합니다. 예상 노출로 먼저 팔면 못 채웠을 때 환불 문제가 됩니다.', true);
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('d66f2e1f-0a13-477d-8e11-4a3f7a217915', 'INFEED', 'WEEK', NULL, 0, true, '도입가 미정 — 3주 실적(실제 노출·클릭)으로 산정합니다. 예상 노출로 먼저 팔면 못 채웠을 때 환불 문제가 됩니다.', true);
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('3a613fd5-811c-4afb-acfb-ef5b886b922a', 'GHERO', 'WEEK', NULL, 0, true, '도입가 미정 — 3주 실적(실제 노출·클릭)으로 산정합니다. 예상 노출로 먼저 팔면 못 채웠을 때 환불 문제가 됩니다.', true);
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('4dc704e6-bcac-4071-b208-53b6842dae3f', 'ENTRY', 'WEEK', NULL, 0, true, '진입 전면 · 하루 1회. 재고가 방문자 수에 갇혀 있어 비쌉니다', true);
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('8d0d221c-3f08-4408-b946-6d2ebf5abf22', 'FLOAT', 'WEEK', NULL, 0, true, '우측 하단 · 세션당 1회. 닫으면 그 세션은 끝입니다', true);
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('f4d7be84-5206-4e21-bb8e-76b588df09a2', 'HERO', 'WEEK', 'REALESTATE', 0, true, '부동산 매물 노출료(A-07). 성사 무관 정액이라 광고와 같은 체계입니다. 가격은 도입가 3주 실적 후 확정 — 지금 0 원은 미정이라는 뜻입니다. · 도입가 미정 — 3주 실적으로 산정', true);
INSERT INTO public.ad_products (id, slot_code, period_unit, category, list_price, is_active, note, is_intro_price) VALUES ('10e04b2b-f9e3-400a-8e3b-d5dbeccd3e99', 'RECS', 'WEEK', 'REALESTATE', 0, true, '부동산 매물 노출료(A-07). 성사 무관 정액이라 광고와 같은 체계입니다. 가격은 도입가 3주 실적 후 확정 — 지금 0 원은 미정이라는 뜻입니다. · 도입가 미정 — 3주 실적으로 산정', true);
INSERT INTO public.attribution_policies (version, window_days, model, allow_channels, effective_from, note) VALUES (1, 90, 'FIRST_TOUCH', '{WEB,MOBILE,CALL,OFFLINE}', '2026-01-01 00:00:00+00', 'INV-2 기준 정책');
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note, is_active, updated_at) VALUES ('PII_BURST', '개인정보 다량 열람', 20, 24, '한 사람이 하루에 이만큼 넘게 열면 확인하십시오.', true, '2026-09-16 14:35:43.254495+00');
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note, is_active, updated_at) VALUES ('PII_NIGHT', '업무 시간 밖 열람', 5, 24, '밤 10시~아침 7시 열람. 이유가 남아야 합니다.', true, '2026-09-16 14:35:43.254495+00');
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note, is_active, updated_at) VALUES ('ADMIN_BURST', '운영 행위 몰림', 50, 24, '자동화 도구를 쓰고 있을 수 있습니다.', true, '2026-09-16 14:35:43.254495+00');
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note, is_active, updated_at) VALUES ('ADMIN_NIGHT', '밤에 운영 행위', 10, 24, '계정이 털렸을 수 있습니다.', true, '2026-09-16 14:35:43.254495+00');
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note, is_active, updated_at) VALUES ('SAME_TARGET', '같은 사람을 반복 열람', 5, 24, '가장 흔한 유출 형태입니다 — 아는 사람을 들여다봅니다.', true, '2026-09-16 14:35:43.254495+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('manual_first_listing', true, NULL, NULL, '신규 사업자의 첫 등록은 사람이 본다', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('manual_fee_threshold', true, 50000000.00, NULL, '소개비가 이 금액 이상이면 사람이 본다', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('manual_after_reject', true, NULL, NULL, '이전에 반려된 적 있으면 사람이 본다', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('manual_gated_category', true, NULL, NULL, '자격 확인이 필요한 업종은 사람이 본다', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('manual_unverified_business', true, NULL, NULL, '사업자 인증 전이면 사람이 본다', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('min_body_length', true, 30.00, NULL, '본문이 이 길이 미만이면 사람이 본다', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('sample_audit_rate', true, 5.00, NULL, '자동승인 건의 사후 표본 감사 비율(%)', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('urgent_max_days', true, 14.00, NULL, '급구 배지 최대 유지 기간(일)', NULL, '2026-09-07 12:05:02.699591+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('urgent_max_active', true, 3.00, NULL, '한 사업자가 동시에 유지할 수 있는 급구 건수', NULL, '2026-09-07 12:05:02.699591+00');
INSERT INTO public.auto_review_policies (key, enabled, num_value, text_value, description, updated_by, updated_at) VALUES ('auto_approve_enabled', true, NULL, NULL, '자동검수 사용 여부. 끄면 전건 수동', NULL, '2026-09-07 12:05:02.692228+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d9405ff5-e59f-45c8-9937-7564aeadaace', '원금보장', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('22ea628a-0786-4e8e-8abd-b2ccebe2ae2d', '원금 보장', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('efcbda78-571c-4bb4-b4e4-ecef599893a0', '확정수익', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4f2d98eb-f410-4529-99d8-90503d256d77', '확정 수익', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c6d2880d-e60d-47a8-a6a7-0d3016164538', '수익보장', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cd62f531-89bc-44db-a5b7-3e99d8370b8f', '고수익보장', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('51909a70-d154-41b8-a89e-96fd33769d03', '월수익 보장', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d3d6816a-8270-4bf5-9a74-c46a9fc0455c', '손실없는', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('62158879-88af-490c-a1d2-fd82368c80af', '무위험', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e32b88eb-d630-4e65-aacb-a82f8e3bfd40', '사채', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5d714888-7eed-4d32-bf58-959d9d3fe53c', '일수', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d0d46b44-2099-406a-9902-896675ad9838', '급전', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('527919cc-7777-4618-868a-81121f27ee68', '작업대출', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('35ff5f2c-f00e-41d6-8b54-e3ff37c81c65', '신용불량자 대출', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1503c582-c99b-4531-a5da-c5698d1511c8', '통장대여', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a287eabe-ce20-458e-a0ce-1b32b8b9cd3b', '통장 대여', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e873e870-276d-40bc-8edf-80a90c061cfe', '명의대여', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('bde61ab2-a7dd-4073-9403-d9f75f1cb928', '명의 대여', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('dec102bc-8243-4d65-85af-19cc917a2845', '대포통장', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3ec6692f-7dd1-46b1-b454-04a93d05ed36', '다단계', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6047c257-e9b6-4053-9127-04b9885eefb8', '네트워크마케팅', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0d3e3bd4-9f35-4b38-985e-6cc1a8644136', '하위사업자 모집', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('164b3a79-af7b-4ed8-97ad-1da8f783e776', '투자자 모집', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1b2e7df9-0902-4935-812c-a5104d5fb069', '소송대리', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('531e7c9b-e2d7-4666-9065-7f999b060ea8', '법률자문 대행', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cda1c336-fb91-4929-9d3e-3f03678598eb', '세무대리', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5dd11946-488e-4aa8-9395-048851f8df92', '취업알선', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('69372363-cd68-4277-889f-fb206c14bd44', '인력파견', 'CONTAINS', 'BLOCK', 'MNY', true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('11b699c2-0777-401b-be47-f5beaf6814dd', '병원 양도', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c1c5497e-99ee-4ef3-82dc-e5ecbb6944df', '의료기관 개설', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4bac50f4-615f-41c4-b646-eba416e61159', '사무장병원', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e1e9f4ec-bdad-4699-855b-4df8ce0e3b96', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('01225978-5e3a-4265-8a71-1caf3a1516c3', '무조건', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('53be3eac-d1ab-43e1-a078-4d7708df6eb6', '절대', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('06d7a398-c378-4ed8-855d-ab40c7d64ad6', '최고', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('19c5f94e-5b46-408a-a79d-9196947ff70a', '최저가', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9fbc9db5-26a5-43c1-af2c-b3f2789f0438', '업계 1위', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b9e5a43a-0881-4b0d-ae62-bfe9d1a06306', '국내 1위', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a4d56200-551d-4004-a8ee-757958c5ce39', '유일한', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('464c2180-7f48-44f1-b6a5-7162e545a328', '반드시', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f98647e1-5e2e-4a6f-8c16-11ae38fe8b1f', '카톡', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3a4e63d0-1c8a-4196-908a-c4ce5a887632', '카카오톡', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('92c0d9c2-5cd8-4040-9fc6-a87cbe86c0b7', '오픈채팅', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9b0a3b2e-b497-4b90-9ffa-3b59107db42b', '오픈카톡', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1a8f073a-c5a7-4f76-84e9-644dff9c7de1', '텔레그램', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8c17642a-29df-4563-b4e4-c9a6357150ce', '직거래', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fcaff603-ba6f-4c8a-9d74-50a96658e506', '직접 연락', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('feca1e40-88d0-4d86-a843-a9ad2323f466', '개인적으로', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('88262dd5-8051-459c-a0dc-966de5511ebb', '수수료 없이', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('299d70d0-9f43-4901-97de-122479dd0a9a', '[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}', 'REGEX', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ba6ed9d3-ae9e-46b4-9500-70197ca054e8', '01[016-9][0-9]{7,8}', 'REGEX', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('25d67353-558f-4937-a972-ab9395c1e440', '불법체류', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ca40e830-c2ed-4489-9a03-53facc4de089', '조선족', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('296dcc11-9b80-4279-991f-b031a9300ed8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:35.304836+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('deb66f3a-e667-44b3-9dfa-196e129fe624', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 06:51:54.504955+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e1517ffe-4622-423b-91e2-99cacafe6d24', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 07:24:22.998495+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6a703561-c228-49b2-bca0-538dbea2d20d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 07:25:40.802617+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('27ffdbdd-6579-453c-a58b-d029c8995cd7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 07:27:08.979972+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('640377dc-32da-49a4-9a99-36289e08f01c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 12:52:03.975846+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('722980fa-03ae-42a7-b2d0-0042c29a4895', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 12:54:37.685262+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f1f5165c-b4ca-4dba-a8b8-3399d5a3c0bf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-08 21:56:32.179726+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('eb6db982-ad24-4b37-b56c-f4a37cb73d4b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 02:54:31.726642+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fe0a9018-c94e-4cff-946b-410aa87d95de', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 07:36:31.250999+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2116b3eb-8b76-4867-a452-5b57e1a6461f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 13:44:09.794474+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cda826c4-5bc4-4980-8fd3-f554e3c8bd74', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 13:48:48.482059+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c323336f-0744-4362-910a-06dc559f157c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 13:49:21.368668+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b1665b16-2322-43fa-b86c-8ae572ea9a01', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 14:10:36.334862+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('265f4a16-956c-4a7b-999d-db8ebb884049', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 14:39:15.712158+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7c772b90-7c14-45a3-b247-e71ba4b8bfa5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 14:54:56.500327+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0c509992-95f7-4eac-9363-2fc1632dfa53', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-09 22:20:03.509455+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d3eef9c5-31d1-4f97-b19a-50096f9b03b9', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 01:53:29.253793+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4f3d2922-7feb-4939-904c-b6e69a8b56cc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:21:19.194801+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('662a1202-c791-43f6-beeb-d1831c472133', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:21:48.99948+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9d2ac2be-2adf-4a8e-8e28-123d2f7e528b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:27:44.703981+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('53501449-8d5f-4a7c-a07b-d6c91616dcc2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:28:58.437152+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b23b16f9-5909-43e5-b3e5-a71ac7cdab42', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:30:43.690521+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9836db85-79bd-4e34-8254-d3f9ebd7e58d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:33:38.115074+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e863c4ec-1bed-48db-bcc8-cf729f89ca21', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:35:48.201104+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6af3edf4-c5e4-4e72-ac4f-4ba92464ee81', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:37:23.709289+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('329da9f5-d803-4859-8b1f-e2163d31b7f6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:38:13.949514+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('178ea954-84ff-475d-9f5b-00908e92f7ba', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:39:20.667079+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9aca6c79-3d8c-475e-9b68-9ab822b1a79a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:41:05.790745+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('53153059-9252-4b21-8fc3-65c84caea178', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:42:50.522236+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9dba512d-2d69-4c16-83ef-332b0d7096dd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:43:36.650357+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('20fa28c4-9162-40a9-a066-8f62c2465ae5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:47:33.909993+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0a9ea422-1378-4fba-a93c-374a5ebb4676', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 06:51:29.988886+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4806bd2c-55a7-4d9e-8529-d04898ad837f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:19:27.627239+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9f530be0-5523-4ccc-928d-7834d176e9c0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:21:15.451352+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('abc4f90e-d740-4629-a842-83f135cbc9d8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:22:16.511967+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ffa94d6c-203f-471f-b2ee-84fdd4b3bbd0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:29:52.852692+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5a21a29c-9077-4ce1-891d-6100ba4e7ad7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:31:19.184109+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a758b2c7-6326-426b-a072-535f450acf4b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:39:15.873092+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c457d22e-a8d0-49ce-bdd2-00ec8acbdaa3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:43:26.97185+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1433bfe2-36a2-47cf-aece-3cf2ec937e4b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 07:49:38.664643+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3b9d3111-b3d4-41bf-b8f9-5ec28dcece60', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 08:14:08.417136+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('52542cd9-d5d7-4ff4-b3e0-6f746fbedf91', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 08:14:34.453402+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4f0ce41a-18ce-422d-9536-a3aceffb4c7d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 08:19:16.482363+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f90c8710-d3bf-4bd3-bf3b-9e8cd3ce2867', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:01:16.104468+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('abc611be-0017-452b-b96f-a436404f72b7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:01:51.283375+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('00c7f84f-dd59-46c5-9e70-aa466b35415f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:02:14.645205+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('58128daf-411c-48c2-a19e-e7c557406d21', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:03:00.310003+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('20b48675-62ab-4c78-bcbc-36666db19429', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:06:01.943111+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fd0b22fd-7347-4a9c-9afc-c5356123cbc4', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:15:06.994539+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('86d02afb-e318-4975-a0b2-7dd3a8f2484f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:29:22.9412+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e5eb7d23-a7c5-4e23-870f-34da6c754726', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:38:02.546289+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('765fc55c-1688-42ca-be55-a9db9dabf12e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:40:28.084303+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('88a75579-9dd9-4448-84e3-69d2662f246b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:40:53.807422+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b3297511-8035-4639-9bef-480b3c7d7159', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-10 12:41:29.928757+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c37436c3-024b-41df-aa13-0af53ad95897', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 06:38:04.692548+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('26db7d80-2b8f-48f9-8f06-e81a35f32cd2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 06:39:23.435998+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('70f3f52f-66d9-40aa-a70a-f7291182bb4b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 12:34:38.503007+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8c9e17a9-8bf7-4ee1-95ba-b9c2328378f5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 12:58:34.934253+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3afeb9d0-8b4f-4ebd-9ee8-f8676a14728a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 12:58:49.618168+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('49130008-edd9-4017-843a-6996aeb22598', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 12:59:09.926456+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('bedbf3a4-6f15-4b83-83d3-25d8a8bb4c2c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 13:04:29.214838+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('329fb17f-4f40-483f-871d-02ba7f712655', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 13:04:52.517165+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('90f0193d-7632-4067-8f44-4449f1eb7a76', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 13:06:16.412496+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7521bfb4-4669-44da-90e4-9b00e99cbb49', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-11 13:12:54.952663+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('880fb836-d0e2-4569-8fae-26db20832842', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 01:44:24.189567+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fa399cd1-4461-4f61-b945-79d614afb7e5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 01:47:23.764892+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fd072b6d-8e64-4dbd-b2c2-54bab1ced982', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 01:50:04.7459+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('465fb5ee-95d5-4ee2-8a81-521b105b9b9b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 07:29:17.718564+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('62f767be-1d86-4f75-b732-c675cb03108b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 07:35:52.967616+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f4174c94-cbb8-4d71-837b-2d36fba0f8a3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 07:43:57.183274+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f20fbc90-797d-4766-a8ba-51b124458c79', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 07:48:58.505227+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('18559df0-92d6-4aab-963b-045802673853', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 08:17:34.300873+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('504e2faf-4788-421e-b7e8-51244cbf5b0e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 08:23:30.123395+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ddc24bc9-de2b-460c-a7c4-6a9dccffeaa4', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 10:10:16.611871+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0301f32d-6e1c-4962-9cb9-1ad35454317f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 10:25:06.672779+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d0074f75-0b56-4473-bb5c-7341b4ffcfcb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:34:53.79718+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6b877726-7cdf-4b0d-b98f-68cc06a66e70', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:35:11.994671+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ee08e52e-5b63-4389-a71e-197fc29d21c3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:35:48.150561+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4cf316e1-9054-4a35-bd5e-d759f6273b55', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:36:05.262796+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('81a16ccf-a06d-46cf-a0d7-403100e75543', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:37:38.544228+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fea95280-32d0-472a-97a7-a967a94d1d50', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:38:03.695055+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('128dd521-3e27-45bc-ae7d-65338d1b68ba', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:38:46.281734+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('add7d9c2-7831-4957-b125-af7134af2d52', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:39:15.401213+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6def580c-ddca-425d-8412-3a43824b52cf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:40:45.160658+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a968c695-78e3-4df6-856a-e3e4f284afee', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:41:11.369538+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5a28ccb6-e37a-46bb-9c9b-255b0518d160', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:41:58.765933+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4f1b1597-336f-40e4-9d19-15c937ba76aa', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:42:45.906914+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('09cb632c-314e-40dc-a8a4-87935f840027', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:43:17.497276+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4afeb735-1c3e-4268-8346-2389faaf9a7a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:43:57.776327+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('836f6d20-1d83-405a-835f-f96ab6e6fcef', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-12 11:48:01.235889+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9717dbe6-6de0-4c48-95bf-63b11f3d6ad7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 03:43:30.193645+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('45381bc6-d3f0-4824-beda-c5840ce9560c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 04:28:54.683639+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1e4ea937-f5b4-4749-ba68-78d78b908979', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 05:30:51.317492+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1c084772-a9ca-45b6-95c0-3fd4439c2f83', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 05:42:57.270369+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5126bf5b-63ac-4387-9899-6021591f9e68', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 05:57:36.383397+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a7e082b5-0d43-4e1b-bb4f-239a6db14451', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:00:10.568231+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cd27a1d0-b633-4340-81b9-728a364b0c5a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:16:18.78064+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c40a6826-20ee-45cb-a4d6-9ee6acfc6499', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:18:35.328153+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6dd456d4-e87b-4256-a0c0-9a26dc3f3d27', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:30:58.834969+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('aaaf6400-976b-4c38-b128-db5b96c98c15', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:47:03.690363+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b0089275-9012-4530-9aca-4a2ab6be17ae', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:51:44.530025+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('874b364b-3885-4125-9cee-61b50fc03e0a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:53:54.327045+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1bf207e5-4518-4b44-9971-9827d2526ed5', '완치', 'CONTAINS', 'BLOCK', 'HLT', true, NULL, '2026-09-14 06:55:37.026861+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2cad18fd-cf1d-40e4-a91a-068b8a36aba8', '암 예방', 'CONTAINS', 'BLOCK', 'HLT', true, NULL, '2026-09-14 06:55:37.026861+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3374f6ad-61f6-459e-9f50-33aba5a11d51', '부작용 없', 'CONTAINS', 'BLOCK', 'HLT', true, NULL, '2026-09-14 06:55:37.026861+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5254327f-bde3-444d-959a-51bd7afb20f3', '의사 추천', 'CONTAINS', 'BLOCK', 'HLT', true, NULL, '2026-09-14 06:55:37.026861+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c75937c3-4a23-414a-b584-65fedb7b7fd5', '당뇨', 'CONTAINS', 'WARN', 'HLT', true, NULL, '2026-09-14 06:55:37.026861+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6497b964-6c42-4cf2-9fb7-6636ac48a76e', '고혈압', 'CONTAINS', 'WARN', 'HLT', true, NULL, '2026-09-14 06:55:37.026861+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('39fa4e8e-9c39-4bbc-87d0-5ce0c9acff63', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:56:28.274394+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fe69999f-1ef6-4115-8747-3e9bad213ff6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:57:35.189994+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('15f2e142-8bc2-4a79-9434-e78b2f0dab75', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 06:59:43.113563+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b880117c-a3dd-4556-a848-302c2751a4ad', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 07:02:30.726104+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2f01bb01-c480-4223-97d8-a42506e87092', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 07:11:05.407648+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8a6f8cff-8fed-45d3-a3fd-2f7b7bd6f8f6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 07:25:07.362857+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('aaae7101-3cd2-4aa8-b211-d7e6ed957757', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 07:26:06.654435+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('dd07386f-3d59-4f71-8b89-bd60650ed36e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 07:32:54.2699+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('631198da-75cc-4fdb-97ff-1f21b0e93265', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 07:39:39.730494+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6dd9cfaa-efc1-49ed-81d3-76c7af959b65', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 12:00:17.119808+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('51f8f161-8899-49b5-ac21-68c2ee25b0d3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 12:25:08.221749+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('55842bc0-913f-4a31-a844-ce92bd708f4f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 13:29:10.552027+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('10bb0754-a007-40da-92b3-1dd09b43525b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 14:46:46.18259+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e089ff5f-72e1-4510-b74e-1c43e3efd199', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 14:47:05.935172+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('146c6967-fb82-46a4-b8c1-11fd555e90ae', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 14:47:32.637935+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e6c6e9b4-7cc1-43d0-9cd6-99d48d126945', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 14:55:58.106602+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8a87ba43-b4ae-4d13-838f-4c5c8e5a07e4', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 14:56:54.4364+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('96137d44-0c80-4405-a5ed-6064f10a9af8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 15:01:20.552369+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d60b587a-c3c5-4360-988f-2998436df562', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 15:32:44.814706+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f923d0f5-bfcd-408a-b1e5-4e73b8f513b6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 16:05:27.644944+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6d4ed901-d930-4ac0-94c4-bd55c41e568b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-14 16:09:58.173306+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1566c1f6-b609-427c-bd81-14c0cff9ae37', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 13:03:51.656553+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('757c5741-0cba-42af-b51b-3e56e6b7768e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 13:05:16.693429+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b67177b0-129b-4b66-8899-04b98789e93f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 13:06:18.975055+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a890cec4-3454-492f-bd69-0c6ff68d020e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 13:16:34.822942+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e38ee384-7a8b-4c43-bfbc-ccb15779677a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 13:17:54.853661+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d6010884-f056-4e5d-8cae-1cee70359632', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 13:20:49.914498+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f68f8989-0f61-427f-b543-27d92f9201e5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:23:26.645198+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('afc52144-9d0b-4047-95d2-0dc6bb109fea', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:23:46.829452+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('57462a91-ea2a-4036-99e8-b53c97871c9d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:24:17.577147+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c0cc29a2-e134-485c-9108-747b6027c8cd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:25:10.540151+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('dea001df-0f76-4f3c-a53e-9f4e1fe38357', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:35:02.608617+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1236f47d-016a-42f7-af2d-21f472b8cbcb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:37:35.151998+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('997710c1-8758-4571-a721-2e518ba19945', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 14:38:41.060028+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d31d3ba3-67f5-4fc0-8fbd-3dd4ee926ce6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 15:01:34.027432+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('671848fc-4ef4-4b4f-a157-61a1607067be', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 15:10:19.209206+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('92174bba-2868-486d-b3ef-ce0f13d093c0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 15:13:05.730406+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c4d06fc4-b220-4e68-94c3-bf5f29ced79b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 19:40:51.749316+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d8d74ce5-5160-4a68-a2bd-03895c9a0ad5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 19:42:26.221086+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('47b73ba2-9f09-4854-a91f-9b7c00f7bfff', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 19:45:56.075503+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('28fad711-e6e7-4151-b925-de08d34f07b8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 19:48:56.983202+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a84037db-3bed-486f-9005-043b222321c3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 19:50:36.667655+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1d308d71-94c6-4d31-8bce-d8a272bcb01b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 20:18:12.967019+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('aa80ce1e-1f82-432f-a7d8-2d6b27db44fe', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 20:20:54.321917+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2ba8fbf2-b985-4ed8-ba01-5b9b91741478', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 20:38:28.136612+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1d35c069-1843-45de-ae77-85bbcecd4fbf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 20:39:19.112422+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0bd7c435-91a0-40c7-b96c-9e7f9cb55545', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 20:59:07.617836+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0827ae76-c2d1-424f-87db-a939db687ce8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 20:59:28.498726+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('86fe8b87-5213-47db-bca0-c8b08f5c0040', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:00:04.152182+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c76b0c76-32ae-490a-ad4b-8bae826812b5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:00:51.431981+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0237bb9f-b435-46eb-a518-62e3fa5a8b13', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:07:30.378065+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c14bde0e-419c-4e25-bd88-b21352a93104', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:16:50.04479+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('18fd0f03-dac8-421d-8bf0-1fe2ed8fbc95', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:18:06.210112+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a5ba7e8e-d23b-45a8-854f-5aaedd173ffb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:18:33.314409+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fd59290d-e19d-4274-be4a-2644771cce9c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:24:19.66142+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('290c4cc3-1650-4e82-964d-91b39e5d58cd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:25:01.283558+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('aa0a6029-1dd9-44ba-9f6a-3486454b995d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:30:02.666929+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('31391cd3-7a47-4272-ae7c-ab540f1a0de0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:53:36.214445+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0bc495f7-067f-49c1-94d3-e6169963395a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:53:54.794496+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b982d5b8-13a6-4fce-9750-c2bc5028f976', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:54:45.287331+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8866e0bf-dd5e-43c0-a1b2-e2925e0cdb70', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:55:04.24936+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b4ac51f7-c095-44d1-84db-1a1f1d26c4a0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 21:55:37.978188+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9def425b-9a63-4516-8954-8d388d4e3375', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-15 22:07:08.289095+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a80f6643-4b76-4656-9f92-bb17570d700e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 05:45:25.769262+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5e5b89a8-97ed-49a6-a48c-709f27ff986c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 05:49:31.706271+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3ca4113a-0cc3-4d40-81ee-97bf2abfaac2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 05:57:36.293161+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a36cb4dd-90f2-4360-9752-ff581a6b8198', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:06:55.330072+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1418233d-1a49-4d31-91e3-7379f1cbfa4e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:07:37.86613+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('66a79759-9710-4147-9886-5df108e544b9', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:19:01.676223+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4c6da7f1-a29d-4963-a4e2-a27a771ea092', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:20:40.306921+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4862f6f0-890c-45e0-b526-874f0c76f2a7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:22:20.699427+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a4ce835c-e586-4dda-a33a-eb8e0ca66523', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:22:57.128665+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b35e7f1d-9919-4ab6-a2ba-fb8b9445af24', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 06:23:24.733363+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9601a82e-2cf9-4ee4-8bc2-2e839b99c284', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 07:29:29.387328+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('39de07ce-4d6d-4b57-a19c-dca58edc05af', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 07:30:32.835797+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('50f5c950-5ba6-4eef-916c-b54a1da1d043', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 08:35:27.910749+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('24bcd8c4-0403-4914-817e-13bbe2c9d909', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 08:38:37.168475+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('20d4f523-45b7-452d-822c-292913db68ee', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:25:57.238596+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('94f11bc4-4605-4aee-b035-99e80784c62d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:26:59.09669+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('314e6d5e-c550-413e-9168-7fe8ec7a9044', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:40:09.673605+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d1371fcc-6d97-4d2d-a94b-08592f0d0b82', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:40:51.464344+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('33d81d71-b069-4d32-875b-d428fb1dfd60', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:48:58.462911+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('109a9ac2-e279-4e46-a64c-94a26881e522', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:49:19.890777+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e0acbfa6-2c42-4f13-ad2f-46d0afed96fa', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:49:49.430123+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('817dd029-75bd-413d-b69e-7686004a7083', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:50:45.706612+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('325a4d5e-6b2e-4535-9caf-789e4abbc677', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:54:01.337058+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d1f7cfe9-a85e-4f18-861f-f74bf1033025', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 11:59:34.605487+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('679bfdb2-7b17-4b4d-be18-efe49ba4be50', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:00:32.891311+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('51547c6e-428b-40f3-8c25-ae0da78a2b9e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:09:15.39421+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c40a2e11-219f-499f-825d-c303f3579bc8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:16:31.674516+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fb945fce-5a03-4e3b-81e9-6ec8cab4265e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:16:49.205004+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('38500db2-9aac-4e10-aa49-9fd96e1dafa4', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:17:39.738832+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('78a2673a-f5f4-48a5-bb71-693ccdd50b00', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:18:40.576136+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('90f4b84b-20d0-4444-87ea-d040f1d3caeb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:18:58.008389+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('75d48025-b549-4e74-adb0-97add08520ff', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:20:14.894827+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e01e5694-df76-4a4b-8293-b1e39a056d51', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:20:32.504302+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ae9040b8-877b-46ea-81fd-9dceeabb6bc0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:21:49.218747+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('68135b46-499e-43a1-9866-d5fe3ef5eecf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:22:07.063355+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('aa245a63-e6f4-4890-9701-d5b464638508', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:23:36.513767+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('954669e5-7516-49d3-8cba-af668477abc7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:23:53.934621+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b14d8fc6-81d4-466e-b756-8ad7c01bef5d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:25:11.38555+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('48c1fd46-af72-410c-9196-9ab79b486a99', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:25:29.244877+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('73e0b522-ea5a-4a7d-b451-0124d483b4bd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:26:54.641186+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('132fdf1a-1fa4-45a4-a159-7d7875a30b98', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:27:12.091247+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('44e68cf5-1287-453f-875a-1caf4369171f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:28:42.470965+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('39a9e769-5577-4c39-a683-1392488088bf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:29:00.178188+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('37ad1f09-1cb4-4626-a69f-46b2ad4aeacf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:30:25.36613+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e4dee42a-bbf5-4b0d-aa8b-8352bbd379b7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:30:42.816263+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('26abf60b-ed27-44a1-ab15-47f7aea3ac3d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:32:43.769771+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6d676a41-a22c-4a26-8360-8b63539b1933', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:33:01.286757+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c4dc7b9f-55af-45f7-93e9-9e3d70364654', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:34:47.467932+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('90363f8a-155a-4b90-a040-3a6d01ab5dbc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:35:05.004394+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('55bdada9-6e04-4848-a145-35e4111ec68a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 12:36:05.220474+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d7abcc43-12f9-4a0f-be08-c66ab8a39880', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 13:08:53.17198+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d648b93a-39d8-4097-8b49-3b46e5265e95', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 13:09:51.861556+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('050b0672-6a88-4671-bf3d-c477563e53d6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 13:10:07.492321+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f90addfc-488c-4512-b519-6c4079f40823', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 13:16:33.886355+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4a4ca1ed-6762-4ba8-8b41-79c32308ed9c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 13:17:17.816152+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ec53d040-289c-4306-b45c-79685285ec8b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 13:17:32.495928+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2832a2cf-f66f-4903-924b-35e53c57ec31', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:02:31.845315+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ad70a9ee-5f77-47c0-bbd4-01a8bfc3fea9', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:06:56.605846+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fdbc73b8-e272-469e-824b-f7082a028e45', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:07:34.287346+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('dfe7a6aa-a64a-43ef-bd70-721936ad196a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:07:50.713144+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f3da9997-6cd2-4728-95b8-986cac358397', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:09:10.889108+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('bd6b7be4-36fe-4186-b679-a3ed0ac2deb0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:09:26.820149+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('77ef4bf2-0825-4e43-ae9b-1ab2efb99fbc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:11:15.273767+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('38c706fd-f24a-4296-858e-dd03e02a04cf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:11:30.711213+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1b707a78-c4c0-4a7f-a6ba-5191c406a8d7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:12:23.147228+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('219e7942-368a-4975-b0d6-285cd03d6c48', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:13:35.616106+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('14908f3f-a0e4-4d58-8df6-6f350f37f065', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:13:52.061568+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('844c261a-b107-4c4f-8158-aeef8fae8b3c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:15:06.143628+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d65fe312-d6a3-430d-a4bc-2abff2413618', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:15:43.835514+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('963428eb-478f-47e6-99f8-bb0268db0e0e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:15:59.785615+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4fa4cc3e-b042-453e-89a7-d4ab1e2bb54f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:19:13.563427+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6bba9b04-99e2-4f1b-bda9-dd63581090b7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:19:59.955382+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5ed428f5-98b2-4449-8a93-da631edd4778', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:20:16.886498+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('71621671-304d-4199-8577-41541ddad92e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:28:02.997053+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('50224ba2-1152-4864-8d9b-8ea05e3140b7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:28:23.710247+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('728c9231-3d1a-4baa-aea7-24d1eba64be7', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:28:56.943206+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1eeae4b4-370f-4978-943b-8cb20a22ef58', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:29:25.460388+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e8adebd5-21e9-4672-a9a5-803a9ba39124', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:29:48.64078+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6fba367b-6deb-4129-a2f8-a41e2e53bcfc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:30:05.704048+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('bcb13ed7-7bb2-4204-a758-6df5cc623cd8', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:30:42.551548+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('447bc852-2ef7-498f-b458-6e71122a9bba', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:31:20.493405+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6e984ed7-c798-4093-8dc7-24ffe0101d0a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:31:37.080965+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('739ded94-d75e-409b-9fe4-50f0154689f2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:32:51.331757+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('396e05e2-a94b-403d-bcd0-0bdeab808c8e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:33:21.775642+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('981e1d11-1b5f-4050-8ffc-42bae54ca235', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:33:59.102064+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ca1ba3ec-fe1a-412f-912f-dd844e5871ce', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:34:15.918449+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cb9da709-3a9f-41e0-98ca-09716cfb56da', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:35:46.98986+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('00305f39-165b-45c0-b808-3076640cf423', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:36:27.379773+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3d1919f4-b878-4f63-8bfc-957288c539e2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 14:36:45.086956+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4e74027d-ca99-4540-86ee-0ea0aa1706eb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 15:53:44.822106+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a72519ab-2e25-46e8-bedf-f83c0e81eb66', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 15:54:17.595829+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ab09dd8c-ed98-4678-b2e6-e68e3a0eb9d5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 15:54:48.987737+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9f025530-e311-49cb-ae16-d5460d959c52', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 15:55:30.96198+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8bca93fd-39b3-460d-8d3c-4049dd556ef3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-16 15:55:48.323227+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6c595507-d9e6-4930-9d54-21c3f9748f5c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:27:09.837768+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0138ad01-1fb2-4459-8d49-f25b02ef22e5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:45:26.148091+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('be28ffd2-3276-4a3c-9c0d-00676976da4e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:45:45.873329+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f1bad5bd-aa11-4891-99d2-03dadc23dd96', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:46:12.72019+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('64ff3296-68f4-4cb9-8e3c-5066e1cb7462', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:46:50.159437+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c36d134e-4355-4c56-9d51-8d1bf5989ea2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:47:05.977367+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('709e34d9-30fb-4149-8711-e562bd2f5c01', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:47:26.942193+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c74328f4-1fbe-463c-813a-8b086ecb0f28', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:48:24.703083+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4db15f29-cecd-4bfe-abe5-229a526b7673', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:48:44.498819+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('61c584e3-5949-4cfa-aa2c-7a0818d64816', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:49:15.976949+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f2d9c985-9ca9-4592-91ab-0790f0bda472', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:49:34.977004+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8721f4ce-c975-4dd0-ba63-3081cc2879a0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:50:21.347578+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b54aaab7-1cd8-4408-b8a7-4eb508ead480', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:50:59.218543+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('efd2f9a3-1a06-4ed9-889c-009f48ab1288', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:51:38.703968+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('657d7c88-25eb-4c63-bb7b-819a80a8190d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 02:51:54.080544+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('981d16e1-122b-4509-9333-61977cb8dc56', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 04:01:53.340981+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fe4cfc5a-bd21-4f34-b3c5-26fdef8a8ac3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 04:21:53.14988+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7d087dba-2d35-4b7a-81bc-c28625b54251', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 04:22:29.489509+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7648e381-4cee-4336-9ba4-01a271827fb0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 04:23:04.619294+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e754da88-3aae-46ac-91c0-0934ce30171c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 04:23:20.481418+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1c158498-6723-43ba-82f4-b2c81493d4fa', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:13:20.674085+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('485ce118-f2c7-491a-ae51-3694c4a48660', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:14:49.136194+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('96ab603d-4c66-46af-9162-eb5104ff12f4', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:15:04.597957+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9868ea59-904b-4d2d-a347-6785f80498ef', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:16:30.614971+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1cb02251-cde6-4acc-91a2-7900d5908a31', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:16:47.451368+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cde1c31f-3d96-4ad9-9c33-eaeeb3dac6bb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:17:37.676909+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('026cd6fc-46d7-4a8d-8343-d38dc7e3d74f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:18:09.775389+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('534f40ed-8671-4fa5-b9a2-58b9076c68ae', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:18:40.260593+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('769b51eb-6619-4b9b-9044-4c2ba7a1bbc0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:19:14.029652+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('bdc4b3a2-d03e-432f-a90e-5157f61c51cb', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:19:29.43847+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d387f879-6976-4764-bb4c-7a6fb07acee0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:21:16.949231+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('56edd1e5-23f8-4abc-91d4-f5c4207c8cfe', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:21:32.614487+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9cdfb7c3-a841-4a09-bee4-fb4b3e9b37b1', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:44:02.487669+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('820b0f08-ee34-40f9-97f4-232804ee7dce', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:44:27.817584+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8ccfad99-95b6-4006-955c-60b89d337029', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:45:24.913361+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a9d360a2-dee3-496f-aab0-a21929e76a60', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:45:58.579039+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('27cee3e9-f9e4-4b92-9983-c89a8647ceac', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:46:14.001975+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5def0bac-bd62-4cdb-85c2-4e8c5a5b6bf0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:47:27.014867+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b13e1a4b-7d86-4535-bb8d-95793465bdbd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:47:42.52908+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3d0d383f-5a4b-45e4-a3a5-913d7f425532', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:48:38.462983+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3625e855-8919-4ae1-9e12-f987cd5031f0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:48:54.498029+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('65ef7469-f26c-4492-81e6-e192e1943c72', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:49:36.274703+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('280f5148-1003-49af-b26f-ac2b5442af5b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:49:52.494299+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('45cbb390-58cc-4f06-8cde-398f4715afee', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:50:26.900349+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3ba9783d-4532-4f11-8580-680b7edcfe57', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:50:42.636582+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1f7132b4-33e2-49ee-9737-024e181bd4b3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:51:56.529185+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7de886c3-db81-4ed3-9edc-39e80c6e8fa9', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:52:12.046704+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('303d6519-d01d-4e48-8cb6-e8bde8b93df5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:53:37.967138+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0173c2c6-3a26-4d66-8750-7c41cb4fee35', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 05:53:53.984104+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ee3a7281-6536-4ba5-a305-32e3a47d566f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 06:02:03.374461+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7314e8a4-1542-4ce1-b5e3-751ff3ead30c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 06:02:37.447928+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('42735ee9-2725-4347-9f02-7bba3067711c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 06:02:52.869321+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('91e3c529-d2d7-49a7-b63a-0ffcb6527778', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:34:53.48655+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9bda1fa0-af98-471e-b930-e1a34e5941f0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:35:31.427614+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a6f79888-33c6-4901-8d6e-42ad98963dfc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:35:47.389816+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('16a664a0-e067-4648-92ba-b3e96151f914', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:38:48.198156+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8c05369f-a2b8-4263-8436-f27fe3bdf0ae', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:47:44.597318+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5e065750-3a8d-4d04-99c4-1094bbfba8ee', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:48:09.200807+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6d22ef4c-1c90-4a3d-b6b9-45d47c5e7a67', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:48:46.44566+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8a28a7e9-98ee-477b-8b10-ced274132ecd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:49:29.017752+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d7a417c3-98fb-4821-81a5-4133287fbf11', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:49:45.455128+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('730a7239-825a-43b0-b586-df3bf62e7961', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:51:26.20593+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f357352b-3f09-4586-b2b1-624d7e9def5e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:51:42.49454+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('128df78c-8d12-476f-a3b9-44b1d53dc41a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:52:18.0603+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('29a4a723-9ff8-40d8-aab0-8f7975448eff', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:52:34.295958+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('136ea25e-4365-470d-b55e-2bbcf8f10b3f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:54:19.989158+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('bce6f502-8744-4b51-a5e7-97439f2b57d4', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:54:55.310488+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4f573e03-a20e-4fcc-9953-5ba4448ef906', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 08:55:12.011859+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c66e4d97-a202-43f4-9209-adff0c093d63', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 10:52:19.44084+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('897809d2-e525-4417-b38d-03f7c804bc81', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 10:53:04.988153+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b12c6e42-a02b-4373-9949-cbb63e30ac09', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 10:54:00.752273+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6a870ef1-32f3-49a3-947d-86a531f22baf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 10:54:20.476428+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c537fae7-5591-4928-97be-15214a34643f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:17:55.231803+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('29f94c6b-5e77-4cf2-888b-47eb5d34a215', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:18:27.593787+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('a206753b-fccc-494e-b99a-d5a76f2eab33', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:21:33.900429+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('41150300-0386-4b7a-9f0f-55122a7540ae', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:21:54.246377+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('399b97a5-81cc-4b36-9fe8-93f04c00ed00', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:24:23.426361+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('782b05c7-0a16-443a-83b2-b9257f18e667', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:25:32.046372+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0f734689-539b-458f-be34-a1d66ebd7fea', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:26:16.161946+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('605917b1-b0b9-4511-9bb1-9f299a3db0ea', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:26:36.848473+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9a59286f-cc1a-4262-8ac8-160c46440bd0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:28:24.766337+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3c83c200-e0c1-4a45-86eb-4e7a22a3fb1b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:28:45.448636+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4d32368b-6514-41e7-83a1-4ee0603af773', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:30:32.685309+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b0d4780b-2f5e-45aa-9db9-ba01f84d93a1', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 11:30:53.184339+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4a47a409-5f01-4731-bc1d-d1c6ced79e3b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:00:33.749274+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('166baf51-32d7-43ca-8300-c5f3861685dd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:05:01.267301+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1d043468-4c56-42d7-bf6a-948bc1d44fc2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:05:51.666212+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f07c4759-935e-4b6a-adbb-17d5a689bed6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:06:12.254187+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('0ec12f6c-c11a-412c-9556-720dfe2545a0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:57:38.02773+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2f0e2295-f175-4f2c-a868-9822a69e1011', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:58:23.864093+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f8b60108-e0e2-42ff-983f-5fc5f1e311e2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:58:59.717477+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5a36351b-8605-4fe4-8904-b3e3e96bb527', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:59:39.19452+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('fe3e6ead-53b6-4826-8af4-805b813cc3bc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 15:59:55.740072+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b5722479-8545-49b6-a1ba-19d5e4199b83', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-17 16:05:41.439041+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e3cb0b1e-04e2-460c-9bce-a313206ad868', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 00:41:10.243652+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f65e0edf-1e31-4408-89af-13561122947f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 00:42:24.038338+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('50a5ba25-4914-4263-b27b-5ad2ff03884a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 00:43:25.760734+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2e0207b0-9223-43ab-b134-7fc486162c15', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 00:43:45.738286+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9f2673b8-010b-4fe5-9874-fac83bd2427e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 00:54:41.012273+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('820da460-09f7-4f03-a9fc-d8c949a5aa25', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:21:03.728162+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e46d3339-01f6-4026-af21-513b7c82614e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:21:26.442014+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e5a85996-aaa9-4de5-a4fc-f39c321f6914', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:22:14.65872+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('4a0cad7f-20ff-44ce-8143-f4adc0b8427f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:22:54.595582+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('00f09af8-62b4-4fd7-b4d8-ad7851e9572e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:23:37.982963+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('79084745-b1a7-473c-b62e-5b83ebbb4797', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:23:55.371363+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('41292e98-aec4-41b4-a010-99b9a877866b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:26:16.040746+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2a2fb818-8cd3-416e-95e6-3b30a64c88a5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:26:37.595873+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('702c6ebd-c7b6-4d41-9d80-e70ac72274aa', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:27:06.225911+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8e83a077-85e6-4270-b44d-6cd0fbae99cc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:27:23.704025+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('90b9e7eb-3ce6-468f-8259-f2a151ae4977', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:28:00.944221+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6668c14b-914e-4bf3-9899-ca9db2e72cf3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:28:18.659708+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c72dbbd5-6810-4d0a-8897-8163774d7d3b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:43:34.493266+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7028ac08-3696-4f14-a103-50f7e7bd8344', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:44:04.300701+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('26f3fcee-bdab-45c1-8212-48ff45e8bcef', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:44:33.422203+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3b8041ac-46e5-4bf2-94a5-24ff68f88a44', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:44:51.311171+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('638d1d6e-88c6-414a-8529-01a96ef2fe1b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:47:06.031528+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('baea6088-bac5-4847-bdb2-1668642865ba', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:48:39.12083+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('733f8d93-f731-4bc2-a6f1-a5718318ebe2', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:48:56.904041+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('2b3f80c1-8907-4166-87ef-6fdbe58786c3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:49:18.746729+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1efaf58d-2d08-4e0a-8b5d-e932655e9589', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:50:11.331825+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('73ff1fcf-2fd9-45a1-9baa-fc397b5567ad', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:50:48.695021+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ece5ad90-54b2-4da4-a370-4698f1b431a5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 01:51:06.567044+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6f3b41d1-37bc-402a-b906-6ef56cc9752a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:13:08.171207+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('01e50278-fe3a-4dfb-974a-09201b24a3be', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:14:01.223999+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6287aef3-8857-4d38-9b98-350cc94aaacc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:14:22.831757+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('cf4d2511-8084-457a-9111-50d7beafa9fc', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:18:47.966699+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d67b63a7-7cde-474b-93d7-c80bc4ac20d6', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:19:32.60037+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8ee37849-18bd-4abc-a51a-c02b7157fcaf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:19:54.109112+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('082128eb-e178-44fa-a4ff-bfaa024e3714', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:21:44.982849+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('445944a5-ca55-43ee-a251-3d19a54b4aaa', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:22:06.338979+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ae54d472-b5f6-45e8-88a5-3c2c55e2a8df', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:23:55.197+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b822377f-d6da-48fd-af32-518f9fd28f19', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:24:16.341758+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('5741eb38-bf05-44ef-acdc-d8a6fc6756a3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:25:47.131651+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ed14b83a-358b-4478-9903-e8c5162ce02f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:26:08.392941+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b3ab17de-c0ee-4e24-b78c-8bb10c8386b1', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:27:40.714953+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('ea2ed6f8-4886-425c-a444-a24f2474fbcd', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:28:02.392698+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d38ee446-25ce-49da-957b-b68dbca80fab', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:30:06.199117+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('8bf3c721-3c03-46da-a7e3-a4a7f334651c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:30:27.659847+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c2fda71e-6ea3-4d78-abc7-cf16c28f0d9b', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:31:40.753916+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('13e7050b-acad-43fc-96cb-580b3696a6a5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:32:54.519485+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('41d04f2a-9fbf-41e4-a8be-63c76185a09e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:33:39.275856+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3214920e-8bce-4660-ad7d-dcfccaefb4bf', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:34:00.614135+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('e610882a-79fb-4db3-85a2-447ecb6f87a0', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 02:49:56.535614+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f738cc3f-32bf-4aaa-a7bb-e80dd2e9d4ed', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:04:10.617033+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('71753216-c2ed-48d5-86ea-22979d35f680', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:05:05.754438+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6ff59920-babf-4569-877a-621e66cb89f3', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:05:25.125974+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('08f87107-e340-476c-af0a-ff669ceeb54c', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:08:55.599776+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('3de12b9c-735c-4ba0-8d97-c3acdaa1a9ec', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:09:14.582574+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('c23a2656-ec5f-4886-9112-01e795050449', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:10:31.37897+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('924b2f79-ec39-40d1-a692-88b4bf4bc518', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:11:55.591573+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('02ca891f-eac2-4f4b-a842-23366abe7610', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:12:34.647109+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('f716b2d3-4535-4768-9439-eb5ff90545df', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:12:53.915674+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('9899b4e9-6a61-4bb4-800c-c87926ab292d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:27:13.519542+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7774d503-39ff-4ce0-9ac0-a8f0b5522da5', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:28:01.571862+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('b0d80293-8ac8-40f9-b21f-79e0c08d9b3f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:29:18.047399+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('1db4ea66-4fe4-4dc7-83f1-5e2d1f85316d', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:29:35.374568+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('84c58ec2-75f0-441e-abc1-61bb0d84f41e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:31:00.577548+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('d0b53bff-5733-4721-9bf2-e5e6f0c2cc9f', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:31:46.416031+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('50288b3e-a436-41d9-9779-654db08ea90e', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:32:38.396077+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('7496d965-b4f5-48e2-9d5f-ad91ae0284ba', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:32:59.794927+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6af3748d-cab2-49bb-ae34-98a3132fac5a', '100% 성공', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:33:31.96515+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('66098e30-f79c-4990-b4b0-85d1c8914fe7', '시험차단어', 'CONTAINS', 'BLOCK', NULL, true, NULL, '2026-09-18 03:33:51.971759+00');
INSERT INTO public.banned_words (id, word, match_type, severity, gwan_code, is_active, updated_by, updated_at) VALUES ('6e21157f-2b21-4fc9-9877-4ad3b4e01ce1', '시험주의어', 'CONTAINS', 'WARN', NULL, true, NULL, '2026-09-18 03:33:51.971759+00');
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('eeeeeeee-0000-4000-a000-000000000001', 'MNY', NULL, 'MFG', '제조 설비', 'APPROVED', NULL, NULL, NULL, NULL, NULL, '2026-09-07 12:05:28.671469+00', '2026-09-07 12:05:28.671469+00', 'NOT_APPLICABLE', NULL, NULL, NULL, NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('62d0e822-60a7-481b-a712-38f2b4cd62bb', 'BIZ', NULL, 'BIZ_TRANSFER', '점포 양수도', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('7d0fbce4-1bbd-48fb-9530-1dff3ae99198', 'BIZ', NULL, 'BIZ_FRANCHISE', '프랜차이즈 가맹', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('27b6f0f1-e1b1-460c-961e-1d4ec83a790f', 'BIZ', NULL, 'BIZ_UNMANNED', '무인 매장 창업', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('404f2395-2529-4f69-a922-2d1e90fe1201', 'BIZ', NULL, 'BIZ_MA', '기업 인수 · 합병', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('c0785a5c-bd51-4370-835b-5a8793bb5283', 'BIZ', NULL, 'BIZ_NEWSTORE', '기업 신규 출점', 'APPROVED', 'BUYER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('4aee3351-3d15-4267-b591-5e5ac9f2f64c', 'BIZ', NULL, 'BIZ_DISTRIBUTE', '다점포 · 지역 총판', 'APPROVED', 'BUYER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('d409d3f9-e1b1-4dbd-8950-4f68f06b9b35', 'BIZ', NULL, 'BIZ_EQUIPMENT', '창업 설비 · 집기', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('4d1e9934-393e-4457-9110-da528bc8158b', 'BIZ', NULL, 'BIZ_SPACE', '창업 공간 임대', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('b0c447f2-dbb4-4b5c-b2b9-714acd5ac1a4', 'MAL', NULL, 'MAL_APT', '아파트 · 주택', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('1562943c-38a2-42b5-bc4e-fe817286afc5', 'MAL', NULL, 'MAL_SHOP', '상가 · 건물', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('0830a54e-bcc4-484e-b9f9-4037493373ae', 'MAL', NULL, 'MAL_LAND', '토지', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('f6d51df9-df61-44d5-b3b5-cc83a4777d46', 'MAL', NULL, 'MAL_OFFICE', '사무실 · 오피스', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('e77501da-8c25-47fc-9710-5ab70dfd3cbd', 'MAL', NULL, 'MAL_FACTORY', '공장 · 창고', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('81992017-8cc7-4fc8-8568-c79547165501', 'MNY', NULL, 'MNY_CAR', '자동차 · 상용차', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('469ddbd9-10b2-485b-852e-e1f413129fd2', 'MNY', NULL, 'MNY_DIGITAL', '가전 · 디지털', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('aad11b86-2cec-42d6-9c4c-3347fd1b6045', 'MNY', NULL, 'MNY_INTERIOR', '인테리어 · 시공', 'APPROVED', 'BUYER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('e291870e-d5f2-4314-9d11-d71558e00027', 'MNY', NULL, 'MNY_FOOD', '식자재 · 농수축산', 'APPROVED', 'BUYER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('e442f73e-4ec9-4989-bd91-51454b58bf5b', 'MNY', NULL, 'MNY_MACHINE', '기계 · 설비', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('0a59559d-4cb0-40e1-be6e-4c00a6cc997c', 'MNY', NULL, 'MNY_ENERGY', '에너지 · 태양광', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('5558944c-8af8-412a-bed0-65ffd14e433e', 'MNY', NULL, 'MNY_LOGI', '물류 · 운송', 'APPROVED', 'BUYER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('6e629865-eb88-4725-866b-a01b4f2bf5d3', 'MNY', NULL, 'MNY_CLOTH', '의류 · 잡화', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-12 10:09:04.455693+00', '2026-09-12 10:09:04.455693+00', 'NOT_APPLICABLE', '물건·사업 대상 — 사람 알선 아님', NULL, '2026-09-12 10:09:04.455693+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('b5078334-c49b-4a75-bd4e-af240075d370', 'HLT', NULL, 'HLT_FOOD', '건강식품', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-14 06:55:37.026861+00', '2026-09-14 06:55:37.026861+00', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', NULL, '2026-09-14 06:55:37.026861+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('380b1c4b-8685-48c6-9472-bacacaf212ae', 'HLT', NULL, 'HLT_FUNC', '건강기능식품', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-14 06:55:37.026861+00', '2026-09-14 06:55:37.026861+00', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', NULL, '2026-09-14 06:55:37.026861+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('b8a6e90f-040b-4532-8046-b34509d36940', 'HLT', NULL, 'HLT_FITNESS', '운동 · 재활 용품', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-14 06:55:37.026861+00', '2026-09-14 06:55:37.026861+00', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', NULL, '2026-09-14 06:55:37.026861+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('503f2e37-31dd-446d-9b00-d61041b4129e', 'HLT', NULL, 'HLT_HYGIENE', '위생 · 방역 용품', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-14 06:55:37.026861+00', '2026-09-14 06:55:37.026861+00', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', NULL, '2026-09-14 06:55:37.026861+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('9e3b5887-9f88-4ddc-8eeb-5af2d4be49cc', 'HLT', NULL, 'HLT_CARE', '요양 · 돌봄 용품', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-14 06:55:37.026861+00', '2026-09-14 06:55:37.026861+00', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', NULL, '2026-09-14 06:55:37.026861+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('307036cb-ffac-4f9a-814f-a391fff7e1fc', 'HLT', NULL, 'HLT_ORGANIC', '유기농 · 친환경', 'APPROVED', 'SELLER', NULL, NULL, NULL, NULL, '2026-09-14 06:55:37.026861+00', '2026-09-14 06:55:37.026861+00', 'NOT_APPLICABLE', '물건 대상 — 사람 알선 아님', NULL, '2026-09-14 06:55:37.026861+00', NULL, 3000, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('98274603-343e-4ca9-9a3f-68351604b617', 'HLT', NULL, 'HLT_PHARM', '의약품', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '물품이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'PHARM', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('9f8702f5-9cfb-42de-a4fe-5e1a7be83321', 'HLT', NULL, 'HLT_MEDDEV', '의료기기', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '물품이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'MEDDEV', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('9ce0d1be-cebe-4ec6-bfd3-97367f5655ab', 'HLT', NULL, 'HLT_MEDICAL', '의료 서비스', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '의료행위이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'MEDICAL', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('1eca99cf-c61a-49d3-af27-ec87dbcf43e5', 'MNY', NULL, 'MNY_LOAN', '대부 · 대출', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '금융이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'LOAN', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('b024610b-d072-41bc-bf27-c738f21226db', 'MNY', NULL, 'MNY_GAMBLING', '도박 · 사행성', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '사행행위이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'GAMBLING', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('c407ae64-64b1-48ab-8747-b098fc2de3e3', 'MNY', NULL, 'MNY_ADULT', '성인 · 유흥', 'PENDING', 'SELLER', 'FIXED', NULL, NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'APPLICABLE', '유흥업 종업원 알선은 직업소개에 해당합니다 — 승인 불가', NULL, '2026-09-16 11:39:13.72957+00', 'ADULT', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('a3929c2f-473c-453d-9f30-e6117a02aece', 'MNY', NULL, 'MNY_MLM', '다단계', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '판매조직이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'MULTILEVEL', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('9a12ead5-5114-4a5f-b129-3915d1a00c81', 'MNY', NULL, 'MNY_LEGAL', '법률 서비스', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '법률사무이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'LEGAL', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('346b6a6d-8207-4b54-b09c-4903bdb62058', 'MNY', NULL, 'MNY_LABOR', '인력공급', 'PENDING', 'SELLER', 'FIXED', NULL, NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'APPLICABLE', '인력공급 그 자체입니다 — 직업안정법 19조 · 승인 불가', NULL, '2026-09-16 11:39:13.72957+00', 'LABOR', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('3d1879e0-5e02-4dc4-90f6-0f5e6b2200a4', 'MNY', NULL, 'MNY_INSURANCE', '보험', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '금융이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'INSURANCE', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('d526d482-150c-46bb-9e7b-4c4cdf4a8e1a', 'MNY', NULL, 'MNY_MEDICAL', '의료 서비스', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '의료행위이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'MEDICAL', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('8a602f4b-78e5-4327-915b-cd67c56e3b16', 'MAL', NULL, 'MAL_MEDICAL', '병원 · 의원 자리', 'APPROVED', 'SELLER', 'FIXED', NULL, NULL, '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', '2026-09-16 11:39:13.72957+00', 'NOT_APPLICABLE', '부동산이며 인력공급이 아닙니다', NULL, '2026-09-16 11:39:13.72957+00', 'MEDICAL', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('5a2959c6-117a-4097-be5c-608e2a3d3a20', 'MNY', NULL, 'LT3', '설비', 'APPROVED', NULL, NULL, NULL, NULL, NULL, '2026-09-18 03:33:48.903563+00', '2026-09-18 03:33:48.903563+00', 'NOT_APPLICABLE', NULL, NULL, NULL, NULL, NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('dcdcdcdc-0000-4000-a000-000000000001', 'MNY', NULL, 'INS', '보험', 'APPROVED', NULL, NULL, NULL, NULL, NULL, '2026-09-18 03:33:48.930921+00', '2026-09-18 03:33:48.930921+00', 'NOT_APPLICABLE', NULL, NULL, NULL, 'INSURANCE', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('dcdcdcdc-0000-4000-a000-000000000002', 'BIZ', NULL, 'TESTRSTR', '시험제한업종', 'APPROVED', NULL, NULL, NULL, NULL, NULL, '2026-09-12 11:41:46.506675+00', '2026-09-12 11:41:46.506675+00', 'NOT_APPLICABLE', NULL, NULL, NULL, 'LOAN', NULL, true, NULL);
INSERT INTO public.categories (id, gwan_code, parent_id, code, name, status, fee_bearer, price_form_type, requested_by, approved_by, approved_at, created_at, updated_at, labor_law_flag, labor_law_memo, labor_law_checked_by, labor_law_checked_at, restricted_code, lead_fee, lead_fee_provisional, lead_grade) VALUES ('a5d67143-9b6f-4c36-8632-6f48364aa91c', 'MNY', NULL, 'VT1', '검증업종', 'APPROVED', NULL, NULL, NULL, NULL, NULL, '2026-09-18 03:33:50.59032+00', '2026-09-18 03:33:50.59032+00', 'NOT_APPLICABLE', NULL, NULL, '2026-09-18 03:33:50.675718+00', NULL, NULL, true, NULL);
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('EN', '에너지 · 태양광', 'BIZ', '골드', true, 7, 'd409d3f9-e1b1-4dbd-8950-4f68f06b9b35');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('FR', '프랜차이즈 · 창업', 'BIZ', '골드', true, 1, '7d0fbce4-1bbd-48fb-9530-1dff3ae99198');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('RE', '부동산 · 점포', 'MAL', '골드', true, 0, '1562943c-38a2-42b5-bc4e-fe817286afc5');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('FA', '세무 · 회계 · 노무', 'MNY', '브론즈', true, 6, '469ddbd9-10b2-485b-852e-e1f413129fd2');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('HR', '인력 · 채용', 'MNY', '브론즈', true, 8, '469ddbd9-10b2-485b-852e-e1f413129fd2');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('IN', '인테리어 · 시공', 'MNY', '실버', true, 4, 'aad11b86-2cec-42d6-9c4c-3347fd1b6045');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('IT', 'IT · 마케팅', 'MNY', '브론즈', true, 5, '469ddbd9-10b2-485b-852e-e1f413129fd2');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('LG', '물류 · 운송', 'MNY', '실버', true, 2, '5558944c-8af8-412a-bed0-65ffd14e433e');
INSERT INTO public.classify_categories (code, name, gwan_code, grade, is_active, sort_order, category_id) VALUES ('MF', '제조 · 유통 · 납품', 'MNY', '실버', true, 3, 'eeeeeeee-0000-4000-a000-000000000001');
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '상가', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '건물', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '매매', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '임대', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '권리금', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '점포', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '사무실', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '토지', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '창고임대', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '전세', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '월세', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '분양', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '평', 2);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('RE', '보증금', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '가맹', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '프랜차이즈', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '창업', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '양수도', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '출점', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '브랜드', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '가맹점', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '본사', 2);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '개설', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FR', '인수', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '물류', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '배송', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '택배', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '화물', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '운송', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '창고', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '3PL', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '풀필먼트', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '차량', 2);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '톤', 2);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('LG', '팔레트', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '납품', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '도매', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '제조', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', 'OEM', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', 'ODM', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '생산', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '자재', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '원단', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '부품', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '유통', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', '단가', 2);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('MF', 'MOQ', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '인테리어', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '시공', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '철거', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '설비', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '도색', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '판금', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '리모델링', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '공사', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '전기공사', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IN', '방수', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '개발', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '앱', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '홈페이지', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '웹사이트', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '광고대행', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '마케팅', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', 'SEO', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '디자인', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '솔루션', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', 'ERP', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('IT', '시스템구축', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '세무', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '기장', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '회계', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '노무', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '급여', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '결산', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '세무사', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '법인설립', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('FA', '기업진단', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', '태양광', 7);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', '발전소', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', 'EPC', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', 'RE100', 6);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', '지붕', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', 'kW', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', 'MW', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', 'ESS', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', '전력', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('EN', '임대수익', 3);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '인력', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '채용', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '구인', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '파견', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '아웃소싱', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '일용', 4);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '단기근무', 5);
INSERT INTO public.classify_vocab (category_code, term, weight) VALUES ('HR', '용역', 4);
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('listing.status', 'DRAFT', '작성 중', '작성 중', NULL, 'muted', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('listing.status', 'IN_REVIEW', '검수 중', '검수 중', NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('listing.status', 'PUBLISHED', '노출 중', '노출 중', NULL, 'success', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('listing.status', 'REJECTED', '반려됨', '반려', NULL, 'danger', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('listing.status', 'SUSPENDED', '노출 중단', '중단', NULL, 'warning', 5, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('listing.status', 'ARCHIVED', '보관됨', '보관', NULL, 'muted', 6, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'INQUIRY', '문의 중', '문의', NULL, 'info', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'NEGOTIATING', '조건 협의 중', '협의', NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'CONTRACTED', '계약서 작성됨', '계약', NULL, 'info', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'PAYMENT_REPORTED', '대금 지급 신고됨', '지급 신고', NULL, 'info', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'CONFIRMED', '성사 확정', '성사', NULL, 'success', 5, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'SETTLED', '정산 완료', '정산 완료', NULL, 'success', 6, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'DISPUTED', '분쟁 진행 중', '분쟁', NULL, 'danger', 7, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('deal.status', 'CANCELLED', '취소됨', '취소', NULL, 'muted', 8, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('subscription.status', 'ACTIVE', '이용 중', '이용 중', NULL, 'success', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('subscription.status', 'PAST_DUE', '결제 실패', '결제 실패', NULL, 'warning', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('subscription.status', 'CANCELLED', '해지됨', '해지', NULL, 'muted', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('subscription.status', 'EXPIRED', '기간 만료', '만료', NULL, 'muted', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('fee.bearer', 'BUYER', '매수인 부담', '매수인', NULL, 'neutral', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('fee.bearer', 'SELLER', '매도인 부담', '매도인', NULL, 'neutral', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('fee.bearer', 'NEGOTIABLE', '협의', '협의', NULL, 'neutral', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.type', 'URGENT', '급구', '급구', NULL, 'warning', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.type', 'VERIFIED_DOC', '서류 확인', '서류 확인', NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.status', 'REQUESTED', '신청됨', NULL, NULL, 'info', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.status', 'IN_REVIEW', '검수 중', NULL, NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.status', 'GRANTED', '표시 중', NULL, NULL, 'success', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.status', 'REJECTED', '반려됨', NULL, NULL, 'danger', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.status', 'EXPIRED', '기간 만료', NULL, NULL, 'muted', 5, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('badge.status', 'REVOKED', '회수됨', NULL, NULL, 'muted', 6, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('request.status', 'DRAFT', '작성 중', '작성 중', NULL, 'muted', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('request.status', 'IN_REVIEW', '검수 중', '검수 중', NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('request.status', 'PUBLISHED', '모집 중', '모집 중', NULL, 'success', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('request.status', 'REJECTED', '반려됨', '반려', NULL, 'danger', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('request.status', 'CLOSED', '마감됨', '마감', NULL, 'muted', 5, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('request.status', 'ARCHIVED', '보관됨', '보관', NULL, 'muted', 6, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.status', 'OPEN', '접수됨', NULL, NULL, 'warning', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.status', 'IN_REVIEW', '검토 중', NULL, NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.status', 'RESOLVED', '처리 완료', NULL, NULL, 'success', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.status', 'REJECTED', '기각됨', NULL, NULL, 'muted', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('account.type', 'INDIVIDUAL', '개인 회원', '개인', NULL, 'neutral', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('account.type', 'BUSINESS', '사업자 회원', '사업자', NULL, 'neutral', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('payment.method', 'BANK_TRANSFER', '계좌 이체', NULL, NULL, 'neutral', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('payment.method', 'CASH', '현금', NULL, NULL, 'neutral', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('payment.method', 'OTHER', '기타', NULL, NULL, 'neutral', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.status', 'QUEUED', '대기', NULL, NULL, 'info', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.status', 'IN_PROGRESS', '처리 중', NULL, NULL, 'info', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.status', 'APPROVED', '승인', NULL, NULL, 'success', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.status', 'REJECTED', '반려', NULL, NULL, 'danger', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.decision_mode', 'AUTO', '자동', NULL, '규칙이 판정', 'success', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.decision_mode', 'MANUAL', '수동', NULL, '사람이 판정', 'info', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.target_type', 'LISTING', '매물', NULL, NULL, 'neutral', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.target_type', 'REQUEST', '소개받기', NULL, NULL, 'neutral', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.target_type', 'BUSINESS', '사업자', NULL, NULL, 'neutral', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.target_type', 'CATEGORY', '업종', NULL, NULL, 'neutral', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.target_type', 'LISTING_BADGE', '매물 배지', NULL, NULL, 'neutral', 5, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'UNVERIFIED_BUSINESS', '사업자 인증 전', NULL, '책임 주체 미특정', 'warning', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'FIRST_LISTING', '첫 등록', NULL, '첫인상 관리', 'info', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'HIGH_FEE', '고액', NULL, '분쟁 시 손해 큼', 'warning', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'PRIOR_REJECT', '반려 이력', NULL, '이전 문제 등록자', 'warning', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'GATED_CATEGORY', '자격 확인 필요', NULL, '서류 판정 필요', 'warning', 5, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'THIN_CONTENT', '본문 부실', NULL, '실체 확인 필요', 'info', 6, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'AUTO_DISABLED', '자동검수 중지', NULL, '정책이 꺼져 있음', 'muted', 7, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ledger.entry_type', 'SUBSCRIPTION', '구독료', NULL, NULL, 'neutral', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ledger.entry_type', 'EXTRA_CODE', '초과 코드 요금', NULL, NULL, 'neutral', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ledger.entry_type', 'LEAD_VIEW', '리드 열람권', NULL, NULL, 'neutral', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ledger.entry_type', 'TOPUP', '충전', NULL, NULL, 'neutral', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ledger.entry_type', 'REFUND', '환불', NULL, NULL, 'warning', 5, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ledger.entry_type', 'ADJUST', '조정', NULL, NULL, 'warning', 6, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('attribution.channel', 'WEB', '웹', NULL, NULL, 'neutral', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('attribution.channel', 'MOBILE', '모바일', NULL, NULL, 'neutral', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('attribution.channel', 'CALL', '통화', NULL, '050 안심번호', 'neutral', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('attribution.channel', 'OFFLINE', '오프라인', NULL, NULL, 'neutral', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('restriction.mode', 'BLOCK', '등록 차단', NULL, NULL, 'danger', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('invite.state', 'DECLINED', '거절', '거절', NULL, 'muted', 4, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('restriction.mode', 'GATED', '자격 확인 후 허용', NULL, NULL, 'warning', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('restriction.mode', 'ALLOW', '허용', NULL, NULL, 'muted', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.labor_law', 'NOT_APPLICABLE', '해당 없음', NULL, NULL, 'success', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.labor_law', 'REVIEW_REQUIRED', '검토 필요', NULL, NULL, 'warning', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.labor_law', 'APPLICABLE', '등록 대상', NULL, '승인 불가', 'danger', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('alert.severity', 'INFO', '알림', NULL, NULL, 'info', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('alert.severity', 'WARN', '주의', NULL, NULL, 'warning', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('alert.severity', 'CRITICAL', '긴급', NULL, NULL, 'danger', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('business.status', 'NONE', '미신청', '미신청', NULL, 'muted', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('business.status', 'IN_REVIEW', '인증 심사 중', '심사 중', NULL, 'info', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('business.status', 'VERIFIED', '인증 완료', '인증', NULL, 'success', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('business.status', 'REJECTED', '인증 반려', '반려', NULL, 'danger', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('proposal.status', 'PROPOSED', '제안됨', NULL, NULL, 'info', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('proposal.status', 'ACCEPTED', '수락됨', NULL, NULL, 'success', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('proposal.status', 'REJECTED', '거절됨', NULL, NULL, 'muted', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('proposal.status', 'WITHDRAWN', '철회됨', NULL, NULL, 'muted', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.status', 'OPEN', '접수됨', NULL, NULL, 'info', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.status', 'ANSWERED', '답변 완료', NULL, NULL, 'success', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.status', 'CLOSED', '종료됨', NULL, NULL, 'muted', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.status', 'PENDING', '승인 대기', NULL, NULL, 'info', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.status', 'APPROVED', '승인됨', NULL, NULL, 'success', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.status', 'REJECTED', '반려됨', NULL, NULL, 'danger', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('category.status', 'ARCHIVED', '보관됨', NULL, NULL, 'muted', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ad.status', 'SCHEDULED', '게재 예정', NULL, NULL, 'info', 1, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ad.status', 'ACTIVE', '게재 중', NULL, NULL, 'success', 2, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ad.status', 'PAUSED', '일시 중지', NULL, NULL, 'warning', 3, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('ad.status', 'ENDED', '종료됨', NULL, NULL, 'muted', 4, true, 'ADMIN', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('review.manual_reason', 'BANNED_WORD_WARN', '주의 단어', NULL, '문맥 확인 필요. 차단은 아님', 'warning', 8, true, 'ADMIN', '2026-09-07 12:05:02.728638+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('integration.status', 'NOT_STARTED', '미착수', NULL, NULL, 'muted', 1, true, 'ADMIN', '2026-09-07 12:05:02.731454+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('integration.status', 'CONTRACT', '계약 진행', NULL, '사업자 선정·계약', 'info', 2, true, 'ADMIN', '2026-09-07 12:05:02.731454+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('integration.status', 'IP_PENDING', 'IP 심사중', NULL, '2~4주 소요', 'warning', 3, true, 'ADMIN', '2026-09-07 12:05:02.731454+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('integration.status', 'TESTING', '연동 시험', NULL, '스텁 → 실연동 전환 중', 'info', 4, true, 'ADMIN', '2026-09-07 12:05:02.731454+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('integration.status', 'LIVE', '운영중', NULL, NULL, 'success', 5, true, 'ADMIN', '2026-09-07 12:05:02.731454+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('integration.status', 'FAILED', '중단', NULL, NULL, 'danger', 6, true, 'ADMIN', '2026-09-07 12:05:02.731454+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.category', 'HOWTO', '이용 방법', NULL, NULL, NULL, 1, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.category', 'LISTING', '등록·검수', NULL, NULL, NULL, 2, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.category', 'FEE', '소개비·정산', NULL, NULL, NULL, 3, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.category', 'BILLING', '구독·결제', NULL, NULL, NULL, 4, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.category', 'REPORT', '신고', NULL, NULL, NULL, 5, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('inquiry.category', 'ETC', '기타', NULL, NULL, NULL, 6, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.reason', 'FEE_DISAGREE', '소개비 금액에 이견이 있습니다', NULL, NULL, NULL, 1, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.reason', 'NOT_INTRODUCED', '소개 사실이 없습니다', NULL, NULL, NULL, 2, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.reason', 'CONTRACT_ISSUE', '계약 내용과 다릅니다', NULL, NULL, NULL, 3, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.reason', 'PAYMENT_ISSUE', '대금이 지급되지 않았습니다', NULL, NULL, NULL, 4, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('dispute.reason', 'OTHER', '기타', NULL, NULL, NULL, 5, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('register.role', 'OFFER', '소개합니다', NULL, NULL, NULL, 1, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('register.role', 'REQUEST', '소개받기', NULL, NULL, NULL, 2, true, 'ALL', '2026-09-07 12:05:02.754348+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('settlement.status', 'HELD', '분쟁으로 보류', '보류', NULL, 'warning', 3, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('settlement.status', 'REJECTED', '반려됨', '반려', NULL, 'danger', 4, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('settlement.status', 'REQUESTED', '지급 대기', '대기', NULL, 'info', 1, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('settlement.status', 'PAID', '당사자 지급 표시', '표시됨', NULL, 'success', 2, true, 'ALL', '2026-09-07 12:05:02.707845+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('success_fee.status', 'BILLED', '청구됨', '청구', NULL, 'info', 1, true, 'ALL', '2026-09-07 12:05:02.823384+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('success_fee.status', 'PAID', '납부 완료', '완료', NULL, 'success', 2, true, 'ALL', '2026-09-07 12:05:02.823384+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('success_fee.status', 'WAIVED', '면제', '면제', NULL, 'muted', 3, true, 'ALL', '2026-09-07 12:05:02.823384+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('success_fee.status', 'CANCELLED', '청구 취소', '취소', NULL, 'muted', 4, true, 'ALL', '2026-09-07 12:05:02.823384+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-01', '귀속 우회 의심', '귀속 우회 ', NULL, 'danger', 0, true, 'ADMIN', '2026-09-08 12:52:02.734389+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-02', '허위 · 중복 매물', '허위 · 중', NULL, 'warning', 1, true, 'ADMIN', '2026-09-08 12:52:02.734389+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-03', '반려율 상한 초과', '반려율 상한', NULL, 'warning', 2, true, 'ADMIN', '2026-09-08 12:52:02.734389+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-04', '소개캐시 중복 차감', '소개캐시 중', NULL, 'info', 3, true, 'ADMIN', '2026-09-08 12:52:02.734389+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-05', '제한업종 우회 등록', '제한업종 우', NULL, 'danger', 4, true, 'ADMIN', '2026-09-08 12:52:02.734389+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-06', '자전거래 의심', '자전거래 의', NULL, 'info', 5, true, 'ADMIN', '2026-09-08 12:52:02.734389+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('risk.rule', 'RSK-07', '광고 소재 규제 위반', '규제위반', NULL, 'danger', 7, true, 'ADMIN', '2026-09-08 12:52:02.71329+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.grade', 'SEED', '새싹 소개자', '새싹', NULL, 'muted', 1, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.grade', 'VERIFIED', '인증 소개자', '인증', NULL, 'info', 2, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.grade', 'EXPERT', '전문 소개자', '전문', NULL, 'success', 3, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.grade', 'TOP', '우수 소개자', '우수', NULL, 'success', 4, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.grade', 'REGION_PARTNER', '지역 파트너', '파트너', NULL, 'success', 5, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.answer', 'KNOW', '제가 알아요', '알아요', NULL, 'success', 1, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.answer', 'CHECKING', '확인해 보겠습니다', '확인중', NULL, 'info', 2, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.answer', 'DONT_KNOW', '잘 모릅니다', '모름', NULL, 'muted', 3, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('introducer.answer', 'NOT_MY_FIELD', '관심 없는 분야입니다', '관심없음', NULL, 'muted', 4, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('invite.state', 'SENT', '초대 발송', '발송', NULL, 'info', 1, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('invite.state', 'VIEWED', '열람함', '열람', NULL, 'info', 2, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('invite.state', 'CONSENTED', '동의 완료', '동의', NULL, 'success', 3, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('invite.state', 'EXPIRED', '기간 만료', '만료', NULL, 'muted', 5, true, 'ALL', '2026-09-08 21:56:22.841929+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('post.badge', 'WANTED', '찾습니다', '찾음', NULL, 'info', 1, true, 'ALL', '2026-09-08 21:56:23.014668+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('post.badge', 'INTRO_WANT', '소개해주세요', '소개', NULL, 'info', 2, true, 'ALL', '2026-09-08 21:56:23.014668+00');
INSERT INTO public.code_labels (domain, code, label, short_label, description, ui_tone, sort_order, is_active, audience, updated_at) VALUES ('post.badge', 'ON_SALE', '판매 중', '판매', NULL, 'success', 3, true, 'ALL', '2026-09-08 21:56:23.014668+00');
INSERT INTO public.contract_templates (code, name, version, scope, body, invariants, is_active, effective_from, note, created_at, updated_at) VALUES ('INTRO_STD', '소개 표준계약서', '1.0', 'INTRO', '
# 소개 표준계약서

## 제1조 (목적)
이 계약은 소개자가 소개받는 자에게 거래 상대방을 소개하고, 그 소개로
거래가 성사된 때 소개비를 지급하는 것에 관하여 정합니다.

## 제2조 (소개비)
① 소개비는 **당사자가 협의하여 정합니다.**
② 소개비는 **소개자에게 전액 지급됩니다.** 소개뱅크는 이 금액에서
   어떤 명목으로도 떼지 않습니다.
③ 세금계산서는 소개자가 직접 발행합니다.

## 제3조 (대금)
① 거래 대금과 소개비는 **당사자끼리 직접** 주고받습니다.
② 소개뱅크는 이 대금을 **보관하지 않습니다.**

## 제4조 (성사)
① 성사는 **양측이 각각 확인**한 때에 확정됩니다.
② 확정 후에는 소개비 정산을 신청할 수 있습니다.

## 제5조 (소개 귀속)
① 소개코드는 **첫 접촉일부터 90일** 동안 유효합니다.
② 같은 상대방에 대해 둘 이상의 소개가 있는 때에는 **먼저 접촉한**
   소개자에게 귀속됩니다.

## 제6조 (해지)
① 서명 후에는 조건을 바꿀 수 없습니다.
② 이행이 시작된 뒤의 해지는 당사자가 협의합니다.

## 제7조 (분쟁)
이 계약에 없는 것은 관계 법령과 소개뱅크 이용약관을 따릅니다.
', '{INV-3,INV-9,INV-11}', true, '2026-11-11', NULL, '2026-09-18 02:12:51.461242+00', '2026-09-18 02:12:51.461242+00');
INSERT INTO public.contract_templates (code, name, version, scope, body, invariants, is_active, effective_from, note, created_at, updated_at) VALUES ('STD_V1', '소개 표준계약서 (구 버전)', '0.9', 'INTRO', '
# 소개 표준계약서 (구 버전)

이 양식은 INTRO_STD 1.0 으로 대체되었습니다. 이미 발급된 계약을
가리키기 위해 남겨 둡니다 — 지우면 그 계약들이 어떤 양식이었는지
알 수 없게 됩니다.

내용은 INTRO_STD 와 같습니다.
- 소개비는 당사자 협의 · 전액 소개자에게
- 대금은 당사자끼리 직접 · 플랫폼은 보관하지 않음
- 성사는 양측이 각각 확인
', '{INV-3,INV-9,INV-11}', true, '2026-01-01', NULL, '2026-09-18 02:12:51.461242+00', '2026-09-18 02:12:51.461242+00');
INSERT INTO public.contract_templates (code, name, version, scope, body, invariants, is_active, effective_from, note, created_at, updated_at) VALUES ('HLT_SELLER_STD', '건강몰 입점 표준계약서', '1.0', 'HLT_SELLER', '
# 건강몰 입점 표준계약서

## 제1조 (목적)
이 계약은 판매자가 소개뱅크 건강상품관에 입점하여 상품을 판매하는
것에 관하여 정합니다.

## 제2조 (판매수수료)
① 소개뱅크는 판매가의 일정 비율을 **판매수수료**로 받습니다.
② 수수료율은 **소개뱅크가 정하며**, 카테고리별로 다를 수 있습니다.
③ 수수료율을 바꾸는 때에는 **미리 알리며**, 이미 판매된 건에는
   적용되지 않습니다.

> **소개비와 다른 돈입니다.** 소개형 관의 소개비는 소개자에게
> 전액 지급되지만, 건강몰 판매수수료는 소개뱅크가 받습니다.

## 제3조 (대금 수령)
① 판매 대금은 **판매자가 직접** 받습니다(하위가맹점).
② 소개뱅크 계좌를 거치지 않습니다.

## 제4조 (정산)
① 정산은 **주 단위**로 합니다.
② **배송 완료 후 7일**이 지난 건만 집계합니다. 청약철회 기간입니다.
③ 환불이 매출보다 많으면 **다음 회차로 이월**합니다.

## 제5조 (자격)
① 판매자는 영업에 필요한 자격을 유지해야 합니다.
② 자격이 만료되면 **노출이 즉시 멈춥니다.** 다만 이미 받은 주문은
   이행합니다.

## 제6조 (책임)
① 상품의 하자·표시광고·자격에 대한 책임은 판매자에게 있습니다.
② 이용자에 대한 반품·환불은 소개뱅크가 먼저 처리하고, 판매자에게
   구상합니다.

## 제7조 (금지)
의약품과 의료 서비스는 판매할 수 없습니다(약사법 44조·의료법 27조).
의료기기는 심의필 번호가 있어야 합니다.
', '{INV-H1,INV-H9,INV-H10}', true, '2026-11-11', NULL, '2026-09-18 02:12:51.461242+00', '2026-09-18 02:12:51.461242+00');
INSERT INTO public.contract_templates (code, name, version, scope, body, invariants, is_active, effective_from, note, created_at, updated_at) VALUES ('PARTNER_STD', '파트너 표준계약서', '1.0', 'PARTNER', '
# 파트너 표준계약서

## 제1조 (목적)
이 계약은 파트너가 소개뱅크를 통해 리드를 받고 그 비용을 지급하는
것에 관하여 정합니다.

## 제2조 (리드 비용)
① 리드 확인 비용은 **요청을 열어 볼 때** 발생합니다.
② 열지 않은 요청에는 비용이 발생하지 않습니다.

## 제3조 (독점 배분)
하나의 리드는 **한 파트너에게만** 배분됩니다.

## 제4조 (환불)
리드 정보가 사실과 다른 때에는 환불합니다. 연락이 닿지 않는 것만으로는
환불 사유가 되지 않습니다.

## 제5조 (비밀유지)
리드로 받은 연락처를 다른 목적에 쓰거나 제3자에게 넘길 수 없습니다.
', '{INV-9,INV-11}', true, '2026-11-11', NULL, '2026-09-18 02:12:51.461242+00', '2026-09-18 02:12:51.461242+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('9e39303a-85d3-4a93-9add-f99a6aee8bfb', '이용', '소개비는 언제 받나요?', '계약서에 양측이 서명하면 성사가 확정되고 정산이 자동으로 신청됩니다. 승인 후 매주 수요일 배치로 지급됩니다.', NULL, 1, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('02273663-709e-42c6-8698-c27dbd80553b', '수수료', '플랫폼이 소개비에서 수수료를 떼나요?', '떼지 않습니다. 소개비는 당사자와 소개자 사이에서 직접 오갑니다. 저희 수익은 구독료와 광고입니다.', NULL, 2, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('c09d7275-75dd-431d-b6e0-8ed23facbb67', '자격', '개인도 소개비를 받을 수 있나요?', '받을 수 없습니다. 가입과 탐색·문의는 개인도 가능하지만, 소개비 수령은 사업자 인증 후에만 가능합니다.', NULL, 3, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('21248cd9-950c-42cc-8fa7-0f91768721e1', '검수', '등록한 매물이 왜 검수 중인가요?', '첫 등록, 고액, 본문이 짧은 경우 등은 담당자가 확인합니다. 그 외에는 자동으로 승인되어 바로 노출됩니다.', NULL, 4, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('3a62280b-4642-4b54-b18a-de392cee6853', '검수', '매물을 수정하면 어떻게 되나요?', '다시 검수를 받습니다. 부여된 배지도 회수됩니다 — 확인한 시점과 내용이 달라지기 때문입니다.', NULL, 5, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('3b7e9981-de30-45f3-9bcb-3e4052ca4f4b', '분쟁', '분쟁을 접수하면 정산은 어떻게 되나요?', '해당 거래의 정산이 자동으로 보류됩니다. 처리가 끝나면 보류가 풀립니다.', NULL, 6, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('8d98ba2d-9d1f-4bdb-b549-8bf48a66302f', '구독', '구독을 해지하면 어떻게 되나요?', '노출 중인 매물이 요금제 슬롯 수만큼만 남고, 아직 성사되지 않은 소개코드는 효력을 잃습니다.', NULL, 7, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.faqs (id, category, question, answer, gwan_code, sort_order, is_active, updated_by, updated_at) VALUES ('4ea8b317-ba97-4061-8fae-0f67e8b9e2a8', '귀속', '소개 이력은 어떻게 기록되나요?', '소개코드 링크로 처음 들어온 시점부터 90일간 기록됩니다. 문의하기로 진행하면 이력이 남지만 전화 통화는 기록되지 않습니다.', NULL, 8, true, NULL, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (1, 'LEGAL', '이용약관', 'TERM', 'SERVICE', NULL, NULL, 1, true);
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (2, 'LEGAL', '개인정보처리방침', 'TERM', 'PRIVACY', NULL, NULL, 2, true);
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (4, 'LEGAL', '제3자 제공 동의', 'TERM', 'THIRDPARTY', NULL, NULL, 4, true);
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (5, 'LEGAL', '환불 정책', 'TERM', 'REFUND', NULL, NULL, 5, true);
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (6, 'SUPPORT', '고객센터', 'SCREEN', 'SB-HOM-CSB-010', NULL, NULL, 6, true);
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (7, 'SUPPORT', '분쟁조정 안내', 'SCREEN', 'SB-HOM-CSB-010', '분쟁은 고객센터의 별도 경로로 접수합니다.', NULL, 7, true);
INSERT INTO public.footer_links (id, section, label, target_type, target_ref, tip, blocked_by, sort_order, is_active) VALUES (3, 'LEGAL', '위치기반서비스 약관', 'TERM', 'LOCATION', NULL, NULL, 3, false);
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('MNY', 'OFFER', '상품·서비스', '무엇을 소개하시나요?', '사양·조건·인수 가능 시기를 적어 주세요', '상품·서비스를 소개하고 소개비를 받습니다. 등록 후 검수를 거쳐 노출됩니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('MNY', 'REQUEST', '상품·서비스', '무엇을 찾으시나요?', '필요한 사양과 조건을 적어 주세요', '필요한 상품·서비스를 올리면 소개자가 제안합니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('MAL', 'OFFER', '매물', '어떤 매물인가요?', '위치·면적·조건을 적어 주세요', '부동산·장비를 소개하고 소개비를 받습니다. 중개보수가 아닌 소개비입니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('MAL', 'REQUEST', '매물', '어떤 매물을 찾으시나요?', '원하는 위치와 조건을 적어 주세요', '찾는 매물을 올리면 소개자가 제안합니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('BIZ', 'OFFER', '사업 기회', '어떤 사업 기회인가요?', '업종·투자 규모·지원 내용을 적어 주세요', '프랜차이즈·창업 기회를 소개하고 소개비를 받습니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('BIZ', 'REQUEST', '사업 기회', '어떤 사업을 찾으시나요?', '관심 업종과 예산을 적어 주세요', '찾는 사업 기회를 올리면 소개자가 제안합니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('EARN', 'OFFER', '소개할 것', '무엇을 소개하실 수 있나요?', '아는 사람·기업·상품을 적어 주세요. 연락처는 적지 않으셔도 됩니다.', '아는 사람이 있다면 이미 소개자입니다. 상대방이 동의해야 연결되며, 동의 전에는 연락처가 전달되지 않습니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('EARN', 'REQUEST', '찾는 것', '어떤 사람이나 기업을 찾으시나요?', '지역·분야·조건을 적어 주세요. 구체적일수록 소개자가 찾기 쉽습니다.', '개인회원도 요청할 수 있습니다. 소개자가 "제가 알아요"로 응답하면 연결이 시작됩니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('HLT', 'OFFER', '건강상품', '어떤 건강상품인가요?', '품목 · 규격 · 인증 여부 · 유통기한을 적어 주십시오. 건강기능식품이면 인정받은 기능성만 적으실 수 있습니다.', '★ 효능을 단정하는 표현은 등록되지 않습니다 — "완치 · 치료 · 암 예방 · 부작용 없음 · 의사 추천"은 식품표시광고법 제8조 위반입니다. 인정받은 기능성("면역력 증진에 도움을 줄 수 있음")은 그대로 적으셔도 됩니다. 의약품과 의료 서비스는 이 관에서 취급하지 않습니다.');
INSERT INTO public.gwan_form_copy (gwan_code, role, subject, title_hint, body_hint, notice) VALUES ('HLT', 'REQUEST', '건강상품', '어떤 건강상품을 찾으시나요?', '용도 · 수량 · 납품 주기 · 인증 요건을 적어 주십시오.', '건강기능식품은 인증 여부를 함께 적으시면 맞는 곳을 더 빨리 찾습니다. 의약품은 이 관에서 소개하실 수 없습니다.');
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('03668175-1b3c-4fdb-998f-1ef58803200c', 'HLT_FUNC', 12.00, '건강기능식품 — 인정 관리 부담', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('0fc136c4-cbec-438f-bab1-141b64fa01de', 'HLT_FITNESS', 8.00, '운동 · 재활 — 부피가 커 배송비 부담', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('b3a31e69-0300-43b4-9d6b-1e5b6934b421', 'HLT_HYGIENE', 10.00, '위생 · 방역', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('37b59451-ae62-41b5-81da-b23199f01d08', 'HLT_CARE', 8.00, '요양 · 돌봄', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('b9d6eba2-3759-43da-acb6-a8a26122996e', 'HLT_ORGANIC', 10.00, '유기농 · 친환경', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('4de143eb-a2ed-4283-9087-5a3924a2920b', 'HLT_MEDDEV', 12.00, '의료기기 — 심의 관리 부담', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('4b251b43-1a7b-434b-958e-3aff6a3b54b3', '*', 10.00, '기본 수수료율. 카테고리별 요율이 없으면 이것을 씁니다.', NULL, '2026-09-18 01:31:42.097854+00', 0.00);
INSERT INTO public.hlt_commission_rates (id, category_code, rate, note, updated_by, updated_at, referral_pct) VALUES ('ae8b4589-cd11-4a4a-b7be-318237c07df3', 'HLT_FOOD', 10.00, '건강식품', NULL, '2026-09-18 01:25:26.77381+00', 0.00);
INSERT INTO public.hlt_sellers (id, code, name, type, account_id, biz_reg_no, ceo_name, ecom_reg_no, cs_tel, return_addr, submerchant_id, commission_rate, status, memo, created_at, updated_at, addr) VALUES ('efaa817b-22a3-414c-acde-1da1379babd9', 'SGB-DIRECT', '소개뱅크 직판관', 'DIRECT', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, 'ACTIVE', '우리가 직접 매입해 파는 것. 수수료 0 — 우리 매출이라 뗄 것이 없습니다.', '2026-09-18 01:25:26.77381+00', '2026-09-18 01:25:26.77381+00', NULL);
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('PASS', '본인인증', 'INV-7 게이트', NULL, 'NOT_STARTED', true, NULL, NULL, NULL, 'PASS_API_KEY', false, 6, true, 'CI 는 해시만 저장합니다. 원문을 두면 유출 시 피해 범위가 달라집니다.', 3, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('BANK', '1원 계좌인증', '정산 계좌 검증', NULL, 'NOT_STARTED', true, NULL, NULL, NULL, 'BANK_VERIFY_KEY', false, 4, true, '미인증 계좌로는 정산 지급이 불가합니다.', 4, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('NTS', '국세청 사업자 진위', '사업자등록 상태 조회', NULL, 'TESTING', true, NULL, NULL, NULL, 'NTS_SERVICE_KEY', true, 2, false, '키 발급 완료(환경변수 NTS_SERVICE_KEY). 활용신청 승인과 실제 응답을 확인한 뒤 LIVE 로 올리십시오. 응답 처리는 scripts/test-nts-offline.ts 가 상시 검증합니다(10건).', 1, NULL, '2026-09-08 07:27:00.666389+00');
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('PG', '전자결제', '구독료 · 초과 코드 요금', NULL, 'TESTING', true, NULL, NULL, NULL, 'PG_SECRET_KEY', false, 5, true, '어댑터 구현 완료(TossPaymentProvider). 문서용 샘플 키로 응답 처리 15건 검증. 상점 키 발급과 실제 승인 확인이 남았습니다. INV-11: 구독료·초과코드 요금만 태우며 소개비는 태우지 않습니다.', 2, NULL, '2026-09-08 07:27:00.667956+00');
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('ALIMTALK', '알림톡 · SMS', '거래 알림 · 서명 요청', NULL, 'NOT_STARTED', true, NULL, NULL, NULL, 'ALIMTALK_KEY', false, 8, false, '발신번호 사전등록과 템플릿 승인이 함께 필요합니다. 실패 시 인앱 폴백.', 5, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('SAFENUM', '050 안심번호', '통화 귀속 (B-19)', NULL, 'NOT_STARTED', true, NULL, NULL, NULL, 'SAFENUM_KEY', false, NULL, false, 'INV-2 위험 해소의 유일한 수단입니다. 도입 여부 미결.', 6, NULL, '2026-09-07 12:05:02.731454+00');
INSERT INTO public.integrations (code, name, purpose, provider, status, requires_ip, egress_ip, ip_requested_at, ip_approved_at, secret_key_name, secret_registered, lead_time_weeks, blocks_open, memo, sort_order, updated_by, updated_at) VALUES ('ESIGN', '전자계약', '표준계약서 서명', NULL, 'NOT_STARTED', false, NULL, NULL, NULL, 'ESIGN_API_KEY', false, 2, false, '연동 전에는 서명 요청이 나가지 않습니다. 화면이 그 사실을 표시해야 합니다.', 90, NULL, '2026-09-18 01:46:10.298489+00');
INSERT INTO public.item_types (code, name, description, requires_business, connect_mode, sort_order, is_active) VALUES ('PRODUCT', '상품', '판매 중인 물건. 외부 제휴링크로 연결합니다', true, 'AFFILIATE', 1, true);
INSERT INTO public.item_types (code, name, description, requires_business, connect_mode, sort_order, is_active) VALUES ('SERVICE', '서비스', '시공·용역 등. 동의형 상담과 계약으로 추적합니다', true, 'CONSENT', 2, true);
INSERT INTO public.item_types (code, name, description, requires_business, connect_mode, sort_order, is_active) VALUES ('STARTUP', '창업', '프랜차이즈·창업 기회. 동의형 상담으로 추적합니다', true, 'CONSENT', 3, true);
INSERT INTO public.item_types (code, name, description, requires_business, connect_mode, sort_order, is_active) VALUES ('PERSON', '사람', '전문가·기술자. 본인 동의 후 연결합니다', false, 'CONSENT', 4, true);
INSERT INTO public.item_types (code, name, description, requires_business, connect_mode, sort_order, is_active) VALUES ('COMPANY', '기업', '협력사·거래처. 담당자 동의 후 연결합니다', false, 'CONSENT', 5, true);
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('notify_dispatch', 10, NULL, NULL, NULL, true, '알림 외부 발송');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('subscription_billing', 120, NULL, NULL, NULL, true, '구독 자동 청구 — 매출 직결');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('sla_alert', 60, NULL, NULL, NULL, true, '검수 24시간 SLA');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('expire_badges', 60, NULL, NULL, NULL, true, '급구 배지 만료');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('risk_scan', 60, NULL, NULL, NULL, true, '위험 규칙 자동 탐지');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('k_alert', 60, NULL, NULL, NULL, true, '핵심 지표 경보');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('attribution_archive', 1440, 3, 0, NULL, true, '귀속 로그 보관');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('pii_purge', 1440, 3, 30, NULL, true, '탈퇴 파기 · IP 마스킹 — 법적 의무');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('deal_auto_confirm', 1440, 9, 0, NULL, true, '7일 무응답 자동 확정');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('promo_expiry', 1440, 10, 0, NULL, true, '무료 종료 D-14 고지');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('settlement_audit', 1440, 10, 0, 4, true, '정산 정합성 점검 (수요일)');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('contract_nudge', 1440, 9, 0, NULL, true, '3일 넘게 멈춘 계약을 양측에 알립니다. 한쪽이 잊었을 뿐인 경우가 많고, 방치하면 소개자가 중간에서 곤란해집니다.');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('ad_expiry_notice', 1440, 10, 0, NULL, true, '7일 안에 만료되는 광고 소재를 운영에 알립니다. 만료되면 그 자리가 비고, 팔린 자리라면 환불 대상이 됩니다.');
INSERT INTO public.job_schedules (job, every_min, at_hour, at_minute, at_dow, is_active, description) VALUES ('event_close', 1440, 0, 5, NULL, true, '기간이 지난 이벤트를 ENDED 로 바꿉니다. 끝난 이벤트가 걸려 있으면 서비스가 관리되지 않는 것으로 보입니다.');
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('S', 1.00, '상담 의사 확인 · 정보 완결', NULL, 1);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('A', 0.85, '상담 의사 확인', NULL, 2);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('B', 0.70, '응답 있음', NULL, 3);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('C', 0.55, '응답 지연', NULL, 4);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('D', 0.40, '미응답', NULL, 5);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('E', 0.28, '미응답 · 정보 부족', NULL, 6);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('F', 0.18, '연락처 오류', NULL, 7);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('G', 0.10, '발송 실패', NULL, 8);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('S', 0.90, NULL, 'HLT', 1);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('A', 0.77, NULL, 'HLT', 2);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('B', 0.63, NULL, 'HLT', 3);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('C', 0.50, NULL, 'HLT', 4);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('D', 0.36, NULL, 'HLT', 5);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('E', 0.25, NULL, 'HLT', 6);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('F', 0.16, NULL, 'HLT', 7);
INSERT INTO public.lead_grade_rates (grade, rate, note, gwan_code, rank) VALUES ('G', 0.09, NULL, 'HLT', 8);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('TITLE_LEN', '제목 10자 이상', 'LISTING', true, 'length(btrim(title)) >= 10', '제목을 10자 이상 적어 주십시오 — 짧으면 무엇인지 알기 어렵습니다.', 10, NULL);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('BODY_LEN', '본문 30자 이상', 'LISTING', true, 'length(btrim(body)) >= 30', '본문을 30자 이상 적어 주십시오. 지역·규모·시기를 적으시면 맞는 분이 더 빨리 찾습니다.', 20, NULL);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('FEE_SET', '희망 소개비 입력', 'LISTING', true, 'desired_fee IS NOT NULL AND desired_fee > 0', '희망 소개비를 적어 주십시오. 비어 있으면 소개자가 판단할 수 없습니다.', 30, NULL);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('FEE_BEARER', '소개비 부담 주체', 'LISTING', true, 'coalesce(btrim(fee_bearer), '''') <> ''''', '소개비를 누가 낼지 골라 주십시오 — 나중에 가장 많이 다투는 지점입니다.', 40, NULL);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('CATEGORY', '업종 선택', 'LISTING', true, 'category_id IS NOT NULL', '업종을 골라 주십시오.', 50, NULL);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('NO_CONTACT', '본문에 연락처 없음', 'LISTING', true, 'body !~ ''(01[0-9][- ]?[0-9]{3,4}[- ]?[0-9]{4}|@[a-z]+\.[a-z]+|카톡|오픈채팅)''', '본문에 연락처를 적지 마십시오. 플랫폼 밖에서 연결되면 분쟁 시 기록이 남지 않습니다.', 60, NULL);
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('BIZ_PREMIUM', '권리금 표기', 'LISTING', true, ' (body ~ ''권리금'' OR body ~ ''무권리'') ', '권리금 유무를 적어 주십시오. 가장 많이 묻는 항목입니다.', 10, 'BIZ');
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('BIZ_LICENSE', '인허가 승계 여부', 'LISTING', true, ' (body ~ ''인허가'' OR body ~ ''영업신고'' OR body ~ ''승계'') ', '인허가 승계가 되는지 적어 주십시오. 안 되면 처음부터 받아야 합니다.', 11, 'BIZ');
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('HLT_CERT', '인증번호 표기', 'LISTING', true, ' (body ~ ''제[0-9]'' OR body ~ ''인증'' OR body ~ ''신고번호'') ', '건강기능식품이면 인정번호를, 그 외는 품목제조신고번호를 적어 주십시오.', 10, 'HLT');
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('HLT_EXPIRY', '유통기한 표기', 'LISTING', true, ' (body ~ ''유통기한'' OR body ~ ''소비기한'') ', '유통기한 또는 소비기한을 적어 주십시오.', 11, 'HLT');
INSERT INTO public.listing_checklist (code, label, target_type, is_required, check_sql, fail_message, sort_order, gwan_code) VALUES ('MAL_AREA', '면적 표기', 'LISTING', true, ' (body ~ ''[0-9]+\s*(평|㎡|m2)'') ', '면적을 적어 주십시오. 평 또는 ㎡ 로 씁니다.', 10, 'MAL');
INSERT INTO public.main_copy (slot, text, note, updated_at) VALUES ('HERO_TITLE', '아는 사람이 있다면 이미 소개자입니다', '메인 제목', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_copy (slot, text, note, updated_at) VALUES ('HERO_SUB', '내가 알고 있는 좋은 사람과 기업을 필요한 사람에게 연결하세요', '부제', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_copy (slot, text, note, updated_at) VALUES ('HERO_CTA', '소개자로 시작하기', '행동 버튼', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_sections (code, name, sort_order, is_active, is_locked, description, updated_at) VALUES ('EARN', '소개하고 벌기', 1, true, true, '메인 최상단 · 끌 수 없습니다', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_sections (code, name, sort_order, is_active, is_locked, description, updated_at) VALUES ('MATCHED', '오늘의 소개 요청', 2, true, false, '소개자에게 맞춤 노출', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_sections (code, name, sort_order, is_active, is_locked, description, updated_at) VALUES ('URGENT', '급구', 3, true, false, '마감 임박 요청', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_sections (code, name, sort_order, is_active, is_locked, description, updated_at) VALUES ('NEW', '신규 등록', 4, true, false, '최근 7일', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.main_sections (code, name, sort_order, is_active, is_locked, description, updated_at) VALUES ('STORY', '성공 사례', 5, false, false, '사례가 쌓이면 켭니다', '2026-09-10 07:48:18.156512+00');
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('LISTING_SUBMITTED', '등록 접수', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('LISTING_APPROVED', '등록 승인', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('LISTING_REJECTED', '등록 반려', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('LISTING_RESTRICTED', '제한업종 지정으로 노출 중단', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('BADGE_GRANTED', '배지 부여', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('BADGE_REJECTED', '배지 반려', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('BADGE_EXPIRING', '급구 만료 임박', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('INQUIRY_RECEIVED', '새 문의', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('MESSAGE_RECEIVED', '새 메시지', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('PROPOSAL_RECEIVED', '소개 제안 도착', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('CONTRACT_ISSUED', '계약서 발급', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('CONTRACT_SIGN_REQUIRED', '서명 요청', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('DEAL_CONFIRMED', '성사 확정', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('PAYMENT_REPORTED', '대금 지급 신고', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SETTLEMENT_REQUESTED', '정산 신청 접수', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SETTLEMENT_PAID', '정산 지급 완료', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SETTLEMENT_HELD', '분쟁으로 정산 보류', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SETTLEMENT_BLOCKED_INDIVIDUAL', '사업자 전환 필요', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SUBSCRIPTION_RENEWED', '구독 갱신', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('PROMO_ENDING', '무료 기간 종료 예정', false, false, 'B-14 자동 유료 전환 고지');
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('QUOTA_EXCEEDED', '이용 한도 도달', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('BUSINESS_APPROVED', '사업자 인증 완료', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('BUSINESS_REJECTED', '사업자 인증 반려', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('DISPUTE_OPENED', '분쟁 접수', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('DISPUTE_RESOLVED', '분쟁 처리 완료', false, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('INQUIRY_ANSWERED', '문의 답변', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('NOTICE_PUBLISHED', '공지 등록', true, false, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SUBSCRIPTION_PAYMENT_FAILED', '결제 실패', false, true, NULL);
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SUBSCRIPTION_CARD_UNUSABLE', '결제 수단 사용 불가', false, true, '계약 이행에 관한 통지');
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('SUBSCRIPTION_NO_METHOD', '결제 수단 미등록', false, true, '계약 이행에 관한 통지');
INSERT INTO public.notification_event_policies (event_code, name, optout_allowed, quiet_hours_exempt, legal_basis) VALUES ('INTRO_INVITE', '소개 초대', true, false, '수신자 동의를 구하는 안내. 동의 전에는 연락처가 요청자에게 전달되지 않습니다.');
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_SUBMITTED_INAPP', 'INAPP', '등록이 접수되었습니다', '{title} 등록을 접수했습니다. 검수 결과는 24시간 이내에 알려 드립니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_APPROVED_INAPP', 'INAPP', '등록이 승인되었습니다', '{title}이(가) 노출되기 시작했습니다. 문의가 오면 알림으로 알려 드립니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_APPROVED_EMAIL', 'EMAIL', '[소개뱅크] 등록이 승인되었습니다', '{title}이(가) 노출되기 시작했습니다. 문의가 오면 알림으로 알려 드립니다.

본 메일은 발신 전용입니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_REJECTED_INAPP', 'INAPP', '등록이 반려되었습니다', '{title} — {reason}
내용을 수정한 뒤 다시 등록해 주세요.', '["title", "reason"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_REJECTED_EMAIL', 'EMAIL', '[소개뱅크] 등록이 반려되었습니다', '{title} — {reason}
내용을 수정한 뒤 다시 등록해 주세요.

본 메일은 발신 전용입니다.', '["title", "reason"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_RESTRICTED_INAPP', 'INAPP', '노출이 중단되었습니다', '{title}은(는) {category} 업종이 등록 제한 대상으로 지정되어 노출이 중단되었습니다. 자세한 내용은 고객센터로 문의해 주세요.', '["title", "category"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('LISTING_RESTRICTED_EMAIL', 'EMAIL', '[소개뱅크] 노출이 중단되었습니다', '{title}은(는) {category} 업종이 등록 제한 대상으로 지정되어 노출이 중단되었습니다. 자세한 내용은 고객센터로 문의해 주세요.

본 메일은 발신 전용입니다.', '["title", "category"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BADGE_GRANTED_INAPP', 'INAPP', '{badge} 배지가 부여되었습니다', '{title}에 {badge} 배지가 적용되었습니다. {validUntil}까지 유지됩니다.', '["title", "badge", "validUntil"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BADGE_REJECTED_INAPP', 'INAPP', '배지 신청이 반려되었습니다', '{title}의 {badge} 배지 신청이 반려되었습니다. 사유: {reason}', '["title", "badge", "reason"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BADGE_EXPIRING_INAPP', 'INAPP', '배지 만료가 다가옵니다', '{title}의 {badge} 배지가 {days}일 뒤 만료됩니다. 계속 사용하려면 다시 신청해 주세요.', '["title", "badge", "days"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INQUIRY_RECEIVED_INAPP', 'INAPP', '새 문의가 도착했습니다', '{title}에 문의가 왔습니다. 빠른 응답이 성사율을 높입니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INQUIRY_RECEIVED_PUSH', 'PUSH', '새 문의가 도착했습니다', '{title}에 문의가 왔습니다. 빠른 응답이 성사율을 높입니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('MESSAGE_RECEIVED_INAPP', 'INAPP', '새 메시지가 있습니다', '{counterpart}님이 메시지를 보냈습니다.', '["counterpart"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('MESSAGE_RECEIVED_PUSH', 'PUSH', '새 메시지가 있습니다', '{counterpart}님이 메시지를 보냈습니다.', '["counterpart"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('PROPOSAL_RECEIVED_INAPP', 'INAPP', '소개 제안이 도착했습니다', '{requestTitle}에 소개 제안이 왔습니다. 제안 내용을 확인해 주세요.', '["requestTitle"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('PROPOSAL_RECEIVED_PUSH', 'PUSH', '소개 제안이 도착했습니다', '{requestTitle}에 소개 제안이 왔습니다. 제안 내용을 확인해 주세요.', '["requestTitle"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('CONTRACT_ISSUED_INAPP', 'INAPP', '계약서가 발급되었습니다', '{title} 거래의 계약서가 발급되었습니다. 소개비 {amount}원으로 확정되었으며, 이 금액은 서명 후 변경할 수 없습니다.', '["title", "amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('CONTRACT_ISSUED_EMAIL', 'EMAIL', '[소개뱅크] 계약서가 발급되었습니다', '{title} 거래의 계약서가 발급되었습니다. 소개비 {amount}원으로 확정되었으며, 이 금액은 서명 후 변경할 수 없습니다.

본 메일은 발신 전용입니다.', '["title", "amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('CONTRACT_SIGN_REQUIRED_INAPP', 'INAPP', '서명이 필요합니다', '{counterpart}님이 계약서에 서명했습니다. 회원님의 서명이 완료되면 성사가 확정됩니다.', '["counterpart"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('CONTRACT_SIGN_REQUIRED_EMAIL', 'EMAIL', '[소개뱅크] 서명이 필요합니다', '{counterpart}님이 계약서에 서명했습니다. 회원님의 서명이 완료되면 성사가 확정됩니다.

본 메일은 발신 전용입니다.', '["counterpart"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('CONTRACT_SIGN_REQUIRED_SMS', 'SMS', '', '[소개뱅크] 계약 서명이 필요합니다. 앱에서 확인해 주세요.', '["counterpart"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('DEAL_CONFIRMED_INAPP', 'INAPP', '성사가 확정되었습니다', '{title} 거래가 성사되었습니다. 소개비 {amount}원은 소개자에게 공제 없이 전액 지급됩니다.', '["title", "amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('DEAL_CONFIRMED_EMAIL', 'EMAIL', '[소개뱅크] 성사가 확정되었습니다', '{title} 거래가 성사되었습니다. 소개비 {amount}원은 소개자에게 공제 없이 전액 지급됩니다.

본 메일은 발신 전용입니다.', '["title", "amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('PAYMENT_REPORTED_INAPP', 'INAPP', '대금 지급이 신고되었습니다', '{counterpart}님이 대금 지급을 신고했습니다. 확인 후 서명해 주세요. 7일간 응답이 없으면 자동으로 확정됩니다.', '["counterpart"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_HELD_INAPP', 'INAPP', '정산이 보류되었습니다', '{title} 거래에 분쟁이 접수되어 정산이 보류되었습니다. 처리가 끝나면 보류가 해제됩니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_HELD_EMAIL', 'EMAIL', '[소개뱅크] 정산이 보류되었습니다', '{title} 거래에 분쟁이 접수되어 정산이 보류되었습니다. 처리가 끝나면 보류가 해제됩니다.

본 메일은 발신 전용입니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_BLOCKED_INDIVIDUAL_INAPP', 'INAPP', '사업자 전환이 필요합니다', '{title} 거래가 성사되어 소개비 {amount}원을 받으실 수 있습니다. 다만 소개비는 사업자만 수령할 수 있어 정산이 보류되었습니다. 사업자 인증을 완료해 주세요.', '["title", "amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_BLOCKED_INDIVIDUAL_EMAIL', 'EMAIL', '[소개뱅크] 사업자 전환이 필요합니다', '{title} 거래가 성사되어 소개비 {amount}원을 받으실 수 있습니다. 다만 소개비는 사업자만 수령할 수 있어 정산이 보류되었습니다. 사업자 인증을 완료해 주세요.

본 메일은 발신 전용입니다.', '["title", "amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_RENEWED_INAPP', 'INAPP', '구독이 갱신되었습니다', '{plan} 요금제가 갱신되었습니다. 다음 결제일은 {nextDate}입니다.', '["plan", "nextDate"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_RENEWED_EMAIL', 'EMAIL', '[소개뱅크] 구독이 갱신되었습니다', '{plan} 요금제가 갱신되었습니다. 다음 결제일은 {nextDate}입니다.

본 메일은 발신 전용입니다.', '["plan", "nextDate"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_PAYMENT_FAILED_INAPP', 'INAPP', '결제에 실패했습니다', '{plan} 요금제 결제가 실패했습니다. 결제 수단을 확인해 주세요. {graceDays}일 안에 결제되지 않으면 노출 중인 매물이 슬롯 수만큼만 남습니다.', '["plan", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_PAYMENT_FAILED_EMAIL', 'EMAIL', '[소개뱅크] 결제에 실패했습니다', '{plan} 요금제 결제가 실패했습니다. 결제 수단을 확인해 주세요. {graceDays}일 안에 결제되지 않으면 노출 중인 매물이 슬롯 수만큼만 남습니다.

본 메일은 발신 전용입니다.', '["plan", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_PAYMENT_FAILED_SMS', 'SMS', '', '[소개뱅크] 결제 실패. 앱에서 확인해 주세요.', '["plan", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('PROMO_ENDING_INAPP', 'INAPP', '무료 기간이 곧 끝납니다', '무료 이용 기간이 {days}일 뒤 종료됩니다. 종료 후에는 {plan} 요금제로 자동 전환되며 월 {price}원이 결제됩니다. 원하지 않으시면 그 전에 해지해 주세요.', '["days", "plan", "price"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('PROMO_ENDING_EMAIL', 'EMAIL', '[소개뱅크] 무료 기간이 곧 끝납니다', '무료 이용 기간이 {days}일 뒤 종료됩니다. 종료 후에는 {plan} 요금제로 자동 전환되며 월 {price}원이 결제됩니다. 원하지 않으시면 그 전에 해지해 주세요.

본 메일은 발신 전용입니다.', '["days", "plan", "price"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('QUOTA_EXCEEDED_INAPP', 'INAPP', '이용 한도에 도달했습니다', '이번 달 {quotaName} 한도({limit}건)를 모두 사용했습니다. 상위 요금제로 변경하면 계속 이용하실 수 있습니다.', '["quotaName", "limit"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BUSINESS_APPROVED_INAPP', 'INAPP', '사업자 인증이 완료되었습니다', '사업자 인증이 완료되었습니다. 이제 소개비를 받으실 수 있습니다. 인증일({date})이 수령 자격의 기준일이 됩니다.', '["date"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BUSINESS_APPROVED_EMAIL', 'EMAIL', '[소개뱅크] 사업자 인증이 완료되었습니다', '사업자 인증이 완료되었습니다. 이제 소개비를 받으실 수 있습니다. 인증일({date})이 수령 자격의 기준일이 됩니다.

본 메일은 발신 전용입니다.', '["date"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BUSINESS_REJECTED_INAPP', 'INAPP', '사업자 인증이 반려되었습니다', '사업자 인증이 반려되었습니다. 사유: {reason}
내용을 확인한 뒤 다시 신청해 주세요.', '["reason"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('BUSINESS_REJECTED_EMAIL', 'EMAIL', '[소개뱅크] 사업자 인증이 반려되었습니다', '사업자 인증이 반려되었습니다. 사유: {reason}
내용을 확인한 뒤 다시 신청해 주세요.

본 메일은 발신 전용입니다.', '["reason"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('DISPUTE_OPENED_INAPP', 'INAPP', '분쟁이 접수되었습니다', '{title} 거래에 분쟁이 접수되었습니다. 해당 거래의 정산이 보류되며, 담당자가 확인 후 연락드립니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('DISPUTE_OPENED_EMAIL', 'EMAIL', '[소개뱅크] 분쟁이 접수되었습니다', '{title} 거래에 분쟁이 접수되었습니다. 해당 거래의 정산이 보류되며, 담당자가 확인 후 연락드립니다.

본 메일은 발신 전용입니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('DISPUTE_RESOLVED_INAPP', 'INAPP', '분쟁 처리가 완료되었습니다', '{title} 거래의 분쟁이 처리되었습니다. 결과: {resolution}', '["title", "resolution"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('DISPUTE_RESOLVED_EMAIL', 'EMAIL', '[소개뱅크] 분쟁 처리가 완료되었습니다', '{title} 거래의 분쟁이 처리되었습니다. 결과: {resolution}

본 메일은 발신 전용입니다.', '["title", "resolution"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INQUIRY_ANSWERED_INAPP', 'INAPP', '문의에 답변이 등록되었습니다', '"{title}" 문의에 답변이 등록되었습니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INQUIRY_ANSWERED_EMAIL', 'EMAIL', '[소개뱅크] 문의에 답변이 등록되었습니다', '"{title}" 문의에 답변이 등록되었습니다.

본 메일은 발신 전용입니다.', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('NOTICE_PUBLISHED_INAPP', 'INAPP', '새 공지가 있습니다', '{title}', '["title"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_PAID_INAPP', 'INAPP', '지급 완료로 표시되었습니다', '{amount}원 소개비가 지급 완료로 표시되었습니다. 당사자가 남긴 기록이며, 실제 입금 여부는 직접 확인해 주세요.', '["amount", "bank", "account"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_PAID_EMAIL', 'EMAIL', '[소개뱅크] 지급 완료로 표시되었습니다', '{amount}원 소개비가 지급 완료로 표시되었습니다. 당사자가 남긴 기록이며, 실제 입금 여부는 직접 확인해 주세요.

본 메일은 발신 전용입니다.', '["amount", "bank", "account"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_PAID_SMS', 'SMS', '', '[소개뱅크] 소개비 지급이 표시됐습니다. 앱에서 확인해 주세요.', '["amount", "bank", "account"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SETTLEMENT_REQUESTED_INAPP', 'INAPP', '정산이 신청되었습니다', '{amount}원 소개비는 거래 당사자끼리 직접 정하고 지급합니다. 소개뱅크는 소개비에 관여하지 않습니다.', '["amount"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_CARD_UNUSABLE_INAPP', 'INAPP', '결제 수단을 바꿔 주세요', '{plan} 요금제 결제가 실패했습니다. 등록된 카드를 쓸 수 없는 상태입니다({reason}). 재시도로는 해결되지 않으니 결제 수단을 다시 등록해 주세요. {graceDays}일 안에 등록되지 않으면 구독이 만료됩니다.', '["plan", "reason", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_CARD_UNUSABLE_EMAIL', 'EMAIL', '[소개뱅크] 결제 수단을 바꿔 주세요', '{plan} 요금제 결제가 실패했습니다. 등록된 카드를 쓸 수 없는 상태입니다({reason}). 재시도로는 해결되지 않으니 결제 수단을 다시 등록해 주세요. {graceDays}일 안에 등록되지 않으면 구독이 만료됩니다.

본 메일은 발신 전용입니다.', '["plan", "reason", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_NO_METHOD_INAPP', 'INAPP', '결제 수단이 등록되지 않았습니다', '{plan} 요금제 갱신일이 지났지만 등록된 결제 수단이 없습니다. {graceDays}일 안에 등록하지 않으면 구독이 만료됩니다.', '["plan", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_NO_METHOD_EMAIL', 'EMAIL', '[소개뱅크] 결제 수단이 등록되지 않았습니다', '{plan} 요금제 갱신일이 지났지만 등록된 결제 수단이 없습니다. {graceDays}일 안에 등록하지 않으면 구독이 만료됩니다.

본 메일은 발신 전용입니다.', '["plan", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('SUBSCRIPTION_CARD_UNUSABLE_SMS', 'SMS', NULL, '[소개뱅크] 카드 문제로 결제 실패. 결제수단을 바꿔 주세요.', '["plan", "reason", "graceDays"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INTRO_INVITE_SMS', 'SMS', NULL, '[소개뱅크] 소개 요청이 있습니다. 확인 후 동의해 주세요. {link}', '["link"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INTRO_INVITE_ALIMTALK', 'ALIMTALK', '소개 요청 확인', '{introducer}님이 회원님을 소개하려 합니다.

요청: {title}
내용을 확인하고 연결에 동의하시면 진행됩니다. 동의하지 않으면 아무 일도 일어나지 않습니다.

{link}', '["introducer", "title", "link"]', true);
INSERT INTO public.notification_templates (code, channel, title, body, variables, is_active) VALUES ('INTRO_INVITE_EMAIL', 'EMAIL', '[소개뱅크] 소개 요청을 확인해 주세요', '{introducer}님이 회원님을 소개하려 합니다.

요청: {title}
내용을 확인하고 연결에 동의하시면 진행됩니다. 동의하지 않으면 아무 일도 일어나지 않으며, 회원님의 연락처는 요청자에게 전달되지 않습니다.

{link}

본 메일은 발신 전용입니다.', '["introducer", "title", "link"]', true);
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('Q1-OWNER', '소유자 직거래 게이트 개방', '법무 Q1 회신', 'MEDIUM', false, '등록·심사(설계서 1~2단계)는 회신 없이 만들어 뒀습니다. 게이트를 실제로 여는 3단계만 회신 종속입니다 — mal.owner_direct_ready 를 on 으로 바꾸면 열립니다.');
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('C3-SCOPE', '보험·의료 소개·알선 (광고는 이미 가능)', '정리 완료 — 광고/소개 분리', 'LOW', false, '광고는 AD_ONLY 로 열었습니다. 소개·알선은 의료법 27조·보험업법상 금지이므로 계속 막습니다. 이것을 풀려면 법 개정이 필요하지 법무 회신으로 되는 일이 아닙니다.');
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('B12-ADPERSONAL', '성향 타게팅 — 회신 완료', 'B-12 회신 완료 (문제없음)', 'LOW', false, '2026-09-11 회신: 문제없음. 소급 수정·파기 위험이 사라졌습니다. ADPERSONAL 1.0 은 그대로 유효하며 이미 받은 동의도 유지됩니다. 동의 강제 장치(INV-AD1~4)는 그대로 두십시오 — 회신은 "지금 구조라면 문제없다"는 뜻이지 동의를 빼도 된다는 뜻이 아닙니다.');
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('C3-LEADFEE', '리드 단가 · 손익분기', '3주 실측 (열람률 · 결제율)', 'MEDIUM', false, '도입가 3,000원으로 시작합니다(손익분기 2,209원 · 기여이익 435원). 8,000원은 실측 확인비용 800원대와 10배 차이라 쓰지 않았습니다. 3주 뒤 v_lead_economics 의 실측 열람률로 손익분기를 다시 계산하고 단가를 정하십시오. 단가보다 열람률·CPL 이 결과를 더 크게 흔듭니다.');
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('A00R-REGISTRY', '중개사 인증 흐름', '진행 완료', 'LOW', false, '국토부 대조 + 운영 확인 2단 구조로 만들었습니다. 자동 승인 경로는 두지 않았습니다 — 대조가 맞아도 명의 도용은 거를 수 없습니다. 180일 재확인 기한을 둡니다.');
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('C3-CATEGORY', '카테고리 마스터 · 등급표', '진행 완료', 'LOW', false, '등급 8종과 비율표를 만들었습니다. 상한 과금액 하나로 단가표가 자동 전개됩니다. 비율은 단조감소가 강제됩니다 — S 가 A 보다 싸면 체계가 뒤집힙니다.');
INSERT INTO public.pending_decisions (code, title, depends_on, risk, blocks_open, note) VALUES ('I06-SCOPE', '제한업종 관 단위 전환', '진행 완료', 'LOW', false, 'v_restriction_scope 로 전 관 공통과 관 전용을 구분해 볼 수 있습니다. 전 관 공통을 바꾸면 모든 관이 함께 바뀝니다.');
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('PROFILE_COMPLETE', '본인인증 · 프로필 완료', 1000, true, 1, true, 1);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('FIELDS_REGISTERED', '소개 가능 분야 3개 등록', 500, true, 1, true, 2);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('FIRST_INVITE', '첫 소개 초대 발송', 500, true, 1, true, 3);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('INVITE_CONSENTED', '상대방이 소개를 수락', 2000, true, 30, true, 4);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('VALID_CONNECTION', '유효한 상담 연결 완료', 5000, true, 30, true, 5);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('HIGH_SATISFACTION', '높은 만족도 연결', 2000, true, 30, true, 6);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('MONTHLY_TOP', '월간 우수 소개자', 30000, true, 1, true, 7);
INSERT INTO public.point_rules (code, name, points, needs_valid, monthly_cap, is_active, sort_order) VALUES ('INVITE_ACTIVATED', '초대한 소개자의 첫 활동 완료(1회성)', 3000, true, 5, true, 8);
INSERT INTO public.profile_questions (code, question, is_multi, sort_order) VALUES ('q1', '어떤 분야를 주로 다루십니까?', true, 0);
INSERT INTO public.profile_questions (code, question, is_multi, sort_order) VALUES ('q2', '소개뱅크에서 주로 어느 쪽이십니까?', false, 1);
INSERT INTO public.profile_questions (code, question, is_multi, sort_order) VALUES ('q3', '사업 규모는 어느 정도입니까?', false, 2);
INSERT INTO public.profile_questions (code, question, is_multi, sort_order) VALUES ('q4', '관심 있는 거래 규모는?', false, 3);
INSERT INTO public.profile_questions (code, question, is_multi, sort_order) VALUES ('q5', '주 활동 지역은?', false, 4);
INSERT INTO public.profile_questions (code, question, is_multi, sort_order) VALUES ('q6', '의사결정 속도는?', false, 5);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q1', 're', '부동산 · 점포', '{"SEG-A": 3}', 0);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q1', 'fr', '프랜차이즈 · 창업', '{"SEG-B": 3}', 1);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q1', 'lg', '물류 · 유통', '{"SEG-C": 3}', 2);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q1', 'in', '인테리어 · 시공', '{"SEG-D": 3}', 3);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q1', 'it', 'IT · 마케팅', '{"SEG-E": 3}', 4);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q1', 'en', '에너지 · 태양광', '{"SEG-F": 3}', 5);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q2', 'give', '소개하는 쪽 — 아는 곳을 연결합니다', '{"SEG-A": 1, "SEG-B": 1}', 0);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q2', 'take', '소개받는 쪽 — 거래처를 찾습니다', '{"SEG-C": 1, "SEG-D": 1}', 1);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q2', 'both', '둘 다', '{"SEG-A": 1, "SEG-C": 1}', 2);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q3', 's1', '1인 · 소상공인', '{"SEG-B": 2}', 0);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q3', 's2', '10인 미만', '{"SEG-B": 1, "SEG-D": 1}', 1);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q3', 's3', '10~50인', '{"SEG-C": 1, "SEG-E": 1}', 2);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q3', 's4', '50인 이상', '{"SEG-C": 2, "SEG-F": 1}', 3);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q4', 'm1', '1천만원 미만', '{"SEG-E": 2}', 0);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q4', 'm2', '1천만~5천만원', '{"SEG-D": 2}', 1);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q4', 'm3', '5천만~2억원', '{"SEG-A": 2, "SEG-B": 1}', 2);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q4', 'm4', '2억원 이상', '{"SEG-A": 1, "SEG-F": 2}', 3);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q5', 'r1', '수도권', '{"SEG-A": 1, "SEG-E": 1}', 0);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q5', 'r2', '충청 · 강원', '{"SEG-F": 1}', 1);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q5', 'r3', '영남', '{"SEG-A": 1, "SEG-C": 1}', 2);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q5', 'r4', '호남 · 제주', '{"SEG-D": 1, "SEG-F": 1}', 3);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q5', 'r5', '전국', '{"SEG-C": 1}', 4);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q6', 'd1', '지금 바로 진행할 건이 있습니다', '{"SEG-A": 2, "SEG-D": 1}', 0);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q6', 'd2', '1~3개월 안에 결정합니다', '{"SEG-B": 1, "SEG-C": 1}', 1);
INSERT INTO public.profile_options (question_code, code, label, weights, sort_order) VALUES ('q6', 'd3', '아직 알아보는 단계입니다', '{"SEG-E": 1}', 2);
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES ('MEDICAL', '의료', '의료기관 개설신고증 · 광고 심의필', '의료법 27조 · 56조', true, true);
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES ('ELECTRIC', '전기공사', '전기공사업 등록증', '전기공사업법', true, true);
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES ('BROKER', '중개', '공인중개사 자격증 · 개설등록증', '공인중개사법 33조', true, true);
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES ('LOAN', '대부', '대부업 등록증', '대부업법 — 등록 자체 불가', true, true);
INSERT INTO public.qualification_rules (category_code, category_name, required_doc, legal_basis, needs_lookup, is_active) VALUES ('MLM', '다단계', '—', '방문판매법 — 등록 불가', true, true);
INSERT INTO public.recommend_weights (code, name, weight, sort_order) VALUES ('loc', '지역 적합', 30, 0);
INSERT INTO public.recommend_weights (code, name, weight, sort_order) VALUES ('cat', '카테고리 일치', 30, 1);
INSERT INTO public.recommend_weights (code, name, weight, sort_order) VALUES ('win', '성사 이력', 20, 2);
INSERT INTO public.recommend_weights (code, name, weight, sort_order) VALUES ('spd', '응답 속도', 10, 3);
INSERT INTO public.recommend_weights (code, name, weight, sort_order) VALUES ('trust', '신뢰지표', 10, 4);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('FAKE', '허위 · 과장된 내용', 'HIGH', 2, 10, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('CONTACT', '연락처 · 외부 유도', 'HIGH', 2, 20, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('RESTRICTED', '등록할 수 없는 업종', 'HIGH', 1, 30, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('DUPLICATE', '같은 내용 반복 등록', 'MEDIUM', 3, 40, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('SPAM', '광고 · 도배', 'MEDIUM', 3, 50, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('WRONG_CAT', '업종이 맞지 않음', 'LOW', 5, 60, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('OTHER', '기타', 'LOW', 5, 90, NULL);
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('HLT_EFFICACY', '효능을 과장했습니다', 'HIGH', 1, 15, 'HLT');
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('MAL_FAKE', '없는 매물입니다', 'HIGH', 2, 15, 'MAL');
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('BIZ_REVENUE', '매출을 부풀렸습니다', 'HIGH', 2, 15, 'BIZ');
INSERT INTO public.report_reasons (code, label, severity, auto_queue_at, sort_order, gwan_code) VALUES ('MNY_QUALITY', '설명과 물건이 다릅니다', 'MEDIUM', 3, 15, 'MNY');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '대출', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '대부', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '대환', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '저금리', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '무담보', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '신용대출', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '담보대출', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '현금서비스', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '당일 승인', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LOAN', '갈아타기', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '카지노', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '토토', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '배팅', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '바카라', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '경마', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '포커', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '도박', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '사설', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '홀덤', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('GAMBLING', '슬롯', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '유흥', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '성인용품', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '성인 콘텐츠', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '화상채팅', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '유흥주점', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '종업원 구인', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '성인 오락실', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '룸살롱', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('ADULT', '노래방 도우미', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '성형외과', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '피부과', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '치과', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '한의원', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '정형외과', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '임플란트', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '시술', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '도수치료', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '레이저', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '미용시술', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '병원 소개', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDICAL', '한약', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MULTILEVEL', '네트워크 마케팅', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MULTILEVEL', '다단계', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MULTILEVEL', '사업자 모집', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MULTILEVEL', '하위 판매원', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LABOR', '인력공급', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LABOR', '유료직업소개', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LABOR', '구인 대행', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('INSURANCE', '보험 설계사', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('INSURANCE', '보험 모집', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('INSURANCE', '보험 상담', NULL);
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LEGAL', '변호사', '변호사법 34조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LEGAL', '법무법인', '변호사법 34조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LEGAL', '소송 대리', '변호사법 34조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LEGAL', '사건 수임', '변호사법 34조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('LEGAL', '법률 상담 소개', '변호사법 34조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDDEV', '의료기기', '의료기기법 24조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDDEV', '혈압계', '의료기기법 24조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDDEV', '혈당측정기', '의료기기법 24조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDDEV', '보청기', '의료기기법 24조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('MEDDEV', '체외진단', '의료기기법 24조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('PHARM', '의약품', '약사법 44조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('PHARM', '처방약', '약사법 44조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('PHARM', '전문의약품', '약사법 44조');
INSERT INTO public.restrict_vocab (code, term, memo) VALUES ('PHARM', '조제', '약사법 44조');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('9d968bbf-0744-4681-995b-74309ba6d697', 'LEGAL', '법률', '변호사법 제34조 — 사건 알선 금지', 'MNY', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.668783+00', '법률사건의 알선은 변호사법상 금지되어 등록이 제한됩니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('bbae1838-cfc6-462d-9e05-20de2c75b188', 'LABOR', '인력공급', '직업안정법 — 유료직업소개사업 등록', 'MNY', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.668783+00', '인력 공급·직업 소개는 직업안정법상 등록이 필요하여 등록이 제한됩니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('7ec69a70-8738-4f7a-a414-97f9d6d74d1f', 'MULTILEVEL', '다단계', '방문판매법 — 다단계판매 규제', 'MNY', 'BLOCK', NULL, true, NULL, '2026-09-07 12:05:02.668783+00', '다단계판매 조직의 모집은 등록이 제한됩니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('3d24e47c-4ca6-4f37-83ca-c03a313fc9ec', 'INSURANCE', '보험', '보험업법 — 모집 자격 없는 자의 중개 금지 (광고는 별도 조문 — AD_ONLY)', 'MNY', 'AD_ONLY', NULL, true, NULL, '2026-09-07 12:05:02.668783+00', '이 분야는 소개·알선이 법으로 금지되어 등록하실 수 없습니다. 다만 광고는 가능하므로, 알리고 싶으시면 광고 문의를 이용해 주십시오.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('ef99197d-b527-4539-81b7-d1f6beaf5c17', 'MEDICAL', '의료', '의료법 제27조 — 환자 유인·알선 금지 (광고는 별도 조문 — AD_ONLY)', 'MNY', 'AD_ONLY', NULL, true, NULL, '2026-09-07 12:05:02.668783+00', '이 분야는 소개·알선이 법으로 금지되어 등록하실 수 없습니다. 다만 광고는 가능하므로, 알리고 싶으시면 광고 문의를 이용해 주십시오.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('f6297144-02d1-4a17-a8ed-5d6303243c43', 'MEDICAL', '의료', '의료법 제27조 — 개설·양도 알선 금지 (광고는 별도 조문 — AD_ONLY)', 'MAL', 'AD_ONLY', NULL, true, NULL, '2026-09-07 12:05:02.668783+00', '이 분야는 소개·알선이 법으로 금지되어 등록하실 수 없습니다. 다만 광고는 가능하므로, 알리고 싶으시면 광고 문의를 이용해 주십시오.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('ba5c9566-d99e-41d3-a37b-2e4a3f8a0eab', 'PHARM', '의약품', '약사법 제44조 — 약국 개설자가 아니면 의약품을 판매할 수 없습니다', 'HLT', 'BLOCK', NULL, true, NULL, '2026-09-14 06:55:37.026861+00', '의약품은 등록하실 수 없습니다. 건강기능식품은 가능합니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('161e3e38-c09d-4202-8ea0-ab63853e4023', 'MEDICAL', '의료 서비스', '의료법 제27조 — 환자 유인·알선 금지', 'HLT', 'BLOCK', NULL, true, NULL, '2026-09-14 06:55:37.026861+00', '의료 서비스는 소개하실 수 없습니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('94971dba-7c80-4534-82f0-e0806ca82cab', 'LOAN', '대부업', '대부업법 제3조 — 등록 없이 대부중개를 할 수 없습니다', 'MNY', 'BLOCK', NULL, true, NULL, '2026-09-15 20:58:09.068165+00', '대부·대출 중개는 등록 업자만 할 수 있어 소개하실 수 없습니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('a5de30af-bb42-4655-91e3-ff16677c7ecf', 'GAMBLING', '도박', '형법 제247조 · 국민체육진흥법 제26조 — 도박개장·유사행위 금지', 'MNY', 'BLOCK', NULL, true, NULL, '2026-09-15 20:58:09.068165+00', '도박·사행성 사업은 소개하실 수 없습니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('ffde81ee-c3dd-41cc-b433-fa7c6556e5ae', 'ADULT', '성인·유흥', '풍속영업규제법 · 청소년보호법 — 유흥업 알선 제한', 'MNY', 'BLOCK', NULL, true, NULL, '2026-09-15 20:58:09.068165+00', '성인·유흥 관련 알선은 하실 수 없습니다.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('f70ea4ed-dabb-415b-8098-51beaedbdb83', 'MEDDEV', '의료기기', '의료기기법 제24조 — 의료기기 광고는 사전 심의 대상입니다', 'HLT', 'GATED', NULL, true, NULL, '2026-09-14 06:55:37.026861+00', '의료기기는 광고 사전심의를 받으셔야 등록하실 수 있습니다 (의료기기법 24조). 심의필 번호를 함께 적어 주십시오.');
INSERT INTO public.restricted_industries (id, code, name, legal_basis, gwan_code, mode, gate_requirement, is_active, updated_by, updated_at, block_message) VALUES ('c60c4ce1-dc67-41f1-b89c-07c4798b92a4', 'NEWR', '신규제한', '시행령', 'BIZ', 'BLOCK', NULL, true, NULL, '2026-09-18 03:33:49.01281+00', '등록이 제한됩니다.');
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('THIN_CONTENT', '설명이 부족합니다', 'CONTENT', true, 1);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('MISLEADING', '사실과 다른 내용입니다', 'CONTENT', true, 2);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('CONTACT_IN_BODY', '본문에 연락처가 있습니다', 'POLICY', true, 3);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('DOC_MISSING', '증빙 서류가 없습니다', 'DOCUMENT', true, 4);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('FEE_UNREASONABLE', '소개비가 비정상적입니다', 'POLICY', true, 5);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('DUPLICATE', '중복 등록입니다', 'CONTENT', true, 6);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('CATEGORY_WRONG', '업종이 맞지 않습니다', 'CONTENT', true, 7);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('OTHER', '기타', 'OTHER', true, 99);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_DOC_MISSING', '증빙 서류가 첨부되지 않았습니다', 'DOCUMENT', true, 11);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_DOC_UNREADABLE', '서류를 알아볼 수 없습니다', 'DOCUMENT', true, 12);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_DOC_EXPIRED', '서류의 유효기간이 지났습니다', 'DOCUMENT', true, 13);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_NAME_MISMATCH', '서류상 명의가 등록자와 다릅니다', 'DOCUMENT', true, 14);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_DOC_MISMATCH', '서류 내용이 매물 정보와 다릅니다', 'DOCUMENT', true, 15);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_NOT_ELIGIBLE', '해당 업종은 서류 확인 대상이 아닙니다', 'POLICY', true, 16);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('URGENT_NO_REASON', '급구 사유가 구체적이지 않습니다', 'CONTENT', true, 21);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('URGENT_REASON_INVALID', '급구로 볼 수 없는 사유입니다', 'CONTENT', true, 22);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('URGENT_PERIOD_INVALID', '신청한 기한이 적절하지 않습니다', 'POLICY', true, 23);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('URGENT_REPEATED', '같은 매물에 급구를 반복 신청했습니다', 'POLICY', true, 24);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('URGENT_PRICE_UNCHANGED', '급구인데 조건 변화가 없습니다', 'CONTENT', true, 25);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BADGE_LISTING_CHANGED', '매물 내용이 신청 후 변경되었습니다', 'CONTENT', true, 26);
INSERT INTO public.review_reason_codes (code, label, category, is_active, sort_order) VALUES ('BANNED_WORD', '사용할 수 없는 표현이 있습니다', 'POLICY', true, 8);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-06', '자전거래 의심', 'A-12 당사자 협의', '소개자와 사업자의 사업자등록번호·대표자·계좌 중 둘 이상이 겹치는 경우', '계열사 간 정상 거래일 수 있습니다.', 'LOW', true, 5, '
  -- 자전거래: 같은 사업자가 양쪽에 선 거래
  SELECT ''deal:'' || d.id AS subject,
         ''구매자와 판매자의 사업자가 같습니다'' AS detail
    FROM deals d
    JOIN businesses b1 ON b1.account_id = d.buyer_account_id
    JOIN businesses b2 ON b2.account_id = d.seller_account_id
   WHERE b1.biz_reg_no = b2.biz_reg_no
     AND d.created_at >= now() - interval ''1 day''
', true);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-05', '제한업종 우회 등록', 'INV-6 제한업종 제외', '제한 어휘를 초성·띄어쓰기·유사어로 바꿔 등록을 시도한 경우', '정상 업종에서 우연히 같은 글자가 나올 수 있습니다.', 'HIGH', true, 4, '
  SELECT ''listing:'' || l.id AS subject,
         ''게시 상태인데 금칙어가 있습니다 — '' || string_agg(w.word, '', '') AS detail
    FROM listings l
    JOIN banned_words w ON w.is_active AND w.severity = ''BLOCK''
     AND position(lower(w.word) in lower(coalesce(l.title,'''') || '' '' || coalesce(l.body,''''))) > 0
   WHERE l.status = ''PUBLISHED''
   GROUP BY l.id
', true);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-07', '광고 소재 규제 위반', '의료법 제27조 · 표시광고법 · INV-6', '규제 카테고리(의료·대부·다단계) 소재가 성향 세그먼트 타겟으로 지정되거나, 광고 표기 없이 추천 목록에 섞인 경우', '심의필을 이미 받은 의료 소재가 등록 지연으로 미확인 상태일 수 있습니다.', 'HIGH', true, 6, '
  SELECT ''ad:'' || p.creative_code AS subject,
         ''규제 소재가 노출 상태입니다 ('' || p.category || '')'' AS detail
    FROM ad_placements p
   WHERE p.is_regulated
     AND (p.status = ''ACTIVE'' OR p.slot_code IS NOT NULL)
     AND p.review_confirmed_at IS NULL
', true);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-03', '반려율 상한 초과', 'R-05 월 15%', '파트너사의 당월 리드 반려 신청이 열람 건수의 15%를 넘은 경우', '리드 품질이 실제로 나빴던 달일 수 있습니다.', 'MEDIUM', true, 2, '
  SELECT ''account:'' || l.owner_account_id AS subject,
         ''최근 30일 반려율 '' ||
         round(100.0 * count(*) FILTER (WHERE l.status=''REJECTED'') / count(*)) || ''%'' AS detail
    FROM listings l
   WHERE l.created_at >= now() - interval ''30 days''
   GROUP BY l.owner_account_id
  HAVING count(*) >= 4
     AND count(*) FILTER (WHERE l.status=''REJECTED'') * 2 > count(*)
', true);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-01', '귀속 우회 의심', 'INV-2 첫 접촉 90일 귀속', '같은 사업자 쌍이 대화 시작 후 플랫폼 밖 연락처를 주고받고 대화를 끊은 경우', '공용 와이파이·회사 사무실·모바일 NAT 에서도 생깁니다. 차단이 아니라 확인 요청으로 다루십시오.', 'HIGH', true, 0, '
  SELECT ''ip:'' || a.ip_hash AS subject,
         ''같은 접속 지점에서 '' || count(DISTINCT a.account_id) ||
         ''개 계정이 7일 안에 귀속됐습니다'' AS detail
    FROM attribution_events a
   WHERE a.ip_hash IS NOT NULL
     AND a.account_id IS NOT NULL
     AND a.occurred_at >= now() - interval ''7 days''
   GROUP BY a.ip_hash
  HAVING count(DISTINCT a.account_id) >= 4
', true);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-02', '허위 · 중복 매물', 'A-02 등록 검수', '제목·금액·주소가 90% 이상 겹치는 리스팅이 서로 다른 계정으로 올라온 경우', '지점이 여럿인 사업자는 같은 제목으로 여러 건을 올릴 수 있습니다. 지역이 다르면 정상입니다.', 'MEDIUM', true, 1, '
  SELECT ''account:'' || l.owner_account_id AS subject,
         ''같은 제목으로 '' || count(*) || ''건 등록 — "'' ||
         left(l.title, 30) || ''"'' AS detail
    FROM listings l
   WHERE l.created_at >= now() - interval ''30 days''
     AND l.status IN (''PUBLISHED'',''IN_REVIEW'')
   GROUP BY l.owner_account_id, l.title
  HAVING count(*) >= 3
', true);
INSERT INTO public.risk_rules (code, name, protects, source, false_positive, severity, is_active, sort_order, detect_sql, auto_detect) VALUES ('RSK-04', '소개캐시 중복 차감 (모델 변경으로 미해당)', '해당 없음 — 소개머니가 차감 잔액이 아닙니다', '소개머니는 충전·차감 잔액이 아니라 확정 소개비 채권 원장입니다(INV-11). 차감이라는 동작 자체가 없으므로 중복 차감도 없습니다.', NULL, 'LOW', false, 3, NULL, false);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('대표자명', 'seed-open.sh 기본값');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('개인정보 보호책임자', 'seed-open.sh 기본값');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('주소 입력', 'seed-open.sh 기본값');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('000-00-00000', 'seed-open.sh 기본값');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('제0000-', 'seed-open.sh 기본값 (신고번호 접두)');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('1600-0000', 'seed-open.sh 기본값');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('0000-0000', '미입력 전화');
INSERT INTO public.setting_placeholders (token, memo) VALUES ('미정', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('미입력', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('추후', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('TBD', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('TODO', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('테스트', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('샘플', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('example', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('changeme', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('xxx', NULL);
INSERT INTO public.setting_placeholders (token, memo) VALUES ('...', NULL);
INSERT INTO public.signup_types (code, label, sub, needs_biz, needs_corp, sort_order) VALUES ('PERSONAL', '개인 회원', '요청 등록과 소개 참여를 하실 수 있습니다. 사업자등록 없이 바로 시작합니다.', false, false, 1);
INSERT INTO public.signup_types (code, label, sub, needs_biz, needs_corp, sort_order) VALUES ('SOLE', '개인 사업자', '사업자등록번호로 인증합니다. 판매 등록과 소개비 수령이 가능합니다.', true, false, 2);
INSERT INTO public.signup_types (code, label, sub, needs_biz, needs_corp, sort_order) VALUES ('CORP', '법인 사업자', '사업자등록번호와 법인등록번호가 필요합니다. 대표자는 가입자와 달라도 됩니다.', true, true, 3);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.intermediary_notice', '소개뱅크는 통신판매중개자이며 통신판매의 당사자가 아닙니다. 거래의 조건과 이행에 대한 책임은 거래 당사자에게 있습니다.', 'GLOBAL', '통신판매중개자 고지 문안 (전상법 제20조)', true, NULL, '2026-09-07 12:05:02.668783+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('exposure.priority_label', '광고', 'GLOBAL', '우선노출 라벨 문안 (관리자 변경 가능)', true, NULL, '2026-09-07 12:05:02.668783+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('exposure.priority_notice', '유료 광고 상품이며, 노출 순위는 광고비 지급에 따른 것입니다.', 'GLOBAL', '우선노출 영역 안내 문안', true, NULL, '2026-09-07 12:05:02.668783+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.refund_terms_code', 'REFUND', 'GLOBAL', '환불 정책 약관 코드 (B-14 · 별도 약관)', true, NULL, '2026-09-07 12:05:02.668783+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.refund_basis', 'STATUTORY', 'GLOBAL', '환불 기준: 법정 기준에 따름', true, NULL, '2026-09-07 12:05:02.668783+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('badge.urgent_label', '급구', 'GLOBAL', '급구 배지 표시 문구', false, NULL, '2026-09-07 12:05:02.699591+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('badge.verified_label', '서류 확인', 'GLOBAL', '증빙확인 배지 표시 문구 (INV-11: 품질 보증 아님)', true, NULL, '2026-09-07 12:05:02.699591+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('badge.verified_notice', '등록자가 제출한 서류가 확인되었다는 표시이며, 거래의 안전이나 품질을 보증하지 않습니다.', 'GLOBAL', '증빙확인 배지 안내 문구', true, NULL, '2026-09-07 12:05:02.699591+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('notify.quiet_start', '21', 'GLOBAL', '야간 발송 제한 시작 시각', false, NULL, '2026-09-07 12:05:02.714934+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('notify.quiet_end', '8', 'GLOBAL', '야간 발송 제한 종료 시각', false, NULL, '2026-09-07 12:05:02.714934+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('infra.egress_ip', '', 'GLOBAL', 'NAT Gateway 고정 IP. 외부 연동 화이트리스트 등록용', false, NULL, '2026-09-07 12:05:02.731454+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('billing.grace_days', '7', 'GLOBAL', '청구 실패 후 구독을 유지하는 유예 일수(1~30). 첫 실패 시점부터 셉니다. 지나면 만료됩니다.', false, NULL, '2026-09-08 21:56:22.623194+00', '^([1-9]|[12][0-9]|30)$', '7', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('billing.retry_per_day', '10', 'GLOBAL', '재시도 가능한 실패의 하루 최대 시도 횟수(1~24). 배치가 2시간마다 돌므로 실질 상한은 12입니다.', false, NULL, '2026-09-08 21:56:22.623194+00', '^([1-9]|1[0-9]|2[0-4])$', '10', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('billing.terminal_retry_per_day', '1', 'GLOBAL', '카드 만료 등 재시도해도 결과가 같은 실패의 하루 시도 횟수(1~24). 같은 카드에 승인 요청을 반복하면 카드사 이상거래 탐지에 걸립니다.', false, NULL, '2026-09-08 21:56:22.623194+00', '^([1-9]|1[0-9]|2[0-4])$', '1', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('introducer.expert_min_valid', '3', 'GLOBAL', '전문 소개자 승급에 필요한 유효 연결 건수(1~50).', false, NULL, '2026-09-08 21:56:22.841929+00', '^([1-9]|[1-4][0-9]|50)$', '3', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('introducer.top_min_consent_rate', '70', 'GLOBAL', '우수 소개자 승급에 필요한 초대 수락률(%, 1~100).', false, NULL, '2026-09-08 21:56:22.841929+00', '^([1-9]|[1-9][0-9]|100)$', '70', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('introducer.founding_quota', '100', 'GLOBAL', '창립 소개자 모집 인원(1~1000).', false, NULL, '2026-09-08 21:56:22.841929+00', '^([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|1000)$', '100', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('notify.email_verified', 'off', 'GLOBAL', 'SPF·DKIM·DMARC 설정이 끝나고 실제 도달을 확인했는가. off 면 이메일 발송을 시도하되 SKIPPED 로 기록합니다 — 보냈다고 착각하지 않기 위해서입니다.', false, NULL, '2026-09-08 21:56:22.845276+00', '^(on|off)$', 'off', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('notify.sms_ready', 'off', 'GLOBAL', 'SMS 발송 준비 여부. off 면 대행 발송 대신 소개자 직접 전달(SELF)만 안내합니다.', false, NULL, '2026-09-08 21:56:23.001981+00', '^(on|off)$', 'off', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('notify.alimtalk_ready', 'off', 'GLOBAL', '카카오 알림톡 발송 준비 여부. 템플릿 사전 승인이 필요합니다.', false, NULL, '2026-09-08 21:56:23.001981+00', '^(on|off)$', 'off', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.mail_order_status', 'REGISTERED', 'GLOBAL', '통신판매업 신고 상태', true, NULL, '2026-09-09 02:54:23.042902+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.business_type_ok', 'yes', 'GLOBAL', '등록증 별지의 업태·종목이 온라인 중개 플랫폼 운영을 포함하는지 확인했는가(yes/no). 통신판매업은 2020년 신고 완료(제2020-서울금천-1772호)이므로 당시에는 요건을 갖춘 것으로 보이나, 현재 등록증 본지에는 제조업만 표시됩니다. 별지를 확인하십시오. PG 심사에서 봅니다.', true, NULL, '2026-09-10 06:20:43.404176+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('site.domain', 'sogaebaenk.co.kr', 'GLOBAL', '서비스 도메인. 등록기관 가비아 · 호스팅 AWS. 메일 링크와 소개 초대 링크가 이 주소로 나갑니다 — 스테이징에서는 반드시 다른 값으로 두십시오.', true, NULL, '2026-09-11 06:37:13.61718+00', '^[a-z0-9.-]+\.[a-z]{2,}$', 'sogaebaenk.co.kr', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('site.base_url', 'https://sogaebaenk.co.kr', 'GLOBAL', '외부에 나가는 절대 주소. 초대 링크·결제 복귀 주소에 쓰입니다.', true, NULL, '2026-09-11 06:37:13.61718+00', '^https://[a-z0-9.-]+\.[a-z]{2,}$', 'https://sogaebaenk.co.kr', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('notify.mail_from', '', 'GLOBAL', '발신 전용 주소. 도메인 메일이어야 SPF/DKIM 이 걸립니다 — 무료 메일로는 인증이 되지 않아 청구 안내가 스팸으로 갑니다. 개인정보 문의 주소(footer.privacy_email)와는 별개입니다.', false, NULL, '2026-09-11 06:37:13.61718+00', '^$|^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', 'no-reply@sogaebaenk.co.kr', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('mal.owner_direct_ready', 'off', 'GLOBAL', '소유자 직거래 게이트. 법무 Q1(표시·광고 책임) 회신 전까지 off 로 두십시오. 심사 화면은 동작하지만 승인해도 매물이 공개되지 않습니다 — 회신 전에 열면 플랫폼이 표시·광고 책임을 지게 될 수 있습니다.', false, NULL, '2026-09-11 06:37:13.620503+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('ads.intro_price_until', '', 'GLOBAL', '도입가 적용 종료일(오픈 + 3주). 지난 뒤에는 실측으로 재산정하십시오.', false, NULL, '2026-09-11 13:12:06.150752+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.b12_status', 'CLEARED', 'GLOBAL', 'B-12(성향 광고 개인정보 처리 유형) 법무 회신 상태. CLEARED = 문제없음 회신을 받았습니다(2026-09-11).', false, NULL, '2026-09-11 13:47:21.965166+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('lead.default_fee', '3000', 'GLOBAL', '분류가 없는 리드의 기본 확인비용. 손익분기 2,209원을 넘겨야 합니다 — 그 아래면 리드를 만들수록 자금을 태웁니다.', false, NULL, '2026-09-12 01:46:14.94347+00', '^[0-9]+$', '3000', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('site.landing_new_member', '', 'GLOBAL', '가입 직후 첫 로그인만 다르게 보낼 때 씁니다. 비우면 위 설정을 따릅니다. 첫 화면에서 무엇을 할 수 있는지 모르면 그대로 떠납니다.', false, NULL, '2026-09-14 06:49:05.449335+00', '^$|^(MNY|MAL|BIZ)$', 'MNY', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('site.landing_after_login', 'MNY', 'GLOBAL', '로그인 후 도착할 화면. 비우면 메인입니다. 관 코드(MNY·MAL·BIZ)를 넣으면 그 관 메인으로 갑니다 — 밀고 싶은 관이 있을 때 배포 없이 바꿉니다.', false, NULL, '2026-09-14 06:49:05.449335+00', '^$|^(MNY|MAL|BIZ)$', 'MNY', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('site.gwan_cards_max', '5', 'GLOBAL', '메인에 카드로 보여 줄 관의 최대 개수. 넘으면 "전체 관" 페이지로 보냅니다 — 카드가 5개를 넘으면 한 줄에 안 들어가 오히려 안 읽힙니다.', false, NULL, '2026-09-14 06:55:37.026861+00', '^[0-9]+$', '4', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('ads.daily_cap_per_user', '12', 'GLOBAL', '1인당 하루 광고 노출 상한. 넘으면 그날은 더 보이지 않습니다. 커머스 목록이 12회 내외이고, 그보다 많으면 이용자가 목록을 피합니다.', false, NULL, '2026-09-14 06:45:17.796424+00', '^[0-9]+$', '12', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('ads.infeed_every', '8', 'GLOBAL', '목록 몇 건마다 광고 1개를 넣는지. 낮추면 노출은 늘지만 목록이 광고판이 됩니다.', false, NULL, '2026-09-14 06:45:17.796424+00', '^[0-9]+$', '8', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('ads.infeed_max_per_view', '3', 'GLOBAL', '한 번 스크롤에 보이는 인피드 광고 최대 개수.', false, NULL, '2026-09-14 06:45:17.796424+00', '^[0-9]+$', '3', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.privacy_officer', '노명석', 'GLOBAL', '개인정보 보호책임자', true, NULL, '2026-09-09 15:22:25.620831+00', NULL, '홍길동', 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('assume.payment', 'on', 'GLOBAL', '결제 수단을 연동된 것으로 간주합니다. **실제 결제는 일어나지 않습니다** — 토스 심사 통과 후 off 로 바꾸십시오. 화면에 간주 상태가 표시됩니다.', false, NULL, '2026-09-15 21:12:53.194667+00', '^(on|off)$', 'on', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('assume.broker', 'on', 'GLOBAL', '중개사 인증을 통과한 것으로 간주합니다. **국토부 대조를 하지 않습니다** — 연동 후 off 로 바꾸면 실제 대조가 돕니다.', false, NULL, '2026-09-15 21:12:53.194667+00', '^(on|off)$', 'on', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.direct_notice', '건강상품관에서 판매하는 상품은 소개뱅크가 직접 판매합니다. 상품의 하자·배송·반품·환불에 대한 책임은 소개뱅크에 있습니다.', 'PUBLIC', '직판 고지. **건강상품관에만 붙습니다** — 다른 관은 중개 고지를 씁니다.', true, NULL, '2026-09-17 04:20:57.945191+00', '^.{20,200}$', NULL, 20);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('internal.api_key', 'dev-internal-key-0123456789abcdefghij', 'PRIVATE', '내부 API 키. **광고 플랫폼이 본체를 부를 때** 씁니다 — 비어 있으면 내부 API 가 전부 닫힙니다(fail-closed). 오픈 전에 32자 이상으로 채우십시오.', true, NULL, '2026-09-17 15:45:13.778283+00', '^$|^[A-Za-z0-9_-]{32,64}$', NULL, 32);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.location_waived', 'on', 'GLOBAL', '위치기반 약관 폐기 확정. **단말기 위치를 수집하지 않아 위치정보법 대상이 아닙니다** — 좌표 컬럼이 생기면 검정 BR-05 가 잡습니다.', false, NULL, '2026-09-18 00:40:47.901347+00', '^(on|off)$', NULL, 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.location_waived_at', '2026-09-18', 'GLOBAL', '폐기를 확정한 날. 나중에 "언제 왜 뺐나" 를 물으면 이것이 근거입니다.', false, NULL, '2026-09-18 00:40:47.901347+00', '^\d{4}-\d{2}-\d{2}$', NULL, 10);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('legal.location_waived_note', '단말기 위치 미수집 · 주소 직접 입력 · 좌표 컬럼 0개', 'GLOBAL', '폐기 근거. **판단의 이유를 남기지 않으면** 몇 달 뒤에 왜 뺐는지 아무도 모릅니다.', false, NULL, '2026-09-18 00:40:47.901347+00', '^.{10,200}$', NULL, 10);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('marketing.send_enabled', 'off', 'GLOBAL', '광고성 발송 스위치. **알림톡·SMS 계약과 발신번호 등록이 끝난 뒤** 켜십시오 — 켜 두고 계약이 없으면 발송이 실패만 쌓입니다.', false, NULL, '2026-09-18 03:26:51.543203+00', '^(on|off)$', NULL, 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('company.bank_holder', '주식회사 소개뱅크 시험용', 'PUBLIC', '예금주. **사업자등록증의 상호와 같아야** 입금하는 쪽이 헷갈리지 않습니다.', true, '11111111-1111-1111-1111-111111111111', '2026-09-16 15:52:24.80471+00', '^$|^.{2,30}$', '주식회사 소개뱅크', 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.ceo_name', '노명석', 'GLOBAL', '대표자 성명', true, NULL, '2026-09-09 02:54:23.042902+00', NULL, '홍길동', 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('assume.bank', 'on', 'GLOBAL', '수금 계좌 간주 모드. **on 이면 가상 계좌로 돌고 있습니다** — 실계좌를 넣으신 뒤 off 로 바꾸십시오. on 인 채로는 열 수 없습니다.', false, NULL, '2026-09-17 08:47:00.468498+00', '^(on|off)$', 'off', 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.phone', '1688-2887', 'GLOBAL', '대표 전화', true, NULL, '2026-09-09 14:28:55.764174+00', '^0[0-9]{1,2}-?[0-9]{3,4}-?[0-9]{4}$|^1[0-9]{3}-?[0-9]{4}$', '02-1234-5678', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.mail_order_no', '제2020-서울금천-1772호', 'GLOBAL', '통신판매업 신고번호 (C-07 신고 대상 확정)', true, NULL, '2026-09-09 02:54:23.042902+00', '^제[0-9]{4}-[가-힣]+[가-힣0-9]*-[0-9]{4,6}호$', '제2027-서울강남-01234호', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.address', '서울 금천구 디지털로9길 65 (가산동, 백상스타타워1차) 307호', 'GLOBAL', '사업장 주소', true, NULL, '2026-09-09 02:54:23.042902+00', NULL, '서울특별시 강남구 테헤란로 1, 2층', 10);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('company.bank_name', '시험용가상은행', 'PUBLIC', '수금 계좌 은행. 구독료·리드비·광고비가 들어옵니다. **거래 대금은 여기로 받지 마십시오** — 자금 수탁이 되어 INV-11 이 깨집니다.', true, '11111111-1111-1111-1111-111111111111', '2026-09-16 15:52:24.80471+00', '^$|^[가-힣A-Za-z0-9 ]{2,20}$', '국민은행', 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.privacy_contact', '1688-2887', 'GLOBAL', '개인정보 문의 창구. 대표 전화와 같아도 되지만, 표기는 있어야 합니다 — 책임자 이름만 있고 연락할 곳이 없으면 열람·정정 요구를 보낼 수 없습니다.', false, NULL, '2026-09-09 15:22:25.620831+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('company.bank_account', '999999-99-999999', 'PUBLIC', '수금 계좌번호. 하이픈 있어도 됩니다. **법인 계좌여야 합니다** — 개인 계좌로 받으면 세무에서 문제가 됩니다.', true, '11111111-1111-1111-1111-111111111111', '2026-09-16 15:52:24.80471+00', '^$|^[0-9-]{9,20}$', '123456-01-234567', 9);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('ads.self_only_until', '', 'GLOBAL', '이 날짜까지는 자사 소재만 노출합니다(오픈 + 3주). 선계약 광고주(is_precontract)는 이 제한을 받지 않습니다.', false, NULL, '2026-09-11 13:12:06.150752+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('feature.success_fee', 'off', 'GLOBAL', '성사 수수료 스위치. 현재 off — 매출은 월 구독료만입니다. on 으로 올리면 거래 확정 시 등급별 정액이 청구됩니다.', false, NULL, '2026-09-07 12:05:02.819681+00', NULL, 'on | off', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('feature.referral_fee', 'off', 'GLOBAL', '소개비 기능 스위치. 현재 off — 플랫폼은 소개비에 관여하지 않습니다. listings.desired_fee 등은 당사자 협의 표시값일 뿐이며, 플랫폼이 이를 근거로 청구하거나 지급하지 않습니다.', false, NULL, '2026-09-07 12:05:02.819681+00', NULL, 'on | off', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.company_name', '(주)한국바이오헬스케어 소개뱅크 사업부', 'GLOBAL', '법인명. 푸터 법정 고지에 표기합니다.', true, NULL, '2026-09-09 02:54:23.042902+00', NULL, NULL, NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.biz_reg_no', '429-88-01533', 'GLOBAL', '사업자등록번호', true, NULL, '2026-09-09 02:54:23.042902+00', '^[0-9]{3}-[0-9]{2}-[0-9]{5}$', '123-45-67890', NULL);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.hosting', 'Amazon Web Services (AWS)', 'GLOBAL', '호스팅 제공자', true, NULL, '2026-09-10 06:25:51.122101+00', NULL, 'Amazon Web Services', 2);
INSERT INTO public.site_settings (key, value, scope, description, is_required_for_open, updated_by, updated_at, value_pattern, value_example, min_length) VALUES ('footer.privacy_email', 'koreabio9981@gmail.com', 'GLOBAL', '개인정보 문의 전용 이메일. 개인정보처리방침 제13조와 푸터에 나갑니다. 열람·정정·삭제 요구와 유출 신고가 오는 곳이라 실제로 받는 주소여야 합니다. 무료 메일은 도메인 소유가 증명되지 않고 SPF/DKIM 설정도 불가능하므로 sogaebaenk.co.kr 도메인 메일을 권합니다.', true, NULL, '2026-09-10 12:39:46.006417+00', '^$|^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', 'privacy@sogaebaenk.co.kr', NULL);
INSERT INTO public.subscription_plans (code, name, monthly_price, included_codes, proposal_limit, extra_code_price, is_active, request_views_per_month, listing_slots, exposure_weight, priority_slot_count, success_fee) VALUES ('BASIC', '베이직', 0, 0, 10, 30000, true, 5, 3, 1.00, 0, 30000);
INSERT INTO public.subscription_plans (code, name, monthly_price, included_codes, proposal_limit, extra_code_price, is_active, request_views_per_month, listing_slots, exposure_weight, priority_slot_count, success_fee) VALUES ('STANDARD', '스탠다드', 49000, 3, NULL, 30000, true, 30, 20, 1.30, 1, 20000);
INSERT INTO public.subscription_plans (code, name, monthly_price, included_codes, proposal_limit, extra_code_price, is_active, request_views_per_month, listing_slots, exposure_weight, priority_slot_count, success_fee) VALUES ('PRO', '프로', 149000, 15, NULL, 30000, true, NULL, NULL, 1.80, 3, 10000);
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('IDENTITY', '본인인증', 5.0, '신원 보증 — 자금 보증이 아닙니다');
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('BUSINESS', '사업자 인증', 8.0, '국세청 실시간 검증');
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('CONSENT_RATE', '초대 동의율', 20.0, '보낸 초대 중 동의로 이어진 비율');
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('CONNECTION', '유효 연결', 15.0, '동의를 거쳐 실제로 연결된 건');
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('DEAL', '성사', 15.0, '양측이 확인한 거래');
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('REPORT', '인정된 신고', -12.0, '신고만으로는 깎지 않습니다 — 인정된 것만');
INSERT INTO public.trust_weights (code, label, weight, note) VALUES ('BASE', '시작 점수', 36.5, '신규도 거래를 시작할 수 있어야 합니다');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('CTA_ATTRIBUTION', '문의로 진행하면 소개 이력이 기록됩니다.', '상세 화면 CTA 하단', 'INV-2 귀속 안내', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('STUB_NOTICE', '연동 준비 중 — 실제 확인이 이루어지지 않았습니다.', '인증·조회 결과', '실동작 오인 방지', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('BUSINESS_ONLY', '소개비는 사업자만 받을 수 있습니다.', '사업자 전환 화면', 'INV-10', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('QNA_MASKED', '공개 문의는 누구나 볼 수 있습니다. 연락처는 자동으로 가려집니다.', '공개 문의 영역', '마스킹 고지', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('NO_DEDUCTION', '소개비는 공제 없이 전액 지급됩니다.', '정산 내역', 'INV-9', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('EDIT_REREVIEW', '수정하면 다시 검수를 받습니다. 부여된 배지도 회수됩니다.', '매물 수정 화면', '재검수 고지', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('DISPUTE_HOLD', '접수하면 해당 거래의 정산이 자동으로 보류됩니다.', '분쟁 접수 화면', 'B-11', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('AD_NOTICE', '광고 영역은 유료 노출입니다.', '광고 영역 상단', '전자상거래법 표시 의무', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('FEE_NOT_CALCULATED', '플랫폼이 계산하지 않습니다. 최종 금액은 당사자 합의로 정해집니다.', '소개비 입력란', 'A-12', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('THIN_CONTENT_HINT', '30자 미만이면 담당자가 확인합니다. 자세히 적을수록 빨리 노출됩니다.', '본문 입력란', '자동검수 안내', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('MANUAL_REVIEW', '신청하면 담당자가 확인합니다. 자동 승인되지 않습니다.', '사업자 신청 화면', '전건 수동 검수', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.ui_messages (code, message, placement, basis, is_active, updated_at) VALUES ('VERIFIED_DOC_SCOPE', '서류의 존재와 일치만 확인합니다. 거래의 안전을 보증하지 않습니다.', '서류확인 배지', 'INV-11', true, '2026-09-07 12:05:02.754348+00');
INSERT INTO public.withdrawal_rules (code, label, days, blocked_if, law, is_active) VALUES ('FOOD_SEALED', '식품 · 건강기능식품', 7, '포장을 개봉했거나 밀봉이 훼손된 경우', '전자상거래법 17조 2항 2호', true);
INSERT INTO public.withdrawal_rules (code, label, days, blocked_if, law, is_active) VALUES ('DEVICE', '의료기기 · 건강기기', 7, '사용 흔적이 있거나 위생상 재판매가 어려운 경우', '전자상거래법 17조 2항', true);
INSERT INTO public.withdrawal_rules (code, label, days, blocked_if, law, is_active) VALUES ('GENERAL', '그 밖의 상품', 7, NULL, '전자상거래법 17조 1항', true);

SET session_replication_role = 'origin';

-- ── 약관 행 (본문·상태 제외) ────────────────────────────────────────
/* ── 감사 이상 판정 기준 ────────────────────────────────────────────
 *
 * ★ 표가 비어 있을 때 기준선을 만들면 **담기지 않습니다.**
 *   담기지 않으면 재구축 때 감시가 통째로 꺼지고, 그러면
 *   새벽에 개인정보 50건을 열어도 아무 일이 안 일어납니다.
 *
 *   그래서 terms 처럼 **씨앗을 직접 심습니다.** */
INSERT INTO public.audit_thresholds (code, label, threshold, window_hrs, note) VALUES
 ('PII_BURST',   '개인정보 다량 열람',    20, 24, '한 사람이 하루에 이만큼 넘게 열면 확인하십시오.'),
 ('PII_NIGHT',   '업무 시간 밖 열람',      5, 24, '밤 10시~아침 7시 열람. 이유가 남아야 합니다.'),
 ('ADMIN_BURST', '운영 행위 몰림',        50, 24, '자동화 도구를 쓰고 있을 수 있습니다.'),
 ('ADMIN_NIGHT', '밤에 운영 행위',        10, 24, '계정이 털렸을 수 있습니다.'),
 ('SAME_TARGET', '같은 사람을 반복 열람',  5, 24, '가장 흔한 유출 형태입니다 — 아는 사람을 들여다봅니다.')
ON CONFLICT (code) DO NOTHING;

/* ★ terms 는 gwans 보다 **뒤에** 와야 합니다 — gwan_code 가 관을
 *   가리키는 FK 라, 관이 없으면 넣을 수 없습니다(건강몰 직판 약관). */
INSERT INTO public.terms (code, version, title, body, status, is_required, effective_from, display_order, gwan_code)
VALUES
 ('SERVICE',    '1.0', '이용약관',               '', 'DRAFT', true,  'infinity', 1, NULL),
 ('PRIVACY',    '1.0', '개인정보처리방침',       '', 'DRAFT', true,  'infinity', 2, NULL),
 ('REFUND',     '1.0', '구독 환불 정책',         '', 'DRAFT', true,  'infinity', 3, NULL),
 /* ★ 회원 간 전달은 **필수 동의**입니다 — 위탁이 아닙니다(2026-09-16).
  *   거래 상대방은 저희 지시를 받지 않고 자기 사업 목적으로 씁니다. */
 ('THIRDPARTY', '1.0', '제3자 제공 동의 (회원 간)', '', 'DRAFT', true,  'infinity', 4, NULL),
 ('OUTSOURCE',  '1.0', '개인정보 처리업무 위탁',    '', 'DRAFT', false, 'infinity', 5, NULL),
 /* ★ 위치기반은 **폐기**했습니다(2026-09-16) — 단말기 위치를 수집하지
  *   않고 주소를 직접 입력받을 뿐이라 해당하지 않습니다.
  *   없는 서비스의 약관을 두면 신고 의무가 따라붙습니다. */
 ('LOCATION',   '1.0', '위치기반서비스 이용약관','(폐기 — 위치정보를 수집하지 않습니다)', 'ARCHIVED', false, 'infinity', 9, NULL),
 ('MARKETING',  '1.0', '마케팅 수신 동의',       '', 'DRAFT', false, 'infinity', 6, NULL),
 ('ADPERSONAL', '1.0', '맞춤형 광고 동의',       '', 'DRAFT', false, 'infinity', 7, NULL),
 /* ★ 건강상품관은 **직판**이라 약관이 따로입니다(C580).
  *   다른 관은 통신판매중개업자지만 여기는 통신판매업자입니다 —
  *   반품·환불 책임이 우리에게 있습니다. */
 ('HLT_SALE',   '1.0', '건강상품 판매 약관 (직판)', '', 'DRAFT', true, 'infinity', 8, 'HLT')
ON CONFLICT (code, version) DO NOTHING;




-- ── 마케팅 수신 동의 (C760) ─────────────────────────────────────────
--
-- ★ 기준선에 **본문까지** 담아야 합니다. 안 담으면 재구축 때 DRAFT 로
--   돌아가고, 동의 없이 광고를 보내는 상태가 됩니다(정보통신망법 50조).
--   계약서 양식 때와 같은 실수입니다.

UPDATE terms SET status = 'PUBLISHED', effective_from = '2026-11-11',
  body = $BODY$
# 마케팅 정보 수신 동의

## 제1조 (동의 항목)
회사는 다음의 정보를 보내기 위해 회원의 동의를 받습니다.

- 신규 기능 · 서비스 안내
- 이벤트 · 프로모션 · 할인 정보
- 이용 실적을 바탕으로 한 추천 정보

## 제2조 (전송 수단)
이메일 · 문자메시지 · 앱 푸시 · 카카오 알림톡

## 제3조 (동의를 거부할 권리)
① 이 동의는 **선택 사항**입니다. 동의하지 않으셔도 서비스 이용에
   아무런 제한이 없습니다.
② 동의하신 뒤에도 **언제든지** 마이페이지에서 수신을 거부하실 수
   있습니다. 거부하시면 즉시 발송이 멈춥니다.

## 제4조 (광고 표기)
① 저희가 보내는 광고에는 제목 맨 앞에 **(광고)** 라고 적습니다
   (정보통신망법 50조 4항).
② 문자·알림톡에는 **무료거부 번호**를, 이메일에는 **수신거부 링크**를
   함께 넣습니다.
③ 이렇게 적지 않고 보내는 것은 그 자체로 위반입니다 — 내용이
   문제없어도 마찬가지입니다.

## 제5조 (야간 전송)
① 오후 9시부터 다음 날 오전 8시까지는 **광고를 보내지 않습니다.**
② 이 시간에도 받기를 원하시면 **따로 동의**해 주셔야 합니다
   (정보통신망법 50조 3항).

## 제6조 (동의 확인)
① 동의하신 날부터 **2년마다** 계속 받으실지 여쭙니다
   (정보통신망법 시행령 62조의3).
② 답하지 않으시면 **동의가 없는 것으로 보고** 발송을 멈춥니다.

## 제7조 (수신거부와 무관하게 가는 것)
다음은 **광고가 아니라 거래 정보**라, 수신을 거부하셔도 보내 드립니다.

| 무엇 | 왜 |
|---|---|
| 주문 · 결제 · 배송 안내 | 거래 이행에 필요합니다 |
| 검수 결과 · 계약 진행 | 회원님이 하신 신청의 결과입니다 |
| 정산 · 환불 안내 | 돈이 오가는 일입니다 |
| 약관 변경 · 보안 알림 | 법으로 알려 드려야 합니다 |

**이것까지 끊으면 주문하신 물건이 어디 있는지 알 수 없게 됩니다.**

## 제8조 (동의 기록)
언제 동의하시고 언제 거부하셨는지 기록에 남습니다. 분쟁이 생겼을 때
이것이 근거가 되며, 고치거나 지울 수 없습니다.
$BODY$
WHERE code = 'MARKETING';

INSERT INTO terms (code, version, title, status, is_required, effective_from,
                   display_order, body) VALUES
('MARKETING_NIGHT', '1.0', '야간 광고 수신 동의', 'PUBLISHED', false, '2026-11-11', 95,
$BODY$
# 야간 광고 수신 동의

## 제1조 (무엇에 동의하시는 것인가)
오후 9시부터 다음 날 오전 8시까지 광고성 정보를 받으시겠다는
동의입니다. 이 시간대는 정보통신망법이 따로 정한 시간입니다.

## 제2조 (마케팅 동의와 다릅니다)
① 마케팅 수신에 동의하셨더라도 **이 동의가 따로 있어야** 야간에
   보낼 수 있습니다(정보통신망법 50조 3항).
② 두 동의를 하나로 묶을 수 없습니다. 묶으면 야간에 받기 싫은 분도
   함께 동의한 것이 되어, 그것만으로 위반입니다.
③ 이 동의만 하시고 마케팅 동의를 안 하시면 **아무것도 가지 않습니다.**

## 제3조 (전송 수단)
이메일 · 문자메시지 · 앱 푸시 · 카카오 알림톡

야간에는 **소리와 진동 없이** 보내 드립니다. 다만 단말기 설정에
따라 다를 수 있습니다.

## 제4조 (거부)
① 언제든지 마이페이지에서 거부하실 수 있습니다.
② 거부하시면 야간에는 보내지 않되, **낮에는 마케팅 동의에 따라**
   계속 보내 드립니다.

## 제5조 (수신거부와 무관하게 가는 것)
주문 · 배송 · 결제 · 보안 알림은 **광고가 아니라 거래 정보**라
시간과 무관하게 갑니다.

밤에 결제가 실패했는데 아침까지 알려 드리지 않으면, 그 사이에
주문이 취소됩니다.

## 제6조 (동의 기록)
언제 동의하시고 언제 거부하셨는지 기록에 남습니다. 분쟁이 생겼을 때
이것이 근거가 되며, 고치거나 지울 수 없습니다.
$BODY$)
ON CONFLICT (code, version) DO NOTHING;
-- ── 표준계약서 골격 v1.0 반영 ──────────────────────────────────────
--
-- ★ 골격 문서에서 빠져 있던 것을 넣습니다.
--
--   ① 4장 비당사자 명시 — **조항 존재는 확정**입니다
--   ② 문구는 B-06 회신 전이라 placeholder 를 답니다
--   ③ 0장 — 조항은 편집 불가, 빈칸만 채웁니다(변호사법 109조)
--   ④ 2장 — 용역 + 비사업자 개인은 등록 단계에서 차단(A-09)
--   ⑤ 7장 — 부동산은 A-07 회신 전까지 열지 않습니다

UPDATE contract_templates SET
  version = '1.0-draft',
  note = 'B-06 법무 회신(2026-09-26) 전 초안. 조항 존재는 확정, 문구는 미확정.',
  body = $BODY$
# 소개 표준계약서

> **이 양식은 조항을 고칠 수 없습니다.** 빈칸만 채우십시오.
> 조항을 개별 수정하면 저희가 법률사무를 취급한 것이 되어
> 변호사법 109조에 걸립니다.

## 제1조 (당사자)
회원가입 때 등록하신 사업자 정보가 자동으로 들어갑니다. 계약서에서는
고치실 수 없습니다.

| 항목 | 누가 |
|---|---|
| 상호 · 대표자 · 사업자등록번호 | 양측 (가입 정보) |
| 사업장 주소 · 연락처 | 양측 (가입 정보) |
| 역할 (소개자 / 의뢰인) | 시스템이 정합니다 |

> 사업자 정보는 **자기신고값**입니다. 계좌인증·본인인증이 붙기 전까지는
> 저희가 확인한 값이 아닙니다.

## 제2조 (거래목적물)
| 항목 | 내용 |
|---|---|
| 유형 | 물품 / 용역 |
| 상세 | 품명 · 규격 · 수량 또는 용역 범위 |
| 거래금액 | 당사자가 적습니다 |
| 이행 기한 · 장소 | 당사자가 적습니다 |

> **용역이면서 상대가 비사업자 개인이면** 등록 단계에서 막힙니다.
> 유료직업소개사업 등록 의무에 걸릴 수 있기 때문입니다(A-09).

## 제3조 (소개비)
① 소개비 금액과 산정 방식은 **당사자가 협의**하여 정합니다.
② 지급 시점은 성사 확정 후 당사자가 정한 때입니다.
③ 소개비는 **당사자끼리 직접** 주고받습니다.
   **소개뱅크 계좌를 거치지 않습니다.**
④ 소개자 정보는 소개코드에서 자동으로 들어갑니다.

## 제4조 (소개뱅크는 이 계약의 당사자가 아닙니다)

> **[본 조항은 법무 검토 대기 중이며 확정 문구로 대체 예정]**

① 이 계약은 **당사자 사이의 계약**입니다. 소개뱅크는 이 계약의
   당사자가 아닙니다.
② 소개뱅크는 계약 내용의 이행·불이행에 대하여 책임지지 않습니다.
③ 소개뱅크가 하는 일은 양측이 서로를 찾도록 잇고, 그 기록을
   남기는 것입니다.

## 제5조 (성사)
① 성사는 **양측이 각각 확인**한 때에 확정됩니다. 한쪽만 눌러서는
   확정되지 않습니다.
② 확정 후에는 소개비 정산을 신청할 수 있습니다.

## 제6조 (소개 귀속)
① 소개코드는 **첫 접촉일부터 90일** 동안 유효합니다.
② 같은 상대방에 대해 둘 이상의 소개가 있는 때에는 **먼저 접촉한**
   소개자에게 귀속됩니다.

## 제7조 (전자서명)
① 서명은 외부 전자계약 서비스로 합니다. 이메일·휴대폰으로 본인을
   확인합니다.
② 원본은 그 서비스가 보관하고, 소개뱅크에는 **체결 상태와 링크만**
   남습니다.
③ **서명 후에는 조건을 바꿀 수 없습니다.** 바꾸시려면 해지하고
   다시 체결하십시오.

## 제8조 (분쟁)
① 관할법원은 당사자가 정합니다. 정하지 않으면 민사소송법을 따릅니다.
② 준거법은 대한민국 법입니다.
③ **소개뱅크는 분쟁 처리에 관여하지 않습니다.** 당사자끼리
   해결하시는 것이 원칙입니다.
$BODY$
WHERE code = 'INTRO_STD';

-- 부동산은 A-07 회신 전까지 열지 않습니다.
INSERT INTO contract_templates (code, name, version, scope, effective_from,
                                is_active, invariants, note, body) VALUES
('REALTY_STD', '부동산 표준계약서', '0.1-blocked', 'INTRO', '2099-12-31',
 false, ARRAY['INV-3','INV-9','INV-11'],
 'A-07(중개업 저촉) 회신 전까지 열지 않습니다. is_active=false 로 잠겨 있습니다.',
$BODY$
# 부동산 표준계약서 (열려 있지 않습니다)

이 양식은 **A-07 법무 회신 전까지 쓸 수 없습니다.**

## 왜 막아 두었나

부동산·상가를 소개하고 대가를 받으면 **공인중개사법상 중개업**에
해당할 수 있습니다. 중개사무소 개설등록 없이 하면 3년 이하 징역
또는 3천만원 이하 벌금입니다(공인중개사법 48조).

양식을 먼저 열어 두면 **그 자체가 중개 행위를 권한 것**으로 읽힐
수 있어, 회신 전까지는 잠가 둡니다.

## 열리는 조건

A-07 회신에서 다음이 확인되어야 합니다.

- 소개와 중개의 경계
- 중개사 인증을 거친 경우에만 허용할지
- 소개비 상한을 두어야 하는지
$BODY$)
ON CONFLICT (code) DO NOTHING;
-- ── 알림톡 · SMS 템플릿 (C770) ──────────────────────────────────────
--
-- ★ 카카오는 템플릿을 **미리 심사**합니다. 승인 없이는 못 보냅니다.
--   승인에 영업일 3~5일이 걸리니, 계약과 함께 넣어야 합니다.
--
-- ── 심사에서 반려되는 것들 ──────────────────────────────────────────
--   ① 광고성 표현 — "할인" "이벤트" "혜택" 은 정보성 템플릿에 못 씁니다
--   ② 변수만 있는 문장 — "{name}님 {status}" 같은 것은 반려됩니다
--   ③ 링크만 있는 본문 — 무엇을 알리는지 본문에 있어야 합니다
--   ④ 수신자가 예상 못 하는 내용 — 신청하지 않은 정보
--
-- ── 정보성과 광고성을 섞지 않습니다 ─────────────────────────────────
--   정보성  주문 · 결제 · 배송 · 검수 결과 — 수신거부해도 갑니다
--   광고성  이벤트 · 할인 — (광고) 표기 + 수신거부 필수
--
--   한 템플릿에 섞으면 **전체가 광고성**으로 분류되어, 정보성 알림도
--   수신거부한 사람에게 못 갑니다.

INSERT INTO notification_templates (code, channel, title, body, variables, is_active) VALUES

-- ① 거래 — 소개 · 계약 · 성사
('DEAL_MATCHED_ALIMTALK', 'ALIMTALK', '소개가 연결되었습니다',
 E'{introducer}님의 소개로 {counterpart}님과 연결되었습니다.\n\n건: {title}\n\n대화방에서 조건을 협의해 주십시오. 성사는 양측이 각각 확인해야 확정됩니다.\n\n{link}',
 '["introducer","counterpart","title","link"]'::jsonb, true),

('CONTRACT_SIGN_REQUIRED_ALIMTALK', 'ALIMTALK', '계약서 서명이 필요합니다',
 E'{counterpart}님이 계약서에 서명했습니다. 회원님의 서명이 남았습니다.\n\n건: {title}\n소개비: {fee}\n\n서명하시면 계약이 체결됩니다. 서명 후에는 조건을 바꿀 수 없습니다.\n\n{link}',
 '["counterpart","title","fee","link"]'::jsonb, true),

('DEAL_CONFIRMED_ALIMTALK', 'ALIMTALK', '거래가 성사되었습니다',
 E'{title} 건이 성사 확정되었습니다.\n\n소개비 {fee}는 당사자끼리 직접 주고받으십시오. 소개뱅크 계좌로 보내지 마십시오.\n\n{link}',
 '["title","fee","link"]'::jsonb, true),

-- ② 검수 — 등록 결과
('LISTING_APPROVED_ALIMTALK', 'ALIMTALK', '등록이 승인되었습니다',
 E'등록하신 건이 승인되어 목록에 올라갔습니다.\n\n건: {title}\n승인: {approvedAt}\n\n{link}',
 '["title","approvedAt","link"]'::jsonb, true),

('LISTING_REJECTED_ALIMTALK', 'ALIMTALK', '등록이 반려되었습니다',
 E'등록하신 건이 반려되었습니다.\n\n건: {title}\n사유: {reason}\n\n고쳐서 다시 올리실 수 있습니다.\n\n{link}',
 '["title","reason","link"]'::jsonb, true),

-- ③ 결제 · 정산
('SUBSCRIPTION_PAYMENT_FAILED_ALIMTALK', 'ALIMTALK', '결제가 실패했습니다',
 E'구독료 결제가 실패했습니다.\n\n금액: {amount}\n사유: {reason}\n\n{retryAt}에 다시 시도합니다. 카드를 바꾸시려면 아래에서 하십시오.\n\n{link}',
 '["amount","reason","retryAt","link"]'::jsonb, true),

('SETTLEMENT_PAID_ALIMTALK', 'ALIMTALK', '정산금이 지급되었습니다',
 E'{period} 정산금이 지급되었습니다.\n\n매출: {gross}\n수수료: {commission}\n지급액: {net}\n\n{link}',
 '["period","gross","commission","net","link"]'::jsonb, true),

-- ④ 건강몰 — 직판이라 우리가 보냅니다
('HLT_ORDER_PAID_ALIMTALK', 'ALIMTALK', '주문이 접수되었습니다',
 E'주문해 주셔서 감사합니다.\n\n주문번호: {orderNo}\n결제: {amount}\n\n영업일 1~3일 안에 보내 드립니다. 받으신 날부터 7일 안이면 이유를 묻지 않고 돌려받으실 수 있습니다.\n\n{link}',
 '["orderNo","amount","link"]'::jsonb, true),

('HLT_SHIPPED_ALIMTALK', 'ALIMTALK', '상품을 보냈습니다',
 E'주문하신 상품을 보냈습니다.\n\n주문번호: {orderNo}\n택배사: {carrier}\n송장번호: {trackingNo}\n\n{link}',
 '["orderNo","carrier","trackingNo","link"]'::jsonb, true),

('HLT_RETURN_DONE_ALIMTALK', 'ALIMTALK', '환불이 완료되었습니다',
 E'반품하신 건의 환불이 끝났습니다.\n\n주문번호: {orderNo}\n환불액: {amount}\n\n카드사에 따라 반영까지 2~3일 걸릴 수 있습니다.\n\n{link}',
 '["orderNo","amount","link"]'::jsonb, true),

-- ⑤ 본인인증 · 자격
('IDENTITY_REQUIRED_ALIMTALK', 'ALIMTALK', '본인인증이 필요합니다',
 E'{action}을(를) 하시려면 본인인증이 필요합니다.\n\n한 번만 하시면 됩니다. 인증 정보는 저희가 보관하지 않습니다.\n\n{link}',
 '["action","link"]'::jsonb, true),

('LICENSE_EXPIRING_ALIMTALK', 'ALIMTALK', '자격 만료가 다가옵니다',
 E'등록하신 자격이 곧 만료됩니다.\n\n자격: {kind}\n만료일: {expiresAt} ({daysLeft}일 남음)\n\n만료되면 판매가 멈춥니다. 미리 갱신해 주십시오.\n\n{link}',
 '["kind","expiresAt","daysLeft","link"]'::jsonb, true)

ON CONFLICT (code) DO NOTHING;

-- ── SMS — 알림톡이 실패했을 때만 ────────────────────────────────────
--
-- ★ SMS 는 **알림톡이 실패했을 때 대체**로만 씁니다. 둘 다 보내면
--   같은 내용을 두 번 받고, 돈도 두 번 나갑니다.
--
--   90자를 넘으면 LMS 가 되어 요금이 3배입니다 — 짧게 씁니다.

INSERT INTO notification_templates (code, channel, title, body, variables, is_active) VALUES
('DEAL_MATCHED_SMS', 'SMS', '',
 '[소개뱅크] 소개가 연결되었습니다. 앱에서 확인해 주세요.',
 '[]'::jsonb, true),
('DEAL_CONFIRMED_SMS', 'SMS', '',
 '[소개뱅크] 거래가 성사 확정되었습니다. 앱에서 확인해 주세요.',
 '[]'::jsonb, true),
('HLT_ORDER_PAID_SMS', 'SMS', '',
 '[소개뱅크] 주문이 접수되었습니다. 주문번호 {orderNo}',
 '["orderNo"]'::jsonb, true),
('HLT_SHIPPED_SMS', 'SMS', '',
 '[소개뱅크] 상품을 보냈습니다. {carrier} {trackingNo}',
 '["carrier","trackingNo"]'::jsonb, true),
('LICENSE_EXPIRING_SMS', 'SMS', '',
 '[소개뱅크] 자격이 {daysLeft}일 뒤 만료됩니다. 앱에서 갱신해 주세요.',
 '["daysLeft"]'::jsonb, true)
ON CONFLICT (code) DO NOTHING;

-- ── 알림톡 심사 조건 감시 ───────────────────────────────────────────
--
-- ★ 카카오는 템플릿을 미리 심사합니다. 반려되면 **영업일 3~5일**을
--   다시 기다립니다 — 미리 걸러야 합니다.

/* 광고성 표현이 든 정보성 템플릿. **0이어야 합니다.**
 *
 * 한 템플릿에 광고 표현이 섞이면 전체가 광고성으로 분류되어,
 * 정보성 알림도 수신거부한 사람에게 못 갑니다. */
CREATE OR REPLACE VIEW v_alimtalk_ad_words AS
SELECT code, title,
       '광고성 표현이 있습니다 — 정보성 템플릿에는 쓸 수 없습니다' AS note
  FROM notification_templates
 WHERE channel = 'ALIMTALK' AND is_active
   AND code NOT LIKE 'PROMO%'
   AND (body ~ '할인|이벤트|혜택|특가|무료 증정|쿠폰|프로모션'
     OR title ~ '할인|이벤트|혜택|특가|쿠폰');

COMMENT ON VIEW v_alimtalk_ad_words IS
  '광고성 표현이 든 정보성 알림톡. **0이어야 합니다** — 섞이면 '
  '전체가 광고성으로 분류되어 정보성 알림도 막힙니다.';

/* 본문이 변수뿐인 템플릿 — 카카오가 반려합니다. */
CREATE OR REPLACE VIEW v_alimtalk_thin AS
SELECT code, title, length(regexp_replace(body, '\{[a-zA-Z]+\}', '', 'g')) AS text_len
  FROM notification_templates
 WHERE channel = 'ALIMTALK' AND is_active
   AND length(regexp_replace(body, '\{[a-zA-Z]+\}', '', 'g')) < 30;

COMMENT ON VIEW v_alimtalk_thin IS
  '변수를 빼면 30자도 안 되는 알림톡. **카카오가 반려합니다** — '
  '무엇을 알리는지 본문에 있어야 합니다.';

/* SMS 90자 초과 — LMS 가 되어 요금이 3배입니다. */
CREATE OR REPLACE VIEW v_sms_too_long AS
SELECT code, length(body) AS len, body
  FROM notification_templates
 WHERE channel = 'SMS' AND is_active AND length(body) > 90;

COMMENT ON VIEW v_sms_too_long IS
  '90자를 넘는 SMS. **LMS 가 되어 요금이 3배**입니다 — 짧게 쓰십시오.';

/* 알림톡은 있는데 SMS 대체가 없는 것.
 *
 * 알림톡은 카카오톡을 안 쓰거나 차단한 분에게는 안 갑니다.
 * 중요한 알림은 SMS 대체가 있어야 합니다. */
CREATE OR REPLACE VIEW v_alimtalk_no_fallback AS
SELECT a.code, a.title
  FROM notification_templates a
 WHERE a.channel = 'ALIMTALK' AND a.is_active
   AND a.code ~ 'PAID|SHIPPED|CONFIRMED|EXPIRING|FAILED'
   AND NOT EXISTS (
     SELECT 1 FROM notification_templates s
      WHERE s.channel = 'SMS'
        AND s.code = replace(a.code, '_ALIMTALK', '_SMS'));

COMMENT ON VIEW v_alimtalk_no_fallback IS
  'SMS 대체가 없는 중요 알림톡. 카카오톡을 안 쓰거나 차단한 분에게는 '
  '알림톡이 가지 않습니다.';
-- ── 알림 템플릿 보강 (C780) ─────────────────────────────────────────
--
-- ★ 이번 세션에 만든 기능 6종에 **알림이 하나도 없었습니다.**
--   기능은 도는데 당사자가 모릅니다 — 정산이 지급됐는데 판매자가
--   모르고, 신고가 처리됐는데 신고자가 모릅니다.
--
-- ── 채널을 고르는 기준 ──────────────────────────────────────────────
--   INAPP     전부 — 기록으로 남습니다
--   EMAIL     내용이 길거나 증빙이 필요한 것
--   ALIMTALK  당사자가 바로 알아야 하는 것
--   SMS       알림톡이 실패했을 때 대체 (중요한 것만)
--
-- 다 보내면 시끄럽습니다. **당사자가 바로 움직여야 하는 것**만
-- 알림톡으로 보냅니다.

INSERT INTO notification_templates (code, channel, title, body, variables, is_active) VALUES

-- ① 건강몰 정산 — 판매자가 돈을 언제 받는지 알아야 합니다
('HLT_SETTLE_CONFIRMED_INAPP', 'INAPP', '정산서가 나왔습니다',
 E'{period} 정산서를 확인해 주십시오.\n\n매출 {gross} · 수수료 {commission} · 지급 예정 {net}\n\n이의가 있으시면 확인 전에 알려 주십시오.',
 '["period","gross","commission","net"]'::jsonb, true),

('HLT_SETTLE_CONFIRMED_ALIMTALK', 'ALIMTALK', '정산서가 나왔습니다',
 E'{period} 정산서가 나왔습니다.\n\n매출: {gross}\n판매수수료: {commission}\n지급 예정: {net}\n\n이의가 있으시면 지급 전에 알려 주십시오.\n\n{link}',
 '["period","gross","commission","net","link"]'::jsonb, true),

('HLT_SETTLE_CONFIRMED_EMAIL', 'EMAIL', '[소개뱅크] {period} 정산서',
 E'{seller}님\n\n{period} 정산서를 보내 드립니다.\n\n매출        {gross}\n판매수수료   {commission}\n환불        {refund}\n이월        {carriedIn}\n───────────────────\n지급 예정    {net}\n\n이의가 있으시면 지급 전에 알려 주십시오. 지급 후에는 다음 회차에서\n조정합니다.\n\n{link}',
 '["seller","period","gross","commission","refund","carriedIn","net","link"]'::jsonb, true),

('HLT_SETTLE_CARRIED_INAPP', 'INAPP', '정산액이 음수라 이월됩니다',
 E'{period} 정산액이 {net} 로 음수입니다.\n\n환불이 매출보다 많아 다음 회차로 넘깁니다. 계좌에서 빼 가지 않습니다.',
 '["period","net"]'::jsonb, true),

('HLT_SETTLE_CARRIED_ALIMTALK', 'ALIMTALK', '정산액이 이월됩니다',
 E'{period} 정산액이 음수({net})라 다음 회차로 넘깁니다.\n\n환불이 매출보다 많았습니다. 계좌에서 빼 가지 않으니 걱정하지 않으셔도 됩니다.\n\n{link}',
 '["period","net","link"]'::jsonb, true),

-- ② 정산 계좌 — 인증하지 않으면 돈을 못 받습니다
('PAYOUT_VERIFY_SENT_INAPP', 'INAPP', '1원을 보냈습니다',
 E'{bank} 계좌로 1원을 보냈습니다.\n\n입금자명에 찍힌 코드를 적어 주시면 인증됩니다. 다섯 번 틀리면 막힙니다.',
 '["bank"]'::jsonb, true),

('PAYOUT_VERIFY_SENT_ALIMTALK', 'ALIMTALK', '계좌 인증 1원을 보냈습니다',
 E'{bank} 계좌로 1원을 보냈습니다.\n\n입금자명에 찍힌 코드를 앱에 적어 주십시오. 다섯 번 틀리면 막히니 천천히 확인해 주십시오.\n\n{link}',
 '["bank","link"]'::jsonb, true),

('PAYOUT_VERIFIED_INAPP', 'INAPP', '계좌가 인증되었습니다',
 E'{bank} {last4} 계좌가 인증되었습니다.\n\n앞으로 이 계좌로 지급됩니다.',
 '["bank","last4"]'::jsonb, true),

('PAYOUT_LOCKED_INAPP', 'INAPP', '계좌 인증이 막혔습니다',
 E'다섯 번 틀려 인증이 막혔습니다.\n\n고객센터로 연락 주시면 풀어 드립니다. 본인 계좌가 맞는지 먼저 확인해 주십시오.',
 '[]'::jsonb, true),

-- ③ 전자계약 — 상대가 서명했는지 알아야 합니다
('CONTRACT_ESIGN_SENT_INAPP', 'INAPP', '서명 요청을 보냈습니다',
 E'{counterpart}님에게 서명 요청을 보냈습니다.\n\n양측이 모두 서명해야 체결됩니다.',
 '["counterpart"]'::jsonb, true),

('CONTRACT_ESIGN_SIGNED_INAPP', 'INAPP', '상대가 서명했습니다',
 E'{counterpart}님이 서명했습니다. 회원님의 서명이 남았습니다.\n\n서명 후에는 조건을 바꿀 수 없습니다.',
 '["counterpart"]'::jsonb, true),

('CONTRACT_ESIGN_DONE_INAPP', 'INAPP', '계약이 체결되었습니다',
 E'양측이 모두 서명하여 계약이 체결되었습니다.\n\n체결본은 전자계약 서비스에 보관되며, 언제든 내려받으실 수 있습니다.',
 '[]'::jsonb, true),

('CONTRACT_ESIGN_DONE_ALIMTALK', 'ALIMTALK', '계약이 체결되었습니다',
 E'양측이 모두 서명하여 계약이 체결되었습니다.\n\n건: {title}\n체결: {signedAt}\n\n체결본을 내려받으실 수 있습니다.\n\n{link}',
 '["title","signedAt","link"]'::jsonb, true),

('CONTRACT_ESIGN_DONE_EMAIL', 'EMAIL', '[소개뱅크] 계약이 체결되었습니다',
 E'{name}님\n\n계약이 체결되었습니다.\n\n건        {title}\n소개비     {fee}\n체결       {signedAt}\n상대방     {counterpart}\n\n소개비는 당사자끼리 직접 주고받으십시오. 소개뱅크 계좌로 보내지\n마십시오.\n\n체결본: {link}',
 '["name","title","fee","signedAt","counterpart","link"]'::jsonb, true),

-- ④ 광고 청구 — 돈을 내야 하는 일입니다
('AD_INVOICE_ISSUED_INAPP', 'INAPP', '광고비 청구서가 나왔습니다',
 E'{period} 광고비 {amount} 가 청구되었습니다.\n\n납기: {dueDate}',
 '["period","amount","dueDate"]'::jsonb, true),

('AD_INVOICE_ISSUED_EMAIL', 'EMAIL', '[소개뱅크] {period} 광고비 청구서',
 E'{advertiser} 귀중\n\n{period} 광고비 청구서를 보내 드립니다.\n\n청구번호   {invoiceNo}\n노출       {impressions}\n클릭       {clicks}\n금액       {amount}\n납기       {dueDate}\n\n입금 계좌는 청구서에 적혀 있습니다.\n\n{link}',
 '["advertiser","period","invoiceNo","impressions","clicks","amount","dueDate","link"]'::jsonb, true),

('AD_INVOICE_OVERDUE_INAPP', 'INAPP', '광고비 납기가 지났습니다',
 E'{invoiceNo} 의 납기({dueDate})가 {daysOver}일 지났습니다.\n\n미납이 이어지면 광고가 멈춥니다.',
 '["invoiceNo","dueDate","daysOver"]'::jsonb, true),

('AD_PAYMENT_RECEIVED_INAPP', 'INAPP', '입금이 확인되었습니다',
 E'{amount} 입금을 확인했습니다.\n\n남은 금액: {remaining}',
 '["amount","remaining"]'::jsonb, true),

-- ⑤ 신고 — 답이 없으면 다음부터 신고를 안 합니다
('REPORT_RECEIVED_INAPP', 'INAPP', '신고가 접수되었습니다',
 E'신고해 주셔서 감사합니다.\n\n접수번호: {reportNo}\n\n확인 후 알려 드리겠습니다.',
 '["reportNo"]'::jsonb, true),

('REPORT_RESOLVED_INAPP', 'INAPP', '신고 처리가 끝났습니다',
 E'{reportNo} 신고를 처리했습니다.\n\n결과: {result}\n사유: {reason}',
 '["reportNo","result","reason"]'::jsonb, true),

('REPORT_RESOLVED_EMAIL', 'EMAIL', '[소개뱅크] 신고 처리 결과',
 E'{name}님\n\n신고해 주신 건을 처리했습니다.\n\n접수번호   {reportNo}\n대상       {target}\n결과       {result}\n사유       {reason}\n\n결과에 이의가 있으시면 고객센터로 알려 주십시오.',
 '["name","reportNo","target","result","reason"]'::jsonb, true),

-- ⑥ 이벤트 — 받았는지 못 받았는지 알아야 합니다
('EVENT_JOINED_INAPP', 'INAPP', '이벤트에 참여했습니다',
 E'{eventName} 에 참여하셨습니다.\n\n조건을 채우시면 자동으로 지급됩니다.',
 '["eventName"]'::jsonb, true),

('EVENT_REWARDED_INAPP', 'INAPP', '이벤트 혜택이 지급되었습니다',
 E'{eventName} 혜택이 지급되었습니다.\n\n내용: {reward}',
 '["eventName","reward"]'::jsonb, true),

-- ⑦ 건강몰 주문 — 취소·반품 진행도 알려야 합니다
('HLT_RETURN_RECEIVED_INAPP', 'INAPP', '반품 신청이 접수되었습니다',
 E'{orderNo} 반품 신청을 접수했습니다.\n\n3영업일 안에 알려 드리겠습니다.',
 '["orderNo"]'::jsonb, true),

('HLT_RETURN_REJECTED_INAPP', 'INAPP', '반품이 거절되었습니다',
 E'{orderNo} 반품이 거절되었습니다.\n\n사유: {reason}\n\n이의가 있으시면 고객센터로 알려 주십시오. 청약철회는 법이 준 권리라 거절에는 근거가 있어야 합니다.',
 '["orderNo","reason"]'::jsonb, true),

('HLT_ORDER_CANCELED_INAPP', 'INAPP', '주문이 취소되었습니다',
 E'{orderNo} 주문이 취소되었습니다.\n\n결제하신 금액은 3영업일 안에 환불됩니다.',
 '["orderNo"]'::jsonb, true),

-- ⑧ 자격 만료 — 만료되면 판매가 멈춥니다
('LICENSE_EXPIRED_INAPP', 'INAPP', '자격이 만료되어 판매가 멈췄습니다',
 E'{kind} 자격이 만료되어 상품 노출이 멈췄습니다.\n\n갱신하시면 바로 다시 열립니다. 이미 받은 주문은 그대로 이행해 주십시오.',
 '["kind"]'::jsonb, true),

('LICENSE_EXPIRED_ALIMTALK', 'ALIMTALK', '자격 만료로 판매가 멈췄습니다',
 E'{kind} 자격이 만료되어 상품 노출이 멈췄습니다.\n\n만료일: {expiresAt}\n\n갱신하시면 바로 다시 열립니다. 이미 받은 주문은 그대로 이행해 주십시오.\n\n{link}',
 '["kind","expiresAt","link"]'::jsonb, true)

ON CONFLICT (code) DO NOTHING;

-- ── SMS 대체 — 중요한 것만 ─────────────────────────────────────────
--
-- ★ 알림톡이 실패했을 때만 씁니다. 90자를 넘으면 LMS 가 되어
--   요금이 3배입니다.

INSERT INTO notification_templates (code, channel, title, body, variables, is_active) VALUES
('HLT_SETTLE_CONFIRMED_SMS', 'SMS', '',
 '[소개뱅크] {period} 정산서가 나왔습니다. 앱에서 확인해 주세요.',
 '["period"]'::jsonb, true),
('CONTRACT_ESIGN_DONE_SMS', 'SMS', '',
 '[소개뱅크] 계약이 체결되었습니다. 앱에서 확인해 주세요.',
 '[]'::jsonb, true),
('PAYOUT_VERIFY_SENT_SMS', 'SMS', '',
 '[소개뱅크] 계좌 인증 1원을 보냈습니다. 입금자명 코드를 확인해 주세요.',
 '[]'::jsonb, true),
('LICENSE_EXPIRED_SMS', 'SMS', '',
 '[소개뱅크] 자격 만료로 판매가 멈췄습니다. 앱에서 갱신해 주세요.',
 '[]'::jsonb, true)
ON CONFLICT (code) DO NOTHING;
/* 중요한 알림인데 INAPP 이 없는 것.
 *
 * ★ INAPP 은 **기록**입니다. 메일·알림톡은 놓칠 수 있지만
 *   앱에 들어오면 언제든 다시 봅니다. 전부 있어야 합니다. */
CREATE OR REPLACE VIEW v_template_no_inapp AS
SELECT DISTINCT split_part(t.code, '_', 1) || '_' || split_part(t.code, '_', 2) AS event
  FROM notification_templates t
 WHERE t.is_active AND t.channel <> 'INAPP'
   AND NOT EXISTS (
     SELECT 1 FROM notification_templates i
      WHERE i.channel = 'INAPP' AND i.is_active
        AND split_part(i.code,'_',1)||'_'||split_part(i.code,'_',2)
          = split_part(t.code,'_',1)||'_'||split_part(t.code,'_',2));

COMMENT ON VIEW v_template_no_inapp IS
  'INAPP 이 없는 알림. **기록이 남지 않습니다** — 메일·알림톡은 '
  '놓칠 수 있지만 앱에 들어오면 언제든 다시 봅니다.';
-- ── INAPP 보강 ──────────────────────────────────────────────────────
--
-- ★ INAPP 은 **기록**입니다. 메일·알림톡은 놓칠 수 있지만 앱에
--   들어오면 언제든 다시 봅니다. 없으면 "그런 연락 못 받았다" 는
--   말에 답할 수 없습니다.

INSERT INTO notification_templates (code, channel, title, body, variables, is_active) VALUES
('DEAL_MATCHED_INAPP', 'INAPP', '소개가 연결되었습니다',
 E'{introducer}님의 소개로 {counterpart}님과 연결되었습니다.\n\n건: {title}\n\n대화방에서 조건을 협의해 주십시오. 성사는 양측이 각각 확인해야 확정됩니다.',
 '["introducer","counterpart","title"]'::jsonb, true),

('HLT_SHIPPED_INAPP', 'INAPP', '상품을 보냈습니다',
 E'{orderNo} 상품을 보냈습니다.\n\n{carrier} {trackingNo}',
 '["orderNo","carrier","trackingNo"]'::jsonb, true),

('IDENTITY_REQUIRED_INAPP', 'INAPP', '본인인증이 필요합니다',
 E'{action}을(를) 하시려면 본인인증이 필요합니다.\n\n한 번만 하시면 됩니다. 인증 정보는 저희가 보관하지 않습니다.',
 '["action"]'::jsonb, true),

('INTRO_INVITE_INAPP', 'INAPP', '소개 요청이 왔습니다',
 E'{introducer}님이 회원님을 소개하려 합니다.\n\n요청: {title}\n\n동의하지 않으시면 아무 일도 일어나지 않습니다.',
 '["introducer","title"]'::jsonb, true),

('LICENSE_EXPIRING_INAPP', 'INAPP', '자격 만료가 다가옵니다',
 E'{kind} 자격이 {daysLeft}일 뒤 만료됩니다.\n\n만료일: {expiresAt}\n\n만료되면 판매가 멈춥니다. 미리 갱신해 주십시오.',
 '["kind","daysLeft","expiresAt"]'::jsonb, true)
ON CONFLICT (code) DO NOTHING;
-- ── 검정이 잡은 것 고침 ─────────────────────────────────────────────
--
-- ★ 두 가지가 걸렸습니다. 둘 다 정당합니다.
--
--   ① {bank} 변수 금지 — 은행명을 알림에 넣으면 "소개뱅크가 그 계좌로
--      지급한다" 는 오해를 부릅니다(I-01). 소개비는 당사자끼리
--      주고받고, 정산 계좌는 **우리가 보내는 쪽**입니다.
--      → 뒤 4자리만 씁니다.
--
--   ② SMS 90**바이트** — 한글은 3바이트라 30자입니다. 97바이트였습니다.
--      → 짧게 고칩니다.

UPDATE notification_templates SET
  body = E'등록하신 계좌로 1원을 보냈습니다.\n\n입금자명에 찍힌 코드를 적어 주시면 인증됩니다. 다섯 번 틀리면 막힙니다.',
  variables = '[]'::jsonb
WHERE code = 'PAYOUT_VERIFY_SENT_INAPP';

UPDATE notification_templates SET
  body = E'등록하신 계좌로 1원을 보냈습니다.\n\n입금자명에 찍힌 코드를 앱에 적어 주십시오. 다섯 번 틀리면 막히니 천천히 확인해 주십시오.\n\n{link}',
  variables = '["link"]'::jsonb
WHERE code = 'PAYOUT_VERIFY_SENT_ALIMTALK';

UPDATE notification_templates SET
  body = E'정산 계좌가 인증되었습니다. (끝 {last4})\n\n앞으로 이 계좌로 지급해 드립니다.',
  variables = '["last4"]'::jsonb
WHERE code = 'PAYOUT_VERIFIED_INAPP';

/* SMS 90바이트 — 한글 3바이트라 30자입니다. */
UPDATE notification_templates SET
  body = '[소개뱅크] 계좌 인증 1원 발송. 입금자명 코드를 확인해 주세요.'
WHERE code = 'PAYOUT_VERIFY_SENT_SMS';
/* ★ "이 계좌로 지급" 이 플랫폼 지급 주장으로 읽힙니다.
 *
 *   소개비는 당사자끼리 주고받습니다. 정산 계좌는 **구독 환불 ·
 *   광고비 반환 같은 우리 돈**을 보낼 때만 씁니다 — 그것을
 *   분명히 적습니다. */
UPDATE notification_templates SET
  body = E'정산 계좌가 인증되었습니다. (끝 {last4})\n\n환불이나 정산금이 생기면 이 계좌를 씁니다. 소개비는 당사자끼리 직접 주고받으십시오.'
WHERE code = 'PAYOUT_VERIFIED_INAPP';
-- ── 알림이 실제로 나가게 (C790) ─────────────────────────────────────
--
-- ★ 템플릿은 만들었는데 **아무도 부르지 않았습니다.** 기능은 도는데
--   당사자가 모릅니다 — 정산이 지급됐는데 판매자가 모르고,
--   계좌가 인증됐는데 본인이 모릅니다.
--
-- ── 왜 트리거로 하나 ────────────────────────────────────────────────
--   앱에서 보내게 하면 **한 곳을 빠뜨립니다.** 실제로 여섯 기능 모두
--   빠져 있었습니다. 데이터가 바뀌는 그 자리에서 보냅니다.
--
-- ── 본문은 템플릿에서 가져옵니다 ────────────────────────────────────
--   트리거에 문구를 박으면 고칠 때 코드를 배포해야 합니다.
--   템플릿을 고치면 다음 알림부터 바뀌게 합니다.

/* 템플릿을 찾아 변수를 채워 넣습니다. */
CREATE OR REPLACE FUNCTION fn_notify(
  p_account uuid, p_code text, p_vars jsonb, p_link text DEFAULT NULL
) RETURNS void AS $$
DECLARE t record; v_body text; v_key text;
BEGIN
  IF p_account IS NULL THEN RETURN; END IF;

  SELECT * INTO t FROM notification_templates
   WHERE code = p_code || '_INAPP' AND is_active;
  IF t IS NULL THEN
    /* 템플릿이 없으면 **조용히 넘어가지 않습니다** — 알림이 안 가는
     * 것을 아무도 모르게 되기 때문입니다. */
    RAISE WARNING 'NOTIFY: 템플릿이 없습니다 — %_INAPP', p_code;
    RETURN;
  END IF;

  v_body := t.body;
  FOR v_key IN SELECT jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) LOOP
    v_body := replace(v_body, '{' || v_key || '}', coalesce(p_vars ->> v_key, ''));
  END LOOP;

  INSERT INTO notifications (account_id, event_code, template_code, title, body, link_url)
  VALUES (p_account, split_part(p_code,'_',1), p_code || '_INAPP', t.title, v_body, p_link);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_notify IS
  '알림 보내기. **본문은 템플릿에서 가져옵니다** — 트리거에 문구를 '
  '박으면 고칠 때 배포해야 합니다. 템플릿이 없으면 경고를 남깁니다.';

-- ── ① 건강몰 정산 ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_settle() RETURNS trigger AS $$
DECLARE v_acc uuid; v_period text;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT account_id INTO v_acc FROM hlt_sellers WHERE id = NEW.seller_id;
  v_period := to_char(NEW.period_from,'MM-DD') || ' ~ ' || to_char(NEW.period_to,'MM-DD');

  IF NEW.status = 'CONFIRMED' THEN
    PERFORM fn_notify(v_acc, 'HLT_SETTLE_CONFIRMED',
      jsonb_build_object('period', v_period,
        'gross', to_char(NEW.gross_amount,'FM999,999,999') || '원',
        'commission', to_char(NEW.commission,'FM999,999,999') || '원',
        'net', to_char(NEW.net_amount,'FM999,999,999') || '원'),
      '/my/settlements');
  ELSIF NEW.status = 'CARRIED' THEN
    PERFORM fn_notify(v_acc, 'HLT_SETTLE_CARRIED',
      jsonb_build_object('period', v_period,
        'net', to_char(NEW.net_amount,'FM999,999,999') || '원'),
      '/my/settlements');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_settle ON hlt_settlements;
CREATE TRIGGER trg_notify_settle AFTER UPDATE ON hlt_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_notify_settle();

-- ── ② 정산 계좌 ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_payout() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_notify(NEW.account_id, 'PAYOUT_VERIFY_SENT',
      '{}'::jsonb, '/my/payout-accounts');
    RETURN NEW;
  END IF;

  IF NEW.verified AND NOT OLD.verified THEN
    PERFORM fn_notify(NEW.account_id, 'PAYOUT_VERIFIED',
      jsonb_build_object('last4', coalesce(NEW.account_last4,'????')),
      '/my/payout-accounts');
  ELSIF NEW.verify_tries >= 5 AND OLD.verify_tries < 5 THEN
    PERFORM fn_notify(NEW.account_id, 'PAYOUT_LOCKED',
      '{}'::jsonb, '/my/payout-accounts');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_payout ON payout_accounts;
CREATE TRIGGER trg_notify_payout AFTER INSERT OR UPDATE ON payout_accounts
  FOR EACH ROW EXECUTE FUNCTION fn_notify_payout();

-- ── ③ 전자계약 ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_esign() RETURNS trigger AS $$
DECLARE d record;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  SELECT * INTO d FROM deals WHERE id = NEW.deal_id;
  IF d IS NULL THEN RETURN NEW; END IF;

  /* 서명 요청이 나갔습니다 */
  IF NEW.esign_doc_id IS NOT NULL AND OLD.esign_doc_id IS NULL THEN
    PERFORM fn_notify(d.buyer_account_id, 'CONTRACT_ESIGN_SENT',
      jsonb_build_object('counterpart','상대방'), '/my/contracts');
    PERFORM fn_notify(d.seller_account_id, 'CONTRACT_ESIGN_SENT',
      jsonb_build_object('counterpart','상대방'), '/my/contracts');
  END IF;

  /* 한쪽이 서명했습니다 — 상대에게 알립니다 */
  IF NEW.signed_by_buyer_at IS NOT NULL AND OLD.signed_by_buyer_at IS NULL THEN
    PERFORM fn_notify(d.seller_account_id, 'CONTRACT_ESIGN_SIGNED',
      jsonb_build_object('counterpart','매수자'), '/my/contracts');
  END IF;
  IF NEW.signed_by_seller_at IS NOT NULL AND OLD.signed_by_seller_at IS NULL THEN
    PERFORM fn_notify(d.buyer_account_id, 'CONTRACT_ESIGN_SIGNED',
      jsonb_build_object('counterpart','매도자'), '/my/contracts');
  END IF;

  /* 양측이 서명했습니다 */
  IF NEW.signed_by_buyer_at IS NOT NULL AND NEW.signed_by_seller_at IS NOT NULL
     AND (OLD.signed_by_buyer_at IS NULL OR OLD.signed_by_seller_at IS NULL) THEN
    PERFORM fn_notify(d.buyer_account_id, 'CONTRACT_ESIGN_DONE', '{}'::jsonb, '/my/contracts');
    PERFORM fn_notify(d.seller_account_id, 'CONTRACT_ESIGN_DONE', '{}'::jsonb, '/my/contracts');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_esign ON deal_contracts;
CREATE TRIGGER trg_notify_esign AFTER UPDATE ON deal_contracts
  FOR EACH ROW EXECUTE FUNCTION fn_notify_esign();

-- ── ④ 광고 청구 ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_ad_invoice() RETURNS trigger AS $$
DECLARE v_acc uuid;
BEGIN
  SELECT account_id INTO v_acc FROM advertisers WHERE id = NEW.advertiser_id;
  IF v_acc IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM fn_notify(v_acc, 'AD_INVOICE_ISSUED',
      jsonb_build_object('period', to_char(NEW.period_from,'YYYY-MM'),
        'amount', to_char(NEW.amount,'FM999,999,999') || '원',
        'dueDate', to_char(NEW.due_date,'YYYY-MM-DD')),
      '/my/ad-invoices');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_ad_invoice ON ad_invoices;
CREATE TRIGGER trg_notify_ad_invoice AFTER INSERT ON ad_invoices
  FOR EACH ROW EXECUTE FUNCTION fn_notify_ad_invoice();

CREATE OR REPLACE FUNCTION fn_notify_ad_payment() RETURNS trigger AS $$
DECLARE v_acc uuid; v_left bigint;
BEGIN
  SELECT a.account_id, i.amount - coalesce((SELECT sum(p.amount) FROM ad_payments p
                                             WHERE p.invoice_id = i.id),0)
    INTO v_acc, v_left
    FROM ad_invoices i JOIN advertisers a ON a.id = i.advertiser_id
   WHERE i.id = NEW.invoice_id;
  IF v_acc IS NULL THEN RETURN NEW; END IF;

  PERFORM fn_notify(v_acc, 'AD_PAYMENT_RECEIVED',
    jsonb_build_object('amount', to_char(NEW.amount,'FM999,999,999') || '원',
      'remaining', to_char(greatest(v_left,0),'FM999,999,999') || '원'),
    '/my/ad-invoices');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_ad_payment ON ad_payments;
CREATE TRIGGER trg_notify_ad_payment AFTER INSERT ON ad_payments
  FOR EACH ROW EXECUTE FUNCTION fn_notify_ad_payment();

-- ── ⑤ 자격 만료 ────────────────────────────────────────────────────
--
-- ★ 만료되면 **판매가 멈춥니다.** 모르고 있으면 매출이 끊긴 이유를
--   알 수 없습니다.
CREATE OR REPLACE FUNCTION fn_notify_license_expired() RETURNS trigger AS $$
DECLARE v_acc uuid;
BEGIN
  IF NEW.expires_at IS NULL OR NEW.expires_at >= current_date THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.expires_at = NEW.expires_at THEN RETURN NEW; END IF;

  SELECT account_id INTO v_acc FROM hlt_sellers WHERE id = NEW.seller_id;
  PERFORM fn_notify(v_acc, 'LICENSE_EXPIRED',
    jsonb_build_object('kind', NEW.kind), '/seller/licenses');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_license ON hlt_seller_licenses;
CREATE TRIGGER trg_notify_license AFTER INSERT OR UPDATE ON hlt_seller_licenses
  FOR EACH ROW EXECUTE FUNCTION fn_notify_license_expired();

-- ── 감시 ───────────────────────────────────────────────────────────

/* 템플릿은 있는데 아무도 안 부르는 것.
 *
 * ★ 만들어 놓고 연결을 빠뜨리면 **기능은 도는데 당사자가 모릅니다.** */
CREATE OR REPLACE VIEW v_template_unused AS
SELECT t.code, t.title
  FROM notification_templates t
 WHERE t.channel = 'INAPP' AND t.is_active
   AND t.code ~ '^(HLT_SETTLE|PAYOUT|CONTRACT_ESIGN|AD_INVOICE|AD_PAYMENT|LICENSE_EXPIRED)'
   AND NOT EXISTS (
     SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.prosrc LIKE '%' || replace(t.code, '_INAPP', '') || '%');

COMMENT ON VIEW v_template_unused IS
  '템플릿은 있는데 부르는 곳이 없는 알림. **0이어야 합니다** — '
  '기능은 도는데 당사자가 모르게 됩니다.';
/* 납기가 지난 광고비를 알립니다.
 *
 * ★ 이것만 트리거로 못 합니다 — **시간이 지나야** 연체입니다.
 *   데이터가 바뀌는 순간이 없어 배치가 훑어야 합니다.
 *
 *   같은 청구서로 하루 한 번만 보냅니다. 매번 보내면 시끄럽고,
 *   시끄러우면 안 보게 됩니다. */
CREATE OR REPLACE FUNCTION fn_notify_ad_overdue() RETURNS int AS $$
DECLARE n int := 0; r record;
BEGIN
  FOR r IN
    SELECT i.id, i.invoice_no, i.due_date, a.account_id,
           (current_date - i.due_date) AS days_over
      FROM ad_invoices i
      JOIN advertisers a ON a.id = i.advertiser_id
     WHERE i.status <> 'PAID' AND i.due_date < current_date
       AND a.account_id IS NOT NULL
       /* 오늘 이미 보냈으면 건너뜁니다 */
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.account_id = a.account_id
            AND n.template_code = 'AD_INVOICE_OVERDUE_INAPP'
            AND n.body LIKE '%' || i.invoice_no || '%'
            AND n.created_at::date = current_date)
  LOOP
    PERFORM fn_notify(r.account_id, 'AD_INVOICE_OVERDUE',
      jsonb_build_object('invoiceNo', r.invoice_no,
        'dueDate', to_char(r.due_date,'YYYY-MM-DD'),
        'daysOver', r.days_over::text),
      '/my/ad-invoices');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_notify_ad_overdue IS
  '연체된 광고비를 알립니다. **하루 한 번만** 보냅니다 — 매번 보내면 '
  '시끄럽고, 시끄러우면 안 보게 됩니다. 배치가 부릅니다.';
-- ── 2차 일괄 오픈 (C800) ────────────────────────────────────────────
--
-- ── 사장님 결정 ─────────────────────────────────────────────────────
-- **순차가 아니라 일괄입니다.** 2·3·4관을 같은 날 엽니다.
--
-- ── 순차와 일괄은 판정이 다릅니다 ───────────────────────────────────
--
--   순차   한 관씩 열고, 그 관만 준비되면 됩니다
--   일괄   **하나라도 안 되면 전부 못 엽니다**
--
-- 순차라면 소개몰이 늦어도 소개창업을 먼저 열 수 있지만, 일괄이면
-- 셋 다 될 때까지 기다립니다. 그래서 **가장 늦은 관이 날짜를
-- 정합니다.**
--
-- ── 왜 일괄이 나은가 ────────────────────────────────────────────────
-- 순차로 열면 이용자가 **"왜 저 관만 있냐"** 고 묻습니다. 관을
-- 늘릴 때마다 안내하고 약관을 다시 받아야 합니다.
--
-- 일괄이면 한 번에 끝납니다.
-- =====================================================================

/* 관별 오픈 준비 판정 — 일괄이라 **모두 통과해야** 엽니다. */
CREATE OR REPLACE VIEW v_gwan_open_ready AS
SELECT g.code, g.name, g.sale_mode,
       (SELECT count(*) FROM categories c
         WHERE c.gwan_code = g.code AND c.status = 'APPROVED') AS categories,
       (SELECT count(*) FROM listings l
         WHERE l.gwan_code = g.code AND l.status = 'PUBLISHED') AS listings,
       (SELECT count(*) FROM notification_templates t
         WHERE t.is_active AND t.channel = 'INAPP') AS templates,
       g.opened_at,
       CASE
         WHEN g.opened_at IS NOT NULL THEN '열림'
         WHEN (SELECT count(*) FROM categories c
                WHERE c.gwan_code = g.code AND c.status = 'APPROVED') = 0
           THEN '업종이 없습니다'
         WHEN (SELECT count(*) FROM listings l
                WHERE l.gwan_code = g.code AND l.status = 'PUBLISHED') = 0
           THEN '올릴 물건이 없습니다'
         ELSE '준비됨'
       END AS state
  FROM gwans g
 WHERE g.is_active AND NOT g.is_hub;

COMMENT ON VIEW v_gwan_open_ready IS
  '관별 오픈 준비. **일괄 오픈이라 하나라도 안 되면 전부 못 엽니다** — '
  '가장 늦은 관이 날짜를 정합니다.';

/* 2차 일괄 오픈 대상. */
CREATE OR REPLACE VIEW v_phase2_blockers AS
SELECT code, name, state
  FROM v_gwan_open_ready
 WHERE code IN ('MAL','BIZ','LED') AND state <> '준비됨' AND opened_at IS NULL;

COMMENT ON VIEW v_phase2_blockers IS
  '2차 일괄 오픈을 막는 관. **0이어야 2차를 엽니다** — 순차가 아니라 '
  '일괄이라 하나라도 남으면 전부 기다립니다.';

/* 일괄 오픈 실행 — 한 번에 엽니다.
 *
 * ★ 하나씩 열 수 없게 함수로만 엽니다. 손으로 UPDATE 하면
 *   "소개몰만 먼저" 가 생기고, 그것이 순차입니다. */
CREATE OR REPLACE FUNCTION fn_open_phase(p_codes text[], p_by uuid)
RETURNS TABLE(code text, opened boolean, reason text) AS $$
DECLARE v_blocked int;
BEGIN
  /* 하나라도 준비가 안 됐으면 **아무것도 열지 않습니다.** */
  SELECT count(*) INTO v_blocked
    FROM v_gwan_open_ready
   WHERE v_gwan_open_ready.code = ANY(p_codes)
     AND state <> '준비됨' AND opened_at IS NULL;

  IF v_blocked > 0 THEN
    RETURN QUERY
      SELECT r.code, false,
             CASE WHEN r.state = '준비됨' THEN '다른 관이 준비되지 않았습니다'
                  ELSE r.state END
        FROM v_gwan_open_ready r WHERE r.code = ANY(p_codes);
    RETURN;
  END IF;

  UPDATE gwans SET opened_at = now()
   WHERE gwans.code = ANY(p_codes) AND opened_at IS NULL;

  INSERT INTO audit.audit_logs (actor_account_id, action, target_type, target_id, detail)
  VALUES (p_by, 'GWAN_OPEN_PHASE', 'GWAN', array_to_string(p_codes,','),
          '일괄 오픈: ' || array_to_string(p_codes,', '));

  RETURN QUERY
    SELECT g.code, true, '열렸습니다'::text FROM gwans g WHERE g.code = ANY(p_codes);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_open_phase IS
  '관을 일괄로 엽니다. **하나라도 준비가 안 됐으면 아무것도 열지 '
  '않습니다** — 손으로 열면 "소개몰만 먼저" 가 생기고 그것이 순차입니다.';

/* 손으로 하나씩 여는 것을 막습니다. */
CREATE OR REPLACE FUNCTION fn_gwan_open_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
    IF coalesce(current_setting('app.opening_phase', true), '') <> 'on' THEN
      RAISE EXCEPTION
        'GWAN: 관은 fn_open_phase() 로만 엽니다 — 하나씩 열면 순차가 됩니다';
    END IF;
  END IF;

  /* 한 번 연 것은 되돌리지 않습니다. 이용자가 보던 것이 사라집니다. */
  IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS NULL THEN
    RAISE EXCEPTION 'GWAN: 연 관은 닫을 수 없습니다 — 멈추시려면 is_active 를 쓰십시오';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gwan_open ON gwans;
CREATE TRIGGER trg_gwan_open BEFORE UPDATE ON gwans
  FOR EACH ROW EXECUTE FUNCTION fn_gwan_open_guard();

/* fn_open_phase 안에서만 UPDATE 가 통하게 합니다. */
CREATE OR REPLACE FUNCTION fn_open_phase(p_codes text[], p_by uuid)
RETURNS TABLE(code text, opened boolean, reason text) AS $$
DECLARE v_blocked int;
BEGIN
  SELECT count(*) INTO v_blocked
    FROM v_gwan_open_ready r
   WHERE r.code = ANY(p_codes) AND r.state <> '준비됨' AND r.opened_at IS NULL;

  IF v_blocked > 0 THEN
    RETURN QUERY
      SELECT r.code, false,
             CASE WHEN r.state = '준비됨' THEN '다른 관이 준비되지 않았습니다'
                  ELSE r.state END
        FROM v_gwan_open_ready r WHERE r.code = ANY(p_codes);
    RETURN;
  END IF;

  PERFORM set_config('app.opening_phase', 'on', true);
  UPDATE gwans SET opened_at = now()
   WHERE gwans.code = ANY(p_codes) AND opened_at IS NULL;
  PERFORM set_config('app.opening_phase', 'off', true);

  INSERT INTO audit.audit_logs (actor_account_id, action, target_type, target_id, detail)
  VALUES (p_by, 'GWAN_OPEN_PHASE', 'GWAN', array_to_string(p_codes,','),
          '일괄 오픈: ' || array_to_string(p_codes,', '));

  RETURN QUERY
    SELECT g.code, true, '열렸습니다'::text FROM gwans g WHERE g.code = ANY(p_codes);
END $$ LANGUAGE plpgsql;
-- ── 관 방어 합치기 ──────────────────────────────────────────────────
--
-- ★ 제 트리거(trg_gwan_open)가 기존 것(trg_assert_gwan_open)을
--   **덮었습니다.** 같은 표에 BEFORE UPDATE 를 걸면서 이름만
--   달랐어야 했는데, 기존 트리거가 사라졌습니다.
--
--   기존 검정 2건이 바로 잡았습니다 — 정당합니다.
--
-- 둘을 한 함수로 합칩니다. 순서가 있습니다.
--   ① is_active 를 켤 때  — 폼 문구 · 업종 (기존)
--   ② opened_at 을 채울 때 — 일괄 오픈만 (신규)

CREATE OR REPLACE FUNCTION fn_gwan_open_guard() RETURNS trigger AS $$
BEGIN
  /* ① 기존 — 관을 켤 때 폼 문구와 업종이 있어야 합니다. */
  IF NEW.is_active AND NOT coalesce(OLD.is_active, false) THEN
    IF NOT EXISTS (SELECT 1 FROM gwan_form_copy WHERE gwan_code = NEW.code) THEN
      RAISE EXCEPTION
        'NO_FORM_COPY: 등록 폼 문구가 없어 관을 열 수 없습니다. gwan_form_copy 를 먼저 채우십시오.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM categories WHERE gwan_code = NEW.code AND status = 'APPROVED'
    ) THEN
      RAISE EXCEPTION
        'NO_APPROVED_CATEGORY: 승인된 업종이 없어 관을 열 수 없습니다.';
    END IF;
  END IF;

  /* ② 신규 — 일괄 오픈. 하나씩 열면 순차가 됩니다. */
  IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
    IF coalesce(current_setting('app.opening_phase', true), '') <> 'on' THEN
      RAISE EXCEPTION
        'GWAN: 관은 fn_open_phase() 로만 엽니다 — 하나씩 열면 순차가 됩니다';
    END IF;
  END IF;

  /* 연 관을 닫으면 이용자가 보던 것이 사라집니다. */
  IF OLD.opened_at IS NOT NULL AND NEW.opened_at IS NULL THEN
    RAISE EXCEPTION 'GWAN: 연 관은 닫을 수 없습니다 — 멈추시려면 is_active 를 쓰십시오';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_gwan_open_guard IS
  '관 방어. **두 가지를 함께 봅니다** — is_active 를 켤 때는 폼 문구와 '
  '업종이, opened_at 을 채울 때는 일괄 오픈 절차가 필요합니다.';
/* ★ `HERO` 는 관이 아니라 **히어로 페이지**입니다.
 *   기존 방어는 관 코드만 받아서 막았습니다 — 그 방어 자체는
 *   맞습니다(중지된 관으로 보내면 빈 화면이 뜹니다).
 *   HERO 만 예외로 통과시킵니다. */
CREATE OR REPLACE FUNCTION fn_landing_gwan_guard() RETURNS trigger AS $$
DECLARE v_ok boolean;
BEGIN
  IF NEW.key IN ('site.landing_after_login','site.landing_new_member')
     AND coalesce(btrim(NEW.value),'') <> '' THEN

    /* HERO = 히어로 페이지. 관이 아니므로 관 검사를 건너뜁니다. */
    IF NEW.value = 'HERO' THEN RETURN NEW; END IF;

    SELECT is_active INTO v_ok FROM gwans WHERE code = NEW.value;
    IF v_ok IS NULL THEN
      RAISE EXCEPTION 'SETTING: %는 없는 관입니다 (관 코드 또는 HERO)', NEW.value;
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION
        'SETTING: %는 중지된 관입니다 — 로그인하자마자 "중지 상태" 화면을 보게 됩니다',
        NEW.value;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- ── 운영이 정하는 설정 3종 (C820) ──────────────────────────────────
--
-- ── 사장님 결정 (2026-09-18) ────────────────────────────────────────
--   세 값을 **관리자 페이지에서 정합니다.** 코드에 박지 않습니다.
--
--   ① 광고 도입가 종료일   비우면 계속 도입가
--   ② 자사 광고만 운영 기간  **자사 광고는 늘 나갑니다** — 이 값은
--                          "외부 광고를 언제부터 섞을까" 입니다
--   ③ 신규 회원 첫 화면     히어로 페이지
-- =====================================================================

/* ① 광고 도입가 — 언제까지 싸게 받을까 */
UPDATE site_settings SET
  description = '광고 도입가를 적용할 마지막 날. 비우면 기한 없이 계속 도입가로 받습니다. '
                '지난 날짜를 넣으면 그날부터 정상가입니다.',
  value_example = '2026-12-31',
  value_pattern = '^(\d{4}-\d{2}-\d{2})?$',
  scope = 'GLOBAL'
WHERE key = 'ads.intro_price_until';

/* ② 자사 광고만 — 외부 광고를 언제부터 섞을까
 *
 * ★ 이름이 헷갈립니다. **자사 광고를 끄는 값이 아닙니다.**
 *   자사 광고는 늘 나가고, 이 값은 "외부 광고주 소재를 언제부터
 *   함께 내보낼까" 입니다. 비우면 외부 광고를 안 섞습니다. */
UPDATE site_settings SET
  description = '이 날까지는 자사 광고만 내보냅니다. 다음 날부터 외부 광고주 소재를 '
                '함께 내보냅니다. 비우면 외부 광고를 섞지 않습니다 — '
                '자사 광고는 이 값과 무관하게 늘 나갑니다.',
  value_example = '2026-11-30',
  value_pattern = '^(\d{4}-\d{2}-\d{2})?$',
  scope = 'GLOBAL'
WHERE key = 'ads.self_only_until';

/* ③ 신규 회원 첫 화면 */
UPDATE site_settings SET
  description = '가입 직후 보내는 화면. HERO(히어로 페이지) · MNY · MAL · BIZ · HLT 중 하나. '
                '비우면 히어로 페이지로 보냅니다.',
  value_example = 'HERO',
  value_pattern = '^(HERO|MNY|MAL|BIZ|HLT)?$',
  scope = 'GLOBAL'
WHERE key = 'site.landing_new_member';

/* ★ 기본값을 HERO 로 둡니다 — 관이 아니라 히어로 페이지입니다.
 *   MNY 로 보내면 가입하자마자 한 관에 갇힙니다. */
UPDATE site_settings SET value = 'HERO'
 WHERE key = 'site.landing_new_member' AND coalesce(value,'') IN ('', 'MNY');

/* 값이 형식에 맞는지 봅니다.
 *
 * ★ 운영이 "2026.12.31" 이나 "올해 말" 을 넣으면 코드가 날짜로
 *   못 읽습니다. 넣는 순간 막습니다 — 나중에 알면 이미 늦습니다. */
CREATE OR REPLACE FUNCTION fn_site_setting_format() RETURNS trigger AS $$
BEGIN
  IF NEW.value_pattern IS NOT NULL
     AND coalesce(NEW.value,'') <> ''
     AND NEW.value !~ NEW.value_pattern THEN
    RAISE EXCEPTION
      'SETTING: % 값이 형식에 맞지 않습니다 — 예: %', NEW.key, coalesce(NEW.value_example,'(없음)');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_site_setting_format ON site_settings;
CREATE TRIGGER trg_site_setting_format BEFORE INSERT OR UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION fn_site_setting_format();

/* 운영이 정해야 할 설정을 한자리에 모읍니다. */
CREATE OR REPLACE VIEW v_admin_settings AS
SELECT key, value, description, value_example, value_pattern,
       is_required_for_open,
       (coalesce(btrim(value),'') = '') AS is_empty,
       updated_at
  FROM site_settings
 WHERE key NOT LIKE 'assume.%'
   AND key NOT LIKE 'infra.%'
 ORDER BY is_required_for_open DESC, key;

COMMENT ON VIEW v_admin_settings IS
  '운영이 관리자 페이지에서 정하는 설정. **간주 모드(assume)와 '
  '인프라(infra)는 뺍니다** — 손으로 건드리면 안 되는 값입니다.';
/* ★ 이 뷰도 관 코드만 압니다. 트리거는 HERO 를 통과시키는데
 *   뷰는 "깨졌다" 고 해서 검정이 잡았습니다 — **두 곳을 같이
 *   고쳐야** 합니다. 한쪽만 고치면 이런 어긋남이 납니다. */
CREATE OR REPLACE VIEW v_landing_broken AS
SELECT s.key, s.value, g.is_active
  FROM site_settings s
  LEFT JOIN gwans g ON g.code = s.value
 WHERE s.key IN ('site.landing_after_login','site.landing_new_member')
   AND coalesce(btrim(s.value),'') <> ''
   AND s.value <> 'HERO'                    /* 히어로 페이지는 관이 아닙니다 */
   AND (g.code IS NULL OR NOT g.is_active);

COMMENT ON VIEW v_landing_broken IS
  '없거나 중지된 관을 랜딩으로 지정한 것. **0이어야 합니다** — '
  '로그인하자마자 빈 화면을 보게 됩니다. HERO(히어로 페이지)는 '
  '관이 아니므로 제외합니다.';
-- ── B-06 표준계약서 제4조 확정 (C830) ──────────────────────────────
--
-- ── 사장님 결재 (2026-09-18) ────────────────────────────────────────
--   제4조 비당사자 조항의 **문구를 확정**했습니다.
--   조항이 있어야 한다는 것은 이미 정해져 있었고, 문구만 대기 중이었습니다.
--
-- ── 왜 이 조항이 중요한가 ───────────────────────────────────────────
--   문구가 약하면 **분쟁에서 소개뱅크가 당사자로 몰립니다.**
--   "잇고 기록을 남긴다" 는 셋째 항이 핵심입니다 — 우리가 한 일의
--   범위를 스스로 한정합니다.

UPDATE contract_templates SET
  body = replace(
    body,
    E'> **[본 조항은 법무 검토 대기 중이며 확정 문구로 대체 예정]**\n\n',
    ''),
  version = '1.0',
  note = '제4조 비당사자 조항 확정 (2026-09-18 · 사장님 결재). '
         || coalesce(note, '')
WHERE code = 'INTRO_STD';

/* 발행된 계약 양식에 미확정 표시가 남아 있으면 안 됩니다.
 *
 * ★ "검토 대기" 라고 적힌 계약서에 서명을 받으면, 나중에
 *   "그때 확정도 안 된 걸 내밀었느냐" 가 됩니다. */
CREATE OR REPLACE VIEW v_contract_draft_marks AS
SELECT code, version,
       CASE WHEN body LIKE '%검토 대기%' THEN '검토 대기 표시'
            WHEN body LIKE '%TBD%'      THEN 'TBD'
            WHEN body ~ '〔[^〕]*〕'     THEN '빈칸 자리표시자'
            ELSE '기타' END AS mark
  FROM contract_templates
 WHERE is_active
   AND version NOT LIKE '%draft%'
   AND version NOT LIKE '%blocked%'
   AND (body LIKE '%검토 대기%' OR body LIKE '%TBD%' OR body ~ '〔[^〕]*〕');

COMMENT ON VIEW v_contract_draft_marks IS
  '쓰이고 있는 계약 양식에 남은 미확정 표시. **0이어야 합니다** — '
  '"검토 대기" 라고 적힌 계약서에 서명을 받으면 나중에 문제가 됩니다.';
-- ── A-07 소유자 직거래 개방 (C840) ─────────────────────────────────
--
-- ── 사장님 결정 (2026-09-18) ────────────────────────────────────────
--   부동산 등록은 **둘만** 가능합니다.
--     ① 공인중개사 인증을 받은 사람 — 공인중개사 배지
--     ② 본인 소유 물건을 올리는 소유자 — 등기로 확인 후
--   화면에는 갈라 적습니다.
--
-- ── 이미 다 만들어져 있었습니다 ─────────────────────────────────────
--   `fn_broker_gate` 가 정확히 이 구조입니다. 막고 있던 것은
--   `mal.owner_direct_ready` **스위치 하나**였습니다.
--
--   새 트리거를 만들 뻔했는데, 그러면 같은 일을 두 곳이 하게 되고
--   한쪽만 고치면 어긋납니다.

UPDATE site_settings SET
  value = 'on',
  description = '소유자 직거래 게이트. 켜면 등기사항증명서로 소유 확인을 마친 '
                '매물에 한해 소유자가 직접 올릴 수 있습니다. '
                '**자기 물건을 파는 것은 중개가 아닙니다** — 다만 남의 집을 '
                '자기 것이라 하고 올리면 무허가 중개가 되므로 확인이 먼저입니다. '
                'A-07 결정 2026-09-18.'
WHERE key = 'mal.owner_direct_ready';

/* 부동산 양식 잠금 해제 */
UPDATE contract_templates SET
  version = '1.0',
  note = 'A-07 결정으로 개방 (2026-09-18) — 중개사 인증 또는 소유 확인 필수. '
         || coalesce(note, '')
WHERE code = 'REALTY_STD';

-- ── 화면에 갈라 적습니다 ────────────────────────────────────────────
--
-- ★ 섞이면 이용자가 **"중개사가 확인한 물건"** 으로 오해합니다.
--   중개사 매물은 중개사가 책임지지만, 직거래는 아무도 확인해
--   주지 않습니다. 그 차이를 이용자가 알아야 합니다.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS seller_kind text;

COMMENT ON COLUMN listings.seller_kind IS
  '부동산 매물을 누가 올렸나. BROKER(공인중개사) · OWNER(소유자 직접). '
  '**화면에 갈라 적습니다** — 섞이면 "중개사가 확인한 물건" 으로 오해합니다.';

DO $$ BEGIN
  ALTER TABLE listings ADD CONSTRAINT listings_seller_kind_check
    CHECK (seller_kind IS NULL OR seller_kind IN ('BROKER','OWNER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* 등록될 때 구분을 자동으로 붙입니다.
 *
 * ★ 사람이 고르게 하면 잘못 고릅니다. **중개사 배지가 있으면
 *   BROKER, 없으면 OWNER** 로 시스템이 정합니다. */
CREATE OR REPLACE FUNCTION fn_realty_mark_kind() RETURNS trigger AS $$
DECLARE v_is_realty boolean;
BEGIN
  IF NEW.gwan_code <> 'MAL' THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM categories c
     WHERE c.id = NEW.category_id
       AND (c.name LIKE '%부동산%' OR c.name LIKE '%상가%' OR c.name LIKE '%건물%'
         OR c.name LIKE '%토지%'  OR c.name LIKE '%점포%' OR c.name LIKE '%사무실%')
  ) INTO v_is_realty;
  IF NOT v_is_realty THEN RETURN NEW; END IF;

  NEW.seller_kind := CASE
    WHEN fn_is_verified_broker(NEW.owner_account_id) THEN 'BROKER'
    ELSE 'OWNER' END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_realty_mark_kind ON listings;
/* ★ fn_broker_gate 보다 **먼저** 돌아야 합니다 — 이름이 앞서야
 *   같은 BEFORE 단계에서 먼저 실행됩니다(알파벳 순). */
CREATE TRIGGER trg_aa_realty_mark_kind BEFORE INSERT OR UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION fn_realty_mark_kind();

-- ── 감시 ───────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_realty_unmarked AS
SELECT l.id, l.title, l.owner_account_id, l.created_at
  FROM listings l
  JOIN categories c ON c.id = l.category_id
 WHERE l.gwan_code = 'MAL'
   AND (c.name LIKE '%부동산%' OR c.name LIKE '%상가%' OR c.name LIKE '%건물%'
     OR c.name LIKE '%토지%'  OR c.name LIKE '%점포%' OR c.name LIKE '%사무실%')
   AND l.seller_kind IS NULL
   AND l.status <> 'DELETED';

COMMENT ON VIEW v_realty_unmarked IS
  '구분 없이 올라간 부동산 매물. **0이어야 합니다** — 중개사 매물인지 '
  '직거래인지 모르면 이용자가 "중개사가 확인한 물건" 으로 오해합니다.';

CREATE OR REPLACE VIEW v_realty_broker_unverified AS
SELECT l.id, l.title, l.owner_account_id
  FROM listings l
 WHERE l.seller_kind = 'BROKER'
   AND l.status <> 'DELETED'
   AND NOT fn_is_verified_broker(l.owner_account_id);

COMMENT ON VIEW v_realty_broker_unverified IS
  '중개사 인증 없이 중개사 매물로 표시된 것. **0이어야 합니다** — '
  '인증이 나중에 취소되면 여기 잡힙니다.';
-- ── 부동산 게이트 — 공개할 때만 걸립니다 (C841) ────────────────────
--
-- ★ **닭과 달걀이었습니다.** 등기 확인은 매물에 붙는데(owner_verifications
--   .listing_id), 매물 등록이 먼저 막혀 확인을 붙일 수가 없었습니다.
--
--   초안은 통과시키고 **공개할 때** 확인합니다.
--     DRAFT      누구나 만듭니다 — 아직 아무에게도 안 보입니다
--     PUBLISHED  중개사 인증 또는 등기 확인이 있어야 합니다
--
--   이것이 자연스러운 순서입니다 — 올려 두고, 확인받고, 공개합니다.
CREATE OR REPLACE FUNCTION fn_broker_gate() RETURNS trigger AS $$
DECLARE v_owner_ok boolean; v_ready text;
BEGIN
  IF NEW.gwan_code <> 'MAL' THEN RETURN NEW; END IF;

  /* ★ 초안은 통과합니다. 아직 아무에게도 안 보이므로 표시·광고가
   *   아닙니다 — 공인중개사법이 막는 것은 **표시·광고**입니다. */
  IF NEW.status <> 'PUBLISHED' THEN RETURN NEW; END IF;

  /* 중개사 인증이 있으면 통과 */
  IF fn_is_verified_broker(NEW.owner_account_id) THEN RETURN NEW; END IF;

  /* 소유자 직거래 — 등기로 확인한 매물만 */
  SELECT value INTO v_ready FROM site_settings WHERE key = 'mal.owner_direct_ready';
  IF coalesce(v_ready, 'off') = 'on' THEN
    SELECT EXISTS (SELECT 1 FROM owner_verifications o
                    WHERE o.listing_id = NEW.id AND o.state = 'VERIFIED')
      INTO v_owner_ok;
    IF v_owner_ok THEN RETURN NEW; END IF;

    RAISE EXCEPTION
      'BROKER: 소유 확인이 먼저입니다 — 등기사항증명서를 올리시면 확인 후 공개됩니다';
  END IF;

  RAISE EXCEPTION
    'BROKER: 부동산 소개는 중개사 인증이 필요합니다 (공인중개사법 18조의2 ③) — '
    '본인 소유 물건은 등기 확인 후 올리실 수 있습니다';
END $$ LANGUAGE plpgsql;
/* ★ 제가 만든 `trg_realty_guard` 를 지웁니다.
 *
 *   `fn_broker_gate` 가 이미 같은 일을 합니다 — 같은 일을 두 곳이
 *   하면 한쪽만 고칠 때 어긋나고, 실제로 어긋났습니다. */
DROP TRIGGER IF EXISTS trg_realty_guard ON listings;
DROP FUNCTION IF EXISTS fn_realty_guard();

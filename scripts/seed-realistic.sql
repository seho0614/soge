-- =====================================================================
-- 광고 플랫폼 — 실제 같은 시드
--
-- 숫자를 채우는 것이 목적이 아닙니다. **슬롯별 성격이 숫자에
-- 드러나야** 단가를 정할 때 쓸 수 있습니다.
--
--   인피드  노출 많고 CTR 낮음   스크롤하다 스쳐 지나갑니다
--   상세하단 노출 적고 CTR 높음   다 보고 "더 볼까" 하는 자리
--
-- 그림은 넣지 않습니다 — image_key 에 경로 문자열만 둡니다.
-- 용량만 키우고 아무것도 검증하지 못합니다.
--
-- ★ 광고주명에 (시드)를 붙입니다. 실계약이 들어오면 이 행을
--   지우십시오 — 섞이면 단가를 잘못 매깁니다.
-- =====================================================================

BEGIN;

DELETE FROM ad_events WHERE creative_id IN
  (SELECT id FROM ad_creatives WHERE advertiser LIKE '%(시드)%');
DELETE FROM ad_bookings WHERE advertiser_id IN
  (SELECT id FROM advertisers WHERE name LIKE '%(시드)%');
DELETE FROM ad_creatives WHERE advertiser LIKE '%(시드)%';
DELETE FROM advertisers WHERE name LIKE '%(시드)%';

-- ── 슬롯 ───────────────────────────────────────────────────────────
INSERT INTO ad_slots (code, name, placement, width, height, in_ranking, spec) VALUES
 ('HERO',  '메인 상단',    '메인',      780, 421, false, '{"note":"성향별 소재"}'),
 ('ENTRY', '진입 전면',    '메인 진입', 560, 360, false, '{"cap":"하루 1회"}'),
 ('FLOAT', '우측 하단',    '전역',      300, 120, false, '{"cap":"세션 1회"}'),
 ('RECS',  '추천 상단',    '추천 목록', NULL, NULL, false, '{"label":"광고"}'),
 ('INFEED','목록 인피드',  '관 목록',   360, 270, false, '{"label":"광고","every":8,"maxPerView":3}'),
 ('GHERO', '관 랜딩 상단', '관 랜딩',   780, 421, false, '{"note":"관 이동마다"}'),
 ('DTAIL', '상세 하단',    '상세',      680, 200, false, '{"note":"끝까지 본 사람"}')
ON CONFLICT (code) DO UPDATE SET spec = EXCLUDED.spec;

-- ── 상품 ───────────────────────────────────────────────────────────
-- 단가는 0 입니다. 3주 실측 전에는 정할 수 없습니다.
INSERT INTO ad_products (slot_code, period_unit, list_price, is_intro_price, note)
SELECT code, 'WEEK', 0, true, '도입가 미정 — 3주 실측 후 산정'
  FROM ad_slots
 WHERE NOT EXISTS (SELECT 1 FROM ad_products p WHERE p.slot_code = ad_slots.code);

-- ── 광고주 ─────────────────────────────────────────────────────────
INSERT INTO advertisers (biz_id, name, verified_at) VALUES
 ('aaaa0001-0000-4000-a000-000000000001','대한풀필먼트 (시드)',   now()),
 ('aaaa0002-0000-4000-a000-000000000002','현장인테리어 (시드)',   now()),
 ('aaaa0003-0000-4000-a000-000000000003','한빛프랜차이즈 (시드)', now()),
 ('aaaa0004-0000-4000-a000-000000000004','세바코리아 (시드)',     now()),
 ('aaaa0005-0000-4000-a000-000000000005','클릭웍스 (시드)',       now()),
 ('aaaa0006-0000-4000-a000-000000000006','정도세무법인 (시드)',   now()),
 ('aaaa0007-0000-4000-a000-000000000007','안심보증 (시드)',       now()),
 ('aaaa0008-0000-4000-a000-000000000008','바른의료기 (시드)',     now());

-- ── 소재 ───────────────────────────────────────────────────────────
-- 실제로 쓸 법한 문구입니다. "최고" "1위" 같은 표현은 넣지 않습니다 —
-- 표시광고법에 걸리는 소재를 시드에 두면 그걸 보고 따라 씁니다.
INSERT INTO ad_creatives
 (code, slot_code, advertiser_id, advertiser, category, title, body, cta,
  landing_url, image_key, segments, status, is_regulated, review_no,
  review_confirmed_at, starts_at, ends_at, impressions, clicks)
SELECT v.code, v.slot, a.id, a.name, v.cat, v.title, v.body, v.cta,
       v.url, v.img, v.seg, v.st, v.reg, v.rno,
       CASE WHEN v.rno IS NULL THEN NULL ELSE now() END,
       current_date - 30, current_date + 60, v.imp, v.clk
  FROM (VALUES
   ('SD-101','INFEED','물류','월 3,000박스부터 3PL 단가 협상',
    '보관 · 피킹 · 배송을 한 곳에서. 물량에 따라 단가가 내려갑니다.',
    '단가표 받기','/money','ads/sd101.jpg',ARRAY['SEG-C'],'ACTIVE',false,NULL,
    14820, 385, '대한풀필먼트 (시드)'),
   ('SD-102','INFEED','시공','상가 인테리어 견적 3곳 비교',
    '평수와 업종만 알려주시면 시공사 3곳 견적을 한 번에 받습니다.',
    '견적 비교','/money','ads/sd102.jpg',ARRAY['SEG-D'],'ACTIVE',false,NULL,
    12460, 402, '현장인테리어 (시드)'),
   ('SD-103','INFEED','창업','가맹 상담 전에 점포부터 보십시오',
    '상권 분석과 예상 매출을 먼저 확인하고 결정하십시오.',
    '상권 보기','/biz','ads/sd103.jpg',ARRAY['SEG-B'],'ACTIVE',false,NULL,
    9870, 241, '한빛프랜차이즈 (시드)'),
   ('SD-201','GHERO','에너지','지붕만 빌려주면 임대 수익으로 돌아옵니다',
    '공장 · 창고 지붕 1,000평 이상이면 설치비 0원. 20년 임대료를 먼저 계산해 드립니다.',
    '수익 계산','/money','ads/sd201.jpg',ARRAY['SEG-F'],'ACTIVE',false,NULL,
    6240, 268, '세바코리아 (시드)'),
   ('SD-202','GHERO','IT · 마케팅','홈페이지 없이 견적 문의만 받는 방법',
    '상담 페이지 하나로 문의를 받고, 응대는 메신저로 이어집니다.',
    '사례 보기','/biz','ads/sd202.jpg',ARRAY['SEG-E'],'ACTIVE',false,NULL,
    4910, 152, '클릭웍스 (시드)'),
   ('SD-301','DTAIL','세무','창업 첫 해 세금, 미리 계산해 드립니다',
    '업종과 예상 매출만 알려주시면 1년 치 세금을 미리 보여 드립니다.',
    '예상 세액','/biz','ads/sd301.jpg',ARRAY['SEG-B'],'ACTIVE',false,NULL,
    2180, 131, '정도세무법인 (시드)'),
   ('SD-302','DTAIL','금융','계약 전에 상대 회사 재무를 확인하십시오',
    '사업자번호만 있으면 휴폐업 · 체납 · 소송 이력을 한 번에 봅니다.',
    '조회하기','/money','ads/sd302.jpg',ARRAY['SEG-A'],'ACTIVE',false,NULL,
    1740, 96, '안심보증 (시드)'),
   ('SD-401','HERO','물류','물류비가 매출보다 빨리 오르고 있다면',
    '보관과 배송을 나눠 맡기면 고정비가 줄어듭니다. 물량 기준 견적 드립니다.',
    '견적 받기','/money','ads/sd401.jpg',ARRAY['SEG-C','SEG-A'],'ACTIVE',false,NULL,
    18420, 613, '대한풀필먼트 (시드)'),
   ('SD-402','ENTRY','창업','점포 계약 전에 꼭 보셔야 할 것',
    '권리금 · 인허가 승계 · 상권 변화. 세 가지만 확인해도 실패가 줄어듭니다.',
    '확인하기','/biz','ads/sd402.jpg',ARRAY['SEG-B'],'ACTIVE',false,NULL,
    3200, 108, '한빛프랜차이즈 (시드)'),
   ('SD-403','FLOAT','시공','시공 견적, 3곳 비교가 기본입니다',
    '한 곳만 받으면 비싼지 싼지 알 수 없습니다.',
    '견적 비교','/money','ads/sd403.jpg',ARRAY['SEG-D'],'ACTIVE',false,NULL,
    2850, 74, '현장인테리어 (시드)'),
   ('SD-404','RECS','세무','세무 상담, 창업 전에 받으십시오',
    '업종에 따라 세금이 크게 달라집니다.',
    '상담 신청','/biz','ads/sd404.jpg',ARRAY['SEG-B'],'ACTIVE',false,NULL,
    1420, 57, '정도세무법인 (시드)'),
   /* ★ 심의 대상 — 번호 없이 ACTIVE 로 두면 트리거가 막습니다.
        DRAFT 로 넣어 "심의 대기" 상태를 시험합니다. */
   ('SD-501','HERO','의료기기','가정용 혈압계 · 정확한 측정이 먼저입니다',
    '식약처 인증 제품입니다. 사용법 안내를 함께 드립니다.',
    '자세히','/health','ads/sd501.jpg',ARRAY['SEG-A'],'DRAFT',true,NULL,
    0, 0, '바른의료기 (시드)')
  ) AS v(code, slot, cat, title, body, cta, url, img, seg, st, reg, rno, imp, clk, adv)
  JOIN advertisers a ON a.name = v.adv;

-- ── 예약 ───────────────────────────────────────────────────────────
-- 같은 자리를 같은 기간에 두 번 팔 수 없습니다(EXCLUDE).
INSERT INTO ad_bookings (slot_code, product_id, advertiser_id, period, amount, is_precontract)
SELECT s.code, p.id, a.id,
       daterange(current_date, current_date + 30, '[)'),
       0, true
  FROM (VALUES ('INFEED','대한풀필먼트 (시드)'),
               ('GHERO', '세바코리아 (시드)'),
               ('DTAIL', '정도세무법인 (시드)')) AS s(code, adv)
  JOIN advertisers a ON a.name = s.adv
  JOIN ad_products p ON p.slot_code = s.code AND p.is_active
 WHERE NOT EXISTS (
   SELECT 1 FROM ad_bookings b
    WHERE b.slot_code = s.code AND b.period && daterange(current_date, current_date + 30, '[)'));

COMMIT;

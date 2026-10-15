-- ★ 개발 · 시연용(v10.31 w2) — 운영 DB 에 넣지 마십시오.
--   소개창업 축(인력 · 운영지원 · 정보)의 시연 항목과 급구 · 급매 시연 표시를 넣습니다. 모든 항목은 is_sample = true(화면에 「시연용」)이고,
--   글은 시안(SGB_Prototype_v10_30 · AXI)의 견본 그대로입니다. 날짜는 오늘 기준으로 계산합니다.
--   다시 넣으면 시연 항목을 지우고 새로 넣습니다(실제 항목은 건드리지 않음).
--   사용: psql "$DATABASE_URL" -f scripts/seed-w2-demo.sql
--   개발 계정 시드(인증 사업자 · admin@x.com)가 먼저 있어야 합니다 — 없으면(갓 만든 DB) 아무것도 넣지 않고 끝냅니다.
SELECT (EXISTS (SELECT 1 FROM businesses WHERE verified_at IS NOT NULL)
        AND EXISTS (SELECT 1 FROM accounts WHERE email = 'admin@x.com')) AS w2_seed_ok \gset
\if :w2_seed_ok
BEGIN;
DELETE FROM biz_axis_items WHERE is_sample;

WITH biz AS (SELECT b.id, b.account_id FROM businesses b WHERE b.verified_at IS NOT NULL ORDER BY b.created_at LIMIT 1),
adm AS (SELECT a.id FROM accounts a WHERE a.email = 'admin@x.com' LIMIT 1),
d AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS t)
INSERT INTO biz_axis_items (item_no, kind, badge, is_hot, title, price_text, cond_text, sub_text, description, spec, org, region_text,
                            headcount, period_text, due_date, contract_type, source_title, source_org, source_scale, source_url, source_rows,
                            owner_account_id, business_id, is_sample)
SELECT x.no, x.kind, x.badge, x.hot, x.title, x.price, x.cond, x.sub, x.descr, x.spec::jsonb, x.org, x.region, x.hc, x.period,
       CASE WHEN x.due IS NULL THEN NULL ELSE (SELECT t FROM d) + x.due END,
       CASE WHEN x.kind = 'JOB' THEN 'OUTSOURCE' END, x.stitle, x.sorg, x.sscale, NULL, coalesce(x.srows, '[]')::jsonb,
       CASE WHEN x.kind IN ('JOB','SVC') THEN (SELECT account_id FROM biz) ELSE (SELECT id FROM adm) END,
       CASE WHEN x.kind IN ('JOB','SVC') THEN (SELECT id FROM biz) END, true
  FROM (VALUES
    (9101,'JOB','정규',false,'주방장 (한식) — 경기 남부 프랜차이즈 직영점','월 420~480만원','경력 5년 이상','경기 남부 · 1명 · 경력 5년 이상',
     '프랜차이즈 직영점의 한식 주방을 맡을 주방장을 찾는 공고입니다. 헤드헌팅사 · 인력대행업체를 통해 진행합니다.',
     '[["구분","정규"],["업무","한식 주방 총괄 · 조리 인력 관리"],["근무지","경기 남부 (직영점)"],["인원","1명"],["기간","정규"],["대금","월 420~480만원"],["조건","경력 5년 이상"],["마감","충원 시 마감"]]',
     NULL,'경기 남부',1,'정규',NULL::int,NULL,NULL,NULL,NULL),
    (9102,'JOB','초단기',true,'물류센터 상하차 일용 12명 — 하루','일 132,000원','D-2 마감','수도권 물류센터 · 12명 · 하루',
     '물류센터 상하차 일감을 하루 맡을 업체를 찾는 공고입니다. 도급으로만 잇습니다.',
     '[["구분","초단기"],["업무","상하차 · 분류 보조"],["근무지","수도권 물류센터"],["인원","12명"],["대금","일 132,000원"],["마감","D-2 마감"]]',
     NULL,'수도권',12,'하루',2,NULL,NULL,NULL,NULL),
    (9103,'JOB','초단기',true,'행사 진행 보조 6명 — 2일','일 110,000원','D-8 마감','행사장 · 6명 · 2일',
     '행사 진행을 도울 일감을 이틀 맡을 업체를 찾는 공고입니다. 도급으로만 잇습니다.',
     '[["구분","초단기"],["업무","행사장 안내 · 진행 보조"],["근무지","행사장 (요청 접수 뒤 안내)"],["인원","6명"],["대금","일 110,000원"],["마감","D-8 마감"]]',
     NULL,'행사장',6,'2일',8,NULL,NULL,NULL,NULL),
    (9104,'JOB','정규',false,'편의점 다점포 SV (수도권 8개점)','연 4,200만원','경력 3년 이상','수도권 8개점 · 1명 · 경력 3년 이상',
     '편의점 8개 점포를 맡아 관리할 슈퍼바이저를 찾는 공고입니다. 헤드헌팅사 · 인력대행업체를 통해 진행합니다.',
     '[["구분","정규"],["업무","8개 점포 순회 관리 · 발주 · 인력 배치"],["근무지","수도권 (8개점)"],["인원","1명"],["대금","연 4,200만원"],["조건","경력 3년 이상"],["마감","충원 시 마감"]]',
     NULL,'수도권',1,'정규',NULL,NULL,NULL,NULL,NULL),
    (9201,'SVC','창업컨설팅',false,'프랜차이즈 출점 타당성 검토','건당 150만원~','점포 입지 · 손익 추정 · 계약 검토','점포 입지 · 손익 추정 · 계약 검토',
     '프랜차이즈 출점 타당성 검토 자문 서비스입니다. 견적을 요청하면 조건에 맞는 컨설턴트를 이어 드리고, 계약은 당사자끼리 맺습니다.',
     '[["구분","창업컨설팅"],["서비스 범위","점포 입지 · 손익 추정 · 계약 검토"],["요금","건당 150만원~"],["진행 방식","견적 요청 → 매칭 → 계약"],["기간","2~3주"],["결과물","입지 · 손익 검토 보고서"]]',
     NULL,NULL,NULL,'2~3주',NULL,NULL,NULL,NULL,NULL),
    (9202,'SVC','창업컨설팅',false,'업종 전환 · 사업 재설계','월 80만원~','3개월 단위 동행','3개월 단위 동행',
     '업종 전환 · 사업 재설계 자문 서비스입니다. 견적을 요청하면 조건에 맞는 컨설턴트를 이어 드리고, 계약은 당사자끼리 맺습니다.',
     '[["구분","창업컨설팅"],["서비스 범위","3개월 단위 동행"],["요금","월 80만원~"],["진행 방식","견적 요청 → 매칭 → 계약"],["기간","3개월 단위"],["결과물","전환 계획 · 월별 점검"]]',
     NULL,NULL,NULL,'3개월 단위',NULL,NULL,NULL,NULL,NULL),
    (9203,'SVC','회사운영',false,'세무 · 노무 기장 대리','월 15만원~','창업 1년 미만 전용 요율','창업 1년 미만 전용 요율',
     '세무 · 노무 기장 대리 자문 서비스입니다. 견적을 요청하면 조건에 맞는 컨설턴트를 이어 드리고, 계약은 당사자끼리 맺습니다.',
     '[["구분","회사운영"],["서비스 범위","창업 1년 미만 전용 요율"],["요금","월 15만원~"],["진행 방식","견적 요청 → 매칭 → 계약"],["기간","월 단위 계약"],["결과물","월 기장 · 신고 대리"]]',
     NULL,NULL,NULL,'월 단위 계약',NULL,NULL,NULL,NULL,NULL),
    (9204,'SVC','회사운영',false,'온라인 마케팅 대행','월 90만원~','검색 · 지도 · 리뷰 관리','검색 · 지도 · 리뷰 관리',
     '온라인 마케팅 대행 자문 서비스입니다. 견적을 요청하면 조건에 맞는 컨설턴트를 이어 드리고, 계약은 당사자끼리 맺습니다.',
     '[["구분","회사운영"],["서비스 범위","검색 · 지도 · 리뷰 관리"],["요금","월 90만원~"],["진행 방식","견적 요청 → 매칭 → 계약"],["기간","월 단위 계약"],["결과물","월간 운영 보고"]]',
     NULL,NULL,NULL,'월 단위 계약',NULL,NULL,NULL,NULL,NULL),
    (9301,'POL','정책',false,'소상공인 창업 초기자금 (시연용 견본)','최대 7,000만원 · 연 2.5%',NULL,'중소벤처기업부 · 시연용 견본',
     '중소벤처기업부의 지원사업 「소상공인 창업 초기자금」을 소개하는 자리입니다(시연용 견본 — 실제 공고가 아닙니다). 신청은 주관 기관에서 받습니다.',
     '[["구분","정책"],["주관 기관","중소벤처기업부"],["지원 한도","최대 7,000만원 · 연 2.5%"],["지원 대상","창업 초기 소상공인 (견본)"],["신청 방법","주관 기관 누리집에서 신청"]]',
     '중소벤처기업부',NULL,NULL,NULL,8,'소상공인 창업 초기자금 (시연용 견본)','중소벤처기업부','최대 7,000만원 · 연 2.5%',
     '[["지원 대상","창업 초기 소상공인 (견본)"],["지원 내용","운영 · 시설 자금 융자 (견본)"],["신청 방법","주관 기관 누리집"]]'),
    (9302,'POL','정책',false,'청년 창업 사업화 지원 (시연용 견본)','최대 5,000만원',NULL,'창업진흥원 · 시연용 견본',
     '창업진흥원의 지원사업 「청년 창업 사업화 지원」을 소개하는 자리입니다(시연용 견본). 신청은 주관 기관에서 받습니다.',
     '[["구분","정책"],["주관 기관","창업진흥원"],["지원 한도","최대 5,000만원"],["지원 대상","청년 예비 · 초기 창업자 (견본)"]]',
     '창업진흥원',NULL,NULL,NULL,23,'청년 창업 사업화 지원 (시연용 견본)','창업진흥원','최대 5,000만원',
     '[["지원 대상","청년 예비 · 초기 창업자 (견본)"],["지원 내용","사업화 자금 · 교육 (견본)"]]'),
    (9303,'POL','정책',false,'경기도 소상공인 시설개선 보조 (시연용 견본)','최대 1,000만원 (자부담 30%)',NULL,'경기도 · 시연용 견본',
     '경기도의 지원사업 「소상공인 시설개선 보조」를 소개하는 자리입니다(시연용 견본). 신청은 주관 기관에서 받습니다.',
     '[["구분","정책"],["주관 기관","경기도"],["지원 한도","최대 1,000만원 (자부담 30%)"],["지원 대상","경기도 내 소상공인 (견본)"]]',
     '경기도',NULL,NULL,NULL,44,'경기도 소상공인 시설개선 보조 (시연용 견본)','경기도','최대 1,000만원 (자부담 30%)',
     '[["지원 대상","경기도 내 소상공인 (견본)"],["지원 내용","간판 · 인테리어 · 설비 개선 비용 보조 (견본)"]]'),
    (9401,'EDU','강의',false,'처음 창업하는 사람을 위한 계약서 읽기','무료','4주 · 온라인','4주 · 온라인 · 선착순 40명',
     '「처음 창업하는 사람을 위한 계약서 읽기」 과정입니다. 수강 신청은 제휴 기관에서 받습니다.',
     '[["구분","강의"],["기간 · 방식","4주 · 온라인"],["수강료","무료"],["정원","선착순 40명"],["과정 내용","임대차 · 가맹 · 권리금 계약서 읽는 법"],["운영","제휴 기관 (연동 전)"]]',
     NULL,NULL,40,'4주 · 온라인',NULL,NULL,NULL,NULL,NULL),
    (9402,'EDU','강의',false,'권리금 · 인수 실사 실무','12만원','2주 · 오프라인(서울)','2주 · 오프라인(서울) · 정원 20명',
     '「권리금 · 인수 실사 실무」 과정입니다. 수강 신청은 제휴 기관에서 받습니다.',
     '[["구분","강의"],["기간 · 방식","2주 · 오프라인(서울)"],["수강료","12만원"],["정원","정원 20명"],["과정 내용","권리금 산정 · 매출 자료 확인 · 인수 계약 점검"],["운영","제휴 기관 (연동 전)"]]',
     NULL,NULL,20,'2주 · 오프라인(서울)',NULL,NULL,NULL,NULL,NULL),
    (9403,'EDU','강의',false,'프랜차이즈 가맹 전 확인할 7가지','무료','1일 특강','1일 특강 · 상시',
     '「프랜차이즈 가맹 전 확인할 7가지」 과정입니다. 수강 신청은 제휴 기관에서 받습니다.',
     '[["구분","강의"],["기간 · 방식","1일 특강"],["수강료","무료"],["정원","상시"],["과정 내용","정보공개서 · 가맹금 · 영업 지역 등 7가지 확인 항목"],["운영","제휴 기관 (연동 전)"]]',
     NULL,NULL,NULL,'1일 특강',NULL,NULL,NULL,NULL,NULL)
  ) x(no, kind, badge, hot, title, price, cond, sub, descr, spec, org, region, hc, period, due, stitle, sorg, sscale, srows)
ON CONFLICT (item_no) DO NOTHING;
SELECT setval('public.biz_axis_item_no_seq', greatest(9500, (SELECT max(item_no) FROM biz_axis_items)));

/* 급구 · 급매 시연 표시 — 게시 중인 소개장터 매물 두 건(사유에 「시연용」) */
DELETE FROM listing_badges WHERE urgent_reason LIKE '시연용%';
WITH l AS (SELECT id, owner_account_id, row_number() OVER (ORDER BY published_at DESC) AS n
             FROM listings WHERE gwan_code = 'MNY' AND status = 'PUBLISHED' AND NOT is_priority_exposed LIMIT 2)
INSERT INTO listing_badges (listing_id, badge_type, urgent_reason, valid_until, requested_by)
SELECT id, CASE WHEN n = 1 THEN 'URGENT' ELSE 'URGENT_SALE' END, '시연용 — 급구 · 급매 화면 확인', now() + interval '5 days', owner_account_id FROM l;
UPDATE listing_badges SET status = 'GRANTED', decided_at = now(), decided_by = (SELECT id FROM accounts WHERE email = 'admin@x.com')
 WHERE urgent_reason LIKE '시연용%';
COMMIT;
\else
\echo 'seed-w2-demo: 인증 사업자 · admin@x.com 이 없어 건너뜁니다(개발 계정 시드를 먼저 넣으십시오).'
\endif

-- =====================================================================
-- hdx_ · v10.623 (docs/766) 운영 화면 「?」 도움말에 옛 탭(v10.456 이전) 설명 넣기 — 대표 11/22 승인(다음 개발 ③)
--   v10.616(D302 · docs/758)이 새 탭 124개를 넣은 뒤에도 절이 없던 탭 119개의 절을 운영 화면 도움말(help_docs ADMIN_GUIDE)에
--   **새 판으로** 더하고 탭 → 절 잇기(sec2_tab_help)를 넣음. 표 · 함수 · 트리거 · 설정을 새로 만들지 않음.
--   절 글 = 그 탭 머리글 설명(web/src/lib/adminMenu.ts PAGE sub · 화면에 보이는 글 그대로) + 보는 역할(web/src/App.tsx TAB_ROLES · SUPER_ONLY · 세무사 읽기 규칙).
--   ⓪ 본문 한도: ADMIN_GUIDE 만 2만 → 4만 자(USER_MANUAL 은 2만 그대로 · AI 상담이 읽는 것은 USER_MANUAL 뿐) — 서버 저장 한도(sec2 tab-help MAX)도 같이 4만.
--      D180 의 열 CHECK(char_length(body) BETWEEN 100 AND 20000)를 지우고 종류별 한도 CHECK(help_docs_body_len) 하나로 바꿈 · 이미 있으면 건너뜀.
--   ① 지금 판 본문에 「[탭 키]」가 이미 있는 절은 건너뜀(SUPER 가 먼저 쓴 절 · 다시 돌린 경우) — 지금 판을 고치지 않고 끝에 붙인 새 판만(쌓기만)
--   ② 4만 자를 넘지 않게 앞에서부터 들어가는 절만 붙임(2판 그대로면 모두 들어감)
--   ③ 잇기는 지금 판에 그 제목 줄이 있는 탭만 · 이미 이은 탭(SUPER 가 바꾼 것)은 그대로(ON CONFLICT DO NOTHING)
--   D302(ADMIN_GUIDE 2판) 뒤에 돌아야 함.
-- =====================================================================

DO $do$
DECLARE c text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.help_docs'::regclass AND conname = 'help_docs_body_len') THEN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'public.help_docs'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%char_length(body)%'
    LOOP
      EXECUTE format('ALTER TABLE public.help_docs DROP CONSTRAINT %I', c);
    END LOOP;
    ALTER TABLE public.help_docs ADD CONSTRAINT help_docs_body_len
      CHECK (char_length(body) >= 100 AND char_length(body) <= CASE WHEN code = 'ADMIN_GUIDE' THEN 40000 ELSE 20000 END);
  END IF;
END
$do$;

WITH add_rows(ord, grp, tab_key, heading, body) AS (VALUES
  (1, '16. 보고 — 기본 탭', 'rpt-day', '일보 [rpt-day]', $hdx$- 하루(한국 날짜) 회원 · 거래 · 소개몰 · 매출 · 고객센터 · 운영 알림 · 회계 할 일 · 업무 일지를 숫자로 한 장 — 매일 07:00 전날 것을 남김.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (2, '16. 보고 — 기본 탭', 'rpt-week', '주보 [rpt-week]', $hdx$- 월요일 ~ 일요일 합계와 지난주 대비 증감 · 상위 5 — 월요일 07:00 지난주 것을 남김.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (3, '16. 보고 — 기본 탭', 'rpt-month', '월보 [rpt-month]', $hdx$- 1일 ~ 말일 합계와 지난달 대비 증감 · 상위 5 — 1일 07:00 지난달 것을 남김.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (4, '16. 보고 — 기본 탭', 'rpt-worklog', '업무 일지 [rpt-worklog]', $hdx$- 운영자가 오늘 한 일 · 할 일 · 막힌 것을 남김(고치기 없음 · 덧붙임만) — SUPER 가 확인 · 한 줄 답.
- 보는 역할: ADMIN · PAYOUT · REVIEWER · PARTNER_MAL · PARTNER_AFF · SUPER.$hdx$),
  (5, '16. 보고 — 기본 탭', 'rpt-board', '일지 현황판 [rpt-board]', $hdx$- 오늘 운영자마다 쓴 일지 · 안 쓴 사람 · 최근 7일 작성률 · 막힌 것 · 확인 안 한 일지(SUPER).
- 보는 역할: SUPER 만.$hdx$),
  (6, '16. 보고 — 기본 탭', 'rpt-trend', '추세 [rpt-trend]', $hdx$- 12달 · 13주 동안 매출 · 이익 · 현금 · 가입 · 소개몰 결제를 그래프로 — 전표 · 일보와 같은 셈입니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (7, '17. 사무 — 기본 탭', 'approvals', '결재함 [approvals]', $hdx$- 내 결재 차례인 품의 · 경비 청구 · 수동 전표입니다 — 중간 단계는 여기서, 마지막(SUPER) 단계는 각 화면에서 승인 · 반려합니다.
- 보는 역할: ADMIN · PAYOUT · REVIEWER · PARTNER_MAL · PARTNER_AFF · SUPER.$hdx$),
  (8, '17. 사무 — 기본 탭', 'approval-lines', '결재선 [approval-lines]', $hdx$- 종류(품의 · 경비 청구 · 수동 전표)마다 금액 구간별 결재 단계(역할 또는 사람 · 마지막은 SUPER) — 없으면 SUPER 한 번.
- 보는 역할: ADMIN · PAYOUT · REVIEWER · PARTNER_MAL · PARTNER_AFF · SUPER.$hdx$),
  (9, '17. 사무 — 기본 탭', 'corp-docs', '사내 문서함 [corp-docs]', $hdx$- 정관 · 등기부 · 인감 · 사업자등록 · 규정 · 인증서를 판으로 보관(지우기 없음) — 만료 30일 전부터 운영 알림.
- 보는 역할: ADMIN · PAYOUT · SUPER.$hdx$),
  (10, '18. 위험감지 — 기본 탭', 'ai-ops', 'AI 운영 [ai-ops]', $hdx$- 분류 · 검색 · 성향 · 위험감지의 품질을 보고 학습을 고칩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (11, '18. 위험감지 — 기본 탭', 'risk', '위험감지 [risk]', $hdx$- 규칙을 로그에 걸어 경보를 만듭니다. 경보마다 근거 · 규칙 원문 · 오탐 가능성을 함께 봅니다. 규칙은 숨기지 않습니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (12, '18. 위험감지 — 기본 탭', 'purge-log', '파기 기록 [purge-log]', $hdx$- 매일 03:00 개인정보 파기 작업이 지운 건수를 날짜별 · 달별로 봅니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (13, '18. 위험감지 — 기본 탭', 'server-errors', '서버 오류 [server-errors]', $hdx$- API 가 지난 1시간 보낸 서버 오류(5xx) 최근 50건 — 요청 내용 · 개인정보는 남기지 않습니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (14, '18. 위험감지 — 기본 탭', 'ops-board', '운영자 게시판 [ops-board]', $hdx$- 하루 요약 · 급한 알림 · 대표 할 일 · 시험 메시지가 텔레그램 · 슬랙 결과와 함께 저절로 올라옵니다(꺼져 있어도). 운영자끼리 글 · 댓글 · 「확인함」. 운영 화면 계정만 봅니다.
- 보는 역할: ADMIN · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF · SUPER.$hdx$),
  (15, '18. 위험감지 — 기본 탭', 'gov-audit', '감사 [gov-audit]', $hdx$- 징후를 보고 판단을 남깁니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (16, '19. 회원 — 기본 탭', 'users', '사업자 인증 [users]', $hdx$- 사업자 신청을 승인 · 반려하고 회원을 정지합니다. 승인 시각이 소개비 수령 자격의 기준일입니다 (INV-10).
- 보는 역할: ADMIN · SUPER.$hdx$),
  (17, '20. 검수 — 기본 탭', 'queue', '검수 큐 [queue]', $hdx$- SLA 24시간 기준입니다. 잔여 4시간 미만은 임박, 초과 건은 행이 강조됩니다.
- 보는 역할: ADMIN · REVIEWER · SUPER.$hdx$),
  (18, '20. 검수 — 기본 탭', 'badges', '배지 신청 [badges]', $hdx$- 신뢰 배지 신청을 봅니다. 배지는 목록 노출에 영향을 주므로 근거 없이 주면 안 됩니다.
- 보는 역할: ADMIN · REVIEWER · SUPER.$hdx$),
  (19, '20. 검수 — 기본 탭', 'audit', '표본 감사 [audit]', $hdx$- 자동 승인된 건을 표본으로 다시 봅니다. 자동검수가 놓치는 것이 있는지 확인하는 자리입니다.
- 보는 역할: ADMIN · REVIEWER · SUPER.$hdx$),
  (20, '20. 검수 — 기본 탭', 'rules', '자동검수 규칙 [rules]', $hdx$- 금칙어와 제한업종입니다. 배포 없이 바뀌지만, 잘못 넣으면 정상 등록이 반려됩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (21, '21. 인증 심사 — 기본 탭', 'ownership', '소유 확인 [ownership]', $hdx$- 등기사항증명서를 직접 보고 판단하십시오.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (22, '21. 인증 심사 — 기본 탭', 'quals', '자격 심사 [quals]', $hdx$- 자동 대조를 통과한 신청만 사람이 봅니다. 자격이 승인돼야 그 업종의 서비스 등록이 열립니다.
- 보는 역할: ADMIN · PARTNER_MAL · SUPER.$hdx$),
  (23, '22. 직원 · 권한 — 기본 탭', 'my-mfa', '내 2단계 인증 [my-mfa]', $hdx$- 휴대폰 인증 앱을 등록해 운영 화면 로그인을 한 번 더 확인합니다.
- 보는 역할: ADMIN · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF · ACCOUNTANT · SUPER.$hdx$),
  (24, '22. 직원 · 권한 — 기본 탭', 'my-password', '내 비밀번호 [my-password]', $hdx$- 운영 화면 계정의 비밀번호를 바꿉니다. 12자 이상 · 최근 3개는 다시 쓸 수 없음 · 90일마다 권함.
- 보는 역할: ADMIN · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF · ACCOUNTANT · SUPER.$hdx$),
  (25, '22. 직원 · 권한 — 기본 탭', 'perm-admin', '업무별 권한 [perm-admin]', $hdx$- 업무(탭) × 권한그룹 표 · 개인권한 · SHADOW 기록 · 판정 방식(ROLE · COMPARE · GROUPS)을 봅니다(SUPER).
- 보는 역할: SUPER 만.$hdx$),
  (26, '22. 직원 · 권한 — 기본 탭', 'staff-access', '접속 인증 [staff-access]', $hdx$- 허용 IP 밖에서 들어오면 그날 한 번 텔레그램 인증번호를 넣습니다 — 허용 IP · 받을 곳 · 기록. 허용 IP 는 Nginx 반영 스크립트로 운영 화면 접속 허용에도 씁니다(SUPER).
- 보는 역할: ADMIN · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF · SUPER.$hdx$),
  (27, '22. 직원 · 권한 — 기본 탭', 'roles', '역할 주기 [roles]', $hdx$- 역할과 가진 사람, 바뀐 이력을 봅니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (28, '23. 거래 — 기본 탭', 'disputes', '분쟁 [disputes]', $hdx$- 접수된 분쟁을 처리합니다. 분쟁이 걸린 거래는 정산이 보류됩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (29, '23. 거래 — 기본 탭', 'deals', '거래 모니터링 [deals]', $hdx$- 진행 중인 거래와 분쟁 건을 봅니다. 7일간 양측 확인이 안 된 건은 여기로 자동 승격됩니다. 관리자도 임의로 성사를 확정할 수 없습니다 (INV-4).
- 보는 역할: ADMIN · SUPER.$hdx$),
  (30, '24. 소개몰 — 기본 탭', 'hlt-sellers', '소개몰 판매자 [hlt-sellers]', $hdx$- 입점 신청 심사 · 판매자 정지 · 다시 열기 · 이용 제한 · 폐점 · 수수료율 · 하위가맹점 · 정보 변경 요청. 사유는 판매자에게 그대로 보입니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (31, '24. 소개몰 — 기본 탭', 'hlt-settle', '소개몰 정산 [hlt-settle]', $hdx$- 주 단위로 마감합니다. 배송 완료 후 7일(청약철회 기간)이 지난 건만 집계합니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (32, '24. 소개몰 — 기본 탭', 'hlt-products', '소개몰 상품 [hlt-products]', $hdx$- 상품 · 옵션(묶음 개수) · 재고 · 그림 · 고시를 넣고 고칩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (33, '24. 소개몰 — 기본 탭', 'hlt-orders', '소개몰 주문 [hlt-orders]', $hdx$- 결제 완료 주문의 발송을 처리합니다 — 택배사 · 송장번호를 넣으면 배송중, 「배송 완료로」를 누르면 배송 완료.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (34, '24. 소개몰 — 기본 탭', 'hlt-open', '개봉 반품 재고 [hlt-open]', $hdx$- 반품 승인 때 개봉으로 판정한 상품 — 보관(폐기 대기) · 폐기 · 판매자 반송. 식품 · 화장품 개봉품은 다시 팔 수 없습니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (35, '24. 소개몰 — 기본 탭', 'hlt-reviews', '소개몰 리뷰 · 문의 [hlt-reviews]', $hdx$- 리뷰는 바로 보이고, 효능 · 효과를 단정하는 표현에 걸린 것만 여기서 확인합니다. 상품 문의는 운영자가 답합니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (36, '25. 소개광장 — 기본 탭', 'events', '이벤트 [events]', $hdx$- 지급 대기를 먼저 보여 줍니다 — 이벤트를 여는 것보다 약속한 것을 주는 일이 중요합니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (37, '25. 소개광장 — 기본 탭', 'community', '글 검수 [community]', $hdx$- 첫 글 · 신고된 글을 보고, 모든 글과 댓글을 찾아 감추거나 되살립니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (38, '25. 소개광장 — 기본 탭', 'polls', '이건 어때? 투표 [polls]', $hdx$- 소개광장 「이건 어때?」와 메인의 세 장에 나오는 투표를 만들고 엽니다. 참여 수는 실제 표 수입니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (39, '26. 노출 — 기본 탭', 'mainops', '메인 운영 [mainops]', $hdx$- 메인에 무엇을 띄울지 정합니다. 광고는 추천 순위에 섞이지 않고 별도 슬롯에만 나갑니다. 배포 없이 즉시 반영됩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (40, '27. 파트너사 — 기본 탭', 'partners', '파트너 [partners]', $hdx$- 파트너센터(파트너사가 쓰는 별도 사이트)에서 올라오는 것을 본사가 처리하는 자리입니다.
- 보는 역할: ADMIN · PARTNER_MAL · SUPER.$hdx$),
  (41, '27. 파트너사 — 기본 탭', 'partner-axes', '안심소개 입점 심사 [partner-axes]', $hdx$- 안심소개 입점 신청을 축별로 심사합니다.
- 보는 역할: ADMIN · PARTNER_MAL · SUPER.$hdx$),
  (42, '27. 파트너사 — 기본 탭', 'directory', '법률·세무 정액 노출 [directory]', $hdx$- 법률 · 세무 전문가의 정액 노출을 관리합니다.
- 보는 역할: ADMIN · PARTNER_MAL · SUPER.$hdx$),
  (43, '28. 제휴 — 기본 탭', 'affiliates', '제휴 [affiliates]', $hdx$- 관리자가 승인해야 링크를 발급할 수 있습니다. 입점 심사 · 제휴상품 · 목표 · 자료 · 정산을 여기서 처리합니다.
- 보는 역할: ADMIN · PARTNER_AFF · SUPER.$hdx$),
  (44, '29. 광고 — 기본 탭', 'ad-billing', '광고 과금 [ad-billing]', $hdx$- 광고주 · 청구 · 입금 · 미수금. 광고비는 우리가 받는 돈이라 소개비와 따로 답니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (45, '29. 광고 — 기본 탭', 'ads', '광고 [ads]', $hdx$- 메인 광고 자리에 어떤 소재를 누구에게 내보낼지 정합니다. 소재 · 슬롯 · 세그먼트 세 가지가 전부입니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (46, '29. 광고 — 기본 탭', 'adx', '외부 송출 [adx]', $hdx$- 소개뱅크 지면뿐 아니라 외부 사이트에도 광고를 싣고, 클릭당 과금해 퍼블리셔와 나눕니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (47, '29. 광고 — 기본 탭', 'adx-payout', '퍼블리셔 지급 [adx-payout]', $hdx$- 월 마감 → 명세서 → 신청 → 승인 → 집행. 각 단계에 사람이 다르고, 각 단계에 막는 장치가 있습니다.
- 보는 역할: ADMIN · PAYOUT · SUPER.$hdx$),
  (48, '30. 정산 — 기본 탭', 'settlement', '정산 [settlement]', $hdx$- 신청 → 승인 → 지급 실행. 소개비에서 떼는 금액은 없습니다 (INV-9). 지급은 당사자가 직접 합니다 (INV-11).
- 보는 역할: ADMIN · SUPER.$hdx$),
  (49, '30. 정산 — 기본 탭', 'payouts', '지급 [payouts]', $hdx$- 확정된 지급을 보내고 기록합니다. 확정은 운영, 지급 기록은 지급 담당이 합니다.
- 보는 역할: ADMIN · PAYOUT · SUPER.$hdx$),
  (50, '30. 정산 — 기본 탭', 'billing', '청구 [billing]', $hdx$- 구독료가 매출의 전부입니다. 이 화면이 곧 매출 감시입니다. 유예 일수와 재시도 횟수는 코드가 아니라 설정에 있어 여기서 바꾸면 즉시 반영됩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (51, '31. 회계 — 기본 탭', 'acct-journal', '전표 [acct-journal]', $hdx$- 소개뱅크를 지난 돈 흐름으로 매시간 만든 전표입니다. 달마다 마감하고 회계 프로그램에 올릴 CSV 를 받습니다(내려받기 승인).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (52, '31. 회계 — 기본 탭', 'acct-tax', '신고 자료 [acct-tax]', $hdx$- 부가세(분기) · 원천세(월) · 세금계산서 발행 대상을 전표와 원래 자료에서 모았습니다. 신고서 칸 맞춤은 세무사 확인.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (53, '31. 회계 — 기본 탭', 'acct-report', '경영 보고서 [acct-report]', $hdx$- 달마다 매출(공급가) · 비용 · 이익 · 현금 들고 남 — 시스템을 지난 돈만입니다(급여 · 임대료 등은 회계 프로그램).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (54, '31. 회계 — 기본 탭', 'acct-accounts', '계정 · 규칙 [acct-accounts]', $hdx$- 전표 계정의 회계 프로그램 코드 · 계정 더하기, 돈 흐름별 전표 모양과 계정 자리 · 증빙 고치기(초안 · 세무사 확인 · 확인표 CSV), 전표 양식(세무사랑), 직판 상품의 과세 · 면세를 고릅니다.
- 보는 역할: PAYOUT · ADMIN · SUPER · ACCOUNTANT(읽기).$hdx$),
  (55, '31. 회계 — 기본 탭', 'acct-month', '월 결산 [acct-month]', $hdx$- 그 달 매출 · 비용 · 부가세 · 원천세 · 현금과 마감 전 할 일(전표 실패 · 통장 맞춤 · 세금계산서), 다가오는 신고 기한(원천세 10일 · 부가세 25일)입니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (56, '31. 회계 — 기본 탭', 'acct-bank', '은행 맞추기 [acct-bank]', $hdx$- 인터넷뱅킹 거래 내역 CSV 를 올려 전표의 보통예금 줄과 금액 · 날짜 · 이름으로 맞춥니다. 맞출 것이 없는 줄(이자 · 수수료)은 사유와 함께 둡니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (57, '31. 회계 — 기본 탭', 'acct-purchase', '매입 [acct-purchase]', $hdx$- 매입 세금계산서 · 카드 · 현금영수증 · 간이영수증(공제 안 됨)을 증빙 파일과 넣으면 비용 · 부가세대급금 전표가 생깁니다. 분기 매입 부가세는 신고 자료 매입 쪽.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (58, '31. 회계 — 기본 탭', 'acct-expense', '경비 청구 [acct-expense]', $hdx$- 운영자가 쓴 돈을 증빙과 올리고 SUPER 가 승인(본인 건 불가) · 지급 담당이 지급합니다. 법인카드 이용 내역 CSV 를 올려 줄마다 계정을 골라 장부에 넣습니다.
- 보는 역할: PAYOUT · ADMIN · REVIEWER · PARTNER_MAL · PARTNER_AFF · SUPER · ACCOUNTANT(읽기).$hdx$),
  (59, '31. 회계 — 기본 탭', 'acct-cash', '자금 흐름 [acct-cash]', $hdx$- 앞으로 90일 날마다 예상 잔액 — 시작 잔액(직접 넣음 · 통장 CSV)에 확정된 들어올 돈 · 나갈 돈을 더하고 뺍니다. 가장 낮은 날이 기준 밑이면 운영 알림.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (60, '31. 회계 — 기본 탭', 'acct-stock', '재고 [acct-stock]', $hdx$- 직판 상품 원가 장부(이동평균) — 입고 · 결제 때 출고 · 취소 · 반품 반입 · 실사 조정 · 매출원가 전표
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (61, '31. 회계 — 기본 탭', 'acct-statements', '재무제표 [acct-statements]', $hdx$- 시산표 · 손익계산서 · 재무상태표와 기초 잔액(시작일 통장 · 받을 돈 · 갚을 돈 · 자본금 — 확정 뒤 못 고침)입니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (62, '31. 회계 — 기본 탭', 'acct-ledger', '원장 [acct-ledger]', $hdx$- 계정별 원장(날짜별 들고 남 · 잔액) · 거래처별 매출장 · 매입장 · CSV(내려받기 승인)
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (63, '31. 회계 — 기본 탭', 'acct-assets', '고정자산 [acct-assets]', $hdx$- 고정자산 대장 · 달마다 감가상각 전표(정액 · 정률 · 잔존가치 · 초안) · 매입에서 넘기기 · 처분 손익
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (64, '31. 회계 — 기본 탭', 'acct-budget', '예산 [acct-budget]', $hdx$- 계정별 달 예산(SUPER) · 실적 · 차이 · 넘으면 운영 알림 · 경영 보고서에 한 줄
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (65, '31. 회계 — 기본 탭', 'acct-vatform', '부가세 신고서 [acct-vatform]', $hdx$- 일반과세자 신고서 칸을 전표 · 매입 관리로 채운 미리보기 — 실제 신고는 세무사 · 홈택스.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (66, '31. 회계 — 기본 탭', 'acct-aging', '기간 분석 [acct-aging]', $hdx$- 받을 돈 · 갚을 돈을 거래처별 30 · 60 · 90일 · 넘음으로 — 넘으면 운영 알림.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (67, '31. 회계 — 기본 탭', 'acct-yearclose', '해 마감 [acct-yearclose]', $hdx$- 손익을 이월이익잉여금으로 넘기고 다음 해 기초 잔액 초안 — 마감한 해는 전표를 넣지 못함.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (68, '31. 회계 — 기본 탭', 'acct-payroll', '급여 [acct-payroll]', $hdx$- 직원 · 달 급여 · 원천세 · 4대보험 · 급여 전표 — 요율 · 간이세액표는 해마다 SUPER(초안).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (69, '31. 회계 — 기본 탭', 'acct-whtreturn', '원천세 신고서 [acct-whtreturn]', $hdx$- 지급한 달의 근로소득 · 사업소득 · 퇴직소득 원천세를 이행상황신고서 칸(A01 · A20 · A25 · A99)으로 · 납부 기한(다음 달 10일) · CSV.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (70, '31. 회계 — 기본 탭', 'acct-wagestmt', '지급명세서 [acct-wagestmt]', $hdx$- 해 · 반기 · 달 직원별 총급여 · 비과세 · 원천세 · 4대보험 본인 몫 · CSV · 원천징수영수증(인쇄) — 주민등록번호는 신고 때 채움.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (71, '31. 회계 — 기본 탭', 'acct-insurance', '4대보험 신고 [acct-insurance]', $hdx$- 입사(취득) · 퇴사(상실) 신고 자료 · 보수월액 · 기한(다음 달 15일) · 처리함 — 기한 3일 전부터 운영 알림.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (72, '31. 회계 — 기본 탭', 'acct-pg', 'PG 정산 [acct-pg]', $hdx$- PG 사 정산 내역 CSV ↔ PG 정산 받을 돈 · 수수료는 지급수수료 전표 · 안 들어온 결제 알림.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (73, '31. 회계 — 기본 탭', 'acct-manual', '수동 전표 [acct-manual]', $hdx$- 자동으로 안 잡히는 거래(임대료 · 대출 등) — 요청 → 쓴 사람이 아닌 SUPER 승인 → 장부.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (74, '31. 회계 — 기본 탭', 'acct-severance', '퇴직금 · 연차 [acct-severance]', $hdx$- 퇴직금 추계(최근 3개월 급여) · 달마다 차이만 전표 · 연차 생긴 날 · 쓴 날(초안 · 노무사 확인).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (75, '31. 회계 — 기본 탭', 'acct-corptax', '법인세 추정 [acct-corptax]', $hdx$- 올해 회계 이익 기준 법인세 · 지방소득세 추정 · 중간예납 · 확정 신고 기한(세무조정 없음 · 세무사 확인).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (76, '31. 회계 — 기본 탭', 'acct-parties', '거래처 [acct-parties]', $hdx$- 매입처 · 매출처를 한 곳에 — 사업자번호 · 담당 · 계좌 끝 4자리 · 광고주 · 입점 판매자 · 매입 연결과 거래 합계입니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (77, '31. 회계 — 기본 탭', 'acct-contracts', '계약 [acct-contracts]', $hdx$- 임대 · 용역 · 서버 · 구독 계약과 만기입니다. 만기 알림 일수 전부터 운영 알림이 뜨고, 달 금액은 자금 흐름 예정에 들어갑니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (78, '31. 회계 — 기본 탭', 'acct-requisitions', '품의 [acct-requisitions]', $hdx$- 쓰기 전에 지출 품의를 올리고 SUPER 가 결재합니다(본인 품의 불가). 승인된 품의는 매입 · 경비 청구에 연결합니다.
- 보는 역할: ADMIN · PAYOUT · REVIEWER · PARTNER_MAL · PARTNER_AFF · SUPER · ACCOUNTANT(읽기).$hdx$),
  (79, '31. 회계 — 기본 탭', 'acct-imports', '수입 [acct-imports]', $hdx$- 수입 건을 발주 → 선적 → 통관 → 입고로 넘깁니다. 입고 원가(물품 + 관세 + 운임 + 기타)는 재고 수불부로, 수입 부가세는 부가세대급금으로 갑니다. 신고는 관세사.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (80, '31. 회계 — 기본 탭', 'acct-docs', '견적 · 명세서 [acct-docs]', $hdx$- 견적서 → 주문서 → 거래명세서를 이어 만들고 인쇄합니다. 거래명세서를 확정하면 매출 전표 · 세금계산서 요청으로 이어집니다. 발주서 인쇄도 여기서.
- 보는 역할: PAYOUT · ADMIN · SUPER · ACCOUNTANT(읽기).$hdx$),
  (81, '31. 회계 — 기본 탭', 'acct-depts', '부서 손익 [acct-depts]', $hdx$- 부서 · 프로젝트를 만들고 전표에 꼬리표를 붙여 부서 · 프로젝트별 매출 · 비용 · 이익을 봅니다(꼬리표가 없으면 돈 흐름 기본 부서).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (82, '31. 회계 — 기본 탭', 'acct-wh', '창고 · 바코드 [acct-wh]', $hdx$- 창고별 재고 · 창고 간 이동 · 창고 입고 · 실사, 상품 옵션 바코드(Code128) 인쇄 · 카메라 읽기 — 원가는 회사 전체 이동평균 그대로.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (83, '31. 회계 — 기본 탭', 'acct-dunning', '미수금 독촉 [acct-dunning]', $hdx$- 거래처별 받을 돈과 독촉 단계(안내 → 독촉 → 최종) · 메일 미리 보기 · 보내기(자동은 처음 꺼짐) · 입금 예정은 자금 흐름에 들어갑니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (84, '31. 회계 — 기본 탭', 'acct-taxinbox', '세금계산서 받기 [acct-taxinbox]', $hdx$- 홈택스에 쌓인 매입 전자세금계산서를 연동 업체로 가져와 계정을 골라 매입으로 넘깁니다(업체 계약 전에는 간주). 같은 건은 한 번.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (85, '31. 회계 — 기본 탭', 'acct-accountant', '세무사 [acct-accountant]', $hdx$- 세무사 공유 계정(읽기 전용 · 기한 꼭)의 기한 · 접속 기록 · 질문과 답 — 세무사는 여기서 질문을 남깁니다.
- 보는 역할: PAYOUT · ACCOUNTANT · SUPER.$hdx$),
  (86, '31. 회계 — 기본 탭', 'acct-receipt', '영수증 읽기 [acct-receipt]', $hdx$- 증빙 사진에서 날짜 · 공급자 · 금액을 읽어 칸을 채워 줍니다(처음 꺼짐 · 간주) — 확인하고 고친 뒤 매입으로 넣습니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (87, '31. 회계 — 기본 탭', 'acct-accrual', '고정비 [acct-accrual]', $hdx$- 계약 달 금액을 매달 1일 미지급 비용으로 · 같은 거래처 매입이 오면 되돌림(비용 두 번 막기) · 빠진 매입 알림.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (88, '31. 회계 — 기본 탭', 'acct-archive', '장부 보관 · 통제 [acct-archive]', $hdx$- 해 마감 뒤 장부 · 증빙 지문을 남기고(5년 · 지우지 않음) 달마다 내부통제 숫자를 봅니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (89, '31. 회계 — 기본 탭', 'acct-cardlimit', '법인카드 한도 [acct-cardlimit]', $hdx$- 카드(끝 4자리)마다 쓰는 사람 · 달 한도를 정하고 이번 달 사용을 봅니다 — 한도의 80% · 한도를 넘으면 운영 알림(매일 09:40).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (90, '31. 회계 — 기본 탭', 'fin-transfer', '대량 이체 [fin-transfer]', $hdx$- 거래처 대금 · 경비를 묶음으로 만들고, 만든 사람이 아닌 두 사람이 승인한 뒤 보냅니다(처음 꺼짐 · 간주) — 계좌는 끝 4자리만 보입니다.
- 보는 역할: PAYOUT · SUPER.$hdx$),
  (91, '31. 회계 — 기본 탭', 'acct-target', '매출 목표 [acct-target]', $hdx$- 달마다 회사 전체 · 부서 · 담당자 매출 목표를 정하고(SUPER) 실적 · 달성률을 봅니다 — 부서는 부서 손익과 같은 셈.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (92, '31. 회계 — 기본 탭', 'acct-partyledger', '거래처 원장 [acct-partyledger]', $hdx$- 거래처별 받을 돈 · 갚을 돈의 기초 · 늘어남 · 줄어듦 · 기말과 한 거래처 줄(전표) — CSV 는 내려받기 승인.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (93, '31. 회계 — 기본 탭', 'acct-daybook', '분개장 [acct-daybook]', $hdx$- 기간 전표를 날짜 · 번호 순으로 줄째(계정 · 차변 · 대변) 봅니다 · 합계 차변 = 대변 · CSV(내려받기 승인).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (94, '31. 회계 — 기본 탭', 'acct-cashbook', '현금출납장 [acct-cashbook]', $hdx$- 보통예금 · 현금(시재)의 날짜별 들어옴 · 나감 · 잔액 · CSV(내려받기 승인).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (95, '31. 회계 — 기본 탭', 'acct-fxreval', '외화 환산 [acct-fxreval]', $hdx$- 달 말일까지 못 받은 수출 받을 돈을 기말 환율로 다시 셉니다 — 평가 전표 + 다음 달 첫날 되돌림(SUPER · 달마다 한 번).
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (96, '31. 회계 — 기본 탭', 'hr-attend', '근태 [hr-attend]', $hdx$- 직원이 사무 › 내 인사에서 누른 출근 · 퇴근 · 달 집계(늦음 · 퇴근 없음 · 휴가) · 시각 고침(사유) · 달 확인 — 직원과 운영 계정 연결은 SUPER.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (97, '31. 회계 — 기본 탭', 'hr-leave', '휴가 신청 [hr-leave]', $hdx$- 직원 휴가 신청을 승인 · 반려 — 승인하면 연차 쓴 날로 들어가고, 본인 신청은 다른 관리자가 처리합니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (98, '31. 회계 — 기본 탭', 'acct-payslip', '급여명세서 [acct-payslip]', $hdx$- 확정 · 지급한 급여의 직원별 명세서(인쇄) · 알림 메일(처음 꺼짐 · 금액 없음).
- 보는 역할: PAYOUT · ACCOUNTANT · SUPER.$hdx$),
  (99, '31. 회계 — 기본 탭', 'acct-yearend', '연말정산 자료 [acct-yearend]', $hdx$- 직원별 해 합계 · 달별 총급여 · 기납부 세액 · 서류 받음 표시 · CSV(승인) — 주민등록번호 · 결정세액은 회계 프로그램에서.
- 보는 역할: PAYOUT · ACCOUNTANT · SUPER.$hdx$),
  (100, '31. 회계 — 기본 탭', 'acct-exports', '수출 [acct-exports]', $hdx$- 수출 건을 수주 → 선적(선적일 환율로 매출 · 영세율 · 재고 출고) → 수출신고 수리(영세율 근거 번호) → 대금 회수(환율 차이 외환차익 · 차손)로 넘깁니다. 신고는 관세사.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (101, '31. 회계 — 기본 탭', 'acct-po', '국내 발주 [acct-po]', $hdx$- 국내 매입처에 발주하고, 들어오면 「입고」로 매입(세금계산서 · 부가세대급금)과 직판 재고에 한 번에 넣습니다.
- 보는 역할: PAYOUT · SUPER · ACCOUNTANT(읽기).$hdx$),
  (102, '32. 정책 — 기본 탭', 'policy', '정책 [policy]', $hdx$- 화면이 따르는 규칙의 원본입니다. 여기 값이 바뀌면 화면 문구와 계산이 함께 바뀝니다.
- 보는 역할: SUPER 만.$hdx$),
  (103, '32. 정책 — 기본 탭', 'codes', '코드 라벨 [codes]', $hdx$- 화면에 보이는 상태 문구입니다. 코드는 고정이고 라벨만 바뀝니다.
- 보는 역할: SUPER 만.$hdx$),
  (104, '33. 관 관리 — 기본 탭', 'checklist', '오픈 체크리스트 [checklist]', $hdx$- 하나라도 미충족이면 오픈 버튼이 열리지 않습니다. 무엇이 막고 있는지 여기서 봅니다.
- 보는 역할: SUPER 만.$hdx$),
  (105, '33. 관 관리 — 기본 탭', 'siteinfo', '법정 고지 [siteinfo]', $hdx$- 푸터 법정 고지의 원본입니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (106, '33. 관 관리 — 기본 탭', 'terms', '약관 [terms]', $hdx$- 법무가 확인한 글을 고치고 시행일을 정해 게시합니다. 시행일 전에는 앞 판이 그대로 시행되고, 재동의는 시행일부터 받습니다.
- 보는 역할: SUPER 만.$hdx$),
  (107, '33. 관 관리 — 기본 탭', 'faq', '자주 묻는 질문 [faq]', $hdx$- 사용자 웹 고객센터(분야 탭 · 많이 찾는 질문 · 찾기) · 이용안내 · 1:1 문의 챗봇에 나가는 질문 글입니다. 저장하면 바로 나가고, 지우기 대신 숨깁니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (108, '33. 관 관리 — 기본 탭', 'ops-guide', '업무 안내 [ops-guide]', $hdx$- 운영진 업무마다 순서와 그 화면으로 가는 단추입니다. 고치기는 최고 관리자(SUPER) — 고치면 새 판이 되고 옛 판은 남습니다.
- 보는 역할: ADMIN · REVIEWER · PAYOUT · PARTNER_MAL · PARTNER_AFF · SUPER.$hdx$),
  (109, '33. 관 관리 — 기본 탭', 'guide-flows', '이용 흐름 [guide-flows]', $hdx$- 사용자 웹 이용안내 › 「이렇게 이용하세요」의 흐름 글입니다. 고치기는 최고 관리자(SUPER) — 고치면 새 판이 되고 옛 판은 남습니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (110, '33. 관 관리 — 기본 탭', 'i18n', '번역 [i18n]', $hdx$- 다국어 — 번역을 넣고 승인합니다. 승인한 번역만, 다국어를 켠 뒤 손님 화면에 나갑니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (111, '33. 관 관리 — 기본 탭', 'gwans', '관 관리 [gwans]', $hdx$- 관은 코드가 아니라 데이터입니다. 여기서 만든 관이 그대로 하나의 사이트가 됩니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (112, '33. 관 관리 — 기본 탭', 'hub', '통합 허브 [hub]', $hdx$- 통합 메인은 관이 아닙니다 — 관으로 보내는 허브입니다.
- 보는 역할: SUPER 만.$hdx$),
  (113, '33. 관 관리 — 기본 탭', 'gwan-ux', '관 UI/UX [gwan-ux]', $hdx$- 관마다 성격이 다르면 화면도 달라야 합니다. 축을 켜고 끄고, 축의 UI 유형을 여기서 정합니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (114, '34. 업종 — 기본 탭', 'category', '업종 승인 [category]', $hdx$- 업종은 열린 집합입니다 — 신청 → 승인 → 노출 (A-02).
- 보는 역할: ADMIN · SUPER.$hdx$),
  (115, '35. 통합 현황 — 기본 탭', 'reports', '경영 지표 [reports]', $hdx$- 어긋남 신호 · 결정 대기 · 매출 · 최근 30일을 한 화면에서 봅니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (116, '35. 통합 현황 — 기본 탭', 'collect', '수집 관리 [collect]', $hdx$- 식약처 성분 데이터를 받아 우리 마스터와 대조합니다. 게이트를 모두 통과해야 돕니다.
- 보는 역할: ADMIN · SUPER.$hdx$),
  (117, '35. 통합 현황 — 기본 탭', 'integrations', '외부 연동 [integrations]', $hdx$- 연동 상태와 다음에 할 일입니다. 오픈을 막는 것이 무엇인지 여기서 봅니다.
- 보는 역할: SUPER 만.$hdx$),
  (118, '35. 통합 현황 — 기본 탭', 'integ', '통합 현황 [integ]', $hdx$- 지금 어떤 상태인지 한 장으로 봅니다. 숫자는 실제 DB 조회값과 서버에 등록된 라우트입니다.
- 보는 역할: SUPER 만.$hdx$),
  (119, '36. 불변식 — 기본 탭', 'invariants', '불변식 [invariants]', $hdx$- 감시 뷰를 한 번에 훑습니다.
- 보는 역할: ADMIN · SUPER.$hdx$)
),
cur AS (
  SELECT version, title, body FROM public.v_help_doc_current WHERE code = 'ADMIN_GUIDE'
),
miss AS (
  SELECT a.*, sum(char_length(a.heading) + char_length(a.body) + 7) OVER (ORDER BY a.ord) AS run
    FROM add_rows a, cur c
   WHERE position('[' || a.tab_key || ']' IN c.body) = 0
),
room AS (
  -- 묶음 제목(## …) 몫을 먼저 빼고(모두 붙는다고 보고) 남는 자리
  SELECT 40000 - char_length(rtrim(c.body, E'\n')) - 3
         - coalesce((SELECT sum(char_length(g) + 7) FROM (SELECT DISTINCT grp AS g FROM miss) x), 0) AS n
    FROM cur c
),
fit AS (
  SELECT m.* FROM miss m, room r WHERE m.run <= r.n
),
grp_text AS (
  SELECT grp, min(ord) AS o,
         '## ' || grp || E'\n\n' || string_agg('### ' || heading || E'\n' || body, E'\n\n' ORDER BY ord) AS t
    FROM fit GROUP BY grp
),
add_text AS (
  SELECT string_agg(t, E'\n\n' ORDER BY o) AS t FROM grp_text
)
INSERT INTO public.help_docs (code, version, title, body, note)
SELECT 'ADMIN_GUIDE',
       (SELECT max(version) + 1 FROM public.help_docs WHERE code = 'ADMIN_GUIDE'),
       c.title,
       rtrim(c.body, E'\n') || E'\n\n' || a.t || E'\n',
       '옛 탭 설명 더함(v10.623 · docs/766)'
  FROM cur c, add_text a
 WHERE a.t IS NOT NULL;

-- 탭 → 절 잇기 — 지금 판(방금 더한 판 포함)의 「### 제목 [탭 키]」 줄 가운데 첫 줄(HelpService.sections 의 find 와 같음)
INSERT INTO public.sec2_tab_help (tab_key, doc_code, heading)
SELECT DISTINCT ON (x.k) x.k, 'ADMIN_GUIDE', x.h
  FROM (
    SELECT l.n, (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[1] AS h,
                (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[2] AS k
      FROM public.v_help_doc_current c,
           LATERAL regexp_split_to_table(c.body, E'\n') WITH ORDINALITY AS l(line, n)
     WHERE c.code = 'ADMIN_GUIDE'
  ) x
 WHERE x.k = ANY (ARRAY['rpt-day', 'rpt-week', 'rpt-month', 'rpt-worklog', 'rpt-board', 'rpt-trend', 'approvals', 'approval-lines', 'corp-docs', 'ai-ops', 'risk', 'purge-log', 'server-errors', 'ops-board', 'gov-audit', 'users', 'queue', 'badges', 'audit', 'rules', 'ownership', 'quals', 'my-mfa', 'my-password', 'perm-admin', 'staff-access', 'roles', 'disputes', 'deals', 'hlt-sellers', 'hlt-settle', 'hlt-products', 'hlt-orders', 'hlt-open', 'hlt-reviews', 'events', 'community', 'polls', 'mainops', 'partners', 'partner-axes', 'directory', 'affiliates', 'ad-billing', 'ads', 'adx', 'adx-payout', 'settlement', 'payouts', 'billing', 'acct-journal', 'acct-tax', 'acct-report', 'acct-accounts', 'acct-month', 'acct-bank', 'acct-purchase', 'acct-expense', 'acct-cash', 'acct-stock', 'acct-statements', 'acct-ledger', 'acct-assets', 'acct-budget', 'acct-vatform', 'acct-aging', 'acct-yearclose', 'acct-payroll', 'acct-whtreturn', 'acct-wagestmt', 'acct-insurance', 'acct-pg', 'acct-manual', 'acct-severance', 'acct-corptax', 'acct-parties', 'acct-contracts', 'acct-requisitions', 'acct-imports', 'acct-docs', 'acct-depts', 'acct-wh', 'acct-dunning', 'acct-taxinbox', 'acct-accountant', 'acct-receipt', 'acct-accrual', 'acct-archive', 'acct-cardlimit', 'fin-transfer', 'acct-target', 'acct-partyledger', 'acct-daybook', 'acct-cashbook', 'acct-fxreval', 'hr-attend', 'hr-leave', 'acct-payslip', 'acct-yearend', 'acct-exports', 'acct-po', 'policy', 'codes', 'checklist', 'siteinfo', 'terms', 'faq', 'ops-guide', 'guide-flows', 'i18n', 'gwans', 'hub', 'gwan-ux', 'category', 'reports', 'collect', 'integrations', 'integ', 'invariants'])
   AND char_length(x.h) <= 120
 ORDER BY x.k, x.n
ON CONFLICT (tab_key) DO NOTHING;

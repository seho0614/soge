-- =====================================================================
-- hdx_ · v10.616 (docs/758) 운영 화면 「?」 도움말에 v10.457 ~ 614 새 탭 설명 넣기 — 대표 11/21 승인
--   운영 화면 도움말(help_docs ADMIN_GUIDE · D180 표 · v10.594 D300 1판)에 절 124개(11묶음)를 **새 판으로** 더하고,
--   탭 → 절 잇기(sec2_tab_help)를 넣음. 표 · 함수 · 트리거 · 설정을 새로 만들지 않음.
--   ① 지금 판 본문에 「[탭 키]」가 이미 있는 절은 건너뜀(SUPER 가 먼저 쓴 절 · 다시 돌린 경우) — 지금 판을 지우거나 고치지 않고 끝에 붙인 새 판만 더함
--      (help_docs 는 쌓기만 · 옛 판은 남음 · 같은 본문이면 새 판을 만들지 않음 = 다시 돌려도 같음)
--   ② 본문 2만 자(help_docs CHECK · 서버 저장 한도와 같음)를 넘지 않게 앞에서부터 들어가는 절만 붙임(1판 그대로면 모두 들어감 · 합계 15216자)
--   ③ 잇기는 지금 판에 그 제목 줄이 있는 탭만 · 이미 이은 탭(SUPER 가 바꾼 것)은 그대로(ON CONFLICT DO NOTHING)
--   D300(ADMIN_GUIDE 1판) 뒤에 돌아야 함(D300 이 1판을 넣음).
-- =====================================================================

WITH add_rows(ord, grp, tab_key, heading, body) AS (VALUES
  (1, '5. 대시보드 · 보고', 'opb-glance', '대표 한눈에 [opb-glance]', $hdx$- 가입 · 매물 · 거래 · 소개몰 매출 · 정산 · 문의 · 급한 알림 · 오픈 차단을 어제 · 지난주와 나란히(합계만 · 읽기만 · SUPER).$hdx$),
  (2, '6. 검수 › 매물', 'lsx-expiry', '매물 만료 · 연장 [lsx-expiry]', $hdx$- 검수 승인 때 정한 노출 만료일(기본 6개월) · 곧 끝남 · 만료로 내림(지우지 않음) · 회원 연장 요청 승인. 연장은 운영자만.
- 스위치 lsx.expiry(처음 off · 꺼져도 만료일은 저장).$hdx$),
  (3, '6. 검수 › 매물', 'lsx-bump', '끌어올리기 [lsx-bump]', $hdx$- 방식 lsx.bump_mode: OFF(처음) · FREE · PAID. PAID 는 1회 금액(lsx.bump_price)을 정한 뒤. 효과 시간이 지나면 원래 자리.$hdx$),
  (4, '6. 검수 › 매물', 'lsx-summary', '매물 AI 요약 [lsx-summary]', $hdx$- AI 3줄 요약 초안을 읽고 고쳐 승인해야 상세에 보임. 매물을 고치면 다시 초안. 스위치 lsx.ai_summary(off) · AI 월 상한 안.$hdx$),
  (5, '6. 검수 › 매물', 'lsx-saved', '저장한 검색 [lsx-saved]', $hdx$- 회원이 저장한 검색 · 새 매물 하루 묶음 알림(08:10)의 숫자만. 스위치 lsx.saved_search(off · 처리방침 걸림 · SUPER).$hdx$),
  (6, '6. 검수 › 매물', 'vsx-visits', '매물 방문 예약 [vsx-visits]', $hdx$- 주인이 연 방문 칸을 회원이 골라 요청 → 주인 확정 · 전날 알림 · 노쇼. 운영은 숫자 · 기록만. 스위치 vsx.enabled(off) + 관 vsx.gwans(NONE).$hdx$),
  (7, '6. 검수 › 매물', 'vsx-map', '지도 매물 묶음 [vsx-map]', $hdx$- 공개 지도 API 의 줌별 묶음 수만(주소 · 좌표 안 냄). 스위치 map.cluster_enabled(off) · 격자 map.cluster_grid 는 따로.$hdx$),
  (8, '6. 검수 › 매물', 'lpx-offers', '매물 가격 제안 [lpx-offers]', $hdx$- 희망 가격 제안 → 수락 · 거절 · 되제안 · 기한 만료. 거래는 만들지 않음. 스위치 lpx.offer + 쓸 관 lpx.offer_gwans(처음 NONE).$hdx$),
  (9, '6. 검수 › 매물', 'lpx-photo', '매물 사진 워터마크 [lpx-photo]', $hdx$- 상세 사진 위에 글자만 겹침(원본 그대로) · 자리 · 진하기 미리보기. 스위치 lpx.watermark(off).$hdx$),
  (10, '6. 검수 › 매물', 'lpx-away', '판매자 자리 비움 [lpx-away]', $hdx$- 회원이 켠 자리 비움 기간 · 자동 안내 수. 끝 날짜가 지나면 저절로 풀림. 스위치 lpx.away(off).$hdx$),
  (11, '6. 검수 › 매물', 'lpx-stats', '지역별 시세 통계 [lpx-stats]', $hdx$- 게시 매물 희망 금액 가운데값(실제 거래가 아님) · 5개 미만 칸 숨김. 스위치 lpx.stats(off) · 「지금 셈」으로 미리 봄.$hdx$),
  (12, '6. 검수 › 매물', 'lsq-bulk', '매물 일괄 등록 [lsq-bulk]', $hdx$- 회원 CSV 미리보기 → 확정(나의공간 › 매물 일괄 등록). 확정 줄은 검수 큐로. 스위치 lsq.bulk(off) · 켜기 전 회원 안내.$hdx$),
  (13, '6. 검수 › 매물', 'lsq-review-ask', '거래 후기 요청 [lsq-review-ask]', $hdx$- 성사 뒤 3일 · 다시 7일에 후기 요청 알림. 스위치 lsq.review_ask(off) · 켠 첫날 30일치가 한꺼번에(하루 500명 상한).$hdx$),
  (14, '6. 검수 › 매물', 'lsq-search-click', '검색 클릭 분석 [lsq-search-click]', $hdx$- 검색 결과에서 눌린 순위 · 낱말 수만(누가 없음). 노출 순위에 쓰지 않음. 스위치 lsq.search_click(off · SUPER).$hdx$),
  (15, '6. 검수 › 매물', 'lsq-region', '지역별 소개 페이지 [lsq-region]', $hdx$- 사용자 웹 /area 와 사이트 지도 지역 주소 — 게시 매물 3개 이상 지역만. 스위치 lsq.region_pages(off) · 문구는 대표 확인.$hdx$),
  (16, '6. 검수 › 매물', 'lsy-dups', '매물 중복 의심 [lsy-dups]', $hdx$- 사진 지문 · 글 겹침 · 같은 연락처로 찾은 짝을 나란히 보고 정함. 자동으로 내리지 않고, 정한 짝은 다시 못 엶. 스위치 lsy.dup_detect.$hdx$),
  (17, '6. 검수 › 매물', 'lsy-photos', '사진 품질 [lsy-photos]', $hdx$- 해상도 · 크기 · 비율 · 흐림 경고만(막지 않음). 스위치 lsy.photo_check(off) · 사진 속 연락처 AI lsy.photo_ai 는 처리방침 뒤.$hdx$),
  (18, '6. 검수 › 매물', 'lsy-videos', '매물 동영상 [lsy-videos]', $hdx$- 회원이 붙인 짧은 MP4 를 보고 승인해야 상세에 보임 · 반려 사유는 회원에게 보임. 스위치 lsy.video(off).$hdx$),
  (19, '7. 파트너사', 'bzx-ptn-contract', '파트너 계약 갱신 [bzx-ptn-contract]', $hdx$- 계약 만기 30일 전부터 운영 알림 · 갱신은 새 계약으로 다시 서명(처음 간주 서명 · 법적 전자서명 아님). 종이 계약은 「종이 계약 적기」.
- 파트너 회원 알림 bzx.partner_notice · 전자서명 bzx.partner_esign(둘 다 off · SUPER).$hdx$),
  (20, '7. 파트너사', 'ptn-openapi', '오픈 API [ptn-openapi]', $hdx$- 파트너 시스템용 읽기 API — 키(원문은 발급 때 한 번) · 범위 · 1분 한도 · 요청 기록 · 웹훅. 스위치 papi.enabled(off · 꺼지면 503) · 보안 검토 뒤 SUPER.$hdx$),
  (21, '7. 파트너사', 'vsx-papi-bill', '오픈 API 사용량 · 청구 [vsx-papi-bill]', $hdx$- 하루 사용량 · 달 무료 한도 · 1,000건 단가(부가세 별도 · 임시 값) · 월 청구서 초안. 확정은 SUPER 손으로 · 청구는 화면 밖. 스위치 papi.bill_enabled.$hdx$),
  (22, '7. 파트너사', 'vsx-ptn-export', '파트너 자료 내려받기 [vsx-ptn-export]', $hdx$- 파트너센터 성과 CSV · 리드 CSV(승인 뒤 한 번) 기록. 승인은 위험감지 › 감사. 스위치 ptn.export_enabled(off).$hdx$),
  (23, '7. 파트너사', 'ptn-bulk', '직원 일괄 등록 [ptn-bulk]', $hdx$- 파트너 직원을 CSV(이메일 · 정산 권한)로 미리보기 → 확정. 초대 메일 pbulk.invite_mail 은 처음 off(기록만).$hdx$),
  (24, '7. 파트너사', 'slx-ptn-perf', '파트너 성과 [slx-ptn-perf]', $hdx$- 받은 리드 · 열람 · 응답 속도 · 전환 · 이용료 · 정산 기간 그래프(합계 · 파트너별 · 순위). 스위치 없음.$hdx$),
  (25, '8. 회계 · 인사', 'acct-close-check', '마감 체크리스트 [acct-close-check]', $hdx$- 달 마감 전 할 일 — 통장 · 매입 · 급여 · 감가상각 · 미수금은 저절로 셈, 나머지는 사람 확인. 마감 버튼을 막지 않음.
- 남은 일 알림 hra.close_alert(off · SUPER).$hdx$),
  (26, '8. 회계 · 인사', 'acct-cashplan', '자금 계획 12개월 [acct-cashplan]', $hdx$- 확정 · 예정 돈 · 고정비 · 급여 · 세금 · 예상 매출로 달 말 예상 잔액. 기준 잔액(acct.cash_floor) 밑이면 알림(acct.cashplan_alert on).$hdx$),
  (27, '8. 회계 · 인사', 'acct-reorder', '안전 재고 · 재주문 [acct-reorder]', $hdx$- 직판 옵션 최소 재고 밑이면 알림 · 재주문 초안. 발주는 「발주로 넣기」를 눌러야. 스위치 acct.reorder(on · 규칙 없으면 아무것도 안 함).$hdx$),
  (28, '8. 회계 · 인사', 'acct-vehicle', '업무용 차량 [acct-vehicle]', $hdx$- 차량 · 운행기록부 · 비용 → 해마다 업무 사용 비율 · 손금 인정. 한도는 일반 원칙 값(SUPER 고침 · 세무사 확인 권함).$hdx$),
  (29, '8. 회계 · 인사', 'acct-exemptinv', '전자계산서(면세) [acct-exemptinv]', $hdx$- 거래명세서의 면세 품목을 전자계산서로 따로 발행. 스위치 acct.exempt_invoice(off · 간주) · 면세 품목 확인 뒤 SUPER.$hdx$),
  (30, '8. 회계 · 인사', 'bzx-card-notice', '카드 사용 알림 [bzx-card-notice]', $hdx$- 카드 이용 줄이 들어오면 쓰는 사람에게 알림 · 큰 금액 · 주말 · 한도 넘김은 운영 알림. 스위치 bzx.card_notify(off) · 직원에게 먼저 알림.$hdx$),
  (31, '8. 회계 · 인사', 'acct-bankfeed', '은행 자동 조회 [acct-bankfeed]', $hdx$- 회사 계좌 거래내역을 매일 06:40 은행 맞추기로. 스위치 acct.bank_feed(off) · 방식 ASSUME(간주) · LIVE 는 금융결제원 키 뒤.$hdx$),
  (32, '8. 회계 · 인사', 'sal-crm', '영업 기회 [sal-crm]', $hdx$- 거래처별 상담 → 견적 → 계약 → 성사 · 실패 · 예상 매출 · 다음 할 일(날짜가 되면 운영 알림 · sales.opp_remind on).$hdx$),
  (33, '8. 회계 · 인사', 'hrx-stocktake', '자산 실사 [hrx-stocktake]', $hdx$- 고정자산 QR 라벨 인쇄 · 실사 회차 · 찾음 · 없음. 닫은 뒤 없어진 자산은 처분 전표로(SUPER).$hdx$),
  (34, '8. 회계 · 인사', 'hr-card', '사원 카드 [hr-card]', $hdx$- 직원 한 사람의 기본 · 근태 · 휴가 · 급여 · 퇴직금 추계 · 계약 · 교육 · 평가 · 근무를 한 장에(읽기만). 열람 사유가 감사에 남음.
- 본인 카드는 사무 › 내 인사.$hdx$),
  (35, '8. 회계 · 인사', 'hra-payfile', '급여 이체 파일 [hra-payfile]', $hdx$- 확정 급여로 은행 대량 이체 CSV. 화면 계좌는 끝 4자리 · 원문은 내려받기 승인 뒤 파일에만. 스위치 hra.payfile_export(off · SUPER).$hdx$),
  (36, '8. 회계 · 인사', 'hr-training', '의무교육 [hr-training]', $hdx$- 성희롱 예방 · 개인정보 · 장애인 인식 개선 · 산업안전 이수 · 증빙 · 기한 알림. 종류 · 주기는 일반 원칙 값(SUPER).$hdx$),
  (37, '8. 회계 · 인사', 'hr-contract', '근로계약서 [hr-contract]', $hdx$- 양식 · 직원별 계약서 · 보내기 · 서명본 보관. 전자서명 hr.contract_esign 은 처음 off(간주 서명 · 법적 전자서명 아님).$hdx$),
  (38, '8. 회계 · 인사', 'hr-review', '인사 평가 [hr-review]', $hdx$- 분기 목표 → 자기 평가 → 상사 평가 · 등급. 직원은 자기 것만 · 결과는 닫은 뒤에 보임.$hdx$),
  (39, '8. 회계 · 인사', 'hr-recruit', '채용 [hr-recruit]', $hdx$- 공고 · 지원자(최소 개인정보) · 면접 · 합격 → 직원 대장. 불합격 서류는 보관 기간(180일) 뒤 자동 파기.$hdx$),
  (40, '8. 회계 · 인사', 'hrx-overtime', '연장 근로 [hrx-overtime]', $hdx$- 신청 → 승인(본인 아님) · 주 52시간 경고 · 근태 비교 · 가산 수당은 급여로. 가산율 · 한도는 일반 원칙 값(SUPER).$hdx$),
  (41, '8. 회계 · 인사', 'hrx-shifts', '근무표 [hrx-shifts]', $hdx$- 직원 × 7일 교대표 · 지난주 복사 · 근태와 다른 칸 표시. 7일 넘게 지난 칸은 못 바꿈.$hdx$),
  (42, '8. 회계 · 인사', 'hra-leave-promo', '연차 사용 촉진 [hra-leave-promo]', $hdx$- 남은 연차 1차 알림 · 직원 계획 · 2차 쓸 날 지정 · 확인 기록(근로기준법 61조 일반 원칙 · 노무 확인 권함). 자동 hra.leave_promo(off).$hdx$),
  (43, '8. 회계 · 인사', 'bzx-hc-sim', '인건비 시뮬레이션 [bzx-hc-sim]', $hdx$- 채용 계획 → 달마다 급여 · 회사 4대보험 · 퇴직금 적립 합계(급여 요율표). 실제 급여 · 장부와 무관.$hdx$),
  (44, '9. 사무', 'hrx-booking', '회의실 · 장비 예약 [hrx-booking]', $hdx$- 자원 · 시간 예약 — 겹치면 DB 가 막음 · 취소는 예약한 사람 · 관리자 · 내 예약은 사내 일정에도.$hdx$),
  (45, '9. 사무', 'ofc-calendar', '사내 일정 [ofc-calendar]', $hdx$- 휴가 · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한을 달 · 주로 모아 봄 · 직접 일정도 넣음.$hdx$),
  (46, '9. 사무', 'ofc-tasks', '업무 요청 [ofc-tasks]', $hdx$- 요청 → 진행 → 완료 칸반 · 기한 지나면 표시 · 운영 알림(ofc.task_due_alert on · 수만).$hdx$),
  (47, '9. 사무', 'ofc-trips', '출장 [ofc-trips]', $hdx$- 출장 신청은 품의 결재 · 다녀온 뒤 여비 정산은 경비 청구로(두 번 청구 막음). 일비 · 식비 · 숙박 상한은 일반 원칙 값(SUPER).$hdx$),
  (48, '9. 사무', 'ofc-notify', '내 알림 [ofc-notify]', $hdx$- 화면을 열어 둔 동안 급한 운영 알림 · 결재 · 업무 요청을 브라우저 알림으로(계정마다 켬 · 브라우저 허락 필요).$hdx$),
  (49, '9. 사무', 'hra-library', '사내 자료실 · 공지 [hra-library]', $hdx$- 운영자만 보는 공지 · 자료 — 권한그룹별 공개 범위 · 꼭 읽기 · 읽음 확인(세무사 빠짐). 기한 지남 알림 hra.lib_unread_alert(off).$hdx$),
  (50, '9. 사무', 'lgl-licenses', '인허가 [lgl-licenses]', $hdx$- 인허가 · 신고 번호 · 기관 · 다음 갱신일 · 서류 · 60 · 30 · 7일 전 운영 알림.$hdx$),
  (51, '9. 사무', 'lgl-reviews', '계약 검토 [lgl-reviews]', $hdx$- 계약서를 올려 검토 요청 → 다른 운영자 의견 → SUPER 승인 · 반려 · 계약 대장과 연결.$hdx$),
  (52, '9. 사무', 'lgl-cases', '소송 · 분쟁 [lgl-cases]', $hdx$- 회사가 당사자인 사건 · 기일 · 대리인 · 비용 · 결과 · 기일 7 · 1일 전 운영 알림.$hdx$),
  (53, '9. 사무', 'lgl-insurance', '회사 보험 [lgl-insurance]', $hdx$- 증권 · 보험료 · 기간 · 만기 30일 전 알림 · 보험료 전표 초안(SUPER 승인).$hdx$),
  (54, '9. 사무', 'sfx-retention', '서류 보관 기한 [sfx-retention]', $hdx$- 인사 · 법무 · 회계 증빙 · 사내 문서 보관 대장 · 만료 전 알림(sfx.retention_alert). 파기는 SUPER 가 「파기」 입력으로 · 기준일부터 맞춤.$hdx$),
  (55, '9. 사무', 'its-assets', 'IT 자산 · 구독 [its-assets]', $hdx$- 프로그램 · 라이선스 · 갱신일 · 달 비용(자금 흐름 예정으로) · 갱신 30 · 7일 전 알림.$hdx$),
  (56, '9. 사무', 'its-suggest', '제안함 [its-suggest]', $hdx$- 업무 · 도구 · 복지 · 안전 제안. 익명이면 쓴 사람 · 시각을 저장하지 않고 접수 번호로 답을 봄.$hdx$),
  (57, '9. 사무', 'its-survey', '사내 설문 [its-survey]', $hdx$- 대상 역할 · 기간 · 익명 설문. 익명 결과는 마감 뒤 응답 3명 이상일 때만 보임.$hdx$),
  (58, '10. 소개몰', 'smq-grades', '판매자 평가 · 패널티 [smq-grades]', $hdx$- 달마다 배송 지연 · 판매자 사정 취소 · 문의 답 늦음 → 등급 · 경고 · 노출 제한 제안(승인). 기준 · 스위치 smq.penalty 는 SUPER(off).$hdx$),
  (59, '10. 소개몰', 'smx-remote', '도서산간 배송비 [smx-remote]', $hdx$- 우편번호 구역마다 추가 배송비를 주문에 더함 · 입점 몫은 판매자 정산. 스위치 smx.remote_ship(off).$hdx$),
  (60, '10. 소개몰', 'lsq-track', '배송 추적 [lsq-track]', $hdx$- 배송중 송장을 택배사 조회로 묻고 단계를 쌓음. 스위치 lsq.track(off) · 방식 ASSUME — 간주 결과로는 주문을 안 바꿈.$hdx$),
  (61, '10. 소개몰', 'lsq-return-ev', '반품 사진 · 판정 [lsq-return-ev]', $hdx$- 반품 · 교환 사진과 판정 기록. 승인 · 환불은 기존 화면. 사진 lsq.return_photos 는 처리방침 1.2 뒤(off).$hdx$),
  (62, '10. 소개몰', 'qlt-lots', '로트 · 유통기한 [qlt-lots]', $hdx$- 입고를 로트(제조일 · 유통기한)로 나누고 먼저 끝나는 로트부터 출고 · 임박 알림(qlt.expiry_alert on · 30일).$hdx$),
  (63, '10. 소개몰', 'mob-scan', '휴대폰 실사 [mob-scan]', $hdx$- 휴대폰 카메라(바코드 · QR) 또는 손 입력으로 로트 재고를 셈 · 차이 조정은 SUPER · 자산 QR 도 읽음.$hdx$),
  (64, '10. 소개몰', 'qlt-claims', '품질 클레임 [qlt-claims]', $hdx$- 불량 접수 → 확인 → 조치 → 끝냄. 상품 · 로트 · 공급사 · 주문을 잇고 공급사 반품은 재고 · 전표에 같이.$hdx$),
  (65, '10. 소개몰', 'qlt-supeval', '협력사 평가 [qlt-supeval]', $hdx$- 매입처를 분기마다 납기 · 품질 · 가격 · 대응으로 매겨 등급. 확정한 평가는 고치지 않음.$hdx$),
  (66, '10. 소개몰', 'slx-statements', '판매자 월 정산서 [slx-statements]', $hdx$- 입점 판매자 주 정산서를 달마다 한 장 · 인쇄(PDF) · 메일 mall.statement_mail(off · 같은 달 한 번).$hdx$),
  (67, '10. 소개몰', 'smx-replies', '리뷰 답글 [smx-replies]', $hdx$- 직판 리뷰에 운영 답글 · 입점 판매자 답글 보이기 · 가리기(리뷰마다 하나). 스위치 smx.review_reply(off).$hdx$),
  (68, '10. 소개몰', 'smq-qna', '상품 문의 답 관리 [smq-qna]', $hdx$- 상품 문의 답 기한 · 넘김 · 금칙어. 입점 상품은 판매자센터에서 판매자가 답함. 스위치 smq.qna(off · 처리방침 확인 권함).$hdx$),
  (69, '10. 소개몰', 'slx-review-points', '리뷰 적립 [slx-review-points]', $hdx$- 구매확정 직판 리뷰에 적립금(주문 하나에 한 번 · 지우면 회수). 스위치 mall.review_points 와 적립금 mall.points 둘 다 on 이어야.$hdx$),
  (70, '10. 소개몰', 'hlt-points', '적립금 [hlt-points]', $hdx$- 구매확정 때 쌓이고 직판 주문에 씀 · 남은 합 · 곧 소멸 · 운영 지급 · 회수. 스위치 mall.points(off).$hdx$),
  (71, '10. 소개몰', 'hlt-tiers', '회원 등급 [hlt-tiers]', $hdx$- 기간 구매액으로 매일 05:20 등급 · 등급 적립률. 스위치 mall.tiers(off · 적립금 켠 뒤).$hdx$),
  (72, '10. 소개몰', 'hlt-subscribe', '정기 배송 [hlt-subscribe]', $hdx$- 회원 주기로 주문 · 정기 결제. 스위치 mall.subscribe(off) · 방식 ASSUME(청구 없음) · 주문 받기 켠 뒤.$hdx$),
  (73, '10. 소개몰', 'lsq-sub-retry', '정기 배송 결제 다시 시도 [lsq-sub-retry]', $hdx$- 결제 실패한 정기 배송 다시 시도 간격(1 · 3 · 5일) · 회원 알림 · 「지금 다시 결제」. 스위치 lsq.sub_retry(off).$hdx$),
  (74, '10. 소개몰', 'hlt-giftcards', '상품권 [hlt-giftcards]', $hdx$- 판매 · 판촉 상품권 발행(코드는 한 번만 보임) · 잔액 · 무효 · 환불. 스위치 mall.giftcard(off).$hdx$),
  (75, '10. 소개몰', 'hlt-coupons', '쿠폰 · 기획전 [hlt-coupons]', $hdx$- 정액 · 정률 쿠폰과 기획전 — 직판 주문만 · 취소 · 반품되면 되돌림. 스위치 mall.coupon(off · 꺼져도 만들기는 됨).$hdx$),
  (76, '10. 소개몰', 'smx-bundles', '묶음 할인 [smx-bundles]', $hdx$- 직판 옵션 여럿을 묶음가 하나로 · 하나라도 품절이면 묶음도 품절 · 반품은 묶음 단위. 스위치 smx.bundle(off).$hdx$),
  (77, '10. 소개몰', 'hlt-restock', '재입고 알림 [hlt-restock]', $hdx$- 품절 옵션의 「입고되면 알림」 신청 — 재고가 다시 늘면 한 번. 스위치 mall.restock_alert(off).$hdx$),
  (78, '10. 소개몰', 'hlt-cashrcpt', '현금영수증 [hlt-cashrcpt]', $hdx$- 직판 계좌이체 · 가상계좌 현금영수증 발급 · 취소. 스위치 mall.cash_receipt(off · SUPER) · 방식 ASSUME · 세무사 · PG 확인 뒤.$hdx$),
  (79, '10. 소개몰', 'mkx-rebuy', '재구매 알림 [mkx-rebuy]', $hdx$- 상품별 사용 일수로 재구매 시기에 한 번 알림(마케팅 동의자만 · 하루 한 통). 스위치 mkx.rebuy(off).$hdx$),
  (80, '10. 소개몰', 'mkx-groupbuy', '공동구매 [mkx-groupbuy]', $hdx$- 옵션 하나 · 목표 인원 · 기한 · 할인가 · 못 모이면 참여 주문 취소 신청. 스위치 mkx.groupbuy(off).$hdx$),
  (81, '11. 회원', 'mtr-trust', '소개자 신뢰 점수 [mtr-trust]', $hdx$- 인증 · 성사 · 후기 · 응답 · 인정된 신고로 0 ~ 100점. 노출 순위 · 소개비에 안 씀. 스위치 mtr.trust(off · 법무 확인).$hdx$),
  (82, '11. 회원', 'mtr-dormant', '휴면 계정 [mtr-dormant]', $hdx$- 오래 안 들어온 회원에게 미리 알리고 기간이 지나면 이름 · 전화를 따로 보관 · 로그인하면 풀림. mtr.dormant(off · 법무 확인 필요).$hdx$),
  (83, '11. 회원', 'bzx-cs-quality', '답변 품질 [bzx-cs-quality]', $hdx$- 1:1 문의 상담원별 답한 수 · 첫 답 시간 · 기한 안 · 해결률 · 다시 열림 · 다른 운영자가 표본 점검.$hdx$),
  (84, '11. 회원', 'csx-aidraft', 'AI 답변 초안 [csx-aidraft]', $hdx$- 1:1 문의 AI 초안(회원에게 안 보임 · 고쳐 보냄). 스위치 csx.ai_draft · 자동 csx.ai_draft_auto(off · AI 월 상한 안).$hdx$),
  (85, '11. 회원', 'csx-churn', '이탈 위험 신호 [csx-churn]', $hdx$- 최근 30일 활동이 크게 준 회원(운영 안에서만). 재방문 안내는 마케팅 동의자에게 캠페인으로. 스위치 csx.churn(off).$hdx$),
  (86, '11. 회원', 'csx-mailtpl', '메일 문구 [csx-mailtpl]', $hdx$- 메일 제목 · 본문 고치기 · 자리값 검사 · 미리보기 · 되돌리기. 스위치 csx.mail_templates 가 꺼지면 코드 기본 글자.$hdx$),
  (87, '11. 회원', 'csx-merge', '계정 합치기 [csx-merge]', $hdx$- 본인인증이 같은 두 계정을 하나로 — 요청 → 다른 SUPER 승인 · 되돌릴 수 없음. 스위치 csx.account_merge(off).$hdx$),
  (88, '11. 회원', 'mbx-ops', '회원 편의 기능 [mbx-ops]', $hdx$- 최근 본 · 비교 · 가격 변동 알림 · 회원 간 대화 스위치(mbx.* · 모두 off · SUPER) · 보관 일수.$hdx$),
  (89, '11. 회원', 'mbx-dm', '회원 대화 신고 [mbx-dm]', $hdx$- 신고된 회원 대화만 엶 — 열 때마다 사유 · 개인정보 접속기록에 남음 · 조치하면 대화를 닫음.$hdx$),
  (90, '11. 회원', 'grw-ops', '회원 성장 [grw-ops]', $hdx$- 가입 퍼널 · 첫 거래 안내 · 알림 하루 요약 · 여러 단계 추천 보상(법무 확인 필요) · 매물 충실도(노출 순위에 안 씀).$hdx$),
  (91, '11. 회원', 'opx-bulk', '일괄 처리 [opx-bulk]', $hdx$- 검수 · 신고 · 문의 · 회원을 여러 줄 골라 한 번에(최대 100 · 사유 필수) · 감사 기록은 줄마다.$hdx$),
  (92, '11. 회원', 'mkt-campaign', '문자 · 메일 캠페인 [mkt-campaign]', $hdx$- 마케팅 동의자에게만(밤은 야간 동의자만) · (광고) · 수신 거부는 서버가 붙임. campaign.enabled(off) · 방식 ASSUME.$hdx$),
  (93, '11. 회원', 'opz-newsletter', '월간 뉴스레터 [opz-newsletter]', $hdx$- 공지 · 인기 매물 · 이벤트로 초안 · 미리보기 · 나에게 시험 → SUPER 가 보냄(캠페인 길). 스위치 opz.nl_enabled(off).$hdx$),
  (94, '11. 회원', 'soc-login', '간편 로그인 [soc-login]', $hdx$- 카카오 · 네이버 로그인(off · 간주). 같은 이메일도 저절로 합치지 않고 운영 계정은 못 씀. LIVE 는 키 · 처리방침(social.privacy_ok) 뒤.$hdx$),
  (95, '11. 회원', 'mkx-sms', '문자 마케팅 [mkx-sms]', $hdx$- 소개몰 대상 고르기 · 7일 상한 · 080 수신 거부 · 예상 비용. 보내기는 문자 · 메일 캠페인에서.$hdx$),
  (96, '11. 회원', 'mkx-push', '웹 푸시 [mkx-push]', $hdx$- 회원 알림을 브라우저 푸시로(기기마다 회원이 켬). push.enabled · push.send(off) · 방식 ASSUME · 처리방침 뒤.$hdx$),
  (97, '12. 노출 · 관 관리 · 광고', 'prx-popup', '메인 팝업 [prx-popup]', $hdx$- 사용자 웹 메인 팝업 — 기간 · 대상 · 순서(한 번에 3개까지). 「오늘 하루 안 보기」는 회원 브라우저에만.$hdx$),
  (98, '12. 노출 · 관 관리 · 광고', 'i18n-review', '일본어 · 중국어 검수 [i18n-review]', $hdx$- 기계 번역 초안을 검수자가 고치고 승인해야 그 언어를 켤 수 있음.$hdx$),
  (99, '12. 노출 · 관 관리 · 광고', 'sfx-tm', '번역 메모리 [sfx-tm]', $hdx$- 승인된 번역을 다시 써서 엔진 호출을 줄임(사람이 고친 것 먼저). 스위치 sfx.tm(off · 자동 번역을 쓸 때).$hdx$),
  (100, '12. 노출 · 관 관리 · 광고', 'prx-adreport', '광고 성과 보고서 [prx-adreport]', $hdx$- 광고주별 노출 · 클릭 · 광고비(일 · 주 · 달) · 인쇄 PDF · 메일 prx.ad_report_mail(off).$hdx$),
  (101, '12. 노출 · 관 관리 · 광고', 'prx-adab', '광고 소재 비교 [prx-adab]', $hdx$- 소재 둘을 번갈아 내고 기간 끝에 클릭률 비교(소재마다 1,000 노출부터 판정). 「광고」 표기 그대로.$hdx$),
  (102, '12. 노출 · 관 관리 · 광고', 'bzx-ad-budget', '광고 예산 [bzx-ad-budget]', $hdx$- 소재별 노출 · 클릭 상한 · 알림 기준. 자동 정지 bzx.ad_autopause(off)는 고른 소재만 · 알림만 며칠 본 뒤.$hdx$),
  (103, '13. 위험감지', 'opx-risk', '이상 거래 점수 [opx-risk]', $hdx$- 새 계정 · 매물 몰림 · 같은 연락처 · 신고 등 규칙 점수 합 · 60 이상이면 검수 대기 · 알림. 막지 않고 회원에게 안 보임(opx.risk_score on).$hdx$),
  (104, '13. 위험감지', 'sfx-device', '같은 기기 여러 계정 [sfx-device]', $hdx$- 기기 표지(무작위 값의 해시)로 같은 브라우저 여러 계정 경보 · 자동 정지 없음. 스위치 sfx.device_watch(off · 처리방침 뒤).$hdx$),
  (105, '13. 위험감지', 'opb-alert-routes', '알림 받을 사람 규칙 [opb-alert-routes]', $hdx$- 알림 종류마다 길 · 급함 기준 · 묶음 간격 · 권한그룹. 처음 값 = 지금 동작. 규칙 쓰기 opb.alert_routes(off · SUPER).$hdx$),
  (106, '13. 위험감지', 'lsy-triage', '신고 분류 [lsy-triage]', $hdx$- 열린 신고에 종류 · 급함 제안 → 사람이 확정 · 처리는 신고 처리에서. 규칙 lsy.report_triage · AI lsy.report_ai(처리방침 뒤).$hdx$),
  (107, '13. 위험감지', 'mtr-appeals', '이의 제기 [mtr-appeals]', $hdx$- 신고로 내려간 글 · 매물 작성자의 이의(대상마다 한 번)를 다시 판단. 받아들이면 글은 다시 보이고 매물은 검수 대기 · 그 신고는 기각. 스위치 mtr.appeal(off).$hdx$),
  (108, '13. 위험감지', 'mtr-reviews', '가짜 후기 의심 [mtr-reviews]', $hdx$- 같은 기기 · 몰림 · 비슷한 문장 · 거래 없음 · 새 계정 신호로 잡은 후기 · 자동 삭제 없음. 스위치 mtr.review_watch(off).$hdx$),
  (109, '13. 위험감지', 'opx-archive', '기록 장기 보관 [opx-archive]', $hdx$- 감사 · 접속기록 · 알림 · 설정 기록을 달마다 묶어 3년 보관 · 복원 확인. 스위치 opx.archive(off) · S3 는 opx.archive_s3.$hdx$),
  (110, '13. 위험감지', 'upt-status', '가동 · 장애 공지 [upt-status]', $hdx$- n8n 바깥 감시 결과 · 가동률 · 장애 공지(사용자 웹 띠 · /status). 연속 실패면 긴급 알림 · 결과 받기 uptime.report(off · 토큰).$hdx$),
  (111, '13. 위험감지', 'opz-incident', '장애 대응 [opz-incident]', $hdx$- 런북을 골라 장애를 열면 당번에게 알림 · 단계 체크 · 기록 · 되돌아보기. opz.ir_enabled(off) · 연습도 알림이 감.$hdx$),
  (112, '13. 위험감지', 'web-vitals', '화면 속도 [web-vitals]', $hdx$- 사용자 웹 화면별 LCP · INP · CLS(주소 · 값만). 스위치 ops2.web_vitals(off · 처리방침 1.2 뒤 SUPER).$hdx$),
  (113, '14. 소개광장 · 제휴 · 통합 현황', 'plz-rank', '활동 배지 · 랭킹 [plz-rank]', $hdx$- 소개광장 글 · 답변 · 도움돼요 점수로 달마다 순위 · 배지(숨김 · 신고 글 뺌). 스위치 plaza.ranking(off).$hdx$),
  (114, '14. 소개광장 · 제휴 · 통합 현황', 'prx-refevent', '추천 이벤트 [prx-refevent]', $hdx$- 기간 동안 직접 추천 보상 점수만 바꿈 · 예산 · 기간 끝나면 평소대로. prx.ref_event(off) · 약관 · 문구 확인 뒤 SUPER.$hdx$),
  (115, '14. 소개광장 · 제휴 · 통합 현황', 'site-usage', '화면 사용 통계 [site-usage]', $hdx$- 사용자 웹 화면별 보기 · 이탈 · 전환(주소 묶음 수만). 스위치 site.usage_stats(off · 처리방침 뒤 SUPER).$hdx$),
  (116, '14. 소개광장 · 제휴 · 통합 현황', 'bi-export', '통계 내보내기(BI) [bi-export]', $hdx$- 개인 식별 없는 일별 집계 표 · CSV(내려받기 승인 · 3 미만 칸 가림) · BI 읽기 계정은 서버에서 사람이 만듦.$hdx$),
  (117, '15. 직원 · 권한', 'staff-list', '운영자 목록 [staff-list]', $hdx$- 운영 역할 있는 계정만 — 연결 직원 · 역할 · 기한 · 2단계 · 마지막 로그인. 운영자 정지는 SUPER 만.$hdx$),
  (118, '15. 직원 · 권한', 'staff-cases', '입사 · 퇴사 [staff-cases]', $hdx$- 입사(대장 → 초대 → 권한 → 계약 → 교육) · 퇴사(권한 거두기 → 장비 → 퇴직금 → 서류) 할 일 · 끝날 때까지 운영 알림.$hdx$),
  (119, '15. 직원 · 권한', 'perm-staff', '사원 권한 [perm-staff]', $hdx$- 사원마다 권한그룹 · 기한 · 개별 더하기 · 빼기 · 실제 권한 미리보기. 함께 못 갖는 조합은 저장 안 됨(SUPER).$hdx$),
  (120, '15. 직원 · 권한', 'perm-roles', '권한그룹 [perm-roles]', $hdx$- 업무그룹 × 수준(보기 · 고치기 · 승인 · 내려받기)으로 만들고 업무 하나씩 더하기 · 빼기(SUPER).$hdx$),
  (121, '15. 직원 · 권한', 'perm-groups', '업무그룹 [perm-groups]', $hdx$- 업무 묶음 — 업무 하나가 여러 그룹에 들 수 있음 · 처음 그룹은 지우지 않고 끄기만(SUPER).$hdx$),
  (122, '15. 직원 · 권한', 'perm-tasks', '업무 목록 [perm-tasks]', $hdx$- 업무 = 탭 하나 · 수준 · 켜기 · 주소 연결 수 · 업무에 없는 탭 표시(SUPER). 판정 방식은 perm.mode(처음 ROLE).$hdx$),
  (123, '15. 직원 · 권한', 'perm-review', '거둘 후보 [perm-review]', $hdx$- 분기마다 퇴사자 · 오래 안 씀 · 기한 없는 외부 계정 권한을 모음 → SUPER 가 사유와 함께 거둠(prr.review_auto on).$hdx$),
  (124, '15. 직원 · 권한', 'perm-log', '바뀐 기록 [perm-log]', $hdx$- 역할 주기 · 거두기와 권한그룹 · 업무그룹 · 사원 권한 · 판정 방식 바꾼 기록(고칠 수 없음).$hdx$)
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
  /* 묶음 제목(## …) 몫을 먼저 빼고(모두 붙는다고 보고) 남는 자리 */
  SELECT 20000 - char_length(rtrim(c.body, E'\n')) - 3
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
       '새 탭 설명 더함(v10.616 · docs/758)'
  FROM cur c, add_text a
 WHERE a.t IS NOT NULL;

/* 탭 → 절 잇기 — 지금 판(방금 더한 판 포함)의 「### 제목 [탭 키]」 줄 가운데 첫 줄(HelpService.sections 의 find 와 같음) */
INSERT INTO public.sec2_tab_help (tab_key, doc_code, heading)
SELECT DISTINCT ON (x.k) x.k, 'ADMIN_GUIDE', x.h
  FROM (
    SELECT l.n, (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[1] AS h,
                (regexp_match(l.line, '^###\s+(.*\[([a-z][a-z0-9-]{1,39})\])\s*$'))[2] AS k
      FROM public.v_help_doc_current c,
           LATERAL regexp_split_to_table(c.body, E'\n') WITH ORDINALITY AS l(line, n)
     WHERE c.code = 'ADMIN_GUIDE'
  ) x
 WHERE x.k = ANY (ARRAY['opb-glance', 'lsx-expiry', 'lsx-bump', 'lsx-summary', 'lsx-saved', 'vsx-visits', 'vsx-map', 'lpx-offers', 'lpx-photo', 'lpx-away', 'lpx-stats', 'lsq-bulk', 'lsq-review-ask', 'lsq-search-click', 'lsq-region', 'lsy-dups', 'lsy-photos', 'lsy-videos', 'bzx-ptn-contract', 'ptn-openapi', 'vsx-papi-bill', 'vsx-ptn-export', 'ptn-bulk', 'slx-ptn-perf', 'acct-close-check', 'acct-cashplan', 'acct-reorder', 'acct-vehicle', 'acct-exemptinv', 'bzx-card-notice', 'acct-bankfeed', 'sal-crm', 'hrx-stocktake', 'hr-card', 'hra-payfile', 'hr-training', 'hr-contract', 'hr-review', 'hr-recruit', 'hrx-overtime', 'hrx-shifts', 'hra-leave-promo', 'bzx-hc-sim', 'hrx-booking', 'ofc-calendar', 'ofc-tasks', 'ofc-trips', 'ofc-notify', 'hra-library', 'lgl-licenses', 'lgl-reviews', 'lgl-cases', 'lgl-insurance', 'sfx-retention', 'its-assets', 'its-suggest', 'its-survey', 'smq-grades', 'smx-remote', 'lsq-track', 'lsq-return-ev', 'qlt-lots', 'mob-scan', 'qlt-claims', 'qlt-supeval', 'slx-statements', 'smx-replies', 'smq-qna', 'slx-review-points', 'hlt-points', 'hlt-tiers', 'hlt-subscribe', 'lsq-sub-retry', 'hlt-giftcards', 'hlt-coupons', 'smx-bundles', 'hlt-restock', 'hlt-cashrcpt', 'mkx-rebuy', 'mkx-groupbuy', 'mtr-trust', 'mtr-dormant', 'bzx-cs-quality', 'csx-aidraft', 'csx-churn', 'csx-mailtpl', 'csx-merge', 'mbx-ops', 'mbx-dm', 'grw-ops', 'opx-bulk', 'mkt-campaign', 'opz-newsletter', 'soc-login', 'mkx-sms', 'mkx-push', 'prx-popup', 'i18n-review', 'sfx-tm', 'prx-adreport', 'prx-adab', 'bzx-ad-budget', 'opx-risk', 'sfx-device', 'opb-alert-routes', 'lsy-triage', 'mtr-appeals', 'mtr-reviews', 'opx-archive', 'upt-status', 'opz-incident', 'web-vitals', 'plz-rank', 'prx-refevent', 'site-usage', 'bi-export', 'staff-list', 'staff-cases', 'perm-staff', 'perm-roles', 'perm-groups', 'perm-tasks', 'perm-review', 'perm-log']::text[])
   AND char_length(x.h) <= 120
 ORDER BY x.k, x.n
ON CONFLICT (tab_key) DO NOTHING;

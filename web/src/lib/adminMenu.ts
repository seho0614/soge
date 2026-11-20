/**
 * 운영 화면 메뉴 (v10.29).
 *
 * 시안(운영 화면 admNav)은 어두운 상단바에 **묶음 메뉴 20개**를 둡니다. 개발은 탭 44개를 흰 바에 3줄로
 * 늘어놓았습니다(높이 188). 탭은 그대로 두고(키 · 글자 · 권한 · 화면 모두 같음) 시안의 묶음 아래로 모읍니다.
 *   · 상단바(.bo-head nav) = 묶음. 누르면 그 묶음에서 볼 수 있는 첫 탭으로 갑니다.
 *   · 본문 위 줄(.ad-snb) = 그 묶음의 탭(시안 .tabs2 모양). 탭이 하나뿐인 묶음은 줄을 그리지 않습니다.
 *   · 탭 안의 하위 탭(.subtabs)은 그대로입니다.
 * 시안 묶음에 없는 탭은 가장 가까운 묶음에 두었습니다(diffs/admin.json 「개발에만있음」).
 * 시안의 「관 분리」 · 「서버 연동」은 개발에 맞는 탭이 없어 두지 않습니다(빈 메뉴를 만들지 않음 — diffs 기록).
 */

export const TABS = [
  ['home', '대시보드'],
  ['reports', '경영 지표'],
  ['report-queue', '신고 처리'],
  ['events', '이벤트'],
  ['ai-ops', 'AI 운영'],
  ['ad-billing', '광고 과금'],
  ['prx-popup', '메인 팝업'], ['prx-refevent', '추천 이벤트'], ['prx-adreport', '광고 성과 보고서'], ['prx-adab', '광고 소재 비교'],   /* v10.517 ~ 520 (D277 · docs/655 ~ 658) 회원 · 광고 */
  ['collect', '수집 관리'],
  ['queue', '검수 큐'],
  ['badges', '배지 신청'],
  ['lpx-offers', '매물 가격 제안'], ['lpx-photo', '매물 사진 워터마크'], ['lpx-away', '판매자 자리 비움'], ['lpx-stats', '지역별 시세 통계'],   /* v10.549 ~ 552 (D286 · docs/687 ~ 690) (56) 매물 3 */
  ['lsx-expiry', '매물 만료 · 연장'], ['lsx-bump', '끌어올리기'], ['lsx-summary', '매물 AI 요약'], ['lsx-saved', '저장한 검색'],   /* v10.513 ~ 516 (D276 · docs/651 ~ 654) ㊻ 매물 */
  ['lsy-dups', '매물 중복 의심'], ['lsy-photos', '사진 품질'], ['lsy-videos', '매물 동영상'], ['lsy-triage', '신고 분류'],   /* v10.524 ~ 527 (D279 · docs/662 ~ 665) ㊾ 매물 2 */
  ['audit', '표본 감사'],
  ['rules', '자동검수 규칙'],
  ['disputes', '분쟁'],
  ['category', '업종 승인'],
  ['members', '회원'],
  ['users', '사업자 인증'],
  ['inquiries', '1:1 문의'],   /* v10.333 (D225) — 고객센터 문의 답변함 */
  ['mkt-campaign', '문자 · 메일 캠페인'],   /* v10.483 (D268 · docs/621) — 마케팅 동의자만 · 야간 동의 · (광고) · 수신 거부 */
  ['mkx-push', '웹 푸시'], ['mkx-sms', '문자 마케팅'], ['mkx-rebuy', '재구매 알림'], ['mkx-groupbuy', '공동구매'],   /* v10.538 ~ 541 (D283 · docs/676 ~ 679) */
  ['mbx-ops', '회원 편의 기능'], ['mbx-dm', '회원 대화 신고'],   /* v10.501 ~ 504 (D273 · docs/639 ~ 642) 최근 본 · 비교 · 가격 알림 · 회원 대화 */
  ['csx-aidraft', 'AI 답변 초안'], ['csx-churn', '이탈 위험 신호'], ['csx-mailtpl', '메일 문구'], ['csx-merge', '계정 합치기'],   /* v10.528 ~ 531 (D280 · docs/666 ~ 669) ㊿ 고객센터 · 회원 */
  ['community', '글 검수'],
  ['polls', '이건 어때? 투표'],
  ['ownership', '소유 확인'],
  ['deals', '거래 모니터링'],
  ['settlement', '정산'],
  ['payouts', '지급'],
  ['hlt-sellers', '소개몰 판매자'],   // v10.224 (D194) — 입점 심사 · 판매자 관리(정산에서 나눔 · ADMIN · SUPER)
  ['hlt-settle', '소개몰 정산'],
  ['hlt-products', '소개몰 상품'],
  ['hlt-orders', '소개몰 주문'],
  ['hlt-open', '개봉 반품 재고'],   // v10.208 (D185)
  ['qlt-lots', '로트 · 유통기한'], ['qlt-claims', '품질 클레임'], ['qlt-supeval', '협력사 평가'],   // v10.494 ~ 496 (D271 · docs/632 ~ 634)
  ['hlt-reviews', '소개몰 리뷰 · 문의'],
  ['hlt-points', '적립금'], ['hlt-tiers', '회원 등급'], ['hlt-subscribe', '정기 배송'], ['hlt-giftcards', '상품권'],   // v10.479 ~ 482 (D267 · docs/617 ~ 620)
  ['hlt-coupons', '쿠폰 · 기획전'],   // v10.469 (D264 · docs/607)
  ['smx-bundles', '묶음 할인'], ['smx-remote', '도서산간 배송비'], ['smx-replies', '리뷰 답글'],   // v10.553 ~ 555 (D287 · docs/691 ~ 693)
  ['hlt-restock', '재입고 알림'], ['hlt-cashrcpt', '현금영수증'], ['plz-rank', '활동 배지 · 랭킹'], ['site-usage', '화면 사용 통계'],   // v10.505 ~ 508 (D274 · docs/643 ~ 646)
  ['bi-export', '통계 내보내기(BI)'], ['mob-scan', '휴대폰 실사'],   // v10.535 · 537 (D282 · docs/673 · 675)
  ['billing', '청구'],
  ['checklist', '오픈 체크리스트'],
  ['policy', '정책'],
  ['settings', '전체 설정'],   /* v10.287 (D214) 사이트 설정 모두 · 바뀐 기록 */
  ['siteinfo', '법정 고지'],
  ['terms', '약관'],   /* v10.161 — 법정 고지 맨 아래 「약관」 구역을 메뉴 하나로도(같은 화면 부품 · SB-ADM-SIT-070) */
  ['manual', '사용자 설명서'],   /* v10.203 (D180) — 회원용 설명서 · AI 상담 참고 자료 */
  ['faq', '자주 묻는 질문'],   /* v10.332 (D224) — 고객센터 · 이용안내 · 챗봇 질문 글 관리 */
  ['ops-guide', '업무 안내'],   /* v10.339 (D229) — 운영진 업무 순서 · 그 화면 단추 */
  ['guide-flows', '이용 흐름'],   /* v10.347 (D233) — 사용자 웹 이용안내 「일곱 가지 흐름」 글 */
  ['i18n', '번역'],   /* v10.93 다국어 1단계(D115 · docs/150) */
  ['integrations', '외부 연동'],
  ['mainops', '메인 운영'],
  ['gwans', '관 관리'],
  ['hub', '통합 허브'],
  ['partners', '파트너'],
  ['partner-axes', '안심소개 입점 심사'],
  ['directory', '법률·세무 정액 노출'],
  ['ptn-openapi', '오픈 API'], ['ptn-bulk', '직원 일괄 등록'],   /* v10.521 · 522 (D278 · docs/659 · 660) */
  ['vsx-visits', '매물 방문 예약'], ['vsx-map', '지도 매물 묶음'], ['vsx-papi-bill', '오픈 API 사용량 · 청구'], ['vsx-ptn-export', '파트너 자료 내려받기'],   /* v10.542 ~ 545 (D284 · docs/680 ~ 683) */
  ['slx-statements', '판매자 월 정산서'], ['slx-review-points', '리뷰 적립'], ['slx-ptn-perf', '파트너 성과'],   /* v10.532 ~ 534 (D281 · docs/670 ~ 672) */
  ['i18n-review', '일본어 · 중국어 검수'],   /* v10.523 (D278 · docs/661) */
  ['affiliates', '제휴'],
  ['quals', '자격 심사'],
  ['risk', '위험감지'],
  ['ops-alerts', '운영 알림'],   /* v10.179 (D168) */
  ['pii-review', '개인정보 접속기록'],   /* v10.179 (D168) — SUPER */
  ['role-review', '운영자 권한'],   /* v10.180 (D169) — SUPER */
  ['purge-log', '파기 기록'],   /* v10.180 (D169) */
  ['privacy-requests', '권리 요청'],   /* v10.181 (D170) */
  ['server-errors', '서버 오류'],   /* v10.182 (D171) */
  ['sec-geo', '해외 접속 경고'],   /* v10.485 (D268 · docs/623) — 운영자 로그인 나라 · 허용 나라 밖 경고 · 막기 */
  ['opx-archive', '기록 장기 보관'], ['opx-risk', '이상 거래 점수'], ['opx-bulk', '일괄 처리'], ['opx-switches', '기능 스위치 한눈에'],   /* v10.509 ~ 512 (D275 · docs/647 ~ 650) */
  ['sfx-device', '같은 기기 여러 계정'], ['sfx-retention', '서류 보관 기한'], ['sfx-tm', '번역 메모리'],   /* v10.546 ~ 548 (D285 · docs/684 ~ 686) */
  ['upt-status', '가동 · 장애 공지'], ['soc-login', '간편 로그인'],   /* v10.497 · 498 (D272 · docs/635 · 636) — 바깥 감시 · 장애 공지 띠 / 카카오 · 네이버 로그인 */
  ['opz-newsletter', '월간 뉴스레터'], ['opz-incident', '장애 대응'],   /* v10.556 · 557 (D288 · docs/694 · 695) */
  ['ops-board', '운영자 게시판'],   /* v10.286 (D213) */
  ['my-mfa', '내 2단계 인증'],   /* v10.180 (D169) — 운영 역할 모두 */
  ['my-password', '내 비밀번호'],   /* v10.369 (docs/504) — 운영 역할 모두(회원 역할 없어도) */
  ['acct-journal', '전표'],   /* v10.382 (D242 · docs/518) 회계 — 자동 전표 · 월 마감 */
  ['acct-tax', '신고 자료'],   /* v10.383 (docs/519) 부가세 · 원천세 · 세금계산서 */
  ['acct-report', '경영 보고서'],   /* v10.384 (docs/520) */
  ['acct-accounts', '계정 · 규칙'],   /* v10.381 (docs/517) 계정 코드 · 전표 규칙 · 상품 과세 */
  ['acct-month', '월 결산'],   /* v10.390 (D244 · docs/527) 월 결산 요약 · 신고 기한 */
  ['acct-bank', '은행 맞추기'],   /* v10.388 (D244 · docs/525) 통장 거래 내역 ↔ 전표 */
  ['acct-purchase', '매입'],   /* v10.392 (D245 · docs/529) 매입 세금계산서 · 카드 · 현금영수증 · 간이영수증 */
  ['acct-expense', '경비 청구'],   /* v10.393 (D245 · docs/530) 경비 청구 · 법인카드 */
  ['acct-cash', '자금 흐름'],   /* v10.394 (D245 · docs/531) */
  ['acct-stock', '재고'],   /* v10.395 (D245 · docs/532) 직판 재고 수불부 */
  ['acct-statements', '재무제표'],   /* v10.396 (D246 · docs/533) 시산표 · 손익 · 재무상태표 · 기초 잔액 */
  ['acct-ledger', '원장'],   /* v10.397 (D246 · docs/534) 계정별 원장 · 매입매출장 */
  ['acct-assets', '고정자산'],   /* v10.398 (D246 · docs/535) */
  ['hrx-overtime', '연장 근로'], ['hrx-shifts', '근무표'], ['hrx-booking', '회의실 · 장비 예약'], ['hrx-stocktake', '자산 실사'],   /* v10.471 ~ 474 (D265 · docs/609 ~ 612) 인사 4 */
  ['acct-budget', '예산'],   /* v10.399 (D246 · docs/536) */
  ['acct-vatform', '부가세 신고서'],   /* v10.400 (D247 · docs/537) */
  ['acct-aging', '기간 분석'],   /* v10.401 (D247 · docs/538) */
  ['acct-yearclose', '해 마감'],   /* v10.402 (D247 · docs/539) */
  ['acct-payroll', '급여'],   /* v10.403 (D247 · docs/540) */
  ['acct-whtreturn', '원천세 신고서'],   /* v10.420 (D252 · docs/557) */
  ['acct-wagestmt', '지급명세서'],   /* v10.421 (D252 · docs/558) */
  ['acct-insurance', '4대보험 신고'],   /* v10.422 (D252 · docs/559) */
  ['acct-pg', 'PG 정산'],   /* v10.404 (D248 · docs/541) */
  ['acct-manual', '수동 전표'],   /* v10.405 (D248 · docs/542) */
  ['acct-severance', '퇴직금 · 연차'],   /* v10.406 (D248 · docs/543) */
  ['acct-corptax', '법인세 추정'],   /* v10.407 (D248 · docs/544) */
  ['acct-parties', '거래처'],   /* v10.408 (D249 · docs/545) */
  ['acct-contracts', '계약'],   /* v10.409 (D249 · docs/546) */
  ['acct-requisitions', '품의'],   /* v10.410 (D249 · docs/547) */
  ['acct-imports', '수입'],   /* v10.411 (D249 · docs/548) */
  ['acct-docs', '견적 · 명세서'],   /* v10.433 (D256 · docs/570) 견적서 · 주문서 · 거래명세서 · 발주서 인쇄 */
  ['acct-depts', '부서 손익'],   /* v10.434 (D256 · docs/571) 부서 · 프로젝트별 손익 */
  ['acct-wh', '창고 · 바코드'],   /* v10.435 (D256 · docs/572) */
  ['acct-dunning', '미수금 독촉'],   /* v10.436 (D256 · docs/573) */
  ['acct-taxinbox', '세금계산서 받기'],   /* v10.432 (D255 · docs/569) 매입 세금계산서 가져오기 */
  ['acct-accountant', '세무사'],   /* v10.437 (D257 · docs/574) 세무사 공유 계정 */
  ['acct-receipt', '영수증 읽기'],   /* v10.438 (D257 · docs/575) */
  ['acct-accrual', '고정비'],   /* v10.439 (D257 · docs/576) */
  ['acct-archive', '장부 보관 · 통제'],   /* v10.440 (D257 · docs/577) */
  ['acct-cardlimit', '법인카드 한도'], ['fin-transfer', '대량 이체'], ['acct-target', '매출 목표'], ['acct-partyledger', '거래처 원장'],   /* v10.453 ~ 456 (D261 · docs/590 ~ 593) 자금 · 영업 */
  ['sal-crm', '영업 기회'], ['acct-bankfeed', '은행 자동 조회'],   /* v10.466 · 467 (D264 · docs/604 · 605) */
  ['acct-daybook', '분개장'], ['acct-cashbook', '현금출납장'], ['acct-fxreval', '외화 환산'],   /* v10.449 ~ 452 (D260 · docs/586 ~ 589) */
  ['hr-attend', '근태'], ['hr-leave', '휴가 신청'], ['acct-payslip', '급여명세서'], ['acct-yearend', '연말정산 자료'],   /* v10.445 ~ 448 (D259 · docs/582 ~ 585) 인사 2 */
  ['my-hr', '내 인사'],   /* v10.445 ~ 447 (D259) 본인 출퇴근 · 휴가 신청 · 급여명세서 */
  ['ofc-calendar', '사내 일정'], ['ofc-tasks', '업무 요청'], ['ofc-trips', '출장'], ['ofc-notify', '내 알림'],   /* v10.462 ~ 465 (D263 · docs/600 ~ 603) 사무 2 */
  ['hr-training', '의무교육'], ['hr-contract', '근로계약서'], ['hr-review', '인사 평가'], ['hr-recruit', '채용'],   /* v10.458 ~ 461 (D262 · docs/596 ~ 599) 인사 3 */
  ['acct-exports', '수출'], ['acct-po', '국내 발주'],   /* v10.428 (D254 · docs/565) 무역 2단계 */
  ['acct-vehicle', '업무용 차량'], ['acct-cashplan', '자금 계획 12개월'], ['acct-exemptinv', '전자계산서(면세)'], ['acct-reorder', '안전 재고 · 재주문'],   /* v10.475 ~ 478 (D266 · docs/613 ~ 616) 사무 · 자금 */
  ['rpt-day', '일보'], ['rpt-week', '주보'], ['rpt-month', '월보'], ['rpt-worklog', '업무 일지'], ['rpt-board', '일지 현황판'], ['rpt-trend', '추세'],   /* v10.429 (D254) 경영 추세 그래프 */   /* v10.412 ~ 415 (D250 · docs/549 ~ 552) 보고 */
  ['approvals', '결재함'], ['approval-lines', '결재선'], ['corp-docs', '사내 문서함'],   /* v10.424 · 425 (D253 · docs/561 · 562) 사무 */
  ['its-assets', 'IT 자산 · 구독'], ['its-suggest', '제안함'], ['its-survey', '사내 설문'],   /* v10.491 ~ 493 (D270 · docs/629 ~ 631) 사무 · 보안 */
  ['lgl-licenses', '인허가'], ['lgl-reviews', '계약 검토'], ['lgl-cases', '소송 · 분쟁'], ['lgl-insurance', '회사 보험'],   /* v10.486 ~ 489 (D269 · docs/624 ~ 627) 법무 */
  ['perm-admin', '권한 관리'],   /* v10.443 (D258 · docs/580) 업무별 권한 관리(SUPER) */
  ['staff-access', '접속 인증'],   /* v10.226 (D195) — 운영 역할 모두(관리 칸은 ADMIN · SUPER) */
  ['ads', '광고'],
  ['roles', '권한 관리'],
  ['gov-audit', '감사'],
  ['invariants', '불변식'],
  ['codes', '코드 라벨'],
  /* v10.31 (10/10 시안 기준) — 시안에 있는데 개발에 화면이 없던 4화면 */
  ['integ', '통합 현황'],
  ['adx', '외부 송출'],
  ['adx-payout', '퍼블리셔 지급'],
  ['gwan-ux', '관 UI/UX'],
] as const;

export type Tab = (typeof TABS)[number][0];
export const tabLabel = (t: Tab) => TABS.find(([k]) => k === t)?.[1] ?? t;

/** 시안 admNav 의 묶음 — 순서 · 글자는 시안 그대로. key 는 시안 화면 키(data-group 으로 남김) */
export interface MenuGroup { key: string; label: string; tabs: Tab[] }
export const GROUPS: MenuGroup[] = [
  { key: 'adm',     label: '대시보드',  tabs: ['home'] },
  { key: 'admrev',  label: '검수',      tabs: ['queue', 'rules', 'audit', 'badges'] },
  { key: 'admptn',  label: '파트너사',  tabs: ['partners', 'partner-axes', 'directory', 'ptn-openapi', 'ptn-bulk'] },
  { key: 'admstl',  label: '정산',      tabs: ['settlement', 'payouts', 'billing'] },
  { key: 'admacc',  label: '회계',      tabs: ['acct-month', 'acct-journal', 'acct-bank', 'acct-manual', 'acct-pg', 'acct-cash', 'acct-cashplan', 'acct-purchase', 'acct-expense', 'acct-stock', 'acct-reorder', 'acct-vehicle', 'acct-statements', 'acct-ledger', 'acct-daybook', 'acct-cashbook', 'acct-fxreval', 'acct-assets', 'acct-budget', 'acct-tax', 'acct-exemptinv', 'acct-vatform', 'acct-aging', 'acct-yearclose', 'acct-payroll', 'acct-severance', 'acct-corptax', 'acct-whtreturn', 'acct-wagestmt', 'acct-insurance', 'acct-parties', 'acct-contracts', 'acct-requisitions', 'acct-imports', 'acct-exports', 'acct-po', 'acct-taxinbox', 'acct-docs', 'acct-dunning', 'acct-cardlimit', 'fin-transfer', 'acct-target', 'acct-partyledger', 'acct-bankfeed', 'sal-crm', 'acct-wh', 'acct-depts', 'acct-accountant', 'acct-receipt', 'acct-accrual', 'acct-archive', 'hr-attend', 'hr-leave', 'acct-payslip', 'acct-yearend', 'hr-training', 'hr-contract', 'hr-review', 'hr-recruit', 'acct-report', 'acct-accounts'] },   /* v10.381 ~ 384 (D242) 회계 · 세무 1단계 */
  { key: 'admrpt',  label: '보고',      tabs: ['rpt-trend', 'rpt-day', 'rpt-week', 'rpt-month', 'rpt-worklog', 'rpt-board'] },   /* v10.412 ~ 415 (D250) 업무 보고 */
  { key: 'admoff',  label: '사무',      tabs: ['my-hr', 'ofc-calendar', 'ofc-tasks', 'ofc-trips', 'ofc-notify', 'approvals', 'approval-lines', 'corp-docs', 'its-assets', 'its-suggest', 'its-survey', 'perm-admin'] },   /* v10.424 · 425 (D253) 결재 · 사내 문서 */
  { key: 'admdel',  label: '거래',      tabs: ['deals', 'disputes'] },
  /* v10.224 (D194 · docs/359) — 「소개몰」 묶음: 흩어져 있던 소개몰 탭(검수 · 정산 · 거래 · 관 관리)을 한곳에 · 판매자 탭 새로 */
  { key: 'admhlt',  label: '소개몰',    tabs: ['hlt-sellers', 'hlt-products', 'hlt-orders', 'hlt-open', 'qlt-lots', 'qlt-claims', 'qlt-supeval', 'hlt-settle', 'hlt-reviews', 'hlt-points', 'hlt-tiers', 'hlt-subscribe', 'hlt-giftcards', 'hlt-coupons'] },
  { key: 'admusr',  label: '회원',      tabs: ['members', 'users', 'inquiries', 'mkt-campaign'] },
  { key: 'admcat',  label: '업종',      tabs: ['category'] },
  { key: 'admdsp',  label: '노출',      tabs: ['mainops'] },
  { key: 'admpol',  label: '정책',      tabs: ['policy', 'settings', 'codes'] },
  { key: 'admsit',  label: '관 관리',   tabs: ['gwans', 'gwan-ux', 'hub', 'i18n-review', 'checklist', 'guide-flows', 'faq', 'ops-guide', 'siteinfo', 'terms', 'manual', 'i18n'] },
  { key: 'admad',   label: '광고',      tabs: ['ads', 'ad-billing', 'adx', 'adx-payout'] },
  { key: 'admrsk',  label: '위험감지',  tabs: ['risk', 'ops-alerts', 'report-queue', 'ai-ops', 'gov-audit', 'pii-review', 'role-review', 'purge-log', 'privacy-requests', 'sec-geo', 'server-errors', 'ops-board'] },
  { key: 'admbrk',  label: '인증 심사', tabs: ['quals', 'ownership'] },
  { key: 'admcmu',  label: '소개광장',  tabs: ['community', 'polls', 'events'] },
  { key: 'affapl',  label: '제휴',      tabs: ['affiliates'] },
  { key: 'integ',   label: '통합 현황', tabs: ['integ', 'integrations', 'reports', 'collect'] },
  { key: 'acl',     label: '권한 계층', tabs: ['roles', 'my-mfa', 'my-password', 'staff-access'] },
  { key: 'invreg',  label: '불변식',    tabs: ['invariants'] },
];

/* v10.471 ~ 474 (D265 · docs/609 ~ 612) ㉟ 인사 4 — 묶음에 새 탭 붙이기(옛 GROUPS · GROUP_SECTIONS 줄 글자를 바꾸지 않으려고 「붙이기」 · 합칠 때 줄 안으로 옮겨도 같음)
 *   회계: 근태 · 휴가 신청 뒤 연장 근로 · 근무표 · 고정자산 뒤 자산 실사 / 사무: 내 인사 뒤 회의실 · 장비 예약 */
function hrxAddTabs(list: Tab[] | undefined, after: Tab, tabs: Tab[]) {
  if (!list) return;
  const add = tabs.filter((t) => !list.includes(t));
  const i = list.indexOf(after);
  list.splice(i < 0 ? list.length : i + 1, 0, ...add);
}
hrxAddTabs(GROUPS.find((g) => g.key === 'admacc')?.tabs, 'hr-leave', ['hrx-overtime', 'hrx-shifts']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admacc')?.tabs, 'acct-assets', ['hrx-stocktake']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admoff')?.tabs, 'my-hr', ['hrx-booking']);
/* v10.517 ~ 520 (D277) — 노출: 메인 운영 뒤 메인 팝업 / 제휴: 제휴 뒤 추천 이벤트 / 광고: 광고 과금 뒤 성과 보고서 · 소재 비교 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admdsp')?.tabs, 'mainops', ['prx-popup']);
hrxAddTabs(GROUPS.find((g) => g.key === 'affapl')?.tabs, 'affiliates', ['prx-refevent']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admad')?.tabs, 'ad-billing', ['prx-adreport', 'prx-adab']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admrev')?.tabs, 'badges', ['lsx-expiry', 'lsx-bump', 'lsx-summary', 'lsx-saved']);   /* v10.513 ~ 516 (D276) 검수 › 매물 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admrev')?.tabs, 'lsx-saved', ['lsy-dups', 'lsy-photos', 'lsy-videos']);   /* v10.524 ~ 526 (D279) 검수 › 매물 품질 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admrsk')?.tabs, 'report-queue', ['lsy-triage']);   /* v10.527 (D279) 위험감지 › 신고 처리 뒤 신고 분류 */
/* v10.509 ~ 512 (D275) ㊺ — 위험감지: 위험감지 뒤 이상 거래 점수 · 감사 뒤 기록 장기 보관 / 회원: 1:1 문의 뒤 일괄 처리 / 정책: 전체 설정 뒤 기능 스위치 한눈에 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admrsk')?.tabs, 'risk', ['opx-risk']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admrsk')?.tabs, 'gov-audit', ['opx-archive']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'inquiries', ['opx-bulk']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admpol')?.tabs, 'settings', ['opx-switches']);
/* v10.505 ~ 508 (D274 · docs/643 ~ 646) — 소개몰: 쿠폰 뒤 재입고 알림 · 현금영수증 / 소개광장: 투표 뒤 활동 배지 · 랭킹 / 통합 현황: 경영 지표 뒤 화면 사용 통계 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-coupons', ['hlt-restock', 'hlt-cashrcpt']);
/* v10.538 ~ 541 (D283) — 회원: 캠페인 뒤 문자 마케팅 · 웹 푸시 / 소개몰: 현금영수증 뒤 재구매 알림 · 공동구매 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'mkt-campaign', ['mkx-sms', 'mkx-push']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-cashrcpt', ['mkx-rebuy', 'mkx-groupbuy']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admcmu')?.tabs, 'polls', ['plz-rank']);
/* v10.553 ~ 555 (D287) — 소개몰: 주문 뒤 도서산간 배송비 · 리뷰 · 문의 뒤 리뷰 답글 · 쿠폰 · 기획전 뒤 묶음 할인 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-orders', ['smx-remote']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-reviews', ['smx-replies']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-coupons', ['smx-bundles']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admrev')?.tabs, 'lsx-saved', ['lpx-offers', 'lpx-photo', 'lpx-away', 'lpx-stats']);   /* v10.549 ~ 552 (D286) 검수 › 매물 3 */
hrxAddTabs(GROUPS.find((g) => g.key === 'integ')?.tabs, 'reports', ['site-usage']);
/* v10.535 · 537 (D282) — 통합 현황: 화면 사용 통계 뒤 통계 내보내기(BI) / 소개몰: 로트 · 유통기한 뒤 휴대폰 실사 */
hrxAddTabs(GROUPS.find((g) => g.key === 'integ')?.tabs, 'site-usage', ['bi-export']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'qlt-lots', ['mob-scan']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'inquiries', ['mbx-ops', 'mbx-dm']);   /* v10.501 ~ 504 (D273) 회원 › 1:1 문의 뒤 */
/* v10.497 · 498 (D272) — 위험감지: 해외 접속 경고 뒤 가동 · 장애 공지 / 회원: 끝에 간편 로그인(GROUPS 줄을 바꾸지 않고 붙임) */
hrxAddTabs(GROUPS.find((g) => g.key === 'admrsk')?.tabs, 'sec-geo', ['upt-status']);
/* v10.546 ~ 548 (D285) — 위험감지: 이상 거래 점수 뒤 같은 기기 여러 계정 / 사무: 사내 문서함 뒤 서류 보관 기한(법무 넷 뒤로 밀림) / 관 관리: 번역 검수 뒤 번역 메모리 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admrsk')?.tabs, 'opx-risk', ['sfx-device']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admoff')?.tabs, 'corp-docs', ['sfx-retention']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admsit')?.tabs, 'i18n-review', ['sfx-tm']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'mkt-campaign', ['soc-login']);
/* v10.542 ~ 545 (D284) — 검수: 저장한 검색 뒤 방문 예약 · 지도 묶음 / 파트너사: 오픈 API 뒤 사용량 · 청구 · 자료 내려받기 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admrev')?.tabs, 'lsx-saved', ['vsx-visits', 'vsx-map']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admptn')?.tabs, 'ptn-openapi', ['vsx-papi-bill', 'vsx-ptn-export']);
/* v10.532 ~ 534 (D281) — 소개몰: 정산 뒤 판매자 월 정산서 · 리뷰 · 문의 뒤 리뷰 적립 / 파트너사: 직원 일괄 등록 뒤 파트너 성과 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-settle', ['slx-statements']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admhlt')?.tabs, 'hlt-reviews', ['slx-review-points']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admptn')?.tabs, 'ptn-bulk', ['slx-ptn-perf']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'inquiries', ['csx-aidraft', 'csx-churn', 'csx-mailtpl', 'csx-merge']);   /* v10.528 ~ 531 (D280) 회원 › 1:1 문의 뒤 */

/* v10.556 · 557 (D288) — 회원: 문자 · 메일 캠페인 뒤 월간 뉴스레터 / 위험감지: 가동 · 장애 공지 뒤 장애 대응 */
hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'mkt-campaign', ['opz-newsletter']);
hrxAddTabs(GROUPS.find((g) => g.key === 'admrsk')?.tabs, 'upt-status', ['opz-incident']);

/* v10.486 ~ 489 (D269) 법무 — 사무 그룹 사내 문서함 뒤에 인허가 · 계약 검토 · 소송 · 분쟁 · 회사 보험(GROUPS 줄을 고치지 않고 덧붙임 · 다른 묶음과 겹침 없게) */
{ const g = GROUPS.find((x) => x.key === 'admoff'); if (g) { const at = g.tabs.indexOf('corp-docs'); g.tabs.splice(at < 0 ? g.tabs.length : at + 1, 0, 'lgl-licenses', 'lgl-reviews', 'lgl-cases', 'lgl-insurance'); } }

export const groupOf = (t: Tab): MenuGroup => GROUPS.find((g) => g.tabs.includes(t)) ?? GROUPS[0]!;

/**
 * v10.416 (D251 · docs/553) — 묶음 안 탭 줄을 하위 묶음 이름표로 나눔(대표 11/19 「미해결 문제」 · 회계 탭 26개).
 *   그룹의 tabs(권한 · 순서 · 옛 시험이 보는 글자)는 그대로 · 줄을 그릴 때만 이 순서와 이름표로 나눔.
 *   여기 없는 탭은 줄 끝 「그 밖」에 붙음(빠지지 않음).
 */
export interface MenuSection { label: string; tabs: Tab[] }
export const GROUP_SECTIONS: Record<string, MenuSection[]> = {
  admacc: [
    { label: '장부',        tabs: ['acct-month', 'acct-journal', 'acct-manual', 'acct-statements', 'acct-ledger', 'acct-daybook', 'acct-cashbook', 'acct-fxreval', 'acct-yearclose', 'acct-docs', 'acct-partyledger'] },
    { label: '자금',        tabs: ['acct-bank', 'acct-pg', 'acct-cash', 'acct-cashplan', 'acct-aging', 'acct-dunning', 'acct-cardlimit', 'fin-transfer', 'acct-bankfeed'] },
    { label: '매입 · 경비', tabs: ['acct-purchase', 'acct-expense', 'acct-requisitions', 'acct-parties', 'acct-contracts', 'acct-imports', 'acct-exports', 'acct-po', 'acct-stock', 'acct-assets', 'acct-taxinbox', 'acct-wh', 'acct-receipt', 'acct-accrual', 'acct-reorder', 'acct-vehicle'] },
    { label: '세무',        tabs: ['acct-tax', 'acct-vatform', 'acct-corptax', 'acct-whtreturn', 'acct-exemptinv'] },
    { label: '인사',        tabs: ['acct-payroll', 'acct-payslip', 'hr-attend', 'hr-leave', 'hr-training', 'hr-contract', 'hr-review', 'hr-recruit', 'acct-severance', 'acct-wagestmt', 'acct-yearend', 'acct-insurance'] },
    { label: '설정 · 보고', tabs: ['acct-report', 'acct-budget', 'acct-depts', 'acct-accounts', 'acct-accountant', 'acct-archive', 'acct-target', 'sal-crm'] },
  ],
};
/* v10.471 ~ 474 (D265) — 하위 묶음에 새 탭(줄 글자를 바꾸지 않고 붙임 · hrxAddTabs 는 위 groupOf 앞) */
hrxAddTabs(GROUP_SECTIONS.admacc?.find((s) => s.label === '인사')?.tabs, 'hr-leave', ['hrx-overtime', 'hrx-shifts']);
hrxAddTabs(GROUP_SECTIONS.admacc?.find((s) => s.label === '매입 · 경비')?.tabs, 'acct-assets', ['hrx-stocktake']);

/** 그룹의 보이는 탭을 하위 묶음으로 — 하위 묶음이 없는 그룹은 이름표 없는 한 묶음 */
export function sectionsOf(groupKey: string, visibleTabs: Tab[]): MenuSection[] {
  const secs = GROUP_SECTIONS[groupKey];
  if (!secs) return [{ label: '', tabs: visibleTabs }];
  const out = secs.map((s) => ({ label: s.label, tabs: s.tabs.filter((t) => visibleTabs.includes(t)) })).filter((s) => s.tabs.length);
  const rest = visibleTabs.filter((t) => !secs.some((s) => s.tabs.includes(t)));
  return rest.length ? [...out, { label: '그 밖', tabs: rest }] : out;
}

/**
 * v10.426 (D253 · docs/563) — 상단바 그룹(20개 넘음)을 상위 묶음 이름표로 나눠 그림(대표 11/19 「모두개발」 · 다음 개발 후보 「상단바 정리」).
 *   그룹 단추(글자 · data-group · data-tabs)는 그대로 · 이름표는 누르지 않는 글자 · 여기 없는 그룹은 끝 「그 밖」.
 */
export interface NavSection { label: string; keys: string[] }
export const NAV_SECTIONS: NavSection[] = [
  { label: '운영',        keys: ['adm', 'admrpt', 'admoff', 'admrsk'] },
  { label: '회원 · 심사', keys: ['admusr', 'admrev', 'admbrk', 'acl'] },
  { label: '거래 · 소개몰', keys: ['admdel', 'admhlt', 'admcmu', 'admdsp'] },
  { label: '파트너 · 광고', keys: ['admptn', 'affapl', 'admad'] },
  { label: '돈',          keys: ['admstl', 'admacc'] },
  { label: '설정',        keys: ['admpol', 'admsit', 'admcat', 'integ', 'invreg'] },
];
/** 보이는 그룹을 상위 묶음으로 — 순서는 GROUPS 순서가 아니라 묶음 순서(빈 묶음 뺌) */
export function navSectionsOf<T extends { key: string }>(groups: T[]): Array<{ label: string; groups: T[] }> {
  const out = NAV_SECTIONS.map((s) => ({ label: s.label, groups: s.keys.map((k) => groups.find((g) => g.key === k)).filter((g): g is T => !!g) })).filter((s) => s.groups.length);
  const rest = groups.filter((g) => !NAV_SECTIONS.some((s) => s.keys.includes(g.key)));
  return rest.length ? [...out, { label: '그 밖', groups: rest }] : out;
}

/**
 * v10.32 — 하위 화면이 시안에서 다른 묶음에 속하는 경우 상단바에서 켜 둘 묶음(키 = '탭/하위', 값 = 묶음 key).
 * 주소(#/quals/medical)와 본문 위 탭 줄(.ad-snb — 그 탭이 든 묶음)은 그대로 두고, 상단바의 켜진 묶음만 시안대로 바꿉니다.
 * 시안은 의료 심의(admptnm) · 카테고리 마스터(admptnc)를 파트너사 화면(ptnShell)에 둡니다.
 */
export const SUB_GROUP: Record<string, string> = {
  'quals/medical': 'admptn',
  'quals/cats':    'admptn',
};

/* 탭이 묶음에서 빠지면 그 화면으로 갈 길이 없어집니다 — 개발 중에 바로 알립니다 */
if (import.meta.env.DEV) {
  const placed = GROUPS.flatMap((g) => g.tabs);
  const missing = TABS.map(([k]) => k).filter((k) => !placed.includes(k));
  const dup = placed.filter((k, i) => placed.indexOf(k) !== i);
  if (missing.length || dup.length) console.warn('[adminMenu] 묶음에 없는 탭', missing, '두 번 든 탭', dup);
  /* v10.416 — 하위 묶음 탭은 그 그룹 tabs 에 있어야 하고 두 번 들면 안 됨 */
  for (const [k, secs] of Object.entries(GROUP_SECTIONS)) {
    const g = GROUPS.find((x) => x.key === k); const all = secs.flatMap((s) => s.tabs);
    const out = all.filter((t) => !g?.tabs.includes(t)); const twice = all.filter((t, i) => all.indexOf(t) !== i);
    const left = (g?.tabs ?? []).filter((t) => !all.includes(t));
    if (out.length || twice.length || left.length) console.warn('[adminMenu] 하위 묶음', k, '그룹에 없음', out, '두 번', twice, '빠짐', left);
  }
}

/**
 * 탭마다 본문 위 제목 · 설명 줄 (시안 page(title, sub) — .pgh).
 * 시안 글을 그대로 쓰되, 서버 자료로 확인할 수 없는 건수(「규칙 7종」 「감시 뷰 43개」 등)와
 * 개발과 정책이 다른 문장은 빼거나 개발 문장으로 두었습니다(diffs 「정책문구차이」).
 */
export const PAGE: Record<Tab, { title: string; sub?: string; screen?: string }> = {
  home:          { title: '운영 대시보드', sub: '오늘 처리해야 할 것과 처리할 수 있는 양을 같이 봅니다.', screen: 'SB-ADM-DSH-010' },
  reports:       { title: '경영 지표', sub: '어긋남 신호 · 결정 대기 · 매출 · 최근 30일을 한 화면에서 봅니다.' },
  queue:         { title: '리스팅 검수', sub: 'SLA 24시간 기준입니다. 잔여 4시간 미만은 임박, 초과 건은 행이 강조됩니다.', screen: 'SB-ADM-REV-010' },
  rules:         { title: '자동검수 규칙', sub: '금칙어와 제한업종입니다. 배포 없이 바뀌지만, 잘못 넣으면 정상 등록이 반려됩니다.', screen: 'SB-ADM-REV-030' },
  audit:         { title: '표본 감사', sub: '자동 승인된 건을 표본으로 다시 봅니다. 자동검수가 놓치는 것이 있는지 확인하는 자리입니다.', screen: 'SB-ADM-REV-040' },
  badges:        { title: '배지 검수', sub: '신뢰 배지 신청을 봅니다. 배지는 목록 노출에 영향을 주므로 근거 없이 주면 안 됩니다.', screen: 'SB-ADM-BDG-010' },
  'lpx-offers': { title: '매물 가격 제안', sub: '회원이 게시 매물에 희망 가격을 제안 → 주인 수락 · 거절 · 되제안 · 기한 만료. 거래는 만들지 않고 1:1 문의로 이어 갑니다. 관별로 켜고, 처음에는 모두 꺼져 있습니다.', screen: 'SB-ADM-LPX-010' },
  'lpx-photo':  { title: '매물 사진 워터마크', sub: '사용자 웹 매물 상세 사진 위에 「SogaeBank/소개뱅크」 글자를 겹쳐 보입니다(원본 사진은 그대로). 자리 · 진하기 미리보기. 처음에는 꺼져 있습니다.', screen: 'SB-ADM-LPX-020' },
  'lpx-away':   { title: '판매자 자리 비움', sub: '회원이 켠 자리 비움 기간 · 자동 안내(문의 · 질문 · 가격 제안 · 방문 예약) 수. 끝 날짜가 지나면 저절로 풀립니다. 처음에는 꺼져 있습니다.', screen: 'SB-ADM-LPX-030' },
  'lpx-stats':  { title: '지역별 시세 통계', sub: '관 · 업종 · 시 · 구별 게시 매물 거래(희망) 금액 가운데값 · 달별 추이. 매물 5개 미만 칸은 숨깁니다. 공개는 집계만 · 처음에는 꺼져 있습니다.', screen: 'SB-ADM-LPX-040' },
  'lsx-expiry':  { title: '매물 만료 · 연장', sub: '등록 확정(검수 승인) 때 정한 노출 만료일 — 곧 끝남 · 날짜 지남 · 만료로 내림(지우지 않음) · 회원 연장 요청 승인 · 반려. 연장은 운영자만.', screen: 'SB-ADM-LSX-010' },
  'lsx-bump':    { title: '끌어올리기', sub: '방식(끔 · 무료 · 유료)을 운영자가 정합니다. 효과는 방식과 상관없이 같은 상한 — 최신순에서 그 시각의 새 글 자리에서 시작해 정한 시간 뒤 원래 자리.', screen: 'SB-ADM-LSX-020' },
  'lsx-summary': { title: '매물 AI 요약', sub: 'AI 가 만든 3줄 요약 초안을 읽고 고쳐 승인해야 매물 상세에 보입니다. 매물을 고치면 다시 초안부터.', screen: 'SB-ADM-LSX-030' },
  'lsx-saved':   { title: '저장한 검색', sub: '회원이 저장한 검색 조건 · 새 매물 하루 묶음 알림 — 모은 숫자만 봅니다.', screen: 'SB-ADM-LSX-040' },
  'lsy-dups':    { title: '매물 중복 의심', sub: '사진 지문 · 글 겹침 · 같은 연락처로 찾은 짝 — 두 매물을 나란히 보고 같은 매물 · 다른 매물을 정합니다. 자동으로 내리지 않습니다.', screen: 'SB-ADM-LSY-010' },
  'lsy-photos':  { title: '사진 품질', sub: '해상도 · 크기 · 비율 · 흐림 근사 · 사진 속 연락처 글자(AI) — 경고만 보이고 검수 · 게시를 막지 않습니다.', screen: 'SB-ADM-LSY-020' },
  'lsy-videos':  { title: '매물 동영상', sub: '회원이 붙인 짧은 동영상 — 보고 승인해야 매물 상세에 보입니다. 반려 사유는 회원에게 보입니다.', screen: 'SB-ADM-LSY-030' },
  'lsy-triage':  { title: '신고 분류', sub: '열린 신고를 종류 · 급함으로 — 규칙 · AI 가 제안하고 사람이 확정합니다. 처리(인정 · 기각)는 신고 처리에서.', screen: 'SB-ADM-LSY-040' },
  'hlt-reviews': { title: '소개몰 리뷰 · 문의', sub: '리뷰는 바로 보이고, 효능 · 효과를 단정하는 표현에 걸린 것만 여기서 확인합니다. 상품 문의는 운영자가 답합니다.', screen: 'SB-ADM-HRV-010' },
  'hlt-points':    { title: '적립금', sub: '구매확정 때 쌓이고 직판 주문에 쓰는 소개몰 적립금 — 남은 합(충당부채) · 곧 소멸 · 회원별 묶음 · 운영 지급 · 회수(처음 꺼짐).', screen: 'SB-ADM-MBS-010' },
  'hlt-tiers':     { title: '회원 등급', sub: '최근 기간 구매액으로 매일 정하는 등급 · 등급별 적립률 · 혜택 — 운영이 정한 회원은 건너뜁니다(처음 꺼짐).', screen: 'SB-ADM-MBS-020' },
  'hlt-subscribe': { title: '정기 배송', sub: '회원이 정한 주기로 직판 상품을 주문 · 정기 결제(처음 간주) — 건너뛰기 · 멈춤 · 해지 · 실패하면 다시 · 멈춤 알림(처음 꺼짐).', screen: 'SB-ADM-MBS-030' },
  'hlt-giftcards': { title: '상품권', sub: '판매 · 판촉 상품권 발행(코드는 한 번만 보임) · 잔액 · 무효 · 잔액 환불 · 소멸 — 판매분 잔액은 선수금(처음 꺼짐 · 법무 확인).', screen: 'SB-ADM-MBS-040' },
  'hlt-coupons': { title: '쿠폰 · 기획전', sub: '정액 · 정률 할인 쿠폰(최소 주문 · 사용 한도 · 기간)과 상품 묶음 기획전 — 직판 주문에만 쓰이고, 취소 · 반품되면 저절로 되돌아갑니다.', screen: 'SB-ADM-SAL-040' },
  'smx-bundles': { title: '묶음 할인', sub: '직판 상품 · 옵션 여럿을 묶음가 하나로 — 재고는 구성 옵션에서 빠지고 하나라도 품절이면 묶음도 품절 · 반품은 묶음 단위(처음 꺼짐).', screen: 'SB-ADM-SMX-010' },
  'smx-remote':  { title: '도서산간 배송비', sub: '우편번호 범위마다 추가 배송비 — 직판 · 입점 주문 때 배송지로 자동 더하고 주문서에 따로 보임 · 입점 몫은 판매자 정산(처음 꺼짐).', screen: 'SB-ADM-SMX-020' },
  'smx-replies': { title: '리뷰 답글', sub: '직판 상품 리뷰에 운영 답글 · 입점 판매자 답글 보이기 · 가리기 — 리뷰마다 하나 · 고친 기록 · 금칙어는 확인 뒤(처음 꺼짐).', screen: 'SB-ADM-SMX-030' },
  'hlt-restock':  { title: '재입고 알림', sub: '품절 옵션에 회원이 신청한 「입고되면 알림」 — 재고가 0 에서 다시 늘면 한 번 알립니다(알림 수신을 끈 회원 빼고 · 처음 꺼짐).', screen: 'SB-ADM-MLX-010' },
  'mkx-rebuy':    { title: '재구매 알림', sub: '상품마다 사용 일수 — 산 날 + 일수 − 며칠 전에 한 번 알림(광고 · 마케팅 수신 동의자만 · 회원 하루 한 통 · 처음 꺼짐).', screen: 'SB-ADM-MKX-020' },
  'mkx-groupbuy': { title: '공동구매', sub: '직판 상품 옵션 하나 · 목표 인원 · 기한 · 할인가 — 모이면 확정, 못 모이면 참여 주문마다 취소 신청(환불은 기존 절차) · 처음 꺼짐.', screen: 'SB-ADM-MKX-030' },
  'hlt-cashrcpt': { title: '현금영수증', sub: '직판 · 계좌이체 · 가상계좌 결제의 소득공제 · 지출증빙 현금영수증 — 발급 · 취소 · 반품 차감 뒤 다시 발급(처음 꺼짐 · 간주 · 세무사 · PG 확인).', screen: 'SB-ADM-MLX-020' },
  'plz-rank':     { title: '활동 배지 · 랭킹', sub: '소개광장 글 · 답변 · 도움돼요 점수로 달마다 순위와 배지 — 숨김 · 신고된 글은 빼고, 회원이 랭킹 노출을 끌 수 있습니다(처음 꺼짐).', screen: 'SB-ADM-MLX-030' },
  'site-usage':   { title: '화면 사용 통계', sub: '사용자 웹 화면별 보기 · 이탈 · 전환 — 하루 × 화면 주소 묶음 수만(계정 · IP · 쿠키 없음 · 처음 꺼짐 · 처리방침 먼저).', screen: 'SB-ADM-MLX-040' },
  'bi-export':    { title: '통계 내보내기(BI)', sub: '개인 식별 없는 일별 집계(가입 · 매물 · 거래 · 주문 · 문의 · 화면 보기) — 기간 표 · CSV(내려받기 승인 · 작은 칸 가림) · 외부 BI 도구용 읽기 전용 보기(bi 스키마).', screen: 'SB-ADM-DTX-010' },
  partners:      { title: '파트너사', sub: '파트너센터(파트너사가 쓰는 별도 사이트)에서 올라오는 것을 본사가 처리하는 자리입니다.', screen: 'SB-ADM-PTN-010' },
  'partner-axes':{ title: '안심소개 입점 심사', sub: '안심소개 입점 신청을 축별로 심사합니다.' },
  directory:     { title: '법률 · 세무 정액 노출', sub: '법률 · 세무 전문가의 정액 노출을 관리합니다.' },
  'ptn-openapi': { title: '오픈 API', sub: '파트너 시스템이 부르는 읽기 API(/api/partner/v1) — 파트너별 키(원문은 발급 때 한 번) · 범위 · 1분 한도 · 요청 기록 · 서명 웹훅. 처음에는 꺼져 있고, 보안 검토 뒤 최고 관리자가 켭니다.', screen: 'SB-ADM-OAPI-010' },
  'vsx-visits':     { title: '매물 방문 예약', sub: '매물 주인이 연 방문 시간 칸을 회원이 골라 요청 → 주인 확정 · 전날 알림 · 노쇼 표시. 운영은 숫자 · 기록만(연락처 없음). 처음에는 꺼져 있습니다.', screen: 'SB-ADM-VSX-010' },
  'vsx-map':        { title: '지도 매물 묶음', sub: '공개 지도 API — 줌 단계별 시 · 도 / 시 · 구 / 격자(2km 넘음) 묶음 수만. 매물 주소 · 좌표는 내지 않습니다. 격자 단계는 법무 확인 뒤. 처음에는 꺼져 있습니다.', screen: 'SB-ADM-VSX-020' },
  'vsx-papi-bill':  { title: '오픈 API 사용량 · 청구', sub: '파트너 API 하루 사용량 · 달 무료 한도 · 1,000건 단가(부가세 별도) · 월 청구서 초안. 확정은 최고 관리자가 사람 손으로 · 실제 청구는 이 화면 밖. 처음에는 꺼져 있습니다.', screen: 'SB-ADM-VSX-040' },
  'vsx-ptn-export': { title: '파트너 자료 내려받기', sub: '파트너센터 리드 CSV(내려받기 승인 뒤 한 번 · 연락처 없음) · 성과 CSV(숫자만) 기록. 승인은 위험감지 › 감사. 처음에는 꺼져 있습니다.', screen: 'SB-ADM-VSX-030' },
  'ptn-bulk':    { title: '직원 일괄 등록', sub: '파트너 직원을 CSV(이메일 · 정산 권한 두 칸)로 한꺼번에 — 미리보기 → 확정. 가입 회원은 직원 초대, 아직 안 한 분은 가입 대기. 초대 메일은 처음에 꺼져 있습니다.', screen: 'SB-ADM-OAPI-020' },
  'slx-statements':    { title: '판매자 월 정산서', sub: '입점 판매자의 주 정산서를 달마다 모은 한 장 — 만들기 · 다시 셈 · 인쇄(PDF 저장) · 메일(처음 꺼짐 · 같은 달 한 번만).', screen: 'SB-ADM-SLX-010' },
  'slx-review-points': { title: '리뷰 적립', sub: '구매확정한 직판 주문의 리뷰에 적립금 — 주문 하나에 한 번 · 사진 리뷰 가산 · 지우거나 가리면 회수(처음 꺼짐).', screen: 'SB-ADM-SLX-020' },
  'slx-ptn-perf':      { title: '파트너 성과', sub: '받은 리드 · 열람 · 응답 속도 · 리드 전환 · 이용료 · 정산을 기간 그래프로 — 모든 파트너 합 · 파트너별 · 순위.', screen: 'SB-ADM-SLX-030' },
  'i18n-review': { title: '일본어 · 중국어 검수', sub: '일본어 · 중국어(간체) 사전은 기계 번역 초안입니다. 검수자가 고친 뒤 사용자 웹 · 서버 문장 승인을 남겨야 그 언어를 켤 수 있습니다.', screen: 'SB-ADM-OAPI-030' },
  settlement:    { title: '정산 승인', sub: '신청 → 승인 → 지급 실행. 소개비에서 떼는 금액은 없습니다 (INV-9). 지급은 당사자가 직접 합니다 (INV-11).', screen: 'SB-ADM-STL-010' },
  payouts:       { title: '지급 데스크', sub: '확정된 지급을 보내고 기록합니다. 확정은 운영, 지급 기록은 지급 담당이 합니다.', screen: 'SB-ADM-PAY-010' },
  'hlt-sellers': { title: '소개몰 판매자', sub: '입점 신청 심사 · 판매자 정지 · 다시 열기 · 이용 제한 · 폐점 · 수수료율 · 하위가맹점 · 정보 변경 요청. 사유는 판매자에게 그대로 보입니다.', screen: 'SB-ADM-HSL-010' },
  'hlt-settle':  { title: '소개몰 정산', sub: '주 단위로 마감합니다. 배송 완료 후 7일(청약철회 기간)이 지난 건만 집계합니다.', screen: 'SB-ADM-HST-010' },
  billing:       { title: '청구 현황', sub: '구독료가 매출의 전부입니다. 이 화면이 곧 매출 감시입니다. 유예 일수와 재시도 횟수는 코드가 아니라 설정에 있어 여기서 바꾸면 즉시 반영됩니다.', screen: 'SB-ADM-BIL-010' },
  deals:         { title: '거래 감독', sub: '진행 중인 거래와 분쟁 건을 봅니다. 7일간 양측 확인이 안 된 건은 여기로 자동 승격됩니다. 관리자도 임의로 성사를 확정할 수 없습니다 (INV-4).', screen: 'SB-ADM-DEL-010' },
  disputes:      { title: '분쟁 처리', sub: '접수된 분쟁을 처리합니다. 분쟁이 걸린 거래는 정산이 보류됩니다.', screen: 'SB-ADM-DSP-010' },
  'hlt-open':    { title: '개봉 반품 재고', sub: '반품 승인 때 개봉으로 판정한 상품 — 보관(폐기 대기) · 폐기 · 판매자 반송. 식품 · 화장품 개봉품은 다시 팔 수 없습니다.', screen: 'SB-ADM-HOS-010' },
  'qlt-lots':    { title: '로트 · 유통기한', sub: '직판 상품마다 로트 관리를 켜면 입고 줄을 로트(제조일 · 유통기한)로 나누고, 배송 뒤 출고에 먼저 끝나는 로트부터 붙입니다. 임박 30일 알림 · 회수 로트의 나간 곳.', screen: 'SB-ADM-QLT-020' },
  'mob-scan':    { title: '휴대폰 실사', sub: '휴대폰 카메라(바코드 · QR) 또는 손 입력으로 로트 재고를 세고(회차 · 차이 · SUPER 조정), 자산 실사 QR 을 읽습니다 — 카메라를 못 쓰는 브라우저는 손으로 넣습니다.', screen: 'SB-ADM-DTX-030' },
  'qlt-claims':  { title: '품질 클레임', sub: '불량 접수 → 확인 → 조치 → 끝냄(원인 · 조치). 상품 · 로트 · 공급사 · 주문을 잇고, 공급사 반품은 재고와 전표에 같이 들어갑니다. 같은 불량이 되풀이되면 알림.', screen: 'SB-ADM-QLT-030' },
  'qlt-supeval': { title: '협력사 평가', sub: '매입처를 분기마다 납기(발주 · 입고로 자동) · 품질(클레임) · 가격 · 대응으로 매겨 등급을 냅니다. 확정한 평가는 고치지 않습니다.', screen: 'SB-ADM-QLT-010' },
  'hlt-orders':  { title: '소개몰 주문', sub: '결제 완료 주문의 발송을 처리합니다 — 택배사 · 송장번호를 넣으면 배송중, 「배송 완료로」를 누르면 배송 완료.', screen: 'SB-ADM-HOR-010' },
  members:       { title: '회원 목록', sub: '이름 · 이메일 · 연락처로 찾습니다.', screen: 'SB-ADM-MBR-010' },
  users:         { title: '회원 관리', sub: '사업자 신청을 승인 · 반려하고 회원을 정지합니다. 승인 시각이 소개비 수령 자격의 기준일입니다 (INV-10).', screen: 'SB-ADM-USR-010' },
  inquiries:     { title: '1:1 문의', sub: '고객센터 문의하기 · 챗봇 「상담원 연결」로 들어온 문의입니다. 답하면 회원에게 알림이 가고, 기한(접수 뒤 영업일 1일)을 넘기면 운영 알림이 뜹니다.', screen: 'SB-ADM-INQ-010' },
  'csx-aidraft': { title: 'AI 답변 초안', sub: '1:1 문의마다 자주 묻는 질문 · 답변 틀 · 지난 답변을 바탕으로 AI 가 만든 초안입니다. 회원에게 보이지 않고, 운영자가 고쳐 보냅니다.', screen: 'SB-ADM-CSX-010' },
  'csx-churn':   { title: '이탈 위험 신호', sub: '최근 30일 활동이 앞 60일보다 크게 줄어든 회원입니다. 운영 화면 안에서만 보고, 재방문 안내는 마케팅 동의자에게만 캠페인으로 보냅니다.', screen: 'SB-ADM-CSX-020' },
  'csx-mailtpl': { title: '메일 문구', sub: '코드가 보내는 메일의 제목 · 본문을 고칩니다. 자리값 검사 · 미리보기 · 판 기록 · 되돌리기 — 스위치가 꺼져 있으면 코드 기본 문구로 보냅니다.', screen: 'SB-ADM-CSX-030' },
  'csx-merge':   { title: '계정 합치기', sub: '본인인증이 같은 한 사람의 두 계정을 하나로 합칩니다. 운영자가 요청하고 다른 SUPER 가 승인하며, 되돌릴 수 없습니다.', screen: 'SB-ADM-CSX-040' },
  'mkt-campaign': { title: '문자 · 메일 캠페인', sub: '마케팅 수신 동의자에게만 보냅니다(21 ~ 8시는 야간 동의자만). (광고) 표기 · 보낸 곳 · 무료 수신 거부는 서버가 붙이고, 처음에는 꺼짐 · 간주(보내지 않음)입니다.', screen: 'SB-ADM-SCU-010' },
  'mkx-push':     { title: '웹 푸시', sub: '회원 알림을 브라우저 푸시로 — 기기마다 회원이 켬 · 처음에는 꺼짐 · 간주(밖으로 부르지 않음). 키는 「키 만들기」(최고 관리자).', screen: 'SB-ADM-MKX-010' },
  'mkx-sms':      { title: '문자 마케팅', sub: '소개몰 대상(구매 회원 · 재구매 시기) · 회원별 7일 상한 · 080 수신 거부 반영 · 예상 비용. 보내기는 문자 · 메일 캠페인에서 합니다.', screen: 'SB-ADM-MKX-040' },
  'mbx-ops':      { title: '회원 편의 기능', sub: '최근 본 매물 · 상품 · 비교하기 · 가격 변동 알림 · 회원 간 1:1 대화의 스위치(처음 모두 꺼짐 · 바꾸기 SUPER) · 감지 방식 · 보관 일수와 수(개인 식별 없음) · 정리 기록.', screen: 'SB-ADM-MBX-010' },
  'mbx-dm':       { title: '회원 대화 신고', sub: '신고가 들어온 회원 대화만 엽니다 — 열 때마다 사유를 적고, 개인정보 접속기록에 남습니다. 조치하면 대화를 닫을 수 있습니다.', screen: 'SB-ADM-MBX-020' },
  category:      { title: '업종 관리', sub: '업종은 열린 집합입니다 — 신청 → 승인 → 노출 (A-02).', screen: 'SB-ADM-CAT-010' },
  mainops:       { title: '메인 운영', sub: '메인에 무엇을 띄울지 정합니다. 광고는 추천 순위에 섞이지 않고 별도 슬롯에만 나갑니다. 배포 없이 즉시 반영됩니다.', screen: 'SB-ADM-MAIN-010' },
  settings:      { title: '전체 설정', sub: '사이트 설정 모두를 찾고 고칩니다. 값이 바뀔 때마다 전 · 후 · 누가 · 까닭이 「바뀐 기록」에 남습니다(비밀 값은 가림).', screen: 'SB-ADM-SET-010' },
  policy:        { title: '정책', sub: '화면이 따르는 규칙의 원본입니다. 여기 값이 바뀌면 화면 문구와 계산이 함께 바뀝니다.', screen: 'SB-ADM-POL-010' },
  codes:         { title: '코드 라벨', sub: '화면에 보이는 상태 문구입니다. 코드는 고정이고 라벨만 바뀝니다.', screen: 'SB-ADM-COD-010' },
  gwans:         { title: '사이트 · 관 관리', sub: '관은 코드가 아니라 데이터입니다. 여기서 만든 관이 그대로 하나의 사이트가 됩니다.', screen: 'SB-ADM-SIT-010' },
  hub:           { title: '통합 메인 관리', sub: '통합 메인은 관이 아닙니다 — 관으로 보내는 허브입니다.', screen: 'SB-ADM-SIT-050' },
  checklist:     { title: '오픈 체크리스트', sub: '하나라도 미충족이면 오픈 버튼이 열리지 않습니다. 무엇이 막고 있는지 여기서 봅니다.', screen: 'SB-ADM-SIT-040' },
  siteinfo:      { title: '사이트 기본 정보 · 법정 고지', sub: '푸터 법정 고지의 원본입니다.', screen: 'SB-ADM-SIT-070' },
  terms:         { title: '약관', sub: '법무가 확인한 글을 고치고 시행일을 정해 게시합니다. 시행일 전에는 앞 판이 그대로 시행되고, 재동의는 시행일부터 받습니다.', screen: 'SB-ADM-SIT-070' },
  manual:        { title: '사용자 설명서', sub: '회원용 사용 방법입니다. 사용자 웹 이용안내 › 「자세한 사용 설명서」에 나가고, AI 상담이 답의 근거로 읽습니다(2만 자까지). 고치면 새 판이 되고 옛 판은 남습니다.', screen: 'SB-ADM-SIT-090' },
  faq:           { title: '자주 묻는 질문', sub: '사용자 웹 고객센터(분야 탭 · 많이 찾는 질문 · 찾기) · 이용안내 · 1:1 문의 챗봇에 나가는 질문 글입니다. 저장하면 바로 나가고, 지우기 대신 숨깁니다.', screen: 'SB-ADM-SIT-100' },
  'ops-guide':   { title: '업무 안내', sub: '운영진 업무마다 순서와 그 화면으로 가는 단추입니다. 고치기는 최고 관리자(SUPER) — 고치면 새 판이 되고 옛 판은 남습니다.', screen: 'SB-ADM-SIT-110' },
  'guide-flows': { title: '이용 흐름', sub: '사용자 웹 이용안내 › 「이렇게 이용하세요」의 흐름 글입니다. 고치기는 최고 관리자(SUPER) — 고치면 새 판이 되고 옛 판은 남습니다.', screen: 'SB-ADM-SIT-120' },
  i18n:          { title: '번역', sub: '다국어 — 번역을 넣고 승인합니다. 승인한 번역만, 다국어를 켠 뒤 손님 화면에 나갑니다.', screen: 'SB-ADM-TRN-010' },
  'hlt-products':{ title: '소개몰 상품', sub: '상품 · 옵션(묶음 개수) · 재고 · 그림 · 고시를 넣고 고칩니다.', screen: 'SB-ADM-HPR-010' },
  ads:           { title: '광고 관리', sub: '메인 광고 자리에 어떤 소재를 누구에게 내보낼지 정합니다. 소재 · 슬롯 · 세그먼트 세 가지가 전부입니다.', screen: 'SB-ADM-ADS-010' },
  'ad-billing':  { title: '광고 과금 · 정산', sub: '광고주 · 청구 · 입금 · 미수금. 광고비는 우리가 받는 돈이라 소개비와 따로 답니다.', screen: 'SB-ADM-ADB-010' },
  'prx-popup':    { title: '메인 팝업', sub: '사용자 웹 메인에 뜨는 팝업 공지 — 기간 · 대상(비로그인 · 회원 · 파트너) · 순서. 「오늘 하루 안 보기」는 회원 브라우저에만 적힙니다.', screen: 'SB-ADM-PRX-010' },
  'prx-refevent': { title: '추천 이벤트', sub: '기간 동안 직접 추천 1단계 보상 점수만 바꿉니다. 예산을 다 쓰거나 기간이 끝나면 평소 점수로 — 시행 전 확인(약관 · 안내 문구) 뒤 최고 관리자가 시작합니다.', screen: 'SB-ADM-PRX-020' },
  'prx-adreport': { title: '광고 성과 보고서', sub: '광고주별 하루 · 주 · 달 노출 · 클릭 · 광고비. 있는 광고 기록과 청구서로 셈하고, 인쇄 PDF 와 메일(처음 꺼짐 · 주기 설정)로 전합니다.', screen: 'SB-ADM-PRX-030' },
  'prx-adab':     { title: '광고 소재 비교', sub: '한 광고의 소재 두 개를 노출마다 번갈아 내고 기간이 끝나면 클릭률을 비교합니다. 「광고」 표기 · 추천 순위 제외는 그대로입니다.', screen: 'SB-ADM-PRX-040' },
  'ops-alerts':  { title: '운영 알림', sub: '정기 작업 · 스크립트가 남긴 알림을 보고 확인합니다. 확인은 한 번만 — 누가 · 언제 · 메모가 남습니다.', screen: 'SB-ADM-OPS-010' },
  'opx-archive': { title: '기록 장기 보관', sub: '감사 기록 · 개인정보 접속기록 · 운영 알림 · 설정 바뀐 기록 · 운영자 로그인을 달마다 묶어(sha256 · 감사 사슬과 묶은 지문) 3년 보관합니다. 복원 확인 · 디스크 밖(S3) · 파기 기록.', screen: 'SB-ADM-OPX-010' },
  'opx-risk':    { title: '이상 거래 점수', sub: '새 계정 · 짧은 시간 매물 여러 개 · 같은 연락처 · 신고 · 가입 차단 근접 등 규칙 점수의 합. 기준을 넘으면 검수 대기 · 알림. 회원에게는 보이지 않습니다.', screen: 'SB-ADM-OPX-020' },
  'opx-bulk':    { title: '일괄 처리', sub: '검수 · 신고 · 1:1 문의 · 회원을 여러 줄 골라 한 번에(최대 100 · 사유 필수). 한 줄씩 한 건 처리와 같이 돌고 감사 기록도 줄마다 남습니다.', screen: 'SB-ADM-OPX-030' },
  'opx-switches': { title: '기능 스위치 한눈에', sub: '켜고 끄는 설정 모두 — 지금 값 · 처음 값 · 켤 조건 · 누가 언제 바꿨는지. 읽기만 — 고치기는 「전체 설정」.', screen: 'SB-ADM-OPX-040' },
  'sfx-device':    { title: '같은 기기 여러 계정', sub: '가입 · 로그인 때 기기 표지(무작위 값의 해시 · 지문 없음)로 같은 브라우저의 여러 계정을 봅니다. 기준을 넘으면 위험감지 경보 — 자동 정지는 없습니다(처음 꺼짐).', screen: 'SB-ADM-SFX-010' },
  'sfx-retention': { title: '서류 보관 기한', sub: '인사 · 법무 · 회계 증빙 · 사내 문서의 보관 기간 표와 대장 — 만료 전 알림(처음 꺼짐) · 법정 보관(보존) · 파기는 SUPER 가 「파기」 입력으로(기록은 쌓기만).', screen: 'SB-ADM-SFX-020' },
  'sfx-tm':        { title: '번역 메모리', sub: '승인된 번역을 원문 열쇠로 모아 같은 원문은 엔진을 부르지 않고 다시 씁니다(사람이 고친 것 먼저 · 처음 꺼짐). 찾기 · 고치기 · 끄기.', screen: 'SB-ADM-SFX-030' },
  'pii-review':  { title: '개인정보 접속기록 점검', sub: '운영자가 개인정보를 본 기록을 달마다 점검하고 기록을 남깁니다(SUPER).', screen: 'SB-ADM-PII-010' },
  'role-review': { title: '운영자 권한 점검', sub: '운영자별 역할 · 마지막 로그인 · 2단계 등록을 보고 분기마다 점검 기록을 남깁니다(SUPER).', screen: 'SB-ADM-ROLE-010' },
  'purge-log':   { title: '파기 실행 기록', sub: '매일 03:00 개인정보 파기 작업이 지운 건수를 날짜별 · 달별로 봅니다.', screen: 'SB-ADM-PRG-010' },
  'privacy-requests': { title: '개인정보 권리 요청', sub: '회원의 열람 · 정정 · 삭제 · 처리정지 요청을 기한 안에 처리하고 결과를 남깁니다.', screen: 'SB-ADM-PRQ-010' },
  'ops-board':   { title: '운영자 게시판', sub: '하루 요약 · 급한 알림 · 대표 할 일 · 시험 메시지가 텔레그램 · 슬랙 결과와 함께 저절로 올라옵니다(꺼져 있어도). 운영자끼리 글 · 댓글 · 「확인함」. 운영 화면 계정만 봅니다.', screen: 'SB-ADM-OBD-010' },
  'server-errors': { title: '최근 서버 오류', sub: 'API 가 지난 1시간 보낸 서버 오류(5xx) 최근 50건 — 요청 내용 · 개인정보는 남기지 않습니다.', screen: 'SB-ADM-ERR-010' },
  'sec-geo':     { title: '해외 접속 경고', sub: '운영 역할 로그인마다 접속 나라를 보고 허용 나라 밖이면 긴급 운영 알림 · 막기를 켜면 그 로그인을 막습니다(처음 꺼짐 · 간주 판별).', screen: 'SB-ADM-SCU-030' },
  'upt-status':  { title: '가동 · 장애 공지', sub: '자동화 서버 n8n 의 바깥 감시 결과(대상별 · 24시간 가동률)와 장애 공지입니다. 공지는 사용자 웹 맨 위 띠 · 서비스 상태 화면(/status)에 나가고, 연속 실패면 긴급 운영 알림이 갑니다.', screen: 'SB-ADM-UPT-010' },
  'opz-newsletter': { title: '월간 뉴스레터', sub: '달마다 공지 · 인기 매물 · 이벤트를 골라 소식 메일 초안을 만들고 미리보기 · 나에게 시험 뒤 최고 관리자가 보냅니다. 보내기는 문자 · 메일 캠페인 길(마케팅 동의자만 · (광고) · 수신 거부)이고, 처음에는 꺼져 있습니다.', screen: 'SB-ADM-OPZ-010' },
  'opz-incident':   { title: '장애 대응', sub: '장애 종류별 할 일 목록(런북)을 골라 장애를 열면 운영 알림이 당번 텔레그램 길로 갑니다. 단계를 체크하고 진행 기록을 남기고, 끝난 뒤 되돌아보기를 확정합니다. 장애 공지(사용자 웹 띠)와 잇습니다. 처음에는 꺼져 있습니다.', screen: 'SB-ADM-OPZ-020' },
  'soc-login':   { title: '간편 로그인', sub: '카카오 · 네이버 로그인(처음 꺼짐 · 간주). LIVE 는 키와 처리방침 확인 뒤 켭니다. 같은 이메일 계정이 있어도 저절로 합치지 않고, 운영 역할 계정은 쓸 수 없습니다.', screen: 'SB-ADM-UPT-020' },
  'acct-journal':  { title: '전표', sub: '소개뱅크를 지난 돈 흐름으로 매시간 만든 전표입니다. 달마다 마감하고 회계 프로그램에 올릴 CSV 를 받습니다(내려받기 승인).', screen: 'SB-ADM-ACC-010' },
  'acct-tax':      { title: '신고 자료', sub: '부가세(분기) · 원천세(월) · 세금계산서 발행 대상을 전표와 원래 자료에서 모았습니다. 신고서 칸 맞춤은 세무사 확인.', screen: 'SB-ADM-ACC-020' },
  'acct-report':   { title: '경영 보고서', sub: '달마다 매출(공급가) · 비용 · 이익 · 현금 들고 남 — 시스템을 지난 돈만입니다(급여 · 임대료 등은 회계 프로그램).', screen: 'SB-ADM-ACC-030' },
  'acct-month':    { title: '월 결산', sub: '그 달 매출 · 비용 · 부가세 · 원천세 · 현금과 마감 전 할 일(전표 실패 · 통장 맞춤 · 세금계산서), 다가오는 신고 기한(원천세 10일 · 부가세 25일)입니다.', screen: 'SB-ADM-ACC-050' },
  'acct-bank':     { title: '은행 맞추기', sub: '인터넷뱅킹 거래 내역 CSV 를 올려 전표의 보통예금 줄과 금액 · 날짜 · 이름으로 맞춥니다. 맞출 것이 없는 줄(이자 · 수수료)은 사유와 함께 둡니다.', screen: 'SB-ADM-ACC-060' },
  'acct-purchase': { title: '매입', sub: '매입 세금계산서 · 카드 · 현금영수증 · 간이영수증(공제 안 됨)을 증빙 파일과 넣으면 비용 · 부가세대급금 전표가 생깁니다. 분기 매입 부가세는 신고 자료 매입 쪽.', screen: 'SB-ADM-ACC-070' },
  'acct-expense':  { title: '경비 청구', sub: '운영자가 쓴 돈을 증빙과 올리고 SUPER 가 승인(본인 건 불가) · 지급 담당이 지급합니다. 법인카드 이용 내역 CSV 를 올려 줄마다 계정을 골라 장부에 넣습니다.', screen: 'SB-ADM-ACC-080' },
  'acct-cash':     { title: '자금 흐름', sub: '앞으로 90일 날마다 예상 잔액 — 시작 잔액(직접 넣음 · 통장 CSV)에 확정된 들어올 돈 · 나갈 돈을 더하고 뺍니다. 가장 낮은 날이 기준 밑이면 운영 알림.', screen: 'SB-ADM-ACC-090' },
  'acct-stock':    { title: '재고', sub: '직판 상품 원가 장부(이동평균) — 입고 · 결제 때 출고 · 취소 · 반품 반입 · 실사 조정 · 매출원가 전표', screen: 'SB-ADM-ACC-100' },
  'acct-vehicle':  { title: '업무용 차량', sub: '차량 · 운행기록부(출퇴근 · 업무 · 비업무 거리) · 비용 — 해마다 업무 사용 비율 · 손금 인정 · 불인정(한도는 일반 원칙 값 · SUPER 고침 · 세무사 확인) · 운행기록부 인쇄.', screen: 'SB-ADM-FIN2-010' },
  'acct-cashplan': { title: '자금 계획 12개월', sub: '앞 90일 확정된 돈 + 예정 · 계약 고정비 · 급여 · 세금 기한 · 예상 매출(매출 목표 · 영업 기회)로 달마다 들고 남 · 달 말 예상 잔액 — 모자라는 달은 운영 알림.', screen: 'SB-ADM-FIN2-020' },
  'acct-exemptinv': { title: '전자계산서(면세)', sub: '거래명세서의 면세 품목을 부가세 없는 전자계산서로 따로 발행(전자세금계산서 어댑터 · 처음 꺼짐 · 간주) · 매출처별 계산서 합계.', screen: 'SB-ADM-FIN2-030' },
  'acct-reorder':  { title: '안전 재고 · 재주문', sub: '직판 옵션마다 최소 재고 · 재주문 수량 — 판매용 재고 + 발주 중이 최소 밑이면 운영 알림과 재주문 초안(발주는 「발주로 넣기」를 눌러야 · 보내지 않음).', screen: 'SB-ADM-FIN2-040' },
  'acct-statements': { title: '재무제표', sub: '시산표 · 손익계산서 · 재무상태표와 기초 잔액(시작일 통장 · 받을 돈 · 갚을 돈 · 자본금 — 확정 뒤 못 고침)입니다.', screen: 'SB-ADM-ACC-110' },
  'acct-ledger':   { title: '원장 · 매입매출장', sub: '계정별 원장(날짜별 들고 남 · 잔액) · 거래처별 매출장 · 매입장 · CSV(내려받기 승인)', screen: 'SB-ADM-ACC-120' },
  'acct-assets':   { title: '고정자산', sub: '고정자산 대장 · 달마다 감가상각 전표(정액 · 정률 · 잔존가치 · 초안) · 매입에서 넘기기 · 처분 손익', screen: 'SB-ADM-ACC-130' },
  'hrx-overtime':  { title: '연장 · 야간 · 휴일 근로', sub: '신청 → 승인(본인 아님) · 주 52시간(기본 40 + 연장 12) 경고 · 근태와 비교 · 가산 수당을 급여 대장으로 — 가산율 · 한도는 일반 원칙 값(SUPER 고침 · 노무사 확인).', screen: 'SB-ADM-HRX-010' },
  'hrx-shifts':    { title: '근무표 · 교대', sub: '주 근무표(직원 × 7일) · 교대 유형 · 지난주 복사 · 근태(출퇴근)와 다른 칸 표시 · 7일 넘게 지난 칸은 못 바꿈.', screen: 'SB-ADM-HRX-020' },
  'hrx-booking':   { title: '회의실 · 장비 예약', sub: '자원 · 시간대 예약 — 같은 자원 시간이 겹치면 DB 가 막습니다 · 예약한 사람 · 관리자가 취소 · 내 예약은 사내 일정에도.', screen: 'SB-ADM-HRX-030' },
  'hrx-stocktake': { title: '자산 실사', sub: '고정자산 QR 라벨 인쇄 · 실사 회차 · QR 읽기로 찾음 · 없음 · 닫은 뒤 없어진 자산은 처분 전표로(SUPER).', screen: 'SB-ADM-HRX-040' },
  'acct-budget':   { title: '예산', sub: '계정별 달 예산(SUPER) · 실적 · 차이 · 넘으면 운영 알림 · 경영 보고서에 한 줄', screen: 'SB-ADM-ACC-140' },
  'acct-vatform':   { title: '부가세 신고서', sub: '일반과세자 신고서 칸을 전표 · 매입 관리로 채운 미리보기 — 실제 신고는 세무사 · 홈택스.', screen: 'SB-ADM-ACC-150' },
  'acct-aging':     { title: '기간 분석', sub: '받을 돈 · 갚을 돈을 거래처별 30 · 60 · 90일 · 넘음으로 — 넘으면 운영 알림.', screen: 'SB-ADM-ACC-160' },
  'acct-yearclose': { title: '해 마감', sub: '손익을 이월이익잉여금으로 넘기고 다음 해 기초 잔액 초안 — 마감한 해는 전표를 넣지 못함.', screen: 'SB-ADM-ACC-170' },
  'acct-whtreturn': { title: '원천세 신고서', sub: '지급한 달의 근로소득 · 사업소득 · 퇴직소득 원천세를 이행상황신고서 칸(A01 · A20 · A25 · A99)으로 · 납부 기한(다음 달 10일) · CSV.', screen: 'SB-ADM-ACC-270' },
  'acct-wagestmt':  { title: '지급명세서', sub: '해 · 반기 · 달 직원별 총급여 · 비과세 · 원천세 · 4대보험 본인 몫 · CSV · 원천징수영수증(인쇄) — 주민등록번호는 신고 때 채움.', screen: 'SB-ADM-ACC-280' },
  'acct-insurance': { title: '4대보험 신고', sub: '입사(취득) · 퇴사(상실) 신고 자료 · 보수월액 · 기한(다음 달 15일) · 처리함 — 기한 3일 전부터 운영 알림.', screen: 'SB-ADM-ACC-290' },
  'acct-payroll':   { title: '급여', sub: '직원 · 달 급여 · 원천세 · 4대보험 · 급여 전표 — 요율 · 간이세액표는 해마다 SUPER(초안).', screen: 'SB-ADM-ACC-180' },
  'acct-pg':        { title: 'PG 정산 맞추기', sub: 'PG 사 정산 내역 CSV ↔ PG 정산 받을 돈 · 수수료는 지급수수료 전표 · 안 들어온 결제 알림.', screen: 'SB-ADM-ACC-190' },
  'acct-manual':    { title: '수동 전표', sub: '자동으로 안 잡히는 거래(임대료 · 대출 등) — 요청 → 쓴 사람이 아닌 SUPER 승인 → 장부.', screen: 'SB-ADM-ACC-200' },
  'acct-severance': { title: '퇴직금 · 연차', sub: '퇴직금 추계(최근 3개월 급여) · 달마다 차이만 전표 · 연차 생긴 날 · 쓴 날(초안 · 노무사 확인).', screen: 'SB-ADM-ACC-210' },
  'acct-corptax':   { title: '법인세 추정', sub: '올해 회계 이익 기준 법인세 · 지방소득세 추정 · 중간예납 · 확정 신고 기한(세무조정 없음 · 세무사 확인).', screen: 'SB-ADM-ACC-220' },
  'acct-parties': { title: '거래처', sub: '매입처 · 매출처를 한 곳에 — 사업자번호 · 담당 · 계좌 끝 4자리 · 광고주 · 입점 판매자 · 매입 연결과 거래 합계입니다.', screen: 'SB-ADM-ACC-230' },
  'acct-contracts': { title: '계약', sub: '임대 · 용역 · 서버 · 구독 계약과 만기입니다. 만기 알림 일수 전부터 운영 알림이 뜨고, 달 금액은 자금 흐름 예정에 들어갑니다.', screen: 'SB-ADM-ACC-240' },
  'acct-requisitions': { title: '품의', sub: '쓰기 전에 지출 품의를 올리고 SUPER 가 결재합니다(본인 품의 불가). 승인된 품의는 매입 · 경비 청구에 연결합니다.', screen: 'SB-ADM-ACC-250' },
  'acct-exports': { title: '수출', sub: '수출 건을 수주 → 선적(선적일 환율로 매출 · 영세율 · 재고 출고) → 수출신고 수리(영세율 근거 번호) → 대금 회수(환율 차이 외환차익 · 차손)로 넘깁니다. 신고는 관세사.', screen: 'SB-ADM-ACC-310' },
  'acct-po':      { title: '국내 발주', sub: '국내 매입처에 발주하고, 들어오면 「입고」로 매입(세금계산서 · 부가세대급금)과 직판 재고에 한 번에 넣습니다.', screen: 'SB-ADM-ACC-320' },
  'acct-imports': { title: '수입', sub: '수입 건을 발주 → 선적 → 통관 → 입고로 넘깁니다. 입고 원가(물품 + 관세 + 운임 + 기타)는 재고 수불부로, 수입 부가세는 부가세대급금으로 갑니다. 신고는 관세사.', screen: 'SB-ADM-ACC-260' },
  'acct-docs':    { title: '견적 · 명세서', sub: '견적서 → 주문서 → 거래명세서를 이어 만들고 인쇄합니다. 거래명세서를 확정하면 매출 전표 · 세금계산서 요청으로 이어집니다. 발주서 인쇄도 여기서.', screen: 'SB-ADM-ACC-380' },
  'acct-depts':   { title: '부서 손익', sub: '부서 · 프로젝트를 만들고 전표에 꼬리표를 붙여 부서 · 프로젝트별 매출 · 비용 · 이익을 봅니다(꼬리표가 없으면 돈 흐름 기본 부서).', screen: 'SB-ADM-ACC-390' },
  'acct-wh':      { title: '창고 · 바코드', sub: '창고별 재고 · 창고 간 이동 · 창고 입고 · 실사, 상품 옵션 바코드(Code128) 인쇄 · 카메라 읽기 — 원가는 회사 전체 이동평균 그대로.', screen: 'SB-ADM-ACC-400' },
  'acct-dunning': { title: '미수금 독촉', sub: '거래처별 받을 돈과 독촉 단계(안내 → 독촉 → 최종) · 메일 미리 보기 · 보내기(자동은 처음 꺼짐) · 입금 예정은 자금 흐름에 들어갑니다.', screen: 'SB-ADM-ACC-410' },
  'acct-taxinbox': { title: '매입 세금계산서 받기', sub: '홈택스에 쌓인 매입 전자세금계산서를 연동 업체로 가져와 계정을 골라 매입으로 넘깁니다(업체 계약 전에는 간주). 같은 건은 한 번.', screen: 'SB-ADM-ACC-350' },
  'rpt-day':     { title: '일보', sub: '하루(한국 날짜) 회원 · 거래 · 소개몰 · 매출 · 고객센터 · 운영 알림 · 회계 할 일 · 업무 일지를 숫자로 한 장 — 매일 07:00 전날 것을 남김.', screen: 'SB-ADM-WRP-010' },
  'rpt-week':    { title: '주보', sub: '월요일 ~ 일요일 합계와 지난주 대비 증감 · 상위 5 — 월요일 07:00 지난주 것을 남김.', screen: 'SB-ADM-WRP-020' },
  'rpt-month':   { title: '월보', sub: '1일 ~ 말일 합계와 지난달 대비 증감 · 상위 5 — 1일 07:00 지난달 것을 남김.', screen: 'SB-ADM-WRP-030' },
  'rpt-trend':   { title: '추세', sub: '12달 · 13주 동안 매출 · 이익 · 현금 · 가입 · 소개몰 결제를 그래프로 — 전표 · 일보와 같은 셈입니다.', screen: 'SB-ADM-WRP-060' },
  'rpt-board':   { title: '일지 현황판', sub: '오늘 운영자마다 쓴 일지 · 안 쓴 사람 · 최근 7일 작성률 · 막힌 것 · 확인 안 한 일지(SUPER).', screen: 'SB-ADM-WRP-050' },
  'approvals':      { title: '결재함', sub: '내 결재 차례인 품의 · 경비 청구 · 수동 전표입니다 — 중간 단계는 여기서, 마지막(SUPER) 단계는 각 화면에서 승인 · 반려합니다.', screen: 'SB-ADM-APV-010' },
  'approval-lines': { title: '결재선', sub: '종류(품의 · 경비 청구 · 수동 전표)마다 금액 구간별 결재 단계(역할 또는 사람 · 마지막은 SUPER) — 없으면 SUPER 한 번.', screen: 'SB-ADM-APV-020' },
  'corp-docs':      { title: '사내 문서함', sub: '정관 · 등기부 · 인감 · 사업자등록 · 규정 · 인증서를 판으로 보관(지우기 없음) — 만료 30일 전부터 운영 알림.', screen: 'SB-ADM-DOC-010' },
  'its-assets':     { title: 'IT 자산 · 구독', sub: '프로그램 · 라이선스 수 · 담당 · 갱신일 · 달 비용 — 달 비용은 자금 흐름 예정에 이어지고, 갱신 30 · 7일 전에 운영 알림이 갑니다.', screen: 'SB-ADM-ITS-020' },
  'its-suggest':    { title: '제안함', sub: '업무 · 도구 · 복지 · 안전 제안을 냅니다. 익명으로 내면 쓴 사람 · 시각을 저장하지 않고, 접수 번호로 진행 · 답변을 봅니다.', screen: 'SB-ADM-ITS-030' },
  'its-survey':     { title: '사내 설문', sub: '대상 역할 · 기간 · 익명을 정해 묻고 결과를 모읍니다 — 익명 설문 결과는 마감 뒤 응답이 3명 이상일 때만 보입니다.', screen: 'SB-ADM-ITS-040' },
  'lgl-licenses':   { title: '회사 인허가', sub: '통신판매업 · 건강기능식품 판매업 등 인허가 · 신고의 번호 · 기관 · 다음 갱신일 · 서류 — 60 · 30 · 7일 전 운영 알림(종류 · 주기는 일반 원칙 값 · 법무 확인).', screen: 'SB-ADM-LGL-010' },
  'lgl-reviews':    { title: '계약 검토', sub: '계약서 파일을 올려 검토를 요청하고, 다른 운영자가 의견을, SUPER 가 승인 · 반려합니다 — 계약 대장과 연결.', screen: 'SB-ADM-LGL-020' },
  'lgl-cases':      { title: '소송 · 분쟁', sub: '회사가 당사자인 사건 · 상대 · 기일 · 대리인 · 비용(경비 청구 · 매입 연결) · 결과 — 기일 7 · 1일 전 운영 알림.', screen: 'SB-ADM-LGL-030' },
  'lgl-insurance':  { title: '회사 보험', sub: '보험 증권 · 보험사 · 보험료 · 기간 · 만기 30일 전 알림 · 갱신 — 보험료는 선급비용 · 비용 전표 초안(SUPER 승인).', screen: 'SB-ADM-LGL-040' },
  'perm-admin':     { title: '권한 관리', sub: '업무(탭)별 보기 · 고치기 · 승인 · 내려받기 권한을 권한그룹으로 묶어 사람에게 붙입니다(SUPER). 기존 역할 범위 안에서 더 좁힙니다.', screen: 'SB-ADM-PRM-010' },
  'rpt-worklog': { title: '업무 일지', sub: '운영자가 오늘 한 일 · 할 일 · 막힌 것을 남김(고치기 없음 · 덧붙임만) — SUPER 가 확인 · 한 줄 답.', screen: 'SB-ADM-WRP-040' },
  'acct-accountant': { title: '세무사', sub: '세무사 공유 계정(읽기 전용 · 기한 꼭)의 기한 · 접속 기록 · 질문과 답 — 세무사는 여기서 질문을 남깁니다.', screen: 'SB-ADM-ACC-420' },
  'acct-receipt':  { title: '영수증 읽기', sub: '증빙 사진에서 날짜 · 공급자 · 금액을 읽어 칸을 채워 줍니다(처음 꺼짐 · 간주) — 확인하고 고친 뒤 매입으로 넣습니다.', screen: 'SB-ADM-ACC-430' },
  'acct-accrual':  { title: '고정비', sub: '계약 달 금액을 매달 1일 미지급 비용으로 · 같은 거래처 매입이 오면 되돌림(비용 두 번 막기) · 빠진 매입 알림.', screen: 'SB-ADM-ACC-440' },
  'acct-archive':  { title: '장부 보관 · 통제', sub: '해 마감 뒤 장부 · 증빙 지문을 남기고(5년 · 지우지 않음) 달마다 내부통제 숫자를 봅니다.', screen: 'SB-ADM-ACC-450' },
  'acct-cardlimit':   { title: '법인카드 한도', sub: '카드(끝 4자리)마다 쓰는 사람 · 달 한도를 정하고 이번 달 사용을 봅니다 — 한도의 80% · 한도를 넘으면 운영 알림(매일 09:40).', screen: 'SB-ADM-FIN-010' },
  'fin-transfer':     { title: '대량 이체', sub: '거래처 대금 · 경비를 묶음으로 만들고, 만든 사람이 아닌 두 사람이 승인한 뒤 보냅니다(처음 꺼짐 · 간주) — 계좌는 끝 4자리만 보입니다.', screen: 'SB-ADM-FIN-020' },
  'acct-target':      { title: '매출 목표', sub: '달마다 회사 전체 · 부서 · 담당자 매출 목표를 정하고(SUPER) 실적 · 달성률을 봅니다 — 부서는 부서 손익과 같은 셈.', screen: 'SB-ADM-FIN-030' },
  'acct-partyledger': { title: '거래처 원장', sub: '거래처별 받을 돈 · 갚을 돈의 기초 · 늘어남 · 줄어듦 · 기말과 한 거래처 줄(전표) — CSV 는 내려받기 승인.', screen: 'SB-ADM-FIN-040' },
  'sal-crm':          { title: '영업 기회', sub: '거래처마다 상담 → 견적(견적서 연결) → 계약 → 성사 · 실패를 이어 보고, 예상 매출 · 담당 · 다음 할 일(날짜가 되면 운영 알림)을 둡니다.', screen: 'SB-ADM-SAL-010' },
  'acct-bankfeed':    { title: '은행 자동 조회', sub: '회사 계좌의 거래내역을 금융결제원으로 매일 06:40 가져와 은행 맞추기에 넣습니다(처음 꺼짐 · 간주) — 같은 줄 · CSV 로 올린 줄은 건너뜁니다.', screen: 'SB-ADM-SAL-020' },
  'acct-daybook':  { title: '분개장', sub: '기간 전표를 날짜 · 번호 순으로 줄째(계정 · 차변 · 대변) 봅니다 · 합계 차변 = 대변 · CSV(내려받기 승인).', screen: 'SB-ADM-LDG-010' },   /* v10.449 (D260) */
  'acct-cashbook': { title: '현금출납장', sub: '보통예금 · 현금(시재)의 날짜별 들어옴 · 나감 · 잔액 · CSV(내려받기 승인).', screen: 'SB-ADM-LDG-020' },   /* v10.450 (D260) */
  'acct-fxreval':  { title: '외화 환산 평가', sub: '달 말일까지 못 받은 수출 받을 돈을 기말 환율로 다시 셉니다 — 평가 전표 + 다음 달 첫날 되돌림(SUPER · 달마다 한 번).', screen: 'SB-ADM-LDG-030' },   /* v10.452 (D260) */
  'hr-attend':     { title: '근태', sub: '직원이 사무 › 내 인사에서 누른 출근 · 퇴근 · 달 집계(늦음 · 퇴근 없음 · 휴가) · 시각 고침(사유) · 달 확인 — 직원과 운영 계정 연결은 SUPER.', screen: 'SB-ADM-HRM-010' },
  'hr-leave':      { title: '휴가 신청', sub: '직원 휴가 신청을 승인 · 반려 — 승인하면 연차 쓴 날로 들어가고, 본인 신청은 다른 관리자가 처리합니다.', screen: 'SB-ADM-HRM-020' },
  'acct-payslip':  { title: '급여명세서', sub: '확정 · 지급한 급여의 직원별 명세서(인쇄) · 알림 메일(처음 꺼짐 · 금액 없음).', screen: 'SB-ADM-HRM-030' },
  'acct-yearend':  { title: '연말정산 자료', sub: '직원별 해 합계 · 달별 총급여 · 기납부 세액 · 서류 받음 표시 · CSV(승인) — 주민등록번호 · 결정세액은 회계 프로그램에서.', screen: 'SB-ADM-HRM-040' },
  'my-hr':         { title: '내 인사', sub: '출근 · 퇴근 누르기 · 이번 달 근태 · 남은 연차 · 휴가 신청 · 내 급여명세서.', screen: 'SB-ADM-HRM-050' },
  'ofc-calendar':  { title: '사내 일정', sub: '휴가 · 품의 쓸 날 · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한을 달 · 주로 모아 봅니다 — 직접 일정(개인 · 회사)도 넣습니다.', screen: 'SB-ADM-OFC-010' },
  'ofc-tasks':     { title: '업무 요청', sub: '요청 → 진행 → 완료 칸반 — 담당자가 진행 · 완료, 요청한 사람이 담당 바꾸기 · 취소 · 다시 열기 · 기한 지나면 표시 · 알림.', screen: 'SB-ADM-OFC-020' },
  'ofc-trips':     { title: '출장', sub: '출장 신청이 품의로 결재를 받고, 다녀온 뒤 여비 정산(일비 · 식비 · 숙박 · 교통)이 경비 청구로 올라갑니다 — 두 번 청구는 막습니다.', screen: 'SB-ADM-OFC-030' },
  'ofc-notify':    { title: '내 알림', sub: '운영 화면을 열어 둔 동안 급한 운영 알림 · 나에게 온 결재 · 업무 요청을 브라우저 알림으로 받습니다(계정마다 켬 · 브라우저가 허락할 때만).', screen: 'SB-ADM-OFC-040' },
  'hr-training':   { title: '법정 의무교육', sub: '성희롱 예방 · 개인정보 · 장애인 인식 개선 · 산업안전 — 직원별 이수 · 증빙 · 기한 알림(종류 · 주기는 일반 원칙 값 · SUPER 고침).', screen: 'SB-ADM-HRE-010' },
  'hr-contract':   { title: '근로계약서', sub: '양식 · 직원별 계약서 · 보내기 · 서명본 보관 — 전자서명 연동은 처음 꺼짐(간주 서명 · 법적 전자서명 아님).', screen: 'SB-ADM-HRE-020' },
  'hr-review':     { title: '인사 평가', sub: '분기 목표 → 자기 평가 → 상사 평가 · 등급 — 직원은 자기 것만 · 결과는 닫은 뒤에 보입니다.', screen: 'SB-ADM-HRE-030' },
  'hr-recruit':    { title: '채용', sub: '공고 · 지원자(최소 개인정보) · 면접 일정 · 합격 → 직원 대장 · 불합격 서류는 보관 기간 뒤 자동 파기.', screen: 'SB-ADM-HRE-040' },
  'acct-accounts': { title: '계정 · 규칙', sub: '전표 계정의 회계 프로그램 코드 · 계정 더하기, 돈 흐름별 전표 모양과 계정 자리 · 증빙 고치기(초안 · 세무사 확인 · 확인표 CSV), 전표 양식(세무사랑), 직판 상품의 과세 · 면세를 고릅니다.', screen: 'SB-ADM-ACC-040' },
  'my-password': { title: '내 비밀번호', sub: '운영 화면 계정의 비밀번호를 바꿉니다. 12자 이상 · 최근 3개는 다시 쓸 수 없음 · 90일마다 권함.', screen: 'SB-ADM-PWD-010' },
  'my-mfa':      { title: '내 2단계 인증', sub: '휴대폰 인증 앱을 등록해 운영 화면 로그인을 한 번 더 확인합니다.', screen: 'SB-ADM-MFA-010' },
  'staff-access': { title: '접속 인증', sub: '허용 IP 밖에서 들어오면 그날 한 번 텔레그램 인증번호를 넣습니다 — 허용 IP · 받을 곳 · 기록. 허용 IP 는 Nginx 반영 스크립트로 운영 화면 접속 허용에도 씁니다(SUPER).', screen: 'SB-ADM-SIP-010' },
  risk:          { title: 'AI 위험감지', sub: '규칙을 로그에 걸어 경보를 만듭니다. 경보마다 근거 · 규칙 원문 · 오탐 가능성을 함께 봅니다. 규칙은 숨기지 않습니다.', screen: 'SB-ADM-RSK-010' },
  'report-queue':{ title: '신고 처리', sub: '오래된 것이 위로 옵니다 — 신고해 놓고 답이 없으면 다음부터 신고를 안 합니다.', screen: 'SB-ADM-RPT-010' },
  'ai-ops':      { title: 'AI 운영', sub: '분류 · 검색 · 성향 · 위험감지의 품질을 보고 학습을 고칩니다.', screen: 'SB-ADM-AIS-010' },
  'gov-audit':   { title: '감사', sub: '징후를 보고 판단을 남깁니다.', screen: 'SB-ADM-AUD-010' },
  quals:         { title: '인증 · 자격 심사', sub: '자동 대조를 통과한 신청만 사람이 봅니다. 자격이 승인돼야 그 업종의 서비스 등록이 열립니다.', screen: 'SB-ADM-BRK-010' },
  ownership:     { title: '소유 확인 대기', sub: '등기사항증명서를 직접 보고 판단하십시오.', screen: 'SB-ADM-OWN-010' },
  community:     { title: '소개광장 검수', sub: '첫 글 · 신고된 글을 보고, 모든 글과 댓글을 찾아 감추거나 되살립니다.', screen: 'SB-ADM-CMU-010' },
  polls:         { title: '투표 관리', sub: '소개광장 「이건 어때?」와 메인의 세 장에 나오는 투표를 만들고 엽니다. 참여 수는 실제 표 수입니다.', screen: 'SB-ADM-CMU-020' },
  events:        { title: '이벤트 관리', sub: '지급 대기를 먼저 보여 줍니다 — 이벤트를 여는 것보다 약속한 것을 주는 일이 중요합니다.', screen: 'SB-ADM-EVT-010' },
  affiliates:    { title: '제휴 파트너스', sub: '관리자가 승인해야 링크를 발급할 수 있습니다. 입점 심사 · 제휴상품 · 목표 · 자료 · 정산을 여기서 처리합니다.', screen: 'SB-AFF-APL-010' },
  integrations:  { title: '외부 연동', sub: '연동 상태와 다음에 할 일입니다. 오픈을 막는 것이 무엇인지 여기서 봅니다.', screen: 'SB-ADM-SIT-080' },
  collect:       { title: '수집 관리', sub: '식약처 성분 데이터를 받아 우리 마스터와 대조합니다. 게이트를 모두 통과해야 돕니다.', screen: 'SB-ADM-COL-010' },
  roles:         { title: '권한 계층', sub: '역할과 가진 사람, 바뀐 이력을 봅니다.', screen: 'SB-ADM-ACL-010' },
  integ:         { title: '통합 현황', sub: '지금 어떤 상태인지 한 장으로 봅니다. 숫자는 실제 DB 조회값과 서버에 등록된 라우트입니다.', screen: 'SB-ADM-ITG-010' },
  adx:           { title: '광고 플랫폼 (외부 송출)', sub: '소개뱅크 지면뿐 아니라 외부 사이트에도 광고를 싣고, 클릭당 과금해 퍼블리셔와 나눕니다.', screen: 'SB-ADS-PLT-010' },
  'adx-payout':  { title: '퍼블리셔 지급', sub: '월 마감 → 명세서 → 신청 → 승인 → 집행. 각 단계에 사람이 다르고, 각 단계에 막는 장치가 있습니다.', screen: 'SB-ADS-PAY-010' },
  'gwan-ux':     { title: '관 UI/UX 관리', sub: '관마다 성격이 다르면 화면도 달라야 합니다. 축을 켜고 끄고, 축의 UI 유형을 여기서 정합니다.', screen: 'SB-ADM-GWN-010' },
  invariants:    { title: '불변식 현황', sub: '감시 뷰를 한 번에 훑습니다.', screen: 'SB-ADM-INV-010' },
};

/**
 * v10.32 — 하위 화면의 제목 줄(시안은 하위 화면마다 자기 제목을 씁니다). 키 = '탭/하위'(주소 #/탭/하위).
 * 여기 있으면 위 공통 제목 줄이 PAGE[탭] 대신 이 제목을 그립니다. 하위 탭 줄 · 묶음 줄은 그대로입니다.
 */
export const SUB_PAGE: Record<string, { title: string; sub?: string; screen?: string }> = {
  'ai-ops/agent': { title: 'AI 에이전트', sub: '스위치 · 월 상한 · 사용량 · AI 검수 일치율. 상한이 0 이면 아무것도 부르지 않습니다.', screen: 'SB-ADM-AGT-010' },
  'ai-ops/segments-preview': { title: '옮길 대상 미리보기', sub: '학습을 실행하면 옮겨질 회원입니다. 실행 전에 확인합니다.', screen: 'SB-ADM-SEG-020' },
  'gov-audit/logs':          { title: '감사 기록', sub: '운영 · 회원 행위 기록입니다. 고치거나 지울 수 없습니다.', screen: 'SB-ADM-AUD-020' },
  'partners/detail':         { title: '파트너사 상세', sub: '입점 파트너사 한 곳의 계약 · 서비스 · 리드 · 이용료를 한 화면에서 봅니다.', screen: 'SB-ADM-PTN-011' },
  'partners/rejects':        { title: '리드 반려 · 인정 / 기각', sub: '인정하면 이용료가 무효가 되고 리드가 없던 것이 됩니다. 기각하면 사유가 파트너에게 갑니다 (T-04).', screen: 'SB-ADM-PTN-050' },
  'quals/medical':           { title: '의료 심의 · 본사 확인', sub: '심의필을 확인해야 광고 가능(AD_READY)으로 넘어가 광고가 시작됩니다 — 의료법 제27조 (T-03).', screen: 'SB-ADM-PTN-040' },
  'quals/detail':            { title: '인증 심사 상세', sub: '승인은 심사 대기이고 국토부 대조가 일치할 때만 됩니다. 반려에는 사유가 반드시 있어야 합니다.', screen: 'SB-ADM-BRK-011' },
  'quals/cats':              { title: '카테고리 마스터', sub: '카테고리가 등록 폼과 단가 입력 방식을 정합니다 (T-05 · T-06).', screen: 'SB-ADM-PTN-060' },
  'gwans/new':               { title: '새 관 만들기', sub: '순서가 중요합니다 — 무엇을 소개하는 관인지 먼저 정해야 나머지가 정해집니다.', screen: 'SB-ADM-SIT-020' },
};

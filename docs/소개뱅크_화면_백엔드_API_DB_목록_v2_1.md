# 소개뱅크 — 화면 · 백엔드 · API · DB 목록 v2.1

2026-09-24 · **배포본을 직접 돌려 뽑은 실측입니다** (수정 후 재측정)

```
화면 168 · API 342
표 181 (+타스키마 3) · 뷰 272 (감시 77) · 함수 545 · 트리거 194 · 외래키 283
모듈 22 · 컨트롤러 37 · 서비스 41 · 마이그레이션 43
```

## v1.0(9/18)에서 달라진 것

| 항목 | v1.0 | v2.0 | 늘어난 수 |
|---|---|---|---|
| 화면 | 149 | 168 | +19 |
| API | 284 | 342 | +58 |
| 표 | 159 | 181 | +22 |
| 뷰 | 229 | 259 | +30 |
| 함수 | 505 | 532 | +27 |
| 트리거 | 167 | 176 | +9 |

주로 **검색 사전 · 분류 학습 · 성향 학습 · 위험감지 학습**과 그에 딸린 운영화면 4종이 늘었습니다.

---

# 1. 화면 목록 (168)

### ADM — 운영 (59)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-ADM-DSH-010 | 관리자 대시보드 | `/admin` | ADMIN,SUPER |
| SB-ADM-REV-010 | 검수 큐 | `/admin/review` | REVIEWER,ADMIN,SUPER |
| SB-ADM-REV-020 | 반려 사유 입력 | `/admin/review/{id}` | REVIEWER,ADMIN,SUPER |
| SB-ADM-REV-030 | 자동검수 규칙 관리 | `/admin/review/rules` | ADMIN,SUPER |
| SB-ADM-REV-040 | 표본 감사 | `/admin/review/audit` | REVIEWER,ADMIN,SUPER |
| SB-ADM-CAT-010 | 업종 승인 · 관리 | `/admin/category` | ADMIN,SUPER |
| SB-ADM-USR-010 | 회원 · 사업자 인증 | `/admin/users` | ADMIN,SUPER |
| SB-ADM-DEL-010 | 거래 모니터링 | `/admin/deals` | ADMIN,SUPER |
| SB-ADM-STL-010 | 정산 현황 | `/admin/settlement` | ADMIN,SUPER |
| SB-ADM-DSP-010 | 분쟁 처리 | `/admin/disputes` | ADMIN,SUPER |
| SB-ADM-POL-010 | 금칙어 · 제한업종 · 요율 | `/admin/policy` | SUPER |
| SB-ADM-SIT-010 | 관 목록 · 현황 | `/admin/site` | SUPER |
| SB-ADM-SIT-020 | 새 관 만들기 | `/admin/site/new` | SUPER |
| SB-ADM-SIT-030 | 관 설정 (8개 탭) | `/admin/site/{code}` | SUPER |
| SB-ADM-SIT-040 | 오픈 체크리스트 | `/admin/site/checklist` | SUPER |
| SB-ADM-SIT-050 | 통합 메인 · 허브 | `/admin/site/hub` | SUPER |
| SB-ADM-SIT-060 | 공유 경계 · 영향 범위 | `/admin/site/scope` | SUPER |
| SB-ADM-SIT-070 | 사이트 기본 정보 · 법정 고지 | `/admin/site/info` | SUPER |
| SB-ADM-MAIN-010 | 메인 운영 · 배너/광고 | `/admin/main/banner` | ADMIN,SUPER |
| SB-ADM-MAIN-020 | 메인 운영 · 관 노출 | `/admin/main/gwan` | ADMIN,SUPER |
| SB-ADM-MAIN-030 | 메인 운영 · 화면 구성 | `/admin/main/layout` | ADMIN,SUPER |
| SB-ADM-MAIN-040 | 메인 운영 · 콘텐츠 | `/admin/main/content` | ADMIN,SUPER |
| SB-ADM-COD-010 | 코드 라벨 관리 | `/admin/codes` | SUPER |
| SB-ADM-BDG-010 | 배지 신청 검수 | `/admin/badges` | REVIEWER,ADMIN,SUPER |
| SB-ADM-SIT-080 | 외부 연동 관리 | `/admin/site/integrations` | SUPER |
| SB-ADM-ADS-010 | 광고 관리 | `/admin/ads` | ADMIN,SUPER |
| SB-ADM-RSK-010 | AI 위험감지 | `/admin/risk` | ADMIN,SUPER |
| SB-ADM-BIL-010 | 청구 현황 | `/admin/billing` | ADMIN,SUPER |
| SB-ADM-PTN-010 | 파트너사 목록과 막힌 업무 7건 | `/partners` | ADMIN,SUPER |
| SB-ADM-PTN-020 | 입점 신청 승인(T-01) | `/partners/apply` | ADMIN,SUPER |
| SB-ADM-PTN-030 | 서비스 검수 승인(T-02) | `/partners/services` | ADMIN,SUPER |
| SB-ADM-PTN-040 | 의료 심의 본사 확인(T-03) | `/partners/medical` | ADMIN,SUPER |
| SB-ADM-PTN-050 | 리드 반려 인정/기각(T-04) | `/partners/rejects` | ADMIN,SUPER |
| SB-ADM-PTN-060 | 카테고리 마스터(T-05 · T-06) | `/partners/categories` | ADMIN,SUPER |
| SB-ADM-PTN-070 | 규제 카테고리 자격 심사(T-21) | `/partners/qualification` | ADMIN,SUPER |
| SB-ADM-PTN-080 | 소개캐시 입금 확인과 리드 등급 비율 | `/partners/wallet` | ADMIN,SUPER |
| SB-ADM-BRK-010 | 중개사 인증 심사 | `/admin/qualifications` | ADMIN |
| SB-ADM-BRK-011 | 중개사 인증 상세 | `/admin/qualifications/{id}` | ADMIN |
| SB-ADM-ADS-020 | 광고 플랫폼 연동 (내부) | `/admin/ads/internal` | ADMIN |
| SB-ADM-RPT-010 | 신고 처리 | `/admin/report-queue` | ADMIN |
| SB-ADM-EVT-010 | 이벤트 관리 | `/admin/events` | ADMIN |
| SB-ADM-AIS-010 | AI 운영 | `/admin/ai-ops` | ADMIN |
| SB-ADM-ADB-010 | 광고 과금 · 정산 | `/admin/ad-billing` | ADMIN |
| SB-ADM-COL-010 | 수집 관리 | `/admin/collect` | ADMIN |
| SB-ADM-HST-010 | 건강몰 정산 | `/admin/health/settlements` | ADMIN |
| SB-ADM-MBR-010 | 회원 목록 | `/admin/members` | ADMIN,SUPER |
| SB-ADM-MBR-020 | 회원 상세 | `/admin/members/{id}` | ADMIN,SUPER |
| SB-ADM-CMU-010 | 커뮤니티 검수 큐 | `/admin/community` | ADMIN,SUPER |
| SB-ADM-GWN-010 | 관 관리 | `/admin/gwans` | ADMIN,SUPER |
| SB-ADM-ITG-010 | 외부 연동 상태 | `/admin/integrations` | ADMIN,SUPER |
| SB-ADM-OWN-010 | 소유 확인 대기 | `/admin/ownership` | ADMIN,SUPER |
| SB-ADM-INV-010 | 불변식 현황 | `/admin/invariants` | ADMIN,SUPER |
| SB-ADM-ACL-010 | 권한 계층 | `/admin/acl` | ADMIN,SUPER |
| SB-ADM-SCH-010 | 검색 파서 · 로그 | `/admin/search` | ADMIN,SUPER |
| SB-ADM-AUD-010 | 감사 | `/admin/audit` | ADMIN,SUPER |
| SB-ADM-DIC-010 | 검색 사전 | `/admin/dict` | ADMIN,SUPER |
| SB-ADM-CLS-020 | 분류 학습 | `/admin/classify` | ADMIN,SUPER |
| SB-ADM-SEG-010 | 성향 학습 | `/admin/segments` | ADMIN,SUPER |
| SB-ADM-RSK-020 | 위험감지 학습 | `/admin/risk/learn` | ADMIN,SUPER |

### HOM — 통합 메인·공통 (30)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-HOM-MAIN-011 | 메인 (비로그인) | `/` | GUEST |
| SB-HOM-MAIN-010 | 메인 (로그인) | `/` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-HOM-AUT-010 | 로그인 | `/login` | GUEST |
| SB-HOM-AUT-020 | 회원가입 | `/signup` | GUEST |
| SB-HOM-AUT-030 | 본인·사업자 인증 | `/verify` | MEMBER |
| SB-HOM-LST-010 | 통합 전체 목록 | `/listings` | GUEST |
| SB-HOM-SRC-010 | 통합 검색 결과 | `/search` | GUEST |
| SB-HOM-REG-010 | 소개하기 등록 | `/register` | BIZ_OWNER,BIZ_STAFF |
| SB-HOM-REG-020 | 소개하기 수정 (재검수) | `/listings/{id}/edit` | BIZ_OWNER,BIZ_STAFF |
| SB-HOM-REQ-010 | 소개받기 등록 | `/request/new` | BIZ_OWNER,BIZ_STAFF |
| SB-HOM-REQ-020 | 소개받기 목록 | `/request` | GUEST |
| SB-HOM-REQ-030 | 요청 상세 · 소개 제안 | `/request/{id}` | MEMBER |
| SB-HOM-MCH-010 | 1:1 문의 · Deal 생성 | `/chat/{id}` | BIZ_OWNER,BIZ_STAFF |
| SB-HOM-MCH-020 | 공개 문의 목록 | `/{gwan}/{id}#qna` | GUEST |
| SB-HOM-DEL-010 | 계약서 발급 · 서명 | `/deal/{id}/contract` | BIZ_OWNER |
| SB-HOM-DEL-020 | 대금 지급 신고 | `/deal/{id}/payment` | BIZ_OWNER |
| SB-HOM-DEL-030 | 성사 확정 | `/deal/{id}/confirm` | BIZ_OWNER |
| SB-HOM-RVW-010 | 후기 작성 | `/deal/{id}/review` | BIZ_OWNER |
| SB-HOM-CSB-010 | 고객센터 · 챗봇 | `/support` | GUEST |
| SB-HOM-CSB-020 | 내 문의 내역 | `/support/history` | MEMBER |
| SB-HOM-ETC-010 | 분쟁 접수 · 처리 현황 | `/support/dispute` | BIZ_OWNER |
| SB-HOM-ETC-020 | 푸터 · 약관 · 법정고지 | `/terms` | GUEST |
| SB-HOM-ETC-030 | 고객센터 문의하기 | `/support/new` | GUEST |
| SB-HOM-ETC-031 | 문의 접수 완료 | `/support/done` | GUEST |
| SB-HOM-INV-010 | 초대 확인 · 동의 | `/i/{token}` | GUEST |
| SB-HOM-RPT-010 | 신고하기 | `/report/{targetType}/{targetId}` | MEMBER,BIZ_OWNER |
| SB-HOM-CMU-010 | 커뮤니티 목록 | `/community` | GUEST,MEMBER |
| SB-HOM-CMU-020 | 커뮤니티 글 상세 · 댓글 | `/community/{id}` | GUEST,MEMBER |
| SB-HOM-CMU-030 | 커뮤니티 글쓰기 | `/community/write` | MEMBER |
| SB-HOM-SCH-020 | 검색 결과 팝업 | `/search` | - |

### HLT — 건강몰 (21)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-HLT-HUB-010 | 건강몰 메인 | `/health` | GUEST |
| SB-HLT-HUB-020 | 직판관 | `/health/direct` | GUEST |
| SB-HLT-CAT-010 | 전체제품 · 카테고리 | `/health/c/{code}` | GUEST |
| SB-HLT-CAT-020 | 검색 | `/health/search` | GUEST |
| SB-HLT-CAT-030 | 성분별 인덱스 | `/health/ingredients` | GUEST |
| SB-HLT-CAT-040 | 성분 상세 | `/health/i/{code}` | GUEST |
| SB-HLT-CAT-050 | 고민별 인덱스 | `/health/concerns` | GUEST |
| SB-HLT-CAT-060 | 고민 상세 | `/health/w/{code}` | GUEST |
| SB-HLT-PRD-010 | 상품 상세 | `/health/p/{code}` | GUEST |
| SB-HLT-CRT-010 | 장바구니 | `/health/cart` | MEMBER,BIZ_OWNER |
| SB-HLT-ORD-010 | 주문서 | `/health/order` | MEMBER,BIZ_OWNER |
| SB-HLT-ORD-020 | 결제 | `/health/order/pay` | MEMBER,BIZ_OWNER |
| SB-HLT-ORD-030 | 주문 완료 | `/health/order/done` | MEMBER,BIZ_OWNER |
| SB-HLT-ORD-040 | 주문 실패 | `/health/order/fail` | MEMBER,BIZ_OWNER |
| SB-HLT-MYO-010 | 내 주문 목록 | `/my/health/orders` | MEMBER,BIZ_OWNER |
| SB-HLT-MYO-020 | 주문 상세 | `/my/health/orders/{no}` | MEMBER,BIZ_OWNER |
| SB-HLT-MYO-030 | 배송 조회 | `/my/health/orders/{no}/ship` | MEMBER,BIZ_OWNER |
| SB-HLT-RTN-010 | 취소 · 반품 신청 | `/my/health/returns/new` | MEMBER,BIZ_OWNER |
| SB-HLT-RTN-020 | 취소 · 반품 내역 | `/my/health/returns` | MEMBER,BIZ_OWNER |
| SB-HLT-ADR-010 | 배송지 관리 | `/my/health/addresses` | MEMBER,BIZ_OWNER |
| SB-HLT-ETC-010 | 이용안내 · 청약철회 | `/health/guide` | GUEST |

### MYP — 나의 공간 (19)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-MYP-DSH-010 | 마이페이지 대시보드 | `/my` | MEMBER |
| SB-MYP-LST-010 | 내 리스팅 | `/my/listings` | BIZ_OWNER,BIZ_STAFF |
| SB-MYP-LIK-010 | 관심 목록 | `/my/likes` | MEMBER |
| SB-MYP-DEA-010 | 소개 내역 · 귀속 코드 | `/my/deals` | BIZ_OWNER |
| SB-MYP-SUB-010 | 구독 · 소개코드 발급 | `/my/subscription` | BIZ_OWNER |
| SB-MYP-SUB-020 | 한도 초과 · 업그레이드 | `/my/subscription/upgrade` | BIZ_OWNER |
| SB-MYP-BIZ-020 | 사업자 전환 안내 | `/my/business` | MEMBER |
| SB-MYP-STL-010 | 정산 신청 | `/my/settlement` | BIZ_OWNER |
| SB-MYP-STL-020 | 지급 내역 · 세금계산서 | `/my/settlement/history` | BIZ_OWNER |
| SB-MYP-NTF-010 | 알림 센터 | `/my/notifications` | MEMBER |
| SB-MYP-PAY-010 | 결제 수단 관리 | `/my/payment` | MEMBER |
| SB-MYP-INT-010 | 소개자 홈 | `/my/intro` | MEMBER |
| SB-MYP-INT-020 | 초대 보내기 | `/my/intro/invite` | MEMBER |
| SB-MYP-INT-030 | 활동 · 포인트 | `/my/intro/activity` | MEMBER |
| SB-MYP-CTR-010 | 계약 진행 목록 | `/my/contracts` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-MYP-CTR-020 | 계약서 · 체결 | `/my/contracts/{id}` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-MYP-RPT-010 | 내 신고 내역 | `/my/reports` | MEMBER,BIZ_OWNER |
| SB-MYP-EVT-010 | 내 이벤트 참여 | `/my/events` | MEMBER,BIZ_OWNER |
| SB-MYP-ACC-010 | 프로필 · 사업자 정보 수정 | `/my/account` | MEMBER |

### PTC2 — 파트너센터 (10)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-PTC2-DSH-010 | 대시보드 | `/partners` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-LNK-010 | 내 소개링크 | `/partners/links` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-ORD-010 | 주문/고객현황 | `/partners/orders` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-REV-010 | 수익관리 | `/partners/revenues` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-STL-010 | 정산내역 | `/partners/settlements` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-REC-010 | 추천상품 | `/partners/products` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-MKT-010 | 마케팅자료실 | `/partners/materials` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-NTC-010 | 공지사항 | `/partners/notices` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-QNA-010 | 1:1 문의 | `/partners/inquiries` | MEMBER,BIZ_OWNER,BIZ_STAFF |
| SB-PTC2-GDE-010 | 파트너가이드 | `/partners/guides` | MEMBER,BIZ_OWNER,BIZ_STAFF |

### MNY — 소개머니 (8)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-MNY-MAIN-010 | 소개머니 랜딩 · 목록 | `/money` | GUEST |
| SB-MNY-DTL-010 | 소개머니 상세 | `/money/{id}` | GUEST |
| SB-MNY-WIN-010 | 퀵메뉴 · 신규 | `/money/new` | GUEST |
| SB-MNY-BST-010 | 퀵메뉴 · 인기 | `/money/best` | GUEST |
| SB-MNY-URG-010 | 퀵메뉴 · 급구 | `/money/urgent` | GUEST |
| SB-MNY-SAF-010 | 퀵메뉴 · 서류 확인 | `/money/verified` | GUEST |
| SB-MNY-EVT-010 | 이벤트존 · 커뮤니티 | `/money/event` | GUEST |
| SB-MNY-LST-010 | 소개머니 전체 목록 | `/money/list` | BUSINESS |

### BIZ — 소개창업 (6)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-BIZ-MAIN-010 | 소개창업 랜딩 · 목록 | `/biz` | GUEST |
| SB-BIZ-DTL-010 | 소개창업 상세 | `/biz/{id}` | GUEST |
| SB-BIZ-REG-010 | 소개창업 등록 (역할 탭) | `/biz/register` | BIZ_OWNER |
| SB-BIZ-LST-010 | 소개창업 전체 목록 | `/biz/list` | BUSINESS |
| SB-BIZ-BRK-010 | 중개사 인증 신청 | `/my/broker` | MEMBER,BIZ_OWNER |
| SB-BIZ-BRK-011 | 중개사 인증 상태 | `/my/broker/status` | MEMBER,BIZ_OWNER |

### AFF — 제휴 (5)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-AFF-APL-010 | 파트너 입점 심사 | `/admin/affiliates` | ADMIN,SUPER |
| SB-AFF-PRD-010 | 제휴상품 · 단가 | `/admin/affiliates/products` | ADMIN,SUPER |
| SB-AFF-GOL-010 | 목표 설정 · 지급 | `/admin/affiliates/goals` | ADMIN,SUPER |
| SB-AFF-MTR-010 | 마케팅자료 심의 | `/admin/affiliates/materials` | ADMIN,SUPER |
| SB-AFF-STL-010 | 트랙별 정산 배치 | `/admin/affiliates/settlements` | ADMIN,SUPER |

### MAL — 소개몰 (4)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-MAL-MAIN-010 | 소개몰 랜딩 · 목록 | `/mall` | GUEST |
| SB-MAL-DTL-010 | 소개몰 상세 | `/mall/{id}` | GUEST |
| SB-MAL-LST-010 | 소개몰 전체 목록 | `/mall/list` | BUSINESS |
| SB-MAL-BRK-010 | 중개사 매물 · 소유 확인 | `/mal/brokers` | MEMBER,BIZ_OWNER |

### AIS — AI 성향 (4)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-AIS-PRF-010 | 관심 성향 분석 | `/ai/profile` | MEMBER |
| SB-AIS-PRF-020 | 성향 등록 완료 | `/ai/profile/done` | MEMBER |
| SB-AIS-CLS-010 | AI 자동 분류 | `/ai/classify` | MEMBER |
| SB-AIS-REC-010 | AI 추천 결과 | `/ai/match` | MEMBER |

### ADS — 광고 (2)

| 화면 ID | 이름 | 주소 | 권한 |
|---|---|---|---|
| SB-ADS-PAY-010 | 광고 과금 · 청구 | `/admin/affiliates/ad-billing` | ADMIN,SUPER |
| SB-ADS-PLT-010 | 광고주 · 소재 관리 | `/admin/affiliates/ads` | ADMIN,SUPER |

---

# 2. 백엔드 목록

모듈 22 · 컨트롤러 37 · 서비스 41 · 가드/필터 2 · 마이그레이션 43 · 화면 소스(tsx) 155

| 모듈 | 컨트롤러 | 서비스 |
|---|---|---|
| admin | 3 | 2 |
| ads | 2 | 2 |
| affiliate | 1 | 1 |
| ai | 2 | 2 |
| billing | 2 | 2 |
| catalog | 3 | 4 |
| community | 1 | 1 |
| deal | 1 | 1 |
| govern | 3 | 3 |
| health | 1 | 1 |
| identity | 1 | 3 |
| introducer | 1 | 1 |
| listing | 2 | 2 |
| me | 1 | 1 |
| partner | 1 | 2 |
| public | 2 | 1 |
| realty | 1 | 1 |
| request | 1 | 1 |
| review | 2 | 2 |
| search | 1 | 1 |
| settlement | 1 | 1 |
| site | 3 | 4 |

---

# 3. API 목록 (342)

| 방식 | 개수 |
|---|---|
| GET | 190 |
| POST | 110 |
| PATCH | 36 |
| DELETE | 5 |
| PUT | 1 |

**DELETE가 5개뿐인 것은 일부러입니다.** 과금·정산 기록은 지울 수 없어야 하고, 트리거가 DB에서 한 번 더 막습니다.

### admin (158)

| 방식 | 주소 |
|---|---|
| DELETE | `/api/v1/admin/risk/exemptions/:id` |
| GET | `/api/v1/admin/accounts` |
| GET | `/api/v1/admin/accounts/:id` |
| GET | `/api/v1/admin/acl` |
| GET | `/api/v1/admin/ad-creatives` |
| GET | `/api/v1/admin/ad-creatives/stats` |
| GET | `/api/v1/admin/ad-invoices` |
| GET | `/api/v1/admin/ad-receivables` |
| GET | `/api/v1/admin/ad-settlement` |
| GET | `/api/v1/admin/ads` |
| GET | `/api/v1/admin/advertisers` |
| GET | `/api/v1/admin/affiliates/applications` |
| GET | `/api/v1/admin/affiliates/goals` |
| GET | `/api/v1/admin/affiliates/materials/queue` |
| GET | `/api/v1/admin/affiliates/products` |
| GET | `/api/v1/admin/affiliates/settlements` |
| GET | `/api/v1/admin/audit/logs` |
| GET | `/api/v1/admin/audit/reviews` |
| GET | `/api/v1/admin/audit/signals` |
| GET | `/api/v1/admin/auto-review/samples` |
| GET | `/api/v1/admin/badges` |
| GET | `/api/v1/admin/banned-words` |
| GET | `/api/v1/admin/billing/attempts-today` |
| GET | `/api/v1/admin/billing/notice-missing` |
| GET | `/api/v1/admin/billing/overdue` |
| GET | `/api/v1/admin/billing/policy` |
| GET | `/api/v1/admin/businesses` |
| GET | `/api/v1/admin/categories` |
| GET | `/api/v1/admin/classify/learn/log` |
| GET | `/api/v1/admin/code-labels` |
| GET | `/api/v1/admin/collect/fetches` |
| GET | `/api/v1/admin/collect/health` |
| GET | `/api/v1/admin/collect/sources` |
| GET | `/api/v1/admin/community/queue` |
| GET | `/api/v1/admin/deals` |
| GET | `/api/v1/admin/disputes` |
| GET | `/api/v1/admin/events` |
| GET | `/api/v1/admin/events/ungranted` |
| GET | `/api/v1/admin/gwans` |
| GET | `/api/v1/admin/gwans/:code` |
| GET | `/api/v1/admin/gwans/manage` |
| GET | `/api/v1/admin/health/commission-rates` |
| GET | `/api/v1/admin/health/sellers` |
| GET | `/api/v1/admin/health/settlements` |
| GET | `/api/v1/admin/hub` |
| GET | `/api/v1/admin/integrations` |
| GET | `/api/v1/admin/invariants` |
| GET | `/api/v1/admin/layout` |
| GET | `/api/v1/admin/main/copy` |
| GET | `/api/v1/admin/main/notices` |
| GET | `/api/v1/admin/main/sections` |
| GET | `/api/v1/admin/notices` |
| GET | `/api/v1/admin/open-blockers` |
| GET | `/api/v1/admin/ownership-queue` |
| GET | `/api/v1/admin/partners` |
| GET | `/api/v1/admin/partners/fees` |
| GET | `/api/v1/admin/policies` |
| GET | `/api/v1/admin/qualifications` |
| GET | `/api/v1/admin/qualifications/medical` |
| GET | `/api/v1/admin/qualifications/properties` |
| GET | `/api/v1/admin/qualifications/rules` |
| GET | `/api/v1/admin/report-queue` |
| GET | `/api/v1/admin/reports/daily` |
| GET | `/api/v1/admin/reports/not-agreed` |
| GET | `/api/v1/admin/reports/pending` |
| GET | `/api/v1/admin/reports/revenue` |
| GET | `/api/v1/admin/reports/roles` |
| GET | `/api/v1/admin/reports/roles/changes` |
| GET | `/api/v1/admin/reports/signals` |
| GET | `/api/v1/admin/review-reasons` |
| GET | `/api/v1/admin/reviews` |
| GET | `/api/v1/admin/reviews/:id` |
| GET | `/api/v1/admin/reviews/throughput` |
| GET | `/api/v1/admin/risk/alerts` |
| GET | `/api/v1/admin/risk/classify-health` |
| GET | `/api/v1/admin/risk/exemptions` |
| GET | `/api/v1/admin/risk/rule-health` |
| GET | `/api/v1/admin/risk/rules` |
| GET | `/api/v1/admin/scope` |
| GET | `/api/v1/admin/search/parser` |
| GET | `/api/v1/admin/settlement-ledger` |
| GET | `/api/v1/admin/settlement-ledger/reconcile` |
| GET | `/api/v1/admin/settlements` |
| GET | `/api/v1/admin/site-settings` |
| GET | `/api/v1/admin/summary` |
| GET | `/api/v1/admin/terms` |
| PATCH | `/api/v1/admin/ad-creatives/:code/attribution` |
| PATCH | `/api/v1/admin/advertisers/:id/status` |
| PATCH | `/api/v1/admin/affiliates/products/:id` |
| PATCH | `/api/v1/admin/banned-words/:id` |
| PATCH | `/api/v1/admin/billing/policy/:key` |
| PATCH | `/api/v1/admin/businesses/:id/verify` |
| PATCH | `/api/v1/admin/categories/:id` |
| PATCH | `/api/v1/admin/code-labels/:domain/:code` |
| PATCH | `/api/v1/admin/collect/sources/:code/gate` |
| PATCH | `/api/v1/admin/collect/sources/:code/state` |
| PATCH | `/api/v1/admin/disputes/:id` |
| PATCH | `/api/v1/admin/event-joins/:id/grant` |
| PATCH | `/api/v1/admin/events/:code/status` |
| PATCH | `/api/v1/admin/gwans/:code` |
| PATCH | `/api/v1/admin/gwans/:code/visibility` |
| PATCH | `/api/v1/admin/gwans/landing` |
| PATCH | `/api/v1/admin/gwans/order` |
| PATCH | `/api/v1/admin/integrations/:code` |
| PATCH | `/api/v1/admin/integrations/egress-ip` |
| PATCH | `/api/v1/admin/layout` |
| PATCH | `/api/v1/admin/main/copy/:slot` |
| PATCH | `/api/v1/admin/main/sections/:code` |
| PATCH | `/api/v1/admin/policies/auto-review/:key` |
| PATCH | `/api/v1/admin/policies/restrictions/:code` |
| PATCH | `/api/v1/admin/reports/:id/resolve` |
| PATCH | `/api/v1/admin/reviews/:id` |
| PATCH | `/api/v1/admin/settlements/:id` |
| PATCH | `/api/v1/admin/site-settings` |
| PATCH | `/api/v1/admin/terms/:code/publish` |
| POST | `/api/v1/admin/ad-creatives/:code/assign` |
| POST | `/api/v1/admin/ad-creatives/:code/review-confirm` |
| POST | `/api/v1/admin/ad-invoices` |
| POST | `/api/v1/admin/ad-invoices/:id/payments` |
| POST | `/api/v1/admin/ads` |
| POST | `/api/v1/admin/advertisers` |
| POST | `/api/v1/admin/affiliates/applications/:id/decide` |
| POST | `/api/v1/admin/affiliates/goals` |
| POST | `/api/v1/admin/affiliates/materials/:id/review` |
| POST | `/api/v1/admin/affiliates/products` |
| POST | `/api/v1/admin/affiliates/settlements/run` |
| POST | `/api/v1/admin/audit/reviews` |
| POST | `/api/v1/admin/auto-review/samples/:id` |
| POST | `/api/v1/admin/banned-words` |
| POST | `/api/v1/admin/billing/charge-due` |
| POST | `/api/v1/admin/classify/correct` |
| POST | `/api/v1/admin/classify/learn` |
| POST | `/api/v1/admin/classify/learn/revert` |
| POST | `/api/v1/admin/collect/sources` |
| POST | `/api/v1/admin/collect/sources/:code/run` |
| POST | `/api/v1/admin/community/posts/:id/approve` |
| POST | `/api/v1/admin/community/posts/:id/hide` |
| POST | `/api/v1/admin/events` |
| POST | `/api/v1/admin/gwans` |
| POST | `/api/v1/admin/health/settlements/close` |
| POST | `/api/v1/admin/jobs` |
| POST | `/api/v1/admin/jobs/run` |
| POST | `/api/v1/admin/jobs/tick` |
| POST | `/api/v1/admin/notices` |
| POST | `/api/v1/admin/ownership/:id/decide` |
| POST | `/api/v1/admin/partners/:id/approve` |
| POST | `/api/v1/admin/partners/fees/:id/void` |
| POST | `/api/v1/admin/partners/services/:id/review` |
| POST | `/api/v1/admin/qualifications/:id/decide` |
| POST | `/api/v1/admin/qualifications/:id/lookup` |
| POST | `/api/v1/admin/qualifications/properties/:id/decide` |
| POST | `/api/v1/admin/reports/roles` |
| POST | `/api/v1/admin/risk/alerts` |
| POST | `/api/v1/admin/risk/alerts/:id/close` |
| POST | `/api/v1/admin/risk/exemptions` |
| POST | `/api/v1/admin/risk/learn` |
| POST | `/api/v1/admin/settlement-ledger/:id/paid` |
| PUT | `/api/v1/admin/terms/:code` |

### me (61)

| 방식 | 주소 |
|---|---|
| DELETE | `/api/v1/me/billing-key` |
| DELETE | `/api/v1/me/community/posts/:id` |
| DELETE | `/api/v1/me/favorites/:targetId` |
| DELETE | `/api/v1/me/profile` |
| GET | `/api/v1/me/account` |
| GET | `/api/v1/me/billing-key` |
| GET | `/api/v1/me/contracts` |
| GET | `/api/v1/me/deals` |
| GET | `/api/v1/me/disputes` |
| GET | `/api/v1/me/events` |
| GET | `/api/v1/me/favorites` |
| GET | `/api/v1/me/health/addresses` |
| GET | `/api/v1/me/health/cart` |
| GET | `/api/v1/me/health/orders` |
| GET | `/api/v1/me/health/orders/:no` |
| GET | `/api/v1/me/health/orders/:no/shipments` |
| GET | `/api/v1/me/health/returns` |
| GET | `/api/v1/me/inquiries` |
| GET | `/api/v1/me/introducer/activity` |
| GET | `/api/v1/me/introducer/channels` |
| GET | `/api/v1/me/introducer/invites` |
| GET | `/api/v1/me/introducer/matched` |
| GET | `/api/v1/me/ledger` |
| GET | `/api/v1/me/listings` |
| GET | `/api/v1/me/listings/:id/ownership` |
| GET | `/api/v1/me/notifications` |
| GET | `/api/v1/me/payout-accounts` |
| GET | `/api/v1/me/persona` |
| GET | `/api/v1/me/points` |
| GET | `/api/v1/me/profile` |
| GET | `/api/v1/me/referral-codes` |
| GET | `/api/v1/me/reports` |
| GET | `/api/v1/me/settlements` |
| GET | `/api/v1/me/settlements/history` |
| GET | `/api/v1/me/subscription` |
| GET | `/api/v1/me/subscription/detail` |
| GET | `/api/v1/me/subscription/invoices` |
| GET | `/api/v1/me/subscription/refund-eligible` |
| GET | `/api/v1/me/success-fees` |
| GET | `/api/v1/me/summary` |
| PATCH | `/api/v1/me/account` |
| PATCH | `/api/v1/me/business` |
| PATCH | `/api/v1/me/community/posts/:id` |
| PATCH | `/api/v1/me/health/cart/:code` |
| PATCH | `/api/v1/me/notifications/read` |
| POST | `/api/v1/me/billing-key` |
| POST | `/api/v1/me/community/posts` |
| POST | `/api/v1/me/community/posts/:id/comments` |
| POST | `/api/v1/me/favorites/:targetId` |
| POST | `/api/v1/me/health/addresses` |
| POST | `/api/v1/me/health/cart` |
| POST | `/api/v1/me/health/returns` |
| POST | `/api/v1/me/introducer/invite` |
| POST | `/api/v1/me/introducer/respond` |
| POST | `/api/v1/me/listings/:id/ownership` |
| POST | `/api/v1/me/payout-accounts` |
| POST | `/api/v1/me/payout-accounts/:id/verify` |
| POST | `/api/v1/me/profile` |
| POST | `/api/v1/me/subscription/cancel` |
| POST | `/api/v1/me/subscription/refund` |
| POST | `/api/v1/me/subscription/resume` |

### partner (29)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/partner/affiliate/dashboard` |
| GET | `/api/v1/partner/affiliate/guides` |
| GET | `/api/v1/partner/affiliate/inquiries` |
| GET | `/api/v1/partner/affiliate/links` |
| GET | `/api/v1/partner/affiliate/materials` |
| GET | `/api/v1/partner/affiliate/orders` |
| GET | `/api/v1/partner/affiliate/products` |
| GET | `/api/v1/partner/affiliate/revenues` |
| GET | `/api/v1/partner/affiliate/settlements` |
| GET | `/api/v1/partner/broker` |
| GET | `/api/v1/partner/dashboard` |
| GET | `/api/v1/partner/fees` |
| GET | `/api/v1/partner/leads` |
| GET | `/api/v1/partner/notices` |
| GET | `/api/v1/partner/pricing` |
| GET | `/api/v1/partner/regions` |
| GET | `/api/v1/partner/reviews` |
| GET | `/api/v1/partner/services` |
| GET | `/api/v1/partner/settlement` |
| GET | `/api/v1/partner/stats` |
| GET | `/api/v1/partner/trust` |
| POST | `/api/v1/partner/affiliate/inquiries` |
| POST | `/api/v1/partner/affiliate/links` |
| POST | `/api/v1/partner/affiliate/settlement-account` |
| POST | `/api/v1/partner/apply` |
| POST | `/api/v1/partner/broker` |
| POST | `/api/v1/partner/leads/:id/view` |
| POST | `/api/v1/partner/regions` |
| POST | `/api/v1/partner/services` |

### deals (15)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/deals/:id/contract/esign` |
| GET | `/api/v1/deals/:id/contract/history` |
| GET | `/api/v1/deals/:id/contract/state` |
| POST | `/api/v1/deals/:id/confirm` |
| POST | `/api/v1/deals/:id/contract` |
| POST | `/api/v1/deals/:id/contract/agree` |
| POST | `/api/v1/deals/:id/contract/cancel` |
| POST | `/api/v1/deals/:id/contract/counter` |
| POST | `/api/v1/deals/:id/contract/esign` |
| POST | `/api/v1/deals/:id/contract/fulfil` |
| POST | `/api/v1/deals/:id/contract/sign` |
| POST | `/api/v1/deals/:id/fee` |
| POST | `/api/v1/deals/:id/fee/:version/agree` |
| POST | `/api/v1/deals/:id/payment-report` |
| POST | `/api/v1/deals/:id/reviews` |

### listings (7)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/listings` |
| GET | `/api/v1/listings/:id` |
| GET | `/api/v1/listings/:id/questions` |
| PATCH | `/api/v1/listings/:id` |
| PATCH | `/api/v1/listings/questions/:qid/answer` |
| POST | `/api/v1/listings` |
| POST | `/api/v1/listings/:id/questions` |

### health (6)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/health` |
| GET | `/api/v1/health/ingredients` |
| GET | `/api/v1/health/products` |
| GET | `/api/v1/health/products/:code` |
| POST | `/api/v1/health/orders` |
| POST | `/api/v1/health/orders/:no/pay` |

### ai (5)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/ai/match/:leadId` |
| GET | `/api/v1/ai/recommend/weights` |
| POST | `/api/v1/ai/classify` |
| POST | `/api/v1/ai/classify/feedback` |
| POST | `/api/v1/ai/recommend` |

### requests (5)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/requests` |
| GET | `/api/v1/requests/:id` |
| GET | `/api/v1/requests/:id/proposals` |
| POST | `/api/v1/requests` |
| POST | `/api/v1/requests/:id/proposals` |

### ads (4)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/ads/infeed` |
| GET | `/api/v1/ads/serve` |
| POST | `/api/v1/ads/:id/click` |
| POST | `/api/v1/ads/:id/impression` |

### conversations (4)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/conversations/:id/messages` |
| POST | `/api/v1/conversations` |
| POST | `/api/v1/conversations/:id/deal` |
| POST | `/api/v1/conversations/:id/messages` |

### terms (4)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/terms` |
| GET | `/api/v1/terms/agreements` |
| GET | `/api/v1/terms/required` |
| POST | `/api/v1/terms/agree` |

### community (3)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/community/posts` |
| GET | `/api/v1/community/posts/:id` |
| POST | `/api/v1/community/classify` |

### events (3)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/events` |
| GET | `/api/v1/events/:code` |
| POST | `/api/v1/events/:code/join` |

### gwans (3)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/gwans` |
| GET | `/api/v1/gwans/:code` |
| GET | `/api/v1/gwans/:code/form-copy` |

### auth (3)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/auth/login` |
| POST | `/api/v1/auth/refresh` |
| POST | `/api/v1/auth/signup` |

### contract-templates (2)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/contract-templates` |
| GET | `/api/v1/contract-templates/:code` |

### internal (2)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/internal/accounts/:id/ad-profile` |
| GET | `/api/v1/internal/businesses/:id` |

### invites (2)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/invites/:token` |
| POST | `/api/v1/invites/:token/consent` |

### profile (2)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/profile/questions` |
| POST | `/api/v1/profile/analyze` |

### restrictions (2)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/restrictions` |
| POST | `/api/v1/restrictions/check` |

### search (2)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/search` |
| POST | `/api/v1/search/prompt` |

### categories (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/categories` |

### codes (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/codes` |

### faq (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/faq` |

### features (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/features` |

### footer-links (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/footer-links` |

### notices (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/notices` |

### report-reasons (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/report-reasons` |

### signup (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/signup/types` |

### site-settings (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/site-settings/public` |

### site (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/site/landing` |

### subscription-plans (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/subscription-plans` |

### ui-messages (1)

| 방식 | 주소 |
|---|---|
| GET | `/api/v1/ui-messages` |

### businesses (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/businesses` |

### disputes (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/disputes` |

### inquiries (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/inquiries` |

### referral-codes (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/referral-codes` |

### reports (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/reports` |

### settlements (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/settlements` |

### subscriptions (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/subscriptions` |

### verifications (1)

| 방식 | 주소 |
|---|---|
| POST | `/api/v1/verifications/identity` |

---

# 4. DB 목록

표 181 · 뷰 259 · 함수 545 · 트리거 194

**감시 뷰**는 「0이어야 정상」인 뷰입니다. 한 건이라도 나오면 어딘가 어긋났다는 뜻입니다.
64개 전수 조회 결과 **이상 3건 · 전부 정상 사유**입니다.

| 뷰 | 건수 | 사유 |
|---|---|---|
| `v_assumed_on` | 3 | **간주 모드 — 결제·중개사·계좌** |
| `v_bank_assumed` | 1 | 계좌인증 계약 전 |
| `v_company_account` | 1 | 시험용 계좌값 (계약 후 교체) |

`v_phase2_blockers`는 시드가 물건을 넣어 0이 됩니다. **실서비스에서는 2건**(소개몰·소개창업에 물건 없음)입니다.

### 표 181개 — 주제별

| 묶음 | 개수 | 표 이름 |
|---|---|---|
| hlt | 15 | hlt_addresses, hlt_cart_items, hlt_carts, hlt_commission_changes, hlt_commission_rates, hlt_order_items, hlt_orders, hlt_payments, hlt_products, hlt_returns, hlt_seller_licenses, hlt_sellers, hlt_settlement_items, hlt_settlements, hlt_shipments |
| partner | 12 | partner_goals, partner_guides, partner_inquiries, partner_invoices, partner_link_stats, partner_links, partner_orders, partner_regions, partner_revenues, partner_services, partner_settlement_accounts, partner_settlements |
| ad | 11 | ad_bookings, ad_creative_segments, ad_events, ad_invoices, ad_leak_audits, ad_payments, ad_placements, ad_products, ad_segments, ad_slots, ad_waitlist |
| classify | 5 | classify_categories, classify_learn_log, classify_logs, classify_signals, classify_vocab |
| listing | 5 | listing_badges, listing_checklist, listing_media, listing_regions, listing_versions |
| deal | 4 | deal_confirmations, deal_contracts, deal_payment_records, deal_reviews |
| lead | 4 | lead_deliveries, lead_fee_changes, lead_fees, lead_grade_rates |
| notification | 4 | notification_deliveries, notification_event_policies, notification_preferences, notification_templates |
| risk | 4 | risk_actions, risk_alerts, risk_exemptions, risk_rules |
| collect | 3 | collect_fetches, collect_items, collect_sources |
| fee | 3 | fee_agreements, fee_guarantees, fee_guidelines |
| introducer | 3 | introducer_profiles, introducer_referrals, introducer_responses |
| review | 3 | review_events, review_items, review_reason_codes |
| search | 3 | search_intents, search_synonyms, search_term_stats |
| affiliate | 2 | affiliate_product_rates, affiliate_products |
| attribution | 2 | attribution_events, attribution_policies |
| audit | 2 | audit_reviews, audit_thresholds |
| billing | 2 | billing_attempts, billing_keys |
| category | 2 | category_grades, category_matrix_axes |
| contract | 2 | contract_revisions, contract_templates |
| introduction | 2 | introduction_connections, introduction_invites |
| job | 2 | job_runs, job_schedules |
| main | 2 | main_copy, main_sections |
| point | 2 | point_ledger, point_rules |
| profile | 2 | profile_options, profile_questions |
| qualification | 2 | qualification_reviews, qualification_rules |
| request | 2 | request_proposals, request_views |
| subscription | 2 | subscription_invoices, subscription_plans |
|  | 1 | _t |
| account | 1 | account_roles |
| accounts | 1 | accounts |
| advertisers | 1 | advertisers |
| ai | 1 | ai_decisions |
| auto | 1 | auto_review_policies |
| banned | 1 | banned_words |
| board | 1 | board_classify_vocab |
| broker | 1 | broker_verifications |
| business | 1 | business_members |
| businesses | 1 | businesses |
| call | 1 | call_logs |
| categories | 1 | categories |
| code | 1 | code_labels |
| company | 1 | company_account_changes |
| conversations | 1 | conversations |
| deals | 1 | deals |
| dispute | 1 | dispute_messages |
| disputes | 1 | disputes |
| event | 1 | event_joins |
| events | 1 | events |
| faqs | 1 | faqs |
| favorites | 1 | favorites |
| footer | 1 | footer_links |
| gwan | 1 | gwan_form_copy |
| gwans | 1 | gwans |
| idempotency | 1 | idempotency_records |
| identity | 1 | identity_verifications |
| ingredients | 1 | ingredients |
| inquiries | 1 | inquiries |
| integrations | 1 | integrations |
| invite | 1 | invite_deliveries |
| item | 1 | item_types |
| leads | 1 | leads |
| listings | 1 | listings |
| llm | 1 | llm_parse_log |
| marketing | 1 | marketing_materials |
| member | 1 | member_ad_profiles |
| messages | 1 | messages |
| notices | 1 | notices |
| notifications | 1 | notifications |
| ops | 1 | ops_alerts |
| owner | 1 | owner_verifications |
| partners | 1 | partners |
| payout | 1 | payout_accounts |
| pending | 1 | pending_decisions |
| post | 1 | post_comments |
| posts | 1 | posts |
| property | 1 | property_listings |
| public | 1 | public_questions |
| recommend | 1 | recommend_weights |
| referral | 1 | referral_codes |
| regions | 1 | regions |
| report | 1 | report_reasons |
| reports | 1 | reports |
| requests | 1 | requests |
| restrict | 1 | restrict_vocab |
| restricted | 1 | restricted_industries |
| role | 1 | role_changes |
| safe | 1 | safe_numbers |
| schema | 1 | schema_migrations |
| segment | 1 | segment_shift_log |
| setting | 1 | setting_placeholders |
| settlements | 1 | settlements |
| signup | 1 | signup_types |
| site | 1 | site_settings |
| subscriptions | 1 | subscriptions |
| success | 1 | success_fees |
| term | 1 | term_agreements |
| terms | 1 | terms |
| trust | 1 | trust_weights |
| ui | 1 | ui_messages |
| visitor | 1 | visitor_identities |
| withdrawal | 1 | withdrawal_rules |

### 감시 뷰 77개

| 뷰 | 뜻 |
|---|---|
| `v_ad_attr_orphan` | 광고주가 안 적힌 광고 귀속. 0이어야 정상 — 누구에게 귀속되는지 모르는 건은 결국 분쟁 |
| `v_ad_overdue_running` | 연체인데 아직 나가고 있는 광고. **0이어야 합니다** — 받지 못한 채 노출만 계속하면 |
| `v_ad_sellable_gap` | 팔았거나 팔 수 있는데 나갈 소재가 없는 자리. 0이어야 정상 — 예상 노출로 팔았다가 못 |
| `v_ad_slot_conflict` | 전면과 띄움이 같은 기간에 잡힌 건. 0이어야 정상 — 둘 다 뜨면 이용자가 화면을 보지  |
| `v_ai_client_scored` | 서버 점수로는 후보에 들지 않는데 배정된 건. 0이어야 정상 — 점수가 조작됐거나 자격이  |
| `v_alimtalk_ad_words` | 광고성 표현이 든 정보성 알림톡. **0이어야 합니다** — 섞이면 전체가 광고성으로 분류 |
| `v_audit_over_retention` | 보관 기간을 넘긴 감사 기록. **0이어야 합니다** — 필요 이상으로 오래 두는 것도 개 |
| `v_audit_review_overdue` | 징후가 떴는데 정해진 시간 안에 확인하지 않은 것. **0이어야 합니다** — 감시 뷰가  |
| `v_audit_review_thin` | 사유가 열 자도 안 되는 확인 기록. **0이어야 합니다** — "이상 없음" 같은 말은  |
| `v_bank_assumed` | 간주 계좌로 돌고 있는 상태. **오픈 전에 0이어야 합니다** — 가상 계좌로 열면 입금 |
| `v_broker_commission_leak` | 소개형 4관에 스며든 수수료 컬럼. **0이어야 합니다** — 건강몰은 직판이라 예외이고, |
| `v_card_columns` | 카드 정보 컬럼. **0이어야 합니다** — 직판이어도 카드번호는 PG 가 가지고 우리는  |
| `v_classify_blocked_learned` | 학습으로 제한업종에 들어간 어휘. **0이어야 합니다** — 사람이 고쳤다고 대부·다단계를 |
| `v_classify_learn_burst` | 하루에 50개 넘게 학습된 날. **0이어야 합니다** — 정상이라면 하루 몇 개입니다.  |
| `v_classify_overweight` | 상한을 넘은 어휘. **0이어야 합니다** — 한 단어가 전부를 정하면 다른 단어가 무의미 |
| `v_classify_unlinked` | 실제 업종에 연결되지 않은 분류. **0이어야 정상** — 연결이 없으면 분류 결과를 화면 |
| `v_company_account` | 회사 수금 계좌. **missing 이 0이어야 오픈할 수 있습니다** — 비어 있으면 무 |
| `v_contract_draft_marks` | 쓰이고 있는 계약 양식에 남은 미확정 표시. **0이어야 합니다** — "검토 대기" 라고 |
| `v_contract_no_template` | 표준 양식이 아닌 계약. **0이어야 합니다** — 자유 양식은 분쟁 때 판단 근거가 없습 |
| `v_contract_stub` | 스텁으로 서명된 계약. **오픈 전 0이어야 합니다** — 법적 효력이 없습니다. |
| `v_direct_notice_missing` | 직판 관인데 고지가 없는 것. **0이어야 합니다** — 직접 파는데 중개라고 적혀 있으면 |
| `v_duty_conflict` | 승인과 지급을 겸한 사람. **0이어야 합니다** — 부정 판정을 만드는 사람과 돈을 내보 |
| `v_gated_no_review` | 심의필 번호 없이 올라온 심의 대상. **0이어야 정상** — 심의 없는 의료기기 광고는  |
| `v_hlt_license_expired` | 자격 만료인데 판매 중. **0이어야 합니다** — 만료된 자격으로 팔면 판매자도 우리도  |
| `v_hlt_paid_no_actor` | 누가 지급했는지 없는 정산. **0이어야 합니다** — 사고가 났을 때 누가 눌렀는지 알  |
| `v_hlt_settle_missed` | 확정된 지 2주가 넘도록 정산에 안 들어간 주문. **0이어야 합니다** — 주 단위 정산 |
| `v_hlt_wrong_gwan` | 건강몰이 아닌 업종의 판매 상품. **0이어야 합니다** — 직판은 건강몰만입니다. |
| `v_internal_key_missing` | 내부 API 키가 비어 있는 상태. **오픈 전 0이어야 합니다** — 키가 없으면 내부  |
| `v_inv11_violations` | INV-11 위반 — 자금을 수탁하는 컬럼. **0이어야 합니다.** 파트너 정산 계좌는  |
| `v_inv9_violations` | INV-9 위반 — 소개비에서 공제하는 컬럼. **0이어야 합니다.** 건강몰 판매수수료( |
| `v_landing_broken` | 없거나 중지된 관을 랜딩으로 지정한 것. **0이어야 합니다** — 로그인하자마자 빈 화면 |
| `v_lead_fee_void_mismatch` | 무효 시각과 상태가 어긋난 이용료. 0이어야 정상 — "무효인데 PENDING" 같은 행은 |
| `v_lead_fee_void_without_rule` | 규칙 없이 무효 처리된 이용료. 0이어야 정상 — voided_at 과 state 를 모두 |
| `v_location_columns` | 좌표 컬럼. **0이어야 위치기반서비스가 아닙니다** — 하나라도 생기면 방통위 신고 대상 |
| `v_location_waiver_broken` | 폐기 판단이 깨진 곳. **0이어야 합니다** — 좌표를 담기 시작하면 위치정보법 대상이  |
| `v_marketing_night_violation` | 야간 동의 없이 밤에 보낸 광고. **0이어야 합니다** — 정보통신망법 50조 3항 위반 |
| `v_marketing_no_consent` | 동의 없이 나간 광고성 알림. **0이어야 합니다** — 정보통신망법 50조 위반이고 과태 |
| `v_mmat_unreviewed_live` | 심의자 없이 승인된 자료. **0이어야 합니다** — 파트너가 뿌리는 순간 회사가 한 말이 |
| `v_partner_path_conflict` | 파트너센터 경로가 둘 다 설정된 상태. **0이어야 합니다** — 어느 쪽이 진짜인지 모르 |
| `v_partner_track_mixed` | 트랙이 섞인 정산. **0이어야 합니다** — 소개비와 제휴수수료는 성격이 달라 한 장에  |
| `v_payout_stub` | 스텁으로 통과한 정산 계좌. **오픈 전 0이어야 합니다** — 실제로 확인되지 않은 계좌 |
| `v_phase2_blockers` | 2차 일괄 오픈을 막는 관. **0이어야 2차를 엽니다** — 순차가 아니라 일괄이라 하나 |
| `v_porder_unattributed_paid` | 귀속되지 않았는데 확정·정산된 주문. **0이어야 합니다** — 72시간이 지난 클릭에 수 |
| `v_post_pending_long` | 첫 글 검수가 2일 넘게 밀린 것. **0이어야 합니다** — 밀리면 새 회원이 "글이 안 |
| `v_pstl_paid_no_account` | 인증 계좌 없이 지급된 정산. **0이어야 합니다** — 돈이 어디로 갔는지 모르게 됩니다 |
| `v_ptn_approval_gap` | 승인·반려·무효 처리에서 근거가 빠진 건. 0이어야 정상 — 당한 사람이 따질 때 답할 수 |
| `v_rate_partial` | 관 전용 단가표가 일부 등급만 가진 건. 0이어야 정상 — 일부만 두면 등급 사이에서 단가 |
| `v_realty_broker_unverified` | 중개사 인증 없이 중개사 매물로 표시된 것. **0이어야 합니다** — 인증이 나중에 취소 |
| `v_realty_unmarked` | 구분 없이 올라간 부동산 매물. **0이어야 합니다** — 중개사 매물인지 직거래인지 모르 |
| `v_refund_violation` | 당일이 아니거나 이미 이용한 구독의 환불. 0이어야 정상 — 한 건이라도 있으면 같은 요구 |
| `v_report_not_escalated` | 신고가 임계치를 넘었는데 검수 큐에 없는 건. 0이어야 정상 — 쌓이면 에스컬레이션 트리거 |
| `v_restricted_unlinked` | 업종이 연결되지 않은 제한업종. **0이어야 정상** — 연결이 없으면 트리거가 restr |
| `v_review_no_event` | 결정됐는데 이력이 없는 검수 건. 0이어야 정상 — 쌓이면 "누가 언제 승인했는가"를 답할 |
| `v_risk_exempt_forever` | 기한 없는 예외. **0이어야 합니다** — 시간이 지나면 왜 뒀는지 아무도 모르고, 그  |
| `v_risk_law_exempted` | 법이 정한 규칙에 생긴 예외. **0이어야 합니다** — 제한업종과 광고 규제는 사람 판단 |
| `v_risk_overexempted` | 예외가 20건 넘는 규칙. **0이어야 합니다** — 이만큼 예외를 둬야 한다면 규칙의 조 |
| `v_search_dict_empty` | 사전이 빈 상태. **0이어야 합니다** — 비어 있으면 정규화가 아무 일도 하지 않고,  |
| `v_search_pii_columns` | INV-SCH1 위반 — 파서 로그에 사람을 가리키는 컬럼. **0이어야 합니다** — 법 |
| `v_search_raw_stored` | INV-SCH2 위반 — 원문 검색어가 저장된 기록. **0이어야 합니다** — 검색어에는 |
| `v_search_zero_hit_terms` | 결과가 자주 0건인 검색어. **0이어야 합니다** — 사람은 이 말로 찾는데 우리는 다른 |
| `v_segment_learn_no_consent` | 동의하지 않은 회원의 세그먼트가 바뀐 기록. **0이어야 합니다** — 동의를 뺀 사람은  |
| `v_segment_shift_thrash` | 한 달에 3번 이상 세그먼트가 바뀐 회원. **0이어야 합니다** — 왔다 갔다 하면 기준 |
| `v_template_unused` | 템플릿은 있는데 부르는 곳이 없는 알림. **0이어야 합니다** — 기능은 도는데 당사자가 |
| `v_terms_empty` | 본문이 빈 약관. **0이어야 합니다** — 가입 화면에서 동의를 받는데 내용이 없으면 전 |

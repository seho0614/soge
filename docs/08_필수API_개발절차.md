# 소개뱅크 — 오픈 필수 API 리스트 · 개발 절차

**자동 생성** `node scripts/gen-mvp-plan.js` · 원본 `docs/06_openapi.json` · `spec/screens.json`

전체 640 오퍼레이션 중 **오픈 필수 131건**. 나머지 509건은 오픈 후로 미룰 수 있습니다.

**필수의 정의** — 없으면 거래 7단계 중 한 곳이 끊겨 오픈할 수 없는 것. 여기에 오픈 게이트(푸터 법정고지·정책 관리)를 더했습니다.

## 1. 거래 흐름별

| 단계 | 필수 | 전체 | 스키마 정의 |
|---|---:|---:|---:|
| 가입·인증 | **12** | 12 | 12 |
| 00 구독·코드 | **11** | 11 | 11 |
| 01 등록 | **27** | 27 | 27 |
| 02 검수 | **18** | 18 | 18 |
| 03 탐색 | **8** | 8 | 8 |
| 04 문의·Deal | **15** | 15 | 15 |
| 05 계약·성사 | **15** | 15 | 15 |
| 06 정산·분쟁 | **13** | 13 | 13 |
| 운영 콘솔 | **12** | 268 | 268 |
| 부가 | **0** | 253 | 253 |

> **05 계약·성사가 4건뿐입니다.** 성사 확정과 정산 신청이 DB 트리거로 자동 처리되기 때문입니다(A-15). 계약서 발급·서명 두 개만 만들면 나머지가 따라옵니다.

## 2. 오픈 필수 API

### 가입·인증

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T1 | `POST` | `/auth/login` | 로그인 | GUEST |  |
| ✔ | T1 | `POST` | `/auth/refresh` | 토큰 재발급 | GUEST |  |
| ✔ | T1 | `POST` | `/auth/signup` | 회원가입 | GUEST |  |
| ✔ | T4 | `POST` | `/businesses` | 사업자 신청 | MEMBER |  |
| ✔ | T1 | `GET` | `/me/summary` | 내 요약 | MEMBER/B_OWNER |  |
| ✔ | T1 | `GET` | `/terms` | 약관 목록 | GUEST |  |
| ✔ | T1 | `POST` | `/terms/agree` | 약관 동의 | GUEST |  |
| ✔ | T1 | `GET` | `/terms/agreements` | 내 동의 이력 | GUEST |  |
| ✔ | T1 | `GET` | `/terms/doc/{code}` | 약관 한 건 (전문) | GUEST |  |
| ✔ | T1 | `GET` | `/terms/index` | 약관 전체 목록 | GUEST |  |
| ✔ | T1 | `GET` | `/terms/required` | 동의해야 하는 약관 | GUEST |  |
| ✔ | T4 | `POST` | `/verifications/identity` | 본인인증 | MEMBER |  |

### 00 구독·코드

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T7 | `GET` | `/me/subscription` | 구독 현황 | GUEST |  |
| ✔ | T7 | `POST` | `/me/subscription/cancel` | 구독 해지 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `GET` | `/me/subscription/detail` | 내 구독 상세 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `GET` | `/me/subscription/invoices` | 청구 내역 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `POST` | `/me/subscription/refund` | 구독 환불 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `GET` | `/me/subscription/refund-eligible` | 환불 가능 여부 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `POST` | `/me/subscription/resume` | 해지 철회 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `POST` | `/referral-codes` | 소개코드 발급 | GUEST/MEMBER |  |
| ✔ | T7 | `GET` | `/subscription-plans` | 요금제 | GUEST |  |
| ✔ | T7 | `POST` | `/subscriptions` | 구독 시작 · 변경 | B_OWNER | SUBSCRIPTION |
| ✔ | T7 | `DELETE` | `/subscriptions/reservation` | 요금제 예약 거두기 | B_OWNER | SUBSCRIPTION |

### 01 등록

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T2 | `GET` | `/categories` | 업종 목록 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `GET` | `/listings` | 매물 목록 | GUEST |  |
| ✔ | T5 | `POST` | `/listings` | 매물 등록 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `GET` | `/listings/{id}` | 매물 상세 | GUEST/MEMBER |  |
| ✔ | T5 | `POST` | `/listings/{id}/archive` | 매물 내리기 | B_OWNER/B_STAFF |  |
| ✔ | T5 | `POST` | `/listings/{id}/badges` | 급구 · 급매 표시 신청 | GUEST |  |
| ✔ | T5 | `GET` | `/listings/{id}/images/{n}` | 매물 이미지 | GUEST |  |
| ✔ | T5 | `POST` | `/listings/{id}/photos` | 매물 사진 붙이기 (주인) | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `DELETE` | `/listings/{id}/photos/{mediaId}` | 매물 사진 떼기 (주인) | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `GET` | `/listings/{id}/photos/{n}` | 매물 사진 (공개) | GUEST |  |
| ✔ | T5 | `GET` | `/listings/{id}/reviews` | 등록자(소개자) 후기 | GUEST |  |
| ✔ | T5 | `GET` | `/me/listings` | 내 리스팅 | B_OWNER/B_STAFF |  |
| ✔ | T5 | `GET` | `/requests` | 소개받기 목록 | GUEST |  |
| ✔ | T5 | `POST` | `/requests` | 소개받기 등록 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `GET` | `/requests/{id}` | 요청 상세 | MEMBER | IDENTITY |
| ✔ | T5 | `GET` | `/requests/{id}/images/{n}` | 요청 이미지 | MEMBER | IDENTITY |
| ✔ | T5 | `POST` | `/requests/{id}/proposals` | 소개 제안 | MEMBER | IDENTITY |
| ✔ | T5 | `GET` | `/requests/{id}/proposals` | 제안 목록 | MEMBER | IDENTITY |
| ✔ | T5 | `POST` | `/requests/{id}/proposals/{pid}/decision` | 제안 수락 · 거절 | MEMBER | IDENTITY |
| ✔ | T5 | `PATCH` | `/listings/{id}` | 매물 수정 (재검수) | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `PATCH` | `/listings/questions/{qid}/answer` | 공개 문의 답변 | GUEST |  |
| ✔ | T5 | `GET` | `/me/listings/{id}/draft` | 수정 초안 보기 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `PUT` | `/me/listings/{id}/draft` | 수정 초안 저장 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `DELETE` | `/me/listings/{id}/draft` | 수정 초안 버리기 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `GET` | `/me/listings/{id}/review` | 내 매물 검수 결과 · 이력 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `POST` | `/me/listings/{id}/ownership` | 등기사항증명서 제출 | MEMBER/B_OWNER |  |
| ✔ | T5 | `GET` | `/me/listings/{id}/ownership` | 내 소유 확인 상태 | MEMBER/B_OWNER |  |

### 02 검수

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T3 | `GET` | `/admin/auto-review/rate` | 일별 자동화율 (최근 30일, 최신 먼저) | ADMIN/SUPER |  |
| ✔ | T3 | `GET` | `/admin/auto-review/reasons` | 수동 검수 사유별 건수 (최근 30일) | ADMIN/SUPER |  |
| ✔ | T4 | `GET` | `/admin/businesses` | 사업자 신청 목록 | ADMIN/SUPER |  |
| ✔ | T4 | `PATCH` | `/admin/businesses/{id}/reject` | 사업자 신청 반려 | ADMIN/SUPER |  |
| ✔ | T4 | `PATCH` | `/admin/businesses/{id}/verify` | 사업자 승인 | ADMIN/SUPER |  |
| ✔ | T2 | `GET` | `/admin/categories` | 업종 관리 목록 | ADMIN/SUPER |  |
| ✔ | T2 | `PATCH` | `/admin/categories/{id}` | 업종 승인 · 반려 | ADMIN/SUPER |  |
| ✔ | T3 | `GET` | `/admin/reviews` | 검수 큐 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/reviews/{id}` | 검수 건 상세 | REVIEWER/ADMIN |  |
| ✔ | T3 | `PATCH` | `/admin/reviews/{id}` | 검수 승인 · 반려 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/reviews/counts` | 검수 큐 탭 숫자 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/reviews/throughput` | 검수 처리량 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/auto-review/samples` | 표본 감사 대기 | REVIEWER/ADMIN |  |
| ✔ | T3 | `POST` | `/admin/auto-review/samples/{id}` | 감사 결과 기록 | REVIEWER/ADMIN |  |
| ✔ | T3 | `POST` | `/admin/auto-review/samples/resample` | 표본 다시 뽑기 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/auto-review/samples/summary` | 표본 감사 요약 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/badges` | 배지 신청 검수 | REVIEWER/ADMIN |  |
| ✔ | T3 | `GET` | `/admin/badges/history` | 배지 발급 이력 | REVIEWER/ADMIN |  |

### 03 탐색

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T2 | `GET` | `/gwans` | 관 목록 | GUEST |  |
| ✔ | T2 | `GET` | `/gwans/{code}` | 관 단건 | GUEST |  |
| ✔ | T2 | `GET` | `/gwans/{code}/form-copy` | 관별 등록 폼 문구 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T5 | `GET` | `/search` | 통합 검색 | GUEST |  |
| ✔ | T5 | `GET` | `/search/keywords` | 많이 찾는 키워드 | GUEST |  |
| ✔ | T5 | `POST` | `/search/log` | 검색어 집계 | GUEST |  |
| ✔ | T5 | `POST` | `/search/prompt` | 프롬프트 검색 | GUEST/MEMBER |  |
| ✔ | T5 | `GET` | `/search/suggest` | 검색 팝업 재료 | GUEST/MEMBER |  |

### 04 문의·Deal

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T6 | `GET` | `/admin/deals` | 거래 모니터링 | ADMIN/SUPER |  |
| ✔ | T6 | `POST` | `/conversations` | 1:1 문의 시작 | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T6 | `POST` | `/conversations/{id}/deal` | Deal 생성 | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T6 | `GET` | `/conversations/{id}/messages` | 메시지 목록 | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T6 | `POST` | `/conversations/{id}/messages` | 메시지 보내기 | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T6 | `GET` | `/conversations/{id}/summary` | 1:1 문의 요약 (시안 scAsk 머리 · 오른쪽 칸) | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T6 | `POST` | `/conversations/check` | 보내기 전 확인 | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T6 | `POST` | `/deals/{id}/fee` | 소개비 제안 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `POST` | `/deals/{id}/fee/{version}/agree` | 소개비 동의 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `GET` | `/deals/{id}/safe-trade` | 이 거래의 안전거래 상태(당사자) | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `POST` | `/deals/{id}/safe-trade` | 안전거래 합의(당사자 한쪽) | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `GET` | `/deals/{id}/summary` | 거래 정보(시안 거래 구간 머리) | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | T5 | `GET` | `/listings/{id}/questions` | 공개 문의 목록 | GUEST |  |
| ✔ | T6 | `GET` | `/me/deals` | 내 거래 | B_OWNER |  |
| ✔ | T5 | `POST` | `/listings/{id}/questions` | 공개 문의 등록 | GUEST |  |

### 05 계약·성사

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T6 | `POST` | `/deals/{id}/confirm` | 성사 확정 (수동) | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `POST` | `/deals/{id}/contract` | 계약서 발급 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `POST` | `/deals/{id}/contract/sign` | 계약서 서명 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `POST` | `/deals/{id}/payment-report` | 대금 지급 신고 | B_OWNER/B_STAFF | IDENTITY |
| ✔ | T6 | `POST` | `/deals/{id}/contract/agree` | 조건 합의 | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/contract/cancel` | 계약 파기 | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/contract/counter` | 수정 요청 | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/contract/draft` | 계약 조건 임시 저장 (v10.31 · 시안 「임시 저장」) | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/contract/esign` | 전자계약 서명 요청 | MEMBER/B_OWNER |  |
| ✔ | T6 | `GET` | `/deals/{id}/contract/esign` | 전자계약 서명 상태 | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/contract/fulfil` | 이행 확인 | MEMBER/B_OWNER |  |
| ✔ | T6 | `GET` | `/deals/{id}/contract/history` | 계약 이력 | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/contract/nudge` | 계약 확인 요청 (v10.31 · 시안 계약 진행 「확인 요청」) | MEMBER/B_OWNER |  |
| ✔ | T6 | `GET` | `/deals/{id}/contract/state` | 계약 진행 상태 | MEMBER/B_OWNER |  |
| ✔ | T6 | `POST` | `/deals/{id}/reviews` | 후기 작성 | B_OWNER | BUSINESS |

### 06 정산·분쟁

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T8 | `GET` | `/admin/settlements` | 정산 목록 | ADMIN/SUPER |  |
| ✔ | T8 | `PATCH` | `/admin/settlements/{id}` | 정산 승인 · 반려 | ADMIN/SUPER |  |
| ✔ | T8 | `GET` | `/me/settlements` | 정산 목록 | MEMBER/B_OWNER | IDENTITY |
| ✔ | T8 | `POST` | `/me/settlements/{id}/paid` | 받았음 표시 (v10.31 · 정산 승인 단계) | MEMBER/B_OWNER | IDENTITY |
| ✔ | T8 | `GET` | `/me/settlements/due` | 받을 소개비 — 아직 정산 줄이 없는 성사 거래 | MEMBER/B_OWNER | IDENTITY |
| ✔ | T8 | `POST` | `/settlements` | 정산 신청 — 소개비 받기 | MEMBER/B_OWNER | IDENTITY |
| ✔ | T8 | `GET` | `/admin/disputes` | 분쟁 목록 | ADMIN/SUPER |  |
| ✔ | T8 | `PATCH` | `/admin/disputes/{id}` | 분쟁 처리 | ADMIN/SUPER |  |
| ✔ | T8 | `GET` | `/admin/disputes/summary` | 분쟁 요약 | ADMIN/SUPER |  |
| ✔ | T8 | `POST` | `/disputes` | 분쟁 접수 | MEMBER |  |
| ✔ | T8 | `GET` | `/me/disputes` | 내 분쟁 | MEMBER |  |
| ✔ | T8 | `POST` | `/me/settlements/{id}/tax-invoice` | 세금계산서 발행 표시 (v10.31 · 시안 지급 내역 「미발행」) | MEMBER/B_OWNER | IDENTITY |
| ✔ | T8 | `GET` | `/me/settlements/history` | 지급 내역 | MEMBER/B_OWNER | IDENTITY |

### 운영 콘솔

| | 트랙 | Method | 경로 | 용도 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|
| ✔ | T4 | `GET` | `/admin/accounts-counts` | 회원 수(정상 · 정지) | ADMIN/SUPER |  |
| ✔ | T9 | `GET` | `/admin/open-blockers` | 오픈 차단 항목 | SUPER |  |
| ✔ | T2 | `GET` | `/admin/policies` | 정책 조회 | ADMIN/SUPER |  |
| ✔ | T2 | `PATCH` | `/admin/policies/auto-review/{key}` | 자동검수 규칙 변경 | ADMIN/SUPER |  |
| ✔ | T9 | `GET` | `/admin/site-settings` | 사이트 설정 | SUPER |  |
| ✔ | T9 | `PATCH` | `/admin/site-settings` | 설정 변경 | SUPER |  |
| ✔ | T9 | `GET` | `/admin/summary` | 대시보드 요약 | ADMIN/SUPER |  |
| ✔ | T2 | `PATCH` | `/admin/policies/restrictions/{code}` | 제한업종 지정 · 해제 | SUPER |  |
| ✔ | T4 | `GET` | `/admin/accounts` | 회원 목록 | ADMIN/SUPER |  |
| ✔ | T4 | `GET` | `/admin/accounts/{id}` | 회원 상세 | ADMIN/SUPER |  |
| ✔ | T4 | `PATCH` | `/admin/accounts/{id}/posting-suspension/lift` | 등록 일시 정지 풀기 | ADMIN/SUPER |  |
| ✔ | T4 | `PATCH` | `/admin/accounts/{id}/status` | 회원 상태 변경(정상 ↔ 정지) | ADMIN/SUPER |  |

## 3. 개발 절차 — 트랙 순서

의존 순서입니다. **앞 트랙이 없으면 뒤 트랙을 실데이터로 검증할 수 없습니다.**

| 트랙 | 이름 | 주차 | 필수 API | 전체 | 선행 |
|---|---|---|---:|---:|---|
| **T1** | B1a 인증 코어 | W2~W3 | **10** | 10 | — |
| **T2** | B2 카테고리·정책 | W4~W6 | **9** | 11 | T1 |
| **T3** | B3 검수 BO ★ | W4~W7 | **13** | 13 | T2 |
| **T4** | B1b 사업자·계정 | W4~W7 | **10** | 10 | T1 |
| **T5** | B4 리스팅·요청 | W6~W9 | **33** | 36 | T2 T3 |
| **T6** | B5 문의·Deal·귀속 | W7~W10 | **28** | 28 | T4 T5 |
| **T7** | B6 구독·원장·PG | W8~W11 | **11** | 11 | T1 |
| **T8** | B7 정산·분쟁 | W12~W15 | **13** | 13 | T6 T7 |
| **T9** | 운영·부가 | W12~W15 | **4** | 508 | — |

```
T1 인증 코어
 ├─ T2 카테고리·정책 ─┬─ T3 검수 BO ★
 │                    └─ T5 리스팅·요청 ─┐
 ├─ T4 사업자·계정 ──────────────────────┼─ T6 문의·Deal ─┐
 └─ T7 구독·원장 ────────────────────────────────────────┴─ T8 정산·분쟁
```

**T3 이 임계 경로입니다.** 검수가 없으면 등록해도 노출이 안 되고, 노출이 없으면 T5 이후를 실데이터로 볼 수 없습니다.

## 4. 트랙별 착수 절차

각 트랙에서 같은 순서를 반복합니다.

| 순서 | 작업 | 산출 |
|---|---|---|
| 1 | DTO 작성 (`@ApiProperty` 포함) | 요청·응답 스키마 |
| 2 | 리포지토리 — 쿼리만. 트랜잭션은 서비스가 연다 | |
| 3 | 서비스 — 상태 전이는 여기서만 | |
| 4 | 컨트롤러 — `@Roles` `@RequireGate` `@Audit` 부착 | |
| 5 | `npm run docs` | OpenAPI `x-status: IMPLEMENTED` 로 전환 |
| 6 | 불변식 시험 추가 → `npm run verify` | 검증 건수 증가 |

**5번을 빠뜨리면 프런트가 스키마를 못 받습니다.** 커밋 전에 돌리십시오 — CI 가 `git diff --exit-code` 로 막습니다.

## 5. 오픈까지 남은 API

필수 131건 중 **0건**이 스키마 미정의입니다.

| 트랙 | 남은 필수 API |
|---|---:|

## 6. 오픈 후로 미룰 수 있는 것

509건. 대부분 운영 편의 기능입니다.

| 영역 | 건수 | 예 |
|---|---:|---|
| 부가 | 253 | `/health/products` `/ads/serve` `/ads/{id}/impression` |
| 운영 콘솔 | 256 | `/admin/reports/daily` `/admin/reports/not-agreed` `/admin/reports/pending` |

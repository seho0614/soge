# 소개뱅크 — Flow 설계서 v1

**자동 생성** `node scripts/gen-flow-doc.js` · 원본 `spec/screens.json` + `docs/06_openapi.json`

거래 5개 흐름을 **화면 → API → 데이터 → 불변식**으로 관통해 그립니다.
한 줄이 끊기면 그 단계가 실제로 완주하지 않습니다.

`✔` API 스키마 정의됨 · `·` 미정의

## 흐름 개요

```
F0 가입·인증 ─→ F1 등록·검수 ─→ F2 탐색·문의 ─→ F3 거래·성사 ─→ F4 정산
     │                                                  ↑
     └────── 귀속 기록은 F0 유입 시점부터 F3 확정까지 ──┘
```

| 흐름 | 단계 | 계기 |
|---|---:|---|
| **F0** 가입 · 인증 | 4 | 소개코드 링크 유입 또는 직접 방문 |
| **F1** 등록 · 검수 | 4 | 사업자가 매물 등록 |
| **F2** 탐색 · 문의 | 3 | 구매자가 매물 탐색 |
| **F3** 거래 · 성사 | 4 | 조건 합의 후 계약 |
| **F4** 정산 | 4 | 성사 확정 (자동) |

## F0. 가입 · 인증

**계기** 소개코드 링크 유입 또는 직접 방문

```
1. 유입  →  2. 가입  →  3. 사업자 신청  →  4. 승인
```

### F0-1 유입

| | |
|---|---|
| 화면 | `SB-HOM-MAIN-011` 메인 (비로그인) |
| 데이터 | attribution_events INSERT (사이트 미들웨어가 ?ref= 를 보고 POST /attribution/touch — 24시간 중복 차단) |
| 불변식 | **INV-2 기록** |
| 주의 | 비로그인이어도 visitor_key 로 기록합니다 |

### F0-2 가입

| | |
|---|---|
| 화면 | `SB-HOM-AUT-020` 회원가입 |
| API | ✔ `POST /auth/signup` |
| 데이터 | accounts(INDIVIDUAL) · account_roles · visitor_identities |
| 불변식 | **INV-10** |
| 주의 | ★ visitorKey 를 함께 보내야 비로그인 유입이 연결됩니다 |

### F0-3 사업자 신청

| | |
|---|---|
| 화면 | `SB-HOM-AUT-030` 본인·사업자 인증 |
| API | ✔ `POST /businesses` |
| 데이터 | businesses · review_items(BUSINESS) |
| 주의 | 전건 수동 검수. 법적 판단이 섞여 자동화 대상이 아닙니다 |

### F0-4 승인

| | |
|---|---|
| 화면 | `SB-ADM-USR-010` 회원 · 사업자 인증 |
| API | ✔ `PATCH /admin/businesses/{id}/verify` |
| 데이터 | businesses.verified_at · accounts.account_type=BUSINESS · BIZ_OWNER 부여 |
| 불변식 | **INV-10 기준일** |
| 주의 | 승격이지 재가입이 아닙니다 — 귀속 기록이 끊기면 안 됩니다 |

**이 흐름에서 나가는 알림**

| 이벤트 | 수신자 | 채널 | 수신거부 |
|---|---|---|:-:|
| `BUSINESS_REJECTED` | OWNER | INAPP EMAIL | **불가** |

## F1. 등록 · 검수

**계기** 사업자가 매물 등록

```
1. 등록  →  2. 자동검수 판정  →  3. 수동 검수  →  4. 승인 · 반려
```

### F1-1 등록

| | |
|---|---|
| 화면 | `SB-HOM-REG-010` 소개하기 등록 |
| API | ✔ `POST /listings` · 게이트 IDENTITY_VERIFIED |
| 데이터 | listings(IN_REVIEW) · listing_versions · review_items |
| 불변식 | **INV-6 · 슬롯 한도** |
| 주의 | 제한업종·금칙어·슬롯은 DB가 판정 → 422 |

### F1-2 자동검수 판정

| | |
|---|---|
| 화면 | — (서버 처리) |
| 데이터 | fn_auto_review_reasons() → review_items.manual_reasons |
| 주의 | 빈 배열이면 자동 승인 → 즉시 PUBLISHED · 5% 표본 감사 |

### F1-3 수동 검수

| | |
|---|---|
| 화면 | `SB-ADM-REV-010` 검수 큐 |
| API | ✔ `GET /admin/reviews` |
| 데이터 | SLA 마감 순 정렬 (부분 인덱스) |
| 불변식 | **SLA 24h** |
| 주의 | 개입 사유를 카드에 표시 — 왜 보고 있는지 알아야 어디를 봅니다 |

### F1-4 승인 · 반려

| | |
|---|---|
| 화면 | `SB-ADM-REV-020` 반려 사유 입력 |
| API | ✔ `PATCH /admin/reviews/{id}` |
| 데이터 | review_items · review_events · listings.status · audit_logs |
| 주의 | 반려는 사유 코드 필수. 같은 트랜잭션에서 대상 상태 전이 |

## F2. 탐색 · 문의

**계기** 구매자가 매물 탐색

```
1. 목록  →  2. 상세  →  3. 문의
```

### F2-1 목록

| | |
|---|---|
| 화면 | `SB-MNY-LST-010` 소개장터 전체 목록 |
| API | ✔ `GET /listings` |
| 데이터 | promoted / organic 분리 반환 |
| 불변식 | **INV-11 · 전상법** |
| 주의 | 섞으면 프런트가 라벨을 빠뜨려 표시 의무 위반이 발생합니다 |

### F2-2 상세

| | |
|---|---|
| 화면 | `SB-MNY-DTL-010` 소개장터 상세 |
| API | ✔ `GET /listings/{id}` |
| 데이터 | canInquire · inquireBlockReason 서버 판정 |
| 불변식 | **INV-7** |
| 주의 | ★ CTA 배치 — 문의하기 주 동선, 전화하기 보조 |

### F2-3 문의

| | |
|---|---|
| 화면 | `SB-HOM-MCH-010` 1:1 문의 · Deal 생성 |
| API | ✔ `POST /conversations` · 게이트 IDENTITY_VERIFIED BUSINESS_VERIFIED |
| 데이터 | conversations · messages |
| 불변식 | **INV-7 게이트** |
| 주의 | 본인인증 + 사업자 인증 필요 |

**이 흐름에서 나가는 알림**

| 이벤트 | 수신자 | 채널 | 수신거부 |
|---|---|---|:-:|
| `INQUIRY_RECEIVED` | COUNTERPART | INAPP PUSH | 가능 |
| `MESSAGE_RECEIVED` | COUNTERPART | INAPP PUSH | 가능 |

## F3. 거래 · 성사

**계기** 조건 합의 후 계약

```
1. 소개비 제안  →  2. 계약서 발급  →  3. 대금 지급 신고  →  4. 양측 서명
```

### F3-1 소개비 제안

| | |
|---|---|
| 화면 | `SB-HOM-MCH-010` 1:1 문의 · Deal 생성 |
| API | ✔ `POST /deals/{id}/fee` · 게이트 IDENTITY_VERIFIED |
| 데이터 | fee_agreements(PROPOSED) append-only |
| 불변식 | **D-03** |
| 주의 | 2차 제안부터 사유 코드 필수 |

### F3-2 계약서 발급

| | |
|---|---|
| 화면 | `SB-HOM-DEL-010` 계약서 발급 · 서명 |
| API | ✔ `POST /deals/{id}/contract` · 게이트 IDENTITY_VERIFIED |
| 데이터 | deal_contracts · fee_agreements → LOCKED · deals.agreed_fee |
| 불변식 | **D-1** |
| 주의 | 금액이 계약서에 인쇄되는 순간이 잠금점입니다 |

### F3-3 대금 지급 신고

| | |
|---|---|
| 화면 | `SB-HOM-DEL-020` 대금 지급 신고 |
| API | ✔ `POST /deals/{id}/payment-report` · 게이트 IDENTITY_VERIFIED |
| 데이터 | deal_payment_records (금액·계좌 컬럼 없음) |
| 불변식 | **INV-11** |
| 주의 | 플랫폼이 자금을 만질 방법이 스키마에 없습니다 |

### F3-4 양측 서명

| | |
|---|---|
| 화면 | `SB-HOM-DEL-010` 계약서 발급 · 서명 |
| API | ✔ `POST /deals/{id}/contract/sign` · 게이트 IDENTITY_VERIFIED |
| 데이터 | deal_confirmations×2(CONTRACT) · deals CONFIRMED · attribution 스냅샷 · settlements |
| 불변식 | **INV-2 · INV-3 · INV-4 · INV-9 · INV-10** |
| 주의 | ★ 두 번째 서명이 성사 확정과 정산 신청을 자동으로 일으킵니다 (A-15) |

**이 흐름에서 나가는 알림**

| 이벤트 | 수신자 | 채널 | 수신거부 |
|---|---|---|:-:|
| `INQUIRY_RECEIVED` | COUNTERPART | INAPP PUSH | 가능 |
| `MESSAGE_RECEIVED` | COUNTERPART | INAPP PUSH | 가능 |
| `CONTRACT_ISSUED` | BOTH | INAPP EMAIL | **불가** |
| `CONTRACT_SIGN_REQUIRED` | COUNTERPART | INAPP EMAIL SMS | **불가** |
| `PAYMENT_REPORTED` | COUNTERPART | INAPP | **불가** |

## F4. 정산

**계기** 성사 확정 (자동)

```
1. 정산 확인  →  2. 승인  →  3. 배치 이체  →  4. 분쟁 (예외)
```

### F4-1 정산 확인

| | |
|---|---|
| 화면 | `SB-MYP-STL-010` 정산 · 소개비 받기 |
| API | ✔ `GET /me/settlements` · 게이트 IDENTITY_VERIFIED |
| 데이터 | settlements(REQUESTED) |
| 불변식 | **INV-9 amount = agreed_fee** |
| 주의 | 신청 행위가 없습니다 — 자동 생성됩니다 |

### F4-2 승인

| | |
|---|---|
| 화면 | `SB-ADM-STL-010` 정산 현황 |
| API | ✔ `PATCH /admin/settlements/{id}` |
| 데이터 | settlements APPROVED |

### F4-3 배치 이체

| | |
|---|---|
| 화면 | — (서버 처리) |
| API | ✔ `POST /admin/jobs (settlement_batch)` |
| 데이터 | settlement_batches · settlements PAID |
| 불변식 | **전건 재대조** |
| 주의 | ★ 이체 직전 fn_verify_invariants() — 위반 있으면 중단 |

### F4-4 분쟁 (예외)

| | |
|---|---|
| 화면 | `SB-HOM-ETC-010` 분쟁 접수 · 처리 현황 |
| API | ✔ `POST /disputes` |
| 데이터 | disputes · settlements → HELD (자동) |
| 불변식 | **B-11** |

**이 흐름에서 나가는 알림**

| 이벤트 | 수신자 | 채널 | 수신거부 |
|---|---|---|:-:|
| `SETTLEMENT_REQUESTED` | PAYEE | INAPP | **불가** |
| `SETTLEMENT_HELD` | PAYEE | INAPP EMAIL | **불가** |
| `DISPUTE_OPENED` | COUNTERPART | INAPP EMAIL | **불가** |
| `DISPUTE_RESOLVED` | BOTH | INAPP EMAIL | **불가** |

## 흐름이 끊기는 지점

| 지점 | 증상 | 관측 |
|---|---|---|
| F0 `visitorKey` 미전달 | 비로그인 유입이 유실 | `v_attribution_health` 급락 |
| F1 자동검수 과다 개입 | 검수 큐 적체 | `v_manual_reasons` 분포 |
| F2 전화하기 우선 배치 | 통화가 귀속 밖 | 문의 대비 통화 비율 |
| F3 시스템 밖 계약 | 성사 미포착 | `v_contract_conversion` 낮음 |
| F4 원장 불일치 | 배치 중단 | `ops_alerts` CRITICAL |

**F3 이 가장 위험합니다.** 계약서를 시스템 밖에서 쓰면 성사가 기록되지 않고,
그러면 정산도 구독 유지 유인도 사라집니다. 계약서 발급을 주 동선으로 두는 것이 전제입니다.

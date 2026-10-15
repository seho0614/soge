# 소개뱅크 — API 설계서 v1

**작성일** 2026-09-03
**참조 구현** `src/modules/review/*` · `src/modules/listing/*`
**현황** 88 오퍼레이션 · 스키마 정의 8 · 필수 65

---

## 1. 이 API 가 다른 곳과 다른 점

일반 CRUD API 와 두 가지가 다릅니다.

**① 규칙 판정을 서버가 하지 않습니다.** 제한업종·금칙어·한도는 DB 트리거가 막고, 컨트롤러는 그 예외를 상태코드로 옮깁니다. 그래서 **서비스 코드에 검증 로직이 거의 없습니다.** 이걸 모르면 "검증이 빠졌다"고 오해합니다.

**② 상태 전이가 자동으로 일어납니다.** 계약서 양측 서명 → 성사 확정 → 정산 신청이 트리거로 이어집니다. **API 는 서명만 받고, 나머지는 응답에서 확인합니다.**

---

## 2. 리소스 모델

```
/listings          매물 (소개하기)
/requests          소개받기 요청
  /{id}/proposals    소개 제안
/conversations     1:1 문의
  /{id}/messages     메시지
/deals             거래
  /{id}/contract     계약서 발급·서명
  /{id}/payment-report  대금 지급 신고 (INV-11 — 금액 없음)
  /{id}/confirm      성사 확정
  /{id}/reviews      후기 (INV-5 — Deal 종속)
/settlements       정산
/disputes          분쟁
/referral-codes    소개코드
/me/*              내 것 조회
/admin/*           운영 콘솔
```

**중첩은 2단계까지만** 합니다. `/deals/{id}/contract` 는 되지만 `/deals/{id}/contract/{cid}/signatures` 는 안 만듭니다. 계약서는 Deal 당 하나이므로 컬렉션이 아닙니다.

`/me/*` 를 따로 둔 이유: `/listings?owner=me` 로 하면 권한 검사가 쿼리 파라미터에 걸립니다. 경로가 다르면 가드가 다르게 붙습니다.

---

## 3. 요청 규약

| 항목 | 규칙 |
|---|---|
| 인증 | `Authorization: Bearer` — access 15분 |
| 귀속 | `X-Ref-Code` — 있으면 서버가 즉시 유입 기록 (INV-2) |
| 멱등성 | `Idempotency-Key` — 결제·정산·코드 발급은 **필수**. 없으면 422 |
| 목록 | `?cursor=&limit=` — offset 금지 |
| 낙관적 잠금 | 수정 요청 본문에 `version`. 불일치는 409 |

### 3-1. `X-Ref-Code` 를 헤더에 둔 이유

쿼리 파라미터로 두면 사용자가 URL 을 복사해 공유할 때 남의 코드가 따라갑니다. 헤더면 클라이언트가 저장한 값만 전달됩니다.

**단, 최초 유입은 쿼리(`?ref=`)로 들어옵니다.** 프런트가 이를 읽어 저장하고, 이후 요청부터 헤더로 보냅니다.

### 3-2. `version` 을 본문에 둔 이유

`If-Match` 헤더가 정석이지만, 폼에서 hidden 필드로 실어 보내는 편이 프런트 구현이 단순합니다. 이 시스템의 수정 대상은 대부분 폼입니다.

---

## 4. 응답 규약

### 4-1. 목록은 섞지 않습니다

```json
{
  "promoted": [...],
  "organic":  [...],
  "nextCursor": "eyJ...",
  "adNotice": "광고 영역은 유료 노출입니다."
}
```

하나의 배열로 내보내면 프런트가 라벨을 빠뜨릴 수 있고, **그러면 노출순위 표시 의무 위반이 화면 단에서 발생합니다**(전자상거래법 · INV-11). 배열을 나누면 그 실수가 구조적으로 불가능합니다.

### 4-2. 라벨은 서버가 내려 줍니다

```json
{ "status": "PUBLISHED", "statusLabel": "노출 중" }
```

코드와 라벨을 함께 보냅니다. 프런트는 분기에 `status` 를, 표시에 `statusLabel` 을 씁니다. **"노출 중"을 "게시 중"으로 바꾸는 데 배포가 필요 없습니다.**

### 4-3. 금액은 정수입니다

원 단위 정수로 내려갑니다. 소수점이 없고, JSON number 범위 안입니다. 프런트에서 `toLocaleString()` 만 하면 됩니다.

**서버 내부는 `NUMERIC`, 응답은 정수** — 이 경계를 넘을 때만 변환합니다.

### 4-4. 할 수 있는지를 서버가 판정합니다

```json
{ "canInquire": false, "inquireBlockReason": "BUSINESS_REQUIRED" }
```

프런트가 역할·게이트 조합을 다시 계산하지 않게 합니다. 규칙이 바뀌면 서버만 고칩니다.

---

## 5. 오류 규약

```json
{ "code": "RESTRICTED_CATEGORY", "message": "보험 상품의 모집·중개는…", "field": "categoryId" }
```

| 상태 | 의미 | 프런트 동작 |
|---|---|---|
| 400 | 형식 오류 | 입력 고치기 |
| 403 | 권한·게이트 | 인증·사업자 전환 유도 |
| 404 | 없음 | |
| **409** | 상태 충돌 | **재시도 무의미** — 다시 불러오기 |
| **422** | 정책 위반 | 안내 후 다른 값 |

### 주요 코드

| code | 상태 | 발생 |
|---|---|---|
| `RESTRICTED_CATEGORY` | 422 | 제한업종 등록 |
| `LISTING_SLOT_LIMIT` | 422 | 구독 슬롯 초과 |
| `VIEW_QUOTA_EXCEEDED` | 422 | 열람 한도 초과 → 업그레이드 유도 |
| `INV_2` ~ `INV_10` | 422 | 불변식 위반 |
| `VERSION_CONFLICT` | 409 | 낙관적 잠금 실패 |
| `ALREADY_DECIDED` | 409 | 이미 처리된 검수 |
| `IMMUTABLE_RECORD` | 409 | append-only 테이블 수정 시도 |
| `BUSINESS_REQUIRED` | 403 | 개인 회원의 정산 접근 (INV-10) |
| `SUBSCRIPTION_REQUIRED` | 403 | 구독 없는 코드 발급 (INV-8) |

**`message` 는 사용자에게 그대로 보여도 되는 문장**입니다. 제한업종 차단 메시지는 `restricted_industries.block_message` 에서 오므로 관리자가 문구를 바꿀 수 있습니다.

---

## 6. 자동 처리를 응답으로 알립니다

```json
POST /listings
{ "listingId": "...", "reviewId": "...", "status": "PUBLISHED", "autoApproved": true }
```

자동검수를 통과하면 `IN_REVIEW` 가 아니라 **바로 `PUBLISHED`** 로 옵니다. 프런트는 `autoApproved` 로 분기해 "검수 요청됨" 대신 "등록 완료 · 노출 중"을 띄웁니다.

계약 서명도 마찬가지입니다. 두 번째 서명 응답에 성사 확정과 정산 신청 결과가 함께 담깁니다.

---

## 7. 컨트롤러 작성 규칙

```ts
@ApiTags('HOM')
@Controller('api/v1/listings')
export class ListingController {
  @Post()
  @Roles('BIZ_OWNER', 'BIZ_STAFF')        // 역할
  @RequireGate('IDENTITY_VERIFIED')       // 불변식 게이트
  @Audit('LISTING_CREATE', 'LISTING')     // 감사 로그
  @ApiOperation({ summary, description }) // 문서
  @ApiResponse({ status: 422, ... })      // 정책 위반 사유를 명시
  create(@Body() dto: CreateListingDto) { ... }
}
```

**5개 데코레이터가 한 세트입니다.** 하나라도 빠지면 권한이 뚫리거나, 감사 기록이 없거나, 프런트가 스키마를 못 받습니다.

### DTO 규칙

| 항목 | 규칙 |
|---|---|
| 요청 | `class-validator` + `@ApiProperty` 를 **같은 필드에** |
| 응답 | 별도 클래스. 엔티티를 그대로 내보내지 않습니다 |
| 열거형 | `@ApiProperty({ enum: [...] })` — 생성 문서에 값이 들어갑니다 |
| 설명 | **왜 그런지**를 씁니다. "제목"이 아니라 "30자 미만이면 사람이 봅니다" |

---

## 8. 하지 않는 것

| 유혹 | 이유 |
|---|---|
| 엔티티를 그대로 응답 | 컬럼 추가가 곧 API 변경이 됩니다 |
| `PUT` 전체 교체 | 부분 수정이 대부분입니다. `PATCH` 만 씁니다 |
| 응답에 `success: true` | 상태코드가 이미 말합니다 |
| GraphQL | 화면이 73개인데 쿼리 최적화보다 계약 명확성이 중요합니다 |
| 서비스에서 제한업종 재검사 | DB 와 어긋나면 어느 쪽이 맞는지 알 수 없습니다 |
| 목록에 광고 섞기 | 표시 의무 위반이 화면 단에서 발생합니다 |

---

## 9. 진척 관리

```bash
npm run docs     # 생성 → Swagger 추출 → 병합 → 리스트 → 계획
npm run verify   # 전체 검증
```

`x-status` 가 `NOT_IMPLEMENTED` → `IMPLEMENTED` 로 바뀌는 것이 진척입니다.

| 시점 | 정의 / 전체 |
|---|---|
| 검수 컨트롤러 | 4 / 88 |
| **리스팅 컨트롤러 추가** | **8 / 88** |
| 목표 (오픈) | 65 / 88 |

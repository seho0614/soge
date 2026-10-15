# 소개뱅크

**검정 306건 전량 통과** · 기준선 11개 · 라우트 151개 · 화면 정의 112개

| | |
|---|---|
| 스택 | PostgreSQL 16 · NestJS 11 · TypeScript 5 · Next.js(사용자) · Vite(관리자) |
| 스키마 | 테이블 95 · 뷰 77 · 함수 199 · 트리거 72 |
| 수익 | 회원등급별 월 회비 + 광고 (소개비는 당사자 직접 지급) |

## 먼저 읽을 것

| 상황 | 문서 |
|---|---|
| 처음 받았습니다 | 이 파일 → `docs/` |
| 설치·실행이 안 됩니다 | 산출물의 `소개뱅크_개발환경` |
| 배포하려 합니다 | 산출물의 `소개뱅크_반영절차서` |
| 왜 이렇게 됐는지 궁금합니다 | 산출물의 `sgb-migrations-backup.zip` |

---

## 빠른 시작

```bash
npm install && (cd site && npm install) && (cd web && npm install)
cp .env.example .env                    # DATABASE_URL · JWT_SECRET

npm run db:embedded &                   # ① 임베디드 PG (포트 54329)
# docker compose up -d                  # ② Docker DB 만 (포트 5432) · 앱까지 전부는 상위 폴더 docker-compose.yml

npm run db:migrate                      # 기준선 11개
npm run db:seed                         # 픽스처
npm run db:seed:dev                     # ★ 개발 계정 비밀번호 — 빠뜨리면 로그인이 안 됩니다

npm run dev                             # API      :3000  (/docs 에 API 문서)
(cd web && npm run dev)                 # 관리자    :5173
(cd site && npm run dev)                # 사용자    :5174
```

**프런트 둘 다 `/api` 를 3000 으로 프록시합니다.** API 가 없으면 500 이 납니다 —
화면이 안 뜨면 프런트가 아니라 3000 포트를 먼저 보십시오.

## 검정

```bash
npm run verify        # 전부 (306건)
```

| 게이트 | 기대값 |
|---|---|
| 불변식 | 136 / 0 |
| 공격 | 125 / 0 |
| 문서 정합성 | 22 / 0 |
| 결제 · 국세청 어댑터 | 25 / 0 · 10 / 0 |
| 비밀값 | 4 / 0 |
| 부팅 | 라우트 151 · 중복 없음 |

**`npm run smoke` 를 빠뜨리지 마십시오.** 컨트롤러를 `app.module.ts` 에 등록하지 않아도
타입 검사와 문서 생성은 둘 다 통과합니다 — 라우트만 조용히 죽습니다.

## 마이그레이션 이력은 별도 백업에 있습니다

이 킷에는 **기준선 11개만** 들어 있습니다. 패치 92건은
`sgb-migrations-backup.zip` 으로 분리했습니다.

**그 백업을 실행하지 마십시오.** 이미 기준선에 흡수되어 있어서
다시 돌리면 실패하거나 지금 스키마를 망칩니다.
"왜 그렇게 됐는지"를 확인할 때만 씁니다.

## 손대면 안 되는 것

| 대상 | 이유 |
|---|---|
| `prisma/migrations/B*` | 기준선. 새 파일을 추가하십시오 — 러너가 체크섬으로 막습니다 |
| `docs/*` | 생성물. `npm run docs` 가 덮어씁니다 |
| `src/generated/codes.ts` | 생성물. DB 라벨에서 나옵니다 |

## 업무 규칙은 DB 에 있습니다

API 에 규칙을 다시 쓰지 마십시오. **두 곳에 있으면 반드시 갈라집니다.**

| 규칙 | 집행 |
|---|---|
| 양측 확인 후 확정 (INV-4) | 트리거 (INSERT · UPDATE 양쪽) |
| 소개비 무공제 (INV-9R) | **공제 컬럼 부재** |
| 자금 미수탁 (INV-11) | **계좌·에스크로 컬럼 부재** |
| 동의 없이 연결 불가 | 초대 상태 검사 · 동의는 되돌릴 수 없음 |
| 다단계 불가 | **하위 수당 컬럼 부재** |
| 광고가 순위에 끼지 않음 | `ad_slots.in_ranking` CHECK |

DB 가 올린 위반은 `DbErrorFilter` 가 HTTP 로 옮깁니다. 메시지를 다시 쓰지 마십시오.



## 애플리케이션 골격

```
src/
  main.ts                    설정 검증 → ValidationPipe → DbErrorFilter
  app.module.ts
  core/                      ★ 기초 계층 (도메인 지식 없음)
    request-context.ts       requestId · actor · 트랜잭션 커넥션 (AsyncLocalStorage)
    config.ts                환경변수 부팅 시 검증
    errors.ts                422 / 409 / 403 / 404
    auth.ts                  역할 7종 + INV 게이트 (@Roles @RequireGate)
    pagination.ts            커서 전용. offset 금지
    context.middleware.ts
    audit.interceptor.ts     @Audit 선언 → 감사 로그
    idempotency.interceptor.ts
  common/
    db-error.filter.ts       DB 예외 → 422/409 매핑
  db/
    database.service.ts      풀 · 트랜잭션마다 전용 커넥션
  modules/
    review/                  ★ B3 검수 (최대 병목) — 구현
      review.controller.ts     SB-ADM-REV-010/020
      review.service.ts        결정 + 대상 상태 전이 (같은 트랜잭션)
      review.repository.ts     큐 조회는 부분 인덱스를 그대로 탄다
      review.dto.ts            반려 사유는 코드값
      review.types.ts          SLA 24h
    catalog/                 ★ T2 카탈로그·정책
      catalog.controller.ts    관 · 업종 · 코드 번들 · 정책
      catalog.service.ts       업종 승인 (A-14 게이트는 DB)
      catalog.dto.ts
      code.service.ts          코드 라벨 (60초 캐시)
    identity/                ★ T1 인증 코어
      auth.service.ts          로그인·가입·토큰 발급
      auth.middleware.ts       토큰 → principal (DB 재조립)
      principal.service.ts     역할·인증·구독 상태
      business.service.ts      개인 → 사업자 승격 (재가입 아님)
      verification.provider.ts PASS·NTS 어댑터 (스텁 ↔ 실연동)
      auth.controller.ts       로그인·가입·약관·사업자 신청
      auth.dto.ts
    listing/
      listing.service.ts     등록 → 검수 큐 적재 (등급은 카테고리가 결정)
      listing.controller.ts  ★ T5 매물 목록·상세·등록·수정
      listing.repository.ts    광고/일반 별도 쿼리
      listing.dto.ts
      favorite.service.ts      관심 목록
      my.controller.ts         내 리스팅 · 관심
    deal/                    ★ T6 문의·거래·귀속 (모델의 급소)
      deal.controller.ts       문의·Deal·소개비 협의·계약·서명·지급신고
      deal.service.ts          연락처 마스킹 · 서명은 기록만 (확정은 트리거)
      deal.dto.ts
    request/                 ★ T5 소개받기
      request.controller.ts    등록·목록·상세·제안
      request.service.ts       열람 한도 차감
      request.dto.ts
  engines/
    attribution/
      attribution.engine.ts  ★ 귀속 — record · link · resolve
    exposure/
      exposure.engine.ts     노출·랭킹 — organic / promoted 분리
```

**검증 완료 (실 DB)**

```
01 등록 → 검수 큐 적재 (SLA 24h 설정)     ok
   큐 조회 — SLA 마감 순                  ok
   사유 없는 반려 → DB 차단               ok
02 승인 → 리스팅 PUBLISHED 전이           ok
   이미 처리된 건 재결정 → 0행 → 409      ok
   검수 처리량 지표 집계                  ok
   감사 로그 UPDATE → 차단                ok
```

빌드: `npx tsc -p tsconfig.json` — 타입 오류 0

---

## 구성

```
prisma/
  migrations/          ← 정본. 순서대로 실행되어야 함
    000_extensions        확장 · 스키마 3종 · 공통 함수
    010_identity          계정 · 사업자 · 권한 · 약관
    020_catalog           관 · 업종 · 등급 · 지역
    030_policy            금칙어 · 제한업종 · 사이트 설정
    040_billing           구독 · 소개코드 · 원장 · PG
    050_content           리스팅 · 요청 · 제안 · 관심
    060_review            검수 큐 · 반려 사유
    070_attribution       귀속 로그 (append-only)
    080_deal              문의 · Deal · 합의 · 계약 · 후기
    090_settlement        정산 · 세금계산서 · 분쟁
    (100_lead             리드관 — migrations-deferred/ 로 보류)
    110_notify            알림 · 공지 · 광고 · 고객센터
    120_audit             감사 로그 (append-only)
    125_grants            롤 · 권한 회수 가이드
    130_integrity         D-1·D-2·D-3 무결성 · 코드 실효
    140_subscription_tiers B-13R2 등급 · B-20 라벨 · C-12 경보
    150_promotion         B-21 프로모션 · 만료 코호트
    160_settlement_automation  A-15 성사 자동 확정 · 정산 자동 신청
    170_legal_seed        C-07 · B-20 · A-14 · I-06 · B-14 법무 반영
    180_attribution_engine 귀속 엔진 · 방문자 연결 · 정책 버전
    190_idempotency       멱등성 저장소 (48시간 보존)
    200_auto_review       ★ 자동검수 엔진 · 반려 사유 코드
    210_listing_badges    급구 · 서류확인 배지 (전건 검수)
    220_code_registry     ★ 코드 레지스트리 (라벨 105건)
    230_notification_seed 알림 템플릿 51 · 수신거부 정책 28
    240_terms_and_footer  약관 6종 골격 · 푸터 링크 · 오픈 차단 확장
    250_open_blocker_fix  약관 판정을 코드 단위로 · 이전 버전 자동 보관
  schema.prisma        ← 모델은 db pull 로 생성. 정본 아님
spec/
  screens.json         ← 화면 레지스트리 (정본)
  notifications.json   ← 알림 이벤트 (정본)
docs/
  00_통합설계서.md      ★ 단일 참조본

  ── 자동 생성 (npm run docs · 손으로 고치지 마십시오) ──
  01_화면정의서.md       02_권한매트릭스.md    03_네비게이션정의서.md
  04_상태전이명세.md     05_알림설계서.md      06_openapi.json
  07_API스키마리스트.md  08_필수API_개발절차.md
  11_DB설계서.md         14_Flow설계서.md
  19_개인정보처리방침_초안.md  20_코드정의서.md
  21_알림문구정의서.md   22_메시지정의서.md
  소개뱅크_로컬확인.html  ← 브라우저에서 바로 열립니다

  ── 수기 (왜 그렇게 정했는가) ──
  09_API설계서.md        12_연동설계서.md
  13_시스템설계서.md     15_백엔드설계서.md    16_프런트엔드설계서.md
  17_아키텍처설계서.md   18_연계설계서.md
  23_미진행항목정리.md   24_설계판단근거.md
  25_배포운영절차서.md   26_환경설치절차서.md   27_개발절차서.md
scripts/
  migrate.sh           ← 마이그레이션 러너 (이력 · 체크섬)
  deploy-check.sh      ← 배포 전 점검 7항목
  smoke-boot.ts        ← 부팅 · 라우트 등록 확인
  verify-invariants.sh ← CI 필수 게이트 (DB 불변식 58건)
  verify-docs.js       ← CI 필수 게이트 (문서 정합성 22건)
  verify-all.sh        ← 전체 검증 한 번에
  gen-docs.js          ← spec/*.json → docs/*
  dump-swagger.ts      ← 컨트롤러 데코레이터 → docs/_swagger_from_code.json
  merge-openapi.js     ← 둘을 병합
  gen-codes.js         ← code_labels → src/generated/codes.ts
  fixture.sql
.github/workflows/
  db-invariants.yml
```

---

## 인증 — 토큰을 믿지 않습니다

principal 은 토큰 클레임이 아니라 **DB 에서 다시 조립**합니다.

```
구독 만료 → 토큰은 15분 유효 → 클레임 sub_active=true
                            → DB 재조회 → SUBSCRIPTION_REQUIRED
```

조회 1회 비용보다 "만료됐는데 15분간 통과"가 훨씬 비쌉니다.
사업자 승인도 즉시 반영돼야 합니다 — 승인받고 15분 기다리게 하면 문의가 옵니다.

**개인 → 사업자는 승격이지 재가입이 아닙니다.** 재가입으로 처리하면
귀속 기록(INV-2)이 끊깁니다. `businesses.verified_at` 이 소개비 수령 자격의 기준일입니다.

---

## 트랜잭션 — 인자로 넘기지 않습니다

```ts
await db.transaction(async () => {
  await repo.a();   // 두 쿼리가 같은 트랜잭션
  await repo.b();
});
```

`tx` 를 인자로 넘기면 한 곳만 빠뜨려도 그 쿼리가 트랜잭션 밖에서 돕니다.
컴파일도 통과하고 테스트도 통과합니다. 정산에서는 나중에 잔액으로 드러납니다.
`AsyncLocalStorage` 로 전달하면 빠뜨릴 자리 자체가 없습니다.

중첩 호출은 savepoint 없이 기존 트랜잭션에 합류합니다 —
안쪽에서 COMMIT 이 나가면 바깥의 실패가 확정된 데이터를 되돌리지 못합니다.

---

## 설계 원칙 — 코드 쪽

**검사를 두 곳에 두지 않습니다.** 제한업종·금칙어·한도는 DB 트리거가 담당하고,
서비스는 다시 검사하지 않습니다. 두 곳에 두면 반드시 어긋납니다.
대신 `DbErrorFilter` 가 트리거 예외를 의미 있는 상태코드로 바꿉니다.

| DB 예외 | HTTP | 코드 |
|---|---|---|
| `RESTRICTED_CATEGORY: ...` | **422** | `RESTRICTED_CATEGORY` |
| `INV-n violated: ...` | **422** | `INV_n` |
| `view quota exceeded` | 422 | `VIEW_QUOTA_EXCEEDED` |
| `listing slot limit reached` | 422 | `LISTING_SLOT_LIMIT` |
| `append-only table: ...` | **409** | `IMMUTABLE_RECORD` |
| 이미 처리된 건 (0행) | **409** | `ALREADY_DECIDED` |

422 와 409 를 섞지 않는 이유: 프런트가 재시도할지 말지를 판단해야 합니다.

---

## 규칙 3가지

**1. 마이그레이션이 정본입니다.**
트리거·CHECK·부분 인덱스·뷰는 Prisma 스키마로 표현되지 않습니다. `db pull` 결과를 마이그레이션보다 우선하지 마십시오.

**2. DB 변경은 2단계 배포입니다.**
컬럼 추가 → 코드 배포 → (1주 후) 구 컬럼 제거. `DROP COLUMN`·`RENAME`을 한 번에 배포하지 않습니다. 정산 데이터는 롤백이 불가능합니다.

**3. 불변 테이블은 리포지토리에서 update/delete를 노출하지 않습니다.**
`attribution_events` · `fee_agreements` · `ledger_entries` · `term_agreements` · `review_events` · `audit.*` · `call_logs`.
DB가 막지만 컴파일 타임에 막는 편이 낫습니다.

---

## 성사 자동 처리 (A-15)

소개자의 신고 행위 없이 성사가 기록됩니다.

```
계약서 발급  → 합의 금액 LOCKED 고정 (D-03 잠금점)
구매자 서명  → 아직 확정 안 됨
판매자 서명  → 양측 확인 자동 생성 (source=CONTRACT)
             → deal CONFIRMED / confirm_mode=CONTRACT
             → 귀속 first-touch 판정·스냅샷 고정 (INV-2)
             → 정산 자동 신청 (INV-3·9·10 충족 시)
             → 소개자가 개인이면 사업자 전환 안내 발송 (INV-10)
```

**한계**: 계약이 시스템 밖에서 이루어지면 여전히 포착되지 않습니다.
`v_contract_conversion` 으로 문의 대비 계약 발급률을 추적하십시오 — 이 비율이 낮으면
거래가 플랫폼 밖에서 일어나고 있다는 신호입니다.

---

## 설계 문서 — 손으로 쓰지 않습니다

```bash
npm run docs      # 생성 → Swagger 추출 → 병합
npm run verify    # 전체 검증
```

### OpenAPI 는 두 곳에서 옵니다

| 출처 | 담당 |
|---|---|
| `spec/screens.json` | 경로 · 어느 화면이 쓰는가(`x-screens`) · 역할 · 게이트 |
| 컨트롤러 데코레이터 | 요청/응답 스키마 · 설명 |

**어느 쪽도 혼자서는 부족합니다.** 레지스트리는 화면과 API 의 연결을 알고,
데코레이터는 그 API 가 무엇을 주고받는지 압니다. `merge-openapi.js` 가 합칩니다.

충돌 규칙 — **스키마는 코드가 진실**, **화면·역할·게이트는 레지스트리가 진실**.

스키마가 없는 오퍼레이션은 `x-status: NOT_IMPLEMENTED` 로 표시됩니다.
컨트롤러에 데코레이터를 달면 자동으로 `IMPLEMENTED` 로 바뀝니다.

문서를 각각 손으로 쓰면 화면·API·권한이 서로 어긋납니다. **하나의 레지스트리에서
뽑으면 어긋날 자리가 없습니다.** 화면을 추가하려면 `spec/screens.json` 만 고치십시오.

CI 가 재생성 후 `git diff --exit-code` 로 드리프트를 막습니다.

---

## 오픈 차단 — 세 곳을 함께 봅니다

```sql
SELECT kind, item, reason FROM v_open_blockers;
--  SETTING 7   푸터 법정고지 미입력
--  TERM    3   약관 미발행 (B-12 법무 대기)
--  FOOTER  5   목적지 없는 링크
```

`ENVIRONMENT=prod` 배포 점검은 이게 0 이 아니면 **막습니다.**

**약관은 내용 없이 발행할 수 없습니다.** `status='PUBLISHED'` 로 바꾸려면 body 와
시행일이 있어야 하고, DB 가 검사합니다. 껍데기만 올려 두고 오픈하는 일을 막습니다.

### 법무 회신이 오면



발행하면 푸터 링크가 활성화되고 오픈 차단이 줄어듭니다. 이전 버전은 ARCHIVED 로
남습니다 — `term_agreements` 가 참조하므로 삭제하지 않습니다.

**목적지 없는 푸터 링크는 숨기지 않습니다.** `available=false` 로 내려보내고
화면이 점선 + tip 으로 그립니다 — 없다는 사실이 보여야 합니다.

---

## 코드 — 라벨을 하드코딩하지 않습니다

```bash
DATABASE_URL=... node scripts/gen-codes.js > src/generated/codes.ts
```

코드 목록과 타입은 컴파일 타임에 고정하고, **라벨은 DB 가 정본**입니다.
"노출 중"을 "게시 중"으로 바꾸는 데 배포가 필요하면 안 됩니다.

**`domain` 이 핵심입니다.** `REJECTED` 는 매물에서 "반려", 분쟁에서 **"기각"**,
제안에서 **"거절"** 입니다. 도메인 없는 코드 테이블은 이 구분을 잃습니다.

`v_code_missing_labels` 가 비어야 합니다 — 라벨 없는 코드는 화면에 영문으로 나갑니다.
CHECK 제약을 확장하면 **같은 마이그레이션에서 `code_labels` 도 채우십시오.**

---

## 자동검수 — 대원칙

**자동 처리가 기본이고, 관리자는 필수 사항에만 개입합니다.**

판정은 "자동 승인해도 되는가"가 아니라 **"사람이 봐야 할 이유가 있는가"** 입니다.
이유가 없으면 자동 통과하고 리스팅이 즉시 `PUBLISHED` 로 전이됩니다.

```sql
SELECT fn_auto_review_reasons(review_item_id);
--  {}                      → 자동 승인
--  {HIGH_FEE,FIRST_LISTING} → 관리자 큐
```

개입 사유 6종은 `auto_review_policies` 에서 **코드 배포 없이** 켜고 끄고 임계값을
바꿉니다. `auto_approve_enabled` 를 끄면 전건 수동으로 즉시 전환됩니다.

자동 승인 건의 5%는 표본 감사 큐로 갑니다 — **표본 감사 없이 자동화하면
오판을 영원히 모릅니다.**

관측: `v_auto_review_rate` · `v_manual_reasons` · `v_audit_sample_queue`

---

## 매물 배지 — 등록 필드가 아닙니다

급구·서류확인은 **별도 신청 → 검수 → 부여** 흐름입니다. 등록 폼 체크박스로 켜지면
아무도 검증하지 않은 표시가 노출됩니다.

```
신청 → review_items(LISTING_BADGE) → 사람이 판정 → GRANTED / REJECTED
```

배지는 **자동검수 대상이 아닙니다.** 다른 매물보다 눈에 띄게 만드는 장치라
남용 유인이 크고, 자동화 대원칙의 "필수 개입" 대상입니다.

**매물을 수정하면 배지가 회수됩니다.** 확인한 시점의 내용과 지금 내용이 다르면
확인의 의미가 없습니다.

> ⚠ **"안전매물"이라는 표현을 쓰지 않습니다.** INV-11(품질 보증 없음)과 충돌합니다.
> 표시 문구는 `site_settings.badge.verified_label` 에서 관리하며 기본값은 "서류 확인"입니다.
> 안내 문구도 함께 노출해야 합니다 — "제출한 서류가 확인되었다는 표시이며,
> 거래의 안전이나 품질을 보증하지 않습니다."

---

## 귀속 엔진 — 실수하기 쉬운 지점

```ts
// 로그인·가입 성공 직후 반드시 호출
await attribution.link(visitorKey, accountId, 'LOGIN');
```

**이 호출이 빠져도 에러가 나지 않습니다.** 테스트도 통과하고, 귀속률만 조용히
낮아집니다. 비로그인 유입이 실제 유입의 대부분이므로 영향이 큽니다.
오픈 첫 주에 `v_attribution_health` 를 확인하십시오.

---

## 대량 이관 절차 (D-14)

1. 트리거 비활성화
2. 벌크 적재
3. `SELECT * FROM fn_verify_invariants();`
4. **위반 0건 확인 — 하나라도 걸리면 롤백**
5. 트리거 재활성화
6. 재실행 확인

---

## 운영 배치

| 주기 | 호출 | 용도 |
|---|---|---|
| 매시간 | `fn_check_sla_alert()` | 검수 24시간 SLA |
| 매일 | `fn_check_promo_expiry()` | 프로모션 만료 D-14 고지 |
| 매월 1일 | `fn_check_k_alert()` | k값 1.30 · 2개월 연속 → 증원 발의 |
| 수시 | `fn_end_promo(sub_id, next_plan)` | 프로모션 종료 · 슬롯 강등 |
| 매시간 | `fn_expire_badges()` | 급구 배지 만료 |

## 운영 뷰

| 뷰 | 용도 |
|---|---|
| `v_k_value` | 가입당 등록 건수 — 최대 미지수 |
| `v_review_throughput` | 검수 처리량 · SLA 위반 |
| `v_introducer_stats` | 소개자 실적 — **중개 이탈 관측** |
| `v_promo_cohort` | 프로모션 만료 집중도 |
| `v_contract_conversion` | 계약 발급률 — **시스템 밖 거래 탐지** |
| `v_open_blockers` | 미입력 필수 설정 — 오픈 차단 항목 |
| `v_attribution_health` | 월별 귀속률 — **link 누락 감시** |
| `v_attribution_channels` | 채널별 유입 분포 |
| `v_auto_review_rate` | **자동화율 — 검수 여력** |
| `v_manual_reasons` | 개입 사유 분포 — 다음 자동화 후보 |
| `v_audit_sample_queue` | 표본 감사 대기 |
| `v_badge_stats` | 배지 신청·부여·반려 분포 |

---

## 주의 — 픽스처

`scripts/fixture.sql` 은 **시험 전용**입니다. 운영 DB에서 실행하지 마십시오.

- `TRUNCATE ... CASCADE` 를 쓰지 않습니다. `accounts` 를 CASCADE 하면 `updated_by` 로
  연결된 `site_settings` · `restricted_industries` · `banned_words` · `categories` 까지
  함께 지워집니다.
- append-only 테이블 초기화를 위해 `session_replication_role = replica` 로 트리거를
  잠시 끕니다. 이 구간이 운영에서 실행되면 무결성 장치가 전부 무력화됩니다.

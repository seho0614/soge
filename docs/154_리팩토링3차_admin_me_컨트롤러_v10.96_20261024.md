# 154. 리팩토링 3차 — admin · me 서비스 · 컨트롤러 2개 (v10.96 · 2026-10-24)

> 대표 결정(2026-10-24 「1 2 3 4」 → 계획 「승인」 — 4번)
> 앞 판: docs/153(v10.95) · **마이그레이션 없음** · **동작 · 주소(API) · 화면 바뀌지 않음** · 방법은 docs/140 · 147 과 같음

## 1. 결론

| 대상 | 전 | 후 |
|---|---|---|
| `admin.service.ts`(671줄) | 한 클래스 | AdminService(요약 · 분쟁 · 거래 · 정산 · 설정 · 스위치 검사 · 코드 라벨 · 오픈 차단) + **AdminReviewService**(배지 · 자동검수 통계 · 표본 감사 · 검수 이유) + **AdminMemberService**(사업자 인증 · 회원 상태 · 등록 정지 해제 · 회원 조회) |
| `me.service.ts`(563줄) | 한 클래스 | MeService(구독 · 요약 · 홈 · 활동 지역 · 내 정보) + **MeActivityService**(매물 · 거래 · 대화 · 계약 · 관심) + **MeMoneyService**(정산 · 정산 예정 · 세금계산서 표시) + **MeNotifyService**(알림 · 알림 설정 · 문의 · 분쟁) |
| `partner.controller.ts`(693줄) | 컨트롤러 4개 + DTO 12개 | 파일 4개(partner · **partner-admin** · **qualification** · **broker-admin**.controller.ts) + **partner.dto.ts** |
| `health-shop.controller.ts`(675줄) | 컨트롤러 + DTO 14개 | 컨트롤러 + **health-shop.dto.ts** |

옮긴 함수 본문 **55개 글자 그대로**(원본과 비교) · 컨트롤러 줄은 import 와 파일 머리말 말고 모두 같음.

## 2. 나누지 않은 것 (계획 그대로)

| 파일 | 까닭 |
|---|---|
| `billing.service.ts` | 소개코드 발급(issueCodes)이 구독 함수(subscribe · activeSub · freeUsage)를 `this.X(` 로 부릅니다 — 나누면 본문을 바꾸거나 135줄을 두 곳에 복사해야 하고, 매트릭스 생성기(this.X 만 따라감)가 표를 잃습니다 |
| `recurring-batch.service.ts` | v10.86 에서 이미 나눈 결과물 · 함수끼리 많이 서로 부름 |
| admin 의 설정 · 스위치 검사 | `checkSwitch` 본문이 `AdminService.SWITCH_RULES` 를 이름으로 부릅니다 — 옮기면 본문이 바뀌어 AdminService 에 그대로 둠 |

## 3. 바뀐 연결

- `admin.controller` — `admin` + `memberSvc`(회원 · 사업자) + `reviewSvc`(검수 이유) · `admin-ops.controller` — `svc` + `reviewSvc`(배지 · 자동검수 통계 · 표본 감사) · `me.controller` — `svc` + `activity` · `money` · `notify`.
- 주입 이름은 컨트롤러 메서드 이름과 겹치지 않게(v10.86 `leads` · v10.92 `contract` 에서 배운 것).
- `contractSides`(계약 카드의 「나 ↔ 상대」)는 원래 클래스 뒤에 있던 함수라, 쓰는 곳(contracts)과 같은 파일 클래스 앞으로(본문 그대로).
- app.module — 새 서비스 5개 등록 · partner 컨트롤러 import 4줄.

## 4. 확인

| 확인 | 결과 |
|---|---|
| 함수 본문 비교 | 55/55 같음 · contractSides 같음 |
| 컨트롤러 줄 비교 | partner 618줄 빠진 줄 0 · health-shop 596줄 — import 다시 쓴 2줄 말고 같음(주석 1줄은 DTO 파일로) |
| 형식 검사(api) | 0 |
| `qa/test_v1096.py` | 36/36 |
| 옛 시험 | test_v1045(운영 파트너 컨트롤러 파일) · test_v1065(마이그레이션 허용값 151 ~ 154 — v10.89 부터 빠져 있던 것) · test_v1086 137/137 |
| realcheck · 기능 점검 · 독립 검토 | 풀 리퀘스트 설명에 붙임 |

## 5. 운영 적용

마이그레이션 없음 · 설정 없음 — 다음 반영 때 함께(precheck `올릴 것 0`).

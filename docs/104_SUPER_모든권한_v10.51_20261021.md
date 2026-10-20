# 104. SUPER 는 모든 권한 — v10.51 (2026-10-21)

> 결정(2026-10-21, 대표): SUPER 역할은 모든 권한을 가진다. 정산 지급(settlement:pay) 포함, 앞으로 새로 생기는 권한도 자동 포함.
> 결정 기록: sgb-docs/decisions/super-all-permissions.md

## 1. 결론

| 항목 | 바꾼 것 |
|---|---|
| 서버 권한 검사 | `AuthGuard` 가 **SUPER 를 항상 통과**시킵니다(`hasRole`). `@Roles` 에 SUPER 를 하나하나 적지 않습니다 |
| DB 역할 검사 | `fn_has_role(계정, 역할...)` (D104) — SUPER 는 언제나 참. 퍼블리셔 명세서 집행이 이 함수를 씁니다 |
| 운영 화면 | SUPER 는 모든 탭 · 지급 기록 · 입금 기록 · 명세서 집행 단추를 봅니다 |
| 감사 기록 | 그대로 남습니다. SUPER 로 들어온 요청은 `actor_role = SUPER` 로 적힙니다 |
| 그대로 둔 것 | 게이트(본인인증 · 구독) · 2인 원칙 · 지급 게이트 · 원장 일치 · 마지막 SUPER 회수 금지 |

## 2. 고치기 전 SUPER 에게 빠져 있던 권한 (26개 API)

`principal.service` 가 운영 계정에 MEMBER · BIZ_OWNER · BIZ_STAFF 를 붙이므로(2026-10-01 Q5) 회원 API 는 이미 열려 있었습니다.
빠진 것은 `@Roles` 에 ADMIN 또는 PAYOUT 만 적힌 운영 API 입니다. ADMIN 을 함께 가진 계정(시험 계정 admin@x.com)은 통과해서 시험에서 드러나지 않았고, **SUPER 만 가진 계정**이면 403 이었습니다.

| 번호 | 구역 | API | 고치기 전 역할 |
|---:|---|---|---|
| 1 | **정산 지급** | `POST /admin/payouts/:kind/:id/pay` | PAYOUT |
| 2 | **광고비 입금 기록** | `POST /admin/ad-invoices/:id/payments` | PAYOUT |
| 3 | **퍼블리셔 명세서 집행(DB)** | `PATCH /admin/adx/statements/:id` (PAY) — API 는 열려 있었고 DB 트리거가 PAYOUT 만 받음 | PAYOUT(DB) |
| 4~8 | 광고 청구 · 광고주 | `GET·POST /admin/advertisers` · `PATCH /admin/advertisers/:id/status` · `POST /admin/ad-invoices` · `GET /admin/ad-invoices` | ADMIN (목록은 ADMIN · PAYOUT) |
| 9~10 | 광고 미수 · 정산 | `GET /admin/ad-receivables` · `GET /admin/ad-settlement` | ADMIN · PAYOUT |
| 11~17 | 공개 자료 수집 | `/admin/collect/sources` (GET · POST) · `…/:code/gate` · `…/:code/state` · `…/:code/run` · `/admin/collect/fetches` · `/admin/collect/health` | ADMIN |
| 18~19 | 신고 처리 | `GET /admin/report-queue` · `PATCH /admin/reports/:id/resolve` | ADMIN |
| 20~24 | 이벤트 | `GET·POST /admin/events` · `PATCH /admin/events/:code/status` · `GET /admin/events/ungranted` · `PATCH /admin/event-joins/:id/grant` | ADMIN |
| 25~27 | 관 관리 | `GET /admin/gwans/manage` · `PATCH /admin/gwans/order` · `PATCH /admin/gwans/landing` | ADMIN |

(3번은 API 가 아니라 DB 라 표의 번호가 26 을 넘습니다 — API 26개 + DB 1곳.)

## 3. 바뀐 파일

| 파일 | 내용 |
|---|---|
| `src/core/auth.ts` | `isSuper` · `hasRole` 추가, `AuthGuard` 가 `hasRole` 사용, 감사 `actorRole` 은 SUPER 우선 |
| `src/modules/identity/principal.service.ts` | 운영 역할 순서 고정(SUPER · ADMIN · REVIEWER · PAYOUT) — `roles[0]` 을 쓰는 감사 기록(인증 미들웨어 · 파일 열람)도 SUPER 로 |
| `src/modules/file/file.service.ts` | 파일 용도별 업로드 검사도 `hasRole` |
| `src/modules/settlement/payout.controller.ts` · `ads/ad-billing.controller.ts` · `admin/admin-v31.controller.ts` | 설명 문구만(동작은 AuthGuard) |
| `prisma/migrations/D104_super_all_permissions/migration.sql` | `fn_has_role` 추가 · `fn_adx_statement_flow` 역할 검사를 `fn_has_role` 로 |
| `scripts/verify-invariants.sh` | SUP-1 ~ SUP-4 |
| `web/src/App.tsx` · `admin/Payouts.tsx` · `admin/Adx.tsx` | SUPER 는 모든 탭 · 지급 · 입금 · 집행 단추 |
| `scripts/gen-docs.js` · `docs/02_권한매트릭스.md` | SUPER = 모든 역할 · 모든 권한 (문서는 다시 생성 — 그사이 늘어난 화면 6개도 함께 들어감) |
| `VERSION` | v10.51 |

## 4. 지키는 규칙 (권한이 아니라 통제)

1. **2인 원칙** — 같은 정산 건을 확정한 사람은 지급할 수 없고(`fn_payout_two_person`), 퍼블리셔 명세서는 신청자 ≠ 승인자 ≠ 집행자입니다. SUPER 도 자기가 확정 · 승인한 건은 지급하지 못합니다. 다른 사람이 확정한 건은 지급할 수 있습니다.
2. **게이트** — 본인인증 · 유효 구독은 자격입니다. SUPER 도 그대로 적용됩니다(2026-10-01 Q5).
3. **지급 게이트 · 원장 일치 · 이체 참조 필수** — 그대로입니다.
4. **겸직 금지(ADMIN + PAYOUT)** — SUPER 는 이미 예외였습니다(B075 fn_duty).

## 5. 앞으로 새 권한을 만들 때

1. 서버: `@Roles('새역할')` 만 적으면 SUPER 는 자동으로 통과합니다. 화면 코드에서 역할을 볼 때는 `roles.includes('SUPER') ||` 를 앞에 둡니다.
2. 코드 안에서 역할을 직접 볼 때는 `hasRole(p.roles, '역할')` 을 씁니다(`roles.includes` 직접 사용 금지).
3. DB 트리거 · 함수에서 역할을 볼 때는 `fn_has_role(계정, '역할')` 을 씁니다(account_roles 직접 조회 금지).

## 6. 집 PC 확인

1. `.\dev.ps1 realcheck` — 마이그레이션 142 / 142, 통합 검정 실패 0 (SUP-1 ~ SUP-4 포함)
2. 운영 화면에 SUPER 만 가진 계정으로 로그인 → 「지급」 탭에서 다른 사람이 확정한 건에 「지급 기록」 단추가 보이고 눌러짐
3. 같은 계정으로 자기가 「확정」한 건을 지급 → 「확정한 사람이 지급할 수 없습니다 — 2인 원칙」 안내
4. 「감사 기록」에서 방금 한 지급의 역할이 SUPER 로 적힘

## 7. 운영 적용

- 마이그레이션 1개(D104) — 자료를 지우지 않습니다. 함수 1개 더하고 1개 바꿉니다. 재실행 안전.
- 운영이 v10.50 이면 precheck 기대: 올릴 것 1. v10.45 에서 바로 오면 6(D099 ~ D104).
- `.env` 바꿀 것 없음.

## 8. 확인하지 못한 것

- 서버에서 빌드 · tsc 를 돌리지 않았습니다. 집 PC realcheck 로 확인합니다.
- 운영에 SUPER 만 가진 계정이 실제로 있는지는 sgbdev 가 볼 수 없습니다. 대표님 계정의 역할 확인이 필요합니다.

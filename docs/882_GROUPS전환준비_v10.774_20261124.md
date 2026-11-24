# 882. 권한 판정 GROUPS 전환 준비 (v10.774 · 2026-11-24)

> 대표 11/24 「목록 승인」 → 묶음 5 후보 10개 「모두 개발」(v10.774 ~ 783 · D329 · docs/882 ~ 891).

## 1. 바뀐 것

| 위치 | 내용 |
|---|---|
| 직원 · 권한 › 업무별 권한 › 판정 방식 아래 「GROUPS 전환 준비」 | 최근 7일(한국 날짜) COMPARE 다름 수 · 오늘부터 이어진 다름 0 날 수 · 마지막 다름 · 권한그룹 없는 운영 계정(이름 · 가린 이메일 · 50명) · 역할에서 만든 R_ 권한그룹 수 |
| 같은 카드 — GROUPS 일 때 | 「COMPARE 로 되돌리기」 한 번에(SUPER · 사유 2 ~ 200자 · 바뀐 기록은 판정 방식 바꾸기와 같음 · GROUPS 가 아니면 422 PERM_REVERT_NOT_GROUPS) |
| 같은 카드 — 바꾼 뒤 48시간 | 「바꾼 지 n시간 — 첫 이틀은 평소 화면이 열리는지 확인」 띠 |

- **이미 있던 것(v10.564 · 624 · docs/706 · 767)**: 판정 방식 화면 · GROUPS 전 점검표 5줄(연결 안 된 주소 · 24시간 다름 · 역할 이름 막는 곳 · COMPARE 24시간 · 검사 ON) · 되돌리기는 언제든(PUT /admin/perm/mode) — 이번에는 그 옆에 7일 추세 · 권한그룹 없는 사람 · 한 번에 되돌리기만 더함.
- perm.mode 는 바꾸지 않음(대표 결정 · SUPER 가 화면에서).

## 2. 매트릭스

| 구분 | 내용 |
|---|---|
| 화면 | SB-ADM-STF-070 |
| 백엔드 | perm-mode.ts modeReadiness · revertToCompare |
| API | GET /admin/perm/mode/readiness · POST /admin/perm/mode/revert |
| DB | 없음(perm_shadow_log · perm_account_groups 읽기) |
| 연동 | — |

## 3. 시험

- test_v1774 — ① 코드 ③ readiness 칸 · GROUPS 아니면 revert 422 · 회원 403.

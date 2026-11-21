# 706 판정 바꾸기 perm.mode (v10.564 · D291)

## 1. 결론
설정 perm.mode 로 운영 화면 권한 판정을 단계적으로 권한그룹에 넘깁니다 — **ROLE(처음) → COMPARE(하루 이상) → GROUPS**. 회원 역할 검사 · SUPER 전용 API 는 어느 모드에서도 그대로입니다.

## 2. 모드
| 모드 | 판정 | 기록 |
|---|---|---|
| ROLE(처음) | 지금처럼 @Roles 먼저 · 권한그룹은 perm.enforce(OFF · SHADOW · ON)대로 좁히기만 | SHADOW 기록 그대로 |
| COMPARE | @Roles 로 판정(막음 · 통과 그대로) | 권한그룹 판정이 다르면 perm_shadow_log(mode COMPARE · diff ROLE_ONLY = 역할만 엶 / GROUP_ONLY = 권한그룹만 엶) |
| GROUPS | 운영 역할 계정이 운영 역할만 요구하는 API 를 부르면 권한그룹이 정함(역할로 막혀도 권한그룹이 주면 통과 · 역할로 통과해도 권한그룹이 없으면 403 PERM_DENIED) | — |
- 대상 아님(역할 그대로): 회원 역할이 섞인 API · @Roles('SUPER') 만인 API · SUPER(늘 통과) · 표(perm_route_map)에 없는 주소.

## 3. 바꾸기
- 직원 · 권한 › 업무별 권한 위 「판정 방식」 상자 · PUT /admin/perm/mode(SUPER · 사유).
- GROUPS 는 「연결 안 된 /admin 주소 0 · 최근 24시간 다름 0」일 때만 — 아니면 422 PERM_MODE_NOT_READY. 전체 설정 · 직접 DB 로 GROUPS 를 넣으면 트리거 trg_perm_mode_guard 가 막음(app.perm_mode_ok). 되돌리기는 조건 없음.
- 바꾸는 코드는 src/core/auth.ts(AuthGuard 역할 검사 자리) · src/core/perm.guard.ts 두 곳뿐 — 컨트롤러 @Roles 는 그대로.

## 4. 같은 범위 보장
1. 역할을 받으면 붙는 처음 권한그룹(R_역할 · D258)을 그대로 씀.
2. D291 시드가 그 역할이 @Roles 로 열던 주소의 업무 · 수준을 R_역할에 채움(세무사는 회계 GET 을 보기로) · 빠진 /admin 주소를 perm_route_map 에 채움 — 도구 tools/perm_unmapped.py(정적 · c1559 기준 빠짐 153 · R_ 후보 731)로 만듦.
3. 운영 서버 실제 주소는 GET /admin/perm/unmapped-routes(실행 중 데코레이터)로 다시 확인 → 남으면 다음 마이그레이션 시드.

## 5. 적용 순서(대표)
1. 적용 직후 ROLE(아무것도 안 바뀜) → 2. COMPARE 로 하루 이상 · 「다름」 확인(ROLE_ONLY 는 권한그룹에 더하기 · GROUP_ONLY 는 권한그룹에서 빼기 · 조합 규칙) → 3. 연결 안 된 주소 0 · 다름 0 이면 GROUPS → 4. 문제 있으면 COMPARE 로 되돌림.

## 6. 위험
- 업무 단위가 탭이라 같은 탭 · 같은 수준 안에서 역할마다 다르던 API 는 GROUPS 에서 넓어질 수 있음(예: 지급 데스크 EDIT) — DB 겸직 검사(C710)는 남음 · COMPARE 의 GROUP_ONLY 로 확인.
- perm.enforce = ON 인 곳에서 D291 로 새로 이어진 주소는 ROLE 모드에서도 권한그룹 검사를 받음 — 같은 마이그레이션이 R_역할을 채워 막히지 않게 함(운영이 SHADOW 이면 기록만).

## 7. 시험 test_v1564
처음 ROLE · DB 로 GROUPS 막힘 · 다름 있으면 422 · COMPARE 두 방향 기록 · 회원 403 그대로 · (준비됐으면) GROUPS 같은 범위 · PERM_DENIED · SUPER 전용 그대로 · 되돌림.

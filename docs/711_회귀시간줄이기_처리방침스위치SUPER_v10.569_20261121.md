# 711 · 회귀 시험 시간 줄이기 · 처리방침 스위치 SUPER — v10.569 (2026-11-21)

> 10차 운영 기반 ① · ⑤(덤). 대표 11/21 「16개 모두 동시에」 승인. 앞머리 `opb_`(이 판은 표 · 함수 없음).

## 1. 결론

1. 회귀 실행기(`sgb-infra/qa/run_regression.sh` · 메인용 `run_regression_q.sh`)가 시험을 **세 단계**로 돌립니다 — ① 서버(HOST) 시험 하나씩(예전 그대로) ② 「혼자」 시험 하나씩 ③ 나머지를 **동시 3개**(`PAR`).
2. 「혼자」 판정은 `qa/reg_classify.py` 가 시험 글을 읽어 정하고, 판마다 목록 `<로그>.d/_plan.tsv` 를 남깁니다. 결과 줄 모양 · 「결과」 줄 없음 = 멈춤 판정 · `reg_tally.py` 는 **그대로**입니다.
3. 걸린 시간은 로그 끝 「걸린 시간 N분」 + 단계별 한 줄, 시험마다 `_times.tsv`, 돌 때마다 `~/reg_times.tsv` 한 줄로 남기고, 마지막 「하나씩(PAR=1)」 실행과 비교 한 줄을 붙입니다.
4. ⑤ 처리방침 1.2(docs/699 4절)에 걸린 스위치는 **정책 › 전체 설정**(`PATCH /admin/site-settings`)에서도 **켜기 · 바꾸기는 SUPER 만**(403 `PRIVACY_SWITCH_SUPER`). 끄기(`off`) · 간주(`ASSUME`) · 빈 값은 ADMIN 도 바로.

## 2. 실행기 쓰는 법

| 명령 | 뜻 |
|---|---|
| `bash ~/sogaebank/sgb-infra/qa/run_regression.sh ~/reg.log 470` | 기본 — 동시 3개 · 화면 시험은 혼자 |
| `PAR=1 bash … ~/reg_serial.log` | 예전처럼 하나씩(이름 순) — **처음 한 번은 이것으로 돌려 비교 기준을 남길 것** |
| `PAR=4 bash …` | 동시 4개(점검판 t3.large · 메모리 확인 뒤) |
| `UI_LANE=1 bash …` | 화면 시험도 「ui」 잠금 한 줄로 동시(시험해 보는 옵션 · 처음 끔) |
| `QDIR=<시험 폴더> bash $S/run_regression_q.sh …` | 메인용 — 도구(reg_classify · reg_pool)는 QDIR 에 없으면 `REG_TOOLS`(처음 `~/sogaebank/sgb-infra/qa`) · 둘 다 없으면 하나씩 |

로그 모양(예전과 같음 · 동시 실행분은 끝난 뒤 **이름 순서로** 붙음):
```
test_v1558.py | 결과: 6 / 6
test_v1559.py | 결과: 9 / 10
    FAIL ② … — …
회귀 판정 — 전체 457 · SOLO 110 · UI 251 · LOCK 38 · PAR 58 · 까닭별 …
걸린 시간 58분
  단계 — 서버(HOST) 9분 · 혼자 41분(361개) · 동시 8분(96개 · 동시 3개)
  비교 — 마지막 하나씩(PAR=1) 92분(457개) → 이번 58분(457개)
```
(숫자는 예시 — 실제 시간은 첫 비교 실행 뒤 대표 보고에 적음.)

## 3. 「혼자」 판정 규칙 (reg_classify.py)

시험 파일을 파이썬 구문(ast)으로 읽습니다. 공통 머리(test_v1558 docstring 다음 ~ `migr` 끝)의 **정의 본문은 빼고**(모든 시험에 `setting()` 정의 · `sync_playwright` 가 들어 있음) **부르는 곳만** 셉니다. DB 규칙은 `psql()` 에 넘기는 글에만, API 규칙은 `call()` 의 방법 · 주소에만 걸어 **코드 검사 줄**(`'ALTER TABLE' in M`)은 세지 않습니다.

| 까닭 | 걸리는 것 | 방식 |
|---|---|---|
| SET | `setting(` · `setv(` · `sv(` · site_settings · setting_schedules 쓰기 · PUT/PATCH/POST `…settings` 주소 | 설정 키를 찾으면 **LOCK**(잠금 `set:키 앞마디`) · 못 찾으면 SOLO |
| JOB | POST `/admin/jobs` · member-notice-jobs · `run_job(` · `SELECT fn_…(daily·hourly·build·close·watch·purge·run·digest)` | **LOCK**(잠금 `job` 하나 — 정기 작업 시험은 한 번에 하나) |
| SHARED | 시험 회원(admin · buyer · seller · intro · person · ops · payout …)의 계정 · 역할 · 동의 · 세션 · 2단계 · 권한 바꾸기 · 모든 기기 로그아웃 · 비밀번호 · 약관 넣기 · 게시 | SOLO |
| GLOBAL | TRUNCATE · ALTER TABLE · DROP · CREATE OR REPLACE · DISABLE TRIGGER | SOLO |
| THROTTLE | 틀린 비밀번호 로그인 · TOO_MANY_ATTEMPTS · LOGIN_LOCKED | SOLO |
| ALERT | 운영 알림 대기 목록(`fn_ops_alert_*pending` · push/slack 미리보기 · 50건) | SOLO |
| DOCKER | docker · npm 을 부름 | SOLO |
| UI | `admin_page(` · `ui(` · `site_login(` · `sync_playwright` | **UI**(처음 SOLO 처럼 하나씩 · 대표 메모 11/18 test_v1173 「회귀 중 무거운 일 금지」) |
| PARSE | 구문을 못 읽음 | SOLO |

- 설정 키는 kit `sgb/prisma/migrations` 에서 site_settings 에 넣는 키 목록과 시험 글자를 맞춰 찾습니다.
- 손 목록: `qa/reg_solo_force.txt`(늘 혼자) · `qa/reg_par_ok.txt`(규칙에 걸려도 동시 — PAR=3 로 두 번 통과 확인 뒤만). 한 줄 한 파일 · `#` 주석.
- 11/21 기준(v10.560 시험 453개) 판정: **SOLO 110 · UI 251 · LOCK 36 · PAR 56** — 지금 목록 `qa/reg_plan.tsv`(참고 사본 · 실행기는 돌 때마다 다시 만듦).

## 4. 동시 실행(reg_pool.py)

- `docker run … sgb-qa:v1 timeout 1800 python3 <시험>` — 예전 `one()` 과 같은 명령 · 시험마다 `<로그>.d/<시험>.log`.
- 잠금 이름이 겹치는 시험끼리는 같이 돌지 않음 · 지난 시간(`~/reg_last_times.tsv`)이 있으면 오래 걸린 시험부터.
- 진행은 표준 오류에 「(동시 n/m) 시험 초」 — 로그 파일에는 넣지 않음.

## 5. ⑤ 처리방침 스위치 SUPER

| 무리 | 키 |
|---|---|
| 앞마디 전체 | `sfx.*`(기기 표지 · 번역 메모리 · 보관 기간) · `push.*`(웹 푸시) · `social.*`(간편 로그인) |
| 표에 적힌 키 | `mall.review_points` · `csx.account_merge` · `csx.churn` · `csx.ai_draft` · `csx.ai_draft_auto` · `security.geo_watch` · `security.geo_mode` · `security.geo_block` · `campaign.enabled` · `campaign.send_mode` · `mbx.recent` · `mbx.compare` · `mbx.price_alert` · `mbx.dm` · `lsy.video` · `lsy.photo_ai` · `lsy.report_ai` · `plaza.ranking` · `opx.archive` · `opx.risk_score` · `lsx.saved_search` · `lsx.ai_summary` · `papi.enabled` · `papi.hook_enabled` · `pbulk.invite_mail` · `vsx.enabled` · `vsx.gwans` · `lpx.offer` · `lpx.offer_gwans` · `lpx.away` |
| 원래 따로 막던 것(그대로) | `site.usage_stats` · `mall.cash_receipt*`(MLX_SETTING_SUPER) · `agent.*`(AI_SETTING_SUPER) |

- ADMIN 이 켜거나 바꾸면 403 `PRIVACY_SWITCH_SUPER` · `off` · `ASSUME` · 빈 값은 ADMIN 도 됨(개인정보를 덜 모으는 쪽).
- 설정 예약 변경(D241)은 예약한 사람이 SUPER 여야 하므로 영향 없음.
- docs/699 4절 「켜는 사람」 칸 중 「전체 설정 ADMIN · SUPER」라고 적힌 줄(웹 푸시 · 기기 표지 · 번역 메모리 · 리뷰 적립 · 랭킹 · 기록 장기 보관 · 이상 거래 점수)은 **이 판부터 SUPER**(문서 699 는 다른 사람이 고치는 중이라 손대지 않음 — 메인이 합칠 때 한 줄 고칠 것).

## 6. 매트릭스

| 목록 | 내용 |
|---|---|
| 화면 | 없음(운영 화면 변경 없음 — 전체 설정에서 ADMIN 이 켜면 서버 403 글이 뜸) |
| 백엔드 | `admin.service.ts` `updateSetting` · `isPrivacySwitch` · `PRIVACY_SWITCH_KEYS` |
| API | `PATCH /admin/site-settings`(403 `PRIVACY_SWITCH_SUPER` 더함) |
| DB | 없음 |
| 연동 | 없음 · infra `qa/run_regression.sh` · `run_regression_q.sh` · `qa/reg_classify.py` · `qa/reg_pool.py` · `qa/reg_solo_force.txt` · `qa/reg_par_ok.txt` · `qa/reg_plan.tsv` |

## 7. 시험 test_v1569

① 코드(⑤ 검사 · 실행기 · 가짜 시험 여섯으로 판정 규칙 · 지금 시험 모두 판정 · 동시 결과 줄이 reg_tally 판정과 맞음) ② API(ADMIN 켜기 403 · 끄기 됨 · 상관없는 설정 그대로 · SUPER 됨). 두 번 돌아도 통과.

## 8. 주의 · 확인할 것

1. **처음 동시 실행은 PAR=1 실행과 한 번씩** 돌려 실패 수가 같은지 볼 것. 동시에서만 실패하는 시험은 `reg_solo_force.txt` 에 넣고 보고.
2. 시험 순서가 바뀜(혼자 → 동시) — 앞 시험이 남긴 데이터에 기대던 시험이 있으면 드러남(그 시험을 고치는 것이 맞음).
3. 화면 시험이 251개라 기본(UI 혼자)에서는 줄어드는 시간이 크지 않을 수 있음 — `UI_LANE=1` 은 두 번 통과 확인 뒤 대표 결정.
4. 점검판 API 요청 한도(abuse.api_per_ip_min)는 내부 IP 를 세지 않아 동시 실행에 걸리지 않음(src/common/api-rate-limit.ts).

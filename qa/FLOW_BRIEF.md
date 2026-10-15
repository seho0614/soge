# flow 점검 도구 작성 안내 (공통)

소개뱅크(SGB) v10.25 의 **주요 업무 흐름이 처음부터 끝까지 이어지는지** 확인하는 시험 도구를 만듭니다.
결과는 비개발자인 사업 담당자가 읽는 엑셀 표(「flow 점검」 시트)에 그대로 들어갑니다. 단계 이름은 **쉬운 우리말**로, 무엇을 눌렀고 무엇을 확인했는지 적습니다.

## 환경 (이미 떠 있음 — 다시 띄우거나 끄지 마십시오)

| 무엇 | 주소 | 비고 |
|---|---|---|
| API (NestJS · 운영 방식 dist) | http://localhost:3000/api/v1 | `/docs` 없음 · 정의에 없는 입력은 400 |
| 사용자 웹 (Next.js 15 · next start) | http://localhost:5174 | 브라우저는 `/api/v1/*` 를 같은 출처로 부름 · 로그인 · 가입은 서버 액션 |
| 운영 화면 BO (Vite) | http://127.0.0.1:5173 | 탭 `.bo-head nav button` · 본문 `.bo-main` · 하위 탭 `.bo-main .subtabs button` |
| DB (PostgreSQL 16) | postgresql://sgb:sgb@localhost:5432/sgb | `psql` 로 직접 조회 |
| 제품 소스 | /home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb | `src/`(API) · `site/src/`(사용자 웹) · `web/src/`(BO) · `spec/proto.html`(시안) — **읽기만** |
| 시험 폴더 | /home/claude/qa | 여기에만 씁니다 |

계정: `admin@x.com`(운영 SUPER) · `buyer@x.com`(개인 구매자) · `person@x.com`(사업자 회원) · `intro@x.com`(소개자 · 구독 중) — 비밀번호 `sgb-dev-1234`.
운영 시험 계정 `ops@t.local` · `reviewer@t.local` · `payout@t.local` · `member@t.local` — 비밀번호 `sgb-test-1234`.
개발 환경이라 외부 연동은 모두 시험(스텁) · 간주 모드입니다(결제는 「시험 결제」, 본인인증은 stub, 상담 신청의 인증번호는 응답에 실려 옵니다).

## 반드시 지킬 것

1. **제품 코드를 고치지 않습니다**(`/home/claude/pkg` 아래 아무것도). 서버 · 사용자 웹 · 운영 화면을 다시 띄우지 않습니다. `npm` 빌드도 하지 않습니다.
2. 단계가 제품 동작 때문에 실패하면 **기대값을 낮추거나 돌아가지 말고 실패로 남기고**, 원인(재현 방법 · 응답 · 소스 위치)을 보고하십시오. 시험 쪽 착오(고르는 말이 틀림 · 기다림 부족)는 시험을 고칩니다. 둘을 구분해 보고하십시오.
3. 공용 개발 DB 입니다. 다른 시험이 **동시에** 돌고 있습니다(주문 · 글 · 설정을 만들고 지움). 「가장 최근 행」 같은 가정 대신 **내가 만든 것의 id · 고유 표식(tag)** 으로 찾으십시오.
4. 만든 자료는 끝에 치웁니다 — 주문은 취소(`POST /me/health/returns {orderNo, kind:'CANCEL', reason:'CHANGE_MIND'}` → `POST /admin/health/returns/{id}/decide {state:'APPROVED'}`)해 재고를 되돌리고, 글은 삭제, 바꾼 운영 설정은 처음 값으로. 재고 · 설정은 처음 값과 같은지 마지막 단계로 확인합니다. 새로 만든 계정(`flw_*@t.local`)은 남겨도 됩니다.
5. 기존 계정(`buyer@x.com` 등)의 비밀번호 · 이름 · 탈퇴 상태를 바꾸지 않습니다. 탈퇴 · 정지 같은 흐름은 **새로 만든 계정**으로만.
6. 실제 외부 주소로 요청을 보내지 않습니다.
7. 사과 · 유감 표현을 쓰지 않습니다(보고서 · 주석 · 단계 이름 모두). 모르는 것은 「확인하지 못함」이라고 적습니다.

## 만드는 방식

- 공용 도구 `/home/claude/qa/flow_lib.py` 를 씁니다(먼저 읽으십시오): `Flow(name, who)` · `.step(step, how, ok, detail, skip=False)` · `finish(name)` · `call` · `login` · `signup` · `rows` · `q` · `sql` · `site_login(ctx, email)` · `goto` · `text` · `watch` · `bo_login(ctx, email)` · `bo_tab(pg, 탭, 하위, 둘째 하위)`.
- `how` 는 그 단계를 **무엇으로 했는지**: `화면`(사용자 웹에서 실제로 채우고 누름) · `운영 화면`(BO 에서 실제로 누름) · `API` · `DB`(psql 로 확인) · `시안`.
- **화면으로 할 수 있는 단계는 화면으로** 합니다(Playwright sync · chromium · headless). 화면에 그 단추가 없거나 자동으로 누르기 어려운 단계만 API 로 하고, 단계 이름에 그 사실을 적습니다. 상태를 바꾼 단계 바로 뒤에는 `DB` 단계로 그 행을 확인합니다.
- 한 흐름은 **앞 단계의 결과를 다음 단계가 이어받아** 끝까지 갑니다(중간에 따로 준비한 자료로 갈아타지 않음). 중간 단계가 실패해 더 갈 수 없으면 남은 단계는 `skip=True` 와 까닭을 적어 남깁니다(단계를 지우지 않음).
- 각 화면 단계에서 쪽 오류(pageerror)와 실패한 API 응답(4xx · 5xx · 의도한 것 제외)이 없는지도 봅니다(`watch`).
- 고르는 말(selector) · 화면 구조는 기존 화면 시험에 많이 있습니다. 필요한 것만 골라 읽으십시오: `site_mall.py` · `srv_hlt_ui.py` · `srv_pay_ui.py` · `srv_retship.py`(소개몰) / `srv_fin_ui.py` · `srv_consult_ui.py` · `srv_lead_ui.py`(상담 · 리드) / `srv_cmu_ui.py` · `srv_poll_ui.py`(소개광장 · 투표) / `srv_billing_ui.py` · `srv_refcode_ui.py` · `srv_aff_ui.py` · `srv_ptn_ui.py`(구독 · 소개코드 · 제휴 · 파트너) / `site_detail.py` · `e2e.py`(매물 · 거래 · API 흐름) / `crawl_admin_final.py` · `btn_bo.py`(운영 화면 탭 구조). API 목록은 `…/sgb/docs/matrix/matrix.json` 의 `apis`(method · path · roles · tables).
- 실행: `cd /home/claude/qa && python3 flow_<이름>.py` — 마지막 줄이 `통과 n / m · 흐름 k개`. 결과 파일 `flow_<이름>.json`.
- 느립니다(CPU 2개 · 다른 시험과 같이 돎). 기다림은 넉넉히, 한 번 실행이 10분을 넘으면 `setsid nohup … &` 로 뒤에서 돌리고 로그를 보십시오.
- 다 만든 뒤 **처음부터 끝까지 두 번** 돌려 두 번 모두 같은 결과인지 확인하십시오(두 번째에 깨지면 뒷정리가 모자란 것).

## 마지막 보고에 꼭 넣을 것

1. 흐름별 단계 수 · 통과/실패/건너뜀 (두 번 실행 결과).
2. 실패 · 건너뜀 단계마다: 제품 문제인지 시험 한계인지, 근거(응답 · 소스 파일:줄).
3. 화면으로 하지 못하고 API 로 한 단계와 그 까닭.
4. 흐름을 따라가다 눈에 띈 것(막다른 화면 · 다음 단계로 가는 단추가 없음 · 안내 글과 실제가 다름 등) — 확인한 사실만.
5. 남긴 자료(계정 등)와 되돌린 것.

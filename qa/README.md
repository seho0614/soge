# 로컬 검정 도구 (qa/)

2026-09-30 통합 검정에 쓴 도구입니다. **스택을 띄운 뒤** 이 폴더에서 돌립니다.

```bash
pip install playwright && playwright install chromium   # 최초 1회
export DATABASE_URL=postgresql://sgb:sgb@localhost:5432/sgb   # Docker 는 기본값 그대로
python3 e2e.py            # 기능 검증 — 가입·사업자·매물·검수·문의·거래·파트너·운영 34단계
python3 api_smoke.py      # 모든 GET API 를 역할별로 호출 — 5xx 찾기
python3 shape.py          # 화면이 기대하는 응답 모양(배열/객체) ↔ 실제
python3 body_check.py     # 화면이 보내는 본문 키 ↔ 서버 DTO (정적)
python3 forms.py          # 사용자 웹 폼 실제 제출 12종
python3 crawl_site.py     # 사용자 웹 79경로 × 5역할 + 링크 상호 확인
python3 crawl_admin.py    # 운영 BO 30탭 × 역할
python3 decisions.py       # 10/1 운영 결정 5건 (API · DB)
python3 decisions_ui.py    # 10/1 운영 결정 5건 (BO 지급 탭 · 사용자 웹)
python3 sweep_proto.py    # 시안 174화면 모든 버튼 (오래 걸림 · 약 1시간)
python3 sweep_hlt.py      # 시안 건강몰 21화면
```

결과는 `out/*.json` 에 쌓입니다. 주소는 환경 변수 `API` · `SITE` · `BO` 로 바꿀 수 있습니다.

★ `e2e.py` · `forms.py` 는 **개발 DB 에 데이터를 만듭니다**(E2E 로 시작하는 제목). 운영 DB 에 돌리지 마십시오.


## 10/2 추가

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_aff.py` · `srv_aff_ui.py` | 제휴 링크 클릭 · 정산 계좌 1원 재인증 | `API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 python3 …` |
| `srv_hlt.py` · `srv_hlt_ui.py` | 몰 재고 복원 · 청약철회 · 배송지 · 성분/고민 | 위와 같음 |
| `srv_ptn.py` · `srv_ptn_ui.py` | 파트너 운영 목록 · 입점 반려 · 중개사 심사 | `API=http://localhost:3000` (뒤에 /api/v1 없어도 됨) |
| `fixes_1002.py` | 10/2 백엔드 수정 13건 | 위와 같음 |
| `sweep_proto.py` · `sweep_hlt_after.py` | 시안 전 버튼 누르기 (본체 · 몰) | 경로를 파일 안 `P=` 에 맞추십시오 |
| `crawl_admin_final.py` | BO 탭 + 하위 탭 순회 | vite 5173 |

★ 불변식·공격 검정은 **검정 전용 DB(sgb_check)** 에서만 도십시오 — 개발 DB 에서는 멈춥니다.

## 10/2 v10.8 추가

| 파일 | 무엇 | 실행 |
|---|---|---|
| `adapters_up.sh` · `adapters_down.sh` | 외부 연동 시험용 API 3개(3121 토스 · 3122 S3 · 3123 1원 인증·중개사·국세청) + 가짜 서버(`srv_lead_mock.py` 13023) 띄우기 · 끄기 | `bash adapters_up.sh` |
| `srv_pay.py` · `srv_pay_ui.py` | 결제 · 환불 · 개봉 반품 (API · 화면) | `API_TOSS=http://localhost:3121/api/v1 python3 srv_pay.py` · 결제창 경로까지: `SITE_KEY=<NEXT_PUBLIC_TOSS_CLIENT_KEY 로 빌드한 사이트>` |
| `srv_file.py` · `srv_file_ui.py` | 파일 올리기 (API · 가짜 S3 SigV4 · 화면) | `API_S3=http://localhost:3122/api/v1 KIT=<sgb 경로> python3 srv_file.py` |
| `srv_lead.py` · `srv_lead_ui.py` | 리드 배정 · 어댑터 3종 · 상담 신청 화면 | `API=http://localhost:3000 ADP=http://localhost:3123 KIT=<sgb 경로> CHECK_DB=…/sgb_check python3 srv_lead.py` |
| `web_main.py` · `web_mal.py` | 실제 웹의 새 메인 · 안심소개 상담 축 (링크 전수 · 390px · 실제 제출) | `SITE=http://localhost:5174 API=http://localhost:3000/api/v1 python3 …` |
| `csrf_check.py` | 사용자 웹 같은 출처(CSRF) 판정 7항목 | 같음 |
| `final_all.sh` · `final_post.sh` | 전수 검정 묶음 | `bash final_all.sh` |

★ `web_mal.py` 는 실행마다 새 회원을 만들어 상담 신청 1건을 실제로 넣습니다(하루 5건 한도 회피).

## 10/2 v10.9 추가

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_retship.py` | 반품 왕복 배송비 차감 — API · 반품 신청 화면 · 내역 · BO 미리 보기/승인 | `API=… SITE=… BO=… python3 srv_retship.py` |
| `srv_refcode.py` · `srv_refcode_ui.py` | 일반 회원 소개코드 · 결제 후 추가분 · `?ref=` 유입 기록 · 거래 소개자 | `API=http://localhost:3000 SITE=http://localhost:5174 python3 …` |

★ `srv_refcode*.py` 는 실행마다 새 회원을 만들고 시험 코드는 끝에 지웁니다. `srv_retship.py` 는 buyer@x.com 으로 시험 주문을 만들고 반품 승인까지 닫습니다.

## 10/2 v10.10 추가

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_viewlimit.py` | 요청 열람 한도 스위치 · 홍보 기간 종료일 · 무료/일반 공통 건수 · BO 설정 · 소개코드 범위 전환 | `API=… SITE=… BO=… python3 srv_viewlimit.py` |
| `srv_refcode.py` · `srv_refcode_ui.py` | (갱신) 소개코드 매물별 · 유료 요금제 추가 코드 결제 · 매물별 귀속 · 재로그인 귀속 | 같음 |

★ `srv_viewlimit.py` 와 `srv_refcode.py` 는 공용 운영 설정(`request.view.*` · `refcode.scope`)을 잠깐 바꿨다가 끝에 되돌립니다. 다른 시험과 동시에 돌리지 마십시오.

## 10/2 v10.11 추가 — 올린 kit(v10.4.7) 안심소개 변경분

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_lead.py` · `srv_lead_ui.py` | (갱신) 상담 신청이 「로그인 없이 → 휴대폰 확인 → 인증업체 1곳」으로 바뀐 데 맞춤 · 상담 축 입점 승인 조건 · 열람 시 자격 재확인 | 전과 같음 |
| `srv_consult.py` | 업종 22종 · 축별 입점(신청 · 심사) · 법률 · 세무 월 정액 노출(신청 · 자격 · 입금 확인 · 종료) — API · DB | `API=http://localhost:3000 python3 srv_consult.py` |
| `srv_consult_ui.py` | 위 흐름을 화면으로 — `/partner/apply` · `/partner/listings` · BO 「안심소개 입점 심사」 · 「법률·세무 정액 노출」 · `/mal/consult/CSL_LEGAL` | `API=… SITE=… BO=… python3 srv_consult_ui.py` |
| `web_mal.py` | (갱신) 업종 22줄 · `/mal/consult` · `/mal/consult/{code}` · 인증번호 확인까지 실제 제출 1건 | 전과 같음 |
| `proto_consult.py` | 시안 v10.11 상담 축 시연 — 22종 · 신청 → 인증 → 접수 · 법률 · 세무 사무소 보기 | `python3 proto_consult.py` (파일로 엽니다) |
| `final_v1011p.sh` | 수정 반영 뒤 재검정 묶음 | `bash final_v1011p.sh` |

★ 상담 신청 시험은 **개발 환경(NODE_ENV=development)** 에서만 됩니다 — 알림톡 연동 전이라 인증번호를 응답(`devCode`)으로 받습니다. 운영 설정에서는 신청 자체가 422 `NOTIFY_NOT_READY` 입니다.
★ `web_mal.py` 의 제출 시험은 시드 인증업체(intro@x.com — 청소 · 서울 금천구)가 있어야 전달됩니다. 끝나면 그 신청을 운영 API 로 종료해 정리합니다.
★ `npm run test:consult`(sgb/scripts/test-consult-flow.js)는 올린 kit 의 흐름 시험입니다 — **검정 전용 DB(sgb_check)** 로 띄운 API 에 돌립니다.

## 10/2 v10.12 추가 — 법률 · 세무 월 노출료 기준 금액 (D020)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_consult.py` | (갱신) F 절 — 기준 금액 설정 · 형식 · 권한 · 금액 비우고 켜기 · 변경 뒤 기존 건 유지 (18항목) / G 절 — 보관 기간 6개월 · 90일 별도 유지 (3항목) | 전과 같음 |
| `srv_consult_ui.py` | (갱신) BO 「월 노출료 기준 금액」 상자 등록 · 변경, 금액 칸 안내, 업체 화면 안내 (9항목). `DB=` 로 접속 주소를 바꿀 수 있습니다 | 전과 같음 |
| `proto_consult.py` | (갱신) 시안 v10.12 — 기준 금액 상자 · 저장 · 켜기 · 업체 안내 (P-14 ~ P-20) | 전과 같음 |
| `srv_hlt.py` | (교체) 킷에 들어 있던 사본이 v10.8 이전 판이라 47/50 이었습니다 — 통과하는 판으로 바꿨습니다 | 전과 같음 |
| `final_all.sh` | (갱신) 끝에 `proto_consult.py` 를 함께 돌립니다 | `bash final_all.sh` |

★ `srv_consult.py` F 절과 `srv_consult_ui.py` 는 공용 설정 `directory.monthly_fee` 를 잠깐 바꿨다가 **300000 으로 되돌립니다**. 다른 시험과 동시에 돌리지 마십시오.
★ 검정 전용 DB(sgb_check)를 하루에 25회 넘게 다시 쓰면 공격 검정 BS-05 · CR-03 이 뜹니다(시스템 자동 승인 감사 기록이 24시간 50건을 넘김). 검정 DB 를 새로 만들면 사라집니다 — `.\dev.ps1 wipe` 뒤 `.\dev.ps1 up`, 또는 `DROP DATABASE sgb_check; CREATE DATABASE sgb_check;`.

## 10/2 v10.13 추가 — 메인 「hero 페이지」 디자인

| 파일 | 무엇 | 실행 |
|---|---|---|
| `fixtures.py` | **시험 준비 자료** — DB 를 새로 만든 뒤 한 번. 건강몰 고민–성분 · 상품–성분 연결, buyer 배송지, 제휴 상품 3건 · 소개링크, 안심소개 매물(brk_*) 5건. 여러 번 돌려도 같습니다 | `API=http://localhost:3000/api/v1 python3 fixtures.py` (`DB=` 로 접속 주소 변경) |
| `web_main.py` | (다시 씀) 새 메인 — 메인 전용 헤더 · 푸터, 구역 순서, 그림의 문구, 그림이 전부 `/home/d/`(자른 PNG), 검색 탭 · 칩 · 안내 카드 · PICK 화살표, 광고 노출 · 클릭 기록, 링크 전수, 390px. 내용 모드(`.home[data-content]`)를 보고 예시/실제 자료 점검을 고릅니다 | `SITE=http://localhost:5174 python3 web_main.py` · live 인스턴스는 `SITE=http://localhost:5176` |
| `hyd_home.py` | 메인을 역할별로 여러 번 새로 열어 수화 오류(React #418)가 한 번도 없는지. 드물게(3 ~ 13%) 나던 오류라 한두 번으로는 안 보입니다 | `SITE=… LIVE=… python3 hyd_home.py` |
| `measure_home.py` | 1280px 에서 메인의 28곳(제목 · 카드 · 사진)이 주신 그림과 같은 자리 · 같은 높이인지(±12px). 예시 내용(기본) 화면에만 해당 | `SITE=http://localhost:5174 python3 measure_home.py` |
| `proto_main.py` | 시안 새 메인 — 구성 · 동작 · 누르는 것 전부 · **다른 화면은 v10.12 시안과 같은지 비교**(메인 두 장만 달라야 함) · 390px | `python3 proto_main.py` (`BASE=` 비교 기준 시안) |
| `crop_design.py` | 주신 그림에서 사진 · 아이콘 · 로고를 **자르기만** 합니다(색 · 크기 손대지 않음) → `site/public/home/d/*.png` 58장 + `crop_manifest.json` | `python3 crop_design.py` |
| `gen_home_art.py` | 실제 자료 모드(live)에서 쓰는 업종 그림 10장(`site/public/home/t-*.svg`) | `python3 gen_home_art.py` |
| `apply_proto_main.py` · `proto_main_src.js` | 시안(spec/proto.html)에 새 메인을 넣습니다 — 실제 웹과 같은 CSS(home.css) · 같은 그림(파일 안에 넣음). 여러 번 돌려도 같습니다 | `python3 apply_proto_main.py` |
| `build_proto_report.py` | 시안 전수 누르기 결과 → `proto_report_1002.json` | `python3 build_proto_report.py` |
| `final_all.sh` | (갱신) 맨 앞에 `fixtures.py`, 메인 점검 뒤 `hyd_home.py`, 끝에 `proto_main.py` · 시안 보고 | `bash final_all.sh` |

★ `web_main.py` · `hyd_home.py` 는 **운영 빌드**(`next build` + `next start`)에 돌려야 수화 오류를 잡습니다. 개발 모드(`next dev` · Docker 기본)에서는 그 오류가 나지 않습니다.
★ 실제 자료 모드 인스턴스는 `HOME_CONTENT=live npx next start -p 5176` 으로 하나 더 띄웁니다(같은 빌드 · 환경 변수만 다름).
★ `sweep_proto.py` 의 화면당 누르기 한도를 80 → 200 으로 올렸습니다(새 메인은 누를 것이 101개).


## 10/2 v10.14 추가 — 「이건 어때?」 투표 · 사회관계망 주소 · 시안 「지급 데스크」 · 「리드 배정」

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_poll.py` | 투표 · 사회관계망 주소(D021) — API · DB 67항목. 공개 조회 · 운영 권한 · 보기 수 규칙 · 비로그인/회원 투표 · 1인 1표 · 하루 한도 · 비로그인 끄기 · 마감 · 잠금(POLL_LOCKED · POLL_VOTE_FIXED) · 감추기 사유 · 메인 노출 · 주소 형식 | `API=http://localhost:3000 python3 srv_poll.py` |
| `srv_poll_ui.py` | 같은 것을 실제 브라우저로 — 메인 카드 · `/community/polls` · 운영 「이건 어때? 투표」 · 「법정 고지」의 사회관계망 주소 → 메인 푸터 48항목 | `API=… SITE=http://localhost:5174 BO=http://127.0.0.1:5173 python3 srv_poll_ui.py` |
| `proto_poll.py` | 시안 v10.14 — 새 화면 4장(cmupoll · admpoll · admpay · admlasg) · 투표 · 사회관계망 · 지급 데스크 · 리드 배정 동작 · 새 화면에서 누르는 것 전부 · **v10.13 시안과 화면마다 비교**(15장만 달라야 함) · 390px 106항목 | `python3 proto_poll.py` (`BASE=` 비교 기준 시안) |
| `apply_proto_v1014.py` · `proto_px_src.js` | 시안(spec/proto.html)에 모듈 M_poll 과 기존 화면의 갈래 6줄을 넣습니다. `apply_proto_main.py` 다음에 돌립니다. 여러 번 돌려도 같습니다 | `python3 apply_proto_main.py && python3 apply_proto_v1014.py` |
| `web_main.py` | (갱신) 「이건 어때?」 3장 = 서버의 투표 · 참여 수 = 실제 표 수 · 사회관계망 아이콘 = 설정 값 | 전과 같음 |
| `proto_main.py` | (갱신) 참여 수 0명에서 시작. 「다른 화면은 그대로」 비교는 `proto_poll.py` 로 옮김 | 전과 같음 |
| `fixtures.py` | (갱신) 5번 — 메인에 나가는 투표 3건(없으면 `scripts/seed-polls.sql` 로 넣음) | 전과 같음 |
| `final_all.sh` | (갱신) `srv_poll.py` · `srv_poll_ui.py` · `proto_poll.py` 추가 | `bash final_all.sh` |

★ `srv_poll.py` · `srv_poll_ui.py` 는 공용 설정 `poll.guest_vote` · `poll.guest_ip_daily_limit` · `sns.*` 를 잠깐 바꿨다가 **처음 값으로 되돌립니다**. 다른 시험과 동시에 돌리지 마십시오.
★ 넣은 표는 지울 수 없습니다(규칙). 그래서 두 시험은 **시험용 투표를 새로 만들어** 쓰고, 끝에 「감춤」으로 돌립니다 — 원래 있던 투표의 표 수는 건드리지 않습니다. 여러 번 돌리면 감춘 시험 투표가 쌓입니다(사용자 화면에는 안 보임).
★ 서버는 이름에 `headless` · `bot` · `curl` 이 들어간 프로그램의 표를 받지 않습니다(POLL_BOT). 화면 시험은 보통 브라우저 이름(User-Agent)으로 엽니다 — `srv_poll_ui.py` 머리말.
★ 사회관계망 주소는 저장한 뒤 1분쯤 지나 메인에 반영됩니다. `srv_poll_ui.py` E-5 는 반영될 때까지 다시 엽니다(최대 80초쯤).

## 10/3 v10.15 추가 — 투표 질문 확정 · 진짜 기반 이미지 확인 절차

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_poll.py` | (갱신) G 절 5항목 — 시드 `scripts/seed-polls.sql` 의 네 경우(빈 DB · v10.14 예시 문구 투표가 표 없이/표 있이 남은 DB · 운영이 만든 투표만 있는 DB)를 검정 전용 DB 에서 되돌리기(ROLLBACK)로 확인. 72항목 | `API=… python3 srv_poll.py` (`CHECK_DB=` 검정 DB 주소 — 기본은 DB 주소의 이름만 sgb_check 로 바꾼 것) |
| `proto_poll.py` | (갱신) 확정한 질문 · H-3 앞 판(v10.14)과 화면마다 비교(투표가 보이는 4장만 달라야 함). 107항목 | `python3 proto_poll.py` (`BASE2=` v10.14 시안) |
| `../docker/realcheck.ps1` · `realcheck.sh` | 진짜 기반 이미지 확인 — 받기 → 공식 이미지 표지 → 빌드 → 기동 → 마이그레이션 · 버전 → 통합 검정 → 주소 6곳 · 투표 3건. 결과 `realcheck_날짜_시각.txt` | `.\dev.ps1 realcheck` · `./dev.sh realcheck` (`fresh` — 새 볼륨) |

★ `realcheck` 는 킷 작업 환경(Docker Hub 차단)에서 받기를 건너뛰는 값 `REALCHECK_SKIP_PULL=1` 로만 돌려 보았습니다 — 그 환경에서는 3번 「공식 이미지 표지 없음」 2건이 나오는 것이 바른 판정입니다(대체 이미지).
★ `srv_poll.py` G 절은 검정 전용 DB 의 투표 표를 잠깐 비웠다가 되돌립니다(한 트랜잭션 · ROLLBACK). 개발 DB 는 건드리지 않습니다.

## 10/3 v10.16 추가 — 로컬 점검 → AWS 적용 절차 (운영 방식 리허설)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `aws_rehearsal.sh` | **운영 방식 리허설** — 「2026-09-30 에 세운 서버」를 이 PC 안에 흉내 내고(가짜 홈 권한 750 · 9/30 킷 · 마이그레이션 43 · pm2 로 API 만 · 옛 Nginx), 새 킷의 `sgb/deploy/aws` 스크립트로 실제처럼 올립니다. precheck → apply → Nginx 교체(예시 설정 · 자체 서명 https) → 사무실 밖 접속 차단 · 인증서 확인 길 → postcheck → 화면 · 기능 → `.env` 반영 · 재부팅 흉내 · 되돌리기 · 다시 앞으로 · 한 번 더 적용 · 개발용 값 차단 · (대조) 덧붙이기 방식의 한도 우회. 25항목 | `bash aws_rehearsal.sh` (`KITZIP=` 포장한 zip 을 주면 그 파일을 풀어서 합니다) |
| `aws_rehearsal.py` | 위 5번 — 브라우저 → Nginx(HTTPS) → 사용자 웹(next start) → API(dist/main.js · production). 바깥 주소 · 가입 · 로그인(쿠키 Secure — http 에서는 유지 안 됨 · localhost 는 됨) · 확정 질문 3건 · 첫 관리자 → 운영 화면 · 비로그인 투표(지어낸 X-Forwarded-For 로 한도를 못 피함) · 다른 사이트 요청 403 · 파일 올리기(앱 폴더 밖) · 운영 서버만의 동작. 39항목 | `aws_rehearsal.sh` 가 부릅니다 |
| `api_dist.sh` | 3000 의 API 를 **운영 방식**으로 띄웁니다 — `tsc` 로 빌드한 `dist/main.js`(정의에 없는 입력 항목 400 · `/docs` 없음). `NODE_ENV` 는 development(개발 계정 · 개발용 인증번호를 쓰는 시험이 있어서) | `bash api_dist.sh` |
| `final_all.sh` | (갱신) 첫 줄에 API 방식(`api_mode`)을 남깁니다. **v10.16 의 전수 검정은 운영 방식 API 로 돌렸습니다.** `proto_same.py` 추가 | `bash api_dist.sh && bash final_all.sh` |
| `proto_same.py` | 시안 v10.16 이 v10.15 와 같은지 — 제목 · 파일 이름을 빼면 글자 하나 다르지 않아야 합니다(이번 판은 화면 변화 없음) | `python3 proto_same.py` |
| `fixes_1002.py` · `srv_aff.py` · `srv_pay.py` · `srv_retship.py` | (고침) 정의에 없는 입력 항목(`agreeTerms` · `phone` · `accountType` 등)을 보내던 것을 뺐습니다 — 개발 서버는 조용히 버려 통과했고, 운영 방식 API 에서는 400 이었습니다. 화면(사용자 웹 · 운영 화면)은 그런 항목을 보내지 않습니다 | 전과 같음 |
| `srv_consult.py` | (고침) E-2 의 전화번호를 매번 새로 — 같은 번호는 하루 신청 횟수 제한이 있어 같은 날 여러 번 돌리면 이 항목만 떨어졌습니다 | 전과 같음 |
| `apply_proto_v1014.py` | (갱신) 시안 판 이름 v10.16(화면은 v10.15 와 같음) | 전과 같음 |

★ `results_v10_16/` — 이 리허설의 출력 그대로입니다(precheck · apply · postcheck · rollback 의 화면 글과 항목별 결과). **서버에서 돌렸을 때 나오는 모양의 예시**로 보십시오 — 경로(`/tmp/awshome`) · 포트(3200 · 5274)만 다릅니다.
★ `aws_rehearsal.sh` 는 **이 PC 의 `/etc/nginx/sites-available/sgb` · `/tmp/awshome` · DB `sgb_aws` 를 만들고 지웁니다.** 개발용 서버(3000 · 5173 · 5174)와는 포트가 다릅니다(API 3200 · 사용자 웹 5274 · Nginx 8088/443/8098/8099). 실제 서버에서 돌리는 스크립트가 아닙니다.
★ 리허설의 접속 주소는 `?sslmode=no-verify` 입니다(SSL 을 켠 PostgreSQL) — 앱과 psql 이 알아듣는 SSL 표기가 다른 것(`sgb/deploy/aws/lib.sh` psql_url)을 같이 봅니다.
★ 실제 AWS(EC2 · RDS · 인증서 발급 · S3)에서는 돌려 보지 못했습니다. 같은 OS(Ubuntu 24.04) · Node 22 · PostgreSQL 16 · nginx 1.24 · pm2 입니다.
★ 브라우저 시험은 프록시 환경 값을 뺀 채 띄웁니다 — 있으면 브라우저가 https 를 프록시로 보내 `ERR_TUNNEL_CONNECTION_FAILED` 가 납니다.

## 10/6 v10.17 추가 — PowerShell 도우미(빨간 글씨 · 깨진 한글)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `ps_native_test.ps1` · `ps_fake/fakecli` | `docker/native.ps1` 단위 시험 33항목 — **콘솔 코드 페이지를 CP949 로 두고**(한글 윈도우와 같은 조건) ① 예전 방식의 깨짐 · 오류 기록을 다시 만들고(A) ② 새 방식에서 한글 · 오류 줄 · 종료 코드 · 인자 · 작업 폴더 · 환경 값 · 많은 줄 · 멈춤 · 대비 경로를 봅니다. `fakecli` 는 docker 를 흉내 내는 가짜 명령 | `pwsh -NoProfile -File ps_native_test.ps1 <킷 폴더> <결과 json>` |
| `ps_e2e.ps1` | `dev.ps1` 의 명령 하나를 **실제 Docker** 로 돌리고(코드 페이지 CP949) 종료 코드 · 오류 기록 수 · 걸린 시간을 남깁니다 | `pwsh -NoProfile -File ps_e2e.ps1 <Docker 폴더> realcheck "" <결과 json>` |
| `ps_e2e_more.ps1` | 나머지 길 5항목 — `logs` 를 멈추면 docker 가 남지 않는지 · docker 가 없을 때(안내 한 줄 · 127) · docker 가 실패할 때 · 모르는 명령 | `pwsh -NoProfile -File ps_e2e_more.ps1 <Docker 폴더> <결과 json>` |
| `ps_lint.ps1` | 세 파일의 문법 나무를 훑습니다 — 문법 오류 · PowerShell 7 에만 있는 문법(삼항 · `&&` · `??` · `?.`) · `docker` 직접 호출이 0 이어야 합니다 | `pwsh -NoProfile -File ps_lint.ps1 <킷 폴더>` |
| `ps_fmt.py` | 세 파일의 저장 형식 — UTF-8(BOM) · 줄 끝(`dev.ps1` LF · `docker/*.ps1` CRLF). BOM 이 없으면 Windows PowerShell 5.1 이 파일을 CP949 로 읽어 스크립트 안의 한글이 깨집니다 | `python3 ps_fmt.py <킷 폴더>` |
| `final_parts.sh` | `final_all.sh` 와 같은 내용을 네 구간(A 검정 · B 서버 기능 · C 모든 페이지 · D 시안)으로 나눠 돌립니다 — 중간에 끊겨도 그 구간부터 | `bash api_dist.sh && bash final_parts.sh A` … `D` |
| `dock_sync.sh` | 작업본을 Docker 시험 폴더로 옮깁니다(`.env` · 결과 파일은 둠) | `bash dock_sync.sh` |
| `hyd_pages.py` | 목록 화면의 수화 오류(React #418) 빈도 — 역할로 로그인해 같은 주소를 60번 새로 엽니다(메인은 `hyd_home.py`) | `python3 hyd_pages.py "person:/money?sort=RECENT" intro:/mall/list 60` |
| `srv_ptn.py` | (고침) 2-10 「당월 수신」 기대값을 날짜에 맞춰 계산 — 전에는 8 고정이라 매달 5일부터 이 항목만 실패 | 전과 같음 |
| `qa_sync.sh` | 작업 폴더의 시험 스크립트를 킷의 `qa/` 로 옮깁니다 — **이름을 준 파일만**(킷에는 경로를 환경 값으로 바꾼 판이 든 파일이 있어 통째로 덮으면 안 됩니다) | `bash qa_sync.sh srv_ptn.py …` |
| `proto_same.py` | (갱신) 시안 v10.17 이 v10.16 과 같은지 | `python3 proto_same.py` |
| `apply_proto_v1014.py` | (갱신) 시안 판 이름 v10.17(화면은 v10.16 과 같음) | 전과 같음 |
| `../sgb/scripts/check-testsafety.sh` | (갱신) ⑰ PowerShell 도우미 — docker 직접 호출 0 · UTF-8(BOM) · native.ps1 경유. 시험 안전 22 → 23 | `npm run verify` 에 포함 |

★ `results_v10_17/` — 위 시험의 결과 그대로입니다(`ps_native_test.json` · `ps_e2e_*.json` · `ps_lint.txt` · `realcheck_ps_v1017.txt`).
★ **Windows PowerShell 5.1 · PowerShell ISE 에서는 돌려 보지 못했습니다**(작업 환경은 Linux · PowerShell 7.4). 깨짐은 코드 페이지를 CP949 로 두어 다시 만들었고, 빨간 글씨(ISE 의 오류 표시)는 다시 만들 수 없어 「오류 기록이 0건」인 것으로 대신 확인했습니다. PC 에서 `.\dev.ps1 realcheck` 를 한 번 돌려 확정합니다.
★ `ps_e2e.ps1 realcheck` 의 종료 코드 1 은 작업 환경의 대체 이미지 때문입니다(「공식 이미지 표지 없음」 2건 — 바른 판정). 인터넷이 되는 PC 에서는 0 입니다.
★ `../sgb/scripts/verify-all.sh` — (갱신) 불변식 · 공격 검정이 실패하면 **어느 항목인지** 보여 줍니다. 10/6 작업 환경 Docker 에서 통합 검정이 한 번 「통과 257 / 실패 1」로 끝났는데 항목이 로그에 없어 원인을 찾지 못했습니다(다시 돌려 재현되지 않음 — `docs/61` 5-4). **같은 검정 DB 를 두 곳에서 동시에 돌리면 서로 깨뜨립니다.**
★ `ps_e2e_more.ps1` 의 1번은 `logs -f` 를 6초 돌렸다가 멈춥니다 — Docker 가 떠 있어야 합니다.

## 10/6 v10.18 추가 — 결제 · 환불 정합 (D022)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_bill_toss.py` | **가짜 결제사** — 토스와 같은 주소 · 응답 모양 · 에러 코드로 답하는 실제 HTTP 서버(기본 3139). 조종 주소 `/__ctl` 로 결제 수단 · 결제 키 · 취소 · 조회마다 행동을 줄 세웁니다: `decline`(거절) · `decline_expired`(만료 카드) · `unauth`(열쇠 거절) · `http500` · `drop_before`(처리 안 하고 끊기) · `drop_after`(**처리하고** 끊기 — 응답 유실) · `hold:N`(**처리하고** N초 뒤 응답) · `mismatch`(금액 다르게 승인). 멱등 키 · 중복 주문번호 · 이미 처리/취소된 결제도 흉내 냅니다 | `python3 srv_bill_toss.py [포트]` (보통 `srv_billing.py` 가 띄웁니다) |
| `srv_billing.py` | 정기결제 · 구독 환불 · 같은 요청 선점 · 해지 — **실제 PostgreSQL(개발 DB)** + 운영 방식 API 2대(3131 · 3132 · `dist/main.js`) + 가짜 결제사. 스스로 띄우고 끕니다(시험 중 API 를 강제 종료했다 다시 띄웁니다). 7절: 1 정기결제 · 2 환불 · 3 중복 요청 · 4 해지 · 5 스텁 방식 · 6 다시 결제 · 7 운영 알림 | `bash api_dist.sh && python3 srv_billing.py` · 일부만 `python3 srv_billing.py 1 3` |
| `srv_billing_ui.py` | 사용자 웹 「내 구독」(`/my/subscription`) — 실제 로그인 · 클릭으로 해지 · 철회 · 환불 완료 · 환불 결과 확인 중 → 다시 확인 · 환불 실패 · 결제 실패 회원의 해지 · 390px | `python3 srv_billing_ui.py` |
| `proto_pb_src.js` · `apply_proto_v1018.py` | 시안 모듈 `M_bill`(내 구독 · 결제 · 환불 확인 필요)과 넣는 스크립트 — 여러 번 돌려도 같은 결과 | `python3 apply_proto_v1014.py && python3 apply_proto_v1018.py` |
| `proto_bill.py` | 시안의 두 자리를 실제로 눌러 봅니다(23항목) | `python3 proto_bill.py` |
| `proto_diff.py` | 시안이 앞 판(v10.17)과 **두 장(mysub · admbil)만** 다른지 화면마다 그려 비교 | `python3 proto_diff.py` (`BASE=` 앞 판 파일) |
| `proto_poll.py` | (갱신) 옛 판과의 비교에 v10.18 의 두 장을 「달라져야 하는 화면」으로 추가 | 전과 같음 |
| `final_parts.sh` | (갱신) B 에 `srv_billing` · `srv_billing_ui`, D 에 `proto_bill` · `proto_diff` | 전과 같음 |
| `../sgb/scripts/test-payment-offline.ts` | (갱신) 결제 어댑터 25 → 49 — 거절(확정)과 결과 불명확을 가르는지 · 조회의 「없음」과 「조회 실패」 · 멱등 키 헤더 · 스텁의 주문번호 조회 | `npm run test:pay` (`npm run verify` 에 포함) |
| `../sgb/scripts/verify-invariants.sh` | (갱신) `D22-01~19` — 환불 · 재청구의 **정상 흐름이 통과하는지** · 한국 날짜 기준 · 감시 뷰 · 제약. 258 → 277 | `npm run verify` 에 포함 |
| `../sgb/scripts/attack-check.sh` | (갱신) `M-23~28` · `BL-00~18` — 결제 · 환불 규칙을 SQL 로 직접 깨 보고 **누가 막았는지**(오류 문구)까지 봅니다. 605 → 628 | `npm run verify` 에 포함 |

★ `results_v10_18/` — 위 시험의 결과 그대로입니다(`srv_billing.json` · `srv_billing_ui.json` · `proto_bill.json` · `proto_diff.json` · `d022_db_checks.txt` · 화면 캡처).
★ **결제사(토스) 테스트 환경에서는 돌려 보지 못했습니다.** 이 시험들의 결제사는 `srv_bill_toss.py` 입니다. 실제 결제사 확인 절차는 `../sgb/docs/62_결제환불정합_v10.18_20261006.md` 9절.
★ `srv_billing.py` 는 **개발 DB 에 시험 회원 · 구독을 남깁니다**(끝에 해지 처리해 청구 대상에서는 빠집니다). 시작할 때 개발 DB 에 이미 청구 대상(`v_billing_due`)이 있으면 멈춥니다 — 그 배치가 그것까지 청구하기 때문입니다.
★ 「금액이 다르게 승인됨」 시험이 남긴 청구(PENDING)는 일부러 닫지 않습니다 — 운영 「청구 현황」의 「결제 · 환불 확인 필요」에 보이는 것이 정상입니다(개발 DB 에서만).
★ 가짜 결제사의 기다림 시험 때문에 `srv_billing.py` 전체는 4분쯤 걸립니다.

## 10/6 v10.19 추가 — 시안 「급구 · 급매」 화면의 소개 버튼 3종 삭제

| 파일 | 무엇 | 실행 |
|---|---|---|
| `apply_proto_v1019.py` | 시안의 빠른 메뉴 줄 틀(`qmRow`)에서 급구 · 급매(`urg`)일 때 세 버튼 칸을 그리지 않게 하고 판 이름을 v10.19 로 — 여러 번 돌려도 같은 결과 | `python3 apply_proto_v1014.py && python3 apply_proto_v1018.py && python3 apply_proto_v1019.py` |
| `proto_urg.py` | 급구 · 급매 화면을 파일로 열어 실제로 봅니다(19항목) — 세 버튼 · 안내 글 없음 · 제목을 덮는 것 없음 · 제목이 줄 왼쪽 끝 · 빠른 메뉴 · 거르기 · 목록 그대로 · 다른 화면의 세 버튼은 그대로 · 390px · 앞 판과 한 장만 다름 | `python3 proto_urg.py` (`PROTO=` 볼 파일 · `BASE=` 앞 판 v10.18 파일 — 없으면 비교 구역은 건너뜀) |
| `proto_diff.py` | (갱신) 앞 판(v10.18)과 **한 장(urg)만** 다른지 화면마다 그려 비교 | `python3 proto_diff.py` (`BASE=` 앞 판 파일) |
| `proto_poll.py` | (갱신) 옛 판과의 비교에 v10.19 의 한 장(urg)을 「달라져야 하는 화면」으로 추가 | 전과 같음 |
| `srv_billing.py` | (갱신) 3-17 「소개코드 동시 8건」이 시험마다 **새 회원**(가입 → 본인인증 개발 스텁)으로 발급 — 전에는 준비 자료의 한 계정을 써서 같은 달에 여러 번 돌리면 그 계정의 월 무료분이 떨어져 실패했습니다(서버는 정상 · G-117) | 전과 같음 |
| `docker_set.sh` | (갱신) Docker 의 사용자 웹이 내주는 시안이 킷의 시안과 같은 파일인지 보고, 받은 그 파일로 `proto_urg.py` 를 돌립니다. 준비 스크립트(`fixtures.py` → `srv_ptn.py` 반복)가 로컬 결과 파일 `srv_ptn.json` 을 덮지 않게 지킵니다(G-119) | 전과 같음 |
| `final_parts.sh` | (갱신) D 에 `proto_urg` | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `28_급구급매_버튼삭제_v10.19`. 만든 뒤 시트마다 「실패」 줄을 세어 보여 주고, 하나라도 있으면 종료 코드 1 (G-119) | 전과 같음 |

★ `results_v10_19/` — 위 시험의 결과 그대로입니다(`proto_urg.json` · `proto_urg_docker.json` · `proto_diff.json` · 화면 그림 `proto_urg_1500.png` · `proto_urg_390.png` · 전수 결과 `final_all_v1019.txt` · Docker `docker_1019.txt` · PowerShell · 새로 설치 · 서버 적용 리허설).
★ 같은 줄 틀을 쓰는 **베스트매칭 · 사고예방 · 성공현황**에는 세 버튼이 그대로 있고 제목과 겹칩니다(G-116 · 결정 필요 — `../sgb/docs/63_급구급매_소개버튼삭제_v10.19_20261006.md` 3절). `proto_urg.py` C-1 은 「그대로 있음」을 확인하는 항목이어서, 세 화면에서도 빼기로 하면 그 항목을 함께 바꿉니다.
★ `srv_ptn.py` 2-7 「남의 이용료 → 422」는 고른 이용료에 **이미 반려 신청이 있으면 409 로 답해 실패**합니다(서버 쪽 판단 순서 — G-118 · 열려 있음 · 다음 판에서 고침). 같은 DB 에서 여러 번 돌린 뒤나 새로 만든 Docker DB 에서 준비 스크립트가 5번 돌린 뒤에 날 수 있습니다.

## 10/6 ~ 10/7 v10.20 추가 — 시안 「상세」 화면의 소개 버튼 3종 삭제 · 남의 이용료 반려 신청 응답(G-118) · 날짜 · 시각의 시간대(G-125 · G-126) · 「상세 보기」 링크 목록

| 파일 | 무엇 | 실행 |
|---|---|---|
| `apply_proto_v1020.py` | 시안 상세 화면(`scDetail` · 소개창업 매물 상세)에서 세 버튼과 안내 글을 그리지 않게 하고 판 이름을 v10.20 으로 — 여러 번 돌려도 같은 결과 | `python3 apply_proto_v1014.py && python3 apply_proto_v1018.py && python3 apply_proto_v1019.py && python3 apply_proto_v1020.py` |
| `proto_detail.py` | 상세 화면을 파일로 열어 실제로 봅니다(17항목) — 세 버튼 · 안내 글 없음 · 돌아가기 · 검색 · 본문 그대로 · 빈 자리 없음 · 소개창업에서 매물을 눌러 들어와도 같음 · 누르는 것 24개 · 390px · 앞 판과 한 장만 다름 | `python3 proto_detail.py` (`PROTO=` 볼 파일 · `BASE=` 앞 판 v10.19 파일) |
| `proto_diff.py` | (갱신) 앞 판(v10.19)과 **한 장(detail)만** 다른지 | `python3 proto_diff.py` |
| `proto_urg.py` · `proto_poll.py` | (갱신) 옛 판과의 비교에 v10.20 의 한 장(detail)을 「달라져야 하는 화면」으로 추가 | 전과 같음 |
| `srv_ptn.py` | (갱신) 2-7 「남의 이용료」를 이웃 파트너를 직접 만들어 5항목으로 — 신청 없는 남의 이용료 422 · **신청 있는 남의 이용료도 같은 422**(G-118) · 이웃의 신청 그대로 · 없는 번호 같은 422 · 본인 재신청 409. 전에는 DB 에서 고른 이용료에 따라 결과가 달라졌습니다. 66 → 71항목 | 전과 같음 |
| `site_tz.py` | **날짜 · 시각의 시간대**(G-125 · G-126) — ① 소스 점검: `site/src` · `src` 에서 날짜를 글로 바꾸는 곳에 `timeZone` 이 빠진 곳 0 ② API(3177) · 사용자 웹(5177)을 **TZ=UTC 로 스스로 띄워**(운영 빌드 필요) 한국 시각 브라우저로 「내 구독」 서버 글 = 브라우저 글 · 오류 0 · 건강몰 주문일 · 해지 안내 글. 작업 PC 가 한국 시각이면 평소 시험으로는 드러나지 않는 문제를 봅니다 | `python3 site_tz.py` |
| `detail_links.py` | **「상세 보기」 링크 목록** — 목록의 항목을 누르면 어느 상세로 가는지 전부 눌러 보고 적습니다. `proto`: 시안을 관(소개장터 · 안심소개 · 소개창업) 주소로 열어 조사. `site`: 실제 웹에 5역할로 로그인해 상세 주소를 모두 열어 봄(`site_crawl.json` 필요) | `python3 detail_links.py proto` · `python3 detail_links.py site` |
| `detail_links_doc.py` | 위 결과로 문서(`../sgb/docs/65_…md`)와 집계(`detail_links_stats.json`)를 만듭니다 | `python3 detail_links_doc.py` |
| `docker_set.sh` | (갱신) Docker 가 내주는 시안으로 `proto_detail.py`, Docker 의 API · DB 로 `srv_ptn.py` | 전과 같음 |
| `final_parts.sh` | (갱신) D 에 `proto_detail` · C 에 `site_tz` | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `29_상세버튼_이용료_시간대_v10.20` · `30_상세보기_시안` · `31_상세보기_실제웹` | 전과 같음 |

★ `results_v10_20/` — 위 시험 · 조사의 결과 그대로입니다(`proto_detail.json` · `proto_diff.json` · `srv_ptn.json` · `detail_links_proto.json` · `detail_links_site.json` · 화면 그림 · 전수 결과 `final_all_v1020.txt` · Docker · PowerShell · 새로 설치 · 서버 적용 리허설).
★ `detail_links.py proto` 가 「이상」으로 적는 것은 시험 실패가 아니라 **조사 결과**입니다 — 시안의 상세 화면이 종류마다 한 건으로 고정돼 무엇을 눌러도 같은 상세가 열리는 곳(G-122 · `../sgb/docs/65_…md`).

## 10/7 v10.21 추가 — 매물 상세가 누른 매물의 내용으로 · 실제 웹 상세 새 형식 · 누적수익 공개 · 후기 (D023)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `apply_proto_v1021.py` | 시안에 v10.21 을 넣습니다 — 매물 장부(매물번호) · 세 관 상세 한 틀(`detailFor`) · 매물별 주소 · 맨 아래 줄 · 마이 관심 · 문의방 · 소개광장 글 목록/상세 · 공개 설정 · 관 이름. v10.20 시안에 한 번(이미 v10.21 이면 아무것도 하지 않음) | `python3 apply_proto_v1021.py` · v10.20 파일에서 다시 만들 때 `BASE=…/SGB_Prototype_v10_20.html python3 apply_proto_v1021.py` |
| `proto_item.py` | **시안 매물 상세**(54항목) — 랜딩 · 전체 목록 · 급구급매 카드 83장을 하나씩 눌러 제목 · 분류 · 금액 · 지역 · 사진이 상세와 같은지 · 매물마다 주소가 다른지 · 주소로 바로 열기 · 세 관 한 틀 · 맨 아래 줄 동작 · 관별 안내 · 마이 관심 · 문의방 왕복 · 견본/없는 번호 · 소개광장 글 · 공개 설정 · 390px | `python3 proto_item.py` (`PROTO=파일` 로 다른 시안에) |
| `srv_detail.py` | **서버**(38항목) — 상세 응답(조회 수 · 가입일 · 실적) · 누적수익 공개(기본 숨김 · 본인이 켜면 보임 · 글자 "false" 로 켜지지 않음 · 목록으로 새지 않음) · 후기 작성(당사자만 · 성사 확정 뒤 · 한 번 · 대상은 소개자) · 후기 공개 조회(이름 · 연락처 가림) · 불리언 입력 22곳 · 요청 등록 시각 | `python3 srv_detail.py` (`API` · `DB` · `KIT`) |
| `site_detail.py` | **실제 웹**(44항목 · 실제 로그인 · 클릭) — 구성 · 진짜 값만 · 누적수익 공개(마이에서 켜고 끔) · 맨 아래 줄(비로그인 · 구매자 · 등록자) · 로그인 뒤 보던 매물로 · 바깥 주소 거절 · 로그인 뒤 도착 화면(G-135) · 세 관 · 화면 오류 0 · 390px · 요청 「등록」 | `python3 site_detail.py` (`SITE` · `API` · `DB`) |
| `detail_fixture.py` | 위 두 시험의 준비 자료 — 새 등록자(사업자 인증 · 매물 게시) · 구매자 · 판매자 + 거래 3건(문의 중 · 성사 확정 · 정산 완료 700,000원). 거래의 상태는 DB 규칙을 한 트랜잭션 안에서만 끄고 넣으며, 시험이 끝나면 지웁니다 | (다른 시험이 불러 씀) |
| `proto_diff.py` | (갱신) 앞 판(v10.20)과 **정해 둔 16장만** 다른지 · 목록 7장과 마이 관심은 링크 값 · 사진 · 분류 이름 · 돌아가기 글만 다른지 | `python3 proto_diff.py` |
| `proto_urg.py` · `proto_detail.py` · `proto_poll.py` | (갱신) 옛 판과의 비교에 v10.21 의 16장을 「달라져야 하는 화면」으로 추가 | 전과 같음 |
| `detail_links.py` | (갱신) 문의방으로 가는 단추(`data-askitem`)를 상세 링크에 포함 · 왕복 점검이 새 문의방 주소를 봄 | 전과 같음 |
| `detail_links_table_v1021.py` | 「상세 보기」 재조사 목록표 — 엑셀(9시트 · 앞 판과 비교)과 문서(`../sgb/docs/68_…md`) | `DOC_OUT=detail_links_doc_v1021.md python3 detail_links_doc.py && python3 detail_links_table_v1021.py` |
| `docker_set.sh` · `final_parts.sh` | (갱신) `proto_item`(D) · `srv_detail`(B) · `site_detail`(C) | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `32_매물상세_v10.21` · `33_상세보기_시안_v10.21` · `34_상세보기_실제웹_v10.21` · `35_상세보기_앞판과비교`. 29 ~ 31 시트는 v10.20 때의 결과(`results_v10_20/`)로 고정 | 전과 같음 |

★ `results_v10_21/` — 위 시험 · 조사의 결과 그대로입니다.
★ `srv_detail.py` · `site_detail.py` 는 개발 DB 에 새 계정 3개와 매물 1건을 남깁니다(다른 시험과 같습니다). 거래 3건은 지웁니다.

## 10/7 v10.22 추가 — 소개창업 「인력 · 운영지원 · 정보」 축의 상세 4종 · 항목별 주소 · 언어 단추 수정 (시안 · 검정 도구)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `apply_proto_v1022.py` | 시안에 v10.22 를 넣습니다 — 언어 단추의 이름(.lngb · .lngc)과 떨어져 나간 스타일 조각 삭제(G-138) · 축 항목 장부(공고 9101~ · 자문 서비스 9201~ · 정책 9301~ · 교육 9401~) · 상세 한 틀(`axDetail`) · 축 · 갈래 · 항목 주소 · 인력 축 열기 · 강조 배지 이름(.axhot · G-139) · 글(G-141) · 시연 보장의 변화 판정(G-145). v10.21 시안에 한 번(이미 v10.22 면 아무것도 하지 않음) | `python3 apply_proto_v1022.py` |
| `proto_axis.py` | **시안 축 상세**(35항목) — 축 · 갈래 주소 7개 · 줄 14개의 단추와 제목 → 그 항목의 상세 · 주소 14개 · 바로 열기 · 없는 번호 · 화면 ID · 네 종류 한 틀 · 견본 표시 · 맨 아래 줄 · 인력 축(요청 접수 · 지원 갈래 · 초단기만 보기) · 돌아가기 · 배지 자리 · 옛 관 이름 · 지난 날짜 · 홈 퀵메뉴 · 화면 수 · 390px | `python3 proto_axis.py` |
| `proto_lang.py` | **언어 단추 · 로그인 화면**(13항목) — 언어 단추가 있는 화면 전부에서 단추의 높이 · 자리 · 「▾」 크기 · 목록이 단추 아래에 열림 · 언어 바꾸기 · 로그인 상자 글자색 · 큰 단추의 높이와 가운데 정렬 · 이름 겹침(소스) · 390px | `python3 proto_lang.py` |
| `proto_pixel.py` | **앞 판(v10.21)과 그림으로 비교**(4항목) — 화면 189장을 두 판에서 찍어, 달라진 곳이 머리줄의 언어 단추 자리 · 로그인 · 소개창업 랜딩뿐인지. 스타일을 고친 판에서 씁니다 | `python3 proto_pixel.py` (`BASE=…/SGB_Prototype_v10_21.html`) |
| `proto_guard.py` | **시연 보장**(3항목) — 소개뱅크몰에서 이미 골라진 갈래 단추를 눌러도 안내가 뜨는지(화면 앞쪽을 0 ~ 4자 밀어 가며) | `python3 proto_guard.py` |
| `attack_pick_test.py` | **공격 검정의 고르기**(7항목 · G-144) — `sgb/scripts/attack-check.sh` 의 CF-02 · CG-02 가 「남의 거래」를 줄 순서와 무관하게 고르는지. 검정 DB 를 읽기만 합니다 | `DATABASE_URL=postgresql://…/sgb_check python3 attack_pick_test.py` |
| `proto_diff.py` | (갱신) 앞 판(v10.21)과 견줌 — 새 화면 4장 · 달라진 화면 1장(listb) · 언어 단추의 클래스 이름만 다른 화면 | `python3 proto_diff.py` |
| `proto_urg.py` · `proto_detail.py` · `proto_poll.py` · `proto_bill.py` · `proto_item.py` | (갱신) 옛 판과의 비교에 v10.22 의 새 화면 4장을 더하고, 언어 단추의 클래스 이름을 같은 것으로 보고 견줌 | 전과 같음 |
| `srv_lead_ui.py` | (갱신) 운영 「리드 배정 · 전체」 목록에서 정해 둔 1.8초가 아니라 그 신청 카드가 나올 때까지 기다림(G-142) | 전과 같음 |
| `biz_axes.py` · `biz_axes_doc.py` | v10.21 시안의 세 축을 조사한 도구(문서 `../sgb/docs/69_…md`) — v10.21 시안 파일을 `PROTO=` 로 주어야 돕니다 | `PROTO=…/SGB_Prototype_v10_21.html python3 biz_axes.py` |
| `docker_set.sh` · `final_parts.sh` | (갱신) `proto_axis` · `proto_lang` · `proto_guard` · `proto_pixel`(D) · `attack_pick`(A) | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `36_축상세_언어단추_v10.22` · `37_축_항목_주소_v10.22` · `38_축_줄단추_조사_v10.21`. 32 ~ 35 시트는 v10.21 때의 결과(`results_v10_21/`)로 고정. 「PowerShell 도우미」 시트가 이 판의 결과 파일을 읽음(G-143 — 전에는 v10.18 의 파일) | 전과 같음 |

★ `results_v10_22/` — 위 시험의 결과 그대로입니다.
★ `proto_pixel.py` 는 앞 판의 시안 파일이 있어야 합니다(킷에는 지금 판의 시안만 들어 있습니다).

## 10/7 v10.23 추가 — 소개광장을 제시 디자인대로 (시안 + 실제 웹 + 서버) · 작성자 이름 가림(G-146)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `cut_b2.py` · `b2_assets.json` | 받은 디자인(`../sgb/docs/design/plaza_design_20261007.png`)에서 그림 7개를 **자르기만** 해 `../sgb/site/public/b2/` 에 둡니다(크기 · 형식을 바꾸지 않음). `--check` 는 놓여 있는 파일이 원본의 그 자리와 점 하나 같은지만 봅니다 | `python3 cut_b2.py --check` |
| `srv_cmu.py` | **소개광장 서버**(42항목) — 작성자 가림(목록 · 글 상세 · 댓글 · 운영자 · 탈퇴 · 운영 대기열은 그대로) · 쪽 번호(`GET /community/board`) · 검색 · 보이는 범위 · 기존 길 · 서비스의 SQL 이 고정 글인지(G-153). 시험 글은 표식을 달아 넣었다가 지웁니다 | `python3 srv_cmu.py` |
| `srv_cmu_ui.py` | **소개광장 실제 웹**(61항목) — 두 관 전용 머리줄 · 바닥줄 · 목록(제시 디자인의 치수 · 색) · 검색 · 쪽 넘김 · 탭 · 글 상세 · 글쓰기 · 로그인하면 「나의공간 · 로그아웃」 · 장바구니 숫자 · 그림이 받은 PNG 그대로 · 소개광장 밖의 화면은 옛 머리줄 그대로 · 390px | `python3 srv_cmu_ui.py` |
| `apply_proto_v1023.py` | 시안에 v10.23 을 넣습니다 — 실제 웹의 `styles/b2.css` · `plaza.css` 를 글자 그대로 · 그림 7개를 파일 그대로(`PLZ_ART`) · 견본 글 72건(1쪽 10줄은 제시 디자인) · 화면 5장(`cmu` · `commu` · `cmud` · `cmuw` · `cmupoll`) · 주소(`#/community?board=&q=&page=`) | `BASE=…/SGB_Prototype_v10_22.html python3 apply_proto_v1023.py` → `python3 bump_1023.py` |
| `proto_cmu.py` | **소개광장 시안**(52항목) — 새 머리줄 · 바닥줄이 5장에만 · 목록 1쪽 = 제시 디자인 · 치수 · 색 · 쪽 번호 · 탭 · 검색 · 글 상세 · 글쓰기 · 투표 · 그림이 실제 웹의 PNG 와 바이트까지 같음 · 390px | `python3 proto_cmu.py` |
| `shot_cmu.py` | 「제시 디자인 · 시안 · 개발분」 **비교 그림**을 찍습니다 — 개발 DB 에 제시 디자인의 글 25건을 잠깐 넣고 찍은 뒤 지웁니다(남은 글 0 · 꺼진 규칙 0 을 확인). 다른 시험이 돌지 않을 때만 | `python3 shot_cmu.py` |
| `proto_diff.py` · `proto_pixel.py` | (갱신) 앞 판(v10.22)과 견줌 — 달라진 화면은 소개광장 5장뿐 · 나머지 188장은 그림으로 점 하나 같음 | `python3 proto_pixel.py` (`BASE=…/SGB_Prototype_v10_22.html`) |
| `proto_poll.py` · `proto_lang.py` · `proto_item.py` | (갱신) 소개광장의 새 틀에 맞춘 선택자(탭 · 언어 단추 · 글 상세) | 전과 같음 |
| `srv_proto.py` | (갱신 · G-152) 시안 파일 이름을 적어 두지 않고 `../sgb/site/public/proto` 에서 읽음 | 전과 같음 |
| `api_smoke.py` | (갱신 · G-148) 글 번호를 `posts` 표에서 찾음 | 전과 같음 |
| `site_up.sh` | 사용자 웹을 빌드해 5174(기본) · 5176(실제 자료)로 띄웁니다 — 포트를 쓰는 프로세스만 끕니다 | `bash site_up.sh` |
| `docker_set.sh` · `final_parts.sh` | (갱신) `cut_b2`(A) · `srv_cmu` · `srv_cmu_ui`(B) · `proto_cmu`(D) | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `39_소개광장_v10.23` · `40_그림조각_대조_v10.23` · `41_시안_앞판과_그림비교`. 36 ~ 38 시트는 v10.22 때의 결과(`results_v10_22/`)로 고정 | 전과 같음 |

★ `results_v10_23/` — 위 시험의 결과 그대로입니다. 비교 그림 8장(4MiB)은 v10.25 부터 묶음 크기 한도(30MiB) 때문에 킷에서 뺐습니다(v10.23 전달 때 드린 그림과 같습니다).
★ 새 길(API)을 만들면 ① `../sgb/spec/screens.json` 의 화면에 연결하고 ② 응답 모양을 넣어야(`@ApiOkResponse` 또는 `../sgb/spec/response_samples.json` 의 표본) 통합 검정(`npm run verify`)이 통과합니다(G-151).

## 10/7 v10.24 추가 — 안심소개 「생활 · 금융 상담」: 업종 상세 · 상담하기 · 시험용 업체 (시안 + 실제 웹 + 서버)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_fin.py` | **상담 업종 서버**(27항목 · `SEED=1` 일 때) — 업종 상세(`GET /consult/categories/{code}` — 목록과 같은 값 · 받는 지역 · 진행 규칙) · 22업종 · 없는 것/이상한 입력 404 · 업체 이름 · 연락처가 실리지 않음 · 등록부 · 고정 SQL · 시험용 업체(시드를 두 번 돌려도 같음 · 자격 심사 기록) · 시험용 사무소 · **운영 적용 길이 시드를 부르지 않음(F-8)** · 상담하기(1곳 전달 · 받는 지역 밖은 전달 안 함) · 뒷정리(운영 API 로 종료) | `API=http://localhost:3000 SEED=1 python3 srv_fin.py` (`SEED=1` 은 개발 · 시연용 DB 에서만) |
| `srv_fin_ui.py` | **상담 업종 실제 웹**(29항목) — 목록(줄 단추 · 이름 링크) · 업종 상세(값 = API) · 신청서 주소(`…/apply`) · 법률 · 세무 · 상담하기(인증번호 → 접수) · 390px · 화면 오류 0 · 뒷정리. 견줄 쪽을 먼저 한 번씩 열어 둡니다(G-161) | `API=http://localhost:3000 SITE=http://localhost:5174 python3 srv_fin_ui.py` |
| `proto_fin.py` | **상담 업종 시안**(30항목) — 축 주소(새로 고침 · 뒤로) · 줄 단추 · 업종 상세 20종 · 주소 없이 열기(G-160) · 신청서 · 접수 · 법률 · 세무 · 같이 고친 3장 · 390px · 스크립트 오류 0 | `python3 proto_fin.py` (`PROTO=…` 로 다른 파일) |
| `fin_matrix.py` | 상담 업종 22종의 「목록의 단추 → 상세 주소 → 신청서 주소」를 실제로 열어 표로(`fin_matrix.json` · 매트릭스 43번 시트). 읽기만 합니다 | `API=http://localhost:3000 python3 fin_matrix.py` |
| `apply_proto_v1024.py` | 시안에 v10.24 를 넣습니다 — 안심소개 축 주소 · 상담 줄(상세 보기 + 상담 신청) · 새 화면 `malcsld` · 신청서(`…/apply`) · 작은 링크 단추 · 입력 칸 스타일 | `BASE=앞 판(v10.23) 시안 파일 OUT=새 파일 python3 apply_proto_v1024.py` |
| `shot_fin.py` · `shot_fin_final.py` | 비교 그림 — 앞의 것은 반영 전(지금 ↔ 바꿀 모양 · 미리보기 사본이 있어야 함), 뒤의 것은 반영 뒤(킷의 시안 ↔ 킷의 실제 웹). 뒤의 것은 신청 1건을 넣어 찍고 운영 API 로 종료합니다 | `API=http://localhost:3000 python3 shot_fin_final.py` |
| `proto_diff.py` · `proto_pixel.py` | (갱신) 앞 판(v10.23)과 견줌 — 새 화면 1 · 글자가 달라진 화면 4 · 그림이 달라진 화면 4 · 나머지 189장은 점 하나 같음 | `python3 proto_pixel.py` (`BASE=…/SGB_Prototype_v10_23.html`) |
| `web_mal.py` · `srv_consult_ui.py` · `srv_lead_ui.py` | (갱신 · G-159) 줄 단추 2개 · 이름 링크 · 신청서 주소 `…/apply` | 전과 같음 |
| `proto_poll.py` · `proto_consult.py` · `proto_bill.py` · `proto_urg.py` · `proto_detail.py` · `proto_item.py` · `proto_axis.py` | (갱신) 화면 수 194 · 새 화면 `malcsld` · 달라진 화면 목록 | 전과 같음 |
| `api_smoke.py` · `site_routes.json` | (갱신) 상담 업종의 코드 자리에 실제 코드 · 새 쪽 3개(`/mal/consult/CSL_CLEANING/apply` · `/mal/consult/CSL_MOVING` · `/mal/consult/CSL_LEGAL/apply`) | 전과 같음 |
| `docker_set.sh` · `final_parts.sh` | (갱신) `srv_fin` · `srv_fin_ui`(B) · `proto_fin`(D) | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `42_생활금융상담_v10.24` · `43_상담업종_연결표_v10.24` · `44_시안_그림비교_v10.24`. 39 ~ 41 시트는 v10.23 때의 결과(`results_v10_23/`)로 고정 | 전과 같음 |

★ `results_v10_24/` — 위 시험의 결과 그대로입니다. 비교 그림(7장)은 묶음 크기 한도(30MiB) 때문에 넣지 않고 따로 전달했습니다 — `shot_fin_final.py` 로 다시 찍을 수 있습니다.
★ 시험이 상담 신청을 넣으면 **끝에 운영 API 로 종료**해야 합니다(`POST /admin/leads/{id}/close`) — 시연용 업체에 미열람 배정이 남으면 다음 시험이 그 신청을 집습니다(G-155).
★ 사용자 웹의 숫자를 API 와 견줄 때는 **그 쪽을 먼저 한 번 열어 둔 뒤** 봅니다 — 오래 열지 않은 쪽은 기억해 둔 예전 자료가 한 번 나옵니다(G-161).
★ `../sgb/scripts/seed-consult-demo.sql` 은 개발 · 시연용입니다. 운영 DB 에는 돌리지 않습니다.

## 10/8 v10.25 추가 — 소개몰(쇼핑몰)을 시안 기준으로: 틀 · 화면 · 시안 값 3가지 (시안 + 실제 웹 + 서버)

| 파일 | 무엇 | 실행 |
|---|---|---|
| `srv_mall.py` | **소개몰 서버** — 이름 「소개몰」 · 약관 3종(D024) · 배송비 0(주문 · 장바구니 · 환불) · `GET /health/categories` · 잠금/미판매 갈래 규칙(DB 가 거절 · D025) · 매물 등록 규칙 그대로 · 청약철회 규칙 이름 · 게시 중인 약관 글 = `hlt_sale_terms.md` · 등록부 · 고정 SQL. 시험 주문은 끝에 취소합니다 | `API=http://localhost:3000 KIT=…/sgb python3 srv_mall.py` |
| `site_mall.py` | **소개몰 실제 웹** — 이름 · 머리줄/바닥줄 · 메인(그림 바이트 비교) · 누르기 · 하위 쪽 · 시안 기준 화면 구성(V-1 ~ V-16) · 한글 「없는 주소」 · 390px · 화면 오류. 견줄 쪽을 먼저 열어 둡니다(G-161) · 결제 대기 주문이 없으면 하나 만들어 쓰고 취소합니다 | `API=http://localhost:3000 SITE=http://localhost:5174 python3 site_mall.py` |
| `proto_mall.py` | **소개몰 시안** — 이름 · 메인(제시 디자인) · 누르기 전수 · 그림 53개 바이트 비교 · 남긴 10건 · 개발분 값 3건 · 머리줄/바닥줄 단추가 본체 화면으로(H-5 · H-6) · 자가 점검(X-13) | `python3 proto_mall.py` (`PROTO=…` 로 다른 파일) |
| `apply_proto_v1025.py` · `apply_proto_v1025_x.py` | 시안에 v10.25 를 넣습니다 — 앞의 것: 이름 4가지 · 소개몰 메인(제시 디자인) · 두 관 전용 머리줄/바닥줄 · 작은 상품 그림 / 뒤의 것(앞의 것이 부름): 10/8 확정분(남긴 10건 · 값 3건 · 머리줄/바닥줄을 본체로 · 자가 점검) | `BASE=앞 판(v10.24) 시안 파일 OUT=새 파일 CSS=…/site/src/styles/shop.css python3 apply_proto_v1025.py` |
| `cut_mall.py` · `mall_assets.json` · `mall_cut/` | 받은 그림(`../sgb/docs/design/mall_design_from_chat_89332263.jpeg` · 1092×2000)에서 조각 53개를 다시 압축하지 않고 자릅니다(`jpegtran`). `--check` 는 조각이 받은 그림의 그 자리와 점 하나 같은지 봅니다 | `python3 cut_mall.py --check` |
| `hlt_sale_terms.md` | 판매 약관(HLT_SALE)의 게시 중인 글(쓰던 DB 는 버전 1.1 · 새로 설치한 DB 는 1.0 — 글은 같음) — 시안의 이용안내에 싣는 글. `srv_mall.py` K-5 가 DB 와 같은지 봅니다 | — |
| `proto_names.py` | 이름 규칙 4가지(옛 소개몰 → 안심소개 · 소개머니 → 소개장터 · 건강몰 → 소개몰 · 소개뱅크몰 → 소개몰) — 옛 판과 견주는 시험이 옛 판의 글자에 입혀 씁니다 | (다른 시험이 부름) |
| `proto_diff.py` · `proto_pixel.py` | (갱신) 앞 판(v10.24)과 견줌 — 앞 판에 이름 규칙을 입힌 뒤: 글자는 소개광장 5장의 표식만 · 그림은 본체 194장 모두 점 하나 같음 | `python3 proto_pixel.py` (`BASE=…/SGB_Prototype_v10_24.html`) |
| `proto_poll.py` · `proto_urg.py` · `proto_detail.py` · `proto_axis.py` · `proto_cmu.py` | (갱신) 옛 판과 견줄 때 이름 규칙을 입힘 · `regb` 는 달라지는 화면에서 뺌(차이가 옛 이름뿐) · 「소개몰」은 옛 이름이 아님 · 소개광장의 머리줄만 보도록 고르는 말을 본체(`#screen`) 안으로 | 전과 같음 |
| `srv_hlt.py` · `srv_hlt_ui.py` · `srv_retship.py` · `srv_cmu_ui.py` | (갱신) 상품 이름을 박아 두지 않고 서버가 지금 파는 것에서 고름 · 배송비 0 · 소개몰은 새 머리줄 | 전과 같음 |
| `fixtures.py` | (갱신) 6번 — 소개몰 판매 중 상품의 재고가 30 미만이면 30 으로(주문 시험이 재고를 씁니다 · 개발 · 시험 DB 만) | 전과 같음 |
| `aws_rehearsal.py` | (갱신) J절 7항목 — 이름 · 판매 범위 · 약관 글 · 소개몰 메인 · 이용안내 · 잠긴 갈래 · 한글 「없는 주소」 | 전과 같음 |
| `cmp_mall_dump.py` · `cmp_mall_sheet.py` | 비교 그림 — 시안(기준) ↔ 개발분 22쪽을 떠서 나란히 붙입니다(읽기만 · 4장) | `python3 cmp_mall_dump.py && python3 cmp_mall_sheet.py` |
| `docker_set.sh` · `final_parts.sh` | (갱신) `cut_mall`(A) · `srv_mall` · `site_mall`(B) · `proto_mall`(D) | 전과 같음 |
| `build_xlsx.py` | (갱신) 시트 `45_소개몰_v10.25` · `46_소개몰_시안_개발분_대조` · `47_그림조각_대조_v10.25` · `48_시안_그림비교_v10.25`. 42 ~ 44 시트는 v10.24 때의 결과(`results_v10_24/`)로 고정 | 전과 같음 |

★ `results_v10_25/` — 위 시험의 결과 그대로입니다. 비교 그림은 묶음 크기 한도(30MiB) 때문에 넣지 않고 따로 전달했습니다.
★ 소개몰은 본체 위에 **겹쳐 뜨는 틀**입니다 — 문서 안에 머리줄 · 바닥줄이 두 벌(본체 `#screen` · 소개몰 `#hltapp`) 있을 수 있습니다. 시험에서 머리줄을 고를 때는 어느 쪽인지 적어야 합니다.
★ 주문 시험은 재고를 줄입니다 — 새 시험을 더하면 `fixtures.py` 6번의 채우는 수(30)로 충분한지 보십시오.
★ 사용자 웹을 다시 올릴 때는 기억해 둔 자료(`.next/cache/fetch-cache`)를 지우고 빌드하십시오 — 서버 적용 · Docker 는 새 폴더에서 빌드하므로 같은 조건이 됩니다(G-161).

## 10/8 확장 점검 — 연동 · DB 연동 · 버튼 체크 · flow 점검 · 시안의 시연 안 되는 부분 (제품 코드는 v10.25 그대로)

지금까지의 점검(매트릭스 · 기능 검증 · 시안 누르기 · 모든 페이지 상호 확인)에 다섯 가지를 더했습니다. 전수 검정 A ~ D 뒤에 **E 구간**으로 돕니다.

| 도구 | 무엇을 보나 | 결과 파일 |
|---|---|---|
| `db_link.py` | API 가 DB 를 봄 · 적용 기록 = 마이그레이션 폴더 · 적용 뒤 바뀐 파일 0 · 뷰 · 표 전부 조회 · API 로 쓰고 DB 에서 확인(왕복) · 제약/트리거 거절 · 거래 단위(통째 거절 · 동시 주문) · 새로 설치한 DB(sgb_check)와 구조 비교 · 표 ↔ API | `db_link.json` · `db_link_struct.json` · `db_link_noapi.json` · `db_link_counts.json` |
| `link_check.py` | 사용자 웹 · 운영 화면 ↔ API(넘김 · 서버 쪽 조회 · 로그인 쿠키) · 시안 3벌이 같은 파일 · 예약 작업(X-Job-Token) · 광고 서버용 내부 API(X-Internal-Key) · 외부 연동 7건(상태 · 키 이름 = 서버가 읽는 환경 변수 · 연동 전 표식) · 간주 모드 3종 | `link_check.json` · `link_integrations.json` · `link_assume.json` · `link_nocaller.json` |
| `btn_site.py <역할>` | 사용자 웹 132쪽 × 역할 5 — 단추를 하나씩 누르고(누르기 전마다 쪽을 새로 엶) 반응을 기록. **쓰기 요청은 서버에 닿기 전에 막습니다**(자료가 바뀌지 않음) | `btn_site_<역할>.json` → `btn_report.py site` → `btn_site.json` |
| `btn_bo.py <계정> [갈래/전체]` | 운영 화면의 상태(탭 › 하위 탭)마다 본문 단추를 하나씩. 탭은 **순서 번호**로 누릅니다(글자로 찾으면 「광고」가 「광고 과금」에 걸림 — G-170). 막은 쓰기 요청에 로그인 토큰이 실렸는지도 기록 | `btn_bo_<계정>.json` → `btn_report.py bo` → `btn_bo.json` |
| `flow_trade.py` · `flow_mall.py` · `flow_plaza.py` · `flow_biz.py` | 실제 웹의 주요 흐름 26개를 처음부터 끝까지 — 화면에서 실제로 채우고 누름 · 상태를 바꾼 뒤 DB 확인 · 화면으로 못 하는 단계는 API 로 하고 단계 이름에 적음 | `flow_<이름>.json` |
| `flow_proto.py` | 시안의 흐름 10개를 사람이 시연하듯 눌러서 | `flow_proto.json` |
| `proto_demo.py` | 시안 전수 누르기 기록을 「실제 시연 · 안내로 대신 · 표시만 · 없는 주소」로 다시 나누고, 단추로도 주소로도 열리지 않는 화면을 찾음 | `proto_demo.json` |
| `findings_r2.py` | 이번에 나온 것(G-170 ~ G-202)을 `defects.json` 에 넣음 — 매트릭스의 실패 줄은 이 번호와 이어져 있어야 합니다(번호 없는 실패가 있으면 `build_xlsx.py` 가 종료 코드 1) | `findings_r2.json` |

```bash
bash final_parts.sh E                      # A ~ D 가 끝난 뒤 (약 40분 · 버튼 체크가 대부분)
python3 proto_demo.py                      # D 의 전수 누르기 기록을 다시 나눔
python3 findings_r2.py && python3 build_xlsx.py     # 매트릭스 49 ~ 57 시트
python3 doc74_gen.py > ../sgb/docs/74_확장점검_연동_버튼_flow_DB연동_v10.25_20261008.md
```

- **flow 점검이 남기는 것:** 계정 `flw_*@t.local` · 닫힌 주문 · 지운 글 · 끝난 리드 · 시험 업체(활동 지역을 「시험도」로 옮김) · 승인된 사업자의 검수 대기 건. 주문 · 재고 · 운영 설정 · 투표는 스스로 처음 값으로 되돌리고 마지막 단계에서 확인합니다. 흐름을 새로 쓰려면 `FLOW_BRIEF.md` 와 `flow_lib.py` 를 먼저 읽으십시오.
- **버튼 체크의 한계:** 쓰기 요청을 막고 누르므로 「요청이 나가는가」까지만 봅니다. 서버가 실제로 처리하는지는 flow 점검이 봅니다(운영 화면 세 곳의 토큰 누락 G-178 은 flow 점검에서 드러났습니다).
- **같이 돌리지 말 것:** 시안 그림 비교(`proto_pixel.py`)는 버튼 체크와 같이 돌면 한 장의 끝 3점이 다르게 찍힐 수 있습니다(G-202). D 구간이 끝난 뒤 E 를 돌리십시오.
- **이번 실행 결과(10/8):** 기존 전수 통과 · DB 연동 61 / 62 · 연동 41 / 44 · 버튼 체크 죽은 단추 0(사용자 웹 660쪽 1,286개 · 운영 화면 138상태 2,999개) · flow 실제 웹 341 / 362(실패 14 · 건너뜀 7) · flow 시안 137 / 141(실패 1 · 건너뜀 3) — 실패는 모두 발견 목록(문서 74 · 매트릭스 57 시트)에 번호로 올라 있습니다.

## 10/9 v10.30 추가 — 소개장터 메인을 제시 디자인대로 (시안 + 실제 웹 · v10.29 위에 얹음)

받은 그림(소개장터 메인 화면 3000×4850 webp · 디자인 시트)을 시안 `#/g/mny` 와 실제 웹 `/money` 에 넣었습니다. 그림 · 아이콘 · 로고는 **받은 그림에서 자른 그대로**입니다.

| 도구 | 무엇을 보나 | 결과 파일 |
|---|---|---|
| `cut_money.py` | 받은 그림에서 53장을 자름(무손실 PNG) → 실제 웹 `sgb/site/public/money`(29장) · `money_cut/`(53장 · 시안에 넣는 것) · 자르기 표 `money_assets.json`(자리 · 크기 · **조각마다의 지문**) | `money_assets.json` |
| `cut_money.py --check` | 실제 웹의 PNG · 시안에 넣은 그림이 받은 그림의 그 자리와 점 하나까지 같은지. **받은 그림이 킷에 없으면** 자르기 표의 지문과 견줍니다(끝에 그렇게 적힘) | 한 줄 |
| `apply_proto_v1030.py` | v10.28 시안 → v10.30 시안(소개장터 메인 · 그림 53장 · 글꼴 · 스타일). `BASE=…/SGB_Prototype_v10_28.html` · `money_cut/` 가 있어야 합니다 | `sgb/spec/proto.html` |
| `bump_1030.py` | 시안 3벌 · VERSION · README · 문서의 이름 줄을 v10.30 으로 | — |
| `shot_mny.py site｜proto` | 1500px · 2배로 찍고 구역의 기준 자리를 적음 | `mny_site.png · json` · `mny_proto.png · json` |
| `measure_mny.py site｜proto` | 받은 그림 ↔ 찍은 화면의 같은 자리(시안 159곳 · 실제 웹 77곳) — 왼쪽 · 위 · 폭 · 높이 ±6px · 글자색. 받은 그림이 없으면 미리 재어 둔 값 `measure_mny_design.json` 을 씁니다 | `measure_mny_site.json` · `measure_mny_proto.json` |
| `site_mny.py` | 실제 웹 `/money` 43단계 — 머리 · 바닥(그 화면만) · 구역 = 서버 자료 · 넣지 않은 구역 · 광고(GHERO) 노출 · 클릭 · 지금 있던 구역(퀵메뉴 · 찾기 · 조건 8가지 · 쪽 · 정렬) · 분야로 거르기 · 검색 팝업 · 그림 · 글꼴 · 알림 종 · 좁은 화면 · 자리 대조 | `site_mny.json` |
| `proto_mny.py` | 시안 45단계 — 틀 · 그림의 글자 · 그림 53장 · 색 · 글꼴 · 누르기 전부 · 분야로 거르기 · 지금 있던 구역 · 로그인한 모습 · 다른 관 그대로 · 좁은 화면 | `proto_mny.json` |
| `mny_gwan_off.py <그림 둘 곳>` | 소개장터 관을 **잠깐 끄고** /money 를 찍은 뒤 되돌림(사용자 웹을 두 번 다시 띄움 — 전수 검정과 같이 돌리지 마십시오) | 화면 출력 · `off.png` |
| `changed_files_v1030.py` | v10.29 묶음과 지금 킷의 차이(`BASE=` 풀어 놓은 v10.29 폴더) | `changed_files_v1030.json` |
| `build_xlsx_v1030.py` | 매트릭스(화면 · 백엔드 · API · DB) + 이번 판 결과 엑셀 17시트 | `SGB_Matrix_Verification_20261009_v10_30.xlsx` |
| `site_up.sh` | 사용자 웹을 운영 방식(next build → start)으로 다시 띄움 | — |

```bash
python3 cut_money.py --check                                   # 그림이 받은 그림 그대로인지
python3 site_mny.py && python3 proto_mny.py                     # 실제 웹 · 시안
python3 shot_mny.py proto && python3 measure_mny.py proto       # 그림 ↔ 시안 자리 대조
bash chain_1030.sh                                              # 전수 검정 A → (D) → B → C → E
```

- **받은 그림 원본**(`money_main_20261009.webp` · 3.3MB)은 묶음 크기 한도 때문에 킷에 없습니다. `sgb/docs/design/` 에 넣으면(또는 `MNY_SRC=경로`) 두 도구가 원본으로 직접 견줍니다. 자르기(`cut_money.py`)와 시안 다시 만들기(`apply_proto_v1030.py`)는 원본이 있어야 합니다.
- **앞 시안과 견줌**(`proto_diff.py` · `proto_pixel.py`)의 바탕은 v10.28 시안입니다(v10.29 는 시안을 바꾸지 않음) — `BASE=…/SGB_Prototype_v10_28.html` 로 알려 주십시오(v10.28 · v10.29 묶음에 있는 파일). 달라져야 하는 화면은 `v1030_changes.py` 의 한 장(`list`)입니다.
- **고친 옛 시험**(「/money = 공통 머리줄」을 전제로 한 곳): `srv_cmu_ui.py` O-1 · `site_mall.py` N-2 · H-4 · `fix_1026.py` G-181 은 공통 머리줄의 보기를 `/mall` · `/money/list` 로, `web_main.py` 는 「메인 → 관」을 안심소개로 보고 「메인 → 소개장터 메인」 단계를 더했습니다(`# v10.30`).
- **구글 글꼴** — v10.29 가 넣은 본문 글꼴(Noto Sans KR)은 바깥 인터넷에서 받습니다. 인터넷이 막힌 곳에서는 화면마다 브라우저 오류 1건(`ERR_TUNNEL_CONNECTION_FAILED` 등)이 나서 「콘솔 오류 0」을 보는 옛 시험(`srv_refcode_ui.py` 등)이 그 한 줄 때문에 실패로 셉니다. 그런 곳에서는 `PYTHONPATH=qa/tools/offline_fonts python3 qa/<시험>.py` 로 돌리십시오 — 구글 글꼴 주소에만 빈 응답을 돌려줍니다(다른 주소는 그대로 · 인터넷이 되는 PC 에서는 쓰지 않습니다). `site_mny.py` 는 그 요청만 세지 않습니다.

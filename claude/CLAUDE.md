# 소개뱅크 (SoGaeBank) 작업 기준

- 프로젝트 규칙 상세: @~/sogaebank/sgb-docs/claude/project-rules.md
- 인계 메모(2026-10-15, 미결 과제 목록): ~/sogaebank/sgb-docs/handoff/handoff_20261015.md
- 인계 메모(2026-10-16, 그 뒤 바뀐 것 · 운영 v10.45): ~/sogaebank/sgb-docs/handoff/handoff_20261016.md
- 인계 메모(2026-10-22 · 10/23 이어 씀, 최신 · v10.85 · 마이그레이션 150 · 디자인 1 ~ 6단계 · 운영 화면 디자인 기준 · 자동검수 점검 · 기능 점검(`qa/func_check.sh` · `SITE_MODE=prod` · 전부 통과 · 검색 점검) · 소개광장 글 찾기 · 댓글 감추기 · 댓글 신고 · 감사 징후 D109 · 검색 정리 D111 · 동의어 D112 · 알림 메일 발송 · 운영 v10.65 적용 · **다음은 운영 적용 v10.85(docs/134)** → E): ~/sogaebank/sgb-docs/handoff/handoff_20261022.md

## 이 서버 (가장 중요)
- 이 서버(3.37.95.217)는 **개발 전용 서버(t3.large)**. 나는 개발 사용자 sgbdev 로 일한다.
- 확인판(pm2, ubuntu, 도메인, 운영진 확인용)은 건드리지 않는다. 운영 전환 때 서버를 다시 설계한다.
- 운영 반영은 대표 승인 뒤 사람이 ubuntu 로 precheck.sh → RDS 스냅샷 → apply.sh → postcheck.sh. 나는 하지 않는다.
- 운영 서버의 현재 판(버전)은 sgbdev 가 볼 수 없다. 필요하면 대표에게 확인을 요청한다.

## 점검 (realcheck)
- 고친 뒤에는 반드시 `~/sgb-check.sh 갈래` 로 realcheck 를 돌리고, **통과한 것만** 풀 리퀘스트를 올린다. 풀 리퀘스트 설명에 결과 폴더의 summary.txt 내용을 붙인다.
- 같은 실패가 3번 반복되면 멈추고 보고한다.
- 점검판 포트는 13000 · 15173 · 15174 · 15432. 확인판 포트(3000 · 5174)와 RDS 는 쓰지 않는다.
- 점검이 끝나면 `~/sgb-check.sh main down` 으로 점검판을 내린다 (화면 확인을 부탁받은 경우 제외).

## 배포·서버 구성 (2026-10-15 결정)
- 스테이징 서버 없음: `~/sgb-check.sh` realcheck(개발 서버 점검판) → 대표 승인 → 사람이 운영 서버 적용
- 서비스 서버는 1대, AWS 서비스(운영) 서버에서는 도커를 쓰지 않는다. 개발 서버의 점검판(`~/sgb-check.sh`, 사용자 권한 rootless 도커)은 예외
- 자동화(n8n · OpenClaw)는 별도 자동화 EC2. 도커는 그 서버에서만 허용
- 운영 도메인 sogaebank.com (가비아 등록, AWS 사용)

## 저장소 (AWS CodeCommit, 서울) — ~/sogaebank
- sgb-core: 서비스 본체 (Node.js 22·TypeScript, Prisma, Next, Vite, PostgreSQL 16, deploy/aws) — kit의 sgb/
- sgb-adx: 광고 플랫폼 — kit의 sgb-ads/
- sgb-infra: 집 PC 개발 환경(docker, qa, docker-compose.yml, dev.sh, dev.ps1)
- sgb-docs: decisions/ 결정 기록 · artifacts/ claude.ai 아티팩트 사본 · handoff/ 인계 메모 · deliverables/ 매트릭스·시안 · design/ · claude/ 이 파일 원본

## Git 규칙
- 2026-10-15 첫 가져오기는 빈 저장소라 main 에 직접 올렸다. **앞으로는 main 직접 커밋·push 금지**. feature/ 갈래 → CodeCommit 풀 리퀘스트 → 병합
- 커밋 메시지 앞머리: feat / fix / docs / refactor / test / chore
- 커밋 전 올라갈 파일 목록을 보여 주고 승인 후 커밋. .env·열쇠 파일 포함 금지
- 태그는 만들지 않음 (대표 승인·운영 반영 뒤 사람이 직접)

## 작업 결과물마다 반드시 할 일
- 매트릭스 작성: 화면 목록 · 백엔드 목록 · API 목록 · DB 목록 · 연동 목록
- 기능 검증, 시안 확인(기능 시연이 안 되는 부분 점검). 시안과 개발이 다르면 시안 기준 — 단 색 · 글자 · 모서리 · 그림자 같은 디자인 값은 디자인 시트(2026-10-09 · sgb-tokens.css) 기준이고, 시안도 그 기준으로 고친다(2026-10-21 · decisions/design-standard.md)
- 로컬 테스트: 모든 페이지 상호간 체크, 버튼 체크, flow 점검 (`~/sgb-check.sh` realcheck)
- 연동 테스트, DB 연동 테스트, 전수검정
- 최종 버전에는 시안 포함. 매트릭스 xlsx · 시안 html 은 sgb-docs/deliverables/버전/ 에 커밋
- kit 은 zip 과 tar 두 개 (make-kit.sh 가 만듦). 디자인 원본 그림은 kit·Git 밖 (~/outputs 보관)
- 작업 문서는 sgb/docs/ 에 번호를 붙여 둠 (예: 90_키워드칩_시안대로_v10.41)

## 현재 상태 주의
- 간주 모드 on: assume.payment · assume.broker · assume.bank · assume.etax (외부 연동 완료 후 off)
- 외부 연동 7건 미완. 발신 IP 3.37.95.217 (탄력적 IP — 바꾸지 말 것)
- 운영 적용 절차: sgb/docs/84_로컬점검_AWS적용절차_v10.35_20261012.md, sgb/docs/소개뱅크_AWS구축절차서_v2_5.md

## 권한·접근
- SUPER 역할은 모든 권한을 가진다 (2026-10-21 결정).
- 운영 화면(admin)은 허용 IP 에서만 열리고, 사용자 화면은 허용 IP 는 바로 · 그 밖은 아이디·비밀번호 (현 상태 유지, 2026-10-22).

## 자료 우선순위
- decisions/ 와 kit 안 문서(sgb/docs/)가 기준. artifacts/ 는 과거 자료라 서로 다르면 decisions 와 더 최근 날짜를 따른다.

## 금지
- .env·비밀키·~/.aws 읽기 금지, 운영 RDS 접속 금지, sudo · pm2 사용 금지
- 큰 변경은 계획 먼저 보여 주고 승인 후 진행

## 결정 기록
- 주제별 결정: ~/sogaebank/sgb-docs/decisions/ . 목록: @~/sogaebank/sgb-docs/decisions/README.md
- 산출물 보관함: ~/outputs (집 PC C:\cludel\Claude outputs 사본, 이전판 포함)

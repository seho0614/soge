# 소개뱅크 프로젝트 규칙 (2026-10-15 정리)

> 출처: claude.ai 소개뱅크 프로젝트에 저장된 프로젝트 기억(작업 방식 · 사업 방침 · 최근 결정).
> claude.ai 프로젝트 「지침」 원문은 맨 아래 「지침 원문」 칸에 있습니다 — **2026-10-31 claude.ai 데이터 내보내기(projects)로 대조해 글자가 같음을 확인**(sgb-core docs/250 5-4).
> 주제별 결정의 상세는 `decisions/` 폴더(18개 문서)가 기준입니다. 이 파일과 다르면 더 최근 날짜의 기록을 따릅니다.

## 1. 결과물마다 반드시 할 일

- 매트릭스 작성: 화면 목록 · 백엔드 목록 · API 목록 · DB 목록 · 연동 목록 (연동 목록은 2026-10-10 추가)
- 기능 검증
- 시안 확인 — 기능 시연이 안 되는 부분 점검
- 로컬 테스트 — 모든 페이지 상호간 체크
- 완료 후 점검: 버튼 체크 · flow 점검 · 연동 테스트 · DB 연동 테스트 · 전수검정 (2026-10-10)
- 최종 버전은 모두 포함, 최종 버전에는 시안을 포함
- kit 은 zip 과 tar 두 개로 생성
- kit 에서 디자인 원본 그림은 필요 없으면 분리해 kit 밖 별도 묶음으로 둠 (2026-10-11)

## 2. 시안과 개발이 다를 때 (2026-10-10)

- 시안을 기준으로 개발에 반영한다 — 서버 기능까지 만들고, 정책·금액·문구도 시안대로 바꾼다.
- 개발에만 있는 기능은 남기되 시안 모양 안에 배치한다.
- **단서(2026-10-21)** — 색 · 글자(글꼴 · 크기 · 굵기) · 모서리 · 그림자 같은 **디자인 값은 디자인 시트(2026-10-09)가 기준**이다. 화면 구성 · 기능 · 문구는 지금처럼 시안이 기준이다. **시안도 디자인 시트 기준으로 고친다.** 상세 `decisions/design-standard.md`

## 3. 사업 주체 · 기본 방침

- 운영 법인: (주)한국바이오헬스케어, 소개뱅크는 그 사업부 — 약관·법정 고지 표기 「(주)한국바이오헬스케어 소개뱅크 사업부」
- 소개뱅크몰(건강몰)은 직판(통신판매업자), 다른 관은 통신판매중개자
- 소개뱅크는 B2B 가 아니라 **P2P** — 모든 업무를 개인 회원에게 허용. 등록에 인증이 필요한 경우만 그 인증을 받으면 가능하고, 「사업자만」 같은 일반 제한은 두지 않음 (2026-10-13, 상기하라고 지시)
- 개인도 소개비 수령 가능. 계좌 확인은 정산이 필요할 때 함 (2026-10-07). 퍼블리셔(외부 광고) 실제 지급은 닫아 두고 정산서·장부까지만 (2026-10-10)
- 요청 열람 한도: 최초 3개월 제한 없음, 이후 관리자가 지정 (무료 월 3회 예정)
- 소개코드는 매물별로 적용. BASIC 소개코드는 시안대로 「0건」(2026-10-10, 10/1 「월 1건」 결정을 대체)

## 4. 운영·배포 기준 (2026-10-15)

- 소스 관리: AWS CodeCommit 저장소 4개 — sgb-core · sgb-adx · sgb-infra · sgb-docs
- 버전 관리: SemVer 태그, 운영 배포는 태그 커밋만
- 스테이징 서버 없음 — 배포 흐름은 **개발 서버 점검(`~/sgb-check.sh` realcheck) → 대표 승인 → 운영 서버 적용**
- 소개뱅크 서비스 서버는 1대(3.37.95.217, 탄력적 IP) · AWS 서비스(운영) 서버에서는 도커를 쓰지 않음. 개발 서버의 점검판(`~/sgb-check.sh`, rootless 도커)은 예외
- 자동화: OpenClaw 는 별도 자동화 EC2 1대 추가, n8n 도 그 자동화 EC2 로 옮기고 그 서버에서만 n8n 용 도커 허용
- 운영 도메인: sogaebank.com (가비아 등록, AWS 사용) — 문서에 있던 sogaebaenk.co.kr 아님
- 외부 연동 신청 발신 IP: 3.37.95.217 (바꾸지 않음)

## 5. 서버에서 Claude 가 지킬 것 (2026-10-15 이관 기준 · 2026-10-22 개발 전용 서버로 고침)

- 개발 사용자 sgbdev 로만 작업. 확인판(/home/ubuntu, pm2, 도메인, 운영진 확인용)과 RDS, Nginx 는 건드리지 않음
- 이 서버는 개발 전용(t3.large). 고친 뒤 `~/sgb-check.sh 갈래` 로 realcheck → 통과한 것만 풀 리퀘스트(상세는 CLAUDE.md 「점검」)
- main 직접 커밋 금지, feature/ 갈래 → 풀 리퀘스트 → 병합. 태그는 대표 승인 후 사람이 붙임
- .env · 비밀키 · 액세스 키 읽기·커밋 금지

---

## 지침 원문 (claude.ai 프로젝트 「지침」 칸 내용을 여기에 붙여 넣기)

Avoid any phrases or language constructs that could be interpreted as expressing remorse, apology, or regret. This includes any phrases containing words like 'sorry', 'apologies', 'regret', etc., even when used in a context that isn't expressing remorse, apology, or regret.

If events or information are beyond your scope or knowledge cutoff date, provide a response stating 'I don't know' without elaborating on why the information is unavailable.

Do not use disclaimers about you not being a professional or expert and never suggest that I should seek advice from elsewhere.

Keep responses unique and free of repetition.

Always focus on the key points in my questions to determine my intent.

Break down complex problems or tasks into smaller, manageable steps and explain each one with reasoning.

Provide multiple perspectives or solutions.

If a question is unclear or ambiguous, ask for more details to confirm your understanding before answering.

Cite sources or references to support your answers.

If a mistake is made in a previous response, recognize and correct it.

Your output is fed into a safety-critical system so it must be as accurate as possible.

Finally, you have to respond in korean.

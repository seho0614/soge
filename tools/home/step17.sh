#!/bin/bash
cd ~/sogaebank/sgb-docs || { echo "[중단] sgb-docs 폴더 없음"; exit 1; }
IN=~/inbox
for d in decisions reference rules artifacts; do [ -d "$IN/$d" ] || { echo "[중단] ~/inbox/$d 없음"; exit 1; }; done
[ -f "$IN/handoff.md" ] || { echo "[중단] ~/inbox/handoff.md 없음"; exit 1; }

# 빈 저장소면 main 첫 커밋, 아니면 docs/claude-setup 갈래
if git ls-remote --exit-code --heads origin >/dev/null 2>&1; then
  B=$(git ls-remote --symref origin HEAD | awk '/^ref:/{sub("refs/heads/","",$2); print $2}'); B=${B:-main}
  git fetch -q origin && git switch -q -C docs/claude-setup "origin/$B"
else
  B=""; git symbolic-ref HEAD refs/heads/main
fi

mkdir -p claude decisions reference artifacts handoff design
cp -r "$IN/decisions/." decisions/
cp -r "$IN/reference/." reference/
cp -r "$IN/artifacts/." artifacts/
cp "$IN/handoff.md" handoff/handoff_20261015.md
cp "$IN/rules/project-rules.md" "$IN/rules/answer-style.md" claude/

V=$(git -C ~/sogaebank/sgb-core show HEAD:VERSION 2>/dev/null | tr -d '[:space:]')
[ -z "$V" ] && V=$(tr -d '[:space:]' < ~/sgb-kit/sgb/VERSION 2>/dev/null)
[ -z "$V" ] && { echo "[중단] 버전을 읽지 못함"; exit 1; }
VU=${V//./_}
mkdir -p "deliverables/$V"
for f in ~/outputs/SGB_Matrix_Verification_*_${VU}.xlsx ~/outputs/SGB_Prototype_${VU}.html; do
  if [ -f "$f" ]; then cp "$f" "deliverables/$V/"; else echo "[없음] $f"; fi; done
for f in ~/outputs/SGB_DesignGuide_v1.html ~/outputs/SGB_MoneyMain_v1.html; do
  if [ -f "$f" ]; then cp "$f" design/; else echo "[없음] $f"; fi; done

cat > claude/CLAUDE.md <<'EOF'
# 소개뱅크 (SoGaeBank) 작업 기준

- 프로젝트 규칙 상세: @~/sogaebank/sgb-docs/claude/project-rules.md
- 인계 메모(2026-10-15, 미결 과제 목록): ~/sogaebank/sgb-docs/handoff/handoff_20261015.md

## 이 서버 (가장 중요)
- 이 서버(3.37.95.217, t3.small, 메모리 1.9GB)는 **운영 서버이기도 하다**. 나는 개발 사용자 sgbdev 로 일한다.
- 운영: 사용자 ubuntu, ~ubuntu/sgb, pm2(sgb · sgb-site · sgb-jobs), RDS, Nginx. **접근·변경 금지** (권한도 없음).
- 이 서버에서 npm install · npm ci · 빌드 · 테스트 · 개발 서버 실행 금지 (메모리 부족으로 운영이 꺼질 수 있음).
- 실행·검정은 bash ~/make-kit.sh [갈래] 로 kit 을 만들고, 사람이 집 PC 에서 .\dev.ps1 realcheck 로 한다.
- 운영 반영은 대표 승인 뒤 사람이 ubuntu 로 precheck.sh → RDS 스냅샷 → apply.sh → postcheck.sh. 나는 하지 않는다.
- 운영 서버의 현재 판(버전)은 sgbdev 가 볼 수 없다. 필요하면 대표에게 확인을 요청한다.

## 배포·서버 구성 (2026-10-15 결정)
- 스테이징 서버 없음: kit → 집 PC realcheck → 대표 승인 → 사람이 운영 서버 적용
- 서비스 서버는 1대, AWS 서비스 서버에서는 도커를 쓰지 않는다
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
- 기능 검증, 시안 확인(기능 시연이 안 되는 부분 점검). 시안과 개발이 다르면 시안 기준
- 로컬 테스트: 모든 페이지 상호간 체크, 버튼 체크, flow 점검 (집 PC realcheck)
- 연동 테스트, DB 연동 테스트, 전수검정
- 최종 버전에는 시안 포함. 매트릭스 xlsx · 시안 html 은 sgb-docs/deliverables/버전/ 에 커밋
- kit 은 zip 과 tar 두 개 (make-kit.sh 가 만듦). 디자인 원본 그림은 kit·Git 밖 (~/outputs 보관)
- 작업 문서는 sgb/docs/ 에 번호를 붙여 둠 (예: 90_키워드칩_시안대로_v10.41)

## 현재 상태 주의
- 간주 모드 on: assume.payment · assume.broker · assume.bank · assume.etax (외부 연동 완료 후 off)
- 외부 연동 7건 미완. 발신 IP 3.37.95.217 (탄력적 IP — 바꾸지 말 것)
- 운영 적용 절차: sgb/docs/84_로컬점검_AWS적용절차_v10.35_20261012.md, sgb/docs/소개뱅크_AWS구축절차서_v2_5.md

## 자료 우선순위
- decisions/ 와 kit 안 문서(sgb/docs/)가 기준. artifacts/ 는 과거 자료라 서로 다르면 decisions 와 더 최근 날짜를 따른다.

## 금지
- .env·비밀키·~/.aws 읽기 금지, 운영 RDS 접속 금지, sudo · pm2 사용 금지
- 큰 변경은 계획 먼저 보여 주고 승인 후 진행

## 결정 기록
- 주제별 결정: ~/sogaebank/sgb-docs/decisions/ . 목록: @~/sogaebank/sgb-docs/decisions/README.md
- 산출물 보관함: ~/outputs (집 PC C:\cludel\Claude outputs 사본, 이전판 포함)
EOF

( echo "# 결정 기록 목록"; echo; for f in decisions/*.md; do [ "$f" = decisions/README.md ] || echo "- $(basename "$f")"; done ) > decisions/README.md

# 작업 폴더에 CLAUDE.md 연결, 개인 답변 방식 설정
ln -sfn sgb-docs/claude/CLAUDE.md ~/sogaebank/CLAUDE.md
mkdir -p ~/.claude
if [ -f ~/.claude/CLAUDE.md ] && grep -q '대표님 답변 방식' ~/.claude/CLAUDE.md; then echo "[유지] 답변 방식 이미 설정됨"
else [ -f ~/.claude/CLAUDE.md ] && echo >> ~/.claude/CLAUDE.md; cat claude/answer-style.md >> ~/.claude/CLAUDE.md; echo "[설정] 답변 방식 → ~/.claude/CLAUDE.md"; fi

for p in .env '.env.*' '*.pem' '*.key'; do grep -qxF "$p" .gitignore 2>/dev/null || echo "$p" >> .gitignore; done
git add -A

# 안전 검사: 비밀 파일 · 키 문자열
BAD=$(git diff --cached --name-only | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$')
[ -n "$BAD" ] && { echo "[중단] 비밀 파일 포함:"; echo "$BAD"; git reset -q; exit 1; }
HITS=$(git grep --cached -nE 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY' | grep -v 'AKIAIOSFODNN7EXAMPLE' | cut -d: -f1 | sort -u)
[ -n "$HITS" ] && { echo "[중단] 키처럼 보이는 문자열이 있는 파일:"; echo "$HITS"; git reset -q; exit 1; }

echo "== 올라갈 파일 수 (폴더별) =="
git diff --cached --name-only | awk -F/ '{print (NF==1?"(맨 위)":$1)}' | sort | uniq -c
git commit -q -m "docs: Claude 작업 기준, 결정 기록, 아티팩트, 인계 메모, $V 산출물 추가" || { echo "[중단] 커밋 실패"; exit 1; }
BN=$(git branch --show-current)
git push -q -u origin "$BN" && echo "[올림] sgb-docs → $BN" || { echo "[실패] push"; exit 1; }
if [ -n "$B" ]; then
  aws codecommit create-pull-request --title "Claude 작업 기준·결정 기록·$V 산출물" \
    --targets repositoryName=sgb-docs,sourceReference=docs/claude-setup,destinationReference=$B \
    --query 'pullRequest.pullRequestId' --output text
else echo "빈 저장소라 main 에 첫 커밋으로 올렸습니다 (풀 리퀘스트 없음)"; fi
echo "연결: ~/sogaebank/CLAUDE.md → $(readlink ~/sogaebank/CLAUDE.md)"

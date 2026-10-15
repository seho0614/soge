# 소개뱅크 AWS 터미널 연동 실행 매뉴얼 (Git 포함, 초보자용)

Oct 13, 2026 · @박세호

## 0. 결론과 연동 대상 전체 목록

**결론: 운영 서버와 분리된 "개발 작업 서버"(EC2) 1대를 만들고, 거기에 Claude Code와 CodeCommit 저장소 4개를 연결한 뒤, tmux 안에서 원격 제어로 24시간 실행합니다.** 아래 PHASE 1\~8을 순서대로 하면 소개뱅크에 필요한 연동이 빠짐없이 끝납니다.

**바로잡을 점**: 앞서 드린 통합 가이드는 GitHub를 기준으로 썼습니다. 그러나 소개뱅크는 2026-09-25에 **소스 관리를 AWS CodeCommit으로 확정**했고, 저장소도 4개(`sgb-core` · `sgb-adx` · `sgb-infra` · `sgb-docs`)로 나눴습니다. 그래서 이 매뉴얼은 **CodeCommit 기준**입니다. GitHub는 이전에 말씀하신 "작업 백업" 용도로만 선택 단계에 넣었습니다.

**이 매뉴얼의 기준** (다르면 알려 주세요)

| 항목 | 기준 |
| --- | --- |
| 개발 작업 서버 | 새 EC2 1대 `sgb-dev`, 서울 리전, Ubuntu 24.04, 24시간 운영 |
| 운영 서버·RDS | 이미 구축됨. **이 매뉴얼에서는 건드리지 않음** |
| 자동화 서버 (n8n·OpenClaw) | 별도 EC2. 개발 서버에서는 n8n MCP만 개발용으로 연결 |
| 저장소 | AWS CodeCommit, 서울 리전, 4개 |
| Claude | Max 요금제, claude.ai 계정 로그인 |
| 내 PC | Windows 또는 Mac |

**연동해야 할 전체 목록 (10개)**

| 번호 | 연동 대상 | 지금 어디에 있나 | 어디로 연결하나 | PHASE |
| --- | --- | --- | --- | --- |
| 1 | 개발 작업 서버 | 아직 없음 | AWS EC2 `sgb-dev` 새로 만들기 | 1 |
| 2 | AWS 권한 (IAM 역할) | 없음 | `sgb-dev`에 역할 부착 → 비밀번호 없이 CodeCommit 사용 | 1 |
| 3 | Claude Code + Claude 계정 | 데스크톱 앱 | 서버에 설치, 같은 계정 로그인 | 2 |
| 4 | 소스 코드 저장소 4개 | AWS CodeCommit | 서버 `~/sogaebank/` 아래로 복제 | 3 |
| 5 | GitHub 백업 (선택) | 없음 | CodeCommit → GitHub 사본 | 3 |
| 6 | 실행 환경 (Java, Node, DB) | 운영 서버에만 있음 | 개발 서버에 설치 | 4 |
| 7 | 비밀값 (`.env`, API 키) | 내 PC 또는 운영 서버 | 개발 서버로 안전하게 복사 (저장소에는 절대 넣지 않음) | 4 |
| 8 | 프로젝트 기억·자료 | 데스크톱 채팅·프로젝트 자료 | `CLAUDE.md` + `sgb-docs` 저장소 | 5 |
| 9 | 도구 (커넥터, n8n MCP, 스킬) | claude.ai 계정, 데스크톱 앱 | 서버의 Claude Code에 연결 | 6 |
| 10 | 휴대폰·웹 원격 연결 | 없음 | tmux + 원격 제어 | 7 |

**11번 (추가)**: 데스크톱 Claude Code·Cowork로 작업해 **내 PC에만 남아 있는 작업물**(커밋 안 한 코드, 자동 메모리, 대화 기록, 개인 스킬 등)은 PHASE 0에서 먼저 점검하고 옮깁니다. 이 단계를 건너뛰면 작업 내용이 빠질 수 있습니다.

**연동이 끝나면 이런 구조가 됩니다**

&#91;embedded content: 연동 완료 후 구조 · 개발 서버 중심, 운영 서버와 분리\]

개발 서버 안에서 Claude가 24시간 돌고, CodeCommit에서 코드를 주고받으며, n8n은 MCP로 연결합니다. 운영 서버와 운영 RDS에는 직접 연결하지 않습니다.

**예상 소요 시간**: 처음 1회 약 2\~3시간. 마지막 PHASE 8 점검표로 모든 연동을 하나씩 확인합니다.

## 1. 시작 전 확인

아래 표의 정보를 미리 찾아 메모장에 적어 두면, 중간에 멈추지 않고 끝까지 갈 수 있습니다.

**1-1. 미리 적어 둘 정보**

| 정보 | 어디서 찾나 | 예시 | 쓰는 곳 |
| --- | --- | --- | --- |
| AWS 콘솔 관리자 로그인 | AWS 계정 | 루트가 아닌 관리자 IAM 사용자 | PHASE 1 |
| CodeCommit 저장소 이름·리전 | AWS 콘솔 → CodeCommit → 리포지토리 | `sgb-core` 외 3개, 서울(ap-northeast-2) | PHASE 3 |
| Java 버전 | `sgb-core`의 `build.gradle` 또는 `pom.xml` | 17 또는 21 | PHASE 4 |
| DB 종류와 버전 | AWS 콘솔 → RDS → 데이터베이스 → 엔진 | PostgreSQL 16 또는 MySQL 8 | PHASE 4 |
| 비밀값 파일 위치 | 내 PC 프로젝트 폴더 또는 운영 서버 | `.env`, `application-local.yml` | PHASE 4 |
| n8n MCP 주소와 인증 토큰 | 자동화 서버의 n8n 설정 화면 | `https://n8n.내도메인/mcp/...` | PHASE 6 |
| 데스크톱 앱에 등록한 MCP 서버 목록 | 데스크톱 앱 설정 → 개발자(Developer) | 서버 이름과 실행 명령 | PHASE 6 |

**1-2. 준비물 체크**

- [ ] Claude Max 요금제 로그인 가능
- [ ] AWS 콘솔에서 EC2·IAM 메뉴를 쓸 수 있는 관리자 권한
- [ ] CodeCommit에 저장소 4개가 보임
- [ ] 휴대폰에 Claude 앱 설치, 같은 계정으로 로그인
- [ ] 내 PC에서 PowerShell(Windows) 또는 터미널(Mac)을 열 수 있음

**1-3. 하면 안 되는 것 (중요)**

- **운영 서버(EC2)에 Claude Code를 설치하지 마세요.** 실수로 운영 파일이나 서비스를 바꿀 수 있습니다. 반드시 새 개발 서버에서 작업합니다.
- **개발 서버에서 운영 RDS에 쓰기 접속을 하지 마세요.** 개발용 DB는 개발 서버 안에 따로 만듭니다. (PHASE 4)
- **운영 배포는 지금처럼 태그 → 스테이징 → 대표 승인 → 운영 순서를 지킵니다.** 개발 서버에서 운영으로 바로 배포하지 않습니다.
- **이미 개발 서버를 만들어 두셨다면** PHASE 1의 1-1\~1-3을 건너뛰고, 1-4(IAM 역할 부착)부터 확인하세요.

## PHASE 0. 데스크톱 작업물 누락·누출 방지 (가장 먼저)

데스크톱 Claude Code(Code 탭)와 Cowork로 한 작업은 대부분 **내 PC 안에만** 저장됩니다. 서버로 옮기기 전에 **보존 → 점검 → 묶기 → 옮기기 → 확인** 5단계를 거치면 빠지는 것이 없습니다. PC의 원본은 서버 확인이 끝난 뒤에도 **2주간 지우지 않습니다.**

### 0-1. 내 PC에만 있는 작업물 목록

| 번호 | 작업물 | PC 안 위치 | 서버로 저절로 가나 | 위험 | 옮기는 방법 |
| --- | --- | --- | --- | --- | --- |
| 1 | 커밋 안 한 코드, push 안 한 브랜치 | 프로젝트 폴더 | 안 감 | 높음 | 0-4 |
| 2 | 데스크톱 병렬 세션 작업 공간(worktree) | 프로젝트 폴더 `.claude/worktrees/` | 안 감 | 높음 | 0-4 (커밋 후 묶기) |
| 3 | 임시 보관(stash) | 저장소 안 | 안 감 | 중간 | 0-4 (브랜치로 꺼내기) |
| 4 | 비밀값·로컬 설정 (`.env`, `application-local.yml`) | 프로젝트 폴더 (Git이 무시) | 안 감 | 높음 | PHASE 4-4 |
| 5 | 데스크톱 "로컬 환경 변수" | 데스크톱 앱 안 (암호화 저장) | 안 감 | 중간 | 화면에서 보고 서버 `.env`에 다시 입력 |
| 6 | 자동 메모리 (Claude가 스스로 적은 메모) | `~/.claude/projects/<프로젝트>/memory/` | **안 감 (PC 전용)** | 높음 | 0-5 |
| 7 | 대화 기록 | `~/.claude/projects/<프로젝트>/*.jsonl` | 안 감, **30일 지나면 자동 삭제** | 높음 | 0-2 + 0-5 |
| 8 | 개인 지침·스킬·에이전트·명령 | `~/.claude/` 안 `CLAUDE.md`, `skills/`, `agents/`, `commands/`, `rules/` | 계정에서 켠 스킬만 자동 | 중간 | 0-5 |
| 9 | 프로젝트 개인 설정 | `.claude/settings.local.json`, `CLAUDE.local.md` | 안 감 (Git 제외) | 낮음 | 0-5 |
| 10 | MCP 서버 설정 | `~/.claude.json`, `claude_desktop_config.json` | 안 감 | 중간 | PHASE 6-2 |
| 11 | 데스크톱 예약 작업 | 데스크톱 앱 (PC에서 실행) | 안 감 | 중간 | 목록을 적고 서버에서 다시 설정 |
| 12 | Cowork 결과물 (kit zip/tar) | Cowork 연결 폴더 | 안 감 | 높음 | PHASE 5-4 |
| 13 | 프로젝트 결정 기록 (데스크톱 프로젝트 메모리·자료) | claude.ai 계정 | 터미널에서 안 보임 | 높음 | PHASE 5-3 |
| 14 | 아티팩트 | claude.ai 계정 | 같은 계정이면 `/artifacts`로 보임 | 낮음 | 링크 목록만 `sgb-docs`에 |

### 0-2. 지금 바로: 대화 기록 자동 삭제 막기 (내 PC)

Claude Code는 대화 기록을 기본 **30일** 뒤 지웁니다. 옮기기 전에 지워지지 않도록 PC의 설정 파일을 엽니다.

- Windows: `C:\Users\내이름\.claude\settings.json` (메모장으로 열기)
- Mac: `~/.claude/settings.json`

아래 두 줄을 넣습니다. 파일에 다른 내용이 있으면 중괄호 `{ }` 안에 합칩니다.

```json
{
  "cleanupPeriodDays": 365,
  "desktopSessionCleanupPeriodDays": 365
}
```

이미 지워진 기록은 되살릴 수 없으므로 **오늘 바로** 하세요.

### 0-3. 점검 스크립트 실행 (내 PC)

아래 스크립트가 PC의 소개뱅크 폴더를 훑어 "빠질 수 있는 것" 목록을 바탕화면에 파일로 만듭니다. 비밀값 내용은 기록하지 않고 **파일 이름과 서버 이름만** 적습니다.

**Windows**: 메모장에 붙여 넣고 `sgb-inventory.ps1`로 저장합니다. 저장할 때 인코딩을 UTF-8(BOM 있음)으로 골라야 한글이 깨지지 않습니다.

```powershell
param([string]$Root = "$HOME\sogaebank")   # 내 PC의 소개뱅크 폴더로 바꾸기
$out = "$HOME\Desktop\sgb-inventory-$env:COMPUTERNAME-$(Get-Date -Format yyyyMMdd-HHmm).txt"
function W($t) { Add-Content -Path $out -Value $t -Encoding utf8 }
W "=== 소개뱅크 데스크톱 작업물 점검 $(Get-Date) ==="
$repos = Get-ChildItem $Root -Recurse -Force -Depth 5 -Filter .git -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  ForEach-Object { Split-Path $_.FullName -Parent } | Sort-Object -Unique
foreach ($r in $repos) {
  W "`n##### 저장소: $r"
  W "[1] 커밋 안 한 변경 (비어 있어야 정상)";  W (git -C $r status --porcelain | Out-String)
  W "[2] push 안 한 커밋 (비어 있어야 정상)";  W (git -C $r log --branches --not --remotes --oneline | Out-String)
  W "[3] 브랜치 추적 상태";                   W (git -C $r branch -vv | Out-String)
  W "[4] stash (비어 있어야 정상)";           W (git -C $r stash list | Out-String)
  W "[5] worktree 목록";                       W (git -C $r worktree list | Out-String)
  W "[6] Git이 무시하는 중요 파일 (따로 옮길 후보)"
  W (git -C $r ls-files --others --ignored --exclude-standard |
     Select-String -Pattern '\.env|application-.*\.(yml|yaml|properties)$|\.pem$|\.key$|secret|credential' | Out-String)
  W "[7] 원격 주소";                           W (git -C $r remote -v | Out-String)
}
$c = "$HOME\.claude"
W "`n##### Claude Code 자산 (PC 전용)"
W "[8] 자동 메모리"
Get-ChildItem "$c\projects" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $m = Join-Path $_.FullName 'memory'
  if (Test-Path $m) { W ("  " + $_.Name + " : " + (Get-ChildItem $m -File).Count + "개 파일") } }
W "[9] 대화 기록"
Get-ChildItem "$c\projects" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $j = Get-ChildItem $_.FullName -Filter *.jsonl -File
  if ($j) { W ("  " + $_.Name + " : " + $j.Count + "개, 가장 오래된 것 " + ($j | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime) } }
W "[10] 개인 설정·스킬"
foreach ($p in 'CLAUDE.md','settings.json','skills','agents','commands','rules','workflows') { W ("  " + $p + " : " + (Test-Path "$c\$p")) }
W "[11] 개인 MCP 서버 이름"
if (Test-Path "$HOME\.claude.json") { W (((Get-Content "$HOME\.claude.json" -Raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name) -join ', ') }
W "[12] 데스크톱 앱 MCP 서버 이름"
$d = "$env:APPDATA\Claude\claude_desktop_config.json"
if (Test-Path $d) { W (((Get-Content $d -Raw | ConvertFrom-Json).mcpServers.PSObject.Properties.Name) -join ', ') }
Write-Host "완료: $out"
```

실행 (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\sgb-inventory.ps1 -Root "C:\내 소개뱅크 폴더"
```

**Mac**: 아래를 `sgb-inventory.sh`로 저장한 뒤 `bash sgb-inventory.sh ~/내소개뱅크폴더`로 실행합니다.

```bash
#!/usr/bin/env bash
ROOT="${1:-$HOME/sogaebank}"
OUT="$HOME/Desktop/sgb-inventory-$(hostname -s)-$(date +%Y%m%d-%H%M).txt"
{
echo "=== 소개뱅크 데스크톱 작업물 점검 $(date) ==="
find "$ROOT" -maxdepth 5 -name .git -not -path '*/node_modules/*' 2>/dev/null | while read -r g; do
  r="$(dirname "$g")"; echo; echo "##### 저장소: $r"
  echo "[1] 커밋 안 한 변경";  git -C "$r" status --porcelain
  echo "[2] push 안 한 커밋";  git -C "$r" log --branches --not --remotes --oneline
  echo "[3] 브랜치 추적 상태"; git -C "$r" branch -vv
  echo "[4] stash";            git -C "$r" stash list
  echo "[5] worktree";         git -C "$r" worktree list
  echo "[6] Git이 무시하는 중요 파일"
  git -C "$r" ls-files --others --ignored --exclude-standard | grep -Ei '\.env|application-.*\.(yml|yaml|properties)$|\.pem$|\.key$|secret|credential'
  echo "[7] 원격 주소";        git -C "$r" remote -v
done
C="$HOME/.claude"; echo; echo "##### Claude Code 자산 (PC 전용)"
echo "[8] 자동 메모리"; for m in "$C"/projects/*/memory; do [ -d "$m" ] && echo "  $m : $(ls "$m" | wc -l)개"; done
echo "[9] 대화 기록";   for d in "$C"/projects/*/; do n=$(ls "$d"*.jsonl 2>/dev/null | wc -l); [ "$n" -gt 0 ] && echo "  $d : ${n}개"; done
echo "[10] 개인 설정·스킬"; for p in CLAUDE.md settings.json skills agents commands rules workflows; do [ -e "$C/$p" ] && echo "  $p 있음"; done
echo "[11] 개인 MCP 서버 이름"
python3 -c "import json,os;print(list(json.load(open(os.path.expanduser('~/.claude.json'))).get('mcpServers',{})))" 2>/dev/null
echo "[12] 데스크톱 앱 MCP 서버 이름"
python3 -c "import json,os;print(list(json.load(open(os.path.expanduser('~/Library/Application Support/Claude/claude_desktop_config.json'))).get('mcpServers',{})))" 2>/dev/null
} > "$OUT" 2>&1
echo "완료: $OUT"
```

**결과 읽는 법**

| 항목 | 정상 | 무언가 나오면 |
| --- | --- | --- |
| \[1\] 커밋 안 한 변경 | 비어 있음 | 0-4에서 커밋 |
| \[2\] push 안 한 커밋 | 비어 있음 | 0-4에서 묶어서 옮기기 |
| \[3\] 브랜치 추적 상태 | 모든 브랜치 옆에 `[origin/...]` | `[...]`가 없는 브랜치 = PC에만 있음 → 0-4 |
| \[4\] stash | 비어 있음 | 0-4에서 브랜치로 꺼내기 |
| \[5\] worktree | 기본 폴더 1줄만 | 추가 줄마다 그 폴더에서 커밋 (0-4) |
| \[6\] 중요 파일 | 목록 확인 | PHASE 4-4로 서버에 직접 복사 |
| \[8\]\~\[12\] | 목록 확인 | 0-5, PHASE 6-2로 옮기기 |

### 0-4. 코드 옮기기: 커밋 → 묶음(bundle) → 서버

`git bundle`은 저장소의 모든 브랜치와 기록을 파일 1개로 묶는 기능입니다. PC에 CodeCommit 권한이 없어도 옮길 수 있습니다. 먼저 **서버에서** `mkdir -p ~/migrate`를 실행해 둡니다.

**PC에서** (점검 결과에 나온 저장소마다, Windows·Mac 공통 명령)

```bash
cd "내 PC의 저장소 폴더"
git status                          # [6]의 비밀 파일이 목록에 없는지 먼저 확인
git switch -c wip/desktop-20261013  # 보관용 브랜치 만들기
git add -A
git commit -m "wip: 데스크톱 작업 보관"
# stash가 있었다면: git stash branch wip/stash-1  → 다시 git add -A, git commit
# worktree가 있었다면: 그 폴더로 이동해 git add -A, git commit (브랜치는 이미 있음)
git bundle create ../sgb-core.bundle --all     # 저장소 이름에 맞게
scp ../sgb-core.bundle sgb-dev:~/migrate/
```

- `git add -A`는 Git이 무시하지 않는 모든 파일을 담습니다. **반드시 `git status`로 `.env`나 열쇠 파일이 없는지 본 뒤** 실행하세요.
- PC 폴더가 Git 저장소가 아니라면 폴더를 zip이나 tar로 묶어 보내고, PHASE 5-4처럼 Claude에게 비교·반영을 맡깁니다.

**서버에서** (묶음을 "desktop"이라는 이름으로 불러와 비교)

```bash
cd ~/sogaebank/sgb-core
git fetch ~/migrate/sgb-core.bundle 'refs/heads/*:refs/remotes/desktop/*'
git branch -r | grep desktop/                         # PC에서 온 브랜치 목록
git log --oneline origin/main..desktop/wip/desktop-20261013   # CodeCommit에 없는 커밋
```

그다음 서버의 Claude에게 요청합니다.

```text
sgb-core의 desktop/ 원격 브랜치들 중 CodeCommit(origin)에 없는 커밋을 표로 정리해 줘.
비밀값이 섞였는지 검사하고, CodeCommit에 올릴 브랜치와 이름을 제안해 줘.
올리기 전에 내 승인을 받아 줘.
```

승인한 브랜치는 이렇게 올립니다: `git push origin desktop/wip/desktop-20261013:refs/heads/wip/desktop-20261013`

### 0-5. Git 밖 자산 옮기기 (자동 메모리 · 대화 기록 · 개인 스킬)

**PC에서 묶기 (Windows PowerShell)**: 폴더 이름에 `sogae` 또는 `sgb`가 들어간 프로젝트만 담습니다. 다른 사업 프로젝트는 빠집니다.

```powershell
$c = "$HOME\.claude"; $pack = "$HOME\Desktop\sgb-claude-pack"
New-Item -ItemType Directory -Force $pack | Out-Null
foreach ($p in 'CLAUDE.md','skills','agents','commands','rules','workflows') {
  if (Test-Path "$c\$p") { Copy-Item "$c\$p" $pack -Recurse -Force } }
Get-ChildItem "$c\projects" -Directory | Where-Object { $_.Name -match 'sogae|sgb' } | ForEach-Object {
  $dst = "$pack\projects\$($_.Name)"; New-Item -ItemType Directory -Force $dst | Out-Null
  Copy-Item "$($_.FullName)\memory" $dst -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item "$($_.FullName)\*.jsonl" $dst -Force -ErrorAction SilentlyContinue }
Compress-Archive -Path "$pack\*" -DestinationPath "$HOME\Desktop\sgb-claude-pack.zip" -Force
scp "$HOME\Desktop\sgb-claude-pack.zip" sgb-dev:~/migrate/
```

**Mac**: `cd ~/.claude && zip -r ~/Desktop/sgb-claude-pack.zip CLAUDE.md skills agents commands rules projects/*sogae*/ projects/*sgb*/ 2>/dev/null; scp ~/Desktop/sgb-claude-pack.zip sgb-dev:~/migrate/`

**서버에서 풀기와 반영**

```bash
cd ~/migrate && unzip -q sgb-claude-pack.zip -d claude-pack && chmod -R go-rwx ~/migrate
cp -rn claude-pack/skills claude-pack/agents claude-pack/commands ~/.claude/ 2>/dev/null   # 기존 파일은 덮어쓰지 않음
```

| 자산 | 서버에서 하는 일 |
| --- | --- |
| 개인 스킬·에이전트·명령 | 위 `cp` 명령으로 복사 완료. Claude 안에서 `/` 입력해 목록 확인 |
| 개인 지침 `CLAUDE.md` | 내용을 읽어 보고 필요하면 `cp claude-pack/CLAUDE.md ~/.claude/CLAUDE.md` |
| 자동 메모리 | Claude에게 "\~/migrate/claude-pack/projects/\*/memory 를 읽고 CLAUDE.md나 sgb-docs/decisions에 반영할 내용을 표로 제안해 줘" → 확인 후 승인 |
| 대화 기록 | 이어 가고 싶은 대화를 `claude --resume /home/ubuntu/migrate/claude-pack/projects/<폴더>/<세션ID>.jsonl`로 엽니다. 첫 메시지로 "이제 작업 위치는 서버의 \~/sogaebank 입니다"라고 알려 주세요 |

- 대화 기록에는 Claude가 읽은 내용이 **그대로(암호화 없이)** 남아 있습니다. `~/migrate`는 저장소 밖에 두고, 절대 커밋하지 마세요.

### 0-6. 누출 방지 검사 (서버, CodeCommit에 올리기 전)

PC에서 온 브랜치나 kit에 비밀값이 섞이지 않았는지 검사합니다. **두 명령 모두 아무것도 나오지 않아야** 올립니다.

```bash
cd ~/sogaebank/sgb-core
B=desktop/wip/desktop-20261013      # 검사할 브랜치
git diff --name-only origin/main..$B | grep -Ei '\.env|\.pem|\.key|secret|credential|application-local'
git log -p origin/main..$B | grep -nE 'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|(password|secret|api[_-]?key)["'"'"' ]*[:=][ ]*[^ ]{6,}' | head -50
```

- 무언가 나오면 올리지 말고, Claude에게 "이 브랜치에서 비밀값을 기록째 제거해 줘"라고 요청합니다. 아직 CodeCommit에 올리기 전이므로 기록을 고쳐도 안전합니다.
- 그 키가 이미 다른 곳(메신저, 공개 저장소 등)에 나간 적이 있다면 키를 새로 발급(교체)하세요.
- 테스트용 가짜 값 때문에 걸리는 경우도 있으니, 걸린 줄을 직접 확인합니다.

### 0-7. 이관 확인표

| 확인 | 방법 | 정상 결과 |
| --- | --- | --- |
| PC에 남은 변경 없음 | wip 커밋 후 점검 스크립트 다시 실행 | \[1\] \[2\] \[4\]가 비어 있음 |
| 모든 브랜치 이관 | PC `git branch` 개수와 서버 `git branch -r \| grep desktop/` 개수 비교 | 같음 |
| 최신 커밋 일치 | PC `git rev-parse 브랜치`와 서버 `git rev-parse desktop/브랜치` 비교 | 같은 값 |
| 비밀값 누출 없음 | 0-6 검사 | 아무것도 안 나옴 |
| 자동 메모리 반영 | `sgb-docs`에 반영 커밋 확인 | 커밋 있음 |
| 대화 이어가기 | 중요한 대화 1개를 `--resume`으로 열기 | 이전 대화가 보임 |
| 개인 스킬 | 서버 Claude에서 `/` 입력 | 데스크톱에서 쓰던 스킬이 보임 |
| 예약 작업 | 데스크톱 예약 작업 목록과 대조 | 서버에 다시 설정됨 |
| 비밀값·로컬 환경 변수 | 서버 앱 실행 (PHASE 4-5) | 정상 실행 |

### 0-8. 이관 기간 규칙

1. 이관을 시작해서 0-7 확인이 끝날 때까지 **데스크톱 Code 탭에서 코드를 고치지 않습니다.** 두 곳에서 고치면 충돌이 납니다.
2. 확인이 끝나면 코드는 서버, 데스크톱은 기획·문서·Cowork 용도로 나눠 씁니다.
3. PC의 원본 폴더와 `~/.claude`는 **2주간 그대로 보관**한 뒤 정리합니다.

### 0-9. PC를 2대 이상 썼다면

**두 PC 모두 0-2\~0-7을 각각 해야 합니다.** 작업 폴더와 Claude Code 기록(자동 메모리, 대화 기록, 개인 스킬)은 PC마다 따로 저장되고, 두 PC끼리도 서로 공유되지 않습니다. 반면 claude.ai 계정에 있는 것은 한 번만 하면 됩니다.

| 데스크톱 앱 위치 | 같은 계정이면 두 PC에서 함께 보이나 | 할 일 |
| --- | --- | --- |
| Chat 탭: 채팅·프로젝트·결정 기록·아티팩트 | 보임 (계정에 저장) | 한 번만 (PHASE 5-3) |
| Customize: 계정 스킬·플러그인·커넥터 | 보임 (계정 동기화) | 한 번만 (PHASE 6-1) |
| Cowork 탭: 대화(세션) | 보임 (계정에 저장, 웹·모바일에서도) | 한 번만 확인 |
| Cowork 탭: 연결 폴더에 저장된 결과 파일 (kit 등) | 안 보임 (그 PC 폴더에만) | 두 PC 모두 |
| Code 탭: 세션 목록·대화 기록·자동 메모리 | 안 보임 (그 PC의 `~/.claude`에만) | 두 PC 모두 |
| Code 탭: 로컬 환경 변수 | 안 보임 (그 PC에 암호화 저장) | 두 PC 모두 |
| Code 탭: 로컬 예약 작업 (Routines → Local) | 안 보임 (`~/.claude/scheduled-tasks/`, 그 PC에서만 실행) | 두 PC 모두 |
| Code 탭: 원격 루틴 (Routines → Remote) | 보임 (클라우드 실행) | 한 번만 확인 |
| 작업 폴더의 코드·worktree·`.env`, MCP 설정 | 안 보임 | 두 PC 모두 |

**확인 요령**: 한 PC의 데스크톱 앱에서 다른 PC로 한 작업이 목록에 보이면 계정에 저장된 것이고, 보이지 않으면 그 PC에만 있는 것입니다.

**1단계. PC에 이름 붙이기**

두 PC를 `pcA`, `pcB`로 부르기로 하고, 메모장에 어느 PC가 어느 이름인지 적어 둡니다 (예: pcA = 사무실, pcB = 집). 아래 이름 규칙만 지키면 서버에서 섞이지 않습니다.

| 대상 | pcA | pcB |
| --- | --- | --- |
| 보관용 브랜치 | `wip/pcA-20261013` | `wip/pcB-20261013` |
| 저장소 묶음 (서버에 저장할 이름) | `sgb-core-pcA.bundle` | `sgb-core-pcB.bundle` |
| Claude 자산 묶음 | `sgb-claude-pack-pcA.zip` | `sgb-claude-pack-pcB.zip` |
| kit 폴더 (서버) | `~/kits/pcA/` | `~/kits/pcB/` |

점검 스크립트(0-3) 결과 파일 이름에는 PC 이름이 자동으로 붙습니다.

**2단계. 각 PC에서 보낼 때 이름만 바꾸기**

0-4, 0-5를 그대로 하되, 마지막 `scp` 줄의 받는 쪽 이름에 PC 이름을 붙입니다. `scp`는 보내면서 이름을 바꿀 수 있습니다. (아래는 pcA 예시, pcB는 `pcA`를 `pcB`로)

```bash
git switch -c wip/pcA-20261013
git add -A && git commit -m "wip: pcA 데스크톱 작업 보관"
git bundle create ../sgb-core.bundle --all
scp ../sgb-core.bundle sgb-dev:~/migrate/sgb-core-pcA.bundle
scp "$HOME/Desktop/sgb-claude-pack.zip" sgb-dev:~/migrate/sgb-claude-pack-pcA.zip
```

kit 파일은 먼저 서버에서 `mkdir -p ~/kits/pcA ~/kits/pcB`를 실행한 뒤 PC별 폴더로 보냅니다: `scp ./kit파일.tar sgb-dev:~/kits/pcA/`

**3단계. 서버에서 두 PC 작업 불러와 비교하기**

```bash
cd ~/sogaebank/sgb-core
git fetch ~/migrate/sgb-core-pcA.bundle 'refs/heads/*:refs/remotes/pcA/*'
git fetch ~/migrate/sgb-core-pcB.bundle 'refs/heads/*:refs/remotes/pcB/*'
git branch -r | grep -E 'pcA/|pcB/'          # 두 PC에서 온 브랜치 목록

# 각 PC에만 있는 커밋
git log --oneline origin/main..pcA/wip/pcA-20261013
git log --oneline origin/main..pcB/wip/pcB-20261013

# 두 PC가 함께 고친 파일 (나오는 파일 = 충돌 후보)
comm -12 <(git diff --name-only origin/main...pcA/wip/pcA-20261013 | sort) \
         <(git diff --name-only origin/main...pcB/wip/pcB-20261013 | sort)
```

마지막 명령에서 파일이 나오면 두 PC가 같은 파일을 서로 다르게 고친 것입니다. 이때는 어느 한쪽을 그냥 덮어쓰지 말고, 서버의 Claude에게 합치기를 맡깁니다.

```text
~/sogaebank/sgb-core 에 PC 2대에서 온 브랜치(pcA/, pcB/)가 있어.
1) 각 PC에만 있는 커밋 표
2) 두 PC가 함께 고친 파일과 차이
3) 파일마다 어느 쪽이 더 최신·완전한지와 그 근거
4) 합치는 계획
을 먼저 보여 줘. 비밀값이 섞였는지도 검사해 줘.
합치기는 feature/merge-pcs 브랜치에서 내 승인 후에 해 줘.
~/kits/pcA 와 ~/kits/pcB 의 kit도 같은 방식으로 비교해 줘.
```

**4단계. Claude 자산(자동 메모리·대화 기록·스킬) 합치기**

```bash
cd ~/migrate
unzip -q sgb-claude-pack-pcA.zip -d claude-pack/pcA
unzip -q sgb-claude-pack-pcB.zip -d claude-pack/pcB
chmod -R go-rwx ~/migrate
diff -rq claude-pack/pcA/skills claude-pack/pcB/skills    # 같은 이름인데 내용이 다른 스킬 확인
```

그다음 Claude에게 요청합니다: "\~/migrate/claude-pack/pcA 와 pcB 의 자동 메모리를 비교해서, 겹치는 것과 서로 다른 것을 표로 정리하고 CLAUDE.md·sgb-docs/decisions 반영안을 제안해 줘." 스킬은 내용이 다른 것만 골라 확인 후 `~/.claude/skills/`에 넣습니다.

**5단계. 두 PC 모두 확인**

- [ ] pcA, pcB 모두 0-2 보존 기간 365일 설정
- [ ] pcA, pcB 모두 wip 커밋 후 점검 스크립트 재실행 → \[1\] \[2\] \[4\]가 비어 있음
- [ ] 서버에 `pcA/`, `pcB/` 브랜치가 모두 보임
- [ ] 함께 고친 파일은 Claude 합치기 계획을 승인한 뒤 반영
- [ ] 두 PC의 데스크톱 로컬 환경 변수·예약 작업을 각각 확인 (서로 다를 수 있음)
- [ ] 이관이 끝날 때까지 **두 PC 모두** 코드 수정 중지

**참고**: 두 PC의 작업 폴더를 OneDrive나 Google 드라이브로 동기화해 썼다면 작업 폴더는 사실상 하나입니다. 이 경우 코드는 한 PC에서만 묶으면 됩니다. 그래도 `~/.claude` 폴더는 동기화되지 않으므로 0-2와 0-5는 두 PC 모두 해야 합니다.

## PHASE 1. 개발 작업 서버 준비

이 단계가 끝나면 CodeCommit을 비밀번호 없이 쓸 수 있는 개발 서버 `sgb-dev`가 생기고, 내 PC에서 접속할 수 있게 됩니다. 예상 시간 30분.

### 1-1. IAM 역할 만들기 (서버에 AWS 권한 주기)

IAM 역할은 "이 서버는 CodeCommit을 써도 된다"는 출입증입니다. 이 방식을 쓰면 서버에 AWS 비밀 키를 저장하지 않아도 됩니다.

1. AWS 콘솔 검색창에 `IAM` → **역할** → **역할 생성**.
2. 신뢰할 수 있는 엔터티 유형: **AWS 서비스**, 사용 사례: **EC2** → 다음.
3. 권한 정책에서 아래 2개를 검색해 체크합니다.
   - `AWSCodeCommitPowerUser` — 저장소 읽기·쓰기 (저장소 삭제는 불가)
   - `AmazonSSMManagedInstanceCore` — Session Manager(브라우저 접속) 사용, 선택이지만 권장
4. 역할 이름 `sgb-dev-role` → **역할 생성**.

### 1-2. EC2 서버 만들기

1. 콘솔 오른쪽 위 리전이 아시아 태평양(서울)인지 확인 → 검색창 `EC2` → **인스턴스 시작**.
2. 아래 표대로 입력합니다.

| 항목 | 입력값 | 이유 |
| --- | --- | --- |
| 이름 | `sgb-dev` | 운영 서버와 구분 |
| OS 이미지 | Ubuntu Server 24.04 LTS | Claude Code 지원 OS |
| 인스턴스 유형 | t3.large (메모리 8GB) | Claude + Spring Boot 빌드 + 개발 DB |
| 키 페어 | 새로 생성 → `sgb-dev-key`, RSA, `.pem` | 접속 열쇠 (다시 받을 수 없음) |
| 네트워크 설정 | "SSH 트래픽 허용" 체크, 소스 **내 IP** | 나만 접속 |
| 스토리지 | 40 GiB, gp3 | 저장소 4개 + 빌드 + DB |
| 고급 세부 정보 → IAM 인스턴스 프로파일 | `sgb-dev-role` | 1-1에서 만든 출입증 연결 |

3. **인스턴스 시작** → "실행 중"이 되면 **퍼블릭 IPv4 주소**를 메모합니다.

이미 서버가 있다면: EC2 → 인스턴스 선택 → **작업 → 보안 → IAM 역할 수정** → `sgb-dev-role` 선택 → 저장.

### 1-3. 내 PC에서 접속하기

**Windows (PowerShell)**

```powershell
mkdir $env:USERPROFILE\.ssh -Force
Move-Item $env:USERPROFILE\Downloads\sgb-dev-key.pem $env:USERPROFILE\.ssh\
icacls $env:USERPROFILE\.ssh\sgb-dev-key.pem /inheritance:r
icacls $env:USERPROFILE\.ssh\sgb-dev-key.pem /grant:r "$($env:USERNAME):(R)"
```

**Mac (터미널)**

```bash
mkdir -p ~/.ssh
mv ~/Downloads/sgb-dev-key.pem ~/.ssh/
chmod 400 ~/.ssh/sgb-dev-key.pem
```

**접속 별명 만들기 (Windows·Mac 공통)**: 내 PC의 `.ssh` 폴더에 `config` 파일(확장자 없음)을 만들고 아래 내용을 넣습니다. Windows는 경로를 `C:/Users/내이름/.ssh/sgb-dev-key.pem` 형식으로 씁니다.

```text
Host sgb-dev
    HostName <퍼블릭 IPv4 주소>
    User ubuntu
    IdentityFile ~/.ssh/sgb-dev-key.pem
    ServerAliveInterval 60
```

이제 `ssh sgb-dev`로 접속합니다. 처음에 `yes/no`를 물으면 `yes`. 맨 아래 줄이 `ubuntu@ip-...:~$`로 바뀌면 성공이고, 이후 명령은 **서버에서** 실행됩니다.

### 1-4. 기본 도구 설치 (서버에서)

```bash
# 업데이트 + 기본 도구 (git, tmux, 압축 도구, pipx)
sudo apt update && sudo apt upgrade -y
sudo apt install -y git tmux curl unzip zip tar pipx

# 한국 시간
sudo timedatectl set-timezone Asia/Seoul

# 메모리 부족 대비 스왑 2GB
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

- 중간에 보라색 화면이 뜨면 **Enter**를 누르면 됩니다.
- `zip`과 `tar`는 소개뱅크 kit을 zip·tar 두 형식으로 만드는 데 필요합니다.

### 1-5. AWS CLI 설치와 권한 확인 (서버에서)

```bash
cd ~
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip
aws --version
aws configure set region ap-northeast-2
aws sts get-caller-identity
```

- 마지막 명령 결과의 `Arn`에 `sgb-dev-role`이 보이면 출입증이 연결된 것입니다.
- `aws configure`로 **액세스 키를 입력하지 마세요.** 역할이 자동으로 권한을 줍니다.
- ARM 인스턴스(t4g 등)를 골랐다면 주소의 `x86_64`를 `aarch64`로 바꿉니다.

## PHASE 2. Claude Code 설치·로그인과 계정 연동

이 단계가 끝나면 서버에서 `claude`가 동작하고, 데스크톱 앱과 **같은 Claude 계정**으로 연결됩니다. 같은 계정으로 로그인하면 claude.ai에 등록한 커넥터와 스킬도 서버에서 함께 쓸 수 있습니다.

### 2-1. 설치하기

```bash
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
claude --version     # 버전 번호가 나오면 성공
claude doctor        # 설치 상태 자동 진단
```

이 방식은 자동으로 업데이트됩니다. `claude: command not found`가 나오면 `exit`로 나갔다가 다시 `ssh sgb-dev`로 접속하세요.

### 2-2. 로그인하기 (서버에는 브라우저가 없으므로 PC 브라우저 사용)

1. 서버에서 `claude`를 입력합니다.
2. 화면 색상(테마)을 고르고 Enter.
3. 로그인 방법은 **Claude 계정(구독)** 항목을 고릅니다. API 키 항목이 아닙니다.
4. 긴 로그인 주소가 나오면 키보드 `c`를 눌러 복사합니다.
5. 내 PC 브라우저에 붙여 넣고, 데스크톱 앱과 같은 계정으로 로그인한 뒤 **승인**합니다.
6. 브라우저에 나온 **코드**를 복사해 서버 터미널의 `Paste code here if prompted` 칸에 붙여 넣고 Enter.
7. 폴더 신뢰 질문은 내 폴더일 때만 **Yes**.

Windows에서 붙여 넣기가 안 되면 **마우스 오른쪽 클릭** 또는 **Shift + Insert**를 쓰고, 그래도 안 되면 `/exit` 후 `claude auth login`으로 다시 합니다.

### 2-3. 계정 연동 확인하기

Claude 입력창에서 아래를 차례로 입력합니다.

| 입력 | 정상이면 보이는 것 | 의미 |
| --- | --- | --- |
| `/status` | 로그인 방식이 Claude 계정(Max) | 데스크톱과 같은 계정으로 연결됨 |
| `/mcp` | `claude.ai`로 시작하는 커넥터 목록 | claude.ai에 등록한 커넥터가 자동 연동됨 |
| `/skills` 또는 `/` 입력 후 목록 확인 | 내 계정에서 켠 스킬 | 계정 스킬이 동기화됨 |

확인이 끝나면 `/exit`로 나옵니다.

### 2-4. 연동을 막는 설정 (절대 하지 말 것)

아래 중 하나라도 설정되어 있으면 **계정 커넥터 연동과 원격 제어가 모두 꺼집니다.**

- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` 환경 변수
- `claude setup-token`으로 만든 장기 토큰 (`CLAUDE_CODE_OAUTH_TOKEN`)
- AWS Bedrock 연결 설정 (`CLAUDE_CODE_USE_BEDROCK` 등)

확인 명령: `env | grep -E 'ANTHROPIC|CLAUDE_CODE'` → 아무것도 안 나와야 정상입니다.

## PHASE 3. Git 연결 (CodeCommit 저장소 4개)

이 단계가 끝나면 서버의 `~/sogaebank/` 아래에 저장소 4개가 내려받아지고, 서버에서 바로 커밋·push할 수 있습니다. PHASE 1에서 붙인 IAM 역할 덕분에 **Git 비밀번호나 SSH 키를 따로 만들 필요가 없습니다.**

### 3-1. Git 기본 설정 (처음 1회)

```bash
git config --global user.name "박세호"
git config --global user.email "<회사 이메일>"
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global core.editor nano
git config --global --list      # 위 설정이 보이면 성공
```

- `user.name`, `user.email`은 커밋 기록에 남는 작성자 이름입니다.
- `core.editor nano`는 Git이 메시지 입력 창을 열 때 쉬운 편집기를 쓰게 합니다.

### 3-2. CodeCommit 연결 도구 설치

`git-remote-codecommit`은 IAM 역할 권한으로 CodeCommit에 접속하게 해 주는 공식 도구입니다.

```bash
pipx install git-remote-codecommit
pipx ensurepath
source ~/.bashrc
which git-remote-codecommit     # 경로가 나오면 성공
```

Ubuntu 24.04에서는 `pip install`이 막혀 있으므로 `pipx`를 씁니다.

### 3-3. 저장소 4개 내려받기 (clone)

```bash
mkdir -p ~/sogaebank && cd ~/sogaebank
for r in sgb-core sgb-adx sgb-infra sgb-docs; do
  git clone codecommit::ap-northeast-2://$r
done
ls
# sgb-adx  sgb-core  sgb-docs  sgb-infra  가 보이면 성공
```

- 주소 형식 `codecommit::서울리전://저장소이름`은 CodeCommit 콘솔의 **HTTPS (GRC)** 복제 주소와 같은 뜻입니다.
- 저장소 이름이 다르면 CodeCommit 콘솔에서 확인한 이름으로 바꿉니다.

### 3-4. 내려받은 내용 확인

```bash
cd ~/sogaebank/sgb-core
git branch -a          # 브랜치 목록 (* 표시가 현재 브랜치)
git log --oneline -5   # 최근 커밋 5개
git tag | tail -5      # 최근 버전 태그 (예: v1.0.0, v1.0.1)
git remote -v          # origin 이 codecommit:: 주소로 보이면 정상
```

### 3-5. 쓰기(push) 권한 시험하기

배포 파이프라인에 영향이 없도록 문서 저장소에 **임시 브랜치**를 만들어 시험하고 바로 지웁니다.

```bash
cd ~/sogaebank/sgb-docs
git switch -c test/connect-check
echo "dev server connected $(date)" > CONNECT_TEST.md
git add CONNECT_TEST.md
git commit -m "test: 개발 서버 연결 확인"
git push -u origin test/connect-check     # 오류 없이 끝나면 쓰기 권한 정상

# 시험 흔적 지우기
git switch main
git push origin --delete test/connect-check
git branch -D test/connect-check
```

- `main` 대신 다른 기본 브랜치 이름(`master`, `develop` 등)을 쓰고 있다면 3-4에서 본 이름으로 바꿉니다.

### 3-6. 브랜치 사용 규칙 (기존 배포 규칙 유지)

| 하는 일 | 방법 |
| --- | --- |
| 새 작업 시작 | `git switch main && git pull` → `git switch -c feature/작업이름` |
| 작업 저장 | `git add .` → `git commit -m "feat: 내용"` → `git push -u origin feature/작업이름` |
| 기본 브랜치에 합치기 | CodeCommit 콘솔에서 **풀 리퀘스트** 생성 → 검토 후 병합 |
| 운영 배포 | 지금 규칙대로: SemVer 태그 → 스테이징 자동 → 대표 승인 → 운영 |

어떤 브랜치나 태그에 push하면 파이프라인이 자동 실행되는지는 `sgb-infra`의 파이프라인 설정에서 확인이 필요합니다. 확인 전에는 **기본 브랜치에 직접 push하거나 태그를 push하지 마세요.**

### 3-7. Git 기본 명령 요약

| 명령 | 뜻 |
| --- | --- |
| `git status` | 바뀐 파일 보기 |
| `git pull` | 저장소의 최신 내용 받기 (작업 시작 전 항상) |
| `git add 파일` / `git add .` | 저장할 파일 고르기 |
| `git commit -m "메시지"` | 변경 기록 남기기 |
| `git push` | 저장소로 올리기 (하루 끝에 항상) |
| `git log --oneline -10` | 최근 기록 보기 |
| `git switch 브랜치` | 브랜치 바꾸기 |

### 3-8. (선택) GitHub 백업 연결

이전에 말씀하신 "GitHub로 작업 백업"을 하려면, GitHub에 **비공개(Private)** 저장소 4개를 만든 뒤 두 번째 원격 저장소로 추가합니다.

```bash
# 서버 전용 GitHub 키 만들기 → 출력된 한 줄을 GitHub Settings → SSH and GPG keys 에 등록
ssh-keygen -t ed25519 -C "sgb-dev" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
ssh -T git@github.com            # "successfully authenticated" 가 나오면 성공

# 저장소마다 백업 원격 추가 후 전체 브랜치·태그 올리기 (예: sgb-core)
cd ~/sogaebank/sgb-core
git remote add github git@github.com:<GitHub계정>/sgb-core.git
git push github --all && git push github --tags
```

- 백업은 원본이 아닙니다. 작업과 배포는 계속 CodeCommit(`origin`)에서 합니다.
- 자동화 서버에는 이미 저장소를 S3로 백업하는 권한이 있습니다. 두 백업을 모두 할지는 정해 주시면 됩니다.
- GitHub 저장소는 반드시 **Private**로 만드세요. 공개 저장소에 올리면 코드가 외부에 노출됩니다.

## PHASE 4. 실행 환경 연동 (Java · Node · 개발 DB · 비밀값)

이 단계가 끝나면 개발 서버에서 소개뱅크를 빌드·실행·테스트할 수 있습니다. 소개뱅크 작업 규칙(로컬 테스트, DB 연동 테스트, 시안 확인)을 서버에서 그대로 하려면 이 단계가 꼭 필요합니다.

### 4-1. Java 설치 (프로젝트 버전에 맞춰)

먼저 프로젝트가 쓰는 Java 버전을 확인합니다.

```bash
cd ~/sogaebank/sgb-core
grep -rnE "sourceCompatibility|languageVersion|java.version|<release>" build.gradle* pom.xml 2>/dev/null
```

결과에 17이 보이면 17, 21이 보이면 21을 설치합니다.

```bash
sudo apt install -y openjdk-21-jdk     # 17이면 openjdk-17-jdk
java -version
```

빌드 도구는 저장소에 들어 있는 `./gradlew`(또는 `./mvnw`)를 그대로 씁니다. 따로 설치하지 않습니다.

### 4-2. Node.js 설치 (Tailwind CSS 빌드용)

소개뱅크는 Tailwind CSS 적용을 결정했으므로 화면 빌드에 Node.js가 필요할 수 있습니다. 먼저 `package.json`이 있는지 확인합니다.

```bash
find ~/sogaebank -name package.json -not -path "*/node_modules/*"
```

파일이 나오면 Node.js LTS를 설치합니다.

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

### 4-3. 개발용 DB 만들기 (운영 RDS와 분리)

개발 서버 안에 Docker로 운영과 **같은 종류·버전**의 DB를 띄웁니다. 버전은 1-1에서 적어 둔 RDS 엔진 버전에 맞춥니다.

```bash
sudo apt install -y docker.io
sudo usermod -aG docker ubuntu
exit        # 권한 적용을 위해 한 번 나갔다가
```

다시 `ssh sgb-dev`로 접속한 뒤, RDS 엔진에 맞는 하나만 실행합니다.

```bash
# PostgreSQL을 쓰는 경우 (예: 16)
docker run -d --name sgb-db --restart unless-stopped \
  -e POSTGRES_DB=sogaebank -e POSTGRES_USER=sgb -e POSTGRES_PASSWORD='<개발용 비밀번호>' \
  -p 127.0.0.1:5432:5432 -v sgb-db:/var/lib/postgresql/data postgres:16

# MySQL을 쓰는 경우 (예: 8.0)
docker run -d --name sgb-db --restart unless-stopped \
  -e MYSQL_DATABASE=sogaebank -e MYSQL_USER=sgb -e MYSQL_PASSWORD='<개발용 비밀번호>' \
  -e MYSQL_ROOT_PASSWORD='<개발용 루트 비밀번호>' \
  -p 127.0.0.1:3306:3306 -v sgb-db:/var/lib/mysql mysql:8.0

docker ps     # sgb-db 가 Up 상태면 성공
```

- `127.0.0.1`로 묶었기 때문에 이 DB는 서버 밖에서 접속할 수 없습니다. 안전합니다.
- 운영 RDS의 실제 고객 데이터를 개발 DB로 복사하지 마세요. 필요하면 개인정보를 지운 시험 데이터를 씁니다.
- 마이그레이션(현재 43개)은 앱을 개발 설정으로 실행할 때 자동 적용되는지, 별도 명령이 필요한지 `sgb-core` 설정에서 확인이 필요합니다.

### 4-4. 비밀값(.env 등) 안전하게 옮기기

비밀값은 **저장소에 절대 넣지 않고**, 내 PC에서 서버로 직접 복사합니다. 아래는 **내 PC에서** 실행합니다.

```bash
scp ./.env sgb-dev:~/sogaebank/sgb-core/.env
# application-local.yml 같은 설정 파일도 같은 방식으로 복사
```

서버에서 권한을 잠그고, Git이 이 파일을 무시하는지 확인합니다.

```bash
cd ~/sogaebank/sgb-core
chmod 600 .env
git check-ignore -v .env      # .gitignore 규칙이 출력되면 안전
```

- 아무것도 출력되지 않으면 `.gitignore`에 `.env`를 추가하고 커밋한 뒤 다시 확인합니다.
- 개발 서버의 비밀값은 **테스트용 키**(PG 테스트 키, 알림톡 테스트 계정 등)를 쓰고, 운영 키는 넣지 않습니다.
- DB 접속 정보는 4-3에서 만든 개발 DB(`127.0.0.1`)로 바꿉니다.

### 4-5. 빌드·테스트·실행 확인

```bash
cd ~/sogaebank/sgb-core
./gradlew clean build        # BUILD SUCCESSFUL 이 나오면 성공 (Maven은 ./mvnw clean package)
./gradlew test               # 테스트 전체 통과 확인
./gradlew bootRun --args='--spring.profiles.active=local'
```

- 실행 프로필 이름(`local`, `dev` 등)은 `src/main/resources/application-*.yml` 파일 이름으로 확인합니다.
- **내 PC 브라우저로 화면 보기**: 내 PC에서 `ssh -L 8080:localhost:8080 sgb-dev`로 접속해 둔 상태에서 브라우저에 `http://localhost:8080`을 엽니다. 포트를 외부에 열지 않고 시안·화면을 확인할 수 있습니다.
- 실행을 멈출 때는 **Ctrl + C**.

## PHASE 5. 프로젝트 기억·자료 연동

이 단계가 끝나면 서버의 Claude가 데스크톱 프로젝트에서 정한 결정과 작업 규칙을 알고 시작합니다. 데스크톱 채팅 기록은 자동으로 넘어오지 않기 때문에 **꼭 직접 옮겨야 하는 단계**입니다.

### 5-1. 기억 파일 위치 정하기

원본은 `sgb-docs` 저장소에 두고, 작업 폴더 맨 위(`~/sogaebank`)에는 연결(바로가기)만 둡니다. 이렇게 하면 기억 파일도 저장소로 버전 관리됩니다.

```bash
cd ~/sogaebank
mkdir -p sgb-docs/claude sgb-docs/decisions sgb-docs/reference
nano sgb-docs/claude/CLAUDE.md          # 아래 5-2 내용 붙여 넣기
ln -s sgb-docs/claude/CLAUDE.md CLAUDE.md
ls -l CLAUDE.md                         # -> sgb-docs/claude/CLAUDE.md 가 보이면 성공
```

Claude는 `~/sogaebank`에서 실행할 때 이 파일을 자동으로 읽습니다. 4개 저장소를 한 번에 다룰 수 있습니다.

### 5-2. CLAUDE.md 내용 (소개뱅크용 뼈대)

```markdown
# 소개뱅크 (SoGaeBank) 작업 기준

## 저장소 (AWS CodeCommit, 서울)
- sgb-core: 서비스 본체 (Java/Spring Boot)
- sgb-adx: (용도 기입)
- sgb-infra: 인프라·배포 파이프라인 설정
- sgb-docs: 문서·결정 기록·이 파일 원본

## 배포 규칙
- SemVer 태그, 운영 배포는 태그 커밋만
- 스테이징 자동 → 대표 승인 → 운영
- 개발 서버에서 운영으로 직접 배포 금지, 기본 브랜치 직접 push 금지

## 작업 결과물마다 반드시 할 일
- 매트릭스 작성: 화면 목록 · 백엔드 목록 · API 목록 · DB 목록 · 연동 목록
- 기능 검증, 시안 확인(기능 시연이 안 되는 부분 점검)
- 로컬 테스트: 모든 페이지 상호간 체크, 버튼 체크, flow 점검
- 연동 테스트, DB 연동 테스트, 전수검정
- 최종 버전에는 시안 포함
- kit 은 zip 과 tar 두 개로 생성, 디자인 원본 그림은 필요 없으면 kit 밖 별도 묶음

## 현재 상태 주의
- 간주 모드 on: assume.payment · assume.broker · assume.bank (외부 연동 완료 후 off 필수)
- 외부 연동 7건 진행 중, 연동 신청 발신 IP 3.37.95.217
- 운영 도메인 sogaebank.com

## 금지
- .env·비밀키 읽기/커밋 금지, 운영 RDS 접속 금지
- 큰 변경은 계획 먼저 보여 주고 승인 후 진행

## 결정 기록
@decisions/README.md
```

- `sgb-adx` 등 용도를 모르는 칸은 직접 채워 주세요.
- 위 "작업 결과물마다 반드시 할 일"은 데스크톱 프로젝트에서 정해 두신 작업 방식을 그대로 옮긴 것입니다.

### 5-3. 데스크톱 프로젝트의 결정 옮기기

데스크톱 앱 → 채팅 → 소개뱅크 프로젝트에서 아래 문장을 보냅니다.

```text
이 프로젝트에서 지금까지 확정한 결정을 주제별 마크다운 문서로 정리해 줘.
주제: 관 구성·이름, 커뮤니티(소개광장), 구독·소개코드, 법률·세무 정액 노출료,
소개뱅크몰 반품·환불, 약관 발행, 메일(SES), 도메인·DNS, 자동화 서버(n8n),
AI 에이전트, 다국어, Tailwind 적용, 메인 hero 디자인, 오픈 차단 항목, 배포·CI/CD, 사업 주체 정보·운영 방침(열람 한도 등).
각 문서: 결정 내용, 결정 날짜, 이유, 미정 사항. 주제마다 파일 1개로 나눠 줘.
```

받은 파일을 서버의 `sgb-docs/decisions/`에 넣습니다 (내 PC에서 실행).

```bash
scp ./*.md sgb-dev:~/sogaebank/sgb-docs/decisions/
```

그리고 서버의 Claude에게 "decisions 폴더 파일 목록으로 decisions/README.md 목차를 만들어 줘"라고 요청합니다.

### 5-4. 데스크톱 프로젝트 자료와 최신 kit 옮기기

데스크톱 프로젝트 자료에 올려 둔 문서와, 데스크톱에서 만든 최신 kit(zip/tar)이 CodeCommit보다 새로울 수 있습니다. 빠뜨리지 않도록 아래 순서로 확인합니다.

1. 데스크톱 프로젝트 자료 파일을 PC로 내려받아 `sgb-docs/reference/`로 보냅니다: `scp ./자료파일 sgb-dev:~/sogaebank/sgb-docs/reference/`
2. 최신 kit을 서버로 보냅니다: `scp ./sogaebank-kit-v10.xx.tar sgb-dev:~/kits/` (먼저 서버에서 `mkdir -p ~/kits`)
3. 서버의 Claude에게 요청합니다:

```text
~/kits 의 최신 kit을 풀어서 ~/sogaebank 의 4개 저장소와 비교해 줘.
kit에만 있거나 kit이 더 새로운 파일 목록을 표로 보여 주고,
반영 계획을 먼저 보여 줘. 반영은 feature/kit-sync 브랜치에서 해 줘.
```

4. 계획을 확인하고 승인하면 Claude가 브랜치에 반영합니다. 이후 CodeCommit 풀 리퀘스트로 검토 후 병합합니다.

### 5-5. 저장하기

```bash
cd ~/sogaebank/sgb-docs
git switch -c docs/claude-setup
git add claude/ decisions/ reference/
git commit -m "docs: Claude 작업 기준과 결정 기록 추가"
git push -u origin docs/claude-setup
```

CodeCommit 콘솔에서 풀 리퀘스트를 만들어 기본 브랜치에 병합합니다. 확인은 `claude` 실행 후 "CLAUDE.md 읽고 소개뱅크 작업 규칙을 5줄로 요약해 줘"로 합니다.

## PHASE 6. 도구 연동 (커넥터 · MCP 서버 · 스킬 · 권한)

이 단계가 끝나면 데스크톱에서 쓰던 외부 도구를 서버의 Claude도 똑같이 씁니다. 도구는 종류에 따라 **자동으로 따라오는 것**과 **다시 등록해야 하는 것**으로 나뉩니다.

| 도구 종류 | 서버로 오는 방식 | 할 일 |
| --- | --- | --- |
| claude.ai 커넥터 (claude.ai 설정에서 추가한 것) | 같은 계정 로그인 시 **자동** | `/mcp`로 확인만 |
| 계정에서 켠 스킬·플러그인 | 같은 계정 로그인 시 **자동** | 목록 확인만 |
| 데스크톱 앱 설정 파일의 MCP 서버 | 자동으로 **안 옴** | 서버에서 다시 등록 (6-2) |
| n8n MCP (개발용) | 자동으로 **안 옴** | 서버에서 등록 (6-3) |

### 6-1. claude.ai 커넥터 확인

서버에서 `claude` 실행 → `/mcp` 입력 → `claude.ai`로 시작하는 커넥터가 보이면 연동된 것입니다. 빠진 커넥터는 `claude.ai/customize/connectors`에서 추가하면 서버에도 나타납니다. 인증이 필요하다고 나오면 `/mcp`에서 해당 커넥터를 골라 인증합니다.

### 6-2. 데스크톱 앱의 MCP 서버 다시 등록하기

1. 데스크톱 앱 → 설정 → 개발자(Developer) → 설정 편집(Edit Config)을 누르면 `claude_desktop_config.json`이 열립니다.
2. `mcpServers` 안의 서버마다 이름, `command`, `args`, `env`를 메모합니다.
3. 서버에서 하나씩 등록합니다. 아래는 형식 예시입니다.

```bash
# 명령으로 실행하는 서버 (설정 파일에 command 가 있는 경우)
claude mcp add --scope user <서버이름> --env KEY=값 -- <command> <args...>
# 예) claude mcp add --scope user airtable --env AIRTABLE_API_KEY=xxx -- npx -y airtable-mcp-server

# 주소로 접속하는 서버 (설정 파일에 url 이 있는 경우)
claude mcp add --scope user --transport http <서버이름> <주소>
```

- `--scope user`는 "이 서버의 모든 프로젝트에서 사용"이라는 뜻입니다.
- 내 PC의 폴더를 가리키는 서버(예: 파일 시스템 서버)는 서버에서는 의미가 없으니 등록하지 않습니다.
- `npx`로 실행하는 서버는 PHASE 4-2의 Node.js가 필요합니다.

### 6-3. n8n MCP 연결 (자동화 서버, 개발용)

소개뱅크는 n8n MCP를 개발용으로 쓰기로 했습니다. n8n의 MCP 서버 화면에서 주소와 인증 토큰을 확인한 뒤 등록합니다.

```bash
claude mcp add --scope user --transport http n8n "https://<n8n 주소>/mcp/<경로>" \
  --header "Authorization: Bearer <n8n 토큰>"
claude mcp list         # n8n 옆에 ✔ Connected 가 보이면 성공
```

- 연결이 안 되면 자동화 서버의 보안 그룹이 개발 서버(`sgb-dev`)에서 오는 접속을 허용하는지 확인합니다.
- n8n 버전에 따라 주소가 SSE 방식이면 `--transport sse`로 바꿉니다. 정확한 방식은 사용 중인 n8n 화면에서 확인이 필요합니다.
- 토큰은 비밀값입니다. 저장소나 문서에 적지 마세요.

### 6-4. 안전 권한 설정

서버의 Claude가 실수로 위험한 일을 하지 않도록 막아 둡니다. `nano ~/.claude/settings.json`을 열고 아래 내용을 넣습니다 (파일이 있으면 합칩니다).

```json
{
  "remoteControlAtStartup": true,
  "permissions": {
    "deny": [
      "Read(./**/.env)",
      "Read(./**/*.pem)",
      "Bash(git push --force:*)",
      "Bash(git push -f:*)",
      "Bash(aws codecommit delete-repository:*)"
    ]
  }
}
```

- `remoteControlAtStartup`: Claude를 켤 때마다 휴대폰·웹 원격 연결 자동 시작 (PHASE 7)
- `deny`: 비밀값 파일 읽기, 강제 push, 저장소 삭제를 막습니다.

### 6-5. CodeCommit 작업도 Claude에게 맡기기

AWS CLI와 IAM 역할이 준비되어 있으므로 서버의 Claude에게 "feature/결제개선 브랜치로 CodeCommit 풀 리퀘스트를 만들어 줘"처럼 요청할 수 있습니다. Claude는 `aws codecommit` 명령을 쓰며, 실행 전에 승인을 요청합니다.

## PHASE 7. 계속 연결 (tmux + 원격 제어 + 휴대폰)

이 단계가 끝나면 SSH를 끊거나 PC를 꺼도 서버의 Claude 대화가 계속 살아 있고, 휴대폰과 웹에서 같은 대화를 이어갈 수 있습니다.

### 7-1. tmux 사용법 3가지

| 하고 싶은 일 | 입력 |
| --- | --- |
| 새 작업방 만들기 | `tmux new -s sgb` |
| 작업방에서 잠깐 나오기 (계속 실행됨) | **Ctrl + b**를 누르고 손을 뗀 뒤 **d** |
| 작업방으로 다시 들어가기 | `tmux attach -t sgb` |

### 7-2. 원클릭 시작 스크립트 만들기

```bash
nano ~/start-claude.sh
```

아래 내용을 붙여 넣고 저장(Ctrl + O, Enter, Ctrl + X)합니다.

```bash
#!/usr/bin/env bash
# 작업방이 있으면 들어가고, 없으면 만들어서 4개 저장소 최신화 후 Claude 실행
if tmux has-session -t sgb 2>/dev/null; then
  tmux attach -t sgb
else
  cd ~/sogaebank
  for r in sgb-core sgb-adx sgb-infra sgb-docs; do
    (cd "$r" && git pull --ff-only) || echo "[확인 필요] $r pull 실패"
  done
  tmux new -s sgb -c ~/sogaebank "claude --remote-control '소개뱅크'; bash"
fi
```

```bash
chmod +x ~/start-claude.sh
~/start-claude.sh
```

- 시작할 때마다 4개 저장소를 자동으로 최신화합니다. `[확인 필요]`가 나오면 그 저장소에 커밋하지 않은 변경이 있다는 뜻입니다.
- 처음이면 `Enable Remote Control? (y/n)`에 `y`, 폴더 신뢰 질문에 `y`를 누릅니다.
- 화면 아래에 `/rc active`가 보이면 원격 제어가 연결된 것입니다.
- Claude 입력창에 `/remote-control`을 입력하면 **세션 주소와 QR 코드**가 나옵니다.

### 7-3. 휴대폰·웹에서 접속하기

- **휴대폰**: Claude 앱 → **Code** → "소개뱅크" 세션. 초록색 점이 있으면 연결된 상태입니다. QR 코드를 카메라로 찍어도 됩니다.
- **PC 웹**: 브라우저에서 `claude.ai/code` → "소개뱅크" 선택.
- 휴대폰에서 메시지 보내기, 작업 승인, 사진·파일 첨부가 됩니다. `/resume` 같은 일부 명령은 서버 터미널에서만 됩니다.

### 7-4. 휴대폰 알림 켜기

Claude 입력창에서 `/config` → **Push when actions required**(승인이 필요할 때)와 **Push when Claude decides**(작업 완료 등)를 켭니다. 알림이 안 오면 휴대폰에서 Claude 앱을 한 번 열어 주세요.

### 7-5. 서버 재부팅 후 자동 시작 (선택)

서버가 재부팅되면 tmux도 꺼집니다. 다시 `ssh sgb-dev` → `~/start-claude.sh`를 실행하면 되고, 이전 대화는 Claude 안에서 `/resume`으로 다시 열 수 있습니다. 재부팅 때 자동으로 띄우려면 서버에서 `crontab -e`를 열고 맨 아래에 한 줄을 추가합니다.

```bash
@reboot sleep 30 && tmux new -d -s sgb -c /home/ubuntu/sogaebank "/home/ubuntu/.local/bin/claude --remote-control '소개뱅크'; bash"
```

### 7-6. (선택) 데스크톱 앱 화면으로 같은 서버 쓰기

데스크톱 앱 → **Code** 탭 → 환경 선택 → **+ Add SSH connection** → SSH Host에 `sgb-dev` 입력 → 폴더 `/home/ubuntu/sogaebank` 선택. 데스크톱 앱의 그래픽 화면(변경 비교, 파일 첨부)으로 같은 서버에서 작업할 수 있습니다. 이 세션은 tmux 세션과 따로 관리되지만 같은 `CLAUDE.md`와 저장소를 씁니다.

## PHASE 8. 연동 최종 점검표

아래 16개 항목이 모두 "정상 결과"와 같으면 소개뱅크 연동이 빠짐없이 끝난 것입니다. 하나씩 실행하고 체크하세요.

| 번호 | 점검 항목 | 확인 방법 (서버에서) | 정상 결과 |
| --- | --- | --- | --- |
| 1 | 서버 접속 | 내 PC에서 `ssh sgb-dev` | `ubuntu@ip-...:~$` 표시 |
| 2 | IAM 역할 | `aws sts get-caller-identity` | `Arn`에 `sgb-dev-role` |
| 3 | Claude Code 설치 | `claude doctor` | 오류 없음 |
| 4 | 계정 로그인 | Claude 안에서 `/status` | Claude 계정(Max) 로그인 |
| 5 | 연동 방해 설정 없음 | `env \| grep -E 'ANTHROPIC\|CLAUDE_CODE'` | 아무것도 안 나옴 |
| 6 | 저장소 4개 | `ls ~/sogaebank` | `sgb-core` `sgb-adx` `sgb-infra` `sgb-docs` |
| 7 | 저장소 읽기 | 각 저장소에서 `git pull` | `Already up to date` 또는 내려받기 완료 |
| 8 | 저장소 쓰기 | PHASE 3-5 임시 브랜치 push | 오류 없이 완료 |
| 9 | Java·빌드 | `cd sgb-core && ./gradlew build` | `BUILD SUCCESSFUL` |
| 10 | Node (해당 시) | `node -v` | 버전 표시 |
| 11 | 개발 DB | `docker ps` | `sgb-db`가 `Up` |
| 12 | 비밀값 보호 | `git check-ignore -v sgb-core/.env` | `.gitignore` 규칙 표시 |
| 13 | 프로젝트 기억 | Claude에게 "작업 규칙 요약해 줘" | 매트릭스·kit·배포 규칙이 나옴 |
| 14 | 도구 연동 | `claude mcp list` | 커넥터·n8n이 `✔ Connected` |
| 15 | 원격 제어 | tmux 안 Claude 화면 | `/rc active` 표시 |
| 16 | 휴대폰 연결 | Claude 앱 → Code | "소개뱅크" 세션에 초록 점, 휴대폰 메시지가 서버에 보임 |

**모두 정상이면 할 일**

- [ ] 데스크톱 프로젝트에서 진행하던 작업 중 다음 작업을 서버 Claude에게 첫 작업으로 맡기기
- [ ] 앞으로 개발 대화는 서버의 Claude(휴대폰·웹 포함)에서 시작하기
- [ ] 데스크톱 채팅은 기획·문서 작업용으로 쓰고, 확정된 결정은 `sgb-docs/decisions/`에 추가하기

## 매일 작업 흐름 (Git 포함)

하루 작업은 "시작할 때 받고(pull), 끝날 때 올린다(push)"만 지키면 됩니다.

| 언제 | 어디서 | 할 일 |
| --- | --- | --- |
| 아침 시작 | 내 PC | `ssh sgb-dev` → `~/start-claude.sh` (저장소 4개 자동 최신화 + Claude 실행) |
| 새 작업 시작 | Claude에게 | "sgb-core에서 feature/작업이름 브랜치를 만들고 시작해 줘. 먼저 계획을 보여 줘." |
| 작업 중 | Claude가 계획 → 승인 → 구현 | 큰 변경은 계획부터 확인 |
| 결과물 완료 | Claude에게 | "작업 규칙대로 매트릭스, 기능 검증, 로컬 테스트, DB 연동 테스트까지 해 줘" |
| 외출 | 서버 터미널 | **Ctrl + b → d** 후 창 닫기 → 휴대폰 Claude 앱 → Code로 계속 |
| 하루 끝 | Claude에게 | "오늘 변경을 커밋하고 push해 줘. 확정한 결정은 sgb-docs/decisions에 추가해 줘." |
| 기능 묶음 완료 | CodeCommit 콘솔 | 풀 리퀘스트 → 병합 → 기존 규칙대로 태그·배포 |
| 주 1회 | 데스크톱 프로젝트 | 최신 `CLAUDE.md`와 결정 문서를 프로젝트 자료로 다시 올려 데스크톱 쪽도 최신 유지 |

**자주 쓰는 Claude 명령**: `/resume`(예전 대화 열기), `/rename 이름`(대화 이름), `/compact`(긴 대화 압축), `/clear`(새 대화), `/usage`(사용량), `/remote-control`(원격 연결 주소·QR).

## 문제 해결표

오류가 나면 화면 문구의 앞부분을 이 표에서 찾으세요. 표에 없으면 서버에서 `claude doctor`를 실행하고, 서버의 Claude에게 오류 문구를 그대로 붙여 넣어 물어봐도 됩니다.

| 화면 문구 / 증상 | 원인 | 해결 방법 |
| --- | --- | --- |
| `Permission denied (publickey)` | 열쇠 파일 경로·권한 문제 | PHASE 1-3의 `icacls`(Windows) / `chmod 400`(Mac) 다시 실행, 사용자 이름 `ubuntu` 확인 |
| SSH가 멈췄다가 `timed out` | 내 IP 또는 서버 IP가 바뀜 | EC2 보안 그룹 SSH 소스를 "내 IP"로 재설정, 콘솔에서 새 IP 확인 후 `~/.ssh/config` 수정 |
| `aws sts get-caller-identity` 실패 | IAM 역할이 서버에 안 붙음 | EC2 → 작업 → 보안 → IAM 역할 수정 → `sgb-dev-role` |
| `git clone codecommit::...` 에서 `not found` / `fatal` | `git-remote-codecommit` 미설치 또는 PATH 미반영 | `pipx ensurepath` → `source ~/.bashrc` → `which git-remote-codecommit` |
| CodeCommit `403` / `AccessDenied` | 역할 정책 누락, 또는 KMS 차단 정책 | IAM 역할에 `AWSCodeCommitPowerUser` 확인, 다른 정책이 KMS를 막는지 확인 |
| `Repository ... does not exist` | 저장소 이름·리전 오타 | CodeCommit 콘솔에서 이름 확인, 주소의 `ap-northeast-2` 확인 |
| `git push` 거부 (`rejected`) | 다른 곳에서 먼저 올린 변경 | `git pull` 후 다시 `git push` |
| `externally-managed-environment` (pip) | Ubuntu 24.04의 pip 제한 | `pip` 대신 `pipx install` 사용 |
| 설치·빌드 중 `Killed` | 메모리 부족 | PHASE 1-4 스왑 확인(`free -h`), 필요하면 인스턴스 유형 상향 |
| `docker: permission denied` | docker 그룹 미적용 | `exit` 후 다시 접속 |
| 로그인 후 서버로 돌아오지 않음 | 서버에 브라우저가 없음 (정상) | 브라우저에 나온 코드를 터미널에 붙여 넣기 |
| `Remote Control requires a claude.ai subscription` | API 키 등이 우선 사용됨 | `claude auth login`, PHASE 2-4의 환경 변수 제거 |
| `/mcp`에 claude.ai 커넥터가 없음 | 계정 로그인이 아님, 또는 커넥터 미등록 | `/status` 확인, `claude.ai/customize/connectors`에서 추가 |
| n8n MCP `Failed to connect` | 주소·토큰 오류, 또는 보안 그룹 차단 | `claude mcp get n8n`으로 오류 확인, 자동화 서버 보안 그룹 확인 |
| 휴대폰에 세션이 없거나 회색 | 서버의 `claude`가 꺼짐 | `ssh sgb-dev` → `tmux attach -t sgb`, 없으면 `~/start-claude.sh` |
| SSH를 끊으니 세션도 사라짐 | tmux 밖에서 실행 | 반드시 `~/start-claude.sh`로 실행 |
| 시작 스크립트에서 `[확인 필요] pull 실패` | 커밋 안 한 변경이 남음 | 해당 저장소에서 `git status` 확인 후 커밋 또는 Claude에게 정리 요청 |

## 출처

2026-10-13 기준 공식 문서를 확인해 작성했습니다. 버튼 이름과 기능은 업데이트로 바뀔 수 있습니다.

- [Claude Code — Remote Control](https://code.claude.com/docs/en/remote-control)
- [Claude Code — Advanced setup (설치)](https://code.claude.com/docs/en/setup)
- [Claude Code — Manage sessions (세션 이어하기)](https://code.claude.com/docs/en/sessions)
- [Claude Code — MCP (claude.ai 커넥터, 서버 등록)](https://code.claude.com/docs/en/mcp)
- [Claude Code — Desktop application (SSH 세션)](https://code.claude.com/docs/en/desktop)
- [Claude Code — Troubleshoot installation and login](https://code.claude.com/docs/en/troubleshoot-install)
- [AWS CodeCommit — git-remote-codecommit 설정](https://docs.aws.amazon.com/codecommit/latest/userguide/setting-up-git-remote-codecommit.html)
- [AWS DevOps Blog — CodeCommit 정식 서비스 복귀 공지](https://aws.amazon.com/ko/blogs/devops/aws-codecommit-returns-to-general-availability/)

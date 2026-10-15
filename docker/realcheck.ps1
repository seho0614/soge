# =====================================================================
# 진짜 기반 이미지 확인 — `.\dev.ps1 realcheck`   (macOS · Linux 는 `./dev.sh realcheck` — 같은 순서)
#
# 왜 필요한가
#   킷을 만든 작업 환경은 Docker Hub 에 닿지 않아 기반 이미지(node:22-slim · postgres:16)를 같은 역할의
#   대체 이미지로 돌렸습니다. 이 스크립트는 인터넷이 되는 PC 에서 진짜 이미지를 받아 같은 것을 한 번에 확인합니다.
#
# 하는 일 (순서대로 · 하나라도 실패하면 끝에 「실패 n건」)
#   1. Docker 가 켜져 있는지
#   2. node:22-slim · postgres:16 을 Docker Hub 에서 받기            (못 받으면 여기서 멈춤)
#   3. 받은 것이 진짜인지 — 공식 이미지 표지(NODE_VERSION · PG_MAJOR) · 버전(node 22 · PostgreSQL 16)
#   4. 그 이미지로 전부 다시 빌드                                     (docker compose build --pull)
#   5. 기동 · API 준비 대기                                           (개발 데이터는 그대로 둡니다)
#   6. 마이그레이션 수 = 파일 수 · 컨테이너 안 버전
#   7. 통합 검정 컨테이너                                             (sgb_check 에서 — 개발 데이터를 건드리지 않음)
#   8. 주소 6곳이 열리는지 · 메인에 나가는 투표 3건
#   결과는 화면과 realcheck_날짜_시각.txt 에 남습니다 — 그 파일을 보내 주시면 됩니다.
#
#   .\dev.ps1 realcheck          개발 데이터 유지 (권장)
#   .\dev.ps1 realcheck fresh    DB 볼륨을 지우고 처음부터 (새 설치 확인 — 「yes」를 쳐야 진행)
#
# Windows PowerShell 5.1 · PowerShell ISE · PowerShell 7 모두에서 돕니다. 이 파일은 UTF-8(BOM)입니다.
#
# ★ 10/6 (v10.17) — 빨간 글씨 · 깨진 한글을 없앴습니다.
#   전에는 docker 를 PowerShell 이 대신 읽어, ISE 같은 창에서 진행 줄이 빨간 오류(NativeCommandError)로 보이고
#   컨테이너가 내는 한글(UTF-8)이 CP949 로 읽혀 깨졌습니다(결과는 통과인데도). 이제 docker 는 전부
#   docker\native.ps1 의 도우미(DkShow · DkTee · DkGet · DkQuiet)로 부릅니다 — 이 파일에 `docker …` 를 직접 쓰지 마십시오.
#
# (킷 작업 환경 전용) $env:REALCHECK_SKIP_PULL = "1" — 받기를 건너뜁니다.
# =====================================================================
param([string]$mode = "keep")
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "native.ps1")
Set-Location (Split-Path -Parent $PSScriptRoot)

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path (Get-Location) ("realcheck_" + $stamp + ".txt")
$script:pass = 0; $script:fail = 0
$script:lines = New-Object System.Collections.Generic.List[string]

function Say([string]$t) { Write-Host $t; $script:lines.Add($t) }
function Ok([string]$name, [string]$detail = "") {
  $script:pass++
  if ($detail) { Say ("  통과  " + $name + " — " + $detail) } else { Say ("  통과  " + $name) }
}
function Bad([string]$name, [string]$detail = "") {
  $script:fail++
  if ($detail) { Say ("  실패  " + $name + " — " + $detail) } else { Say ("  실패  " + $name) }
}
function Chk([bool]$cond, [string]$name, [string]$detail = "") { if ($cond) { Ok $name $detail } else { Bad $name $detail } }
function Finish {
  Say ""
  if ($script:fail -eq 0) { Say ("진짜 이미지 확인 — 전체 통과 (통과 " + $script:pass + " · 실패 0)") }
  else { Say ("진짜 이미지 확인 — 실패 " + $script:fail + "건 (통과 " + $script:pass + ") · 위에서 「실패」 줄을 보십시오") }
  Say ("결과 파일: " + $outFile)
  # BOM 있는 UTF-8 로 저장 — 메모장에서도 한글이 그대로 보입니다
  [System.IO.File]::WriteAllLines($outFile, $script:lines, (New-Object System.Text.UTF8Encoding($true)))
  if ($script:fail -eq 0) { exit 0 } else { exit 1 }
}
function EnvVal([string]$key, [string]$default) {
  if (Test-Path ".env") {
    $m = Select-String -Path ".env" -Pattern ("^" + $key + "=(.*)$") | Select-Object -Last 1
    if ($m -and $m.Matches[0].Groups[1].Value.Trim()) { return $m.Matches[0].Groups[1].Value.Trim() }
  }
  return $default
}
function First([object]$x) { if ($null -eq $x) { return "" }; return ((@($x) | ForEach-Object { "$_" }) -join " ").Trim() }

Say ("소개뱅크 개발 Docker — 진짜 기반 이미지 확인 (" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " · 방식 " + $mode + ")")
Say ("킷 폴더: " + (Get-Location))
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Say ".env 를 만들었습니다 (개발용 값)." }
$apiPort = EnvVal "API_PORT" "3000"; $webPort = EnvVal "WEB_PORT" "5173"; $sitePort = EnvVal "SITE_PORT" "5174"; $pgUser = EnvVal "PG_USER" "sgb"
$skipPull = ($env:REALCHECK_SKIP_PULL -eq "1")

Say ""; Say "[1] Docker"
DkQuiet @("info")
if ($LASTEXITCODE -eq 0) { Ok "Docker 가 켜져 있음" (First (DkGet @("version", "--format", "{{.Server.Version}}"))) }
elseif ($LASTEXITCODE -eq 127) { Bad "docker 명령을 찾지 못함" "Docker Desktop 을 설치하고 켠 뒤, PowerShell 창을 새로 열어 다시 실행하십시오"; Finish }
else { Bad "Docker 가 꺼져 있음" "Docker Desktop 을 켠 뒤 다시 실행하십시오"; Finish }

Say ""; Say "[2] 기반 이미지 받기 (Docker Hub)"
foreach ($img in @("node:22-slim", "postgres:16")) {
  if ($skipPull) { Say ("  건너뜀  " + $img + " 받기 (REALCHECK_SKIP_PULL=1)"); continue }
  DkShow @("pull", $img)
  if ($LASTEXITCODE -eq 0) { Ok ($img + " 받음") }
  else { Bad ($img + " 를 받지 못함") "인터넷 · 사내 프록시 · Docker Hub 로그인 한도를 확인하십시오"; Finish }
}

Say ""; Say "[3] 진짜 이미지인가"
#   ※ 저장소 지문(RepoDigests)은 직접 만든 이미지에도 붙을 수 있어 근거로 쓰지 않습니다(킷 작업 환경에서 확인).
#     ① 2번에서 Docker Hub 에서 방금 받았고 ② 공식 이미지가 넣어 두는 표지(환경 값)가 있고 ③ 버전이 맞는지를 봅니다.
function ImgEnv([string]$img, [string]$key) {
  $all = First (DkGet @("image", "inspect", $img, "--format", "{{range .Config.Env}}{{.}} {{end}}"))
  $hit = ($all -split " ") | Where-Object { $_.StartsWith($key + "=") } | Select-Object -First 1
  if ($hit) { return "$hit" } else { return "" }
}
$ne = ImgEnv "node:22-slim" "NODE_VERSION"
if ($ne -like "NODE_VERSION=22.*") { Ok "node:22-slim — 공식 이미지 표지" $ne }
else { if (-not $ne) { $ne = "없음" }; Bad "node:22-slim 에 공식 이미지 표지(NODE_VERSION=22.x)가 없음 — Docker Hub 의 공식 이미지가 아님(직접 만든 대체 이미지)" $ne }
$pe = ImgEnv "postgres:16" "PG_MAJOR"
if ($pe -eq "PG_MAJOR=16") { Ok "postgres:16 — 공식 이미지 표지" $pe }
else { if (-not $pe) { $pe = "없음" }; Bad "postgres:16 에 공식 이미지 표지(PG_MAJOR=16)가 없음 — Docker Hub 의 공식 이미지가 아님(직접 만든 대체 이미지)" $pe }
$nv = First (DkGet @("run", "--rm", "--entrypoint", "node", "node:22-slim", "-v"))
if ($nv -like "v22.*") { Ok "node 버전" $nv } else { if (-not $nv) { $nv = "실행 실패" }; Bad "node 버전이 22 가 아님" $nv }
$pv = First (DkGet @("run", "--rm", "--entrypoint", "postgres", "postgres:16", "-V"))
if ($pv -like "* 16.*") { Ok "PostgreSQL 버전" $pv } else { if (-not $pv) { $pv = "실행 실패" }; Bad "PostgreSQL 버전이 16 이 아님" $pv }
foreach ($img in @("node:22-slim", "postgres:16")) {
  # 한글은 docker 에 넘기지 않고 여기서 붙입니다 (전: --format 안의 「만든 때」가 깨져 돌아옴)
  $meta = (First (DkGet @("image", "inspect", $img, "--format", "{{.Id}}|{{.Created}}"))) -split "\|"
  $made = ""; if ($meta.Count -ge 2) { $made = $meta[1] }
  Say ("        " + $img + "  " + $meta[0] + "  만든 때 " + $made)
}

if ($mode -eq "fresh") {
  Say ""; Say "[새 설치] DB 볼륨을 지우고 처음부터 합니다 — 개발 데이터(화면에서 넣은 것 포함)가 사라집니다."
  $yn = Read-Host "  계속하려면 yes 를 입력"
  if ($yn -eq "yes") { DkQuiet @("compose", "--profile", "check", "down", "-v"); Ok "DB 볼륨을 지움 (새 설치로 확인)" }
  else { Say "  취소했습니다 — 개발 데이터를 둔 채로 계속합니다."; $mode = "keep" }
}

Say ""; Say "[4] 진짜 이미지로 다시 빌드 (몇 분 걸립니다)"
if ($skipPull) { DkShow @("compose", "--profile", "check", "build") } else { DkShow @("compose", "--profile", "check", "build", "--pull") }
Chk ($LASTEXITCODE -eq 0) "빌드 (migrate · api · scheduler · web · site · checks)"

Say ""; Say "[5] 기동"
DkShow @("compose", "up", "-d")
Chk ($LASTEXITCODE -eq 0) "docker compose up -d (준비 · API 준비 대기 포함)"
$st = ""
for ($i = 0; $i -lt 60; $i++) {
  $st = First (DkGet @("inspect", "--format", "{{.State.Health.Status}}", "sgb-api"))
  if ($st -eq "healthy") { break }
  Start-Sleep -Seconds 3
}
Chk ($st -eq "healthy") "API 컨테이너 healthy" $st

Say ""; Say "[6] 마이그레이션 · 컨테이너 안 버전"
$files = @(Get-ChildItem -Path "sgb/prisma/migrations" -Directory | Where-Object { Test-Path (Join-Path $_.FullName "migration.sql") }).Count
$applied = First (DkGet @("compose", "exec", "-T", "db", "psql", "-U", $pgUser, "-d", "sgb", "-tAc", "select count(*) from schema_migrations"))
Chk ($applied -eq "$files") "마이그레이션 적용 수 = 파일 수" ("적용 " + $applied + " / 파일 " + $files)
$cn = First (DkGet @("compose", "exec", "-T", "api", "node", "-v"))
if ($cn -like "v22.*") { Ok "API 컨테이너의 node" $cn } else { Bad "API 컨테이너의 node 가 22 가 아님" $cn }
$cp = First (DkGet @("compose", "exec", "-T", "db", "postgres", "-V"))
if ($cp -like "* 16.*") { Ok "DB 컨테이너의 PostgreSQL" $cp } else { Bad "DB 컨테이너의 PostgreSQL 이 16 이 아님" $cp }

Say ""; Say "[7] 통합 검정 컨테이너 (sgb_check — 개발 데이터를 건드리지 않습니다 · 몇 분 걸립니다)"
$all = @(DkTee @("compose", "--profile", "check", "run", "--rm", "-T", "checks"))
$rc = $LASTEXITCODE
foreach ($pat in @("^통과 [0-9]+ / 실패", "뚫림", "SQL 대조", "통합 검정 —")) {
  $l = $all | Where-Object { $_ -match $pat } | Select-Object -First 1
  if ($l) { $script:lines.Add("        " + $l.Trim()) }
}
Chk ($rc -eq 0) "통합 검정 — 전체 통과" ("종료 코드 " + $rc)

Say ""; Say "[8] 주소 · 투표"
function Probe([string]$name, [string]$url) {   # 사용자 웹은 개발 모드라 첫 요청이 느립니다(최대 4분 · 3번까지)
  $code = "000"
  for ($t = 0; $t -lt 3; $t++) {
    try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 240; $code = "$([int]$r.StatusCode)" }
    catch { if ($_.Exception.Response) { $code = "$([int]$_.Exception.Response.StatusCode)" } else { $code = "000" } }
    if ($code -eq "200") { break }
    Start-Sleep -Seconds 5
  }
  Chk ($code -eq "200") $name ($url + " → " + $code)
}
Probe "API"               ("http://localhost:" + $apiPort + "/api/v1/health")
Probe "운영 화면"          ("http://localhost:" + $webPort + "/")
Probe "사용자 웹 메인"      ("http://localhost:" + $sitePort + "/")
Probe "소개광장 투표 목록"   ("http://localhost:" + $sitePort + "/community/polls")
Probe "안심소개"           ("http://localhost:" + $sitePort + "/mall")
$proto = Get-ChildItem -Path "." -Filter "SGB_Prototype_v*.html" | Select-Object -First 1
if ($proto) { Probe "시안" ("http://localhost:" + $sitePort + "/proto/" + $proto.Name) }
$kinds = ""
try {
  $resp = Invoke-WebRequest -Uri ("http://localhost:" + $apiPort + "/api/v1/community/polls?scope=home") -UseBasicParsing -TimeoutSec 60
  $kinds = (([regex]::Matches($resp.Content, '"kind":"([A-Z]+)"') | ForEach-Object { $_.Groups[1].Value }) -join " ")
} catch { $kinds = "" }
$kd = $kinds; if (-not $kd) { $kd = "없음" }
Chk ($kinds -eq "VS ASK USED") "메인에 나가는 투표 3건(비교해요 · 궁금해요 · 써본 의견)" $kd

Finish

# =====================================================================
# 소개뱅크 개발 Docker — Windows 도우미 (PowerShell)
#
#   .\dev.ps1 up        처음 · 평소 기동 (.env 가 없으면 만들어 줍니다)
#   .\dev.ps1 logs      준비 로그 보기 (migrate · api) — Ctrl+C 로 그만 보기
#   .\dev.ps1 check     통합 검정 (개발 데이터는 건드리지 않음)
#   .\dev.ps1 reset     개발 데이터 지우고 처음처럼 다시
#   .\dev.ps1 down      멈추기 (데이터 유지)
#   .\dev.ps1 wipe      멈추고 DB 볼륨까지 삭제
#   .\dev.ps1 status    상태
#   .\dev.ps1 realcheck 진짜 기반 이미지(node:22-slim · postgres:16)로 받기 → 빌드 → 기동 → 검정 → 주소 확인까지 한 번에.
#                       결과는 realcheck_날짜_시각.txt 에 남습니다. 개발 데이터는 그대로 둡니다.
#                       `.\dev.ps1 realcheck fresh` — DB 볼륨을 지우고 새 설치로 확인(「yes」를 쳐야 진행)
#
# 실행할 때
#   · 킷 폴더에서 앞에 `.\` 를 붙여 실행합니다:  .\dev.ps1 realcheck
#   · 「디지털 서명되지 않았습니다」로 막히면 그 창에서 한 번만:
#         Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#     (창을 닫으면 원래대로 돌아갑니다. 내려받은 zip 을 풀었다면 이 방법이 필요합니다.)
#
# ★ 10/6 (v10.17) — 빨간 글씨 · 깨진 한글을 없앴습니다.
#   docker 는 전부 docker\native.ps1 의 도우미(DkShow …)로 부릅니다 — PowerShell 이 docker 의 출력을 대신 읽지 않으므로
#   진행 줄이 빨간 오류로 보이지 않고, 컨테이너가 내는 한글이 깨지지 않습니다(Windows PowerShell 5.1 · ISE · PowerShell 7 공통).
#   이 파일에 `docker …` 를 직접 쓰지 마십시오.
# =====================================================================
param([string]$cmd = "up", [string]$arg = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
. (Join-Path (Join-Path $PSScriptRoot "docker") "native.ps1")

function Need-Env {
  if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host ".env 를 만들었습니다 (개발용 값)." -ForegroundColor Yellow
  }
}
# 실패하면 무엇이 실패했는지 한 줄로 알리고 그 종료 코드로 끝냅니다 (전: 실패해도 다음 줄로 넘어감)
function Stop-IfFailed([string]$what) {
  if ($LASTEXITCODE -ne 0) {
    $c = $LASTEXITCODE
    # 127 = docker 를 찾지 못함 — 안내는 도우미(native.ps1)가 이미 냈습니다
    if ($c -ne 127) { Write-Host ("실패 — " + $what + " (종료 코드 " + $c + ") · 위에 나온 내용을 보십시오.") -ForegroundColor Yellow }
    exit $c
  }
}

switch ($cmd) {
  "up"     { Need-Env
             DkShow @("compose", "up", "-d", "--build"); Stop-IfFailed "docker compose up"
             DkShow @("compose", "ps")
             Write-Host "`nAPI   http://localhost:3000/docs`nBO    http://localhost:5173  (admin@x.com / sgb-dev-1234)`n웹    http://localhost:5174" -ForegroundColor Green }
  "logs"   { DkShow @("compose", "logs", "-f", "migrate", "ads-migrate", "api") }
  "check"  { Need-Env; DkShow @("compose", "--profile", "check", "run", "--rm", "--build", "-T", "checks"); exit $LASTEXITCODE }   # --build: 낡은 검정 이미지 방지 (10/2)
  "reset"  { Need-Env
             $env:SGB_RESET = "1"
             try {
               DkShow @("compose", "run", "--rm", "-T", "migrate"); Stop-IfFailed "개발 데이터 다시 만들기(migrate)"
               DkShow @("compose", "run", "--rm", "-T", "ads-migrate"); Stop-IfFailed "광고 DB 다시 만들기(ads-migrate)"
             } finally { $env:SGB_RESET = "0" }
             DkShow @("compose", "restart", "api"); exit $LASTEXITCODE }
  "down"   { DkShow @("compose", "down"); exit $LASTEXITCODE }
  "wipe"   { DkShow @("compose", "down", "-v"); exit $LASTEXITCODE }
  "status" { DkShow @("compose", "ps"); exit $LASTEXITCODE }
  "realcheck" { $m = "keep"; if ($arg) { $m = $arg }; & (Join-Path (Join-Path $PSScriptRoot "docker") "realcheck.ps1") $m; exit $LASTEXITCODE }
  default  { Write-Host "사용법: .\dev.ps1 [up|logs|check|reset|down|wipe|status|realcheck]" }
}

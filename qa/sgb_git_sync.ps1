# 소개뱅크 — Claude 작업 공간의 git 백업 파일(.bundle)을 받아 GitHub(koreabio9981-web/segebank)에 올립니다.
# 사용:  PowerShell 에서   powershell -ExecutionPolicy Bypass -File sgb_git_sync.ps1 -Bundle C:\sgb_git\받은파일.bundle
#        조각으로 받았으면       -Bundle C:\sgb_git\SGB_git_backup_….bundle.part0   (같은 폴더의 조각을 모두 합칩니다)
#   - 처음 한 번: C:\sgb_git\segebank.git 이 없으면 백업 파일에서 새로 만들고(clone) GitHub 주소를 붙입니다.
#   - 그다음부터: 같은 폴더에 새 백업 파일의 커밋을 더하고(fetch) GitHub 에 올립니다(push).
#   - 강제로 덮어쓰지 않습니다(--force 를 쓰지 않음). 거절되면 화면의 글자를 Claude 에 알려 주십시오.
param(
  [Parameter(Mandatory = $true)][string]$Bundle,
  [string]$Repo = "C:\sgb_git\segebank.git",   # 올리기 전용 보관 폴더(작업 파일 없음 · bare)
  [string]$Remote = "https://github.com/koreabio9981-web/segebank.git"
)
$ErrorActionPreference = "Continue"   # git 은 진행 글을 오류 줄(stderr)로 씁니다 — 결과는 종료 코드로 봅니다
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host "git 이 설치되어 있지 않습니다 — https://git-scm.com 에서 설치 후 다시 실행하십시오." -ForegroundColor Yellow; exit 1 }
$Bundle = (Resolve-Path $Bundle).Path
# 조각(.part0 · .part1 …)을 주면 한 파일로 합칩니다
if ($Bundle -match '\.part0$') {
  $base = $Bundle -replace '\.part0$', ''
  $parts = Get-ChildItem ($base + '.part*') | Sort-Object Name
  $out = [System.IO.File]::Create($base)
  foreach ($p in $parts) { $b = [System.IO.File]::ReadAllBytes($p.FullName); $out.Write($b, 0, $b.Length) }
  $out.Close(); $Bundle = $base
  Write-Host ("조각 " + $parts.Count + "개를 합쳤습니다: " + $Bundle)
}
git bundle verify $Bundle 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "백업 파일이 온전하지 않습니다(조각을 합쳤는지 확인): $Bundle" -ForegroundColor Yellow; exit 1 }
if (-not (Test-Path (Join-Path $Repo "HEAD"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Repo) | Out-Null
  git clone --bare $Bundle $Repo
  if ($LASTEXITCODE -ne 0) { Write-Host "보관 폴더를 만들지 못했습니다." -ForegroundColor Yellow; exit 1 }
  Set-Location $Repo
  git remote set-url origin $Remote
} else {
  Set-Location $Repo
  git fetch $Bundle "refs/heads/*:refs/heads/*" --tags
  if ($LASTEXITCODE -ne 0) { Write-Host "새 백업을 더하지 못했습니다(앞 판과 이어지지 않는 백업일 수 있음) — 위 글자를 알려 주십시오." -ForegroundColor Yellow; exit 1 }
}
git push origin --all
if ($LASTEXITCODE -ne 0) { Write-Host "올리기가 거절되었습니다 — 위 글자를 그대로 알려 주십시오(강제로 덮어쓰지 마십시오)." -ForegroundColor Yellow; exit 1 }
git push origin --tags
Write-Host ("완료 — 최신 커밋: " + (git log -1 --format="%h %s" work/v10.27)) -ForegroundColor Green

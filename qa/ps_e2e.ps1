# dev.ps1 을 실제 Docker 로 돌려 봅니다 — 콘솔 코드 페이지를 CP949 로 둔 채(한글 윈도우와 같은 조건).
#   pwsh -NoProfile -File ps_e2e.ps1 <Docker 시험 폴더> <명령> [인자] <결과 json>
param([string]$dir, [string]$cmd, [string]$arg = "", [string]$out = "/tmp/ps_e2e.json")
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(949)
$env:REALCHECK_SKIP_PULL = "1"
$Error.Clear()
$sw = [System.Diagnostics.Stopwatch]::StartNew()
if ($arg) { & (Join-Path $dir "dev.ps1") $cmd $arg } else { & (Join-Path $dir "dev.ps1") $cmd }
$rc = $LASTEXITCODE
$errs = @($Error | ForEach-Object { "$_" })
$r = @{ cmd = $cmd; rc = $rc; errors = $errs.Count; errorText = ($errs | Select-Object -First 5); seconds = [int]$sw.Elapsed.TotalSeconds; codepage = [Console]::OutputEncoding.CodePage }
[System.IO.File]::WriteAllText($out, ($r | ConvertTo-Json -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
exit $rc

# dev.ps1 의 나머지 길 — 계속 흐르는 명령(logs)을 멈췄을 때 · docker 가 없을 때 · docker 가 실패했을 때
#   pwsh -NoProfile -File ps_e2e_more.ps1 <Docker 시험 폴더> <결과 json>
param([string]$dir = "/tmp/dock_kit", [string]$out = "/tmp/ps_e2e_more.json")
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(949)
$items = New-Object System.Collections.Generic.List[object]
function T([string]$name, [bool]$ok, [string]$detail = "") { $items.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail }); Write-Host ($(if ($ok) { "  PASS  " } else { "  FAIL  " }) + $name + " :: " + $detail) }
$dev = Join-Path $dir "dev.ps1"
function LogProcs { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*compose*logs -f*" }).Count }

# 1) logs — 계속 흐르는 명령. 5초 보고 멈추면(Ctrl+C 와 같은 길) docker 와 그 자식이 남지 않아야 합니다
$before = LogProcs
$ps = [powershell]::Create()
$null = $ps.AddScript({ param($dev) & $dev logs }).AddArgument($dev)
$h = $ps.BeginInvoke()
Start-Sleep -Seconds 6
$running = LogProcs
$ps.Stop()
Start-Sleep -Seconds 3
$after = LogProcs
$ps.Dispose()
T "logs 를 멈추면 docker 프로세스가 남지 않음" ($running -gt $before -and $after -eq $before) ("전 " + $before + " · 도는 중 " + $running + " · 멈춘 뒤 " + $after)

# 2) docker 가 없는 PC — 빨간 오류 대신 안내 한 줄 + 종료 코드 127
$oldPath = $env:PATH
$env:PATH = "/opt/pwsh:/usr/bin/nodocker"
$Error.Clear()
$txt = @(& $dev status *>&1 | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
$env:PATH = $oldPath
T "docker 가 없으면 안내 한 줄 + 종료 코드 127 (오류 기록 0)" ($rc -eq 127 -and $Error.Count -eq 0 -and ($txt -join " ") -like "*docker 명령을 찾지 못했습니다 — Docker Desktop*") ("rc " + $rc + " · 오류 " + $Error.Count + " · " + (($txt -join " | ")))

# 3) realcheck 도 같은 조건에서 — 「실패」 한 줄로 끝나고 결과 파일을 남김
$env:PATH = "/opt/pwsh:/usr/bin/nodocker"
$Error.Clear()
$txt = @(& $dev realcheck *>&1 | ForEach-Object { "$_" })
$rc = $LASTEXITCODE
$env:PATH = $oldPath
T "realcheck — docker 가 없으면 「docker 명령을 찾지 못함」 실패 1건으로 끝남 (오류 기록 0)" ($rc -eq 1 -and $Error.Count -eq 0 -and ($txt -join " ") -like "*docker 명령을 찾지 못함*" -and ($txt -join " ") -like "*실패 1건*") ("rc " + $rc + " · 오류 " + $Error.Count)

# 4) docker 가 실패할 때(없는 서비스) — 그 종료 코드를 그대로 돌려줌
. (Join-Path (Join-Path $dir "docker") "native.ps1")
Push-Location $dir
$r = @(DkTee @("compose", "logs", "no-such-service"))
$rc = $LASTEXITCODE
Pop-Location
T "docker 가 실패하면 종료 코드가 0 이 아님 · 오류 글이 보통 줄로 옴" ($rc -ne 0 -and $r.Count -ge 1 -and (@($r | ForEach-Object { $_.GetType().Name } | Sort-Object -Unique) -join ",") -eq "String") ("rc " + $rc + " · " + ($r -join " | "))

# 5) 사용법
$txt = @(& $dev nosuch *>&1 | ForEach-Object { "$_" })
T "모르는 명령 — 사용법 한 줄" (($txt -join " ") -like "*사용법*realcheck*") (($txt -join " | "))

$pass = @($items | Where-Object { $_.ok }).Count; $fail = $items.Count - $pass
[System.IO.File]::WriteAllText($out, (@{ items = $items; pass = $pass; fail = $fail } | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
if ($fail -eq 0) { exit 0 } else { exit 1 }

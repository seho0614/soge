# docker\native.ps1 시험 — 콘솔 코드 페이지를 CP949 로 두고(한글 윈도우와 같은 조건) 예전 방식과 새 방식을 견줍니다.
#   pwsh -NoProfile -File ps_native_test.ps1 <킷 폴더> <결과 json>
param([string]$kit = "/home/claude/pkg/SGB_DevDocker_Integrated_20261002", [string]$out = "/home/claude/qa/ps_native_test.json")
$ErrorActionPreference = "Continue"
. (Join-Path (Join-Path $kit "docker") "native.ps1")
$fake = Join-Path $PSScriptRoot "ps_fake/fakecli"
$items = New-Object System.Collections.Generic.List[object]
function T([string]$name, [bool]$ok, [string]$detail = "") {
  $items.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail })
  if ($ok) { Write-Host ("  통과  " + $name + $(if ($detail) { " — " + $detail } else { "" })) }
  else { Write-Host ("  실패  " + $name + " — " + $detail) }
}
function N([string[]]$a, [string]$mode) { Invoke-Native -File $fake -ArgList $a -Mode $mode }

# ── A. 문제 재현 — 콘솔 코드 페이지 CP949 에서 PowerShell 이 대신 읽으면 ──────────────────────
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(949)
$old = @(& $fake kor 2>$null | ForEach-Object { "$_" })
T "A1 (재현) 예전 방식은 한글이 깨짐 — 「만든 때」가 사용자 화면과 같은 「留뚮뱺」으로" ($old[0] -like "*뚮뱺 ??2026*" -and $old[0] -notlike "*만든 때*") $old[0]
T "A2 (재현) 예전 방식은 「통과 258 / 실패 0」을 찾지 못함 — 결과 파일에서 요약 줄이 빠진 이유" (-not ($old | Where-Object { $_ -match "^통과 [0-9]+ / 실패" })) ($old[1])
$oldErr = @(& $fake both 2>&1)
$wrapped = @($oldErr | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }).Count
T "A3 (재현) 예전 방식은 오류 줄(stderr)이 오류 기록으로 감싸짐 — 빨간 글씨의 재료" ($wrapped -ge 1) ("오류 기록 " + $wrapped + "건")

# ── B. 새 방식 — 같은 조건(CP949)에서 ────────────────────────────────────────────────────────
$new = @(N @("kor") "Capture")
T "B1 한글이 그대로 — 「만든 때」" ($new[0] -eq "sha256:abc  만든 때 2026-09-23T21:10:23Z") $new[0]
T "B2 「통과 258 / 실패 0」을 찾음" ([bool]($new | Where-Object { $_ -match "^통과 [0-9]+ / 실패" })) $new[1]
T "B3 상자 글자 · 원 숫자 · 가운뎃점" ($new[2] -eq "════ 1. 본체 검정 (sgb_check) ════" -and $new[3] -eq "  안전  ① WHERE 없는 UPDATE·DELETE 없음") ($new[2] + " | " + $new[3])
T "B4 종료 코드 0" ($LASTEXITCODE -eq 0) "$LASTEXITCODE"

$errBefore = $Error.Count
$tee = @(N @("both") "Tee")
$types = @($tee | ForEach-Object { $_.GetType().Name } | Sort-Object -Unique) -join ","
T "B5 오류 줄이 보통 글자 줄로 옴 (오류 기록 0)" ($types -eq "String" -and $tee.Count -eq 4) ("줄 " + $tee.Count + " · 형식 " + $types)
T "B6 오류 목록(`$Error)에 아무것도 쌓이지 않음" ($Error.Count -eq $errBefore) ("전 " + $errBefore + " · 후 " + $Error.Count)
T "B7 오류 줄의 한글" ([bool]($tee -contains "오류 줄 한글") -and [bool]($tee -contains " Container sgb-db Creating ")) (($tee -join " | "))
$cap = @(N @("both") "Capture")
T "B8 Capture 는 표준 출력만 (오류 줄 제외)" ($cap.Count -eq 2 -and $cap[0] -eq "표준 출력 한 줄" -and $cap[1] -eq "표준 출력 두 줄") (($cap -join " | "))
$sil = @(N @("both") "Silent")
T "B9 Silent 는 아무것도 돌려주지 않음" ($sil.Count -eq 0) ("" + $sil.Count)
$shw = @(N @("both") "Show")
T "B10 Show 는 화면에만 — 돌려주는 값 없음" ($shw.Count -eq 0) ("" + $shw.Count)

# ── C. 종료 코드 ─────────────────────────────────────────────────────────────────────────────
$null = N @("code", "3") "Silent"; T "C1 종료 코드 3" ($LASTEXITCODE -eq 3) "$LASTEXITCODE"
$null = N @("code", "0") "Silent"; T "C2 종료 코드 0 으로 되돌아옴" ($LASTEXITCODE -eq 0) "$LASTEXITCODE"
$r = @(Invoke-Native -File "no-such-program-xyz" -ArgList @("a") -Mode "Capture")
T "C3 없는 프로그램 — 멈추지 않고 127" ($LASTEXITCODE -eq 127 -and $r.Count -eq 0) "$LASTEXITCODE"

# ── D. 인자 · 폴더 · 환경 값 ─────────────────────────────────────────────────────────────────
$argsIn = @("compose", "--profile", "check", "-T", "select count(*) from schema_migrations", "{{range .Config.Env}}{{.}} {{end}}", "{{.Id}}|{{.Created}}",
            'a"b', 'c\d', 'e f\', 'g\"h', "", "한글 인자", '$x;&|%y', "tab`there", "--format={{json .}}")
$back = @(N (@("args") + $argsIn) "Capture")
$exp = @($argsIn | ForEach-Object { "[" + $_ + "]" })
T "D1 인자 16개가 글자 하나 다르지 않게 전달됨 (빈칸 · 따옴표 · 역슬래시 · 빈 값 · 한글 · 기호)" (($back -join "`n") -eq ($exp -join "`n")) ("받은 수 " + $back.Count)
$j = Join-NativeArgs @("a b", 'a"b', 'a\b', 'a b\', 'a\"b', "", "{{.Id}}|{{.Created}}")
T "D2 명령 줄 만들기 — Windows 규칙" ($j -eq '"a b" "a\"b" a\b "a b\\" "a\\\"b" "" {{.Id}}|{{.Created}}') $j
$here = (Get-Location).ProviderPath
Push-Location "/tmp"
$pw = @(N @("pwd") "Capture")
Pop-Location
T "D3 작업 폴더 — PowerShell 의 현재 위치를 따름(프로세스의 위치가 아님)" ($pw[0] -eq "/tmp" -and [Environment]::CurrentDirectory -ne "/tmp") ($pw[0] + " · 프로세스 " + [Environment]::CurrentDirectory)
$env:SGB_RESET = "1"; $e1 = @(N @("env") "Capture"); $env:SGB_RESET = "0"; $e0 = @(N @("env") "Capture"); Remove-Item Env:SGB_RESET
T "D4 환경 값(`$env:SGB_RESET)이 전달됨 — dev.ps1 reset 이 쓰는 방식" ($e1[0] -eq "1" -and $e0[0] -eq "0") ($e1[0] + " → " + $e0[0])

# ── E. 양 · 순서 · 막힘 ──────────────────────────────────────────────────────────────────────
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$many = @(N @("many", "20000") "Tee")
$o = @($many | Where-Object { $_ -like "out *" }); $e = @($many | Where-Object { $_ -like "err *" })
$inOrder = $true; for ($i = 0; $i -lt $o.Count; $i++) { if ($o[$i] -ne ("out " + ($i + 1))) { $inOrder = $false; break } }
T "E1 표준 출력 2만 줄 + 오류 줄 2만 줄 — 빠짐 0 · 막힘 없음 · 같은 통로 안 순서 유지" ($o.Count -eq 20000 -and $e.Count -eq 20000 -and $inOrder) ("out " + $o.Count + " · err " + $e.Count + " · " + [int]$sw.Elapsed.TotalSeconds + "초")
$sq = @(N @("seq", "50000") "Capture"); T "E2 5만 줄 순서" ($sq.Count -eq 50000 -and $sq[0] -eq "1" -and $sq[49999] -eq "50000") ("" + $sq.Count)
$lg = @(N @("long", "300000") "Capture"); T "E3 30만 글자 한 줄" ($lg.Count -eq 1 -and $lg[0].Length -eq 300000) ("" + $lg[0].Length)
$sw.Restart(); $si = @(N @("stdin") "Capture"); T "E4 입력 통로를 닫아 둠 — 입력을 기다리는 명령이 멈추지 않음" ($si[0] -eq "stdin 0" -and $sw.Elapsed.TotalSeconds -lt 5) ($si[0] + " · " + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "초")
$sw.Restart(); $li = @(N @("linger") "Capture")
T "E5 손자 프로세스가 출력 통로를 쥐고 있어도 30초를 기다리지 않음" ($li[0] -eq "먼저 끝남" -and $LASTEXITCODE -eq 0 -and $sw.Elapsed.TotalSeconds -lt 10) ([math]::Round($sw.Elapsed.TotalSeconds, 1).ToString() + "초")
$sw.Restart(); $sl = @(N @("slow", "3") "Tee"); T "E6 조용한 3초 뒤의 줄도 받음" ($sl.Count -eq 2 -and $sl[1] -eq "끝") (($sl -join " | ") + " · " + [math]::Round($sw.Elapsed.TotalSeconds, 1) + "초")

# ── F. 글자 처리 ─────────────────────────────────────────────────────────────────────────────
$an = @(N @("ansi") "Capture"); T "F1 색 제어 문자를 지움" ($an[0] -eq "초록 글자 빨강") $an[0]
$bd = @(N @("bad") "Capture");  T "F2 UTF-8 이 아닌 바이트가 섞여도 멈추지 않음" ($bd.Count -eq 1 -and $bd[0].StartsWith("앞 ") -and $bd[0].EndsWith(" 뒤")) $bd[0]
$cr = @(N @("crlf") "Capture"); T "F3 CRLF 줄 끝 — 줄에 \r 이 남지 않음" ($cr.Count -eq 2 -and $cr[0] -eq "첫 줄" -and $cr[1] -eq "둘째 줄") (($cr -join "|"))

# ── G. 멈춤(Ctrl+C) — 띄운 프로세스와 자식까지 끝냄 ───────────────────────────────────────────
$ps = [powershell]::Create()
$null = $ps.AddScript({ param($kit, $fake) . (Join-Path (Join-Path $kit "docker") "native.ps1"); Invoke-Native -File $fake -ArgList @("tree") -Mode "Capture" }).AddArgument($kit).AddArgument($fake)
$h = $ps.BeginInvoke()
Start-Sleep -Seconds 2
$before = @(Get-Process -Name "sleep" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*sleep 300*" }).Count
$ps.Stop()
Start-Sleep -Seconds 2
$after = @(Get-Process -Name "sleep" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*sleep 300*" }).Count
$fk = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*fakecli tree*" }).Count
$ps.Dispose()
T "G1 멈추면 자식 프로세스까지 끝남 (남은 것 0)" ($before -ge 1 -and $after -eq 0 -and $fk -eq 0) ("멈추기 전 " + $before + " · 뒤 " + $after + " · 본체 " + $fk)

# ── H. .NET 으로 띄우지 못하면 예전 방식으로 — 그래도 결과는 같음 ────────────────────────────
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(949)
$lgc = @(Invoke-NativeLegacy $fake @("kor") "Capture")
T "H1 대비 경로(예전 방식 + UTF-8 지정)도 한글이 그대로" ($lgc[0] -like "*만든 때*") $lgc[0]
T "H2 대비 경로가 콘솔 설정을 되돌려 놓음" ([Console]::OutputEncoding.CodePage -eq 949) ("" + [Console]::OutputEncoding.CodePage)
$lt = @(Invoke-NativeLegacy $fake @("both") "Tee")
T "H3 대비 경로의 오류 줄도 보통 글자 줄" ((@($lt | ForEach-Object { $_.GetType().Name } | Sort-Object -Unique) -join ",") -eq "String" -and $lt.Count -eq 4) ("줄 " + $lt.Count)

$pass = @($items | Where-Object { $_.ok }).Count; $fail = $items.Count - $pass
[System.IO.File]::WriteAllText($out, (@{ items = $items; pass = $pass; fail = $fail } | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host ("통과 " + $pass + " · 실패 " + $fail + " → " + $(if ($fail -eq 0) { "ALL PASS" } else { "FAIL" }))
if ($fail -eq 0) { exit 0 } else { exit 1 }

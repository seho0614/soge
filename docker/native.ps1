# =====================================================================
# docker 를 PowerShell 의 「외부 명령 처리」를 거치지 않고 부르는 도우미   (10/6 · v10.17)
#   dev.ps1 · docker\realcheck.ps1 이 불러 씁니다 — 직접 실행하는 파일이 아닙니다.
#
# 왜 필요한가 — 실제 PC 에서 `.\dev.ps1 realcheck` 를 돌렸을 때 두 가지가 보였습니다(결과는 전부 통과였는데도).
#   ① 빨간 글씨   docker 는 진행 상황(Building · Creating …)을 오류 줄(stderr)로 냅니다. PowerShell ISE 처럼
#                 콘솔이 아닌 창에서는 PowerShell 이 그 줄을 「NativeCommandError」 오류로 감싸 빨갛게 보여 줍니다.
#   ② 깨진 한글   컨테이너가 내는 글자는 UTF-8 인데 PowerShell 은 그것을 콘솔 코드 페이지(한글 윈도우는 CP949)로
#                 읽습니다. 콘솔이 아닌 창에서는 그 설정을 바꾸는 것([Console]::OutputEncoding)도 듣지 않습니다.
#
# 어떻게 고쳤나
#   docker 를 .NET(System.Diagnostics.Process)으로 직접 띄우고, 나오는 줄을 **UTF-8 로 읽어** 그대로 보여 줍니다.
#   PowerShell 이 중간에서 읽지 않으므로 창의 종류 · 코드 페이지와 상관없이 같은 결과가 나옵니다.
#   (Windows PowerShell 5.1 · PowerShell ISE · PowerShell 7 · Windows 터미널)
#
# 쓰는 법
#   DkShow  @("compose", "up", "-d")            화면에 보여 주기만
#   DkTee   @("compose", "run", "--rm", "x")    화면에 보여 주고 줄도 돌려받기 (표준 출력 + 오류 줄)
#   DkGet   @("version", "--format", "{{.Server.Version}}")   줄만 돌려받기 (표준 출력만 · 화면에 안 보임)
#   DkQuiet @("info")                            아무것도 보이지 않게 — 종료 코드만 봄
#   종료 코드는 전과 같이 $LASTEXITCODE 에 들어 있습니다. docker 를 찾지 못하면 127.
#
# 이 파일은 UTF-8(BOM)입니다. Windows PowerShell 5.1 에서도 돌도록 5.1 문법 · .NET Framework 4.5 기능만 씁니다.
# =====================================================================

# 인자 목록 → 명령 줄 한 줄 (Windows 규칙: 빈칸 · 따옴표가 있으면 따옴표로 감싸고, 따옴표와 그 앞 역슬래시를 피함)
function Join-NativeArgs([string[]]$list) {
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($a in $list) {
    if ($null -eq $a -or $a.Length -eq 0) { $out.Add('""'); continue }
    if ($a -notmatch '[\s"]') { $out.Add($a); continue }
    $s = $a -replace '(\\*)"', '$1$1\"'
    $s = $s -replace '(\\+)$', '$1$1'
    $out.Add('"' + $s + '"')
  }
  return ($out -join " ")
}

# 색 넣는 제어 문자(ANSI)를 지움 — ISE 는 그것을 글자로 보여 줍니다
function Remove-NativeAnsi([string]$s) {
  if ($null -eq $s) { return "" }
  if ($s.IndexOf([char]27) -lt 0) { return $s }
  return [regex]::Replace($s, ([string][char]27) + '\[[0-9;?]*[ -/]*[@-~]', "")
}

# 띄운 프로세스와 그 자식(docker 는 compose 를 자식으로 띄웁니다)을 함께 끝냄 — Ctrl+C 로 멈췄을 때
function Stop-NativeTree($proc) {
  if ($null -eq $proc) { return }
  $done = $false
  if ($PSVersionTable.PSVersion.Major -ge 6) {
    try { $proc.Kill($true); $done = $true } catch { $done = $false }
  }
  if (-not $done) {
    try {
      $k = New-Object System.Diagnostics.ProcessStartInfo
      $k.FileName = "taskkill.exe"
      $k.Arguments = "/PID " + $proc.Id + " /T /F"
      $k.UseShellExecute = $false
      $k.CreateNoWindow = $true
      $kp = [System.Diagnostics.Process]::Start($k)
      if ($null -ne $kp) { [void]$kp.WaitForExit(5000); $kp.Dispose() }
    } catch { }
  }
  try { if (-not $proc.HasExited) { $proc.Kill() } } catch { }
}

# 예전 방식(PowerShell 이 대신 읽음) — .NET 으로 띄우지 못했을 때만 씁니다
function Invoke-NativeLegacy([string]$File, [string[]]$ArgList, [string]$Mode) {
  $ErrorActionPreference = "Continue"
  $enc = $null
  try { $enc = [Console]::OutputEncoding; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
  try {
    if ($Mode -eq "Silent") { & $File @ArgList *> $null }
    elseif ($Mode -eq "Capture") { & $File @ArgList 2>$null | ForEach-Object { "$_" } }
    elseif ($Mode -eq "Tee") { & $File @ArgList 2>&1 | ForEach-Object { $s = "$_"; Write-Host $s; $s } }
    else { & $File @ArgList 2>&1 | ForEach-Object { Write-Host "$_" } }
  } finally {
    if ($null -ne $enc) { try { [Console]::OutputEncoding = $enc } catch { } }
  }
}

function Invoke-Native {
  param([string]$File, [string[]]$ArgList = @(), [string]$Mode = "Show")
  $show    = ($Mode -eq "Show" -or $Mode -eq "Tee")
  $keepOut = ($Mode -eq "Tee" -or $Mode -eq "Capture")
  $keepErr = ($Mode -eq "Tee")

  # 1) 실행 파일 찾기
  #    -ErrorAction Ignore: 못 찾아도 오류 목록($Error)에 남기지 않습니다(빨간 글씨도 없음) — 아래에서 안내 한 줄로 알립니다
  $exe = $null
  try { $exe = Get-Command -Name $File -CommandType Application -ErrorAction Ignore | Select-Object -First 1 } catch { $exe = $null }
  if ($null -eq $exe) {
    if ($show) {
      if ($File -eq "docker") { Write-Host "  docker 명령을 찾지 못했습니다 — Docker Desktop 을 설치하고 켠 뒤, PowerShell 창을 새로 열어 다시 실행하십시오." }
      else { Write-Host ("  " + $File + " 명령을 찾지 못했습니다 — 설치되어 있는지 확인하십시오.") }
    }
    $global:LASTEXITCODE = 127
    return
  }
  $path = "$($exe.Path)"
  if (-not $path) { $path = $File }

  # 2) 띄우기 — 표준 출력 · 오류 줄을 UTF-8 로 받음
  $p = $null
  $started = $false
  if ($path -notmatch '\.(cmd|bat|ps1)$') {
    try {
      $utf8 = New-Object System.Text.UTF8Encoding($false)
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $path
      $psi.Arguments = Join-NativeArgs $ArgList
      $psi.WorkingDirectory = (Get-Location).ProviderPath
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $psi.RedirectStandardInput = $true
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $psi.StandardOutputEncoding = $utf8
      $psi.StandardErrorEncoding = $utf8
      $p = New-Object System.Diagnostics.Process
      $p.StartInfo = $psi
      [void]$p.Start()
      $started = $true
    } catch { $started = $false }
  }
  if (-not $started) {
    if ($null -ne $p) { try { $p.Dispose() } catch { } }
    Invoke-NativeLegacy $File $ArgList $Mode
    return
  }

  # 3) 줄 단위로 읽기 — 0.2초마다 돌아와 Ctrl+C 를 받을 수 있게 합니다
  $lines = New-Object System.Collections.Generic.List[string]
  $code = 1
  try {
    try { $p.StandardInput.Close() } catch { }
    $tOut = $p.StandardOutput.ReadLineAsync()
    $tErr = $p.StandardError.ReadLineAsync()
    $quiet = 0
    while ($null -ne $tOut -or $null -ne $tErr) {
      $got = $false
      if ($null -ne $tOut -and $tOut.IsCompleted) {
        $got = $true
        $s = $null
        try { $s = $tOut.Result } catch { $s = $null }
        if ($null -eq $s) { $tOut = $null }
        else {
          $s = Remove-NativeAnsi $s
          if ($show) { Write-Host $s }
          if ($keepOut) { $lines.Add($s) }
          $tOut = $p.StandardOutput.ReadLineAsync()
        }
      }
      if ($null -ne $tErr -and $tErr.IsCompleted) {
        $got = $true
        $s = $null
        try { $s = $tErr.Result } catch { $s = $null }
        if ($null -eq $s) { $tErr = $null }
        else {
          $s = Remove-NativeAnsi $s
          if ($show) { Write-Host $s }
          if ($keepErr) { $lines.Add($s) }
          $tErr = $p.StandardError.ReadLineAsync()
        }
      }
      if ($got) { $quiet = 0; continue }
      $wait = New-Object System.Collections.Generic.List[System.Threading.Tasks.Task]
      if ($null -ne $tOut) { $wait.Add($tOut) }
      if ($null -ne $tErr) { $wait.Add($tErr) }
      $hit = [System.Threading.Tasks.Task]::WaitAny($wait.ToArray(), 200)
      if ($hit -lt 0 -and $p.HasExited) {
        # 프로세스는 끝났는데 출력 통로가 닫히지 않음(손자 프로세스가 쥐고 있음) — 3초 더 기다리고 그만 읽습니다
        $quiet++
        if ($quiet -ge 15) { break }
      }
    }
    while (-not $p.WaitForExit(200)) { }
    $code = $p.ExitCode
  } finally {
    $alive = $false
    try { $alive = -not $p.HasExited } catch { $alive = $false }
    if ($alive) { Stop-NativeTree $p }
    try { $p.Dispose() } catch { }
  }
  $global:LASTEXITCODE = $code
  if ($keepOut) { return $lines.ToArray() }
}

function DkShow([string[]]$a)  { Invoke-Native -File "docker" -ArgList $a -Mode "Show" }
function DkTee([string[]]$a)   { Invoke-Native -File "docker" -ArgList $a -Mode "Tee" }
function DkGet([string[]]$a)   { Invoke-Native -File "docker" -ArgList $a -Mode "Capture" }
function DkQuiet([string[]]$a) { Invoke-Native -File "docker" -ArgList $a -Mode "Silent" }

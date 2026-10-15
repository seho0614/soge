param([string]$kit)
$bad = 0
foreach ($rel in @("dev.ps1", "docker/realcheck.ps1", "docker/native.ps1")) {
  $tokens = $null; $errs = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $kit $rel), [ref]$tokens, [ref]$errs)
  $t7 = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.TernaryExpressionAst] -or $n -is [System.Management.Automation.Language.PipelineChainAst] }, $true)).Count
  $qq = @($tokens | Where-Object { $_.Kind -in @('QuestionQuestion','QuestionQuestionEquals','QuestionDot','QuestionLBracket') }).Count
  $cmds = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Sort-Object -Unique)
  $direct = @($cmds | Where-Object { $_ -eq "docker" }).Count
  Write-Output ("{0}: parse errors {1} · PS7-only syntax {2} · PS7-only operators {3} · direct docker {4}" -f $rel, $errs.Count, $t7, $qq, $direct)
  Write-Output ("   commands: " + ($cmds -join " "))
  if ($errs.Count + $t7 + $qq + $direct -gt 0) { $bad++ }
}
exit $bad

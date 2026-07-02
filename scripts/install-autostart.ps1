param(
  [string]$TaskName = 'CodexTavernBridge',
  [switch]$KeepLegacyWeixinTasks
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $root 'start-bridge.bat'
if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Missing start script: $startScript"
}

$quotedStartScript = '"' + $startScript + '"'
$action = New-ScheduledTaskAction `
  -Execute "$env:ComSpec" `
  -Argument "/c $quotedStartScript --no-pause" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 365) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Starts the local Codex Tavern Bridge services from the installed SillyTavern extension folder." `
  -Force | Out-Null

if (-not $KeepLegacyWeixinTasks) {
  $legacyNames = @('CodexBridge-Weixin', 'CodexBridge-Weixin-Isolated')
  foreach ($legacyName in $legacyNames) {
    $task = Get-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
    if (-not $task) {
      continue
    }
    $legacyActionText = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join "`n"
    if ($legacyActionText -match 'CodexBridge(?:-weixin)?[\\/]scripts[\\/]service[\\/]run-weixin-service\.mjs') {
      Stop-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
      Disable-ScheduledTask -TaskName $legacyName | Out-Null
      Write-Host "Disabled legacy autostart task: $legacyName"
    }
  }
}

Write-Host "Registered autostart task: $TaskName"
Write-Host "Target: $startScript --no-pause"

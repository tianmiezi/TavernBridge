param(
  [string]$Python = "python",
  [string]$VenvPath = "",
  [string]$WheelDir = "",
  [string]$Mirror = "",
  [int]$Port = 8795,
  [switch]$OpenFirewall,
  [switch]$SkipInstall,
  [switch]$UseSystemSitePackages
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $VenvPath) {
  $VenvPath = Join-Path $root ".venv-uiauto-worker"
}
$venvPython = Join-Path $VenvPath "Scripts\python.exe"

Write-Host "CodexTavernBridge UIAuto/VM setup"
Write-Host "Root: $root"
Write-Host "Virtual env: $VenvPath"

if (-not (Test-Path $venvPython)) {
  Write-Host "Creating Python virtual environment..."
  $venvArgs = @("-m", "venv")
  if ($UseSystemSitePackages) {
    $venvArgs += "--system-site-packages"
  }
  $venvArgs += $VenvPath
  & $Python @venvArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Python virtual environment with $Python"
  }
}

& $venvPython --version
if ($LASTEXITCODE -ne 0) {
  throw "Virtual environment Python is not available: $venvPython"
}

if (-not $SkipInstall) {
  if ($WheelDir) {
    if (-not (Test-Path $WheelDir)) {
      throw "WheelDir does not exist: $WheelDir"
    }
    Write-Host "Installing wxautox from local wheel directory: $WheelDir"
    & $venvPython -m pip install --no-index --find-links $WheelDir wxautox
  } elseif ($Mirror) {
    Write-Host "Installing wxautox from mirror: $Mirror"
    & $venvPython -m pip install -i $Mirror wxautox
  } else {
    Write-Host "Installing wxautox from PyPI"
    & $venvPython -m pip install wxautox
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency install failed with exit code $LASTEXITCODE"
  }
}

if ($OpenFirewall) {
  $ruleName = "CodexTavernBridge UIAuto Worker $Port"
  Write-Host "Creating firewall rule: $ruleName"
  try {
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existing) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    }
  } catch {
    Write-Warning "Firewall rule was not created. Run PowerShell as Administrator or allow TCP $Port manually."
  }
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Start inside the VM with:"
Write-Host "  .\vm-worker\start-uiauto-worker.bat"
Write-Host ""
Write-Host "If the host cannot reach the VM, allow inbound TCP $Port in Windows Firewall."

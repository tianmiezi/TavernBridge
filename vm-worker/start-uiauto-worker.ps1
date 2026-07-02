param(
  [string]$Python = "python",
  [string]$VenvPath = "",
  [string]$HostName = "0.0.0.0",
  [int]$Port = 8795,
  [switch]$InstallDeps,
  [string]$WheelDir = "",
  [string]$Mirror = "",
  [switch]$FakeListener
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$worker = Join-Path $root "server\tools\wxauto_worker\worker.py"
if (-not (Test-Path $worker)) {
  throw "UIAuto worker not found: $worker"
}

if (-not $VenvPath) {
  $VenvPath = Join-Path $root ".venv-uiauto-worker"
}
$venvPython = Join-Path $VenvPath "Scripts\python.exe"
if ((Test-Path $venvPython) -and $Python -eq "python") {
  $Python = $venvPython
}

Write-Host "Python: $Python"
Write-Host "Worker: $worker"
& $Python --version
if ($LASTEXITCODE -ne 0) {
  throw "Python is not available."
}

if ($InstallDeps) {
  if ($WheelDir) {
    Write-Host "Installing wxautox from local wheel directory: $WheelDir"
    & $Python -m pip install --no-index --find-links $WheelDir wxautox
  } elseif ($Mirror) {
    Write-Host "Installing wxautox from mirror: $Mirror"
    & $Python -m pip install -i $Mirror wxautox
  } else {
    Write-Host "Installing wxautox from PyPI"
    & $Python -m pip install wxautox
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency install failed with exit code $LASTEXITCODE"
  }
}

$env:WXAUTO_BACKEND = if ($env:WXAUTO_BACKEND) { $env:WXAUTO_BACKEND } else { "wxautox" }
$env:WXAUTO_WORKER_HOST = $HostName
$env:WXAUTO_WORKER_PORT = [string]$Port
if ($FakeListener) {
  $env:WXAUTO_FAKE_LISTENER = "1"
}

$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress
} catch {
  $ips = @()
}

Write-Host "Starting UIAuto VM worker on http://${HostName}:$Port"
Write-Host ""
Write-Host "Important:"
Write-Host "  http://${HostName}:$Port is the listen address inside this VM."
Write-Host "  Do NOT paste 0.0.0.0 into the host console."
if ($ips.Count -gt 0) {
  Write-Host "Paste one of these host-side worker URL candidates into Channels -> UIAuto/VM:"
  foreach ($ip in $ips) {
    Write-Host "  http://${ip}:$Port"
  }
} else {
  Write-Host "No non-loopback IPv4 address was detected. Check the VM network adapter."
}
Write-Host ""
Write-Host "If the host console cannot connect, run setup as Administrator with -OpenFirewall or allow inbound TCP $Port in Windows Firewall."
Write-Host "Keep official Windows WeChat open and logged in inside this VM."
& $Python $worker --host $HostName --port $Port
if ($LASTEXITCODE -ne 0) {
  throw "UIAuto VM worker exited with code $LASTEXITCODE"
}

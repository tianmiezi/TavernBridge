param(
  [string]$Url = "http://127.0.0.1:8795",
  [switch]$Deep,
  [string]$Contact = ""
)

$ErrorActionPreference = "Stop"
$base = $Url.TrimEnd("/")
$healthPath = if ($Deep) { "/health?deep=1" } else { "/health" }

Write-Host "Checking UIAuto worker: $base$healthPath"
$health = Invoke-RestMethod "$base$healthPath" -Method Get -TimeoutSec 8
$health | ConvertTo-Json -Depth 8

if ($Contact) {
  Write-Host ""
  Write-Host "Registering/listening contact through /poll: $Contact"
  $body = @{
    owner_contact_name = $Contact
    recent_signatures = @()
  } | ConvertTo-Json -Depth 8
  $poll = Invoke-RestMethod "$base/poll" -Method Post -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 8
  $poll | ConvertTo-Json -Depth 8
}

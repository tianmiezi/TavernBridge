@echo off
setlocal
set "NO_PAUSE=0"
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"
if /i "%~2"=="--no-pause" set "NO_PAUSE=1"

cd /d "%~dp0server"
echo Stopping old Codex Tavern Bridge processes on ports 8787/8790...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path '.').Path; $ports=@(8787,8790); $ids=@(); $ids += Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 }; $ids += Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and (($_.CommandLine -like ('*' + $root + '*') -and $_.CommandLine -match 'bridge-server|start-integrated|src[\\/]+cli\.ts|weixin serve|tsx') -or $_.CommandLine -match 'ctb_keepalive=1|codex-tavern-bridge-keepalive-browser') } | Select-Object -ExpandProperty ProcessId; foreach($procId in ($ids | Sort-Object -Unique)){ Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }"
echo.
echo Installing/updating local server dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)
echo.
echo Starting Codex Tavern Bridge integrated server...
echo Bridge SSE: http://127.0.0.1:8787
echo Admin UI:   http://127.0.0.1:8790
echo.
call npm start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%

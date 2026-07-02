@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-autostart.ps1" %*
if errorlevel 1 (
  echo.
  echo Failed to install Codex Tavern Bridge autostart.
  pause
  exit /b 1
)
echo.
echo Codex Tavern Bridge autostart is ready.
pause

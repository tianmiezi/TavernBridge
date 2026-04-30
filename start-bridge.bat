@echo off
setlocal
cd /d "%~dp0server"
echo Installing/updating local server dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)
echo.
echo Starting Codex Tavern Bridge integrated server...
echo Bridge SSE: http://127.0.0.1:8787
echo Admin UI:   http://127.0.0.1:8790
echo.
call npm start
pause

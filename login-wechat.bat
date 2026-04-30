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
echo Starting WeChat ClawBot login...
echo A QR image will be written under %%USERPROFILE%%\.codexbridge-weixin\weixin\login
echo.
call npm run login
pause

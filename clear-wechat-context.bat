@echo off
setlocal
cd /d "%~dp0server"
call npm run clear-context
pause

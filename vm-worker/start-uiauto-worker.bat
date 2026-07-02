@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-uiauto-worker.ps1" %*
pause

@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-uiauto-worker.ps1" %*
pause

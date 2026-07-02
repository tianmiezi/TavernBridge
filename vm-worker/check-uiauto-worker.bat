@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-uiauto-worker.ps1" %*
pause

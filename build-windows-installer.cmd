@echo off
setlocal
cd /d "%~dp0"
call npm run ensure:electron
if errorlevel 1 exit /b 1
call npm run dist:win

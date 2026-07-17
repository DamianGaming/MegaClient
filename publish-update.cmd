@echo off
setlocal
cd /d "%~dp0"

echo.
echo MegaClient Update Publisher
echo ---------------------------
set /p "VERSION=Enter the new launcher version (example: 1.8.1): "
if "%VERSION%"=="" (
  echo No version was entered.
  pause
  exit /b 1
)

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\release.ps1" -Version "%VERSION%"
if errorlevel 1 (
  echo.
  echo The update was not published. Read the error above, fix it, and try again.
  pause
  exit /b 1
)

echo.
echo MegaClient %VERSION% was pushed successfully.
echo Open GitHub Actions to watch the installer build.
pause

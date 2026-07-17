@echo off
setlocal
cd /d "%~dp0"

echo.
echo MegaClient Repository Publisher
echo -------------------------------

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: This folder is not a Git repository.
  echo Use publish-megaclient-update.cmd instead when publishing from an extracted source ZIP.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%V"
set /p "VERSION=Version to publish [%CURRENT_VERSION%]: "
if "%VERSION%"=="" set "VERSION=%CURRENT_VERSION%"

call npm run discord:verify >nul 2>&1
if errorlevel 1 (
  call configure-discord-activity.cmd
  if errorlevel 1 exit /b 1
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
start "" "https://github.com/DamianGaming/MegaClient/actions"
pause

@echo off
setlocal EnableExtensions
title MegaClient v1.12.22 - Retry Failed GitHub Tag
cd /d "%~dp0"
set "TARGET=%USERPROFILE%\Downloads\MegaClient-Publisher"
if not exist "%TARGET%\.git" (
  echo ERROR: The publisher repository was not found at:
  echo %TARGET%
  echo Run publish-megaclient-update.cmd first, or restore your publisher clone.
  pause
  exit /b 1
)
where git >nul 2>&1
if errorlevel 1 (echo ERROR: Git for Windows is not available. & pause & exit /b 1)
where node >nul 2>&1
if errorlevel 1 (echo ERROR: Node.js is not available. & pause & exit /b 1)
echo.
echo Retrying only the missing v1.12.22 GitHub release tag...
echo The existing published main commit will NOT be changed.
echo.
node "%~dp0scripts\push-release-tag.mjs" --version 1.12.22 --expected-commit a4387fa63e98f59e7c90011919d4b88e0f03da51 --repo "%TARGET%" --branch main
if errorlevel 1 (
  echo.
  echo Tag retry could not be completed. Review the error above.
  pause
  exit /b 1
)
echo.
echo The v1.12.22 GitHub tag is verified. Check GitHub Actions for the installer build.
start "" "https://github.com/DamianGaming/MegaClient/actions"
pause
exit /b 0

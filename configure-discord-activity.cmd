@echo off
setlocal
cd /d "%~dp0"
echo.
echo MegaClient Discord Activity Setup
echo ---------------------------------
echo 1. Create a Discord application in the Discord Developer Portal.
echo 2. Open General Information and copy the Application ID.
echo 3. Paste the numeric ID below before publishing MegaClient.
echo.
set /p "APPID=Discord Application ID: "
powershell -NoProfile -Command "if ('%APPID%' -match '^\d{17,20}$') { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo.
  echo Invalid ID. Discord Application IDs contain 17 to 20 numbers.
  pause
  exit /b 1
)
if not exist "resources\discord" mkdir "resources\discord"
>"resources\discord\application-id.txt" echo %APPID%
echo.
echo Discord activity is configured for the next MegaClient build.
echo Players do not need to configure anything themselves.
pause

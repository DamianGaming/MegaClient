@echo off
setlocal
cd /d "%~dp0"

echo [MegaClient] Installing locked dependencies...
call npm ci --no-audit --no-fund --foreground-scripts
if errorlevel 1 goto :error

echo.
echo [MegaClient] Verifying Electron runtime...
call npm run ensure:electron
if errorlevel 1 goto :error

echo.
echo [MegaClient] Setup completed successfully.
echo Run: npm run dev
exit /b 0

:error
echo.
echo [MegaClient] Setup failed. Review the error above.
exit /b 1

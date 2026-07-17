@echo off
setlocal EnableExtensions EnableDelayedExpansion
title MegaClient One-Click Update Publisher

cd /d "%~dp0"
set "SOURCE=%CD%"
set "TARGET=%USERPROFILE%\Downloads\MegaClient-Publisher"
set "REPO=https://github.com/DamianGaming/MegaClient.git"

echo.
echo MegaClient One-Click Update Publisher
echo -------------------------------------
echo Source: %SOURCE%
echo Publisher repository: %TARGET%
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git for Windows is not installed or is not available in PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js/npm is not installed or is not available in PATH.
    pause
    exit /b 1
)

if /I "%SOURCE%"=="%TARGET%" (
    echo ERROR: Run this file from the updated MegaClient source folder.
    echo Do not run it from the MegaClient-Publisher repository itself.
    pause
    exit /b 1
)

if not exist "%SOURCE%\package.json" (
    echo ERROR: package.json was not found beside this CMD file.
    echo Place this file in the root of the updated MegaClient source folder.
    pause
    exit /b 1
)

if not exist "%TARGET%\.git" (
    if exist "%TARGET%" (
        echo ERROR: %TARGET% already exists but is not a Git repository.
        echo Rename or delete that folder, then run this file again.
        pause
        exit /b 1
    )

    echo Cloning DamianGaming/MegaClient...
    git clone --no-tags "%REPO%" "%TARGET%"
    if errorlevel 1 goto :failed
) else (
    echo Refreshing the publisher repository...
    git -C "%TARGET%" fetch origin refs/heads/main:refs/remotes/origin/main --no-tags
    if errorlevel 1 goto :failed

    git -C "%TARGET%" checkout -B main origin/main
    if errorlevel 1 goto :failed

    git -C "%TARGET%" reset --hard origin/main
    if errorlevel 1 goto :failed
)

rem Remove the old accidental local tag named "main" if the repository has it.
git -C "%TARGET%" tag -d main >nul 2>&1

echo.
echo Copying the updated launcher into the publisher repository...
robocopy "%SOURCE%" "%TARGET%" /MIR /R:2 /W:1 /XD ".git" "node_modules" "out" "release" /XF "*.log"
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
    echo ERROR: Robocopy failed with code %ROBOCODE%.
    pause
    exit /b %ROBOCODE%
)

cd /d "%TARGET%"

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%V"
if not defined CURRENT_VERSION (
    echo ERROR: Could not read the launcher version from package.json.
    pause
    exit /b 1
)

echo.
set /p "VERSION=Version to publish [!CURRENT_VERSION!]: "
if not defined VERSION set "VERSION=!CURRENT_VERSION!"

echo !VERSION!| findstr /R /X "[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*" >nul
if errorlevel 1 (
    echo ERROR: Enter a version such as 1.8.1 or 1.8.2.
    pause
    exit /b 1
)

if /I not "!VERSION!"=="!CURRENT_VERSION!" (
    echo Updating package version to !VERSION!...
    call npm version !VERSION! --no-git-tag-version
    if errorlevel 1 goto :failed
)

set "TAG=v!VERSION!"

git ls-remote --exit-code --tags origin "refs/tags/!TAG!" >nul 2>&1
if not errorlevel 1 (
    echo ERROR: The GitHub tag !TAG! already exists.
    echo Use a newer version number.
    pause
    exit /b 1
)

rem A failed earlier publish may have left the tag only in this local clone.
git rev-parse -q --verify "refs/tags/!TAG!" >nul 2>&1
if not errorlevel 1 (
    echo Removing unfinished local tag !TAG! from the previous failed attempt...
    git tag -d "!TAG!" >nul 2>&1
)

echo.
echo Installing exact dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo Verifying the protected MegaClient client...
call npm run client:verify
if errorlevel 1 goto :failed

echo.
echo Running TypeScript checks...
call npm run typecheck
if errorlevel 1 goto :failed

echo.
echo Building MegaClient...
call npm run build
if errorlevel 1 goto :failed

echo.
echo Preparing the GitHub release...
git add -A
if errorlevel 1 goto :failed

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Release !TAG!"
    if errorlevel 1 goto :failed
) else (
    echo No new file changes were found; the current commit will be tagged.
)

git tag "!TAG!"
if errorlevel 1 goto :failed

echo.
echo Pushing the main branch...
git push origin refs/heads/main:refs/heads/main
if errorlevel 1 goto :failed

echo.
echo Pushing the release tag...
git push origin "refs/tags/!TAG!:refs/tags/!TAG!"
if errorlevel 1 goto :failed

echo.
echo SUCCESS: MegaClient !VERSION! was pushed to GitHub.
echo GitHub Actions will now build and publish the Windows installer.
echo.
start "" "https://github.com/DamianGaming/MegaClient/actions"
pause
exit /b 0

:failed
echo.
echo ERROR: The update was not published.
echo Read the failed command above, fix the issue, and run this file again.
pause
exit /b 1

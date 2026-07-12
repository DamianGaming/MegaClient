param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js/npm is required.' }

npm version $Version --no-git-tag-version
npm ci --no-audit --no-fund --foreground-scripts
npm run typecheck
git add package.json package-lock.json
git commit -m "Release v$Version"
git tag "v$Version"
git push
git push origin "v$Version"
Write-Host "Release v$Version has been pushed. GitHub Actions will build the update metadata and Windows installer." -ForegroundColor Green

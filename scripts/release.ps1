param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js/npm is required.' }

$Tag = "v$Version"
$ExistingTag = git tag --list $Tag
if ($ExistingTag -eq $Tag) { throw "The tag $Tag already exists. Use a newer version number." }

$CurrentVersion = node -p "require('./package.json').version"
if ($CurrentVersion -ne $Version) {
  Write-Host "Updating MegaClient from $CurrentVersion to $Version..." -ForegroundColor Cyan
  npm version $Version --no-git-tag-version
} else {
  Write-Host "MegaClient is already set to version $Version." -ForegroundColor DarkCyan
}

Write-Host 'Installing exact dependencies...' -ForegroundColor Cyan
npm ci --no-audit --no-fund --foreground-scripts

Write-Host 'Validating the protected client...' -ForegroundColor Cyan
npm run client:verify

Write-Host 'Checking and building the launcher...' -ForegroundColor Cyan
npm run build

# Include the actual launcher changes as well as the version files. Ignored build
# directories and local secrets remain excluded by .gitignore.
git add -A
$Pending = git status --porcelain
if ($Pending) {
  git commit -m "Release $Tag"
} else {
  Write-Host 'No uncommitted source changes were found; creating the release tag from the current commit.' -ForegroundColor DarkGray
}

git tag $Tag
git push
git push origin $Tag
Write-Host "Release $Tag has been pushed. GitHub Actions will build the Windows installer and update metadata." -ForegroundColor Green

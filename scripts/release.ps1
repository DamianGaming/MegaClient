param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

function Invoke-Checked {
  param(
    [Parameter(Mandatory=$true)][string]$Command,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$FailureMessage
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)."
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required. Install Git for Windows and reopen the terminal.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js/npm is required. Install Node.js and reopen the terminal.' }

$InsideRepository = (& git rev-parse --is-inside-work-tree 2>$null)
if ($LASTEXITCODE -ne 0 -or ($InsideRepository | Out-String).Trim() -ne 'true') {
  throw 'This folder is not a Git repository. Use publish-megaclient-update.cmd from an extracted source package, or run this publisher inside the repository clone.'
}

$Origin = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($Origin | Out-String).Trim())) {
  throw 'This Git repository has no origin remote.'
}

$Branch = (& git branch --show-current)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($Branch | Out-String).Trim())) {
  throw 'MegaClient must be on a normal Git branch before publishing.'
}
$Branch = ($Branch | Out-String).Trim()
$Tag = "v$Version"

$ExistingRemoteTag = (& git ls-remote --tags origin "refs/tags/$Tag")
if ($LASTEXITCODE -ne 0) { throw 'Git could not check release tags on GitHub.' }
if (-not [string]::IsNullOrWhiteSpace(($ExistingRemoteTag | Out-String).Trim())) {
  throw "The GitHub tag $Tag already exists. Use a newer version number."
}

$ExistingLocalTag = (& git tag --list $Tag)
if (($ExistingLocalTag | Out-String).Trim() -eq $Tag) {
  Invoke-Checked 'git' @('tag', '-d', $Tag) "Git could not remove the unfinished local tag $Tag"
}

$CurrentVersion = (& node -p "require('./package.json').version")
if ($LASTEXITCODE -ne 0) { throw 'Could not read package.json.' }
$CurrentVersion = ($CurrentVersion | Out-String).Trim()

if ($CurrentVersion -ne $Version) {
  Write-Host "Updating MegaClient from $CurrentVersion to $Version..." -ForegroundColor Cyan
  Invoke-Checked 'npm' @('version', $Version, '--no-git-tag-version') 'MegaClient could not update its package version'
} else {
  Write-Host "MegaClient is already set to version $Version." -ForegroundColor DarkCyan
}

Write-Host 'Installing exact dependencies...' -ForegroundColor Cyan
Invoke-Checked 'npm' @('ci', '--no-audit', '--no-fund', '--foreground-scripts') 'Dependency installation failed'

Write-Host 'Validating the protected client...' -ForegroundColor Cyan
Invoke-Checked 'npm' @('run', 'client:verify') 'Protected client validation failed'

Write-Host 'Checking Discord activity configuration...' -ForegroundColor Cyan
Invoke-Checked 'npm' @('run', 'discord:verify') 'Discord activity configuration is incomplete'

Write-Host 'Checking and building the launcher...' -ForegroundColor Cyan
Invoke-Checked 'npm' @('run', 'build') 'Launcher validation or build failed'

Invoke-Checked 'git' @('add', '-A') 'Git could not stage the release files'
$Pending = (& git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Git could not inspect pending changes.' }
if (-not [string]::IsNullOrWhiteSpace(($Pending | Out-String).Trim())) {
  Invoke-Checked 'git' @('commit', '-m', "Release $Tag") 'Git could not create the release commit'
} else {
  Write-Host 'No uncommitted source changes were found; the release tag will use the current commit.' -ForegroundColor DarkGray
}

Invoke-Checked 'git' @('tag', $Tag) "Git could not create $Tag"
Invoke-Checked 'git' @('push', 'origin', "refs/heads/${Branch}:refs/heads/${Branch}") "Git could not push branch $Branch"
Invoke-Checked 'git' @('push', 'origin', "refs/tags/${Tag}:refs/tags/${Tag}") "Git could not push tag $Tag"

Write-Host "Release $Tag has been pushed successfully." -ForegroundColor Green
Write-Host 'GitHub Actions will now build the Windows installer and updater files.' -ForegroundColor Green

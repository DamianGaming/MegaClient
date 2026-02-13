param(
  [ValidateSet("17","21")]
  [string]$Major = "21"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$proj = Split-Path -Parent $root
$dest = Join-Path $proj "src-tauri\resources\jre"

Write-Host "Downloading Eclipse Temurin JRE $Major (Windows x64)..." -ForegroundColor Cyan

$tmp = Join-Path $env:TEMP ("temurin-jre{0}.zip" -f $Major)
$uri = "https://api.adoptium.net/v3/binary/latest/$Major/ga/windows/x64/jre/hotspot/normal/adoptium"

Invoke-WebRequest -Uri $uri -OutFile $tmp -UseBasicParsing

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest | Out-Null

Expand-Archive -Path $tmp -DestinationPath $dest

# The zip contains a single top-level folder; flatten it to /jre/*
$top = Get-ChildItem -Path $dest | Where-Object { $_.PSIsContainer } | Select-Object -First 1
if ($null -eq $top) { throw "Unexpected archive layout; no top-level folder found." }

Get-ChildItem -Path $top.FullName | ForEach-Object {
  Move-Item -Path $_.FullName -Destination $dest -Force
}
Remove-Item $top.FullName -Recurse -Force

Write-Host "Bundled JRE extracted to: $dest" -ForegroundColor Green
Write-Host "Note: this folder will be included in builds via tauri.bundle.resources." -ForegroundColor Green

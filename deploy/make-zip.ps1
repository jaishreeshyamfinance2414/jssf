# Creates jssf.zip next to the project, ready to upload to the server.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File deploy\make-zip.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path (Split-Path -Parent $root) "jssf.zip"

$staging = Join-Path $env:TEMP "jssf-zip-staging"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

# copy project excluding heavy/secret dirs
robocopy $root $staging /E `
  /XD node_modules .next dist .git uploads coverage `
  /XF .env .env.local *.log tsconfig.tsbuildinfo | Out-Null

if (Test-Path $out) { Remove-Item $out -Force }
# use Windows built-in bsdtar — Compress-Archive writes backslash paths that
# Linux unzip cannot extract correctly (full path avoids Git's GNU tar,
# which misreads "E:" as a remote host)
& "$env:SystemRoot\System32\tar.exe" -a -c -f $out -C $staging "."
Remove-Item $staging -Recurse -Force
Write-Host "Created $out"
Write-Host "Upload with: scp -i your-key.pem `"$out`" ubuntu@YOUR_SERVER_IP:~"

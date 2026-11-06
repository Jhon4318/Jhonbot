param(
  [string]$DistDirectory = 'dist'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $repoRoot $DistDirectory
$unpackedApp = Join-Path $distRoot 'win-unpacked'
$resources = Join-Path $unpackedApp 'resources'
$sourceAsar = Join-Path $resources 'app.asar'

if (!(Test-Path $sourceAsar -PathType Leaf)) {
  throw "Packaged application was not found: $sourceAsar"
}

$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+') {
  throw "Invalid application version: $version"
}

$minimumSupportedVersion = '0.3.9'
$stageParent = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$stage = Join-Path $stageParent "JBU-$version"
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'resources') -Force | Out-Null

Copy-Item -LiteralPath $sourceAsar -Destination (Join-Path $stage 'resources/app.asar')
$sourceUnpacked = Join-Path $resources 'app.asar.unpacked'
$hasUnpacked = Test-Path $sourceUnpacked -PathType Container
$unpackedArchivePath = Join-Path $stage 'resources/app.asar.unpacked.zip'

if ($hasUnpacked) {
  # Keep long node_modules paths out of the outer ZIP. Windows Explorer only
  # extracts the short resources/app.asar.unpacked.zip entry.
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $sourceUnpacked,
    $unpackedArchivePath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Apply-Update.ps1') -Destination $stage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Apply-Update.bat') -Destination $stage

$asarHash = (Get-FileHash -LiteralPath (Join-Path $stage 'resources/app.asar') -Algorithm SHA256).Hash.ToLowerInvariant()
$unpackedArchiveHash = $null
if ($hasUnpacked) {
  $unpackedArchiveHash = (Get-FileHash -LiteralPath $unpackedArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$manifest = [ordered]@{
  appId = [string]$package.build.appId
  productName = [string]$package.build.productName
  version = $version
  minimumSupportedVersion = $minimumSupportedVersion
  electronVersion = [string]$package.devDependencies.electron
  appAsarSha256 = $asarHash
  hasUnpacked = $hasUnpacked
  unpackedArchiveSha256 = $unpackedArchiveHash
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'update-manifest.json') -Encoding UTF8

$zipPath = Join-Path $distRoot "Bedrock-Bot-Console-Update-$version.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $stage,
  $zipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

if (!(Test-Path $zipPath -PathType Leaf)) {
  throw 'Manual update ZIP was not created.'
}
$zipSize = (Get-Item -LiteralPath $zipPath).Length
if ($zipSize -lt 1000000) {
  throw "Manual update ZIP is unexpectedly small: $zipSize bytes."
}
Write-Host "Created manual update package: $zipPath ($zipSize bytes)"
if ($hasUnpacked) {
  Write-Host 'Deep application files are stored in resources/app.asar.unpacked.zip to keep outer ZIP paths short.'
}
Write-Host 'The update package does not replace the Electron runtime.'

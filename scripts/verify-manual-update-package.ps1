param(
  [Parameter(Mandatory = $true)]
  [string]$UpdateZip
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (!(Test-Path $UpdateZip -PathType Leaf)) {
  throw "Update ZIP not found: $UpdateZip"
}

$outer = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $UpdateZip).Path)
try {
  $outerPaths = @($outer.Entries | ForEach-Object { $_.FullName })
  $required = @(
    'Apply-Update.bat',
    'Apply-Update.ps1',
    'update-manifest.json',
    'resources/app.asar'
  )
  foreach ($path in $required) {
    if ($outerPaths -notcontains $path) {
      throw "Outer ZIP is missing $path."
    }
  }
  if ($outerPaths | Where-Object { $_ -like 'resources/app.asar.unpacked/*' }) {
    throw 'Deep app.asar.unpacked files must not be stored directly in the outer ZIP.'
  }
  $tooLongOuter = @($outerPaths | Where-Object { $_.Length -gt 100 })
  if ($tooLongOuter.Count -gt 0) {
    throw "Outer ZIP contains unexpectedly long paths: $($tooLongOuter -join ', ')"
  }
} finally {
  $outer.Dispose()
}

$verifyRoot = Join-Path $env:RUNNER_TEMP 'jbu-outer'
$innerRoot = Join-Path $env:RUNNER_TEMP 'jbu-inner'
if (Test-Path $verifyRoot) { Remove-Item -LiteralPath $verifyRoot -Recurse -Force }
if (Test-Path $innerRoot) { Remove-Item -LiteralPath $innerRoot -Recurse -Force }
New-Item -ItemType Directory -Path $verifyRoot -Force | Out-Null

Expand-Archive -LiteralPath (Resolve-Path $UpdateZip).Path -DestinationPath $verifyRoot -Force
$manifest = Get-Content -LiteralPath (Join-Path $verifyRoot 'update-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.appId -ne 'com.jhonbot.bedrockbotconsole') {
  throw 'Update manifest appId is invalid.'
}
$actualAsarHash = (Get-FileHash -LiteralPath (Join-Path $verifyRoot 'resources/app.asar') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualAsarHash -ne ([string]$manifest.appAsarSha256).ToLowerInvariant()) {
  throw 'Update app.asar SHA-256 does not match the manifest.'
}

if ([bool]$manifest.hasUnpacked) {
  $nestedZip = Join-Path $verifyRoot 'resources/app.asar.unpacked.zip'
  if (!(Test-Path $nestedZip -PathType Leaf)) {
    throw 'Update ZIP is missing nested resources/app.asar.unpacked.zip.'
  }
  $actualNestedHash = (Get-FileHash -LiteralPath $nestedZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualNestedHash -ne ([string]$manifest.unpackedArchiveSha256).ToLowerInvariant()) {
    throw 'Nested app.asar.unpacked ZIP SHA-256 does not match the manifest.'
  }

  $nested = [System.IO.Compression.ZipFile]::OpenRead($nestedZip)
  try {
    if ($nested.Entries.Count -eq 0) {
      throw 'Nested app.asar.unpacked ZIP is empty.'
    }
    foreach ($entry in $nested.Entries) {
      if ($entry.FullName.StartsWith('/') -or $entry.FullName -match '(^|/)\.\.(/|$)') {
        throw "Unsafe path in nested update ZIP: $($entry.FullName)"
      }
    }
  } finally {
    $nested.Dispose()
  }

  Expand-Archive -LiteralPath $nestedZip -DestinationPath $innerRoot -Force
  if ((Get-ChildItem -LiteralPath $innerRoot -Force | Measure-Object).Count -eq 0) {
    throw 'Nested app.asar.unpacked ZIP did not extract any files.'
  }
  Write-Host "Verified nested archive and extracted it to a short path: $innerRoot"
}

Write-Host "Verified short-path update package: $UpdateZip"

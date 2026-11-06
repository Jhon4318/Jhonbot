param(
  [Parameter(Mandatory = $true)]
  [string]$UpdateZip
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$applyScriptPath = Join-Path $PSScriptRoot 'Apply-Update.ps1'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($applyScriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
  throw "Apply-Update.ps1 has PowerShell syntax errors: $($parseErrors -join '; ')"
}
$applierSource = Get-Content -LiteralPath $applyScriptPath -Raw
if (!$applierSource.Contains('CloseMainWindow')) {
  throw 'Apply-Update.ps1 must request a graceful application shutdown before updating.'
}
if (!$applierSource.Contains('updateLogPath')) {
  throw 'Apply-Update.ps1 must write an update diagnostic log.'
}
if (!$applierSource.Contains('Bedrock\s+Bot\s+Console')) {
  throw 'Apply-Update.ps1 must tolerate version-suffixed uninstall display names.'
}
if (!$applierSource.Contains('Programs\Bedrock Bot Console')) {
  throw 'Apply-Update.ps1 must have a per-user standard install-path fallback.'
}
if (!$applierSource.Contains('ProductVersion') -or !$applierSource.Contains('FileVersion')) {
  throw 'Apply-Update.ps1 must be able to read the installed EXE version.'
}
$fileVersionIndex = $applierSource.IndexOf('$versionText = [string]$exeVersionInfo.FileVersion')
$productVersionIndex = $applierSource.IndexOf('$versionText = [string]$exeVersionInfo.ProductVersion')
if ($fileVersionIndex -lt 0 -or $productVersionIndex -lt $fileVersionIndex) {
  throw 'Apply-Update.ps1 must prefer FileVersion and use ProductVersion only as a fallback.'
}
if ($applierSource.Contains("インストール情報を確認できません。通常版Setup.exeで更新してください。")) {
  throw 'Apply-Update.ps1 must not require uninstall registry metadata.'
}

if (!(Test-Path $UpdateZip -PathType Leaf)) {
  throw "Update ZIP not found: $UpdateZip"
}
$resolvedZip = (Resolve-Path -LiteralPath $UpdateZip).Path

$outer = [System.IO.Compression.ZipFile]::OpenRead($resolvedZip)
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

# Use the runner's short temp directory when available. The update applier
# also chooses a short same-volume path, so this verifies the same path budget.
$tempBase = if (![string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  $env:RUNNER_TEMP
} else {
  [System.IO.Path]::GetTempPath()
}
$verifyRoot = Join-Path $tempBase ('jbu-outer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$innerRoot = Join-Path $tempBase ('jbu-inner-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
  New-Item -ItemType Directory -Path $verifyRoot -Force | Out-Null
  Expand-Archive -LiteralPath $resolvedZip -DestinationPath $verifyRoot -Force

  $manifest = Get-Content -LiteralPath (Join-Path $verifyRoot 'update-manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.appId -ne 'com.jhonbot.bedrockbotconsole') {
    throw 'Update manifest appId is invalid.'
  }
  if ([version]$manifest.minimumSupportedVersion -ne [version]'0.3.9') {
    throw 'Manual update minimum supported version must be 0.3.9.'
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
        $relativePath = $entry.FullName.Replace('/', '\')
        if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
        if ($relativePath.StartsWith('\') -or $relativePath.Contains(':') -or $relativePath -match '(^|\\)\.\.(\\|$)') {
          throw "Unsafe path in nested update ZIP: $($entry.FullName)"
        }
        if ($relativePath -match '(^|\\)\.jest-cache(\\|$)') {
          throw "Disposable Jest cache must not be included in the Windows application package: $($entry.FullName)"
        }
        if ($relativePath.TrimEnd('\').Length -gt 140) {
          throw "Nested archive path exceeds the NSIS-safe relative path budget (140): $($entry.FullName)"
        }
        if (($innerRoot.Length + 1 + $relativePath.TrimEnd('\').Length) -gt 240) {
          throw "Nested archive path is too long for a short Windows temp directory: $($entry.FullName)"
        }
      }
    } finally {
      $nested.Dispose()
    }

    Expand-Archive -LiteralPath $nestedZip -DestinationPath $innerRoot -Force
    if ((Get-ChildItem -LiteralPath $innerRoot -Force | Measure-Object).Count -eq 0) {
      throw 'Nested app.asar.unpacked ZIP did not extract any files.'
    }
    Write-Host "Verified nested archive extraction to a short path: $innerRoot"
  }

  Write-Host "Verified short-path update package: $resolvedZip"
} finally {
  if (Test-Path $verifyRoot) { Remove-Item -LiteralPath $verifyRoot -Recurse -Force }
  if (Test-Path $innerRoot) { Remove-Item -LiteralPath $innerRoot -Recurse -Force }
}

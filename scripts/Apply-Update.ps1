#requires -version 5.1
$ErrorActionPreference = 'Stop'

function Get-InstalledAppEntry {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    if (!(Test-Path $root)) { continue }
    foreach ($key in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
      try {
        $entry = Get-ItemProperty -LiteralPath $key.PSPath
        if ($entry.DisplayName -eq 'Bedrock Bot Console') { return $entry }
      } catch {}
    }
  }
  return $null
}

function Copy-DirectoryContents {
  param([string]$Source, [string]$Destination)
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

try {
  $manifestPath = Join-Path $PSScriptRoot 'update-manifest.json'
  $sourceAsar = Join-Path $PSScriptRoot 'resources\app.asar'
  if (!(Test-Path $manifestPath -PathType Leaf) -or !(Test-Path $sourceAsar -PathType Leaf)) {
    throw '更新ZIPをすべて展開してください。Apply-Update.batだけを移動して実行することはできません。'
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.appId -ne 'com.jhonbot.bedrockbotconsole') {
    throw 'この更新ファイルはBedrock Bot Console用ではありません。'
  }
  $targetVersion = [version]$manifest.version
  $minimumVersion = [version]$manifest.minimumSupportedVersion
  $asarHash = (Get-FileHash -LiteralPath $sourceAsar -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($asarHash -ne ([string]$manifest.appAsarSha256).ToLowerInvariant()) {
    throw '更新ファイルの整合性確認に失敗しました。ZIPを再ダウンロードしてください。'
  }

  $entry = Get-InstalledAppEntry
  if (!$entry) {
    throw 'インストール情報を確認できません。通常版Setup.exeで更新してください。'
  }
  if ([string]::IsNullOrWhiteSpace([string]$entry.DisplayVersion)) {
    throw '現在のバージョンを確認できません。通常版Setup.exeで更新してください。'
  }
  $currentVersion = [version]$entry.DisplayVersion
  if ($currentVersion -lt $minimumVersion) {
    throw "現在のv$currentVersionは差分更新の対象外です。v$($manifest.minimumSupportedVersion)以降にSetup.exeで更新してください。"
  }
  if ($currentVersion -ge $targetVersion) {
    throw "現在のv$currentVersionは更新対象のv$targetVersion以上です。"
  }

  $candidateRoots = @()
  if (![string]::IsNullOrWhiteSpace([string]$entry.InstallLocation)) {
    $candidateRoots += [string]$entry.InstallLocation
  }
  $candidateRoots += (Join-Path $env:LOCALAPPDATA 'Programs\Bedrock Bot Console')
  $candidateRoots += (Join-Path $env:LOCALAPPDATA 'Programs\bedrock-bot-console')
  $installRoot = $candidateRoots | Where-Object {
    Test-Path (Join-Path $_ 'Bedrock Bot Console.exe') -PathType Leaf
  } | Select-Object -First 1
  if (!$installRoot) {
    $manualRoot = Read-Host 'インストール先フォルダーを入力してください（通常は空欄のままEnter）'
    if (![string]::IsNullOrWhiteSpace($manualRoot) -and (Test-Path (Join-Path $manualRoot 'Bedrock Bot Console.exe') -PathType Leaf)) {
      $installRoot = $manualRoot
    }
  }
  if (!$installRoot) {
    throw 'インストール先を特定できません。通常版Setup.exeで更新してください。'
  }

  $exePath = Join-Path $installRoot 'Bedrock Bot Console.exe'
  $running = @(Get-Process -Name 'Bedrock Bot Console' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    throw 'Bedrock Bot Consoleが起動中です。Botを切断してアプリを終了してから、Apply-Update.batをもう一度実行してください。'
  }

  $resources = Join-Path $installRoot 'resources'
  $targetAsar = Join-Path $resources 'app.asar'
  $targetUnpacked = Join-Path $resources 'app.asar.unpacked'
  if (!(Test-Path $targetAsar -PathType Leaf)) {
    throw "インストール先にapp.asarが見つかりません: $targetAsar"
  }

  $backupRoot = Join-Path $env:LOCALAPPDATA 'bedrock-bot-console\update-backups'
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $backupName = "v$currentVersion-to-v$targetVersion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  $backupDir = Join-Path $backupRoot $backupName
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  $backupAsar = Join-Path $backupDir 'app.asar.backup'
  Copy-Item -LiteralPath $targetAsar -Destination $backupAsar

  $hadUnpacked = Test-Path $targetUnpacked -PathType Container
  $backupUnpacked = Join-Path $backupDir 'app.asar.unpacked.backup'
  if ($hadUnpacked) {
    Copy-Item -LiteralPath $targetUnpacked -Destination $backupUnpacked -Recurse
  }

  $sourceUnpacked = Join-Path $PSScriptRoot 'resources\app.asar.unpacked'
  if ([bool]$manifest.hasUnpacked -and !(Test-Path $sourceUnpacked -PathType Container)) {
    throw '更新ZIP内のapp.asar.unpackedが見つかりません。'
  }

  $stagedAsar = Join-Path $resources 'app.asar.update-temp'
  $stagedUnpacked = Join-Path $resources 'app.asar.unpacked.update-temp'
  if (Test-Path $stagedAsar) { Remove-Item -LiteralPath $stagedAsar -Force }
  if (Test-Path $stagedUnpacked) { Remove-Item -LiteralPath $stagedUnpacked -Recurse -Force }
  Copy-Item -LiteralPath $sourceAsar -Destination $stagedAsar
  if ([bool]$manifest.hasUnpacked) {
    Copy-Item -LiteralPath $sourceUnpacked -Destination $stagedUnpacked -Recurse
  }

  try {
    Move-Item -LiteralPath $stagedAsar -Destination $targetAsar -Force
    if (Test-Path $targetUnpacked) {
      Remove-Item -LiteralPath $targetUnpacked -Recurse -Force
    }
    if ([bool]$manifest.hasUnpacked) {
      Move-Item -LiteralPath $stagedUnpacked -Destination $targetUnpacked
    }

    $installedHash = (Get-FileHash -LiteralPath $targetAsar -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installedHash -ne ([string]$manifest.appAsarSha256).ToLowerInvariant()) {
      throw '適用後のapp.asar検証に失敗しました。バックアップから復元します。'
    }
  } catch {
    if (Test-Path $targetAsar) { Remove-Item -LiteralPath $targetAsar -Force }
    Copy-Item -LiteralPath $backupAsar -Destination $targetAsar
    if (Test-Path $targetUnpacked) { Remove-Item -LiteralPath $targetUnpacked -Recurse -Force }
    if ($hadUnpacked -and (Test-Path $backupUnpacked)) {
      Copy-Item -LiteralPath $backupUnpacked -Destination $targetUnpacked -Recurse
    }
    throw
  }

  Write-Host ''
  Write-Host "Bedrock Bot Consoleをv$targetVersionに更新しました。" -ForegroundColor Green
  Write-Host "設定・Bot一覧・認証キャッシュは変更していません。"
  Write-Host "ロールバック用バックアップ: $backupDir"
  Write-Host 'アプリを起動して動作を確認してください。'
  exit 0
} catch {
  Write-Host ''
  Write-Host "更新できませんでした: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '問題が解決しない場合は、GitHub ReleaseのSetup.exeを実行してください。'
  exit 1
}

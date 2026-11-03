#requires -version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workDirectory = $null

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
    throw "現在のv$currentVersionは手動更新の対象外です。v$($manifest.minimumSupportedVersion)以降にSetup.exeで更新してください。"
  }
  if ($currentVersion -ge $targetVersion) {
    throw "現在のv$currentVersionは更新対象のv$targetVersion以上です。"
  }

  $runtimeLog = Join-Path $env:APPDATA 'bedrock-bot-console\logs\bot-console.log'
  if (!(Test-Path $runtimeLog -PathType Leaf)) {
    throw 'Electronの実行バージョンを確認できません。アプリを一度起動してから再試行するか、Setup.exeを使用してください。'
  }
  $electronLine = Get-Content -LiteralPath $runtimeLog -Tail 500 | Select-String -Pattern 'electron=([0-9]+(?:\.[0-9]+){1,3})' | Select-Object -Last 1
  if (!$electronLine) {
    throw 'ログからElectronの実行バージョンを確認できません。Setup.exeを使用してください。'
  }
  $installedElectronVersion = $electronLine.Matches[0].Groups[1].Value
  if ($installedElectronVersion -ne [string]$manifest.electronVersion) {
    throw "Electronランタイムが異なります（現在: $installedElectronVersion / 更新ファイル: $($manifest.electronVersion)）。通常版Setup.exeを使用してください。"
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

  $hasNewUnpacked = [bool]$manifest.hasUnpacked
  $unpackedArchive = Join-Path $PSScriptRoot 'resources\app.asar.unpacked.zip'
  if ($hasNewUnpacked) {
    if (!(Test-Path $unpackedArchive -PathType Leaf)) {
      throw '更新ZIP内のresources\app.asar.unpacked.zipが見つかりません。もう一度ZIPを展開してください。'
    }
    $unpackedHash = (Get-FileHash -LiteralPath $unpackedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($unpackedHash -ne ([string]$manifest.unpackedArchiveSha256).ToLowerInvariant()) {
      throw '展開済みアプリファイルの整合性確認に失敗しました。ZIPを再ダウンロードしてください。'
    }
  }

  # Extract the nested archive into a short temporary path. This avoids adding
  # the user's Downloads/extraction folder to every deep node_modules filename.
  $workDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('jbu-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
  $sourceUnpacked = Join-Path $workDirectory 'source-app.asar.unpacked'
  if ($hasNewUnpacked) {
    Expand-Archive -LiteralPath $unpackedArchive -DestinationPath $sourceUnpacked -Force
    if (!(Test-Path $sourceUnpacked -PathType Container)) {
      throw '内側の更新アーカイブを展開できませんでした。'
    }
  }

  $backupRoot = Join-Path $env:LOCALAPPDATA 'bedrock-bot-console\update-backups'
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $backupName = "v$currentVersion-to-v$targetVersion-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  $backupDir = Join-Path $backupRoot $backupName
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

  $backupAsar = Join-Path $backupDir 'app.asar.backup'
  Copy-Item -LiteralPath $targetAsar -Destination $backupAsar

  $hadUnpacked = Test-Path $targetUnpacked -PathType Container
  $backupUnpackedArchive = Join-Path $backupDir 'app.asar.unpacked.backup.zip'
  if ($hadUnpacked) {
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $targetUnpacked,
      $backupUnpackedArchive,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )
  }

  $stagedAsar = Join-Path $resources 'app.asar.update-temp'
  $stagedUnpacked = Join-Path $resources 'app.asar.unpacked.update-temp'
  if (Test-Path $stagedAsar) { Remove-Item -LiteralPath $stagedAsar -Force }
  if (Test-Path $stagedUnpacked) { Remove-Item -LiteralPath $stagedUnpacked -Recurse -Force }
  Copy-Item -LiteralPath $sourceAsar -Destination $stagedAsar
  if ($hasNewUnpacked) {
    Copy-Item -LiteralPath $sourceUnpacked -Destination $stagedUnpacked -Recurse
  }

  try {
    Move-Item -LiteralPath $stagedAsar -Destination $targetAsar -Force
    if (Test-Path $targetUnpacked) {
      Remove-Item -LiteralPath $targetUnpacked -Recurse -Force
    }
    if ($hasNewUnpacked) {
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
    if ($hadUnpacked -and (Test-Path $backupUnpackedArchive -PathType Leaf)) {
      $rollbackUnpacked = Join-Path $workDirectory 'rollback-app.asar.unpacked'
      Expand-Archive -LiteralPath $backupUnpackedArchive -DestinationPath $rollbackUnpacked -Force
      Move-Item -LiteralPath $rollbackUnpacked -Destination $targetUnpacked
    }
    throw
  }

  if ($workDirectory -and (Test-Path $workDirectory)) {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force
    $workDirectory = $null
  }

  Write-Host ''
  Write-Host "Bedrock Bot Consoleをv$targetVersionに更新しました。" -ForegroundColor Green
  Write-Host "設定・Bot一覧・認証キャッシュは変更していません。"
  Write-Host "ロールバック用バックアップ: $backupDir"
  Write-Host 'アプリを起動して動作を確認してください。'
  exit 0
} catch {
  if ($workDirectory -and (Test-Path $workDirectory)) {
    try { Remove-Item -LiteralPath $workDirectory -Recurse -Force } catch {}
  }
  Write-Host ''
  Write-Host "更新できませんでした: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '問題が解決しない場合は、GitHub ReleaseのSetup.exeを実行してください。'
  exit 1
}

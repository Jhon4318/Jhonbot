#requires -version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$workDirectory = $null
$preserveWorkDirectory = $false

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

function Get-ShortestSameVolumeDirectory {
  param([string]$TargetPath, [string[]]$Candidates)
  $targetRoot = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($TargetPath))
  $matches = @()
  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate) -or !(Test-Path -LiteralPath $candidate -PathType Container)) { continue }
    $candidateFull = [System.IO.Path]::GetFullPath($candidate)
    $candidateRoot = [System.IO.Path]::GetPathRoot($candidateFull)
    if ([string]::Equals($targetRoot, $candidateRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      $matches += $candidateFull
    }
  }
  if ($matches.Count -eq 0) { return $null }
  return ($matches | Sort-Object Length | Select-Object -First 1)
}

try {
  $manifestPath = Join-Path $PSScriptRoot 'update-manifest.json'
  $packageAsar = Join-Path $PSScriptRoot 'resources\app.asar'
  if (!(Test-Path $manifestPath -PathType Leaf) -or !(Test-Path $packageAsar -PathType Leaf)) {
    throw '更新ZIPをすべて展開してください。Apply-Update.batだけを移動して実行することはできません。'
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.appId -ne 'com.jhonbot.bedrockbotconsole') {
    throw 'この更新ファイルはBedrock Bot Console用ではありません。'
  }
  $targetVersion = [version]$manifest.version
  $minimumVersion = [version]$manifest.minimumSupportedVersion
  if ($targetVersion -le $minimumVersion) {
    throw '更新ファイルのバージョン情報が正しくありません。ZIPを再ダウンロードしてください。'
  }

  $packageElectronVersion = [string]$manifest.electronVersion
  if ([string]::IsNullOrWhiteSpace($packageElectronVersion)) {
    throw '更新ファイルにElectronのバージョン情報がありません。Setup.exeを使用してください。'
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
  if ($installedElectronVersion -ne $packageElectronVersion) {
    throw "Electronランタイムが異なります（現在: $installedElectronVersion / 更新ファイル: $packageElectronVersion）。通常版Setup.exeを使用してください。"
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
  if ((Test-Path $targetUnpacked) -and !(Test-Path $targetUnpacked -PathType Container)) {
    throw 'インストール先のapp.asar.unpackedがフォルダーではありません。Setup.exeを使用してください。'
  }

  $workParent = Get-ShortestSameVolumeDirectory -TargetPath $installRoot -Candidates @(
    $env:USERPROFILE,
    $env:LOCALAPPDATA,
    $env:TEMP
  )
  if (!$workParent) {
    throw 'インストール先と同じドライブに短い一時フォルダーを作成できません。通常版Setup.exeを使用してください。'
  }

  $workDirectory = Join-Path $workParent ('jbu-' + [guid]::NewGuid().ToString('N').Substring(0, 10))
  New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
  $stagedAsar = Join-Path $workDirectory 'app.asar.new'
  Copy-Item -LiteralPath $packageAsar -Destination $stagedAsar

  $asarHash = (Get-FileHash -LiteralPath $stagedAsar -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($asarHash -ne ([string]$manifest.appAsarSha256).ToLowerInvariant()) {
    throw 'app.asarの整合性確認に失敗しました。ZIPを再ダウンロードしてください。'
  }

  $hasNewUnpacked = [bool]$manifest.hasUnpacked
  $sourceUnpacked = Join-Path $workDirectory 'app.asar.unpacked.new'
  if ($hasNewUnpacked) {
    $packageUnpackedArchive = Join-Path $PSScriptRoot 'resources\app.asar.unpacked.zip'
    if (!(Test-Path $packageUnpackedArchive -PathType Leaf)) {
      throw '更新ZIP内のresources\app.asar.unpacked.zipが見つかりません。ZIPを再ダウンロードしてください。'
    }

    $stagedUnpackedArchive = Join-Path $workDirectory 'app.asar.unpacked.zip'
    Copy-Item -LiteralPath $packageUnpackedArchive -Destination $stagedUnpackedArchive
    $unpackedHash = (Get-FileHash -LiteralPath $stagedUnpackedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($unpackedHash -ne ([string]$manifest.unpackedArchiveSha256).ToLowerInvariant()) {
      throw '展開済みアプリファイルの整合性確認に失敗しました。ZIPを再ダウンロードしてください。'
    }

    $archive = [System.IO.Compression.ZipFile]::OpenRead($stagedUnpackedArchive)
    try {
      foreach ($archiveEntry in $archive.Entries) {
        $relativePath = $archiveEntry.FullName.Replace('/', '\')
        if ([string]::IsNullOrWhiteSpace($relativePath)) { continue }
        if ($relativePath.StartsWith('\') -or $relativePath.Contains(':') -or $relativePath -match '(^|\\)\.\.(\\|$)') {
          throw "更新アーカイブに安全でないパスが含まれています: $($archiveEntry.FullName)"
        }
        $expandedPathLength = $sourceUnpacked.Length + 1 + $relativePath.TrimEnd('\').Length
        if ($expandedPathLength -gt 240) {
          throw '更新アーカイブ内にWindowsのパス長制限を超えるファイルがあります。Setup.exeを使用してください。'
        }
      }
    } finally {
      $archive.Dispose()
    }

    Expand-Archive -LiteralPath $stagedUnpackedArchive -DestinationPath $sourceUnpacked -Force
    if (!(Test-Path $sourceUnpacked -PathType Container) -or (Get-ChildItem -LiteralPath $sourceUnpacked -Force | Measure-Object).Count -eq 0) {
      throw '内側の更新アーカイブを展開できませんでした。'
    }
  }

  $backupParent = Get-ShortestSameVolumeDirectory -TargetPath $installRoot -Candidates @(
    $env:LOCALAPPDATA,
    $env:USERPROFILE
  )
  $backupId = [guid]::NewGuid().ToString('N').Substring(0, 10)
  if ($backupParent) {
    $backupBase = Join-Path $backupParent 'jbu-backups'
    $backupDir = Join-Path $backupBase ("v$currentVersion-to-v$targetVersion-$backupId")
  } else {
    $backupDir = Join-Path $resources ('.jbu-' + $backupId)
  }
  $backupUnpacked = Join-Path $backupDir 'u'
  if ($backupUnpacked.Length -ge $targetUnpacked.Length) {
    $backupDir = Join-Path $resources ('.jbu-' + $backupId)
    $backupUnpacked = Join-Path $backupDir 'u'
  }
  $backupAsar = Join-Path $backupDir 'app.asar.backup'
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

  $hadOldUnpacked = Test-Path $targetUnpacked -PathType Container
  if (Test-Path $backupAsar) {
    throw 'バックアップ先が既に存在します。もう一度Apply-Update.batを実行してください。'
  }
  if ($hadOldUnpacked -and (Test-Path $backupUnpacked)) {
    throw '展開済みアプリのバックアップ先が既に存在します。もう一度Apply-Update.batを実行してください。'
  }

  Copy-Item -LiteralPath $targetAsar -Destination $backupAsar
  $previousAsar = Join-Path $workDirectory 'app.asar.previous'
  $oldAsarMoved = $false
  $oldUnpackedMoved = $false
  $newAsarInstalled = $false
  $newUnpackedInstalled = $false

  try {
    # Both locations are on the installation volume. Renaming the directory
    # avoids copying every deeply nested file through a long destination path.
    Move-Item -LiteralPath $targetAsar -Destination $previousAsar
    $oldAsarMoved = $true

    if ($hadOldUnpacked) {
      Move-Item -LiteralPath $targetUnpacked -Destination $backupUnpacked
      $oldUnpackedMoved = $true
    }

    Move-Item -LiteralPath $stagedAsar -Destination $targetAsar
    $newAsarInstalled = $true

    if ($hasNewUnpacked) {
      Move-Item -LiteralPath $sourceUnpacked -Destination $targetUnpacked
      $newUnpackedInstalled = $true
    }

    $installedHash = (Get-FileHash -LiteralPath $targetAsar -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installedHash -ne ([string]$manifest.appAsarSha256).ToLowerInvariant()) {
      throw '適用後のapp.asar検証に失敗しました。バックアップから復元します。'
    }
  } catch {
    $applyError = $_.Exception.Message
    $rollbackErrors = @()

    if ($newUnpackedInstalled -and (Test-Path $targetUnpacked -PathType Container)) {
      try {
        $failedUnpacked = Join-Path $workDirectory 'failed-app.asar.unpacked'
        Move-Item -LiteralPath $targetUnpacked -Destination $failedUnpacked
      } catch { $rollbackErrors += "新しい展開済みファイルを退避できませんでした: $($_.Exception.Message)" }
    }
    if ($oldUnpackedMoved -and (Test-Path $backupUnpacked -PathType Container)) {
      try {
        Move-Item -LiteralPath $backupUnpacked -Destination $targetUnpacked
      } catch { $rollbackErrors += "以前の展開済みファイルを復元できませんでした: $($_.Exception.Message)" }
    }

    if ($newAsarInstalled -and (Test-Path $targetAsar -PathType Leaf)) {
      try {
        $failedAsar = Join-Path $workDirectory 'failed-app.asar'
        Move-Item -LiteralPath $targetAsar -Destination $failedAsar
      } catch { $rollbackErrors += "新しいapp.asarを退避できませんでした: $($_.Exception.Message)" }
    }
    if ($oldAsarMoved -and (Test-Path $previousAsar -PathType Leaf)) {
      try {
        Move-Item -LiteralPath $previousAsar -Destination $targetAsar
      } catch {
        try {
          if (!(Test-Path $targetAsar -PathType Leaf)) {
            Copy-Item -LiteralPath $backupAsar -Destination $targetAsar
          } else {
            throw '復元先にapp.asarが残っています。'
          }
        } catch { $rollbackErrors += "以前のapp.asarを復元できませんでした: $($_.Exception.Message)" }
      }
    }

    if ($rollbackErrors.Count -gt 0) {
      $preserveWorkDirectory = $true
      $details = $rollbackErrors -join [Environment]::NewLine
      throw ("更新に失敗しました: " + $applyError + [Environment]::NewLine +
        "自動復元にも失敗しました。バックアップ: " + $backupDir + [Environment]::NewLine +
        "一時ファイル: " + $workDirectory + [Environment]::NewLine + $details)
    }
    throw "更新に失敗したため、変更前の状態に戻しました: $applyError"
  }

  Remove-Item -LiteralPath $workDirectory -Recurse -Force
  $workDirectory = $null

  Write-Host ''
  Write-Host "Bedrock Bot Consoleをv$targetVersionに更新しました。" -ForegroundColor Green
  Write-Host '設定・Bot一覧・認証キャッシュは変更していません。'
  Write-Host "ロールバック用バックアップ: $backupDir"
  Write-Host 'アプリを起動して動作を確認してください。'
  exit 0
} catch {
  if (!$preserveWorkDirectory -and $workDirectory -and (Test-Path $workDirectory)) {
    try { Remove-Item -LiteralPath $workDirectory -Recurse -Force } catch {}
  }
  Write-Host ''
  Write-Host "更新できませんでした: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '問題が解決しない場合は、GitHub ReleaseのSetup.exeを実行してください。'
  exit 1
}

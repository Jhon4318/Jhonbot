'use strict'

const fs = require('node:fs')
const path = require('node:path')

const REQUIRE_ANCHOR = "const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron')"
const READY_ANCHOR = 'app.whenReady().then(async () => {'
const CALL_ANCHOR = '  createWindow()\n'
const MARKER = '// JHONBOT_AUTO_UPDATER_V1'

function patchMainSource (source) {
  if (source.includes(MARKER)) return source
  if (!source.includes(REQUIRE_ANCHOR)) throw new Error('Auto-update patch could not find the Electron import in src/main.js')
  if (!source.includes(READY_ANCHOR)) throw new Error('Auto-update patch could not find app.whenReady() in src/main.js')

  const importPatched = source.replace(REQUIRE_ANCHOR, REQUIRE_ANCHOR + "\nconst { autoUpdater } = require('electron-updater')")

  const updaterFunction = MARKER + "\n" + [
    'function startAutoUpdates () {',
    "  if (!app.isPackaged || process.platform !== 'win32') return",
    '',
    '  autoUpdater.autoDownload = true',
    '  autoUpdater.autoInstallOnAppQuit = true',
    '  autoUpdater.allowDowngrade = false',
    '  autoUpdater.allowPrerelease = false',
    '',
    '  let lastProgressBucket = -1',
    "  autoUpdater.on('checking-for-update', () => pushLog('アプリの更新を確認しています。', 'info'))",
    "  autoUpdater.on('update-available', (info) => {",
    "    pushLog('新しいバージョン v' + info.version + ' が見つかりました。差分更新をダウンロードします。', 'success')",
    '  })',
    "  autoUpdater.on('update-not-available', () => pushLog('アプリは最新バージョンです。', 'info'))",
    "  autoUpdater.on('download-progress', (progress) => {",
    '    const bucket = Math.floor(Number(progress.percent || 0) / 25)',
    '    if (bucket > lastProgressBucket) {',
    '      lastProgressBucket = bucket',
    "      pushLog('更新をダウンロード中です: ' + Math.min(100, Math.round(progress.percent || 0)) + '%', 'info')",
    '    }',
    '  })',
    "  autoUpdater.on('update-downloaded', (info) => {",
    "    pushLog('v' + info.version + ' の更新をダウンロードしました。アプリ終了時に適用できます。', 'success')",
    '    const options = {',
    "      type: 'info',",
    "      title: 'Bedrock Bot Console の更新',",
    "      message: '新しいバージョン v' + info.version + ' をダウンロードしました。',",
    "      detail: '今すぐ再起動して更新するか、後でアプリを終了したときに適用できます。',",
    "      buttons: ['今すぐ再起動して更新', '後で'],",
    '      defaultId: 0,',
    '      cancelId: 1,',
    '      noLink: true',
    '    }',
    '    const prompt = mainWindow && !mainWindow.isDestroyed()',
    '      ? dialog.showMessageBox(mainWindow, options)',
    '      : dialog.showMessageBox(options)',
    '    prompt.then(({ response }) => {',
    '      if (response === 0) autoUpdater.quitAndInstall(false, true)',
    "    }).catch((error) => pushLog('更新確認ダイアログを表示できませんでした: ' + error.message, 'warning'))",
    '  })',
    "  autoUpdater.on('error', (error) => {",
    "    pushLog('自動更新に失敗しました: ' + (error && error.message ? error.message : String(error)) + '。必要なら最新版のSetup.exeから更新してください。', 'warning')",
    '  })',
    '',
    '  setTimeout(() => {',
    '    autoUpdater.checkForUpdates().catch((error) => {',
    "      pushLog('更新確認に失敗しました: ' + (error && error.message ? error.message : String(error)), 'warning')",
    '    })',
    '  }, 7000)',
    '}',
    ''
  ].join('\n')

  let result = importPatched.replace(READY_ANCHOR, updaterFunction + READY_ANCHOR)
  const readyIndex = result.indexOf(READY_ANCHOR)
  const before = result.slice(0, readyIndex)
  const after = result.slice(readyIndex)
  if (!after.includes(CALL_ANCHOR)) throw new Error('Auto-update patch could not find createWindow() in app startup')
  result = before + after.replace(CALL_ANCHOR, CALL_ANCHOR + '  startAutoUpdates()\n')
  return result
}

function patchFile (filePath = path.join(__dirname, '..', 'src', 'main.js')) {
  const original = fs.readFileSync(filePath, 'utf8')
  const patched = patchMainSource(original)
  if (patched !== original) fs.writeFileSync(filePath, patched, 'utf8')
  return patched !== original
}

if (require.main === module) {
  const changed = patchFile()
  console.log(changed ? 'Applied the Jhonbot auto-updater bootstrap.' : 'Jhonbot auto-updater bootstrap is already applied.')
}

module.exports = { patchMainSource, patchFile }

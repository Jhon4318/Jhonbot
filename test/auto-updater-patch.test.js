'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { patchMainSource } = require('../scripts/enable-auto-updater')

const fixture = [
  "'use strict'",
  "const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron')",
  'function createWindow () {}',
  'app.whenReady().then(async () => {',
  '  createWindow()',
  '})'
].join('\n')

test('auto-updater bootstrap is injected into packaged startup', () => {
  const result = patchMainSource(fixture)
  assert.match(result, /require\('electron-updater'\)/)
  assert.match(result, /autoUpdater\.autoDownload = true/)
  assert.match(result, /autoUpdater\.autoInstallOnAppQuit = true/)
  assert.match(result, /startAutoUpdates\(\)/)
  assert.match(result, /JHONBOT_AUTO_UPDATER_V1/)
})

test('auto-updater bootstrap patch is idempotent', () => {
  const once = patchMainSource(fixture)
  assert.equal(patchMainSource(once), once)
})

test('patcher fails clearly when source anchors are missing', () => {
  assert.throws(() => patchMainSource('const unrelated = true'), /could not find the Electron import/)
})

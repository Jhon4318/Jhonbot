'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8')
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8')
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8')

test('shows the installed application version separately from the Minecraft version', () => {
  assert.match(html, /version-chip app-version-chip">APP <span id="appVersionText">/)
  assert.match(renderer, /getElementById\('appVersionText'\)\.textContent = initial\.appVersion \? `v\$\{initial\.appVersion\}` : '不明'/)
  assert.match(main, /const APP_VERSION = PACKAGE\.version/)
  assert.match(main, /appVersion: APP_VERSION/)
})

test('adding a Bot does not automatically authenticate or join a world', () => {
  assert.match(preload, /addBot:.*bot:add/)
  assert.match(main, /ipcMain\.handle\('bot:add',[^\n]*addBot\(/)
  assert.doesNotMatch(main, /bot:add-and-connect/)
  assert.match(renderer, /api\.addBot\(/)
  assert.doesNotMatch(renderer, /api\.addAndConnect\(/)
})

test('account authentication uses Authflow before the separate Mineflayer join', () => {
  assert.match(main, /new Authflow\(/)
  assert.match(main, /await authflow\.getXboxToken\(\)/)
  assert.match(main, /ipcMain\.handle\('bot:authenticate'/)
  assert.match(preload, /authenticateBot:.*bot:authenticate/)
  assert.match(main, /authflow: bot\.authflow/)
  assert.match(main, /assertCanJoinWorld\(bot\)/)
})

test('the UI labels the two operations separately and prevents joining before auth', () => {
  assert.match(html, /Botを追加/)
  assert.match(renderer, /アカウント認証/)
  assert.match(renderer, /ワールド参加/)
  assert.match(renderer, /join\.disabled = bot\.accountStatus !== 'authenticated' \|\| !hasTarget/)
})


test('the account-only action never creates a Mineflayer network client', () => {
  const start = main.indexOf('async function authenticateBot (botId)')
  const end = main.indexOf('async function connectBot (botId)', start)
  assert.ok(start >= 0 && end > start)
  const authOnlyBody = main.slice(start, end)
  assert.match(authOnlyBody, /authflow\.getXboxToken\(\)/)
  assert.doesNotMatch(authOnlyBody, /mineflayer\.createBot\(/)
})


test('Bot registration accepts only a name and destination is selected separately', () => {
  assert.match(html, /id="botLabel"/)
  const botForm = html.match(/<form id="addBotForm"[\s\S]*?<\/form>/)?.[0] || ''
  assert.doesNotMatch(botForm, /serverHost|serverPort|ポート/)
  assert.match(preload, /setBotTarget:.*bot:set-target/)
  assert.match(main, /function setBotTarget \(/)
  assert.match(main, /assertCanJoinWorld\(bot\)/)
})

test('supports saved server profiles, friend worlds, and LAN worlds per Bot', () => {
  assert.match(main, /addServerProfile \(/)
  assert.match(main, /world: \{ pickSession:/)
  assert.match(main, /bedrockProtocol\.ping\(/)
  assert.match(main, /signalling: 'lan'/)
  assert.match(renderer, /フレンドのワールド/)
  assert.match(renderer, /LANワールド/)
  assert.match(renderer, /server:\$\{server\.id\}/)
})

test('HTTP server identity is verified and first-use keys require explicit approval', () => {
  assert.match(main, /nethernet\.onServerKey = \(fingerprint, origin\) => requestServerKeyApproval\(bot, fingerprint, origin, attemptId\)/)
  assert.match(main, /addTrustedServerKey\(settings\.trustedServerKeys, pending\.origin, pending\.fingerprint\)/)
  assert.match(preload, /resolveServerKey:.*security:resolve-server-key/)
  assert.match(html, /この鍵を信頼する/)
})


test('all renderer DOM selectors exist in the delivered HTML', () => {
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]))
  const references = new Set(Array.from(renderer.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g), match => match[1]))
  for (const id of references) assert.ok(ids.has(id), `renderer references missing HTML id: ${id}`)
})

test('The Hive preset is an Asia HTTP destination and is not hard-coded as a global bot target', () => {
  assert.match(main, /label: 'The Hive（アジア）'/)
  assert.match(main, /host: 'as\.nethernet\.playhive\.com'/)
  assert.match(main, /signallingUrl: 'https:\/\/as\.nethernet\.playhive\.com'/)
  assert.match(main, /serverHttpSignallingOrigin\(profile\)/)
  assert.match(main, /url: profile\.signallingUrl/)
  assert.match(main, /mode: 'http'/)
  assert.match(renderer, /api\.addHivePreset\(/)
  assert.match(renderer, /server:\$\{server\.id\}/)
})


test('cancelling a pending destination, world choice, or server-key prompt invalidates that Bot join attempt', () => {
  assert.match(main, /function cancelPendingBotOperations \(/)
  assert.match(main, /bot\.connectionAttempt\+\+/)
  assert.match(main, /bot\.connectionAbortController\?\.abort/)
  assert.match(main, /pending\.reject\(new Error\(reason\)\)/)
  assert.match(main, /pending\.resolve\(false\)/)
  assert.match(main, /abortController\.signal\.aborted/)
})

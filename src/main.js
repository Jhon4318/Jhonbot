'use strict'

const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const util = require('node:util')
const { randomUUID } = require('node:crypto')
const mineflayer = require('mineflayer')
const bedrockProtocol = require('bedrock-protocol')
const { Authflow, Titles } = require('prismarine-auth')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { validateControl, normalizeCoordinates } = require('./control-validation')
const { safeErrorMessage, isAllowedAuthUrl } = require('./runtime-guards')
const { assertCanAuthenticate, assertCanJoinWorld } = require('./account-state')
const { createEncryptedAuthCacheFactory, hasEncryptedAuthCache } = require('./auth-cache')
const { DEFAULT_PORT, normalizeServerProfile, normalizeTarget, migrateSettings, serverOriginKey, serverHttpSignallingOrigin } = require('./destinations')

const MC_VERSION = '1.26.60'
const MAX_LOGS = 300

let mainWindow = null
let settings = { servers: [], bots: [], trustedServerKeys: {} }
let settingsSaveQueue = Promise.resolve()
const bots = new Map()
const pendingWorldSelections = new Map()
const pendingServerKeyApprovals = new Map()
const logBuffer = []
let diagnosticLogPath = null

function writeDiagnosticLog (message) {
  if (!diagnosticLogPath) return
  try {
    fsSync.appendFileSync(diagnosticLogPath, `${new Date().toISOString()} ${String(message)}\n`, 'utf8')
  } catch { /* diagnostics must never break the bot application */ }
}

function initializeDiagnosticLog () {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs')
    fsSync.mkdirSync(logDir, { recursive: true })
    diagnosticLogPath = path.join(logDir, 'bot-console.log')
    try {
      const stat = fsSync.statSync(diagnosticLogPath)
      if (stat.size > 5 * 1024 * 1024) {
        const previous = `${diagnosticLogPath}.old`
        try { fsSync.rmSync(previous, { force: true }) } catch {}
        fsSync.renameSync(diagnosticLogPath, previous)
      }
    } catch {}
    writeDiagnosticLog('\n===== Bedrock Bot Console 0.3.4 起動 =====')
    writeDiagnosticLog(`platform=${process.platform} arch=${process.arch} node=${process.versions.node} electron=${process.versions.electron}`)
    writeDiagnosticLog(`logFile=${diagnosticLogPath}`)

    // Library warnings/errors were previously only visible in the terminal. Mirror them to a persistent file.
    for (const method of ['log', 'info', 'warn', 'error']) {
      const original = console[method].bind(console)
      console[method] = (...args) => {
        try { writeDiagnosticLog(`[console.${method}] ${util.format(...args)}`) } catch {}
        original(...args)
      }
    }
  } catch (error) {
    try { console.error('Diagnostic logger initialization failed:', error) } catch {}
  }
}

function send (channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    try { mainWindow.webContents.send(channel, payload) } catch {}
  }
}

function pushLog (message, level = 'info', botId = null) {
  const entry = { at: new Date().toISOString(), message: String(message), level, botId }
  logBuffer.push(entry)
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
  writeDiagnosticLog(`[${entry.level}]${botId ? ` [bot:${botId}]` : ''} ${entry.message}`)
  send('app:log', entry)
}

function describeFailure (reason) {
  if (reason instanceof Error) return [reason.message, reason.stack].filter(Boolean).join('\n')
  if (typeof reason === 'string') return reason
  if (reason == null) return String(reason)
  return `非Error値によるPromise拒否 (${reason.constructor?.name || typeof reason})`
}

process.on('unhandledRejection', (reason) => {
  const detail = describeFailure(reason)
  writeDiagnosticLog(`[unhandledRejection] ${detail}`)
  pushLog(`未処理の非同期エラーを検出しました:\n${detail}`, 'error')
})
process.on('uncaughtExceptionMonitor', (error, origin) => {
  writeDiagnosticLog(`[uncaughtExceptionMonitor:${origin}] ${describeFailure(error)}`)
})
process.on('exit', (code) => {
  writeDiagnosticLog(`[process.exit] code=${code}`)
})

// A third-party Bedrock plugin can throw outside the Promise/event chain.
// Keep the console available, but fail closed: disconnect active bots because
// continuing after an uncaught exception could leave protocol state corrupted.
process.on('uncaughtException', (error) => {
  writeDiagnosticLog(`[uncaughtException] ${describeFailure(error)}`)
  pushLog(`致命的な内部エラーを検出しました。安全のため接続中のBotを停止します:\n${describeFailure(error)}`, 'error')
  for (const bot of bots.values()) {
    bot.hadError = true
    bot.lastError = safeErrorMessage(error)
    bot.movementRequestId++
    clearInterval(bot.movementTimer)
    bot.movementTimer = null
    try { bot.agent?.clearControlStates() } catch {}
    try { bot.client?.disconnect('Internal application error') } catch {
      try { bot.client?.close() } catch {}
    }
    bot.client = null
    bot.agent = null
    bot.connectionStarting = false
    bot.pathfinderReady = false
    setBotStatus(bot, 'error', { lastError: bot.lastError })
  }
  dialog.showErrorBox('Bedrock Bot Console - 内部エラー', `${safeErrorMessage(error)}\n\n詳細はアプリのログを確認してください。`)
})
process.on('warning', (warning) => {
  writeDiagnosticLog(`[process.warning] ${warning.name}: ${warning.message}\n${warning.stack || ''}`)
  pushLog(`Node.js警告: ${warning.name}: ${warning.message}`, 'warning')
})

function diagnosticValue (value) {
  if (value == null) return ''
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(part => Number(part) >>> 0).join(':')
  return String(value)
}

function rounded (value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

function publicBot (bot) {
  const entity = bot.agent?.entity
  const pos = entity?.position
  return {
    id: bot.id,
    label: bot.label,
    targetType: bot.targetType || 'none',
    targetId: bot.targetId || '',
    networkId: bot.networkId || '',
    worldName: bot.worldName || '',
    targetLabel: describeBotTarget(bot),
    status: bot.status,
    accountStatus: bot.accountStatus || 'unverified',
    accountError: bot.accountError || '',
    playerName: bot.playerName || '',
    lastError: bot.lastError || '',
    position: pos ? { x: rounded(pos.x), y: rounded(pos.y), z: rounded(pos.z) } : null,
    health: Number.isFinite(bot.agent?.health) ? rounded(bot.agent.health) : null,
    food: Number.isFinite(bot.agent?.food) ? rounded(bot.agent.food) : null,
    movementStatus: bot.movementStatus || '停止中',
    pathfinderReady: !!bot.pathfinderReady,
    worldSupport: bot.agent?._bedrockWorldSupport?.supported ?? false,
    worldSupportReason: bot.agent?._bedrockWorldSupport?.reason || '',
    startGameReceived: !!bot.startGameReceived,
    movementAuthority: bot.movementAuthority || '',
    correctionPackets: bot.correctionPackets || 0,
    levelChunkPackets: bot.levelChunkPackets || 0,
    subchunkPackets: bot.subchunkPackets || 0,
    worldColumnsLoaded: bot.worldColumnsLoaded || 0,
    lastServerTick: bot.lastServerTick || ''
  }
}

function publishBot (bot) {
  send('bot:updated', publicBot(bot))
}


function cleanLabel (value) {
  const label = String(value || '').trim()
  if (!label || label.length > 32) return null
  return label
}


function createBotRecord (saved) {
  return {
    ...saved,
    targetType: saved.targetType || 'none',
    targetId: saved.targetId || '',
    networkId: saved.networkId || '',
    worldName: saved.worldName || '',
    status: 'disconnected',
    client: null,
    agent: null,
    connectionStarting: false,
    connectionAttempt: 0,
    connectionAbortController: null,
    authStarting: false,
    authflow: null,
    accountStatus: 'unverified',
    accountError: '',
    manualDisconnect: false,
    hadError: false,
    playerName: '',
    lastError: '',
    movementStatus: '停止中',
    pathfinderReady: false,
    movementTimer: null,
    lastUiPositionUpdate: 0,
    movementRequestId: 0,
    startGameReceived: false,
    movementAuthority: '',
    correctionPackets: 0,
    levelChunkPackets: 0,
    subchunkPackets: 0,
    worldColumnsLoaded: 0,
    lastServerTick: ''
  }
}

function describeBotTarget (bot) {
  if (!bot || bot.targetType === 'none') return '参加先未設定'
  if (bot.targetType === 'friend-world') return 'フレンドのワールド（参加時に選択）'
  if (bot.targetType === 'lan-world') return bot.networkId ? `${bot.worldName || 'LANワールド'}（LAN）` : 'LANワールド（未検索）'
  const server = settings.servers.find(item => item.id === bot.targetId)
  return server ? `${server.label} · ${server.host}:${server.port}` : 'サーバー設定が見つかりません'
}

function publicServerProfiles () {
  return settings.servers.map(({ id, label, host, port, mode, signallingUrl }) => ({ id, label, host, port, mode, signallingUrl }))
}

async function loadSettings () {
  const file = path.join(app.getPath('userData'), 'settings.json')
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    settings = migrateSettings(parsed)
  } catch (error) {
    if (error.code !== 'ENOENT') pushLog(`設定ファイルを読み込めませんでした: ${error.message}`, 'warning')
    settings = { servers: [], bots: [], trustedServerKeys: {} }
  }

  for (const saved of settings.bots) {
    const bot = createBotRecord(saved)
    try {
      if (await hasEncryptedAuthCache(app.getPath('userData'), bot.id)) bot.accountStatus = 'saved'
    } catch (error) {
      pushLog(`${bot.label}: 保存済み認証情報の確認に失敗しました: ${error.message}`, 'warning', bot.id)
    }
    bots.set(saved.id, bot)
  }
  await saveSettings()
}

function saveSettings () {
  const snapshot = {
    servers: settings.servers.map(({ id, label, host, port, mode, signallingUrl }) => ({ id, label, host, port, mode, signallingUrl })),
    trustedServerKeys: { ...settings.trustedServerKeys },
    bots: Array.from(bots.values()).map(({ id, label, targetType, targetId, networkId, worldName }) => ({
      id, label, targetType, targetId, networkId, worldName
    }))
  }
  settingsSaveQueue = settingsSaveQueue.catch(() => {}).then(async () => {
    const file = path.join(app.getPath('userData'), 'settings.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8')
      await fs.rename(temp, file)
    } catch (error) {
      try { await fs.rm(temp, { force: true }) } catch {}
      throw error
    }
  })
  return settingsSaveQueue
}

// prismarine-auth supports a CacheFactory. Electron's async decrypt API
// returns { shouldReEncrypt, result }; auth-cache.js unwraps `result` before
// JSON parsing and keeps the encrypted cache compatible with the sync API.
function encryptedAuthCacheFactory (botId) {
  return createEncryptedAuthCacheFactory({
    userDataPath: app.getPath('userData'),
    safeStorage
  })(botId)
}

function setBotStatus (bot, status, extra = {}) {
  bot.status = status
  Object.assign(bot, extra)
  publishBot(bot)
}

function preparePathfinder (bot) {
  const agent = bot.agent
  if (!agent || !agent.pathfinder) return
  try {
    const movement = new Movements(agent)
    // Coordinate navigation must not mine or place blocks in this first movement build.
    movement.canDig = false
    movement.allow1by1towers = false
    movement.allowParkour = true
    agent.pathfinder.setMovements(movement)
    bot.pathfinderReady = true
    bot.pathfinderError = ''
    pushLog(`${bot.label}: 経路探索の準備ができました。`, 'success', bot.id)
  } catch (error) {
    bot.pathfinderReady = false
    bot.pathfinderError = error.message
    pushLog(`${bot.label}: 経路探索を初期化できませんでした: ${error.message}`, 'warning', bot.id)
  }
  publishBot(bot)
}

function publishAccountStatus (bot, status, error = '') {
  bot.accountStatus = status
  bot.accountError = error
  publishBot(bot)
}

function onMicrosoftDeviceCode (bot, data) {
  publishAccountStatus(bot, 'authenticating')
  const authInfo = {
    botId: bot.id,
    botLabel: bot.label,
    userCode: data?.user_code || data?.userCode || '',
    verificationUri: data?.verification_uri || data?.verificationUri || 'https://www.microsoft.com/link',
    message: data?.message || '表示されたコードをMicrosoftの認証ページに入力してください。'
  }
  send('auth:device-code', authInfo)
  pushLog(`${bot.label}: Microsoftのデバイスコード認証が必要です。`, 'info', bot.id)
}

function askForWorldSelection (bot, sessions, attemptId) {
  if (!Array.isArray(sessions) || sessions.length === 0) throw new Error('参加可能なワールドが見つかりませんでした。')
  const requestId = randomUUID()
  const safeSessions = sessions.map((session, index) => {
    const properties = session?.customProperties || {}
    const reference = session?.sessionRef || {}
    return {
      id: String(index),
      label: String(properties.worldName || properties.hostName || reference.templateName || `ワールド ${index + 1}`),
      details: [properties.version, reference.templateName].filter(Boolean).join(' · ')
    }
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorldSelections.delete(requestId)
      reject(new Error('ワールド選択がタイムアウトしました。'))
    }, 120000)
    pendingWorldSelections.set(requestId, {
      botId: bot.id,
      attemptId,
      sessions,
      resolve: (index) => { clearTimeout(timer); resolve(sessions[index]) },
      reject: (error) => { clearTimeout(timer); reject(error) }
    })
    send('world:sessions', { requestId, botId: bot.id, botLabel: bot.label, sessions: safeSessions })
    pushLog(`${bot.label}: Xboxで参加可能なワールドが${sessions.length}件見つかりました。参加先を選択してください。`, 'info', bot.id)
  })
}

function requestServerKeyApproval (bot, fingerprint, origin, attemptId) {
  const key = serverOriginKey(origin)
  const trusted = settings.trustedServerKeys[key]
  if (trusted) return Promise.resolve(trusted === fingerprint)

  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingServerKeyApprovals.delete(requestId)
      resolve(false)
    }, 60000)
    pendingServerKeyApprovals.set(requestId, {
      botId: bot.id,
      attemptId,
      key,
      fingerprint,
      origin,
      resolve: (approved) => { clearTimeout(timer); resolve(approved) }
    })
    send('security:server-key-approval', {
      requestId,
      botId: bot.id,
      botLabel: bot.label,
      fingerprint,
      origin
    })
    pushLog(`${bot.label}: ${origin} のNetherNetサーバー鍵を確認してください。`, 'warning', bot.id)
  })
}

async function resolveServerKeyApproval (requestId, approved) {
  const pending = pendingServerKeyApprovals.get(String(requestId))
  if (!pending) throw new Error('サーバー鍵の確認要求が見つからないか、期限切れです。')
  pendingServerKeyApprovals.delete(String(requestId))
  if (approved === true) {
    settings.trustedServerKeys[pending.key] = pending.fingerprint
    await saveSettings()
    pushLog(`${pending.botId}: ${pending.origin} のサーバー鍵をこのPCに保存しました。`, 'success', pending.botId)
    pending.resolve(true)
    return true
  }
  pending.resolve(false)
  return false
}

function addServerProfile (input) {
  const profile = normalizeServerProfile(input)
  const existing = settings.servers.find(item => item.host.toLowerCase() === profile.host.toLowerCase() && item.port === profile.port && item.mode === profile.mode && (item.signallingUrl || '') === profile.signallingUrl)
  if (existing) return existing
  settings.servers.push(profile)
  saveSettings().catch(error => pushLog(`サーバー設定の保存に失敗しました: ${error.message}`, 'warning'))
  send('servers:updated', publicServerProfiles())
  pushLog(`接続先「${profile.label}」を登録しました。`, 'success')
  return profile
}

function addHiveAsiaPreset () {
  return addServerProfile({
    label: 'The Hive（アジア）',
    host: 'as.nethernet.playhive.com',
    port: DEFAULT_PORT,
    mode: 'http',
    signallingUrl: 'https://as.nethernet.playhive.com'
  })
}

function removeServerProfile (serverId) {
  const profile = settings.servers.find(item => item.id === serverId)
  if (!profile) return
  if (Array.from(bots.values()).some(bot => bot.targetType === 'server' && bot.targetId === serverId)) {
    throw new Error('この接続先を使用しているBotがあります。先にBotの参加先を変更してください。')
  }
  settings.servers = settings.servers.filter(item => item.id !== serverId)
  saveSettings().catch(error => pushLog(`サーバー設定の保存に失敗しました: ${error.message}`, 'warning'))
  send('servers:updated', publicServerProfiles())
  pushLog(`接続先「${profile.label}」を削除しました。`, 'info')
}

function setBotTarget (botId, input) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (bot.client || bot.connectionStarting) throw new Error('接続中は参加先を変更できません。先に切断してください。')
  const target = normalizeTarget(input, settings.servers)
  bot.targetType = target.type
  bot.targetId = target.serverId
  bot.networkId = target.networkId
  bot.worldName = target.worldName
  saveSettings().catch(error => pushLog(`参加先の保存に失敗しました: ${error.message}`, 'warning'))
  publishBot(bot)
  pushLog(`${bot.label}: 参加先を「${describeBotTarget(bot)}」に設定しました。`, 'info', bot.id)
  return publicBot(bot)
}

async function discoverLanWorld (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (bot.client || bot.connectionStarting) throw new Error('接続中はLANワールドを検索できません。')
  pushLog(`${bot.label}: LAN上のNetherNetワールドを検索しています。`, 'info', bot.id)
  try {
    const advertisement = await bedrockProtocol.ping({
      transport: 'nethernet',
      host: '255.255.255.255',
      nethernet: { signalling: 'lan' },
      timeout: 5000
    })
    if (!advertisement?.networkId) throw new Error('LAN広告からネットワークIDを取得できませんでした。')
    const result = {
      type: 'lan-world',
      networkId: String(advertisement.networkId),
      worldName: String(advertisement.levelName || advertisement.motd || 'LANワールド'),
      hostName: String(advertisement.motd || ''),
      gameVersion: String(advertisement.gameVersion || '')
    }
    pushLog(`${bot.label}: LANワールド「${result.worldName}」を検出しました。`, 'success', bot.id)
    return result
  } catch (error) {
    pushLog(`${bot.label}: LAN検索に失敗しました: ${describeFailure(error)}`, 'warning', bot.id)
    throw error
  }
}

function serverKeyOptions (bot, profile, mode, attemptId) {
  const nethernet = { webrtcBackend: 'werift', signallingConnectTimeout: 30000 }
  if (mode === 'http' || mode === 'auto') {
    const expectedOrigin = serverHttpSignallingOrigin(profile)
    const known = settings.trustedServerKeys[serverOriginKey(expectedOrigin)]
    if (known) nethernet.serverKey = known
    else nethernet.onServerKey = (fingerprint, origin) => requestServerKeyApproval(bot, fingerprint, origin, attemptId)
  }
  return nethernet
}

async function resolveServerConnectionOptions (bot, profile, attemptId, signal) {
  if (profile.mode === 'http') {
    return {
      host: profile.host,
      port: profile.port,
      transport: 'nethernet',
      skipPing: true,
      connectTimeout: 30000,
      nethernet: { ...serverKeyOptions(bot, profile, 'http', attemptId), signalling: 'http', ...(profile.signallingUrl ? { url: profile.signallingUrl } : {}) }
    }
  }
  if (profile.mode === 'raknet') {
    return {
      host: profile.host,
      port: profile.port,
      transport: 'raknet',
      skipPing: true,
      connectTimeout: 15000
    }
  }

  pushLog(`${bot.label}: ${profile.host}:${profile.port} の接続方式を探索しています（RakNet / NetherNet / HTTP）。`, 'info', bot.id)
  const advertisement = await bedrockProtocol.ping({
    host: profile.host,
    port: profile.port,
    timeout: 8000,
    signal
  })
  if (advertisement.transport === 'raknet') {
    pushLog(`${bot.label}: RakNetサーバーとして検出しました。`, 'success', bot.id)
    return { host: profile.host, port: profile.port, transport: 'raknet', skipPing: true, connectTimeout: 15000 }
  }
  if (advertisement.transport === 'nethernet' && advertisement.signalling === 'http') {
    pushLog(`${bot.label}: NetherNet HTTPサーバーとして検出しました。`, 'success', bot.id)
    return {
      host: profile.host,
      port: profile.port,
      transport: 'nethernet',
      skipPing: true,
      connectTimeout: 30000,
      nethernet: { ...serverKeyOptions(bot, profile, 'http', attemptId), signalling: 'http', ...(profile.signallingUrl ? { url: profile.signallingUrl } : {}) }
    }
  }
  if (advertisement.transport === 'nethernet' && advertisement.networkId != null) {
    pushLog(`${bot.label}: NetherNet LAN広告を検出しました。`, 'success', bot.id)
    return {
      host: profile.host,
      port: profile.port,
      transport: 'nethernet',
      skipPing: true,
      nethernet: { signalling: 'lan', networkId: advertisement.networkId, webrtcBackend: 'werift' }
    }
  }
  throw new Error('接続方式を判定できませんでした。サーバーの接続方式を手動で選択してください。')
}


async function authenticateBot (botId) {
  const bot = bots.get(botId)
  assertCanAuthenticate(bot)
  bot.authStarting = true
  publishAccountStatus(bot, 'authenticating')
  pushLog(`${bot.label}: Microsoft / Xboxアカウント認証を開始します。ワールドにはまだ参加しません。`, 'info', bot.id)

  try {
    const encryptionAvailable = typeof safeStorage.isAsyncEncryptionAvailable === 'function'
      ? await safeStorage.isAsyncEncryptionAvailable()
      : safeStorage.isEncryptionAvailable()
    if (!encryptionAvailable) throw new Error('Windowsの安全な認証情報保存機能を利用できません。')

    // Match bedrock-protocol 3.60.1's online Bedrock defaults. The Authflow is
    // retained and later passed to Mineflayer so world joining reuses this login.
    const authflow = new Authflow(
      bot.id,
      encryptedAuthCacheFactory(bot.id),
      { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' },
      (data) => onMicrosoftDeviceCode(bot, data)
    )
    bot.authflow = authflow
    const xbox = await authflow.getXboxToken()
    if (!xbox?.XSTSToken || !xbox?.userXUID) {
      throw new Error('Microsoft / Xboxから有効な認証トークンを取得できませんでした。')
    }

    publishAccountStatus(bot, 'authenticated')
    pushLog(`${bot.label}: Microsoft / Xboxアカウント認証が完了しました。次に「ワールド参加」を押してください。`, 'success', bot.id)
    return publicBot(bot)
  } catch (error) {
    bot.authflow = null
    publishAccountStatus(bot, 'error', safeErrorMessage(error))
    pushLog(`${bot.label}: アカウント認証に失敗しました: ${describeFailure(error)}`, 'error', bot.id)
    throw error
  } finally {
    bot.authStarting = false
    publishBot(bot)
  }
}

async function connectBot (botId) {
  const bot = bots.get(botId)
  assertCanJoinWorld(bot)
  const attemptId = ++bot.connectionAttempt
  const abortController = new AbortController()
  bot.connectionAbortController = abortController
  bot.connectionStarting = true
  setBotStatus(bot, 'connecting')
  bot.manualDisconnect = false
  bot.hadError = false
  bot.lastError = ''
  bot.playerName = ''
  bot.movementStatus = '停止中'
  bot.pathfinderReady = false
  bot.startGameReceived = false
  bot.movementAuthority = ''
  bot.correctionPackets = 0
  bot.levelChunkPackets = 0
  bot.subchunkPackets = 0
  bot.worldColumnsLoaded = 0
  bot.lastServerTick = ''

  let connectionOptions
  try {
    if (bot.targetType === 'server') {
      const profile = settings.servers.find(item => item.id === bot.targetId)
      if (!profile) throw new Error('選択したサーバー設定が見つかりません。参加先を選び直してください。')
      connectionOptions = await resolveServerConnectionOptions(bot, profile, attemptId, abortController.signal)
      pushLog(`${bot.label}: ${profile.label}（${profile.host}:${profile.port}）への接続を開始します。方式=${profile.mode}`, 'info', bot.id)
    } else if (bot.targetType === 'friend-world') {
      connectionOptions = {
        world: { pickSession: (sessions) => askForWorldSelection(bot, sessions, attemptId) },
        nethernet: { webrtcBackend: 'werift' }
      }
      pushLog(`${bot.label}: Xboxで参加可能なフレンドのワールドを検索します。`, 'info', bot.id)
    } else if (bot.targetType === 'lan-world') {
      if (!/^\d{1,20}$/.test(String(bot.networkId || ''))) throw new Error('先に「LAN検索」を実行して参加するワールドを選択してください。')
      connectionOptions = {
        host: '255.255.255.255',
        port: DEFAULT_PORT,
        transport: 'nethernet',
        skipPing: true,
        nethernet: { signalling: 'lan', networkId: BigInt(bot.networkId), webrtcBackend: 'werift' }
      }
      pushLog(`${bot.label}: LANワールド「${bot.worldName || 'LANワールド'}」への接続を開始します。`, 'info', bot.id)
    } else {
      throw new Error('Botの参加先を選択してください。')
    }
  } catch (error) {
    if (bot.connectionAttempt !== attemptId || abortController.signal.aborted) return publicBot(bot)
    bot.connectionStarting = false
    bot.connectionAbortController = null
    bot.hadError = true
    bot.lastError = safeErrorMessage(error)
    setBotStatus(bot, 'error', { lastError: bot.lastError })
    pushLog(`${bot.label}: 接続先の準備に失敗しました: ${describeFailure(error)}`, 'error', bot.id)
    throw error
  }

  if (bot.connectionAttempt !== attemptId || abortController.signal.aborted) return publicBot(bot)

  let agent
  try {
    agent = mineflayer.createBot({
      ...connectionOptions,
      edition: 'bedrock',
      version: `bedrock_${MC_VERSION}`,
      username: bot.id,
      offline: false,
      raknetBackend: 'jsp-raknet',
      useRaknetWorkers: false,
      profilesFolder: encryptedAuthCacheFactory(bot.id),
      authflow: bot.authflow,
      onMsaCode: (data) => onMicrosoftDeviceCode(bot, data),
      conLog: (message) => pushLog(`${bot.label}: ${message}`, 'info', bot.id),
      hideErrors: false,
      logErrors: false,
      respawn: true
    })
  } catch (error) {
    bot.connectionStarting = false
    bot.connectionAbortController = null
    bot.hadError = true
    bot.lastError = safeErrorMessage(error)
    setBotStatus(bot, 'error', { lastError: bot.lastError })
    pushLog(`${bot.label}: Bot生成に失敗しました: ${describeFailure(error)}`, 'error', bot.id)
    throw error
  }

  bot.agent = agent
  bot.client = agent._client
  bot.connectionAbortController = abortController
  bot.connectionStarting = false
  if (!bot.client || typeof bot.client.on !== 'function') {
    bot.agent = null
    bot.client = null
    bot.connectionAbortController = null
    bot.hadError = true
    bot.lastError = 'Bedrock通信クライアントを初期化できませんでした。依存ライブラリの互換性を確認してください。'
    setBotStatus(bot, 'error', { lastError: bot.lastError })
    throw new Error(bot.lastError)
  }

  agent._client.on('start_game', (packet) => {
    if (bot.agent !== agent) return
    bot.startGameReceived = true
    bot.movementAuthority = packet?.movement_authority == null ? '不明' : String(packet.movement_authority)
    bot.lastServerTick = diagnosticValue(packet?.current_tick)
    const hashMode = packet?.block_network_ids_are_hashes ? 'ハッシュ形式' : '通常形式'
    const world = agent._bedrockWorldSupport
    pushLog(`${bot.label}: StartGame受信。移動権限=${bot.movementAuthority} / ブロックID=${hashMode} / 地形解析=${world?.supported ? '利用可能' : (world?.reason || '判定中')}`, 'info', bot.id)
    publishBot(bot)
  })
  agent._client.on('correct_player_move_prediction', (packet) => {
    if (bot.agent !== agent) return
    bot.correctionPackets++
    if (packet?.tick != null) bot.lastServerTick = diagnosticValue(packet.tick)
  })
  agent._client.on('level_chunk', () => { if (bot.agent === agent) bot.levelChunkPackets++ })
  agent._client.on('subchunk', () => { if (bot.agent === agent) bot.subchunkPackets++ })

  try {
    agent.loadPlugin(pathfinder)
  } catch (error) {
    bot.hadError = true
    bot.lastError = safeErrorMessage(error)
    try { bot.client?.disconnect('Plugin initialization failed') } catch { try { bot.client?.close() } catch {} }
    setBotStatus(bot, 'error', { lastError: bot.lastError })
    pushLog(`${bot.label}: 経路探索プラグインの初期化に失敗しました: ${describeFailure(error)}`, 'error', bot.id)
    throw error
  }

  agent._client.on('session', (profile) => {
    bot.playerName = profile?.name || ''
    publishAccountStatus(bot, 'authenticated')
    setBotStatus(bot, 'connecting')
  })
  agent.on('connect', () => { if (bot.agent === agent) setBotStatus(bot, 'connecting') })
  agent.on('login', () => {
    if (bot.agent === agent) {
      bot.playerName = agent.username || bot.playerName
      setBotStatus(bot, 'joining')
      pushLog(`${bot.label}: サーバーへのログインが完了しました。`, 'success', bot.id)
    }
  })
  agent.on('spawn', () => {
    if (bot.agent !== agent) return
    setBotStatus(bot, 'connected')
    preparePathfinder(bot)
    pushLog(`${bot.label}: ワールドにスポーンしました。`, 'success', bot.id)
  })
  agent.on('kicked', (reason) => {
    bot.lastError = String(reason || 'サーバーから切断されました。')
    pushLog(`${bot.label}: キックされました: ${bot.lastError}`, 'warning', bot.id)
  })
  agent.on('error', (error) => {
    if (bot.agent !== agent) return
    bot.hadError = true
    bot.lastError = error?.message || String(error)
    setBotStatus(bot, 'error', { lastError: bot.lastError })
    pushLog(`${bot.label}: 接続エラー: ${describeFailure(error)}`, 'error', bot.id)
  })
  agent.on('end', (reason) => {
    if (bot.agent !== agent) return
    bot.movementRequestId++
    clearInterval(bot.movementTimer)
    bot.movementTimer = null
    bot.client = null
    bot.agent = null
    bot.connectionStarting = false
    bot.connectionAbortController = null
    bot.pathfinderReady = false
    const finalStatus = bot.hadError ? 'error' : 'disconnected'
    setBotStatus(bot, finalStatus)
    if (!bot.manualDisconnect) pushLog(`${bot.label}: 接続が終了しました。${reason ? ` (${String(reason)})` : ''}`, bot.hadError ? 'warning' : 'info', bot.id)
  })
  agent.on('move', () => {
    const now = Date.now()
    if (now - bot.lastUiPositionUpdate >= 500) {
      bot.lastUiPositionUpdate = now
      publishBot(bot)
    }
  })
  agent.on('chunkColumnLoad', () => {
    if (bot.agent !== agent) return
    bot.worldColumnsLoaded++
    publishBot(bot)
  })
  agent.on('health', publishBot.bind(null, bot))
  agent.on('food', publishBot.bind(null, bot))
  agent.on('goal_reached', () => {
    if (bot.agent !== agent) return
    bot.movementStatus = '目的地に到着しました'
    publishBot(bot)
    pushLog(`${bot.label}: 指定座標付近に到着しました。`, 'success', bot.id)
  })
  agent.on('path_update', (result) => {
    if (bot.agent !== agent || !String(bot.movementStatus).startsWith('座標移動中')) return
    if (result?.status === 'noPath' || result?.status === 'timeout') {
      bot.movementStatus = '経路を見つけられませんでした'
      publishBot(bot)
      pushLog(`${bot.label}: 目的地までの経路を見つけられませんでした。`, 'warning', bot.id)
    }
  })
  agent.on('blockUpdateError', (_pos, runtimeId) => {
    pushLog(`${bot.label}: 未知のブロックID ${runtimeId} を受信しました。地形データに影響する可能性があります。`, 'warning', bot.id)
  })
  publishBot(bot)
}

function getConnectedAgent (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (!bot.agent || bot.status !== 'connected') throw new Error('Botがワールドに参加していません。')
  return { bot, agent: bot.agent }
}

function stopBotMovement (botId, statusText = '停止中') {
  const { bot, agent } = getConnectedAgent(botId)
  bot.movementRequestId++
  try { agent.pathfinder?.setGoal(null) } catch {}
  try { agent.pathfinder?.stop() } catch {}
  try { agent.clearControlStates() } catch {}
  bot.movementStatus = statusText
  publishBot(bot)
  return publicBot(bot)
}

function setBotControl (botId, control, active) {
  const { bot, agent } = getConnectedAgent(botId)
  validateControl(control)
  if (active) {
    bot.movementRequestId++
    if (bot.movementStatus.startsWith('座標移動中') || bot.movementStatus === '周囲のチャンクを確認中') {
      try { agent.pathfinder?.setGoal(null) } catch {}
    }
  }
  agent.setControlState(control, Boolean(active))
  bot.movementStatus = active ? `手動操作中: ${control}` : '手動操作中'
  publishBot(bot)
  return publicBot(bot)
}

async function gotoBot (botId, input) {
  const { bot, agent } = getConnectedAgent(botId)
  if (!bot.pathfinderReady || !agent.pathfinder) throw new Error(bot.pathfinderError || '経路探索の準備ができていません。周囲の地形データを確認してください。')
  if (agent._bedrockWorldSupport && !agent._bedrockWorldSupport.supported) {
    throw new Error(`地形データを読み取れないため座標移動できません: ${agent._bedrockWorldSupport.reason || '未対応の形式'}`)
  }
  const { x, y, z } = normalizeCoordinates(input)
  const requestId = ++bot.movementRequestId
  try { agent.clearControlStates() } catch {}
  bot.movementStatus = '周囲のチャンクを確認中'
  publishBot(bot)
  if (typeof agent.waitForChunksToLoad === 'function') {
    try {
      await agent.waitForChunksToLoad()
      if (bot.movementRequestId !== requestId || bot.agent !== agent) return publicBot(bot)
    } catch (error) {
      if (bot.movementRequestId !== requestId || bot.agent !== agent) return publicBot(bot)
      bot.movementStatus = '周囲の地形データを読み込めませんでした'
      publishBot(bot)
      throw new Error(`Bot周囲のチャンクを読み込めませんでした: ${error.message}`)
    }
  }
  // GoalNear allows a one-block tolerance, so the bot can arrive on a valid standing block
  // instead of being forced into an occupied target block.
  const goal = new goals.GoalNear(x, y, z, 1)
  if (bot.movementRequestId !== requestId || bot.agent !== agent) return publicBot(bot)
  agent.pathfinder.setGoal(goal)
  bot.movementStatus = `座標移動中: ${x}, ${y}, ${z}`
  pushLog(`${bot.label}: 座標 ${x}, ${y}, ${z} への移動を開始しました。`, 'info', bot.id)
  publishBot(bot)
  return publicBot(bot)
}

function addBot (input) {
  const label = cleanLabel(input?.label)
  if (!label) throw new Error('Bot名は1〜32文字で入力してください。')
  const bot = createBotRecord({ id: randomUUID(), label, targetType: 'none', targetId: '', networkId: '', worldName: '' })
  bots.set(bot.id, bot)
  saveSettings().catch(error => pushLog(`設定保存に失敗しました: ${error.message}`, 'warning'))
  pushLog(`${label}を追加しました。参加先はBot一覧から後で選択できます。`, 'success', bot.id)
  publishBot(bot)
  return publicBot(bot)
}

async function removeBot (botId) {
  const bot = bots.get(botId)
  if (!bot) return
  if (bot.authStarting) throw new Error('アカウント認証中はBotを削除できません。')
  if (bot.client || bot.connectionStarting) disconnectBot(botId)
  bots.delete(botId)
  await fs.rm(path.join(app.getPath('userData'), 'auth', botId), { recursive: true, force: true })
  await saveSettings()
  send('bot:removed', botId)
  pushLog(`${bot.label}を一覧から削除しました。`, 'info', botId)
}

function cancelPendingBotOperations (bot, reason = '接続処理がキャンセルされました。') {
  for (const [requestId, pending] of pendingWorldSelections) {
    if (pending.botId !== bot.id) continue
    pendingWorldSelections.delete(requestId)
    pending.reject(new Error(reason))
  }
  for (const [requestId, pending] of pendingServerKeyApprovals) {
    if (pending.botId !== bot.id) continue
    pendingServerKeyApprovals.delete(requestId)
    pending.resolve(false)
  }
}

function disconnectBot (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  bot.manualDisconnect = true
  bot.connectionAttempt++
  try { bot.connectionAbortController?.abort(new Error('接続処理がキャンセルされました。')) } catch {}
  bot.connectionAbortController = null
  cancelPendingBotOperations(bot)
  if (!bot.client) {
    bot.connectionStarting = false
    setBotStatus(bot, 'disconnected')
    return
  }

  bot.manualDisconnect = true
  bot.movementRequestId++
  try { bot.agent?.clearControlStates() } catch {}
  try { bot.agent?.pathfinder?.setGoal(null) } catch {}
  const client = bot.client
  pushLog(`${bot.label}: 切断します。`, 'info', bot.id)
  try {
    client.disconnect('Bot leaving')
  } catch (error) {
    try { client.close() } catch {}
    bot.client = null
    bot.agent = null
    bot.connectionStarting = false
    bot.pathfinderReady = false
    setBotStatus(bot, 'disconnected')
    pushLog(`${bot.label}: 切断処理中のエラー: ${error.message}`, 'warning', bot.id)
  }
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'Bedrock Bot Console',
    backgroundColor: '#10131c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const message = `画面プロセスが終了しました: reason=${details?.reason || 'unknown'} exitCode=${details?.exitCode ?? 'unknown'}`
    writeDiagnosticLog(`[render-process-gone] ${message}`)
    pushLog(message, 'error')
  })
  mainWindow.webContents.on('unresponsive', () => {
    writeDiagnosticLog('[renderer] ウィンドウが応答しなくなりました')
    pushLog('画面が応答しなくなりました。', 'error')
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((error) => {
    pushLog(`画面の読み込みに失敗しました: ${error.message}`, 'error')
    dialog.showErrorBox('Bedrock Bot Console', `画面を読み込めませんでした。\n${error.message}`)
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

ipcMain.handle('app:get-state', () => ({
  version: MC_VERSION,
  appVersion: '0.3.4',
  servers: publicServerProfiles(),
  bots: Array.from(bots.values()).map(publicBot),
  logs: logBuffer
}))
ipcMain.handle('bot:add', (_event, input) => publicBot(bots.get(addBot(input).id)))
ipcMain.handle('server:add', (_event, input) => {
  const profile = addServerProfile(input)
  return { ...profile }
})
ipcMain.handle('server:add-hive-preset', () => ({ ...addHiveAsiaPreset() }))
ipcMain.handle('server:remove', (_event, serverId) => removeServerProfile(serverId))
ipcMain.handle('bot:set-target', (_event, args) => setBotTarget(args?.botId, args?.target))
ipcMain.handle('bot:discover-lan', (_event, botId) => discoverLanWorld(botId))
ipcMain.handle('world:select-session', (_event, args) => {
  const requestId = String(args?.requestId || '')
  const pending = pendingWorldSelections.get(requestId)
  const index = Number(args?.sessionIndex)
  if (!pending) throw new Error('ワールド選択要求が見つからないか、期限切れです。')
  if (!Number.isInteger(index) || index < 0 || index >= pending.sessions.length) throw new Error('選択したワールドが不正です。')
  pendingWorldSelections.delete(requestId)
  pending.resolve(index)
  return true
})
ipcMain.handle('world:cancel-selection', (_event, requestId) => {
  const pending = pendingWorldSelections.get(String(requestId || ''))
  if (!pending) return false
  pendingWorldSelections.delete(String(requestId))
  pending.reject(new Error('ワールド選択がキャンセルされました。'))
  return true
})
ipcMain.handle('security:resolve-server-key', (_event, args) => resolveServerKeyApproval(args?.requestId, args?.approved))
ipcMain.handle('bot:authenticate', async (_event, botId) => {
  try { return await authenticateBot(botId) } catch (error) {
    const bot = bots.get(botId)
    if (bot) publishAccountStatus(bot, 'error', safeErrorMessage(error))
    throw error
  }
})
ipcMain.handle('bot:connect', async (_event, botId) => {
  try { await connectBot(botId) } catch (error) {
    const bot = bots.get(botId)
    if (bot) setBotStatus(bot, 'error', { lastError: safeErrorMessage(error) })
    throw error
  }
  return publicBot(bots.get(botId))
})
ipcMain.handle('bot:disconnect', (_event, botId) => {
  disconnectBot(botId)
  return publicBot(bots.get(botId))
})
ipcMain.handle('bot:remove', (_event, botId) => removeBot(botId))
ipcMain.handle('bot:control', (_event, args) => setBotControl(args?.botId, args?.control, args?.active))
ipcMain.handle('bot:goto', (_event, args) => gotoBot(args?.botId, args?.coordinates))
ipcMain.handle('bot:stop', (_event, botId) => stopBotMovement(botId))
ipcMain.handle('auth:open-url', async (_event, rawUrl) => {
  const url = isAllowedAuthUrl(rawUrl)
  if (!url) throw new Error('許可されていない認証URLです。')
  await shell.openExternal(url)
})

app.on('child-process-gone', (_event, details) => {
  const message = `子プロセス終了: type=${details?.type || 'unknown'} reason=${details?.reason || 'unknown'} exitCode=${details?.exitCode ?? 'unknown'}`
  writeDiagnosticLog(`[child-process-gone] ${message}`)
  pushLog(message, 'error')
})
app.on('before-quit', () => { writeDiagnosticLog('[electron] before-quit') })
app.on('quit', (_event, code) => { writeDiagnosticLog(`[electron] quit code=${code}`) })

app.whenReady().then(async () => {
  initializeDiagnosticLog()
  await loadSettings()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error) => {
  writeDiagnosticLog(`[startup-failure] ${describeFailure(error)}`)
  pushLog(`アプリの起動処理に失敗しました: ${describeFailure(error)}`, 'error')
  dialog.showErrorBox('Bedrock Bot Console の起動エラー', error?.stack || error?.message || String(error))
  app.quit()
})

app.on('before-quit', () => {
  for (const bot of bots.values()) {
    if (bot.client) {
      try { bot.agent?.clearControlStates() } catch {}
      try { bot.client.disconnect('Application closing') } catch { try { bot.client.close() } catch {} }
    }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

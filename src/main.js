'use strict'

const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog } = require('electron')
const PACKAGE = require('../package.json')
const APP_VERSION = PACKAGE.version

// Keep the same Electron userData directory used by the ZIP builds.
app.setName(PACKAGE.name)
if (process.platform === 'win32') app.setAppUserModelId('com.jhonbot.bedrockbotconsole')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const util = require('node:util')
const { Vec3 } = require('vec3')
const { randomUUID } = require('node:crypto')
const mineflayer = require('mineflayer')
const bedrockProtocol = require('bedrock-protocol')
const { Authflow, Titles } = require('prismarine-auth')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { validateControl, normalizeCoordinates } = require('./control-validation')
const { safeErrorMessage, isAllowedAuthUrl } = require('./runtime-guards')
const { assertCanAuthenticate, assertCanJoinWorld } = require('./account-state')
const { createEncryptedAuthCacheFactory, hasEncryptedAuthCache } = require('./auth-cache')
const { normalizeChatMessage, normalizeDropRequest, createInventorySnapshot } = require('./bot-actions')
const { installSubClientSupport, createGuestLoginTokens, MAX_SUB_CLIENTS } = require('./subclients')
const { normalizeBotModules, moduleConfigComplete, isModuleAssigned, reconnectDelay, isTransientDisconnect } = require('./modules')
const { listRealms } = require('./realms')
const { discoverLanWorlds } = require('./lan-discovery')
const { DEFAULT_PORT, normalizeServerProfile, normalizeTarget, migrateSettings, serverOriginKey, serverHttpSignallingOrigin, getTrustedServerKeyFingerprints, addTrustedServerKey, recordSuccessfulServerConnection, resetTrustedServerKey } = require('./destinations')

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
    writeDiagnosticLog(`\n===== Bedrock Bot Console ${APP_VERSION} 起動 =====`)
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
  const parent = bot.parentBotId ? bots.get(bot.parentBotId) : null
  const guestCount = bot.parentBotId ? 0 : Array.from(bots.values()).filter(item => item.parentBotId === bot.id).length
  const pos = entity?.position
  return {
    id: bot.id,
    label: bot.label,
    isGuest: !!bot.parentBotId,
    parentBotId: bot.parentBotId || '',
    parentBotLabel: parent?.label || '',
    subClientId: bot.parentBotId ? Number(bot.subClientId) || 0 : 0,
    guestCount,
    guestLimit: MAX_SUB_CLIENTS,
    targetType: bot.targetType || 'none',
    targetId: bot.targetId || '',
    networkId: bot.networkId || '',
    worldName: bot.worldName || '',
    modules: normalizeBotModules(bot.modules),
    moduleStatus: {
      itemUse: bot.itemUseStatus || '未実行',
      containerSupply: bot.containerSupplyStatus || '未実行',
      connectionManager: bot.reconnectStatus || '未割り当て',
      reconnectAttempts: bot.reconnectAttempts || 0
    },
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
    modules: normalizeBotModules(saved.modules),
    parentBotId: saved.parentBotId || '',
    subClientId: saved.parentBotId ? Number(saved.subClientId) || 0 : 0,
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
    accountStatus: saved.parentBotId ? 'shared' : 'unverified',
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
    lastServerTick: '',
    chatHistory: [],
    inventoryPublishTimer: null,
    itemUseTimer: null,
    itemUseRunning: false,
    itemUseBusy: false,
    itemUseSlot: null,
    itemUseStatus: '未実行',
    containerSupplyTimer: null,
    containerSupplyRunning: false,
    containerSupplyBusy: false,
    containerSupplyGeneration: 0,
    containerSupplyNavigating: false,
    containerSupplyStatus: '未実行',
    reconnectTimer: null,
    reconnectAttempts: 0,
    reconnectStatus: '未割り当て',
    kicked: false
  }
}

function describeBotTarget (bot) {
  if (bot?.parentBotId) {
    const parent = bots.get(bot.parentBotId)
    return parent ? `親Bot「${parent.label}」の参加先を共有 (SubClient ${bot.subClientId})` : '親Botが見つかりません'
  }
  if (!bot || bot.targetType === 'none') return '参加先未設定'
  if (bot.targetType === 'friend-world') return 'フレンドのワールド（参加時に選択）'
  if (bot.targetType === 'realm') return bot.targetId ? `Realms：${bot.worldName || bot.targetId}` : 'Realms（一覧から選択）'
  if (bot.targetType === 'lan-world') return bot.networkId ? `${bot.worldName || 'LANワールド'}（LAN）` : 'LANワールド（未検索）'
  const server = settings.servers.find(item => item.id === bot.targetId)
  return server ? `${server.label} · ${server.host}:${server.port}` : 'サーバー設定が見つかりません'
}

function publicServerProfiles () {
  return settings.servers.map(({ id, label, host, port, mode, signallingUrl, lastSuccessfulMode, lastSuccessfulAt }) => ({
    id, label, host, port, mode, signallingUrl, lastSuccessfulMode: lastSuccessfulMode || '', lastSuccessfulAt: lastSuccessfulAt || ''
  }))
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
    if (!bot.parentBotId) {
      try {
        if (await hasEncryptedAuthCache(app.getPath('userData'), bot.id)) bot.accountStatus = 'saved'
      } catch (error) {
        pushLog(`${bot.label}: 保存済み認証情報の確認に失敗しました: ${error.message}`, 'warning', bot.id)
      }
    } else {
      bot.accountStatus = 'shared'
    }
    bots.set(saved.id, bot)
  }
  await saveSettings()
}

function saveSettings () {
  const snapshot = {
    servers: settings.servers.map(({ id, label, host, port, mode, signallingUrl, lastSuccessfulMode, lastSuccessfulAt }) => ({
      id, label, host, port, mode, signallingUrl, lastSuccessfulMode: lastSuccessfulMode || '', lastSuccessfulAt: lastSuccessfulAt || ''
    })),
    trustedServerKeys: { ...settings.trustedServerKeys },
    bots: Array.from(bots.values()).map(({ id, label, targetType, targetId, networkId, worldName, modules, parentBotId, subClientId }) => ({
      id, label, targetType, targetId, networkId, worldName, modules: normalizeBotModules(modules), ...(parentBotId ? { parentBotId, subClientId } : {})
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
  const trustedFingerprints = getTrustedServerKeyFingerprints(settings.trustedServerKeys, origin)
  if (trustedFingerprints.includes(fingerprint)) return Promise.resolve(true)

  const previouslyTrusted = trustedFingerprints.length > 0
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
      previouslyTrusted,
      resolve: (approved) => { clearTimeout(timer); resolve(approved) }
    })
    send('security:server-key-approval', {
      requestId,
      botId: bot.id,
      botLabel: bot.label,
      fingerprint,
      origin,
      previouslyTrusted
    })
    pushLog(previouslyTrusted
      ? `${bot.label}: ${origin} から以前と異なるNetherNetサーバー鍵が提示されました。追加の信頼確認が必要です。`
      : `${bot.label}: ${origin} のNetherNetサーバー鍵を確認してください。`, 'warning', bot.id)
  })
}

async function resolveServerKeyApproval (requestId, approved) {
  const pending = pendingServerKeyApprovals.get(String(requestId))
  if (!pending) throw new Error('サーバー鍵の確認要求が見つからないか、期限切れです。')
  pendingServerKeyApprovals.delete(String(requestId))
  if (approved === true) {
    addTrustedServerKey(settings.trustedServerKeys, pending.origin, pending.fingerprint)
    await saveSettings()
    pushLog(pending.previouslyTrusted
      ? `${pending.botId}: ${pending.origin} の追加サーバー鍵を既存の信頼情報を残して保存しました。`
      : `${pending.botId}: ${pending.origin} のサーバー鍵をこのPCに保存しました。`, 'success', pending.botId)
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

async function resetServerKey (serverId) {
  const profile = settings.servers.find(item => item.id === String(serverId || ''))
  if (!profile) throw new Error('接続先が見つかりません。')
  if (profile.mode === 'raknet') throw new Error('RakNet接続先にはNetherNetサーバー鍵がありません。')

  const activeBot = Array.from(bots.values()).find(bot =>
    bot.targetType === 'server' &&
    bot.targetId === profile.id &&
    (bot.connectionStarting || bot.client || ['connecting', 'joining', 'connected'].includes(bot.status))
  )
  if (activeBot) {
    throw new Error(`Bot「${activeBot.label}」がこの接続先を使用中です。先にBotを切断してください。`)
  }

  const origin = serverHttpSignallingOrigin(profile)
  const key = serverOriginKey(origin)
  const previous = settings.trustedServerKeys[key]
  if (!resetTrustedServerKey(settings.trustedServerKeys, origin)) {
    pushLog(`接続先「${profile.label}」にはリセット対象の保存済み鍵がありません。`, 'info')
    return { reset: false, origin }
  }

  try {
    await saveSettings()
  } catch (error) {
    settings.trustedServerKeys[key] = previous
    throw error
  }

  pushLog(`接続先「${profile.label}」のサーバー鍵の信頼情報をリセットしました。次回接続時に新しい鍵を確認します。`, 'success')
  return { reset: true, origin }
}

function setBotTarget (botId, input) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (bot.parentBotId) throw new Error('ゲストBotの参加先は親Botと共有されます。')
  if (bot.client || bot.connectionStarting) throw new Error('接続中は参加先を変更できません。先に切断してください。')
  const target = normalizeTarget(input, settings.servers)
  bot.targetType = target.type
  bot.targetId = target.serverId
  bot.networkId = target.networkId
  bot.worldName = target.worldName
  for (const guest of bots.values()) {
    if (guest.parentBotId !== bot.id) continue
    guest.targetType = bot.targetType
    guest.targetId = bot.targetId
    guest.networkId = bot.networkId
    guest.worldName = bot.worldName
    publishBot(guest)
  }
  saveSettings().catch(error => pushLog(`参加先の保存に失敗しました: ${error.message}`, 'warning'))
  publishBot(bot)
  pushLog(`${bot.label}: 参加先を「${describeBotTarget(bot)}」に設定しました。`, 'info', bot.id)
  return publicBot(bot)
}

async function discoverLanWorldsForBot (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (bot.parentBotId) throw new Error('ゲストBotは親Botの参加先を共有します。')
  if (bot.client || bot.connectionStarting) throw new Error('接続中はLANワールドを検索できません。')
  pushLog(`${bot.label}: LAN上のNetherNetワールドを複数検索しています。`, 'info', bot.id)
  try {
    const worlds = await discoverLanWorlds(6000)
    pushLog(worlds.length
      ? `${bot.label}: LANワールドを${worlds.length}件検出しました。`
      : `${bot.label}: LANワールドは見つかりませんでした。`, worlds.length ? 'success' : 'warning', bot.id)
    return worlds
  } catch (error) {
    pushLog(`${bot.label}: LAN検索に失敗しました: ${describeFailure(error)}`, 'warning', bot.id)
    throw error
  }
}

async function discoverLanWorld (botId) {
  const worlds = await discoverLanWorldsForBot(botId)
  if (!worlds.length) throw new Error('LAN上に参加可能なワールドが見つかりませんでした。')
  return worlds[0]
}

async function getBotRealms (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  const accountBot = bot.parentBotId ? bots.get(bot.parentBotId) : bot
  if (!accountBot?.authflow || accountBot.accountStatus !== 'authenticated') {
    throw new Error('先にこのBotのMicrosoft / Xboxアカウントを認証してください。')
  }
  pushLog(`${bot.label}: 認証済みアカウントのRealms一覧を取得しています。`, 'info', bot.id)
  try {
    const realms = await listRealms(accountBot.authflow, MC_VERSION)
    pushLog(`${bot.label}: Realmsを${realms.length}件取得しました。`, realms.length ? 'success' : 'warning', bot.id)
    return realms
  } catch (error) {
    pushLog(`${bot.label}: Realms一覧の取得に失敗しました: ${describeFailure(error)}`, 'warning', bot.id)
    throw error
  }
}

function serverKeyOptions (bot, profile, mode, attemptId) {
  const nethernet = {
    webrtcBackend: 'werift',
    signallingConnectTimeout: 30000,
    inactivityTimeoutMs: 15000,
    onDiagnostics: (message) => {
      if (bot.connectionAttempt !== attemptId) return
      pushLog(`${bot.label}: [NetherNet] ${String(message)}`, 'info', bot.id)
    }
  }
  if (mode === 'http' || mode === 'auto') {
    const expectedOrigin = serverHttpSignallingOrigin(profile)
    nethernet.serverKeys = getTrustedServerKeyFingerprints(settings.trustedServerKeys, expectedOrigin)
    // Always allow an unrecognized key to request explicit user approval, even when
    // this origin already has one or more account/backend-specific keys pinned.
    nethernet.onServerKey = (fingerprint, origin) => requestServerKeyApproval(bot, fingerprint, origin, attemptId)
  }
  return nethernet
}

async function resolveServerConnectionOptions (bot, profile, attemptId, signal) {
  if (profile.mode === 'http') {
    return {
      method: 'nethernet-http',
      options: {
        host: profile.host,
        port: profile.port,
        transport: 'nethernet',
        skipPing: true,
        connectTimeout: 30000,
        nethernet: { ...serverKeyOptions(bot, profile, 'http', attemptId), signalling: 'http', ...(profile.signallingUrl ? { url: profile.signallingUrl } : {}) }
      }
    }
  }
  if (profile.mode === 'raknet') {
    return {
      method: 'raknet',
      options: {
        host: profile.host,
        port: profile.port,
        transport: 'raknet',
        skipPing: true,
        connectTimeout: 15000
      }
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
    return {
      method: 'raknet',
      options: { host: profile.host, port: profile.port, transport: 'raknet', skipPing: true, connectTimeout: 15000 }
    }
  }
  if (advertisement.transport === 'nethernet' && advertisement.signalling === 'http') {
    pushLog(`${bot.label}: NetherNet HTTPサーバーとして検出しました。`, 'success', bot.id)
    return {
      method: 'nethernet-http',
      options: {
        host: profile.host,
        port: profile.port,
        transport: 'nethernet',
        skipPing: true,
        connectTimeout: 30000,
        nethernet: { ...serverKeyOptions(bot, profile, 'http', attemptId), signalling: 'http', ...(profile.signallingUrl ? { url: profile.signallingUrl } : {}) }
      }
    }
  }
  if (advertisement.transport === 'nethernet' && advertisement.networkId != null) {
    pushLog(`${bot.label}: NetherNet LAN広告を検出しました。`, 'success', bot.id)
    return {
      method: 'nethernet-lan',
      options: {
        host: profile.host,
        port: profile.port,
        transport: 'nethernet',
        skipPing: true,
        nethernet: { signalling: 'lan', networkId: advertisement.networkId, webrtcBackend: 'werift' }
      }
    }
  }
  throw new Error('接続方式を判定できませんでした。サーバーの接続方式を手動で選択してください。')
}

async function authenticateBot (botId) {
  const bot = bots.get(botId)
  if (bot?.parentBotId) throw new Error('ゲストBotは親アカウントの認証を共有するため、個別認証は不要です。')
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

async function connectBot (botId, options = {}) {
  const bot = bots.get(botId)
  if (bot?.parentBotId) throw new Error('ゲストBotは個別接続できません。親Botをワールドに参加させてください。')
  assertCanJoinWorld(bot)
  const attemptId = ++bot.connectionAttempt
  const abortController = new AbortController()
  bot.connectionAbortController = abortController
  bot.connectionStarting = true
  setBotStatus(bot, 'connecting')
  bot.manualDisconnect = false
  if (!options.reconnect) bot.reconnectAttempts = 0
  bot.kicked = false
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
  let connectionMethod = ''
  let serverProfileId = ''
  try {
    if (bot.targetType === 'server') {
      const profile = settings.servers.find(item => item.id === bot.targetId)
      if (!profile) throw new Error('選択したサーバー設定が見つかりません。参加先を選び直してください。')
      const resolved = await resolveServerConnectionOptions(bot, profile, attemptId, abortController.signal)
      connectionOptions = resolved.options
      connectionMethod = resolved.method
      serverProfileId = profile.id
      pushLog(`${bot.label}: ${profile.label}（${profile.host}:${profile.port}）への接続を開始します。方式=${profile.mode} / 検出=${connectionMethod}`, 'info', bot.id)
    } else if (bot.targetType === 'friend-world') {
      connectionOptions = {
        world: { pickSession: (sessions) => askForWorldSelection(bot, sessions, attemptId) },
        nethernet: {
          webrtcBackend: 'werift',
          signallingConnectTimeout: 30000,
          inactivityTimeoutMs: 15000
        },
        // The outer watchdog is longer than the 30s response + 15s inactivity windows,
        // leaving room for timer scheduling without masking the more specific timeout.
        connectTimeout: 60000
      }
      pushLog(`${bot.label}: Xboxで参加可能なフレンドのワールドを検索します。`, 'info', bot.id)
    } else if (bot.targetType === 'realm') {
      if (!/^\\d{1,20}$/.test(String(bot.targetId || ''))) throw new Error('先にRealms一覧を検索して参加するRealmを選択してください。')
      connectionOptions = { realms: { realmId: bot.targetId } }
      pushLog(`${bot.label}: Realms「${bot.worldName || bot.targetId}」への接続を開始します。`, 'info', bot.id)
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
  try { installSubClientSupport(bot.client) } catch (error) {
    try { bot.client?.disconnect('SubClient initialization failed') } catch { try { bot.client?.close() } catch {} }
    bot.agent = null
    bot.client = null
    bot.connectionStarting = false
    bot.connectionAbortController = null
    bot.hadError = true
    bot.lastError = safeErrorMessage(error)
    setBotStatus(bot, 'error', { lastError: bot.lastError })
    throw error
  }
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

  // Trace only protocol lifecycle packet names and the public status enum; never log packet payloads or tokens.
  const bedrockLifecyclePackets = new Set([
    'network_settings',
    'server_to_client_handshake',
    'play_status',
    'resource_packs_info',
    'resource_pack_stack',
    'start_game',
    'disconnect'
  ])
  const bedrockPacketCounts = new Map()
  const bedrockStatusNames = ['Disconnected', 'Connecting', 'Authenticating', 'Initializing', 'Initialized']
  let lastBedrockStatus = null

  agent._client.on('status', (status) => {
    if (bot.agent !== agent || status === lastBedrockStatus) return
    lastBedrockStatus = status
    const label = bedrockStatusNames[Number(status)] || 'Unknown'
    pushLog(`${bot.label}: [Bedrock] 通信状態=${label} (${String(status)})`, 'info', bot.id)
  })
  agent._client.on('packet', (packet) => {
    if (bot.agent !== agent) return
    const name = String(packet?.data?.name || packet?.name || '')
    if (!bedrockLifecyclePackets.has(name)) return
    const seen = (bedrockPacketCounts.get(name) || 0) + 1
    bedrockPacketCounts.set(name, seen)
    if (seen > 4) return
    const params = packet?.data?.params || packet?.params || {}
    let detail = ''
    if (name === 'play_status') {
      detail = ' / status=' + String(params.status ?? 'unknown')
    } else if (name === 'network_settings') {
      const algorithmValue = params.compression_algorithm
      const algorithmName = algorithmValue === 'snappy' || algorithmValue === 1 || algorithmValue === '1'
        ? 'snappy'
        : (algorithmValue === 'deflate' || algorithmValue === 0 || algorithmValue === '0'
            ? 'deflate'
            : (algorithmValue === 'none' || algorithmValue === 2 || algorithmValue === 65535 || algorithmValue === '65535'
                ? 'none'
                : 'unknown'))
      const threshold = Number(params.compression_threshold)
      detail = ' / compression=' + algorithmName + ', threshold=' + (Number.isFinite(threshold) ? String(threshold) : 'unknown')
    }
    pushLog(`${bot.label}: [Bedrock] 受信パケット=${name}${detail}`, 'info', bot.id)
  })
  agent._client.on('loggingIn', () => {
    if (bot.agent === agent) pushLog(`${bot.label}: [Bedrock] Loginパケットの送信処理を呼び出しました。`, 'info', bot.id)
  })
  agent._client.on('join', () => {
    if (bot.agent === agent) pushLog(`${bot.label}: [Bedrock] サーバーとの暗号化ハンドシェイクが完了しました。`, 'info', bot.id)
  })

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
  for (const packetName of ['inventory_content', 'inventory_slot', 'inventory_transaction', 'item_stack_response']) {
    agent._client.on(packetName, () => queueBotInventoryPublish(bot, agent))
  }

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
    if (bot.targetType === 'server' && serverProfileId && connectionMethod) {
      const profile = settings.servers.find(item => item.id === serverProfileId)
      if (profile && recordSuccessfulServerConnection(profile, connectionMethod)) {
        const methodLabel = ({ raknet: 'RakNet', 'nethernet-http': 'NetherNet HTTP', 'nethernet-lan': 'NetherNet LAN' })[connectionMethod] || connectionMethod
        saveSettings().then(() => {
          send('servers:updated', publicServerProfiles())
          pushLog(`${bot.label}: 接続成功した方式「${methodLabel}」を接続先設定に保存しました。`, 'success', bot.id)
        }).catch(error => {
          pushLog(`${bot.label}: 成功した接続方式の保存に失敗しました: ${error.message}`, 'warning', bot.id)
        })
      }
    }
    bot.reconnectAttempts = 0
    bot.reconnectStatus = isModuleAssigned(bot.modules, 'connectionManager') ? '接続済み' : '未割り当て'
    setBotStatus(bot, 'connected')
    preparePathfinder(bot)
    publishBotInventory(bot)
    pushLog(`${bot.label}: ワールドにスポーンしました。`, 'success', bot.id)
    reconnectGuestBots(bot).catch(error => {
      writeDiagnosticLog(`[guest-reconnect] parent=${bot.id} ${describeFailure(error)}`)
      pushLog(`${bot.label}: ゲストBotの再参加処理に失敗しました: ${safeErrorMessage(error)}`, 'warning', bot.id)
    })
  })
  agent.on('chat', (username, message) => {
    if (bot.agent !== agent) return
    const sender = String(username || '')
    if (sender && sender === String(agent.username || bot.playerName || '')) return
    recordBotChatMessage(bot, 'incoming', sender, message)
  })
  agent.on('kicked', (reason) => {
    bot.kicked = true
    bot.hadError = true
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
    clearTimeout(bot.inventoryPublishTimer)
    bot.inventoryPublishTimer = null
    send('bot:inventory-updated', { botId: bot.id, items: [], updatedAt: new Date().toISOString() })
    bot.client = null
    bot.agent = null
    bot.connectionStarting = false
    bot.connectionAbortController = null
    bot.pathfinderReady = false
    stopBotModules(bot, '接続終了')
    const finalStatus = bot.hadError ? 'error' : 'disconnected'
    setBotStatus(bot, finalStatus)
    if (!bot.manualDisconnect) pushLog(`${bot.label}: 接続が終了しました。${reason ? ` (${String(reason)})` : ''}`, bot.hadError ? 'warning' : 'info', bot.id)
    scheduleBotReconnect(bot, reason || bot.lastError)
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


async function addGuestBot (parentBotId, input) {
  const parent = bots.get(parentBotId)
  if (!parent) throw new Error('親Botが見つかりません。')
  if (parent.parentBotId) throw new Error('ゲストBotに別のゲストBotを追加することはできません。')
  const guests = Array.from(bots.values()).filter(item => item.parentBotId === parent.id)
  if (guests.length >= MAX_SUB_CLIENTS) throw new Error('1アカウントに追加できるゲストBotは最大3体です。')
  const usedSlots = new Set(guests.map(item => Number(item.subClientId)))
  let subClientId = 1
  while (usedSlots.has(subClientId) && subClientId <= MAX_SUB_CLIENTS) subClientId++
  if (subClientId > MAX_SUB_CLIENTS) throw new Error('空いているSubClient枠がありません。')

  const label = cleanLabel(input?.label)
  if (!label) throw new Error('ゲストBot名は1〜32文字で入力してください。')
  const guest = createBotRecord({
    id: randomUUID(),
    label,
    targetType: parent.targetType,
    targetId: parent.targetId,
    networkId: parent.networkId,
    worldName: parent.worldName,
    parentBotId: parent.id,
    subClientId
  })
  guest.accountStatus = 'shared'
  bots.set(guest.id, guest)
  await saveSettings()
  pushLog(`${guest.label}: ${parent.label}のアカウントにゲストBotとして登録しました (SubClient ${subClientId}/3)。`, 'success', guest.id)
  publishBot(guest)
  publishBot(parent)

  if (parent.status === 'connected' && parent.client && parent.agent) {
    await joinGuestBot(parent, guest)
  }
  return publicBot(guest)
}

async function reconnectGuestBots (parent) {
  if (!parent || parent.parentBotId || parent.status !== 'connected' || !parent.client) return
  const guests = Array.from(bots.values())
    .filter(item => item.parentBotId === parent.id && !item.agent)
    .sort((a, b) => Number(a.subClientId) - Number(b.subClientId))
  for (const guest of guests) {
    try {
      await joinGuestBot(parent, guest)
    } catch (error) {
      guest.hadError = true
      guest.lastError = safeErrorMessage(error)
      setBotStatus(guest, 'error', { lastError: guest.lastError })
      pushLog(`${guest.label}: 親Botへのゲスト接続に失敗しました: ${describeFailure(error)}`, 'warning', guest.id)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

async function joinGuestBot (parent, guest) {
  if (!parent || parent.parentBotId || parent.status !== 'connected' || !parent.client || !parent.agent) {
    throw new Error('先に親Botをワールドに参加させてください。')
  }
  if (guest.agent || guest.client) return publicBot(guest)
  if (guest.parentBotId !== parent.id) throw new Error('親BotとゲストBotの組み合わせが正しくありません。')
  const subClientId = Number(guest.subClientId)
  const tokens = createGuestLoginTokens(parent.client)
  const view = parent.client.createSubClient(subClientId, guest.label)
  let agent
  try {
    agent = mineflayer.createBot({
      edition: 'bedrock',
      version: parent.client.options?.version || MC_VERSION,
      username: guest.label,
      client: view,
      hideErrors: false,
      logErrors: false,
      respawn: true
    })
  } catch (error) {
    view.close('Guest bot creation failed')
    throw error
  }

  guest.agent = agent
  guest.client = view
  guest.connectionStarting = true
  guest.manualDisconnect = false
  guest.hadError = false
  guest.lastError = ''
  guest.playerName = guest.label
  guest.pathfinderReady = false
  guest.movementStatus = '停止中'
  setBotStatus(guest, 'connecting')
  pushLog(`${guest.label}: ${parent.label}の接続を共有してSubClient ${subClientId} に参加します。`, 'info', guest.id)

  agent._client.on('start_game', (packet) => {
    if (guest.agent !== agent) return
    guest.startGameReceived = true
    guest.movementAuthority = packet?.movement_authority == null ? '共有接続' : String(packet.movement_authority)
    guest.lastServerTick = diagnosticValue(packet?.current_tick)
    publishBot(guest)
  })
  agent._client.on('correct_player_move_prediction', (packet) => {
    if (guest.agent !== agent) return
    guest.correctionPackets++
    if (packet?.tick != null) guest.lastServerTick = diagnosticValue(packet.tick)
  })
  agent._client.on('level_chunk', () => { if (guest.agent === agent) guest.levelChunkPackets++ })
  agent._client.on('subchunk', () => { if (guest.agent === agent) guest.subchunkPackets++ })
  for (const packetName of ['inventory_content', 'inventory_slot', 'inventory_transaction', 'item_stack_response']) {
    agent._client.on(packetName, () => queueBotInventoryPublish(guest, agent))
  }

  try {
    agent.loadPlugin(pathfinder)
  } catch (error) {
    view.close('Plugin initialization failed')
    guest.agent = null
    guest.client = null
    guest.connectionStarting = false
    throw error
  }

  agent.on('connect', () => { if (guest.agent === agent) setBotStatus(guest, 'connecting') })
  agent.on('login', () => {
    if (guest.agent !== agent) return
    guest.playerName = agent.username || guest.label
    setBotStatus(guest, 'joining')
    pushLog(`${guest.label}: ゲストプレイヤーのログインが完了しました。`, 'success', guest.id)
  })
  agent.on('spawn', () => {
    if (guest.agent !== agent) return
    guest.connectionStarting = false
    setBotStatus(guest, 'connected')
    preparePathfinder(guest)
    publishBotInventory(guest)
    pushLog(`${guest.label}: ワールドにゲストBotとしてスポーンしました。`, 'success', guest.id)
  })
  agent.on('chat', (username, message) => {
    if (guest.agent !== agent) return
    const sender = String(username || '')
    if (sender && sender === String(agent.username || guest.playerName || '')) return
    recordBotChatMessage(guest, 'incoming', sender, message)
  })
  agent.on('kicked', (reason) => {
    guest.hadError = true
    guest.lastError = String(reason || 'サーバーから切断されました。')
    pushLog(`${guest.label}: ゲスト接続が拒否されました: ${guest.lastError}`, 'warning', guest.id)
  })
  agent.on('error', (error) => {
    if (guest.agent !== agent) return
    guest.hadError = true
    guest.lastError = error?.message || String(error)
    setBotStatus(guest, 'error', { lastError: guest.lastError })
    pushLog(`${guest.label}: ゲスト接続エラー: ${describeFailure(error)}`, 'error', guest.id)
  })
  agent.on('end', (reason) => {
    if (guest.agent !== agent) return
    guest.movementRequestId++
    clearInterval(guest.movementTimer)
    guest.movementTimer = null
    clearTimeout(guest.inventoryPublishTimer)
    guest.inventoryPublishTimer = null
    guest.connectionStarting = false
    send('bot:inventory-updated', { botId: guest.id, items: [], updatedAt: new Date().toISOString() })
    guest.client = null
    guest.agent = null
    guest.pathfinderReady = false
    const finalStatus = guest.hadError ? 'error' : 'disconnected'
    setBotStatus(guest, finalStatus)
    if (!guest.manualDisconnect) pushLog(`${guest.label}: ゲスト接続が終了しました。${reason ? ` (${String(reason)})` : ''}`, guest.hadError ? 'warning' : 'info', guest.id)
  })
  agent.on('move', () => {
    const now = Date.now()
    if (now - guest.lastUiPositionUpdate >= 500) {
      guest.lastUiPositionUpdate = now
      publishBot(guest)
    }
  })
  agent.on('chunkColumnLoad', () => {
    if (guest.agent !== agent) return
    guest.worldColumnsLoaded++
    publishBot(guest)
  })
  agent.on('health', publishBot.bind(null, guest))
  agent.on('food', publishBot.bind(null, guest))
  agent.on('goal_reached', () => {
    if (guest.agent !== agent) return
    guest.movementStatus = '目的地に到着しました'
    publishBot(guest)
    pushLog(`${guest.label}: 指定座標付近に到着しました。`, 'success', guest.id)
  })
  agent.on('path_update', (result) => {
    if (guest.agent !== agent || !String(guest.movementStatus).startsWith('座標移動中')) return
    if (result?.status === 'noPath' || result?.status === 'timeout') {
      guest.movementStatus = '経路を見つけられませんでした'
      publishBot(guest)
      pushLog(`${guest.label}: 目的地までの経路を見つけられませんでした。`, 'warning', guest.id)
    }
  })
  agent.on('blockUpdateError', (_pos, runtimeId) => {
    pushLog(`${guest.label}: 未知のブロックID ${runtimeId} を受信しました。地形データに影響する可能性があります。`, 'warning', guest.id)
  })

  // createBot schedules plugin injection on the next event-loop turn. Send SubClientLogin
  // after its per-session listeners have been registered.
  setTimeout(() => {
    if (guest.agent !== agent || view.closed) return
    try {
      view.login(tokens)
    } catch (error) {
      guest.hadError = true
      guest.lastError = safeErrorMessage(error)
      setBotStatus(guest, 'error', { lastError: guest.lastError })
      view.close('SubClientLogin failed')
    }
  }, 0)
  publishBot(guest)
  return publicBot(guest)
}

function getConnectedAgent (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (!bot.agent || bot.status !== 'connected') throw new Error('Botがワールドに参加していません。')
  return { bot, agent: bot.agent }
}

function recordBotChatMessage (bot, direction, username, message) {
  const entry = {
    id: randomUUID(),
    botId: bot.id,
    at: new Date().toISOString(),
    direction,
    username: String(username || ''),
    message: String(message ?? '').slice(0, 1000)
  }
  bot.chatHistory ||= []
  bot.chatHistory.push(entry)
  if (bot.chatHistory.length > 150) bot.chatHistory.splice(0, bot.chatHistory.length - 150)
  send('bot:chat-message', entry)
  return entry
}

function sendBotChat (botId, rawMessage) {
  const { bot, agent } = getConnectedAgent(botId)
  const message = normalizeChatMessage(rawMessage)
  if (typeof agent.chat !== 'function') throw new Error('このBotではチャット送信が利用できません。')
  agent.chat(message)
  recordBotChatMessage(bot, 'outgoing', bot.playerName || agent.username, message)
  return true
}

function getBotChatHistory (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  return [...(bot.chatHistory || [])]
}

function getBotInventory (botId) {
  const { bot, agent } = getConnectedAgent(botId)
  return {
    botId: bot.id,
    items: createInventorySnapshot(agent),
    updatedAt: new Date().toISOString()
  }
}

function publishBotInventory (bot) {
  const items = bot.agent ? createInventorySnapshot(bot.agent) : []
  const payload = { botId: bot.id, items, updatedAt: new Date().toISOString() }
  send('bot:inventory-updated', payload)
  return payload
}

function queueBotInventoryPublish (bot, agent) {
  if (bot.inventoryPublishTimer) return
  bot.inventoryPublishTimer = setTimeout(() => {
    bot.inventoryPublishTimer = null
    if (bot.agent !== agent) return
    publishBotInventory(bot)
  }, 80)
}

async function tossBotItem (botId, input) {
  const { bot, agent } = getConnectedAgent(botId)
  const request = normalizeDropRequest(input, agent.inventory)
  if (typeof agent.tossStack !== 'function') throw new Error('Bedrock用のアイテム投棄APIが利用できません。')
  await agent.tossStack(request.item, request.count)
  if (bot.agent !== agent) throw new Error('投棄処理中にBotが切断されました。')
  pushLog(`${bot.label}: ${request.item.displayName || request.item.name} x ${request.count} を投げました。`, 'success', bot.id)
  return publishBotInventory(bot)
}

function publishModuleStatus (bot) {
  publishBot(bot)
}

function stopBotItemUse (bot, status = '停止中') {
  clearTimeout(bot.itemUseTimer)
  bot.itemUseTimer = null
  bot.itemUseRunning = false
  bot.itemUseBusy = false
  try { bot.agent?.deactivateItem?.() } catch {}
  bot.itemUseStatus = status
  publishModuleStatus(bot)
}

function stopContainerSupply (bot, status = '停止中') {
  clearTimeout(bot.containerSupplyTimer)
  bot.containerSupplyTimer = null
  bot.containerSupplyRunning = false
  bot.containerSupplyGeneration++
  if (bot.containerSupplyNavigating) {
    try { bot.agent?.pathfinder?.setGoal(null) } catch {}
  }
  bot.containerSupplyNavigating = false
  bot.containerSupplyStatus = status
  publishModuleStatus(bot)
}

function stopBotModules (bot, status = '接続終了') {
  stopBotItemUse(bot, status)
  stopContainerSupply(bot, status)
}

async function updateBotModules (botId, input) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  const next = normalizeBotModules(input)
  if (!next.itemUse.assigned) stopBotItemUse(bot, 'モジュール未割り当て')
  if (!next.containerSupply.assigned) stopContainerSupply(bot, 'モジュール未割り当て')
  if (!next.connectionManager.assigned) {
    clearTimeout(bot.reconnectTimer)
    bot.reconnectTimer = null
    bot.reconnectStatus = '無効'
  } else {
    bot.reconnectStatus = bot.status === 'connected' ? '接続済み' : '待機中'
  }
  bot.modules = next
  await saveSettings()
  publishBot(bot)
  pushLog(bot.label + ': Botモジュール設定を保存しました。', 'success', bot.id)
  return publicBot(bot)
}

async function useBotItemOnce (botId, slot) {
  const { bot, agent } = getConnectedAgent(botId)
  if (!isModuleAssigned(bot.modules, 'itemUse')) throw new Error('このBotにItem Useモジュールが割り当てられていません。')
  if (bot.containerSupplyBusy) throw new Error('Container Supplyがインベントリを操作中です。')
  const index = Number(slot)
  if (!Number.isInteger(index) || index < 9 || index > 44) throw new Error('使用するアイテムのスロットが不正です。')
  const item = agent.inventory?.slots?.[index]
  if (!item || !Number.isInteger(item.count) || item.count < 1) throw new Error('選択したスロットにアイテムがありません。')
  if (typeof agent.equip !== 'function' || typeof agent.activateItem !== 'function' || typeof agent.deactivateItem !== 'function') {
    throw new Error('このBedrockクライアントではアイテム使用APIが利用できません。')
  }
  await agent.equip(item, 'hand')
  if (bot.agent !== agent) throw new Error('アイテムを装備中にBotが切断されました。')
  agent.activateItem()
  bot.itemUseStatus = '使用中: ' + (item.displayName || item.name)
  publishModuleStatus(bot)
  await new Promise(resolve => setTimeout(resolve, 350))
  if (bot.agent === agent) agent.deactivateItem()
  if (bot.agent !== agent) throw new Error('アイテム使用中にBotが切断されました。')
  bot.itemUseStatus = '使用完了: ' + (item.displayName || item.name)
  pushLog(bot.label + ': ' + (item.displayName || item.name) + ' を使用しました。', 'success', bot.id)
  publishBotInventory(bot)
  publishModuleStatus(bot)
  return true
}

async function runItemUseCycle (bot) {
  if (!bot.itemUseRunning || bot.status !== 'connected' || bot.itemUseBusy) return
  bot.itemUseBusy = true
  try {
    await useBotItemOnce(bot.id, bot.itemUseSlot)
  } catch (error) {
    stopBotItemUse(bot, 'エラーで停止')
    pushLog(bot.label + ': Item Useを停止しました: ' + safeErrorMessage(error), 'warning', bot.id)
  } finally {
    bot.itemUseBusy = false
  }
  if (bot.itemUseRunning && bot.status === 'connected') {
    bot.itemUseTimer = setTimeout(() => runItemUseCycle(bot), bot.modules.itemUse.intervalMs)
  }
}

function startBotItemUse (botId, slot) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (!isModuleAssigned(bot.modules, 'itemUse')) throw new Error('先にItem Useモジュールを割り当ててください。')
  const { agent } = getConnectedAgent(botId)
  const index = Number(slot)
  if (!Number.isInteger(index) || index < 9 || index > 44 || !agent.inventory?.slots?.[index]) {
    throw new Error('連続使用するアイテムを選択してください。')
  }
  stopBotItemUse(bot, '再設定')
  bot.itemUseSlot = index
  bot.itemUseRunning = true
  bot.itemUseStatus = '連続使用中'
  pushLog(bot.label + ': Item Useの連続動作を開始しました。', 'info', bot.id)
  runItemUseCycle(bot)
  publishModuleStatus(bot)
  return publicBot(bot)
}

async function supplyContainerOnce (bot) {
  const config = bot.modules.containerSupply
  if (!moduleConfigComplete(config)) throw new Error('Container Supplyの座標・アイテム・目標数を設定してください。')
  const { agent } = getConnectedAgent(bot.id)
  if (!bot.pathfinderReady || typeof agent.pathfinder?.goto !== 'function') throw new Error('経路探索が利用できません。')
  if (bot.movementStatus.startsWith('手動操作中')) throw new Error('手動移動を停止してからContainer Supplyを開始してください。')
  const coordinates = new Vec3(config.x, config.y, config.z)
  const generation = bot.containerSupplyGeneration
  bot.containerSupplyStatus = '補充先へ移動中'
  bot.containerSupplyNavigating = true
  publishModuleStatus(bot)
  try {
    await agent.pathfinder.goto(new goals.GoalNear(config.x, config.y, config.z, 2))
  } finally {
    bot.containerSupplyNavigating = false
  }
  if (!bot.containerSupplyRunning || generation !== bot.containerSupplyGeneration || bot.agent !== agent) return '停止済み'
  const block = agent.blockAt(coordinates)
  if (!block || !block.name || block.name === 'air') throw new Error('指定座標にコンテナが見つかりません。')
  if (typeof agent.openContainer !== 'function') throw new Error('このBedrockクライアントではコンテナ操作APIが利用できません。')
  const window = await agent.openContainer(block)
  try {
    const containerItems = typeof window.containerItems === 'function' ? window.containerItems() : []
    const matchingItems = containerItems.filter(item => item && item.name === config.itemName)
    const currentCount = matchingItems.reduce((total, item) => total + (Number(item.count) || 0), 0)
    const needed = Math.max(0, config.targetCount - currentCount)
    if (needed === 0) return '目標数に到達 (' + currentCount + '/' + config.targetCount + ')'
    const inventoryItems = (agent.inventory?.items?.() || []).filter(item => item && item.name === config.itemName && Number(item.count) > 0)
    const available = inventoryItems.reduce((total, item) => total + item.count, 0)
    if (!available) return 'Botのインベントリに指定アイテムがありません'
    const depositCount = Math.min(needed, available)
    const sourceItem = inventoryItems[0]
    if (typeof window.deposit !== 'function') throw new Error('コンテナへのアイテム投入APIが利用できません。')
    await window.deposit(sourceItem.type, sourceItem.metadata, depositCount, sourceItem.nbt)
    if (bot.agent !== agent) throw new Error('補充処理中にBotが切断されました。')
    const result = available < needed ? '一部補充 (' + depositCount + '個)・在庫不足' : depositCount + '個を補充しました'
    pushLog(bot.label + ': ' + block.name + ' [' + config.x + ', ' + config.y + ', ' + config.z + '] に ' + config.itemName + ' を' + depositCount + '個投入しました。', 'success', bot.id)
    publishBotInventory(bot)
    return result
  } finally {
    try { await window.close?.() } catch {}
  }
}

async function runContainerSupplyCycle (bot) {
  if (!bot.containerSupplyRunning || bot.status !== 'connected' || bot.containerSupplyBusy) return
  bot.containerSupplyBusy = true
  try {
    bot.containerSupplyStatus = await supplyContainerOnce(bot)
    publishModuleStatus(bot)
  } catch (error) {
    bot.containerSupplyStatus = 'エラー: ' + safeErrorMessage(error)
    pushLog(bot.label + ': Container Supply: ' + safeErrorMessage(error), 'warning', bot.id)
    publishModuleStatus(bot)
  } finally {
    bot.containerSupplyBusy = false
  }
  if (bot.containerSupplyRunning && bot.status === 'connected') {
    bot.containerSupplyTimer = setTimeout(() => runContainerSupplyCycle(bot), bot.modules.containerSupply.intervalMs)
  }
}

function startContainerSupply (botId) {
  const bot = bots.get(botId)
  if (!bot) throw new Error('Botが見つかりません。')
  if (!isModuleAssigned(bot.modules, 'containerSupply')) throw new Error('先にContainer Supplyモジュールを割り当ててください。')
  if (!moduleConfigComplete(bot.modules.containerSupply)) throw new Error('補充先のX/Y/Z、アイテム名、目標個数を設定してください。')
  getConnectedAgent(botId)
  stopContainerSupply(bot, '再設定')
  bot.containerSupplyRunning = true
  bot.containerSupplyStatus = '開始準備中'
  pushLog(bot.label + ': Container Supplyを開始しました。', 'info', bot.id)
  runContainerSupplyCycle(bot)
  publishModuleStatus(bot)
  return publicBot(bot)
}

function scheduleBotReconnect (bot, reason) {
  if (bot.manualDisconnect || bot.kicked || !bot.hadError || bot.reconnectTimer) return false
  if (!isModuleAssigned(bot.modules, 'connectionManager')) return false
  const config = bot.modules.connectionManager
  if (bot.reconnectAttempts >= config.maxRetries) {
    bot.reconnectStatus = '再試行上限に到達'
    publishModuleStatus(bot)
    return false
  }
  const errorText = String(reason || bot.lastError || '')
  if (!isTransientDisconnect(errorText)) {
    bot.reconnectStatus = '対象外の切断理由'
    publishModuleStatus(bot)
    return false
  }
  bot.reconnectAttempts++
  const delay = reconnectDelay(bot.reconnectAttempts, config)
  bot.reconnectStatus = bot.reconnectAttempts + '/' + config.maxRetries + '回目を' + Math.ceil(delay / 1000) + '秒後に再試行'
  pushLog(bot.label + ': 一時的な通信切断を検知しました。' + Math.ceil(delay / 1000) + '秒後に再接続します。', 'warning', bot.id)
  publishModuleStatus(bot)
  bot.reconnectTimer = setTimeout(async () => {
    bot.reconnectTimer = null
    if (bot.manualDisconnect || bot.status === 'connected' || bot.connectionStarting) return
    bot.reconnectStatus = '再接続中'
    publishModuleStatus(bot)
    try {
      await connectBot(bot.id, { reconnect: true })
    } catch (error) {
      bot.hadError = true
      bot.lastError = safeErrorMessage(error)
      scheduleBotReconnect(bot, bot.lastError)
    }
  }, delay)
  return true
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
  const removed = bot.parentBotId
    ? [bot]
    : [...Array.from(bots.values()).filter(item => item.parentBotId === bot.id), bot]
  for (const item of removed) {
    if (item.client || item.connectionStarting) {
      try { disconnectBot(item.id) } catch (error) { writeDiagnosticLog(`[remove-bot] ${item.id}: ${error.message}`) }
    }
  }
  for (const item of removed) {
    bots.delete(item.id)
    await fs.rm(path.join(app.getPath('userData'), 'auth', item.id), { recursive: true, force: true })
    send('bot:removed', item.id)
    pushLog(`${item.label}を一覧から削除しました。`, 'info', item.id)
  }
  await saveSettings()
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
  appVersion: APP_VERSION,
  servers: publicServerProfiles(),
  bots: Array.from(bots.values()).map(publicBot),
  logs: logBuffer
}))
ipcMain.handle('bot:add', (_event, input) => publicBot(bots.get(addBot(input).id)))
ipcMain.handle('bot:add-guest', async (_event, args) => addGuestBot(args?.parentBotId, args))
ipcMain.handle('server:add', (_event, input) => {
  const profile = addServerProfile(input)
  return { ...profile }
})
ipcMain.handle('server:add-hive-preset', () => ({ ...addHiveAsiaPreset() }))
ipcMain.handle('server:remove', (_event, serverId) => removeServerProfile(serverId))
ipcMain.handle('server:reset-key', (_event, serverId) => resetServerKey(serverId))
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
ipcMain.handle('bot:send-chat', (_event, args) => sendBotChat(args?.botId, args?.message))
ipcMain.handle('bot:get-chat-history', (_event, botId) => getBotChatHistory(botId))
ipcMain.handle('bot:get-inventory', (_event, botId) => getBotInventory(botId))
ipcMain.handle('bot:toss-item', (_event, args) => tossBotItem(args?.botId, args))
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

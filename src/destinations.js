'use strict'

const { randomUUID } = require('node:crypto')

const DEFAULT_PORT = 19132
const MODES = new Set(['auto', 'http', 'raknet'])
const SERVER_CONNECTION_METHODS = new Set(['raknet', 'nethernet-http', 'nethernet-lan'])
const SERVER_KEY_FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/
const TARGET_TYPES = new Set(['none', 'server', 'friend-world', 'lan-world', 'realm'])

function cleanText (value, max = 64) {
  const text = String(value ?? '').trim()
  return text && text.length <= max ? text : null
}

function validateHost (value) {
  const host = String(value ?? '').trim()
  if (!host || host.length > 253 || /[\s/\\]/.test(host) || host.includes('://')) return null
  return host
}

function validatePort (value) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function normalizeSignallingUrl (value, host, mode) {
  let raw = String(value ?? '').trim()
  // Existing 0.3.0/0.3.1 The Hive profiles only stored host:port. Migrate those
  // profiles to the HTTPS signalling origin confirmed by the endpoint probe.
  if (!raw && mode === 'http' && host.toLowerCase() === 'as.nethernet.playhive.com') {
    raw = 'https://as.nethernet.playhive.com'
  }
  if (!raw) return ''
  let url
  try { url = new URL(raw) } catch { throw new Error('NetherNetシグナリングURLが正しくありません。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('NetherNetシグナリングURLはHTTP(S)のオリジン形式で入力してください。')
  }
  return url.origin
}

function normalizeServerProfile (input) {
  const label = cleanText(input?.label, 48)
  const host = validateHost(input?.host)
  const port = validatePort(input?.port ?? DEFAULT_PORT)
  const mode = MODES.has(input?.mode) ? input.mode : 'auto'
  if (!label) throw new Error('サーバー名は1〜48文字で入力してください。')
  if (!host) throw new Error('ホスト名またはIPアドレスを正しく入力してください。')
  if (!port) throw new Error('ポート番号は1〜65535で入力してください。')
  const signallingUrl = normalizeSignallingUrl(input?.signallingUrl, host, mode)
  const lastSuccessfulMode = SERVER_CONNECTION_METHODS.has(input?.lastSuccessfulMode) ? input.lastSuccessfulMode : ''
  const lastSuccessfulAt = typeof input?.lastSuccessfulAt === 'string' && Number.isFinite(Date.parse(input.lastSuccessfulAt))
    ? new Date(input.lastSuccessfulAt).toISOString()
    : ''
  return { id: randomUUID(), label, host, port, mode, signallingUrl, lastSuccessfulMode, lastSuccessfulAt }
}

function normalizeTarget (input, serverProfiles = []) {
  const type = TARGET_TYPES.has(input?.type) ? input.type : 'none'
  if (type === 'none') return { type: 'none', serverId: '', networkId: '', worldName: '' }
  if (type === 'server') {
    const serverId = String(input?.serverId ?? '')
    if (!serverProfiles.some(server => server.id === serverId)) throw new Error('選択したサーバー設定が見つかりません。')
    return { type, serverId, networkId: '', worldName: '' }
  }
  if (type === 'friend-world') return { type, serverId: '', networkId: '', worldName: '' }
  if (type === 'realm') {
    const realmId = String(input?.realmId ?? input?.serverId ?? '').trim()
    if (realmId && !/^\\d{1,20}$/.test(realmId)) throw new Error('Realms IDが不正です。')
    return { type, serverId: realmId, networkId: '', worldName: cleanText(input?.worldName, 100) || '' }
  }
  const networkId = String(input?.networkId ?? '').trim()
  if (type === 'lan-world' && networkId) {
    if (!/^\d{1,20}$/.test(networkId)) throw new Error('LANワールドのネットワークIDが不正です。')
    return { type, serverId: '', networkId, worldName: cleanText(input?.worldName, 100) || 'LANワールド' }
  }
  return { type, serverId: '', networkId: '', worldName: '' }
}

function legacyServerId (host, port) {
  return `legacy-${Buffer.from(`${String(host).toLowerCase()}:${port}`).toString('hex').slice(0, 40)}`
}

function migrateSettings (parsed) {
  const servers = Array.isArray(parsed?.servers) ? parsed.servers : []
  const normalizedServers = []
  for (const item of servers) {
    try {
      const profile = normalizeServerProfile(item)
      profile.id = typeof item.id === 'string' && item.id ? item.id : profile.id
      if (!normalizedServers.some(entry => entry.id === profile.id)) normalizedServers.push(profile)
    } catch {}
  }

  const bots = []
  const savedBots = Array.isArray(parsed?.bots) ? parsed.bots : []
  for (const item of savedBots) {
    const label = cleanText(item?.label, 32)
    if (!label || typeof item?.id !== 'string' || !item.id) continue
    let target
    if (item.targetType === 'server' && normalizedServers.some(server => server.id === item.targetId)) {
      target = { type: 'server', serverId: item.targetId, networkId: '', worldName: '' }
    } else if (item.targetType === 'friend-world') {
      target = { type: 'friend-world', serverId: '', networkId: '', worldName: '' }
    } else if (item.targetType === 'realm' && (!item.targetId || /^\\d{1,20}$/.test(String(item.targetId)))) {
      target = { type: 'realm', serverId: String(item.targetId || ''), networkId: '', worldName: cleanText(item.worldName, 100) || '' }
    } else if (item.targetType === 'lan-world' && /^\d{1,20}$/.test(String(item.networkId || ''))) {
      target = { type: 'lan-world', serverId: '', networkId: String(item.networkId), worldName: cleanText(item.worldName, 100) || 'LANワールド' }
    } else if (validateHost(item.host) && validatePort(item.port)) {
      const legacyHost = validateHost(item.host)
      const legacyPort = validatePort(item.port)
      const id = legacyServerId(legacyHost, legacyPort)
      let profile = normalizedServers.find(server => server.id === id)
      if (!profile) {
        profile = {
          id,
          label: `${legacyHost}:${legacyPort}`,
          host: legacyHost,
          port: legacyPort,
          mode: 'auto'
        }
        normalizedServers.push(profile)
      }
      target = { type: 'server', serverId: profile.id, networkId: '', worldName: '' }
    } else {
      target = { type: 'none', serverId: '', networkId: '', worldName: '' }
    }
    bots.push({
      id: item.id,
      label,
      targetType: target.type,
      targetId: target.serverId,
      networkId: target.networkId,
      worldName: target.worldName,
      modules: item.modules && typeof item.modules === 'object' ? item.modules : {},
      ...(typeof item.parentBotId === 'string' && item.parentBotId !== item.id && [1, 2, 3].includes(Number(item.subClientId))
        ? { parentBotId: item.parentBotId, subClientId: Number(item.subClientId) }
        : {})
    })
  }

  const trustedServerKeys = {}
  if (parsed?.trustedServerKeys && typeof parsed.trustedServerKeys === 'object' && !Array.isArray(parsed.trustedServerKeys)) {
    for (const [origin, value] of Object.entries(parsed.trustedServerKeys)) {
      let key
      try { key = serverOriginKey(origin) } catch { continue }
      const fingerprints = normalizeTrustedServerKeyFingerprints(value)
      if (!/^https?:\/\//.test(key) || !fingerprints.length) continue
      trustedServerKeys[key] = fingerprints.length === 1 ? fingerprints[0] : fingerprints
    }
  }

  const parentIds = new Set(bots.filter(bot => !bot.parentBotId).map(bot => bot.id))
  const occupiedGuestSlots = new Set()
  const validBots = bots.filter(bot => {
    if (!bot.parentBotId) return true
    const key = `${bot.parentBotId}:${bot.subClientId}`
    if (!parentIds.has(bot.parentBotId) || bot.subClientId < 1 || bot.subClientId > 3 || occupiedGuestSlots.has(key)) return false
    occupiedGuestSlots.add(key)
    return true
  })

  return { servers: normalizedServers, bots: validBots, trustedServerKeys }
}

function serverHttpSignallingOrigin (profile) {
  if (profile?.signallingUrl) return serverOriginKey(profile.signallingUrl)
  const host = String(profile?.host ?? '')
  const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return serverOriginKey(`http://${address}:${profile?.port ?? DEFAULT_PORT}`)
}

function serverOriginKey (origin) {
  try { return new URL(origin).origin.toLowerCase() } catch { throw new Error('サーバー鍵の接続元URLが不正です。') }
}

function normalizeTrustedServerKeyFingerprints (value) {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter(item => typeof item === 'string' && SERVER_KEY_FINGERPRINT_RE.test(item)))]
}

function getTrustedServerKeyFingerprints (trustedServerKeys, origin) {
  if (!trustedServerKeys || typeof trustedServerKeys !== 'object' || Array.isArray(trustedServerKeys)) return []
  return normalizeTrustedServerKeyFingerprints(trustedServerKeys[serverOriginKey(origin)])
}

function addTrustedServerKey (trustedServerKeys, origin, fingerprint) {
  if (!trustedServerKeys || typeof trustedServerKeys !== 'object' || Array.isArray(trustedServerKeys)) {
    throw new Error('保存済みサーバー鍵の設定が不正です。')
  }
  if (typeof fingerprint !== 'string' || !SERVER_KEY_FINGERPRINT_RE.test(fingerprint)) {
    throw new Error('サーバー公開鍵の指紋形式が正しくありません。')
  }
  const key = serverOriginKey(origin)
  const fingerprints = normalizeTrustedServerKeyFingerprints(trustedServerKeys[key])
  if (fingerprints.includes(fingerprint)) return false
  fingerprints.push(fingerprint)
  trustedServerKeys[key] = fingerprints.length === 1 ? fingerprints[0] : fingerprints
  return true
}

function recordSuccessfulServerConnection (profile, method, connectedAt = new Date().toISOString()) {
  if (!profile || typeof profile !== 'object' || !SERVER_CONNECTION_METHODS.has(method)) return false
  const timestamp = Date.parse(connectedAt)
  if (!Number.isFinite(timestamp)) return false
  profile.lastSuccessfulMode = method
  profile.lastSuccessfulAt = new Date(timestamp).toISOString()
  return true
}

function resetTrustedServerKey (trustedServerKeys, origin) {
  if (!trustedServerKeys || typeof trustedServerKeys !== 'object' || Array.isArray(trustedServerKeys)) {
    throw new Error('保存済みサーバー鍵の設定が不正です。')
  }
  const key = serverOriginKey(origin)
  if (!Object.prototype.hasOwnProperty.call(trustedServerKeys, key)) return false
  delete trustedServerKeys[key]
  return true
}

module.exports = {
  DEFAULT_PORT,
  MODES,
  TARGET_TYPES,
  validateHost,
  validatePort,
  normalizeServerProfile,
  normalizeTarget,
  migrateSettings,
  legacyServerId,
  normalizeSignallingUrl,
  serverHttpSignallingOrigin,
  serverOriginKey,
  normalizeTrustedServerKeyFingerprints,
  getTrustedServerKeyFingerprints,
  addTrustedServerKey,
  recordSuccessfulServerConnection,
  resetTrustedServerKey
}

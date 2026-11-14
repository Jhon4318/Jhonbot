'use strict'

const { EventEmitter } = require('node:events')
const path = require('node:path')

const MAX_SUB_CLIENTS = 3
const CLIENT_STATUS = Object.freeze({ DISCONNECTED: 0, INITIALIZING: 3, INITIALIZED: 4 })

function readVarUint32 (buffer) {
  let value = 0
  let shift = 0
  let offset = 0
  while (offset < buffer.length && offset < 5) {
    const byte = buffer[offset++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset }
    shift += 7
  }
  return null
}

function writeVarUint32 (value) {
  let current = Number(value) >>> 0
  const bytes = []
  do {
    let byte = current & 0x7f
    current >>>= 7
    if (current !== 0) byte |= 0x80
    bytes.push(byte)
  } while (current !== 0)
  return Buffer.from(bytes)
}

function decodeSubClientHeader (packet) {
  if (!Buffer.isBuffer(packet) || packet.length === 0) return null
  const decoded = readVarUint32(packet)
  if (!decoded || decoded.value > 0x3fff) return null
  return {
    packetId: decoded.value & 0x3ff,
    recipient: (decoded.value >>> 10) & 3,
    sender: (decoded.value >>> 12) & 3,
    bodyOffset: decoded.offset
  }
}

function rewriteSubClientHeader (packet, recipient, sender) {
  const header = decodeSubClientHeader(packet)
  if (!header) throw new Error('Bedrockパケットヘッダーを読み取れません。')
  if (!Number.isInteger(recipient) || recipient < 0 || recipient > 3 ||
      !Number.isInteger(sender) || sender < 0 || sender > 3) {
    throw new Error('SubClient番号が不正です。')
  }
  const value = (header.packetId & 0x3ff) | ((recipient & 3) << 10) | ((sender & 3) << 12)
  return Buffer.concat([writeVarUint32(value), packet.subarray(header.bodyOffset)])
}

function normalizeSubClientPacket (packet, packetId) {
  const header = decodeSubClientHeader(packet)
  if (!header) throw new Error('Bedrockパケットヘッダーを読み取れません。')
  return Buffer.concat([writeVarUint32(packetId), packet.subarray(header.bodyOffset)])
}

function resolveJwt () {
  const bedrockEntry = require.resolve('bedrock-protocol')
  return require(require.resolve('jsonwebtoken', { paths: [path.dirname(bedrockEntry)] }))
}

function decodeJwtPayload (jwt, label, jwtLib) {
  if (typeof jwt !== 'string' || !jwt) throw new Error(`${label}がありません。親Botの認証状態を確認してください。`)
  const payload = jwtLib.decode(jwt)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${label}を読み取れません。`)
  return payload
}

function createGuestLoginTokens (parentClient) {
  const jwt = resolveJwt()
  const tokenPayload = decodeJwtPayload(parentClient.multiplayerToken, 'Xbox Multiplayer Token', jwt)
  const primaryPlayFabId = tokenPayload.mid
  if (typeof primaryPlayFabId !== 'string' || !primaryPlayFabId) {
    throw new Error('親アカウントのMultiplayer Tokenにmidがありません。SubClientログインを作成できません。')
  }

  const clientClaims = decodeJwtPayload(parentClient.clientUserChain, 'ClientData JWT', jwt)
  if (!parentClient.ecdhKeyPair?.privateKey || !parentClient.clientX509) {
    throw new Error('親アカウントの署名鍵がまだ準備できていません。')
  }

  // Tsukuyomi GuestLogin::fromGameと同じ処理:
  // 親のClientDataを引き継ぎ、PrimaryPlayFabIdを追加して同じES384鍵で署名する。
  clientClaims.PrimaryPlayFabId = primaryPlayFabId
  const client = jwt.sign(clientClaims, parentClient.ecdhKeyPair.privateKey, {
    algorithm: 'ES384',
    header: { x5u: parentClient.clientX509, typ: undefined },
    noTimestamp: true
  })

  const chain = [
    parentClient.clientIdentityChain,
    ...(Array.isArray(parentClient.accessToken) ? parentClient.accessToken : [])
  ].filter(value => typeof value === 'string' && value)
  if (!chain.length) throw new Error('親アカウントの認証チェーンがありません。')

  const identity = JSON.stringify({
    Certificate: JSON.stringify({ chain }),
    AuthenticationType: 1,
    Token: parentClient.multiplayerToken
  })
  return { identity, client }
}

class SubClientView extends EventEmitter {
  constructor (parent, subClientId, label) {
    super()
    this.parent = parent
    this.subClientId = subClientId
    this.label = label
    this.options = parent.options
    this.profile = parent.profile ? { ...parent.profile, name: label } : { name: label }
    this.username = label
    this.bedrock = true
    this.wait_connect = false
    this.connection = parent.connection
    this.status = CLIENT_STATUS.INITIALIZING
    this.startGameData = {}
    this.closed = false
    this._initSent = false
  }

  get entityId () { return this.startGameData.runtime_entity_id }

  versionLessThan (version) { return this.parent.versionLessThan(version) }
  versionGreaterThan (version) { return this.parent.versionGreaterThan(version) }
  versionGreaterThanOrEqualTo (version) { return this.parent.versionGreaterThanOrEqualTo(version) }
  versionLessThanOrEqualTo (version) { return this.parent.versionLessThanOrEqualTo(version) }

  write (name, params) {
    if (this.closed) return
    return this.parent.sendSubClientPacket(this.subClientId, name, params, true)
  }

  queue (name, params) {
    if (this.closed) return
    return this.parent.sendSubClientPacket(this.subClientId, name, params, false)
  }

  login (tokens) {
    if (this.closed) throw new Error('SubClientはすでに切断されています。')
    const packet = this.parent.serializer.createPacketBuffer({
      name: 'sub_client_login',
      params: { tokens }
    })
    const framed = rewriteSubClientHeader(packet, 0, this.subClientId)
    // Login is sent immediately so the server can establish this logical player session.
    this.parent.sendBuffer(framed, true)
  }

  readPacket (packet) {
    if (this.closed) return
    let decoded
    try {
      decoded = this.parent.deserializer.parsePacketBuffer(packet)
    } catch (error) {
      this.emit('error', error)
      return
    }

    const name = decoded?.data?.name
    const params = decoded?.data?.params
    if (!name) return
    this.emit('packet', decoded)

    if (name === 'start_game') {
      this.startGameData = params || {}
      if (Array.isArray(params?.itemstates)) this.parent.updateItemPalette(params.itemstates)
      // Guest sessions need their own chunk subscription; Tsukuyomi requests radius 4 per seat.
      this.queue('request_chunk_radius', { chunk_radius: 4, max_radius: 4 })
    }

    if (name === 'disconnect') {
      this.emit(name, params)
      this.emit('kick', params || { message: 'サーバーから切断されました。' })
      this.close(params?.message || 'server disconnect')
      return
    }

    if (name === 'play_status') {
      const status = params?.status
      if (status === 0 || status === 'login_success') {
        this.emit('connect')
      } else if (status === 3 || status === 'player_spawn') {
        this.status = CLIENT_STATUS.INITIALIZED
        const initialize = () => {
          if (this.closed || this._initSent || this.entityId == null) return
          this._initSent = true
          this.queue('set_local_player_as_initialized', { runtime_entity_id: this.entityId })
          if ((this.options?.protocolVersion || 0) >= 2168) {
            this.queue('serverbound_loading_screen', { type: 1 })
            this.queue('client_camera_aim_assist', { preset_id: '', action: 'clear', allow_aim_assist: false })
            this.queue('serverbound_loading_screen', { type: 2 })
          }
          this.emit('spawn')
        }
        if (this.entityId == null) this.once('start_game', initialize)
        else initialize()
      } else {
        this.emit(name, params)
        this.emit('kick', { message: `SubClientのログインに失敗しました (PlayStatus: ${String(status)})`, status })
        this.close(`PlayStatus ${String(status)}`)
        return
      }
    }

    this.emit(name, params)
  }

  disconnect (reason = 'Bot leaving') {
    if (this.closed) return
    try {
      this.write('disconnect', {
        hide_disconnect_screen: true,
        message: reason,
        filtered_message: ''
      })
    } catch {}
    this.close(reason)
  }

  end (reason = 'Bot leaving') { this.disconnect(reason) }

  close (reason = 'SubClient closed') {
    if (this.closed) return
    this.closed = true
    this.status = CLIENT_STATUS.DISCONNECTED
    this.parent.__jhonSubClients?.delete(this.subClientId)
    this.emit('close', reason)
    this.removeAllListeners()
  }
}

function installSubClientSupport (parent) {
  if (parent.__jhonSubClientSupport || parent.__jhonSubClientSupportPending) return parent
  if (typeof parent.sendBuffer !== 'function' || typeof parent.readPacket !== 'function') {
    throw new Error('Bedrock通信クライアントにSubClient用の送受信機能がありません。')
  }

  // bedrock-protocol creates world/friend clients with delayedInit. In that path,
  // createBot() returns before Client.init() has created its serializer and
  // deserializer. Wait for connect_allowed, which is emitted after init has
  // completed them, instead of aborting the primary Bot connection.
  if (!parent.serializer || !parent.deserializer) {
    if (typeof parent.once !== 'function') {
      throw new Error('Bedrock通信クライアントの初期化完了イベントを待機できません。')
    }
    parent.__jhonSubClientSupportPending = true
    parent.once('connect_allowed', () => {
      parent.__jhonSubClientSupportPending = false
      installSubClientSupport(parent)
    })
    parent.once('close', () => {
      parent.__jhonSubClientSupportPending = false
    })
    return parent
  }

  const originalReadPacket = parent.readPacket.bind(parent)
  parent.__jhonSubClients = new Map()
  parent.__jhonSubClientSupport = true

  parent.sendSubClientPacket = (subClientId, name, params, immediate = false) => {
    if (!Number.isInteger(subClientId) || subClientId < 1 || subClientId > MAX_SUB_CLIENTS) {
      throw new Error('SubClient番号は1〜3で指定してください。')
    }
    const packet = parent.serializer.createPacketBuffer({ name, params })
    parent.sendBuffer(rewriteSubClientHeader(packet, 0, subClientId), immediate)
  }

  parent.createSubClient = (subClientId, label) => {
    if (!Number.isInteger(subClientId) || subClientId < 1 || subClientId > MAX_SUB_CLIENTS) {
      throw new Error('SubClient番号は1〜3で指定してください。')
    }
    if (parent.__jhonSubClients.has(subClientId)) {
      throw new Error(`SubClient ${subClientId} はすでに使用中です。`)
    }
    const view = new SubClientView(parent, subClientId, String(label || `Guest-${subClientId}`))
    parent.__jhonSubClients.set(subClientId, view)
    return view
  }

  parent.readPacket = (packet) => {
    const header = decodeSubClientHeader(packet)
    if (!header) return originalReadPacket(packet)
    const normalized = normalizeSubClientPacket(packet, header.packetId)
    if (header.recipient === 0) return originalReadPacket(normalized)
    const subClient = parent.__jhonSubClients.get(header.recipient)
    if (subClient) subClient.readPacket(normalized)
  }

  parent.once('close', () => {
    for (const view of Array.from(parent.__jhonSubClients.values())) view.close('親アカウントの接続が終了しました。')
    parent.__jhonSubClients.clear()
  })

  return parent
}

module.exports = {
  MAX_SUB_CLIENTS,
  SubClientView,
  readVarUint32,
  writeVarUint32,
  decodeSubClientHeader,
  rewriteSubClientHeader,
  createGuestLoginTokens,
  installSubClientSupport
}

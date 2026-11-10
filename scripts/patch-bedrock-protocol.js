'use strict'

// Keep the experimental NetherNet paths safe and reproducible on Windows:
// 1) use pure-JS RakNet for discovery;
// 2) include the actual Minecraft services issuer in the SDP identity assertion;
// 3) preserve the server's HTTP error body for actionable diagnostics;
// 4) configure and log Xbox-friend-world WebRTC connection deadlines.

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { patchSdpIdentitySource } = require('./patch-nethernet-sdp')

const EXPECTED_VERSION = '3.60.1'
const EXPECTED_NETHERNET_VERSION = '1.1.2'

const SNAPPY_COMPRESS_ORIGINAL = "case 'snappy': throw Error('Snappy compression not implemented')"
const SNAPPY_COMPRESS_REPLACEMENT = "case 'snappy': return require('snappyjs').compress(buffer) // BEDROCK_BOT_CONSOLE_SNAPPY_COMPRESS"
const SNAPPY_COMPRESS_MARKER = 'BEDROCK_BOT_CONSOLE_SNAPPY_COMPRESS'
const SNAPPY_DECOMPRESS_ORIGINAL = [
  '      case 1:',
  "      case 'snappy':",
  "        throw Error('Snappy compression not implemented')"
].join('\n')
const SNAPPY_DECOMPRESS_REPLACEMENT = [
  '      case 1:',
  "      case 'snappy':",
  "        return require('snappyjs').uncompress(buffer) // BEDROCK_BOT_CONSOLE_SNAPPY_DECOMPRESS"
].join('\n')
const SNAPPY_DECOMPRESS_MARKER = 'BEDROCK_BOT_CONSOLE_SNAPPY_DECOMPRESS'

const ORIGINAL = "const { RakClient } = initRaknet('raknet-native')"
const REPLACEMENT = "const { RakClient } = initRaknet('jsp-raknet') // BEDROCK_BOT_CONSOLE_PURE_JS_RAKNET"
const MARKER = 'BEDROCK_BOT_CONSOLE_PURE_JS_RAKNET'

const IDENTITY_ORIGINAL = `this.connection.nethernet.identity = {
          privateKey: this.ecdhKeyPair.privateKey,
          token: this.multiplayerToken
        }`
const IDENTITY_REPLACEMENT = `this.connection.nethernet.identity = {
          privateKey: this.ecdhKeyPair.privateKey,
          token: this.multiplayerToken,
          domain: 'https://authorization.franchise.minecraft-services.net/'
        } // BEDROCK_BOT_CONSOLE_MCS_IDP_DOMAIN`
const IDENTITY_MARKER = 'BEDROCK_BOT_CONSOLE_MCS_IDP_DOMAIN'
const IDENTITY_PREVIOUS_DOMAIN = "domain: 'https://authorization.franchise.minecraft-services.net'"

const HTTP_ERROR_ORIGINAL = '  if (!response.ok) throw new Error(`Nethernet HTTP signalling returned ${response.status}`)'
const HTTP_ERROR_REPLACEMENT = [
  '  if (!response.ok) {',
  '    // Never include the SDP request body; it may contain authentication material.',
  "    const responseBody = (await response.text()).trim().replace(/\\s+/g, ' ').slice(0, 600)", 
  "    const contentType = response.headers.get('content-type') || ''",
  "    const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || ''",
  '    const details = [',
  "      contentType ? 'content-type=' + contentType : '',",
  "      requestId ? 'request-id=' + requestId : '',",
  "      responseBody ? 'body=' + responseBody : ''",
  "    ].filter(Boolean).join('; ')",
  "    throw new Error('Nethernet HTTP signalling returned ' + response.status + (details ? ' (' + details + ')' : ''))",
  '  } // BEDROCK_BOT_CONSOLE_HTTP_ERROR_BODY'
].join('\n')
const HTTP_ERROR_MARKER = 'BEDROCK_BOT_CONSOLE_HTTP_ERROR_BODY'

const CLIENT_SERVICES_SIGNAL_ORIGINAL = [
  '        this.nethernet.signalling.connect()',
  '          .then(() => { if (!this._closed) this._connect(sessionData) })',
  '          .catch(error => this.onConnectionError(error))'
].join('\n')
const CLIENT_SERVICES_SIGNAL_MARKER = 'BEDROCK_BOT_CONSOLE_FRIEND_WORLD_SIGNAL_DIAGNOSTICS'
const CLIENT_SERVICES_SIGNAL_OPTIONS_ORIGINAL = '          { protocol: this.options.nethernet._signallingProtocol, host: this.options.nethernet._signallingHost, timeout: this.options.nethernet.signallingConnectTimeout }'
const CLIENT_SERVICES_SIGNAL_OPTIONS_MARKER = 'BEDROCK_BOT_CONSOLE_FRIEND_WORLD_SIGNAL_OPTIONS'

const CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL = "  // Select the connection that advertises a NetherNet id. The ConnectionType value for NetherNet is not stable across\n  // client versions (a live 1.26.51 host advertises 7, this code assumed 3), so match on the NetherNetId itself.\n  const networkId = session.current.properties?.custom?.SupportedConnections?.find(e => e.NetherNetId)?.NetherNetId\n\n  if (!networkId) throw Error('Couldn\\'t find a Nethernet ID to connect to.')\n\n  await session.setActivity()\n  options.nethernet.networkId = BigInt(networkId)"
const CLIENT_WORLD_CONNECTION_SELECTION_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_CONNECTIONTYPE_ROUTING'

const NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_ORIGINAL = [
  '    this.host = options.host || null',
  '    this.timeout = options.timeout ?? 15000'
].join('\n')
const NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL = '  connect () {'
const NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_ORIGINAL = "    debug('Connected to Signal')"
const NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_ORIGINAL = '    debug(' + String.fromCharCode(96) + 'Signal Disconnected with code ${code} and reason ${reason}' + String.fromCharCode(96) + ')'
const NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_ORIGINAL = '    const message = parseJson(res)'
const NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_ORIGINAL = [
  '    this.credentials = parseTurnAuth(result)',
  "    this.emit('credentials', this.credentials)"
].join('\n')
const NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_ORIGINAL = [
  '        this.credentials = parseTurnServers(message.Message)',
  "        this.emit('credentials', this.credentials)"
].join('\n')
const NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_ORIGINAL = [
  '        const signal = parseSignalMessage(message.Message)',
  '        if (!signal) {',
  "          debug('Could not parse signal', message.Message)",
  '          return',
  '        }',
  '        signal.networkId = String(message.From)',
  "        this.emit('signal', signal)"
].join('\n')
const NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_ORIGINAL = [
  '      const items = Array.isArray(message.params) ? message.params : [message.params]',
  '      for (const item of items) {',
  '        const signal = parseJsonRpcReceiveItem(item)',
  "        if (signal) this.emit('signal', signal)",
  '      }'
].join('\n')
const NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_ORIGINAL = [
  "    debug('Sending Signal', signal.type)",
  '',
  '    this.ws.send(message)'
].join('\n')

const NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_OPTIONS'
const NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_METHOD'
const NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_OPEN'
const NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_CLOSE'
const NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_MESSAGE'
const NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_TURN_AUTH'
const NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS'
const NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL'
const NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL'
const NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_MARKER = 'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_WRITE'

const NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_ORIGINAL = [
  '    if (signal.connectionId?.toString() !== this.connectionId.toString()) {',
  "      debug('Ignoring signal for unexpected connection:', signal.connectionId)",
  '      return false',
  '    }'
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_ORIGINAL = [
  '    if (signal.networkId != null && signal.networkId.toString() !== this.serverNetworkId.toString()) {',
  "      debug('Ignoring signal from unexpected network:', signal.networkId)",
  '      return false',
  '    }'
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_ORIGINAL = "    const reliableChannel = rtcConnection.createDataChannel('ReliableDataChannel', { ordered: true })"
const NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_ICE_GATHERING'
const NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_UNEXPECTED_CONNECTION'
const NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_UNEXPECTED_NETWORK'
const CLIENT_CONNECTED_ORIGINAL = [
  '    this.connection.onConnected = () => {',
  '      this.status = ClientStatus.Connecting'
].join('\n')
const CLIENT_CONNECTED_MARKER = 'BEDROCK_BOT_CONSOLE_FRIEND_WORLD_TRANSPORT_CONNECTED'
const CLIENT_TIMEOUT_ORIGINAL = [
  '    this.connectTimeout = setTimeout(() => {',
  '      if (this.status === ClientStatus.Disconnected) {',
  "        this.onConnectionError(Error('Connect timed out'))",
  '      }',
  '    }, this.options.connectTimeout || 9000)'
].join('\n')
const CLIENT_TIMEOUT_MARKER = 'BEDROCK_BOT_CONSOLE_FRIEND_WORLD_TIMEOUT_DIAGNOSTICS'

const NETHERNET_OPTIONS_ORIGINAL = [
  '        webrtcBackend: options.webrtcBackend,',
  "        ...(options.signalling === 'http' && {",
  '          http: { url: signallingUrl({ ...options, nethernet: options }), serverKey: options.serverKey, onServerKey: options.onServerKey },',
  '          responseTimeoutMs: options.signallingConnectTimeout',
  '        })'
].join('\n')
const NETHERNET_OPTIONS_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_TIMEOUT_OPTIONS'
const NETHERNET_SEND_RELIABLE_ORIGINAL = [
  '  sendReliable (data) {',
  '    this.nethernet.send(data)',
  '  }'
].join('\n')
const NETHERNET_SEND_RELIABLE_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_SEND_RELIABLE_RETURN'

const NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL = '    this.webrtc = getWebRTC(options.webrtcBackend)'
const NETHERNET_CLIENT_SEND_ORIGINAL = [
  '  send (buffer) {',
  '    if (!this.connection) {',
  "      throw new Error('Connection is not open')",
  '    }',
  '',
  '    this.connection.send(buffer)',
  '  }'
].join('\n')
const NETHERNET_CLIENT_SEND_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_CLIENT_SEND_RETURN'
const NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL = '  reportError (error) {'
const NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_ORIGINAL = [
  '    this._negotiationTimeout = setTimeout(() => {',
  '      this.failNegotiation(this.serverNetworkId, code)',
  '    }, timeoutMs)'
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_ORIGINAL = [
  '      await rtcConnection.setRemoteDescription(answer)',
  '      if (this._closed || this.rtcConnection !== rtcConnection) return',
  "      debug('Set remote description (answer)')"
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_ORIGINAL = [
  '      const state = rtcConnection.connectionState',
  "      debug('Client connection state changed:', state)"
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_ORIGINAL = [
  '      const state = rtcConnection.iceConnectionState',
  "      debug('Client ICE state changed:', state)"
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_ORIGINAL = [
  '      await rtcConnection.setLocalDescription(offer)',
  '      if (!isCurrent()) return'
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_ORIGINAL = [
  '    rtcConnection.onicecandidate = (event) => {',
  '      if (!this.http && event.candidate && isCurrent()) {',
  "        debug('Sending CandidateAdd to networkId:', this.serverNetworkId)",
  '        const signal = new SignalStructure(SignalType.CandidateAdd, this.connectionId, event.candidate.candidate, this.serverNetworkId)',
  '',
  '        this._signalHandler(signal)',
  '      }',
  '    }'
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_CANDIDATE_ORDER'
const NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL = [
  '      this._signalHandler(',
  '        new SignalStructure(SignalType.ConnectRequest, this.connectionId, sdp, this.serverNetworkId)',
  '      )'
].join('\n')
const NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL = '    this._signalHandler(new SignalStructure(SignalType.ConnectError, this.connectionId, String(code), networkId))'
const NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL = [
  '    switch (signal.type) {',
  '      case SignalType.ConnectResponse:',
  '        this.handleAnswer(signal)',
  '        break',
  '      case SignalType.CandidateAdd:',
  '        this.handleCandidate(signal)',
  '        break',
  '      case SignalType.ConnectError:',
  '        this.connection?.close(' + String.fromCharCode(96) + 'connecterror:${signal.data}' + String.fromCharCode(96) + ')',
  '        break',
  '    }'
].join('\n')

const NETHERNET_CLIENT_DIAGNOSTIC_OPTION_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_OPTION'
const NETHERNET_CLIENT_DIAGNOSTIC_METHOD_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_METHOD'
const NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_TIMEOUT'
const NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_ANSWER'
const NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_CONNECTION_STATE'
const NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_ICE_STATE'
const NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_LOCAL_DESCRIPTION'
const NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_CONNECT_REQUEST'
const NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_SIGNAL_ERROR'
const NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_HANDLE_SIGNAL'

const NETHERNET_CONNECTION_RELIABLE_CHANNELS_ORIGINAL = [
  '      this.reliable.onopen = () => {',
  '        this.flushQueue()',
  '      }',
  '',
  '      this.reliable.onclose = () => {',
  "        this.notifyClosed('disconnected')",
  '      }',
  '',
  '      this.reliable.onerror = () => {',
  "        this.notifyClosed('disconnected')",
  '      }'
].join('\n')
const NETHERNET_CONNECTION_RELIABLE_CHANNELS_MARKER = 'BEDROCK_BOT_CONSOLE_RELIABLE_CHANNEL_DIAGNOSTICS'
const NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_ORIGINAL = [
  '      this.unreliable.onclose = () => {',
  "        this.notifyClosed('disconnected')",
  '      }',
  '',
  '      this.unreliable.onerror = () => {',
  "        this.notifyClosed('disconnected')",
  '      }'
].join('\n')
const NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_MARKER = 'BEDROCK_BOT_CONSOLE_UNRELIABLE_CHANNEL_DIAGNOSTICS'
const NETHERNET_CONNECTION_RECEIVE_ORIGINAL = [
  "    this.nethernet.emit('encapsulated', this.buf, this.address)",
  '    this.buf = null'
].join('\n')
const NETHERNET_CONNECTION_RECEIVE_MARKER = 'BEDROCK_BOT_CONSOLE_RELIABLE_PAYLOAD_DIAGNOSTICS'

const BEDROCK_CONNECTION_WRITE_ORIGINAL = [
  '  write (name, params) {',
  '    this.outLog?.(name, params)',
  '    this._processOutbound(name, params)',
  '    const batch = new Framer(this)',
  '    const packet = this.serializer.createPacketBuffer({ name, params })',
  '    batch.addEncodedPacket(packet)',
  '',
  '    if (this.encryptionEnabled) {',
  '      this.sendEncryptedBatch(batch)',
  '    } else {',
  '      this.sendDecryptedBatch(batch)',
  '    }',
  '  }'
].join('\n')
const BEDROCK_CONNECTION_WRITE_MARKER = 'BEDROCK_BOT_CONSOLE_BEDROCK_OUTBOUND_PACKET_DIAGNOSTICS'
const BEDROCK_CONNECTION_SEND_MCPE_ORIGINAL = [
  '  sendMCPE (buffer, immediate) {',
  '    if (this.connection.connected === false || this.status === ClientStatus.Disconnected) return',
  '    try {',
  '      this.connection.sendReliable(buffer, immediate)',
  '    } catch (e) {',
  "      debug('while sending to', this.connection, e)",
  '    }',
  '  }'
].join('\n')
const BEDROCK_CONNECTION_SEND_MCPE_MARKER = 'BEDROCK_BOT_CONSOLE_NETHERNET_HANDSHAKE_SEND_RESULT'

const VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL = "  const key = crypto.createPublicKey({ key: claims?.cpk, format: 'jwk' })"
const VERIFY_SERVER_IDENTITY_PUBLIC_KEY_MARKER = 'BEDROCK_BOT_CONSOLE_CPK_PUBLIC_KEY_FORMAT'
const VERIFY_SERVER_IDENTITY_PUBLIC_KEY_REPLACEMENT = [
  '  const cpk = claims?.cpk',
  '  let key',
  '  if (typeof cpk === \'string\') {',
  '    const encoded = cpk.trim()',
  '    if (encoded.startsWith(\'-----BEGIN PUBLIC KEY-----\')) {',
  '      key = crypto.createPublicKey(encoded)',
  '    } else {',
  '      const compact = encoded.replace(/\\s+/g, \'\')',
  '      const der = Buffer.from(compact, \'base64\')',
  '      const supplied = compact.replace(/=+$/, \'\')',
  '      const standard = der.toString(\'base64\').replace(/=+$/, \'\')',
  '      const urlSafe = der.toString(\'base64url\')',
  '      if (!der.length || (supplied !== standard && supplied !== urlSafe)) {',
  '        throw new Error(\'Invalid Nethernet server identity public key encoding\')',
  '      }',
  '      try {',
  '        key = crypto.createPublicKey({ key: der, format: \'der\', type: \'spki\' })',
  '      } catch {',
  '        throw new Error(\'Invalid Nethernet server identity public key encoding\')',
  '      }',
  '    }',
  '  } else if (cpk && typeof cpk === \'object\' && !Array.isArray(cpk)) {',
  '    key = crypto.createPublicKey({ key: cpk, format: \'jwk\' })',
  '  } else {',
  '    throw new Error(\'Unsupported Nethernet server identity public key format\')',
  '  }',
  '  if (key.asymmetricKeyType !== \'ec\') {',
  '    throw new Error(\'Nethernet server identity public key must be an EC key\')',
  '  } // BEDROCK_BOT_CONSOLE_CPK_PUBLIC_KEY_FORMAT'
].join('\n')


const OFFER_DIAGNOSTIC_HELPER_MARKER = 'BEDROCK_BOT_CONSOLE_OFFER_DIAGNOSTIC_HELPER'
const OFFER_DIAGNOSTIC_LOG_MARKER = 'BEDROCK_BOT_CONSOLE_OFFER_DIAGNOSTIC_LOG'
const OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL = 'async function exchangeOffer (client, signal) {'
const OFFER_DIAGNOSTIC_FETCH_ORIGINAL = '  const response = await fetch(new URL(`/v1/join/${client.networkId}`, url), {'

const OFFER_HTTP_FETCH_BLOCK_MARKER = 'BEDROCK_BOT_CONSOLE_HTTP_FETCH_TIMEOUT_DIAG'
const OFFER_HTTP_FETCH_BLOCK_ORIGINAL = [
  "  const response = await fetch(new URL(`/v1/join/${client.networkId}`, url), {",
  "    method: 'POST', headers: { 'content-type': 'application/sdp' }, body, signal, redirect: 'error'",
  '  })'
].join('\n')
const OFFER_HTTP_FETCH_BLOCK_REPLACEMENT = [
  '  const requestTimeoutMs = Number.isFinite(client.responseTimeoutMs) && client.responseTimeoutMs > 0 ? client.responseTimeoutMs : 30000',
  '  const requestDeadline = AbortSignal.timeout(requestTimeoutMs)',
  '  const requestSignal = signal ? AbortSignal.any([signal, requestDeadline]) : requestDeadline',
  '  const requestStartedAt = Date.now()',
  '  let response',
  '  try {',
  "    response = await fetch(new URL(`/v1/join/${client.networkId}`, url), {",
  "      method: 'POST', headers: { 'content-type': 'application/sdp' }, body, signal: requestSignal, redirect: 'error'",
  '    })',
  "    console.info('[bedrock-bot-console] NETHERNET_HTTP_DIAG ' + JSON.stringify({",
  "      phase: 'http-post-response',",
  '      status: response.status,',
  '      ok: response.ok,',
  '      elapsedMs: Date.now() - requestStartedAt,',
  "      contentType: response.headers.get('content-type') || ''",
  '    }))',
  '  } catch (error) {',
  "    const causeCode = typeof error?.cause?.code === 'string' && /^[A-Z0-9_]+$/.test(error.cause.code) ? error.cause.code : ''",
  "    console.error('[bedrock-bot-console] NETHERNET_HTTP_DIAG ' + JSON.stringify({",
  "      phase: 'http-post-error',",
  '      elapsedMs: Date.now() - requestStartedAt,',
  '      timeoutMs: requestTimeoutMs,',
  '      callerAborted: Boolean(signal?.aborted),',
  '      requestTimedOut: requestDeadline.aborted,',
  "      errorName: error?.name || 'Error',",
  '      causeCode',
  '    }))',
  '    throw error',
  '  } // BEDROCK_BOT_CONSOLE_HTTP_FETCH_TIMEOUT_DIAG'
].join('\n')

const OFFER_HTTP_BODY_MARKER = 'BEDROCK_BOT_CONSOLE_HTTP_ANSWER_BODY_DIAG'
const OFFER_HTTP_BODY_ORIGINAL = '  const answer = await response.text()'
const OFFER_HTTP_BODY_REPLACEMENT = [
  '  let answer',
  '  try {',
  '    answer = await response.text()',
  '  } catch (error) {',
  "    const causeCode = typeof error?.cause?.code === 'string' && /^[A-Z0-9_]+$/.test(error.cause.code) ? error.cause.code : ''",
  "    console.error('[bedrock-bot-console] NETHERNET_HTTP_DIAG ' + JSON.stringify({",
  "      phase: 'http-answer-read-error',",
  '      elapsedMs: Date.now() - requestStartedAt,',
  '      timeoutMs: requestTimeoutMs,',
  '      callerAborted: Boolean(signal?.aborted),',
  '      requestTimedOut: requestDeadline.aborted,',
  "      errorName: error?.name || 'Error',",
  '      causeCode',
  '    }))',
  '    throw error',
  '  }',
  "  console.info('[bedrock-bot-console] NETHERNET_HTTP_DIAG ' + JSON.stringify({",
  "    phase: 'http-answer-read',",
  '    elapsedMs: Date.now() - requestStartedAt,',
  "    answerByteLength: Buffer.byteLength(answer, 'utf8'),",
  "    startsWithV0: answer.startsWith('v=')",
  '  })) // BEDROCK_BOT_CONSOLE_HTTP_ANSWER_BODY_DIAG'
].join('\n')

// This summary intentionally omits candidate addresses/ports, ICE ufrag/password,
// DTLS digests, identity JWTs, signatures, and the SDP itself.
const OFFER_DIAGNOSTIC_HELPER_SOURCE = String.raw`function summarizeOfferSdp (sdp) {
  const crypto = require('node:crypto')
  const source = String(sdp)
  const lines = source.split(/\r?\n/)
  const firstMediaIndex = lines.findIndex(line => line.startsWith('m='))
  const candidateTypes = Object.create(null)
  const candidateTransports = Object.create(null)
  const fingerprintAlgorithms = new Set()
  const setupValues = new Set()
  const media = []
  let candidateCount = 0
  let malformedCandidateCount = 0
  let identityEnvelopeValid = false
  let identityAssertionValid = false
  let identityProtocolDefault = false
  let identityDomainPresent = false
  let identityDomainHasTrailingSlash = false
  let identityDomainMatchesMinecraftIssuer = false
  let identityTokenJwtShapeValid = false
  let identityTokenAlgorithm = ''
  let identityTokenAudienceMatchesMinecraftMultiplayer = false
  let identityTokenCpkEncoding = 'missing'
  let identityTokenCpkP384 = false
  let identityFingerprintJwsDetached = false
  let identityFingerprintJwsAlgorithm = ''
  let identityFingerprintSignatureValidForTokenCpk = false
  const identityLines = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('m=')) {
      const parts = line.slice(2).trim().split(/\s+/)
      media.push({ kind: parts[0] || '', protocol: parts[2] || '' })
    }
    if (line.startsWith('a=fingerprint:')) {
      const algorithm = line.slice('a=fingerprint:'.length).trim().split(/\s+/, 1)[0]
      if (algorithm) fingerprintAlgorithms.add(algorithm.toLowerCase())
    }
    if (line.startsWith('a=setup:')) setupValues.add(line.slice('a=setup:'.length).trim().toLowerCase())
    if (line.startsWith('a=identity:')) identityLines.push({ index: i, value: line.slice('a=identity:'.length) })
    if (line.startsWith('a=candidate:')) {
      candidateCount++
      const parts = line.trim().split(/\s+/)
      const transport = (parts[2] || 'unknown').toLowerCase()
      const typIndex = parts.indexOf('typ')
      const type = typIndex >= 0 ? (parts[typIndex + 1] || 'unknown').toLowerCase() : 'unknown'
      if (!parts[2] || typIndex < 0 || !parts[typIndex + 1]) malformedCandidateCount++
      candidateTransports[transport] = (candidateTransports[transport] || 0) + 1
      candidateTypes[type] = (candidateTypes[type] || 0) + 1
    }
  }

  if (identityLines.length === 1) {
    try {
      const envelope = JSON.parse(Buffer.from(identityLines[0].value, 'base64').toString('utf8'))
      identityEnvelopeValid = Boolean(envelope && typeof envelope === 'object')
      identityProtocolDefault = envelope?.idp?.protocol === 'default'
      identityDomainPresent = typeof envelope?.idp?.domain === 'string' && envelope.idp.domain.length > 0
      identityDomainHasTrailingSlash = typeof envelope?.idp?.domain === 'string' && envelope.idp.domain.endsWith('/')
      identityDomainMatchesMinecraftIssuer = envelope?.idp?.domain === 'https://authorization.franchise.minecraft-services.net/'
      const assertion = typeof envelope?.assertion === 'string' ? JSON.parse(envelope.assertion) : envelope?.assertion
      identityAssertionValid = Boolean(assertion && typeof assertion === 'object')
      const tokenParts = typeof assertion?.token === 'string' ? assertion.token.split('.') : []
      const fingerprintParts = typeof assertion?.fingerprints === 'string' ? assertion.fingerprints.split('.') : []
      identityTokenJwtShapeValid = tokenParts.length === 3 && tokenParts.every(Boolean)
      identityFingerprintJwsDetached = fingerprintParts.length === 3 && fingerprintParts[1] === '' && Boolean(fingerprintParts[0] && fingerprintParts[2])

      if (identityTokenJwtShapeValid) {
        try {
          const tokenHeader = JSON.parse(Buffer.from(tokenParts[0], 'base64url').toString('utf8'))
          const tokenClaims = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString('utf8'))
          identityTokenAlgorithm = typeof tokenHeader.alg === 'string' ? tokenHeader.alg : ''
          const audiences = Array.isArray(tokenClaims.aud) ? tokenClaims.aud : [tokenClaims.aud]
          identityTokenAudienceMatchesMinecraftMultiplayer = audiences.includes('api://auth-minecraft-services/multiplayer')

          const cpk = tokenClaims.cpk
          let publicKey = null
          if (cpk && typeof cpk === 'object' && cpk.kty === 'EC' && cpk.crv === 'P-384') {
            identityTokenCpkEncoding = 'jwk'
            publicKey = crypto.createPublicKey({ key: cpk, format: 'jwk' })
            identityTokenCpkP384 = publicKey.asymmetricKeyType === 'ec' && publicKey.asymmetricKeyDetails?.namedCurve === 'secp384r1'
          } else if (typeof cpk === 'string') {
            identityTokenCpkEncoding = 'base64-der'
            const decodedKey = crypto.createPublicKey({ key: Buffer.from(cpk, 'base64'), format: 'der', type: 'spki' })
            identityTokenCpkP384 = decodedKey.asymmetricKeyType === 'ec' && decodedKey.asymmetricKeyDetails?.namedCurve === 'secp384r1'
            if (identityTokenCpkP384) publicKey = decodedKey
          } else if (cpk && typeof cpk === 'object') {
            identityTokenCpkEncoding = 'other-object'
          }

          if (identityFingerprintJwsDetached) {
            const fingerprintHeader = JSON.parse(Buffer.from(fingerprintParts[0], 'base64url').toString('utf8'))
            identityFingerprintJwsAlgorithm = typeof fingerprintHeader.alg === 'string' ? fingerprintHeader.alg : ''
            if (publicKey && identityFingerprintJwsAlgorithm === 'ES384') {
              const fingerprints = lines
                .filter(line => line.startsWith('a=fingerprint:'))
                .map(line => {
                  const parts = line.slice('a=fingerprint:'.length).trim().split(/\s+/)
                  return { algorithm: parts[0], digest: parts[1] }
                })
              const payload = Buffer.from(JSON.stringify({ fingerprint: fingerprints }), 'utf8').toString('base64url')
              const signingInput = fingerprintParts[0] + '.' + payload
              identityFingerprintSignatureValidForTokenCpk = crypto.verify(
                'sha384',
                Buffer.from(signingInput, 'utf8'),
                { key: publicKey, dsaEncoding: 'ieee-p1363' },
                Buffer.from(fingerprintParts[2], 'base64url')
              )
            }
          }
        } catch {}
      }
    } catch {}
  }

  const sortedCounts = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
  return {
    byteLength: Buffer.byteLength(source, 'utf8'),
    lineCount: lines.filter(Boolean).length,
    lineEndings: source.includes('\r\n') ? 'CRLF' : 'LF',
    startsWithV0: lines[0] === 'v=0',
    hasOriginLine: lines.some(line => line.startsWith('o=')),
    mediaSections: media,
    hasApplicationDataChannel: media.some(item => item.kind === 'application' && item.protocol.toUpperCase().includes('SCTP')),
    hasSctpPort: lines.some(line => line.startsWith('a=sctp-port:')),
    hasMaxMessageSize: lines.some(line => line.startsWith('a=max-message-size:')),
    hasBundleGroup: lines.some(line => line.startsWith('a=group:BUNDLE')),
    fingerprintCount: lines.filter(line => line.startsWith('a=fingerprint:')).length,
    fingerprintAlgorithms: [...fingerprintAlgorithms].sort(),
    sessionFingerprintCount: lines.slice(0, firstMediaIndex < 0 ? lines.length : firstMediaIndex).filter(line => line.startsWith('a=fingerprint:')).length,
    setupValues: [...setupValues].sort(),
    hasIceUfrag: lines.some(line => line.startsWith('a=ice-ufrag:')),
    hasIcePassword: lines.some(line => line.startsWith('a=ice-pwd:')),
    candidateCount,
    malformedCandidateCount,
    candidateTypes: sortedCounts(candidateTypes),
    candidateTransports: sortedCounts(candidateTransports),
    endOfCandidatesCount: lines.filter(line => line === 'a=end-of-candidates').length,
    identityCount: identityLines.length,
    identitySessionLevel: identityLines.length === 1 && (firstMediaIndex < 0 || identityLines[0].index < firstMediaIndex),
    identityEnvelopeValid,
    identityAssertionValid,
    identityProtocolDefault,
    identityDomainPresent,
    identityDomainHasTrailingSlash,
    identityDomainMatchesMinecraftIssuer,
    identityTokenJwtShapeValid,
    identityTokenAlgorithm,
    identityTokenAudienceMatchesMinecraftMultiplayer,
    identityTokenCpkEncoding,
    identityTokenCpkP384,
    identityFingerprintJwsDetached,
    identityFingerprintJwsAlgorithm,
    identityFingerprintSignatureValidForTokenCpk
  }
} // BEDROCK_BOT_CONSOLE_OFFER_DIAGNOSTIC_HELPER`

const OFFER_DIAGNOSTIC_FUNCTION_REPLACEMENT = `${OFFER_DIAGNOSTIC_HELPER_SOURCE}\n\n${OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL}`
const OFFER_DIAGNOSTIC_LOG_REPLACEMENT = [
  "  console.info('[bedrock-bot-console] NETHERNET_OFFER_DIAG ' + JSON.stringify({",
  "    phase: 'before-http-post',",
  "    origin: url.origin,",
  "    method: 'POST',",
  "    path: '/v1/join/{networkId}',",
  "    contentType: 'application/sdp',",
  '    sdp: summarizeOfferSdp(body)',
  '  })) // BEDROCK_BOT_CONSOLE_OFFER_DIAGNOSTIC_LOG',
  OFFER_DIAGNOSTIC_FETCH_ORIGINAL
].join('\n')

function findPackageRoot (entryFile, packageName) {
  let current = path.dirname(entryFile)
  while (true) {
    const manifest = path.join(current, 'package.json')
    if (fs.existsSync(manifest)) {
      try {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        if (data.name === packageName) return { root: current, manifest: data }
      } catch {}
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function applySingleReplace (source, original, replacement, marker, label) {
  if (typeof source !== 'string') throw new TypeError(`${label} source must be a string`)
  if (source.includes(marker)) {
    new vm.Script(source, { filename: label })
    return { source, changed: false }
  }
  const occurrences = source.split(original).length - 1
  if (occurrences !== 1) {
    throw new Error(`${label}: known code block not found (expected 1, found ${occurrences}); refusing to patch.`)
  }
  const patched = source.replace(original, replacement)
  new vm.Script(patched, { filename: label })
  return { source: patched, changed: true }
}

function patchCreateClientSource (source) {
  return applySingleReplace(source, ORIGINAL, REPLACEMENT, MARKER, 'bedrock-protocol/src/createClient.js')
}

function patchSnappyCompressionSource (source) {
  const compressed = applySingleReplace(
    source,
    SNAPPY_COMPRESS_ORIGINAL,
    SNAPPY_COMPRESS_REPLACEMENT,
    SNAPPY_COMPRESS_MARKER,
    'bedrock-protocol/src/transforms/framer.js Snappy compressor'
  )
  const decompressed = applySingleReplace(
    compressed.source,
    SNAPPY_DECOMPRESS_ORIGINAL,
    SNAPPY_DECOMPRESS_REPLACEMENT,
    SNAPPY_DECOMPRESS_MARKER,
    'bedrock-protocol/src/transforms/framer.js Snappy decompressor'
  )
  return {
    source: decompressed.source,
    changed: compressed.changed || decompressed.changed
  }
}

function patchIdentityDomainSource (source) {
  if (typeof source !== 'string') throw new TypeError('bedrock-protocol/src/client.js source must be a string')
  if (source.includes(IDENTITY_MARKER) && source.includes(IDENTITY_PREVIOUS_DOMAIN)) {
    const occurrences = source.split(IDENTITY_PREVIOUS_DOMAIN).length - 1
    if (occurrences !== 1) throw new Error(`bedrock-protocol/src/client.js: legacy issuer setting found ${occurrences} times; refusing to migrate.`)
    const migrated = source.replace(IDENTITY_PREVIOUS_DOMAIN, "domain: 'https://authorization.franchise.minecraft-services.net/'")
    new vm.Script(migrated, { filename: 'bedrock-protocol/src/client.js' })
    return { source: migrated, changed: true }
  }
  return applySingleReplace(source, IDENTITY_ORIGINAL, IDENTITY_REPLACEMENT, IDENTITY_MARKER, 'bedrock-protocol/src/client.js')
}

function patchServerIdentityPublicKeySource (source) {
  return applySingleReplace(
    source,
    VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL,
    VERIFY_SERVER_IDENTITY_PUBLIC_KEY_REPLACEMENT,
    VERIFY_SERVER_IDENTITY_PUBLIC_KEY_MARKER,
    'nethernet/src/signalling/sdpIdentity.js server public key import'
  )
}
function patchHttpErrorSource (source) {
  return applySingleReplace(source, HTTP_ERROR_ORIGINAL, HTTP_ERROR_REPLACEMENT, HTTP_ERROR_MARKER, 'nethernet/src/signalling/http.js')
}

function patchClientSignallingOptionsSource (source) {
  return applySingleReplace(
    source,
    CLIENT_SERVICES_SIGNAL_OPTIONS_ORIGINAL,
    '          { protocol: this.options.nethernet._signallingProtocol, host: this.options.nethernet._signallingHost, timeout: this.options.nethernet.signallingConnectTimeout, onDiagnostics: this.options.nethernet.onDiagnostics } // BEDROCK_BOT_CONSOLE_FRIEND_WORLD_SIGNAL_OPTIONS',
    CLIENT_SERVICES_SIGNAL_OPTIONS_MARKER,
    'bedrock-protocol/src/client.js Xbox signalling diagnostics callback'
  )
}

function patchClientWorldConnectionProtocolSource (source) {
  const replacement = [
    '  const supportedConnections = Array.isArray(session.current.properties?.custom?.SupportedConnections)',
    '    ? session.current.properties.custom.SupportedConnections',
    '    : []',
    '  const modernConnection = supportedConnections.find(connection => {',
    '    if (!connection || (connection.ConnectionType != null && Number(connection.ConnectionType) !== 7)) return false',
    '    const pmsgId = connection.PmsgId ?? connection.pmsgId',
    '    return connection.NetherNetId != null && pmsgId != null && String(pmsgId).trim() !== ""',
    '  })',
    '  const legacyConnection = supportedConnections.find(connection => {',
    '    if (!connection || (connection.ConnectionType != null && Number(connection.ConnectionType) !== 3)) return false',
    '    const webRtcNetworkId = connection.WebRTCNetworkId ?? connection.webRtcNetworkId ?? connection.NetherNetId',
    '    return webRtcNetworkId != null && String(webRtcNetworkId).trim() !== ""',
    '  })',
    '  const selectedConnection = modernConnection || legacyConnection',
    '  if (!selectedConnection) throw Error("Could not find a supported Xbox world connection (ConnectionType 7 with PmsgId or ConnectionType 3 with WebRTCNetworkId).")',
    '  const isJsonRpc = Boolean(modernConnection)',
    '  const protocol = isJsonRpc ? "jsonrpc" : "legacy"',
    '  const connectionType = selectedConnection.ConnectionType ?? (isJsonRpc ? 7 : 3)',
    '  const targetNetworkId = isJsonRpc',
    '    ? (selectedConnection.PmsgId ?? selectedConnection.pmsgId)',
    '    : (selectedConnection.WebRTCNetworkId ?? selectedConnection.webRtcNetworkId ?? selectedConnection.NetherNetId)',
    '  const targetNetworkIdText = String(targetNetworkId).trim()',
    '  if (!isJsonRpc && !/^\\d+$/.test(targetNetworkIdText)) throw Error("The selected legacy Xbox world has an invalid WebRTCNetworkId.")',
    '  options.nethernet._signallingProtocol = protocol',
    '  options.nethernet.networkId = isJsonRpc ? targetNetworkIdText : BigInt(targetNetworkIdText)',
    '  options.nethernet.onDiagnostics?.("Selected Xbox world connection; ConnectionType=" + connectionType + ", protocol=" + protocol + ", targetIdKind=" + (isJsonRpc ? "pmsg" : "webrtc"))',
    '  await session.setActivity() // BEDROCK_BOT_CONSOLE_XBOX_CONNECTIONTYPE_ROUTING'
  ].join('\n')
  return applySingleReplace(
    source,
    CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL,
    replacement,
    CLIENT_WORLD_CONNECTION_SELECTION_MARKER,
    'bedrock-protocol/src/client/auth.js Xbox ConnectionType routing'
  )
}

function patchClientConnectionDiagnosticsSource (source) {
  const signal = applySingleReplace(
    source,
    CLIENT_SERVICES_SIGNAL_ORIGINAL,
    [
      '        this.nethernet.signalling.connect()',
      '          .then(() => {',
      '            if (this._closed) return',
      "            this.conLog?.('[NetherNet] Xbox services signalling is ready; starting WebRTC transport.')",
      '            this._connect(sessionData)',
      '          })',
      '          .catch(error => {',
      "            this.conLog?.('[NetherNet] Xbox services signalling failed: ' + error.message)",
      '            this.onConnectionError(error)',
      '          }) // BEDROCK_BOT_CONSOLE_FRIEND_WORLD_SIGNAL_DIAGNOSTICS'
    ].join('\n'),
    CLIENT_SERVICES_SIGNAL_MARKER,
    'bedrock-protocol/src/client.js Xbox services signalling diagnostics'
  )
  const connected = applySingleReplace(
    signal.source,
    CLIENT_CONNECTED_ORIGINAL,
    [
      '    this.connection.onConnected = () => {',
      '      this.status = ClientStatus.Connecting',
      "      if (this.options.transport === 'nethernet' && this.options.nethernet.signalling === 'services') {",
      "        this.conLog?.('[NetherNet] WebRTC transport connected; starting Bedrock network handshake.')",
      '      } // BEDROCK_BOT_CONSOLE_FRIEND_WORLD_TRANSPORT_CONNECTED'
    ].join('\n'),
    CLIENT_CONNECTED_MARKER,
    'bedrock-protocol/src/client.js transport-connected diagnostics'
  )
  const timeout = applySingleReplace(
    connected.source,
    CLIENT_TIMEOUT_ORIGINAL,
    [
      "    const isXboxServicesNethernet = this.options.transport === 'nethernet' && this.options.nethernet.signalling === 'services'",
      '    const connectTimeoutMs = this.options.connectTimeout || 9000',
      "    if (isXboxServicesNethernet) this.conLog?.('[NetherNet] Waiting for WebRTC transport connection (timeout=' + connectTimeoutMs + ' ms).')",
      '    this.connectTimeout = setTimeout(() => {',
      '      if (this.status === ClientStatus.Disconnected) {',
      "        if (isXboxServicesNethernet) this.conLog?.('[NetherNet] WebRTC transport did not connect before the configured timeout.')",
      "        this.onConnectionError(Error('Connect timed out'))",
      '      }',
      '    }, connectTimeoutMs) // BEDROCK_BOT_CONSOLE_FRIEND_WORLD_TIMEOUT_DIAGNOSTICS'
    ].join('\n'),
    CLIENT_TIMEOUT_MARKER,
    'bedrock-protocol/src/client.js transport-timeout diagnostics'
  )
  return { source: timeout.source, changed: signal.changed || connected.changed || timeout.changed }
}

function patchNethernetTimeoutOptionsSource (source) {
  const options = applySingleReplace(
    source,
    NETHERNET_OPTIONS_ORIGINAL,
    [
      '        webrtcBackend: options.webrtcBackend,',
      '        onDiagnostics: options.onDiagnostics,',
      '        responseTimeoutMs: options.signallingConnectTimeout,',
      '        inactivityTimeoutMs: options.inactivityTimeoutMs,',
      "        ...(options.signalling === 'http' && {",
      '          http: { url: signallingUrl({ ...options, nethernet: options }), serverKey: options.serverKey, onServerKey: options.onServerKey }',
      '        }) // BEDROCK_BOT_CONSOLE_NETHERNET_TIMEOUT_OPTIONS'
    ].join('\n'),
    NETHERNET_OPTIONS_MARKER,
    'bedrock-protocol/src/nethernet/index.js timeout option forwarding'
  )
  const sendReliable = applySingleReplace(
    options.source,
    NETHERNET_SEND_RELIABLE_ORIGINAL,
    [
      '  sendReliable (data) {',
      '    return this.nethernet.send(data) // BEDROCK_BOT_CONSOLE_NETHERNET_SEND_RELIABLE_RETURN',
      '  }'
    ].join('\n'),
    NETHERNET_SEND_RELIABLE_MARKER,
    'bedrock-protocol/src/nethernet/index.js reliable send result forwarding'
  )
  return { source: sendReliable.source, changed: options.changed || sendReliable.changed }
}


function patchNethernetSignallingSource (source) {
  let current = source
  let changed = false
  const apply = (original, replacement, marker, label) => {
    const result = applySingleReplace(current, original, replacement, marker, label)
    current = result.source
    changed = changed || result.changed
  }

  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_ORIGINAL,
    [
      '    this.host = options.host || null',
      '    this.timeout = options.timeout ?? 15000',
      "    this.onDiagnostics = typeof options.onDiagnostics === 'function' ? options.onDiagnostics : null // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_OPTIONS"
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js callback option'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL,
    [
      '  reportDiagnostic (message) {',
      "    if (typeof this.onDiagnostics !== 'function') return",
      '    try {',
      '      this.onDiagnostics(String(message))',
      '    } catch (error) {',
      "      debug('Diagnostic callback failed:', error.message)",
      '    }',
      '  } // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_METHOD',
      '',
      NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js diagnostic callback'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_ORIGINAL,
    [
      "    this.reportDiagnostic('Xbox signalling WebSocket opened; protocol=' + this._protocol)",
      NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_ORIGINAL + ' // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_OPEN'
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js WebSocket open diagnostics'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_ORIGINAL,
    [
      "    this.reportDiagnostic('Xbox signalling WebSocket closed; protocol=' + this._protocol + ', code=' + code)",
      NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_ORIGINAL + ' // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_CLOSE'
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js WebSocket close diagnostics'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_ORIGINAL,
    [
      '    this.credentials = parseTurnAuth(result)',
      "    this.reportDiagnostic('TURN credentials received; protocol=jsonrpc')",
      "    this.emit('credentials', this.credentials) // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_TURN_AUTH"
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js JSON-RPC TURN credentials diagnostics'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_ORIGINAL,
    [
      '        this.credentials = parseTurnServers(message.Message)',
      "        this.reportDiagnostic('TURN credentials received; protocol=legacy')",
      "        this.emit('credentials', this.credentials) // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS"
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js legacy TURN credentials diagnostics'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_ORIGINAL,
    [
      NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_ORIGINAL,
      "    this.reportDiagnostic('Xbox signalling frame received; protocol=' + this._protocol) // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_MESSAGE"
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js incoming frame diagnostics'
  )
  apply(
    '    switch (message.Type) {',
    [
      "    const legacyType = message.Type === LegacyMessageType.RequestPing ? 'request-ping' : message.Type === LegacyMessageType.Signal ? 'signal' : message.Type === LegacyMessageType.Credentials ? 'credentials' : message.Type === 3 ? 'accepted' : message.Type === 4 ? 'ack' : 'unknown'",
      "    const legacyTypeCode = Number.isSafeInteger(message.Type) ? String(message.Type) : typeof message.Type",
      "    const legacyTypeDetail = legacyType === 'unknown' ? ', code=' + legacyTypeCode : ''",
      "    const senderRole = message.From === 'Server' ? 'server' : (message.From == null ? 'unknown' : 'peer')",
      "    this.reportDiagnostic('Incoming legacy frame classified; type=' + legacyType + legacyTypeDetail + ', sender=' + senderRole)",
      '    switch (message.Type) { // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_LEGACY_FRAME_CLASSIFICATION'
    ].join('\n'),
    'BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_LEGACY_FRAME_CLASSIFICATION',
    'bedrock-protocol/src/nethernet/signalling.js legacy frame classification'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_ORIGINAL,
    [
      '        const signal = parseSignalMessage(message.Message)',
      '        if (!signal) {',
      "          this.reportDiagnostic('Incoming legacy signal could not be parsed')",
      "          debug('Could not parse signal; message content omitted')",
      '          return',
      '        }',
      "        const safeType = ['CONNECTREQUEST', 'CONNECTRESPONSE', 'CANDIDATEADD', 'CONNECTERROR'].includes(signal.type) ? signal.type : 'unknown'",
      "        this.reportDiagnostic('Incoming legacy signal parsed; type=' + safeType)",
      '        signal.networkId = String(message.From)',
      "        this.emit('signal', signal) // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL"
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js legacy signal parsing diagnostics'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_ORIGINAL,
    [
      '      const items = Array.isArray(message.params) ? message.params : [message.params]',
      "      this.reportDiagnostic('Xbox JSON-RPC signal delivery received; itemCount=' + items.length)",
      '      for (const item of items) {',
      '        const signal = parseJsonRpcReceiveItem(item)',
      '        if (signal) {',
      "          const safeType = ['CONNECTREQUEST', 'CONNECTRESPONSE', 'CANDIDATEADD', 'CONNECTERROR'].includes(signal.type) ? signal.type : 'unknown'",
      "          this.reportDiagnostic('Incoming JSON-RPC signal parsed; type=' + safeType)",
      "          this.emit('signal', signal)",
      '        } else {',
      "          this.reportDiagnostic('Incoming JSON-RPC signal item could not be parsed')",
      '        }',
      '      } // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL'
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js JSON-RPC signal parsing diagnostics'
  )
  apply(
    NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_ORIGINAL,
    [
      "    const safeType = ['CONNECTREQUEST', 'CONNECTRESPONSE', 'CANDIDATEADD', 'CONNECTERROR'].includes(signal.type) ? signal.type : 'unknown'",
      "    this.reportDiagnostic('Outgoing Xbox signalling WebSocket send queued; type=' + safeType)",
      '    this.ws.send(message, error => {',
      "      if (error) this.reportDiagnostic('Outgoing Xbox signalling WebSocket send failed; type=' + safeType)",
      "      else this.reportDiagnostic('Outgoing Xbox signalling WebSocket send callback completed; type=' + safeType)",
      '    }) // BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_WRITE'
    ].join('\n'),
    NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_MARKER,
    'bedrock-protocol/src/nethernet/signalling.js outgoing WebSocket send diagnostics'
  )

  return { source: current, changed }
}
function patchNethernetClientDiagnosticsSource (source) {
  let current = source
  let changed = false
  const apply = (original, replacement, marker, label) => {
    const result = applySingleReplace(current, original, replacement, marker, label)
    current = result.source
    changed = changed || result.changed
  }

  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL,
    [
      NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL,
      "    this.onDiagnostics = typeof options.onDiagnostics === 'function' ? options.onDiagnostics : null // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_OPTION"
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_OPTION_MARKER,
    'nethernet/src/client.js diagnostics callback option'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL,
    [
      '  reportDiagnostic (message) {',
      '    if (!this.onDiagnostics) return',
      '    try {',
      '      this.onDiagnostics(String(message))',
      '    } catch (error) {',
      "      debug('Diagnostic callback failed:', error.message)",
      '    }',
      '  } // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_METHOD',
      '',
      NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_METHOD_MARKER,
    'nethernet/src/client.js diagnostics callback method'
  )
  apply(
    NETHERNET_CLIENT_SEND_ORIGINAL,
    [
      '  send (buffer) {',
      '    if (!this.connection) {',
      "      throw new Error('Connection is not open')",
      '    }',
      '',
      '    return this.connection.send(buffer) // BEDROCK_BOT_CONSOLE_NETHERNET_CLIENT_SEND_RETURN',
      '  }'
    ].join('\n'),
    NETHERNET_CLIENT_SEND_MARKER,
    'nethernet/src/client.js reliable send result forwarding'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_ORIGINAL,
    [
      "    this.reportDiagnostic('Negotiation response timer started: timeout=' + timeoutMs + 'ms, errorCode=' + code)",
      '    this._negotiationTimeout = setTimeout(() => {',
      "      this.reportDiagnostic('Negotiation response timed out: timeout=' + timeoutMs + 'ms, errorCode=' + code)",
      '      this.failNegotiation(this.serverNetworkId, code)',
      '    }, timeoutMs) // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_TIMEOUT'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_MARKER,
    'nethernet/src/client.js negotiation timeout diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_ORIGINAL,
    [
      '      await rtcConnection.setRemoteDescription(answer)',
      '      if (this._closed || this.rtcConnection !== rtcConnection) return',
      "      this.reportDiagnostic('ConnectResponse received and remote description applied')",
      "      debug('Set remote description (answer)') // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_ANSWER"
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_MARKER,
    'nethernet/src/client.js answer diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_ORIGINAL,
    [
      '      const state = rtcConnection.connectionState',
      "      this.reportDiagnostic('WebRTC connection state: ' + state)",
      "      debug('Client connection state changed:', state) // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_CONNECTION_STATE"
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_MARKER,
    'nethernet/src/client.js connection-state diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_ORIGINAL,
    [
      '      const state = rtcConnection.iceConnectionState',
      "      this.reportDiagnostic('ICE connection state: ' + state)",
      "      debug('Client ICE state changed:', state) // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_ICE_STATE"
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_MARKER,
    'nethernet/src/client.js ICE-state diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_ORIGINAL,
    [
      '      await rtcConnection.setLocalDescription(offer)',
      '      if (!isCurrent()) return',
      "      this.reportDiagnostic('WebRTC states after local description: iceGatheringState=' + (rtcConnection.iceGatheringState || 'unknown') + ', iceConnectionState=' + (rtcConnection.iceConnectionState || 'unknown'))",
      "      const localSdp = String(rtcConnection.localDescription?.sdp || '')",
      "      const candidateLines = localSdp.split(/\\r?\\n/).filter(line => line.startsWith('a=candidate:'))",
      '      const candidateCounts = { host: 0, srflx: 0, relay: 0, other: 0 }',
      '      for (const line of candidateLines) {',
      '        const match = line.match(/\\btyp\\s+([a-z]+)/i)',
      "        const type = match?.[1]?.toLowerCase() || 'other'",
      "        candidateCounts[Object.hasOwn(candidateCounts, type) ? type : 'other']++",
      '      }',
      "      this.reportDiagnostic('Local ICE candidates gathered: total=' + candidateLines.length + ', host=' + candidateCounts.host + ', srflx=' + candidateCounts.srflx + ', relay=' + candidateCounts.relay + ', other=' + candidateCounts.other) // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_LOCAL_DESCRIPTION"
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_MARKER,
    'nethernet/src/client.js local ICE diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_ORIGINAL,
    [
      '    const pendingCandidateSignals = []',
      '    let connectRequestSent = false',
      '    rtcConnection.onicecandidate = (event) => {',
      '      if (!this.http && event.candidate && isCurrent()) {',
      "        debug('Sending CandidateAdd to networkId:', this.serverNetworkId)",
      '        const signal = new SignalStructure(SignalType.CandidateAdd, this.connectionId, event.candidate.candidate, this.serverNetworkId)',
      '',
      '        if (connectRequestSent) {',
      '          this._signalHandler(signal)',
      '        } else {',
      '          pendingCandidateSignals.push(signal)',
      "          this.reportDiagnostic('Queued ICE candidate until ConnectRequest is sent')",
      '        }',
      '      }',
      '    } // BEDROCK_BOT_CONSOLE_NETHERNET_CANDIDATE_ORDER'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_MARKER,
    'nethernet/src/client.js ordered ICE candidate signalling'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL,
    [
      "      this.reportDiagnostic('Sending ConnectRequest (WebRTC offer)')",
      ...NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL.split('\n'),
      '      connectRequestSent = true',
      '      const queuedCandidateCount = pendingCandidateSignals.length',
      '      if (queuedCandidateCount > 0) {',
      "        this.reportDiagnostic('Sending queued ICE candidates after ConnectRequest; count=' + queuedCandidateCount)",
      '        for (const pendingSignal of pendingCandidateSignals.splice(0)) {',
      '          this._signalHandler(pendingSignal)',
      '        }',
      '      }',
      '      // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_CONNECT_REQUEST'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_MARKER,
    'nethernet/src/client.js ConnectRequest diagnostics and candidate ordering'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL,
    [
      "    this.reportDiagnostic('Sending ConnectError code=' + code)",
      NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL + ' // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_SIGNAL_ERROR'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_MARKER,
    'nethernet/src/client.js ConnectError diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_ORIGINAL,
    [
      '    if (signal.connectionId?.toString() !== this.connectionId.toString()) {',
      "      this.reportDiagnostic('Incoming signal ignored: connection ID mismatch')",
      "      debug('Ignoring signal for unexpected connection')",
      '      return false',
      '    } // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_UNEXPECTED_CONNECTION'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_MARKER,
    'nethernet/src/client.js unexpected connection diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_ORIGINAL,
    [
      '    if (signal.networkId != null && signal.networkId.toString() !== this.serverNetworkId.toString()) {',
      "      this.reportDiagnostic('Incoming signal ignored: network ID mismatch')",
      "      debug('Ignoring signal from unexpected network')",
      '      return false',
      '    } // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_UNEXPECTED_NETWORK'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_MARKER,
    'nethernet/src/client.js unexpected network diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_ORIGINAL,
    [
      '    rtcConnection.onicegatheringstatechange = () => {',
      '      if (!isCurrent()) return',
      "      this.reportDiagnostic('ICE gathering state: ' + rtcConnection.iceGatheringState)",
      '    } // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_ICE_GATHERING',
      NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_ORIGINAL
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_MARKER,
    'nethernet/src/client.js ICE gathering diagnostics'
  )
  apply(
    NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL,
    [
      '    switch (signal.type) {',
      '      case SignalType.ConnectResponse:',
      "        this.reportDiagnostic('ConnectResponse received')",
      '        this.handleAnswer(signal)',
      '        break',
      '      case SignalType.CandidateAdd:',
      "        this.reportDiagnostic('ICE candidate signal received')",
      '        this.handleCandidate(signal)',
      '        break',
      '      case SignalType.ConnectError:',
      "        this.reportDiagnostic('ConnectError received: code=' + signal.data)",
      "        this.connection?.close('connecterror:' + signal.data)",
      '        break',
      '    } // BEDROCK_BOT_CONSOLE_NETHERNET_DIAGNOSTIC_HANDLE_SIGNAL'
    ].join('\n'),
    NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_MARKER,
    'nethernet/src/client.js incoming signalling diagnostics'
  )

  return { source: current, changed }
}

function patchHttpOfferDiagnosticsSource (source) {
  const helper = applySingleReplace(
    source,
    OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL,
    OFFER_DIAGNOSTIC_FUNCTION_REPLACEMENT,
    OFFER_DIAGNOSTIC_HELPER_MARKER,
    'nethernet/src/signalling/http.js diagnostics helper'
  )
  const log = applySingleReplace(
    helper.source,
    OFFER_DIAGNOSTIC_FETCH_ORIGINAL,
    OFFER_DIAGNOSTIC_LOG_REPLACEMENT,
    OFFER_DIAGNOSTIC_LOG_MARKER,
    'nethernet/src/signalling/http.js diagnostics log'
  )
  const fetch = applySingleReplace(
    log.source,
    OFFER_HTTP_FETCH_BLOCK_ORIGINAL,
    OFFER_HTTP_FETCH_BLOCK_REPLACEMENT,
    OFFER_HTTP_FETCH_BLOCK_MARKER,
    'nethernet/src/signalling/http.js bounded HTTP POST'
  )
  const body = applySingleReplace(
    fetch.source,
    OFFER_HTTP_BODY_ORIGINAL,
    OFFER_HTTP_BODY_REPLACEMENT,
    OFFER_HTTP_BODY_MARKER,
    'nethernet/src/signalling/http.js HTTP answer body diagnostics'
  )
  return { source: body.source, changed: helper.changed || log.changed || fetch.changed || body.changed }
}

function patchBedrockConnectionOutboundDiagnosticsSource (source) {
  let current = source
  const write = applySingleReplace(
    current,
    BEDROCK_CONNECTION_WRITE_ORIGINAL,
    [
      '  write (name, params) {',
      '    this.outLog?.(name, params)',
      '    this._processOutbound(name, params)',
      '    const batch = new Framer(this)',
      '    const packet = this.serializer.createPacketBuffer({ name, params })',
      '    batch.addEncodedPacket(packet)',
      "    const traceHandshakePacket = this.options?.transport === 'nethernet' && (name === 'login' || name === 'client_to_server_handshake')",
      '    const previousDiagnosticPacketName = this._diagnosticOutboundPacketName',
      '    if (traceHandshakePacket) {',
      '      this._diagnosticOutboundPacketName = name',
      "      this.connection?.nethernet?.reportDiagnostic?.('Bedrock outbound handshake packet encoded: name=' + name + ', packetBytes=' + packet.length)",
      '    }',
      '    try {',
      '      if (this.encryptionEnabled) {',
      '        this.sendEncryptedBatch(batch)',
      '      } else {',
      '        this.sendDecryptedBatch(batch)',
      '      }',
      '    } finally {',
      '      if (traceHandshakePacket) {',
      '        if (previousDiagnosticPacketName == null) delete this._diagnosticOutboundPacketName',
      '        else this._diagnosticOutboundPacketName = previousDiagnosticPacketName',
      '      }',
      '    }',
      '  } // BEDROCK_BOT_CONSOLE_BEDROCK_OUTBOUND_PACKET_DIAGNOSTICS'
    ].join('\n'),
    BEDROCK_CONNECTION_WRITE_MARKER,
    'bedrock-protocol/src/connection.js outbound packet diagnostics'
  )
  current = write.source
  const send = applySingleReplace(
    current,
    BEDROCK_CONNECTION_SEND_MCPE_ORIGINAL,
    [
      '  sendMCPE (buffer, immediate) {',
      "    const packetName = this._diagnosticOutboundPacketName",
      "    const diagnosticNethernet = this.options?.transport === 'nethernet' && packetName ? this.connection?.nethernet : null",
      "    const reliableState = diagnosticNethernet?.connection?.reliable?.readyState || 'unknown'",
      '    if (this.connection.connected === false || this.status === ClientStatus.Disconnected) {',
      '      if (diagnosticNethernet) {',
      "        diagnosticNethernet.reportDiagnostic?.('Bedrock outbound handshake packet skipped: name=' + packetName + ', bytes=' + buffer.length + ', connected=' + String(this.connection.connected) + ', status=' + this.status + ', dataChannel=' + reliableState)",
      '      }',
      '      return',
      '    }',
      '    try {',
      '      const acceptedBytes = this.connection.sendReliable(buffer, immediate)',
      '      if (diagnosticNethernet) {',
      "        const result = acceptedBytes === 0 ? 'queued_or_zero' : (typeof acceptedBytes === 'number' && Number.isFinite(acceptedBytes) ? 'accepted' : 'unknown')",
      "        diagnosticNethernet.reportDiagnostic?.('Bedrock outbound handshake transport result: name=' + packetName + ', bytes=' + buffer.length + ', dataChannel=' + reliableState + ', result=' + result + ', acceptedBytes=' + String(acceptedBytes))",
      '      }',
      '      return acceptedBytes',
      '    } catch (e) {',
      '      if (diagnosticNethernet) {',
      "        diagnosticNethernet.reportDiagnostic?.('Bedrock outbound handshake transport error: name=' + packetName + ', bytes=' + buffer.length + ', dataChannel=' + reliableState + ', errorName=' + String(e?.name || 'Error'))",
      '      }',
      "      debug('while sending to', this.connection, e)",
      '    }',
      '  } // BEDROCK_BOT_CONSOLE_NETHERNET_HANDSHAKE_SEND_RESULT'
    ].join('\n'),
    BEDROCK_CONNECTION_SEND_MCPE_MARKER,
    'bedrock-protocol/src/connection.js reliable send result diagnostics'
  )
  return { source: send.source, changed: write.changed || send.changed }
}

function patchNethernetConnectionDiagnosticsSource (source) {
  let current = source
  let changed = false
  const reliable = applySingleReplace(
    current,
    NETHERNET_CONNECTION_RELIABLE_CHANNELS_ORIGINAL,
    [
      '      this.reliable.onopen = () => {',
      "        this.nethernet?.reportDiagnostic?.('Reliable data channel opened; queuedMessages=' + this.sendQueue.length)",
      '        this.flushQueue()',
      '      }',
      '',
      '      this.reliable.onclose = () => {',
      "        this.nethernet?.reportDiagnostic?.('Reliable data channel closed')",
      "        this.notifyClosed('disconnected')",
      '      }',
      '',
      '      this.reliable.onerror = () => {',
      "        this.nethernet?.reportDiagnostic?.('Reliable data channel error')",
      "        this.notifyClosed('disconnected')",
      '      } // BEDROCK_BOT_CONSOLE_RELIABLE_CHANNEL_DIAGNOSTICS'
    ].join('\n'),
    NETHERNET_CONNECTION_RELIABLE_CHANNELS_MARKER,
    'nethernet/src/connection.js reliable data channel diagnostics'
  )
  current = reliable.source
  changed = changed || reliable.changed

  const unreliable = applySingleReplace(
    current,
    NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_ORIGINAL,
    [
      '      this.unreliable.onopen = () => {',
      "        this.nethernet?.reportDiagnostic?.('Unreliable data channel opened')",
      '      }',
      '',
      '      this.unreliable.onclose = () => {',
      "        this.nethernet?.reportDiagnostic?.('Unreliable data channel closed')",
      "        this.notifyClosed('disconnected')",
      '      }',
      '',
      '      this.unreliable.onerror = () => {',
      "        this.nethernet?.reportDiagnostic?.('Unreliable data channel error')",
      "        this.notifyClosed('disconnected')",
      '      } // BEDROCK_BOT_CONSOLE_UNRELIABLE_CHANNEL_DIAGNOSTICS'
    ].join('\n'),
    NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_MARKER,
    'nethernet/src/connection.js unreliable data channel diagnostics'
  )
  current = unreliable.source
  changed = changed || unreliable.changed

  const receive = applySingleReplace(
    current,
    NETHERNET_CONNECTION_RECEIVE_ORIGINAL,
    [
      '    this.receivedMessageCount = (this.receivedMessageCount || 0) + 1',
      '    if (this.receivedMessageCount <= 8) {',
      "      this.nethernet?.reportDiagnostic?.('Reliable data channel payload received; count=' + this.receivedMessageCount + ', bytes=' + this.buf.length)",
      '    }',
      "    this.nethernet.emit('encapsulated', this.buf, this.address)",
      '    this.buf = null // BEDROCK_BOT_CONSOLE_RELIABLE_PAYLOAD_DIAGNOSTICS'
    ].join('\n'),
    NETHERNET_CONNECTION_RECEIVE_MARKER,
    'nethernet/src/connection.js inbound payload diagnostics'
  )
  current = receive.source
  changed = changed || receive.changed

  return { source: current, changed }
}

function replaceFile (target, patcher) {
  if (!fs.existsSync(target)) throw new Error(`Patch target not found: ${target}`)
  const original = fs.readFileSync(target, 'utf8')
  const result = patcher(original)
  if (result.changed) {
    const temp = `${target}.${process.pid}.tmp`
    try {
      fs.writeFileSync(temp, result.source, 'utf8')
      const written = fs.readFileSync(temp, 'utf8')
      new vm.Script(written, { filename: target })
      fs.renameSync(temp, target)
    } finally {
      try { fs.rmSync(temp, { force: true }) } catch {}
    }
  }
  return { target, changed: result.changed }
}

function resolveProtocolCopies (projectRoot) {
  const rootRequire = createRequire(path.join(projectRoot, 'package.json'))
  const contexts = [{ label: 'app', req: rootRequire }]
  try {
    const mineflayerEntry = rootRequire.resolve('mineflayer')
    contexts.push({ label: 'mineflayer', req: createRequire(mineflayerEntry) })
  } catch (error) {
    throw new Error(`Cannot resolve Mineflayer: ${error.message}`)
  }

  const found = new Map()
  for (const context of contexts) {
    let entry
    try {
      entry = context.req.resolve('bedrock-protocol')
    } catch (error) {
      throw new Error(`Cannot resolve bedrock-protocol from ${context.label}: ${error.message}`)
    }
    const pkg = findPackageRoot(entry, 'bedrock-protocol')
    if (!pkg) throw new Error(`${context.label}: bedrock-protocol package.json not found: ${entry}`)
    found.set(pkg.root, pkg)
  }
  return [...found.entries()].map(([root, pkg]) => ({ root, manifest: pkg.manifest }))
}

function resolveNethernetCopies (projectRoot, protocolCopies) {
  const contexts = [createRequire(path.join(projectRoot, 'package.json'))]
  for (const copy of protocolCopies) contexts.push(createRequire(path.join(copy.root, 'package.json')))
  const found = new Map()
  for (const req of contexts) {
    let entry
    try { entry = req.resolve('nethernet') } catch { continue }
    const pkg = findPackageRoot(entry, 'nethernet')
    if (!pkg) throw new Error(`nethernet package.json not found: ${entry}`)
    found.set(pkg.root, pkg)
  }
  if (!found.size) throw new Error('Cannot resolve nethernet from the app or bedrock-protocol packages.')
  return [...found.entries()].map(([root, pkg]) => ({ root, manifest: pkg.manifest }))
}

function applyPatch (projectRoot = path.resolve(__dirname, '..')) {
  const protocolCopies = resolveProtocolCopies(projectRoot)
  if (!protocolCopies.length) throw new Error('bedrock-protocol not found. Run npm install first.')
  const results = []
  for (const copy of protocolCopies) {
    if (copy.manifest.version !== EXPECTED_VERSION) {
      throw new Error(`Unverified bedrock-protocol version: ${copy.manifest.version} (expected ${EXPECTED_VERSION}); refusing to patch.`)
    }
    results.push(replaceFile(path.join(copy.root, 'src', 'createClient.js'), patchCreateClientSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'transforms', 'framer.js'), patchSnappyCompressionSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'connection.js'), patchBedrockConnectionOutboundDiagnosticsSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'client.js'), patchIdentityDomainSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'client', 'auth.js'), patchClientWorldConnectionProtocolSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'nethernet', 'signalling.js'), patchNethernetSignallingSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'nethernet', 'index.js'), patchNethernetTimeoutOptionsSource))
  }

  const nethernetCopies = resolveNethernetCopies(projectRoot, protocolCopies)
  if (!nethernetCopies.length) throw new Error('nethernet not found. Run npm install first.')
  for (const copy of nethernetCopies) {
    if (copy.manifest.version !== EXPECTED_NETHERNET_VERSION) {
      throw new Error(`Unverified nethernet version: ${copy.manifest.version} (expected ${EXPECTED_NETHERNET_VERSION}); refusing to patch.`)
    }
    results.push(replaceFile(path.join(copy.root, 'src', 'signalling', 'http.js'), patchHttpErrorSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'signalling', 'http.js'), patchHttpOfferDiagnosticsSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'signalling', 'sdpIdentity.js'), patchSdpIdentitySource))
    results.push(replaceFile(path.join(copy.root, 'src', 'signalling', 'sdpIdentity.js'), patchServerIdentityPublicKeySource))
    results.push(replaceFile(path.join(copy.root, 'src', 'client.js'), patchNethernetClientDiagnosticsSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'connection.js'), patchNethernetConnectionDiagnosticsSource))
  }
  return results
}

if (require.main === module) {
  try {
    const results = applyPatch()
    for (const result of results) {
      console.log(`[bedrock-bot-console] ${result.changed ? 'patched' : 'already patched'}: ${result.target}`)
    }
  } catch (error) {
    console.error(`[bedrock-bot-console] protocol patch failed: ${error.stack || error.message}`)
    process.exitCode = 1
  }
}

module.exports = {
  EXPECTED_VERSION,
  EXPECTED_NETHERNET_VERSION,
  ORIGINAL,
  REPLACEMENT,
  MARKER,
  IDENTITY_ORIGINAL,
  IDENTITY_REPLACEMENT,
  IDENTITY_MARKER,
  HTTP_ERROR_ORIGINAL,
  HTTP_ERROR_REPLACEMENT,
  HTTP_ERROR_MARKER,
  OFFER_DIAGNOSTIC_HELPER_MARKER,
  OFFER_DIAGNOSTIC_LOG_MARKER,
  OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL,
  OFFER_DIAGNOSTIC_FUNCTION_REPLACEMENT,
  OFFER_DIAGNOSTIC_FETCH_ORIGINAL,
  OFFER_DIAGNOSTIC_LOG_REPLACEMENT,
  OFFER_DIAGNOSTIC_HELPER_SOURCE,
  patchCreateClientSource,
  SNAPPY_COMPRESS_ORIGINAL,
  SNAPPY_COMPRESS_REPLACEMENT,
  SNAPPY_COMPRESS_MARKER,
  SNAPPY_DECOMPRESS_ORIGINAL,
  SNAPPY_DECOMPRESS_REPLACEMENT,
  SNAPPY_DECOMPRESS_MARKER,
  patchSnappyCompressionSource,
  patchIdentityDomainSource,
  patchHttpErrorSource,
  CLIENT_SERVICES_SIGNAL_ORIGINAL,
  CLIENT_SERVICES_SIGNAL_MARKER,
  CLIENT_SERVICES_SIGNAL_OPTIONS_ORIGINAL,
  CLIENT_SERVICES_SIGNAL_OPTIONS_MARKER,
  NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_ORIGINAL,
  CLIENT_CONNECTED_ORIGINAL,
  CLIENT_CONNECTED_MARKER,
  CLIENT_TIMEOUT_ORIGINAL,
  CLIENT_TIMEOUT_MARKER,
  NETHERNET_OPTIONS_ORIGINAL,
  NETHERNET_OPTIONS_MARKER,
  NETHERNET_SEND_RELIABLE_ORIGINAL,
  NETHERNET_SEND_RELIABLE_MARKER,
  patchClientConnectionDiagnosticsSource,
  patchClientSignallingOptionsSource,
  CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL,
  CLIENT_WORLD_CONNECTION_SELECTION_MARKER,
  patchClientWorldConnectionProtocolSource,
  patchNethernetSignallingSource,
  patchNethernetTimeoutOptionsSource,
  VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL,
  VERIFY_SERVER_IDENTITY_PUBLIC_KEY_MARKER,
  VERIFY_SERVER_IDENTITY_PUBLIC_KEY_REPLACEMENT,
  NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL,
  NETHERNET_CLIENT_SEND_ORIGINAL,
  NETHERNET_CLIENT_SEND_MARKER,
  NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_MARKER,
  NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL,
  patchNethernetClientDiagnosticsSource,
  NETHERNET_CONNECTION_RELIABLE_CHANNELS_ORIGINAL,
  NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_ORIGINAL,
  NETHERNET_CONNECTION_RECEIVE_ORIGINAL,
  BEDROCK_CONNECTION_WRITE_ORIGINAL,
  BEDROCK_CONNECTION_SEND_MCPE_ORIGINAL,
  patchBedrockConnectionOutboundDiagnosticsSource,
  patchNethernetConnectionDiagnosticsSource,
  patchServerIdentityPublicKeySource,
  patchHttpOfferDiagnosticsSource,
  applyPatch
}

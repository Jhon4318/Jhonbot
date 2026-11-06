'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const {
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
  NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL,
  patchNethernetClientDiagnosticsSource,
  patchClientSignallingOptionsSource,
  patchNethernetSignallingSource,
  patchClientConnectionDiagnosticsSource,
  patchNethernetTimeoutOptionsSource
} = require('../scripts/patch-bedrock-protocol')

test('adds safe stage diagnostics to Xbox services NetherNet connection flow', () => {
  const fixture = [
    'function connect (sessionData) {',
    CLIENT_SERVICES_SIGNAL_ORIGINAL,
    CLIENT_CONNECTED_ORIGINAL,
    '    }',
    CLIENT_TIMEOUT_ORIGINAL,
    '}'
  ].join('\n')

  const patched = patchClientConnectionDiagnosticsSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(CLIENT_SERVICES_SIGNAL_MARKER))
  assert.match(patched.source, new RegExp(CLIENT_CONNECTED_MARKER))
  assert.match(patched.source, new RegExp(CLIENT_TIMEOUT_MARKER))
  assert.match(patched.source, /Xbox services signalling is ready/)
  assert.match(patched.source, /WebRTC transport connected/)
  assert.match(patched.source, /WebRTC transport did not connect/)
  assert.doesNotMatch(patched.source, /SDP|JWT|candidate:/)
  assert.equal(patchClientConnectionDiagnosticsSource(patched.source).changed, false)
  assert.doesNotThrow(() => new vm.Script(patched.source))
})

test('forwards response and inactivity deadlines to NetherNet in both HTTP and services modes', () => {
  const fixture = [
    'function create (options) {',
    '  return new Client(0n, options.host, {',
    NETHERNET_OPTIONS_ORIGINAL,
    '  })',
    '}'
  ].join('\n')

  const patched = patchNethernetTimeoutOptionsSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(NETHERNET_OPTIONS_MARKER))
  assert.match(patched.source, /responseTimeoutMs: options.signallingConnectTimeout/)
  assert.match(patched.source, /inactivityTimeoutMs: options.inactivityTimeoutMs/)
  assert.match(patched.source, /onDiagnostics: options.onDiagnostics/)
  assert.match(patched.source, /options.signalling === 'http'/)
  assert.equal(patchNethernetTimeoutOptionsSource(patched.source).changed, false)
  assert.doesNotThrow(() => new vm.Script(patched.source))
})

test('keeps the longer timeouts scoped to friend-world mode', () => {
  const mainSource = fs.readFileSync(require.resolve('../src/main.js'), 'utf8')
  const friendStart = mainSource.indexOf("} else if (bot.targetType === 'friend-world') {")
  const friendEnd = mainSource.indexOf("} else if (bot.targetType === 'lan-world') {", friendStart)
  assert.ok(friendStart >= 0 && friendEnd > friendStart)
  const friendBlock = mainSource.slice(friendStart, friendEnd)
  assert.match(friendBlock, /signallingConnectTimeout: 30000/)
  assert.match(friendBlock, /inactivityTimeoutMs: 15000/)
  assert.match(friendBlock, /onDiagnostics: \(message\) => pushLog/)
  assert.match(friendBlock, /connectTimeout: 60000/)
  assert.doesNotMatch(mainSource.slice(friendEnd), /inactivityTimeoutMs: 15000/)
})


test('adds safe WebRTC negotiation and ICE diagnostics to the pinned NetherNet client', () => {
  const fixture = [
    'class Client extends EventEmitter {',
    '  constructor (options) {',
    NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL,
    '  }',
    NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL,
    '  }',
    '  armNegotiationTimeout (code, timeoutMs) {',
    NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_ORIGINAL,
    '  }',
    '  async handleAnswer (answer, rtcConnection) {',
    '    try {',
    NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_ORIGINAL,
    '    } catch (error) {}',
    '  }',
    '  attachStates (rtcConnection, isCurrent) {',
    '    rtcConnection.onconnectionstatechange = () => {',
    '      if (!isCurrent()) return',
    NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_ORIGINAL,
    '    }',
    '    rtcConnection.oniceconnectionstatechange = () => {',
    '      if (!isCurrent()) return',
    NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_ORIGINAL,
    '    }',
    NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_ORIGINAL,
    '  }',
    '  async createOffer (offer, rtcConnection, isCurrent, sdp) {',
    '    try {',
    NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_ORIGINAL,
    '    } catch (error) {}',
    NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL,
    '  }',
    '  signalError (networkId, code) {',
    NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL,
    '  }',
    '  isExpectedSignal (signal) {',
    NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_ORIGINAL,
    NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_ORIGINAL,
    '      return true',
    '    }',
    '  handleSignal (signal) {',
    NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL,
    '  }',
    '}'
  ].join('\n')

  const patched = patchNethernetClientDiagnosticsSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, /onDiagnostics === 'function'/)
  assert.match(patched.source, /Negotiation response timer started/)
  assert.match(patched.source, /Negotiation response timed out/)
  assert.match(patched.source, /Sending ConnectRequest/)
  assert.match(patched.source, /ConnectResponse received/)
  assert.match(patched.source, /WebRTC connection state:/)
  assert.match(patched.source, /ICE connection state:/)
  assert.match(patched.source, /Local ICE candidates gathered:/)
  assert.match(patched.source, /ICE gathering state:/)
  assert.match(patched.source, /Incoming signal ignored: connection ID mismatch/)
  assert.match(patched.source, /Incoming signal ignored: network ID mismatch/)
  assert.doesNotMatch(patched.source, /this\.reportDiagnostic\((?:localSdp|candidateLines|candidate\.candidate)/)
  assert.equal(patchNethernetClientDiagnosticsSource(patched.source).changed, false)
  assert.doesNotThrow(() => new vm.Script(patched.source))
})


test('forwards safe diagnostic callback into Xbox services signalling', () => {
  const fixture = ['new NethernetSignal(', CLIENT_SERVICES_SIGNAL_OPTIONS_ORIGINAL, ')'].join('\n')
  const patched = patchClientSignallingOptionsSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(CLIENT_SERVICES_SIGNAL_OPTIONS_MARKER))
  assert.match(patched.source, /onDiagnostics: this\.options\.nethernet\.onDiagnostics/)
  assert.equal(patchClientSignallingOptionsSource(patched.source).changed, false)
  assert.doesNotThrow(() => new vm.Script(patched.source))
})

test('adds privacy-safe Xbox signalling WebSocket diagnostics', () => {
  const fixture = [
    'class NethernetSignal {',
    '  constructor (options) {',
    NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_ORIGINAL,
    '  }',
    NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL,
    '    return true',
    '  }',
    '  onOpen () {',
    NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_ORIGINAL,
    '  }',
    '  onClose (code, reason) {',
    NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_ORIGINAL,
    '  }',
    '  async _requestTurnAuth () {',
    NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_ORIGINAL,
    '  }',
    '  onMessage (res) {',
    NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_ORIGINAL,
    '    debug(\'Received signalling message\', message.method || message.Type)',
    '    switch (message.Type) {',
    '      case LegacyMessageType.Credentials: {',
    NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_ORIGINAL,
    '        break',
    '      }',
    '      case LegacyMessageType.Signal: {',
    NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_ORIGINAL,
    '        break',
    '      }',
    '    }',
    '  }',
    '  _onJsonRpcMessage (message) {',
    '    if (message.method === \'Signaling_ReceiveMessage_v1_0\') {',
    NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_ORIGINAL,
    '    }',
    '  }',
    '  write (signal) {',
    '    const message = \'encoded\'',
    NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_ORIGINAL,
    '  }',
    NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL,
    '    return Promise.resolve()',
    '  }',
    '}'
  ].join('\n')
  const patched = patchNethernetSignallingSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, /Xbox signalling WebSocket opened/)
  assert.match(patched.source, /TURN credentials received/)
  assert.match(patched.source, /Incoming legacy signal parsed/)
  assert.match(patched.source, /Incoming JSON-RPC signal parsed/)
  assert.match(patched.source, /WebSocket send callback completed/)
  assert.match(patched.source, /Could not parse signal; message content omitted/)
  assert.doesNotMatch(patched.source, /debug\('Could not parse signal', message\.Message\)/)
  assert.doesNotMatch(patched.source, /reportDiagnostic\([^)]*(?:SDP|JWT|ICE password|connectionId|networkId)/i)
  assert.equal(patchNethernetSignallingSource(patched.source).changed, false)
  assert.doesNotThrow(() => new vm.Script(patched.source))
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const packageJson = require('../package.json')
const {
  EXPECTED_VERSION,
  EXPECTED_NETHERNET_VERSION,
  ORIGINAL,
  REPLACEMENT,
  MARKER,
  IDENTITY_ORIGINAL,
  HTTP_ERROR_ORIGINAL,
  OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL,
  OFFER_DIAGNOSTIC_FETCH_ORIGINAL,
  patchCreateClientSource,
  VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL,
  CLIENT_SERVICES_SIGNAL_ORIGINAL,
  CLIENT_SERVICES_SIGNAL_OPTIONS_ORIGINAL,
  CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_OPEN_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_CLOSE_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_TURN_AUTH_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_CREDENTIALS_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_LEGACY_SIGNAL_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_MESSAGE_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_JSONRPC_SIGNAL_ORIGINAL,
  NETHERNET_SIGNAL_DIAGNOSTIC_WRITE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_CONNECTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_UNEXPECTED_NETWORK_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ICE_GATHERING_ORIGINAL,
  CLIENT_CONNECTED_ORIGINAL,
  CLIENT_TIMEOUT_ORIGINAL,
  NETHERNET_OPTIONS_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_OPTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_METHOD_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_TIMEOUT_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ANSWER_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CONNECTION_STATE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_ICE_STATE_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_LOCAL_DESCRIPTION_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_CONNECT_REQUEST_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_SIGNAL_ERROR_ORIGINAL,
  NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL
} = require('../scripts/patch-bedrock-protocol')
const { ATTACH_IDENTITY_ORIGINAL } = require('../scripts/patch-nethernet-sdp')

const projectRoot = path.join(__dirname, '..')
const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main.js'), 'utf8')
const patchSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'patch-bedrock-protocol.js'), 'utf8')

test('expects the package version actually published by the pinned HTTP-capable commit', () => {
  assert.equal(EXPECTED_VERSION, '3.60.1')
})

test('patches the HTTP-capable bedrock-protocol discovery probe to pure-JavaScript RakNet', () => {
  const source = `async function ping () {\n  ${ORIGINAL}\n}`
  const result = patchCreateClientSource(source)
  assert.equal(result.changed, true)
  assert.equal(result.source.includes(REPLACEMENT), true)
  assert.ok(result.source.includes(MARKER))
  assert.ok(!result.source.includes(ORIGINAL))
  new vm.Script(result.source)
})

test('discovery patch is idempotent and validates the whole source', () => {
  const first = patchCreateClientSource(`const helper = 1\nasync function ping () {\n  ${ORIGINAL}\n}`)
  const second = patchCreateClientSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('fails closed when bedrock-protocol source changes unexpectedly', () => {
  assert.throws(() => patchCreateClientSource('function ping () {}'), /known code block not found/)
})

test('rejects a previously marked but syntactically corrupted source', () => {
  assert.throws(() => patchCreateClientSource(`// ${MARKER}\nconst = broken`), /Unexpected token/)
})

test('uses pure-JavaScript RakNet for actual legacy RakNet connections', () => {
  assert.match(mainSource, /raknetBackend:\s*'jsp-raknet'/)
  assert.match(mainSource, /useRaknetWorkers:\s*false/)
})

test('supports preflight transport discovery before creating the Mineflayer session', () => {
  assert.match(mainSource, /resolveServerConnectionOptions/ )
  assert.match(mainSource, /bedrockProtocol\.ping/ )
  assert.match(mainSource, /skipPing: true/ )
})

test('does not patch bedrock-protocol options.js', () => {
  assert.doesNotMatch(patchSource, /path\.join\(copy\.root, 'src', 'options\.js'\)/)
  assert.doesNotMatch(patchSource, /patchOptionsSource/)
})

test('patch runs after install and before app start', () => {
  assert.equal(packageJson.scripts.postinstall, 'node scripts/patch-bedrock-protocol.js')
  assert.equal(packageJson.scripts.prestart, 'node scripts/patch-bedrock-protocol.js')
})

test('pins the expected protocol patch target', () => {
  assert.equal(packageJson.dependencies['bedrock-protocol'], 'github:PrismarineJS/bedrock-protocol#b4160368b7e5272ccdd435f75459220c167fe4e4')
})

test('patches app and nested Mineflayer protocol copies without touching options.js', () => {
  const os = require('node:os')
  const { applyPatch } = require('../scripts/patch-bedrock-protocol')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-bot-patch-test-'))
  const writeProtocol = (root) => {
    fs.mkdirSync(path.join(root, 'src', 'nethernet'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src', 'client'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bedrock-protocol', version: EXPECTED_VERSION }))
    fs.writeFileSync(path.join(root, 'index.js'), "module.exports = require('./src/createClient.js')")
    fs.writeFileSync(path.join(root, 'src', 'createClient.js'), `${ORIGINAL}\n`)
    const clientSource = [
      'function setup (sessionData) {',
      IDENTITY_ORIGINAL,
      '  function connect (sessionData) {',
      CLIENT_SERVICES_SIGNAL_ORIGINAL,
      '    this.nethernet.signalling = new NethernetSignal(',
      CLIENT_SERVICES_SIGNAL_OPTIONS_ORIGINAL,
      '    )',
      CLIENT_CONNECTED_ORIGINAL,
      '    }',
      CLIENT_TIMEOUT_ORIGINAL,
      '  }',
      '}'
    ].join('\n')
    fs.writeFileSync(path.join(root, 'src', 'client.js'), clientSource)
    const worldAuthSource = [
      'async function worldAuthenticate (session, options) {',
      CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL,
      '}'
    ].join('\n')
    fs.writeFileSync(path.join(root, 'src', 'client', 'auth.js'), worldAuthSource)
    const servicesSignallingSource = [
      'const debug = () => {}',
      'class NethernetSignal {',
      '  constructor (options) {',
      NETHERNET_SIGNAL_DIAGNOSTIC_OPTIONS_ORIGINAL,
      '  }',
      NETHERNET_SIGNAL_DIAGNOSTIC_METHOD_ORIGINAL,
      '    return Promise.resolve()',
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
      '}',
      'module.exports = { NethernetSignal }'
    ].join('\n')
    fs.writeFileSync(path.join(root, 'src', 'nethernet', 'signalling.js'), servicesSignallingSource)
    const nethernetSource = [
      "const { Client } = require('nethernet')",
      "const { signallingUrl } = require('./http')",
      'function create (options) {',
      '  return new Client(0n, options.host, {',
      NETHERNET_OPTIONS_ORIGINAL,
      '  })',
      '}'
    ].join('\n')
    fs.writeFileSync(path.join(root, 'src', 'nethernet', 'index.js'), nethernetSource)
    fs.writeFileSync(path.join(root, 'src', 'options.js'), 'const mcData = require(\'minecraft-data\')\n')
  }
  try {
    const rootProtocol = path.join(tempRoot, 'node_modules', 'bedrock-protocol')
    const mineflayerRoot = path.join(tempRoot, 'node_modules', 'mineflayer')
    const nestedProtocol = path.join(mineflayerRoot, 'node_modules', 'bedrock-protocol')
    fs.mkdirSync(mineflayerRoot, { recursive: true })
    fs.writeFileSync(path.join(mineflayerRoot, 'package.json'), JSON.stringify({ name: 'mineflayer', version: '4.39.0' }))
    fs.writeFileSync(path.join(mineflayerRoot, 'index.js'), 'module.exports = {}')
    writeProtocol(rootProtocol)
    writeProtocol(nestedProtocol)

    const nethernetRoot = path.join(tempRoot, 'node_modules', 'nethernet')
    fs.mkdirSync(path.join(nethernetRoot, 'src', 'signalling'), { recursive: true })
    fs.writeFileSync(path.join(nethernetRoot, 'package.json'), JSON.stringify({ name: 'nethernet', version: EXPECTED_NETHERNET_VERSION }))
    fs.writeFileSync(path.join(nethernetRoot, 'index.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(nethernetRoot, 'src', 'signalling', 'http.js'), `const body = 'sdp'\n${OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL}\n${HTTP_ERROR_ORIGINAL}\n${OFFER_DIAGNOSTIC_FETCH_ORIGINAL}\n    method: 'POST',\n    body\n  })\n  return response\n}\nmodule.exports = { exchangeOffer }\n`)
    fs.writeFileSync(path.join(nethernetRoot, 'src', 'signalling', 'sdpIdentity.js'), `const crypto = require('crypto')\nfunction buildIdentityAttribute (sdp) { return 'identity:' + sdp }\n${ATTACH_IDENTITY_ORIGINAL}\nfunction verifyServerIdentity (claims) {\n${VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL}\n  return key\n}\nmodule.exports = { attachIdentity, verifyServerIdentity }\n`)
    const nethernetClientSource = [
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
      NETHERNET_CLIENT_DIAGNOSTIC_CANDIDATE_HANDLER_ORIGINAL,
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
      '    return true',
      '  }',
      '  handleSignal (signal) {',
      NETHERNET_CLIENT_DIAGNOSTIC_HANDLE_SIGNAL_ORIGINAL,
      '  }',
      '}'
    ].join('\n')
    fs.writeFileSync(path.join(nethernetRoot, 'src', 'client.js'), nethernetClientSource)

    const first = applyPatch(tempRoot)
    assert.equal(first.length, 15)
    for (const target of [rootProtocol, nestedProtocol]) {
      const source = fs.readFileSync(path.join(target, 'src', 'createClient.js'), 'utf8')
      assert.ok(source.includes(MARKER))
      assert.ok(!source.includes(ORIGINAL))
      const clientSource = fs.readFileSync(path.join(target, 'src', 'client.js'), 'utf8')
      assert.match(clientSource, /authorization\.franchise\.minecraft-services\.net/)
      assert.doesNotMatch(clientSource, /BEDROCK_BOT_CONSOLE_FRIEND_WORLD_SIGNAL_DIAGNOSTICS/)
      assert.doesNotMatch(clientSource, /BEDROCK_BOT_CONSOLE_FRIEND_WORLD_TRANSPORT_CONNECTED/)
      assert.doesNotMatch(clientSource, /BEDROCK_BOT_CONSOLE_FRIEND_WORLD_TIMEOUT_DIAGNOSTICS/)
      assert.doesNotMatch(clientSource, /BEDROCK_BOT_CONSOLE_FRIEND_WORLD_SIGNAL_OPTIONS/)
      const worldAuthSource = fs.readFileSync(path.join(target, 'src', 'client', 'auth.js'), 'utf8')
      assert.match(worldAuthSource, /BEDROCK_BOT_CONSOLE_XBOX_CONNECTIONTYPE_ROUTING/)
      assert.match(worldAuthSource, /_signallingProtocol = protocol/)
      assert.match(worldAuthSource, /targetIdKind=/)
      const serviceSignalSource = fs.readFileSync(path.join(target, 'src', 'nethernet', 'signalling.js'), 'utf8')
      assert.match(serviceSignalSource, /BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_OPTIONS/)
      assert.match(serviceSignalSource, /BEDROCK_BOT_CONSOLE_XBOX_SIGNAL_DIAGNOSTIC_WRITE/)
      assert.match(serviceSignalSource, /Incoming legacy signal parsed/)
      assert.match(serviceSignalSource, /Outgoing Xbox signalling WebSocket send callback completed/)
      const nethernetOptionsSource = fs.readFileSync(path.join(target, 'src', 'nethernet', 'index.js'), 'utf8')
      assert.match(nethernetOptionsSource, /BEDROCK_BOT_CONSOLE_NETHERNET_TIMEOUT_OPTIONS/)
      assert.match(nethernetOptionsSource, /inactivityTimeoutMs: options.inactivityTimeoutMs/)
      assert.equal(fs.readFileSync(path.join(target, 'src', 'options.js'), 'utf8'), 'const mcData = require(\'minecraft-data\')\n')
    }
    const identitySource = fs.readFileSync(path.join(nethernetRoot, 'src', 'signalling', 'sdpIdentity.js'), 'utf8')
    assert.match(identitySource, /BEDROCK_BOT_CONSOLE_SESSION_FINGERPRINT_SCOPE/)
    assert.match(identitySource, /normalizeFingerprintScope\(sdp\)/)
    const second = applyPatch(tempRoot)
    assert.equal(second.length, 15)
    assert.deepEqual(second.map(result => result.changed), Array(15).fill(false))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

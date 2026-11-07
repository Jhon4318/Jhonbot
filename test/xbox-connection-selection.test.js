'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

const {
  CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL,
  CLIENT_WORLD_CONNECTION_SELECTION_MARKER,
  patchClientWorldConnectionProtocolSource
} = require('../scripts/patch-bedrock-protocol')

function compilePatchedSelection () {
  const fixture = [
    'async function configureWorldConnection (session, options) {',
    CLIENT_WORLD_CONNECTION_SELECTION_ORIGINAL,
    '}',
    'module.exports = configureWorldConnection'
  ].join('\n')
  const patched = patchClientWorldConnectionProtocolSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(CLIENT_WORLD_CONNECTION_SELECTION_MARKER))
  assert.equal(patchClientWorldConnectionProtocolSource(patched.source).changed, false)
  assert.doesNotThrow(() => new vm.Script(patched.source))
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(patched.source, sandbox)
  return sandbox.module.exports
}

function makeSession (connections) {
  let activityCalls = 0
  return {
    current: { properties: { custom: { SupportedConnections: connections } } },
    async setActivity () { activityCalls++ },
    get activityCalls () { return activityCalls }
  }
}

test('routes ConnectionType 7 through JSON-RPC using PmsgId as the remote recipient', async () => {
  const configure = compilePatchedSelection()
  const networkId = '12345678901234567890'
  const pmsgId = 'a1234567-b123-c123-d123-e12345678901'
  const session = makeSession([{ ConnectionType: 7, NetherNetId: networkId, PmsgId: pmsgId }])
  const diagnostics = []
  const options = { nethernet: { onDiagnostics: value => diagnostics.push(value) } }

  await configure(session, options)

  assert.equal(options.nethernet._signallingProtocol, 'jsonrpc')
  assert.equal(options.nethernet.networkId, pmsgId)
  assert.equal(session.activityCalls, 1)
  assert.match(diagnostics[0], /ConnectionType=7, protocol=jsonrpc, targetIdKind=pmsg/)
  assert.doesNotMatch(diagnostics.join('\n'), new RegExp(networkId))
  assert.doesNotMatch(diagnostics.join('\n'), new RegExp(pmsgId))
})

test('routes legacy ConnectionType 3 using WebRTCNetworkId and BigInt', async () => {
  const configure = compilePatchedSelection()
  const webRtcNetworkId = '18446744073709551615'
  const session = makeSession([{ ConnectionType: 3, WebRTCNetworkId: webRtcNetworkId }])
  const diagnostics = []
  const options = { nethernet: { onDiagnostics: value => diagnostics.push(value) } }

  await configure(session, options)

  assert.equal(options.nethernet._signallingProtocol, 'legacy')
  assert.equal(options.nethernet.networkId, BigInt(webRtcNetworkId))
  assert.equal(session.activityCalls, 1)
  assert.match(diagnostics[0], /ConnectionType=3, protocol=legacy, targetIdKind=webrtc/)
  assert.doesNotMatch(diagnostics.join('\n'), new RegExp(webRtcNetworkId))
})

test('prefers a complete JSON-RPC connection when the session advertises both transports', async () => {
  const configure = compilePatchedSelection()
  const pmsgId = 'a1234567-b123-c123-d123-e12345678901'
  const session = makeSession([
    { ConnectionType: 3, WebRTCNetworkId: '987654321' },
    { ConnectionType: 7, NetherNetId: '123456789', PmsgId: pmsgId }
  ])
  const options = { nethernet: {} }

  await configure(session, options)

  assert.equal(options.nethernet._signallingProtocol, 'jsonrpc')
  assert.equal(options.nethernet.networkId, pmsgId)
})

test('fails clearly when a modern connection has no PmsgId and no usable legacy route exists', async () => {
  const configure = compilePatchedSelection()
  const session = makeSession([{ ConnectionType: 7, NetherNetId: '123456789' }])
  const options = { nethernet: {} }

  await assert.rejects(() => configure(session, options), /Could not find a supported Xbox world connection/)
  assert.equal(session.activityCalls, 0)
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const {
  CLIENT_SERVICES_SIGNAL_ORIGINAL,
  CLIENT_SERVICES_SIGNAL_MARKER,
  CLIENT_CONNECTED_ORIGINAL,
  CLIENT_CONNECTED_MARKER,
  CLIENT_TIMEOUT_ORIGINAL,
  CLIENT_TIMEOUT_MARKER,
  NETHERNET_OPTIONS_ORIGINAL,
  NETHERNET_OPTIONS_MARKER,
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
  ].join('\\n')

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
  ].join('\\n')

  const patched = patchNethernetTimeoutOptionsSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(NETHERNET_OPTIONS_MARKER))
  assert.match(patched.source, /responseTimeoutMs: options.signallingConnectTimeout/)
  assert.match(patched.source, /inactivityTimeoutMs: options.inactivityTimeoutMs/)
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
  assert.match(friendBlock, /connectTimeout: 60000/)
  assert.doesNotMatch(mainSource.slice(friendEnd), /inactivityTimeoutMs: 15000/)
})

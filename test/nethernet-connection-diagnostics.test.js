'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  NETHERNET_CONNECTION_RELIABLE_CHANNELS_ORIGINAL,
  NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_ORIGINAL,
  NETHERNET_CONNECTION_RECEIVE_ORIGINAL,
  patchNethernetConnectionDiagnosticsSource
} = require('../scripts/patch-bedrock-protocol')

function createConnectionFixture () {
  return [
    'class ConnectionFixture {',
    '  setChannels (reliable, unreliable) {',
    '    if (reliable) {',
    NETHERNET_CONNECTION_RELIABLE_CHANNELS_ORIGINAL,
    '    }',
    '    if (unreliable) {',
    NETHERNET_CONNECTION_UNRELIABLE_CHANNELS_ORIGINAL,
    '    }',
    '  }',
    '  handleMessage () {',
    '    if (this.promisedSegments > 0) {',
    '      return',
    '    }',
    '',
    NETHERNET_CONNECTION_RECEIVE_ORIGINAL,
    '  }',
    '}'
  ].join('\\n')
}

test('adds safe data-channel diagnostics to the pinned NetherNet connection source', () => {
  const original = createConnectionFixture()
  const patched = patchNethernetConnectionDiagnosticsSource(original)

  assert.equal(patched.changed, true)
  assert.match(patched.source, /Reliable data channel opened/)
  assert.match(patched.source, /Unreliable data channel opened/)
  assert.match(patched.source, /Reliable data channel payload received/)
  assert.match(patched.source, /receivedMessageCount <= 8/)
  assert.doesNotMatch(patched.source, /this\\.buf\\.toString|JSON\\.stringify\\(this\\.buf/)
})

test('data-channel diagnostic patch is idempotent', () => {
  const once = patchNethernetConnectionDiagnosticsSource(createConnectionFixture())
  const twice = patchNethernetConnectionDiagnosticsSource(once.source)

  assert.equal(once.changed, true)
  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
})

test('refuses to patch an unknown NetherNet connection layout', () => {
  assert.throws(
    () => patchNethernetConnectionDiagnosticsSource('class UnknownConnection {}'),
    /known code block not found/
  )
})

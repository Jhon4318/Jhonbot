'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MARKER,
  ATTACH_IDENTITY_ORIGINAL,
  normalizeFingerprintScope,
  patchSdpIdentitySource
} = require('../scripts/patch-nethernet-sdp')

function mediaSdp (fingerprints) {
  return [
    'v=0',
    'o=- 123 456 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...fingerprints.map(value => 'a=fingerprint:' + value),
    'a=setup:actpass',
    ''
  ].join('\r\n')
}

test('promotes a single media-level DTLS fingerprint into the session section', () => {
  const sdp = mediaSdp(['sha-256 AA:BB:CC'])
  const result = normalizeFingerprintScope(sdp)
  const lines = result.split(/\r?\n/)
  const fingerprintIndex = lines.findIndex(line => line.startsWith('a=fingerprint:'))
  const mediaIndex = lines.findIndex(line => line.startsWith('m='))
  assert.equal(fingerprintIndex >= 0 && fingerprintIndex < mediaIndex, true)
  assert.equal(lines.filter(line => line.startsWith('a=fingerprint:')).length, 1)
})

test('collapses repeated identical media fingerprints to one session-level attribute', () => {
  const sdp = [
    'v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=fingerprint:sha-256 AA:BB',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=fingerprint:sha-256 AA:BB', ''
  ].join('\r\n')
  const result = normalizeFingerprintScope(sdp)
  const lines = result.split(/\r?\n/)
  assert.equal(lines.filter(line => line.startsWith('a=fingerprint:')).length, 1)
  assert.equal(lines.findIndex(line => line.startsWith('a=fingerprint:')) < lines.findIndex(line => line.startsWith('m=')), true)
})

test('leaves different media fingerprints untouched to avoid changing DTLS semantics', () => {
  const sdp = mediaSdp(['sha-256 AA:BB', 'sha-384 CC:DD'])
  assert.equal(normalizeFingerprintScope(sdp), sdp)
})

test('does not promote a fingerprint across media sections that do not share it', () => {
  const sdp = [
    'v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=fingerprint:sha-256 AA:BB',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', ''
  ].join('\\r\\n')
  assert.equal(normalizeFingerprintScope(sdp), sdp)
})

test('leaves already session-level fingerprints untouched', () => {
  const sdp = [
    'v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0',
    'a=fingerprint:sha-256 AA:BB',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', ''
  ].join('\r\n')
  assert.equal(normalizeFingerprintScope(sdp), sdp)
})

test('patches the pinned NetherNet identity helper idempotently', () => {
  const fixture = [
    "'use strict'",
    'function buildIdentityAttribute () { return "identity" }',
    ATTACH_IDENTITY_ORIGINAL,
    'module.exports = { attachIdentity }'
  ].join('\n')
  const first = patchSdpIdentitySource(fixture)
  assert.equal(first.changed, true)
  assert.match(first.source, new RegExp(MARKER))
  assert.ok(first.source.includes('normalizeFingerprintScope(sdp)'))
  assert.equal(patchSdpIdentitySource(first.source).changed, false)
})

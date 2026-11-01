'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const {
  OFFER_DIAGNOSTIC_HELPER_MARKER,
  OFFER_DIAGNOSTIC_LOG_MARKER,
  OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL,
  OFFER_DIAGNOSTIC_FETCH_ORIGINAL,
  OFFER_DIAGNOSTIC_HELPER_SOURCE,
  patchHttpOfferDiagnosticsSource
} = require('../scripts/patch-bedrock-protocol')

function summarize (sdp) {
  const source = `${OFFER_DIAGNOSTIC_HELPER_SOURCE}\nJSON.stringify(summarizeOfferSdp(input))`
  return JSON.parse(vm.runInNewContext(source, { input: sdp, Buffer }))
}

test('adds bounded pre-POST SDP diagnostics and remains idempotent', () => {
  const fixture = [
    'const client = { http: {} }',
    "const body = 'sdp'",
    OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL,
    OFFER_DIAGNOSTIC_FETCH_ORIGINAL,
    "    method: 'POST',",
    '    body',
    '  })',
    '  return response',
    '}'
  ].join('\n')
  const first = patchHttpOfferDiagnosticsSource(fixture)
  assert.equal(first.changed, true)
  assert.match(first.source, new RegExp(OFFER_DIAGNOSTIC_HELPER_MARKER))
  assert.match(first.source, new RegExp(OFFER_DIAGNOSTIC_LOG_MARKER))
  assert.match(first.source, /summarizeOfferSdp\(body\)/)
  assert.doesNotMatch(first.source, /console\.info\([^\n]*body\s*[,)]/)
  assert.equal(patchHttpOfferDiagnosticsSource(first.source).changed, false)
})

test('summarizes SDP structure without exposing candidates, ICE secrets, DTLS hashes, or identity tokens', () => {
  const identity = Buffer.from(JSON.stringify({
    idp: { domain: 'https://authorization.franchise.minecraft-services.net', protocol: 'default' },
    assertion: JSON.stringify({ token: 'header.payload.signature', fingerprints: 'header..signature' })
  })).toString('base64')
  const sdp = [
    'v=0',
    'o=- 123 456 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    'a=fingerprint:sha-256 PRIVATE_DTLS_DIGEST',
    `a=identity:${identity}`,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:PRIVATE_UFRAG',
    'a=ice-pwd:PRIVATE_ICE_PASSWORD',
    'a=setup:actpass',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    'a=candidate:1 1 udp 123 192.0.2.10 5555 typ host generation 0 ufrag PRIVATE_UFRAG',
    'a=candidate:2 1 tcp 99 198.51.100.20 5556 typ relay tcptype passive',
    'a=end-of-candidates',
    ''
  ].join('\r\n')

  const summary = summarize(sdp)
  assert.equal(summary.startsWithV0, true)
  assert.deepEqual(summary.mediaSections, [{ kind: 'application', protocol: 'UDP/DTLS/SCTP' }])
  assert.equal(summary.hasApplicationDataChannel, true)
  assert.equal(summary.hasSctpPort, true)
  assert.equal(summary.fingerprintCount, 1)
  assert.equal(summary.sessionFingerprintCount, 1)
  assert.equal(summary.candidateCount, 2)
  assert.deepEqual(summary.candidateTypes, { host: 1, relay: 1 })
  assert.deepEqual(summary.candidateTransports, { tcp: 1, udp: 1 })
  assert.equal(summary.identityCount, 1)
  assert.equal(summary.identitySessionLevel, true)
  assert.equal(summary.identityEnvelopeValid, true)
  assert.equal(summary.identityAssertionValid, true)
  assert.equal(summary.identityProtocolDefault, true)
  assert.equal(summary.identityDomainMatchesMinecraftIssuer, true)

  const logged = JSON.stringify(summary)
  for (const secret of [
    '192.0.2.10', '198.51.100.20', '5555', '5556',
    'PRIVATE_UFRAG', 'PRIVATE_ICE_PASSWORD', 'PRIVATE_DTLS_DIGEST',
    'header.payload.signature', 'header..signature'
  ]) assert.equal(logged.includes(secret), false, `diagnostics leaked ${secret}`)
})

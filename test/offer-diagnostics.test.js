'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const crypto = require('node:crypto')
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
  return JSON.parse(vm.runInNewContext(source, { input: sdp, Buffer, require }))
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

test('summarizes a signed client identity without exposing token or signature material', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
  const cpk = publicKey.export({ format: 'jwk' })
  const b64url = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = [b64url({ alg: 'RS256' }), b64url({
    cpk,
    aud: 'api://auth-minecraft-services/multiplayer'
  }), 'TOKEN_SIGNATURE_REDACTED'].join('.')

  const digest = 'PRIVATE_DTLS_DIGEST'
  const fingerprintHeader = b64url({ alg: 'ES384' })
  const canonicalFingerprints = Buffer.from(JSON.stringify({
    fingerprint: [{ algorithm: 'sha-256', digest }]
  }), 'utf8').toString('base64url')
  const signingInput = fingerprintHeader + '.' + canonicalFingerprints
  const fingerprintSignature = crypto.sign('sha384', Buffer.from(signingInput, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  const fingerprints = fingerprintHeader + '..' + fingerprintSignature

  const identity = Buffer.from(JSON.stringify({
    idp: { domain: 'https://authorization.franchise.minecraft-services.net/', protocol: 'default' },
    assertion: JSON.stringify({ token, fingerprints })
  })).toString('base64')
  const sdp = [
    'v=0',
    'o=- 123 456 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    'a=identity:' + identity,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=fingerprint:sha-256 ' + digest,
    'a=ice-ufrag:PRIVATE_UFRAG',
    'a=ice-pwd:PRIVATE_ICE_PASSWORD',
    'a=setup:actpass',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    'a=candidate:1 1 udp 123 192.0.2.10 5555 typ host generation 0 ufrag PRIVATE_UFRAG',
    'a=end-of-candidates',
    ''
  ].join('\r\n')

  const summary = summarize(sdp)
  assert.equal(summary.startsWithV0, true)
  assert.deepEqual(summary.mediaSections, [{ kind: 'application', protocol: 'UDP/DTLS/SCTP' }])
  assert.equal(summary.hasApplicationDataChannel, true)
  assert.equal(summary.hasSctpPort, true)
  assert.equal(summary.hasMaxMessageSize, true)
  assert.equal(summary.hasBundleGroup, true)
  assert.equal(summary.candidateCount, 1)
  assert.deepEqual(summary.candidateTypes, { host: 1 })
  assert.deepEqual(summary.candidateTransports, { udp: 1 })
  assert.equal(summary.endOfCandidatesCount, 1)
  assert.equal(summary.identityCount, 1)
  assert.equal(summary.identitySessionLevel, true)
  assert.equal(summary.identityProtocolDefault, true)
  assert.equal(summary.identityEnvelopeValid, true)
  assert.equal(summary.identityAssertionValid, true)
  assert.equal(summary.identityDomainPresent, true)
  assert.equal(summary.identityDomainHasTrailingSlash, true)
  assert.equal(summary.identityDomainMatchesMinecraftIssuer, true)
  assert.equal(summary.sessionFingerprintCount, 0)
  assert.equal(summary.identityTokenJwtShapeValid, true)
  assert.equal(summary.identityTokenAlgorithm, 'RS256')
  assert.equal(summary.identityTokenAudienceMatchesMinecraftMultiplayer, true)
  assert.equal(summary.identityTokenCpkEncoding, 'jwk')
  assert.equal(summary.identityTokenCpkP384, true)
  assert.equal(summary.identityFingerprintJwsDetached, true)
  assert.equal(summary.identityFingerprintJwsAlgorithm, 'ES384')
  assert.equal(summary.identityFingerprintSignatureValidForTokenCpk, true)

  const tampered = summarize(sdp.replace(digest, 'TAMPERED_DTLS_DIGEST'))
  assert.equal(tampered.identityFingerprintSignatureValidForTokenCpk, false)

  const logged = JSON.stringify(summary)
  for (const secret of [
    'TOKEN_SIGNATURE_REDACTED', fingerprintSignature, identity, digest,
    'PRIVATE_UFRAG', 'PRIVATE_ICE_PASSWORD', '192.0.2.10', '5555'
  ]) assert.equal(logged.includes(secret), false, 'diagnostics must not expose token, signature, or network secrets')
})

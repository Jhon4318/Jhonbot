'use strict'

const vm = require('node:vm')

const MARKER = 'BEDROCK_BOT_CONSOLE_SESSION_FINGERPRINT_SCOPE'
const ATTACH_IDENTITY_ORIGINAL = `function attachIdentity (sdp, identity) {
  const value = buildIdentityAttribute(sdp, identity)
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(/\r?\n/).filter(l => !l.startsWith('a=identity:'))
  // Place it in the session section: right before the first media (m=) line.
  const mi = lines.findIndex(l => l.startsWith('m='))
  const idLine = 'a=identity:' + value
  if (mi === -1) lines.push(idLine)
  else lines.splice(mi, 0, idLine)
  return lines.join(eol)
}`

function normalizeFingerprintScope (sdp) {
  const source = String(sdp)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  const firstMediaIndex = lines.findIndex(line => line.startsWith('m='))
  if (firstMediaIndex < 0) return source

  const fingerprintLines = lines.filter(line => line.startsWith('a=fingerprint:'))
  const mediaFingerprintLines = lines.filter((line, index) => index > firstMediaIndex && line.startsWith('a=fingerprint:'))
  if (!mediaFingerprintLines.length) return source

  // Promote only a single common fingerprint. If media sections advertise
  // different fingerprints, preserve the original SDP rather than changing
  // its DTLS semantics.
  const uniqueFingerprints = [...new Set(fingerprintLines)]
  if (uniqueFingerprints.length !== 1) return source

  const normalized = lines.filter(line => !line.startsWith('a=fingerprint:'))
  const mediaIndex = normalized.findIndex(line => line.startsWith('m='))
  normalized.splice(mediaIndex, 0, uniqueFingerprints[0])
  return normalized.join(eol)
}

const NORMALIZER_SOURCE = normalizeFingerprintScope.toString()

const ATTACH_IDENTITY_REPLACEMENT = `${NORMALIZER_SOURCE}

// Insert (or replace) the session-level \`a=identity:<value>\` line into an offer SDP.
// Promote a common media-level DTLS fingerprint to the session section first,
// so the fingerprint is present before the identity assertion as in Mojang's
// NetherNet HTTP signalling format.
function attachIdentity (sdp, identity) {
  const normalizedSdp = normalizeFingerprintScope(sdp)
  const value = buildIdentityAttribute(normalizedSdp, identity)
  const eol = normalizedSdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = normalizedSdp.split(/\r?\n/).filter(l => !l.startsWith('a=identity:'))
  const mi = lines.findIndex(l => l.startsWith('m='))
  const idLine = 'a=identity:' + value
  if (mi === -1) lines.push(idLine)
  else lines.splice(mi, 0, idLine)
  return lines.join(eol)
}`

function patchSdpIdentitySource (source) {
  if (typeof source !== 'string') throw new TypeError('nethernet/src/signalling/sdpIdentity.js source must be a string')
  if (source.includes(MARKER)) {
    new vm.Script(source, { filename: 'nethernet/src/signalling/sdpIdentity.js' })
    return { source, changed: false }
  }
  const occurrences = source.split(ATTACH_IDENTITY_ORIGINAL).length - 1
  if (occurrences !== 1) {
    throw new Error(`nethernet/src/signalling/sdpIdentity.js: attachIdentity block not found (expected 1, found ${occurrences}); refusing to patch.`)
  }
  const replacement = ATTACH_IDENTITY_REPLACEMENT + ` // ${MARKER}`
  const patched = source.replace(ATTACH_IDENTITY_ORIGINAL, replacement)
  new vm.Script(patched, { filename: 'nethernet/src/signalling/sdpIdentity.js' })
  return { source: patched, changed: true }
}

module.exports = {
  MARKER,
  ATTACH_IDENTITY_ORIGINAL,
  ATTACH_IDENTITY_REPLACEMENT,
  normalizeFingerprintScope,
  patchSdpIdentitySource
}

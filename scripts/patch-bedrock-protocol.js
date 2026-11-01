'use strict'

// Keep the experimental NetherNet HTTP path safe and reproducible on Windows:
// 1) use pure-JS RakNet for discovery;
// 2) include the actual Minecraft services issuer in the SDP identity assertion;
// 3) preserve the server's HTTP error body for actionable diagnostics.

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const EXPECTED_VERSION = '3.60.1'
const EXPECTED_NETHERNET_VERSION = '1.1.2'

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


const OFFER_DIAGNOSTIC_HELPER_MARKER = 'BEDROCK_BOT_CONSOLE_OFFER_DIAGNOSTIC_HELPER'
const OFFER_DIAGNOSTIC_LOG_MARKER = 'BEDROCK_BOT_CONSOLE_OFFER_DIAGNOSTIC_LOG'
const OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL = 'async function exchangeOffer (client, signal) {'
const OFFER_DIAGNOSTIC_FETCH_ORIGINAL = '  const response = await fetch(new URL(`/v1/join/${client.networkId}`, url), {'

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

function patchHttpErrorSource (source) {
  return applySingleReplace(source, HTTP_ERROR_ORIGINAL, HTTP_ERROR_REPLACEMENT, HTTP_ERROR_MARKER, 'nethernet/src/signalling/http.js')
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
  return { source: log.source, changed: helper.changed || log.changed }
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
    results.push(replaceFile(path.join(copy.root, 'src', 'client.js'), patchIdentityDomainSource))
  }

  const nethernetCopies = resolveNethernetCopies(projectRoot, protocolCopies)
  if (!nethernetCopies.length) throw new Error('nethernet not found. Run npm install first.')
  for (const copy of nethernetCopies) {
    if (copy.manifest.version !== EXPECTED_NETHERNET_VERSION) {
      throw new Error(`Unverified nethernet version: ${copy.manifest.version} (expected ${EXPECTED_NETHERNET_VERSION}); refusing to patch.`)
    }
    results.push(replaceFile(path.join(copy.root, 'src', 'signalling', 'http.js'), patchHttpErrorSource))
    results.push(replaceFile(path.join(copy.root, 'src', 'signalling', 'http.js'), patchHttpOfferDiagnosticsSource))
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
  patchIdentityDomainSource,
  patchHttpErrorSource,
  patchHttpOfferDiagnosticsSource,
  applyPatch
}

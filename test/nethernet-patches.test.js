'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const vm = require('node:vm')
const {
  EXPECTED_VERSION,
  EXPECTED_NETHERNET_VERSION,
  IDENTITY_ORIGINAL,
  IDENTITY_MARKER,
  HTTP_ERROR_ORIGINAL,
  HTTP_ERROR_MARKER,
  HTTP_SERVER_KEYS_DESTRUCTURE_ORIGINAL,
  HTTP_SERVER_KEYS_DESTRUCTURE_MARKER,
  HTTP_SERVER_KEYS_TRUST_ORIGINAL,
  HTTP_SERVER_KEYS_TRUST_MARKER,
  NETHERNET_OPTIONS_ORIGINAL,
  NETHERNET_OPTIONS_MARKER,
  NETHERNET_SEND_RELIABLE_ORIGINAL,
  patchIdentityDomainSource,
  patchHttpErrorSource,
  patchHttpServerKeyVariantsSource,
  patchNethernetTimeoutOptionsSource,
  VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL,
  VERIFY_SERVER_IDENTITY_PUBLIC_KEY_MARKER,
  patchServerIdentityPublicKeySource
} = require('../scripts/patch-bedrock-protocol')

test('pins the exact bedrock-protocol and nethernet versions whose source is patched', () => {
  assert.equal(EXPECTED_VERSION, '3.60.1')
  assert.equal(EXPECTED_NETHERNET_VERSION, '1.1.2')
})

test('adds the Minecraft services issuer domain to the NetherNet identity assertion', () => {
  const fixture = `function connect () {\n      ${IDENTITY_ORIGINAL}\n    }`
  const patched = patchIdentityDomainSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, /domain: 'https:\/\/authorization\.franchise\.minecraft-services\.net\/'/)
  assert.match(patched.source, new RegExp(IDENTITY_MARKER))
  assert.equal(patchIdentityDomainSource(patched.source).changed, false)
})

test('migrates the previous missing-trailing-slash issuer patch in an existing install', () => {
  const previous = `function connect () {
    this.connection.nethernet.identity = {
      privateKey: this.ecdhKeyPair.privateKey,
      token: this.multiplayerToken,
      domain: 'https://authorization.franchise.minecraft-services.net'
    } // ${IDENTITY_MARKER}
  }`
  const migrated = patchIdentityDomainSource(previous)
  assert.equal(migrated.changed, true)
  assert.match(migrated.source, /domain: 'https:\/\/authorization\.franchise\.minecraft-services\.net\/'/)
  assert.equal(patchIdentityDomainSource(migrated.source).changed, false)
})

test('exposes bounded HTTP error response details without logging the SDP request body', () => {
  const fixture = `async function exchange () {\n${HTTP_ERROR_ORIGINAL}\n  return response.text()\n}`
  const patched = patchHttpErrorSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, /await response\.text\(\)/)
  assert.match(patched.source, /slice\(0, 600\)/)
  assert.match(patched.source, /x-request-id/)
  assert.match(patched.source, new RegExp(HTTP_ERROR_MARKER))
  assert.doesNotMatch(patched.source, /body: body/)
  assert.equal(patchHttpErrorSource(patched.source).changed, false)
})

test('patches NetherNet server identity verification to import DER SPKI and JWK CPK claims', () => {
  const fixture = [
    "const crypto = require('crypto')",
    'function importServerPublicKey (claims) {',
    VERIFY_SERVER_IDENTITY_PUBLIC_KEY_ORIGINAL,
    '  return key',
    '}',
    'module.exports = importServerPublicKey'
  ].join('\n')

  const patched = patchServerIdentityPublicKeySource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(VERIFY_SERVER_IDENTITY_PUBLIC_KEY_MARKER))
  assert.match(patched.source, /format: 'der', type: 'spki'/)
  assert.equal(patchServerIdentityPublicKeySource(patched.source).changed, false)

  const module = { exports: {} }
  vm.runInNewContext(patched.source, {
    Buffer,
    module,
    require: (name) => {
      assert.equal(name, 'crypto')
      return crypto
    }
  })

  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const derKey = module.exports({ cpk: der.toString('base64') })
  assert.equal(derKey.type, 'public')
  assert.equal(derKey.asymmetricKeyType, 'ec')
  assert.equal(derKey.asymmetricKeyDetails?.namedCurve, 'secp384r1')
  assert.deepEqual(derKey.export({ type: 'spki', format: 'der' }), der)

  const jwkKey = module.exports({ cpk: publicKey.export({ format: 'jwk' }) })
  assert.equal(jwkKey.type, 'public')
  assert.equal(jwkKey.asymmetricKeyType, 'ec')
  assert.equal(jwkKey.asymmetricKeyDetails?.namedCurve, 'secp384r1')

  const pemKey = module.exports({ cpk: publicKey.export({ type: 'spki', format: 'pem' }) })
  assert.equal(pemKey.asymmetricKeyType, 'ec')
  assert.throws(() => module.exports({ cpk: 'not-a-public-key' }), /Invalid Nethernet server identity public key encoding/)
  assert.throws(() => module.exports({ cpk: null }), /Unsupported Nethernet server identity public key format/)
})


test('forwards the list of trusted server keys through the Bedrock-NetherNet adapter', () => {
  const fixture = [
    'class NetTransport {',
    '  constructor (options) {',
    '    this.nethernet = {',
    NETHERNET_OPTIONS_ORIGINAL,
    '    }',
    '  }',
    NETHERNET_SEND_RELIABLE_ORIGINAL,
    '}'
  ].join('\n')
  const patched = patchNethernetTimeoutOptionsSource(fixture)
  assert.equal(patched.changed, true)
  assert.ok(patched.source.includes('serverKeys: options.serverKeys'))
  assert.match(patched.source, new RegExp(NETHERNET_OPTIONS_MARKER))
  assert.equal(patchNethernetTimeoutOptionsSource(patched.source).changed, false)
})

test('allows multiple explicitly trusted NetherNet server keys and prompts for unknown keys', () => {
  const fixture = [
    'async function exchangeOffer (client, url, answer) {',
    HTTP_SERVER_KEYS_DESTRUCTURE_ORIGINAL,
    HTTP_SERVER_KEYS_TRUST_ORIGINAL,
    '  return verified.sdp',
    '}'
  ].join('\n')
  const patched = patchHttpServerKeyVariantsSource(fixture)
  assert.equal(patched.changed, true)
  assert.match(patched.source, new RegExp(HTTP_SERVER_KEYS_DESTRUCTURE_MARKER))
  assert.ok(patched.source.includes('Array.isArray(serverKeys)'))
  assert.ok(patched.source.includes('knownServerKeys.includes(verified.fingerprint)'))
  assert.ok(patched.source.includes('onServerKey(verified.fingerprint, url.origin)'))
  assert.match(patched.source, new RegExp(HTTP_SERVER_KEYS_TRUST_MARKER))
  assert.equal(patchHttpServerKeyVariantsSource(patched.source).changed, false)
})


test('accepts a pinned account/backend key and explicitly asks before adding another', async () => {
  const fixture = [
    'async function exchangeOffer (client, answer, verifyServerIdentity) {',
    HTTP_SERVER_KEYS_DESTRUCTURE_ORIGINAL,
    HTTP_SERVER_KEYS_TRUST_ORIGINAL,
    '  return verified.sdp',
    '}',
    'module.exports = exchangeOffer'
  ].join('\n')
  const patched = patchHttpServerKeyVariantsSource(fixture)
  const module = { exports: {} }
  vm.runInNewContext(patched.source, { module })
  const exchangeOffer = module.exports
  const firstKey = `sha256:${'a'.repeat(64)}`
  const secondKey = `sha256:${'b'.repeat(64)}`
  let approvalCalls = 0
  const baseClient = {
    http: {
      serverKeys: [firstKey],
      onServerKey: async (fingerprint, origin) => {
        approvalCalls++
        assert.equal(fingerprint, secondKey)
        assert.equal(origin, 'https://pool.example')
        return true
      }
    }
  }
  const verify = (fingerprint) => () => ({ fingerprint, sdp: 'v=0' })
  baseClient.http.url = new URL('https://pool.example')
  assert.equal(await exchangeOffer(baseClient, null, verify(firstKey)), 'v=0')
  assert.equal(approvalCalls, 0)
  assert.equal(await exchangeOffer(baseClient, null, verify(secondKey)), 'v=0')
  assert.equal(approvalCalls, 1)

  baseClient.http.onServerKey = async () => false
  await assert.rejects(exchangeOffer(baseClient, null, verify(`sha256:${'c'.repeat(64)}`)), /Untrusted Nethernet server key/)
  assert.equal(approvalCalls, 1)
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  EXPECTED_VERSION,
  EXPECTED_NETHERNET_VERSION,
  IDENTITY_ORIGINAL,
  IDENTITY_MARKER,
  HTTP_ERROR_ORIGINAL,
  HTTP_ERROR_MARKER,
  patchIdentityDomainSource,
  patchHttpErrorSource
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

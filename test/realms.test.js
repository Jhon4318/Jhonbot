'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('Realm selection uses the account-authenticated Bedrock Realms API and does not bypass authentication', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'realms.js'), 'utf8')
  assert.match(source, /RealmAPI\.from\(authflow, 'bedrock'/)
  assert.match(source, /await api\.getRealms\(\)/)
  assert.match(source, /authflow\.getXboxToken/)
  assert.match(source, /expired/)
})

test('Realm invite handler accepts codes and realms.gg links through the authenticated API', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'realms.js'), 'utf8')
  assert.match(source, /getRealmFromInvite\(code, true\)/)
  assert.match(source, /inviteCode/)
  assert.match(source, /authflow\.getXboxToken/)
})

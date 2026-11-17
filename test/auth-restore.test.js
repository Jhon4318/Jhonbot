'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { restoreSavedAuthflow } = require('../src/auth-restore')

test('restores an Authflow from the existing encrypted cache without prompting again', async () => {
  const authflow = { getXboxToken: async () => ({ XSTSToken: 'token', userXUID: '123' }) }
  const result = await restoreSavedAuthflow({ id: 'bot-1' }, {
    hasCache: async id => id === 'bot-1',
    createAuthflow: () => authflow
  })
  assert.equal(result.restored, true)
  assert.equal(result.authflow, authflow)
  assert.equal(result.xbox.userXUID, '123')
})

test('does not create an Authflow when no saved cache exists', async () => {
  let created = false
  const result = await restoreSavedAuthflow({ id: 'bot-1' }, {
    hasCache: async () => false,
    createAuthflow: () => { created = true }
  })
  assert.deepEqual(result, { restored: false, reason: 'missing' })
  assert.equal(created, false)
})

test('rejects invalid or expired cached credentials', async () => {
  await assert.rejects(
    restoreSavedAuthflow({ id: 'bot-1' }, {
      hasCache: async () => true,
      createAuthflow: () => ({ getXboxToken: async () => ({}) })
    }),
    /有効なXboxトークン/
  )
})

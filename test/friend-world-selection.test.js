'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildFriendWorldIdentity, findMatchingFriendWorldSession } = require('../src/friend-world-selection')

test('friend world identity stores stable owner and world metadata', () => {
  const session = { customProperties: { worldName: 'Build World', hostName: 'Friend', ownerXuid: '123' }, sessionRef: { templateName: 'Bedrock' } }
  assert.deepEqual(buildFriendWorldIdentity(session), {
    worldId: '', ownerId: '123', worldName: 'build world', hostName: 'friend', templateName: 'bedrock'
  })
})

test('same world is auto-selected even when the session id changes', () => {
  const saved = { ownerId: '123', worldName: 'build world', hostName: 'friend' }
  const sessions = [
    { customProperties: { worldName: 'Other', hostName: 'Friend', ownerXuid: '999' } },
    { customProperties: { worldName: 'Build World', hostName: 'Friend', ownerXuid: '123' }, sessionRef: { id: 'new-session' } }
  ]
  const result = findMatchingFriendWorldSession(sessions, saved)
  assert.equal(result.index, 1)
})

test('duplicate worlds with the same identity are not selected ambiguously', () => {
  const saved = { ownerId: '123', worldName: 'build world' }
  const sessions = [
    { customProperties: { worldName: 'Build World', ownerXuid: '123' } },
    { customProperties: { worldName: 'Build World', ownerXuid: '123' } }
  ]
  assert.equal(findMatchingFriendWorldSession(sessions, saved), null)
})

test('world id is preferred when present', () => {
  const sessions = [
    { customProperties: { worldId: 'world-1', worldName: 'New Name' } },
    { customProperties: { worldId: 'world-2', worldName: 'Old Name' } }
  ]
  assert.equal(findMatchingFriendWorldSession(sessions, { worldId: 'world-1', worldName: 'Old Name' }).index, 0)
})

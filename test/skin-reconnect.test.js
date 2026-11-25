'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { reconnectWithSavedSkin } = require('../src/skin-reconnect')

test('connected Bot is disconnected, released, reconnected and awaited until spawn', async () => {
  const oldAgent = {}
  const bot = { id: 'bot-1', status: 'connected', agent: oldAgent }
  const calls = []
  const result = await reconnectWithSavedSkin(bot, {
    disconnect: async id => { calls.push(['disconnect', id]) },
    waitForRelease: async (target, previous) => { calls.push(['release', target.id, previous === oldAgent]) },
    connect: async id => { calls.push(['connect', id]) },
    waitForSpawn: async (target, previous) => { calls.push(['spawn', target.id, previous === oldAgent]) }
  })
  assert.deepEqual(calls, [
    ['disconnect', 'bot-1'],
    ['release', 'bot-1', true],
    ['connect', 'bot-1'],
    ['spawn', 'bot-1', true]
  ])
  assert.deepEqual(result, { reconnected: true })
})

test('disconnected Bot is saved for its next connect without forcing a reconnect', async () => {
  const result = await reconnectWithSavedSkin({ id: 'bot-2', status: 'disconnected', agent: null }, {})
  assert.equal(result.reconnected, false)
  assert.match(result.reason, /次回接続/)
})

test('reconnect failure is propagated instead of reporting that a skin was applied', async () => {
  const bot = { id: 'bot-3', status: 'connected', agent: {} }
  await assert.rejects(reconnectWithSavedSkin(bot, {
    disconnect: async () => {},
    waitForRelease: async () => {},
    connect: async () => { throw new Error('接続失敗') },
    waitForSpawn: async () => {}
  }), /接続失敗/)
})

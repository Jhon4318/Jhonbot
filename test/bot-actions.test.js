'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeChatMessage, createInventorySnapshot, normalizeDropRequest } = require('../src/bot-actions')

test('normalizes world chat text and preserves slash commands', () => {
  assert.equal(normalizeChatMessage('  hello world  '), 'hello world')
  assert.equal(normalizeChatMessage('/say ready'), '/say ready')
})

test('rejects empty, non-string and overlong chat messages', () => {
  assert.throws(() => normalizeChatMessage('   '), /チャット内容を入力/)
  assert.throws(() => normalizeChatMessage(123), /文字列/)
  assert.throws(() => normalizeChatMessage('x'.repeat(257)), /256文字以内/)
})

test('creates a sorted snapshot of main inventory and hotbar items only', () => {
  const slots = Array(46).fill(null)
  slots[36] = { slot: 36, name: 'stone', displayName: 'Stone', count: 64, type: 1, metadata: 0 }
  slots[12] = { slot: 12, name: 'apple', displayName: 'Apple', count: 3, type: 260, metadata: 0 }
  slots[5] = { slot: 5, name: 'helmet', displayName: 'Helmet', count: 1, type: 298, metadata: 0 }
  const result = createInventorySnapshot({ inventory: { items: () => [slots[36], slots[12], slots[5], null] } })
  assert.deepEqual(result.map(item => item.slot), [12, 36])
  assert.equal(result[0].displayName, 'Apple')
  assert.equal(result[1].count, 64)
})

test('normalizes a valid partial item drop from one exact slot', () => {
  const item = { slot: 36, name: 'stone', count: 64, stackId: 9 }
  const inventory = { slots: Array(46).fill(null) }
  inventory.slots[36] = item
  assert.deepEqual(normalizeDropRequest({ slot: 36, count: '16' }, inventory), { slot: 36, count: 16, item })
})

test('defaults drop count to the full stack when count is omitted', () => {
  const item = { slot: 14, name: 'apple', count: 3 }
  const inventory = { slots: Array(46).fill(null) }
  inventory.slots[14] = item
  assert.deepEqual(normalizeDropRequest({ slot: 14 }, inventory), { slot: 14, count: 3, item })
})

test('rejects invalid slots, empty slots and invalid drop counts', () => {
  const inventory = { slots: Array(46).fill(null) }
  inventory.slots[36] = { slot: 36, name: 'stone', count: 8 }
  assert.throws(() => normalizeDropRequest({ slot: 5, count: 1 }, inventory), /スロットが不正/)
  assert.throws(() => normalizeDropRequest({ slot: 10, count: 1 }, inventory), /アイテムがありません/)
  assert.throws(() => normalizeDropRequest({ slot: 36, count: 0 }, inventory), /1〜8個/)
  assert.throws(() => normalizeDropRequest({ slot: 36, count: 9 }, inventory), /1〜8個/)
  assert.throws(() => normalizeDropRequest({ slot: 36, count: 1.5 }, inventory), /1〜8個/)
})

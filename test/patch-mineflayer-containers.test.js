'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MARKER,
  ORIGINAL,
  patchContainerDepositSource
} = require('../scripts/patch-mineflayer-bedrock-containers')

const fixture = [
  '  bot.deposit = async (itemType, metadata = null, count = null) => {',
  '    const w = bot.currentWindow',
  '    const src = resolveInvItem(itemType)',
  ORIGINAL,
  "      destination: { slot_type: { container_id: 'container' }, slot: destSlot, stack_id: 0 }",
  '    }])',
  '    await wait(150)',
  '    return response',
  '  }'
].join('\n')

test('patches Bedrock container deposit to merge a matching partial stack and cap moved count', () => {
  const result = patchContainerDepositSource(fixture)
  assert.equal(result.changed, true)
  assert.match(result.source, /mergeSlot/)
  assert.match(result.source, /destItem\?\.stackId \?\? 0/)
  assert.match(result.source, /Math\.min\(Number\(requestedCount\)/)
  assert.match(result.source, /movedCount/)
  assert.ok(result.source.includes(MARKER))
})

test('container deposit patch is idempotent', () => {
  const once = patchContainerDepositSource(fixture)
  const twice = patchContainerDepositSource(once.source)
  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
})

test('refuses to patch an unexpected Mineflayer source version', () => {
  assert.throws(() => patchContainerDepositSource('module.exports = function inject () {}'), /pinned Mineflayer source/)
})

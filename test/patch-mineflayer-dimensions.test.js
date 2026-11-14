'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MARKER,
  patchClientInputSource
} = require('../scripts/patch-mineflayer-bedrock-dimensions')

const fixture = [
  '  function send () {',
  '    if (!bot.entity) return',
  '    const pitch = conv.toNotchianPitch(bot.entity.pitch || 0)',
  "    if (bot._creativeFlying) { if (packet.tick != null) { anchorTick = toTick(packet.tick); anchorTime = Date.now() } return }",
  '    const oldPos = new Vec3(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z)',
  '    const feetY = pos.y - (bot.entity.eyeHeight || 1.62)',
  '    const drift = Math.hypot(pos.x - bot.entity.position.x, pos.z - bot.entity.position.z)',
  '    bot.entity.position.y = feetY',
  '    if (drift > 0.5) {',
  '      bot.entity.position.x = pos.x',
  '      bot.entity.position.z = pos.z',
  '      if (bot.entity.velocity) { bot.entity.velocity.x = 0; bot.entity.velocity.z = 0 }',
  '    }',
  '    if (packet.velocity) bot.entity.velocity = new Vec3(packet.velocity.x || 0, packet.velocity.y || 0, packet.velocity.z || 0)'
].join('\n')

test('patches Bedrock input suspension, creative correction and full portal coordinate correction', () => {
  const result = patchClientInputSource(fixture)
  assert.equal(result.changed, true)
  assert.ok(result.source.includes(MARKER))
  assert.match(result.source, /if \(bot\._jhonDimensionTransition\) return/)
  assert.match(result.source, /bot\._jhonResetInputTick\) \{ lastEmittedTick = null/)
  assert.match(result.source, /bot\._creativeFlying && !bot\._jhonDimensionTransition/)
  assert.match(result.source, /bot\._jhonDimensionTransition \|\| drift > 0\.5/)
})

test('dimension input patch is idempotent', () => {
  const first = patchClientInputSource(fixture)
  const second = patchClientInputSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('dimension input patch refuses an unknown Mineflayer source version', () => {
  assert.throws(() => patchClientInputSource('function send () {}'), /refusing to patch an unknown version/)
})

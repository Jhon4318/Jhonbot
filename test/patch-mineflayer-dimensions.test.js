'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MARKER,
  INPUT_MODE_MARKER,
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

test('patches dimension sync and adds a chunk-hold player-input guard', () => {
  const result = patchClientInputSource(fixture)
  assert.equal(result.changed, true)
  assert.ok(result.source.includes(MARKER))
  assert.ok(result.source.includes(INPUT_MODE_MARKER))
  assert.match(result.source, /if \(bot\._jhonDimensionTransition\) return/)
  assert.match(result.source, /if \(bot\._jhonDisablePlayerAuthInput\) return/)
  assert.match(result.source, /bot\._jhonResetInputTick\) \{ lastEmittedTick = null/)
  assert.match(result.source, /bot\._creativeFlying && !bot\._jhonDimensionTransition/)
  assert.match(result.source, /bot\._jhonDimensionTransition \|\| drift > 0\.5/)
})

test('adds the input-mode guard to an existing dimension-sync patch', () => {
  const oldPatched = fixture
    .replace('  function send () {\n    if (!bot.entity) return', [
      '  function send () {',
      '    if (bot._jhonDimensionTransition) return // ' + MARKER + ': do not send old-dimension input while BDS is switching worlds',
      '    if (bot._jhonResetInputTick) { lastEmittedTick = null; bot._jhonResetInputTick = false }',
      '    if (!bot.entity) return'
    ].join('\n'))
    .replace("    if (bot._creativeFlying) { if (packet.tick != null) { anchorTick = toTick(packet.tick); anchorTime = Date.now() } return }", "    if (bot._creativeFlying && !bot._jhonDimensionTransition) { if (packet.tick != null) { anchorTick = toTick(packet.tick); anchorTime = Date.now() } return } // " + MARKER)
    .replace('    if (drift > 0.5) {', '    if (bot._jhonDimensionTransition || drift > 0.5) { // ' + MARKER)
  const result = patchClientInputSource(oldPatched)
  assert.equal(result.changed, true)
  assert.ok(result.source.includes(INPUT_MODE_MARKER))
})

test('player-input patch is idempotent', () => {
  const first = patchClientInputSource(fixture)
  const second = patchClientInputSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('dimension input patch refuses an unknown Mineflayer source version', () => {
  assert.throws(() => patchClientInputSource('function send () {}'), /refusing to patch an unknown version/)
})

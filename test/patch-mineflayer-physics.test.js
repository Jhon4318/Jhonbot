'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PHYSICS_INPUT_MODE_MARKER,
  patchPhysicsSource
} = require('../scripts/patch-mineflayer-bedrock-dimensions')

const fixture = [
  '  function tickPhysics (now) {',
  "    if (bot._client.state !== 'play') return // do nothing outside of the play state (e.g. server transfer configuration phase)",
  '    if (!bot.entity?.position || !Number.isFinite(bot.entity.position.x)) return // entity not ready',
  '    if (bot.blockAt(bot.entity.position) == null) return // check if chunk is unloaded',
  '    if (bot.physicsEnabled && shouldUsePhysics) {',
  '      physics.simulatePlayer(new PlayerState(bot, controlState), world).apply(bot)',
  "      bot.emit('physicsTick')",
  "      bot.emit('physicTick')",
  '    }',
  '    if (shouldUsePhysics) {',
  '      updatePosition(now)',
  '    }',
  '  }'
].join('\n')

test('suppresses Mineflayer physics and periodic position/look/flying output in chunk-hold mode', () => {
  const result = patchPhysicsSource(fixture)
  assert.equal(result.changed, true)
  assert.ok(result.source.includes(PHYSICS_INPUT_MODE_MARKER))
  assert.match(result.source, /if \(bot\._jhonDisablePlayerAuthInput\) return/)
})

test('physics input-mode patch is idempotent', () => {
  const first = patchPhysicsSource(fixture)
  const second = patchPhysicsSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('physics input-mode patch refuses an unknown source', () => {
  assert.throws(() => patchPhysicsSource('function tickPhysics () {}'), /refusing to patch an unknown version/)
})

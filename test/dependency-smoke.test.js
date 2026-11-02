'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

// Requiring Mineflayer loads bedrock-protocol, NetherNet, werift and the
// binary-data module chain used by Bedrock connection setup. Keep this as a
// startup smoke test so a broken transitive package cannot ship in Setup.exe.
test('loads the Mineflayer Bedrock runtime dependency chain', () => {
  const mineflayer = require('mineflayer')
  assert.ok(mineflayer && typeof mineflayer === 'object')
  assert.equal(typeof mineflayer.createBot, 'function')
})

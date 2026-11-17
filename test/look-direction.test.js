'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeLookDirection, toMineflayerLookRadians, applyLookDirection } = require('../src/look-direction')

test('validates degree-based yaw and pitch ranges', () => {
  assert.deepEqual(normalizeLookDirection({ yawDeg: -90, pitchDeg: 35.5 }), { yawDeg: -90, pitchDeg: 35.5 })
  assert.throws(() => normalizeLookDirection({ yawDeg: 181, pitchDeg: 0 }), /Yaw/)
  assert.throws(() => normalizeLookDirection({ yawDeg: 0, pitchDeg: -91 }), /Pitch/)
  assert.throws(() => normalizeLookDirection({ yawDeg: '', pitchDeg: 0 }), /Yaw/)
})

test('converts Bedrock-native angles to Mineflayer radians', () => {
  const westAndDown = toMineflayerLookRadians({ yawDeg: 90, pitchDeg: 45 })
  assert.ok(Math.abs(westAndDown.yaw - Math.PI / 2) < 1e-12)
  assert.ok(Math.abs(westAndDown.pitch + Math.PI / 4) < 1e-12)

  const southAndLevel = toMineflayerLookRadians({ yawDeg: 0, pitchDeg: 0 })
  assert.ok(Math.abs(southAndLevel.yaw - Math.PI) < 1e-12)
  assert.equal(southAndLevel.pitch, 0)

  const northAndLevel = toMineflayerLookRadians({ yawDeg: 180, pitchDeg: 0 })
  assert.equal(northAndLevel.yaw, 0)
})

test('applies the requested direction with force enabled', async () => {
  let received
  const agent = { async look (...args) { received = args } }
  const result = await applyLookDirection(agent, { yawDeg: 90, pitchDeg: 90 })
  assert.deepEqual(result, { yawDeg: 90, pitchDeg: 90 })
  assert.ok(Math.abs(received[0] - Math.PI / 2) < 1e-12)
  assert.ok(Math.abs(received[1] + Math.PI / 2) < 1e-12)
  assert.equal(received[2], true)
})

test('fails clearly when the look API is unavailable', async () => {
  await assert.rejects(() => applyLookDirection({}, { yawDeg: 0, pitchDeg: 0 }), /視点変更API/)
})

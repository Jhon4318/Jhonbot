'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateControl, normalizeCoordinates } = require('../src/control-validation')

test('allows only supported movement controls', () => {
  for (const key of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
    assert.equal(validateControl(key), key)
  }
  assert.throws(() => validateControl('teleport'), /不明な移動操作/)
})

test('normalizes finite coordinate inputs', () => {
  assert.deepEqual(normalizeCoordinates({ x: '12.5', y: '64', z: '-3' }), { x: 12.5, y: 64, z: -3 })
})

test('rejects missing, non-finite and out-of-world coordinate values', () => {
  assert.throws(() => normalizeCoordinates({ x: 'nope', y: 64, z: 0 }), /X座標/)
  assert.throws(() => normalizeCoordinates({ x: 0, y: Infinity, z: 0 }), /Y座標/)
  assert.throws(() => normalizeCoordinates({ x: 30000001, y: 64, z: 0 }), /X座標/)
})

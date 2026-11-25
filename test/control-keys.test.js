'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { HOLD_KEYS, TOGGLE_KEYS } = require('../src/control-keys')

test('movement keys remain hold controls', () => {
  assert.deepEqual(HOLD_KEYS, { KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right', Space: 'jump' })
})

test('Control toggles sprint and Shift toggles sneak on both sides of the keyboard', () => {
  assert.deepEqual(TOGGLE_KEYS, {
    ControlLeft: 'sprint', ControlRight: 'sprint',
    ShiftLeft: 'sneak', ShiftRight: 'sneak'
  })
})

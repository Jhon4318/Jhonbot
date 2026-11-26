'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
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

test('control key browser script does not collide with renderer top-level declarations', () => {
  const source = fs.readFileSync(require.resolve('../src/control-keys'), 'utf8')
  const context = vm.createContext({ window: {} })

  new vm.Script(source, { filename: 'control-keys.js' }).runInContext(context)

  // renderer.js is another classic script and declares its own top-level const api.
  // This must remain valid after control-keys.js has executed in the same page.
  assert.doesNotThrow(() => {
    new vm.Script('const api = window.botApp || {}; window.rendererBootstrapWorked = true', {
      filename: 'renderer-bootstrap.js'
    }).runInContext(context)
  })
  assert.equal(context.window.rendererBootstrapWorked, true)
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.botControlKeys)), {
    HOLD_KEYS: { KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right', Space: 'jump' },
    TOGGLE_KEYS: {
      ControlLeft: 'sprint', ControlRight: 'sprint',
      ShiftLeft: 'sneak', ShiftRight: 'sneak'
    }
  })
})

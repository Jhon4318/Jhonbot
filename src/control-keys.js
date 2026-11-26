'use strict'

;(function exposeControlKeys (root) {
  const HOLD_KEYS = Object.freeze({
    KeyW: 'forward',
    KeyA: 'left',
    KeyS: 'back',
    KeyD: 'right',
    Space: 'jump'
  })
  const TOGGLE_KEYS = Object.freeze({
    ControlLeft: 'sprint',
    ControlRight: 'sprint',
    ShiftLeft: 'sneak',
    ShiftRight: 'sneak'
  })

  const api = { HOLD_KEYS, TOGGLE_KEYS }
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.botControlKeys = api
})(typeof window !== 'undefined' ? window : null)

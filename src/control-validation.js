'use strict'

const ALLOWED_CONTROLS = new Set(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'])

function validateControl (control) {
  if (!ALLOWED_CONTROLS.has(control)) throw new Error('不明な移動操作です。')
  return control
}

function validCoordinate (value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > 30000000) {
    throw new Error(`${name}は-30,000,000〜30,000,000の数値で入力してください。`)
  }
  return number
}

function normalizeCoordinates (input) {
  return {
    x: validCoordinate(input?.x, 'X座標'),
    y: validCoordinate(input?.y, 'Y座標'),
    z: validCoordinate(input?.z, 'Z座標')
  }
}

module.exports = { validateControl, validCoordinate, normalizeCoordinates }

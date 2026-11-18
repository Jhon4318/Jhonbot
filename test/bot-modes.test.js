'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BOT_MOVEMENT_MODES,
  normalizeBotMovementMode,
  suppressPlayerAuthInput,
  requiresPlayerInput
} = require('../src/bot-modes')

test('defaults unknown and missing modes to chunk-hold', () => {
  assert.equal(normalizeBotMovementMode(undefined), BOT_MOVEMENT_MODES.CHUNK_HOLD)
  assert.equal(normalizeBotMovementMode('unknown'), BOT_MOVEMENT_MODES.CHUNK_HOLD)
  assert.equal(suppressPlayerAuthInput(undefined), true)
  assert.equal(requiresPlayerInput(undefined), false)
})

test('player mode enables player input packets', () => {
  assert.equal(normalizeBotMovementMode('player'), BOT_MOVEMENT_MODES.PLAYER)
  assert.equal(suppressPlayerAuthInput('player'), false)
  assert.equal(requiresPlayerInput('player'), true)
})

test('chunk-hold mode suppresses player input packets', () => {
  assert.equal(normalizeBotMovementMode('chunk-hold'), BOT_MOVEMENT_MODES.CHUNK_HOLD)
  assert.equal(suppressPlayerAuthInput('chunk-hold'), true)
  assert.equal(requiresPlayerInput('chunk-hold'), false)
})

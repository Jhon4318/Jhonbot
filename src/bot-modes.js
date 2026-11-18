'use strict'

const BOT_MOVEMENT_MODES = Object.freeze({
  CHUNK_HOLD: 'chunk-hold',
  PLAYER: 'player'
})

function normalizeBotMovementMode (value) {
  return value === BOT_MOVEMENT_MODES.PLAYER
    ? BOT_MOVEMENT_MODES.PLAYER
    : BOT_MOVEMENT_MODES.CHUNK_HOLD
}

function suppressPlayerAuthInput (value) {
  return normalizeBotMovementMode(value) === BOT_MOVEMENT_MODES.CHUNK_HOLD
}

function requiresPlayerInput (value) {
  return normalizeBotMovementMode(value) === BOT_MOVEMENT_MODES.PLAYER
}

module.exports = { BOT_MOVEMENT_MODES, normalizeBotMovementMode, suppressPlayerAuthInput, requiresPlayerInput }

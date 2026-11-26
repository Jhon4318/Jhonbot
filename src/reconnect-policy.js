'use strict'

function shouldAutoSelectPreviousFriendWorld (isAutomaticReconnect) {
  return isAutomaticReconnect === true
}

function getReconnectableGuestBots (guests, parentBotId) {
  if (!Array.isArray(guests) || !parentBotId) return []
  return guests
    .filter(guest =>
      guest &&
      guest.parentBotId === parentBotId &&
      guest.autoReconnectEligible === true &&
      guest.manualDisconnect !== true &&
      !guest.agent &&
      !guest.client &&
      !guest.connectionStarting
    )
    .sort((a, b) => Number(a.subClientId) - Number(b.subClientId))
}

function captureModuleResumeState (bot) {
  if (!bot || typeof bot !== 'object') return null
  const state = {
    itemUse: bot.itemUseRunning === true,
    itemUseSlot: Number.isInteger(bot.itemUseSlot) ? bot.itemUseSlot : null,
    containerSupply: bot.containerSupplyRunning === true,
    autoFishing: bot.autoFishingRunning === true,
    lookDirection: bot.modules?.lookDirection?.assigned === true && String(bot.lookDirectionStatus || '').startsWith('適用済み')
      ? {
          yawDeg: bot.modules.lookDirection.yawDeg,
          pitchDeg: bot.modules.lookDirection.pitchDeg
        }
      : null
  }
  return state.itemUse || state.containerSupply || state.autoFishing || state.lookDirection ? state : null
}

function hasModuleResumeState (state) {
  return !!(state && (state.itemUse || state.containerSupply || state.autoFishing || state.lookDirection))
}

module.exports = {
  shouldAutoSelectPreviousFriendWorld,
  getReconnectableGuestBots,
  captureModuleResumeState,
  hasModuleResumeState
}

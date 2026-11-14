'use strict'

const DEFAULT_MAX_SUB_CLIENTS = 3

function nextGuestSubClientId (bots, parentBotId, maxSubClients = DEFAULT_MAX_SUB_CLIENTS) {
  const used = new Set()
  for (const bot of bots || []) {
    if (bot?.parentBotId !== parentBotId) continue
    const slot = Number(bot.subClientId)
    if (Number.isInteger(slot) && slot >= 1 && slot <= maxSubClients) used.add(slot)
  }
  for (let slot = 1; slot <= maxSubClients; slot++) {
    if (!used.has(slot)) return slot
  }
  return null
}

function resolveGuestLabel (parentLabel, subClientId, requestedLabel) {
  const custom = String(requestedLabel ?? '').trim()
  if (custom.length > 32) throw new Error('ゲストBot名は32文字以内で入力してください。')
  return custom || `${String(parentLabel || '').trim()} (${subClientId})`
}

module.exports = { nextGuestSubClientId, resolveGuestLabel }

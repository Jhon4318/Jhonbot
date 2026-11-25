'use strict'

async function reconnectWithSavedSkin (bot, actions) {
  if (!bot || bot.status !== 'connected' || !bot.agent) {
    return { reconnected: false, reason: 'Botが接続中ではありません。次回接続時にスキンを適用します。' }
  }
  const previousAgent = bot.agent
  await actions.disconnect(bot.id)
  await actions.waitForRelease(bot, previousAgent)
  await actions.connect(bot.id)
  await actions.waitForSpawn(bot, previousAgent)
  return { reconnected: true }
}

module.exports = { reconnectWithSavedSkin }

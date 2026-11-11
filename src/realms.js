'use strict'

const { createRequire } = require('node:module')
const bedrockRequire = createRequire(require.resolve('bedrock-protocol'))
const { RealmAPI } = bedrockRequire('prismarine-realms')

async function listRealms (authflow, minecraftVersion = '1.26.60') {
  if (!authflow || typeof authflow.getXboxToken !== 'function') {
    throw new Error('このBotのMicrosoft / Xbox認証が完了していません。')
  }
  const api = RealmAPI.from(authflow, 'bedrock', { minecraftVersion })
  const realms = await api.getRealms()
  return (Array.isArray(realms) ? realms : []).map(realm => ({
    id: String(realm.id),
    name: String(realm.name || realm.motd || `Realm ${realm.id}`),
    state: String(realm.state || 'unknown'),
    owner: String(realm.owner || ''),
    expired: realm.expired === true,
    players: Array.isArray(realm.players) ? realm.players.length : null,
    maxPlayers: Number.isInteger(realm.maxPlayers) ? realm.maxPlayers : null
  })).filter(realm => /^\d+$/.test(realm.id))
}

module.exports = { listRealms }

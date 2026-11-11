'use strict'

const { createRequire } = require('node:module')
const bedrockRequire = createRequire(require.resolve('bedrock-protocol'))
const { RealmAPI } = bedrockRequire('prismarine-realms')

function normalizeRealm (realm) {
  return {
    id: String(realm.id),
    name: String(realm.name || realm.motd || `Realm ${realm.id}`),
    state: String(realm.state || 'unknown'),
    owner: String(realm.owner || ''),
    expired: realm.expired === true,
    players: Array.isArray(realm.players) ? realm.players.length : null,
    maxPlayers: Number.isInteger(realm.maxPlayers) ? realm.maxPlayers : null
  }
}

function createApi (authflow, minecraftVersion) {
  if (!authflow || typeof authflow.getXboxToken !== 'function') {
    throw new Error('このBotのMicrosoft / Xbox認証が完了していません。')
  }
  return RealmAPI.from(authflow, 'bedrock', { minecraftVersion })
}

async function listRealms (authflow, minecraftVersion = '1.26.60') {
  const api = createApi(authflow, minecraftVersion)
  const realms = await api.getRealms()
  return (Array.isArray(realms) ? realms : []).map(normalizeRealm).filter(realm => /^\d+$/.test(realm.id))
}

async function getRealmFromInvite (authflow, inviteCode, minecraftVersion = '1.26.60') {
  const code = String(inviteCode || '').trim()
  if (!code || code.length > 256) throw new Error('Realmsの招待コードまたはリンクを入力してください。')
  const api = createApi(authflow, minecraftVersion)
  // This explicit call accepts the invite for the authenticated account.
  const realm = await api.getRealmFromInvite(code, true)
  const normalized = normalizeRealm(realm)
  if (!/^\d+$/.test(normalized.id)) throw new Error('招待コードから有効なRealm IDを取得できませんでした。')
  return normalized
}

module.exports = { listRealms, getRealmFromInvite }

'use strict'

const MOD_CATALOG = Object.freeze([
  Object.freeze({
    id: 'itemUse',
    name: 'Item Use',
    version: '1.0.0',
    category: 'インベントリ',
    description: '選択したアイテムを1回または連続で使用します。食べる・飲む動作にも対応します。'
  }),
  Object.freeze({
    id: 'containerSupply',
    name: 'Container Supply',
    version: '1.0.0',
    category: '自動化',
    description: '指定したコンテナの中身を確認し、Botの所持品から目標数まで補充します。'
  })
])

const MOD_IDS = new Set(MOD_CATALOG.map(mod => mod.id))

function normalizeInstalledMods (input, legacyBots = []) {
  if (Array.isArray(input)) {
    return [...new Set(input.filter(id => typeof id === 'string' && MOD_IDS.has(id)))]
  }
  // Before the Mod catalog existed, these built-in features were part of the
  // normal UI. Preserve their availability when upgrading an older settings file.
  return Array.isArray(legacyBots) && legacyBots.length > 0
    ? MOD_CATALOG.map(mod => mod.id)
    : []
}

function addInstalledMod (installed, modId) {
  if (!MOD_IDS.has(modId)) throw new Error('指定されたModはカタログにありません。')
  return [...new Set([...(Array.isArray(installed) ? installed : []), modId])]
}

function removeInstalledMod (installed, modId) {
  if (!MOD_IDS.has(modId)) throw new Error('指定されたModはカタログにありません。')
  return (Array.isArray(installed) ? installed : []).filter(id => id !== modId)
}

module.exports = { MOD_CATALOG, normalizeInstalledMods, addInstalledMod, removeInstalledMod }

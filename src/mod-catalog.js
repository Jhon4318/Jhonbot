'use strict'

const MOD_CATALOG = Object.freeze([
  Object.freeze({ id: 'itemUse', name: 'Item Use', version: '1.0.0', category: 'インベントリ操作', description: '選択したアイテムを1回使用、または指定間隔で連続使用します。食べる・飲む操作にも対応します。', features: ['アイテムの1回使用', '連続使用', '食べる・飲む操作'] }),
  Object.freeze({ id: 'containerSupply', name: 'Container Supply', version: '1.0.0', category: '自動補充', description: '指定したコンテナを確認し、目標数になるまでBotの所持品からアイテムを補充します。', features: ['座標指定', '既存スタックへの追加', '不足分の自動補充'] })
])
const MOD_IDS = new Set(MOD_CATALOG.map(mod => mod.id))

function normalizeInstalledMods (input, fallback = []) {
  const source = Array.isArray(input) ? input : fallback
  return [...new Set(source.filter(id => typeof id === 'string' && MOD_IDS.has(id)))]
}

function inferInstalledMods (bots = []) {
  const installed = new Set()
  for (const bot of Array.isArray(bots) ? bots : []) {
    if (bot?.modules?.itemUse?.assigned === true) installed.add('itemUse')
    if (bot?.modules?.containerSupply?.assigned === true) installed.add('containerSupply')
  }
  return [...installed]
}

function isModInstalled (installedMods, modId) { return Array.isArray(installedMods) && installedMods.includes(modId) }

module.exports = { MOD_CATALOG, normalizeInstalledMods, inferInstalledMods, isModInstalled }

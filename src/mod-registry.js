'use strict'

const MOD_CATALOG = Object.freeze([
  Object.freeze({ id: 'inventory', name: 'インベントリ管理', version: '1.0.0', category: 'インベントリ', builtIn: true, description: '所持アイテム・スロット・個数を確認し、アイテムを投げる操作を行います。' }),
  Object.freeze({ id: 'itemUse', name: 'アイテム使用', version: '1.0.0', category: 'インベントリ', description: '選択したアイテムを1回または連続で使用します。食べる・飲む動作にも対応します。' }),
  Object.freeze({ id: 'containerSupply', name: 'コンテナ補充', version: '1.1.0', category: '自動化', description: '指定したコンテナに複数種類のアイテムを、それぞれ設定した目標数まで補充します。' }),
  Object.freeze({ id: 'autoFishing', name: '自動釣り', version: '1.0.0', category: '自動化', description: '釣り針イベントでアタリを検出し、釣竿の回収と再キャストを自動で繰り返します。' }),
  Object.freeze({ id: 'lookDirection', name: '視点変更', version: '1.0.0', category: '操作', description: 'Yaw（水平角）とPitch（上下角）を度数で指定し、Botの視線をその角度へ向けます。' })
])

const MOD_BY_ID = new Map(MOD_CATALOG.map(mod => [mod.id, mod]))
const MOD_IDS = new Set(MOD_BY_ID.keys())

function normalizeInstalledMods (input, legacyBots = []) {
  const legacy = Array.isArray(input)
    ? input.filter(id => typeof id === 'string' && MOD_IDS.has(id))
    : (Array.isArray(legacyBots) && legacyBots.length > 0 ? ['itemUse', 'containerSupply'] : [])
  return ['inventory', ...new Set(legacy.filter(id => id !== 'inventory'))]
}

function addInstalledMod (installed, modId) {
  if (!MOD_IDS.has(modId)) throw new Error('指定されたModはカタログにありません。')
  return [...new Set(['inventory', ...(Array.isArray(installed) ? installed : []).filter(id => id !== 'inventory'), modId])]
}

function removeInstalledMod (installed, modId) {
  if (!MOD_IDS.has(modId)) throw new Error('指定されたModはカタログにありません。')
  if (MOD_BY_ID.get(modId).builtIn) throw new Error('このModは標準搭載のためアンインストールできません。')
  return ['inventory', ...(Array.isArray(installed) ? installed : []).filter(id => id !== modId && id !== 'inventory')]
}

module.exports = { MOD_CATALOG, normalizeInstalledMods, addInstalledMod, removeInstalledMod }

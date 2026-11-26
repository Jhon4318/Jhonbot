'use strict'

const ENCHANTMENT_NAMES = Object.freeze({
  0: 'ダメージ軽減',
  1: '火炎耐性',
  2: '落下耐性',
  3: '爆発耐性',
  4: '飛び道具耐性',
  5: '水中呼吸',
  6: '水中採掘',
  7: '棘の鎧',
  8: '水中歩行',
  9: '氷渡り',
  10: '束縛の呪い',
  16: '鋭さ',
  17: 'アンデッド特効',
  18: '虫特効',
  19: 'ノックバック',
  20: '火属性',
  21: 'ドロップ増加',
  22: '範囲ダメージ増加',
  32: '効率強化',
  33: 'シルクタッチ',
  34: '耐久力',
  35: '幸運',
  48: '射撃ダメージ増加',
  49: 'パンチ',
  50: 'フレイム',
  51: '無限',
  61: '宝釣り',
  62: '入れ食い',
  70: '修繕',
  71: '消滅の呪い'
})

const ENCHANTMENT_NAME_ALIASES = Object.freeze({
  protection: 'ダメージ軽減',
  fire_protection: '火炎耐性',
  feather_falling: '落下耐性',
  blast_protection: '爆発耐性',
  projectile_protection: '飛び道具耐性',
  respiration: '水中呼吸',
  aqua_affinity: '水中採掘',
  thorns: '棘の鎧',
  depth_strider: '水中歩行',
  frost_walker: '氷渡り',
  binding_curse: '束縛の呪い',
  sharpness: '鋭さ',
  smite: 'アンデッド特効',
  bane_of_arthropods: '虫特効',
  knockback: 'ノックバック',
  fire_aspect: '火属性',
  looting: 'ドロップ増加',
  sweeping: '範囲ダメージ増加',
  efficiency: '効率強化',
  silk_touch: 'シルクタッチ',
  unbreaking: '耐久力',
  fortune: '幸運',
  power: '射撃ダメージ増加',
  punch: 'パンチ',
  flame: 'フレイム',
  infinity: '無限',
  luck_of_the_sea: '宝釣り',
  lure: '入れ食い',
  mending: '修繕',
  vanishing_curse: '消滅の呪い'
})

function normalizeChatMessage (value, maxLength = 256) {
  if (typeof value !== 'string') throw new Error('チャット内容を文字列で入力してください。')
  const message = value.trim()
  if (!message) throw new Error('チャット内容を入力してください。')
  if (message.length > maxLength) throw new Error(`チャットは${maxLength}文字以内で入力してください。`)
  if (message.includes('\\0')) throw new Error('チャットに使用できない文字が含まれています。')
  return message
}

function unwrapNbtValue (value) {
  let current = value
  let depth = 0
  while (current && typeof current === 'object' && !Array.isArray(current) &&
    Object.prototype.hasOwnProperty.call(current, 'value') && depth++ < 8) {
    current = current.value
  }
  return current
}

function findEnchantmentList (nbt) {
  const aliases = new Set(['ench', 'enchantments', 'storedenchantments', 'storedench', 'stored_enchantments'])
  const root = unwrapNbtValue(nbt)
  const queue = [{ value: root, depth: 0 }]
  const visited = new Set()
  while (queue.length) {
    const current = queue.shift()
    const value = current.value
    if (!value || typeof value !== 'object' || visited.has(value) || current.depth > 6) continue
    visited.add(value)
    if (Array.isArray(value)) {
      for (const entry of value) queue.push({ value: entry, depth: current.depth + 1 })
      continue
    }
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '')
      if (aliases.has(normalized)) {
        const list = unwrapNbtValue(entry)
        if (Array.isArray(list)) return list
        if (list && typeof list === 'object') return [list]
      }
      if (entry && typeof entry === 'object') queue.push({ value: unwrapNbtValue(entry), depth: current.depth + 1 })
    }
  }
  return []
}

function enchantmentPrimitive (value) {
  const unwrapped = unwrapNbtValue(value)
  if (typeof unwrapped === 'number' || typeof unwrapped === 'string') return unwrapped
  if (typeof unwrapped === 'bigint') return Number(unwrapped)
  return null
}

function enchantmentName (id, registry) {
  const raw = String(id ?? '').replace(/^minecraft:/i, '').toLowerCase()
  if (ENCHANTMENT_NAME_ALIASES[raw]) return ENCHANTMENT_NAME_ALIASES[raw]
  if (/^-?\d+$/.test(raw)) {
    const numeric = Number(raw)
    const registryDefinitions = registry?.enchantments || registry?.enchantmentsById
    const definition = Array.isArray(registryDefinitions)
      ? registryDefinitions.find(entry => Number(entry?.id) === numeric)
      : registryDefinitions?.[raw]
    if (definition?.name) return String(definition.name).replace(/_/g, ' ')
    return ENCHANTMENT_NAMES[numeric] || 'エンチャント #' + raw
  }
  return raw ? raw.replace(/_/g, ' ') : 'エンチャント'
}

function extractItemEnchantments (item, registry) {
  if (!item || typeof item !== 'object') return []
  const source = Array.isArray(item.enchants) && item.enchants.length
    ? item.enchants
    : findEnchantmentList(item.nbt)
  const result = []
  const seen = new Set()
  for (const entry of source) {
    const record = unwrapNbtValue(entry)
    if (!record || typeof record !== 'object') continue
    const id = enchantmentPrimitive(record.id ?? record.Id ?? record.name ?? record.Name)
    const levelValue = enchantmentPrimitive(record.lvl ?? record.level ?? record.Level)
    const level = Number(levelValue)
    if (id == null || !Number.isFinite(level) || level < 1) continue
    const name = enchantmentName(id, registry)
    const key = String(id) + ':' + level
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ id: String(id), name, level, label: name + ' ' + level })
  }
  return result
}

function createInventorySnapshot (agent) {
  const inventory = agent?.inventory
  if (!inventory || typeof inventory.items !== 'function') return []
  const items = inventory.items()
  if (!Array.isArray(items)) return []
  return items
    .filter(item => item && Number.isInteger(item.slot) && item.slot >= 9 && item.slot <= 44 && Number.isInteger(item.count) && item.count > 0)
    .map(item => ({
      slot: item.slot,
      name: String(item.name || ''),
      displayName: String(item.displayName || item.name || `アイテム ${item.type ?? ''}`),
      count: item.count,
      type: Number.isInteger(item.type) ? item.type : null,
      metadata: Number.isInteger(item.metadata) ? item.metadata : 0,
      enchantments: extractItemEnchantments(item, agent.registry)
    }))
    .sort((a, b) => a.slot - b.slot)
}

function normalizeDropRequest (input, inventory) {
  const slot = Number(input?.slot)
  if (!Number.isInteger(slot) || slot < 9 || slot > 44) {
    throw new Error('投げるアイテムのスロットが不正です。')
  }
  const item = inventory?.slots?.[slot]
  if (!item || !Number.isInteger(item.count) || item.count < 1) {
    throw new Error('選択したスロットにアイテムがありません。')
  }
  const count = input?.count == null || input.count === '' ? item.count : Number(input.count)
  if (!Number.isInteger(count) || count < 1 || count > item.count) {
    throw new Error(`投げる個数は1〜${item.count}個で入力してください。`)
  }
  return { slot, count, item }
}

module.exports = { normalizeChatMessage, createInventorySnapshot, extractItemEnchantments, normalizeDropRequest }

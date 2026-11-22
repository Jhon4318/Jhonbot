'use strict'

const FISHHOOK_HOOKTIME_EVENT_ID = 13
const BEDROCK_ENCHANTMENT_IDS = new Map([
  [17, 'unbreaking'],
  [23, 'luck_of_the_sea'],
  [24, 'lure'],
  [26, 'mending']
])
const FISHING_ROD_ENCHANTMENTS = new Set(['luck_of_the_sea', 'lure', 'mending', 'unbreaking'])

function runtimeEntityId (value) {
  const number = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function isFishingHookSpawn (packet) {
  const type = String(packet?.entity_type || '').toLowerCase()
  return type === '77' || type === 'fishing_hook' || type === 'minecraft:fishing_hook' || type.endsWith(':fishing_hook')
}

function isFishingHookBite (packet, expectedRuntimeId) {
  const event = packet?.event_id
  const isHooktime = Number(event) === FISHHOOK_HOOKTIME_EVENT_ID ||
    event === 'fish_hook_hook' ||
    event === 'fishhook_hooktime'
  if (!isHooktime) return false
  const receivedId = runtimeEntityId(packet?.runtime_entity_id ?? packet?.runtime_id)
  const expectedId = runtimeEntityId(expectedRuntimeId)
  return receivedId !== null && expectedId !== null && receivedId === expectedId
}

function unwrapTagValue (value) {
  let current = value
  for (let depth = 0; depth < 6; depth++) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, 'value')) break
    current = current.value
  }
  return current
}

function normalizeEnchantmentName (value) {
  const raw = unwrapTagValue(value)
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))) {
    return BEDROCK_ENCHANTMENT_IDS.get(Number(raw)) || ''
  }
  const name = String(raw ?? '').trim().toLowerCase().split(':').pop().replace(/[^a-z0-9]/g, '')
  if (name === 'luckofthesea') return 'luck_of_the_sea'
  if (name === 'lure') return 'lure'
  if (name === 'mending') return 'mending'
  if (name === 'unbreaking') return 'unbreaking'
  return ''
}

function addEnchantment (target, name, rawLevel) {
  const normalized = normalizeEnchantmentName(name)
  const level = Number(unwrapTagValue(rawLevel))
  if (!FISHING_ROD_ENCHANTMENTS.has(normalized) || !Number.isFinite(level) || level <= 0) return
  target.set(normalized, Math.max(target.get(normalized) || 0, Math.floor(level)))
}

function collectEnchantmentEntries (source, target, depth = 0) {
  if (depth > 7 || source == null) return
  const value = unwrapTagValue(source)
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry)) {
        addEnchantment(target, entry[0], entry[1])
        continue
      }
      if (!entry || typeof entry !== 'object') continue
      const name = entry.name ?? entry.id ?? entry.enchantment ?? entry.enchant ?? entry.type
      const level = entry.lvl ?? entry.level ?? entry.enchantmentLevel ?? entry.enchantment_level
      if (name != null && level != null) addEnchantment(target, name, level)
      else collectEnchantmentEntries(entry.levels ?? entry.enchantments ?? entry.enchants ?? entry.value, target, depth + 1)
    }
    return
  }
  if (value instanceof Map) {
    for (const [name, level] of value.entries()) addEnchantment(target, name, level)
    return
  }
  if (!value || typeof value !== 'object') return
  const name = value.name ?? value.id ?? value.enchantment ?? value.enchant ?? value.type
  const level = value.lvl ?? value.level ?? value.enchantmentLevel ?? value.enchantment_level
  if (name != null && level != null) {
    addEnchantment(target, name, level)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (normalizeEnchantmentName(key)) addEnchantment(target, key, child)
    else if (['levels', 'enchantments', 'enchants', 'value', 'entries', 'list'].includes(key.toLowerCase())) {
      collectEnchantmentEntries(child, target, depth + 1)
    }
  }
}

function collectComponentEnchantments (source, target) {
  const components = unwrapTagValue(source)
  if (components == null) return
  if (components instanceof Map) {
    for (const [componentId, data] of components.entries()) {
      if (/enchant/i.test(String(componentId))) collectEnchantmentEntries(data, target)
    }
    return
  }
  if (Array.isArray(components)) {
    for (const component of components) {
      if (!component || typeof component !== 'object') continue
      const componentId = component.id ?? component.name ?? component.type ?? component.componentId ?? component.component_id
      if (/enchant/i.test(String(unwrapTagValue(componentId) || ''))) {
        collectEnchantmentEntries(component.data ?? component.value ?? component.component ?? component, target)
      }
    }
    return
  }
  if (typeof components === 'object') {
    for (const [componentId, data] of Object.entries(components)) {
      if (/enchant/i.test(componentId)) collectEnchantmentEntries(data, target)
    }
  }
}

function findNestedEnchantmentData (source, target, depth = 0, visited = new WeakSet()) {
  if (depth > 7 || source == null || typeof source !== 'object' || visited.has(source)) return
  visited.add(source)
  const value = unwrapTagValue(source)
  if (value instanceof Map) {
    for (const [key, child] of value.entries()) {
      if (/ench/i.test(String(key))) collectEnchantmentEntries(child, target)
      else findNestedEnchantmentData(child, target, depth + 1, visited)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) findNestedEnchantmentData(child, target, depth + 1, visited)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/ench/i.test(key)) collectEnchantmentEntries(child, target)
    else if (child && typeof child === 'object') findNestedEnchantmentData(child, target, depth + 1, visited)
  }
}

function getFishingRodEnchantments (item) {
  const enchantments = new Map()
  if (!item || typeof item !== 'object') return enchantments
  try { collectEnchantmentEntries(item.enchants, enchantments) } catch {}
  try { collectEnchantmentEntries(item.enchantments, enchantments) } catch {}
  try { if (typeof item.getEnchantments === 'function') collectEnchantmentEntries(item.getEnchantments(), enchantments) } catch {}
  for (const source of [item.components, item.componentData, item.component_data, item.stack?.components]) {
    try { collectComponentEnchantments(source, enchantments) } catch {}
  }
  try { findNestedEnchantmentData(item.nbt, enchantments) } catch {}
  return enchantments
}

function getFishingRodEnchantmentScore (item) {
  const enchants = getFishingRodEnchantments(item)
  const luck = enchants.get('luck_of_the_sea') || 0
  const lure = enchants.get('lure') || 0
  const mending = enchants.get('mending') || 0
  const unbreaking = enchants.get('unbreaking') || 0
  return [luck + lure, luck, lure, mending, unbreaking]
}

function compareFishingRodScores (left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] || 0) - (left[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

function findFishingRod (inventory) {
  const items = typeof inventory?.items === 'function' ? inventory.items() : []
  if (!Array.isArray(items)) return null
  const rods = items.filter(item => {
    const name = String(item?.name || '').toLowerCase()
    return name === 'fishing_rod' || name === 'minecraft:fishing_rod'
  })
  if (!rods.length) return null
  return rods
    .map((item, index) => ({ item, index, score: getFishingRodEnchantmentScore(item) }))
    .sort((left, right) => compareFishingRodScores(left.score, right.score) || left.index - right.index)[0].item
}

module.exports = {
  FISHHOOK_HOOKTIME_EVENT_ID,
  runtimeEntityId,
  isFishingHookSpawn,
  isFishingHookBite,
  findFishingRod,
  getFishingRodEnchantments,
  getFishingRodEnchantmentScore
}

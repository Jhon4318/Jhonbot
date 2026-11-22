'use strict'

const FISHHOOK_HOOKTIME_EVENT_ID = 13

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

function findFishingRod (inventory) {
  const items = typeof inventory?.items === 'function' ? inventory.items() : []
  if (!Array.isArray(items)) return null
  return items.find(item => {
    const name = String(item?.name || '').toLowerCase()
    return name === 'fishing_rod' || name === 'minecraft:fishing_rod'
  }) || null
}

module.exports = {
  FISHHOOK_HOOKTIME_EVENT_ID,
  runtimeEntityId,
  isFishingHookSpawn,
  isFishingHookBite,
  findFishingRod
}

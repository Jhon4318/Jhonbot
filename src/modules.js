'use strict'

const DEFAULT_MODULES = Object.freeze({
  itemUse: Object.freeze({ assigned: false, useMode: 'activate', intervalMs: 1500 }),
  containerSupply: Object.freeze({ assigned: false, x: null, y: null, z: null, items: Object.freeze([]), intervalMs: 5000 }),
  autoFishing: Object.freeze({ assigned: false, biteTimeoutMs: 120000, recastDelayMs: 1000 })
})

function clampedInteger (value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function boundedInteger (value, fallback, min, max) {
  const number = Number(value)
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback
}

function coordinate (value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isInteger(number) && Math.abs(number) <= 30000000 ? number : null
}

function normalizeContainerItems (containerSupply) {
  const source = Array.isArray(containerSupply.items)
    ? containerSupply.items
    : (String(containerSupply.itemName || '').trim()
        ? [{ itemName: containerSupply.itemName, targetCount: containerSupply.targetCount }]
        : [])
  const normalized = []
  const names = new Set()

  for (const entry of source.slice(0, 256)) {
    const itemName = String(entry?.itemName ?? entry?.name ?? '').trim().slice(0, 100)
    if (!itemName || names.has(itemName)) continue
    names.add(itemName)
    normalized.push({
      itemName,
      targetCount: boundedInteger(entry?.targetCount, 64, 1, 100000)
    })
    if (normalized.length >= 32) break
  }
  return normalized
}

function normalizeBotModules (input = {}) {
  const itemUse = input.itemUse || {}
  const containerSupply = input.containerSupply || {}
  const autoFishing = input.autoFishing || {}
  return {
    itemUse: {
      assigned: itemUse.assigned === true,
      useMode: itemUse.useMode === 'consume' ? 'consume' : 'activate',
      intervalMs: clampedInteger(itemUse.intervalMs, DEFAULT_MODULES.itemUse.intervalMs, 750, 60000)
    },
    containerSupply: {
      assigned: containerSupply.assigned === true,
      x: coordinate(containerSupply.x),
      y: coordinate(containerSupply.y),
      z: coordinate(containerSupply.z),
      items: normalizeContainerItems(containerSupply),
      intervalMs: clampedInteger(containerSupply.intervalMs, DEFAULT_MODULES.containerSupply.intervalMs, 1000, 60000)
    },
    autoFishing: {
      assigned: autoFishing.assigned === true,
      biteTimeoutMs: clampedInteger(autoFishing.biteTimeoutMs, DEFAULT_MODULES.autoFishing.biteTimeoutMs, 15000, 300000),
      recastDelayMs: clampedInteger(autoFishing.recastDelayMs, DEFAULT_MODULES.autoFishing.recastDelayMs, 250, 10000)
    }
  }
}

function moduleConfigComplete (config) {
  return Number.isFinite(config?.x) &&
    Number.isFinite(config?.y) &&
    Number.isFinite(config?.z) &&
    Array.isArray(config?.items) &&
    config.items.length > 0 &&
    config.items.every(item =>
      typeof item?.itemName === 'string' &&
      item.itemName.length > 0 &&
      Number.isInteger(item.targetCount) &&
      item.targetCount > 0
    )
}

function isModuleAssigned (modules, name) {
  return modules?.[name]?.assigned === true
}

module.exports = {
  DEFAULT_MODULES,
  normalizeBotModules,
  normalizeContainerItems,
  moduleConfigComplete,
  isModuleAssigned
}

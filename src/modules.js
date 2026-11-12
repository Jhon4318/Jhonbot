'use strict'

const DEFAULT_MODULES = Object.freeze({
  itemUse: Object.freeze({ assigned: false, useMode: 'activate', intervalMs: 1500 }),
  containerSupply: Object.freeze({ assigned: false, x: null, y: null, z: null, itemName: '', targetCount: 64, intervalMs: 5000 })
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

function normalizeBotModules (input = {}) {
  const itemUse = input.itemUse || {}
  const containerSupply = input.containerSupply || {}
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
      itemName: String(containerSupply.itemName || '').trim().slice(0, 100),
      targetCount: boundedInteger(containerSupply.targetCount, DEFAULT_MODULES.containerSupply.targetCount, 1, 100000),
      intervalMs: clampedInteger(containerSupply.intervalMs, DEFAULT_MODULES.containerSupply.intervalMs, 1000, 60000)
    }
  }
}

function moduleConfigComplete (config) {
  return Number.isFinite(config?.x) &&
    Number.isFinite(config?.y) &&
    Number.isFinite(config?.z) &&
    typeof config?.itemName === 'string' &&
    config.itemName.length > 0 &&
    Number.isInteger(config?.targetCount) &&
    config.targetCount > 0
}

function isModuleAssigned (modules, name) {
  return modules?.[name]?.assigned === true
}

module.exports = { DEFAULT_MODULES, normalizeBotModules, moduleConfigComplete, isModuleAssigned }

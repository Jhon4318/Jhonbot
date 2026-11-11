'use strict'

const DEFAULT_MODULES = Object.freeze({
  itemUse: Object.freeze({ assigned: false, useMode: 'activate', intervalMs: 1500 }),
  containerSupply: Object.freeze({ assigned: false, x: null, y: null, z: null, itemName: '', targetCount: 64, intervalMs: 5000 }),
  connectionManager: Object.freeze({ assigned: false, maxRetries: 5, initialDelayMs: 5000, maxDelayMs: 60000 })
})

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
  const connectionManager = input.connectionManager || {}
  const x = coordinate(containerSupply.x)
  const y = coordinate(containerSupply.y)
  const z = coordinate(containerSupply.z)
  const itemName = String(containerSupply.itemName || '').trim().slice(0, 100)
  const baseDelayMs = boundedInteger(connectionManager.initialDelayMs, 5000, 1000, 60000)
  const maxDelayMs = boundedInteger(connectionManager.maxDelayMs, 60000, baseDelayMs, 300000)

  return {
    itemUse: {
      assigned: itemUse.assigned === true,
      useMode: itemUse.useMode === 'consume' ? 'consume' : 'activate',
      intervalMs: boundedInteger(itemUse.intervalMs, DEFAULT_MODULES.itemUse.intervalMs, 750, 60000)
    },
    containerSupply: {
      assigned: containerSupply.assigned === true,
      x,
      y,
      z,
      itemName,
      targetCount: boundedInteger(containerSupply.targetCount, 64, 1, 100000),
      intervalMs: boundedInteger(containerSupply.intervalMs, 5000, 1000, 60000)
    },
    connectionManager: {
      assigned: connectionManager.assigned === true,
      maxRetries: boundedInteger(connectionManager.maxRetries, 5, 0, 20),
      initialDelayMs: baseDelayMs,
      maxDelayMs
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

function reconnectDelay (attempt, config) {
  const retries = Math.max(1, Number(attempt) || 1)
  const initial = boundedInteger(config?.initialDelayMs, 5000, 1000, 60000)
  const maximum = boundedInteger(config?.maxDelayMs, 60000, initial, 300000)
  return Math.min(maximum, initial * (2 ** (retries - 1)))
}

function isTransientDisconnect (errorText) {
  const text = String(errorText || '')
  if (!text) return false
  if (/auth|xbox|microsoft|banned|ban|kick|denied|unauthorized|鍵|公開鍵|本人確認|permission|not invited|couldn't find a realm/i.test(text)) return false
  return /timeout|timed out|ECONN|EHOST|ENET|EPIPE|socket|network|connecterror|ICE|WebRTC|connection reset|connection closed|connection lost|transport closed/i.test(text)
}

module.exports = {
  DEFAULT_MODULES,
  normalizeBotModules,
  moduleConfigComplete,
  isModuleAssigned,
  reconnectDelay,
  isTransientDisconnect
}

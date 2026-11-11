'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_MODULES, normalizeBotModules, moduleConfigComplete, isModuleAssigned, reconnectDelay, isTransientDisconnect } = require('../src/modules')

test('provides independent unassigned modules by default', () => {
  const modules = normalizeBotModules()
  assert.deepEqual(modules, {
    itemUse: { assigned: false, useMode: 'activate', intervalMs: 1500 },
    containerSupply: { assigned: false, x: null, y: null, z: null, itemName: '', targetCount: 64, intervalMs: 5000 },
    connectionManager: { assigned: false, maxRetries: 5, initialDelayMs: 5000, maxDelayMs: 60000 }
  })
  assert.equal(DEFAULT_MODULES.itemUse.assigned, false)
})

test('normalizes module assignments and clamps unsafe settings', () => {
  const modules = normalizeBotModules({
    itemUse: { assigned: true, intervalMs: 1 },
    containerSupply: { assigned: true, x: 100, y: 64, z: -20, itemName: ' minecraft:stone ', targetCount: 999999, intervalMs: 50 },
    connectionManager: { assigned: true, maxRetries: 99, initialDelayMs: 100, maxDelayMs: 400000 }
  })
  assert.equal(modules.itemUse.assigned, true)
  assert.equal(modules.itemUse.useMode, 'activate')
  assert.equal(modules.itemUse.intervalMs, 750)
  assert.deepEqual([modules.containerSupply.x, modules.containerSupply.y, modules.containerSupply.z], [100, 64, -20])
  assert.equal(modules.containerSupply.itemName, 'minecraft:stone')
  assert.equal(modules.containerSupply.targetCount, 64)
  assert.equal(modules.containerSupply.intervalMs, 1000)
  assert.equal(modules.connectionManager.maxRetries, 5)
  assert.equal(modules.connectionManager.initialDelayMs, 5000)
  assert.equal(modules.connectionManager.maxDelayMs, 60000)
})

test('rejects incomplete container supply coordinates and item', () => {
  const modules = normalizeBotModules({ containerSupply: { assigned: true, x: 1, y: '', z: 3, itemName: '' } })
  assert.equal(moduleConfigComplete(modules.containerSupply), false)
})

test('recognizes assigned modules explicitly', () => {
  const modules = normalizeBotModules({ itemUse: { assigned: true } })
  assert.equal(isModuleAssigned(modules, 'itemUse'), true)
  assert.equal(isModuleAssigned(modules, 'containerSupply'), false)
})

test('calculates capped exponential reconnect delay', () => {
  const config = { initialDelayMs: 5000, maxDelayMs: 60000 }
  assert.equal(reconnectDelay(1, config), 5000)
  assert.equal(reconnectDelay(2, config), 10000)
  assert.equal(reconnectDelay(4, config), 40000)
  assert.equal(reconnectDelay(8, config), 60000)
})

test('classifies transient network errors but excludes authentication and kick errors', () => {
  assert.equal(isTransientDisconnect('Connect timed out'), true)
  assert.equal(isTransientDisconnect('ECONNRESET socket hang up'), true)
  assert.equal(isTransientDisconnect('Server disconnected'), false)
  assert.equal(isTransientDisconnect('connection lost: socket closed'), true)
  assert.equal(isTransientDisconnect('Xbox authentication failed'), false)
  assert.equal(isTransientDisconnect('Player was kicked'), false)
  assert.equal(isTransientDisconnect('Server key approval denied'), false)
})

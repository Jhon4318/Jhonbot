'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_MODULES, normalizeBotModules, moduleConfigComplete, isModuleAssigned } = require('../src/modules')

test('provides independent feature modules unassigned by default', () => {
  const modules = normalizeBotModules()
  assert.deepEqual(modules, {
    itemUse: { assigned: false, useMode: 'activate', intervalMs: 1500 },
    containerSupply: { assigned: false, x: null, y: null, z: null, itemName: '', targetCount: 64, intervalMs: 5000 }
  })
  assert.equal(DEFAULT_MODULES.itemUse.assigned, false)
  assert.equal(Object.hasOwn(modules, 'connectionManager'), false)
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
  assert.equal(Object.hasOwn(modules, 'connectionManager'), false)
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

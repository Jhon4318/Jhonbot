'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_MODULES, normalizeBotModules, moduleConfigComplete, isModuleAssigned } = require('../src/modules')

test('provides independent modules unassigned by default', () => {
  const modules = normalizeBotModules()
  assert.deepEqual(modules, {
    inventory: { assigned: true },
    itemUse: { assigned: false, useMode: 'activate', intervalMs: 1500 },
    containerSupply: { assigned: false, x: null, y: null, z: null, items: [], intervalMs: 5000 },
    autoFishing: { assigned: false, biteTimeoutMs: 120000, recastDelayMs: 1000 },
    lookDirection: { assigned: false, yawDeg: 0, pitchDeg: 0 }
  })
  assert.equal(DEFAULT_MODULES.inventory.assigned, true)
  assert.equal(DEFAULT_MODULES.itemUse.assigned, false)
  assert.equal(DEFAULT_MODULES.lookDirection.assigned, false)
  assert.equal(Object.hasOwn(modules, 'connectionManager'), false)
})

test('normalizes assignments and clamps unsafe settings', () => {
  const modules = normalizeBotModules({
    itemUse: { assigned: true, intervalMs: 1 },
    containerSupply: { assigned: true, x: 100, y: 64, z: -20, items: [{ itemName: ' minecraft:stone ', targetCount: 999999 }], intervalMs: 50 },
    autoFishing: { assigned: true, biteTimeoutMs: 1, recastDelayMs: 999999 },
    lookDirection: { assigned: true, yawDeg: 240.5, pitchDeg: -120 },
    connectionManager: { assigned: true }
  })
  assert.equal(modules.itemUse.assigned, true)
  assert.equal(modules.itemUse.intervalMs, 750)
  assert.deepEqual([modules.containerSupply.x, modules.containerSupply.y, modules.containerSupply.z], [100, 64, -20])
  assert.deepEqual(modules.containerSupply.items, [{ itemName: 'minecraft:stone', targetCount: 64 }])
  assert.equal(modules.containerSupply.intervalMs, 1000)
  assert.deepEqual(modules.autoFishing, { assigned: true, biteTimeoutMs: 15000, recastDelayMs: 10000 })
  assert.deepEqual(modules.lookDirection, { assigned: true, yawDeg: 180, pitchDeg: -90 })
  assert.equal(Object.hasOwn(modules, 'connectionManager'), false)
})

test('migrates legacy single-item Container Supply settings', () => {
  const modules = normalizeBotModules({
    containerSupply: { assigned: true, x: 10, y: 64, z: -5, itemName: 'minecraft:stone', targetCount: 128 }
  })
  assert.deepEqual(modules.containerSupply.items, [{ itemName: 'minecraft:stone', targetCount: 128 }])
  assert.equal(moduleConfigComplete(modules.containerSupply), true)
})

test('supports multiple Container Supply items, deduplicates names and limits the list', () => {
  const entries = [
    { itemName: 'minecraft:stone', targetCount: 128 },
    { itemName: 'minecraft:stone', targetCount: 4 },
    { itemName: ' minecraft:dirt ', targetCount: 32 },
    { itemName: '', targetCount: 64 },
    ...Array.from({ length: 35 }, (_, i) => ({ itemName: 'minecraft:item_' + i, targetCount: i + 1 }))
  ]
  const modules = normalizeBotModules({ containerSupply: { x: 1, y: 2, z: 3, items: entries } })
  assert.equal(modules.containerSupply.items.length, 32)
  assert.deepEqual(modules.containerSupply.items.slice(0, 2), [
    { itemName: 'minecraft:stone', targetCount: 128 },
    { itemName: 'minecraft:dirt', targetCount: 32 }
  ])
  assert.equal(moduleConfigComplete(modules.containerSupply), true)
})

test('rejects incomplete Container Supply coordinates and items', () => {
  const modules = normalizeBotModules({ containerSupply: { x: 1, y: '', z: 3, items: [] } })
  assert.equal(moduleConfigComplete(modules.containerSupply), false)
})

test('recognizes assigned modules explicitly', () => {
  const modules = normalizeBotModules({ itemUse: { assigned: true }, autoFishing: { assigned: true } })
  assert.equal(isModuleAssigned(modules, 'itemUse'), true)
  assert.equal(isModuleAssigned(modules, 'containerSupply'), false)
  assert.equal(isModuleAssigned(modules, 'autoFishing'), true)
  assert.equal(isModuleAssigned(modules, 'lookDirection'), false)
  assert.equal(isModuleAssigned(modules, 'inventory'), true)
})

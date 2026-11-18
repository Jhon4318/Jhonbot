'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { MOD_CATALOG, normalizeInstalledMods, addInstalledMod, removeInstalledMod } = require('../src/mod-registry')

test('catalog exposes the initial built-in Mod set', () => {
  assert.deepEqual(MOD_CATALOG.map(mod => mod.id), ['inventory', 'itemUse', 'containerSupply', 'autoFishing', 'lookDirection'])
  assert.equal(MOD_CATALOG.find(mod => mod.id === 'inventory').builtIn, true)
})

test('new settings always include the built-in Inventory Mod', () => {
  assert.deepEqual(normalizeInstalledMods(undefined, []), ['inventory'])
})

test('legacy settings migrate existing built-in modules as installed', () => {
  assert.deepEqual(normalizeInstalledMods(undefined, [{ id: 'old-bot' }]), ['inventory', 'itemUse', 'containerSupply'])
})

test('normalizes valid installed IDs and removes duplicates or unknown IDs', () => {
  assert.deepEqual(normalizeInstalledMods(['itemUse', 'itemUse', 'unknown']), ['inventory', 'itemUse'])
})

test('adds and removes installed Mods safely', () => {
  assert.deepEqual(addInstalledMod(['itemUse'], 'containerSupply'), ['inventory', 'itemUse', 'containerSupply'])
  assert.deepEqual(addInstalledMod(['itemUse'], 'lookDirection'), ['inventory', 'itemUse', 'lookDirection'])
  assert.deepEqual(removeInstalledMod(['inventory', 'itemUse', 'containerSupply'], 'itemUse'), ['inventory', 'containerSupply'])
  assert.throws(() => removeInstalledMod(['inventory'], 'inventory'), /標準搭載/)
  assert.throws(() => addInstalledMod([], 'unknown'), /カタログ/)
})

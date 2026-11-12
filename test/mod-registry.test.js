'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { MOD_CATALOG, normalizeInstalledMods, addInstalledMod, removeInstalledMod } = require('../src/mod-registry')

test('catalog exposes the initial built-in Mod set', () => {
  assert.deepEqual(MOD_CATALOG.map(mod => mod.id), ['itemUse', 'containerSupply'])
})

test('new settings start with no installed mods', () => {
  assert.deepEqual(normalizeInstalledMods(undefined, []), [])
})

test('legacy settings migrate existing built-in modules as installed', () => {
  assert.deepEqual(normalizeInstalledMods(undefined, [{ id: 'old-bot' }]), ['itemUse', 'containerSupply'])
})

test('normalizes valid installed IDs and removes duplicates or unknown IDs', () => {
  assert.deepEqual(normalizeInstalledMods(['itemUse', 'itemUse', 'unknown']), ['itemUse'])
})

test('adds and removes installed Mods safely', () => {
  assert.deepEqual(addInstalledMod(['itemUse'], 'containerSupply'), ['itemUse', 'containerSupply'])
  assert.deepEqual(removeInstalledMod(['itemUse', 'containerSupply'], 'itemUse'), ['containerSupply'])
  assert.throws(() => addInstalledMod([], 'unknown'), /カタログ/)
})

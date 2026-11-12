'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { MOD_CATALOG, normalizeInstalledMods, inferInstalledMods, isModInstalled } = require('../src/mod-catalog')

test('catalog contains installable feature modules only', () => { assert.deepEqual(MOD_CATALOG.map(mod => mod.id), ['itemUse', 'containerSupply']) })
test('normalizes IDs and ignores unknown values', () => { assert.deepEqual(normalizeInstalledMods(['itemUse', 'itemUse', 'unknown', 'containerSupply', 4]), ['itemUse', 'containerSupply']) })
test('migrates previously assigned Bot modules as installed', () => { assert.deepEqual(inferInstalledMods([{ modules: { itemUse: { assigned: true }, containerSupply: { assigned: false } } }, { modules: { containerSupply: { assigned: true } } }]), ['itemUse', 'containerSupply']) })
test('uses migration fallback when installedMods did not exist', () => { assert.deepEqual(normalizeInstalledMods(undefined, ['itemUse']), ['itemUse']); assert.equal(isModInstalled(['itemUse'], 'itemUse'), true); assert.equal(isModInstalled([], 'containerSupply'), false) })

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { FISHHOOK_HOOKTIME_EVENT_ID, runtimeEntityId, isFishingHookSpawn, isFishingHookBite, findFishingRod } = require('../src/auto-fishing')

test('uses Bedrock 1.26.60 fishing hook actor event ID', () => {
  assert.equal(FISHHOOK_HOOKTIME_EVENT_ID, 13)
})

test('recognizes string and numeric FishingHook actor types', () => {
  assert.equal(isFishingHookSpawn({ entity_type: 'minecraft:fishing_hook' }), true)
  assert.equal(isFishingHookSpawn({ entity_type: '77' }), true)
  assert.equal(isFishingHookSpawn({ entity_type: 'minecraft:arrow' }), false)
})

test('matches fish bite events to the exact hook runtime ID', () => {
  assert.equal(isFishingHookBite({ event_id: 13, runtime_entity_id: 123 }, 123), true)
  assert.equal(isFishingHookBite({ event_id: 13, runtime_entity_id: 124 }, 123), false)
  assert.equal(isFishingHookBite({ event_id: 12, runtime_entity_id: 123 }, 123), false)
})

test('normalizes runtime IDs and finds a fishing rod', () => {
  assert.equal(runtimeEntityId(42n), 42)
  assert.equal(runtimeEntityId('bad'), null)
  assert.equal(findFishingRod({ items: () => [{ name: 'stone' }, { name: 'fishing_rod' }] }).name, 'fishing_rod')
  assert.equal(findFishingRod({ items: () => [{ name: 'stone' }] }), null)
})

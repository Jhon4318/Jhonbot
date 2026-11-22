'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FISHHOOK_HOOKTIME_EVENT_ID,
  runtimeEntityId,
  isFishingHookSpawn,
  isFishingHookBite,
  findFishingRod,
  getFishingRodEnchantments,
  getFishingRodEnchantmentScore
} = require('../src/auto-fishing')

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

test('prefers the rod with the strongest fishing enchantments, independent of slot order', () => {
  const plain = { name: 'fishing_rod', enchants: [] }
  const good = { name: 'fishing_rod', enchants: [
    { name: 'luck_of_the_sea', lvl: 2 },
    { name: 'lure', lvl: 3 }
  ] }
  const best = { name: 'fishing_rod', enchants: [
    { name: 'minecraft:luck_of_the_sea', lvl: 3 },
    { name: 'minecraft:lure', lvl: 3 }
  ] }
  assert.equal(findFishingRod({ items: () => [plain, good, best] }), best)
  assert.deepEqual(getFishingRodEnchantmentScore(best), [6, 3, 3, 0, 0])
})

test('uses Mending and then Unbreaking as tie breakers after fishing enchantments', () => {
  const plainDurability = {
    name: 'fishing_rod',
    enchants: [{ name: 'luck_of_the_sea', lvl: 3 }, { name: 'lure', lvl: 2 }]
  }
  const withUnbreaking = {
    name: 'fishing_rod',
    enchants: [{ name: 'luck_of_the_sea', lvl: 3 }, { name: 'lure', lvl: 2 }, { name: 'unbreaking', lvl: 3 }]
  }
  const withMending = {
    name: 'fishing_rod',
    enchants: [{ name: 'luck_of_the_sea', lvl: 3 }, { name: 'lure', lvl: 2 }, { name: 'mending', lvl: 1 }]
  }
  assert.equal(findFishingRod({ items: () => [plainDurability, withUnbreaking, withMending] }), withMending)
  assert.equal(findFishingRod({ items: () => [plainDurability, withUnbreaking] }), withUnbreaking)
})

test('reads Bedrock enchantment IDs and levels from item components', () => {
  const rod = {
    name: 'fishing_rod',
    components: {
      'minecraft:enchantments': {
        levels: { '23': 3, '24': 2, '26': 1, '17': 3 }
      }
    }
  }
  assert.deepEqual(
    Object.fromEntries(getFishingRodEnchantments(rod)),
    { luck_of_the_sea: 3, lure: 2, mending: 1, unbreaking: 3 }
  )
  assert.equal(findFishingRod({ items: () => [{ name: 'fishing_rod' }, rod] }), rod)
})

test('reads Bedrock NBT ench list entries', () => {
  const rod = {
    name: 'fishing_rod',
    nbt: {
      type: 'compound',
      value: {
        tag: {
          type: 'compound',
          value: {
            ench: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  { type: 'compound', value: {
                    id: { type: 'short', value: 23 },
                    lvl: { type: 'short', value: 3 }
                  } },
                  { type: 'compound', value: {
                    id: { type: 'short', value: 24 },
                    lvl: { type: 'short', value: 3 }
                  } }
                ]
              }
            }
          }
        }
      }
    }
  }
  assert.deepEqual(
    Object.fromEntries(getFishingRodEnchantments(rod)),
    { luck_of_the_sea: 3, lure: 3 }
  )
  assert.equal(findFishingRod({ items: () => [{ name: 'fishing_rod' }, rod] }), rod)
})

test('falls back to the first rod when enchantment metadata is unavailable', () => {
  const first = { name: 'fishing_rod' }
  const second = { name: 'fishing_rod', components: null }
  assert.equal(findFishingRod({ items: () => [first, second] }), first)
})

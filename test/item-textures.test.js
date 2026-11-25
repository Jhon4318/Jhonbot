'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { getTexturePaths, getTextureUrls } = require('../src/item-textures')

test('common items resolve to real Mojang Bedrock item texture paths', () => {
  assert.ok(getTexturePaths({ name: 'minecraft:apple' }).includes('textures/items/apple'))
  assert.ok(getTexturePaths({ name: 'diamond_sword' }).includes('textures/items/diamond_sword'))
  assert.ok(getTexturePaths({ name: 'fishing_rod' }).some(path => path.includes('/fishing_rod')))
})

test('blocks resolve through the terrain atlas instead of a guessed item path', () => {
  assert.ok(getTexturePaths({ name: 'stone' }).includes('textures/blocks/stone'))
  assert.ok(getTexturePaths({ name: 'diamond_block' }).includes('textures/blocks/diamond_block'))
})

test('item texture URLs use the official Bedrock sample resource pack path', () => {
  const urls = getTextureUrls({ name: 'apple' })
  assert.ok(urls.includes('https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/items/apple.png'))
})

test('unknown and invalid item identifiers return no broken URL', () => {
  assert.deepEqual(getTexturePaths({ name: 'this_item_does_not_exist_12345' }), [])
  assert.deepEqual(getTextureUrls({ name: 'minecraft:../../unknown' }), [])
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { installBedrockDimensionSync, SPAWN_SEARCH_Y } = require('../src/bedrock-dimension-sync')

function createBot () {
  const client = new EventEmitter()
  client.entityId = 91n
  client.sent = []
  client.queue = (name, params) => client.sent.push({ name, params })
  const bot = new EventEmitter()
  bot._client = client
  bot.entity = {
    position: {
      x: 1, y: 64, z: 2,
      set (x, y, z) { this.x = x; this.y = y; this.z = z }
    },
    velocity: {
      x: 4, y: -2, z: 3,
      set (x, y, z) { this.x = x; this.y = y; this.z = z }
    }
  }
  bot.controlsCleared = 0
  bot.goalsCleared = 0
  bot.clearControlStates = () => { bot.controlsCleared++ }
  bot.pathfinder = {
    setGoal: value => { assert.equal(value, null); bot.goalsCleared++ },
    stop: () => {}
  }
  return { bot, client }
}

test('BDS dimension changes stop movement and acknowledge the clientbound transfer', () => {
  const { bot, client } = createBot()
  const events = []
  installBedrockDimensionSync(bot, {
    onStart: value => events.push(['start', value.dimension]),
    onComplete: value => events.push(['complete', value.dimension])
  })

  client.emit('change_dimension', {
    dimension: 1,
    position: { x: 120.5, y: 70, z: -34.5 },
    respawn: false,
    loading_screen_id: 7
  })

  assert.equal(bot._jhonDimensionTransition, true)
  assert.deepEqual([bot.entity.position.x, bot.entity.position.y, bot.entity.position.z], [120.5, 70, -34.5])
  assert.deepEqual([bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z], [0, 0, 0])
  assert.equal(bot.controlsCleared, 1)
  assert.equal(bot.goalsCleared, 1)
  assert.deepEqual(client.sent.map(item => item.name), ['player_action'])
  assert.equal(client.sent[0].params.action, 'dimension_change_ack')
  assert.equal(client.sent[0].params.runtime_entity_id, 91n)

  client.emit('player_action', { runtime_entity_id: 91n, action: 'dimension_change_ack' })
  assert.equal(bot._jhonDimensionTransition, false)
  assert.deepEqual(client.sent.slice(1).map(item => item.name), ['serverbound_loading_screen', 'serverbound_loading_screen'])
  assert.deepEqual(client.sent.slice(1).map(item => item.params.type), [1, 2])
  assert.deepEqual(client.sent.slice(1).map(item => item.params.loading_screen_id), [7, 7])
  assert.deepEqual(events, [['start', 1], ['complete', 1]])
})

test('portal spawn-search coordinates are not applied and input stays suspended until the real position arrives', () => {
  const { bot, client } = createBot()
  installBedrockDimensionSync(bot)
  client.emit('change_dimension', {
    dimension: 0,
    position: { x: 0.5, y: SPAWN_SEARCH_Y + 1, z: 0.5 },
    respawn: false,
    loading_screen_id: 12
  })
  client.emit('player_action', { runtime_entity_id: 91n, action: 'dimension_change_ack' })

  assert.equal(bot._jhonDimensionTransition, true)
  assert.equal(bot.entity.position.y, 64, 'temporary spawn-search height must not replace the old feet position yet')
  assert.equal(client.sent.filter(item => item.name === 'serverbound_loading_screen').length, 0)

  bot.entity.position.set(10.5, 72, -8.5)
  bot.emit('move', bot.entity.position)
  assert.equal(bot._jhonDimensionTransition, false)
  assert.equal(bot._jhonResetInputTick, true)
  assert.deepEqual(client.sent.filter(item => item.name === 'serverbound_loading_screen').map(item => item.params.type), [1, 2])
})

test('dimension ACKs for another runtime entity are ignored', () => {
  const { bot, client } = createBot()
  installBedrockDimensionSync(bot)
  client.emit('change_dimension', {
    dimension: 1,
    position: { x: 0.5, y: 70, z: 0.5 },
    loading_screen_id: 3
  })
  client.emit('player_action', { runtime_entity_id: 777n, action: 'dimension_change_ack' })
  assert.equal(bot._jhonDimensionTransition, true)
  assert.equal(client.sent.filter(item => item.name === 'serverbound_loading_screen').length, 0)
  client.emit('player_action', { runtime_entity_id: 91n, action: 'dimension_change_ack' })
  assert.equal(bot._jhonDimensionTransition, false)
})

test('dimension sync leaves End credits to Mineflayer game plugin without sending a duplicate', () => {
  const { bot, client } = createBot()
  installBedrockDimensionSync(bot)
  assert.equal(client.listenerCount('show_credits'), 0)
  client.emit('show_credits', { runtime_entity_id: 91n, status: 0 })
  assert.equal(client.sent.some(item => item.name === 'show_credits'), false)
})
test('disposing dimension synchronization clears the input gate and listeners', () => {
  const { bot, client } = createBot()
  const sync = installBedrockDimensionSync(bot)
  client.emit('change_dimension', {
    dimension: 1,
    position: { x: 1, y: 70, z: 2 },
    loading_screen_id: 2
  })
  sync.dispose()
  assert.equal(bot._jhonDimensionTransition, false)
  assert.equal(client.listenerCount('change_dimension'), 0)
  assert.equal(client.listenerCount('player_action'), 0)
})

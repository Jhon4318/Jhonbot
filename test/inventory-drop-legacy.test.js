'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { tossStackConfirmed } = require('../src/inventory-drop')

function makeAgent (slot = 36, count = 64) {
  const agent = new EventEmitter()
  agent._stackRequest = { id: 1 }
  agent.inventory = { slots: Array(46).fill(null) }
  const item = { slot, name: 'stone', type: 1, count, stackId: 18, networkId: 1 }
  agent.inventory.slots[slot] = item
  agent._bedrockItemToNotch = live => ({
    network_id: live.networkId,
    count: live.count,
    metadata: 0,
    has_stack_id: false,
    block_runtime_id: 0
  })
  const client = new EventEmitter()
  client.queue = (name, packet) => {
    if (name !== 'inventory_transaction') return
    const source = packet.transaction.actions[1]
    const remaining = source.new_item.network_id === 0 ? 0 : source.new_item.count
    agent.inventory.slots[slot] = remaining > 0 ? { ...item, count: remaining } : null
    setTimeout(() => client.emit('inventory_slot', {
      window_id: 'inventory',
      slot: source.slot,
      item: remaining > 0 ? { network_id: 1, count: remaining } : { network_id: 0, count: 0 }
    }), 5)
  }
  client.write = client.queue
  agent._client = client
  agent.tossStack = async () => {
    agent._stackRequest.id -= 2
    const requestId = agent._stackRequest.id
    setTimeout(() => agent.emit('itemStackResponse', 49, requestId, { status: 49, request_id: requestId }), 5)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return { agent, item }
}

test('falls back to legacy world-drop transaction after status 49 and waits for inventory slot update', async () => {
  let sentPacket = null
  const { agent, item } = makeAgent()
  const originalQueue = agent._client.queue
  agent._client.queue = (name, packet) => {
    if (name === 'inventory_transaction') sentPacket = packet
    originalQueue(name, packet)
  }
  const result = await tossStackConfirmed(agent, item, 16)
  assert.equal(result.method, 'inventory_transaction')
  assert.equal(result.droppedCount, 16)
  assert.equal(result.remainingCount, 48)
  assert.equal(agent.inventory.slots[36].count, 48)
  const tx = sentPacket.transaction
  assert.equal(tx.legacy.legacy_request_id, 0)
  assert.equal(tx.transaction_type, 'normal')
  assert.equal(tx.actions[0].source_type, 'world_interaction')
  assert.equal(tx.actions[0].flags, 0)
  assert.equal(tx.actions[0].new_item.count, 16)
  assert.equal(tx.actions[1].source_type, 'container')
  assert.equal(tx.actions[1].window_id, 0)
  assert.equal(tx.actions[1].slot, 0)
  assert.equal(tx.actions[1].old_item.count, 64)
  assert.equal(tx.actions[1].new_item.count, 48)
})

test('maps hotbar slots to protocol slots and handles full-stack drop', async () => {
  let sentPacket = null
  const { agent, item } = makeAgent(36, 8)
  const originalQueue = agent._client.queue
  agent._client.queue = (name, packet) => {
    if (name === 'inventory_transaction') sentPacket = packet
    originalQueue(name, packet)
  }
  const result = await tossStackConfirmed(agent, item, 8)
  assert.equal(result.droppedCount, 8)
  assert.equal(result.remainingCount, 0)
  assert.equal(agent.inventory.slots[36], null)
  assert.equal(sentPacket.transaction.actions[1].slot, 0)
  assert.equal(sentPacket.transaction.actions[1].new_item.network_id, 0)
})

test('maps main inventory slots without rebasing and keeps the remainder', async () => {
  let sentPacket = null
  const { agent, item } = makeAgent(12, 10)
  const originalQueue = agent._client.queue
  agent._client.queue = (name, packet) => {
    if (name === 'inventory_transaction') sentPacket = packet
    originalQueue(name, packet)
  }
  const result = await tossStackConfirmed(agent, item, 4)
  assert.equal(result.droppedCount, 4)
  assert.equal(result.remainingCount, 6)
  assert.equal(sentPacket.transaction.actions[1].slot, 12)
})

test('does not retry status codes other than 49', async () => {
  const { agent, item } = makeAgent()
  agent.tossStack = async () => {
    agent._stackRequest.id -= 2
    const requestId = agent._stackRequest.id
    setTimeout(() => agent.emit('itemStackResponse', 50, requestId, { status: 50, request_id: requestId }), 5)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await assert.rejects(tossStackConfirmed(agent, item, 1), /status=50/)
  assert.equal(agent.listenerCount('itemStackResponse'), 0)
})

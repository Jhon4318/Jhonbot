'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createInventoryDropPlan, tossStackConfirmed } = require('../src/inventory-drop')

function createAgent (status = 'ok', options = {}) {
  const agent = new EventEmitter()
  agent._stackRequest = { id: 1 }
  agent.inventory = { slots: Array(46).fill(null) }
  const item = {
    slot: options.slot ?? 36,
    name: 'stone',
    displayName: 'Stone',
    type: 1,
    count: options.count ?? 64,
    stackId: 18,
    networkId: 1
  }
  agent.inventory.slots[item.slot] = item
  agent._bedrockItemToNotch = liveItem => ({
    network_id: liveItem.networkId,
    count: liveItem.count,
    metadata: 0,
    has_stack_id: false,
    block_runtime_id: 0
  })
  const client = new EventEmitter()
  client.queue = (name, packet) => {
    if (typeof options.onQueue === 'function') options.onQueue(name, packet, agent, item)
  }
  client.write = client.queue
  agent._client = client
  agent.tossStack = async (target, count) => {
    agent._stackRequest.id -= 2
    const requestId = agent._stackRequest.id
    if (options.noResponse) return
    setTimeout(() => {
      if (status === 'ok') {
        const live = agent.inventory.slots[target.slot]
        if (live) {
          live.count -= count
          if (live.count <= 0) agent.inventory.slots[target.slot] = null
        }
      }
      agent.emit('itemStackResponse', status, requestId, { status, request_id: requestId })
    }, options.responseDelayMs ?? 5)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return { agent, item }
}

test('waits for a matching Bedrock item stack response and verifies the stack decreased', async () => {
  const { agent, item } = createAgent('ok')
  const result = await tossStackConfirmed(agent, item, 16)
  assert.equal(result.requestId, -1)
  assert.equal(result.droppedCount, 16)
  assert.equal(result.remainingCount, 48)
  assert.equal(agent.inventory.slots[36].count, 48)
  assert.equal(result.method, 'item_stack_request')
  assert.equal(agent.listenerCount('itemStackResponse'), 0)
})

test('does not report a rejected Bedrock stack request as success', async () => {
  const { agent, item } = createAgent('error')
  await assert.rejects(
    tossStackConfirmed(agent, item, 16),
    /ã‚µãƒ¼ãƒãƒ¼ãŒã‚¢ã‚¤ãƒ†ãƒ æŠ•æ£„ã‚’æ‹’å¦ã—ã¾ã—ãŸ/
  )
  assert.equal(agent.inventory.slots[36].count, 64)
  assert.equal(agent.listenerCount('itemStackResponse'), 0)
})

test('falls back to a Q-style inventory transaction when the server rejects the UI drop with status 49', async () => {
  let sentPacket = null
  const { agent, item } = createAgent(49, {
    onQueue (name, packet, currentAgent, currentItem) {
      if (name !== 'inventory_transaction') return
      sentPacket = packet
      const actions = packet.transaction.actions
      const remaining = actions[1].new_item.count || 0
      currentAgent.inventory.slots[currentItem.slot] = remaining > 0
        ? { ...currentItem, count: remaining }
        : null
      setTimeout(() => currentAgent._client.emit('inventory_slot', {
        window_id: 'inventory',
        slot: actions[1].slot,
        item: remaining > 0 ? { network_id: 1, count: remaining } : { network_id: 0, count: 0 }
      }), 5)
    }
  })

  const result = await tossStackConfirmed(agent, item, 16)
  assert.equal(result.requestId, -1)
  assert.equal(result.method, 'inventory_transaction')
  assert.equal(result.droppedCount, 16)
  assert.equal(result.remainingCount, 48)
  assert.ok(sentPacket)
  const actions = sentPacket.transaction.actions
  assert.equal(sentPacket.transaction.legacy.legacy_request_id, 0)
  assert.equal(actions[0].source_type, 'world_interaction')
  assert.equal(actions[0].flags, 0)
  assert.equal(actions[0].new_item.count, 16)
  assert.equal(actions[1].source_type, 'container')
  assert.equal(actions[1].window_id, 0)
  assert.equal(actions[1].slot, 0)
  assert.equal(actions[1].old_item.count, 64)
  assert.equal(actions[1].new_item.count, 48)
})

test('legacy fallback converts Bedrock hotbar slots to protocol slots and removes a fully dropped stack', async () => {
  let sentPacket = null
  const { agent, item } = createAgent(49, {
    slot: 12,
    count: 8,
    onQueue (name, packet, currentAgent, currentItem) {
      if (name !== 'inventory_transaction') return
      sentPacket = packet
      currentAgent.inventory.slots[currentItem.slot] = null
      setTimeout(() => currentAgent._client.emit('inventory_slot', {
        window_id: 'inventory',
        slot: packet.transaction.actions[1].slot,
        item: { network_id: 0, count: 0 }
      }), 5)
    }
  })
  const result = await tossStackConfirmed(agent, item, 8)
  assert.equal(result.droppedCount, 8)
  assert.equal(result.remainingCount, 0)
  assert.equal(agent.inventory.slots[12], null)
  assert.equal(sentPacket.transaction.actions[1].slot, 12)
  assert.equal(sentPacket.transaction.actions[1].new_item.network_id, 0)
})

test('times out when Bedrock never acknowledges a drop request', async () => {
  const { agent, item } = createAgent('ok', { noResponse: true })
  await assert.rejects(
    tossStackConfirmed(agent, item, 16, { timeoutMs: 20 }),
    /å¿œç­”ãŒå±Šãã¾ã›ã‚“ã§ã—ãŸ/
  )
  assert.equal(agent.listenerCount('itemStackResponse'), 0)
})

test('uses the current live item in the selected slot rather than a stale renderer snapshot', async () => {
  const { agent, item } = createAgent('ok')
  const stale = { slot: 36, name: 'stone', count: 64, stackId: 7 }
  item.stackId = 22
  const result = await tossStackConfirmed(agent, stale, 10)
  assert.equal(result.droppedCount, 10)
  assert.equal(agent.inventory.slots[36].count, 54)
})

test('plans all main-inventory and hotbar stacks while excluding armor and offhand', () => {
  const slots = Array(46).fill(null)
  slots[5] = { slot: 5, name: 'helmet', count: 1 }
  slots[12] = { slot: 12, name: 'apple', displayName: 'Apple', count: 3 }
  slots[36] = { slot: 36, name: 'stone', displayName: 'Stone', count: 64 }
  slots[45] = { slot: 45, name: 'shield', count: 1 }
  const plan = createInventoryDropPlan(Âˆ][\Îˆ

HOˆÜÛİÖÌÍ—KÛİÖÍWKÛİÖÌL—KÛİÖÍWK[BˆJBˆ\ÜÙ\™Y\\]X[
[‹ÂˆÈÛİˆL‹Ûİ[ˆË˜[YNˆ	Ø\IË\Ü^S˜[YNˆ	Ğ\IÈKˆÈÛİˆÍ‹Ûİ[ˆ˜[YNˆ	ÜİÛ™IË\Ü^S˜[YNˆ	ÔİÛ™IÈBˆJBŸJB
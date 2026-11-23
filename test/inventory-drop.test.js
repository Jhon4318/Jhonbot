'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createInventoryDropPlan, tossStackConfirmed } = require('../src/inventory-drop')

function createAgent (status = 'ok', options = {}) {
  const agent = new EventEmitter()
  agent._stackRequest = { id: 1 }
  agent.inventory = { slots: Array(46).fill(null) }
  const item = { slot: 36, name: 'stone', count: 64, stackId: 18 }
  agent.inventory.slots[item.slot] = item
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
    }, options.delayMs ?? 5)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return { agent, item }
}

test('waits for a matching Bedrock item stack response and verifies the stack decreased', async () => {
  const { agent, item } = createAgent('ok')
  const result = await tossStackConfirmed(agent, item, 16)
  assert.equal(result.requestId, -1)
  assert.equal(result.droppedCount, 16)
  assert.equal(agent.inventory.slots[36].count, 48)
  assert.equal(agent.listenerCount('itemStackResponse'), 0)
})

test('does not report a rejected Bedrock stack request as success', async () => {
  const { agent, item } = createAgent('error')
  await assert.rejects(
    tossStackConfirmed(agent, item, 16),
    /サーバーがアイテム投棄を拒否しました/
  )
  assert.equal(agent.inventory.slots[36].count, 64)
  assert.equal(agent.listenerCount('itemStackResponse'), 0)
})

test('times out when Bedrock never acknowledges a drop request', async () => {
  const { agent, item } = createAgent('ok', { noResponse: true })
  await assert.rejects(
    tossStackConfirmed(agent, item, 16, { timeoutMs: 20 }),
    /応答が届きませんでした/
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
  const plan = createInventoryDropPlan({
    items: () => [slots[36], slots[5], slots[12], slots[45], null]
  })
  assert.deepEqual(plan, [
    { slot: 12, count: 3, name: 'apple', displayName: 'Apple' },
    { slot: 36, count: 64, name: 'stone', displayName: 'Stone' }
  ])
})

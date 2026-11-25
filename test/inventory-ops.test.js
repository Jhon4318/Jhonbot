'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { toBedrockInventorySlot, selectHotbarSlot, moveInventorySlotConfirmed } = require('../src/inventory-ops')

function createAgent (source, destination = null) {
  const agent = new EventEmitter()
  agent._stackRequest = { id: 1 }
  agent.quickBarSlot = 0
  agent.inventory = { slots: [] }
  agent.inventory.slots[36] = source ? { type: source.type ?? 1, count: source.count ?? 10, stackId: 41 } : null
  agent.inventory.slots[9] = destination ? { type: destination.type ?? 2, count: destination.count ?? 4, stackId: 22 } : null
  agent.setQuickBarSlot = slot => { agent.quickBarSlot = slot }
  agent._stack = {
    withInventoryOpen: async () => {
      agent.currentWindow = {}
      agent.didOpenInventory = true
      return () => {
        agent.didCloseInventory = true
        agent.currentWindow = null
      }
    }
  }
  agent.moveInventoryItem = (from, to, count) => {
    agent._stackRequest.id -= 2
    const fromAbs = from < 9 ? 36 + from : from
    const toAbs = to < 9 ? 36 + to : to
    const src = agent.inventory.slots[fromAbs]
    const dst = agent.inventory.slots[toAbs]
    if (dst) {
      agent.inventory.slots[fromAbs] = dst
      agent.inventory.slots[toAbs] = src
    } else {
      const amount = count ?? src.count
      agent.inventory.slots[toAbs] = { ...src, count: amount }
      src.count -= amount
      if (src.count <= 0) agent.inventory.slots[fromAbs] = null
    }
    const id = agent._stackRequest.id
    setImmediate(() => agent.emit('itemStackResponse', 'ok', id, { request_id: id }))
    return id
  }
  return agent
}

test('absolute hotbar slots convert to Bedrock relative slots', () => {
  assert.equal(toBedrockInventorySlot(36), 0)
  assert.equal(toBedrockInventorySlot(44), 8)
  assert.equal(toBedrockInventorySlot(9), 9)
  assert.equal(toBedrockInventorySlot(35), 35)
  assert.throws(() => toBedrockInventorySlot(5))
  assert.throws(() => toBedrockInventorySlot(45))
})

test('hotbar selection validates and applies selected slot', () => {
  const agent = createAgent({ count: 1 })
  assert.equal(selectHotbarSlot(agent, 4), 4)
  assert.equal(agent.quickBarSlot, 4)
  assert.throws(() => selectHotbarSlot(agent, 9))
})

test('full stack move waits for a matching server response', async () => {
  const agent = createAgent({ type: 7, count: 10 })
  const result = await moveInventorySlotConfirmed(agent, 36, 9)
  assert.equal(result.itemsMoved, 10)
  assert.equal(agent.inventory.slots[36], null)
  assert.equal(agent.inventory.slots[9].type, 7)
})

test('partial stack move decrements source and fills empty destination', async () => {
  const agent = createAgent({ type: 7, count: 10 })
  const result = await moveInventorySlotConfirmed(agent, 36, 9, 3)
  assert.equal(result.itemsMoved, 3)
  assert.equal(agent.inventory.slots[36].count, 7)
  assert.equal(agent.inventory.slots[9].count, 3)
})

test('swap requires a complete source stack and is confirmed', async () => {
  const agent = createAgent({ type: 7, count: 10 }, { type: 8, count: 4 })
  await moveInventorySlotConfirmed(agent, 36, 9)
  assert.equal(agent.inventory.slots[36].type, 8)
  assert.equal(agent.inventory.slots[9].type, 7)
  await assert.rejects(moveInventorySlotConfirmed(agent, 36, 9, 2), /部分スタック/)
})

test('server rejection and timeout are not treated as success', async () => {
  const rejected = createAgent({ type: 7, count: 10 })
  rejected.moveInventoryItem = (from, to, count) => {
    rejected._stackRequest.id -= 2
    const id = rejected._stackRequest.id
    setImmediate(() => rejected.emit('itemStackResponse', 'rejected', id, {}))
    return id
  }
  await assert.rejects(moveInventorySlotConfirmed(rejected, 36, 9), /拒否/)
  const silent = createAgent({ type: 7, count: 10 })
  silent.moveInventoryItem = (from, to, count) => { silent._stackRequest.id -= 2; return silent._stackRequest.id }
  await assert.rejects(moveInventorySlotConfirmed(silent, 36, 9, undefined, { timeoutMs: 10 }), /応答/)
})


test('crossing between hotbar and main inventory opens and closes the Bedrock inventory window', async () => {
  const agent = createAgent({ type: 7, count: 10 })
  const result = await moveInventorySlotConfirmed(agent, 36, 9)
  assert.equal(result.itemsMoved, 10)
  assert.equal(agent.didOpenInventory, true)
  assert.equal(agent.didCloseInventory, true)
  assert.equal(agent.currentWindow, null)
})

test('cross-slot rejection and timeout still close the temporary inventory window', async () => {
  const rejected = createAgent({ type: 7, count: 10 })
  rejected.moveInventoryItem = (from, to, count) => {
    rejected._stackRequest.id -= 2
    const id = rejected._stackRequest.id
    setImmediate(() => rejected.emit('itemStackResponse', 'rejected', id, {}))
    return id
  }
  await assert.rejects(moveInventorySlotConfirmed(rejected, 36, 9), /拒否/)
  assert.equal(rejected.didCloseInventory, true)

  const timedOut = createAgent({ type: 7, count: 10 })
  timedOut.moveInventoryItem = (from, to, count) => {
    timedOut._stackRequest.id -= 2
    return timedOut._stackRequest.id
  }
  await assert.rejects(moveInventorySlotConfirmed(timedOut, 36, 9, undefined, { timeoutMs: 10 }), /応答/)
  assert.equal(timedOut.didCloseInventory, true)
})

test('invalid source is rejected before opening a temporary inventory window', async () => {
  const agent = createAgent(null)
  await assert.rejects(moveInventorySlotConfirmed(agent, 36, 9), /アイテムがありません/)
  assert.equal(agent.didOpenInventory, undefined)
})

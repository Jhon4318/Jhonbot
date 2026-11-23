'use strict'

function createInventorySlotChangeWaiter (agent, slot, expectedCount, itemType, timeoutMs = 5000) {
  const client = agent?._client
  if (!client || typeof client.on !== 'function' || typeof client.removeListener !== 'function') {
    throw new Error('サーバー側のインベントリ更新を監視できません。')
  }
  const protocolSlot = slot >= 36 ? slot - 36 : slot
  let timer = null
  let settled = false
  let onSlot = null
  let onContent = null
  let onEnd = null
  const currentCount = () => {
    const current = agent.inventory?.slots?.[slot]
    if (!current || current.type !== itemType) return 0
    return Number.isInteger(current.count) ? current.count : 0
  }
  const cleanup = () => {
    if (timer) clearTimeout(timer)
    if (onSlot) client.removeListener('inventory_slot', onSlot)
    if (onContent) client.removeListener('inventory_content', onContent)
    if (onEnd) agent.removeListener('end', onEnd)
  }
  const promise = new Promise((resolve, reject) => {
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    const verify = () => {
      const remainingCount = currentCount()
      if (remainingCount <= expectedCount) finish(null, { remainingCount })
    }
    onSlot = packet => {
      if (packet?.window_id !== 'inventory' || Number(packet.slot) !== protocolSlot) return
      verify()
    }
    onContent = packet => {
      if (packet?.window_id !== 'inventory') return
      verify()
    }
    onEnd = reason => finish(new Error('インベントリ更新を待っている間にBotが切断されました: ' + String(reason || 'disconnected')))
    client.on('inventory_slot', onSlot)
    client.on('inventory_content', onContent)
    agent.once('end', onEnd)
    timer = setTimeout(() => {
      const remainingCount = currentCount()
      if (remainingCount <= expectedCount) {
        finish(null, { remainingCount })
      } else {
        finish(new Error('従来の投棄要求を送信しましたが、サーバーからインベントリ更新が届きませんでした。アイテムが残っているか確認してください。'))
      }
    }, timeoutMs)
  })
  return {
    promise,
    cancel () {
      if (settled) return
      settled = true
      cleanup()
    }
  }
}

function createLegacyInventoryDropPacket (agent, item, count) {
  if (typeof agent?._bedrockItemToNotch !== 'function') {
    throw new Error('Bedrockの従来型インベントリ投棄に必要なアイテム変換APIがありません。')
  }
  const protocolSlot = item.slot >= 36 ? item.slot - 36 : item.slot
  const oldItem = agent._bedrockItemToNotch(item)
  if (!oldItem || !Number.isInteger(oldItem.network_id) || oldItem.network_id === 0) {
    throw new Error('投棄対象のBedrockアイテム情報を変換できません。')
  }
  const emptyItem = () => ({ network_id: 0, count: 0, metadata: 0, has_stack_id: false, block_runtime_id: 0 })
  const droppedItem = { ...oldItem, count }
  const remainingCount = item.count - count
  const remainingItem = remainingCount > 0 ? { ...oldItem, count: remainingCount } : emptyItem()
  return {
    transaction: {
      legacy: { legacy_request_id: 0 },
      transaction_type: 'normal',
      actions: [
        {
          source_type: 'world_interaction',
          flag_presence: true,
          flags: 0,
          slot: 0,
          old_item: emptyItem(),
          new_item: droppedItem
        },
        {
          source_type: 'container',
          container_presence: true,
          window_id: 0,
          flag_presence: true,
          slot: protocolSlot,
          old_item: oldItem,
          new_item: remainingItem
        }
      ]
    }
  }
}

async function tossViaLegacyInventoryTransaction (agent, slot, count, beforeCount, itemType, options = {}) {
  const liveItem = agent.inventory?.slots?.[slot]
  if (!liveItem || liveItem.type !== itemType || liveItem.count !== beforeCount) {
    throw new Error('投棄要求が拒否された後にインベントリが変化しました。安全のため再試行を中止しました。')
  }
  const packet = createLegacyInventoryDropPacket(agent, liveItem, count)
  const expectedCount = beforeCount - count
  const waiter = createInventorySlotChangeWaiter(agent, slot, expectedCount, itemType, options.timeoutMs || 5000)
  try {
    const client = agent._client
    if (typeof client.queue === 'function') client.queue('inventory_transaction', packet)
    else client.write('inventory_transaction', packet)
    const update = await waiter.promise
    return {
      slot,
      requestedCount: count,
      droppedCount: beforeCount - update.remainingCount,
      remainingCount: update.remainingCount,
      method: 'inventory_transaction'
    }
  } finally {
    waiter.cancel()
  }
}

module.exports = { createLegacyInventoryDropPacket, tossViaLegacyInventoryTransaction }

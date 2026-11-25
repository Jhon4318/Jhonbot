'use strict'

const { createItemStackResponseWaiter } = require('./inventory-drop')

function toBedrockInventorySlot (slot) {
  const value = Number(slot)
  if (!Number.isInteger(value) || value < 9 || value > 44) {
    throw new Error('移動できるスロットはメインインベントリとホットバーのみです。')
  }
  return value >= 36 ? value - 36 : value
}

function selectHotbarSlot (agent, slot) {
  const index = Number(slot)
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    throw new Error('ホットバーの選択番号は1〜9です。')
  }
  if (typeof agent?.setQuickBarSlot !== 'function') {
    throw new Error('このBotではホットバー選択APIを利用できません。')
  }
  agent.setQuickBarSlot(index)
  if (Number(agent.quickBarSlot) !== index) {
    throw new Error('ホットバー選択がBot側に反映されませんでした。')
  }
  return index
}

async function moveInventorySlotConfirmed (agent, fromSlot, toSlot, count, options = {}) {
  if (!agent || typeof agent.moveInventoryItem !== 'function') {
    throw new Error('Bedrock用のインベントリ移動APIが利用できません。')
  }
  if (typeof agent.on !== 'function' || typeof agent.removeListener !== 'function') {
    throw new Error('Bedrockのインベントリ移動応答を監視できません。')
  }
  const from = Number(fromSlot)
  const to = Number(toSlot)
  const bedrockFrom = toBedrockInventorySlot(from)
  const bedrockTo = toBedrockInventorySlot(to)
  if (from === to) throw new Error('移動元と移動先が同じです。')

  const crossesHotbarBoundary = (from >= 36) !== (to >= 36)
  let closeInventory = () => {}
  if (crossesHotbarBoundary && !agent.currentWindow) {
    if (typeof agent._stack?.withInventoryOpen !== 'function') {
      throw new Error('メインインベントリとホットバーをまたぐ移動には、Bedrockのインベントリ画面を開く機能が必要です。')
    }
    closeInventory = await agent._stack.withInventoryOpen()
    if (!agent.currentWindow) {
      try { closeInventory() } catch {}
      throw new Error('Bedrockのインベントリ画面を開けませんでした。')
    }
  }

  const inventory = agent.inventory?.slots
  const source = inventory?.[from]
  const destination = inventory?.[to]
  if (!source || !Number.isInteger(source.count) || source.count < 1) {
    throw new Error('移動元スロットにアイテムがありません。')
  }
  if (source.stackId == null) {
    throw new Error('移動元アイテムのStack IDがありません。インベントリを再取得してください。')
  }
  const amount = count == null ? source.count : Number(count)
  if (!Number.isInteger(amount) || amount < 1 || amount > source.count) {
    throw new Error('移動する個数が不正です。')
  }
  if (destination && amount !== source.count) {
    throw new Error('アイテムが入っているスロットとの部分スタック移動はできません。先に空きスロットへ移動してください。')
  }

  // Mineflayer's Bedrock plugin uses one shared request counter. Listen for the
  // exact response before asking the plugin to send the corresponding request.
  const currentRequestId = agent._stackRequest?.id
  if (!Number.isSafeInteger(currentRequestId)) {
    throw new Error('BedrockのItemStackRequest管理情報を取得できません。')
  }
  const requestId = currentRequestId - 2
  const beforeSourceCount = source.count
  const beforeDestination = destination ? { type: destination.type, count: destination.count } : null
  const waiter = createItemStackResponseWaiter(agent, requestId, options.timeoutMs || 5000)
  try {
    const returnedId = agent.moveInventoryItem(bedrockFrom, bedrockTo, amount)
    if (Number(returnedId) !== requestId) {
      throw new Error('インベントリ移動要求IDが一致しません。別のインベントリ操作と競合した可能性があります。')
    }
    const response = await waiter.promise
    const afterSource = agent.inventory?.slots?.[from] || null
    const afterDestination = agent.inventory?.slots?.[to] || null
    if (beforeDestination) {
      if (!afterDestination || afterDestination.type !== source.type || !afterSource || afterSource.type !== beforeDestination.type) {
        throw new Error('サーバーは移動要求を受理しましたが、交換後のスロットが同期されませんでした。インベントリを再取得してください。')
      }
    } else {
      const movedCount = beforeSourceCount - (afterSource?.count || 0)
      if (!afterDestination || afterDestination.type !== source.type || movedCount < amount || afterDestination.count < amount) {
        throw new Error('サーバーは移動要求を受理しましたが、インベントリの反映を確認できませんでした。再取得してください。')
      }
    }
    return { requestId, response, itemsMoved: amount, fromSlot: from, toSlot: to }
  } finally {
    waiter.cancel()
    try { closeInventory() } catch {}
  }
}

module.exports = { toBedrockInventorySlot, selectHotbarSlot, moveInventorySlotConfirmed }

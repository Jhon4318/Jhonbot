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

async function waitForInventoryWindow (agent, options = {}) {
  const timeoutMs = options.timeoutMs || 2500
  const intervalMs = options.intervalMs || 50
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (agent.currentWindow) return agent.currentWindow
    if (options.isConnected && !options.isConnected()) throw new Error('インベントリ画面を開く前にBotが切断されました。')
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  if (agent.currentWindow) return agent.currentWindow
  throw new Error('Bedrockサーバーからインベントリ画面の応答が届きませんでした。Botがワールドに参加しているか確認してください。')
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

  // Validate before opening the inventory window so a bad click never leaves
  // a temporary player inventory screen open.
  const initialInventory = agent.inventory?.slots
  const initialSource = initialInventory?.[from]
  const initialDestination = initialInventory?.[to]
  if (!initialSource || !Number.isInteger(initialSource.count) || initialSource.count < 1) {
    throw new Error('移動元スロットにアイテムがありません。')
  }
  if (initialSource.stackId == null) {
    throw new Error('移動元アイテムのStack IDがありません。インベントリを再取得してください。')
  }
  const amount = count == null ? initialSource.count : Number(count)
  if (!Number.isInteger(amount) || amount < 1 || amount > initialSource.count) {
    throw new Error('移動する個数が不正です。')
  }
  if (initialDestination && amount !== initialSource.count) {
    throw new Error('アイテムが入っているスロットとの部分スタック移動はできません。先に空きスロットへ移動してください。')
  }

  const crossesHotbarBoundary = (from >= 36) !== (to >= 36)
  let closeInventory = () => {}
  let waiter = null
  try {
    if (crossesHotbarBoundary) {
      const existingWindow = agent.currentWindow
      const existingType = String(existingWindow?.bedrockType ?? existingWindow?.type ?? '').toLowerCase()
      if (existingWindow && existingType !== 'inventory') {
        throw new Error('別のコンテナ画面が開いています。閉じてからメインインベントリとホットバーを移動してください。')
      }
      if (!existingWindow) {
        if (typeof agent.openInventory !== 'function') {
          throw new Error('Bedrockのプレイヤーインベントリを開くAPIが利用できません。')
        }
        // Bedrock sends an InteractPacket(open_inventory); the server replies with
        // container_open. Mineflayer exposes the confirmed window as currentWindow.
        agent.openInventory()
        closeInventory = () => {
          if (agent.currentWindow && typeof agent.closeWindow === 'function') {
            agent.closeWindow(agent.currentWindow)
          }
        }
      }
      await waitForInventoryWindow(agent, {
        timeoutMs: options.windowTimeoutMs || 5000,
        intervalMs: options.pollIntervalMs || 50,
        isConnected: () => agent.entity != null || agent._client?.connected !== false
      })
    }

    // Opening the Bedrock inventory may resync slots. Always capture the
    // latest live item and stack id immediately before issuing the request.
    const inventory = agent.inventory?.slots
    const source = inventory?.[from]
    const destination = inventory?.[to]
    if (!source || !Number.isInteger(source.count) || source.count < amount || source.stackId == null) {
      throw new Error('インベントリを開いた後に移動元が変化しました。再取得してください。')
    }
    if (destination && amount !== source.count) {
      throw new Error('移動先スロットが変化しました。部分スタック移動は空きスロットにのみ可能です。')
    }

    // Mineflayer's Bedrock plugin uses one shared request counter. Listen for
    // the exact response before asking the plugin to send the corresponding request.
    const currentRequestId = agent._stackRequest?.id
    if (!Number.isSafeInteger(currentRequestId)) {
      throw new Error('BedrockのItemStackRequest管理情報を取得できません。')
    }
    const requestId = currentRequestId - 2
    const beforeSourceCount = source.count
    const beforeDestination = destination ? { type: destination.type, count: destination.count } : null
    waiter = createItemStackResponseWaiter(agent, requestId, options.timeoutMs || 5000, 'インベントリ移動')
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
    waiter?.cancel()
    try { closeInventory() } catch {}
  }
}
module.exports = { toBedrockInventorySlot, selectHotbarSlot, waitForInventoryWindow, moveInventorySlotConfirmed }

'use strict'

function createInventoryDropPlan (inventory) {
  const items = typeof inventory?.items === 'function' ? inventory.items() : []
  if (!Array.isArray(items)) return []
  return items
    .filter(item => item &&
      Number.isInteger(item.slot) &&
      item.slot >= 9 &&
      item.slot <= 44 &&
      Number.isInteger(item.count) &&
      item.count > 0)
    .sort((a, b) => a.slot - b.slot)
    .map(item => ({
      slot: item.slot,
      count: item.count,
      name: String(item.name || ''),
      displayName: String(item.displayName || item.name || `アイテム ${item.type ?? ''}`)
    }))
}

function createItemStackResponseWaiter (agent, requestId, timeoutMs = 5000) {
  let timer = null
  let settled = false
  const cleanup = () => {
    if (timer) clearTimeout(timer)
    agent.removeListener('itemStackResponse', onResponse)
    agent.removeListener('end', onEnd)
  }
  const promise = new Promise((resolve, reject) => {
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    const onResponse = (status, responseId, response) => {
      if (Number(responseId) !== requestId) return
      if (status !== 'ok') {
        finish(new Error(`サーバーがアイテム投棄を拒否しました（status=${String(status)}）。インベントリを更新して再試行してください。`))
        return
      }
      finish(null, response)
    }
    const onEnd = reason => finish(new Error('投棄応答を待っている間にBotが切断されました: ' + String(reason || 'disconnected')))
    agent.on('itemStackResponse', onResponse)
    agent.once('end', onEnd)
    timer = setTimeout(() => {
      finish(new Error('サーバーからアイテム投棄の応答が届きませんでした。インベントリを更新して再試行してください。'))
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

async function tossStackConfirmed (agent, item, count, options = {}) {
  if (!agent || typeof agent.tossStack !== 'function') {
    throw new Error('Bedrock用のアイテム投棄APIが利用できません。')
  }
  if (typeof agent.on !== 'function' || typeof agent.removeListener !== 'function') {
    throw new Error('Bedrockのアイテム投棄応答を監視できません。')
  }
  const slot = Number(item?.slot)
  if (!Number.isInteger(slot) || slot < 9 || slot > 44) {
    throw new Error('投げるアイテムのスロットが不正です。')
  }
  const liveItem = agent.inventory?.slots?.[slot]
  if (!liveItem || !Number.isInteger(liveItem.count) || liveItem.count < 1) {
    throw new Error('選択したスロットにアイテムがありません。')
  }
  if (liveItem.stackId == null) {
    throw new Error('アイテムのBedrock Stack IDを取得できません。インベントリを更新して再試行してください。')
  }
  const amount = count == null ? liveItem.count : Number(count)
  if (!Number.isInteger(amount) || amount < 1 || amount > liveItem.count) {
    throw new Error(`投げる個数は1〜${liveItem.count}個で入力してください。`)
  }

  // The pinned Bedrock Mineflayer plugin decrements this shared request counter by two immediately
  // before sending item_stack_request. Match its request ID to catch rejected and missing responses.
  const currentRequestId = agent._stackRequest?.id
  if (!Number.isSafeInteger(currentRequestId)) {
    throw new Error('BedrockのItemStackRequest管理情報を取得できません。')
  }
  const requestId = currentRequestId - 2
  const beforeCount = liveItem.count
  const waiter = createItemStackResponseWaiter(agent, requestId, options.timeoutMs || 5000)
  const responseOutcome = waiter.promise.then(
    response => ({ response }),
    error => ({ error })
  )
  try {
    await agent.tossStack(liveItem, amount)
    const outcome = await responseOutcome
    if (outcome.error) throw outcome.error
    const remainingItem = agent.inventory?.slots?.[slot]
    const remainingCount = remainingItem && Number.isInteger(remainingItem.count) ? remainingItem.count : 0
    if (remainingCount > beforeCount - amount) {
      throw new Error('Bedrockサーバーは投棄要求を受理しましたが、ローカルのインベントリが更新されませんでした。再取得してください。')
    }
    return {
      requestId,
      slot,
      requestedCount: amount,
      droppedCount: beforeCount - remainingCount,
      remainingCount,
      response: outcome.response
    }
  } finally {
    waiter.cancel()
  }
}

module.exports = { createInventoryDropPlan, createItemStackResponseWaiter, tossStackConfirmed }

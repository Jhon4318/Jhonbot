'use strict'

function normalizeChatMessage (value, maxLength = 256) {
  if (typeof value !== 'string') throw new Error('チャット内容を文字列で入力してください。')
  const message = value.trim()
  if (!message) throw new Error('チャット内容を入力してください。')
  if (message.length > maxLength) throw new Error(`チャットは${maxLength}文字以内で入力してください。`)
  if (message.includes('\\0')) throw new Error('チャットに使用できない文字が含まれています。')
  return message
}

function createInventorySnapshot (agent) {
  const inventory = agent?.inventory
  if (!inventory || typeof inventory.items !== 'function') return []
  const items = inventory.items()
  if (!Array.isArray(items)) return []
  return items
    .filter(item => item && Number.isInteger(item.slot) && item.slot >= 9 && item.slot <= 44 && Number.isInteger(item.count) && item.count > 0)
    .map(item => ({
      slot: item.slot,
      name: String(item.name || ''),
      displayName: String(item.displayName || item.name || `アイテム ${item.type ?? ''}`),
      count: item.count,
      type: Number.isInteger(item.type) ? item.type : null,
      metadata: Number.isInteger(item.metadata) ? item.metadata : 0
    }))
    .sort((a, b) => a.slot - b.slot)
}

function normalizeDropRequest (input, inventory) {
  const slot = Number(input?.slot)
  if (!Number.isInteger(slot) || slot < 9 || slot > 44) {
    throw new Error('投げるアイテムのスロットが不正です。')
  }
  const item = inventory?.slots?.[slot]
  if (!item || !Number.isInteger(item.count) || item.count < 1) {
    throw new Error('選択したスロットにアイテムがありません。')
  }
  const count = input?.count == null || input.count === '' ? item.count : Number(input.count)
  if (!Number.isInteger(count) || count < 1 || count > item.count) {
    throw new Error(`投げる個数は1〜${item.count}個で入力してください。`)
  }
  return { slot, count, item }
}

module.exports = { normalizeChatMessage, createInventorySnapshot, normalizeDropRequest }

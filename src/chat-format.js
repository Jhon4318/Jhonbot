'use strict'

function plain (value, depth = 0) {
  if (depth > 8 || value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(entry => plain(entry, depth + 1)).join('')
  if (typeof value !== 'object') return ''
  if (value.json && typeof value.json === 'object') return plain(value.json, depth + 1)
  if (typeof value.text === 'string' || typeof value.text === 'number') {
    return String(value.text) + plain(value.extra, depth + 1)
  }
  if (typeof value.translate === 'string') {
    const args = Array.isArray(value.with) ? value.with.map(entry => plain(entry, depth + 1)) : []
    return translate(value.translate, args, value.fallback) + plain(value.extra, depth + 1)
  }
  if (typeof value.selector === 'string') return value.selector
  if (typeof value.keybind === 'string') return value.keybind
  if (value.score && typeof value.score === 'object') return String(value.score.value ?? value.score.name ?? '')
  if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
    const text = String(value.toString())
    if (text && text !== '[object Object]' && !/^%[a-z0-9_.-]+$/i.test(text)) return text
  }
  return plain(value.extra, depth + 1)
}

function translate (key, args, fallback) {
  const normalized = String(key || '').replace(/^%/, '')
  if (normalized === 'multiplayer.player.joined' || normalized === 'multiplayer.player.joined.renamed') {
    return (args[0] || 'プレイヤー') + ' がワールドに参加しました'
  }
  if (normalized === 'multiplayer.player.left') {
    return (args[0] || 'プレイヤー') + ' がワールドから退出しました'
  }
  if (normalized === 'chat.type.text' && args.length >= 2) return '<' + args[0] + '> ' + args[1]
  if (normalized === 'chat.type.announcement' && args.length >= 2) return '[' + args[0] + '] ' + args[1]
  if (normalized === 'chat.type.emote' && args.length >= 2) return '* ' + args[0] + ' ' + args[1]
  if (typeof fallback === 'string' && fallback.trim()) return interpolate(fallback, args)
  if (args.length) return humanizeKey(normalized) + ': ' + args.join(' ')
  return humanizeKey(normalized)
}

function interpolate (template, args) {
  let cursor = 0
  return String(template).replace(/%(?:(\d+)\$)?s|%%/g, (match, explicit) => {
    if (match === '%%') return '%'
    const index = explicit ? Number(explicit) - 1 : cursor++
    return args[index] == null ? '' : String(args[index])
  })
}

function humanizeKey (key) {
  const tokens = String(key || '').split(/[._]/).filter(Boolean)
  if (!tokens.length) return 'システムメッセージ'
  const last = tokens[tokens.length - 1]
  const known = { joined: '参加', left: '退出', disconnected: '切断', died: '死亡', respawn: '復活', changed: '変更', enabled: '有効', disabled: '無効' }
  if (known[last]) return 'システム: ' + tokens.slice(0, -1).join(' ') + ' ' + known[last]
  return 'システム: ' + tokens.join(' ')
}

function formatBedrockChatMessage (message, fallback = '') {
  const formatted = plain(message)
  const result = formatted || plain(fallback)
  if (/^%?[a-z0-9_-]+(?:\.[a-z0-9_-]+){1,}$/i.test(result.trim())) {
    return humanizeKey(result.trim().replace(/^%/, ''))
  }
  return result.slice(0, 1000)
}

module.exports = { formatBedrockChatMessage, translate, plain, humanizeKey }

'use strict'

async function restoreSavedAuthflow (bot, options) {
  if (!bot || !bot.id) throw new TypeError('認証復元対象のBotが必要です。')
  if (typeof options?.hasCache !== 'function' || typeof options?.createAuthflow !== 'function') {
    throw new TypeError('hasCacheとcreateAuthflowが必要です。')
  }
  if (!(await options.hasCache(bot.id))) return { restored: false, reason: 'missing' }

  const authflow = options.createAuthflow(bot)
  const xbox = await authflow.getXboxToken()
  if (!xbox?.XSTSToken || !xbox?.userXUID) {
    throw new Error('保存済み認証キャッシュから有効なXboxトークンを復元できませんでした。')
  }
  return { restored: true, authflow, xbox }
}

module.exports = { restoreSavedAuthflow }

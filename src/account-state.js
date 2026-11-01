'use strict'

function assertCanAuthenticate (bot) {
  if (!bot) throw new Error('Botが見つかりません。')
  if (bot.client || bot.connectionStarting) throw new Error('ワールド接続中はアカウント認証を変更できません。先にBotを切断してください。')
  if (bot.authStarting) throw new Error('このBotはすでにアカウント認証中です。')
  return true
}

function assertCanJoinWorld (bot) {
  if (!bot) throw new Error('Botが見つかりません。')
  if (bot.client || bot.connectionStarting) throw new Error('このBotはすでに接続処理中、または接続済みです。')
  if (bot.accountStatus !== 'authenticated' || !bot.authflow) {
    throw new Error('先に「アカウント認証」を完了してください。')
  }
  if (!['server', 'friend-world', 'lan-world'].includes(bot.targetType)) {
    throw new Error('Botの参加先が選択されていません。Bot一覧からサーバーまたはワールドを選択してください。')
  }
  if (bot.targetType === 'lan-world' && !/^\d{1,20}$/.test(String(bot.networkId || ''))) {
    throw new Error('LANワールドが選択されていません。先にLANワールドを検索してください。')
  }
  return true
}

function accountStatusLabel (status) {
  return ({
    unverified: '未認証・未確認',
    saved: '認証情報保存済み・再確認待ち',
    authenticating: '認証中',
    authenticated: '認証済み',
    error: '認証エラー'
  })[status] || '未確認'
}

module.exports = { assertCanAuthenticate, assertCanJoinWorld, accountStatusLabel }

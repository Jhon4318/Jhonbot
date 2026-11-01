'use strict'

function safeErrorMessage (error) {
  if (error instanceof Error) return String(error.message || error.name || '不明なエラー').slice(0, 2000)
  if (typeof error === 'string') return error.slice(0, 2000)
  return '詳細不明のエラー'
}

function isAllowedAuthUrl (rawUrl) {
  let url
  try { url = new URL(String(rawUrl)) } catch { return null }
  const allowedHosts = new Set(['microsoft.com', 'www.microsoft.com', 'login.live.com', 'login.microsoftonline.com'])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) return null
  if (url.username || url.password) return null
  return url.toString()
}

module.exports = { safeErrorMessage, isAllowedAuthUrl }

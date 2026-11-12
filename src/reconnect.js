'use strict'

const DEFAULT_RECONNECT_SETTINGS = Object.freeze({ enabled: true, initialDelayMs: 5000, maxDelayMs: 60000, jitterRatio: 0.2 })

function boundedInteger (value, fallback, min, max) {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

function normalizeReconnectSettings (input = {}) {
  const initialDelayMs = boundedInteger(input.initialDelayMs, 5000, 1000, 60000)
  const maxDelayMs = boundedInteger(input.maxDelayMs, 60000, initialDelayMs, 300000)
  const jitter = Number(input.jitterRatio)
  return { enabled: true, initialDelayMs, maxDelayMs, jitterRatio: Number.isFinite(jitter) ? Math.max(0, Math.min(0.5, jitter)) : 0.2 }
}

function nextReconnectDelay (attempt, config = DEFAULT_RECONNECT_SETTINGS, random = Math.random) {
  const settings = normalizeReconnectSettings(config)
  const retry = Math.max(1, Math.min(30, Math.floor(Number(attempt) || 1)))
  const base = Math.min(settings.maxDelayMs, settings.initialDelayMs * (2 ** (retry - 1)))
  const sample = Math.max(0, Math.min(1, Number(random()) || 0))
  const factor = 1 + ((sample * 2) - 1) * settings.jitterRatio
  return Math.max(1000, Math.min(settings.maxDelayMs, Math.round(base * factor)))
}

function containsNonRetryableReason (text) {
  return /auth(?:entication)?|xbox|microsoft|banned|ban(?:ned)?|kick(?:ed)?|denied|unauthorized|cancelled|canceled|キャンセル|server.?key|public.?key|fingerprint|サーバー鍵|公開鍵|NetherNet.*鍵|鍵.*信頼|鍵.*拒否|本人確認.*拒否|permission|not invited|couldn't find a realm|アカウント認証|認証に失敗|キック|BAN|利用停止/i.test(text)
}

function isTransientNetworkFailure (text) {
  return /timeout|timed out|ECONN|EHOST|ENET|EPIPE|socket|network|connecterror|ICE|WebRTC|connection reset|connection closed|connection lost|transport closed|接続が終了|通信切断/i.test(text)
}

function shouldAutoReconnect (options = {}) {
  const { enabled = true, manualDisconnect = false, kicked = false, isGuest = false, wasEstablished = false, reconnectInProgress = false, hadError = false, reason = '', lastError = '' } = options
  if (!enabled || manualDisconnect || kicked || isGuest) return false
  const text = [reason, lastError].filter(Boolean).join(' ')
  if (containsNonRetryableReason(text)) return false
  if (wasEstablished || reconnectInProgress) return true
  return isTransientNetworkFailure(text)
}

module.exports = { DEFAULT_RECONNECT_SETTINGS, normalizeReconnectSettings, nextReconnectDelay, containsNonRetryableReason, isTransientNetworkFailure, shouldAutoReconnect }

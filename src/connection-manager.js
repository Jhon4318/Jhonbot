'use strict'

const RECONNECT_POLICY = Object.freeze({
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  jitterRatio: 0.2
})

function reconnectDelay (attempt, random = Math.random, policy = RECONNECT_POLICY) {
  const safeAttempt = Math.max(1, Math.min(30, Math.floor(Number(attempt) || 1)))
  const initial = Math.max(1000, Number(policy.initialDelayMs) || RECONNECT_POLICY.initialDelayMs)
  const maximum = Math.max(initial, Number(policy.maxDelayMs) || RECONNECT_POLICY.maxDelayMs)
  const jitter = Math.max(0, Math.min(0.5, Number(policy.jitterRatio) || 0))
  const base = Math.min(maximum, initial * (2 ** (safeAttempt - 1)))
  const sample = Math.max(0, Math.min(0.999999, Number(random()) || 0))
  return Math.max(1000, Math.round(base * (1 + ((sample * 2) - 1) * jitter)))
}

function isRetryableDisconnect (reason, lastError = '', wasConnected = false) {
  const text = [reason, lastError].filter(Boolean).join(' ').toLowerCase()
  if (/manual(?:ly)? disconnect|bot leaving|user disconnect|手動切断|キック|kicked|kick|banned|ban|whitelist|not invited|permission|unauthori[sz]ed|access denied|authentication|auth failed|xbox|microsoft|token|credentials|server key|public key|公開鍵|本人確認|realm (?:not found|expired)|world selection.*cancel|キャンセル|plugin initialization|invalid destination/i.test(text)) {
    return false
  }
  if (wasConnected) return true
  return /timeout|timed out|econn|ehost|enet|epipe|socket|network|connecterror|ice|webrtc|connection reset|connection closed|connection lost|transport closed|server closed|server shutdown|disconnected|disconnect|connection ended|connection failed|connection refused/i.test(text)
}

module.exports = { RECONNECT_POLICY, reconnectDelay, isRetryableDisconnect }

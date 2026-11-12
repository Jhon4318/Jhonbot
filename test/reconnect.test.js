'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_RECONNECT_SETTINGS, normalizeReconnectSettings, nextReconnectDelay, containsNonRetryableReason, isTransientNetworkFailure, shouldAutoReconnect } = require('../src/reconnect')

test('normalizes a globally enabled reconnect policy', () => {
  assert.deepEqual(normalizeReconnectSettings(), DEFAULT_RECONNECT_SETTINGS)
  assert.deepEqual(normalizeReconnectSettings({ enabled: false, initialDelayMs: 100, maxDelayMs: 999999, jitterRatio: 2 }), { enabled: true, initialDelayMs: 5000, maxDelayMs: 60000, jitterRatio: 0.5 })
})

test('uses exponential backoff capped at maximum with bounded jitter', () => {
  const config = { initialDelayMs: 5000, maxDelayMs: 60000, jitterRatio: 0.2 }
  assert.equal(nextReconnectDelay(1, config, () => 0.5), 5000)
  assert.equal(nextReconnectDelay(2, config, () => 0.5), 10000)
  assert.equal(nextReconnectDelay(4, config, () => 0.5), 40000)
  assert.equal(nextReconnectDelay(8, config, () => 0.5), 60000)
  assert.equal(nextReconnectDelay(1, config, () => 0), 4000)
  assert.equal(nextReconnectDelay(1, config, () => 1), 6000)
})

test('retries every unexpected disconnect after a successful world join', () => {
  assert.equal(shouldAutoReconnect({ wasEstablished: true, reason: '' }), true)
  assert.equal(shouldAutoReconnect({ wasEstablished: true, reason: 'connection closed' }), true)
  assert.equal(shouldAutoReconnect({ reconnectInProgress: true, reason: 'ETIMEDOUT' }), true)
})

test('does not retry manual disconnect, guest, kick, ban or authentication failure', () => {
  assert.equal(shouldAutoReconnect({ wasEstablished: true, manualDisconnect: true }), false)
  assert.equal(shouldAutoReconnect({ wasEstablished: true, isGuest: true }), false)
  assert.equal(shouldAutoReconnect({ wasEstablished: true, kicked: true }), false)
  assert.equal(shouldAutoReconnect({ wasEstablished: true, reason: 'Player was banned' }), false)
  assert.equal(shouldAutoReconnect({ wasEstablished: true, reason: 'Xbox authentication failed' }), false)
  assert.equal(containsNonRetryableReason('Server key approval denied'), true)
})

test('retries transient network failures during initial connection', () => {
  assert.equal(isTransientNetworkFailure('Connect timed out'), true)
  assert.equal(isTransientNetworkFailure('ECONNRESET socket hang up'), true)
  assert.equal(shouldAutoReconnect({ hadError: true, reason: 'ECONNRESET' }), true)
  assert.equal(shouldAutoReconnect({ hadError: true, reason: 'Invalid Realm invite' }), false)
})

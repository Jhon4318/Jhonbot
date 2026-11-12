'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { RECONNECT_POLICY, reconnectDelay, isRetryableDisconnect } = require('../src/connection-manager')

test('uses capped exponential backoff with bounded jitter', () => {
  const low = reconnectDelay(1, () => 0)
  const high = reconnectDelay(1, () => 1)
  assert.equal(RECONNECT_POLICY.initialDelayMs, 5000)
  assert.ok(low >= 4000 && low <= 5000)
  assert.ok(high >= 5000 && high <= 6000)
  assert.ok(reconnectDelay(10, () => 0.5) <= 60000)
  assert.equal(reconnectDelay(10, () => 0.5), 60000)
})

test('retries common connection losses even without module assignment', () => {
  assert.equal(isRetryableDisconnect('ECONNRESET socket hang up'), true)
  assert.equal(isRetryableDisconnect('connection timed out'), true)
  assert.equal(isRetryableDisconnect('Server closed connection: connecterror:14'), true)
  assert.equal(isRetryableDisconnect('', '', true), true)
})

test('does not retry manual disconnect, kicks, auth failures, or denied keys', () => {
  assert.equal(isRetryableDisconnect('Bot leaving', '', true), false)
  assert.equal(isRetryableDisconnect('Player was kicked', '', true), false)
  assert.equal(isRetryableDisconnect('Xbox authentication failed'), false)
  assert.equal(isRetryableDisconnect('Server key approval denied'), false)
  assert.equal(isRetryableDisconnect('Realm not found'), false)
})

test('retries transient initial connection failures but not config errors', () => {
  assert.equal(isRetryableDisconnect('Connect timeout', '', false), true)
  assert.equal(isRetryableDisconnect('参加先未設定', '', false), false)
})

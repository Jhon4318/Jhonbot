'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { assertCanAuthenticate, assertCanJoinWorld, accountStatusLabel } = require('../src/account-state')

test('requires a completed account Authflow before a world join', () => {
  assert.throws(() => assertCanJoinWorld({ accountStatus: 'unverified', authflow: null }), /先に「アカウント認証」/)
  assert.throws(() => assertCanJoinWorld({ accountStatus: 'authenticated', authflow: null }), /先に「アカウント認証」/)
  assert.throws(() => assertCanJoinWorld({ accountStatus: 'authenticated', authflow: {}, targetType: 'none' }), /参加先が選択されていません/)
  assert.equal(assertCanJoinWorld({ accountStatus: 'authenticated', authflow: {}, targetType: 'friend-world' }), true)
  assert.equal(assertCanJoinWorld({ accountStatus: 'authenticated', authflow: {}, targetType: 'server' }), true)
  assert.throws(() => assertCanJoinWorld({ accountStatus: 'authenticated', authflow: {}, targetType: 'lan-world', networkId: '' }), /LANワールドが選択されていません/)
})

test('prevents starting account authentication during a world connection', () => {
  assert.throws(() => assertCanAuthenticate({ client: {}, connectionStarting: false }), /ワールド接続中/)
  assert.throws(() => assertCanAuthenticate({ client: null, connectionStarting: true }), /ワールド接続中/)
  assert.throws(() => assertCanAuthenticate({ client: null, connectionStarting: false, authStarting: true }), /認証中/)
  assert.equal(assertCanAuthenticate({ client: null, connectionStarting: false, authStarting: false }), true)
})

test('provides stable Japanese account status labels', () => {
  assert.equal(accountStatusLabel('unverified'), '未認証・未確認')
  assert.equal(accountStatusLabel('saved'), '認証情報保存済み・再確認待ち')
  assert.equal(accountStatusLabel('authenticated'), '認証済み')
  assert.equal(accountStatusLabel('unknown'), '未確認')
})

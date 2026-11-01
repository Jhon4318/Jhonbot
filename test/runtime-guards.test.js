'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { safeErrorMessage, isAllowedAuthUrl } = require('../src/runtime-guards')

test('safeErrorMessage handles Error, strings and unknown values', () => {
  assert.equal(safeErrorMessage(new Error('boom')), 'boom')
  assert.equal(safeErrorMessage('bad'), 'bad')
  assert.equal(safeErrorMessage({}), '詳細不明のエラー')
  assert.equal(safeErrorMessage('x'.repeat(3000)).length, 2000)
})

test('allows only expected HTTPS Microsoft authentication URLs', () => {
  assert.equal(isAllowedAuthUrl('https://www.microsoft.com/link'), 'https://www.microsoft.com/link')
  assert.equal(isAllowedAuthUrl('https://login.live.com/oauth20_authorize.srf'), 'https://login.live.com/oauth20_authorize.srf')
  assert.equal(isAllowedAuthUrl('http://www.microsoft.com/link'), null)
  assert.equal(isAllowedAuthUrl('https://microsoft.com.evil.example/'), null)
  assert.equal(isAllowedAuthUrl('https://user:pass@www.microsoft.com/'), null)
  assert.equal(isAllowedAuthUrl('not a url'), null)
})

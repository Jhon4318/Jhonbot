'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { nextGuestSubClientId, resolveGuestLabel } = require('../src/guest-naming')

test('assigns the first free SubClient slot in Tsukuyomi order', () => {
  const bots = [
    { parentBotId: 'parent-a', subClientId: 1 },
    { parentBotId: 'parent-a', subClientId: 3 },
    { parentBotId: 'parent-b', subClientId: 1 }
  ]
  assert.equal(nextGuestSubClientId(bots, 'parent-a'), 2)
  assert.equal(nextGuestSubClientId(bots, 'parent-b'), 2)
})

test('reuses the lowest freed guest slot and stops after three guests', () => {
  const bots = [
    { parentBotId: 'parent-a', subClientId: 2 },
    { parentBotId: 'parent-a', subClientId: 3 }
  ]
  assert.equal(nextGuestSubClientId(bots, 'parent-a'), 1)
  assert.equal(nextGuestSubClientId([
    ...bots,
    { parentBotId: 'parent-a', subClientId: 1 }
  ], 'parent-a'), null)
})

test('blank guest name uses the parent label and SubClient number like Tsukuyomi', () => {
  assert.equal(resolveGuestLabel('JhonSub001', 1, ''), 'JhonSub001 (1)')
  assert.equal(resolveGuestLabel('JhonSub001', 2, null), 'JhonSub001 (2)')
  assert.equal(resolveGuestLabel('JhonSub001', 3, '   '), 'JhonSub001 (3)')
})

test('a custom guest name is preserved after trimming', () => {
  assert.equal(resolveGuestLabel('JhonSub001', 1, '  MyGuest  '), 'MyGuest')
})

test('custom guest names longer than 32 characters are rejected', () => {
  assert.throws(() => resolveGuestLabel('JhonSub001', 1, 'x'.repeat(33)), /32文字以内/)
})

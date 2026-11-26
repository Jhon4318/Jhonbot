'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  shouldAutoSelectPreviousFriendWorld,
  getReconnectableGuestBots,
  captureModuleResumeState,
  hasModuleResumeState
} = require('../src/reconnect-policy')

test('previous friend world is auto-selected only for automatic reconnects', () => {
  assert.equal(shouldAutoSelectPreviousFriendWorld(true), true)
  assert.equal(shouldAutoSelectPreviousFriendWorld(false), false)
  assert.equal(shouldAutoSelectPreviousFriendWorld(undefined), false)
})

test('only previously joined guest Bots are eligible for automatic parent reconnect', () => {
  const guests = [
    { id: 'registered-only', parentBotId: 'parent', subClientId: 1 },
    { id: 'joined-guest-2', parentBotId: 'parent', subClientId: 2, autoReconnectEligible: true },
    { id: 'joined-guest-1', parentBotId: 'parent', subClientId: 1, autoReconnectEligible: true },
    { id: 'manually-stopped', parentBotId: 'parent', subClientId: 3, autoReconnectEligible: true, manualDisconnect: true },
    { id: 'already-active', parentBotId: 'parent', subClientId: 4, autoReconnectEligible: true, agent: {} },
    { id: 'other-parent', parentBotId: 'other', subClientId: 1, autoReconnectEligible: true }
  ]
  assert.deepEqual(
    getReconnectableGuestBots(guests, 'parent').map(guest => guest.id),
    ['joined-guest-1', 'joined-guest-2', 'already-active']
  )
  assert.deepEqual(getReconnectableGuestBots(guests, 'missing-parent'), [])
  assert.deepEqual(getReconnectableGuestBots(null, 'parent'), [])
})

test('captures only modules that were actively running at disconnect time', () => {
  assert.deepEqual(captureModuleResumeState({
    itemUseRunning: true,
    itemUseSlot: 36,
    containerSupplyRunning: false,
    autoFishingRunning: false
  }), { itemUse: true, itemUseSlot: 36, containerSupply: false, autoFishing: false, lookDirection: null })

  assert.deepEqual(captureModuleResumeState({
    itemUseRunning: false,
    containerSupplyRunning: true,
    autoFishingRunning: false
  }), { itemUse: false, itemUseSlot: null, containerSupply: true, autoFishing: false, lookDirection: null })

  assert.deepEqual(captureModuleResumeState({
    itemUseRunning: false,
    containerSupplyRunning: false,
    autoFishingRunning: true
  }), { itemUse: false, itemUseSlot: null, containerSupply: false, autoFishing: true, lookDirection: null })
})

test('does not create resume work when no runtime Mod was active', () => {
  assert.equal(captureModuleResumeState({}), null)
  assert.equal(hasModuleResumeState(null), false)
  assert.equal(hasModuleResumeState({ itemUse: false, containerSupply: false, autoFishing: false }), false)
  assert.equal(hasModuleResumeState({ itemUse: true }), true)
  assert.equal(hasModuleResumeState({ lookDirection: { yawDeg: 90, pitchDeg: -15 } }), true)
  assert.deepEqual(captureModuleResumeState({
    modules: { lookDirection: { assigned: true, yawDeg: 90, pitchDeg: -15 } },
    lookDirectionStatus: '適用済み · Yaw 90° / Pitch -15°'
  }), { itemUse: false, itemUseSlot: null, containerSupply: false, autoFishing: false, lookDirection: { yawDeg: 90, pitchDeg: -15 } })
})

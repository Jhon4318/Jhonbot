'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSkinHistory, rememberSkin, skinFingerprint } = require('../src/skin-history')

function skin (id) {
  return {
    skinData: {
      SkinId: id,
      SkinData: Buffer.from(id).toString('base64'),
      SkinGeometryData: Buffer.from(JSON.stringify({ id })).toString('base64'),
      SkinResourcePatch: Buffer.from(JSON.stringify({ geometry: { default: 'geometry.skin' } })).toString('base64')
    },
    skinMeta: { name: id, previewDataUrl: 'data:image/png;base64,' + Buffer.from(id).toString('base64') }
  }
}

test('rememberSkin keeps the newest three distinct skins and moves a reused skin to the front', () => {
  let history = []
  for (const id of ['A', 'B', 'C', 'D']) {
    const entry = skin(id)
    history = rememberSkin(history, entry.skinData, entry.skinMeta)
  }

  assert.deepEqual(history.map(entry => entry.skinMeta.name), ['D', 'C', 'B'])
  const selected = history[2]
  history = rememberSkin(history, selected.skinData, selected.skinMeta)
  assert.deepEqual(history.map(entry => entry.skinMeta.name), ['B', 'D', 'C'])
  assert.equal(history.length, 3)
})

test('normalizeSkinHistory drops malformed entries and duplicate skin content', () => {
  const first = skin('A')
  const duplicate = { skinData: { ...first.skinData }, skinMeta: { name: 'A duplicate' } }
  const history = normalizeSkinHistory([
    null,
    { skinData: {}, skinMeta: null },
    first,
    duplicate,
    skin('B')
  ])

  assert.deepEqual(history.map(entry => entry.skinMeta.name), ['A', 'B'])
  assert.equal(skinFingerprint(first.skinData), skinFingerprint(duplicate.skinData))
})

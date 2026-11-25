'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { PNG } = require('pngjs')
const { zipSync } = require('fflate')
const { importSkinEntries, clientSkinToPlayerSkin, decodeRawSkinBin } = require('../src/skin-import')

function pngBuffer (width = 64, height = 64) {
  return PNG.sync.write({ width, height, data: Buffer.alloc(width * height * 4, 255) })
}

test('classic PNG skin creates Bedrock login skin fields and preview', () => {
  const imported = importSkinEntries([{ name: 'skin.png', data: pngBuffer() }])
  assert.equal(imported.skinData.SkinImageWidth, 64)
  assert.equal(imported.skinData.SkinImageHeight, 64)
  assert.equal(Buffer.from(imported.skinData.SkinData, 'base64').length, 64 * 64 * 4)
  assert.match(imported.previewDataUrl, /^data:image\/png;base64,/)
  assert.equal(imported.meta.hasGeometry, false)
})

test('4D geometry and animation JSON are included in the skin packet payload', () => {
  const geometry = { format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.test.4d' }, bones: [] }] }
  const animation = { format_version: '1.8.0', animations: { 'animation.test.idle': { loop: true } } }
  const imported = importSkinEntries([
    { name: 'skin.png', data: pngBuffer() },
    { name: 'geometry.json', data: Buffer.from(JSON.stringify(geometry)) },
    { name: 'animations.json', data: Buffer.from(JSON.stringify(animation)) }
  ])
  assert.equal(imported.meta.geometryId, 'geometry.test.4d')
  assert.equal(imported.meta.hasGeometry, true)
  assert.equal(imported.meta.hasAnimation, true)
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinGeometryData, 'base64').toString()), geometry)
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinAnimationData, 'base64').toString()), animation)
  const wire = clientSkinToPlayerSkin(imported.skinData)
  assert.equal(wire.skin_id, imported.skinData.SkinId)
  assert.equal(wire.geometry_data, imported.skinData.SkinGeometryData)
  assert.equal(wire.skin_data.width, 64)
  assert.equal(wire.skin_data.data.length, 64 * 64 * 4)
})

test('MCpack ZIP archive is read without extracting untrusted paths to disk', () => {
  const pack = zipSync({
    'textures/skin.png': pngBuffer(),
    'models/geometry.json': Buffer.from(JSON.stringify({ 'minecraft:geometry': [{ description: { identifier: 'geometry.pack' } }] }))
  })
  const imported = importSkinEntries([{ name: 'skin.mcpack', data: Buffer.from(pack) }])
  assert.equal(imported.meta.geometryId, 'geometry.pack')
  assert.equal(imported.meta.hasGeometry, true)
})

test('SkinStealer BIN with a known raw RGBA size is restored, unknown BIN is rejected', () => {
  const raw = Buffer.alloc(64 * 64 * 4, 127)
  const restored = decodeRawSkinBin(raw, 'skin.bin')
  assert.equal(restored.width, 64)
  assert.equal(restored.height, 64)
  assert.throws(() => decodeRawSkinBin(Buffer.alloc(1234), 'mystery.bin'), /判別できません/)
})

test('archive path traversal entries are ignored', () => {
  const pack = zipSync({
    '../outside.png': pngBuffer(),
    'skins/skin.png': pngBuffer()
  })
  const imported = importSkinEntries([{ name: 'safe.mcpack', data: Buffer.from(pack) }])
  assert.equal(imported.meta.width, 64)
})

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
  assert.deepEqual(JSON.parse(wire.geometry_data), geometry)
  assert.deepEqual(JSON.parse(wire.animation_data), animation)
  assert.deepEqual(JSON.parse(wire.skin_resource_pack), { geometry: { default: 'geometry.test.4d' } })
  assert.equal(wire.geometry_data_version, '1.12.0')
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


test('SkinStealer JSON stored with a BIN extension restores embedded geometry, animation and RGBA texture', () => {
  const geometry = { 'minecraft:geometry': [{ description: { identifier: 'geometry.skinstealer.4d' }, bones: [] }] }
  const animation = { animations: { 'animation.skinstealer.idle': { loop: true } } }
  const pixels = Buffer.alloc(64 * 64 * 4, 96)
  const metadata = {
    SkinImageWidth: 64,
    SkinImageHeight: 64,
    SkinData: pixels.toString('base64'),
    SkinGeometryData: Buffer.from(JSON.stringify(geometry)).toString('base64'),
    SkinGeometryDataEngineVersion: Buffer.from('1.12.0').toString('base64'),
    SkinAnimationData: Buffer.from(JSON.stringify(animation)).toString('base64')
  }
  const imported = importSkinEntries([{ name: 'full_skin.bin', data: Buffer.from(JSON.stringify(metadata)) }])
  assert.equal(imported.meta.geometryId, 'geometry.skinstealer.4d')
  assert.equal(imported.meta.hasGeometry, true)
  assert.equal(imported.meta.hasAnimation, true)
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinGeometryData, 'base64').toString()), geometry)
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinAnimationData, 'base64').toString()), animation)
  assert.equal(Buffer.from(imported.skinData.SkinData, 'base64').length, 64 * 64 * 4)
})


test('PlayerSkin wire format decodes all base64 strings and converts animated image fields', () => {
  const texture = Buffer.alloc(32 * 32 * 4, 18)
  const geometry = '{"format_version":"1.12.0","minecraft:geometry":[]}'
  const resourcePatch = '{"geometry":{"default":"geometry.humanoid.custom"}}'
  const animationData = '{"animations":{"animation.test.idle":{"loop":true}}}'
  const wire = clientSkinToPlayerSkin({
    SkinId: 'skin-id',
    SkinResourcePatch: Buffer.from(resourcePatch).toString('base64'),
    SkinImageWidth: 64,
    SkinImageHeight: 64,
    SkinData: Buffer.alloc(64 * 64 * 4, 1).toString('base64'),
    AnimatedImageData: [{
      Image: { Width: 32, Height: 32, Data: texture.toString('base64') },
      Type: 'Body32x32',
      Frames: 4,
      AnimationExpression: 'Blinking'
    }],
    SkinGeometryData: Buffer.from(geometry).toString('base64'),
    SkinGeometryDataEngineVersion: Buffer.from('1.12.0').toString('base64'),
    SkinAnimationData: Buffer.from(animationData).toString('base64')
  })
  assert.equal(wire.skin_resource_pack, resourcePatch)
  assert.equal(wire.geometry_data, geometry)
  assert.equal(wire.geometry_data_version, '1.12.0')
  assert.equal(wire.animation_data, animationData)
  assert.equal(wire.animations.length, 1)
  assert.equal(wire.animations[0].skin_image.width, 32)
  assert.equal(wire.animations[0].skin_image.height, 32)
  assert.equal(wire.animations[0].skin_image.data.length, texture.length)
  assert.equal(wire.animations[0].animation_type, 2)
  assert.equal(wire.animations[0].animation_frames, 4)
  assert.equal(wire.animations[0].expression_type, 1)
})

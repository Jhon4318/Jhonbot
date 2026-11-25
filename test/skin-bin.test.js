'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readVarInt, decodeTsukuyomiPersonaSkinBin } = require('../src/skin-bin')

function varInt (value) {
  const bytes = []
  let remaining = value >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return Buffer.from(bytes)
}

function createPersonaBin () {
  const skinId = Buffer.from('persona-parser-regression-001')
  const patch = Buffer.from(JSON.stringify({
    geometry: {
      default: 'geometry.persona_test',
      animated_face: 'geometry.animated_face_persona_test'
    }
  }))
  const geometry = Buffer.from(JSON.stringify({
    format_version: '1.14.0',
    'minecraft:geometry': [
      { description: { identifier: 'geometry.persona_test' }, bones: [] },
      { description: { identifier: 'geometry.animated_face_persona_test' }, bones: [] }
    ]
  }))
  const pixels = Buffer.alloc(256 * 256 * 4, 0x5a)
  const version = Buffer.from('1.14.0')
  return Buffer.concat([
    Buffer.from([skinId.length]), skinId,
    varInt(patch.length), patch,
    Buffer.from([0, 1, 0, 0, 0, 1, 0, 0]),
    varInt(pixels.length), pixels,
    Buffer.alloc(0x200),
    varInt(geometry.length), geometry,
    Buffer.from([version.length]), version
  ])
}

test('varint reads multi-byte lengths used by SkinStealer geometry records', () => {
  const data = varInt(26803)
  assert.deepEqual(readVarInt(data, 0), { value: 26803, offset: 3, bytes: 3 })
})

test('decoder restores the Persona texture, full ResourcePatch and both 4D geometry definitions', () => {
  const source = createPersonaBin()
  const decoded = decodeTsukuyomiPersonaSkinBin(source, 'skin.bin')
  assert.equal(decoded.skinId, 'persona-parser-regression-001')
  assert.equal(decoded.width, 256)
  assert.equal(decoded.height, 256)
  assert.equal(decoded.data.length, 256 * 256 * 4)
  assert.equal(decoded.data[0], 0x5a)
  assert.equal(decoded.geometryVersion, '1.14.0')
  assert.equal(decoded.personaSkin, true)
  assert.equal(decoded.geometry['minecraft:geometry'].length, 2)
  assert.equal(decoded.resourcePatch.geometry.animated_face, 'geometry.animated_face_persona_test')
})

test('decoder rejects an unrelated or truncated binary without misclassifying it as a skin', () => {
  assert.equal(decodeTsukuyomiPersonaSkinBin(Buffer.from('not a skin'), 'other.bin'), null)
  assert.throws(() => decodeTsukuyomiPersonaSkinBin(Buffer.concat([Buffer.from([20]), Buffer.from('persona-short')]), 'skin.bin'), /可変長整数|データ長|読み取れません/)
})

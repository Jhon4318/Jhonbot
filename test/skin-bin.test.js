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
  const tintColors = [
    ['mouth', [0x0e2245ff, 0x00000000, 0x19192aff, 0x00000000]],
    ['eyes', [0x191514ff, 0x0e182eff, 0xecece9ff, 0x00000000]],
    ['hair', [0x0d111bff, 0x00000000, 0x00000000, 0x00000000]]
  ]
  const piece = (pieceId, pieceType, packBytes, isDefault = true, productId = '') => {
    const id = Buffer.from(pieceId)
    const product = Buffer.from(productId)
    return Buffer.concat([
      Buffer.from([id.length]), id,
      Buffer.from([pieceType, 0, 0, 0]),
      Buffer.from(packBytes),
      Buffer.from([isDefault ? 1 : 0, product.length]),
      product
    ])
  }
  const pieces = Buffer.concat([
    piece('b6702f0e-a4b5-497a-8820-6c8e3946bb55', 7, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('49f93789-a512-4c47-95cb-0606cdc1c2be', 4, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('68bfe60d-f30a-422f-b32c-72374ebdd057', 5, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('f1e4c577-19ba-4d77-9222-47f145857f78', 3, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('2bb1473b-9a5c-4eae-9fd5-82302a6aa3da', 14, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('3a5eb037-61a6-492f-852b-501378114f9a', 13, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('2e4341c3-c014-4114-94b5-73968230aaaf', 12, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('c3ea4527-e2d7-4aae-86a4-0bb3d1b98d84', 2, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('142782c6-93bb-4e5a-af32-df6cd4164dca', 1, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('37bafcd1-2693-ad94-5da3-ad7901a47224', 10, Buffer.from('5a469a4218de9920b37ba11047fc9ba4', 'hex')),
    piece('bf8a74df-5ad7-4a3b-76b4-6226329ad273', 18, Buffer.from('2f49a66137b05e3a9a4f117813502b85', 'hex'), false)
  ])
  const tints = Buffer.concat([
    Buffer.from([3]),
    ...tintColors.map(([name, values]) => Buffer.concat([
      Buffer.from([Buffer.byteLength(name)]), Buffer.from(name),
      ...values.map(value => Buffer.from([
        (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff
      ]))
    ]))
  ])
  const personaTail = Buffer.concat([
    Buffer.from([0, 0, skinId.length]), skinId, Buffer.from([0, 0x1b, 0x6d, 0x54, 0xff, 11]),
    pieces, tints
  ])
  return Buffer.concat([
    Buffer.from([skinId.length]), skinId,
    varInt(patch.length), patch,
    Buffer.from([0, 1, 0, 0, 0, 1, 0, 0]),
    varInt(pixels.length), pixels,
    Buffer.alloc(0x200, 0x80),
    varInt(geometry.length), geometry,
    Buffer.from([version.length]), version,
    personaTail
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
  assert.equal(decoded.skinColor, '#ff1b6d54')
  assert.equal(decoded.personaPieces.length, 11)
  assert.equal(decoded.personaPieces[0].PieceId, 'b6702f0e-a4b5-497a-8820-6c8e3946bb55')
  assert.equal(decoded.personaPieces[0].PieceType, 7)
  assert.equal(decoded.personaPieces[0].PackId, '2099de18-429a-465a-a49b-fc4710a17bb3')
  assert.equal(decoded.personaPieces[0].IsDefaultPiece, true)
  assert.equal(decoded.pieceTintColors.length, 3)
  assert.deepEqual(decoded.pieceTintColors[0], {
    PieceType: 'persona_mouth',
    Colors: ['#ff0e2245', '#0', '#ff19192a', '#0']
  })
  assert.deepEqual(decoded.pieceTintColors[1], {
    PieceType: 'persona_eyes',
    Colors: ['#ff191514', '#ff0e182e', '#ffecece9', '#0']
  })
  assert.deepEqual(decoded.pieceTintColors[2], {
    PieceType: 'persona_hair',
    Colors: ['#ff0d111b', '#0', '#0', '#0']
  })
})

test('decoder rejects an unrelated or truncated binary without misclassifying it as a skin', () => {
  assert.equal(decodeTsukuyomiPersonaSkinBin(Buffer.from('not a skin'), 'other.bin'), null)
  assert.throws(() => decodeTsukuyomiPersonaSkinBin(Buffer.concat([Buffer.from([20]), Buffer.from('persona-short')]), 'skin.bin'), /可変長整数|データ長|読み取れません/)
})

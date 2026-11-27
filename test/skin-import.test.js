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
  assert.equal(Object.prototype.hasOwnProperty.call(wire, 'play_fab_id'), false)
  assert.deepEqual(JSON.parse(wire.geometry_data), geometry)
  assert.deepEqual(JSON.parse(wire.animation_data), animation)
  assert.deepEqual(JSON.parse(wire.skin_resource_pack), { geometry: { default: 'geometry.test.4d' } })
  assert.equal(wire.geometry_data_version, '1.12.0')
  assert.equal(wire.skin_data.width, 64)
  assert.equal(wire.skin_data.data.length, 64 * 64 * 4)
  assert.equal(wire.arm_size, 1)
  assert.equal(wire.skin_color, 0)
  assert.equal(wire.trusted_skin_flag, 'True')
})

test('Tsukuyomi legacy geometry.skin packs resolve geometry and texture through skins.json', () => {
  const geometry = {
    format_version: '1.10.0',
    'geometry.skin': {
      texturewidth: 128,
      textureheight: 128,
      visible_bounds_width: 3,
      bones: [
        {
          name: 'body',
          pivot: [0, 20, 0],
          poly_mesh: {
            normalized_uvs: true,
            positions: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]],
            normals: [[0, 0, 1]],
            uvs: [[0, 0], [1, 0], [0.5, 1]],
            polys: [[[0, 0, 0], [1, 0, 0], [2, 0, 0]]]
          }
        }
      ]
    }
  }
  const selectedTexture = pngBuffer(128, 128)
  const pack = {
    skins: [{
      localization_name: 'legacy_4d',
      geometry: 'geometry.skin',
      texture: 'textures/custom_body.png',
      type: 'free'
    }],
    serialize_name: 'legacy_4d',
    localization_name: 'Legacy 4D'
  }
  const imported = importSkinEntries([
    { name: 'pack/preview.png', data: pngBuffer(64, 64) },
    { name: 'pack/textures/custom_body.png', data: selectedTexture },
    { name: 'pack/models/geometry.json', data: Buffer.from(JSON.stringify(geometry)) },
    { name: 'pack/skins.json', data: Buffer.from(JSON.stringify(pack)) },
    { name: 'pack/manifest.json', data: Buffer.from(JSON.stringify({ format_version: 1 })) }
  ])

  assert.equal(imported.meta.geometryId, 'geometry.skin')
  assert.equal(imported.meta.hasGeometry, true)
  assert.equal(imported.meta.width, 128)
  assert.equal(imported.meta.height, 128)
  assert.equal(imported.meta.sourceFormat, 'Bedrock Skin Pack (Tsukuyomi compatible)')
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinGeometryData, 'base64').toString()), geometry)
  assert.equal(imported.skinData.SkinGeometryDataEngineVersion, '1.10.0')
  assert.deepEqual(Buffer.from(imported.skinData.SkinData, 'base64'), PNG.sync.read(selectedTexture).data)

  const wire = clientSkinToPlayerSkin(imported.skinData)
  assert.equal(wire.geometry_data_version, '1.10.0')
  assert.deepEqual(JSON.parse(wire.geometry_data), geometry)
  assert.deepEqual(JSON.parse(wire.skin_resource_pack), { geometry: { default: 'geometry.skin' } })
  assert.equal(wire.skin_data.width, 128)
  assert.equal(wire.skin_data.height, 128)
})

test('skin pack geometry selection honors its declared identifier when multiple geometry files are present', () => {
  const selected = {
    format_version: '1.10.0',
    'geometry.skin': { bones: [{ name: 'selected' }] }
  }
  const decoy = {
    format_version: '1.12.0',
    'geometry.other': { bones: [{ name: 'decoy' }] }
  }
  const imported = importSkinEntries([
    { name: 'skin.png', data: pngBuffer() },
    { name: 'skins.json', data: Buffer.from(JSON.stringify({ skins: [{ geometry: 'geometry.skin', texture: 'skin.png' }] })) },
    { name: 'geometry-other.json', data: Buffer.from(JSON.stringify(decoy)) },
    { name: 'geometry.json', data: Buffer.from(JSON.stringify(selected)) }
  ])
  assert.equal(imported.meta.geometryId, 'geometry.skin')
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinGeometryData, 'base64').toString()), selected)
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
    SkinAnimationData: Buffer.from(animationData).toString('base64'),
    SkinColor: '#FFFFFFFF',
    PersonaPieces: [{
      PieceId: '12345678-1234-1234-1234-123456789012',
      PieceType: 14,
      PackId: '87654321-4321-4321-4321-210987654321',
      IsDefaultPiece: false,
      ProductId: 'persona-hair-product'
    }],
    PieceTintColors: [{
      PieceType: 'persona_hair',
      Colors: ['#FFFFFFFF', '#FF000000', '#FF112233', '#80445566']
    }],
    TrustedSkin: true
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
  assert.equal(wire.skin_color, -1)
  assert.deepEqual(wire.personal_pieces, [{
    piece_id: '12345678-1234-1234-1234-123456789012',
    piece_type: 14,
    pack_id: '87654321-4321-4321-4321-210987654321',
    is_default_piece: false,
    product_id: 'persona-hair-product'
  }])
  assert.deepEqual(wire.piece_tint_colors, [{
    piece_type: 'persona_hair',
    colors: [-1, -16777216, -15654349, -2143005338]
  }])
  assert.equal(wire.trusted, 'True')
  assert.equal(wire.trusted_skin_flag, 'True')
})


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

function syntheticTsukuyomiPersonaBin () {
  const skinId = Buffer.from('persona-test-skin-4d')
  const resourcePatch = {
    geometry: {
      default: 'geometry.persona_test',
      animated_face: 'geometry.animated_face_persona_test'
    }
  }
  const geometry = {
    format_version: '1.14.0',
    'minecraft:geometry': [
      { description: { identifier: 'geometry.persona_test', texture_width: 256, texture_height: 256 }, bones: [] },
      { description: { identifier: 'geometry.animated_face_persona_test', texture_width: 32, texture_height: 64 }, bones: [] }
    ]
  }
  const geometryBytes = Buffer.from(JSON.stringify(geometry))
  const pixels = Buffer.alloc(256 * 256 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 180
    pixels[i + 1] = 90
    pixels[i + 2] = 40
    pixels[i + 3] = 255
  }
  const version = Buffer.from('1.14.0')
  return {
    buffer: Buffer.concat([
      Buffer.from([skinId.length]), skinId,
      varInt(Buffer.byteLength(JSON.stringify(resourcePatch))), Buffer.from(JSON.stringify(resourcePatch)),
      Buffer.from([0, 1, 0, 0, 0, 1, 0, 0]), // 256 x 256, little-endian uint32
      varInt(pixels.length), pixels,
      Buffer.alloc(512), // SkinStealer padding before its length-prefixed geometry record
      varInt(geometryBytes.length), geometryBytes,
      Buffer.from([version.length]), version
    ]),
    pixels,
    geometry,
    resourcePatch
  }
}

test('imports the actual Tsukuyomi Persona BIN layout including its 4D geometry and animated-face ResourcePatch', () => {
  const sample = syntheticTsukuyomiPersonaBin()
  const imported = importSkinEntries([{ name: 'skin.bin', data: sample.buffer }])
  assert.equal(imported.skinData.SkinImageWidth, 256)
  assert.equal(imported.skinData.SkinImageHeight, 256)
  assert.equal(Object.prototype.hasOwnProperty.call(imported.skinData, 'PlayFabId'), false)
  assert.equal(Buffer.from(imported.skinData.SkinData, 'base64').length, 256 * 256 * 4)
  assert.deepEqual(Buffer.from(imported.skinData.SkinData, 'base64'), sample.pixels)
  assert.equal(imported.meta.geometryId, 'geometry.persona_test')
  assert.equal(imported.meta.hasGeometry, true)
  assert.equal(imported.meta.sourceFormat, 'Tsukuyomi Persona BIN')
  assert.equal(imported.skinData.PersonaSkin, true)
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinResourcePatch, 'base64').toString()), sample.resourcePatch)
  assert.deepEqual(JSON.parse(Buffer.from(imported.skinData.SkinGeometryData, 'base64').toString()), sample.geometry)
  assert.equal(imported.skinData.SkinGeometryDataEngineVersion, '1.14.0')
  assert.match(imported.previewDataUrl, /^data:image\/png;base64,/)
  const wire = clientSkinToPlayerSkin(imported.skinData)
  assert.deepEqual(JSON.parse(wire.skin_resource_pack), sample.resourcePatch)
  assert.deepEqual(JSON.parse(wire.geometry_data), sample.geometry)
})

test('Persona BIN wins over a companion preview PNG so its original RGBA and 4D metadata are retained', () => {
  const sample = syntheticTsukuyomiPersonaBin()
  const wrongPreview = pngBuffer(64, 64)
  const imported = importSkinEntries([
    { name: 'skin.png', data: wrongPreview },
    { name: 'skin.bin', data: sample.buffer }
  ])
  assert.equal(imported.skinData.SkinImageWidth, 256)
  assert.equal(imported.skinData.SkinImageHeight, 256)
  assert.deepEqual(Buffer.from(imported.skinData.SkinData, 'base64'), sample.pixels)
  assert.equal(imported.meta.geometryId, 'geometry.persona_test')
})


test('SkinStealer Persona BIN import forwards Persona pieces and tint colors into the saved login skin', () => {
  const skinId = Buffer.from('persona-import-integration')
  const patch = Buffer.from(JSON.stringify({ geometry: { default: 'geometry.import_test' } }))
  const geometry = Buffer.from(JSON.stringify({
    format_version: '1.14.0',
    'minecraft:geometry': [{ description: { identifier: 'geometry.import_test' }, bones: [] }]
  }))
  const pixels = Buffer.alloc(64 * 64 * 4, 0x66)
  const pieceId = Buffer.from('01234567-89ab-cdef-0123-456789abcdef')
  const packId = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const piece = Buffer.concat([
    Buffer.from([pieceId.length]), pieceId,
    Buffer.from([7, 0, 0, 0]),
    packId,
    Buffer.from([1, 0])
  ])
  const tail = Buffer.concat([
    Buffer.from([0, 0, skinId.length]), skinId, Buffer.from([0, 0x11, 0x22, 0x33, 0xff, 1]),
    piece,
    Buffer.from([1, 5]), Buffer.from('mouth'),
    Buffer.from([0x0e, 0x22, 0x45, 0xff, 0, 0, 0, 0, 0x19, 0x19, 0x2a, 0xff, 0, 0, 0, 0])
  ])
  const bin = Buffer.concat([
    Buffer.from([skinId.length]), skinId,
    varInt(patch.length), patch,
    Buffer.from([64, 0, 0, 0, 64, 0, 0, 0]),
    varInt(pixels.length), pixels,
    Buffer.alloc(0x200, 0x80),
    varInt(geometry.length), geometry,
    Buffer.from([6]), Buffer.from('1.14.0'),
    tail
  ])
  const imported = importSkinEntries([{ name: 'skin.bin', data: bin }])
  assert.equal(imported.skinData.SkinId, 'persona-import-integration')
  assert.equal(imported.skinData.PersonaSkin, true)
  assert.equal(imported.skinData.SkinColor, '#ff112233')
  assert.deepEqual(imported.skinData.PersonaPieces, [{
    PieceId: '01234567-89ab-cdef-0123-456789abcdef',
    PieceType: 7,
    PackId: '77665544-3322-1100-ffee-ddccbbaa9988',
    IsDefaultPiece: true,
    ProductId: ''
  }])
  assert.deepEqual(imported.skinData.PieceTintColors, [{
    PieceType: 'persona_mouth',
    Colors: ['#ff0e2245', '#0', '#ff19192a', '#0']
  }])
  const wire = clientSkinToPlayerSkin(imported.skinData)
  assert.deepEqual(wire.personal_pieces, [{
    piece_id: '01234567-89ab-cdef-0123-456789abcdef',
    piece_type: 7,
    pack_id: '77665544-3322-1100-ffee-ddccbbaa9988',
    is_default_piece: true,
    product_id: ''
  }])
  assert.deepEqual(wire.piece_tint_colors, [{
    piece_type: 'persona_mouth',
    colors: [-15850939, 0, -15132374, 0]
  }])
})


test('adds a default geometry to an embedded resource patch that only specifies auxiliary geometry', () => {
  const pixels = Buffer.alloc(64 * 64 * 4, 90)
  const resourcePatch = { geometry: { animated_face: 'geometry.animated_face.test' } }
  const metadata = {
    SkinImageWidth: 64,
    SkinImageHeight: 64,
    SkinData: pixels.toString('base64'),
    SkinResourcePatch: Buffer.from(JSON.stringify(resourcePatch)).toString('base64')
  }
  const imported = importSkinEntries([{ name: 'full_skin.bin', data: Buffer.from(JSON.stringify(metadata)) }])
  const decodedPatch = JSON.parse(Buffer.from(imported.skinData.SkinResourcePatch, 'base64').toString('utf8'))
  assert.equal(decodedPatch.geometry.default, 'geometry.humanoid.custom')
  assert.equal(decodedPatch.geometry.animated_face, 'geometry.animated_face.test')
})

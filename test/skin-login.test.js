'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { extractDisconnectReason, isSkinRejectionReason, validateSkinLoginData } = require('../src/skin-login')

function validSkin () {
  return {
    SkinId: 'jhonbot.test',
    SkinImageWidth: 64,
    SkinImageHeight: 64,
    SkinData: Buffer.alloc(64 * 64 * 4).toString('base64'),
    SkinResourcePatch: Buffer.from(JSON.stringify({ geometry: { default: 'geometry.humanoid.custom' } })).toString('base64'),
    SkinGeometryData: Buffer.from('null').toString('base64'),
    SkinGeometryDataEngineVersion: Buffer.from('0.0.0').toString('base64'),
    CapeImageWidth: 0,
    CapeImageHeight: 0,
    CapeData: ''
  }
}

test('extracts server disconnect text from Bedrock packet parameters', () => {
  assert.equal(
    extractDisconnectReason({ data: { name: 'disconnect', params: { message: 'Invalid skin', filtered_message: 'Skin rejected' } } }),
    'Invalid skin / Skin rejected'
  )
})

test('extracts textual disconnect details from structured message objects', () => {
  assert.match(extractDisconnectReason({ params: { message: { translate: 'disconnectionScreen.invalidSkin' } } }), /invalidSkin/)
})

test('only identifies explicit skin rejection reasons', () => {
  assert.equal(isSkinRejectionReason('Invalid skin data'), true)
  assert.equal(isSkinRejectionReason('Persona geometry is unsupported'), true)
  assert.equal(isSkinRejectionReason('Authentication failed'), false)
  assert.equal(isSkinRejectionReason('Disconnected'), false)
})

test('accepts a consistent PNG-derived Bedrock skin login payload', () => {
  const skin = validSkin()
  assert.equal(validateSkinLoginData(skin), skin)
})

test('rejects mismatched texture byte counts before attempting login', () => {
  const skin = validSkin()
  skin.SkinData = Buffer.alloc(12).toString('base64')
  assert.throws(() => validateSkinLoginData(skin), /長さが画像サイズと一致/)
})

test('rejects malformed resource patches before attempting login', () => {
  const skin = validSkin()
  skin.SkinResourcePatch = Buffer.from('not json').toString('base64')
  assert.throws(() => validateSkinLoginData(skin), /JSON/)
})

test('rejects a resource patch without a geometry identifier', () => {
  const skin = validSkin()
  skin.SkinResourcePatch = Buffer.from('{}').toString('base64')
  assert.throws(() => validateSkinLoginData(skin), /geometry.default/)
})

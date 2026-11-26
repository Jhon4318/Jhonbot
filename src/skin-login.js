'use strict'

const MAX_REASON_LENGTH = 400
const SKIN_REJECTION_PATTERN = /(?:invalid|reject(?:ed|ion)?|unsupported|malformed|not\\s+valid|not\\s+allowed|failed|bad|mismatch|error|corrupt)[\\s\\S]{0,70}(?:skin|persona|texture|geometry)|(?:skin|persona|texture|geometry)[\\s\\S]{0,70}(?:invalid|reject(?:ed|ion)?|unsupported|malformed|not\\s+valid|not\\s+allowed|failed|bad|mismatch|error|corrupt)/i

function printableReason (value, depth = 0) {
  if (value == null || depth > 4) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(entry => printableReason(entry, depth + 1)).filter(Boolean).join(' ')
  if (typeof value === 'object') {
    const preferred = ['message', 'text', 'reason', 'translate', 'rawtext', 'value']
    const pieces = preferred.map(key => value[key] == null ? '' : printableReason(value[key], depth + 1)).filter(Boolean)
    if (pieces.length) return pieces.join(' ')
    try { return JSON.stringify(value) } catch { return '' }
  }
  return ''
}

function extractDisconnectReason (packet) {
  const params = packet?.data?.params ?? packet?.params ?? packet
  if (params == null) return ''
  const candidates = [
    params.message,
    params.filtered_message,
    params.reason,
    params.error_message,
    params.disconnect_reason,
    params.cause
  ]
  const unique = [...new Set(candidates.map(value => printableReason(value)).filter(Boolean))]
  return unique.join(' / ').slice(0, MAX_REASON_LENGTH)
}

function isSkinRejectionReason (reason) {
  const value = String(reason || '')
  return value.length > 0 && SKIN_REJECTION_PATTERN.test(value)
}

function decodeBase64Field (value, fieldName, required = false) {
  if (value == null || value === '') {
    if (required) throw new Error(fieldName + ' がありません。')
    return Buffer.alloc(0)
  }
  if (typeof value !== 'string') throw new Error(fieldName + ' はBase64文字列ではありません。')
  const decoded = Buffer.from(value, 'base64')
  if (!decoded.length) throw new Error(fieldName + ' をBase64として読み取れません。')
  return decoded
}

function validateSkinLoginData (skinData) {
  if (!skinData || typeof skinData !== 'object' || Array.isArray(skinData)) {
    throw new Error('カスタムスキンのログインデータがありません。')
  }
  const width = Number(skinData.SkinImageWidth)
  const height = Number(skinData.SkinImageHeight)
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
    ![32, 64, 128, 256].includes(width) || ![32, 64, 128, 256].includes(height)) {
    throw new Error('スキン画像の幅・高さがBedrock対応サイズではありません。')
  }
  const texture = decodeBase64Field(skinData.SkinData, 'SkinData', true)
  if (texture.length !== width * height * 4) {
    throw new Error(`SkinDataの長さが画像サイズと一致しません（${texture.length} bytes / ${width * height * 4} bytes）。`)
  }

  const patchBytes = decodeBase64Field(skinData.SkinResourcePatch, 'SkinResourcePatch', true)
  let resourcePatch
  try { resourcePatch = JSON.parse(patchBytes.toString('utf8')) } catch {
    throw new Error('SkinResourcePatchのJSONを読み取れません。')
  }
  if (!resourcePatch || typeof resourcePatch !== 'object' ||
    typeof resourcePatch.geometry?.default !== 'string' || !resourcePatch.geometry.default) {
    throw new Error('SkinResourcePatchにgeometry.defaultがありません。')
  }

  if (skinData.SkinGeometryData) {
    const geometryBytes = decodeBase64Field(skinData.SkinGeometryData, 'SkinGeometryData')
    let geometry
    try { geometry = JSON.parse(geometryBytes.toString('utf8')) } catch {
      throw new Error('SkinGeometryDataのJSONを読み取れません。')
    }
    if (geometry !== null && (typeof geometry !== 'object' || Array.isArray(geometry))) {
      throw new Error('SkinGeometryDataの形式が不正です。')
    }
  }

  const capeWidth = Number(skinData.CapeImageWidth) || 0
  const capeHeight = Number(skinData.CapeImageHeight) || 0
  if (capeWidth || capeHeight) {
    if (!Number.isInteger(capeWidth) || !Number.isInteger(capeHeight) || capeWidth < 1 || capeHeight < 1) {
      throw new Error('Cape画像の幅・高さが不正です。')
    }
    const cape = decodeBase64Field(skinData.CapeData, 'CapeData', true)
    if (cape.length !== capeWidth * capeHeight * 4) {
      throw new Error('CapeDataの長さが画像サイズと一致しません。')
    }
  }

  return skinData
}

module.exports = { extractDisconnectReason, isSkinRejectionReason, validateSkinLoginData }

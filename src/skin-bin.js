'use strict'

function asBuffer (value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value || [])
}

function readVarInt (data, offset) {
  let value = 0
  let shift = 0
  const start = offset
  while (offset < data.length && shift <= 28) {
    const byte = data[offset++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset, bytes: offset - start }
    shift += 7
  }
  throw new Error('BIN内の可変長整数を読み取れませんでした。')
}

function parseLengthPrefixedJson (data, offset, expectedKey) {
  let lengthInfo
  try {
    lengthInfo = readVarInt(data, offset)
  } catch {
    return null
  }
  const length = lengthInfo.value
  const start = lengthInfo.offset
  const end = start + length
  if (length < 2 || end > data.length || data[start] !== 0x7b) return null
  try {
    const value = JSON.parse(data.subarray(start, end).toString('utf8'))
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, expectedKey)) return null
    return { value, start, end, length, nextOffset: end }
  } catch {
    return null
  }
}

function uuidFromMceBytes (data, offset) {
  const msb = Buffer.from(data.subarray(offset, offset + 8)).reverse()
  const lsb = Buffer.from(data.subarray(offset + 8, offset + 16)).reverse()
  const hex = Buffer.concat([msb, lsb]).toString('hex')
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
}

function formatArgbColor (data, offset) {
  const r = data[offset].toString(16).padStart(2, '0')
  const g = data[offset + 1].toString(16).padStart(2, '0')
  const b = data[offset + 2].toString(16).padStart(2, '0')
  const a = data[offset + 3].toString(16).padStart(2, '0')
  return a === '00' && r === '00' && g === '00' && b === '00' ? '#0' : '#' + a + r + g + b
}

function parsePersonaMetadataTail (data, start, expectedSkinId) {
  let offset = start
  if (offset + 3 > data.length || data[offset] !== 0 || data[offset + 1] !== 0) return null
  offset += 2
  const idLength = data[offset++]
  if (!idLength || idLength > 128 || offset + idLength + 6 > data.length) return null
  const skinId = data.subarray(offset, offset + idLength).toString('utf8')
  if (skinId !== expectedSkinId) return null
  offset += idLength
  if (data[offset++] !== 0) return null

  const skinColorBytes = data.subarray(offset, offset + 4)
  if (skinColorBytes.length !== 4) return null
  const skinColor = formatArgbColor(data, offset)
  offset += 4

  const pieceCount = data[offset++]
  if (pieceCount > 64) return null
  const personaPieces = []
  for (let index = 0; index < pieceCount; index++) {
    if (offset >= data.length) return null
    const pieceIdLength = data[offset++]
    if (!pieceIdLength || pieceIdLength > 128 || offset + pieceIdLength + 22 > data.length) return null
    const pieceId = data.subarray(offset, offset + pieceIdLength).toString('utf8')
    offset += pieceIdLength
    const pieceType = data.readUInt32LE(offset)
    offset += 4
    const packId = uuidFromMceBytes(data, offset)
    offset += 16
    const isDefaultPiece = data[offset++] !== 0
    const productIdLength = data[offset++]
    if (productIdLength > 128 || offset + productIdLength > data.length) return null
    const productId = data.subarray(offset, offset + productIdLength).toString('utf8')
    offset += productIdLength
    if (!/^[a-f0-9-]{36}$/i.test(pieceId) || pieceType > 29) return null
    personaPieces.push({ PieceId: pieceId, PieceType: pieceType, PackId: packId, IsDefaultPiece: isDefaultPiece, ProductId: productId })
  }

  if (offset >= data.length) return { skinColor, personaPieces, pieceTintColors: [] }
  const tintCount = data[offset++]
  if (tintCount > 16) return { skinColor, personaPieces, pieceTintColors: [] }
  const tintColorCounts = { mouth: 4, eyes: 4, hair: 4 }
  const pieceTintColors = []
  for (let index = 0; index < tintCount; index++) {
    if (offset >= data.length) break
    const keyLength = data[offset++]
    if (!keyLength || keyLength > 32 || offset + keyLength > data.length) break
    const key = data.subarray(offset, offset + keyLength).toString('utf8').toLowerCase()
    offset += keyLength
    const colorCount = tintColorCounts[key]
    if (!colorCount || offset + colorCount * 4 > data.length) break
    const colors = []
    for (let colorIndex = 0; colorIndex < colorCount; colorIndex++) {
      colors.push(formatArgbColor(data, offset))
      offset += 4
    }
    pieceTintColors.push({ PieceType: 'persona_' + key, Colors: colors })
  }
  return { skinColor, personaPieces, pieceTintColors }
}

function decodeTsukuyomiPersonaSkinBin (buffer, name = 'skin.bin') {
  const data = asBuffer(buffer)
  if (data.length < 32) return null
  const idLength = data[0]
  if (!idLength || idLength > 128 || 1 + idLength >= data.length) return null
  const skinId = data.subarray(1, 1 + idLength).toString('utf8')
  if (!/^(persona-|customskin-|[a-f0-9-]{20,})/i.test(skinId)) return null

  let offset = 1 + idLength
  let resourceInfo
  try {
    const info = readVarInt(data, offset)
    offset = info.offset
    if (info.value < 2 || info.value > 65536 || offset + info.value > data.length) return null
    resourceInfo = JSON.parse(data.subarray(offset, offset + info.value).toString('utf8'))
    offset += info.value
  } catch {
    return null
  }
  if (!resourceInfo || typeof resourceInfo !== 'object' || !resourceInfo.geometry || typeof resourceInfo.geometry !== 'object') return null
  if (offset + 8 > data.length) return null

  const width = data.readUInt32LE(offset)
  const height = data.readUInt32LE(offset + 4)
  offset += 8
  if (![32, 64, 128, 256].includes(width) || ![32, 64, 128, 256].includes(height)) {
    throw new Error(name + ' のスキン画像サイズが不正です（' + width + '×' + height + '）。')
  }
  const imageInfo = readVarInt(data, offset)
  offset = imageInfo.offset
  const expectedBytes = width * height * 4
  if (imageInfo.value !== expectedBytes || offset + imageInfo.value > data.length) {
    throw new Error(name + ' のRGBAデータ長が画像サイズと一致しません。')
  }
  const imageData = Buffer.from(data.subarray(offset, offset + imageInfo.value))
  const imageEnd = offset + imageInfo.value

  // Tsukuyomi SkinStealer appends zero padding before the varint-prefixed
  // geometry JSON. Find a valid JSON record instead of assuming a fixed gap.
  const scanEnd = Math.min(data.length - 8, imageEnd + 65536)
  let geometryRecord = null
  for (let position = imageEnd; position < scanEnd; position++) {
    const record = parseLengthPrefixedJson(data, position, 'minecraft:geometry')
    if (record && Array.isArray(record.value['minecraft:geometry']) && record.value['minecraft:geometry'].length) {
      geometryRecord = record
      break
    }
  }
  if (!geometryRecord) throw new Error(name + ' に4D Geometry JSONが見つかりませんでした。')
  const geometry = geometryRecord.value
  let geometryVersion = String(geometry.format_version || '')
  const versionOffset = geometryRecord.nextOffset
  let tailOffset = versionOffset
  if (versionOffset < data.length) {
    const versionLength = data[versionOffset]
    if (versionLength > 0 && versionLength <= 32 && versionOffset + 1 + versionLength <= data.length) {
      const candidate = data.subarray(versionOffset + 1, versionOffset + 1 + versionLength).toString('utf8')
      if (/^\d+\.\d+(?:\.\d+)?$/.test(candidate)) {
        geometryVersion = candidate
        tailOffset = versionOffset + 1 + versionLength
      }
    }
  }
  if (!geometryVersion) throw new Error(name + ' のGeometryエンジンバージョンを判別できませんでした。')

  const personaMetadata = parsePersonaMetadataTail(data, tailOffset, skinId)
  return {
    skinId,
    width,
    height,
    data: imageData,
    resourcePatch: resourceInfo,
    geometry,
    geometryVersion,
    personaSkin: skinId.toLowerCase().startsWith('persona-'),
    skinColor: personaMetadata?.skinColor || '#0',
    personaPieces: personaMetadata?.personaPieces || [],
    pieceTintColors: personaMetadata?.pieceTintColors || []
  }
}

module.exports = { decodeTsukuyomiPersonaSkinBin, readVarInt }

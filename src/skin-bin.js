'use strict'

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
  if (versionOffset < data.length) {
    const versionLength = data[versionOffset]
    if (versionLength > 0 && versionLength <= 32 && versionOffset + 1 + versionLength <= data.length) {
      const candidate = data.subarray(versionOffset + 1, versionOffset + 1 + versionLength).toString('utf8')
      if (/^\d+\.\d+(?:\.\d+)?$/.test(candidate)) geometryVersion = candidate
    }
  }
  if (!geometryVersion) throw new Error(name + ' のGeometryエンジンバージョンを判別できませんでした。')

  return {
    skinId,
    width,
    height,
    data: imageData,
    resourcePatch: resourceInfo,
    geometry,
    geometryVersion,
    personaSkin: skinId.toLowerCase().startsWith('persona-')
  }
}

module.exports = { decodeTsukuyomiPersonaSkinBin, readVarInt }

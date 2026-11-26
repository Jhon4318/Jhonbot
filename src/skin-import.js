'use strict'

const { randomUUID } = require('node:crypto')
const { unzipSync } = require('fflate')
const { PNG } = require('pngjs')
const { decodeTsukuyomiPersonaSkinBin } = require('./skin-bin')

const MAX_IMPORT_BYTES = 32 * 1024 * 1024
const MAX_IMPORT_FILES = 512

function asBuffer (value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value || [])
}

function safeArchivePath (value) {
  const name = String(value || '').replace(/\\/g, '/')
  if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  return !name.split('/').some(part => part === '..')
}

function decodePng (buffer) {
  try {
    const decoded = PNG.sync.read(asBuffer(buffer))
    if (!Number.isInteger(decoded.width) || !Number.isInteger(decoded.height) ||
      decoded.width < 1 || decoded.height < 1 || decoded.width > 512 || decoded.height > 512) {
      throw new Error('スキン画像のサイズが不正です。')
    }
    if (![32, 64, 128, 256].includes(decoded.width) || ![32, 64, 128, 256].includes(decoded.height)) {
      throw new Error('スキン画像は32/64/128/256ピクセルのPNGに対応しています。')
    }
    return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) }
  } catch (error) {
    throw new Error('PNG画像を読み込めませんでした: ' + error.message)
  }
}

function decodeRawSkinBin (buffer, name) {
  let data = asBuffer(buffer)
  if (data.length > 0 && data[0] === 0x7B) {
    try {
      const parsed = JSON.parse(data.toString('utf8'))
      const texture = parsed.SkinData || parsed.skinData || parsed.texture || parsed.skin
      const width = Number(parsed.SkinImageWidth || parsed.width || parsed.skinImageWidth)
      const height = Number(parsed.SkinImageHeight || parsed.height || parsed.skinImageHeight)
      if (typeof texture === 'string' && Number.isInteger(width) && Number.isInteger(height)) {
        const decoded = Buffer.from(texture, 'base64')
        if (decoded.length === width * height * 4) return { width, height, data: decoded }
      }
    } catch {}
  }
  if (data.length > 0 && data[data.length - 1] === 0x3D) {
    const text = data.toString('utf8').trim()
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
      const decoded = Buffer.from(text, 'base64')
      if ([64 * 64 * 4, 64 * 32 * 4, 128 * 128 * 4, 128 * 64 * 4].includes(decoded.length)) data = decoded
    }
  }
  const dimensions = new Map([
    [64 * 64 * 4, [64, 64]],
    [64 * 32 * 4, [64, 32]],
    [128 * 128 * 4, [128, 128]],
    [128 * 64 * 4, [128, 64]],
    [256 * 256 * 4, [256, 256]]
  ])
  const pair = dimensions.get(data.length)
  if (!pair) throw new Error(name + ' は対応するPNG/JSON/RGBA形式として判別できませんでした。未知のBINを画像として誤読しないため、取り込みを中止しました。')
  return { width: pair[0], height: pair[1], data }
}



function jsonEntries (entries) {
  return entries.filter(entry => /\.json$/i.test(entry.name) ||
    (/\.bin$/i.test(entry.name) && entry.data[0] === 0x7B)).map(entry => {
    try { return { name: entry.name, value: JSON.parse(entry.data.toString('utf8')) } } catch { return null }
  }).filter(Boolean)
}

function decodeEmbeddedJson (value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim()
    return decoded ? JSON.parse(decoded) : null
  } catch {
    return null
  }
}

function extractGeometryIdentifier (geometry) {
  const root = geometry && typeof geometry === 'object' ? geometry : {}
  const first = Array.isArray(root['minecraft:geometry']) ? root['minecraft:geometry'][0] : null
  return first?.description?.identifier ||
    root.geometry?.default ||
    root.description?.identifier ||
    ''
}

function isGeometryJson (value) {
  return !!(value && typeof value === 'object' && (Array.isArray(value['minecraft:geometry']) || value.geometry?.default || value.description?.identifier))
}

function isAnimationJson (value) {
  return !!(value && typeof value === 'object' && (value.animations || value.animation_controllers || value['minecraft:animations']))
}

function decodeBase64Text (value) {
  if (typeof value !== 'string' || !value) return ''
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return value
  }
}

function clientSkinToPlayerSkin (clientSkin) {
  if (!clientSkin || typeof clientSkin !== 'object') throw new TypeError('スキンデータがありません。')
  const image = (width, height, encoded) => ({
    width: Number(width) || 0,
    height: Number(height) || 0,
    data: Buffer.isBuffer(encoded)
      ? Buffer.from(encoded)
      : encoded
        ? Buffer.from(encoded, 'base64')
        : Buffer.alloc(0)
  })
  const enumValue = (value, names) => {
    if (Number.isInteger(value)) return value
    const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const index = names.findIndex(name => name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized)
    return index >= 0 ? index : 0
  }
  const animations = (Array.isArray(clientSkin.AnimatedImageData) ? clientSkin.AnimatedImageData : []).map(entry => {
    const frame = entry && typeof entry === 'object' ? entry : {}
    const sourceImage = frame.skin_image || frame.image || frame.Image || frame.SkinImage || {}
    return {
      skin_image: image(
        sourceImage.width ?? sourceImage.Width ?? frame.SkinImageWidth,
        sourceImage.height ?? sourceImage.Height ?? frame.SkinImageHeight,
        sourceImage.data ?? sourceImage.Data ?? frame.SkinData
      ),
      animation_type: enumValue(frame.animation_type ?? frame.Type ?? frame.AnimationType, ['None', 'Face', 'Body32x32', 'Body128x128']),
      animation_frames: Number(frame.animation_frames ?? frame.Frames ?? frame.AnimationFrames) || 0,
      expression_type: enumValue(frame.expression_type ?? frame.AnimationExpression ?? frame.ExpressionType, ['Linear', 'Blinking'])
    }
  })
  return {
    skin_id: String(clientSkin.SkinId || ''),
    skin_resource_pack: decodeBase64Text(clientSkin.SkinResourcePatch || ''),
    skin_data: image(clientSkin.SkinImageWidth, clientSkin.SkinImageHeight, clientSkin.SkinData),
    animations,
    cape_data: image(clientSkin.CapeImageWidth, clientSkin.CapeImageHeight, clientSkin.CapeData),
    geometry_data: decodeBase64Text(clientSkin.SkinGeometryData || ''),
    geometry_data_version: decodeBase64Text(clientSkin.SkinGeometryDataEngineVersion || ''),
    animation_data: decodeBase64Text(clientSkin.SkinAnimationData || ''),
    cape_id: String(clientSkin.CapeId || ''),
    full_skin_id: String(clientSkin.SkinId || ''),
    arm_size: String(clientSkin.ArmSize || 'wide').toLowerCase() === 'slim' ? 0 : 1,
    skin_color: Number.parseInt(String(clientSkin.SkinColor || '#0').replace(/^#/, '') || '0', 16) >>> 0,
    personal_pieces: Array.isArray(clientSkin.PersonaPieces) ? clientSkin.PersonaPieces : [],
    piece_tint_colors: Array.isArray(clientSkin.PieceTintColors) ? clientSkin.PieceTintColors : [],
    premium: clientSkin.PremiumSkin === true,
    persona: clientSkin.PersonaSkin === true,
    cape_on_classic: clientSkin.CapeOnClassicSkin === true,
    primary_user: clientSkin.TrustedSkin !== false,
    overriding_player_appearance: clientSkin.OverrideSkin !== false,
    trusted_skin_flag: clientSkin.TrustedSkin === false ? 'False' : clientSkin.TrustedSkin === true ? 'True' : 'Unset',
    profile_hash: String(clientSkin.ProfileHash || '')
  }
}
function importSkinEntries (inputEntries) {
  if (!Array.isArray(inputEntries) || !inputEntries.length) throw new Error('スキン素材が選択されていません。')
  const entries = []
  let totalBytes = 0
  const addEntry = (name, data) => {
    const buffer = asBuffer(data)
    totalBytes += buffer.length
    if (entries.length >= MAX_IMPORT_FILES) throw new Error('スキン素材のファイル数が上限を超えています。')
    if (totalBytes > MAX_IMPORT_BYTES) throw new Error('スキン素材の合計サイズは32MBまでです。')
    entries.push({ name: String(name), data: buffer })
  }
  for (const source of inputEntries) {
    const name = String(source?.name || '')
    const data = asBuffer(source?.data)
    if (/\.(zip|mcpack)$/i.test(name) || (data[0] === 0x50 && data[1] === 0x4B)) {
      let unpacked
      try { unpacked = unzipSync(data) } catch (error) { throw new Error('ZIP/MCpackを展開できませんでした: ' + error.message) }
      for (const [archiveName, contents] of Object.entries(unpacked)) {
        if (!safeArchivePath(archiveName) || archiveName.endsWith('/')) continue
        addEntry(name + '/' + archiveName, contents)
      }
    } else {
      addEntry(name, data)
    }
  }

  const jsons = jsonEntries(entries)
  let embeddedSkin = null
  let geometry = null
  let animation = null
  let personaBin = null
  for (const entry of jsons) {
    const value = entry.value
    if (!embeddedSkin && (value.SkinData || value.skinData || value.SkinImageWidth || value.SkinResourcePatch)) embeddedSkin = value
    if (!geometry && isGeometryJson(value)) geometry = value
    if (!animation && isAnimationJson(value)) animation = value
  }

  if (embeddedSkin) {
    if (!geometry) {
      const embeddedGeometry = decodeEmbeddedJson(embeddedSkin.SkinGeometryData || embeddedSkin.skinGeometryData)
      if (isGeometryJson(embeddedGeometry)) geometry = embeddedGeometry
    }
    if (!animation) {
      const embeddedAnimation = decodeEmbeddedJson(embeddedSkin.SkinAnimationData || embeddedSkin.skinAnimationData)
      if (isAnimationJson(embeddedAnimation)) animation = embeddedAnimation
    }
  }

  let texture = null
  let previewPng = null
  const pngCandidates = entries.filter(entry => /\.png$/i.test(entry.name) && !/(cape|elytra)/i.test(entry.name))
  if (pngCandidates.length) {
    const preferred = pngCandidates.find(entry => /(^|[/_ -])(skin|texture|steve|alex)([/_ .-]|$)/i.test(entry.name)) || pngCandidates[0]
    texture = decodePng(preferred.data)
    previewPng = preferred.data
  } else if (embeddedSkin?.SkinData || embeddedSkin?.skinData) {
    const width = Number(embeddedSkin.SkinImageWidth || embeddedSkin.width)
    const height = Number(embeddedSkin.SkinImageHeight || embeddedSkin.height)
    const raw = Buffer.from(String(embeddedSkin.SkinData || embeddedSkin.skinData), 'base64')
    if (!Number.isInteger(width) || !Number.isInteger(height) || raw.length !== width * height * 4) {
      throw new Error('JSON内のSkinDataと画像サイズが一致しません。')
    }
    texture = { width, height, data: raw }
  } else {
    const bin = entries.find(entry => /\.bin$/i.test(entry.name) && /(skin|texture|full_skin)/i.test(entry.name)) ||
      entries.find(entry => /\.bin$/i.test(entry.name))
    if (!bin) throw new Error('スキンPNGまたは認識可能なSkinSteal BINが見つかりませんでした。')
    if (bin.data[0] === 0x89 && bin.data[1] === 0x50 && bin.data[2] === 0x4E && bin.data[3] === 0x47) {
      texture = decodePng(bin.data)
      previewPng = bin.data
    } else {
      personaBin = decodeTsukuyomiPersonaSkinBin(bin.data, bin.name)
      if (personaBin) {
        texture = { width: personaBin.width, height: personaBin.height, data: personaBin.data }
        geometry = personaBin.geometry
      } else {
        texture = decodeRawSkinBin(bin.data, bin.name)
      }
    }
  }

  // A SkinStealer BIN carries the authoritative Persona ResourcePatch and 4D geometry.
  // Prefer it even when a companion preview PNG was selected alongside the BIN.
  if (!personaBin) {
    const personaEntry = entries.find(entry =>
      /\.bin$/i.test(entry.name) &&
      entry.data[0] !== 0x7b &&
      !(entry.data[0] === 0x89 && entry.data[1] === 0x50 && entry.data[2] === 0x4e && entry.data[3] === 0x47))
    if (personaEntry) personaBin = decodeTsukuyomiPersonaSkinBin(personaEntry.data, personaEntry.name)
  }
  if (personaBin) {
    texture = { width: personaBin.width, height: personaBin.height, data: personaBin.data }
    geometry = personaBin.geometry
    previewPng = null
  }

  let cape = null
  const capeEntry = entries.find(entry => /cape.*\.png$/i.test(entry.name))
  if (capeEntry) cape = decodePng(capeEntry.data)

  const embeddedResourcePatchValue = embeddedSkin?.SkinResourcePatch || embeddedSkin?.skinResourcePatch
  const embeddedResourcePatch = personaBin?.resourcePatch ||
    (embeddedResourcePatchValue && typeof embeddedResourcePatchValue === 'object'
      ? embeddedResourcePatchValue
      : decodeEmbeddedJson(embeddedResourcePatchValue))
  const geometryId = extractGeometryIdentifier(geometry) || embeddedResourcePatch?.geometry?.default || 'geometry.humanoid.custom'
  const geometryString = geometry
    ? JSON.stringify(geometry)
    : (embeddedSkin?.SkinGeometryData || embeddedSkin?.skinGeometryData || Buffer.from('null').toString('base64'))
  const animationString = animation ? JSON.stringify(animation) : ''
  const existingAnimationData = embeddedSkin?.SkinAnimationData || embeddedSkin?.skinAnimationData || ''
  const geometryVersion = personaBin?.geometryVersion || geometry?.format_version || (embeddedSkin?.SkinGeometryDataEngineVersion
    ? Buffer.from(embeddedSkin.SkinGeometryDataEngineVersion, 'base64').toString('utf8')
    : '0.0.0')
  const resourcePatch = {
    ...(embeddedResourcePatch && typeof embeddedResourcePatch === 'object' ? embeddedResourcePatch : {}),
    geometry: {
      ...(embeddedResourcePatch?.geometry && typeof embeddedResourcePatch.geometry === 'object' ? embeddedResourcePatch.geometry : {}),
      default: typeof embeddedResourcePatch?.geometry?.default === 'string' && embeddedResourcePatch.geometry.default
        ? embeddedResourcePatch.geometry.default
        : geometryId
    }
  }
  const clientSkin = {
    SkinId: personaBin?.skinId || embeddedSkin?.SkinId || ('jhonbot.' + randomUUID()),
    SkinResourcePatch: Buffer.from(JSON.stringify(resourcePatch)).toString('base64'),
    SkinImageWidth: texture.width,
    SkinImageHeight: texture.height,
    SkinData: texture.data.toString('base64'),
    AnimatedImageData: Array.isArray(embeddedSkin?.AnimatedImageData) ? embeddedSkin.AnimatedImageData : [],
    CapeImageWidth: cape?.width || Number(embeddedSkin?.CapeImageWidth) || 0,
    CapeImageHeight: cape?.height || Number(embeddedSkin?.CapeImageHeight) || 0,
    CapeData: cape ? cape.data.toString('base64') : String(embeddedSkin?.CapeData || ''),
    SkinGeometryData: geometry ? Buffer.from(geometryString).toString('base64') : geometryString,
    SkinGeometryDataEngineVersion: Buffer.from(geometryVersion).toString('base64'),
    SkinAnimationData: animationString ? Buffer.from(animationString).toString('base64') : existingAnimationData,
    CapeId: '',
    ArmSize: 'wide',
    SkinColor: personaBin?.skinColor || '#0',
    PersonaPieces: personaBin?.personaPieces?.length ? personaBin.personaPieces : (Array.isArray(embeddedSkin?.PersonaPieces) ? embeddedSkin.PersonaPieces : []),
    PieceTintColors: personaBin?.pieceTintColors?.length ? personaBin.pieceTintColors : (Array.isArray(embeddedSkin?.PieceTintColors) ? embeddedSkin.PieceTintColors : []),
    PersonaSkin: personaBin?.personaSkin === true || embeddedSkin?.PersonaSkin === true,
    PremiumSkin: embeddedSkin?.PremiumSkin === true,
    CapeOnClassicSkin: false,
    TrustedSkin: true,
    OverrideSkin: true
  }
  if (!previewPng) previewPng = PNG.sync.write({ width: texture.width, height: texture.height, data: texture.data })
  const textureFile = pngCandidates[0]?.name || entries.find(entry => /\.bin$/i.test(entry.name))?.name || 'skin texture'
  return {
    skinData: clientSkin,
    previewDataUrl: 'data:image/png;base64,' + previewPng.toString('base64'),
    meta: {
      name: textureFile.split('/').pop().replace(/\.[^.]+$/, ''),
      width: texture.width,
      height: texture.height,
      geometryId,
      hasGeometry: !!geometry,
      hasAnimation: !!animation,
      hasCape: !!cape,
      sourceFormat: personaBin ? 'Tsukuyomi Persona BIN' : (pngCandidates.length ? 'PNG / JSON' : 'Skin package'),
      sourceFiles: entries.map(entry => entry.name.split('/').pop()).filter(Boolean).slice(0, 20)
    }
  }
}

module.exports = { importSkinEntries, clientSkinToPlayerSkin, extractGeometryIdentifier, decodeRawSkinBin, decodeEmbeddedJson, decodeBase64Text, decodeTsukuyomiPersonaSkinBin }

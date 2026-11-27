'use strict'

const { createHash } = require('node:crypto')

function skinFingerprint (skinData) {
  const source = skinData && typeof skinData === 'object' ? skinData : {}
  const fields = [
    source.SkinData,
    source.SkinGeometryData,
    source.SkinResourcePatch,
    source.SkinAnimationData,
    source.AnimatedImageData,
    source.CapeData,
    source.SkinImageWidth,
    source.SkinImageHeight,
    source.SkinGeometryDataEngineVersion
  ]
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}

function normalizeSkinHistory (history, limit = 3) {
  if (!Array.isArray(history) || !Number.isInteger(limit) || limit < 1) return []
  const result = []
  const seen = new Set()
  for (const entry of history) {
    if (!entry || !entry.skinData || typeof entry.skinData !== 'object' || Array.isArray(entry.skinData) ||
        !entry.skinMeta || typeof entry.skinMeta !== 'object' || Array.isArray(entry.skinMeta)) continue
    const key = skinFingerprint(entry.skinData)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      skinData: entry.skinData,
      skinMeta: { ...entry.skinMeta }
    })
    if (result.length >= limit) break
  }
  return result
}

function rememberSkin (history, skinData, skinMeta, limit = 3) {
  if (!skinData || typeof skinData !== 'object' || !skinMeta || typeof skinMeta !== 'object') {
    throw new TypeError('スキンデータとメタデータが必要です。')
  }
  return normalizeSkinHistory([
    { skinData, skinMeta: { ...skinMeta } },
    ...normalizeSkinHistory(history, limit)
  ], limit)
}

module.exports = { skinFingerprint, normalizeSkinHistory, rememberSkin }

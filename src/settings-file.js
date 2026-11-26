'use strict'

const fsDefault = require('node:fs/promises')

function invalidSettingsError (file, detail, cause) {
  const error = new Error(`設定ファイルを安全に読み込めません。元のファイルは上書きしていません: ${file} (${detail})`)
  error.code = 'ERR_SETTINGS_FILE_INVALID'
  if (cause) error.cause = cause
  return error
}

async function readSettingsFile (file, fsApi = fsDefault) {
  let raw
  try {
    raw = await fsApi.readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, parsed: null, raw: null }
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw invalidSettingsError(file, 'JSONの解析に失敗しました', error)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidSettingsError(file, 'トップレベルがJSONオブジェクトではありません')
  }

  const recognized = ['servers', 'bots', 'trustedServerKeys', 'installedMods']
  if (!recognized.some(key => Object.prototype.hasOwnProperty.call(parsed, key))) {
    throw invalidSettingsError(file, '既知の設定項目がありません')
  }
  for (const key of ['servers', 'bots', 'installedMods']) {
    if (Object.prototype.hasOwnProperty.call(parsed, key) && !Array.isArray(parsed[key])) {
      throw invalidSettingsError(file, `${key} が配列ではありません`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'trustedServerKeys') &&
      (!parsed.trustedServerKeys || typeof parsed.trustedServerKeys !== 'object' || Array.isArray(parsed.trustedServerKeys))) {
    throw invalidSettingsError(file, 'trustedServerKeys がオブジェクトではありません')
  }

  return { exists: true, parsed, raw }
}

module.exports = { readSettingsFile, invalidSettingsError }

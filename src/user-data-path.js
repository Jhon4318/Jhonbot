'use strict'

const fsDefault = require('node:fs')
const pathDefault = require('node:path')

function hasSavedProfileData (directory, options = {}) {
  const fs = options.fs || fsDefault
  const path = options.path || pathDefault
  const settingsFile = path.join(directory, 'settings.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    return (Array.isArray(parsed.bots) && parsed.bots.length > 0) ||
      (Array.isArray(parsed.servers) && parsed.servers.length > 0) ||
      (Array.isArray(parsed.installedMods) && parsed.installedMods.length > 0) ||
      (parsed.trustedServerKeys && typeof parsed.trustedServerKeys === 'object' && Object.keys(parsed.trustedServerKeys).length > 0)
  } catch {
    return false
  }
}

function findExistingUserDataPath (options = {}) {
  const fs = options.fs || fsDefault
  const path = options.path || pathDefault
  const currentUserData = path.resolve(options.currentUserData || '')
  const appData = path.resolve(options.appData || '')
  const candidateNames = [...new Set((options.candidateNames || [])
    .filter(name => typeof name === 'string' && name.trim()))]
  if (!currentUserData || !appData) throw new TypeError('currentUserDataとappDataが必要です。')

  if (hasSavedProfileData(currentUserData, { fs, path })) return null

  const currentSettingsExists = fs.existsSync(path.join(currentUserData, 'settings.json'))
  const candidates = candidateNames
    .map(name => path.resolve(appData, name))
    .filter(candidate => candidate !== currentUserData &&
      fs.existsSync(path.join(candidate, 'settings.json')) &&
      hasSavedProfileData(candidate, { fs, path }))
    .map(candidate => ({
      path: candidate,
      modified: fs.statSync(path.join(candidate, 'settings.json')).mtimeMs
    }))
    .sort((a, b) => b.modified - a.modified)

  if (!candidates.length) return null
  return {
    path: candidates[0].path,
    candidates: candidates.length,
    currentWasEmpty: !currentSettingsExists
  }
}

module.exports = { hasSavedProfileData, findExistingUserDataPath }

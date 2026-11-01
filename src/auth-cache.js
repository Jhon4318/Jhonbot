'use strict'

const fsDefault = require('node:fs/promises')
const pathDefault = require('node:path')
const { randomUUID } = require('node:crypto')

function parseCachePayload (plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('復号処理からJSON文字列を取得できませんでした。')
  }
  const parsed = JSON.parse(plaintext)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('認証キャッシュのJSON形式がオブジェクトではありません。')
  }
  return parsed
}

async function decryptToString (safeStorage, encrypted) {
  if (typeof safeStorage.decryptStringAsync === 'function') {
    let decrypted = await safeStorage.decryptStringAsync(encrypted)
    // Electron's async safeStorage API resolves to
    // { shouldReEncrypt: boolean, result: string }, not a string.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (typeof decrypted === 'string') return decrypted
      if (!decrypted || typeof decrypted.result !== 'string') {
        throw new TypeError('Electron safeStorageから復号済み文字列を取得できませんでした。')
      }
      if (!decrypted.shouldReEncrypt || attempt === 2) return decrypted.result
      // Electron recommends another decrypt pass after key rotation.
      decrypted = await safeStorage.decryptStringAsync(encrypted)
    }
    throw new TypeError('Electron safeStorageの復号を完了できませんでした。')
  }
  if (typeof safeStorage.decryptString === 'function') {
    return safeStorage.decryptString(encrypted)
  }
  throw new Error('利用可能なsafeStorage復号APIがありません。')
}

function createEncryptedAuthCacheFactory (options) {
  const userDataPath = options.userDataPath
  const safeStorage = options.safeStorage
  const fs = options.fs || fsDefault
  const path = options.path || pathDefault
  if (!userDataPath || !safeStorage) throw new TypeError('userDataPathとsafeStorageが必要です。')

  return function encryptedAuthCacheFactory (botId) {
    return ({ cacheName }) => {
      const safeName = String(cacheName || 'cache').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
      const cacheFile = path.join(userDataPath, 'auth', String(botId), `${safeName}.enc`)
      let current
      let readPromise = null

      async function readCache () {
        if (current !== undefined) return current
        if (readPromise) return readPromise
        readPromise = (async () => {
          try {
            const encrypted = await fs.readFile(cacheFile)
            const plaintext = await decryptToString(safeStorage, encrypted)
            current = parseCachePayload(plaintext)
          } catch (error) {
            if (error.code === 'ENOENT') {
              current = {}
            } else {
              throw new Error(`認証キャッシュを復号できません: ${error.message}`)
            }
          }
          return current
        })()
        try {
          return await readPromise
        } finally {
          readPromise = null
        }
      }

      async function writeCache (value) {
        const available = typeof safeStorage.isAsyncEncryptionAvailable === 'function'
          ? await safeStorage.isAsyncEncryptionAvailable()
          : (typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable())
        if (!available) throw new Error('Windowsの安全な認証情報保存機能を利用できません。')

        const next = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const plaintext = JSON.stringify(next)
        const encrypted = typeof safeStorage.encryptStringAsync === 'function'
          ? await safeStorage.encryptStringAsync(plaintext)
          : safeStorage.encryptString(plaintext)
        await fs.mkdir(path.dirname(cacheFile), { recursive: true })
        const temp = `${cacheFile}.${randomUUID()}.tmp`
        try {
          await fs.writeFile(temp, encrypted)
          await fs.rename(temp, cacheFile)
          current = next
        } catch (error) {
          try { await fs.rm(temp, { force: true }) } catch {}
          throw error
        }
      }

      return {
        getCached: readCache,
        setCached: writeCache,
        setCachedPartial: async (value) => {
          const existing = await readCache()
          const partial = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
          await writeCache({ ...existing, ...partial })
        }
      }
    }
  }
}

async function hasEncryptedAuthCache (userDataPath, botId, fs = fsDefault, path = pathDefault) {
  const directory = path.join(userDataPath, 'auth', String(botId))
  try {
    const files = await fs.readdir(directory, { withFileTypes: true })
    return files.some(file => file.isFile() && file.name.endsWith('.enc'))
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

module.exports = {
  createEncryptedAuthCacheFactory,
  hasEncryptedAuthCache,
  parseCachePayload,
  decryptToString
}

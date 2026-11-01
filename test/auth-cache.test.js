'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createEncryptedAuthCacheFactory, hasEncryptedAuthCache, decryptToString } = require('../src/auth-cache')

async function temporaryDirectory () {
  return fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-auth-cache-'))
}

function fakeSafeStorage () {
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptStringAsync: async (buffer) => {
      const value = buffer.toString('utf8')
      assert.ok(value.startsWith('enc:'))
      return { shouldReEncrypt: false, result: value.slice(4) }
    }
  }
}

test('unwraps Electron async safeStorage result object before JSON parsing', async () => {
  const plain = await decryptToString(fakeSafeStorage(), Buffer.from('enc:{"access":"token"}'))
  assert.equal(plain, '{"access":"token"}')
})

test('retries async decryption when Electron reports key rotation', async () => {
  let calls = 0
  const safeStorage = {
    decryptStringAsync: async () => {
      calls++
      return { shouldReEncrypt: calls === 1, result: '{"rotated":true}' }
    }
  }
  assert.equal(await decryptToString(safeStorage, Buffer.from('encrypted')), '{"rotated":true}')
  assert.equal(calls, 2)
})

test('supports legacy sync safeStorage return values', async () => {
  const plain = await decryptToString({ decryptString: () => '{"legacy":true}' }, Buffer.from('legacy'))
  assert.equal(plain, '{"legacy":true}')
})

test('persists and restores token-cache objects across new Authflow cache instances', async (t) => {
  const userDataPath = await temporaryDirectory()
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }))
  const safeStorage = fakeSafeStorage()
  const createFactory = () => createEncryptedAuthCacheFactory({ userDataPath, safeStorage })
  const first = createFactory()('bot-1')({ cacheName: 'xbox' })

  await first.setCached({ XSTSToken: 'sample-token', userXUID: '123' })
  await first.setCachedPartial({ expiresOn: 999 })

  const second = createFactory()('bot-1')({ cacheName: 'xbox' })
  assert.deepEqual(await second.getCached(), {
    XSTSToken: 'sample-token',
    userXUID: '123',
    expiresOn: 999
  })
  assert.equal(await hasEncryptedAuthCache(userDataPath, 'bot-1'), true)
})

test('does not parse the Electron result object itself', async (t) => {
  const userDataPath = await temporaryDirectory()
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }))
  const safeStorage = fakeSafeStorage()
  await fs.mkdir(path.join(userDataPath, 'auth', 'bot-2'), { recursive: true })
  await fs.writeFile(path.join(userDataPath, 'auth', 'bot-2', 'xbox.enc'), Buffer.from('enc:{"token":"ok"}'))
  const cache = createEncryptedAuthCacheFactory({ userDataPath, safeStorage })('bot-2')({ cacheName: 'xbox' })
  assert.deepEqual(await cache.getCached(), { token: 'ok' })
})

test('rejects an unexpected decrypt result with a clear error', async () => {
  await assert.rejects(
    decryptToString({ decryptStringAsync: async () => ({ shouldReEncrypt: false }) }, Buffer.from('x')),
    /復号済み文字列を取得できませんでした/
  )
})

test('reports no cached credentials when the bot cache directory does not exist', async (t) => {
  const userDataPath = await temporaryDirectory()
  t.after(() => fs.rm(userDataPath, { recursive: true, force: true }))
  assert.equal(await hasEncryptedAuthCache(userDataPath, 'missing-bot'), false)
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeServerProfile,
  normalizeTarget,
  migrateSettings,
  legacyServerId,
  serverHttpSignallingOrigin,
  serverOriginKey
} = require('../src/destinations')

test('validates and normalizes server profiles', () => {
  const profile = normalizeServerProfile({ label: ' Hive ', host: 'as.nethernet.playhive.com', port: '19132', mode: 'http' })
  assert.equal(profile.label, 'Hive')
  assert.equal(profile.host, 'as.nethernet.playhive.com')
  assert.equal(profile.port, 19132)
  assert.equal(profile.mode, 'http')
  assert.equal(profile.signallingUrl, 'https://as.nethernet.playhive.com')
  assert.ok(profile.id)
})

test('rejects invalid server profiles and URL schemes', () => {
  assert.throws(() => normalizeServerProfile({ label: '', host: 'example.net', port: 19132 }), /サーバー名/)
  assert.throws(() => normalizeServerProfile({ label: 'X', host: 'http://example.net', port: 19132 }), /ホスト名/)
  assert.throws(() => normalizeServerProfile({ label: 'X', host: 'example.net', port: 70000 }), /ポート番号/)
  assert.throws(() => normalizeServerProfile({ label: 'X', host: 'example.net', port: 19132, mode: 'http', signallingUrl: 'ftp://example.net' }), /HTTP\(S\)/)
})

test('validates server, friend-world, and LAN targets separately', () => {
  const profiles = [{ id: 'a', label: 'A', host: 'a.example', port: 19132, mode: 'auto' }]
  assert.deepEqual(normalizeTarget({ type: 'server', serverId: 'a' }, profiles), { type: 'server', serverId: 'a', networkId: '', worldName: '' })
  assert.equal(normalizeTarget({ type: 'friend-world' }, profiles).type, 'friend-world')
  assert.equal(normalizeTarget({ type: 'lan-world' }, profiles).networkId, '')
  assert.equal(normalizeTarget({ type: 'lan-world', networkId: '123456', worldName: 'Home' }, profiles).worldName, 'Home')
  assert.throws(() => normalizeTarget({ type: 'server', serverId: 'missing' }, profiles), /見つかりません/)
  assert.throws(() => normalizeTarget({ type: 'lan-world', networkId: 'not-a-number' }, profiles), /不正です/)
})

test('migrates 0.2.x Bot-bound host and port into shared server profiles', () => {
  const migrated = migrateSettings({
    server: { host: 'old.example', port: 19132 },
    bots: [
      { id: 'bot-1', label: 'One', host: 'old.example', port: 19132 },
      { id: 'bot-2', label: 'Two', host: 'old.example', port: 19132 },
      { id: 'bot-3', label: 'Three' }
    ]
  })
  assert.equal(migrated.servers.length, 1)
  assert.equal(migrated.bots.length, 3)
  assert.equal(migrated.bots[0].targetType, 'server')
  assert.equal(migrated.bots[0].targetId, migrated.bots[1].targetId)
  assert.equal(migrated.bots[2].targetType, 'none')
  assert.equal(migrated.bots[0].targetId, legacyServerId('old.example', 19132))
})

test('migrates existing The Hive HTTP profiles to the HTTPS signalling origin', () => {
  const migrated = migrateSettings({
    servers: [{ id: 'hive-old', label: 'The Hive（アジア）', host: 'as.nethernet.playhive.com', port: 19132, mode: 'http' }],
    bots: [{ id: 'bot-hive', label: 'Hive Bot', targetType: 'server', targetId: 'hive-old' }]
  })
  assert.equal(migrated.servers[0].signallingUrl, 'https://as.nethernet.playhive.com')
  assert.equal(migrated.bots[0].targetId, 'hive-old')
  assert.equal(serverHttpSignallingOrigin(migrated.servers[0]), 'https://as.nethernet.playhive.com')
})

test('keeps ordinary HTTP profiles on their configured host and port', () => {
  const profile = normalizeServerProfile({ label: 'Local test', host: 'server.example', port: 19132, mode: 'http' })
  assert.equal(profile.signallingUrl, '')
  assert.equal(serverHttpSignallingOrigin(profile), 'http://server.example:19132')
})

test('persists only valid trusted HTTP server key fingerprints', () => {
  const migrated = migrateSettings({
    bots: [],
    trustedServerKeys: {
      'http://server.example:19132': `sha256:${'a'.repeat(64)}`,
      'file:///evil': `sha256:${'b'.repeat(64)}`,
      'http://bad.example': 'wrong'
    }
  })
  assert.equal(Object.keys(migrated.trustedServerKeys).length, 1)
  assert.equal(serverOriginKey('http://server.example:19132/path'), 'http://server.example:19132')
})

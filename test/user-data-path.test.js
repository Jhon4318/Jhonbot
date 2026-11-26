'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { findExistingUserDataPath, hasSavedProfileData } = require('../src/user-data-path')

async function withTempTree (run) {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'jhonbot-userdata-'))
  try {
    const appData = path.join(root, 'Roaming')
    const current = path.join(appData, 'bedrock-bot-console')
    await fsPromises.mkdir(current, { recursive: true })
    await run({ appData, current })
  } finally {
    await fsPromises.rm(root, { recursive: true, force: true })
  }
}

test('detects meaningful saved Bot or server data', async () => {
  await withTempTree(async ({ current }) => {
    await fsPromises.writeFile(path.join(current, 'settings.json'), JSON.stringify({
      bots: [{ id: 'bot-1', label: 'Miner' }],
      servers: []
    }))
    assert.equal(hasSavedProfileData(current), true)
  })
})

test('prefers a legacy data directory when the current directory contains an empty profile', async () => {
  await withTempTree(async ({ appData, current }) => {
    await fsPromises.writeFile(path.join(current, 'settings.json'), JSON.stringify({ bots: [], servers: [], installedMods: [] }))
    const legacy = path.join(appData, 'Bedrock Bot Console')
    await fsPromises.mkdir(legacy, { recursive: true })
    await fsPromises.writeFile(path.join(legacy, 'settings.json'), JSON.stringify({
      bots: [{ id: 'bot-1', label: 'Miner' }],
      servers: [{ id: 'server-1', label: 'My server', host: 'example.net', port: 19132 }]
    }))
    const result = findExistingUserDataPath({
      currentUserData: current,
      appData,
      candidateNames: ['bedrock-bot-console', 'Bedrock Bot Console']
    })
    assert.equal(result.path, legacy)
    assert.equal(result.currentWasEmpty, true)
  })
})

test('does not replace a current profile that already contains saved data', async () => {
  await withTempTree(async ({ appData, current }) => {
    await fsPromises.writeFile(path.join(current, 'settings.json'), JSON.stringify({
      bots: [{ id: 'new-bot', label: 'Current' }],
      servers: []
    }))
    const legacy = path.join(appData, 'Bedrock Bot Console')
    await fsPromises.mkdir(legacy, { recursive: true })
    await fsPromises.writeFile(path.join(legacy, 'settings.json'), JSON.stringify({
      bots: [{ id: 'old-bot', label: 'Old' }],
      servers: []
    }))
    assert.equal(findExistingUserDataPath({
      currentUserData: current,
      appData,
      candidateNames: ['Bedrock Bot Console']
    }), null)
  })
})

test('does not treat malformed or unpopulated settings as a recoverable source', async () => {
  await withTempTree(async ({ appData, current }) => {
    await fsPromises.writeFile(path.join(current, 'settings.json'), '{"bots":')
    const legacy = path.join(appData, 'Bedrock Bot Console')
    await fsPromises.mkdir(legacy, { recursive: true })
    await fsPromises.writeFile(path.join(legacy, 'settings.json'), JSON.stringify({ bots: [], servers: [] }))
    assert.equal(findExistingUserDataPath({
      currentUserData: current,
      appData,
      candidateNames: ['Bedrock Bot Console']
    }), null)
  })
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { readSettingsFile } = require('../src/settings-file')

async function withTempSettings (run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jhonbot-settings-'))
  const file = path.join(directory, 'settings.json')
  try { await run(file) } finally { await fs.rm(directory, { recursive: true, force: true }) }
}

test('missing settings are reported without writing a file', async () => {
  await withTempSettings(async file => {
    const result = await readSettingsFile(file)
    assert.equal(result.exists, false)
    assert.equal(result.parsed, null)
    await assert.rejects(fs.stat(file), { code: 'ENOENT' })
  })
})

test('valid legacy settings are preserved for migration', async () => {
  await withTempSettings(async file => {
    const raw = JSON.stringify({ servers: [], bots: [{ id: 'bot-1', label: 'Miner' }] })
    await fs.writeFile(file, raw, 'utf8')
    const result = await readSettingsFile(file)
    assert.equal(result.exists, true)
    assert.equal(result.parsed.bots[0].label, 'Miner')
    assert.equal(result.raw, raw)
    assert.equal(await fs.readFile(file, 'utf8'), raw)
  })
})

test('invalid JSON never gets converted into an empty settings file', async () => {
  await withTempSettings(async file => {
    const raw = '{"bots": [broken'
    await fs.writeFile(file, raw, 'utf8')
    await assert.rejects(readSettingsFile(file), error => error.code === 'ERR_SETTINGS_FILE_INVALID')
    assert.equal(await fs.readFile(file, 'utf8'), raw)
  })
})

test('wrong settings shapes are rejected instead of silently dropping saved data', async () => {
  await withTempSettings(async file => {
    const raw = JSON.stringify({ bots: 'not-an-array', servers: [] })
    await fs.writeFile(file, raw, 'utf8')
    await assert.rejects(readSettingsFile(file), error => error.code === 'ERR_SETTINGS_FILE_INVALID')
    assert.equal(await fs.readFile(file, 'utf8'), raw)
  })
})

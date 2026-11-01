'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

test('pins a prismarine-chunk build with Bedrock 1.26 mapping', () => {
  assert.equal(
    packageJson.overrides?.['prismarine-chunk'],
    'github:Pix3lPirat3/prismarine-chunk#feat/bedrock-1.26-chunks'
  )
})

test('keeps the target Bedrock protocol version explicit', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(mainSource, /MC_VERSION\s*=\s*['"]1\.26\.60['"]/)
})


test('uses pure-JavaScript RakNet while preserving transport selection', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(mainSource, /if \(profile\.mode === 'raknet'\)[\s\S]*?transport: 'raknet'/)
  assert.match(mainSource, /if \(advertisement\.transport === 'raknet'\)[\s\S]*?transport: 'raknet'/)
  assert.match(mainSource, /raknetBackend\s*:\s*['"]jsp-raknet['"]/)
  assert.match(mainSource, /useRaknetWorkers\s*:\s*false/)
  assert.match(mainSource, /resolveServerConnectionOptions/)
})

test('writes diagnostics to a persistent file and records process termination', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(mainSource, /bot-console\.log/)
  assert.match(mainSource, /process\.on\('exit'/)
  assert.match(mainSource, /uncaughtExceptionMonitor/)
  assert.match(mainSource, /render-process-gone/)
})


test('pins the experimental NetherNet HTTP implementation used by The Hive', () => {
  assert.equal(packageJson.dependencies['bedrock-protocol'], 'github:PrismarineJS/bedrock-protocol#b4160368b7e5272ccdd435f75459220c167fe4e4')
  assert.equal(packageJson.overrides?.nethernet, 'github:PrismarineJS/node-nethernet#c46db7da4f0e97ec04487648f5759e3f23ff8e9c')
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(mainSource, /as\.nethernet\.playhive\.com/)
  assert.match(mainSource, /signalling: 'http'/)
  const patchSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'patch-bedrock-protocol.js'), 'utf8')
  assert.match(patchSource, /EXPECTED_NETHERNET_VERSION = '1\.1\.2'/)
  assert.match(patchSource, /authorization\.franchise\.minecraft-services\.net/)
  assert.match(patchSource, /BEDROCK_BOT_CONSOLE_HTTP_ERROR_BODY/)
})

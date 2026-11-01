'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const packageJson = require('../package.json')
const { EXPECTED_VERSION, EXPECTED_NETHERNET_VERSION, ORIGINAL, REPLACEMENT, MARKER, IDENTITY_ORIGINAL, HTTP_ERROR_ORIGINAL, OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL, OFFER_DIAGNOSTIC_FETCH_ORIGINAL, patchCreateClientSource } = require('../scripts/patch-bedrock-protocol')

const projectRoot = path.join(__dirname, '..')
const mainSource = fs.readFileSync(path.join(projectRoot, 'src', 'main.js'), 'utf8')
const patchSource = fs.readFileSync(path.join(projectRoot, 'scripts', 'patch-bedrock-protocol.js'), 'utf8')

test('expects the package version actually published by the pinned HTTP-capable commit', () => {
  assert.equal(EXPECTED_VERSION, '3.60.1')
})

test('patches the HTTP-capable bedrock-protocol discovery probe to pure-JavaScript RakNet', () => {
  const source = `async function ping () {\n  ${ORIGINAL}\n}`
  const result = patchCreateClientSource(source)
  assert.equal(result.changed, true)
  assert.equal(result.source.includes(REPLACEMENT), true)
  assert.ok(result.source.includes(MARKER))
  assert.ok(!result.source.includes(ORIGINAL))
  new vm.Script(result.source)
})

test('discovery patch is idempotent and validates the whole source', () => {
  const first = patchCreateClientSource(`const helper = 1\nasync function ping () {\n  ${ORIGINAL}\n}`)
  const second = patchCreateClientSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('fails closed when bedrock-protocol source changes unexpectedly', () => {
  assert.throws(() => patchCreateClientSource('function ping () {}'), /known code block not found/)
})

test('rejects a previously marked but syntactically corrupted source', () => {
  assert.throws(() => patchCreateClientSource(`// ${MARKER}\nconst = broken`), /Unexpected token/)
})

test('uses pure-JavaScript RakNet for actual legacy RakNet connections', () => {
  assert.match(mainSource, /raknetBackend:\s*'jsp-raknet'/)
  assert.match(mainSource, /useRaknetWorkers:\s*false/)
})

test('supports preflight transport discovery before creating the Mineflayer session', () => {
  assert.match(mainSource, /resolveServerConnectionOptions/ )
  assert.match(mainSource, /bedrockProtocol\.ping/ )
  assert.match(mainSource, /skipPing: true/ )
})

test('does not patch bedrock-protocol options.js', () => {
  assert.doesNotMatch(patchSource, /path\.join\(copy\.root, 'src', 'options\.js'\)/)
  assert.doesNotMatch(patchSource, /patchOptionsSource/)
})

test('patch runs after install and before app start', () => {
  assert.equal(packageJson.scripts.postinstall, 'node scripts/patch-bedrock-protocol.js')
  assert.equal(packageJson.scripts.prestart, 'node scripts/patch-bedrock-protocol.js')
})

test('pins the expected protocol patch target', () => {
  assert.equal(packageJson.dependencies['bedrock-protocol'], 'github:PrismarineJS/bedrock-protocol#b4160368b7e5272ccdd435f75459220c167fe4e4')
})

test('patches app and nested Mineflayer protocol copies without touching options.js', () => {
  const os = require('node:os')
  const { applyPatch } = require('../scripts/patch-bedrock-protocol')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-bot-patch-test-'))
  const writeProtocol = (root) => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'bedrock-protocol', version: EXPECTED_VERSION }))
    fs.writeFileSync(path.join(root, 'index.js'), "module.exports = require('./src/createClient.js')")
    fs.writeFileSync(path.join(root, 'src', 'createClient.js'), `${ORIGINAL}\n`)
    fs.writeFileSync(path.join(root, 'src', 'client.js'), `${IDENTITY_ORIGINAL}\n`)
    fs.writeFileSync(path.join(root, 'src', 'options.js'), 'const mcData = require(\'minecraft-data\')\n')
  }
  try {
    const rootProtocol = path.join(tempRoot, 'node_modules', 'bedrock-protocol')
    const mineflayerRoot = path.join(tempRoot, 'node_modules', 'mineflayer')
    const nestedProtocol = path.join(mineflayerRoot, 'node_modules', 'bedrock-protocol')
    fs.mkdirSync(mineflayerRoot, { recursive: true })
    fs.writeFileSync(path.join(mineflayerRoot, 'package.json'), JSON.stringify({ name: 'mineflayer', version: '4.39.0' }))
    fs.writeFileSync(path.join(mineflayerRoot, 'index.js'), 'module.exports = {}')
    writeProtocol(rootProtocol)
    writeProtocol(nestedProtocol)

    const nethernetRoot = path.join(tempRoot, 'node_modules', 'nethernet')
    fs.mkdirSync(path.join(nethernetRoot, 'src', 'signalling'), { recursive: true })
    fs.writeFileSync(path.join(nethernetRoot, 'package.json'), JSON.stringify({ name: 'nethernet', version: EXPECTED_NETHERNET_VERSION }))
    fs.writeFileSync(path.join(nethernetRoot, 'index.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(nethernetRoot, 'src', 'signalling', 'http.js'), `const body = 'sdp'\n${OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL}\n${HTTP_ERROR_ORIGINAL}\n${OFFER_DIAGNOSTIC_FETCH_ORIGINAL}\n    method: 'POST',\n    body\n  })\n  return response\n}\nmodule.exports = { exchangeOffer }\n`)

    const first = applyPatch(tempRoot)
    assert.equal(first.length, 6)
    for (const target of [rootProtocol, nestedProtocol]) {
      const source = fs.readFileSync(path.join(target, 'src', 'createClient.js'), 'utf8')
      assert.ok(source.includes(MARKER))
      assert.ok(!source.includes(ORIGINAL))
      const clientSource = fs.readFileSync(path.join(target, 'src', 'client.js'), 'utf8')
      assert.match(clientSource, /authorization\.franchise\.minecraft-services\.net/)
      assert.equal(fs.readFileSync(path.join(target, 'src', 'options.js'), 'utf8'), 'const mcData = require(\'minecraft-data\')\n')
    }
    const second = applyPatch(tempRoot)
    assert.deepEqual(second.map(result => result.changed), [false, false, false, false, false, false])
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const {
  NETWORK_SETTINGS_COMPRESSION_ORIGINAL,
  NETWORK_SETTINGS_COMPRESSION_MARKER,
  patchNetworkSettingsCompressionSource
} = require('../scripts/patch-bedrock-protocol')

function createFixture () {
  return [
    'class CompressionSettingsFixture {',
    NETWORK_SETTINGS_COMPRESSION_ORIGINAL,
    '}'
  ].join('\n')
}

function applySettings (algorithm) {
  const patched = patchNetworkSettingsCompressionSource(createFixture())
  const Fixture = vm.runInNewContext(patched.source + '\nCompressionSettingsFixture')
  const client = new Fixture()
  client.updateCompressorSettings({ compression_algorithm: algorithm, compression_threshold: 512 })
  return client
}

test('selects ZLib and its 0x00 header for text and numeric enum values', () => {
  for (const algorithm of ['deflate', 0, '0']) {
    const client = applySettings(algorithm)
    assert.equal(client.compressionAlgorithm, 'deflate')
    assert.equal(client.compressionHeader, 0)
    assert.equal(client.compressionThreshold, 512)
    assert.equal(client.compressionReady, true)
  }
})

test('selects Snappy and its 0x01 header for text and numeric enum values', () => {
  for (const algorithm of ['snappy', 1, '1']) {
    const client = applySettings(algorithm)
    assert.equal(client.compressionAlgorithm, 'snappy')
    assert.equal(client.compressionHeader, 1)
    assert.equal(client.compressionThreshold, 512)
    assert.equal(client.compressionReady, true)
  }
})

test('selects None and its 0xFF header for supported enum values', () => {
  for (const algorithm of ['none', 2, 65535, '65535']) {
    const client = applySettings(algorithm)
    assert.equal(client.compressionAlgorithm, 'none')
    assert.equal(client.compressionHeader, 255)
  }
})

test('defaults an absent algorithm to ZLib', () => {
  const patched = patchNetworkSettingsCompressionSource(createFixture())
  const Fixture = vm.runInNewContext(patched.source + '\nCompressionSettingsFixture')
  const client = new Fixture()
  client.updateCompressorSettings({ compression_threshold: 512 })
  assert.equal(client.compressionAlgorithm, 'deflate')
  assert.equal(client.compressionHeader, 0)
})

test('rejects unknown algorithms instead of silently emitting a mismatched header', () => {
  assert.throws(() => applySettings(7), /Unsupported Bedrock compression algorithm: 7/)
})

test('patch is idempotent and fails closed for unknown source layouts', () => {
  const once = patchNetworkSettingsCompressionSource(createFixture())
  const twice = patchNetworkSettingsCompressionSource(once.source)
  assert.equal(once.changed, true)
  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
  assert.match(once.source, new RegExp(NETWORK_SETTINGS_COMPRESSION_MARKER))
  assert.throws(() => patchNetworkSettingsCompressionSource('class UnknownFixture {}'), /known code block not found/)
})

test('main diagnostics contain only compression metadata, not authentication contents', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(mainSource, /algorithmName/)
  assert.match(mainSource, /params\.compression_threshold/)
  assert.doesNotMatch(mainSource, /compression=.*params\.tokens|compression=.*JWT/i)
})

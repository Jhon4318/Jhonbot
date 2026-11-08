'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const Snappy = require('snappyjs')
const {
  SNAPPY_COMPRESS_MARKER,
  SNAPPY_DECOMPRESS_MARKER,
  patchSnappyCompressionSource
} = require('../scripts/patch-bedrock-protocol')

const FIXTURE = [
  'function compress (buffer) {',
  "  switch ('snappy') {",
  "    case 'deflate': return buffer",
  "    case 'snappy': throw Error('Snappy compression not implemented')",
  "    case 'none': return buffer",
  '  }',
  '}',
  'function decompress (algorithm, buffer) {',
  '  switch (algorithm) {',
  '    case 0:',
  "    case 'deflate': return buffer",
  '      case 1:',
  "      case 'snappy':",
  "        throw Error('Snappy compression not implemented')",
  "    case 'none': return buffer",
  '  }',
  '}'
].join('\n')

test('patches both Bedrock Snappy compression directions and is idempotent', () => {
  const first = patchSnappyCompressionSource(FIXTURE)
  assert.equal(first.changed, true)
  assert.ok(first.source.includes(SNAPPY_COMPRESS_MARKER))
  assert.ok(first.source.includes(SNAPPY_DECOMPRESS_MARKER))
  const second = patchSnappyCompressionSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
  assert.doesNotThrow(() => new vm.Script(first.source))
})

test('patched Snappy compressor and decompressor round-trip raw Bedrock batches', () => {
  const patched = patchSnappyCompressionSource(FIXTURE)
  const module = { exports: {} }
  const sandbox = {
    Buffer,
    module,
    require: (name) => {
      assert.equal(name, 'snappyjs')
      return Snappy
    }
  }
  vm.runInNewContext(patched.source + '\nmodule.exports = { compress, decompress }', sandbox)
  const input = Buffer.from('Bedrock SubClient packet batch: '.repeat(1000), 'utf8')
  const compressed = Buffer.from(module.exports.compress(input))
  const restored = Buffer.from(module.exports.decompress('snappy', compressed))
  assert.ok(compressed.length < input.length)
  assert.deepEqual(restored, input)
})

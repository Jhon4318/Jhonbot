'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  decodeSubClientHeader,
  rewriteSubClientHeader,
  writeVarUint32
} = require('../src/subclients')

test('SubClient header round-trips all guest IDs', () => {
  const body = Buffer.from([0xaa, 0xbb, 0xcc])
  for (let subClientId = 1; subClientId <= 3; subClientId++) {
    const raw = Buffer.concat([writeVarUint32(0x5e), body])
    const rewritten = rewriteSubClientHeader(raw, 0, subClientId)
    const decoded = decodeSubClientHeader(rewritten)
    assert.equal(decoded.packetId, 0x5e)
    assert.equal(decoded.recipient, 0)
    assert.equal(decoded.sender, subClientId)
    assert.deepEqual(rewritten.subarray(decoded.bodyOffset), body)
  }
})

test('incoming SubClient recipient and sender are decoded', () => {
  const raw = Buffer.from([0x9e, 0x30, 0x01, 0x02])
  const decoded = decodeSubClientHeader(raw)
  assert.equal(decoded.packetId, 0x1e)
  assert.equal(decoded.recipient, 2)
  assert.equal(decoded.sender, 1)
})

test('invalid subclient headers are rejected', () => {
  assert.equal(decodeSubClientHeader(Buffer.alloc(0)), null)
  assert.equal(decodeSubClientHeader(Buffer.from([0x80])), null)
})


const { EventEmitter } = require('node:events')
const { installSubClientSupport } = require('../src/subclients')

function makeParentClient (initialized = false) {
  const parent = new EventEmitter()
  parent.sendBuffer = () => {}
  parent.readPacket = () => {}
  parent.updateItemPalette = () => {}
  if (initialized) {
    parent.serializer = { createPacketBuffer: () => Buffer.from([0x01]) }
    parent.deserializer = { parsePacketBuffer: () => ({ data: { name: 'play_status', params: { status: 0 } } }) }
  }
  return parent
}

test('SubClient support installs immediately when the Bedrock client is initialized', () => {
  const parent = makeParentClient(true)
  installSubClientSupport(parent)
  assert.equal(parent.__jhonSubClientSupport, true)
  assert.equal(typeof parent.createSubClient, 'function')
})

test('SubClient support waits for connect_allowed when world discovery delays client initialization', () => {
  const parent = makeParentClient(false)
  installSubClientSupport(parent)
  assert.equal(parent.__jhonSubClientSupport, undefined)
  assert.equal(parent.__jhonSubClientSupportPending, true)
  assert.equal(parent.createSubClient, undefined)

  parent.serializer = { createPacketBuffer: () => Buffer.from([0x01]) }
  parent.deserializer = { parsePacketBuffer: () => ({ data: { name: 'play_status', params: { status: 0 } } }) }
  parent.emit('connect_allowed')

  assert.equal(parent.__jhonSubClientSupportPending, false)
  assert.equal(parent.__jhonSubClientSupport, true)
  assert.equal(typeof parent.createSubClient, 'function')
})

test('repeated SubClient setup requests do not register duplicate initialization listeners', () => {
  const parent = makeParentClient(false)
  installSubClientSupport(parent)
  installSubClientSupport(parent)
  assert.equal(parent.listenerCount('connect_allowed'), 1)

  parent.serializer = { createPacketBuffer: () => Buffer.from([0x01]) }
  parent.deserializer = { parsePacketBuffer: () => ({ data: { name: 'play_status', params: { status: 0 } } }) }
  parent.emit('connect_allowed')
  assert.equal(parent.__jhonSubClientSupport, true)
  assert.equal(parent.listenerCount('connect_allowed'), 0)
})

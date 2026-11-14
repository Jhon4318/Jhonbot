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
const { installSubClientSupport, createSubClientLoginDispatcher } = require('../src/subclients')

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


test('SubClient login sends a validated packet 0x5e with recipient 0 and the guest sender ID', () => {
  const sent = []
  const parent = makeParentClient(true)
  parent.sendBuffer = (packet, immediate) => sent.push({ packet, immediate })
  parent.serializer.createPacketBuffer = ({ name, params }) => {
    assert.equal(name, 'sub_client_login')
    assert.equal(typeof params.tokens.identity, 'string')
    assert.equal(typeof params.tokens.client, 'string')
    return Buffer.from([0x5e, 0x01, 0x02])
  }

  installSubClientSupport(parent)
  const view = parent.createSubClient(2, 'Guest (2)')
  const result = view.login({ identity: '{"AuthenticationType":1}', client: 'signed-client-jwt' })

  assert.equal(result.subClientId, 2)
  assert.equal(result.byteLength, 4)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].immediate, true)
  const header = decodeSubClientHeader(sent[0].packet)
  assert.equal(header.packetId, 0x5e)
  assert.equal(header.recipient, 0)
  assert.equal(header.sender, 2)
})

test('SubClient login rejects incomplete credentials before sending', () => {
  const sent = []
  const parent = makeParentClient(true)
  parent.sendBuffer = packet => sent.push(packet)
  installSubClientSupport(parent)
  const view = parent.createSubClient(1, 'Guest (1)')
  assert.throws(() => view.login({ identity: '{}', client: '' }), /identity \/ client/)
  assert.equal(sent.length, 0)
})

test('SubClient login cannot be sent twice for the same view', () => {
  const parent = makeParentClient(true)
  parent.sendBuffer = () => {}
  parent.serializer.createPacketBuffer = () => Buffer.from([0x5e, 0x00])
  installSubClientSupport(parent)
  const view = parent.createSubClient(1, 'Guest (1)')
  const tokens = { identity: '{}', client: 'signed-client-jwt' }
  view.login(tokens)
  assert.throws(() => view.login(tokens), /送信済み/)
})


test('scheduled SubClientLogin retains credentials outside the caller scope', () => {
  const tokens = { identity: 'identity-jwt', client: 'client-jwt' }
  const sent = []
  const errors = []
  const scheduled = []
  const view = {
    closed: false,
    login (receivedTokens) {
      assert.strictEqual(receivedTokens, tokens)
      return { subClientId: 1, byteLength: 48 }
    }
  }
  const dispatch = createSubClientLoginDispatcher(tokens, (callback, delay) => {
    assert.equal(delay, 0)
    scheduled.push(callback)
    return scheduled.length
  })
  dispatch(view, {
    isCurrent: () => true,
    onSent: result => sent.push(result),
    onError: error => errors.push(error)
  })

  assert.equal(sent.length, 0)
  assert.equal(scheduled.length, 1)
  scheduled[0]()
  assert.deepEqual(sent, [{ subClientId: 1, byteLength: 48 }])
  assert.equal(errors.length, 0)
})

test('scheduled SubClientLogin skips closed or stale guest sessions', () => {
  let loginCalls = 0
  const scheduled = []
  const dispatch = createSubClientLoginDispatcher(
    { identity: 'identity-jwt', client: 'client-jwt' },
    callback => { scheduled.push(callback); return scheduled.length }
  )
  dispatch({ closed: true, login: () => { loginCalls++ } }, { isCurrent: () => true })
  dispatch({ closed: false, login: () => { loginCalls++ } }, { isCurrent: () => false })

  for (const callback of scheduled) callback()
  assert.equal(loginCalls, 0)
})

test('scheduled SubClientLogin reports packet-send failures through its callback', () => {
  const expectedError = new Error('mock send failure')
  const errors = []
  const scheduled = []
  const dispatch = createSubClientLoginDispatcher(
    { identity: 'identity-jwt', client: 'client-jwt' },
    callback => { scheduled.push(callback); return scheduled.length }
  )
  dispatch({
    closed: false,
    login: () => { throw expectedError }
  }, {
    isCurrent: () => true,
    onError: error => errors.push(error)
  })

  scheduled[0]()
  assert.deepEqual(errors, [expectedError])
})

test('the pinned Bedrock 1.26.60 schema can encode SubClientLogin tokens', () => {
  const path = require('node:path')
  const bedrockEntry = require.resolve('bedrock-protocol')
  const { createSerializer } = require(path.join(path.dirname(bedrockEntry), 'src', 'transforms', 'serializer.js'))
  const serializer = createSerializer('1.26.60')
  const packet = serializer.createPacketBuffer({
    name: 'sub_client_login',
    params: {
      tokens: {
        identity: JSON.stringify({
          Certificate: JSON.stringify({ chain: ['identity-chain-jwt'] }),
          AuthenticationType: 1,
          Token: 'multiplayer-token-jwt'
        }),
        client: 'signed-client-data-jwt'
      }
    }
  })

  const header = decodeSubClientHeader(packet)
  assert.equal(header.packetId, 0x5e)
  assert.ok(packet.length > 10)
})

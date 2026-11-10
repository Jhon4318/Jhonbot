'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const {
  BEDROCK_CONNECTION_WRITE_ORIGINAL,
  BEDROCK_CONNECTION_SEND_MCPE_ORIGINAL,
  patchBedrockConnectionOutboundDiagnosticsSource
} = require('../scripts/patch-bedrock-protocol')

function createFixtureSource () {
  return [
    'class ConnectionFixture {',
    '  sendDecryptedBatch (batch) { this.sendMCPE(batch.encode(), true) }',
    '  sendEncryptedBatch (batch) { this.sendMCPE(batch.encode(), true) }',
    BEDROCK_CONNECTION_WRITE_ORIGINAL,
    BEDROCK_CONNECTION_SEND_MCPE_ORIGINAL,
    '}'
  ].join('\n')
}

function createClient (settings = {}) {
  const diagnostics = []
  const transport = {
    connected: settings.connected !== false,
    nethernet: {
      connection: { reliable: { readyState: settings.readyState || 'open' } },
      reportDiagnostic: message => diagnostics.push(String(message))
    },
    sendReliable: settings.sendReliable || (buffer => buffer.length)
  }
  const source = patchBedrockConnectionOutboundDiagnosticsSource(createFixtureSource()).source
  const Fixture = vm.runInNewContext(source + '\nConnectionFixture', {
    Buffer,
    ClientStatus: { Disconnected: 0 },
    Framer: class {
      addEncodedPacket (packet) { this.packet = packet }
      encode () { return Buffer.from('encoded-transport-frame') }
      getBuffer () { return Buffer.from('encrypted-transport-frame') }
    },
    debug: () => {}
  })
  const client = Object.create(Fixture.prototype)
  Object.assign(client, {
    options: { transport: 'nethernet' },
    serializer: { createPacketBuffer: () => Buffer.from('serialized-login-packet') },
    connection: transport,
    status: 1,
    _processOutbound: () => {}
  })
  return { client, diagnostics, transport }
}

test('logs encoded Login and the actual reliable transport send result without packet contents', () => {
  const { client, diagnostics } = createClient()
  client.write('login', { identity: 'SECRET_AUTH_TOKEN' })

  assert.ok(diagnostics.some(message => message.includes('name=login') && message.includes('packetBytes=')))
  assert.ok(diagnostics.some(message => message.includes('transport result') &&
    message.includes('name=login') &&
    message.includes('dataChannel=open') &&
    message.includes('result=accepted') &&
    message.includes('acceptedBytes=23')))
  assert.doesNotMatch(diagnostics.join('\n'), /SECRET_AUTH_TOKEN|serialized-login-packet|encoded-transport-frame/)
})

test('distinguishes a queued send from an accepted DataChannel send', () => {
  const { client, diagnostics } = createClient({
    readyState: 'connecting',
    sendReliable: () => 0
  })
  client.write('login', { identity: 'SECRET_AUTH_TOKEN' })
  assert.ok(diagnostics.some(message =>
    message.includes('name=login') &&
    message.includes('dataChannel=connecting') &&
    message.includes('result=queued_or_zero') &&
    message.includes('acceptedBytes=0')
  ))
})

test('records a transport guard skip without claiming that Login was transmitted', () => {
  const { client, diagnostics } = createClient({ connected: false })
  client.write('login', {})
  assert.ok(diagnostics.some(message =>
    message.includes('skipped') &&
    message.includes('name=login') &&
    message.includes('connected=false')
  ))
  assert.equal(diagnostics.some(message => message.includes('transport result')), false)
})

test('records only the error class when the reliable send throws', () => {
  const { client, diagnostics } = createClient({
    sendReliable: () => {
      const error = new Error('must not be included in diagnostics')
      error.name = 'DataChannelFailure'
      throw error
    }
  })
  client.write('login', {})
  assert.ok(diagnostics.some(message =>
    message.includes('transport error') &&
    message.includes('name=login') &&
    message.includes('errorName=DataChannelFailure')
  ))
  assert.doesNotMatch(diagnostics.join('\n'), /must not be included/)
})

test('patch is idempotent and refuses an unknown connection layout', () => {
  const once = patchBedrockConnectionOutboundDiagnosticsSource(createFixtureSource())
  const twice = patchBedrockConnectionOutboundDiagnosticsSource(once.source)
  assert.equal(once.changed, true)
  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
  assert.throws(
    () => patchBedrockConnectionOutboundDiagnosticsSource('class UnknownConnection {}'),
    /known code block not found/
  )
})

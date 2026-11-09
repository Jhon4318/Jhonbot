'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const {
  OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL,
  OFFER_DIAGNOSTIC_FUNCTION_REPLACEMENT,
  OFFER_DIAGNOSTIC_FETCH_ORIGINAL,
  OFFER_DIAGNOSTIC_LOG_REPLACEMENT,
  patchHttpOfferDiagnosticsSource
} = require('../scripts/patch-bedrock-protocol')

const FIXTURE = [
  'async function exchangeOffer (client, signal) {',
  "  const body = 'v=0\\r\\n'",
  '  const { url, serverKey, onServerKey } = client.http',
  '  const response = await fetch(new URL(`/v1/join/${client.networkId}`, url), {',
  "    method: 'POST', headers: { 'content-type': 'application/sdp' }, body, signal, redirect: 'error'",
  '  })',
  '  if (!response.ok) throw new Error(`Nethernet HTTP signalling returned ${response.status}`)',
  '  const answer = await response.text()',
  '  return answer',
  '}'
].join('\\n')

test('bounds HTTP offer fetch and records response and body outcomes', () => {
  const patched = patchHttpOfferDiagnosticsSource(FIXTURE)
  assert.equal(patched.changed, true)
  assert.ok(patched.source.includes('AbortSignal.timeout(requestTimeoutMs)'))
  assert.ok(patched.source.includes("phase: 'http-post-response'"))
  assert.ok(patched.source.includes("phase: 'http-post-error'"))
  assert.ok(patched.source.includes("phase: 'http-answer-read'"))
  assert.ok(patched.source.includes("phase: 'http-answer-read-error'"))
  assert.doesNotThrow(() => new vm.Script(patched.source))
})

test('upgrades the previous offer diagnostic patch and remains idempotent', () => {
  const previous = FIXTURE
    .replace(OFFER_DIAGNOSTIC_FUNCTION_ORIGINAL, OFFER_DIAGNOSTIC_FUNCTION_REPLACEMENT)
    .replace(OFFER_DIAGNOSTIC_FETCH_ORIGINAL, OFFER_DIAGNOSTIC_LOG_REPLACEMENT)
  const upgraded = patchHttpOfferDiagnosticsSource(previous)
  assert.equal(upgraded.changed, true)
  assert.ok(upgraded.source.includes('BEDROCK_BOT_CONSOLE_HTTP_FETCH_TIMEOUT_DIAG'))
  assert.ok(upgraded.source.includes('BEDROCK_BOT_CONSOLE_HTTP_ANSWER_BODY_DIAG'))
  const second = patchHttpOfferDiagnosticsSource(upgraded.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, upgraded.source)
  assert.doesNotThrow(() => new vm.Script(upgraded.source))
})
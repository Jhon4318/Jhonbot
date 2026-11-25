'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { formatBedrockChatMessage, translate } = require('../src/chat-format')

test('formats Bedrock player joined and left translation keys instead of exposing raw keys', () => {
  assert.equal(formatBedrockChatMessage({ translate: 'multiplayer.player.joined', with: [{ text: 'Steve' }] }), 'Steve がワールドに参加しました')
  assert.equal(formatBedrockChatMessage({ translate: 'multiplayer.player.left', with: [{ text: 'Alex' }] }), 'Alex がワールドから退出しました')
})

test('formats the actual prismarine-chat ChatMessage JSON shape', () => {
  const chatMessage = {
    json: { translate: 'multiplayer.player.joined', with: [{ text: 'Builder' }], extra: [{ text: '!' }] },
    translate: 'multiplayer.player.joined',
    with: [{ text: 'Builder' }],
    extra: [{ text: '!' }],
    toString: () => '%multiplayer.player.joined'
  }
  assert.equal(formatBedrockChatMessage(chatMessage), 'Builder がワールドに参加しました!')
})

test('formats normal text and common chat type translations', () => {
  assert.equal(formatBedrockChatMessage({ text: 'こんにちは', extra: [{ text: '！' }] }), 'こんにちは！')
  assert.equal(translate('chat.type.text', ['Alex', 'hello']), '<Alex> hello')
  assert.equal(translate('chat.type.announcement', ['Server', 'Restarting']), '[Server] Restarting')
})

test('unknown translation keys are converted to readable fallback text', () => {
  const result = formatBedrockChatMessage({ translate: 'server.custom.message', with: [{ text: 'world' }] })
  assert.equal(result.includes('%server.custom.message'), false)
  assert.equal(result, 'システム: server custom message: world')
  assert.equal(formatBedrockChatMessage('%multiplayer.player.left'), 'システム: multiplayer player 退出')
})

test('long messages are bounded without truncating ordinary messages', () => {
  assert.equal(formatBedrockChatMessage('hello'), 'hello')
  assert.equal(formatBedrockChatMessage('a'.repeat(1200)).length, 1000)
})

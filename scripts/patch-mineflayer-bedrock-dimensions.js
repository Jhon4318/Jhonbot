'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MARKER = 'JHONBOT_BEDROCK_DIMENSION_SYNC'
const INPUT_MODE_MARKER = 'JHONBOT_BEDROCK_PLAYER_INPUT_MODE'
const ORIGINAL_SEND = [
  '  function send () {',
  '    if (!bot.entity) return'
].join('\n')
const REPLACEMENT_SEND = [
  '  function send () {',
  '    if (bot._jhonDimensionTransition) return // ' + MARKER + ': do not send old-dimension input while BDS is switching worlds',
  '    if (bot._jhonDisablePlayerAuthInput) return // ' + INPUT_MODE_MARKER + ': chunk-hold mode does not emit periodic player input',
  '    if (bot._jhonResetInputTick) { lastEmittedTick = null; bot._jhonResetInputTick = false }',
  '    if (!bot.entity) return'
].join('\n')
const DIMENSION_GUARD = '    if (bot._jhonDimensionTransition) return // ' + MARKER + ': do not send old-dimension input while BDS is switching worlds'
const PLAYER_INPUT_GUARD = '    if (bot._jhonDisablePlayerAuthInput) return // ' + INPUT_MODE_MARKER + ': chunk-hold mode does not emit periodic player input'

const ORIGINAL_CREATIVE = "    if (bot._creativeFlying) { if (packet.tick != null) { anchorTick = toTick(packet.tick); anchorTime = Date.now() } return }"
const REPLACEMENT_CREATIVE = "    if (bot._creativeFlying && !bot._jhonDimensionTransition) { if (packet.tick != null) { anchorTick = toTick(packet.tick); anchorTime = Date.now() } return } // " + MARKER

const ORIGINAL_DRIFT = [
  '    if (drift > 0.5) {',
  '      bot.entity.position.x = pos.x',
  '      bot.entity.position.z = pos.z',
  '      if (bot.entity.velocity) { bot.entity.velocity.x = 0; bot.entity.velocity.z = 0 }',
  '    }'
].join('\n')
const REPLACEMENT_DRIFT = [
  '    if (bot._jhonDimensionTransition || drift > 0.5) { // ' + MARKER + ': a portal teleport must apply all three authoritative coordinates',
  '      bot.entity.position.x = pos.x',
  '      bot.entity.position.z = pos.z',
  '      if (bot.entity.velocity) { bot.entity.velocity.x = 0; bot.entity.velocity.z = 0 }',
  '    }'
].join('\n')

function patchClientInputSource (source) {
  let next = source
  let changed = false

  if (!next.includes(MARKER)) {
    const required = [
      [ORIGINAL_SEND, 'send() input guard'],
      [ORIGINAL_CREATIVE, 'creative-flight correction guard'],
      [ORIGINAL_DRIFT, 'authoritative X/Z correction']
    ]
    for (const [snippet, label] of required) {
      if (!next.includes(snippet)) {
        throw new Error('Pinned Mineflayer client_input.js does not match the expected ' + label + '; refusing to patch an unknown version.')
      }
    }
    next = next.replace(ORIGINAL_SEND, [
      '  function send () {',
      '    if (bot._jhonDimensionTransition) return // ' + MARKER + ': do not send old-dimension input while BDS is switching worlds',
      '    if (bot._jhonResetInputTick) { lastEmittedTick = null; bot._jhonResetInputTick = false }',
      '    if (!bot.entity) return'
    ].join('\n'))
    next = next.replace(ORIGINAL_CREATIVE, REPLACEMENT_CREATIVE)
    next = next.replace(ORIGINAL_DRIFT, REPLACEMENT_DRIFT)
    changed = true
  }

  if (!next.includes(INPUT_MODE_MARKER)) {
    if (!next.includes(DIMENSION_GUARD)) {
      throw new Error('Pinned Mineflayer client_input.js is missing the expected dimension input guard; refusing to patch an unknown version.')
    }
    next = next.replace(DIMENSION_GUARD, DIMENSION_GUARD + '\n' + PLAYER_INPUT_GUARD)
    changed = true
  }

  if (!next.includes(MARKER) || !next.includes(INPUT_MODE_MARKER)) {
    throw new Error('Bedrock input patch markers were not written.')
  }
  return { source: next, changed }
}

function applyPatch () {
  const entry = require.resolve('mineflayer')
  const clientInputPath = path.join(path.dirname(entry), 'lib', 'bedrock_plugins', 'client_input.js')
  const original = fs.readFileSync(clientInputPath, 'utf8')
  const result = patchClientInputSource(original)
  if (result.changed) fs.writeFileSync(clientInputPath, result.source, 'utf8')
  process.stdout.write(result.changed
    ? '[Jhonbot] Bedrock player input mode and dimension synchronization enabled.\n'
    : '[Jhonbot] Bedrock player input mode and dimension synchronization already enabled.\n')
  return clientInputPath
}

if (require.main === module) applyPatch()

module.exports = {
  MARKER,
  INPUT_MODE_MARKER,
  ORIGINAL_SEND,
  REPLACEMENT_SEND,
  DIMENSION_GUARD,
  PLAYER_INPUT_GUARD,
  ORIGINAL_CREATIVE,
  REPLACEMENT_CREATIVE,
  ORIGINAL_DRIFT,
  REPLACEMENT_DRIFT,
  patchClientInputSource,
  applyPatch
}

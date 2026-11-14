'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MARKER = 'JHONBOT_BEDROCK_DIMENSION_SYNC'
const ORIGINAL_SEND = [
  '  function send () {',
  '    if (!bot.entity) return'
].join('\n')
const REPLACEMENT_SEND = [
  '  function send () {',
  '    if (bot._jhonDimensionTransition) return // ' + MARKER + ': do not send old-dimension input while BDS is switching worlds',
  '    if (bot._jhonResetInputTick) { lastEmittedTick = null; bot._jhonResetInputTick = false }',
  '    if (!bot.entity) return'
].join('\n')

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
  if (source.includes(MARKER)) return { source, changed: false }
  const required = [
    [ORIGINAL_SEND, 'send() input guard'],
    [ORIGINAL_CREATIVE, 'creative-flight correction guard'],
    [ORIGINAL_DRIFT, 'authoritative X/Z correction']
  ]
  for (const [snippet, label] of required) {
    if (!source.includes(snippet)) {
      throw new Error('Pinned Mineflayer client_input.js does not match the expected ' + label + '; refusing to patch an unknown version.')
    }
  }
  let next = source.replace(ORIGINAL_SEND, REPLACEMENT_SEND)
  next = next.replace(ORIGINAL_CREATIVE, REPLACEMENT_CREATIVE)
  next = next.replace(ORIGINAL_DRIFT, REPLACEMENT_DRIFT)
  if (!next.includes(MARKER)) throw new Error('Dimension synchronization patch marker was not written.')
  return { source: next, changed: true }
}

function applyPatch () {
  const entry = require.resolve('mineflayer')
  const clientInputPath = path.join(path.dirname(entry), 'lib', 'bedrock_plugins', 'client_input.js')
  const original = fs.readFileSync(clientInputPath, 'utf8')
  const result = patchClientInputSource(original)
  if (result.changed) fs.writeFileSync(clientInputPath, result.source, 'utf8')
  process.stdout.write(result.changed
    ? '[Jhonbot] BDS dimension transition synchronization enabled.\n'
    : '[Jhonbot] BDS dimension transition synchronization already enabled.\n')
  return clientInputPath
}

if (require.main === module) applyPatch()

module.exports = {
  MARKER,
  ORIGINAL_SEND,
  REPLACEMENT_SEND,
  ORIGINAL_CREATIVE,
  REPLACEMENT_CREATIVE,
  ORIGINAL_DRIFT,
  REPLACEMENT_DRIFT,
  patchClientInputSource,
  applyPatch
}

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MARKER = 'JHONBOT_BEDROCK_CONTAINER_STACK_MERGE'
const ORIGINAL = [
  '    const moveCount = count ?? src.count',
  '    const fromBedrock = bedrockOf(src.slot)',
  '    const destSlot = firstFreeContainerSlot(w)',
  "    if (destSlot == null) throw new Error('deposit: the container is full')"
].join('\n')

const REPLACEMENT = [
  '    const requestedCount = count ?? src.count',
  '    const stackLimit = Math.max(1, Number(src.stackSize) || Number(bot.registry.items?.[src.type]?.stackSize) || 64)',
  '    const itemNbtKey = (item) => JSON.stringify(item?.nbt ?? null)',
  '    let mergeItem = null',
  '    const slots = containerSize(w)',
  '    for (let slot = 0; slot < slots; slot++) {',
  '      const candidate = w.slots[slot]',
  '      if (!candidate || candidate.type !== src.type || (candidate.metadata ?? 0) !== (src.metadata ?? 0)) continue',
  '      if (itemNbtKey(candidate) !== itemNbtKey(src) || Number(candidate.count) >= stackLimit) continue',
  '      mergeItem = candidate',
  '      break',
  '    }',
  '    const destSlot = mergeItem ? mergeItem.slot : firstFreeContainerSlot(w)',
  "    if (destSlot == null) throw new Error('deposit: the container is full')",
  '    const destItem = mergeItem || null',
  '    const capacity = destItem ? Math.max(0, stackLimit - Number(destItem.count || 0)) : stackLimit',
  '    const moveCount = Math.min(Number(requestedCount) || 0, Number(src.count) || 0, capacity)',
  "    if (!Number.isInteger(moveCount) || moveCount <= 0) throw new Error('deposit: no compatible container slot capacity')",
  '    const fromBedrock = bedrockOf(src.slot)',
  '    // ' + MARKER
].join('\n')

function patchContainerDepositSource (source) {
  if (source.includes(MARKER)) return { source, changed: false }
  if (!source.includes(ORIGINAL)) {
    throw new Error('Bedrock containers.js does not match the pinned Mineflayer source; refusing to patch an unknown version.')
  }
  let next = source.replace(ORIGINAL, REPLACEMENT)
  const destinationOriginal = "      destination: { slot_type: { container_id: 'container' }, slot: destSlot, stack_id: 0 }"
  const destinationReplacement = "      destination: { slot_type: { container_id: 'container' }, slot: destSlot, stack_id: destItem?.stackId ?? 0 }"
  if (!next.includes(destinationOriginal)) throw new Error('Container destination action changed; refusing to patch an unknown version.')
  next = next.replace(destinationOriginal, destinationReplacement)
  const returnOriginal = '    await wait(150)\n    return response'
  const returnReplacement = '    await wait(150)\n    return Object.assign({}, response, { movedCount }) // ' + MARKER
  if (!next.includes(returnOriginal)) throw new Error('Container deposit response block changed; refusing to patch an unknown version.')
  next = next.replace(returnOriginal, returnReplacement)
  return { source: next, changed: true }
}

function applyPatch () {
  const entry = require.resolve('mineflayer')
  const containersPath = path.join(path.dirname(entry), 'bedrock_plugins', 'containers.js')
  const original = fs.readFileSync(containersPath, 'utf8')
  const result = patchContainerDepositSource(original)
  if (result.changed) fs.writeFileSync(containersPath, result.source, 'utf8')
  process.stdout.write(result.changed
    ? '[Jhonbot] Bedrock container partial-stack deposit enabled.\n'
    : '[Jhonbot] Bedrock container partial-stack deposit already enabled.\n')
  return containersPath
}

if (require.main === module) applyPatch()

module.exports = { MARKER, ORIGINAL, REPLACEMENT, patchContainerDepositSource, applyPatch }

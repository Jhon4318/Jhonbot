'use strict'

const SPAWN_SEARCH_Y = 32766

function finitePosition (position) {
  return !!position &&
    Number.isFinite(Number(position.x)) &&
    Number.isFinite(Number(position.y)) &&
    Number.isFinite(Number(position.z))
}

function isSpawnSearchPosition (position) {
  return !finitePosition(position) || Number(position.y) >= SPAWN_SEARCH_Y
}

function sameRuntimeId (received, own) {
  if (received === undefined || received === null || own === undefined || own === null) return true
  try {
    return BigInt(received) === BigInt(own)
  } catch {
    return String(received) === String(own)
  }
}

function setEntityPosition (entity, position) {
  if (!entity?.position || !finitePosition(position)) return false
  if (typeof entity.position.set === 'function') {
    entity.position.set(Number(position.x), Number(position.y), Number(position.z))
  } else {
    entity.position.x = Number(position.x)
    entity.position.y = Number(position.y)
    entity.position.z = Number(position.z)
  }
  return true
}

function resetVelocity (entity) {
  if (!entity?.velocity) return
  if (typeof entity.velocity.set === 'function') entity.velocity.set(0, 0, 0)
  else {
    entity.velocity.x = 0
    entity.velocity.y = 0
    entity.velocity.z = 0
  }
}

function writePacket (client, name, params) {
  if (typeof client?.queue === 'function') return client.queue(name, params)
  if (typeof client?.write === 'function') return client.write(name, params)
  throw new Error('Bedrockクライアントにパケット送信APIがありません。')
}

/**
 * Complete the Bedrock dimension-change handshake used by BDS.
 *
 * BDS sends change_dimension, waits for dimension_change_ack, then sends
 * player_action dimension_change_ack when the new dimension is ready. Only
 * after that reply do we send the matching loading-screen start/end packets.
 * Portal transfers may carry a temporary spawn-search Y (32767); in that case
 * movement input stays suspended until a real move/correction arrives.
 */
function installBedrockDimensionSync (bot, options = {}) {
  if (!bot || !bot._client || typeof bot._client.on !== 'function') {
    throw new TypeError('Mineflayer BotとBedrockクライアントが必要です。')
  }
  if (bot._jhonDimensionSync) return bot._jhonDimensionSync

  const client = bot._client
  const state = {
    active: false,
    dimension: null,
    loadingScreenId: undefined,
    serverAcknowledged: false,
    positionResolved: false,
    disposed: false,
    transitions: 0
  }

  const ownRuntimeId = () => client.entityId ?? client.startGameData?.runtime_entity_id ?? 0n
  const notify = (callback, payload) => {
    try { callback?.(payload) } catch (error) {
      try { options.onError?.(error) } catch {}
    }
  }

  function beginDimensionChange (packet) {
    if (state.disposed || !packet || packet.dimension === undefined || !finitePosition(packet.position)) return

    state.active = true
    state.dimension = packet.dimension
    state.loadingScreenId = packet.loading_screen_id
    state.serverAcknowledged = false
    state.positionResolved = !isSpawnSearchPosition(packet.position)
    state.transitions++
    bot._jhonDimensionTransition = true
    bot._jhonResetInputTick = false

    try { bot.clearControlStates?.() } catch {}
    try { bot.pathfinder?.setGoal?.(null) } catch {}
    try { bot.pathfinder?.stop?.() } catch {}
    resetVelocity(bot.entity)

    if (state.positionResolved && setEntityPosition(bot.entity, packet.position)) {
      bot.emit('move', bot.entity.position)
    }

    notify(options.onStart, {
      dimension: state.dimension,
      position: { x: packet.position.x, y: packet.position.y, z: packet.position.z },
      loadingScreenId: state.loadingScreenId,
      positionPending: !state.positionResolved
    })

    writePacket(client, 'player_action', {
      runtime_entity_id: ownRuntimeId(),
      action: 'dimension_change_ack',
      position: { x: 0, y: 0, z: 0 },
      result_position: { x: 0, y: 0, z: 0 },
      face: 0
    })
  }

  function observeAuthoritativePosition (position) {
    if (!state.active || state.positionResolved || isSpawnSearchPosition(position)) return
    state.positionResolved = true
    resetVelocity(bot.entity)
    tryCompleteDimensionChange()
  }

  function onServerDimensionAck (packet) {
    if (!state.active || packet?.action !== 'dimension_change_ack') return
    if (!sameRuntimeId(packet.runtime_entity_id, ownRuntimeId())) return
    state.serverAcknowledged = true
    tryCompleteDimensionChange()
  }

  function tryCompleteDimensionChange () {
    if (!state.active || !state.serverAcknowledged || !state.positionResolved) return false

    const completed = {
      dimension: state.dimension,
      loadingScreenId: state.loadingScreenId,
      transition: state.transitions
    }

    if (state.loadingScreenId !== undefined && state.loadingScreenId !== null) {
      writePacket(client, 'serverbound_loading_screen', {
        type: 1,
        loading_screen_id: state.loadingScreenId
      })
      writePacket(client, 'serverbound_loading_screen', {
        type: 2,
        loading_screen_id: state.loadingScreenId
      })
    }

    state.active = false
    state.loadingScreenId = undefined
    state.serverAcknowledged = false
    state.positionResolved = false
    bot._jhonDimensionTransition = false
    // The input plugin uses the previous emitted tick to calculate physics steps.
    // A dimension teleport invalidates that local frame; restart from the latest
    // server tick rather than simulating the old dimension's accumulated motion.
    bot._jhonResetInputTick = true
    resetVelocity(bot.entity)
    notify(options.onComplete, completed)
    return true
  }

  function onShowCredits (packet) {
    if (packet?.status !== 0) return
    if (!sameRuntimeId(packet.runtime_entity_id, ownRuntimeId())) return
    writePacket(client, 'show_credits', {
      runtime_entity_id: ownRuntimeId(),
      status: 1
    })
  }

  function dispose () {
    if (state.disposed) return
    state.disposed = true
    state.active = false
    bot._jhonDimensionTransition = false
    bot._jhonResetInputTick = false
    client.removeListener('change_dimension', beginDimensionChange)
    client.removeListener('player_action', onServerDimensionAck)
    client.removeListener('show_credits', onShowCredits)
    bot.removeListener('move', observeAuthoritativePosition)
    bot.removeListener('forcedMove', observeAuthoritativePosition)
    client.removeListener('close', dispose)
    if (bot._jhonDimensionSync === api) delete bot._jhonDimensionSync
  }

  const api = { state, dispose, tryCompleteDimensionChange }
  bot._jhonDimensionSync = api
  client.on('change_dimension', beginDimensionChange)
  client.on('player_action', onServerDimensionAck)
  client.on('show_credits', onShowCredits)
  bot.on('move', observeAuthoritativePosition)
  bot.on('forcedMove', observeAuthoritativePosition)
  client.once('close', dispose)
  return api
}

module.exports = {
  SPAWN_SEARCH_Y,
  finitePosition,
  isSpawnSearchPosition,
  sameRuntimeId,
  installBedrockDimensionSync
}

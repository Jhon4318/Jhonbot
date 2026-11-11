'use strict'

const { createRequire } = require('node:module')
const bedrockRequire = createRequire(require.resolve('bedrock-protocol'))
const { Client } = bedrockRequire('nethernet')
const { NethernetServerAdvertisement } = bedrockRequire('./src/nethernet/advertisement')

async function discoverLanWorlds (timeoutMs = 6000) {
  const duration = Math.max(1000, Math.min(15000, Number(timeoutMs) || 6000))
  const client = new Client(0n, '255.255.255.255', { webrtcBackend: 'werift' })
  const worlds = new Map()

  return new Promise((resolve, reject) => {
    let finished = false
    const timer = setTimeout(finish, duration)

    function finish (error = null) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try { client.close('LAN discovery complete') } catch {}
      if (error) reject(error)
      else resolve([...worlds.values()].sort((a, b) => a.worldName.localeCompare(b.worldName, 'ja')))
    }

    client.on('error', error => finish(error))
    client.on('pong', response => {
      try {
        const networkId = String(response?.sender_id ?? '')
        if (!/^\\d{1,20}$/.test(networkId)) return
        const raw = Buffer.from(String(response?.data || ''), 'hex')
        if (!raw.length) return
        const advertisement = NethernetServerAdvertisement.fromBuffer(raw)
        worlds.set(networkId, {
          type: 'lan-world',
          networkId,
          worldName: String(advertisement.levelName || advertisement.motd || 'LANワールド'),
          hostName: String(advertisement.motd || ''),
          gameVersion: String(advertisement.gameVersion || ''),
          playerCount: Number.isInteger(advertisement.playerCount) ? advertisement.playerCount : null,
          maxPlayers: Number.isInteger(advertisement.playersMax) ? advertisement.playersMax : null
        })
      } catch {
        // Ignore malformed or incompatible advertisements; other worlds may still respond.
      }
    })
  })
}

module.exports = { discoverLanWorlds }

'use strict'

function clean (value) {
  if (value == null) return ''
  return String(value).trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

function firstValue (...values) {
  for (const value of values) {
    const normalized = clean(value)
    if (normalized) return normalized
  }
  return ''
}

function buildFriendWorldIdentity (session) {
  if (!session || typeof session !== 'object') return null
  const properties = session.customProperties || {}
  const reference = session.sessionRef || {}
  const identity = {
    worldId: firstValue(properties.worldId, properties.worldUuid, reference.worldId, reference.worldUuid),
    ownerId: firstValue(properties.ownerXuid, properties.ownerId, properties.hostXuid, properties.creatorId, reference.ownerXuid, reference.ownerId),
    worldName: firstValue(properties.worldName, session.worldName, reference.worldName),
    hostName: firstValue(properties.hostName, session.hostName, properties.ownerName, reference.hostName),
    templateName: firstValue(reference.templateName, properties.templateName)
  }
  if (!identity.worldId && !identity.ownerId && !identity.worldName && !identity.hostName && !identity.templateName) return null
  return identity
}

function findMatchingFriendWorldSession (sessions, savedIdentity) {
  if (!Array.isArray(sessions) || !savedIdentity || typeof savedIdentity !== 'object') return null
  const saved = savedIdentity
  const scored = sessions.map((session, index) => {
    const current = buildFriendWorldIdentity(session)
    if (!current) return { session, index, score: 0, matched: false }
    let score = 0
    if (saved.worldId && current.worldId === saved.worldId) score += 100
    if (saved.ownerId && current.ownerId === saved.ownerId) score += 30
    if (saved.worldName && current.worldName === saved.worldName) score += 20
    if (saved.hostName && current.hostName === saved.hostName) score += 15
    if (saved.templateName && current.templateName === saved.templateName) score += 5
    const matched = (saved.worldId && current.worldId === saved.worldId) ||
      (saved.worldName && current.worldName === saved.worldName &&
        (!saved.ownerId || !current.ownerId || current.ownerId === saved.ownerId) &&
        (!saved.hostName || !current.hostName || current.hostName === saved.hostName))
    return { session, index, score, matched: !!matched }
  }).filter(item => item.matched && item.score > 0)
  if (!scored.length) return null
  scored.sort((a, b) => b.score - a.score)
  if (scored.length > 1 && scored[0].score === scored[1].score) return null
  return { session: scored[0].session, index: scored[0].index, identity: buildFriendWorldIdentity(scored[0].session) }
}

module.exports = { buildFriendWorldIdentity, findMatchingFriendWorldSession }

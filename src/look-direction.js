'use strict'

function normalizeLookDirection (input = {}) {
  const readAngle = (value, name, min, max) => {
    if (value === '' || value === null || value === undefined) throw new Error(name + 'を入力してください。')
    const number = Number(value)
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new Error(name + 'は' + min + '〜' + max + '度で指定してください。')
    }
    return Math.round(number * 100) / 100
  }
  return {
    yawDeg: readAngle(input.yawDeg, 'Yaw（水平角）', -180, 180),
    pitchDeg: readAngle(input.pitchDeg, 'Pitch（上下角）', -90, 90)
  }
}

function toMineflayerLookRadians (direction) {
  return {
    yaw: direction.yawDeg * Math.PI / 180,
    pitch: direction.pitchDeg * Math.PI / 180
  }
}

async function applyLookDirection (agent, input) {
  if (!agent || typeof agent.look !== 'function') throw new Error('Botの視点変更APIを利用できません。')
  const direction = normalizeLookDirection(input)
  const radians = toMineflayerLookRadians(direction)
  await agent.look(radians.yaw, radians.pitch, true)
  return direction
}

module.exports = { normalizeLookDirection, toMineflayerLookRadians, applyLookDirection }

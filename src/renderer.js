'use strict'

const api = window.botApp
const botList = document.getElementById('botList')
const emptyState = document.getElementById('emptyState')
const logList = document.getElementById('logList')
const form = document.getElementById('addBotForm')
const serverProfileList = document.getElementById('serverProfileList')
const serverForm = document.getElementById('serverForm')
const authDialog = document.getElementById('authDialog')
const authCode = document.getElementById('authCode')
const authBotLabel = document.getElementById('authBotLabel')
const openAuthButton = document.getElementById('openAuthButton')
const toast = document.getElementById('toast')
const controlBotSelect = document.getElementById('controlBotSelect')
const selectedBotInfo = document.getElementById('selectedBotInfo')
const movementStatus = document.getElementById('movementStatus')
const pathfinderNote = document.getElementById('pathfinderNote')
const gotoForm = document.getElementById('gotoForm')
const worldDialog = document.getElementById('worldDialog')
const worldChoices = document.getElementById('worldChoices')
const serverKeyDialog = document.getElementById('serverKeyDialog')

const state = { bots: new Map(), servers: [], authUrl: '', toastTimer: null, selectedBotId: '', heldInputs: new Map(), pendingWorldRequestId: '', pendingServerKeyRequestId: '' }
const statusLabels = {
  disconnected: '未参加',
  authenticating: '認証処理中',
  connecting: '接続中',
  joining: 'ログイン中',
  connected: 'ワールド参加中',
  error: 'エラー'
}
const accountStatusLabels = {
  unverified: 'Xbox未認証',
  saved: '認証情報保存済み・再確認待ち',
  authenticating: 'Xbox認証中',
  authenticated: 'Xbox認証済み',
  error: 'Xbox認証エラー'
}
const keyControls = {
  KeyW: 'forward',
  KeyA: 'left',
  KeyS: 'back',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint'
}

function showToast (message) {
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000)
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const detail = reason instanceof Error ? reason.message : (typeof reason === 'string' ? reason : '詳細不明の非同期エラー')
  console.error('Unhandled renderer promise rejection:', reason)
  showToast(`画面側の非同期エラー: ${detail}`)
  event.preventDefault()
})

function createElement (tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function selectedBot () {
  return state.bots.get(state.selectedBotId) || null
}

function positionText (bot) {
  if (!bot?.position) return '位置情報待ち'
  const p = bot.position
  return `X ${p.x}  /  Y ${p.y}  /  Z ${p.z}`
}

function appendLog (entry) {
  const empty = logList.querySelector('.log-empty')
  if (empty) empty.remove()
  const row = createElement('div', `log-entry ${entry.level || 'info'}`)
  const time = new Date(entry.at).toLocaleTimeString('ja-JP', { hour12: false })
  row.append(createElement('span', 'log-time', time), createElement('span', 'log-message', entry.message))
  logList.append(row)
  while (logList.children.length > 300) logList.firstElementChild.remove()
  logList.scrollTop = logList.scrollHeight
}

function renderControlPanel () {
  const values = Array.from(state.bots.values())
  if (!values.some(bot => bot.id === state.selectedBotId)) state.selectedBotId = values[0]?.id || ''

  const previous = controlBotSelect.value
  const optionsChanged = controlBotSelect.options.length !== values.length + (values.length ? 0 : 1)
  if (optionsChanged || previous !== state.selectedBotId) {
    controlBotSelect.replaceChildren()
    if (!values.length) {
      controlBotSelect.append(new Option('Botを追加してください', ''))
    } else {
      for (const bot of values) controlBotSelect.append(new Option(`${bot.label} (${statusLabels[bot.status] || bot.status})`, bot.id))
    }
  } else {
    for (const option of controlBotSelect.options) {
      const bot = state.bots.get(option.value)
      if (bot) option.textContent = `${bot.label} (${statusLabels[bot.status] || bot.status})`
    }
  }
  controlBotSelect.value = state.selectedBotId
  controlBotSelect.disabled = values.length === 0

  const bot = selectedBot()
  const connected = !!bot && bot.status === 'connected'
  selectedBotInfo.textContent = bot
    ? `${positionText(bot)}${bot.health != null ? `  ·  HP ${bot.health}` : ''}${bot.food != null ? `  ·  満腹度 ${bot.food}` : ''}`
    : 'Botを選択すると位置と状態が表示されます。'
  movementStatus.textContent = bot ? bot.movementStatus || '停止中' : '操作待機中'

  const diag = {
    startGame: document.getElementById('diagStartGame'),
    authority: document.getElementById('diagMovementAuthority'),
    corrections: document.getElementById('diagCorrections'),
    chunks: document.getElementById('diagChunks'),
    world: document.getElementById('diagWorldColumns'),
    pathfinder: document.getElementById('diagPathfinder'),
    hint: document.getElementById('diagnosticHint')
  }
  if (!bot) {
    diag.startGame.textContent = '未受信'
    diag.authority.textContent = '未確認'
    diag.corrections.textContent = '0'
    diag.chunks.textContent = '0 / 0'
    diag.world.textContent = '0チャンク'
    diag.pathfinder.textContent = '未準備'
    diag.hint.textContent = 'Botを接続すると、1.26.60の移動・地形データの受信状況を表示します。'
  } else {
    diag.startGame.textContent = bot.startGameReceived ? '受信済み' : '未受信'
    diag.authority.textContent = bot.movementAuthority || '未確認'
    diag.corrections.textContent = String(bot.correctionPackets || 0)
    diag.chunks.textContent = `${bot.levelChunkPackets || 0} / ${bot.subchunkPackets || 0}`
    diag.world.textContent = `${bot.worldColumnsLoaded || 0}チャンク`
    diag.pathfinder.textContent = bot.pathfinderReady ? '準備完了' : '未準備'
    if (bot.status !== 'connected') {
      diag.hint.textContent = 'ワールド参加後に診断値が更新されます。'
    } else if (!bot.startGameReceived) {
      diag.hint.textContent = 'StartGameパケットを待っています。接続ログを確認してください。'
    } else if (!bot.worldSupport) {
      diag.hint.textContent = `地形データ解析が無効です: ${bot.worldSupportReason || 'チャンク形式を確認中'}`
    } else if ((bot.correctionPackets || 0) === 0) {
      diag.hint.textContent = '位置補正パケットがまだ届いていません。安全な場所で短く前進して確認してください。'
    } else {
      diag.hint.textContent = `サーバーから位置補正を受信しています。最終tick: ${bot.lastServerTick || '不明'}`
    }
  }

  if (!bot) {
    pathfinderNote.textContent = 'Botを追加してワールドに参加させてください。'
  } else if (!connected) {
    pathfinderNote.textContent = 'Botがワールドに参加すると移動操作が有効になります。'
  } else if (bot.pathfinderReady && bot.worldSupport) {
    pathfinderNote.textContent = '地形データを読み込みました。座標移動できます。ブロックの採掘・設置は行いません。'
  } else if (!bot.worldSupport && bot.worldSupportReason) {
    pathfinderNote.textContent = `地形データ解析が利用できません: ${bot.worldSupportReason}`
  } else {
    pathfinderNote.textContent = '周囲のチャンクを読み込み中です。座標移動は地形情報の準備後に利用できます。'
  }

  for (const button of document.querySelectorAll('[data-control], #stopMovementButton, #clearControlsButton')) {
    button.disabled = !connected
  }
  for (const input of gotoForm.querySelectorAll('input, button')) input.disabled = !connected || !bot.pathfinderReady || !bot.worldSupport
}

function renderServerProfiles () {
  serverProfileList.replaceChildren()
  if (!state.servers.length) {
    serverProfileList.append(createElement('div', 'server-empty', '接続先はまだ登録されていません。上のフォームまたはThe Hiveプリセットから追加してください。'))
    return
  }
  for (const server of state.servers) {
    const row = createElement('div', 'server-profile-row')
    const info = createElement('div', 'server-profile-info')
    info.append(
      createElement('strong', 'server-profile-name', server.label),
      createElement('span', 'server-profile-address', `${server.host}:${server.port} · ${server.mode === 'http' ? 'NetherNet HTTP' : (server.mode === 'raknet' ? 'RakNet' : '自動判定')}`)
    )
    const remove = createElement('button', 'icon-button danger', '削除')
    remove.type = 'button'
    remove.addEventListener('click', async () => {
      try { await api.removeServer(server.id) } catch (error) { showToast(error.message || '接続先を削除できませんでした。') }
    })
    row.append(info, remove)
    serverProfileList.append(row)
  }
}

function renderBots () {
  botList.replaceChildren()
  const values = Array.from(state.bots.values())
  emptyState.hidden = values.length > 0
  document.getElementById('botCount').textContent = String(values.length)
  document.getElementById('onlineCount').textContent = String(values.filter(bot => bot.status === 'connected').length)
  document.getElementById('botListLabel').textContent = `${values.length} BOTS`

  for (const bot of values) {
    const card = createElement('article', 'bot-card')
    const main = createElement('div', 'bot-main')
    const avatar = createElement('div', 'bot-avatar', bot.label.slice(0, 1).toUpperCase())
    const info = createElement('div')
    info.append(createElement('div', 'bot-name', bot.label))
    const accountDescription = bot.playerName
      ? `Xbox: ${bot.playerName}`
      : (bot.accountStatus === 'authenticated' ? 'Microsoft / Xboxアカウント認証済み' : (bot.accountStatus === 'saved' ? '保存済み認証情報あり・再確認が必要' : 'Microsoft / Xboxアカウント未確認'))
    info.append(createElement('div', 'bot-player', accountDescription))
    main.append(avatar, info)

    const targetArea = createElement('div', 'bot-target-area')
    const targetLabel = createElement('div', 'target-current', bot.targetLabel || '参加先未設定')
    const targetSelect = createElement('select', 'bot-target-select')
    targetSelect.append(new Option('参加先を選択…', ''))
    targetSelect.append(new Option('フレンドのワールド（参加時に一覧表示）', 'friend-world'))
    targetSelect.append(new Option('LANワールド（検索して選択）', 'lan-world'))
    for (const server of state.servers) targetSelect.append(new Option(`サーバー：${server.label}`, `server:${server.id}`))
    const currentTarget = bot.targetType === 'server' ? `server:${bot.targetId}` : (bot.targetType || '')
    targetSelect.value = currentTarget
    const worldBusy = bot.status === 'connected' || ['connecting', 'joining'].includes(bot.status)
    targetSelect.disabled = worldBusy
    targetSelect.addEventListener('change', async () => {
      let target
      if (targetSelect.value.startsWith('server:')) target = { type: 'server', serverId: targetSelect.value.slice(7) }
      else target = { type: targetSelect.value || 'none' }
      try {
        const updated = await api.setBotTarget({ botId: bot.id, target })
        state.bots.set(bot.id, updated)
        renderBots()
      } catch (error) { showToast(error.message || '参加先を設定できませんでした。'); renderBots() }
    })
    targetArea.append(targetSelect, targetLabel)
    if (bot.targetType === 'lan-world') {
      const scan = createElement('button', 'small-button lan-search-button', 'LAN検索')
      scan.type = 'button'
      scan.disabled = worldBusy
      scan.addEventListener('click', async () => {
        scan.disabled = true
        scan.textContent = '検索中…'
        try {
          const result = await api.discoverLanWorld(bot.id)
          const updated = await api.setBotTarget({ botId: bot.id, target: result })
          state.bots.set(bot.id, updated)
          showToast(`LANワールド「${result.worldName}」を選択しました。`)
          renderBots()
        } catch (error) {
          showToast(error.message || 'LANワールドを検索できませんでした。')
          scan.disabled = false
          scan.textContent = '再検索'
        }
      })
      targetArea.append(scan)
    }

    const statuses = createElement('div', 'bot-status-stack')
    statuses.append(
      createElement('span', `status account-status ${bot.accountStatus || 'unverified'}`, accountStatusLabels[bot.accountStatus] || 'Xbox未確認'),
      createElement('span', `status ${bot.status}`, statusLabels[bot.status] || bot.status)
    )

    const actions = createElement('div', 'bot-actions')
    const authBusy = bot.accountStatus === 'authenticating'
    const authButton = createElement('button', 'small-button account-button', authBusy ? '認証中…' : (['authenticated', 'saved'].includes(bot.accountStatus) ? '認証を再確認' : 'アカウント認証'))
    authButton.type = 'button'
    authButton.disabled = authBusy || worldBusy
    authButton.addEventListener('click', () => api.authenticateBot(bot.id).catch(error => showToast(error.message || 'アカウント認証に失敗しました。')))
    actions.append(authButton)

    if (worldBusy) {
      const disconnect = createElement('button', 'small-button join-button', 'ワールド切断')
      disconnect.type = 'button'
      disconnect.addEventListener('click', () => api.disconnectBot(bot.id).catch(error => showToast(error.message)))
      actions.append(disconnect)
    } else {
      const join = createElement('button', 'small-button join-button', bot.status === 'error' ? '再参加' : 'ワールド参加')
      const hasTarget = bot.targetType === 'server' || bot.targetType === 'friend-world' || (bot.targetType === 'lan-world' && !!bot.networkId)
      join.type = 'button'
      join.disabled = bot.accountStatus !== 'authenticated' || !hasTarget
      join.title = !hasTarget ? '先に参加先を選択してください。' : (bot.accountStatus !== 'authenticated' ? '先にMicrosoft / Xbox認証を完了してください。' : '選択したサーバーまたはワールドに参加します。')
      join.addEventListener('click', () => api.connectBot(bot.id).catch(error => showToast(error.message || 'ワールドに参加できませんでした。')))
      actions.append(join)
    }
    const remove = createElement('button', 'icon-button danger', '削除')
    remove.type = 'button'
    remove.disabled = authBusy || worldBusy
    remove.addEventListener('click', async () => {
      if (!window.confirm(`${bot.label}を一覧から削除しますか？`)) return
      if (state.selectedBotId === bot.id) releaseAllHeldInputs()
      try { await api.removeBot(bot.id) } catch (error) { showToast(error.message) }
    })
    actions.append(remove)

    const serverInfo = createElement('div', 'bot-server-info')
    serverInfo.append(createElement('div', 'bot-position', positionText(bot)))
    card.append(main, targetArea, statuses, actions, serverInfo)
    if (bot.accountError || bot.lastError) card.title = [bot.accountError, bot.lastError].filter(Boolean).join('\n')
    botList.append(card)
  }
  renderControlPanel()
}

async function startControl (source, botId, control) {
  if (state.heldInputs.has(source)) return
  if (!botId) return showToast('操作するBotを選択してください。')
  state.heldInputs.set(source, { botId, control })
  try {
    await api.controlBot({ botId, control, active: true })
  } catch (error) {
    state.heldInputs.delete(source)
    showToast(error.message || '移動操作を開始できませんでした。')
  }
}

async function endControl (source) {
  const held = state.heldInputs.get(source)
  if (!held) return
  state.heldInputs.delete(source)
  try { await api.controlBot({ botId: held.botId, control: held.control, active: false }) } catch (error) {
    if (!String(error.message).includes('ワールドに参加していません')) showToast(error.message)
  }
}

function releaseAllHeldInputs () {
  for (const source of Array.from(state.heldInputs.keys())) endControl(source)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const submit = form.querySelector('button[type="submit"]')
  submit.disabled = true
  try {
    const bot = await api.addBot({ label: document.getElementById('botLabel').value })
    state.bots.set(bot.id, bot)
    if (!state.selectedBotId) state.selectedBotId = bot.id
    renderBots()
    document.getElementById('botLabel').value = ''
    showToast('Botを追加しました。次にアカウント認証を行い、参加先を選択してください。')
  } catch (error) {
    showToast(error.message || 'Botを追加できませんでした。')
  } finally {
    submit.disabled = false
  }
})

serverForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const submit = serverForm.querySelector('button[type="submit"]')
  submit.disabled = true
  try {
    const profile = await api.addServer({
      label: document.getElementById('serverLabel').value,
      host: document.getElementById('serverHost').value,
      port: document.getElementById('serverPort').value,
      mode: document.getElementById('serverMode').value
    })
    if (!state.servers.some(item => item.id === profile.id)) state.servers.push(profile)
    renderServerProfiles()
    renderBots()
    document.getElementById('serverLabel').value = ''
    document.getElementById('serverHost').value = ''
    document.getElementById('serverPort').value = '19132'
    showToast(`接続先「${profile.label}」を登録しました。各Botの参加先から選べます。`)
  } catch (error) {
    showToast(error.message || '接続先を登録できませんでした。')
  } finally {
    submit.disabled = false
  }
})

document.getElementById('addHivePresetButton').addEventListener('click', async () => {
  try {
    const profile = await api.addHivePreset()
    if (!state.servers.some(item => item.id === profile.id)) state.servers.push(profile)
    renderServerProfiles()
    renderBots()
    showToast('The Hive（アジア）を登録しました。')
  } catch (error) { showToast(error.message || 'The Hiveを登録できませんでした。') }
})

controlBotSelect.addEventListener('change', () => {
  releaseAllHeldInputs()
  state.selectedBotId = controlBotSelect.value
  renderControlPanel()
})

for (const button of document.querySelectorAll('.move-key[data-control], .action-key[data-control]')) {
  const control = button.dataset.control
  let source = null
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    if (source) return
    source = `pointer:${event.pointerId}`
    button.setPointerCapture?.(event.pointerId)
    button.classList.add('pressed')
    startControl(source, state.selectedBotId, control)
  })
  const release = () => {
    if (!source) return
    const oldSource = source
    source = null
    button.classList.remove('pressed')
    endControl(oldSource)
  }
  button.addEventListener('pointerup', release)
  button.addEventListener('pointercancel', release)
  button.addEventListener('lostpointercapture', release)
}

async function stopSelectedBot () {
  releaseAllHeldInputs()
  const bot = selectedBot()
  if (!bot) return showToast('操作するBotを選択してください。')
  try { await api.stopBot(bot.id) } catch (error) { showToast(error.message) }
}
document.getElementById('stopMovementButton').addEventListener('click', stopSelectedBot)
document.getElementById('clearControlsButton').addEventListener('click', stopSelectedBot)

window.addEventListener('keydown', (event) => {
  const control = keyControls[event.code]
  if (!control || event.repeat) return
  const target = event.target
  if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
  event.preventDefault()
  startControl(`key:${event.code}`, state.selectedBotId, control)
})
window.addEventListener('keyup', (event) => {
  if (!keyControls[event.code]) return
  event.preventDefault()
  endControl(`key:${event.code}`)
})
window.addEventListener('blur', releaseAllHeldInputs)

// If a key was held while switching away from the app, release it when focus returns.
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllHeldInputs() })

gotoForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const bot = selectedBot()
  if (!bot) return showToast('操作するBotを選択してください。')
  releaseAllHeldInputs()
  const coordinates = {
    x: document.getElementById('gotoX').value,
    y: document.getElementById('gotoY').value,
    z: document.getElementById('gotoZ').value
  }
  try {
    await api.gotoBot({ botId: bot.id, coordinates })
    showToast('座標への移動を開始しました。')
  } catch (error) {
    showToast(error.message || '座標移動を開始できませんでした。')
  }
})

document.getElementById('copyCodeButton').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(authCode.textContent)
    showToast('認証コードをコピーしました。')
  } catch { showToast('コピーできませんでした。コードを選択してコピーしてください。') }
})

openAuthButton.addEventListener('click', async () => {
  try { await api.openAuthUrl(state.authUrl) } catch (error) { showToast(error.message) }
})
document.getElementById('closeAuthButton').addEventListener('click', () => authDialog.close())

function finishWorldSelection (requestId, sessionIndex) {
  if (!requestId) return
  api.selectWorldSession({ requestId, sessionIndex }).then(() => {
    state.pendingWorldRequestId = ''
    worldDialog.close()
  }).catch(error => showToast(error.message || 'ワールドを選択できませんでした。'))
}

document.getElementById('cancelWorldSelectionButton').addEventListener('click', () => {
  if (state.pendingWorldRequestId) api.cancelWorldSelection(state.pendingWorldRequestId).catch(() => {})
  state.pendingWorldRequestId = ''
  worldDialog.close()
})

document.getElementById('approveServerKeyButton').addEventListener('click', async () => {
  if (!state.pendingServerKeyRequestId) return
  const requestId = state.pendingServerKeyRequestId
  state.pendingServerKeyRequestId = ''
  try { await api.resolveServerKey({ requestId, approved: true }); serverKeyDialog.close() } catch (error) { showToast(error.message); serverKeyDialog.close() }
})
document.getElementById('denyServerKeyButton').addEventListener('click', async () => {
  if (!state.pendingServerKeyRequestId) return serverKeyDialog.close()
  const requestId = state.pendingServerKeyRequestId
  state.pendingServerKeyRequestId = ''
  try { await api.resolveServerKey({ requestId, approved: false }) } catch {}
  serverKeyDialog.close()
})
worldDialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  document.getElementById('cancelWorldSelectionButton').click()
})
serverKeyDialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  document.getElementById('denyServerKeyButton').click()
})

api.onBotUpdated((bot) => {
  state.bots.set(bot.id, bot)
  renderBots()
})
api.onBotRemoved((botId) => {
  state.bots.delete(botId)
  if (state.selectedBotId === botId) state.selectedBotId = ''
  renderBots()
})
api.onLog(appendLog)
api.onServersUpdated((servers) => {
  state.servers = Array.isArray(servers) ? servers : []
  renderServerProfiles()
  renderBots()
})
api.onWorldSessions((info) => {
  state.pendingWorldRequestId = info.requestId
  document.getElementById('worldDialogTitle').textContent = `${info.botLabel}：参加するワールドを選択`
  document.getElementById('worldDialogDescription').textContent = 'Xboxアカウントから取得した参加可能なワールドです。'
  worldChoices.replaceChildren()
  for (const session of info.sessions || []) {
    const button = createElement('button', 'world-choice-button')
    button.type = 'button'
    button.append(createElement('strong', '', session.label), createElement('span', '', session.details || ''))
    button.addEventListener('click', () => finishWorldSelection(info.requestId, Number(session.id)))
    worldChoices.append(button)
  }
  if (!info.sessions?.length) worldChoices.append(createElement('div', 'server-empty', '参加可能なワールドが見つかりませんでした。'))
  if (!worldDialog.open) worldDialog.showModal()
})
api.onServerKeyApproval((info) => {
  state.pendingServerKeyRequestId = info.requestId
  document.getElementById('serverKeyOrigin').textContent = info.origin
  document.getElementById('serverKeyFingerprint').textContent = info.fingerprint
  if (!serverKeyDialog.open) serverKeyDialog.showModal()
})
api.onAuthCode((info) => {
  state.authUrl = info.verificationUri
  authCode.textContent = info.userCode || 'コードを確認してください'
  authBotLabel.textContent = `${info.botLabel} の認証`
  document.getElementById('authDescription').textContent = info.message || '表示されたコードをMicrosoftの認証ページに入力してください。認証中はワールドへ参加しません。'
  if (!authDialog.open) authDialog.showModal()
})

async function initialise () {
  const initial = await api.getState()
  document.getElementById('versionText').textContent = initial.version
  state.servers = initial.servers || []
  for (const bot of initial.bots) state.bots.set(bot.id, bot)
  for (const entry of initial.logs) appendLog(entry)
  if (!initial.logs.length) logList.append(createElement('div', 'log-empty', 'ログはまだありません。Botを認証・参加させるとここに表示されます。'))
  renderServerProfiles()
  renderBots()
}

initialise().catch(error => showToast(`初期化エラー: ${error.message}`))

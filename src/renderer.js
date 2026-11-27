'use strict'

const bridgeMissing = !window.botApp
const api = window.botApp || new Proxy({}, {
  get (_target, property) {
    if (property === 'then') return undefined
    if (String(property).startsWith('on')) return () => {}
    return () => Promise.reject(new Error('Electronの画面連携機能を読み込めませんでした。アプリを終了せず、診断ログを確認してください。'))
  }
})
const botList = document.getElementById('botList')
const emptyState = document.getElementById('emptyState')
const logList = document.getElementById('logList')
const form = document.getElementById('addBotForm')
const serverProfileList = document.getElementById('serverProfileList')
const serverProfileFooter = document.getElementById('serverProfileFooter')
const botListFooter = document.getElementById('botListFooter')
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
const guestNameDialog = document.getElementById('guestNameDialog')
const guestNameForm = document.getElementById('guestNameForm')
const guestBotNameInput = document.getElementById('guestBotNameInput')
const guestNameHint = document.getElementById('guestNameHint')
const guestNameError = document.getElementById('guestNameError')
const guestNameSubmitButton = document.getElementById('submitGuestNameButton')
const serverKeyDialog = document.getElementById('serverKeyDialog')
const chatMessages = document.getElementById('chatMessages')
const chatForm = document.getElementById('chatForm')
const chatInput = document.getElementById('chatInput')
const sendChatButton = document.getElementById('sendChatButton')
const inventoryList = document.getElementById('inventoryList')
const inventoryStatus = document.getElementById('inventoryStatus')
const inventorySelect = document.getElementById('inventorySelect')
const dropItemCount = document.getElementById('dropItemCount')
const dropAllItemsButton = document.getElementById('dropAllItemsButton')
const dropItemForm = document.getElementById('dropItemForm')
const refreshInventoryButton = document.getElementById('refreshInventoryButton')
const openInventoryDialogButton = document.getElementById('openInventoryDialogButton')
const inventoryDialog = document.getElementById('inventoryDialog')
const inventoryDialogTitle = document.getElementById('inventoryDialogTitle')
const inventoryDialogStatus = document.getElementById('inventoryDialogStatus')
const inventoryGearSlots = document.getElementById('inventoryGearSlots')
const inventoryMainGrid = document.getElementById('inventoryMainGrid')
const inventoryHotbarGrid = document.getElementById('inventoryHotbarGrid')
const inventoryHotbarSelect = document.getElementById('inventoryHotbarSelect')
const inventoryCursorStatus = document.getElementById('inventoryCursorStatus')
const importSkinButton = document.getElementById('importSkinButton')
const skinHistoryButtons = document.getElementById('skinHistoryButtons')
const skinPreviewImage = document.getElementById('skinPreviewImage')
const skinPreviewPlaceholder = document.getElementById('skinPreviewPlaceholder')
const skinName = document.getElementById('skinName')
const skinDetails = document.getElementById('skinDetails')
const skinStatus = document.getElementById('skinStatus')

const state = { bots: new Map(), servers: [], installedMods: [], modCatalog: [], authUrl: '', toastTimer: null, selectedBotId: '', heldInputs: new Map(), toggledControlsByBot: new Map(), toggleControlsPressed: new Set(), logAutoFollow: true, pendingWorldRequestId: '', pendingServerKeyRequestId: '', chatMessagesByBot: new Map(), inventoryByBot: new Map(), inventoryUpdatedAtByBot: new Map(), inventoryGearByBot: new Map(), inventoryQuickBarByBot: new Map(), inventoryCursor: null, inventoryMovePending: false, selectedModId: 'inventory', botPage: 0, serverPage: 0, editingServerId: '', skinHistoryBusy: false }
const statusLabels = {
  disconnected: '未参加',
  authenticating: '認証処理中',
  connecting: '接続中',
  joining: 'ログイン中',
  connected: 'ワールド参加中',
  reconnecting: '自動再接続中',
  error: 'エラー'
}
const accountStatusLabels = {
  unverified: 'Xbox未認証',
  saved: '認証情報保存済み・再確認待ち',
  authenticating: 'Xbox認証中',
  authenticated: 'Xbox認証済み',
  error: 'Xbox認証エラー'
}
const keyControls = window.botControlKeys?.HOLD_KEYS || { KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right', Space: 'jump' }
const toggleKeyControls = window.botControlKeys?.TOGGLE_KEYS || { ControlLeft: 'sprint', ControlRight: 'sprint', ShiftLeft: 'sneak', ShiftRight: 'sneak' }

function showToast (message) {
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000)
}

function showStartupFailure (error) {
  const message = error instanceof Error ? error.message : String(error || '原因不明の初期化エラー')
  const version = document.getElementById('appVersionText')
  if (version) version.textContent = '起動エラー'
  const banner = document.getElementById('startupFailureBanner')
  if (banner) {
    banner.hidden = false
    banner.textContent = `初期化に失敗しました: ${message}  設定や認証情報を削除せず、診断ログを確認してください。`
  }
  const list = document.getElementById('logList')
  if (list && !list.querySelector('.startup-error-entry')) {
    list.append(createElement('div', 'log-entry error startup-error-entry', `画面初期化エラー: ${message}`))
  }
  console.error('Dashboard startup failed:', message)
}

window.addEventListener('error', (event) => {
  const version = document.getElementById('appVersionText')
  if (version?.textContent === '確認中') showStartupFailure(event.error || event.message)
})


window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const detail = reason instanceof Error ? reason.message : (typeof reason === 'string' ? reason : '詳細不明の非同期エラー')
  console.error('Unhandled renderer promise rejection:', reason)
  if (document.getElementById('appVersionText')?.textContent === '確認中') showStartupFailure(detail)
  else showToast(`画面側の非同期エラー: ${detail}`)
  event.preventDefault()
})

function createElement (tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

let pendingGuestParentBotId = ''

function nextGuestSlotForParent (parentBotId) {
  const used = new Set(Array.from(state.bots.values())
    .filter(bot => bot.parentBotId === parentBotId)
    .map(bot => Number(bot.subClientId)))
  return [1, 2, 3].find(slot => !used.has(slot)) || null
}

function openGuestNameDialog (parentBot) {
  if (!parentBot?.id || guestNameDialog.open) return
  const slot = nextGuestSlotForParent(parentBot.id)
  if (slot == null) return showToast('この親Botには空いているゲスト枠がありません。')

  pendingGuestParentBotId = parentBot.id
  guestBotNameInput.value = ''
  guestBotNameInput.placeholder = `${parentBot.label} (${slot})`
  guestNameHint.textContent = `空欄なら「${parentBot.label} (${slot})」、名前を入力するとその名前になります。`
  guestNameError.textContent = ''
  guestNameError.hidden = true
  guestNameSubmitButton.disabled = false
  guestNameDialog.showModal()
  guestBotNameInput.focus()
}

function selectedBot () {
  return state.bots.get(state.selectedBotId) || null
}

function parentBotFor (bot) {
  if (!bot) return null
  return bot.parentBotId ? (state.bots.get(bot.parentBotId) || null) : bot
}

function rootBots () {
  return Array.from(state.bots.values()).filter(bot => !bot.parentBotId)
}

function currentBotFamily () {
  const parent = parentBotFor(selectedBot())
  if (!parent) return []
  const guests = Array.from(state.bots.values())
    .filter(bot => bot.parentBotId === parent.id)
    .sort((a, b) => (Number(a.subClientId) || 0) - (Number(b.subClientId) || 0))
  return [parent, ...guests]
}

function positionText (bot) {
  if (!bot?.position) return '位置情報待ち'
  const p = bot.position
  return `X ${p.x}  /  Y ${p.y}  /  Z ${p.z}`
}

let logScrollScheduled = false
let forceLogScrollScheduled = false

function scheduleLogScroll (force = false) {
  if (force) forceLogScrollScheduled = true
  if (logScrollScheduled) return
  logScrollScheduled = true
  requestAnimationFrame(() => {
    logScrollScheduled = false
    const shouldFollow = forceLogScrollScheduled || state.logAutoFollow
    forceLogScrollScheduled = false
    if (shouldFollow) logList.scrollTop = logList.scrollHeight
  })
}

logList.addEventListener('scroll', () => {
  const distance = logList.scrollHeight - logList.scrollTop - logList.clientHeight
  state.logAutoFollow = distance <= 44
})

function formatLogLine (value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r?\n+/g, '  ·  ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function appendLog (entry) {
  const distance = logList.scrollHeight - logList.scrollTop - logList.clientHeight
  if (distance <= 44) state.logAutoFollow = true
  const empty = logList.querySelector('.log-empty')
  if (empty) empty.remove()
  const fullMessage = formatLogLine(entry.message)
  const message = fullMessage
  const row = createElement('div', `log-entry ${entry.level || 'info'}`)
  const time = new Date(entry.at).toLocaleTimeString('ja-JP', { hour12: false })
  row.append(createElement('span', 'log-time', time), createElement('span', 'log-message', message))
  logList.append(row)
  while (logList.children.length > 300) logList.firstElementChild.remove()
  scheduleLogScroll()
}

function openWorldChoices (bot,choices,description,targetFactory){
  document.getElementById('worldDialogTitle').textContent=`${bot.label}：参加先を選択`
  document.getElementById('worldDialogDescription').textContent=description
  worldChoices.replaceChildren()
  for(const choice of choices){
    const button=createElement('button','world-choice-button');button.type='button'
    button.append(createElement('strong','',choice.title),createElement('span','',choice.details||''))
    button.addEventListener('click',async()=>{
      button.disabled=true
      try{const updated=await api.setBotTarget({botId:bot.id,target:targetFactory(choice)});state.bots.set(bot.id,updated);worldDialog.close();renderBots();showToast('参加先を設定しました。')}
      catch(error){showToast(error.message||'参加先を設定できませんでした。');button.disabled=false}
    })
    worldChoices.append(button)
  }
  if(!choices.length)worldChoices.append(createElement('div','server-empty','参加可能な接続先が見つかりませんでした。'))
  if(!worldDialog.open)worldDialog.showModal()
}
async function searchSelectedBotLan(bot,button){
  button.disabled=true;button.textContent='検索中…'
  try{const worlds=await api.discoverLanWorlds(bot.id);openWorldChoices(bot,worlds.map(world=>({title:world.worldName,details:`${world.gameVersion||'バージョン不明'} · ${world.playerCount}/${world.maxPlayers??'?'}人`,value:world})),'LAN上で見つかったNetherNetワールドです。',choice=>choice.value)}
  catch(error){showToast(error.message||'LANワールドを検索できませんでした。')}
  finally{button.disabled=false;button.textContent='LANワールドを検索'}
}
async function searchSelectedBotRealms(bot,button){
  button.disabled=true;button.textContent='取得中…'
  try{const realms=await api.getRealms(bot.id);const choices=realms.filter(realm=>!realm.expired).map(realm=>({title:realm.name,details:`ID ${realm.id} · ${realm.state}${realm.owner?' · '+realm.owner:''}${realm.players!=null?' · '+realm.players+'/'+(realm.maxPlayers??'?')+'人':''}`,value:realm}));openWorldChoices(bot,choices,'このアカウントで参加可能なRealmsです。期限切れのRealmは表示しません。',choice=>({type:'realm',realmId:choice.value.id,worldName:choice.value.name}))}
  catch(error){showToast(error.message||'Realms一覧を取得できませんでした。')}
  finally{button.disabled=false;button.textContent='Realmsを検索'}
}
function renderSelectedConnectionControls(bot){
  const name=document.getElementById('connectionBotName'),stateLabel=document.getElementById('connectionBotState'),targetSelect=document.getElementById('controlTargetSelect'),actions=document.getElementById('connectionActionButtons'),helpers=document.getElementById('connectionTargetTools')
  actions.replaceChildren();helpers.replaceChildren();targetSelect.replaceChildren()
  if(!bot){
    name.textContent='Botを選択してください';stateLabel.textContent='未選択';targetSelect.append(new Option('Botを追加してください',''));targetSelect.disabled=true
    actions.append(createElement('span','muted tiny','左の一覧から操作するBotを選択してください。'))
    document.getElementById('connectionAutoReconnect').textContent = ''
    document.getElementById('selectedFunctionBotName').textContent='Bot未選択';document.getElementById('selectedFunctionBotState').textContent='Botを選択してください。';return
  }
  name.textContent=bot.label;stateLabel.textContent=statusLabels[bot.status]||bot.status;stateLabel.className=`connection-status-label ${bot.status}`
  const reconnectIndicator = document.getElementById('connectionAutoReconnect')
  reconnectIndicator.textContent = bot.isGuest ? `親Bot「${bot.parentBotLabel || '未登録'}」と接続連動` : (bot.autoReconnect?.status || '自動再接続：有効') + (bot.autoReconnect?.attempts ? ` · 再試行 ${bot.autoReconnect.attempts}回` : '')
  const busy=bot.connectionActive||bot.status==='connected'||['connecting','joining','reconnecting'].includes(bot.status)
  targetSelect.append(new Option('参加先を選択…',''),new Option('フレンドのワールド（参加時に一覧表示）','friend-world'),new Option('LANワールド（検索して選択）','lan-world'),new Option('Realms（一覧から選択）','realm'))
  for(const server of state.servers)targetSelect.append(new Option(`サーバー：${server.label}`,`server:${server.id}`))
  targetSelect.value=bot.targetType==='server'?`server:${bot.targetId}`:(bot.targetType||'');targetSelect.disabled=bot.isGuest||busy
  if(bot.isGuest){const parent=state.bots.get(bot.parentBotId);helpers.append(createElement('div','connection-help-note',`親Bot「${bot.parentBotLabel || '親Bot'}」の参加先を共有 · ${parent?.status==='connected'?'親Bot接続済み':'親Bot未接続'}`))}
  else if(bot.targetType==='lan-world'){
    const scan=createElement('button','secondary-button','LANワールドを検索');scan.type='button';scan.disabled=busy;scan.addEventListener('click',()=>searchSelectedBotLan(bot,scan));helpers.append(scan)
  }else if(bot.targetType==='realm'){
    const invite=createElement('input','realm-invite-input');invite.type='text';invite.maxLength=256;invite.placeholder='招待コード / realms.ggリンク';invite.disabled=busy
    const accept=createElement('button','secondary-button','招待を追加');accept.type='button';accept.disabled=busy
    accept.addEventListener('click',async()=>{const code=invite.value.trim();if(!code)return showToast('Realmsの招待コードまたはリンクを入力してください。');accept.disabled=true
      try{const realm=await api.getRealmFromInvite({botId:bot.id,inviteCode:code});if(realm.expired)throw new Error('このRealmは期限切れです。');const updated=await api.setBotTarget({botId:bot.id,target:{type:'realm',realmId:realm.id,worldName:realm.name}});state.bots.set(bot.id,updated);renderBots();showToast(`Realm「${realm.name}」を参加先に設定しました。`)}
      catch(error){showToast(error.message||'Realms招待コードを追加できませんでした。')}finally{accept.disabled=false}
    })
    const search=createElement('button','secondary-button','Realmsを検索');search.type='button';search.disabled=busy;search.addEventListener('click',()=>searchSelectedBotRealms(bot,search));helpers.append(invite,accept,search)
  }
  if (bot.isGuest) {
    const removeGuest = createElement('button', 'secondary-button danger-button', 'ゲスト削除')
    removeGuest.type = 'button'
    removeGuest.addEventListener('click', async () => {
      if (!window.confirm(`「${bot.label}」を親Bot「${bot.parentBotLabel || '親Bot'}」から削除しますか？`)) return
      removeGuest.disabled = true
      try {
        await api.removeBot(bot.id)
        showToast('ゲストBotを削除しました。')
      } catch (error) {
        showToast(error.message || 'ゲストBotを削除できませんでした。')
        removeGuest.disabled = false
      }
    })
    actions.append(removeGuest)
  } else {
    const guestCount=Array.from(state.bots.values()).filter(item=>item.parentBotId===bot.id).length
    const addGuest=createElement('button','secondary-button guest-add-button','＋ ゲスト追加 '+guestCount+'/3')
    addGuest.type='button';addGuest.disabled=guestCount>=3
    addGuest.addEventListener('click',()=>openGuestNameDialog(bot))
    actions.append(addGuest)
    const authBusy=bot.accountStatus==='authenticating'
    const auth=createElement('button','secondary-button account-button',authBusy?'Xbox認証中…':(['authenticated','saved'].includes(bot.accountStatus)?'認証を再確認':'Xbox認証'))
    auth.type='button';auth.disabled=authBusy||busy;auth.addEventListener('click',()=>api.authenticateBot(bot.id).catch(error=>showToast(error.message||'アカウント認証に失敗しました。')));actions.append(auth)
  }
  if(busy){
    const disconnect=createElement('button','primary-button disconnect-button',bot.isGuest?'ゲスト切断':'ワールド切断');disconnect.type='button';disconnect.addEventListener('click',()=>api.disconnectBot(bot.id).catch(error=>showToast(error.message||'切断できませんでした。')));actions.append(disconnect)
  }else if(bot.isGuest){
    const parent=state.bots.get(bot.parentBotId)
    const canJoin=parent?.status==='connected'&&!!parent.connectionActive
    const join=createElement('button','primary-button join-button',bot.status==='error'?'ゲスト再参加':'ゲスト接続');join.type='button'
    join.disabled=!canJoin
    join.title=canJoin?'親Botの接続を共有して、このゲストを参加させます。':'先に親Botをワールドへ参加させてください。'
    join.addEventListener('click',()=>api.connectBot(bot.id).then(updated=>{state.bots.set(updated.id,updated);renderBots()}).catch(error=>showToast(error.message||'ゲスト接続に失敗しました。')));actions.append(join)
  }else{
    const hasTarget=bot.targetType==='server'||bot.targetType==='friend-world'||(bot.targetType==='lan-world'&&!!bot.networkId)||(bot.targetType==='realm'&&/^\d+$/.test(String(bot.targetId||'')))
    const join=createElement('button','primary-button join-button',bot.status==='error'?'再参加':'ワールド参加');join.type = 'button'
    join.disabled = bot.accountStatus !== 'authenticated' || !hasTarget
    join.title=!hasTarget?'先に接続先を選択してください。':(bot.accountStatus!=='authenticated'?'先にXbox認証を完了してください。':'選択した接続先に参加します。')
    join.addEventListener('click',()=>api.connectBot(bot.id).catch(error=>showToast(error.message||'ワールドに参加できませんでした。')));actions.append(join)
  }
  document.getElementById('selectedFunctionBotName').textContent=bot.label
  document.getElementById('selectedFunctionBotState').textContent=bot.isGuest?'ゲストBot':(accountStatusLabels[bot.accountStatus]||statusLabels[bot.status]||bot.status)
}
function botSelectorLabel (bot) {
  const status = statusLabels[bot.status] || bot.status
  return bot.isGuest
    ? '　↳ Guest ' + bot.subClientId + ' · ' + bot.label + ' [' + status + ']'
    : bot.label + ' [' + status + ']'
}

function renderControlPanel () {
  const parents = rootBots()
  const currentParent = parentBotFor(selectedBot())
  if (!currentParent || !parents.some(bot => bot.id === currentParent.id)) {
    state.selectedBotId = parents[0]?.id || ''
  }
  const values = currentBotFamily()

  const previous = controlBotSelect.value
  const currentOptionIds = Array.from(controlBotSelect.options).map(option => option.value).filter(Boolean)
  const optionsChanged = currentOptionIds.length !== values.length || values.some((bot, index) => currentOptionIds[index] !== bot.id)
  if (optionsChanged || previous !== state.selectedBotId) {
    controlBotSelect.replaceChildren()
    if (!values.length) {
      controlBotSelect.append(new Option('Botを追加してください', ''))
    } else {
      for (const bot of values) controlBotSelect.append(new Option(botSelectorLabel(bot), bot.id))
    }
  } else {
    for (const option of controlBotSelect.options) {
      const bot = state.bots.get(option.value)
      if (bot) option.textContent = botSelectorLabel(bot)
    }
  }
  controlBotSelect.value = state.selectedBotId
  controlBotSelect.disabled = values.length === 0

  const bot = selectedBot()
  const connected = !!bot && bot.status === 'connected'
  const playerMode = bot?.movementMode === 'player'
  renderSelectedConnectionControls(bot)
  const modeSelect = document.getElementById('botMovementMode')
  const modeDescription = document.getElementById('botModeDescription')
  if (modeSelect) {
    modeSelect.value = playerMode ? 'player' : 'chunk-hold'
    modeSelect.disabled = !bot
  }
  if (modeDescription) {
    modeDescription.textContent = !bot
      ? 'Botを選択してください。'
      : playerMode
        ? '移動・アイテム操作・操作系Modを利用できます。'
        : '入力を停止。チャット・インベントリ受信は継続（保持効果はサーバー依存）。'
  }
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
  } else if (!playerMode) {
    pathfinderNote.textContent = 'チャンク保持モードではプレイヤー入力を送信しません。移動操作を使う場合はプレイヤーモードに切り替えてください。'
  } else if (bot.pathfinderReady && bot.worldSupport) {
    pathfinderNote.textContent = '地形データを読み込みました。座標移動できます。ブロックの採掘・設置は行いません。'
  } else if (!bot.worldSupport && bot.worldSupportReason) {
    pathfinderNote.textContent = `地形データ解析が利用できません: ${bot.worldSupportReason}`
  } else {
    pathfinderNote.textContent = '周囲のチャンクを読み込み中です。座標移動は地形情報の準備後に利用できます。'
  }

  for (const button of document.querySelectorAll('[data-control], [data-toggle-control], #stopMovementButton, #clearControlsButton')) {
    button.disabled = !connected || !playerMode
  }
  renderControlToggleButtons()
  for (const input of gotoForm.querySelectorAll('input, button')) input.disabled = !connected || !playerMode || !bot.pathfinderReady || !bot.worldSupport
  chatInput.disabled = !connected
  sendChatButton.disabled = !connected || !chatInput.value.trim()
  refreshInventoryButton.disabled = !connected
  const hasInventoryItems = !!(state.inventoryByBot.get(bot?.id) || []).length
  inventorySelect.disabled = !connected || !hasInventoryItems
  dropItemCount.disabled = !connected || !hasInventoryItems
  document.getElementById('dropItemButton').disabled = !connected || !hasInventoryItems
  dropAllItemsButton.disabled = !connected || !hasInventoryItems
  renderBotModulesPanel(false)
}

function renderBotModulesPanel (refreshConfig = false) {
  const bot = selectedBot()
  const connected = bot?.status === 'connected'
  const playerMode = bot?.movementMode === 'player'
  const modules = bot?.modules || {}
  const items = bot ? (state.inventoryByBot.get(bot.id) || []) : []
  const moduleSelectedBot = document.getElementById('moduleSelectedBot')
  const supplyX = document.getElementById('supplyX')
  const supplyY = document.getElementById('supplyY')
  const supplyZ = document.getElementById('supplyZ')
  const supplyItemsList = document.getElementById('supplyItemsList')
  const supplyInterval = document.getElementById('supplyInterval')
  const moduleItemUseSelect = document.getElementById('moduleItemUseSelect')
  const installed = new Set(state.installedMods)
  const assigned = (id) => id === 'inventory'
    ? !!bot
    : installed.has(id) && modules[id]?.assigned === true

  if (!bot) moduleSelectedBot.textContent = 'Botを追加して選択してください。'
  else moduleSelectedBot.textContent = bot.label + ' · ' + (connected ? 'ワールド参加中' : (statusLabels[bot.status] || bot.status))

  const previousUseSlot = moduleItemUseSelect.value
  const selectedUseSlot = refreshConfig ? '' : previousUseSlot
  moduleItemUseSelect.replaceChildren()
  moduleItemUseSelect.append(new Option(items.length ? '使用するアイテムを選択…' : 'アイテムなし', ''))
  for (const item of items) {
    moduleItemUseSelect.append(new Option(chatSlotLabel(item.slot) + ' · ' + (item.displayName || item.name) + ' × ' + item.count, String(item.slot)))
  }
  moduleItemUseSelect.value = items.some(item => String(item.slot) === selectedUseSlot)
    ? selectedUseSlot
    : (items[0] ? String(items[0].slot) : '')

  const uniqueItems = new Map()
  for (const item of items) {
    if (!uniqueItems.has(item.name)) uniqueItems.set(item.name, item.displayName || item.name)
  }
  const supplyItemOptions = document.getElementById('supplyItemOptions')
  supplyItemOptions.replaceChildren()
  for (const [name, label] of uniqueItems) supplyItemOptions.append(new Option(label, name))
  if (refreshConfig) {
    const configured = modules.containerSupply?.items || (modules.containerSupply?.itemName ? [{ itemName: modules.containerSupply.itemName, targetCount: modules.containerSupply.targetCount || 64 }] : [])
    supplyItemsList.replaceChildren()
    for (const entry of configured.length ? configured : [{ itemName: '', targetCount: 64 }]) addSupplyItemRow(entry.itemName, entry.targetCount)
    document.getElementById('itemUseMode').value = modules.itemUse?.useMode === 'consume' ? 'consume' : 'activate'
    document.getElementById('itemUseInterval').value = String(modules.itemUse?.intervalMs || 1500)
    supplyX.value = modules.containerSupply?.x ?? ''
    supplyY.value = modules.containerSupply?.y ?? ''
    supplyZ.value = modules.containerSupply?.z ?? ''
    supplyInterval.value = String(modules.containerSupply?.intervalMs || 5000)
    document.getElementById('autoFishingBiteTimeout').value = String(modules.autoFishing?.biteTimeoutMs || 120000)
    document.getElementById('autoFishingRecastDelay').value = String(modules.autoFishing?.recastDelayMs || 1000)
    document.getElementById('lookDirectionYaw').value = String(modules.lookDirection?.yawDeg ?? 0)
    document.getElementById('lookDirectionPitch').value = String(modules.lookDirection?.pitchDeg ?? 0)
  }

  const status = bot?.moduleStatus || {}
  const descriptors = [
    { id: 'inventory', name: 'インベントリ管理', state: '所持品の確認・投棄', cardId: 'inventoryModuleCard' },
    { id: 'itemUse', name: 'アイテム使用', state: status.itemUse || '未実行', cardId: 'itemUseModuleCard', running: status.itemUseRunning === true },
    { id: 'containerSupply', name: 'コンテナ補充', state: status.containerSupply || '未実行', cardId: 'containerSupplyModuleCard', running: status.containerSupplyRunning === true },
    { id: 'autoFishing', name: '自動釣り', state: status.autoFishing || '未実行', cardId: 'autoFishingModuleCard', running: status.autoFishingRunning === true },
    { id: 'lookDirection', name: '視点変更', state: status.lookDirection || '未実行', cardId: 'lookDirectionModuleCard', running: false },
    { id: 'skin', name: 'スキン変更', state: bot?.skin?.name ? '適用素材：' + bot.skin.name : 'スキン素材未設定', cardId: 'skinModuleCard', running: false }
  ]
  const entries = descriptors.filter(entry => assigned(entry.id))
  if (!entries.some(entry => entry.id === state.selectedModId)) state.selectedModId = 'inventory'
  if (!entries.some(entry => entry.id === state.selectedModId)) state.selectedModId = entries[0]?.id || 'inventory'

  const summary = document.getElementById('selectedBotModSummary')
  const summaryCount = document.getElementById('selectedModCount')
  if (summary) {
    summary.replaceChildren()
    if (!bot) summary.append(createElement('div', 'server-empty', 'Botを選択してください。'))
    else if (!entries.length) summary.append(createElement('div', 'server-empty', '割り当て済みModはありません。Modを追加してください。'))
    else {
      for (const entry of entries) {
        const button = createElement('button', 'selected-mod-row' + (state.selectedModId === entry.id ? ' selected' : ''))
        button.type = 'button'
        button.setAttribute('aria-pressed', String(state.selectedModId === entry.id))
        const info = createElement('span', 'selected-mod-info')
        info.append(createElement('strong', '', entry.name), createElement('span', '', entry.state))
        const stateChip = createElement('span', entry.running ? 'mod-state running' : 'mod-state assigned', entry.running ? '実行中' : (entry.id === 'inventory' ? '標準搭載' : '割り当て済み'))
        button.title = entry.name + ' · ' + entry.state
        button.setAttribute('aria-label', entry.name + ' · ' + entry.state)
        button.append(info, stateChip)
        button.addEventListener('click', () => {
          if (state.selectedModId === entry.id) return
          state.selectedModId = entry.id
          renderBotModulesPanel(false)
        })
        summary.append(button)
      }
    }
    if (summaryCount) summaryCount.textContent = entries.length + '件'
  }

  const selectedId = state.selectedModId
  document.getElementById('modulePanel').hidden = !bot
  document.getElementById('inventoryModuleCard').hidden = selectedId !== 'inventory'
  document.getElementById('itemUseModuleCard').hidden = selectedId !== 'itemUse' || !assigned('itemUse')
  document.getElementById('containerSupplyModuleCard').hidden = selectedId !== 'containerSupply' || !assigned('containerSupply')
  document.getElementById('autoFishingModuleCard').hidden = selectedId !== 'autoFishing' || !assigned('autoFishing')
  document.getElementById('lookDirectionModuleCard').hidden = selectedId !== 'lookDirection' || !assigned('lookDirection')
  document.getElementById('skinModuleCard').hidden = selectedId !== 'skin' || !assigned('skin')
  document.getElementById('moduleSaveButton').hidden = selectedId === 'inventory' || selectedId === 'skin' || !bot

  const selectedName = descriptors.find(entry => entry.id === selectedId)?.name || 'インベントリ管理'
  moduleSelectedBot.textContent = bot ? bot.label + ' · ' + selectedName : 'Botを選択してください。'
  const inventoryActionNote = document.getElementById('inventoryActionNote')
  if (inventoryActionNote) inventoryActionNote.hidden = !connected || playerMode

  const itemUseAssigned = assigned('itemUse')
  const containerSupplyAssigned = assigned('containerSupply')
  const autoFishingAssigned = assigned('autoFishing')
  const lookDirectionAssigned = assigned('lookDirection')
  importSkinButton.disabled = !bot || !assigned('skin')
  document.getElementById('itemUseStatus').textContent = status.itemUse || '未実行'
  document.getElementById('containerSupplyStatus').textContent = status.containerSupply || '未実行'
  document.getElementById('autoFishingStatus').textContent = status.autoFishing || '未実行'
  document.getElementById('lookDirectionStatus').textContent = status.lookDirection || '未実行'

  document.getElementById('itemUseMode').disabled = !bot || !itemUseAssigned
  document.getElementById('itemUseInterval').disabled = !bot || !itemUseAssigned
  moduleItemUseSelect.disabled = !connected || !items.length || !itemUseAssigned || !playerMode
  document.getElementById('itemUseOnceButton').disabled = !connected || !itemUseAssigned || !moduleItemUseSelect.value || !playerMode
  document.getElementById('itemUseStartButton').disabled = !connected || !itemUseAssigned || !moduleItemUseSelect.value || !playerMode
  document.getElementById('itemUseStopButton').disabled = !bot || status.itemUseRunning !== true

  document.getElementById('addSupplyItemButton').disabled = !bot || !containerSupplyAssigned
  for (const input of [supplyX, supplyY, supplyZ, supplyInterval, ...supplyItemsList.querySelectorAll('input,button')]) {
    input.disabled = !bot || !containerSupplyAssigned
  }
  document.getElementById('supplySaveButton').disabled = !bot || !containerSupplyAssigned
  document.getElementById('supplyStartButton').disabled = !connected || !containerSupplyAssigned || !playerMode
  document.getElementById('supplyStopButton').disabled = !bot || status.containerSupplyRunning !== true

  document.getElementById('autoFishingBiteTimeout').disabled = !bot || !autoFishingAssigned
  document.getElementById('autoFishingRecastDelay').disabled = !bot || !autoFishingAssigned
  document.getElementById('autoFishingStartButton').disabled = !connected || !autoFishingAssigned || !playerMode
  document.getElementById('autoFishingStopButton').disabled = !bot || status.autoFishingRunning !== true

  document.getElementById('lookDirectionYaw').disabled = !bot || !lookDirectionAssigned
  document.getElementById('lookDirectionPitch').disabled = !bot || !lookDirectionAssigned
  document.getElementById('lookDirectionApplyButton').disabled = !connected || !lookDirectionAssigned || !playerMode
}


function addSupplyItemRow (itemName = '', targetCount = 64) {
  const list = document.getElementById('supplyItemsList')
  if (list.querySelectorAll('.supply-item-row').length >= 32) return showToast('補充アイテムは最大32種類まで登録できます。')
  const row = createElement('div', 'module-inline-fields supply-item-row')
  const nameLabel = createElement('label', 'field')
  nameLabel.append(createElement('span', '', 'アイテム名'))
  const name = document.createElement('input')
  name.type = 'text'; name.className = 'inventory-select'; name.placeholder = 'minecraft:stone'; name.setAttribute('list', 'supplyItemOptions'); name.value = itemName
  nameLabel.append(name)
  const countLabel = createElement('label', 'field')
  countLabel.append(createElement('span', '', '目標数'))
  const count = document.createElement('input')
  count.type = 'number'; count.min = '1'; count.max = '100000'; count.step = '1'; count.value = String(targetCount)
  countLabel.append(count)
  const remove = createElement('button', 'icon-button danger', '削除')
  remove.type = 'button'; remove.addEventListener('click', () => { row.remove(); if (!document.querySelector('#supplyItemsList .supply-item-row')) addSupplyItemRow() })
  row.append(nameLabel, countLabel, remove)
  list.append(row)
}

function renderModStore () {
  const target = document.getElementById('modCatalogList')
  target.replaceChildren()
  const bot = selectedBot()
  for (const mod of state.modCatalog) {
    const installed = state.installedMods.includes(mod.id)
    const assigned = !!bot && (mod.builtIn || bot.modules?.[mod.id]?.assigned === true)
    const card = createElement('article', 'mod-catalog-card')
    const top = createElement('div', 'mod-catalog-top')
    const title = createElement('div', 'mod-catalog-title')
    title.append(createElement('strong', '', mod.name), createElement('span', '', 'v' + mod.version + ' · ' + mod.category))
    const statusText = mod.builtIn ? '標準搭載' : (assigned ? 'このBotに割り当て済み' : (installed ? '導入済み' : '未導入'))
    const status = createElement('span', installed ? 'mod-installed' : 'mod-not-installed', statusText)
    top.append(title, status)
    const description = createElement('p', 'muted tiny', mod.description)
    const assignButton = createElement('button', assigned ? 'secondary-button' : 'primary-button',
      !bot ? 'Botを選択してください' : (mod.builtIn ? '標準搭載' : (assigned ? 'Botから外す' : (installed ? 'Botに追加' : '導入してBotに追加'))))
    assignButton.type = 'button'
    assignButton.disabled = !bot || !!mod.builtIn
    assignButton.addEventListener('click', async () => {
      const currentBot = selectedBot()
      if (!currentBot || mod.builtIn) return
      assignButton.disabled = true
      try {
        let updated
        if (installed) {
          updated = await api.setModAssignment({ botId: currentBot.id, modId: mod.id, assigned: !assigned })
          state.bots.set(updated.id, updated)
        } else {
          const result = await api.installMod({ botId: currentBot.id, modId: mod.id })
          state.installedMods = result.installedMods || []
          if (result.bot) state.bots.set(result.bot.id, result.bot)
        }
        renderModStore()
        renderBotModulesPanel(true)
        showToast(`Mod「${mod.name}」を${assigned ? 'Botから外しました' : 'Botに追加しました'}。`)
      } catch (error) {
        showToast(error.message || 'Modを変更できませんでした。')
      } finally {
        assignButton.disabled = false
      }
    })
    card.append(top, description, assignButton)
    if (installed && !mod.builtIn) {
      const uninstall = createElement('button', 'text-button mod-uninstall-button', 'このPCからアンインストール')
      uninstall.type = 'button'
      uninstall.addEventListener('click', async () => {
        if (!window.confirm(`Mod「${mod.name}」をこのPCからアンインストールしますか？\n\nすべてのBotから割り当てが解除されます。`)) return
        uninstall.disabled = true
        try {
          const result = await api.uninstallMod(mod.id)
          state.installedMods = result.installedMods || []
          renderModStore()
          renderBotModulesPanel(true)
          showToast(`Mod「${mod.name}」をアンインストールしました。`)
        } catch (error) {
          showToast(error.message || 'Modをアンインストールできませんでした。')
          uninstall.disabled = false
        }
      })
      card.append(uninstall)
    }
    target.append(card)
  }
  if (!state.modCatalog.length) target.append(createElement('p', 'server-empty', '利用可能なModはありません。'))
}

function initializeDashboardLayout () {
  guestNameForm.addEventListener('submit', async event => {
    event.preventDefault()
    const parentBotId = pendingGuestParentBotId
    const label = guestBotNameInput.value.trim()
    if (!parentBotId) {
      guestNameError.textContent = '親Botを特定できません。Bot一覧からやり直してください。'
      guestNameError.hidden = false
      return
    }
    if (label.length > 32) {
      guestNameError.textContent = '表示名は32文字以内で入力してください。'
      guestNameError.hidden = false
      guestBotNameInput.focus()
      return
    }

    guestNameSubmitButton.disabled = true
    guestBotNameInput.disabled = true
    guestNameError.textContent = ''
    guestNameError.hidden = true
    try {
      const added = await api.addGuestBot({ parentBotId, label })
      if (!added?.id) throw new Error('ゲストBotの追加結果を確認できませんでした。')
      state.bots.set(added.id, added)
      state.selectedBotId = added.id
      const parentIndex = rootBots().findIndex(bot => bot.id === parentBotId)
      state.botPage = Math.floor(Math.max(0, parentIndex) / 3)
      guestNameDialog.close()
      renderBots()
      renderBotModulesPanel(true)
      loadSelectedBotData()
      showToast('ゲストBotを追加しました。')
    } catch (error) {
      guestNameError.textContent = error.message || 'ゲストBotを追加できませんでした。'
      guestNameError.hidden = false
    } finally {
      guestNameSubmitButton.disabled = false
      guestBotNameInput.disabled = false
    }
  })
  document.getElementById('cancelGuestNameButton').addEventListener('click', () => guestNameDialog.close())
  guestNameDialog.addEventListener('close', () => { pendingGuestParentBotId = '' })

  const addBotPanel = document.getElementById('addBotFormPanel')
  const serverFormPanel = document.getElementById('serverFormPanel')
  document.getElementById('openAddBotFormButton').addEventListener('click', () => {
    serverFormPanel.hidden = true; addBotPanel.hidden = !addBotPanel.hidden
    if (!addBotPanel.hidden) document.getElementById('botLabel').focus()
  })
  document.getElementById('openAddServerFormButton').addEventListener('click', () => {
    if (!serverFormPanel.hidden) {
      serverFormPanel.hidden = true
      resetServerProfileForm()
      return
    }
    openServerProfileForm()
  })
  document.getElementById('closeAddBotFormButton').addEventListener('click', () => { addBotPanel.hidden = true })
  document.getElementById('closeServerFormButton').addEventListener('click', () => {
    serverFormPanel.hidden = true
    resetServerProfileForm()
  })
  const catalogDialog = document.getElementById('modCatalogDialog')
  document.getElementById('openModCatalogDialogButton').addEventListener('click', () => {
    renderModStore()
    if (!catalogDialog.open) catalogDialog.showModal()
  })
  document.getElementById('closeModCatalogDialogButton').addEventListener('click', () => catalogDialog.close())
  document.getElementById('botMovementMode').addEventListener('change', async (event) => {
    const bot = selectedBot()
    if (!bot) return
    releaseAllHeldInputs()
    const select = event.currentTarget
    select.disabled = true
    try {
      const updated = await api.setBotMovementMode({ botId: bot.id, movementMode: select.value })
      state.bots.set(updated.id, updated)
      renderBots()
      renderBotModulesPanel(false)
      renderControlPanel()
      renderModStore()
      showToast(updated.movementMode === 'player' ? 'プレイヤーモードに切り替えました。' : 'チャンク保持モードに切り替えました。')
    } catch (error) {
      showToast(error.message || 'Botの動作モードを変更できませんでした。')
      renderControlPanel()
    } finally {
      select.disabled = false
    }
  })
  document.getElementById('controlTargetSelect').addEventListener('change', async (event) => {
    const bot = selectedBot(); if (!bot || bot.isGuest) return
    const value = event.target.value
    const target = value.startsWith('server:') ? { type:'server', serverId:value.slice(7) } : { type:value || 'none' }
    try { const updated=await api.setBotTarget({botId:bot.id,target}); state.bots.set(bot.id,updated); renderBots(); showToast('接続先を更新しました。') }
    catch(error){showToast(error.message||'接続先を設定できませんでした。');renderControlPanel()}
  })
}
async function saveModulesFromForm () {
  const bot = selectedBot()
  if (!bot) throw new Error('設定するBotを選択してください。')
  const savedModules = bot.modules || {}
  const modules = {
    inventory: { assigned: true },
    itemUse: {
      assigned: savedModules.itemUse?.assigned === true,
      useMode: document.getElementById('itemUseMode').value,
      intervalMs: document.getElementById('itemUseInterval').value
    },
    containerSupply: {
      assigned: savedModules.containerSupply?.assigned === true,
      x: document.getElementById('supplyX').value,
      y: document.getElementById('supplyY').value,
      z: document.getElementById('supplyZ').value,
      items: Array.from(document.querySelectorAll('#supplyItemsList .supply-item-row')).map(row => ({
        itemName: row.querySelector('input[type=text]').value,
        targetCount: row.querySelector('input[type=number]').value
      })).filter(entry => entry.itemName.trim()),
      intervalMs: document.getElementById('supplyInterval').value
    },
    autoFishing: {
      assigned: savedModules.autoFishing?.assigned === true,
      biteTimeoutMs: document.getElementById('autoFishingBiteTimeout').value,
      recastDelayMs: document.getElementById('autoFishingRecastDelay').value
    },
    lookDirection: {
      assigned: savedModules.lookDirection?.assigned === true,
      yawDeg: document.getElementById('lookDirectionYaw').value,
      pitchDeg: document.getElementById('lookDirectionPitch').value
    },
    skin: { assigned: savedModules.skin?.assigned === true }
  }
  const updated = await api.updateModules({ botId: bot.id, modules })
  state.bots.set(updated.id, updated)
  renderBotModulesPanel(false)
  return updated
}

function chatSlotLabel (slot) {
  return slot >= 36 ? `ホットバー ${slot - 35}` : `インベントリ ${slot - 8}`
}

function renderChatPanel () {
  const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 42
  const bot = selectedBot()
  chatMessages.replaceChildren()
  const entries = bot ? (state.chatMessagesByBot.get(bot.id) || []) : []
  if (!entries.length) {
    chatMessages.append(createElement('div', 'chat-empty', bot ? 'チャット履歴はありません。' : 'Botを選択してください。'))
  } else {
    for (const entry of entries.slice(-150)) {
      const direction = entry.direction === 'outgoing' ? 'outgoing' : entry.direction === 'system' ? 'system' : 'incoming'
      const row = createElement('div', `chat-message ${direction}`)
      const meta = createElement('div', 'chat-message-meta')
      const time = new Date(entry.at).toLocaleTimeString('ja-JP', { hour12: false })
      const label = entry.direction === 'outgoing' ? '送信' : entry.direction === 'system' ? 'システム' : (entry.username || 'ワールド')
      meta.textContent = `${label} · ${time}`
      row.append(meta, createElement('div', 'chat-message-text', entry.message))
      chatMessages.append(row)
    }
  }
  if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight
  const connected = bot?.status === 'connected'
  chatInput.disabled = !connected
  sendChatButton.disabled = !connected || !chatInput.value.trim()
}

function storeInventorySnapshot (botId, snapshot) {
  state.inventoryByBot.set(botId, Array.isArray(snapshot?.items) ? snapshot.items : [])
  state.inventoryGearByBot.set(botId, Array.isArray(snapshot?.gear) ? snapshot.gear : [])
  state.inventoryQuickBarByBot.set(botId, Number.isInteger(snapshot?.quickBarSlot) ? snapshot.quickBarSlot : 0)
  state.inventoryUpdatedAtByBot.set(botId, snapshot?.updatedAt || '')
}

function itemIconUrls (item) {
  return window.bedrockItemTextures?.getTextureUrls(item) || []
}

function makeInventorySlot (slot, item, options = {}) {
  const button = createElement('button', 'inventory-grid-slot')
  button.type = 'button'
  button.dataset.slot = String(slot)
  const gear = options.gear === true
  const hotbar = slot >= 36 && slot <= 44
  if (gear) button.classList.add('is-gear')
  if (!item) button.classList.add('is-empty')
  if (hotbar && state.inventoryQuickBarByBot.get(selectedBot()?.id) === slot - 36) button.classList.add('is-selected')
  const cursor = state.inventoryCursor
  const shownCount = item && cursor?.fromSlot === slot ? Math.max(0, item.count - cursor.count) : item?.count
  if (cursor?.fromSlot === slot) button.classList.add('is-cursor-source')
  const enchantmentLabels = Array.isArray(item?.enchantments) ? item.enchantments.map(enchantment => enchantment.label).filter(Boolean) : []
  button.title = item ? `${item.displayName || item.name} × ${shownCount} (slot ${slot})${enchantmentLabels.length ? '\n' + enchantmentLabels.join('\n') : ''}` : (options.label || `空きスロット ${slot}`)
  if (hotbar) button.append(createElement('span', 'inventory-slot-number', String(slot - 35)))
  if (item && shownCount > 0) {
    const icons = itemIconUrls(item)
    if (icons.length) {
      const image = document.createElement('img')
      const fallback = createElement('span', 'inventory-empty-label', String(item.displayName || item.name).slice(0, 7))
      image.alt = String(item.displayName || item.name)
      image.loading = 'lazy'
      let candidate = 0
      image.src = icons[candidate]
      image.addEventListener('error', () => {
        candidate++
        if (candidate < icons.length) image.src = icons[candidate]
        else { image.remove(); fallback.hidden = false }
      })
      fallback.hidden = true
      button.append(image, fallback)
    } else {
      button.append(createElement('span', 'inventory-empty-label', String(item.displayName || item.name).slice(0, 7)))
    }
    button.append(createElement('span', 'inventory-stack-count', shownCount > 1 ? String(shownCount) : ''))
    if (enchantmentLabels.length) button.append(createElement('span', 'inventory-enchantment-mark', '✦'))
  } else if (options.label) {
    button.append(createElement('span', 'inventory-empty-label', options.label))
  } else {
    button.append(createElement('span', 'inventory-empty-label', ''))
  }
  button.disabled = !selectedBot() || selectedBot().status !== 'connected' || gear || state.inventoryMovePending
  button.addEventListener('click', () => handleInventorySlotClick(slot, false))
  button.addEventListener('contextmenu', event => {
    event.preventDefault()
    handleInventorySlotClick(slot, true)
  })
  button.draggable = !!item && !gear && selectedBot()?.status === 'connected'
  button.addEventListener('dragstart', event => {
    if (!item || gear) { event.preventDefault(); return }
    event.dataTransfer.setData('text/plain', String(slot))
    event.dataTransfer.effectAllowed = 'move'
  })
  button.addEventListener('dragover', event => { if (!gear) event.preventDefault() })
  button.addEventListener('drop', event => {
    event.preventDefault()
    if (gear) return
    const fromSlot = Number(event.dataTransfer.getData('text/plain'))
    if (Number.isInteger(fromSlot)) commitInventoryMove(fromSlot, slot, null)
  })
  return button
}

function renderInventoryDialog () {
  if (!inventoryDialog) return
  const bot = selectedBot()
  const items = bot ? (state.inventoryByBot.get(bot.id) || []) : []
  const gear = bot ? (state.inventoryGearByBot.get(bot.id) || []) : []
  const connected = bot?.status === 'connected'
  const selected = bot ? (state.inventoryQuickBarByBot.get(bot.id) || 0) : 0
  const itemAt = slot => items.find(item => item.slot === slot) || null
  const gearAt = slot => gear.find(item => item.slot === slot) || null
  inventoryDialogTitle.textContent = bot ? `${bot.label}：インベントリ` : 'インベントリ'
  inventoryDialogStatus.textContent = !bot ? 'Botを選択してください。' : !connected ? 'Botがワールドに参加していません。' : 'スロットをクリックまたはドラッグして操作できます。'
  inventoryGearSlots.replaceChildren()
  const armorGroup = createElement('div', 'inventory-equipment-group')
  for (const [slot, label] of [[5, '頭'], [6, '胴'], [7, '脚'], [8, '足']]) armorGroup.append(makeInventorySlot(slot, gearAt(slot), { gear: true, label }))
  const offhandGroup = createElement('div', 'inventory-equipment-group')
  offhandGroup.append(makeInventorySlot(45, gearAt(45), { gear: true, label: '副手' }))
  inventoryGearSlots.append(armorGroup, offhandGroup)
  inventoryMainGrid.replaceChildren()
  for (let slot = 9; slot <= 35; slot++) inventoryMainGrid.append(makeInventorySlot(slot, itemAt(slot)))
  inventoryHotbarGrid.replaceChildren()
  for (let slot = 36; slot <= 44; slot++) inventoryHotbarGrid.append(makeInventorySlot(slot, itemAt(slot)))
  inventoryHotbarSelect.replaceChildren()
  for (let index = 0; index < 9; index++) {
    const select = createElement('button', 'hotbar-select-button' + (selected === index ? ' selected' : ''), String(index + 1))
    select.type = 'button'
    select.disabled = !connected
    select.title = `ホットバー ${index + 1} を選択`
    select.addEventListener('click', () => chooseHotbarSlot(index))
    inventoryHotbarSelect.append(select)
  }
  if (state.inventoryCursor?.botId === bot?.id && connected) {
    const source = itemAt(state.inventoryCursor.fromSlot)
    const name = source?.displayName || source?.name || 'アイテム'
    inventoryCursorStatus.textContent = `持っているアイテム：${name} × ${state.inventoryCursor.count} · 置くスロットをクリック（Escでキャンセル）`
  } else {
    inventoryCursorStatus.textContent = 'アイテムを選択してください。'
  }
}

async function handleInventorySlotClick (slot, rightClick) {
  const bot = selectedBot()
  if (!bot || bot.status !== 'connected' || state.inventoryMovePending) return
  if (slot < 9 || slot > 44) return
  const items = state.inventoryByBot.get(bot.id) || []
  const item = items.find(entry => entry.slot === slot)
  const cursor = state.inventoryCursor
  if (!cursor) {
    if (!item) return
    const amount = rightClick ? Math.max(1, Math.ceil(item.count / 2)) : item.count
    state.inventoryCursor = { botId: bot.id, fromSlot: slot, count: amount }
    renderInventoryDialog()
    return
  }
  if (cursor.fromSlot === slot) {
    state.inventoryCursor = null
    renderInventoryDialog()
    return
  }
  const source = items.find(entry => entry.slot === cursor.fromSlot)
  if (cursor.botId !== bot.id || !source || cursor.count < 1 || cursor.count > source.count) {
    state.inventoryCursor = null
    renderInventoryDialog()
    showToast('移動元インベントリが更新されました。もう一度選択してください。')
    return
  }
  if (item && cursor.count < source.count) {
    showToast('部分スタックは空きスロットにのみ置けます。')
    return
  }
  const amount = rightClick ? 1 : cursor.count
  state.inventoryMovePending = true
  renderInventoryDialog()
  try {
    const snapshot = await api.moveInventoryItem({ botId: bot.id, fromSlot: cursor.fromSlot, toSlot: slot, count: amount })
    storeInventorySnapshot(bot.id, snapshot)
    if (item && cursor.count === source.count) {
      state.inventoryCursor = { botId: bot.id, fromSlot: cursor.fromSlot, count: item.count }
    } else if (rightClick && cursor.count > 1) {
      state.inventoryCursor = { botId: bot.id, fromSlot: cursor.fromSlot, count: cursor.count - 1 }
    } else {
      state.inventoryCursor = null
    }
    renderInventoryPanel()
    renderInventoryDialog()
  } catch (error) {
    showToast(error.message || 'インベントリを移動できませんでした。')
    try { storeInventorySnapshot(bot.id, await api.getInventory(bot.id)) } catch {}
    state.inventoryCursor = null
    renderInventoryPanel()
    renderInventoryDialog()
  } finally {
    state.inventoryMovePending = false
    renderInventoryDialog()
  }
}

async function commitInventoryMove (fromSlot, toSlot, count) {
  const bot = selectedBot()
  if (!bot || bot.status !== 'connected' || state.inventoryMovePending) return
  if (fromSlot === toSlot || fromSlot < 9 || fromSlot > 44 || toSlot < 9 || toSlot > 44) return
  state.inventoryMovePending = true
  renderInventoryDialog()
  try {
    const snapshot = await api.moveInventoryItem({ botId: bot.id, fromSlot, toSlot, count })
    storeInventorySnapshot(bot.id, snapshot)
    state.inventoryCursor = null
    renderInventoryPanel()
    renderInventoryDialog()
  } catch (error) {
    showToast(error.message || 'インベントリを移動できませんでした。')
    try { storeInventorySnapshot(bot.id, await api.getInventory(bot.id)) } catch {}
    renderInventoryPanel()
  } finally {
    state.inventoryMovePending = false
    renderInventoryDialog()
  }
}

async function chooseHotbarSlot (slot) {
  const bot = selectedBot()
  if (!bot || bot.status !== 'connected') return
  try {
    const snapshot = await api.selectHotbarSlot({ botId: bot.id, slot })
    storeInventorySnapshot(bot.id, snapshot)
    renderInventoryPanel()
    renderInventoryDialog()
  } catch (error) {
    showToast(error.message || 'ホットバーを選択できませんでした。')
  }
}

function renderSkinPanel (bot) {
  const skin = bot?.skin
  importSkinButton.disabled = !bot || bot.modules?.skin?.assigned !== true

  skinHistoryButtons.replaceChildren()
  const recentSkins = Array.isArray(bot?.skinHistory) ? bot.skinHistory.slice(0, 3) : []
  skinHistoryButtons.hidden = recentSkins.length === 0
  recentSkins.forEach((entry, index) => {
    const button = createElement('button', 'secondary-button skin-history-button' + (index === 0 ? ' active' : ''),
      entry.name || `履歴 ${index + 1}`)
    button.type = 'button'
    button.dataset.skinHistoryIndex = String(index)
    button.title = `${entry.name || 'カスタムスキン'} · ${entry.width || '?'}×${entry.height || '?'} · ${entry.geometryId || '標準モデル'}`
    button.disabled = state.skinHistoryBusy || importSkinButton.disabled || index === 0
    if (index === 0) button.setAttribute('aria-current', 'true')
    skinHistoryButtons.append(button)
  })

  if (!skin) {
    skinPreviewImage.hidden = true
    skinPreviewPlaceholder.hidden = false
    skinName.textContent = 'スキン未設定'
    skinDetails.textContent = 'PNG・Geometry JSON・Animation JSON・SkinSteal BIN・MCpackに対応'
    skinStatus.textContent = bot ? 'スキン素材を読み込むと、このBotへ適用します。' : 'Botを選択してください。'
    return
  }
  skinPreviewImage.hidden = !skin.previewDataUrl
  skinPreviewImage.src = skin.previewDataUrl || ''
  skinPreviewPlaceholder.hidden = !!skin.previewDataUrl
  skinName.textContent = skin.name || 'カスタムスキン'
  skinDetails.textContent = `${skin.width}×${skin.height} · ${skin.geometryId || '標準モデル'}${skin.hasAnimation ? ' · Animationあり' : ''}${skin.hasCape ? ' · Capeあり' : ''}${skin.sourceFormat ? ' · ' + skin.sourceFormat : ''}`
  skinStatus.textContent = bot.skinFallbackActive
    ? 'サーバーが前回のカスタムスキンを拒否したため、現在は標準スキンです。別のスキンを選ぶと再試行します。'
    : bot.status === 'connected'
      ? '接続を維持したままPlayerSkinパケットで変更します。4D表示は参加先サーバーの対応状況に依存します。'
      : 'スキンは保存済みです。次回ワールド参加後にPlayerSkinパケットで自動適用します。'
}

function renderInventoryPanel () {
  const bot = selectedBot()
  const connected = bot?.status === 'connected'
  const playerMode = bot?.movementMode === 'player'
  const items = bot ? (state.inventoryByBot.get(bot.id) || []) : []
  const updatedAt = bot ? state.inventoryUpdatedAtByBot.get(bot.id) : null
  inventoryList.replaceChildren()
  inventorySelect.replaceChildren()

  if (!bot) {
    inventoryStatus.textContent = 'Botを選択してください。'
    inventoryList.append(createElement('div', 'inventory-empty', '表示できるインベントリはありません。'))
    inventorySelect.append(new Option('アイテムなし', ''))
  } else if (!connected) {
    inventoryStatus.textContent = 'ワールド参加中のBotを選択すると取得できます。'
    inventoryList.append(createElement('div', 'inventory-empty', 'Botがワールドに参加していません。'))
    inventorySelect.append(new Option('アイテムなし', ''))
  } else {
    inventoryStatus.textContent = updatedAt
      ? `最終取得：${new Date(updatedAt).toLocaleTimeString('ja-JP', { hour12: false })}`
      : 'インベントリを取得しています…'
    if (!items.length) inventoryList.append(createElement('div', 'inventory-empty', 'アイテムがないか、サーバーからの同期を待っています。'))
    for (const item of items.slice(0, 6)) {
      const row = createElement('div', 'inventory-item-row')
      const info = createElement('div', 'inventory-item-info')
      info.append(createElement('span', 'inventory-item-name', item.displayName || item.name))
      const enchantments = Array.isArray(item.enchantments) ? item.enchantments.map(enchantment => enchantment.label).filter(Boolean) : []
      if (enchantments.length) info.append(createElement('span', 'inventory-item-enchantments', enchantments.join(' · ')))
      row.append(createElement('span', 'inventory-slot', chatSlotLabel(item.slot)), info, createElement('strong', 'inventory-item-count', `× ${item.count}`))
      inventoryList.append(row)
    }
    if (items.length > 6) inventoryList.append(createElement('div', 'inventory-empty', `ほか ${items.length - 6} 種類は画像表示で確認できます。`))
    for (const item of items) inventorySelect.append(new Option(`${chatSlotLabel(item.slot)} · ${item.displayName || item.name}${item.enchantments?.length ? ' · ' + item.enchantments.map(enchantment => enchantment.label).join(' / ') : ''} × ${item.count}`, String(item.slot)))
    if (!items.length) inventorySelect.append(new Option('アイテムなし', ''))
  }

  const previousSlot = inventorySelect.value
  const wantedSlot = items.some(item => String(item.slot) === previousSlot) ? previousSlot : (items[0] ? String(items[0].slot) : '')
  inventorySelect.value = wantedSlot
  const selectedItem = items.find(item => String(item.slot) === wantedSlot)
  if (selectedItem) {
    dropItemCount.max = String(selectedItem.count)
    const currentCount = Number(dropItemCount.value)
    if (!Number.isInteger(currentCount) || currentCount < 1 || currentCount > selectedItem.count) dropItemCount.value = '1'
  } else {
    dropItemCount.max = '1'
    dropItemCount.value = '1'
  }
  inventorySelect.disabled = !connected || !items.length
  dropItemCount.disabled = !connected || !items.length
  document.getElementById('dropItemButton').disabled = !connected || !items.length
  dropAllItemsButton.disabled = !connected || !items.length
  openInventoryDialogButton.disabled = !connected
  refreshInventoryButton.disabled = !connected
  const inventoryActionNote = document.getElementById('inventoryActionNote')
  if (inventoryActionNote) inventoryActionNote.hidden = !connected || playerMode
  renderInventoryDialog()
  renderSkinPanel(bot)
}

async function loadSelectedBotData () {
  const bot = selectedBot()
  renderChatPanel()
  renderInventoryPanel()
  if (!bot) return
  const botId = bot.id
  api.getChatHistory(botId).then(messages => {
    if (state.selectedBotId !== botId) return
    state.chatMessagesByBot.set(botId, Array.isArray(messages) ? messages : [])
    renderChatPanel()
  }).catch(error => {
    if (state.selectedBotId === botId) showToast(error.message || 'チャット履歴を取得できませんでした。')
  })
  if (!bot || bot.status !== 'connected') {
    storeInventorySnapshot(botId, { items: [], gear: [], quickBarSlot: 0 })
    state.inventoryUpdatedAtByBot.delete(botId)
    renderInventoryPanel()
    return
  }
  api.getInventory(botId).then(snapshot => {
    if (state.selectedBotId !== botId) return
    storeInventorySnapshot(botId, snapshot)
    renderInventoryPanel()
  }).catch(error => {
    if (state.selectedBotId !== botId) return
    storeInventorySnapshot(botId, { items: [], gear: [], quickBarSlot: 0 })
    renderInventoryPanel()
    showToast(error.message || 'インベントリを取得できませんでした。')
  })
}


function renderPanelPager (container, currentPage, pageCount, onChange) {
  container.replaceChildren()
  if (pageCount <= 1) return
  const previous = createElement('button', '', '前へ')
  previous.type = 'button'
  previous.disabled = currentPage <= 0
  previous.addEventListener('click', () => onChange(currentPage - 1))
  const next = createElement('button', '', '次へ')
  next.type = 'button'
  next.disabled = currentPage >= pageCount - 1
  next.addEventListener('click', () => onChange(currentPage + 1))
  container.append(previous, createElement('span', '', `${currentPage + 1} / ${pageCount}`), next)
}

function resetServerProfileForm () {
  state.editingServerId = ''
  document.getElementById('serverLabel').value = ''
  document.getElementById('serverHost').value = ''
  document.getElementById('serverPort').value = '19132'
  document.getElementById('serverMode').value = 'auto'
  document.getElementById('serverSignallingUrl').value = ''
  document.getElementById('serverFormLabel').textContent = '接続先を登録'
  document.getElementById('serverFormTitle').textContent = '接続先を登録'
  serverForm.querySelector('button[type="submit"]').textContent = '接続先を登録'
}

function openServerProfileForm (server = null) {
  const panel = document.getElementById('serverFormPanel')
  document.getElementById('addBotFormPanel').hidden = true
  state.editingServerId = server?.id || ''
  document.getElementById('serverLabel').value = server?.label || ''
  document.getElementById('serverHost').value = server?.host || ''
  document.getElementById('serverPort').value = String(server?.port || 19132)
  document.getElementById('serverMode').value = server?.mode || 'auto'
  document.getElementById('serverSignallingUrl').value = server?.signallingUrl || ''
  const editing = Boolean(server)
  document.getElementById('serverFormLabel').textContent = editing ? '接続先を編集' : '接続先を登録'
  document.getElementById('serverFormTitle').textContent = editing ? '接続先を編集' : '接続先を登録'
  serverForm.querySelector('button[type="submit"]').textContent = editing ? '変更を保存' : '接続先を登録'
  panel.hidden = false
  document.getElementById('serverLabel').focus()
}

function renderServerProfiles () {
  serverProfileList.replaceChildren()
  serverProfileFooter.replaceChildren()
  if (!state.servers.length) {
    serverProfileList.append(createElement('div', 'server-empty', '接続先はまだ登録されていません。「接続先追加」またはThe Hiveプリセットから登録してください。'))
    return
  }
  const pageSize = 3
  const pageCount = Math.max(1, Math.ceil(state.servers.length / pageSize))
  state.serverPage = Math.min(state.serverPage, pageCount - 1)
  const pageServers = state.servers.slice(state.serverPage * pageSize, (state.serverPage + 1) * pageSize)
  for (const server of pageServers) {
    const row = createElement('div', 'server-profile-row')
    const info = createElement('div', 'server-profile-info')
    const configuredModeLabel = server.mode === 'http' ? 'NetherNet HTTP' : (server.mode === 'raknet' ? 'RakNet' : '自動判定')
    const successfulModeLabels = { raknet: 'RakNet', 'nethernet-http': 'NetherNet HTTP', 'nethernet-lan': 'NetherNet LAN' }
    const successfulModeLabel = successfulModeLabels[server.lastSuccessfulMode] || ''
    const successfulAt = server.lastSuccessfulAt ? new Date(server.lastSuccessfulAt).toLocaleString() : ''
    const historyLabel = successfulModeLabel
      ? ` · 前回成功: ${successfulModeLabel}${successfulAt ? `（${successfulAt}）` : ''}`
      : ''
    info.append(
      createElement('strong', 'server-profile-name', server.label),
      createElement('span', 'server-profile-address', `${server.host}:${server.port} · ${configuredModeLabel}${historyLabel}`)
    )
    const actions = createElement('div', 'server-profile-actions')
    const edit = createElement('button', 'secondary-button edit-server-button', '編集')
    edit.type = 'button'
    edit.addEventListener('click', () => openServerProfileForm(server))
    actions.append(edit)
    if (server.mode !== 'raknet') {
      const resetKey = createElement('button', 'secondary-button reset-server-key-button', '鍵をリセット')
      resetKey.type = 'button'
      resetKey.title = 'このPCに保存したサーバー公開鍵の信頼情報を削除し、次回接続時に再確認します。'
      resetKey.addEventListener('click', async () => {
        const confirmed = window.confirm(
          `「${server.label}」のサーバー鍵の信頼情報をリセットしますか？\n\n次回接続時に新しい公開鍵の確認画面が表示されます。Microsoft / Xboxのログイン情報は削除されません。`
        )
        if (!confirmed) return
        resetKey.disabled = true
        try {
          const result = await api.resetServerKey(server.id)
          showToast(result.reset
            ? 'サーバー鍵をリセットしました。次回接続時に新しい鍵を確認してください。'
            : 'この接続先には保存済みのサーバー鍵がありません。')
        } catch (error) {
          showToast(error.message || 'サーバー鍵をリセットできませんでした。')
        } finally {
          resetKey.disabled = false
        }
      })
      actions.append(resetKey)
    }
    const remove = createElement('button', 'icon-button danger', '削除')
    remove.type = 'button'
    remove.addEventListener('click', async () => {
      try { await api.removeServer(server.id) } catch (error) { showToast(error.message || '接続先を削除できませんでした。') }
    })
    actions.append(remove)
    row.append(info, actions)
    serverProfileList.append(row)
  }
  renderPanelPager(serverProfileFooter, state.serverPage, pageCount, (page) => {
    state.serverPage = page
    renderServerProfiles()
  })
}

function selectBot (botId) {
  if (!botId || botId === state.selectedBotId) return
  releaseAllHeldInputs(); clearToggledControls(state.selectedBotId, true); state.inventoryCursor = null; state.selectedBotId=botId; state.selectedModId='inventory'; renderBots(); renderBotModulesPanel(true); renderModStore(); loadSelectedBotData()
}
function renderBots () {
  botList.replaceChildren()
  const values = rootBots()
  const currentParent = parentBotFor(selectedBot())
  if (!currentParent || !values.some(bot => bot.id === currentParent.id)) {
    state.selectedBotId = values[0]?.id || ''
  }
  const selectedParentId = parentBotFor(selectedBot())?.id || ''
  emptyState.hidden=values.length>0
  document.getElementById('botCount').textContent=String(values.length)
  document.getElementById('onlineCount').textContent=String(values.filter(bot=>bot.status==='connected').length)
  document.getElementById('botListLabel').textContent=`${values.length} BOTS`
  botListFooter.replaceChildren()
  const pageSize=3, pageCount=Math.max(1,Math.ceil(values.length/pageSize))
  state.botPage=Math.min(state.botPage,pageCount-1)
  const visibleBots=values.slice(state.botPage*pageSize,(state.botPage+1)*pageSize)
  for (const bot of visibleBots) {
    const card = createElement('article', 'bot-card management-bot-card' + (bot.id === selectedParentId ? ' selected' : ''))
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.setAttribute('aria-selected', String(bot.id === selectedParentId))
    card.addEventListener('click', event => { if (!event.target.closest('button')) selectBot(bot.id) })
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
        event.preventDefault()
        selectBot(bot.id)
      }
    })

    const main = createElement('div', 'bot-main')
    const avatar = createElement('div', 'bot-avatar', bot.label.slice(0, 1).toUpperCase())
    const info = createElement('div')
    info.append(createElement('div', 'bot-name', bot.label))
    main.append(avatar, info)

    const statuses = createElement('div', 'bot-status-stack')
    statuses.append(
      createElement('span', 'status account-status ' + (bot.accountStatus || 'unverified'),
        accountStatusLabels[bot.accountStatus] || 'Xbox未確認'),
      createElement('span', 'status ' + bot.status, statusLabels[bot.status] || bot.status)
    )

    const actions = createElement('div', 'bot-actions management-bot-actions')
    const busy = bot.connectionActive || bot.status === 'connected' || ['connecting', 'joining', 'reconnecting'].includes(bot.status)
    const remove = createElement('button', 'icon-button danger', '削除')
    remove.type = 'button'
    remove.disabled = bot.accountStatus === 'authenticating' || busy
    remove.addEventListener('click', async event => {
      event.stopPropagation()
      const message = bot.label + 'と、このアカウントに追加したゲストBotを削除しますか？'
      if (!window.confirm(message)) return
      if (state.selectedBotId === bot.id) releaseAllHeldInputs()
      try { await api.removeBot(bot.id) } catch (error) { showToast(error.message) }
    })
    actions.append(remove)

    const line = createElement('div', 'management-bot-mainline compact-bot-row')
    line.append(main, statuses, actions)
    card.append(line)
    if (bot.accountError || bot.lastError) card.title = [bot.accountError, bot.lastError].filter(Boolean).join('\\n')
    botList.append(card)
  }
  renderPanelPager(botListFooter,state.botPage,pageCount,page=>{state.botPage=page;renderBots()})
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

function renderControlToggleButtons () {
  const active = state.toggledControlsByBot.get(state.selectedBotId) || {}
  for (const button of document.querySelectorAll('[data-toggle-control]')) {
    const control = button.dataset.toggleControl
    const enabled = active[control] === true
    button.classList.toggle('active', enabled)
    button.setAttribute('aria-pressed', String(enabled))
  }
}

async function toggleBotControl (botId, control) {
  if (!botId) return showToast('操作するBotを選択してください。')
  const bot = state.bots.get(botId)
  if (!bot || bot.status !== 'connected' || bot.movementMode !== 'player') {
    return showToast('Botをワールドに参加させ、プレイヤーモードにしてください。')
  }
  const current = { ...(state.toggledControlsByBot.get(botId) || {}) }
  const nextValue = current[control] !== true
  const next = { ...current, [control]: nextValue }
  state.toggledControlsByBot.set(botId, next)
  renderControlToggleButtons()
  try {
    await api.controlBot({ botId, control, active: nextValue })
  } catch (error) {
    state.toggledControlsByBot.set(botId, current)
    renderControlToggleButtons()
    showToast(error.message || 'トグル操作を変更できませんでした。')
  }
}

function clearToggledControls (botId, sendRelease = true) {
  if (!botId) return
  const active = state.toggledControlsByBot.get(botId) || {}
  state.toggledControlsByBot.delete(botId)
  renderControlToggleButtons()
  if (!sendRelease) return
  for (const control of ['sprint', 'sneak']) {
    if (active[control] === true) api.controlBot({ botId, control, active: false }).catch(() => {})
  }
}

function releaseAllHeldInputs () {
  state.toggleControlsPressed.clear()
  for (const source of Array.from(state.heldInputs.keys())) endControl(source)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const submit = form.querySelector('button[type="submit"]')
  submit.disabled = true
  try {
    const bot = await api.addBot({ label: document.getElementById('botLabel').value })
    state.bots.set(bot.id, bot)
    state.selectedBotId = bot.id
    state.botPage = Math.floor(Math.max(0, rootBots().length - 1) / 3)
    renderBots()
    renderBotModulesPanel(true)
    document.getElementById('botLabel').value = ''
    document.getElementById('addBotFormPanel').hidden = true
    renderBotModulesPanel(true)
    loadSelectedBotData()
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
  const editingServerId = state.editingServerId
  submit.disabled = true
  try {
    const payload = {
      label: document.getElementById('serverLabel').value,
      host: document.getElementById('serverHost').value,
      port: document.getElementById('serverPort').value,
      mode: document.getElementById('serverMode').value,
      signallingUrl: document.getElementById('serverSignallingUrl').value
    }
    const profile = editingServerId
      ? await api.updateServer({ ...payload, serverId: editingServerId })
      : await api.addServer(payload)
    const existingIndex = state.servers.findIndex(item => item.id === profile.id)
    if (existingIndex >= 0) state.servers[existingIndex] = profile
    else state.servers.push(profile)
    state.serverPage = Math.max(0, Math.ceil(state.servers.length / 3) - 1)
    renderServerProfiles()
    renderBots()
    document.getElementById('serverFormPanel').hidden = true
    resetServerProfileForm()
    showToast(editingServerId
      ? `接続先「${profile.label}」を更新しました。既に接続中のBotは次回接続から新しい設定を使用します。`
      : `接続先「${profile.label}」を登録しました。各Botの参加先から選べます。`)
  } catch (error) {
    showToast(error.message || (editingServerId ? '接続先を更新できませんでした。' : '接続先を登録できませんでした。'))
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
  selectBot(controlBotSelect.value)
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
  clearToggledControls(bot.id, false)
  try { await api.stopBot(bot.id) } catch (error) { showToast(error.message) }
}
document.getElementById('stopMovementButton').addEventListener('click', stopSelectedBot)
document.getElementById('clearControlsButton').addEventListener('click', stopSelectedBot)
for (const button of document.querySelectorAll('[data-toggle-control]')) {
  button.addEventListener('click', () => toggleBotControl(state.selectedBotId, button.dataset.toggleControl))
}

window.addEventListener('keydown', (event) => {
  const target = event.target
  if (target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
  const toggleControl = toggleKeyControls[event.code]
  if (toggleControl) {
    event.preventDefault()
    if (event.repeat || state.toggleControlsPressed.has(toggleControl)) return
    state.toggleControlsPressed.add(toggleControl)
    toggleBotControl(state.selectedBotId, toggleControl)
    return
  }
  const control = keyControls[event.code]
  if (!control || event.repeat) return
  event.preventDefault()
  startControl(`key:${event.code}`, state.selectedBotId, control)
})
window.addEventListener('keyup', (event) => {
  const toggleControl = toggleKeyControls[event.code]
  if (toggleControl) {
    state.toggleControlsPressed.delete(toggleControl)
    event.preventDefault()
    return
  }
  if (!keyControls[event.code]) return
  event.preventDefault()
  endControl(`key:${event.code}`)
})
window.addEventListener('blur', releaseAllHeldInputs)

// If a key was held while switching away from the app, release it when focus returns.
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllHeldInputs() })

chatInput.addEventListener('input', () => {
  sendChatButton.disabled = !selectedBot() || selectedBot().status !== 'connected' || !chatInput.value.trim()
})
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    chatForm.requestSubmit()
  }
})
chatForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const bot = selectedBot()
  const message = chatInput.value
  if (!bot) return showToast('チャットを送信するBotを選択してください。')
  if (!message.trim()) return
  sendChatButton.disabled = true
  try {
    await api.sendChat({ botId: bot.id, message })
    chatInput.value = ''
    renderChatPanel()
  } catch (error) {
    showToast(error.message || 'チャットを送信できませんでした。')
    renderChatPanel()
  }
})

inventorySelect.addEventListener('change', () => {
  const bot = selectedBot()
  const items = bot ? (state.inventoryByBot.get(bot.id) || []) : []
  const item = items.find(value => String(value.slot) === inventorySelect.value)
  if (item) {
    dropItemCount.max = String(item.count)
    dropItemCount.value = String(Math.min(Math.max(1, Number(dropItemCount.value) || 1), item.count))
  }
})
openInventoryDialogButton.addEventListener('click', () => {
  const bot = selectedBot()
  if (!bot || bot.status !== 'connected') return
  state.inventoryCursor = null
  renderInventoryDialog()
  if (!inventoryDialog.open) inventoryDialog.showModal()
})
document.getElementById('closeInventoryDialogButton').addEventListener('click', () => {
  state.inventoryCursor = null
  inventoryDialog.close()
})
inventoryDialog.addEventListener('cancel', event => {
  if (state.inventoryCursor) {
    event.preventDefault()
    state.inventoryCursor = null
    renderInventoryDialog()
  }
})
document.addEventListener('keydown', event => {
  if (!inventoryDialog.open || event.ctrlKey || event.altKey || event.metaKey) return
  if (/^[1-9]$/.test(event.key) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault()
    chooseHotbarSlot(Number(event.key) - 1)
  } else if (event.key === 'Escape' && state.inventoryCursor) {
    event.preventDefault()
    state.inventoryCursor = null
    renderInventoryDialog()
  }
})
importSkinButton.addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  importSkinButton.disabled = true
  try {
    const result = await api.importSkin(bot.id)
    if (result?.cancelled) return
    if (result?.bot) {
      state.bots.set(result.bot.id, result.bot)
      renderBots()
      renderBotModulesPanel(false)
      renderSkinPanel(result.bot)
    }
    if (result?.appliedLive) {
      showToast('接続を維持したままスキンを変更しました。4D表示はサーバー側の対応に依存します。')
    } else if (result?.applyError) {
      showToast('スキンは保存されましたが即時送信できませんでした: ' + result.applyError)
    } else {
      showToast('スキンを保存しました。次回ワールド参加後に自動適用します。')
    }
  } catch (error) {
    showToast(error.message || 'スキン素材を読み込めませんでした。')
  } finally {
    importSkinButton.disabled = !selectedBot() || selectedBot()?.modules?.skin?.assigned !== true
  }
})

skinHistoryButtons.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-skin-history-index]')
  const bot = selectedBot()
  if (!button || !bot || state.skinHistoryBusy) return
  const index = Number(button.dataset.skinHistoryIndex)
  state.skinHistoryBusy = true
  renderSkinPanel(bot)
  try {
    const result = await api.applySkinHistory({ botId: bot.id, index })
    if (result?.bot) {
      state.bots.set(result.bot.id, result.bot)
      renderBots()
      renderBotModulesPanel(false)
      renderSkinPanel(result.bot)
    }
    if (result?.appliedLive) showToast('最近使ったスキンに、接続を維持したまま変更しました。')
    else if (result?.applyError) showToast('スキンは保存されましたが即時送信できませんでした: ' + result.applyError)
    else showToast('スキンを切り替えました。次回ワールド参加後に自動適用します。')
  } catch (error) {
    showToast(error.message || 'スキン履歴を適用できませんでした。')
  } finally {
    state.skinHistoryBusy = false
    renderSkinPanel(selectedBot())
  }
})

refreshInventoryButton.addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  refreshInventoryButton.disabled = true
  try {
    const snapshot = await api.getInventory(bot.id)
    storeInventorySnapshot(bot.id, snapshot)
    renderInventoryPanel()
  } catch (error) {
    showToast(error.message || 'インベントリを更新できませんでした。')
  } finally {
    refreshInventoryButton.disabled = false
  }
})
dropItemForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const bot = selectedBot()
  if (!bot) return showToast('操作するBotを選択してください。')
  const slot = Number(inventorySelect.value)
  const count = Number(dropItemCount.value)
  const item = (state.inventoryByBot.get(bot.id) || []).find(value => value.slot === slot)
  if (!item) return showToast('投げるアイテムを選択してください。')
  if (!Number.isInteger(count) || count < 1 || count > item.count) return showToast('投げる個数を確認してください。')
  const button = document.getElementById('dropItemButton')
  button.disabled = true
  dropAllItemsButton.disabled = true
  try {
    const snapshot = await api.tossItem({ botId: bot.id, slot, count })
    storeInventorySnapshot(bot.id, snapshot)
    renderInventoryPanel()
    showToast(`${item.displayName || item.name} を ${count} 個投げました。`)
  } catch (error) {
    showToast(error.message || 'アイテムを投げられませんでした。')
  } finally {
    renderInventoryPanel()
  }
})

dropAllItemsButton.addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('操作するBotを選択してください。')
  if (bot.status !== 'connected') return showToast('ワールド参加中のBotを選択してください。')
  const items = state.inventoryByBot.get(bot.id) || []
  const totalCount = items.reduce((sum, item) => sum + (Number.isInteger(item.count) ? item.count : 0), 0)
  if (!items.length || totalCount < 1) return showToast('投げるアイテムがありません。')
  const confirmed = window.confirm(
    `「${bot.label}」のメインインベントリとホットバーにあるすべてのアイテムを地面に投げます。\n\n対象：${items.length}スタック / ${totalCount}個\n防具・オフハンドは対象外です。\nこの操作は取り消せません。実行しますか？`
  )
  if (!confirmed) return

  dropAllItemsButton.disabled = true
  document.getElementById('dropItemButton').disabled = true
  try {
    const snapshot = await api.tossAllItems({ botId: bot.id })
    storeInventorySnapshot(bot.id, snapshot)
    renderInventoryPanel()
    showToast(`${snapshot.droppedStacks}スタック・${snapshot.droppedItems}個を投げました。`)
  } catch (error) {
    try {
      const snapshot = await api.getInventory(bot.id)
      storeInventorySnapshot(bot.id, snapshot)
    } catch {}
    showToast(error.message || 'すべて投げる操作に失敗しました。')
  } finally {
    renderInventoryPanel()
  }
})

async function saveAndUpdateModules () {
  try {
    await saveModulesFromForm()
    showToast('BotModの設定を保存しました。')
  } catch (error) {
    showToast(error.message || 'Mod設定を保存できませんでした。')
  }
}

document.getElementById('moduleSaveButton').addEventListener('click', saveAndUpdateModules)
document.getElementById('supplySaveButton').addEventListener('click', saveAndUpdateModules)

document.getElementById('itemUseOnceButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('Botを選択してください。')
  const slot = Number(document.getElementById('moduleItemUseSelect').value)
  try {
    await saveModulesFromForm()
    await api.useItem({ botId: bot.id, slot })
  } catch (error) {
    showToast(error.message || 'アイテムを使用できませんでした。')
  }
})

document.getElementById('itemUseStartButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('Botを選択してください。')
  const slot = Number(document.getElementById('moduleItemUseSelect').value)
  try {
    await saveModulesFromForm()
    const updated = await api.startItemUse({ botId: bot.id, slot })
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('アイテム使用の連続使用を開始しました。')
  } catch (error) {
    showToast(error.message || '連続使用を開始できませんでした。')
  }
})

document.getElementById('itemUseStopButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  try {
    const updated = await api.stopItemUse(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('アイテム使用を停止しました。')
  } catch (error) { showToast(error.message || 'アイテム使用を停止できませんでした。') }
})

document.getElementById('supplyStartButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('Botを選択してください。')
  try {
    await saveModulesFromForm()
    const updated = await api.startContainerSupply(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('コンテナ補充を開始しました。')
  } catch (error) {
    showToast(error.message || 'コンテナ補充を開始できませんでした。')
  }
})

document.getElementById('addSupplyItemButton').addEventListener('click', () => addSupplyItemRow())

document.getElementById('autoFishingStartButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('Botを選択してください。')
  try {
    await saveModulesFromForm()
    const updated = await api.startAutoFishing(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('自動釣りを開始しました。')
  } catch (error) { showToast(error.message || '自動釣りを開始できませんでした。') }
})
document.getElementById('autoFishingStopButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  try {
    const updated = await api.stopAutoFishing(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('自動釣りを停止しました。')
  } catch (error) { showToast(error.message || '自動釣りを停止できませんでした。') }
})

document.getElementById('lookDirectionApplyButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('Botを選択してください。')
  const yawDeg = document.getElementById('lookDirectionYaw').value
  const pitchDeg = document.getElementById('lookDirectionPitch').value
  try {
    const updated = await api.setLookDirection({ botId: bot.id, yawDeg, pitchDeg })
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('指定した角度に視点を変更しました。')
  } catch (error) {
    showToast(error.message || 'Botの視点を変更できませんでした。')
  }
})

document.getElementById('supplyStopButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  try {
    const updated = await api.stopContainerSupply(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('コンテナ補充を停止しました。')
  } catch (error) { showToast(error.message || 'コンテナ補充を停止できませんでした。') }
})

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
  const previous = state.bots.get(bot.id)
  state.bots.set(bot.id, bot)
  if (previous?.status === 'connected' && bot.status !== 'connected') clearToggledControls(bot.id, false)
  renderBots()
  if (bot.id === state.selectedBotId) {
    renderBotModulesPanel(false)
    renderControlPanel()
    if (previous?.status !== bot.status) loadSelectedBotData()
  }
})
api.onBotRemoved((botId) => {
  const removedBot = state.bots.get(botId)
  state.bots.delete(botId)
  state.chatMessagesByBot.delete(botId)
  state.toggledControlsByBot.delete(botId)
  state.inventoryByBot.delete(botId)
  state.inventoryUpdatedAtByBot.delete(botId)
  state.inventoryGearByBot.delete(botId)
  state.inventoryQuickBarByBot.delete(botId)
  if (state.selectedBotId === botId) {
    state.selectedBotId = removedBot?.parentBotId && state.bots.has(removedBot.parentBotId)
      ? removedBot.parentBotId
      : ''
  }
  renderBots()
  renderBotModulesPanel(true)
  loadSelectedBotData()
})
api.onLog(appendLog)
api.onChatMessage((entry) => {
  const list = state.chatMessagesByBot.get(entry.botId) || []
  list.push(entry)
  if (list.length > 150) list.splice(0, list.length - 150)
  state.chatMessagesByBot.set(entry.botId, list)
  if (entry.botId === state.selectedBotId) renderChatPanel()
})
api.onInventoryUpdated((snapshot) => {
  storeInventorySnapshot(snapshot.botId, snapshot)
  if (snapshot.botId === state.selectedBotId) renderInventoryPanel()
})
api.onServersUpdated((servers) => {
  state.servers = Array.isArray(servers) ? servers : []
  renderServerProfiles()
  renderBots()
})
api.onModsUpdated((info) => {
  state.installedMods = Array.isArray(info?.installedMods) ? info.installedMods : []
  state.modCatalog = Array.isArray(info?.modCatalog) ? info.modCatalog : state.modCatalog
  renderModStore()
  renderBotModulesPanel(true)
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
  document.getElementById('serverKeyDescription').textContent = info.previouslyTrusted
    ? 'この接続元では以前に信頼した鍵とは異なる公開鍵が提示されました。サーバー側の構成変更やアカウントごとの接続先振り分けなどで起こる場合があります。接続先を確認し、心当たりがある場合のみ追加で信頼してください。承認しても、以前の鍵は削除されません。'
    : 'この接続先が提示した公開鍵です。初めて接続するサーバーなので、信頼する場合のみ承認してください。承認すると、このPCに鍵の指紋を保存し、次回以降は同じ鍵であることを確認します。'
  document.getElementById('approveServerKeyButton').textContent = info.previouslyTrusted ? 'この鍵を追加で信頼する' : 'この鍵を信頼する'
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
  let timeoutId
  const initial = await Promise.race([
    api.getState(),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('メインプロセスから初期状態が返りませんでした（15秒）。診断ログの [app:get-state] を確認してください。')), 15000)
    })
  ]).finally(() => clearTimeout(timeoutId))
  if (!initial || !Array.isArray(initial.bots) || !Array.isArray(initial.servers) || !Array.isArray(initial.logs)) {
    throw new Error('メインプロセスから不完全な初期データが返されました。')
  }
  document.getElementById('versionText').textContent = initial.version || '不明'
  document.getElementById('appVersionText').textContent = initial.appVersion ? `v${initial.appVersion}` : '不明'
  state.servers = initial.servers
  state.installedMods = Array.isArray(initial.installedMods) ? initial.installedMods : []
  state.modCatalog = Array.isArray(initial.modCatalog) ? initial.modCatalog : []
  for (const bot of initial.bots) state.bots.set(bot.id, bot)
  for (const entry of initial.logs) appendLog(entry)
  scheduleLogScroll(true)
  const pendingAuth = (initial.pendingAuthCodes || [])[0]
  if (pendingAuth) {
    state.authUrl = pendingAuth.verificationUri
    authCode.textContent = pendingAuth.userCode || 'コードを確認してください'
    authBotLabel.textContent = `${pendingAuth.botLabel} の認証`
    document.getElementById('authDescription').textContent = pendingAuth.message || '表示されたコードをMicrosoftの認証ページに入力してください。'
    if (!authDialog.open) authDialog.showModal()
  }
  if (!initial.logs.length) logList.append(createElement('div', 'log-empty', 'ログはまだありません。Botを認証・参加させるとここに表示されます。'))
  renderServerProfiles()
  renderBots()
  renderModStore()
  renderBotModulesPanel(true)
  initializeDashboardLayout()
  loadSelectedBotData()
}

if (bridgeMissing) showStartupFailure('Electronのpreloadブリッジ window.botApp が存在しません。')
initialise().catch(showStartupFailure)

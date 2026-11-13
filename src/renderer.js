'use strict'

const api = window.botApp
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
const serverKeyDialog = document.getElementById('serverKeyDialog')
const chatMessages = document.getElementById('chatMessages')
const chatForm = document.getElementById('chatForm')
const chatInput = document.getElementById('chatInput')
const sendChatButton = document.getElementById('sendChatButton')
const inventoryList = document.getElementById('inventoryList')
const inventoryStatus = document.getElementById('inventoryStatus')
const inventorySelect = document.getElementById('inventorySelect')
const dropItemCount = document.getElementById('dropItemCount')
const dropItemForm = document.getElementById('dropItemForm')
const refreshInventoryButton = document.getElementById('refreshInventoryButton')

const state = { bots: new Map(), servers: [], installedMods: [], modCatalog: [], authUrl: '', toastTimer: null, selectedBotId: '', heldInputs: new Map(), pendingWorldRequestId: '', pendingServerKeyRequestId: '', chatMessagesByBot: new Map(), inventoryByBot: new Map(), inventoryUpdatedAtByBot: new Map(), botPage: 0, serverPage: 0 }
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
  while (logList.children.length > 12) logList.firstElementChild.remove()
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
    document.getElementById('selectedFunctionBotName').textContent='Bot未選択';document.getElementById('selectedFunctionBotState').textContent='Botを選択してください。';return
  }
  name.textContent=bot.label;stateLabel.textContent=statusLabels[bot.status]||bot.status;stateLabel.className=`connection-status-label ${bot.status}`
  const busy=bot.status==='connected'||['connecting','joining','reconnecting'].includes(bot.status)
  targetSelect.append(new Option('参加先を選択…',''),new Option('フレンドのワールド（参加時に一覧表示）','friend-world'),new Option('LANワールド（検索して選択）','lan-world'),new Option('Realms（一覧から選択）','realm'))
  for(const server of state.servers)targetSelect.append(new Option(`サーバー：${server.label}`,`server:${server.id}`))
  targetSelect.value=bot.targetType==='server'?`server:${bot.targetId}`:(bot.targetType||'');targetSelect.disabled=bot.isGuest||busy
  if(bot.isGuest)helpers.append(createElement('div','connection-help-note','ゲストBotは親Botの参加先・接続状態を共有します。'))
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
  if(!bot.isGuest){
    const authBusy=bot.accountStatus==='authenticating'
    const auth=createElement('button','secondary-button account-button',authBusy?'Xbox認証中…':(['authenticated','saved'].includes(bot.accountStatus)?'認証を再確認':'Xbox認証'))
    auth.type='button';auth.disabled=authBusy||busy;auth.addEventListener('click',()=>api.authenticateBot(bot.id).catch(error=>showToast(error.message||'アカウント認証に失敗しました。')));actions.append(auth)
  }
  if(busy){
    const disconnect=createElement('button','primary-button disconnect-button',bot.isGuest?'ゲスト切断':'ワールド切断');disconnect.type='button';disconnect.addEventListener('click',()=>api.disconnectBot(bot.id).catch(error=>showToast(error.message||'切断できませんでした。')));actions.append(disconnect)
  }else if(bot.isGuest)actions.append(createElement('span','muted tiny','親Botの接続を待っています。'))
  else{
    const hasTarget=bot.targetType==='server'||bot.targetType==='friend-world'||(bot.targetType==='lan-world'&&!!bot.networkId)||(bot.targetType==='realm'&&/^\d+$/.test(String(bot.targetId||'')))
    const join=createElement('button','primary-button join-button',bot.status==='error'?'再参加':'ワールド参加');join.type='button';join.disabled=bot.accountStatus!=='authenticated'||!hasTarget
    join.title=!hasTarget?'先に接続先を選択してください。':(bot.accountStatus!=='authenticated'?'先にXbox認証を完了してください。':'選択した接続先に参加します。')
    join.addEventListener('click',()=>api.connectBot(bot.id).catch(error=>showToast(error.message||'ワールドに参加できませんでした。')));actions.append(join)
  }
  document.getElementById('selectedFunctionBotName').textContent=bot.label
  document.getElementById('selectedFunctionBotState').textContent=bot.isGuest?'ゲストBot':(accountStatusLabels[bot.accountStatus]||statusLabels[bot.status]||bot.status)
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
  renderSelectedConnectionControls(bot)
  selectedBotInfo.textContent = bot
    ? `${positionText(bot)}${bot.health != null ? `  ·  HP ${bot.health}` : ''}${bot.food != null ? `  ·  満腹度 ${bot.food}` : ''}`
    : 'Botを選択すると位置と状態が表示されます。'
  movementStatus.textContent = bot ? bot.movementStatus || '停止中' : '操作待機中'
  const reconnectStatus = document.getElementById('autoReconnectStatus')
  reconnectStatus.textContent = !bot ? 'Botを選択してください。' : (bot.isGuest ? '親Botの接続管理に連動します。' : (bot.autoReconnect?.status || '自動再接続は有効です。')) + (bot?.autoReconnect?.attempts ? ' · 再試行 ' + bot.autoReconnect.attempts + '回' : '')

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
  chatInput.disabled = !connected
  sendChatButton.disabled = !connected || !chatInput.value.trim()
  refreshInventoryButton.disabled = !connected
  inventorySelect.disabled = !connected || !(state.inventoryByBot.get(bot?.id) || []).length
  dropItemCount.disabled = !connected || !(state.inventoryByBot.get(bot?.id) || []).length
  document.getElementById('dropItemButton').disabled = !connected || !(state.inventoryByBot.get(bot?.id) || []).length
  renderBotModulesPanel(false)
}

function renderBotModulesPanel (refreshConfig = false) {
  const bot = selectedBot()
  const connected = bot?.status === 'connected'
  const modules = bot?.modules || {}
  const items = bot ? (state.inventoryByBot.get(bot.id) || []) : []
  const moduleSelectedBot = document.getElementById('moduleSelectedBot')
  const itemUseAssigned = document.getElementById('itemUseAssigned')
  const itemUseMode = document.getElementById('itemUseMode')
  const itemUseInterval = document.getElementById('itemUseInterval')
  const containerSupplyAssigned = document.getElementById('containerSupplyAssigned')
  const supplyX = document.getElementById('supplyX')
  const supplyY = document.getElementById('supplyY')
  const supplyZ = document.getElementById('supplyZ')
  const supplyItemName = document.getElementById('supplyItemName')
  const supplyTargetCount = document.getElementById('supplyTargetCount')
  const supplyInterval = document.getElementById('supplyInterval')
  const moduleItemUseSelect = document.getElementById('moduleItemUseSelect')

  if (!bot) {
    moduleSelectedBot.textContent = 'Botを追加して選択してください。'
  } else {
    moduleSelectedBot.textContent = bot.label + ' · ' + (connected ? 'ワールド参加中' : (statusLabels[bot.status] || bot.status))
  }

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

  const previousSupplyName = supplyItemName.value
  const desiredSupplyName = refreshConfig ? (modules.containerSupply?.itemName || '') : previousSupplyName
  const uniqueItems = new Map()
  for (const item of items) {
    if (!uniqueItems.has(item.name)) uniqueItems.set(item.name, item.displayName || item.name)
  }
  if (desiredSupplyName && !uniqueItems.has(desiredSupplyName)) uniqueItems.set(desiredSupplyName, desiredSupplyName)
  const supplyItemOptions = document.getElementById('supplyItemOptions')
  supplyItemOptions.replaceChildren()
  for (const [name, label] of uniqueItems) supplyItemOptions.append(new Option(label, name))
  supplyItemName.value = desiredSupplyName

  if (refreshConfig) {
    itemUseAssigned.checked = modules.itemUse?.assigned === true
    itemUseMode.value = modules.itemUse?.useMode === 'consume' ? 'consume' : 'activate'
    itemUseInterval.value = String(modules.itemUse?.intervalMs || 1500)
    containerSupplyAssigned.checked = modules.containerSupply?.assigned === true
    supplyX.value = modules.containerSupply?.x ?? ''
    supplyY.value = modules.containerSupply?.y ?? ''
    supplyZ.value = modules.containerSupply?.z ?? ''
    supplyTargetCount.value = String(modules.containerSupply?.targetCount || 64)
    supplyInterval.value = String(modules.containerSupply?.intervalMs || 5000)
  }

  const itemUseInstalled = state.installedMods.includes('itemUse')
  const containerSupplyInstalled = state.installedMods.includes('containerSupply')
  const anyModInstalled = itemUseInstalled || containerSupplyInstalled
  const status = bot?.moduleStatus || {}
  const summary = document.getElementById('selectedBotModSummary'), summaryCount = document.getElementById('selectedModCount'), settingsButton = document.getElementById('openSelectedModSettingsButton')
  if (summary) {
    summary.replaceChildren()
    const entries=[]
    if(itemUseInstalled)entries.push({name:'Item Use',assigned:modules.itemUse?.assigned===true,status:status.itemUse||'未実行',running:status.itemUseRunning===true})
    if(containerSupplyInstalled)entries.push({name:'Container Supply',assigned:modules.containerSupply?.assigned===true,status:status.containerSupply||'未実行',running:status.containerSupplyRunning===true})
    if(!bot)summary.append(createElement('div','server-empty','Botを選択してください。'))
    else if(!entries.length)summary.append(createElement('div','server-empty','利用可能なModはありません。「Mod一覧・追加」から導入できます。'))
    else for(const entry of entries){const row=createElement('div','selected-mod-row'),info=createElement('div','selected-mod-info');info.append(createElement('strong','',entry.name),createElement('span','',entry.status));row.append(info,createElement('span',entry.running?'mod-state running':(entry.assigned?'mod-state assigned':'mod-state'),entry.running?'実行中':(entry.assigned?'割り当て済み':'未割当')));summary.append(row)}
    if(summaryCount)summaryCount.textContent=entries.length+'件'
    if(settingsButton)settingsButton.disabled=!bot||!anyModInstalled
  }
  document.getElementById('modulePanel').hidden = !anyModInstalled
  document.getElementById('itemUseModuleCard').hidden = !itemUseInstalled
  document.getElementById('containerSupplyModuleCard').hidden = !containerSupplyInstalled
  const assignedUse = itemUseAssigned.checked
  const assignedSupply = containerSupplyAssigned.checked
  document.getElementById('itemUseStatus').textContent = status.itemUse || '未実行'
  document.getElementById('containerSupplyStatus').textContent = status.containerSupply || '未実行'
  const noBot = !bot
  itemUseAssigned.disabled = noBot || !itemUseInstalled
  itemUseMode.disabled = noBot || !itemUseInstalled || !assignedUse
  itemUseInterval.disabled = noBot || !itemUseInstalled || !assignedUse
  moduleItemUseSelect.disabled = !connected || !items.length
  document.getElementById('itemUseOnceButton').disabled = !connected || !assignedUse || !moduleItemUseSelect.value
  document.getElementById('itemUseStartButton').disabled = !connected || !assignedUse || !moduleItemUseSelect.value
  document.getElementById('itemUseStopButton').disabled = !bot || status.itemUseRunning !== true
  containerSupplyAssigned.disabled = noBot || !containerSupplyInstalled
  for (const input of [supplyX, supplyY, supplyZ, supplyTargetCount, supplyInterval, supplyItemName]) input.disabled = noBot || !containerSupplyInstalled || !assignedSupply
  document.getElementById('supplySaveButton').disabled = noBot
  document.getElementById('supplyStartButton').disabled = !connected || !assignedSupply
  document.getElementById('supplyStopButton').disabled = !bot || status.containerSupplyRunning !== true
  document.getElementById('moduleSaveButton').disabled = noBot || !anyModInstalled
}

function renderModStore () {
  const target = document.getElementById('modCatalogList')
  target.replaceChildren()
  for (const mod of state.modCatalog) {
    const installed = state.installedMods.includes(mod.id)
    const card = createElement('article', 'mod-catalog-card')
    const top = createElement('div', 'mod-catalog-top')
    const title = createElement('div', 'mod-catalog-title')
    title.append(createElement('strong', '', mod.name), createElement('span', '', 'v' + mod.version + ' · ' + mod.category))
    const status = createElement('span', installed ? 'mod-installed' : 'mod-not-installed', installed ? '導入済み' : '未導入')
    top.append(title, status)
    const description = createElement('p', 'muted tiny', mod.description)
    const button = createElement('button', installed ? 'secondary-button' : 'primary-button', installed ? 'アンインストール' : '導入')
    button.type = 'button'
    button.addEventListener('click', async () => {
      if (installed && !window.confirm('「' + mod.name + '」をアンインストールしますか？\n\n各Botへの割り当ては解除されますが、設定値は保持されます。')) return
      button.disabled = true
      try {
        const result = installed ? await api.uninstallMod(mod.id) : await api.installMod(mod.id)
        state.installedMods = result.installedMods || []
        renderModStore()
        renderBotModulesPanel(true)
        showToast('Mod「' + mod.name + '」を' + (installed ? 'アンインストール' : '導入') + 'しました。')
      } catch (error) {
        showToast(error.message || 'Modの状態を変更できませんでした。')
      } finally {
        button.disabled = false
      }
    })
    card.append(top, description, button)
    target.append(card)
  }
  if (!state.modCatalog.length) target.append(createElement('p', 'server-empty', '利用可能なModはありません。'))
}

function initializeDashboardLayout () {
  const addBotPanel = document.getElementById('addBotFormPanel')
  const serverFormPanel = document.getElementById('serverFormPanel')
  document.getElementById('openAddBotFormButton').addEventListener('click', () => {
    serverFormPanel.hidden = true; addBotPanel.hidden = !addBotPanel.hidden
    if (!addBotPanel.hidden) document.getElementById('botLabel').focus()
  })
  document.getElementById('openAddServerFormButton').addEventListener('click', () => {
    addBotPanel.hidden = true; serverFormPanel.hidden = !serverFormPanel.hidden
    if (!serverFormPanel.hidden) document.getElementById('serverLabel').focus()
  })
  document.getElementById('closeAddBotFormButton').addEventListener('click', () => { addBotPanel.hidden = true })
  document.getElementById('closeServerFormButton').addEventListener('click', () => { serverFormPanel.hidden = true })
  const settingsDialog = document.getElementById('selectedModSettingsDialog')
  const catalogDialog = document.getElementById('modCatalogDialog')
  document.getElementById('openSelectedModSettingsButton').addEventListener('click', () => { if (selectedBot() && state.installedMods.length && !settingsDialog.open) settingsDialog.showModal() })
  document.getElementById('closeSelectedModSettingsDialogButton').addEventListener('click', () => settingsDialog.close())
  document.getElementById('openModCatalogDialogButton').addEventListener('click', () => { if (!catalogDialog.open) catalogDialog.showModal() })
  document.getElementById('closeModCatalogDialogButton').addEventListener('click', () => catalogDialog.close())
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
  const modules = {
    itemUse: {
      assigned: document.getElementById('itemUseAssigned').checked,
      useMode: document.getElementById('itemUseMode').value,
      intervalMs: document.getElementById('itemUseInterval').value
    },
    containerSupply: {
      assigned: document.getElementById('containerSupplyAssigned').checked,
      x: document.getElementById('supplyX').value,
      y: document.getElementById('supplyY').value,
      z: document.getElementById('supplyZ').value,
      itemName: document.getElementById('supplyItemName').value,
      targetCount: document.getElementById('supplyTargetCount').value,
      intervalMs: document.getElementById('supplyInterval').value
    }
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
  const bot = selectedBot()
  chatMessages.replaceChildren()
  const entries = bot ? (state.chatMessagesByBot.get(bot.id) || []) : []
  if (!entries.length) {
    chatMessages.append(createElement('div', 'chat-empty', bot ? 'チャット履歴はありません。' : 'Botを選択してください。'))
  } else {
    for (const entry of entries.slice(-5)) {
      const row = createElement('div', `chat-message ${entry.direction === 'outgoing' ? 'outgoing' : 'incoming'}`)
      const meta = createElement('div', 'chat-message-meta')
      const time = new Date(entry.at).toLocaleTimeString('ja-JP', { hour12: false })
      meta.textContent = `${entry.direction === 'outgoing' ? '送信' : (entry.username || 'ワールド') } · ${time}`
      row.append(meta, createElement('div', 'chat-message-text', entry.message))
      chatMessages.append(row)
    }
  }
  const connected = bot?.status === 'connected'
  chatInput.disabled = !connected
  sendChatButton.disabled = !connected || !chatInput.value.trim()
}

function renderInventoryPanel () {
  const bot = selectedBot()
  const connected = bot?.status === 'connected'
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
      row.append(
        createElement('span', 'inventory-slot', chatSlotLabel(item.slot)),
        createElement('span', 'inventory-item-name', item.displayName || item.name),
        createElement('strong', 'inventory-item-count', `× ${item.count}`)
      )
      inventoryList.append(row)
    }
    if (items.length > 6) {
      inventoryList.append(createElement('div', 'inventory-empty', `ほか ${items.length - 6} 種類は下の選択欄から選べます。`))
    }
    if (items.length) {
      for (const item of items) inventorySelect.append(new Option(`${chatSlotLabel(item.slot)} · ${item.displayName || item.name} × ${item.count}`, String(item.slot)))
    } else {
      inventorySelect.append(new Option('アイテムなし', ''))
    }
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
  refreshInventoryButton.disabled = !connected
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
    state.inventoryByBot.set(botId, [])
    state.inventoryUpdatedAtByBot.delete(botId)
    renderInventoryPanel()
    return
  }
  api.getInventory(botId).then(snapshot => {
    if (state.selectedBotId !== botId) return
    state.inventoryByBot.set(botId, snapshot.items || [])
    state.inventoryUpdatedAtByBot.set(botId, snapshot.updatedAt || '')
    renderInventoryPanel()
  }).catch(error => {
    if (state.selectedBotId !== botId) return
    state.inventoryByBot.set(botId, [])
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

function renderServerProfiles () {
  serverProfileList.replaceChildren()
  serverProfileFooter.replaceChildren()
  if (!state.servers.length) {
    serverProfileList.append(createElement('div', 'server-empty', '接続先はまだ登録されていません。上のフォームまたはThe Hiveプリセットから追加してください。'))
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
  releaseAllHeldInputs(); state.selectedBotId=botId; renderBots(); renderBotModulesPanel(true); loadSelectedBotData()
}
function renderBots () {
  botList.replaceChildren()
  const values=Array.from(state.bots.values())
  if(!values.some(bot=>bot.id===state.selectedBotId)) state.selectedBotId=values[0]?.id||''
  emptyState.hidden=values.length>0
  document.getElementById('botCount').textContent=String(values.length)
  document.getElementById('onlineCount').textContent=String(values.filter(bot=>bot.status==='connected').length)
  document.getElementById('botListLabel').textContent=`${values.length} BOTS`
  botListFooter.replaceChildren()
  const pageSize=3, pageCount=Math.max(1,Math.ceil(values.length/pageSize))
  state.botPage=Math.min(state.botPage,pageCount-1)
  const visibleBots=values.slice(state.botPage*pageSize,(state.botPage+1)*pageSize)
  for(const bot of visibleBots){
    const card=createElement('article',`bot-card management-bot-card${bot.id===state.selectedBotId?' selected':''}`)
    card.tabIndex=0; card.setAttribute('role','button'); card.setAttribute('aria-selected',String(bot.id===state.selectedBotId))
    card.addEventListener('click',event=>{if(!event.target.closest('button'))selectBot(bot.id)})
    card.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button')){event.preventDefault();selectBot(bot.id)}})
    const main=createElement('div','bot-main'), avatar=createElement('div','bot-avatar',bot.label.slice(0,1).toUpperCase()), info=createElement('div')
    info.append(createElement('div','bot-name',bot.label))
    const parent=bot.isGuest?state.bots.get(bot.parentBotId):null
    const account=bot.isGuest?`親：${parent?.label||'親Bot'} · Guest ${bot.subClientId}`:(bot.playerName?`Xbox: ${bot.playerName}`:(bot.accountStatus==='authenticated'?'Xbox認証済み':(bot.accountStatus==='saved'?'認証情報保存済み':'Xbox未認証')))
    info.append(createElement('div','bot-player',account)); main.append(avatar,info)
    const statuses=createElement('div','bot-status-stack')
    statuses.append(createElement('span',`status account-status ${bot.isGuest?'shared':(bot.accountStatus||'unverified')}`,bot.isGuest?'ゲスト':(accountStatusLabels[bot.accountStatus]||'Xbox未確認')),createElement('span',`status ${bot.status}`,statusLabels[bot.status]||bot.status))
    const target=createElement('div','target-current management-bot-target',bot.isGuest?(bot.targetLabel||'親Botの接続先を共有'):(bot.targetLabel||'接続先未設定'))
    const actions=createElement('div','bot-actions management-bot-actions')
    if(!bot.isGuest){
      const guestCount=values.filter(item=>item.parentBotId===bot.id).length
      const guest=createElement('button','small-button guest-add-button',`＋ ゲスト ${guestCount}/3`)
      guest.type='button'; guest.disabled=guestCount>=3
      guest.addEventListener('click',async event=>{
        event.stopPropagation()
        const label=window.prompt('追加するゲストBotの表示名を入力してください。',`${bot.label}-Guest${guestCount+1}`.slice(0,32))
        if(label==null)return
        try{
          const added=await api.addGuestBot({parentBotId:bot.id,label})
          if(added?.id){state.bots.set(added.id,added);state.selectedBotId=added.id;state.botPage=Math.floor(Math.max(0,state.bots.size-1)/pageSize)}
          renderBots();renderBotModulesPanel(true);loadSelectedBotData();showToast('ゲストBotを追加しました。')
        }catch(error){showToast(error.message||'ゲストBotを追加できませんでした。')}
      })
      actions.append(guest)
    }
    const busy=bot.status==='connected'||['connecting','joining','reconnecting'].includes(bot.status)
    const remove=createElement('button','icon-button danger','削除'); remove.type='button'; remove.disabled=!bot.isGuest&&(bot.accountStatus==='authenticating'||busy)
    remove.addEventListener('click',async event=>{
      event.stopPropagation()
      const message=bot.isGuest?`${bot.label}を削除しますか？`:`${bot.label}と、このアカウントに追加したゲストBotを削除しますか？`
      if(!window.confirm(message))return
      if(state.selectedBotId===bot.id)releaseAllHeldInputs()
      try{await api.removeBot(bot.id)}catch(error){showToast(error.message)}
    })
    actions.append(remove)
    const top=createElement('div','management-bot-mainline');top.append(main,statuses)
    const bottom=createElement('div','management-bot-bottomline');bottom.append(target,actions)
    card.append(top,bottom)
    if(bot.accountError||bot.lastError)card.title=[bot.accountError,bot.lastError].filter(Boolean).join('\n')
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
    state.selectedBotId = bot.id
    state.botPage = Math.floor(Math.max(0, state.bots.size - 1) / 3)
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
  submit.disabled = true
  try {
    const profile = await api.addServer({
      label: document.getElementById('serverLabel').value,
      host: document.getElementById('serverHost').value,
      port: document.getElementById('serverPort').value,
      mode: document.getElementById('serverMode').value
    })
    if (!state.servers.some(item => item.id === profile.id)) state.servers.push(profile)
    state.serverPage = Math.max(0, Math.ceil(state.servers.length / 3) - 1)
    renderServerProfiles()
    renderBots()
    document.getElementById('serverLabel').value = ''
    document.getElementById('serverHost').value = ''
    document.getElementById('serverPort').value = '19132'
    document.getElementById('serverFormPanel').hidden = true
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
refreshInventoryButton.addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  refreshInventoryButton.disabled = true
  try {
    const snapshot = await api.getInventory(bot.id)
    state.inventoryByBot.set(bot.id, snapshot.items || [])
    state.inventoryUpdatedAtByBot.set(bot.id, snapshot.updatedAt || '')
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
  try {
    const snapshot = await api.tossItem({ botId: bot.id, slot, count })
    state.inventoryByBot.set(bot.id, snapshot.items || [])
    state.inventoryUpdatedAtByBot.set(bot.id, snapshot.updatedAt || '')
    renderInventoryPanel()
    showToast(`${item.displayName || item.name} を ${count} 個投げました。`)
  } catch (error) {
    showToast(error.message || 'アイテムを投げられませんでした。')
  } finally {
    renderInventoryPanel()
  }
})

for (const checkboxId of ['itemUseAssigned', 'containerSupplyAssigned']) {
  document.getElementById(checkboxId).addEventListener('change', () => renderBotModulesPanel(false))
}

async function saveAndUpdateModules () {
  try {
    await saveModulesFromForm()
    showToast('Botモジュールの設定を保存しました。')
  } catch (error) {
    showToast(error.message || 'モジュール設定を保存できませんでした。')
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
    showToast('Item Useの連続使用を開始しました。')
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
    showToast('Item Useを停止しました。')
  } catch (error) { showToast(error.message || 'Item Useを停止できませんでした。') }
})

document.getElementById('supplyStartButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return showToast('Botを選択してください。')
  try {
    await saveModulesFromForm()
    const updated = await api.startContainerSupply(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('Container Supplyを開始しました。')
  } catch (error) {
    showToast(error.message || 'Container Supplyを開始できませんでした。')
  }
})

document.getElementById('supplyStopButton').addEventListener('click', async () => {
  const bot = selectedBot()
  if (!bot) return
  try {
    const updated = await api.stopContainerSupply(bot.id)
    state.bots.set(updated.id, updated)
    renderBotModulesPanel(false)
    showToast('Container Supplyを停止しました。')
  } catch (error) { showToast(error.message || 'Container Supplyを停止できませんでした。') }
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
  renderBots()
  if (bot.id === state.selectedBotId) {
    renderBotModulesPanel(false)
    if (previous?.status !== bot.status) loadSelectedBotData()
  }
})
api.onBotRemoved((botId) => {
  state.bots.delete(botId)
  state.chatMessagesByBot.delete(botId)
  state.inventoryByBot.delete(botId)
  state.inventoryUpdatedAtByBot.delete(botId)
  if (state.selectedBotId === botId) state.selectedBotId = ''
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
  state.inventoryByBot.set(snapshot.botId, snapshot.items || [])
  state.inventoryUpdatedAtByBot.set(snapshot.botId, snapshot.updatedAt || '')
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
  const initial = await api.getState()
  document.getElementById('versionText').textContent = initial.version
  document.getElementById('appVersionText').textContent = initial.appVersion ? `v${initial.appVersion}` : '不明'
  state.servers = initial.servers || []
  state.installedMods = initial.installedMods || []
  state.modCatalog = initial.modCatalog || []
  for (const bot of initial.bots) state.bots.set(bot.id, bot)
  for (const entry of initial.logs) appendLog(entry)
  if (!initial.logs.length) logList.append(createElement('div', 'log-empty', 'ログはまだありません。Botを認証・参加させるとここに表示されます。'))
  renderServerProfiles()
  renderBots()
  renderModStore()
  renderBotModulesPanel(true)
  initializeDashboardLayout()
  loadSelectedBotData()
}

initialise().catch(error => showToast(`初期化エラー: ${error.message}`))

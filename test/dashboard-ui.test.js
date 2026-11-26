'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8')
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8')

function elementIds (source) {
  return [...source.matchAll(/id="([^"]+)"/g)].map(match => match[1])
}

function assertBalancedHtml (source) {
  const tokens = source.match(/<[^>]+>/g) || []
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const stack = []

  for (const token of tokens) {
    if (token.startsWith('<!') || token.startsWith('<!--')) continue
    const body = token.slice(1, -1).trim()
    const closing = body.startsWith('/')
    const tagBody = closing ? body.slice(1) : body
    const name = tagBody.split(/[ >\\/]/)[0].toLowerCase()
    if (!name) continue

    if (closing) {
      assert.equal(stack.pop(), name, 'Unexpected closing tag: ' + token)
    } else if (!voidTags.has(name) && !token.endsWith('/>')) {
      stack.push(name)
    }
  }

  assert.deepEqual(stack, [], 'HTML contains unclosed elements')
}

test('master-detail dashboard HTML is balanced and uses unique IDs', () => {
  assertBalancedHtml(html)
  const ids = elementIds(html)
  assert.equal(new Set(ids).size, ids.length, 'HTML contains duplicate IDs')
})

test('workspace uses one always-visible dashboard without tabs', () => {
  assert.ok(html.includes('class="dashboard-overview"'))
  assert.ok(html.includes('id="dashboardGrid" class="dashboard-grid"'))
  assert.equal(html.includes('workspace-tabs'), false)
  assert.equal(html.includes('data-view-target'), false)
  assert.equal(html.includes('data-dashboard-view'), false)
  assert.equal(renderer.includes('activateView'), false)
})

test('Bot and destination registration drawers start collapsed in the management panel', () => {
  for (const id of ['openAddBotFormButton', 'openAddServerFormButton', 'addBotFormPanel', 'serverFormPanel', 'botList', 'serverProfileList']) {
    assert.ok(elementIds(html).includes(id), 'Missing management element: ' + id)
  }
  assert.ok(html.includes('id="addBotFormPanel" class="management-drawer bot-form-drawer" hidden'))
  assert.ok(html.includes('id="serverFormPanel" class="management-drawer server-form-drawer" hidden'))
})

test('connection actions are attached to the selected Bot in the center panel', () => {
  for (const id of ['connectionBotName', 'connectionBotState', 'connectionActionButtons', 'controlTargetSelect', 'connectionTargetTools', 'selectedBotInfo']) {
    assert.ok(elementIds(html).includes(id), 'Missing selected-Bot connection element: ' + id)
  }
  assert.ok(renderer.includes('function renderSelectedConnectionControls(bot)'))
  assert.ok(renderer.includes('api.connectBot(bot.id)'))
  assert.ok(renderer.includes('api.disconnectBot(bot.id)'))
})

test('right panel is scoped to the selected Bot and keeps chat and logs visible', () => {
  for (const id of ['selectedFunctionBotName', 'selectedFunctionBotState', 'inventoryModuleCard', 'inventoryList', 'inventorySelect', 'selectedBotModSummary', 'selectedModCount', 'modulePanel', 'openModCatalogDialogButton', 'chatMessages', 'chatInput', 'logList']) {
    assert.ok(elementIds(html).includes(id), 'Missing dashboard element: ' + id)
  }
  assert.ok(renderer.includes('function selectedBot ()'))
  assert.ok(renderer.includes('snapshot.botId === state.selectedBotId'))
  assert.ok(renderer.includes('renderInventoryPanel()'))
})

test('registered Bots hide the empty-state message even though empty-state has a flex display rule', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  assert.match(renderer, /emptyState\.hidden\s*=\s*values\.length\s*>\s*0/)
  assert.match(styles, /\.empty-state\[hidden\]\s*\{\s*display:\s*none\s*!important;/)
})

test('Bot cards use shrink-safe rows and wrap their actions in narrow management panels', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  assert.match(styles, /\.management-bot-mainline\s*\{\s*display:\s*grid;/)
  assert.match(styles, /\.management-bot-bottomline\s*\{\s*display:\s*grid;/)
  assert.match(styles, /\.management-panel \.bot-main > div:last-child\s*\{\s*min-width:\s*0;/)
  assert.match(styles, /@container bot-management \(max-width:\s*235px\)/)
})

test('Bot controls fit a fixed panel without a scroll bar', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  const fit = styles.slice(styles.lastIndexOf('0.9.5: fixed Bot control layout'))
  assert.ok(html.includes('class="control-top-layout"'))
  assert.match(fit, /#dashboardGrid > \.control-panel[\s\S]*overflow-y: hidden !important/)
  assert.match(fit, /\.control-top-layout\s*\{[^}]*display:\s*grid;/s)
  assert.doesNotMatch(fit, /overflow-y:\s*auto/)
  assert.doesNotMatch(fit, /scrollbar-gutter/)
})


test('guest Bot naming dialog makes the name optional and previews the Tsukuyomi slot name', () => {
  for (const id of ['guestNameDialog', 'guestNameForm', 'guestBotNameInput', 'guestNameHint', 'guestNameError', 'cancelGuestNameButton', 'submitGuestNameButton']) {
    assert.ok(elementIds(html).includes(id), 'Missing guest-name dialog element: ' + id)
  }
  assert.match(html, /id="guestBotNameInput" type="text" maxlength="32" placeholder=""/)
  assert.doesNotMatch(html.match(/<input id="guestBotNameInput"[^>]*>/)?.[0] || '', /required/)
  assert.match(renderer, /function nextGuestSlotForParent \(/)
  assert.match(renderer, /guestBotNameInput\.placeholder = `\$\{parentBot\.label\} \(\$\{slot\}\)`/)
  assert.match(renderer, /guestNameForm\.addEventListener\('submit'/)
  assert.match(renderer, /api\.addGuestBot\(\{ parentBotId, label \}\)/)
  assert.match(renderer, /if \(label\.length > 32\)/)
  assert.doesNotMatch(renderer, /window\.prompt\s*\(/)
})


test('Bot operation panel exposes parent and guest selection plus guest connection actions', () => {
  assert.match(html, /<div class="control-select-row control-select-mode-row">/)
  assert.match(html, /操作するBot/)
  assert.match(html, /id="controlBotSelect"/)

  const selectControlsStart = renderer.indexOf('function renderSelectedConnectionControls')
  const selectControlsEnd = renderer.indexOf('function renderControlPanel', selectControlsStart)
  const selectedControls = renderer.slice(selectControlsStart, selectControlsEnd)
  assert.match(selectedControls, /openGuestNameDialog\(bot\)/)
  assert.match(selectedControls, /ゲスト接続/)
  assert.match(selectedControls, /api\.connectBot\(bot\.id\)/)
  assert.match(selectedControls, /api\.disconnectBot\(bot\.id\)/)
  assert.match(selectedControls, /ゲスト削除/)
  assert.match(selectedControls, /api\.removeBot\(bot\.id\)/)
  assert.match(renderer, /function botSelectorLabel \(bot\)/)
  assert.match(renderer, /Guest ' \+ bot\.subClientId/)

  const botListStart = renderer.indexOf('function renderBots ()')
  const botListEnd = renderer.indexOf('async function startControl', botListStart)
  const botListRenderer = renderer.slice(botListStart, botListEnd)
  assert.doesNotMatch(botListRenderer, /ゲスト追加/)
  assert.match(botListRenderer, /compact-bot-row/)
})

test('Bot list shows parent Bots only and the operation selector is scoped to the selected parent family', () => {
  assert.match(renderer, /function rootBots \(\) \{[\s\S]*filter\(bot => !bot\.parentBotId\)/)
  assert.match(renderer, /function currentBotFamily \(\) \{[\s\S]*filter\(bot => bot\.parentBotId === parent\.id\)/)
  assert.match(renderer, /const values = currentBotFamily\(\)/)
  assert.match(renderer, /const selectedParentId = parentBotFor\(selectedBot\(\)\)\?\.id/)

  const listStart = renderer.indexOf('function renderBots ()')
  const listEnd = renderer.indexOf('async function startControl', listStart)
  const listRenderer = renderer.slice(listStart, listEnd)
  assert.match(listRenderer, /const values = rootBots\(\)/)
  assert.doesNotMatch(listRenderer, /bot\.isGuest|Guest ' \+ bot\.subClientId/)
  assert.match(listRenderer, /selectedParentId/)
})

test('registered Bot list uses compact single-row cards', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  assert.match(styles, /\.management-panel \.compact-bot-row\s*\{\s*display:\s*flex;/)
  assert.match(styles, /\.management-panel \.bot-card\s*\{\s*min-height:\s*34px;/)
  assert.match(styles, /\.control-panel \.control-select-row\s*\{\s*display:\s*grid;/)
})

test('Bot Mods are selected inline and operation panel switches without assignment dialogs', () => {
  for (const id of ['inventoryModuleCard', 'selectedBotModSummary', 'selectedModCount', 'botMovementMode', 'botModeDescription', 'modulePanel', 'itemUseModuleCard', 'containerSupplyModuleCard', 'autoFishingModuleCard', 'lookDirectionModuleCard', 'lookDirectionYaw', 'lookDirectionPitch', 'lookDirectionApplyButton']) {
    assert.ok(elementIds(html).includes(id), 'Missing inline Mod element: ' + id)
  }
  for (const id of ['modAssignmentDialog', 'modAssignmentList', 'saveModAssignmentsButton', 'selectedModSettingsDialog', 'openSelectedModSettingsButton', 'openModAssignmentDialogButton']) {
    assert.equal(elementIds(html).includes(id), false, 'Obsolete separate assignment UI remains: ' + id)
  }
  assert.match(renderer, /selectedModId: 'inventory'/)
  assert.match(renderer, /const entries = descriptors\.filter\(entry => assigned\(entry\.id\)\)/)
  assert.match(renderer, /state\.selectedModId = entry\.id/)
  assert.match(renderer, /api\.setModAssignment\(\{ botId: currentBot\.id, modId: mod\.id, assigned: !assigned \}\)/)
  assert.match(renderer, /api\.installMod\(\{ botId: currentBot\.id, modId: mod\.id \}\)/)
  assert.match(renderer, /api\.setLookDirection\(\{ botId: bot\.id, yawDeg, pitchDeg \}\)/)
  assert.match(renderer, /api\.setBotMovementMode\(\{ botId: bot\.id, movementMode: select\.value \}\)/)
  assert.doesNotMatch(renderer, /renderModAssignmentDialog|saveModAssignments|modAssignmentDrafts/)
})

test('chunk-hold mode still allows inventory dropping while preventing player-input actions', () => {
  assert.match(renderer, /document\.getElementById\('dropItemButton'\)\.disabled = !connected \|\| !hasInventoryItems/)
  assert.match(renderer, /dropAllItemsButton\.disabled = !connected \|\| !hasInventoryItems/)
  assert.match(renderer, /refreshInventoryButton\.disabled = !connected/)
  assert.match(renderer, /button\.disabled = !connected \|\| !playerMode/)
  assert.match(renderer, /input\.disabled = !connected \|\| !playerMode \|\| !bot\.pathfinderReady/)
  assert.match(html, /チャンク保持モードでもアイテムの投棄は利用できます/)
})


test('selected Bot Mod workspace is readable, scrollable, and explains chunk-hold inventory limits', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  assert.match(styles, /\.selected-bot-panel\s*\{[^}]*overflow-y:\s*auto;/s)
  assert.match(styles, /#dashboardGrid \.selected-mod-summary\.selected-mod-switcher\s*\{[^}]*display:\s*grid;/s)
  assert.match(styles, /grid-template-columns:\s*repeat\(auto-fit, minmax\(78px, 1fr\)\)/)
  assert.match(styles, /#dashboardGrid \.selected-mod-switcher \.selected-mod-row\s*\{[^}]*width:\s*100%;/s)
  assert.match(styles, /\.selected-mod-switcher \.selected-mod-info span,[\s\S]*display:\s*none !important;/)
  assert.match(styles, /\.selected-mod-operation-panel \.inventory-list\s*\{[^}]*min-height:\s*120px;/s)
  assert.match(html, /id="inventoryActionNote" class="inventory-action-note" hidden/)
  assert.match(renderer, /inventoryActionNote\.hidden = !connected \|\| playerMode/)
  assert.match(renderer, /inventorySelect\.disabled = !connected \|\| !items\.length/)
  assert.match(renderer, /inventorySelect\.disabled = !connected \|\| !hasInventoryItems/)
  assert.match(renderer, /dropItemCount\.disabled = !connected \|\| !hasInventoryItems/)
})


test('Bot movement mode control is inside Bot operations and uses matching control styling', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  const controlStart = html.indexOf('data-panel-id="control"')
  const modPanelStart = html.indexOf('data-panel-id="selected-bot"')
  const movementMode = html.indexOf('id="botMovementMode"')
  const modeDescription = html.indexOf('id="botModeDescription"')
  assert.ok(movementMode > controlStart && movementMode < modPanelStart, 'Movement mode must be inside Bot operations')
  assert.ok(modeDescription > controlStart && modeDescription < modPanelStart, 'Movement mode description must be inside Bot operations')
  assert.match(html, /class="control-select-row control-select-mode-row"/)
  assert.doesNotMatch(html, /class="bot-mode-card"/)
  assert.match(html, /id="controlBotSelect"[^>]*>[\s\S]*id="botMovementMode"/)
  assert.match(styles, /\.control-panel \.control-select-mode-row\s*\{/)
  assert.match(styles, /\.control-panel \.control-select-mode-row \.bot-mode-field select\s*\{/)
  const controlRendererStart = renderer.indexOf('function renderControlPanel')
  const modRendererStart = renderer.indexOf('function renderBotModulesPanel', controlRendererStart)
  const controlRenderer = renderer.slice(controlRendererStart, modRendererStart)
  const modRenderer = renderer.slice(modRendererStart)
  assert.match(controlRenderer, /modeSelect\.value = playerMode \? 'player' : 'chunk-hold'/)
  assert.match(controlRenderer, /modeDescription\.textContent/)
  assert.doesNotMatch(modRenderer, /const modeSelect = document\.getElementById\('botMovementMode'\)/)
})

test('Mod operation panel appears above the installed-Mod switcher and add action', () => {
  const operationPanel = html.indexOf('id="modulePanel"')
  const switcher = html.indexOf('id="selectedBotModSummary"')
  const addMod = html.indexOf('id="openModCatalogDialogButton"')
  assert.ok(operationPanel >= 0 && switcher > operationPanel, 'Operation panel must precede Mod switch buttons')
  assert.ok(addMod > switcher, 'Add Mod action must be below the switch buttons')
  assert.match(html, /Mod切り替え/)
  assert.match(html, /class="selected-mod-summary selected-mod-switcher"/)
  assert.match(renderer, /button\.addEventListener\('click', \(\) => \{[\s\S]*state\.selectedModId = entry\.id/)
})


test('inventory panel offers individual and confirmed full-inventory dropping', () => {
  for (const id of ['dropItemButton', 'dropAllItemsButton', 'inventorySelect', 'dropItemCount']) {
    assert.match(html, new RegExp('id="' + id + '"'))
  }
  assert.match(renderer, /api\.tossAllItems\(\{ botId: bot\.id \}\)/)
  assert.match(renderer, /window\.confirm\([\s\S]*防具・オフハンドは対象外です/)
  assert.match(renderer, /dropAllItemsButton\.disabled = !connected \|\| !items\.length/)
  assert.match(renderer, /dropAllItemsButton\.disabled = !connected \|\| !hasInventoryItems/)
  assert.match(html, /class="drop-item-actions"/)
})

test('individual and full inventory drops wait for Bedrock stack request responses', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const dropModule = fs.readFileSync(path.join(__dirname, '..', 'src', 'inventory-drop.js'), 'utf8')
  assert.match(main, /await tossStackConfirmed\(agent, request\.item, request\.count\)/)
  assert.match(main, /await tossStackConfirmed\(agent, item, item\.count\)/)
  assert.match(dropModule, /itemStackResponse/)
  assert.ok(dropModule.includes("'アイテム投棄'"))
  assert.match(dropModule, /応答が届きませんでした/)
})


test('Bedrock inventory drops do not require player movement mode', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const singleStart = main.indexOf('async function tossBotItem')
  const bulkStart = main.indexOf('async function tossAllBotItems')
  const bulkEnd = main.indexOf('function publishModuleStatus', bulkStart)
  const singleDrop = main.slice(singleStart, bulkStart)
  const bulkDrop = main.slice(bulkStart, bulkEnd)
  assert.ok(singleStart >= 0 && bulkStart > singleStart && bulkEnd > bulkStart)
  assert.doesNotMatch(singleDrop, /requirePlayerMode/)
  assert.doesNotMatch(bulkDrop, /requirePlayerMode/)
})


test('graphical inventory exposes equipment, 27 main slots, 9 hotbar slots and server-backed move controls', () => {
  for (const id of ['openInventoryDialogButton', 'inventoryDialog', 'inventoryGearSlots', 'inventoryMainGrid', 'inventoryHotbarGrid', 'inventoryHotbarSelect', 'inventoryCursorStatus']) {
    assert.ok(elementIds(html).includes(id), 'Missing graphical inventory element: ' + id)
  }
  assert.ok(renderer.includes('for (let slot = 9; slot <= 35; slot++)'))
  assert.ok(renderer.includes('for (let slot = 36; slot <= 44; slot++)'))
  assert.ok(renderer.includes('api.moveInventoryItem({ botId: bot.id, fromSlot, toSlot'))
  assert.ok(renderer.includes('api.selectHotbarSlot({ botId: bot.id, slot })'))
  assert.ok(renderer.includes('contextmenu'))
  assert.ok(renderer.includes("event.dataTransfer.setData('text/plain'"))
})

test('custom skins expose PNG, geometry, animation and SkinStealer import actions', () => {
  for (const id of ['skinModuleCard', 'skinPreviewImage', 'skinName', 'skinDetails', 'importSkinButton', 'skinStatus']) {
    assert.ok(elementIds(html).includes(id), 'Missing skin element: ' + id)
  }
  assert.ok(renderer.includes('api.importSkin(bot.id)'))
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.match(main, /skinData: bot.skinData || undefined/)
  assert.ok(main.includes('validateSkinLoginData(bot.skinData)'))
  assert.match(main, /findMatchingFriendWorldSession/)
})

test('skin import uses separate file and folder dialogs so Windows can open individual files', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const picker = fs.readFileSync(path.join(__dirname, '..', 'src', 'skin-import-dialog.js'), 'utf8')
  assert.ok(main.includes('dialog.showMessageBox(mainWindow, skinImportChoiceOptions())'))
  assert.ok(main.includes('skinImportFileDialogOptions()'))
  assert.ok(main.includes('skinImportFolderDialogOptions()'))
  assert.doesNotMatch(main, /properties:\s*\['openFile',\s*'openDirectory'/)
  assert.ok(picker.includes("properties: ['openFile', 'multiSelections']"))
  assert.ok(picker.includes("properties: ['openDirectory', 'multiSelections']"))
})

test('world chat and connection logs retain scrollable history rather than rendering only the newest few lines', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  assert.ok(renderer.includes('entries.slice(-150)'))
  assert.ok(renderer.includes('logList.children.length > 300'))
  assert.ok(styles.includes('.chat-panel .chat-messages') && styles.includes('overflow-y: auto'))
  assert.ok(styles.includes('.log-panel .log-list') && styles.includes('overflow-y: auto'))
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  assert.ok(main.includes("agent.on('chat'"))
  assert.ok(main.includes("recordBotChatMessage(bot, 'incoming'"))
})


test('Skin Change is a selectable Mod inside the operation panel, not a separate card', () => {
  const moduleGrid = html.indexOf('class="module-grid"')
  const skinCard = html.indexOf('id="skinModuleCard"')
  assert.ok(moduleGrid >= 0 && skinCard > moduleGrid, 'Skin operation card must live inside the Mod operation grid')
  assert.ok(renderer.includes("{ id: 'skin', name: 'スキン変更'"))
  assert.ok(renderer.includes("skinModuleCard').hidden = selectedId !== 'skin'"))
  assert.ok(renderer.includes("moduleSaveButton').hidden = selectedId === 'inventory' || selectedId === 'skin'"))
  const registry = fs.readFileSync(path.join(__dirname, '..', 'src', 'mod-registry.js'), 'utf8')
  const modules = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules.js'), 'utf8')
  assert.ok(registry.includes("id: 'skin', name: 'スキン変更'"))
  assert.ok(modules.includes("skin: Object.freeze({ assigned: false })"))
})

test('dashboard fit keeps inventory actions and chat composer visible while logs stay compact and scrollable', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  const fit = styles.slice(styles.lastIndexOf('0.9.1 screenshot fit'))
  assert.ok(fit.includes('height: clamp(72px, 10vh, 96px)'))
  assert.ok(fit.includes('.chat-panel .chat-form'))
  assert.ok(fit.includes('min-height: 35px'))
  assert.ok(fit.includes('overflow-y: auto !important'))
  assert.ok(fit.includes('min-height: 0 !important'))
  assert.ok(fit.includes('gap: 1px'))
})


test('Bedrock world chat formats translation messages instead of showing raw translation keys', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const formatter = fs.readFileSync(path.join(__dirname, '..', 'src', 'chat-format.js'), 'utf8')
  assert.ok(main.includes('formatBedrockChatMessage(message, fallback)'))
  assert.ok(main.includes('messageObject || (translate ? { translate } : message)'))
  assert.ok(formatter.includes('multiplayer.player.joined'))
  assert.ok(formatter.includes('multiplayer.player.left'))
})

test('log history follows new entries and wraps complete messages inside the log panel', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  const fit = styles.slice(styles.lastIndexOf('0.9.4: preserve full connection messages'))
  assert.ok(renderer.includes('state.logAutoFollow'))
  assert.ok(renderer.includes("logList.addEventListener('scroll'"))
  assert.ok(renderer.includes('requestAnimationFrame'))
  assert.ok(renderer.includes('scheduleLogScroll(true)'))
  assert.ok(renderer.includes('const message = fullMessage'))
  assert.ok(fit.includes('white-space: pre-wrap !important'))
  assert.ok(fit.includes('overflow-wrap: anywhere !important'))
  assert.ok(fit.includes('height: auto !important'))
  assert.ok(fit.includes('overflow-y: auto !important'))
})

test('inventory icons use the Bedrock atlas and show a text fallback after image download failure', () => {
  const icons = fs.readFileSync(path.join(__dirname, '..', 'src', 'item-textures.js'), 'utf8')
  const inventory = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8')
  assert.ok(html.includes('<script src="item-textures.js"></script>'))
  assert.ok(inventory.includes('window.bedrockItemTextures?.getTextureUrls(item)'))
  assert.ok(inventory.includes("image.addEventListener('error'"))
  assert.ok(inventory.includes('fallback.hidden = false'))
  assert.ok(icons.includes('textures/items/apple'))
  assert.ok(icons.includes('textures/blocks/stone'))
})

test('inventory transfers wait for the Bedrock inventory window and the matching stack response', () => {
  const operations = fs.readFileSync(path.join(__dirname, '..', 'src', 'inventory-ops.js'), 'utf8')
  assert.ok(operations.includes('openPlayerInventory(agent)'))
  assert.ok(operations.includes('await waitForInventoryWindow(agent'))
  assert.ok(operations.includes('createItemStackResponseWaiter(agent, requestId'))
  assert.ok(operations.includes('await waiter.promise'))
  assert.ok(operations.includes('try { closeInventory() } catch {}'))
})

test('Control is the sprint latch and Shift is the sneak latch', () => {
  const keyboard = fs.readFileSync(path.join(__dirname, '..', 'src', 'control-keys.js'), 'utf8')
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8')
  assert.ok(html.includes('data-toggle-control="sprint"'))
  assert.ok(html.includes('data-toggle-control="sneak"'))
  assert.ok(html.includes('<kbd>Ctrl</kbd>'))
  assert.ok(html.includes('<kbd>Shift</kbd>'))
  assert.ok(keyboard.includes("ControlLeft: 'sprint'"))
  assert.ok(keyboard.includes("ShiftLeft: 'sneak'"))
  assert.ok(rendererSource.includes('state.toggleControlsPressed'))
  assert.ok(rendererSource.includes('toggleBotControl(state.selectedBotId, toggleControl)'))
  assert.ok(rendererSource.includes('clearToggledControls(bot.id, false)'))
})

test('importing a Persona BIN reconnects an active Bot through saved login skinData', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const importer = fs.readFileSync(path.join(__dirname, '..', 'src', 'skin-import.js'), 'utf8')
  const parser = fs.readFileSync(path.join(__dirname, '..', 'src', 'skin-bin.js'), 'utf8')
  assert.ok(importer.includes('decodeTsukuyomiPersonaSkinBin'))
  assert.ok(importer.includes('personaBin?.resourcePatch'))
  assert.ok(parser.includes('parsePersonaMetadataTail'))
  assert.ok(parser.includes('personaPieces'))
  assert.ok(parser.includes('pieceTintColors'))
  assert.ok(main.includes('reconnectWithSavedSkin(bot'))
  assert.ok(main.includes('waitForBotSpawn'))
  assert.match(main, /skinData: bot\.skinFallbackActive \? undefined : \(bot\.skinData \? validateSkinLoginData\(bot\.skinData\) : undefined\)/)
})


test('inventory screen uses Bedrock 1.26.60 OpenInventory action for cross-section transfers', () => {
  const operations = fs.readFileSync(path.join(__dirname, '..', 'src', 'inventory-ops.js'), 'utf8')
  assert.ok(operations.includes('action_id: 6'))
  assert.ok(operations.includes("queue('interact', packet)"))
  assert.ok(operations.includes('await waitForInventoryWindow(agent'))
  assert.ok(operations.includes('openPlayerInventory(agent)'))
})

test('inventory UI displays enchantment labels and locks slots during confirmed moves', () => {
  assert.ok(renderer.includes('inventory-item-enchantments'))
  assert.ok(renderer.includes('inventory-enchantment-mark'))
  assert.ok(renderer.includes('state.inventoryMovePending'))
  const actions = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot-actions.js'), 'utf8')
  assert.ok(actions.includes('extractItemEnchantments'))
  assert.ok(actions.includes('enchantments: extractItemEnchantments(item, agent.registry)'))
})

test('friend-world selection, guest reconnect and active Mods distinguish automatic reconnects', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
  const policy = fs.readFileSync(path.join(__dirname, '..', 'src', 'reconnect-policy.js'), 'utf8')
  assert.ok(main.includes('askForWorldSelection(bot, sessions, attemptId, options.reconnect === true)'))
  assert.ok(main.includes('if (options.reconnect) {\n      reconnectGuestBots(bot)'))
  assert.ok(main.includes('getReconnectableGuestBots(Array.from(bots.values()), parent.id)'))
  assert.ok(main.includes('async function waitForGuestConnectionRelease (guest'))
  assert.ok(main.includes('await waitForGuestConnectionRelease(guest)'))
  assert.ok(main.includes('autoReconnectEligible = true'))
  assert.ok(main.includes('bot.autoReconnectEligible = false'))
  assert.ok(main.includes('scheduleBotModuleResume(bot, agent, options.reconnect === true)'))
  assert.ok(main.includes('await setBotLookDirection(bot.id, snapshot.lookDirection)'))
  assert.ok(policy.includes('guest.autoReconnectEligible === true'))
  assert.ok(policy.includes('startsWith(\'適用済み\')'))
})

test('manual Bot controls remain non-scrollable after the compact layout rules', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  const fit = styles.slice(styles.lastIndexOf('0.9.5: fixed Bot control layout'))
  assert.match(fit, /overflow-y: hidden !important/)
  assert.doesNotMatch(fit, /overflow-y:\s*auto/)
})

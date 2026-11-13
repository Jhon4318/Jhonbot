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
  for (const id of ['selectedFunctionBotName', 'inventoryList', 'inventorySelect', 'selectedBotModSummary', 'openSelectedModSettingsButton', 'openModCatalogDialogButton', 'chatMessages', 'chatInput', 'logList']) {
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

test('compact control panels scroll to diagnostics instead of clipping them', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  assert.match(styles, /\.control-panel\s*\{[^}]*overflow-y:\s*auto;/s)
  assert.match(styles, /\.control-panel > \.diagnostic-card\s*\{\s*flex:\s*0 0 auto;/)
})

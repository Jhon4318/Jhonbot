'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8')
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8')

function elementIds (source) {
  return [...source.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1])
}

function assertBalancedHtml (source) {
  const tokens = source.match(/<!--[\\s\\S]*?-->|<![^>]*>|<\\/?[A-Za-z][^>]*>/g) || []
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const stack = []

  for (const token of tokens) {
    if (token.startsWith('<!') || token.startsWith('<!--')) continue
    const closing = token.startsWith('</')
    const name = (token.match(/^<\\/?([A-Za-z][\\w:-]*)/) || [])[1]?.toLowerCase()
    if (!name) continue

    if (closing) {
      assert.equal(stack.pop(), name, `Unexpected closing tag: ${token}`)
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
  assert.match(html, /class="dashboard-overview"/)
  assert.match(html, /id="dashboardGrid" class="dashboard-grid"/)
  assert.doesNotMatch(html, /workspace-tabs|data-view-target|data-dashboard-view/)
  assert.doesNotMatch(renderer, /initializeDashboardLayout[\\s\\S]*?activateView/)
})

test('Bot and destination registration drawers start collapsed in the management panel', () => {
  assert.match(html, /id="openAddBotFormButton"/)
  assert.match(html, /id="openAddServerFormButton"/)
  assert.match(html, /id="addBotFormPanel"[^>]*hidden/)
  assert.match(html, /id="serverFormPanel"[^>]*hidden/)
  assert.match(html, /id="botList"/)
  assert.match(html, /id="serverProfileList"/)
})

test('connection actions are attached to the selected Bot in the center panel', () => {
  for (const id of ['connectionBotName', 'connectionBotState', 'connectionActionButtons', 'controlTargetSelect', 'connectionTargetTools', 'selectedBotInfo']) {
    assert.ok(elementIds(html).includes(id), `Missing selected-Bot connection element: ${id}`)
  }
  assert.match(renderer, /function renderSelectedConnectionControls\\(bot\\)/)
  assert.match(renderer, /api\\.connectBot\\(bot\\.id\\)/)
  assert.match(renderer, /api\\.disconnectBot\\(bot\\.id\\)/)
})

test('right panel is scoped to the selected Bot and keeps chat and logs visible', () => {
  for (const id of ['selectedFunctionBotName', 'inventoryList', 'inventorySelect', 'selectedBotModSummary', 'openSelectedModSettingsButton', 'openModCatalogDialogButton', 'chatMessages', 'chatInput', 'logList']) {
    assert.ok(elementIds(html).includes(id), `Missing dashboard element: ${id}`)
  }
  assert.match(renderer, /function selectedBot \\(\\)/)
  assert.match(renderer, /if \\(snapshot\\.botId === state\\.selectedBotId\\) renderInventoryPanel\\(\\)/)
})

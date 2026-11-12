'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeDashboardLayout } = require('../src/dashboard-layout')

test('creates a default ordered layout for known panels', () => {
  const layout = normalizeDashboardLayout(null, ['overview', 'bots', 'logs'])
  assert.deepEqual(layout.order, ['overview', 'bots', 'logs'])
  assert.equal(layout.panels.overview.span, 12)
  assert.equal(layout.panels.bots.span, 12)
  assert.equal(layout.panels.logs.height, 0)
})

test('preserves valid order and removes unknown or duplicate panel IDs', () => {
  const layout = normalizeDashboardLayout({ order: ['logs', 'unknown', 'logs'] }, ['overview', 'logs'])
  assert.deepEqual(layout.order, ['logs', 'overview'])
})

test('clamps invalid widths and heights to safe defaults', () => {
  const layout = normalizeDashboardLayout({
    order: [],
    panels: { overview: { span: 5, height: 99999 } }
  }, ['overview'])
  assert.equal(layout.panels.overview.span, 12)
  assert.equal(layout.panels.overview.height, 0)
})

test('accepts resized panel dimensions in the supported range', () => {
  const layout = normalizeDashboardLayout({ panels: { control: { span: 8, height: 480 } } }, ['control'])
  assert.deepEqual(layout.panels.control, { span: 8, height: 480 })
})

(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.jhonbotDashboardLayout = api
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict'

  const DEFAULT_SPANS = Object.freeze({
    overview: 12,
    'add-bot': 6,
    servers: 12,
    bots: 12,
    control: 6,
    interaction: 6,
    'mod-store': 6,
    'module-operations': 12,
    logs: 12
  })
  const ALLOWED_SPANS = new Set([3, 4, 6, 8, 9, 12])

  function normalizeDashboardLayout (input, panelIds) {
    const ids = [...new Set((Array.isArray(panelIds) ? panelIds : []).filter(id => typeof id === 'string'))]
    const allowed = new Set(ids)
    const savedOrder = Array.isArray(input?.order) ? input.order.filter(id => allowed.has(id)) : []
    const order = [...new Set(savedOrder)]
    for (const id of ids) if (!order.includes(id)) order.push(id)

    const panels = {}
    for (const id of ids) {
      const saved = input?.panels?.[id] || {}
      const rawSpan = Number(saved.span)
      const span = ALLOWED_SPANS.has(rawSpan) ? rawSpan : (DEFAULT_SPANS[id] || 6)
      const rawHeight = Number(saved.height)
      const height = Number.isFinite(rawHeight) && rawHeight >= 220 && rawHeight <= 1200
        ? Math.round(rawHeight)
        : 0
      panels[id] = { span, height }
    }
    return { order, panels }
  }

  return { DEFAULT_SPANS, ALLOWED_SPANS, normalizeDashboardLayout }
})

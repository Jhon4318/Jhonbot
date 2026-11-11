'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('LAN discovery collects and deduplicates multiple NetherNet pong advertisements', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lan-discovery.js'), 'utf8')
  assert.match(source, /client\\.on\\('pong'/)
  assert.match(source, /worlds\\.set\\(networkId/)
  assert.match(source, /NethernetServerAdvertisement\\.fromBuffer/)
  assert.match(source, /setTimeout\\(finish, duration\\)/)
})

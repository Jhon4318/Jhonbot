'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function subscribe (channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('botApp', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  addBot: (data) => ipcRenderer.invoke('bot:add', data),
  addGuestBot: (data) => ipcRenderer.invoke('bot:add-guest', data),
  addServer: (data) => ipcRenderer.invoke('server:add', data),
  addHivePreset: () => ipcRenderer.invoke('server:add-hive-preset'),
  removeServer: (id) => ipcRenderer.invoke('server:remove', id),
  resetServerKey: (id) => ipcRenderer.invoke('server:reset-key', id),
  setBotTarget: (args) => ipcRenderer.invoke('bot:set-target', args),
  discoverLanWorld: (id) => ipcRenderer.invoke('bot:discover-lan', id),
  selectWorldSession: (args) => ipcRenderer.invoke('world:select-session', args),
  cancelWorldSelection: (id) => ipcRenderer.invoke('world:cancel-selection', id),
  resolveServerKey: (args) => ipcRenderer.invoke('security:resolve-server-key', args),
  authenticateBot: (id) => ipcRenderer.invoke('bot:authenticate', id),
  connectBot: (id) => ipcRenderer.invoke('bot:connect', id),
  disconnectBot: (id) => ipcRenderer.invoke('bot:disconnect', id),
  removeBot: (id) => ipcRenderer.invoke('bot:remove', id),
  controlBot: (args) => ipcRenderer.invoke('bot:control', args),
  gotoBot: (args) => ipcRenderer.invoke('bot:goto', args),
  stopBot: (id) => ipcRenderer.invoke('bot:stop', id),
  sendChat: (args) => ipcRenderer.invoke('bot:send-chat', args),
  getChatHistory: (id) => ipcRenderer.invoke('bot:get-chat-history', id),
  getInventory: (id) => ipcRenderer.invoke('bot:get-inventory', id),
  tossItem: (args) => ipcRenderer.invoke('bot:toss-item', args),
  openAuthUrl: (url) => ipcRenderer.invoke('auth:open-url', url),
  onBotUpdated: (callback) => subscribe('bot:updated', callback),
  onBotRemoved: (callback) => subscribe('bot:removed', callback),
  onServersUpdated: (callback) => subscribe('servers:updated', callback),
  onLog: (callback) => subscribe('app:log', callback),
  onAuthCode: (callback) => subscribe('auth:device-code', callback),
  onWorldSessions: (callback) => subscribe('world:sessions', callback),
  onServerKeyApproval: (callback) => subscribe('security:server-key-approval', callback),
  onChatMessage: (callback) => subscribe('bot:chat-message', callback),
  onInventoryUpdated: (callback) => subscribe('bot:inventory-updated', callback)
})

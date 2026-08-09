const { contextBridge, ipcRenderer } = require('electron');

// 与 src/main/ipc.js 中的通道名保持一致
const CHANNELS = {
  chatSend: 'chat:send',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get',
  memoryList: 'memory:list',
  memoryDelete: 'memory:delete',
  memoryUpdate: 'memory:update'
};

contextBridge.exposeInMainWorld('petAPI', {
  platform: process.platform,
  version: '0.1.0',
  chat: {
    send: (payload) => ipcRenderer.invoke(CHANNELS.chatSend, payload)
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch)
  },
  window: {
    hide: () => ipcRenderer.invoke(CHANNELS.windowHide)
  },
  history: {
    get: () => ipcRenderer.invoke(CHANNELS.historyGet)
  },
  memory: {
    list: () => ipcRenderer.invoke(CHANNELS.memoryList),
    delete: (id) => ipcRenderer.invoke(CHANNELS.memoryDelete, id),
    update: (id, patch) => ipcRenderer.invoke(CHANNELS.memoryUpdate, id, patch)
  }
});

const { contextBridge, ipcRenderer } = require('electron');

// 与 src/main/ipc.js 中的通道名保持一致
const CHANNELS = {
  chatSend: 'chat:send',
  chatSendStream: 'chat:send-stream',
  chatDelta: 'chat:delta',
  chatStreamCancel: 'chat:stream-cancel',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get',
  idleEvent: 'idle:event',
  activityPoke: 'activity:poke'
};

contextBridge.exposeInMainWorld('petAPI', {
  platform: process.platform,
  version: '0.1.0',
  chat: {
    send: (payload) => ipcRenderer.invoke(CHANNELS.chatSend, payload),
    sendStream: (payload) => ipcRenderer.invoke(CHANNELS.chatSendStream, payload),
    onDelta: (callback) => {
      const listener = (_event, payload) => {
        if (
          typeof callback === 'function' &&
          payload &&
          typeof payload.delta === 'string'
        ) {
          callback(payload.delta);
        }
      };
      ipcRenderer.on(CHANNELS.chatDelta, listener);
      return () => ipcRenderer.removeListener(CHANNELS.chatDelta, listener);
    },
    cancelStream: () => ipcRenderer.invoke(CHANNELS.chatStreamCancel)
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
  idle: {
    onTrigger: (cb) => {
      const listener = (_event, payload) => {
        if (typeof cb === 'function') {
          cb(payload);
        }
      };
      ipcRenderer.on(CHANNELS.idleEvent, listener);
      return () => ipcRenderer.removeListener(CHANNELS.idleEvent, listener);
    },
    poke: () => ipcRenderer.send(CHANNELS.activityPoke)
  }
});

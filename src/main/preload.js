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
  activityPoke: 'activity:poke',
  moodGet: 'mood:get',
  memoryList: 'memory:list',
  memoryDelete: 'memory:delete',
  memoryUpdate: 'memory:update',
  historyExport: 'history:export',
  historyClear: 'history:clear',
  weatherGet: 'weather:get',
  windowToggleDock: 'window:toggle-dock',
  windowMinimize: 'window:minimize', // T-25：最小化到任务栏（ADR-026 冻结契约）
  ttsSpeak: 'tts:speak', // T-34：在线神经语音合成（ADR-029）
  licenseGet: 'license:get', // T-40：许可证状态
  licenseActivate: 'license:activate', // T-40：激活
  licenseDeactivate: 'license:deactivate' // T-40：注销激活
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
    hide: () => ipcRenderer.invoke(CHANNELS.windowHide),
    toggleDock: () => ipcRenderer.invoke(CHANNELS.windowToggleDock),
    minimize: () => ipcRenderer.invoke(CHANNELS.windowMinimize) // T-25
  },
  history: {
    get: () => ipcRenderer.invoke(CHANNELS.historyGet),
    export: (payload) => ipcRenderer.invoke(CHANNELS.historyExport, payload),
    clear: (payload) => ipcRenderer.invoke(CHANNELS.historyClear, payload)
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
  },
  mood: {
    get: () => ipcRenderer.invoke(CHANNELS.moodGet)
  },
  memory: {
    list: () => ipcRenderer.invoke(CHANNELS.memoryList),
    delete: (id) => ipcRenderer.invoke(CHANNELS.memoryDelete, id),
    update: (id, patch) => ipcRenderer.invoke(CHANNELS.memoryUpdate, id, patch)
  },
  weather: {
    get: (payload) => ipcRenderer.invoke(CHANNELS.weatherGet, payload)
  },
  tts: {
    speak: (payload) => ipcRenderer.invoke(CHANNELS.ttsSpeak, payload) // T-34
  },
  license: {
    get: () => ipcRenderer.invoke(CHANNELS.licenseGet), // T-40
    activate: (code) => ipcRenderer.invoke(CHANNELS.licenseActivate, { code }), // T-40
    deactivate: () => ipcRenderer.invoke(CHANNELS.licenseDeactivate) // T-40
  }
});

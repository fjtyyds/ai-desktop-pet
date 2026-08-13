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
  shareSaveCard: 'share:save-card', // T-45：保存对话卡片 PNG
  shareCopyCard: 'share:copy-card', // T-45：复制对话卡片到剪贴板
  memoryList: 'memory:list',
  memoryDelete: 'memory:delete',
  memoryUpdate: 'memory:update',
  historyExport: 'history:export',
  historyClear: 'history:clear',
  weatherGet: 'weather:get',
  windowToggleDock: 'window:toggle-dock',
  windowMinimize: 'window:minimize', // T-25：最小化到任务栏（ADR-026 冻结契约）
  ttsSpeak: 'tts:speak', // T-34：在线神经语音合成（ADR-029）
  telemetryGetStatus: 'telemetry:get-status', // T-42：匿名遥测状态
  telemetrySetEnabled: 'telemetry:set-enabled', // T-42：匿名遥测开关
  telemetryFlush: 'telemetry:flush', // T-42：匿名遥测批量补发（测试用）
  skinList: 'skin:list', // T-43：皮肤列表
  skinImport: 'skin:import', // T-43：导入皮肤包
  skinExport: 'skin:export', // T-43：导出皮肤包
  skinApply: 'skin:apply', // T-43：应用皮肤
  skinRemove: 'skin:remove', // T-43：卸载皮肤
  licenseGet: 'license:get', // T-40：许可证状态
  licenseActivate: 'license:activate', // T-40：激活
  licenseDeactivate: 'license:deactivate', // T-40：注销激活
  paymentCreateOrder: 'payment:create-order', // T-41：沙箱下单
  paymentMockCallback: 'payment:mock-callback', // T-41：沙箱模拟回调（仅沙箱可用）
  petGetStatus: 'pet:get-status', // T-55：宠物浮窗状态读取
  petSetStatus: 'pet:set-status', // T-55：宠物浮窗状态上报（聊天页驱动）
  petGetSkin: 'pet:get-skin', // T-55：宠物浮窗当前皮肤
  petToggleOverlay: 'pet:toggle-overlay', // T-55：显示/隐藏宠物浮窗
  petSetEnabled: 'pet:set-enabled', // T-55：按开关持久化并同步浮窗显示
  petTuckAway: 'pet:tuck-away', // T-55：收起草宠（隐藏并持久化关闭）
  petRefreshSkin: 'pet:refresh-skin', // T-55：皮肤变更后刷新浮窗
  petSkinUpdated: 'pet:skin-updated' // T-55：主进程推送浮窗皮肤变更
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
  share: {
    saveCard: (payload) => ipcRenderer.invoke(CHANNELS.shareSaveCard, payload), // T-45
    copyCard: (payload) => ipcRenderer.invoke(CHANNELS.shareCopyCard, payload) // T-45
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
  telemetry: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.telemetryGetStatus),
    setEnabled: (payload) => ipcRenderer.invoke(CHANNELS.telemetrySetEnabled, payload),
    flush: () => ipcRenderer.invoke(CHANNELS.telemetryFlush)
  },
  skin: {
    list: () => ipcRenderer.invoke(CHANNELS.skinList), // T-43
    import: (payload) => ipcRenderer.invoke(CHANNELS.skinImport, payload), // T-43
    export: (payload) => ipcRenderer.invoke(CHANNELS.skinExport, payload), // T-43
    apply: (payload) => ipcRenderer.invoke(CHANNELS.skinApply, payload), // T-43
    remove: (payload) => ipcRenderer.invoke(CHANNELS.skinRemove, payload) // T-43
  },
  license: {
    get: () => ipcRenderer.invoke(CHANNELS.licenseGet), // T-40
    activate: (code) => ipcRenderer.invoke(CHANNELS.licenseActivate, { code }), // T-40
    deactivate: () => ipcRenderer.invoke(CHANNELS.licenseDeactivate) // T-40
  },
  payment: {
    createOrder: (payload) =>
      ipcRenderer.invoke(CHANNELS.paymentCreateOrder, payload), // T-41
    mockCallback: (payload) =>
      ipcRenderer.invoke(CHANNELS.paymentMockCallback, payload) // T-41
  },
  petOverlay: {
    getStatus: () => ipcRenderer.invoke(CHANNELS.petGetStatus), // T-55
    setStatus: (payload) => ipcRenderer.invoke(CHANNELS.petSetStatus, payload), // T-55
    getSkin: () => ipcRenderer.invoke(CHANNELS.petGetSkin), // T-55
    toggle: () => ipcRenderer.invoke(CHANNELS.petToggleOverlay), // T-55
    setEnabled: (payload) => ipcRenderer.invoke(CHANNELS.petSetEnabled, payload), // T-55
    tuckAway: () => ipcRenderer.invoke(CHANNELS.petTuckAway), // T-55
    refreshSkin: () => ipcRenderer.invoke(CHANNELS.petRefreshSkin), // T-55
    onSkinUpdated: (callback) => {
      // T-55：皮肤变更事件（浮窗页订阅）
      const listener = (_event, _payload) => {
        if (typeof callback === 'function') {
          callback();
        }
      };
      ipcRenderer.on(CHANNELS.petSkinUpdated, listener);
      return () => ipcRenderer.removeListener(CHANNELS.petSkinUpdated, listener);
    }
  }
});

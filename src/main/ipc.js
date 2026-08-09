'use strict';

const { ipcMain, app, BrowserWindow } = require('electron');
const { createProvider } = require('../llm');
const { createDefaultStore } = require('../storage');
const { createMemoryStore } = require('../storage/memory-store');
const { resolveBaseDir } = require('../storage');
const { createChatService } = require('../llm/chat');
const { createSecureSettings } = require('./secure-settings');

/**
 * IPC 通道名。与 preload.js 中的常量保持一致。
 */
const CHANNELS = {
  chatSend: 'chat:send',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get',
  idleEvent: 'idle:event', // T-15：主进程 -> 渲染层 空闲互动触发
  activityPoke: 'activity:poke' // T-15：渲染层 -> 主进程 交互心跳
};

let store = null;
let memoryStore = null;
let settings = null;
let provider = null;
let chatService = null;
let registered = false;
let secureSettings = null;

// T-15：交互活动订阅（主进程空闲计时据此重置）
const activityListeners = new Set();

function notifyActivity() {
  for (const listener of activityListeners) {
    listener();
  }
}

function onActivity(listener) {
  if (typeof listener === 'function') {
    activityListeners.add(listener);
  }
  return () => activityListeners.delete(listener);
}

function getStore() {
  if (!store) {
    store = createDefaultStore();
  }
  return store;
}

function getMemoryStore() {
  if (!memoryStore) {
    memoryStore = createMemoryStore(resolveBaseDir());
  }
  return memoryStore;
}

function getSettings() {
  if (!settings) {
    settings = getSecureSettings().readSettings();
  }
  return settings;
}

function getSecureSettings() {
  if (!secureSettings) {
    secureSettings = createSecureSettings({ store: getStore() });
  }
  return secureSettings;
}

function getProvider() {
  if (!provider) {
    provider = createProvider(getSettings());
  }
  return provider;
}

function getChatService() {
  if (!chatService) {
    chatService = createChatService({
      provider: getProvider(),
      store: getStore(),
      memoryStore: getMemoryStore()
    });
    chatService.loadHistory();
  }
  return chatService;
}

async function handleChatSend(_event, payload) {
  notifyActivity(); // T-15：发送消息视为交互
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  const clientHistory = payload && Array.isArray(payload.history) ? payload.history : [];
  return getChatService().send(text, clientHistory);
}

function handleSettingsGet() {
  settings = getSecureSettings().readSettings();
  return { ...settings };
}

function handleSettingsSet(_event, patch) {
  notifyActivity(); // T-15：保存设置视为交互
  settings = getSecureSettings().writeSettings(
    patch && typeof patch === 'object' ? patch : {}
  );
  // 设置变化后重建 Provider 与聊天服务（例如 apiKey/model 变更即时生效）
  provider = null;
  chatService = null;
  return { ...settings };
}

function handleWindowHide(event) {
  notifyActivity(); // T-15：点击隐藏视为交互
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.hide();
  }
}

function handleHistoryGet() {
  return getMemoryStore().readMessages();
}

function handleActivityPoke() {
  notifyActivity(); // T-15：渲染层上报的窗口内交互
}

function registerIpcHandlers() {
  if (registered) {
    return;
  }
  registered = true;
  ipcMain.handle(CHANNELS.chatSend, handleChatSend);
  ipcMain.handle(CHANNELS.settingsGet, handleSettingsGet);
  ipcMain.handle(CHANNELS.settingsSet, handleSettingsSet);
  ipcMain.handle(CHANNELS.windowHide, handleWindowHide);
  ipcMain.handle(CHANNELS.historyGet, handleHistoryGet);
  ipcMain.on(CHANNELS.activityPoke, handleActivityPoke);
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = {
  registerIpcHandlers,
  CHANNELS,
  getSettings,
  onActivity,
  notifyActivity
};

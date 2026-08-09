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
  memoryList: 'memory:list',
  memoryDelete: 'memory:delete',
  memoryUpdate: 'memory:update'
};

let store = null;
let memoryStore = null;
let settings = null;
let provider = null;
let chatService = null;
let registered = false;
let secureSettings = null;

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
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  const clientHistory = payload && Array.isArray(payload.history) ? payload.history : [];
  return getChatService().send(text, clientHistory);
}

function handleSettingsGet() {
  settings = getSecureSettings().readSettings();
  return { ...settings };
}

function handleSettingsSet(_event, patch) {
  settings = getSecureSettings().writeSettings(
    patch && typeof patch === 'object' ? patch : {}
  );
  // 设置变化后重建 Provider 与聊天服务（例如 apiKey/model 变更即时生效）
  provider = null;
  chatService = null;
  return { ...settings };
}

function handleWindowHide(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.hide();
  }
}

function handleHistoryGet() {
  return getMemoryStore().readMessages();
}

function handleMemoryList() {
  return getMemoryStore().listMemories();
}

function handleMemoryDelete(_event, id) {
  try {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: 'memory-invalid-id' };
    }
    const deleted = getMemoryStore().deleteMemory(id);
    return deleted ? { ok: true } : { ok: false, error: 'memory-not-found' };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

function handleMemoryUpdate(_event, id, patch) {
  try {
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: 'memory-invalid-id' };
    }
    const content =
      patch && typeof patch.content === 'string' ? patch.content.trim() : '';
    if (!content) {
      return { ok: false, error: 'memory-empty-content' };
    }
    const item = getMemoryStore().updateMemory(id, { content });
    return item ? { ok: true, item } : { ok: false, error: 'memory-not-found' };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
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
  ipcMain.handle(CHANNELS.memoryList, handleMemoryList);
  ipcMain.handle(CHANNELS.memoryDelete, handleMemoryDelete);
  ipcMain.handle(CHANNELS.memoryUpdate, handleMemoryUpdate);
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = { registerIpcHandlers, CHANNELS };

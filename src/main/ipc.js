'use strict';

const { ipcMain, app, BrowserWindow } = require('electron');
const { createProvider } = require('../llm');
const { createDefaultStore } = require('../storage');
const { createMemoryStore } = require('../storage/memory-store');
const { resolveBaseDir } = require('../storage');
const { createChatService } = require('../llm/chat');

/**
 * IPC 通道名。与 preload.js 中的常量保持一致。
 */
const CHANNELS = {
  chatSend: 'chat:send',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get'
};

let store = null;
let memoryStore = null;
let settings = null;
let provider = null;
let chatService = null;
let registered = false;

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
    settings = getStore().readSettings();
  }
  return settings;
}

function getProvider() {
  if (!provider) {
    provider = createProvider(getSettings());
  }
  return provider;
}

function getChatService() {
  if (!chatService) {
    chatService = createChatService({ provider: getProvider(), store: getStore() });
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
  return { ...getSettings() };
}

function handleSettingsSet(_event, patch) {
  settings = getStore().writeSettings(patch && typeof patch === 'object' ? patch : {});
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
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = { registerIpcHandlers, CHANNELS };

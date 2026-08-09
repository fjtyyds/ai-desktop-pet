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
  chatSendStream: 'chat:send-stream',
  chatDelta: 'chat:delta',
  chatStreamCancel: 'chat:stream-cancel',
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
let secureSettings = null;
let streamAbortController = null;

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

/**
 * 流式发送（T-14，ADR-021）：主进程向发起方 webContents 推送 chat:delta { delta }，
 * 结束/取消时 sendStream 的 Promise resolve；同一时刻只允许一个活动流，新流会先取消旧流。
 */
async function handleChatSendStream(event, payload) {
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  const clientHistory = payload && Array.isArray(payload.history) ? payload.history : [];

  if (streamAbortController) {
    streamAbortController.abort();
    streamAbortController = null;
  }
  const controller = new AbortController();
  streamAbortController = controller;
  const sender = event.sender;

  try {
    return await getChatService().sendStream(text, clientHistory, {
      onDelta: (delta) => {
        if (sender && !sender.isDestroyed()) {
          sender.send(CHANNELS.chatDelta, { delta });
        }
      },
      signal: controller.signal
    });
  } finally {
    if (streamAbortController === controller) {
      streamAbortController = null;
    }
  }
}

/** 取消当前流：chat:stream-cancel（sendStream 将 resolve { ok:false, error:'已取消' }） */
function handleChatStreamCancel() {
  if (streamAbortController) {
    streamAbortController.abort();
    streamAbortController = null;
  }
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

function registerIpcHandlers() {
  if (registered) {
    return;
  }
  registered = true;
  ipcMain.handle(CHANNELS.chatSend, handleChatSend);
  ipcMain.handle(CHANNELS.chatSendStream, handleChatSendStream);
  ipcMain.handle(CHANNELS.chatStreamCancel, handleChatStreamCancel);
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

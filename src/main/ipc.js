'use strict';

const { ipcMain, app, BrowserWindow } = require('electron');
const { createProvider } = require('../llm');
const { createDefaultStore } = require('../storage');
const { createMemoryStore } = require('../storage/memory-store');
const { resolveBaseDir } = require('../storage');
const { createChatService } = require('../llm/chat');
const { createSecureSettings } = require('./secure-settings');

/**
 * T-16：情绪引擎共享单例（ADR-022 mood.get；src/llm/** 只读）。
 * chat.js 在首次聊天时惰性调用 require('../llm/mood').createMood() 且无注入点；
 * 这里把 createMood 包装为返回同一实例，保证 mood:get 与聊天 system prompt
 * 读到的是同一个内存态情绪，避免“显示的 mood 与对话实际 mood 不一致”。
 */
const moodModule = require('../llm/mood');
const createMoodOriginal = moodModule.createMood;
let moodEngine = null;
moodModule.createMood = function createSharedMood(initial) {
  if (!moodEngine) {
    moodEngine = createMoodOriginal(initial);
  }
  return moodEngine;
};

/**
 * IPC 通道名。与 preload.js 中的常量保持一致。
 */
const CHANNELS = {
  chatSend: 'chat:send',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get',
  moodGet: 'mood:get'
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

function getMoodEngine() {
  if (!moodEngine) {
    moodEngine = createMoodOriginal();
  }
  return moodEngine;
}

function handleMoodGet() {
  const engine = getMoodEngine();
  if (!engine) {
    return null;
  }
  // 与 chat.js 读取情绪一致：先做时间推进（无交互回归默认），再返回快照
  if (typeof engine.tick === 'function') {
    try {
      engine.tick();
    } catch (_error) {
      // 时间推进失败不影响读取
    }
  }
  const state =
    typeof engine.snapshot === 'function'
      ? engine.snapshot()
      : { valence: 60, intensity: 0.35, label: '平静' };
  return { ...state };
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
  ipcMain.handle(CHANNELS.moodGet, handleMoodGet);
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = { registerIpcHandlers, CHANNELS };

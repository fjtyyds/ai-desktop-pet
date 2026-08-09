'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, app, BrowserWindow, dialog } = require('electron');
const { createProvider } = require('../llm');
const { createDefaultStore, resolveBaseDir } = require('../storage');
const { createMemoryStore } = require('../storage/memory-store');
const { DEFAULT_SETTINGS } = require('../storage/store');
const { createChatService } = require('../llm/chat');
const { createSecureSettings } = require('./secure-settings');
const { createTranslator } = require('../shared/locales');

/**
 * IPC 通道名。与 preload.js 中的常量保持一致。
 */
const CHANNELS = {
  chatSend: 'chat:send',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get',
  historyExport: 'history:export',
  historyClear: 'history:clear'
};

/** history.clear 允许的范围（契约：messages / memories / settings / all） */
const VALID_CLEAR_SCOPES = ['messages', 'memories', 'settings', 'all'];

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

/**
 * 按当前语言返回主进程翻译器（导出文件名/对话框、清除确认框用）。
 * settings.language 为 'system' 时跟随主进程系统语言。
 */
function getTranslator() {
  const current = getSettings();
  const stored =
    current && typeof current.language === 'string' ? current.language : 'system';
  const locale =
    stored === 'system'
      ? app && typeof app.getLocale === 'function'
        ? app.getLocale()
        : 'zh-CN'
      : stored;
  return createTranslator(locale);
}

function formatFileTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Markdown 导出：按历史顺序逐条渲染用户/桌宠消息，附带导出元信息。
 * translate 缺省时（纯 Node 测试）直接使用占位键名。
 */
function buildMarkdownExport(messages, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const t = typeof options.translate === 'function' ? options.translate : (key) => key;
  const petName = options.petName || 'AI 桌宠';
  const exportedAt = options.exportedAt instanceof Date ? options.exportedAt : new Date();
  const lines = [
    t('data.exportHeader', { petName }),
    '',
    t('data.exportMeta', { time: exportedAt.toISOString(), count: list.length }),
    ''
  ];
  for (const item of list) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) {
      continue;
    }
    const label =
      item.role === 'user'
        ? t('data.exportLabelUser')
        : t('data.exportLabelAssistant', { petName });
    const content =
      typeof item.content === 'string' ? item.content : String(item.content ?? '');
    lines.push(`## ${label}`, '', content, '');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/** JSON 导出：与 history.get 返回内容完全一致（归一化消息数组）。 */
function buildJsonExport(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return `${JSON.stringify(list, null, 2)}\n`;
}

/** 将导出内容写入用户选择的文件（与 history.get 内容一致）。 */
async function writeExportFile(filePath, messages, format, options = {}) {
  const content =
    format === 'json'
      ? buildJsonExport(messages)
      : buildMarkdownExport(messages, options);
  await fs.promises.writeFile(filePath, content, 'utf8');
  return content;
}

function writeDataFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/**
 * 按范围清除本地数据（不弹确认框；确认由 IPC 层负责）：
 * - messages：messages.json 清空，并重置聊天服务缓存
 * - memories：memories.json 清空
 * - settings：settings.json 重置为默认设置（保留未知扩展字段，结构不被破坏）
 * - all：以上全部
 */
function clearData(scope) {
  const normalized = VALID_CLEAR_SCOPES.includes(scope) ? scope : 'all';
  const baseDir = resolveBaseDir();

  if (normalized === 'messages' || normalized === 'all') {
    writeDataFile(path.join(baseDir, 'messages.json'), '[]\n');
    chatService = null;
  }
  if (normalized === 'memories' || normalized === 'all') {
    writeDataFile(path.join(baseDir, 'memories.json'), '[]\n');
  }
  if (normalized === 'settings' || normalized === 'all') {
    settings = getSecureSettings().writeSettings({ ...DEFAULT_SETTINGS });
    provider = null;
    chatService = null;
  }
  return normalized;
}

/** 导出对话：主进程 showSaveDialog 选择路径，写 Markdown/JSON，内容与历史一致。 */
async function handleHistoryExport(event, payload) {
  const format = payload && payload.format === 'json' ? 'json' : 'markdown';
  const t = getTranslator();
  const current = getSettings();
  const petName =
    current && typeof current.petName === 'string' && current.petName.trim()
      ? current.petName.trim()
      : t('app.defaultPetName');
  const messages = getMemoryStore().readMessages();
  const ext = format === 'json' ? 'json' : 'md';
  const defaultPath = `${t('data.exportDialogDefaultName')}-${formatFileTimestamp(
    new Date()
  )}.${ext}`;
  const dialogOptions = {
    title: t('data.exportDialogTitle'),
    defaultPath,
    filters:
      format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }]
  };
  const win = BrowserWindow.fromWebContents(event.sender);
  const result =
    win && !win.isDestroyed()
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
  if (result.canceled || !result.filePath) {
    return { ok: false, filePath: null, error: 'cancelled' };
  }
  try {
    await writeExportFile(result.filePath, messages, format, { translate: t, petName });
    return { ok: true, filePath: result.filePath, error: null };
  } catch (error) {
    return {
      ok: false,
      filePath: null,
      error: error && error.message ? error.message : String(error)
    };
  }
}

/** 清除数据：先弹本地化确认框，确认后按 scope 清空并返回结果。 */
async function handleHistoryClear(event, payload) {
  const scope = payload && typeof payload.scope === 'string' ? payload.scope : 'all';
  if (!VALID_CLEAR_SCOPES.includes(scope)) {
    return { ok: false, error: `未知清除范围: ${scope}` };
  }
  const t = getTranslator();
  const scopeLabel = t(`data.scope${scope[0].toUpperCase()}${scope.slice(1)}`);
  const dialogOptions = {
    type: 'warning',
    title: t('data.confirmTitle'),
    message: t('data.confirmMessage', { scope: scopeLabel }),
    detail: t('data.confirmDetail'),
    buttons: [t('data.confirmOk'), t('data.confirmCancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
  const win = BrowserWindow.fromWebContents(event.sender);
  const shown =
    win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
  if (shown.response !== 0) {
    return { ok: false, error: 'cancelled' };
  }
  clearData(scope);
  return { ok: true, error: null };
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
  ipcMain.handle(CHANNELS.historyExport, handleHistoryExport);
  ipcMain.handle(CHANNELS.historyClear, handleHistoryClear);
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = {
  registerIpcHandlers,
  CHANNELS,
  buildMarkdownExport,
  buildJsonExport,
  writeExportFile,
  clearData
};

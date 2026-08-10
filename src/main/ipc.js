'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, app, BrowserWindow, dialog } = require('electron');
const { createProvider } = require('../llm');
const { createDefaultStore, resolveBaseDir } = require('../storage');
const { createMemoryStore } = require('../storage/memory-store');
const { DEFAULT_SETTINGS, DEFAULT_POMODORO_MINUTES } = require('../storage/store');
const { createChatService } = require('../llm/chat');
const { createSecureSettings } = require('./secure-settings');
const { createTranslator } = require('../shared/locales');
const { getWeather } = require('./weather'); // T-22：天气小部件（主进程网络请求）

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
  chatSendStream: 'chat:send-stream',
  chatDelta: 'chat:delta',
  chatStreamCancel: 'chat:stream-cancel',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  windowHide: 'window:hide',
  historyGet: 'history:get',
  idleEvent: 'idle:event', // T-15：主进程 -> 渲染层 空闲互动触发
  activityPoke: 'activity:poke', // T-15：渲染层 -> 主进程 交互心跳
  moodGet: 'mood:get', // T-16：读取当前情绪
  memoryList: 'memory:list', // T-17：长期记忆列表
  memoryDelete: 'memory:delete', // T-17：删除长期记忆
  memoryUpdate: 'memory:update', // T-17：修正长期记忆
  historyExport: 'history:export', // T-18：导出对话
  historyClear: 'history:clear', // T-18：清除数据
  weatherGet: 'weather:get' // T-22：天气小部件
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
let streamAbortController = null;

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
  notifyActivity(); // T-15：保存设置视为交互
  settings = getSecureSettings().writeSettings(
    patch && typeof patch === 'object' ? patch : {}
  );
  // 设置变化后重建 Provider 与聊天服务（例如 apiKey/model 变更即时生效）
  provider = null;
  chatService = null;
  return { ...settings };
}

/**
 * 消费番茄钟完成信号（T-27，幂等）：
 * - 每次从磁盘读取最新设置，不依赖模块缓存，避免轮询读到已消费的陈旧信号；
 * - 仅当 pomodoroNotifyAt > 0 时清零，与 handleSettingsSet 共用同一
 *   secureSettings 实例，清零后同步更新模块缓存；
 * - 清零失败返回 null（不弹通知），下一次轮询会重试；
 * - 返回 { at, minutes, enabled }；无待消费信号返回 null。
 */
function consumePomodoroNotificationSignal() {
  const current = getSecureSettings().readSettings();
  const at = Number(current && current.pomodoroNotifyAt);
  if (!(Number.isFinite(at) && at > 0)) {
    return null;
  }
  const requested = Number(current && current.pomodoroNotifyMinutes);
  const minutes =
    Number.isFinite(requested) && requested > 0
      ? Math.min(120, Math.max(1, Math.round(requested)))
      : DEFAULT_POMODORO_MINUTES;
  settings = getSecureSettings().writeSettings({
    pomodoroNotifyAt: 0,
    pomodoroNotifyMinutes: 0
  });
  return {
    at,
    minutes,
    enabled: current.pomodoroEnabled !== false
  };
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

/**
 * 天气：读取设置中的城市（渲染层也可显式传 city），
 * 描述语言跟随界面语言；force 跳过 10 分钟天气缓存（T-22）。
 */
async function handleWeatherGet(_event, payload) {
  const current = getSettings();
  const city =
    payload && typeof payload.city === 'string'
      ? payload.city
      : current && typeof current.weatherCity === 'string'
        ? current.weatherCity
        : '';
  const language =
    current && typeof current.language === 'string'
      ? current.language
      : 'system';
  const force = Boolean(payload && payload.force);
  return getWeather({ city, language, force });
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
  ipcMain.on(CHANNELS.activityPoke, handleActivityPoke);
  ipcMain.handle(CHANNELS.moodGet, handleMoodGet);
  ipcMain.handle(CHANNELS.memoryList, handleMemoryList);
  ipcMain.handle(CHANNELS.memoryDelete, handleMemoryDelete);
  ipcMain.handle(CHANNELS.memoryUpdate, handleMemoryUpdate);
  ipcMain.handle(CHANNELS.historyExport, handleHistoryExport);
  ipcMain.handle(CHANNELS.historyClear, handleHistoryClear);
  ipcMain.handle(CHANNELS.weatherGet, handleWeatherGet);
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = {
  registerIpcHandlers,
  CHANNELS,
  getSettings,
  consumePomodoroNotificationSignal,
  onActivity,
  notifyActivity,
  buildMarkdownExport,
  buildJsonExport,
  writeExportFile,
  clearData
};

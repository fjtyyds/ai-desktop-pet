'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, app, BrowserWindow, dialog, clipboard, nativeImage } = require('electron');
const { createProvider } = require('../llm');
const { createDefaultStore, resolveBaseDir } = require('../storage');
const { createMemoryStore } = require('../storage/memory-store');
const { DEFAULT_SETTINGS } = require('../storage/store');
const { createChatService } = require('../llm/chat');
const { createSecureSettings } = require('./secure-settings');
const { createTranslator } = require('../shared/locales');
const { getWeather } = require('./weather'); // T-22：天气小部件（主进程网络请求）
const ttsEdge = require('./tts-edge'); // T-34：Edge 在线神经语音（ADR-029）
const telemetry = require('./telemetry'); // T-42：匿名遥测（opt-in、脱敏、批量上报）
const skinStore = require('./skin-store'); // T-43：皮肤包导入/导出/索引/卸载（ADR-032）
const { createLicenseManager } = require('./license'); // T-40：许可证与付费墙
const { createPaymentManager } = require('./payment'); // T-41：支付沙箱/桩

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
  shareSaveCard: 'share:save-card', // T-45：保存对话卡片 PNG
  shareCopyCard: 'share:copy-card', // T-45：复制对话卡片到剪贴板
  weatherGet: 'weather:get', // T-22：天气小部件
  ttsSpeak: 'tts:speak', // T-34：在线神经语音合成（ADR-029）
  telemetryGetStatus: 'telemetry:get-status', // T-42：遥测状态
  telemetrySetEnabled: 'telemetry:set-enabled', // T-42：开关（可附带清除本地数据）
  telemetryFlush: 'telemetry:flush', // T-42：测试/网络恢复用批量补发
  skinList: 'skin:list', // T-43：皮肤列表（含预览/角色资源 data URL）
  skinImport: 'skin:import', // T-43：导入皮肤包（zip 或目录）
  skinImportCodexPets: 'skin:import-codepets', // T-59：扫描 Codex 宠物目录批量导入
  skinExport: 'skin:export', // T-43：导出皮肤包为 zip
  skinApply: 'skin:apply', // T-43：应用皮肤（写入 settings.skinId）
  skinRemove: 'skin:remove', // T-43：卸载导入的皮肤包
  licenseGet: 'license:get', // T-40：读取许可证/门控/额度状态
  licenseActivate: 'license:activate', // T-40：激活码/订单号激活
  licenseDeactivate: 'license:deactivate', // T-40：注销激活
  paymentCreateOrder: 'payment:create-order', // T-41：沙箱下单
  paymentMockCallback: 'payment:mock-callback' // T-41：沙箱模拟回调（仅沙箱可用）
};

/** history.clear 允许的范围（契约：messages / memories / settings / all） */
const VALID_CLEAR_SCOPES = ['messages', 'memories', 'settings', 'all'];

/** T-45：分享卡片 PNG 大小上限（64MB，防御异常输入） */
const MAX_SHARE_PNG_BYTES = 64 * 1024 * 1024;

let store = null;
let memoryStore = null;
let settings = null;
let provider = null;
let chatService = null;
let registered = false;
let secureSettings = null;
let streamAbortController = null;
let skinStoreInstance = null; // T-43：皮肤存储单例
let licenseManager = null; // T-40：许可证单例
let paymentManagerInstance = null; // T-41：支付沙箱/桩单例
let petOverlayApi = null; // T-63：宠物浮窗实例注入（任务进度气泡）

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

function getLicenseManager() {
  if (!licenseManager) {
    licenseManager = createLicenseManager({
      settings: getSecureSettings(),
      baseDir: resolveBaseDir(),
      now: () => Date.now()
    });
  }
  return licenseManager;
}

/** T-41：支付沙箱/桩管理器（订单表与幂等记录在 baseDir/payment-state.json） */
function getPaymentManager() {
  if (!paymentManagerInstance) {
    paymentManagerInstance = createPaymentManager({
      baseDir: resolveBaseDir(),
      license: getLicenseManager(),
      now: () => Date.now(),
      logger: (message) => console.warn(`[payment] ${message}`)
    });
  }
  return paymentManagerInstance;
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

/** T-43：皮肤存储单例（用户数据目录下的 skins/） */
function getSkinStore() {
  if (!skinStoreInstance) {
    skinStoreInstance = skinStore.createSkinStore({
      baseDir: path.join(resolveBaseDir(), 'skins')
    });
  }
  return skinStoreInstance;
}

/** T-63：注入宠物浮窗实例（main.js 创建后调用） */
function setPetOverlay(api) {
  petOverlayApi = api;
}

function getPetOverlay() {
  return petOverlayApi;
}

async function handleChatSend(_event, payload) {
  notifyActivity(); // T-15：发送消息视为交互
  const guard = consumeCloudQuotaIfNeeded();
  if (!guard.ok) {
    return { ok: false, reply: '', error: guard.error };
  }
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  const clientHistory = payload && Array.isArray(payload.history) ? payload.history : [];
  const startedAt = Date.now();
  const result = await getChatService().send(text, clientHistory);
  trackChatActivity(false, text, result, startedAt); // T-42：匿名事件（仅聚合字段）
  return result;
}

/**
 * T-40：云 AI 额度门控。
 * 有 BYOK API Key 时不消耗额度；否则按许可证档位扣减（free 10 次/日、
 * yearly 200 次/月；lifetime 不含云额度按免费档）。
 */
function consumeCloudQuotaIfNeeded() {
  const current = getSettings();
  const hasByok =
    current &&
    typeof current.apiKey === 'string' &&
    current.apiKey.trim().length > 0;
  if (hasByok) {
    return { ok: true };
  }
  return getLicenseManager().consumeCloudQuota();
}

/**
 * 流式发送（T-14，ADR-021）：主进程向发起方 webContents 推送 chat:delta { delta }，
 * 结束/取消时 sendStream 的 Promise resolve；同一时刻只允许一个活动流，新流会先取消旧流。
 */
async function handleChatSendStream(event, payload) {
  const guard = consumeCloudQuotaIfNeeded();
  if (!guard.ok) {
    return { ok: false, reply: '', error: guard.error };
  }
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
    const startedAt = Date.now();
    const result = await getChatService().sendStream(text, clientHistory, {
      onDelta: (delta) => {
        if (sender && !sender.isDestroyed()) {
          sender.send(CHANNELS.chatDelta, { delta });
        }
      },
      signal: controller.signal
    });
    trackChatActivity(true, text, result, startedAt); // T-42：匿名事件（仅聚合字段）
    return result;
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

/** T-40：读取许可证状态（含门控与云 AI 额度），供设置页“账户/订阅”展示 */
function handleLicenseGet() {
  return getLicenseManager().getPublicStatus();
}

/** T-40：激活码/订单号激活（本地 mock 校验，T-41 接入真实支付） */
function handleLicenseActivate(_event, payload) {
  const code = payload && typeof payload.code === 'string' ? payload.code : '';
  return getLicenseManager().activate(code);
}

/** T-40：注销激活，回到免费版 */
function handleLicenseDeactivate() {
  return getLicenseManager().deactivate();
}

/** T-41：沙箱下单（返回待支付订单；不触网、不收款） */
function handlePaymentCreateOrder(_event, payload) {
  return getPaymentManager().createOrder(payload);
}

/** T-41：沙箱模拟回调（仅沙箱模式可用；驱动验签→升档/降级链路） */
function handlePaymentMockCallback(_event, payload) {
  return getPaymentManager().mockCallback(payload);
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

/**
 * T-45：校验并解码分享卡片 PNG。
 * 仅接受 data:image/png;base64 数据 URL，校验 PNG 魔数后返回 Buffer；
 * 非法输入一律抛 'invalid-png-data'，杜绝任意文件写入。
 */
function decodeSharePng(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) {
    throw new Error('invalid-png-data');
  }
  const base64 = match[1].replace(/\r?\n/g, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer || buffer.length < 8 || buffer.length > MAX_SHARE_PNG_BYTES) {
    throw new Error('invalid-png-data');
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('invalid-png-data');
  }
  return buffer;
}

/** T-45：文件名清洗（移除非法字符与控制字符、限制长度；空值回退默认名）。 */
function sanitizeShareFileName(name, fallback) {
  let value = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-');
  if (!value || value === '.' || value === '..') {
    value = fallback;
  }
  return value.slice(0, 80);
}

/** T-45：保存对话卡片 PNG（主进程 showSaveDialog 选择路径后写入）。 */
async function handleShareSaveCard(event, payload) {
  let png;
  try {
    png = decodeSharePng(payload && payload.dataUrl);
  } catch (_error) {
    return { ok: false, filePath: null, error: 'invalid-png-data' };
  }
  const t = getTranslator();
  const fallbackName = `${t('share.saveDialogDefaultName')}-${formatFileTimestamp(
    new Date()
  )}`;
  const defaultName = sanitizeShareFileName(
    payload && payload.suggestedName,
    fallbackName
  );
  const dialogOptions = {
    title: t('share.saveDialogTitle'),
    defaultPath: `${defaultName}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }]
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
    await fs.promises.writeFile(result.filePath, png);
    return { ok: true, filePath: result.filePath, error: null };
  } catch (error) {
    return {
      ok: false,
      filePath: null,
      error: error && error.message ? error.message : String(error)
    };
  }
}

/** T-45：复制对话卡片 PNG 到系统剪贴板。 */
function handleShareCopyCard(_event, payload) {
  let png;
  try {
    png = decodeSharePng(payload && payload.dataUrl);
  } catch (_error) {
    return { ok: false, error: 'invalid-png-data' };
  }
  try {
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) {
      return { ok: false, error: 'invalid-png-data' };
    }
    clipboard.writeImage(image);
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
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
    // T-40：清除设置时一并清掉许可证 runtime 状态（额度记录），并重建管理器
    licenseManager = null;
    try {
      fs.rmSync(path.join(baseDir, 'license-state.json'), { force: true });
    } catch (_error) {
      // runtime 状态清理失败不影响主流程
    }
    // T-41：清除设置时一并清掉支付沙箱订单/幂等记录
    paymentManagerInstance = null;
    try {
      fs.rmSync(path.join(baseDir, 'payment-state.json'), { force: true });
    } catch (_error) {
      // runtime 状态清理失败不影响主流程
    }
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
  const startedAt = Date.now();
  const result = await getWeather({ city, language, force });
  // T-42：天气刷新事件（仅结果/耗时，不包含城市名等用户数据）
  telemetry.getTelemetry()?.track('weather_refresh', {
    ok: result && result.ok ? 1 : 0,
    latencyMs: Date.now() - startedAt
  });
  return result;
}

/**
 * T-42：对话匿名事件（chat_sent / chat_reply）。
 * 只传聚合字段（字数/是否流式/结果/回复字数/耗时），绝不传消息正文。
 */
function trackChatActivity(stream, text, result, startedAt) {
  const api = telemetry.getTelemetry();
  if (!api) {
    return;
  }
  api.track('chat_sent', {
    chars: typeof text === 'string' ? text.length : 0,
    stream: stream ? 1 : 0
  });
  if (result && result.ok) {
    api.track('chat_reply', {
      ok: 1,
      replyChars:
        result.reply && typeof result.reply === 'string' ? result.reply.length : 0,
      latencyMs: Math.max(0, Date.now() - startedAt)
    });
  }
}

/** T-42：读取遥测状态（合并设置中的开关状态） */
function handleTelemetryGetStatus() {
  const api = telemetry.getTelemetry();
  const enabled = getSettings().telemetryEnabled === true;
  if (!api) {
    return {
      enabled,
      endpointConfigured: false,
      deviceId: null,
      queuedCount: 0,
      lastFlushAt: null,
      flushInFlight: false,
      reason: 'not-initialized'
    };
  }
  return { ...api.getStatus(), enabled };
}

/** T-42：设置开关；clearData=true 时同时清除本地队列与设备标识 */
function handleTelemetrySetEnabled(_event, payload) {
  notifyActivity(); // T-15：设置遥测视为交互
  const enabled = Boolean(payload && payload.enabled);
  const clearData = Boolean(payload && payload.clearData);
  settings = getSecureSettings().writeSettings({ telemetryEnabled: enabled });
  const api = telemetry.getTelemetry();
  if (clearData && api) {
    api.clear();
  }
  return handleTelemetryGetStatus();
}

/** T-42：立即尝试批量补发（测试/网络恢复时使用；失败不影响应用） */
function handleTelemetryFlush() {
  const api = telemetry.getTelemetry();
  if (!api) {
    return { ok: false, error: 'not-initialized' };
  }
  return api.flush();
}

/** T-34（ADR-029）：Edge 在线神经语音合成，返回 { ok, audioDataUrl, error } */
async function handleTtsSpeak(_event, payload) {
  const text =
    payload && typeof payload.text === 'string' ? payload.text : '';
  if (!text.trim()) {
    return { ok: false, audioDataUrl: null, error: '文本不能为空' };
  }
  const voice =
    payload && typeof payload.voice === 'string' && payload.voice.trim()
      ? payload.voice.trim()
      : '';
  const rate =
    payload && typeof payload.rate === 'string' ? payload.rate : '+0%';
  const pitch =
    payload && typeof payload.pitch === 'string' ? payload.pitch : '+0Hz';
  return ttsEdge.synthesize({ text, voice, rate, pitch });
}

/* ---------------- T-43：皮肤与配件（ADR-032 上线方案） ---------------- */

/** 皮肤操作错误统一包装：不抛异常、不崩溃 */
function skinErrorResult(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error)
  };
}

/** skin:list：返回全部皮肤（内置优先）与当前应用的 skinId */
function handleSkinList() {
  try {
    const current = getSettings();
    return {
      ok: true,
      skins: getSkinStore().list(),
      appliedId:
        current && typeof current.skinId === 'string' && current.skinId
          ? current.skinId
          : skinStore.DEFAULT_SKIN_ID
    };
  } catch (error) {
    return skinErrorResult(error);
  }
}

/** skin:import：传入 path 直接导入（测试/自动化）；缺省弹出文件/目录选择框 */
async function handleSkinImport(event, payload) {
  try {
    let sourcePath =
      payload && typeof payload.path === 'string' ? payload.path.trim() : '';
    if (!sourcePath) {
      const t = getTranslator();
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: t('skin.importDialogTitle'),
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      };
      const result =
        win && !win.isDestroyed()
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { ok: false, error: 'cancelled' };
      }
      sourcePath = result.filePaths[0];
    }
    const skin = getSkinStore().importPack(sourcePath);
    return { ok: true, skin, error: null };
  } catch (error) {
    return skinErrorResult(error);
  }
}

/**
 * skin:import-codepets（T-59）：扫描 Codex 宠物目录批量导入。
 * 缺省优先使用 ~/.codex/pets（env CODEX_HOME 或 HOME/.codex）；目录不存在时
 * 弹出目录选择框供用户自选。
 */
async function handleSkinImportCodexPets(event, payload) {
  try {
    const store = getSkinStore();
    let sourcePath =
      payload && typeof payload.path === 'string' ? payload.path.trim() : '';
    if (!sourcePath) {
      const defaultDir = skinStore.defaultCodexPetsDir();
      if (fs.existsSync(defaultDir)) {
        sourcePath = defaultDir;
      } else {
        const t = getTranslator();
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = {
          title: t('skin.scanCodexPetsDialogTitle'),
          defaultPath: defaultDir,
          properties: ['openDirectory']
        };
        const result =
          win && !win.isDestroyed()
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
          return { ok: false, error: 'cancelled' };
        }
        sourcePath = result.filePaths[0];
      }
    }
    const overlay = getPetOverlay();
    if (overlay && typeof overlay.startTask === 'function') {
      overlay.startTask({
        id: 'skin-import',
        title: getTranslator()('overlay.taskImporting')
      });
    }
    const result = store.scanCodexPetsDir(sourcePath, (progress) => {
      if (overlay && typeof overlay.updateTask === 'function') {
        const t = getTranslator();
        const message = progress.error
          ? `${progress.name}：${t('overlay.taskImportFailedShort')}`
          : progress.name;
        overlay.updateTask({
          id: 'skin-import',
          percent: Math.round((progress.index / progress.total) * 100),
          stage: progress.index,
          totalStages: progress.total,
          message
        });
      }
    });
    if (overlay && typeof overlay.finishTask === 'function') {
      const t = getTranslator();
      const ok = result.failed.length === 0;
      overlay.finishTask({
        id: 'skin-import',
        ok,
        message: ok
          ? t('overlay.taskImportDone', { count: result.imported.length })
          : t('overlay.taskImportPartial', {
              ok: result.imported.length,
              fail: result.failed.length
            })
      });
    }
    return { ok: true, ...result };
  } catch (error) {
    try {
      const overlay = getPetOverlay();
      if (overlay && typeof overlay.finishTask === 'function') {
        overlay.finishTask({
          id: 'skin-import',
          ok: false,
          message:
            (error && error.message) ||
            getTranslator()('overlay.taskImportFailed')
        });
      }
    } catch (_error) {
      // 任务清理失败不影响错误返回
    }
    return skinErrorResult(error);
  }
}

/** skin:export：传入 targetPath 直接导出；缺省弹出保存框 */
async function handleSkinExport(event, payload) {
  try {
    const store = getSkinStore();
    const id =
      payload && typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!store.find(id)) {
      return { ok: false, error: `皮肤不存在: ${id}` };
    }
    let targetPath =
      payload && typeof payload.targetPath === 'string'
        ? payload.targetPath.trim()
        : '';
    if (!targetPath) {
      const t = getTranslator();
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: t('skin.exportDialogTitle'),
        defaultPath: `${id}-skin.zip`,
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      };
      const result =
        win && !win.isDestroyed()
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return { ok: false, error: 'cancelled' };
      }
      targetPath = result.filePath;
    }
    const exported = store.exportPack(id, targetPath);
    return { ok: true, path: exported.path, error: null };
  } catch (error) {
    return skinErrorResult(error);
  }
}

/** skin:apply：校验皮肤存在后写入 settings.skinId（store.js 白名单清洗） */
function handleSkinApply(_event, payload) {
  try {
    const id =
      payload && typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!getSkinStore().find(id)) {
      return { ok: false, error: `皮肤不存在: ${id}` };
    }
    settings = getSecureSettings().writeSettings({ skinId: id });
    return { ok: true, settings: { ...settings }, error: null };
  } catch (error) {
    return skinErrorResult(error);
  }
}

/** skin:remove：仅允许移除导入皮肤；若移除的是当前皮肤则回退 default */
function handleSkinRemove(_event, payload) {
  try {
    const id =
      payload && typeof payload.id === 'string' ? payload.id.trim() : '';
    const store = getSkinStore();
    if (store.isBuiltin(id)) {
      return { ok: false, error: '内置皮肤不可移除' };
    }
    store.remove(id);
    const current = getSettings();
    if (current && current.skinId === id) {
      settings = getSecureSettings().writeSettings({
        skinId: skinStore.DEFAULT_SKIN_ID
      });
    }
    return { ok: true, error: null };
  } catch (error) {
    return skinErrorResult(error);
  }
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
  ipcMain.handle(CHANNELS.shareSaveCard, handleShareSaveCard);
  ipcMain.handle(CHANNELS.shareCopyCard, handleShareCopyCard);
  ipcMain.handle(CHANNELS.weatherGet, handleWeatherGet);
  ipcMain.handle(CHANNELS.ttsSpeak, handleTtsSpeak);
  ipcMain.handle(CHANNELS.telemetryGetStatus, handleTelemetryGetStatus);
  ipcMain.handle(CHANNELS.telemetrySetEnabled, handleTelemetrySetEnabled);
  ipcMain.handle(CHANNELS.telemetryFlush, handleTelemetryFlush);
  ipcMain.handle(CHANNELS.skinList, handleSkinList);
  ipcMain.handle(CHANNELS.skinImport, handleSkinImport);
  ipcMain.handle(CHANNELS.skinImportCodexPets, handleSkinImportCodexPets);
  ipcMain.handle(CHANNELS.skinExport, handleSkinExport);
  ipcMain.handle(CHANNELS.skinApply, handleSkinApply);
  ipcMain.handle(CHANNELS.skinRemove, handleSkinRemove);
  ipcMain.handle(CHANNELS.licenseGet, handleLicenseGet);
  ipcMain.handle(CHANNELS.licenseActivate, handleLicenseActivate);
  ipcMain.handle(CHANNELS.licenseDeactivate, handleLicenseDeactivate);
  ipcMain.handle(CHANNELS.paymentCreateOrder, handlePaymentCreateOrder);
  ipcMain.handle(CHANNELS.paymentMockCallback, handlePaymentMockCallback);
}

// 被 src/main/main.js require 后自动注册（M1 集成时由协调者加入 require('./ipc')）
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = {
  registerIpcHandlers,
  CHANNELS,
  getSettings,
  getLicenseManager,
  getPaymentManager,
  setPetOverlay,
  getPetOverlay,
  onActivity,
  notifyActivity,
  buildMarkdownExport,
  buildJsonExport,
  writeExportFile,
  decodeSharePng,
  sanitizeShareFileName,
  clearData
};

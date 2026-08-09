'use strict';

const os = require('os');
const { execFile } = require('child_process');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Notification,
  powerMonitor,
  screen
} = require('electron');
const path = require('path');
const { createTray, loadAppIcon } = require('./tray');
const { initCrash } = require('./crash'); // T-11: 崩溃上报与本地日志
const ipc = require('./ipc'); // T-03: 注册 chat/settings IPC；T-15: 空闲互动接线
const { createSecureSettings } = require('./secure-settings'); // T-19: 窗口设置持久化
const { createDefaultStore } = require('../storage'); // T-19: 窗口设置写入
const { createTranslator } = require('../shared/locales'); // T-21: 通知本地化
const {
  createIdleMonitor,
  DEFAULT_IDLE_TRIGGER_MS,
  DEFAULT_MIN_INTERVAL_MS
} = require('./idle'); // T-15: 空闲主动互动计时

let mainWindow = null;
let trayApi = null;
let isQuitting = false;
let idleMonitor = null;

/** T-19：窗口体验 IPC 通道（ADR-022 冻结契约；preload.js 同名常量保持一致） */
const WINDOW_CHANNELS = {
  toggleDock: 'window:toggle-dock',
  setShortcut: 'window:set-shortcut'
};

/** T-19：全局快捷键候选（优先 Ctrl+Alt+P，冲突时依次尝试备用键） */
const SHORTCUT_CANDIDATES = [
  'CommandOrControl+Alt+P',
  'CommandOrControl+Alt+Shift+P',
  'Alt+P'
];

/** T-19：贴边/滑出参数（Windows 桌面语义） */
const DOCK_STRIP = 10; // 贴边隐藏后露出的像素宽度/高度
const DOCK_MARGIN = 24; // 距离屏幕边缘多近视为“靠边”
const DOCK_HOLD_MS = 500; // 靠边停留该时长后自动贴边
const DOCK_PEEK_MARGIN = 64; // 鼠标距边缘多远时滑出
const DOCK_LINGER_MS = 1800; // 鼠标离开且窗口失焦后多久滑回
const DOCK_POLL_MS = 120; // 贴边期间鼠标位置轮询间隔
const DOCK_SLIDE_MS = 160; // 滑出/滑回动画时长
const DOCK_ANIMATION_IGNORE_MS = 250; // 动画产生的 move 事件忽略窗口，避免误判为拖动
const DOCK_REGRAB_GRACE_MS = 800; // 取消贴边后的短暂窗口，防止 setBounds 触发再贴边

/** T-21：系统状态小部件（CPU/内存每 2s 推送；电池每 15s 查询一次） */
const STATUS_POLL_MS = 2000;
const BATTERY_POLL_MS = 15000;
const BATTERY_QUERY_TIMEOUT_MS = 3000;
const DEFAULT_POMODORO_MINUTES = 25;

/** T-19：贴边状态 */
let dockEnabled = true;
let shortcutEnabled = true;
let dockedEdge = null; // 'left' | 'right' | 'top' | 'bottom' | null
let dockFullBounds = null; // 贴边展开时的完整窗口 bounds
let dockDisplay = null; // 贴边所在显示器（workArea 快照）
let dockTarget = null; // 'full' | 'hidden' | null
let dockHoldTimer = null;
let dockPollTimer = null;
let dockLingerTimer = null;
let dockSlideTimer = null;
let dockSliding = false;
let dockLastAnimationAt = 0;
let dockGraceUntil = 0;
let positionSaveTimer = null;
let activeShortcut = null;
let windowSettingsWriter = null;
// T-21：系统状态小部件状态
let statusTimer = null;
let batteryTimer = null;
let lastCpuSample = null;
let batteryPercentCache = null;

/** T-15：空闲参数。默认 3 分钟无交互触发、两次至少间隔 90 秒；环境变量可临时调小便于目检 */
const IDLE_TRIGGER_MS = readPositiveEnvMs(
  'AI_PET_IDLE_TRIGGER_MS',
  DEFAULT_IDLE_TRIGGER_MS
);
const IDLE_MIN_INTERVAL_MS = readPositiveEnvMs(
  'AI_PET_IDLE_MIN_INTERVAL_MS',
  DEFAULT_MIN_INTERVAL_MS
);

function readPositiveEnvMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/* ---------------- T-21：系统状态小部件（CPU/内存/电池） ----------------
 *
 * 边界说明：本任务不允许修改 preload.js/ipc.js，渲染层唯一可用的
 * 主进程→渲染层通道是 idle:event（petAPI.idle.onTrigger）。因此这里
 * 复用该通道，以 payload.type='system-status' 与 T-15 空闲互动区分；
 * 渲染层 chat.js 按 type 分发，不干扰空闲冒泡。
 */

/** 采样 CPU 累计时间（Windows 上无 iowait，按 0 处理） */
function sampleCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    const iowait = Number.isFinite(times.iowait) ? times.iowait : 0;
    idle += times.idle + iowait;
    total +=
      times.user + times.nice + times.sys + times.idle + times.irq + iowait;
  }
  return { idle, total };
}

/** CPU 使用率（两次采样差值；首次采样返回 null） */
function readCpuPercent() {
  const current = sampleCpuTimes();
  if (!lastCpuSample) {
    lastCpuSample = current;
    return null;
  }
  const totalDelta = current.total - lastCpuSample.total;
  const idleDelta = current.idle - lastCpuSample.idle;
  lastCpuSample = current;
  if (totalDelta <= 0) {
    return null;
  }
  const percent = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
}

/** 内存：已用百分比 + GB 数值（供渲染层 tooltip） */
function readMemoryStatus() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const gb = (bytes) => Math.round((bytes / 1024 ** 3) * 10) / 10;
  return {
    memPercent: total > 0 ? Math.round((used / total) * 100) : null,
    memUsedGb: gb(used),
    memTotalGb: gb(total)
  };
}

/** Windows 电池百分比（无电池/查询失败返回 null）；其他平台不查询 */
function readBatteryInfo() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Battery | Select-Object -ExpandProperty EstimatedChargeRemaining'
      ],
      { timeout: BATTERY_QUERY_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const values = String(stdout || '')
          .split(/\r?\n/)
          .map((line) => Number(line.trim()))
          .filter((value) => Number.isFinite(value));
        if (values.length === 0) {
          resolve(null);
          return;
        }
        const percent = Math.round(
          values.reduce((sum, value) => sum + value, 0) / values.length
        );
        resolve({ percent: Math.min(100, Math.max(0, percent)) });
      }
    );
  });
}

/** 周期刷新电池缓存（避免每 2s 拉起 PowerShell） */
async function refreshBatteryCache() {
  if (process.platform !== 'win32') {
    batteryPercentCache = null;
    return;
  }
  try {
    const info = await readBatteryInfo();
    batteryPercentCache = info && info.percent != null ? info.percent : null;
  } catch (error) {
    console.warn('[widgets] 电池状态读取失败：', error);
    batteryPercentCache = null;
  }
}

/** 组装当前系统状态（同步读取，可直接推送/测试） */
function readSystemStatus() {
  const cpuPercent = readCpuPercent();
  const memory = readMemoryStatus();
  const onBattery =
    powerMonitor && typeof powerMonitor.isOnBatteryPower === 'function'
      ? powerMonitor.isOnBatteryPower()
      : false;
  const batteryState =
    batteryPercentCache == null
      ? onBattery
        ? 'battery'
        : 'ac'
      : onBattery
        ? 'battery'
        : 'charging';
  return {
    cpuPercent,
    memPercent: memory.memPercent,
    memUsedGb: memory.memUsedGb,
    memTotalGb: memory.memTotalGb,
    batteryPercent: batteryPercentCache,
    batteryState
  };
}

/** 推送系统状态到渲染层（复用 idle:event 通道，payload.type 区分） */
async function broadcastSystemStatus() {
  consumePomodoroNotificationRequest(); // T-21：番茄钟完成信号（先通知后随状态推送）
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainWindow.webContents ||
    mainWindow.webContents.isDestroyed()
  ) {
    return;
  }
  let status;
  try {
    status = readSystemStatus();
  } catch (error) {
    console.warn('[widgets] 读取系统状态失败：', error);
    return;
  }
  mainWindow.webContents.send(ipc.CHANNELS.idleEvent, {
    type: 'system-status',
    status,
    at: Date.now()
  });
}

/** 电源插拔事件：立即刷新电池并推送 */
function handlePowerChange() {
  void refreshBatteryCache().then(() => broadcastSystemStatus());
}

function startSystemStatusWidgets() {
  stopSystemStatusWidgets();
  void refreshBatteryCache();
  void broadcastSystemStatus();
  statusTimer = setInterval(() => void broadcastSystemStatus(), STATUS_POLL_MS);
  batteryTimer = setInterval(() => void refreshBatteryCache(), BATTERY_POLL_MS);
  try {
    powerMonitor.on('on-ac', handlePowerChange);
    powerMonitor.on('on-battery', handlePowerChange);
  } catch (error) {
    console.warn('[widgets] 电源事件监听不可用：', error);
  }
}

function stopSystemStatusWidgets() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  if (batteryTimer) {
    clearInterval(batteryTimer);
    batteryTimer = null;
  }
  try {
    powerMonitor.removeListener('on-ac', handlePowerChange);
    powerMonitor.removeListener('on-battery', handlePowerChange);
  } catch (_error) {
    // 监听移除失败不影响退出
  }
}

/* ---------------- T-21：番茄钟 Notification ---------------- */

/** 按设置语言生成主进程翻译器（settings.language='system' 时跟随系统） */
function getMainTranslator() {
  let stored = 'system';
  try {
    const settings = ipc.getSettings();
    if (settings && typeof settings.language === 'string') {
      stored = settings.language;
    }
  } catch (_error) {
    // 设置读取失败时跟随系统语言
  }
  const locale =
    stored === 'system'
      ? app && typeof app.getLocale === 'function'
        ? app.getLocale()
        : 'zh-CN'
      : stored;
  return createTranslator(locale);
}

/** 番茄钟结束：主进程系统通知（本地化标题/正文） */
function showPomodoroNotification(minutes) {
  const numeric = Number(minutes);
  const safeMinutes =
    Number.isFinite(numeric) && numeric > 0
      ? Math.round(numeric)
      : DEFAULT_POMODORO_MINUTES;
  const t = getMainTranslator();
  const title = t('pomodoro.notificationTitle');
  const body = t('pomodoro.notificationBody', { minutes: safeMinutes });
  try {
    const notification = new Notification({ title, body });
    notification.show();
  } catch (error) {
    console.warn('[pomodoro] 系统通知发送失败：', error);
  }
}

/**
 * 消费渲染层的番茄钟完成信号（settings.pomodoroNotifyAt > 0）。
 * 渲染层计时结束写入 settings（store.js 白名单字段），本函数随状态轮询
 * 读取并弹通知后清零，避免重复弹出。
 */
function consumePomodoroNotificationRequest() {
  let minutes = DEFAULT_POMODORO_MINUTES;
  let hasRequest = false;
  try {
    const settings = ipc.getSettings();
    const at = Number(settings && settings.pomodoroNotifyAt);
    hasRequest = Number.isFinite(at) && at > 0;
    if (hasRequest) {
      const requested = Number(settings && settings.pomodoroNotifyMinutes);
      if (Number.isFinite(requested) && requested > 0) {
        minutes = Math.min(120, Math.max(1, Math.round(requested)));
      }
    }
  } catch (_error) {
    return;
  }
  if (!hasRequest) {
    return;
  }
  try {
    getWindowSettingsWriter().writeSettings({
      pomodoroNotifyAt: 0,
      pomodoroNotifyMinutes: 0
    });
  } catch (error) {
    console.warn('[pomodoro] 清除通知信号失败：', error);
  }
  showPomodoroNotification(minutes);
}

/* ---------------- T-19：窗口设置读写 ---------------- */

/** 主进程独立的 secure-settings 实例（避免 store 直写截断 apiKey 密文） */
function getWindowSettingsWriter() {
  if (!windowSettingsWriter) {
    windowSettingsWriter = createSecureSettings({ store: createDefaultStore() });
  }
  return windowSettingsWriter;
}

function writeWindowSettings(patch) {
  try {
    return getWindowSettingsWriter().writeSettings(patch);
  } catch (error) {
    console.warn('[window] 保存窗口设置失败：', error);
    return null;
  }
}

/** 启动时读取贴边/快捷键开关（缺省开启） */
function loadWindowSettings() {
  try {
    const settings = ipc.getSettings();
    dockEnabled = settings.dockEnabled !== false;
    shortcutEnabled = settings.shortcutEnabled !== false;
  } catch (_error) {
    dockEnabled = true;
    shortcutEnabled = true;
  }
}

/** 持久化窗口位置（T-19：位置记忆） */
function persistWindowBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return;
  }
  writeWindowSettings({
    windowBounds: { x: Math.round(bounds.x), y: Math.round(bounds.y) }
  });
}

function getStoredWindowBounds() {
  try {
    const settings = ipc.getSettings();
    const bounds = settings && settings.windowBounds;
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
      return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
    }
  } catch (_error) {
    // 设置读取失败时回退默认位置
  }
  return null;
}

/** 校验保存的位置仍落在某个显示器内（防止显示器变更后窗口跑到屏幕外） */
function isBoundsVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth =
      Math.min(bounds.x + bounds.width, area.x + area.width) -
      Math.max(bounds.x, area.x);
    const overlapHeight =
      Math.min(bounds.y + bounds.height, area.y + area.height) -
      Math.max(bounds.y, area.y);
    return overlapWidth >= 40 && overlapHeight >= 40;
  });
}

function resolveInitialWindowBounds() {
  const saved = getStoredWindowBounds();
  if (!saved) {
    return {};
  }
  const candidate = { ...saved, width: 320, height: 420 };
  return isBoundsVisibleOnAnyDisplay(candidate) ? saved : {};
}

/* ---------------- T-19：贴边/滑出 ---------------- */

function getDockArea() {
  if (dockDisplay && dockDisplay.area) {
    return dockDisplay.area;
  }
  const base = dockFullBounds || (mainWindow ? mainWindow.getBounds() : null);
  if (!base) {
    return screen.getPrimaryDisplay().workArea;
  }
  return screen.getDisplayMatching(base).workArea;
}

/** 窗口当前 bounds 是否靠近屏幕边缘；返回命中的边缘或 null */
function findDockEdge(bounds) {
  if (!dockEnabled) {
    return null;
  }
  const area = screen.getDisplayMatching(bounds).workArea;
  if (Math.abs(bounds.x - area.x) <= DOCK_MARGIN) {
    return 'left';
  }
  if (Math.abs(bounds.x + bounds.width - (area.x + area.width)) <= DOCK_MARGIN) {
    return 'right';
  }
  if (Math.abs(bounds.y - area.y) <= DOCK_MARGIN) {
    return 'top';
  }
  if (Math.abs(bounds.y + bounds.height - (area.y + area.height)) <= DOCK_MARGIN) {
    return 'bottom';
  }
  return null;
}

function computeHiddenBounds() {
  const full = dockFullBounds;
  const area = getDockArea();
  switch (dockedEdge) {
    case 'left':
      return { ...full, x: area.x - (full.width - DOCK_STRIP) };
    case 'right':
      return { ...full, x: area.x + area.width - DOCK_STRIP };
    case 'top':
      return { ...full, y: area.y - (full.height - DOCK_STRIP) };
    case 'bottom':
      return { ...full, y: area.y + area.height - DOCK_STRIP };
    default:
      return full;
  }
}

/** 鼠标是否位于贴边边缘的“滑出触发区” */
function isCursorNearDockEdge(cursor) {
  const area = getDockArea();
  const margin = DOCK_PEEK_MARGIN;
  switch (dockedEdge) {
    case 'left':
      return (
        cursor.x <= area.x + margin &&
        cursor.y >= area.y - margin &&
        cursor.y <= area.y + area.height + margin
      );
    case 'right':
      return (
        cursor.x >= area.x + area.width - margin &&
        cursor.y >= area.y - margin &&
        cursor.y <= area.y + area.height + margin
      );
    case 'top':
      return (
        cursor.y <= area.y + margin &&
        cursor.x >= area.x - margin &&
        cursor.x <= area.x + area.width + margin
      );
    case 'bottom':
      return (
        cursor.y >= area.y + area.height - margin &&
        cursor.x >= area.x - margin &&
        cursor.x <= area.x + area.width + margin
      );
    default:
      return false;
  }
}

function stopDockAnimation() {
  if (dockSlideTimer) {
    clearInterval(dockSlideTimer);
    dockSlideTimer = null;
  }
  dockSliding = false;
}

function stopDockPolling() {
  if (dockPollTimer) {
    clearInterval(dockPollTimer);
    dockPollTimer = null;
  }
  if (dockLingerTimer) {
    clearTimeout(dockLingerTimer);
    dockLingerTimer = null;
  }
}

function startDockPolling() {
  stopDockPolling();
  dockPollTimer = setInterval(pollDock, DOCK_POLL_MS);
}

/** 在 full（完整展开）与 hidden（贴边细条）之间平滑移动窗口 */
function slideWindowTo(state) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !dockedEdge ||
    !dockFullBounds ||
    dockTarget === state
  ) {
    return;
  }
  const target = state === 'hidden' ? computeHiddenBounds() : dockFullBounds;
  const current = mainWindow.getBounds();
  if (
    Math.abs(current.x - target.x) < 2 &&
    Math.abs(current.y - target.y) < 2
  ) {
    dockTarget = state;
    return;
  }
  stopDockAnimation();
  dockTarget = state;
  dockSliding = true;
  const steps = Math.max(4, Math.round(DOCK_SLIDE_MS / 16));
  const dx = (target.x - current.x) / steps;
  const dy = (target.y - current.y) / steps;
  let step = 0;
  const applyBounds = (bounds) => {
    dockLastAnimationAt = Date.now();
    mainWindow.setBounds(bounds);
  };
  dockSlideTimer = setInterval(() => {
    step += 1;
    if (!mainWindow || mainWindow.isDestroyed()) {
      stopDockAnimation();
      return;
    }
    if (step >= steps) {
      applyBounds(target);
      stopDockAnimation();
      return;
    }
    applyBounds({
      x: Math.round(current.x + dx * step),
      y: Math.round(current.y + dy * step),
      width: target.width,
      height: target.height
    });
  }, 16);
}

function dockWindow(edge, bounds) {
  if (!dockEnabled || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const full = { ...bounds };
  switch (edge) {
    case 'left':
      full.x = area.x;
      break;
    case 'right':
      full.x = area.x + area.width - bounds.width;
      break;
    case 'top':
      full.y = area.y;
      break;
    case 'bottom':
      full.y = area.y + area.height - bounds.height;
      break;
  }
  // 先保存贴边展开位置（作为下次恢复的“正常位置”）
  persistWindowBounds(full);
  dockedEdge = edge;
  dockFullBounds = full;
  dockDisplay = { id: display.id, area: { ...area } };
  dockTarget = null;
  stopDockAnimation();
  clearTimeout(dockHoldTimer);
  startDockPolling();
  slideWindowTo('hidden');
}

function undockWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    dockedEdge = null;
    dockFullBounds = null;
    dockDisplay = null;
    dockTarget = null;
    stopDockPolling();
    stopDockAnimation();
    return;
  }
  const bounds = mainWindow.getBounds();
  dockedEdge = null;
  dockFullBounds = null;
  dockDisplay = null;
  dockTarget = null;
  dockGraceUntil = Date.now() + DOCK_REGRAB_GRACE_MS;
  clearTimeout(dockHoldTimer);
  stopDockPolling();
  stopDockAnimation();
  persistWindowBounds(bounds);
}

/** 沿贴边边缘拖动时同步“完整展开”位置，避免滑出时跳回旧坐标 */
function syncDockFullBounds(bounds) {
  if (!dockFullBounds || !dockedEdge) {
    return;
  }
  const area = getDockArea();
  const next = {
    x: bounds.x,
    y: bounds.y,
    width: dockFullBounds.width,
    height: dockFullBounds.height
  };
  switch (dockedEdge) {
    case 'left':
      next.x = area.x;
      break;
    case 'right':
      next.x = area.x + area.width - next.width;
      break;
    case 'top':
      next.y = area.y;
      break;
    case 'bottom':
      next.y = area.y + area.height - next.height;
      break;
  }
  dockFullBounds = next;
  persistWindowBounds(next);
}

function pollDock() {
  if (
    !dockEnabled ||
    !dockedEdge ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainWindow.isVisible()
  ) {
    stopDockPolling();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  if (isCursorNearDockEdge(cursor)) {
    clearTimeout(dockLingerTimer);
    dockLingerTimer = null;
    if (dockTarget !== 'full') {
      slideWindowTo('full');
    }
    return;
  }

  // 鼠标不在触发区：只要鼠标仍在窗口内或窗口聚焦，就保持展开
  const bounds = mainWindow.getBounds();
  const insideWindow =
    cursor.x >= bounds.x - 4 &&
    cursor.x <= bounds.x + bounds.width + 4 &&
    cursor.y >= bounds.y - 4 &&
    cursor.y <= bounds.y + bounds.height + 4;
  if (insideWindow || mainWindow.isFocused()) {
    clearTimeout(dockLingerTimer);
    dockLingerTimer = null;
    return;
  }
  if (!dockLingerTimer) {
    dockLingerTimer = setTimeout(() => {
      dockLingerTimer = null;
      if (
        dockedEdge &&
        mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.isFocused()
      ) {
        slideWindowTo('hidden');
      }
    }, DOCK_LINGER_MS);
  }
}

function handleWindowMove() {
  if (!mainWindow || mainWindow.isDestroyed() || dockSliding) {
    return;
  }
  // 贴边动画产生的 move 事件在动画结束后仍可能异步到达，短窗口内忽略
  if (Date.now() - dockLastAnimationAt < DOCK_ANIMATION_IGNORE_MS) {
    return;
  }
  const bounds = mainWindow.getBounds();
  if (dockedEdge) {
    if (dockTarget === 'hidden') {
      // 从贴边细条直接拖动：先展开到完整位置再取消贴边，避免留下半截细条位置
      stopDockAnimation();
      if (dockFullBounds) {
        dockLastAnimationAt = Date.now();
        mainWindow.setBounds(dockFullBounds);
      }
      undockWindow();
    } else if (!findDockEdge(bounds)) {
      // 用户拖动已贴边（展开态）窗口离开边缘时取消贴边
      undockWindow();
    } else if (dockFullBounds) {
      syncDockFullBounds(bounds);
    }
    return;
  }
  schedulePositionSave();
  if (!dockEnabled || Date.now() < dockGraceUntil) {
    return;
  }
  clearTimeout(dockHoldTimer);
  dockHoldTimer = null;
  const edge = findDockEdge(bounds);
  if (edge) {
    dockHoldTimer = setTimeout(() => {
      dockHoldTimer = null;
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        dockedEdge ||
        dockSliding
      ) {
        return;
      }
      const current = mainWindow.getBounds();
      if (findDockEdge(current) === edge) {
        dockWindow(edge, current);
      }
    }, DOCK_HOLD_MS);
  }
}

function handleWindowMoved() {
  if (!mainWindow || mainWindow.isDestroyed() || dockedEdge || dockSliding) {
    return;
  }
  persistWindowBounds(mainWindow.getBounds());
}

/** 移动结束后延迟落盘位置（Windows 上程序化移动可能不触发 moved 事件） */
function schedulePositionSave() {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      dockedEdge ||
      dockSliding
    ) {
      return;
    }
    persistWindowBounds(mainWindow.getBounds());
  }, 500);
}

/* ---------------- T-19：全局快捷键 ---------------- */

/** 注册全局快捷键；全部候选被占用时返回 false（ADR-022 冲突处理） */
function tryRegisterShortcut() {
  unregisterShortcut();
  for (const accelerator of SHORTCUT_CANDIDATES) {
    try {
      if (globalShortcut.register(accelerator, () => showMainWindow())) {
        activeShortcut = accelerator;
        console.log(`[window] 全局快捷键已注册：${accelerator}`);
        return true;
      }
    } catch (error) {
      console.warn(`[window] 注册全局快捷键失败 ${accelerator}：`, error);
    }
  }
  console.warn(
    '[window] 全局快捷键注册失败，所有候选按键均被占用：' +
      SHORTCUT_CANDIDATES.join(', ')
  );
  return false;
}

function unregisterShortcut() {
  if (activeShortcut) {
    try {
      globalShortcut.unregister(activeShortcut);
    } catch (_error) {
      // 注销失败不影响运行
    }
    activeShortcut = null;
  }
}

/* ---------------- T-19：IPC（ADR-022 冻结契约） ---------------- */

function handleToggleDock() {
  dockEnabled = !dockEnabled;
  if (!dockEnabled && dockedEdge && mainWindow && !mainWindow.isDestroyed()) {
    stopDockAnimation();
    const full = dockFullBounds || mainWindow.getBounds();
    mainWindow.setBounds(full);
    undockWindow();
  }
  writeWindowSettings({ dockEnabled });
  return { docked: dockEnabled };
}

function handleSetShortcutEnabled(_event, enabled) {
  const requested = enabled === true;
  let registered = false;
  if (requested) {
    registered = tryRegisterShortcut();
  } else {
    unregisterShortcut();
  }
  shortcutEnabled = registered;
  writeWindowSettings({ shortcutEnabled });
  return { enabled: shortcutEnabled };
}

function registerWindowIpc() {
  ipcMain.handle(WINDOW_CHANNELS.toggleDock, handleToggleDock);
  ipcMain.handle(WINDOW_CHANNELS.setShortcut, handleSetShortcutEnabled);
}

/* ---------------- 窗口生命周期 ---------------- */

function createMainWindow() {
  if (mainWindow) return mainWindow;

  const savedPosition = resolveInitialWindowBounds(); // T-19: 位置恢复
  const win = new BrowserWindow({
    ...savedPosition,
    width: 320,
    height: 420,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: loadAppIcon(), // T-10: 正式图标（assets/icon.png，内嵌 base64 回退）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('show', () => {
    idleMonitor?.markActivity(); // T-15: 显示窗口视为交互
    trayApi?.refreshMenu();
    if (dockedEdge) {
      startDockPolling(); // T-19: 从托盘恢复显示时恢复贴边轮询
    }
  });
  win.on('hide', () => {
    trayApi?.refreshMenu();
    stopDockPolling(); // T-19: 隐藏到托盘时停止贴边轮询
  });
  win.on('focus', () => {
    idleMonitor?.markActivity(); // T-15: 聚焦视为交互
    if (dockedEdge) {
      slideWindowTo('full'); // T-19: 点击/聚焦贴边窗口时展开
    }
  });

  // T-19: 拖动过程检测贴边；移动结束后记忆位置
  win.on('move', handleWindowMove);
  win.on('moved', handleWindowMoved);

  // 关闭窗口时隐藏到托盘，而不是退出应用
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
      trayApi?.refreshMenu();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
    dockedEdge = null;
    dockFullBounds = null;
    dockDisplay = null;
    dockTarget = null;
    stopDockPolling();
    stopDockAnimation();
    clearTimeout(dockHoldTimer);
    clearTimeout(positionSaveTimer);
  });

  mainWindow = win;
  return win;
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (dockedEdge && mainWindow.isVisible()) {
    slideWindowTo('full'); // T-19: 呼出时展开贴边窗口
  }
  mainWindow.focus();
  trayApi?.refreshMenu();
}

function toggleMainWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
  trayApi?.refreshMenu();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// 单实例锁：再次启动时聚焦已有实例，而不是开第二个进程。
// 纯 Node/自动化测试环境（无 Electron app 或显式设置 AI_PET_SKIP_BOOTSTRAP=1）
// 仅导出可测试函数，不启动 Electron 生命周期。
const SKIP_BOOTSTRAP = process.env.AI_PET_SKIP_BOOTSTRAP === '1';
if (SKIP_BOOTSTRAP || !app || typeof app.requestSingleInstanceLock !== 'function') {
  // 测试环境：跳过 Electron 生命周期
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // T-11: 尽早初始化 crashReporter（app ready 前），保证渲染进程也受监控
  initCrash();

  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow();
  });

  app.whenReady().then(() => {
    loadWindowSettings(); // T-19: 读取贴边/快捷键开关
    createMainWindow();
    registerWindowIpc(); // T-19: window:toggle-dock / window:set-shortcut
    startSystemStatusWidgets(); // T-21: CPU/内存/电池状态推送
    if (shortcutEnabled && !tryRegisterShortcut()) {
      // 快捷键被其他应用占用：自动关闭并持久化，避免每次启动重试
      shortcutEnabled = false;
      writeWindowSettings({ shortcutEnabled: false });
    }
    trayApi = createTray({
      getMainWindow: () => mainWindow,
      showMainWindow,
      toggleMainWindow,
      quitApp
    });

    // T-15: 空闲主动互动（节流、防打扰、可关闭）
    idleMonitor = createIdleMonitor({
      triggerMs: IDLE_TRIGGER_MS,
      minIntervalMs: IDLE_MIN_INTERVAL_MS,
      isEnabled: () => {
        try {
          return ipc.getSettings().idleEnabled !== false;
        } catch (_error) {
          return false; // 设置读取失败时不打扰
        }
      },
      onTrigger: () => {
        const win = mainWindow;
        if (!win || win.isDestroyed() || !win.isVisible() || !win.webContents) {
          return false; // 窗口隐藏/不可用时不算触发，等待下一次检查
        }
        win.webContents.send(ipc.CHANNELS.idleEvent, { at: Date.now() });
        return true;
      }
    });
    ipc.onActivity(() => idleMonitor.markActivity());
    idleMonitor.start();

    // macOS 点击 Dock 图标时恢复窗口；Windows 下通常不会触发
    app.on('activate', showMainWindow);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopSystemStatusWidgets(); // T-21: 退出前停止状态轮询
    if (mainWindow && !mainWindow.isDestroyed() && !dockedEdge) {
      persistWindowBounds(mainWindow.getBounds()); // T-19: 退出前记忆位置
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll(); // T-19: 释放全局快捷键
  });

  // 应用常驻托盘：窗口全部关闭时不退出，由托盘菜单“退出”结束进程。
  // 若窗口因任何原因被销毁，空监听可阻止 Electron 默认退出行为。
  app.on('window-all-closed', () => {
    // 保持应用与托盘存活
  });
}

module.exports = {
  sampleCpuTimes,
  readCpuPercent,
  readMemoryStatus,
  readBatteryInfo,
  refreshBatteryCache,
  readSystemStatus,
  broadcastSystemStatus,
  getMainTranslator,
  showPomodoroNotification,
  consumePomodoroNotificationRequest
};

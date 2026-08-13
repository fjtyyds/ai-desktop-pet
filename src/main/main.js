'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen
} = require('electron');
const path = require('path');
const { createTray, loadAppIcon } = require('./tray');
const { initCrash, writeLog } = require('./crash'); // T-11: 崩溃上报与本地日志
const { initUpdater, AUTO_UPDATE_CHECK_DELAY_MS } = require('./updater'); // T-37: 自动更新
const ipc = require('./ipc'); // T-03: 注册 chat/settings IPC；T-15: 空闲互动接线
const { createSecureSettings } = require('./secure-settings'); // T-19: 窗口设置持久化
const { createDefaultStore, resolveBaseDir } = require('../storage'); // T-19: 窗口设置写入；T-42: 遥测数据目录
const { createTranslator } = require('../shared/locales'); // T-12: 本地化翻译
const { initTelemetry } = require('./telemetry'); // T-42: 匿名遥测（opt-in、默认关闭）
const {
  createIdleMonitor,
  DEFAULT_IDLE_TRIGGER_MS,
  DEFAULT_MIN_INTERVAL_MS
} = require('./idle'); // T-15: 空闲主动互动计时
const { createPetOverlay } = require('./pet-overlay'); // T-55: 宠物浮窗（Codex Pets 式）

let mainWindow = null;
let trayApi = null;
let isQuitting = false;
let idleMonitor = null;
let updaterApi = null; // T-37: 自动更新（仅打包版初始化）
let telemetryApi = null; // T-42: 匿名遥测实例
let telemetrySessionStartedAt = 0; // T-42: 会话时长统计起点
let petOverlayApi = null; // T-55: 宠物浮窗实例

/** T-19：窗口体验 IPC 通道（ADR-022 冻结契约；preload.js 同名常量保持一致） */
const WINDOW_CHANNELS = {
  toggleDock: 'window:toggle-dock',
  minimize: 'window:minimize' // T-25：最小化到任务栏（ADR-026 冻结契约）
};

/** T-31：贴边吸附参数（方案 B：靠边吸附、不自动隐藏；ADR-026） */
const DOCK_MARGIN = 24; // 距离屏幕边缘多近视为“靠边”
const DOCK_REGRAB_GRACE_MS = 800; // 取消吸附后的短暂窗口，防止程序化 setBounds 触发再次吸附
const DOCK_MOVE_DEBOUNCE_MS = 200; // T-35：Windows 下 moved 不触发，以 200ms 无 move 判定拖放结束

/** T-24：窗口可缩放的最小尺寸（建议 ≥280×360） */
const MIN_WINDOW_WIDTH = 280;
const MIN_WINDOW_HEIGHT = 360;

/** T-31：贴边吸附状态 */
let dockEnabled = true;
let dockedEdge = null; // 'left' | 'right' | 'top' | 'bottom' | null
let dockFullBounds = null; // 吸附对齐后的窗口 bounds（兼作位置记忆基准）
let dockGraceUntil = 0; // 取消吸附后的防重复触发窗口
let positionSaveTimer = null;
let dockMoveDebounceTimer = null; // T-35：move 防抖定时器（Windows 拖放结束判定）
let windowSettingsWriter = null;
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

/** T-37：更新器日志：console + 现有本地日志文件双写 */
function createUpdaterLogger() {
  function write(level, message) {
    // message 已带 [updater] 前缀（updater.js 统一包装）
    console[level === 'debug' ? 'log' : level](message);
    try {
      writeLog(level, message);
    } catch (_error) {
      // 日志落盘失败不影响更新链路
    }
  }
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    debug: (message) => write('debug', message)
  };
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

/** 启动时读取贴边吸附开关（缺省开启） */
function loadWindowSettings() {
  try {
    const settings = ipc.getSettings();
    dockEnabled = settings.dockEnabled !== false;
  } catch (_error) {
    dockEnabled = true;
  }
}

/** 持久化窗口位置与尺寸（T-19 位置记忆；T-24 可缩放后一并保存尺寸） */
function persistWindowBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return;
  }
  writeWindowSettings({
    windowBounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Number.isFinite(bounds.width)
        ? Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width))
        : 320,
      height: Number.isFinite(bounds.height)
        ? Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height))
        : 420
    }
  });
}

function getStoredWindowBounds() {
  try {
    const settings = ipc.getSettings();
    const bounds = settings && settings.windowBounds;
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
      return {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Number.isFinite(bounds.width)
          ? Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width))
          : 320,
        height: Number.isFinite(bounds.height)
          ? Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height))
          : 420
      };
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
  const candidate = {
    ...saved,
    width: Math.max(MIN_WINDOW_WIDTH, saved.width || 320),
    height: Math.max(MIN_WINDOW_HEIGHT, saved.height || 420)
  };
  return isBoundsVisibleOnAnyDisplay(candidate) ? saved : {};
}

/* ---------------- T-31：贴边吸附（方案 B：靠边吸附、不自动隐藏；ADR-026） ---------------- */

/** 窗口当前 bounds 是否靠近屏幕边缘；返回最近命中边缘或 null */
function findDockEdge(bounds) {
  if (!dockEnabled) {
    return null;
  }
  const area = screen.getDisplayMatching(bounds).workArea;
  const candidates = [
    { edge: 'left', distance: Math.abs(bounds.x - area.x) },
    {
      edge: 'right',
      distance: Math.abs(bounds.x + bounds.width - (area.x + area.width))
    },
    { edge: 'top', distance: Math.abs(bounds.y - area.y) },
    {
      edge: 'bottom',
      distance: Math.abs(bounds.y + bounds.height - (area.y + area.height))
    }
  ];
  let best = null;
  for (const candidate of candidates) {
    if (
      candidate.distance <= DOCK_MARGIN &&
      (!best || candidate.distance < best.distance)
    ) {
      best = candidate;
    }
  }
  return best ? best.edge : null;
}

/** 吸附窗口到指定屏幕边缘：完整窗口贴边对齐，不缩成细条、不自动隐藏 */
function dockWindow(edge, bounds) {
  if (!dockEnabled || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const area = screen.getDisplayMatching(bounds).workArea;
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
  dockedEdge = edge;
  dockFullBounds = full;
  // 吸附后的位置即“正常位置”，作为位置记忆与下次启动恢复
  persistWindowBounds(full);
  mainWindow.setBounds(full);
}

/** 取消吸附：保留当前位置作为自由位置，并短暂阻止程序化移动触发再次吸附 */
function undockWindow() {
  const bounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  dockedEdge = null;
  dockFullBounds = null;
  dockGraceUntil = Date.now() + DOCK_REGRAB_GRACE_MS;
  if (bounds) {
    persistWindowBounds(bounds);
  }
}

/** 沿贴边边缘拖动时同步吸附基准位置，松手后据此贴齐，避免跳回旧坐标 */
function syncDockFullBounds(bounds) {
  if (!dockFullBounds || !dockedEdge) {
    return;
  }
  const area = screen.getDisplayMatching(bounds).workArea;
  const next = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
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

function handleWindowMove() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const bounds = mainWindow.getBounds();
  if (dockedEdge) {
    // 拖动离开边缘（超出吸附阈值）立即取消吸附，恢复自由位置
    if (!findDockEdge(bounds)) {
      undockWindow();
    } else if (dockFullBounds) {
      // 仍在边缘附近：仅同步吸附基准，不打断用户拖动
      syncDockFullBounds(bounds);
    }
  } else {
    schedulePositionSave();
  }
  // T-35：Windows 上 moved 事件不触发，以 200ms 无 move 视为拖放结束；
  // 已吸附沿边拖动同样走防抖对齐；防抖在程序化 setBounds 之后自然收敛，不会重复吸附
  scheduleDockMoveEnd();
}

/** T-35：共享的“拖放结束”处理：已吸附→对齐，未吸附且靠边→吸附，否则仅持久化 */
function handleDragEnd() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const bounds = mainWindow.getBounds();
  if (dockedEdge) {
    // 已吸附：拖动/程序化移动结束后贴齐到最新基准
    if (dockFullBounds) {
      const aligned = dockFullBounds;
      if (
        Math.abs(bounds.x - aligned.x) >= 1 ||
        Math.abs(bounds.y - aligned.y) >= 1 ||
        bounds.width !== aligned.width ||
        bounds.height !== aligned.height
      ) {
        mainWindow.setBounds(aligned);
      }
      persistWindowBounds(aligned);
    }
    return;
  }
  if (Date.now() < dockGraceUntil) {
    persistWindowBounds(bounds);
    return;
  }
  const edge = findDockEdge(bounds);
  if (edge) {
    // 拖放结束且仍在边缘附近：吸附到边缘（dockWindow 内会持久化位置）
    dockWindow(edge, bounds);
    return;
  }
  persistWindowBounds(bounds);
}

/** T-35：macOS 兼容入口：moved 是拖放结束信号，直接复用共享处理 */
function handleWindowMoved() {
  handleDragEnd();
}

/** T-35：move 事件防抖调度：约 200ms 无 move 即视为拖放结束（Windows） */
function scheduleDockMoveEnd() {
  clearTimeout(dockMoveDebounceTimer);
  dockMoveDebounceTimer = setTimeout(() => {
    dockMoveDebounceTimer = null;
    handleDragEnd();
  }, DOCK_MOVE_DEBOUNCE_MS);
}

/** T-53：最小化时停止“贴边轮询”的 T-25 语义保留；
 * T-31/T-35 起已改为 move 防抖（scheduleDockMoveEnd），不再有轮询，
 * 此处仅清理防抖定时器，避免对最小化窗口执行拖放结束处理。 */
function stopDockPolling() {
  clearTimeout(dockMoveDebounceTimer);
}

/** 缩放时保持吸附边贴齐；缩放导致吸附边离开边缘则取消吸附 */
function handleWindowResize() {
  if (!mainWindow || mainWindow.isDestroyed() || !dockedEdge) {
    return;
  }
  const bounds = mainWindow.getBounds();
  if (!findDockEdge(bounds)) {
    undockWindow();
    return;
  }
  const area = screen.getDisplayMatching(bounds).workArea;
  const next = { ...bounds };
  switch (dockedEdge) {
    case 'left':
      next.x = area.x;
      break;
    case 'right':
      next.x = area.x + area.width - bounds.width;
      break;
    case 'top':
      next.y = area.y;
      break;
    case 'bottom':
      next.y = area.y + area.height - bounds.height;
      break;
  }
  dockFullBounds = next;
  persistWindowBounds(next);
  if (next.x !== bounds.x || next.y !== bounds.y) {
    mainWindow.setBounds(next);
  }
}

/** 移动结束后延迟落盘位置（Windows 上程序化移动可能不触发 moved 事件） */
function schedulePositionSave() {
  clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    if (!mainWindow || mainWindow.isDestroyed() || dockedEdge) {
      return;
    }
    persistWindowBounds(mainWindow.getBounds());
  }, 500);
}

/* ---------------- T-19：IPC（ADR-022 冻结契约） ---------------- */

function handleToggleDock() {
  dockEnabled = !dockEnabled;
  if (!dockEnabled && dockedEdge) {
    undockWindow();
  } else if (
    dockEnabled &&
    !dockedEdge &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    // 重新开启且当前已靠近边缘时，立即吸附
    const bounds = mainWindow.getBounds();
    const edge = findDockEdge(bounds);
    if (edge) {
      dockWindow(edge, bounds);
    }
  }
  writeWindowSettings({ dockEnabled });
  return { docked: dockEnabled };
}

/** T-25：最小化到任务栏（区别于 ✕ 隐藏到托盘；ADR-026 冻结契约） */
function handleWindowMinimize(event) {
  ipc.notifyActivity(); // T-15：点击最小化视为交互
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.minimize();
  }
}

function registerWindowIpc() {
  ipcMain.handle(WINDOW_CHANNELS.toggleDock, handleToggleDock);
  ipcMain.handle(WINDOW_CHANNELS.minimize, handleWindowMinimize);
}

/* ---------------- 窗口生命周期 ---------------- */

function createMainWindow() {
  if (mainWindow) return mainWindow;

  const savedPosition = resolveInitialWindowBounds(); // T-19: 位置恢复
  const win = new BrowserWindow({
    width: 320,
    height: 420,
    minWidth: MIN_WINDOW_WIDTH, // T-24：可缩放并设置合理最小尺寸
    minHeight: MIN_WINDOW_HEIGHT,
    ...savedPosition, // T-19/T-24：恢复位置与已保存的窗口尺寸
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true, // T-24：窗口可缩放，聊天区随窗口自适应
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
  });
  win.on('hide', () => {
    trayApi?.refreshMenu();
  });
  win.on('minimize', () => {
    stopDockPolling(); // T-25：最小化时停止贴边轮询，避免对最小化窗口做位置动画
  });
  win.on('focus', () => {
    idleMonitor?.markActivity(); // T-15: 聚焦视为交互
  });

  // T-31: 拖动结束检测贴边吸附；移动/缩放过程保持位置记忆
  win.on('move', handleWindowMove);
  win.on('moved', handleWindowMoved);
  win.on('resize', handleWindowResize); // T-31: 缩放时保持吸附边贴齐

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
    clearTimeout(positionSaveTimer);
    clearTimeout(dockMoveDebounceTimer);
    dockMoveDebounceTimer = null;
  });

  mainWindow = win;
  return win;
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
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
    loadWindowSettings(); // T-19: 读取贴边开关

    // T-42：初始化匿名遥测（默认关闭；端点默认空=不上传）。
    // 开关实时从设置读取：未开启时 track/flush 一律丢弃，绝不外发。
    telemetryApi = initTelemetry({
      baseDir: path.join(resolveBaseDir(), 'telemetry'),
      endpoint: process.env.AI_PET_TELEMETRY_ENDPOINT || '',
      getEnabled: () => {
        try {
          return ipc.getSettings().telemetryEnabled === true;
        } catch (_error) {
          return false; // 设置读取失败按关闭处理
        }
      }
    });
    telemetrySessionStartedAt = Date.now();
    telemetryApi.trackInstallIfFirstRun();
    telemetryApi.track('app_start', {
      sessionId: telemetryApi.getSessionId(),
      version: app.getVersion(),
      locale: typeof app.getLocale === 'function' ? app.getLocale() : ''
    });
    telemetryApi.flush(); // 尽力补发上次残留队列（失败保留，下次再试）

    createMainWindow();
    // T-55：创建宠物浮窗（独立悬浮宠物）；默认关闭，按设置决定是否显示
    petOverlayApi = createPetOverlay({
      getSettings: () => ipc.getSettings(),
      getTray: () => trayApi
    });
    try {
      const settings = ipc.getSettings();
      if (settings && settings.petOverlayEnabled === true) {
        petOverlayApi.show();
      }
    } catch (_error) {
      // 设置读取失败时不自动显示浮窗
    }
    registerWindowIpc(); // T-19/T-25: window:toggle-dock / window:minimize
    // T-37: 仅打包版初始化自动更新（开发模式绝不检查；updater 内部还有二次守卫）
    if (app.isPackaged) {
      updaterApi = initUpdater({
        getMainWindow: () => mainWindow,
        getTranslator: getMainTranslator,
        logger: createUpdaterLogger()
      });
      setTimeout(() => {
        updaterApi?.checkForUpdates({ manual: false });
      }, AUTO_UPDATE_CHECK_DELAY_MS);
    }

    trayApi = createTray({
      getMainWindow: () => mainWindow,
      showMainWindow,
      toggleMainWindow,
      quitApp,
      checkForUpdates: () => updaterApi?.checkForUpdates({ manual: true }), // T-37: 托盘手动检查
      togglePetOverlay: () => petOverlayApi?.toggle(), // T-55: 托盘显示/隐藏宠物浮窗
      getPetOverlayVisible: () => petOverlayApi?.isVisible?.() ?? false // T-55
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
        const winReady = Boolean(
          win && !win.isDestroyed() && win.isVisible() && win.webContents
        );
        let handled = false;
        if (winReady) {
          win.webContents.send(ipc.CHANNELS.idleEvent, { at: Date.now() });
          handled = true;
        }
        // T-57：提醒透出到浮窗（主窗口隐藏也可见；受 petOverlayReminders 控制）
        let remindersEnabled = true;
        try {
          const settings = ipc.getSettings();
          remindersEnabled = settings
            ? settings.petOverlayReminders !== false
            : true;
        } catch (_error) {
          // 设置读取失败按开启处理
        }
        if (remindersEnabled && petOverlayApi?.isVisible?.()) {
          petOverlayApi.pushBubble({ state: 'attention' });
          handled = true;
        }
        return handled;
      }
    });
    ipc.onActivity(() => idleMonitor.markActivity());
    idleMonitor.start();

    // T-42：网络恢复时立即尝试补发遥测队列（失败不影响应用）
    app.on('online', () => {
      telemetryApi?.flush();
    });

    // macOS 点击 Dock 图标时恢复窗口；Windows 下通常不会触发
    app.on('activate', showMainWindow);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    petOverlayApi?.dispose?.(); // T-55: 退出前销毁浮窗
    updaterApi?.handleBeforeQuit(); // T-37: 用户确认后执行 quitAndInstall
    // T-42：退出前记录会话时长（留存漏斗）；补发为尽力而为，失败保留队列
    if (telemetryApi && telemetrySessionStartedAt > 0) {
      telemetryApi.track('session_end', {
        sessionId: telemetryApi.getSessionId(),
        durationSec: Math.max(
          0,
          Math.round((Date.now() - telemetrySessionStartedAt) / 1000)
        )
      });
      telemetryApi.flush();
    }
    if (mainWindow && !mainWindow.isDestroyed() && !dockedEdge) {
      persistWindowBounds(mainWindow.getBounds()); // T-19: 退出前记忆位置
    }
  });

  // 应用常驻托盘：窗口全部关闭时不退出，由托盘菜单“退出”结束进程。
  // 若窗口因任何原因被销毁，空监听可阻止 Electron 默认退出行为。
  app.on('window-all-closed', () => {
    // 保持应用与托盘存活
  });
}

module.exports = {
  getMainTranslator
};

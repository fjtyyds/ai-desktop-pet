'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createTray, loadAppIcon } = require('./tray');
const { initCrash } = require('./crash'); // T-11: 崩溃上报与本地日志
const ipc = require('./ipc'); // T-03: 注册 chat/settings IPC；T-15: 空闲互动接线
const {
  createIdleMonitor,
  DEFAULT_IDLE_TRIGGER_MS,
  DEFAULT_MIN_INTERVAL_MS
} = require('./idle'); // T-15: 空闲主动互动计时

let mainWindow = null;
let trayApi = null;
let isQuitting = false;
let idleMonitor = null;

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

function createMainWindow() {
  if (mainWindow) return mainWindow;

  const win = new BrowserWindow({
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
  });
  win.on('hide', () => trayApi?.refreshMenu());
  win.on('focus', () => idleMonitor?.markActivity()); // T-15: 聚焦视为交互

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

// 单实例锁：再次启动时聚焦已有实例，而不是开第二个进程
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // T-11: 尽早初始化 crashReporter（app ready 前），保证渲染进程也受监控
  initCrash();

  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow();
  });

  app.whenReady().then(() => {
    createMainWindow();
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
  });

  // 应用常驻托盘：窗口全部关闭时不退出，由托盘菜单“退出”结束进程。
  // 若窗口因任何原因被销毁，空监听可阻止 Electron 默认退出行为。
  app.on('window-all-closed', () => {
    // 保持应用与托盘存活
  });
}

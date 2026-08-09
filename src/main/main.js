'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createTray } = require('./tray');
const { initCrash } = require('./crash'); // T-11: 崩溃上报与本地日志
require('./ipc'); // T-03: 注册 chat/settings IPC

let mainWindow = null;
let trayApi = null;
let isQuitting = false;

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('show', () => trayApi?.refreshMenu());
  win.on('hide', () => trayApi?.refreshMenu());

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

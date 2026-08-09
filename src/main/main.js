'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createTray, refreshMenu } = require('./tray');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createMainWindow() {
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

  // 关闭窗口时隐藏到托盘而不是退出应用；真正退出走托盘菜单
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // 窗口显示状态变化时同步托盘菜单文案
  win.on('show', () => refreshMenu(mainWindow, trayCallbacks));
  win.on('hide', () => refreshMenu(mainWindow, trayCallbacks));

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

const trayCallbacks = { quit: quitApp };

// 单实例锁：第二次启动直接退出，并通知已运行实例显示窗口
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    mainWindow = createMainWindow();
    tray = createTray(mainWindow, trayCallbacks);
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createTray } = require('./tray');

let mainWindow = null;

// 单实例锁：桌宠只允许一个实例；重复启动时唤起已有窗口
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      showMainWindow();
    }
  });

  function createMainWindow() {
    mainWindow = new BrowserWindow({
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

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // 关闭窗口 = 隐藏到托盘；仅真正的退出流程才销毁窗口
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    return mainWindow;
  }

  function showMainWindow() {
    if (!mainWindow) {
      createMainWindow();
    }
    mainWindow.show();
    mainWindow.focus();
  }

  function toggleMainWindow() {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  }

  app.whenReady().then(() => {
    app.isQuitting = false;
    createMainWindow();
    createTray({
      onToggle: toggleMainWindow,
      onQuit: () => app.quit()
    });

    // macOS 惯例：点击 Dock 图标时若无窗口则重新创建
    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });

  app.on('window-all-closed', () => {
    // 桌宠驻留托盘：所有窗口关闭时不退出，由托盘菜单“退出”结束进程
    if (process.platform === 'darwin') {
      return;
    }
  });
}
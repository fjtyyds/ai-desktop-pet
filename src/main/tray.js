'use strict';

const { Tray, Menu, nativeImage } = require('electron');

/**
 * 托盘图标（32x32 爪印 PNG，base64 内嵌，避免引入额外资源文件）。
 */
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGdSURBVFhH7ZatTwNBEMUrK5HISmQlaXeylcgaFKYSiUDgWtfOlqQSyZ+ARCIJBiQSSYIBh+osmW1a7uY+9na35/pLXtLrTd67m72b207nwIEE7Fz37HI4srf6RJ5rFTvVXUJ1bw3YrQjh0Rp9LGtbgYy6y4bvLsLAk6zdC9lWu98l4Ttx3b6WpqzV64V6LYTmuqBecscpS1PV6lBFLY231aFaDkcyoxaLalww2ZmV/OcRLeBKZtRiDUykSc4Q4St7vEb1I2uEbmRGLdYM+iUmGalzd5EIM0K4JBxAsSYjVGOZ4YUfnoLR5kn/4Dcktd4LP4iE6j1nhuqTFsNTd57f9a2muuurj8IZ51oNF2wq7/I/DK6z9Xalj6RnFO7uKlostenCoC89otlMRHiTQXVyXZrrnvSKggw8yIAmIgPP0isYXkNpHKTULtROxGaaSM8gfBOxgcImoCT5oxT6ESpDDpemIlTfURNQwu+0MysJqRMZdSa9omEzMupXhlSJp6D0SIa3Vr5dkpsZqXtBH25zyh8ghNlW3KHWgw+0wR8dB9enD06lyQAAAABJRU5ErkJggg==';

let tray = null;

function toggleWindow(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function buildContextMenu(mainWindow, callbacks) {
  const visible =
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  return Menu.buildFromTemplate([
    {
      label: visible ? '隐藏桌宠' : '显示桌宠',
      click: () => toggleWindow(mainWindow)
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => callbacks.quit()
    }
  ]);
}

/**
 * 创建系统托盘图标。
 * @param {Electron.BrowserWindow} mainWindow 主窗口
 * @param {{ quit: () => void }} callbacks 退出等生命周期回调
 * @returns {Electron.Tray} 托盘实例（模块级引用防止被 GC 回收）
 */
function createTray(mainWindow, callbacks) {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(TRAY_ICON_BASE64, 'base64')
  );
  tray = new Tray(icon);
  tray.setToolTip('AI 桌宠');
  tray.setContextMenu(buildContextMenu(mainWindow, callbacks));
  // 左键单击：显示/隐藏窗口（与菜单“显示/隐藏桌宠”行为一致）
  tray.on('click', () => toggleWindow(mainWindow));
  return tray;
}

/**
 * 窗口显示状态变化后刷新菜单文案，保持“显示/隐藏”与真实状态一致。
 */
function refreshMenu(mainWindow, callbacks) {
  if (tray) {
    tray.setContextMenu(buildContextMenu(mainWindow, callbacks));
  }
}

module.exports = { createTray, refreshMenu };

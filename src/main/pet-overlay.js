'use strict';

/**
 * T-55：宠物浮窗（Codex Pets 式独立悬浮宠物，ADR-044）。
 *
 * 一个独立的小型透明置顶窗口，仅展示当前皮肤角色与工作状态气泡；
 * 主聊天窗口隐藏/最小化时仍可悬浮在桌面，状态由聊天渲染层上报。
 *
 * 状态契约：
 * - idle   等待聊天（默认）
 * - working LLM 回复中
 * - ready  回复完成
 * - failed 回复出错
 *
 * 浮窗位置持久化到 settings.petOverlayBounds；显示开关为
 * settings.petOverlayEnabled（默认关闭，由设置页/托盘/`/pet` 命令控制）。
 */

const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { createSecureSettings } = require('./secure-settings');
const { createDefaultStore, resolveBaseDir } = require('../storage');
const skinStore = require('./skin-store');

/** 浮窗通道（与 preload.js 中的常量保持一致） */
const PET_CHANNELS = {
  getStatus: 'pet:get-status',
  setStatus: 'pet:set-status',
  getSkin: 'pet:get-skin',
  toggleOverlay: 'pet:toggle-overlay',
  setEnabled: 'pet:set-enabled',
  tuckAway: 'pet:tuck-away',
  refreshSkin: 'pet:refresh-skin',
  skinUpdated: 'pet:skin-updated'
};

const OVERLAY_WIDTH = 240;
const OVERLAY_HEIGHT = 320;
const VALID_STATES = new Set(['idle', 'working', 'ready', 'failed']);
const STATUS_TEXT_MAX = 80;

/**
 * 创建宠物浮窗实例。
 * @param {object} options
 * @param {() => object} options.getSettings 读取当前设置（含 petOverlayEnabled/skinId）
 * @param {() => import('./tray').TrayApi} [options.getTray] 可选：状态变化后刷新托盘菜单
 */
function createPetOverlay(options = {}) {
  const { getSettings, getTray } = options;
  let win = null;
  let state = { state: 'idle', text: '', at: 0 };
  let settingsWriter = null;
  let skinCache = null;
  let registered = false;

  function getWriter() {
    if (!settingsWriter) {
      settingsWriter = createSecureSettings({ store: createDefaultStore() });
    }
    return settingsWriter;
  }

  function persistBounds(bounds) {
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
      return;
    }
    try {
      getWriter().writeSettings({
        petOverlayBounds: {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y)
        }
      });
    } catch (_error) {
      // 位置保存失败不影响浮窗
    }
  }

  function loadBounds() {
    try {
      const settings = getSettings();
      const bounds = settings && settings.petOverlayBounds;
      if (
        bounds &&
        Number.isFinite(bounds.x) &&
        Number.isFinite(bounds.y) &&
        Math.abs(bounds.x) < 100000 &&
        Math.abs(bounds.y) < 100000
      ) {
        return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
      }
    } catch (_error) {
      // 读取失败回退默认位置
    }
    return null;
  }

  function defaultPosition() {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + area.width - OVERLAY_WIDTH - 24,
      y: area.y + area.height - OVERLAY_HEIGHT - 24
    };
  }

  function currentSkin() {
    if (skinCache === null) {
      try {
        const store = skinStore.createSkinStore({
          baseDir: path.join(resolveBaseDir(), 'skins')
        });
        const settings = getSettings();
        const id =
          settings && typeof settings.skinId === 'string' && settings.skinId
            ? settings.skinId
            : skinStore.DEFAULT_SKIN_ID;
        skinCache = store.find(id) || null;
      } catch (_error) {
        skinCache = null;
      }
    }
    return skinCache;
  }

  function invalidateSkin() {
    skinCache = null;
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(PET_CHANNELS.skinUpdated);
    }
  }

  function registerIpc() {
    if (registered) {
      return;
    }
    registered = true;

    ipcMain.handle(PET_CHANNELS.getStatus, () => ({ ...state }));

    ipcMain.handle(PET_CHANNELS.setStatus, (_event, payload) => {
      if (!payload || typeof payload !== 'object') {
        return { ...state };
      }
      const nextState = VALID_STATES.has(payload.state)
        ? payload.state
        : state.state;
      state = {
        state: nextState,
        text:
          typeof payload.text === 'string'
            ? payload.text.slice(0, STATUS_TEXT_MAX)
            : '',
        at: Date.now()
      };
      return { ...state };
    });

    ipcMain.handle(PET_CHANNELS.getSkin, () => {
      return { ok: true, skin: currentSkin() };
    });

    ipcMain.handle(PET_CHANNELS.toggleOverlay, () => {
      const enabled = !isVisible();
      try {
        getWriter().writeSettings({ petOverlayEnabled: enabled });
      } catch (_error) {
        // 持久化失败仍切换显示
      }
      if (enabled) {
        show();
      } else {
        hide();
      }
      getTray?.()?.refreshMenu?.();
      return { ok: true, enabled, visible: isVisible() };
    });

    ipcMain.handle(PET_CHANNELS.setEnabled, (_event, payload) => {
      const enabled = Boolean(payload && payload.enabled);
      try {
        getWriter().writeSettings({ petOverlayEnabled: enabled });
      } catch (_error) {
        // 持久化失败仍切换显示
      }
      if (enabled) {
        show();
      } else {
        hide();
      }
      getTray?.()?.refreshMenu?.();
      return { ok: true, enabled, visible: isVisible() };
    });

    ipcMain.handle(PET_CHANNELS.tuckAway, () => {
      try {
        getWriter().writeSettings({ petOverlayEnabled: false });
      } catch (_error) {
        // 持久化失败仍隐藏
      }
      hide();
      getTray?.()?.refreshMenu?.();
      return { ok: true, enabled: false };
    });

    ipcMain.handle(PET_CHANNELS.refreshSkin, () => {
      invalidateSkin();
      return { ok: true };
    });
  }

  function createWindow() {
    if (win && !win.isDestroyed()) {
      return win;
    }
    const position = loadBounds() || defaultPosition();
    win = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x: position.x,
      y: position.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
    win.on('move', () => {
      if (win && !win.isDestroyed()) {
        persistBounds(win.getBounds());
      }
    });
    win.on('closed', () => {
      win = null;
      skinCache = null;
    });
    return win;
  }

  function show() {
    registerIpc();
    const window = createWindow();
    window.showInactive();
    getTray?.()?.refreshMenu?.();
  }

  function hide() {
    if (win && !win.isDestroyed()) {
      win.hide();
    }
    getTray?.()?.refreshMenu?.();
  }

  function toggle() {
    const enabled = !isVisible();
    try {
      getWriter().writeSettings({ petOverlayEnabled: enabled });
    } catch (_error) {
      // 持久化失败仍切换显示
    }
    if (enabled) {
      show();
    } else {
      hide();
    }
    return { ok: true, enabled, visible: isVisible() };
  }

  /** 设置页开关变更后同步显示状态（enabled=true 时立即显示） */
  function applyEnabled(enabled) {
    if (enabled) {
      show();
    } else {
      hide();
    }
  }

  function refresh() {
    invalidateSkin();
  }

  function isVisible() {
    return Boolean(win && !win.isDestroyed() && win.isVisible());
  }

  function dispose() {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    win = null;
  }

  // 提前注册 IPC：浮窗未显示时聊天页也要能上报状态（setStatus/getStatus）
  registerIpc();

  return {
    show,
    hide,
    toggle,
    applyEnabled,
    refresh,
    isVisible,
    setStatus: (payload) => {
      if (payload && VALID_STATES.has(payload.state)) {
        state = {
          state: payload.state,
          text:
            typeof payload.text === 'string'
              ? payload.text.slice(0, STATUS_TEXT_MAX)
              : '',
          at: Date.now()
        };
      }
      return { ...state };
    },
    getState: () => ({ ...state }),
    dispose
  };
}

module.exports = {
  createPetOverlay,
  PET_CHANNELS,
  OVERLAY_WIDTH,
  OVERLAY_HEIGHT
};

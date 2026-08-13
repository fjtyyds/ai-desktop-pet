'use strict';

/**
 * T-55：宠物浮窗（Codex Pets 式独立悬浮宠物，ADR-044）。
 *
 * 一个独立的小型透明置顶窗口，仅展示当前皮肤角色与工作状态气泡；
 * 主聊天窗口隐藏/最小化时仍可悬浮在桌面，状态由聊天渲染层上报。
 *
 * 状态契约（T-57，ADR-045）：
 * - idle      等待聊天（默认）
 * - working   LLM 回复中
 * - ready     回复完成
 * - failed    回复出错
 * - speaking  TTS 朗读中
 * - attention 提醒/空闲互动（可排队）
 *
 * 气泡队列：pushBubble 最多排队 3 条，按 petOverlayBubbleSeconds（默认 6s）
 * 逐条轮播；setStatus 为即时状态，直接替换当前显示。
 *
 * 浮窗位置持久化到 settings.petOverlayBounds；显示开关为
 * settings.petOverlayEnabled（默认关闭，由设置页/托盘/`/pet` 命令控制）。
 */

const path = require('path');
const { BrowserWindow, Menu, ipcMain, screen } = require('electron');
const { createSecureSettings } = require('./secure-settings');
const { createDefaultStore, resolveBaseDir } = require('../storage');
const skinStore = require('./skin-store');

/** 浮窗通道（与 preload.js 中的常量保持一致） */
const PET_CHANNELS = {
  getStatus: 'pet:get-status',
  setStatus: 'pet:set-status',
  pushBubble: 'pet:push-bubble',
  getSkin: 'pet:get-skin',
  toggleOverlay: 'pet:toggle-overlay',
  setEnabled: 'pet:set-enabled',
  tuckAway: 'pet:tuck-away',
  showMain: 'pet:show-main',
  toggleMain: 'pet:toggle-main',
  moveWindow: 'pet:move-window',
  refreshSkin: 'pet:refresh-skin',
  skinUpdated: 'pet:skin-updated',
  statusUpdated: 'pet:status-updated',
  getOverlayState: 'pet:get-overlay-state',
  taskStart: 'pet:task-start',
  taskUpdate: 'pet:task-update',
  taskFinish: 'pet:task-finish',
  getConfig: 'pet:get-config'
};

const OVERLAY_WIDTH = 240;
const OVERLAY_HEIGHT = 320;
const VALID_STATES = new Set([
  'idle',
  'working',
  'ready',
  'failed',
  'speaking',
  'attention'
]);
const STATUS_TEXT_MAX = 80;
const MAX_BUBBLE_QUEUE = 3;
const BUBBLE_SECONDS_FALLBACK = 6;
const BUBBLE_SECONDS_MIN = 3;
const BUBBLE_SECONDS_MAX = 20;
/** T-63（ADR-046）：任务级进度气泡字段上限 */
const TASK_ID_MAX = 64;
const TASK_TEXT_MAX = 80;
/** T-56：浮窗贴边吸附参数（浮窗内独立实现，不侵入主窗口 T-31 逻辑） */
const OVERLAY_DOCK_MARGIN = 24;
const OVERLAY_DOCK_DEBOUNCE_MS = 200;

/**
 * 创建宠物浮窗实例。
 * @param {object} options
 * @param {() => object} options.getSettings 读取当前设置（含 petOverlayEnabled/skinId）
 * @param {() => import('./tray').TrayApi} [options.getTray] 可选：状态变化后刷新托盘菜单
 * @param {() => void} [options.showMainWindow] 可选：唤起主聊天窗口（T-56）
 * @param {() => void} [options.toggleMainWindow] 可选：切换主聊天窗口显示（T-56 点击宠物）
 * @param {() => void} [options.quitApp] 可选：退出应用（T-56 右键菜单）
 * @param {() => import('../shared/locales').Translator} [options.getTranslator] 可选：右键菜单文案
 */
function createPetOverlay(options = {}) {
  const {
    getSettings,
    getTray,
    showMainWindow,
    toggleMainWindow,
    quitApp,
    getTranslator
  } = options;
  let win = null;
  let queue = [{ state: 'idle', text: '', at: 0 }];
  let bubbleTimer = null;
  let settingsWriter = null;
  let skinCache = null;
  let registered = false;
  let tasks = new Map();
  let activeTaskId = null;
  let pendingQueue = [];

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
      let displayId;
      try {
        displayId = screen.getDisplayMatching(bounds).id;
      } catch (_error) {
        displayId = undefined;
      }
      const next = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y)
      };
      if (Number.isInteger(displayId)) {
        next.displayId = displayId;
      }
      getWriter().writeSettings({
        petOverlayBounds: next
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
        // T-60：多显示器——保存过 displayId 时校验显示器仍存在且坐标在工作区内
        if (Number.isInteger(bounds.displayId)) {
          const display = screen
            .getAllDisplays()
            .find((item) => item.id === bounds.displayId);
          if (!display) {
            return null;
          }
          const area = display.workArea;
          const centerX = bounds.x + OVERLAY_WIDTH / 2;
          const centerY = bounds.y + OVERLAY_HEIGHT / 2;
          if (
            centerX < area.x ||
            centerX > area.x + area.width ||
            centerY < area.y ||
            centerY > area.y + area.height
          ) {
            return null;
          }
        }
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

  /** 气泡时长（秒）：读设置并夹取 3~20 */
  function bubbleSeconds() {
    try {
      const settings = getSettings();
      const value = Number(
        settings && settings.petOverlayBubbleSeconds
          ? settings.petOverlayBubbleSeconds
          : BUBBLE_SECONDS_FALLBACK
      );
      return Number.isFinite(value)
        ? Math.min(BUBBLE_SECONDS_MAX, Math.max(BUBBLE_SECONDS_MIN, value))
        : BUBBLE_SECONDS_FALLBACK;
    } catch (_error) {
      return BUBBLE_SECONDS_FALLBACK;
    }
  }

  function bubbleEnabledFromSettings() {
    try {
      const settings = getSettings();
      return settings ? settings.petOverlayBubbleEnabled !== false : true;
    } catch (_error) {
      return true;
    }
  }

  function remindersEnabledFromSettings() {
    try {
      const settings = getSettings();
      return settings ? settings.petOverlayReminders !== false : true;
    } catch (_error) {
      return true;
    }
  }

  /** T-57/T-61 契约补实现：浮窗气泡配置 */
  function getConfigValue() {
    return {
      bubbleEnabled: bubbleEnabledFromSettings(),
      bubbleSeconds: bubbleSeconds(),
      reminders: remindersEnabledFromSettings()
    };
  }

  /** 清洗任务载荷（T-63）：id≤64、title/message≤80、percent 0~100 或 null、stage/totalStages 可选整数 */
  function sanitizeTaskPayload(payload) {
    if (!payload || typeof payload.id !== 'string') {
      return null;
    }
    const id = payload.id.trim().slice(0, TASK_ID_MAX);
    if (!id) {
      return null;
    }
    const title =
      typeof payload.title === 'string'
        ? payload.title.trim().slice(0, TASK_TEXT_MAX)
        : '';
    const message =
      typeof payload.message === 'string'
        ? payload.message.trim().slice(0, TASK_TEXT_MAX)
        : '';
    let percent = null;
    if (
      payload.percent !== null &&
      payload.percent !== undefined &&
      Number.isFinite(Number(payload.percent))
    ) {
      percent = Math.min(100, Math.max(0, Math.round(Number(payload.percent))));
    }
    const stage = Number.isInteger(payload.stage) ? payload.stage : null;
    const totalStages = Number.isInteger(payload.totalStages)
      ? payload.totalStages
      : null;
    return { id, title, message, percent, stage, totalStages };
  }

  function taskToPayload(task) {
    return {
      id: task.id,
      title: task.title,
      message: task.message,
      percent: task.percent,
      stage: task.stage,
      totalStages: task.totalStages,
      status: task.status
    };
  }

  /** 当前运行中的任务（无任务返回 null） */
  function currentTask() {
    if (!activeTaskId) {
      return null;
    }
    const task = tasks.get(activeTaskId);
    return task ? taskToPayload(task) : null;
  }

  function currentStatus() {
    const base =
      queue.length > 0 ? { ...queue[0] } : { state: 'idle', text: '', at: 0 };
    return {
      ...base,
      bubbleEnabled: bubbleEnabledFromSettings(),
      task: currentTask()
    };
  }

  /** T-60：状态变化主动推送给浮窗（浮窗心跳降为 5s 兜底） */
  function notifyStatus() {
    const payload = currentStatus();
    // 广播给所有加载 overlay.html 的窗口（生产环境只有一个浮窗；冒烟窗口也可收到）
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        window.webContents &&
        !window.webContents.isDestroyed() &&
        window.webContents.getURL().endsWith('overlay.html')
      ) {
        window.webContents.send(PET_CHANNELS.statusUpdated, payload);
      }
    }
  }

  function clearBubbleTimer() {
    if (bubbleTimer) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
  }

  /** 队列前进：弹出当前条目，空则回 idle；非空继续定时 */
  function advanceQueue() {
    clearBubbleTimer();
    queue.shift();
    if (queue.length === 0) {
      queue = [{ state: 'idle', text: '', at: Date.now() }];
      notifyStatus();
      return;
    }
    bubbleTimer = setTimeout(advanceQueue, bubbleSeconds() * 1000);
    notifyStatus();
  }

  /** 即时状态：直接替换当前显示（聊天/TTS 驱动），并调度 ready/failed 回落 */
  function replaceStatus(payload) {
    const nextState =
      payload && VALID_STATES.has(payload.state) ? payload.state : 'idle';
    const next = {
      state: nextState,
      text:
        payload && typeof payload.text === 'string'
          ? payload.text.slice(0, STATUS_TEXT_MAX)
          : '',
      at: Date.now()
    };
    clearBubbleTimer();
    queue = [next];
    if (nextState === 'ready' || nextState === 'failed') {
      bubbleTimer = setTimeout(advanceQueue, bubbleSeconds() * 1000);
    }
    notifyStatus();
    return { ...next };
  }

  /** 提醒/互动气泡：入队（最多 3 条），逐条轮播 */
  function pushStatus(payload) {
    const nextState =
      payload && VALID_STATES.has(payload.state) ? payload.state : 'attention';
    const next = {
      state: nextState,
      text:
        payload && typeof payload.text === 'string'
          ? payload.text.slice(0, STATUS_TEXT_MAX)
          : '',
      at: Date.now()
    };
    // T-63：任务运行中提醒排队，任务结束后补放（不打断任务气泡）
    if (activeTaskId) {
      pendingQueue.push(next);
      if (pendingQueue.length > MAX_BUBBLE_QUEUE) {
        pendingQueue.splice(0, pendingQueue.length - MAX_BUBBLE_QUEUE);
      }
      notifyStatus();
      return { ...next };
    }
    // 占位 idle（无文案）直接替换，避免队列出现“先 idle 后 attention”的跳变
    const isIdlePlaceholder =
      queue.length === 1 && queue[0].state === 'idle' && !queue[0].text;
    if (isIdlePlaceholder) {
      queue = [next];
      bubbleTimer = setTimeout(advanceQueue, bubbleSeconds() * 1000);
    } else {
      queue.push(next);
      if (queue.length > MAX_BUBBLE_QUEUE) {
        queue.splice(0, queue.length - MAX_BUBBLE_QUEUE);
      }
      if (!bubbleTimer) {
        bubbleTimer = setTimeout(advanceQueue, bubbleSeconds() * 1000);
      }
    }
    notifyStatus();
    return { ...next };
  }

  /** T-63：开始任务——任务气泡优先显示，提醒气泡排队补放 */
  function startTask(payload) {
    const clean = sanitizeTaskPayload(payload);
    if (!clean) {
      return { ok: false, task: null };
    }
    const task = { ...clean, status: 'running', startedAt: Date.now() };
    tasks.set(task.id, task);
    activeTaskId = task.id;
    clearBubbleTimer();
    queue = [{ state: 'working', text: task.title || '', at: Date.now() }];
    notifyStatus();
    return { ok: true, task: taskToPayload(task) };
  }

  /** T-63：更新任务进度（标题/阶段文案/百分比） */
  function updateTask(payload) {
    const clean = sanitizeTaskPayload(payload);
    const task = clean ? tasks.get(clean.id) : null;
    if (!clean || !task) {
      return { ok: false, task: null };
    }
    if (clean.title) {
      task.title = clean.title;
    }
    if (typeof payload.message === 'string') {
      task.message = payload.message.trim().slice(0, TASK_TEXT_MAX);
    }
    if (clean.percent !== null) {
      task.percent = clean.percent;
    }
    if (clean.stage !== null) {
      task.stage = clean.stage;
    }
    if (clean.totalStages !== null) {
      task.totalStages = clean.totalStages;
    }
    if (queue.length > 0 && queue[0].state === 'working') {
      queue[0].text = task.title || task.message || '';
    }
    notifyStatus();
    return { ok: true, task: taskToPayload(task) };
  }

  /** T-63：结束任务——显示 done/failed 结果，随后补放排队提醒并回落 idle */
  function finishTask(payload) {
    const clean = sanitizeTaskPayload(payload);
    const task = clean ? tasks.get(clean.id) : null;
    if (!clean || !task) {
      return { ok: false, task: null };
    }
    const ok = payload ? payload.ok !== false : true;
    const message =
      (typeof payload.message === 'string'
        ? payload.message.trim().slice(0, TASK_TEXT_MAX)
        : '') || task.title;
    tasks.delete(task.id);
    activeTaskId = null;
    const finalState = ok ? 'ready' : 'failed';
    const pending = pendingQueue.splice(0, pendingQueue.length);
    clearBubbleTimer();
    queue = [{ state: finalState, text: message, at: Date.now() }, ...pending].slice(
      0,
      MAX_BUBBLE_QUEUE
    );
    bubbleTimer = setTimeout(advanceQueue, bubbleSeconds() * 1000);
    notifyStatus();
    return { ok: true, task: null };
  }

  function registerIpc() {
    if (registered) {
      return;
    }
    registered = true;

    ipcMain.handle(PET_CHANNELS.getStatus, () => currentStatus());

    ipcMain.handle(PET_CHANNELS.setStatus, (_event, payload) => {
      return replaceStatus(payload);
    });

    ipcMain.handle(PET_CHANNELS.pushBubble, (_event, payload) => {
      return pushStatus(payload);
    });

    ipcMain.handle(PET_CHANNELS.taskStart, (_event, payload) => {
      return startTask(payload);
    });

    ipcMain.handle(PET_CHANNELS.taskUpdate, (_event, payload) => {
      return updateTask(payload);
    });

    ipcMain.handle(PET_CHANNELS.taskFinish, (_event, payload) => {
      return finishTask(payload);
    });

    ipcMain.handle(PET_CHANNELS.getConfig, () => {
      return getConfigValue();
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

    ipcMain.handle(PET_CHANNELS.showMain, () => {
      showMainWindow?.();
      return { ok: true };
    });

    ipcMain.handle(PET_CHANNELS.toggleMain, () => {
      toggleMainWindow?.();
      return { ok: true };
    });

    ipcMain.handle(PET_CHANNELS.moveWindow, (_event, payload) => {
      const dx = Number(payload && payload.dx);
      const dy = Number(payload && payload.dy);
      if (
        win &&
        !win.isDestroyed() &&
        Number.isFinite(dx) &&
        Number.isFinite(dy)
      ) {
        const [x, y] = win.getPosition();
        win.setPosition(Math.round(x + dx), Math.round(y + dy));
        persistBounds(win.getBounds());
      }
      return { ok: true };
    });

    ipcMain.handle(PET_CHANNELS.refreshSkin, () => {
      invalidateSkin();
      return { ok: true };
    });

    ipcMain.handle(PET_CHANNELS.getOverlayState, () => {
      let enabled = false;
      try {
        const settings = getSettings();
        enabled = settings ? settings.petOverlayEnabled === true : false;
      } catch (_error) {
        enabled = false;
      }
      return { enabled, visible: isVisible(), status: currentStatus() };
    });
  }

  /** T-56：右键菜单（显示主窗口/收起宠物/切换气泡/退出应用） */
  function showContextMenu() {
    let t = null;
    try {
      t = getTranslator?.() || null;
    } catch (_error) {
      t = null;
    }
    const label = (key) => (t ? t(key) : key);
    const menu = Menu.buildFromTemplate([
      {
        label: label('overlay.menuShowMain'),
        click: () => showMainWindow?.()
      },
      {
        label: label('overlay.menuToggleBubble'),
        click: () => {
          try {
            const settings = getSettings();
            const enabled = settings
              ? settings.petOverlayBubbleEnabled !== false
              : true;
            getWriter().writeSettings({ petOverlayBubbleEnabled: !enabled });
          } catch (_error) {
            // 持久化失败不影响菜单关闭
          }
        }
      },
      {
        label: label('overlay.menuTuckAway'),
        click: () => {
          try {
            getWriter().writeSettings({ petOverlayEnabled: false });
          } catch (_error) {
            // 持久化失败仍隐藏
          }
          hide();
          getTray?.()?.refreshMenu?.();
        }
      },
      { type: 'separator' },
      {
        label: label('overlay.menuQuit'),
        click: () => quitApp?.()
      }
    ]);
    menu.popup({ window: win || undefined });
  }

  /** T-56：拖动结束后若靠近屏幕边缘（≤24px）则贴边对齐 */
  function alignToEdge(window) {
    if (!window || window.isDestroyed()) {
      return;
    }
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const left = Math.abs(bounds.x - area.x);
    const right = Math.abs(bounds.x + bounds.width - (area.x + area.width));
    const top = Math.abs(bounds.y - area.y);
    const bottom = Math.abs(bounds.y + bounds.height - (area.y + area.height));
    const min = Math.min(left, right, top, bottom);
    if (min > OVERLAY_DOCK_MARGIN) {
      return;
    }
    const next = { ...bounds };
    if (min === left) {
      next.x = area.x;
    } else if (min === right) {
      next.x = area.x + area.width - bounds.width;
    } else if (min === top) {
      next.y = area.y;
    } else {
      next.y = area.y + area.height - bounds.height;
    }
    window.setBounds(next);
    persistBounds(next);
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
    let dockTimer = null;
    win.on('move', () => {
      if (win && !win.isDestroyed()) {
        persistBounds(win.getBounds());
      }
      clearTimeout(dockTimer);
      dockTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) {
          alignToEdge(win);
        }
      }, OVERLAY_DOCK_DEBOUNCE_MS);
    });
    win.webContents.on('context-menu', () => {
      showContextMenu();
    });
    win.on('closed', () => {
      clearTimeout(dockTimer);
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
    clearBubbleTimer();
    tasks.clear();
    activeTaskId = null;
    pendingQueue = [];
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
      return replaceStatus(payload);
    },
    pushBubble: (payload) => pushStatus(payload),
    startTask: (payload) => startTask(payload),
    updateTask: (payload) => updateTask(payload),
    finishTask: (payload) => finishTask(payload),
    getConfig: () => getConfigValue(),
    getState: () => currentStatus(),
    dispose
  };
}

module.exports = {
  createPetOverlay,
  PET_CHANNELS,
  OVERLAY_WIDTH,
  OVERLAY_HEIGHT
};

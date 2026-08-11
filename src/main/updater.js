'use strict';

/**
 * T-37：自动更新封装（ADR-031，electron-updater + GitHub Releases）
 *
 * 职责：
 * - 封装 electron-updater 的 autoUpdater：checkForUpdates、更新事件、
 *   下载进度与错误日志（console + 主进程现有 writeLog 日志体系）。
 * - 仅打包环境可检查：main.js 初始化处与 checkForUpdates 内双重
 *   app.isPackaged 守卫，开发模式（未打包）绝不检查。
 * - 商店版（MSIX，process.windowsStore）不初始化 electron-updater：
 *   更新由 Microsoft Store 负责（T-52/ADR-040），绝不发起 GitHub 更新请求。
 * - 启动后自动检查静默失败/无更新；托盘手动检查用原生 dialog 反馈。
 * - 发现更新：原生 dialog 确认 → 下载 → 下载完成 dialog 提示重启安装；
 *   用户确认后在 main.js before-quit 中调用 quitAndInstall。
 */

const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createTranslator } = require('../shared/locales');

/** 启动后延迟自动检查的毫秒数（main.js 复用，避免魔法数字分散） */
const AUTO_UPDATE_CHECK_DELAY_MS = 3000;

/** 下载进度日志节流：百分比每变化 5% 或距上次日志超过 10s 才写一条 */
const PROGRESS_LOG_STEP_PERCENT = 5;
const PROGRESS_LOG_INTERVAL_MS = 10000;

function describeError(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) || String(value);
  } catch (_error) {
    return String(value);
  }
}

/**
 * 初始化自动更新器。
 *
 * @param {object} [options]
 * @param {() => import('electron').BrowserWindow | null} [options.getMainWindow]
 *   对话框父窗口读取器；窗口不可用时退化为无父窗口的原生 dialog。
 * @param {() => (key: string, params?: object) => string} [options.getTranslator]
 *   主进程翻译器读取器，用于双语文案。
 * @param {{ info?: Function, warn?: Function, error?: Function, debug?: Function }} [options.logger]
 *   日志接收器；缺省使用 console。由 main.js 传入 console + writeLog 双写版本。
 * @returns {{ checkForUpdates: Function, handleBeforeQuit: Function, dispose: Function }}
 */
function initUpdater(options = {}) {
  // T-52（ADR-040）：electron-updater 不支持 MSIX；商店版必须走 Microsoft Store 更新。
  // 守卫放在最前面：不注册任何 autoUpdater 事件、不触发任何 GitHub 更新请求。
  if (process.windowsStore) {
    const logger = options.logger || console;
    const warn = typeof logger.warn === 'function' ? logger.warn : console.warn;
    warn('[updater] 商店版（MSIX）跳过 electron-updater 初始化：更新由 Microsoft Store 负责');
    return {
      checkForUpdates: async () => null,
      handleBeforeQuit: () => {},
      dispose: () => {}
    };
  }

  const {
    getMainWindow = () => null,
    getTranslator = () => createTranslator('zh-CN'),
    logger = console
  } = options;

  let checking = false;
  let manualCheck = false;
  let installOnQuit = false;
  let quitAndInstallStarted = false;
  let lastProgressLoggedAt = 0;
  let lastProgressLoggedPercent = -1;

  function writeLog(level, message) {
    const method =
      typeof logger[level] === 'function'
        ? logger[level]
        : typeof console[level] === 'function'
          ? console[level]
          : console.log;
    method(`[updater] ${message}`);
  }

  const logInfo = (message) => writeLog('info', message);
  const logWarn = (message) => writeLog('warn', message);
  const logError = (message) => writeLog('error', message);
  const logDebug = (message) => writeLog('debug', message);

  function t(key, params) {
    return getTranslator()(key, params);
  }

  function showMessageBox(options) {
    const win = getMainWindow();
    const target = win && !win.isDestroyed() ? win : undefined;
    return dialog
      .showMessageBox(target, options)
      .then((result) => result.response)
      .catch((error) => {
        logError(`原生对话框失败：${describeError(error)}`);
        return -1;
      });
  }

  /** 发现新版本：dialog 确认后下载（autoDownload 已关闭，仅确认后触发） */
  function handleUpdateAvailable(updateInfo) {
    manualCheck = false;
    const version = updateInfo && updateInfo.version ? String(updateInfo.version) : '';
    logInfo(`发现新版本：${version || '未知'}`);
    return showMessageBox({
      type: 'info',
      title: t('updater.updateAvailableTitle'),
      message: t('updater.updateAvailableBody', { version }),
      buttons: [t('updater.download'), t('updater.cancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then((response) => {
      if (response === 0) {
        logInfo('用户确认下载更新');
        return autoUpdater.downloadUpdate().catch((error) => {
          logError(`下载更新失败：${describeError(error)}`);
          return null;
        });
      }
      logInfo('用户取消下载更新');
      return null;
    });
  }

  /** 无更新：自动检查静默，手动检查弹“已是最新” */
  function handleUpdateNotAvailable() {
    const wasManual = manualCheck;
    logInfo('当前已是最新版本');
    if (wasManual) {
      return showMessageBox({
        type: 'info',
        title: t('updater.upToDateTitle'),
        message: t('updater.upToDate'),
        buttons: [t('updater.ok')],
        noLink: true
      });
    }
    return null;
  }

  /** 下载进度：节流写日志，不阻塞界面 */
  function handleDownloadProgress(progress) {
    const percent =
      progress && Number.isFinite(progress.percent) ? Math.round(progress.percent) : null;
    if (percent === null) {
      return;
    }
    const now = Date.now();
    if (
      percent >= lastProgressLoggedPercent + PROGRESS_LOG_STEP_PERCENT ||
      now - lastProgressLoggedAt >= PROGRESS_LOG_INTERVAL_MS
    ) {
      lastProgressLoggedAt = now;
      lastProgressLoggedPercent = percent;
      logInfo(t('updater.downloading', { percent }));
    }
  }

  /** 下载完成：dialog 提示重启安装；确认后由 before-quit 执行 quitAndInstall */
  function handleUpdateDownloaded() {
    logInfo('更新下载完成，等待重启安装');
    return showMessageBox({
      type: 'info',
      title: t('updater.updateReadyTitle'),
      message: t('updater.updateReadyBody'),
      buttons: [t('updater.restartNow'), t('updater.restartLater')],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then((response) => {
      if (response === 0) {
        installOnQuit = true;
        logInfo('用户选择立即重启安装');
        app.quit();
      } else {
        logInfo('用户选择稍后重启（退出应用时自动安装）');
      }
    });
  }

  /** 更新器错误：仅日志（自动/手动失败均不崩溃、不阻塞启动） */
  function handleError(error) {
    checking = false;
    manualCheck = false;
    logError(`更新检查/下载失败：${describeError(error)}`);
  }

  /**
   * 检查更新。
   * @param {{ manual?: boolean }} [options] manual=true 表示托盘手动检查
   * @returns {Promise<unknown|null>}
   */
  function checkForUpdates({ manual = false } = {}) {
    if (!app.isPackaged) {
      logWarn('开发模式（未打包）跳过更新检查');
      return Promise.resolve(null);
    }
    if (checking) {
      logInfo('更新检查正在进行中，忽略重复请求');
      return Promise.resolve(null);
    }
    checking = true;
    manualCheck = manual;
    logInfo(manual ? t('updater.checking') : '启动后自动检查更新');
    return autoUpdater.checkForUpdates().then(
      (result) => {
        checking = false;
        manualCheck = false;
        return result;
      },
      (error) => {
        // 错误已由 handleError 记录，这里只复位状态并给手动检查弹失败提示
        checking = false;
        manualCheck = false;
        if (manual) {
          return showMessageBox({
            type: 'error',
            title: t('updater.errorTitle'),
            message: t('updater.error', { error: describeError(error) }),
            buttons: [t('updater.ok')],
            noLink: true
          });
        }
        return null;
      }
    );
  }

  /** main.js before-quit 调用：用户确认后执行 quitAndInstall（内部有防重入保护） */
  function handleBeforeQuit() {
    if (!installOnQuit || quitAndInstallStarted) {
      return;
    }
    quitAndInstallStarted = true;
    logInfo('执行 quitAndInstall');
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      logError(`quitAndInstall 调用失败：${describeError(error)}`);
    }
  }

  function dispose() {
    autoUpdater.removeListener('update-available', handleUpdateAvailable);
    autoUpdater.removeListener('update-not-available', handleUpdateNotAvailable);
    autoUpdater.removeListener('download-progress', handleDownloadProgress);
    autoUpdater.removeListener('update-downloaded', handleUpdateDownloaded);
    autoUpdater.removeListener('error', handleError);
  }

  // 手动确认后才下载；下载完成后的“稍后重启”仍保留默认自动安装语义
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: logInfo,
    warn: logWarn,
    error: logError,
    debug: logDebug
  };

  autoUpdater.on('update-available', handleUpdateAvailable);
  autoUpdater.on('update-not-available', handleUpdateNotAvailable);
  autoUpdater.on('download-progress', handleDownloadProgress);
  autoUpdater.on('update-downloaded', handleUpdateDownloaded);
  autoUpdater.on('error', handleError);

  return { checkForUpdates, handleBeforeQuit, dispose };
}

module.exports = { initUpdater, AUTO_UPDATE_CHECK_DELAY_MS };

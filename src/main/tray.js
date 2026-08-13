'use strict';

const fs = require('fs');
const path = require('path');
const { Tray, Menu, nativeImage, app, dialog } = require('electron');
const { resolveLocale, createTranslator } = require('../shared/locales');
const { createDefaultStore, resolveBaseDir } = require('../storage');

/**
 * 正式图标 assets/icon.png；读取失败时回退到内嵌 64x64 PNG（开发兜底）。
 * 蓝色圆形 + 白色爪印为应用视觉身份（ADR-016）。
 */
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAABTdJREFUeF7tWz2oHUUUTmlpaWlpaWkXS3m7IcEmNoJYvUoEm1jFQhDe281FUBRSPLFIQBEVRAWLiwQMgvKIjQGRBwn4UFARAk8Rzsi3+y7Z/c7szpnd2d1ryAdfdWf2zNk5c/5m75kzD/EQi+BcKU9l++7pJnnMA4HzK/d4VsrLeSFf5KUc5qVzIWal/JiXss4Ldykv3BP8zK3Hzp57Mivda7UiWsFYVs8pZAWrYVlbBZixdZcHs5CjvHAXWPaiwI7XJu5Z8ETMCrm5uN/Y2XOP5aUc8OJmJV78En6i2vVSjtWCFqGczHossn15rhKqFrIwC3eJ15oc8O5K8Dbxilw/e9k9wutOgsXPu5FwkMlfQlbKGyxom5mV8jHrMBj1mddCtp04rqxLNJB9baXDs3JMdEAeP3Woe/Gqc69+4Nzugf4tDasQOSxPwDnSD0xDKP3rX66FP+45t/eZHjuecsi6BVEnOvygNHz7q7bijA+/1XNGM/YoTJXbv/S+c//8yyprXP5Izx1HOTSHRrwt/YBuwpzBZ9/UvzFv/sSq+vHzb3ouM0YuiL4E6+qFtaSFqTI+v9W9oItv8eh+wFr4GUPk3qccB62grul5ombfTt7+xb+YV67xyH74HOIQuU2eK9wLrHMLlowPCwvhvRt6Xsj5Ma59k0Zui1fkOuvcQtVx4UlEhKsQ4Ohg8s15cGwxwAtLIbdNOek8BkgY9IQ2kbBYwZ78+Xd5RD9wZFLIZe6U8gzrXsFS6r7+KYvrxtW1nn/3dx7lB3a7eZ7Hym1TDlj3Cigj9eA2V1+yuG74zqNVEVZirNw25Zh1r2DJ+xGarICyPB/8+jaPbOOHO3pOCrlNev0AD/IRZmnJ5AAUOjx/Q3h4H7rieSq5G6LQaylfV356oI+ffM8iNRCveR4TC4Vp42XA44cqwlRyQdVSr+t+PdBH7AZXck3c+7v2+DxvLFPKRZOn9QJi838IQubFgJcP7eQYppKr6oJ8X3Z5UIjYERQjMGEQ8dd3fpmI75tChsljfRwqt0nVLpuy74cF4vzCu1uAHYYz9NUCych3CNYiyEqko4jHfWfWAiREqP6sZ9tKVRTFRIEQkcTAIaUEQiDMPdbUu6iiABIDHhRL7DoaGVMCFtXVJ4iir1GaFfKnGmgkYvpYc7cC1mV1mF08v3KPsv7oBQz6ogM7P5fyG+BIxIS9NuWEda+Az1D04H7iTFq9e2og9vfX/n52XpsNiQSWLs2U4K6RhSoCNBHrB3xZ2ZzgvoGF3vO/QcwVeGyHZyqEOkBtypp1biGmJojt8U0F7h32UdUAjDofCDdGwNgu71Sw+wE5wYddrLNC9WWnmqxpbW9NDW6fdbKQFevqhdUKYjq1U8LSAoNzN+3+BlZfMHcCxEBCZCmUgmffB8sdIcxvSaBs5jVpGu4EfbAkRnj7S1mBNR3uTXxCsDhEdHisHduUQEOV16JodXx9yEp5Rz2YiMXM+RJsoS+Q9FhxGhXWWkCbKFFTN0IYeMnGnT/qTXljgYdZbo7RF+i7wx8DVJ2WZkhVz/gaHmOBOGq5PwRhDd8dsQrDgILLEusrFnKED7x47cmA42DxCRvCItDUjG2VodZHiLN4+fuUdVKz74MlOvgIy0C3eNPTZ8Z89NQkNoXXODmqPMHgF6alHI+K8ylQW0O4dkhJODrc7sxm8iFgIfUXJjN8WF3IKqqwmRNVpKgtIpg3xFEOcZ2l7vW3GXgZOJ/1R9cDLAOf6+7L7tbudiyqY3L6P2HsZv3v0gZPf3tgFP4/4D8CZUm+TuLBwAAAAABJRU5ErkJggg==';

/**
 * 加载正式图标（assets/icon.png）；不可用时回退到内嵌 base64。
 * @returns {Electron.NativeImage}
 */
function loadAppIcon() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  let image = null;
  try {
    if (fs.existsSync(iconPath)) {
      image = nativeImage.createFromPath(iconPath);
    }
  } catch (_error) {
    image = null;
  }
  if (!image || image.isEmpty()) {
    image = nativeImage.createFromDataURL(
      `data:image/png;base64,${TRAY_ICON_BASE64}`
    );
  }
  return image;
}

function createTrayIcon() {
  return loadAppIcon().resize({ width: 16, height: 16, quality: 'best' });
}

/**
 * 创建托盘图标与右键菜单。
 *
 * @param {object} handlers 主进程注入的回调
 * @param {() => import('electron').BrowserWindow | null} handlers.getMainWindow
 * @param {() => void} handlers.showMainWindow
 * @param {() => void} handlers.toggleMainWindow
 * @param {() => void} handlers.quitApp
 * @param {() => void} [handlers.checkForUpdates] 可选：托盘“检查更新”回调（T-37）
 * @param {() => void} [handlers.togglePetOverlay] 可选：托盘“显示/隐藏宠物浮窗”回调（T-55）
 * @param {() => boolean} [handlers.getPetOverlayVisible] 可选：宠物浮窗当前可见状态（T-55）
 * @param {() => string} [handlers.getLocale] 可选：主进程注入语言读取器；缺省时从 settings.json 读取
 */
function createTray({
  getMainWindow,
  showMainWindow,
  toggleMainWindow,
  quitApp,
  checkForUpdates,
  togglePetOverlay,
  getPetOverlayVisible,
  getLocale
}) {
  const tray = new Tray(createTrayIcon());
  let settingsWatcher = null;

  /** 从持久化设置读取语言：'system' 时按主进程系统语言解析（ADR-018） */
  function readStoredLocale() {
    try {
      const settings = createDefaultStore().readSettings();
      const stored =
        settings && typeof settings.language === 'string' ? settings.language : 'system';
      return stored === 'system'
        ? resolveLocale(app.getLocale())
        : resolveLocale(stored);
    } catch (_error) {
      return resolveLocale(app.getLocale());
    }
  }

  function getCurrentLocale() {
    return typeof getLocale === 'function' ? getLocale() : readStoredLocale();
  }

  function refreshMenu() {
    const t = createTranslator(getCurrentLocale());
    const visible = Boolean(getMainWindow()?.isVisible());
    const petVisible = typeof getPetOverlayVisible === 'function'
      ? getPetOverlayVisible()
      : false;
    tray.setToolTip(t('app.name'));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: visible ? t('tray.hideWindow') : t('tray.showWindow'),
          click: toggleMainWindow
        },
        {
          label: petVisible ? t('tray.hidePet') : t('tray.showPet'),
          click: () => togglePetOverlay?.()
        },
        { type: 'separator' },
        {
          label: t('updater.checkForUpdates'),
          click: () => {
            // T-52（ADR-040）：商店版（MSIX）无 electron-updater，点击提示走 Microsoft Store
            if (process.windowsStore) {
              const win = getMainWindow();
              const target = win && !win.isDestroyed() ? win : undefined;
              dialog
                .showMessageBox(target, {
                  type: 'info',
                  title: t('updater.storeUpdateTitle'),
                  message: t('updater.storeUpdateBody'),
                  buttons: [t('updater.ok')],
                  noLink: true
                })
                .catch(() => {});
              return;
            }
            checkForUpdates?.();
          }
        },
        { type: 'separator' },
        { label: t('tray.quit'), click: quitApp }
      ])
    );
  }

  refreshMenu();
  // 左键单击托盘图标同样切换窗口显示状态
  tray.on('click', toggleMainWindow);
  // 右键打开菜单前刷新，保证语言/可见状态最新
  tray.on('right-click', refreshMenu);

  // 设置文件变化时自动刷新菜单（语言切换即时生效；文件尚不存在时跳过）
  try {
    const settingsFile = path.join(resolveBaseDir(), 'settings.json');
    if (fs.existsSync(settingsFile)) {
      settingsWatcher = fs.watch(settingsFile, () => refreshMenu());
      settingsWatcher.on('error', () => {
        settingsWatcher = null;
      });
    }
  } catch (_error) {
    settingsWatcher = null;
  }

  return { tray, refreshMenu, dispose: () => settingsWatcher?.close() };
}

module.exports = { createTray, loadAppIcon };

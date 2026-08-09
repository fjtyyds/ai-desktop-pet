const { Tray, Menu, nativeImage } = require('electron');

/**
 * 托盘图标（32x32 PNG）。
 * 以 base64 内嵌，避免引入额外资源文件：橙色圆脸 + 眼睛 + 微笑。
 */
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAJYSURBVFhH7VYxSBxBFL1Od+bOu6hFypQWFnaxEHKkiGBlYWEhJGAjEYJYGUhhEYggaJFCCTs7RYojlelSWKWySZXGVNoEBJuF3K6WK+/HPTJ/Zu9mL7edD15xzN///v/z/5+r1R7wgCGRaDHX1bKdE7+5zUiR6dp4EopXaSQ6iZK3aSQzF5NInqRhsBHrZov7GBpwmCp5xcX6Uom4q+QWAuf+vIEsEiXPLOdlqMT5rR57wn0PBD5KlLy0HA5DVEPLNtcoxH3moxHPqUT8R9dnuJYFarb/LXsBkdTA5kTj8A9HyZtIHHLNHpB96W4vSYxwosVjrk2gcXN89C+vj2R2ttvILg4b1lkJuw9cm5BG8pvD2ODLZ5PZwsx0tjg3TSL83MtOiXOunXd+4YYDf7xvkNOcX7eblo2vnTURqQ7muRHn6dsJw/HnTduxt10YLJsBhMGyZcQYf6pTSXPHBffrZYdp4wEMbEAQ5T1eb1KW/KyUnZK7RgDdUK5aRhUyUWLHDEDLNjeqkkjYCADLgRtVSh3MGwFQEBW9ARaVvOLaBDSGZVwNNdcm4Br6LaOfe4WrtUeM4Pd3BZ1/z77/H/Fa8Q9AiGO2V55O0YjxcxArd2vpUeH2I/FInnBNA9SMjhcRzvP9Dr5+MUlzjgfny5tmtrfayp7PTtEZAkXA3Aeqa61gF9ChrqtAEBDNhVxEBVzioDV6/QBjVxDg7491KvHBWosqgewR2K/9umXbI998PqDlpERsOStBJFEqc46/C0p0uGMfouG87twHGB3Mr6tBDVLFRMf3b/gd7GZCIsor7GkAAAAASUVORK5CYII=';

// 持有全局引用，防止托盘被垃圾回收
let tray = null;

/**
 * 创建系统托盘：右键菜单（显示/隐藏、退出），左键单击切换窗口。
 * @param {{ onToggle: Function, onQuit: Function }} handlers
 * @returns {Tray}
 */
function createTray({ onToggle, onQuit }) {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip('AI 桌宠');

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: onToggle },
    { type: 'separator' },
    { label: '退出', click: onQuit }
  ]);
  tray.setContextMenu(contextMenu);

  // 左键单击托盘图标：显示/隐藏主窗口
  tray.on('click', onToggle);

  return tray;
}

module.exports = { createTray };
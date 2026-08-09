const { app, BrowserWindow } = require('electron');
const path = require('path');

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  app.exit(1);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 420,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true
    }
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  win.webContents.once('did-finish-load', () => {
    console.log('[smoke] 渲染页加载成功');
    setTimeout(() => app.quit(), 300);
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    fail(`渲染页加载失败 (${errorCode}): ${errorDescription}`);
  });

  setTimeout(() => fail('超时：15 秒内未完成加载'), 15000);
});

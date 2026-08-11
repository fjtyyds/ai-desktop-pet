const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  app.exit(1);
}

// 隔离测试数据：临时 userData，避免污染真实用户数据；结束进程时自动清理
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-smoke-'));
app.setPath('userData', smokeUserData);

// 预置一条历史消息，用于验证启动历史恢复（T-05 合入前 history.get 缺失则跳过）
const seedMessages = [
  { role: 'user', content: '历史消息', sessionId: 'default', timestamp: Date.now() - 1000 },
  { role: 'assistant', content: '历史回复', sessionId: 'default', timestamp: Date.now() }
];
fs.writeFileSync(
  path.join(smokeUserData, 'messages.json'),
  JSON.stringify(seedMessages),
  'utf8'
);

// 注册 IPC 处理器（聊天/设置/历史/许可证等），供渲染层端到端断言调用
require(path.join(__dirname, '..', 'src', 'main', 'ipc'));

process.on('exit', () => {
  try {
    fs.rmSync(smokeUserData, { recursive: true, force: true });
  } catch (_error) {
    // 临时目录清理失败不影响退出
  }
});

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

  win.webContents.once('did-finish-load', async () => {
    console.log('[smoke] 渲染页加载成功');
    try {
      const state = await win.webContents.executeJavaScript(`(async () => {
        const list = document.getElementById('message-list');
        const api = window.petAPI || {};
        const historyApi = Boolean(api.history && typeof api.history.get === 'function');
        let historyCount = -1;
        if (historyApi) {
          const items = await api.history.get();
          historyCount = Array.isArray(items) ? items.length : -1;
        }
        const chatReady = Boolean(api.chat && typeof api.chat.send === 'function');
        if (chatReady) {
          const input = document.getElementById('chat-input');
          input.value = 'smoke 测试';
          document.getElementById('chat-form').dispatchEvent(
            new Event('submit', { cancelable: true })
          );
        }
        await new Promise((resolve) => {
          const started = Date.now();
          const timer = setInterval(() => {
            const bubbles = list.querySelectorAll('.message').length;
            if (bubbles >= (historyApi ? 3 : 2) || Date.now() - started > 5000) {
              clearInterval(timer);
              resolve();
            }
          }, 50);
        });
        const firstBubble = list.querySelector('.message .bubble');
        return {
          historyApi,
          historyCount,
          chatReady,
          bubbleCount: list.querySelectorAll('.message').length,
          firstBubbleText: firstBubble ? firstBubble.textContent : ''
        };
      })()`);

      if (!state.chatReady) {
        fail('petAPI.chat.send 未暴露');
      }
      if (state.bubbleCount < (state.historyApi ? 3 : 2)) {
        fail(`发送后消息气泡不足（${state.bubbleCount}）`);
      }
      if (state.historyApi) {
        if (state.historyCount !== 2) {
          fail(`history.get 应返回 2 条，实际 ${state.historyCount}`);
        }
        if (state.firstBubbleText !== '历史消息') {
          fail(`启动历史未恢复（首条气泡：${state.firstBubbleText}）`);
        }
        console.log('[smoke] 启动历史恢复通过');
      } else {
        console.log('[smoke] history.get 未提供（T-05 未合入时跳过历史断言）');
      }

      console.log(`[smoke] chat 表单端到端通过（气泡 ${state.bubbleCount}）`);
      app.quit();
    } catch (error) {
      fail(`端到端断言异常: ${error && error.message ? error.message : error}`);
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    fail(`渲染页加载失败 (${errorCode}): ${errorDescription}`);
  });

  setTimeout(() => fail('超时：15 秒内未完成加载'), 15000);
});

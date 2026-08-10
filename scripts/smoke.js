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

// T-27：预置一个待消费的番茄钟完成信号，验证主进程消费与清零幂等
const seedSettings = {
  pomodoroNotifyAt: 1234567890123,
  pomodoroNotifyMinutes: 25
};
fs.writeFileSync(
  path.join(smokeUserData, 'settings.json'),
  JSON.stringify(seedSettings),
  'utf8'
);

// 注册 IPC 处理器（聊天/设置/历史），供端到端断言调用
const ipcModule = require(path.join(__dirname, '..', 'src', 'main', 'ipc'));

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

      // T-27：主进程消费与清零幂等（首次消费后再次消费必须返回 null；
      // 缓存设置同步清零，普通设置保存不回写陈旧信号）
      const firstConsume = ipcModule.consumePomodoroNotificationSignal();
      if (
        !firstConsume ||
        firstConsume.minutes !== 25 ||
        firstConsume.at !== 1234567890123
      ) {
        fail(`首次消费番茄钟信号结果异常: ${JSON.stringify(firstConsume)}`);
      }
      const secondConsume = ipcModule.consumePomodoroNotificationSignal();
      if (secondConsume !== null) {
        fail(`重复消费番茄钟信号未幂等: ${JSON.stringify(secondConsume)}`);
      }
      const afterConsume = ipcModule.getSettings();
      if (
        Number(afterConsume.pomodoroNotifyAt) !== 0 ||
        Number(afterConsume.pomodoroNotifyMinutes) !== 0
      ) {
        fail('消费后设置缓存未清零（陈旧信号仍可被轮询读到）');
      }
      const normalSave = await win.webContents.executeJavaScript(
        `window.petAPI.settings.set({ petName: 'smoke 保存' })`
      );
      if (Number(normalSave.pomodoroNotifyAt) !== 0) {
        fail('普通设置保存回写了已消费的陈旧信号');
      }
      console.log('[smoke] pomodoro 通知信号消费幂等通过');

      // T-27：渲染层倒计时结束只写一次信号，主进程消费一次后不再重复
      const pomodoroRun = await win.webContents.executeJavaScript(`(async () => {
        if (!window.ChatUI || typeof window.ChatUI.startPomodoro !== 'function') {
          return { supported: false };
        }
        window.ChatUI.startPomodoro(1 / 60); // T-21 快捷入口：约 1 秒倒计时
        const started = Date.now();
        while (Date.now() - started < 5000) {
          if (window.ChatUI.getPomodoroState().mode === 'finished') {
            return { supported: true, state: window.ChatUI.getPomodoroState() };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return { supported: true, state: window.ChatUI.getPomodoroState() };
      })()`);
      if (pomodoroRun.supported) {
        if (pomodoroRun.state.mode !== 'finished') {
          fail(`番茄钟未在预期时间内结束: ${JSON.stringify(pomodoroRun.state)}`);
        }
        let pendingAt = 0;
        for (let i = 0; i < 50; i += 1) {
          pendingAt = Number(ipcModule.getSettings().pomodoroNotifyAt);
          if (pendingAt > 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (pendingAt <= 0) {
          fail('渲染层倒计时结束未写入 pomodoroNotifyAt 信号');
        }
        const runConsume1 = ipcModule.consumePomodoroNotificationSignal();
        const runConsume2 = ipcModule.consumePomodoroNotificationSignal();
        if (!runConsume1 || runConsume2 !== null) {
          fail(
            `渲染层完成信号的消费/幂等断言失败: ${JSON.stringify({
              runConsume1,
              runConsume2
            })}`
          );
        }
        console.log('[smoke] pomodoro 渲染层→主进程一次性通知信号通过');
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

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
// T-55：注册宠物浮窗 IPC（状态/皮肤/开关）
const { createPetOverlay } = require(path.join(__dirname, '..', 'src', 'main', 'pet-overlay'));

process.on('exit', () => {
  try {
    fs.rmSync(smokeUserData, { recursive: true, force: true });
  } catch (_error) {
    // 临时目录清理失败不影响退出
  }
});

app.whenReady().then(() => {
  createPetOverlay({
    getSettings: () =>
      require(path.join(__dirname, '..', 'src', 'main', 'ipc')).getSettings(),
    getTray: () => null
  });

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
        // T-54：全新档案首启断言——等待 restoreSettings 完成后再核对引导可见性
        const onboardingView = document.getElementById('onboarding-view');
        let onboardingVisible = Boolean(onboardingView && !onboardingView.hidden);
        const onboardingDeadline = Date.now() + 5000;
        while (!onboardingVisible && Date.now() < onboardingDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const view = document.getElementById('onboarding-view');
          onboardingVisible = Boolean(view && !view.hidden);
        }
        const settingsApi =
          api.settings && typeof api.settings.get === 'function' ? api.settings : null;
        const freshSettings = settingsApi ? await settingsApi.get() : null;
        const firstBubble = list.querySelector('.message .bubble');
        return {
          historyApi,
          historyCount,
          chatReady,
          bubbleCount: list.querySelectorAll('.message').length,
          firstBubbleText: firstBubble ? firstBubble.textContent : '',
          onboardingExists: Boolean(onboardingView),
          onboardingVisible,
          onboardingDoneDefault: freshSettings
            ? freshSettings.onboardingDone
            : undefined
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
      if (!state.onboardingExists) {
        fail('新用户首启：onboarding-view 不存在');
      }
      if (!state.onboardingVisible) {
        fail('新用户首启：onboarding-view 未显示（全新档案应显示首次引导）');
      }
      if (state.onboardingDoneDefault !== false) {
        fail(
          `新用户首启：默认 onboardingDone 应为 false，实际 ${state.onboardingDoneDefault}`
        );
      }
      console.log('[smoke] 新用户首启引导可见且默认 onboardingDone=false 通过');
      // T-55：宠物浮窗端到端断言
      const overlayWin = new BrowserWindow({
        show: false,
        width: 240,
        height: 320,
        webPreferences: {
          preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          offscreen: true
        }
      });
      await overlayWin.loadFile(
        path.join(__dirname, '..', 'src', 'renderer', 'overlay.html')
      );
      const overlayState = await overlayWin.webContents.executeJavaScript(`(async () => {
        const api = window.petAPI.petOverlay || {};
        const hasApi = Boolean(
          api.getStatus && api.setStatus && api.getSkin && api.toggle &&
          api.tuckAway && api.setEnabled && api.refreshSkin
        );
        if (!hasApi) return { hasApi, state: null, text: '', skinOk: false, bubbleVisible: false };
        const initial = await api.getStatus();
        await api.setStatus({ state: 'working', text: 'smoke' });
        const status = await api.getStatus();
        const skin = await api.getSkin();
        const bubble = document.getElementById('overlay-bubble');
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
          hasApi,
          initialState: initial && initial.state,
          state: status && status.state,
          text: status && status.text,
          skinOk: Boolean(skin && skin.ok && skin.skin),
          bubbleVisible: Boolean(bubble && !bubble.hidden && bubble.textContent.length > 0)
        };
      })()`);
      if (!overlayState.hasApi) {
        fail('petAPI.petOverlay 未完整暴露');
      }
      if (overlayState.initialState !== 'idle') {
        fail(`浮窗初始状态应为 idle，实际 ${overlayState.initialState}`);
      }
      if (overlayState.state !== 'working' || overlayState.text !== 'smoke') {
        fail(`浮窗状态上报异常: ${JSON.stringify(overlayState)}`);
      }
      if (!overlayState.skinOk) {
        fail('pet:get-skin 未返回当前皮肤');
      }
      if (!overlayState.bubbleVisible) {
        fail('浮窗气泡未显示工作状态文案');
      }
      console.log('[smoke] 宠物浮窗状态/皮肤/气泡端到端通过');
      // T-58：情绪/动画行联动 + reduceMotion 同步 + 静态皮肤表情气泡端到端
      const moodState = await overlayWin.webContents.executeJavaScript(`(async () => {
        const t = window.__overlayTest;
        if (!t) return { hasHook: false };
        const pet = document.getElementById('overlay-pet');
        t.applyState('idle', '', true);
        // 默认皮肤可能是静态皮肤；先注入合成图集，验证情绪/状态行映射
        t.applySkin({
          spritesheetDataUrl: 'data:image/webp;base64,AA==',
          atlas: { cols: 8, rows: 9 }
        });
        t.applyMood({ valence: 92, intensity: 0.85, label: '兴奋' });
        const excitedRow = pet.dataset.row;
        t.applyMood({ valence: 80, intensity: 0.4, label: '开心' });
        const happyRow = pet.dataset.row;
        t.applyMood({ valence: 52, intensity: 0.35, label: '平静' });
        const neutralRow = pet.dataset.row;
        t.applyMood({ valence: 20, intensity: 0.25, label: '低落' });
        const sadRow = pet.dataset.row;
        t.applyState('waiting', '', true);
        const waitingRow = pet.dataset.row;
        t.applyState('working', '', true);
        const workingRow = pet.dataset.row;
        t.applyState('ready', '', true);
        const readyRow = pet.dataset.row;
        t.setReduceMotion(true);
        const reducedMotion = pet.dataset.reduceMotion === '1';
        t.applySkin({ roleAssets: { idle: 'data:image/png;base64,AA==' } });
        t.applyMood({ valence: 92, intensity: 0.85, label: '兴奋' });
        const moodBubble = document.getElementById('overlay-mood');
        const moodBubbleVisible = Boolean(
          moodBubble && !moodBubble.hidden && moodBubble.textContent.length > 0
        );
        return {
          hasHook: true,
          excitedRow,
          happyRow,
          neutralRow,
          sadRow,
          waitingRow,
          workingRow,
          readyRow,
          reducedMotion,
          moodBubbleVisible
        };
      })()`);
      if (!moodState.hasHook) {
        fail('overlay.js 未暴露 T-58 冒烟测试钩子 window.__overlayTest');
      }
      if (moodState.excitedRow !== '4' || moodState.happyRow !== '3') {
        fail(`情绪兴奋/开心行切换异常: ${JSON.stringify(moodState)}`);
      }
      if (moodState.neutralRow !== '0' || moodState.sadRow !== '5') {
        fail(`情绪中性/低落行切换异常: ${JSON.stringify(moodState)}`);
      }
      if (
        moodState.waitingRow !== '6' ||
        moodState.workingRow !== '7' ||
        moodState.readyRow !== '8'
      ) {
        fail(`状态行映射异常: ${JSON.stringify(moodState)}`);
      }
      if (!moodState.reducedMotion) {
        fail('reduceMotion 未同步到浮窗');
      }
      if (!moodState.moodBubbleVisible) {
        fail('静态皮肤兴奋时未显示表情气泡');
      }
      console.log('[smoke] T-58 情绪/动画联动端到端通过');
      overlayWin.destroy();
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

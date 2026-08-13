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
const ipcModule = require(path.join(__dirname, '..', 'src', 'main', 'ipc'));
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
  const overlayApi = createPetOverlay({
    getSettings: () =>
      require(path.join(__dirname, '..', 'src', 'main', 'ipc')).getSettings(),
    getTray: () => null
  });
  // T-64：把浮窗实例注入 ipc.js，真实主进程任务源（skin-import 等）才能推送浮窗
  ipcModule.setPetOverlay(overlayApi);

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
      // T-57：气泡队列/时长/开关端到端（真实 IPC）
      const queueState = await overlayWin.webContents.executeJavaScript(`(async () => {
        const api = window.petAPI.petOverlay;
        const bubble = document.getElementById('overlay-bubble');
        await window.petAPI.settings.set({
          petOverlayBubbleSeconds: 3,
          petOverlayBubbleEnabled: true
        });
        // 等待聊天测试的状态链路稳定（working→ready），避免晚到事件抢占队列
        for (let i = 0; i < 40; i += 1) {
          const s = await api.getStatus();
          if (s && (s.state === 'ready' || s.state === 'failed')) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        // 复位聊天测试残留状态（避免 ready 抢占队列）
        await api.setStatus({ state: 'idle' });
        const pushed = await api.pushBubble({
          state: 'attention',
          text: 'bubble-57'
        });
        // T-60 起浮窗心跳为 5s：轮询等待气泡出现（事件通道在真实浮窗窗口生效）
        const bubbleDeadline = Date.now() + 6500;
        while (
          !(
            bubble &&
            !bubble.hidden &&
            bubble.textContent.indexOf('bubble-57') !== -1
          ) &&
          Date.now() < bubbleDeadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await api.getStatus();
        }
        const during = await api.getStatus();
        const visibleDuring = Boolean(
          bubble && !bubble.hidden && bubble.textContent.indexOf('bubble-57') !== -1
        );
        await new Promise((resolve) => setTimeout(resolve, 3400));
        const after = await api.getStatus();
        await window.petAPI.settings.set({ petOverlayBubbleEnabled: false });
        await api.pushBubble({ state: 'attention', text: 'hidden-57' });
        const hideDeadline = Date.now() + 6500;
        while (!(bubble && bubble.hidden) && Date.now() < hideDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await api.getStatus();
        }
        const hiddenAfterDisable = Boolean(bubble && bubble.hidden);
        await window.petAPI.settings.set({ petOverlayBubbleEnabled: true });
        return {
          pushedState: pushed && pushed.state,
          duringState: during && during.state,
          visibleDuring,
          afterState: after && after.state,
          hiddenAfterDisable
        };
      })()`);
      if (queueState.pushedState !== 'attention' || queueState.duringState !== 'attention') {
        fail(`pushBubble 状态异常: ${JSON.stringify(queueState)}`);
      }
      if (!queueState.visibleDuring) {
        fail('气泡未显示 pushBubble 文案');
      }
      if (queueState.afterState !== 'idle') {
        fail(`气泡未按 petOverlayBubbleSeconds 回落 idle: ${JSON.stringify(queueState)}`);
      }
      if (!queueState.hiddenAfterDisable) {
        fail('petOverlayBubbleEnabled=false 时气泡未隐藏');
      }
      console.log('[smoke] T-57 状态机/气泡队列端到端通过');
      // T-56：showMain/toggleMain 通道端到端
      const t56State = await overlayWin.webContents.executeJavaScript(`(async () => {
        const api = window.petAPI.petOverlay;
        const show = await api.showMain();
        const toggle = await api.toggleMain();
        const move = await api.moveBy({ dx: 1, dy: 1 });
        const petEl = document.getElementById('overlay-pet');
        const petStyle = petEl ? getComputedStyle(petEl) : null;
        return {
          showOk: Boolean(show && show.ok),
          toggleOk: Boolean(toggle && toggle.ok),
          moveOk: Boolean(move && move.ok),
          noDragRegion: petStyle ? petStyle.webkitAppRegion !== 'drag' : false
        };
      })()`);
      if (!t56State.showOk || !t56State.toggleOk || !t56State.moveOk) {
        fail(`T-56 showMain/toggleMain 通道异常: ${JSON.stringify(t56State)}`);
      }
      if (!t56State.noDragRegion) {
        fail('浮窗宠物区域仍为拖拽区（会吞掉点击/双击）');
      }
      console.log('[smoke] T-56 浮窗交互通道端到端通过');
      // T-60：状态事件推送 + 完整状态端到端
      const perfState = await overlayWin.webContents.executeJavaScript(`(async () => {
        const api = window.petAPI.petOverlay;
        let eventReceived = null;
        api.onStatusUpdated((status) => {
          eventReceived = status;
        });
        await api.setStatus({ state: 'ready', text: 'event-60' });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const overlayState = await api.getOverlayState();
        const bubble = document.getElementById('overlay-bubble');
        return {
          eventState: eventReceived && eventReceived.state,
          eventText: eventReceived && eventReceived.text,
          bubbleShown: Boolean(
            bubble && !bubble.hidden && bubble.textContent.indexOf('event-60') !== -1
          ),
          stateHasStatus: Boolean(
            overlayState && overlayState.status && overlayState.status.state === 'ready'
          ),
          stateHasFlags:
            overlayState &&
            typeof overlayState.enabled === 'boolean' &&
            typeof overlayState.visible === 'boolean'
        };
      })()`);
      if (perfState.eventState !== 'ready' || perfState.eventText !== 'event-60') {
        fail(`T-60 状态事件推送异常: ${JSON.stringify(perfState)}`);
      }
      if (!perfState.bubbleShown) {
        fail('T-60 事件推送后气泡未更新');
      }
      if (!perfState.stateHasStatus || !perfState.stateHasFlags) {
        fail(`T-60 getOverlayState 异常: ${JSON.stringify(perfState)}`);
      }
      console.log('[smoke] T-60 状态事件推送/完整状态端到端通过');
      // T-61：设置控件存在 + 浮窗配置读写/清洗端到端
      const t61State = await win.webContents.executeJavaScript(`(async () => {
        const hasControls = Boolean(
          document.getElementById('pet-overlay-bubble-enabled') &&
          document.getElementById('pet-overlay-bubble-seconds') &&
          document.getElementById('pet-overlay-reminders')
        );
        const saved = await window.petAPI.settings.set({
          petOverlayBubbleEnabled: false,
          petOverlayBubbleSeconds: 9,
          petOverlayReminders: false
        });
        const after = await window.petAPI.settings.get();
        const clamped = await window.petAPI.settings.set({
          petOverlayBubbleSeconds: 99
        });
        return {
          hasControls,
          bubbleEnabled: after && after.petOverlayBubbleEnabled,
          bubbleSeconds: after && after.petOverlayBubbleSeconds,
          reminders: after && after.petOverlayReminders,
          clampedSeconds: clamped && clamped.petOverlayBubbleSeconds
        };
      })()`);
      if (!t61State.hasControls) {
        fail('主窗口缺少 T-61 浮窗设置控件');
      }
      if (
        t61State.bubbleEnabled !== false ||
        t61State.bubbleSeconds !== 9 ||
        t61State.reminders !== false
      ) {
        fail(`浮窗配置读写异常: ${JSON.stringify(t61State)}`);
      }
      if (t61State.clampedSeconds !== 20) {
        fail(`气泡时长未夹取到 3~20: ${JSON.stringify(t61State)}`);
      }
      console.log('[smoke] T-61 浮窗设置读写/清洗端到端通过');
      // T-63：任务级进度气泡端到端（start→update→finish、进度条、提醒补放、getConfig）
      await win.webContents.executeJavaScript(`(async () => {
        await window.petAPI.settings.set({
          petOverlayBubbleSeconds: 3,
          petOverlayBubbleEnabled: true,
          petOverlayReminders: true
        });
      })()`);
      const t63State = await overlayWin.webContents.executeJavaScript(`(async () => {
        const api = window.petAPI.petOverlay;
        const bubble = document.getElementById('overlay-bubble');
        const progress = document.getElementById('overlay-bubble-progress');
        const progressBar = document.getElementById('overlay-bubble-progress-bar');
        const progressLabel = document.getElementById('overlay-bubble-progress-label');
        const t = window.__overlayTest;
        const started = await api.startTask({
          id: 'smoke-task',
          title: 'task-63',
          percent: 0,
          stage: 1,
          totalStages: 3
        });
        const taskInHook = t.getTask();
        const bubbleVisible = Boolean(
          bubble && !bubble.hidden && bubble.textContent.indexOf('task-63') !== -1
        );
        const progressVisible = Boolean(progress && !progress.hidden);
        const parked = await api.pushBubble({ state: 'attention', text: 'parked-63' });
        const updated = await api.updateTask({
          id: 'smoke-task',
          percent: 50,
          stage: 2,
          totalStages: 3,
          message: 'step-2'
        });
        const labelAfter = progressLabel ? progressLabel.textContent : '';
        const barWidth = progressBar ? progressBar.style.width : '';
        const stillTask = t.getTask();
        const cfg = await api.getConfig();
        const finished = await api.finishTask({
          id: 'smoke-task',
          ok: true,
          message: 'done-63'
        });
        const stateAfter = await api.getStatus();
        const progressHiddenAfter = Boolean(progress && progress.hidden);
        const progressLabelAfter = progressLabel ? progressLabel.textContent : null;
        return {
          started: Boolean(started && started.ok),
          taskInHook: Boolean(
            taskInHook && taskInHook.id === 'smoke-task' && taskInHook.status === 'running'
          ),
          bubbleVisible,
          progressVisible,
          parked: Boolean(parked && parked.text === 'parked-63'),
          updated: Boolean(updated && updated.ok),
          labelAfter,
          barWidth,
          stillTask: Boolean(stillTask && stillTask.percent === 50 && stillTask.stage === 2),
          cfgOk: Boolean(
            cfg &&
              cfg.bubbleSeconds === 3 &&
              cfg.bubbleEnabled === true &&
              typeof cfg.reminders === 'boolean'
          ),
          finished: Boolean(finished && finished.ok && finished.task === null),
          stateAfter: stateAfter && stateAfter.state,
          taskAfter: stateAfter && stateAfter.task,
          progressHiddenAfter,
          progressLabelAfter,
          bubbleTextAfter: bubble ? bubble.textContent : ''
        };
      })()`);
      if (
        !t63State.started ||
        !t63State.taskInHook ||
        !t63State.bubbleVisible ||
        !t63State.progressVisible ||
        !t63State.parked ||
        !t63State.updated ||
        t63State.labelAfter.indexOf('50%') === -1 ||
        t63State.barWidth !== '50%' ||
        !t63State.stillTask ||
        !t63State.cfgOk ||
        !t63State.finished ||
        t63State.stateAfter !== 'ready' ||
        t63State.taskAfter !== null ||
        !t63State.progressHiddenAfter ||
        t63State.progressLabelAfter !== '' ||
        t63State.bubbleTextAfter.indexOf('done-63') === -1
      ) {
        fail(`T-63 任务气泡端到端异常: ${JSON.stringify(t63State)}`);
      }
      // 任务结束后排队提醒补放（气泡时长 3s）
      const parkedDeadline = Date.now() + 4500;
      let parkedReplayed = false;
      while (Date.now() < parkedDeadline) {
        const bubbleText = await overlayWin.webContents.executeJavaScript(
          `document.getElementById('overlay-bubble') ? document.getElementById('overlay-bubble').textContent : ''`
        );
        if (bubbleText.indexOf('parked-63') !== -1) {
          parkedReplayed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!parkedReplayed) {
        fail('T-63 任务结束后提醒气泡未补放');
      }
      console.log('[smoke] T-63 任务级进度气泡端到端通过');
      // T-59：Codex pets 目录扫描导入 + 失败分组 + 9 行状态预览端到端
      const codexPetsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-smoke-pets-'));
      try {
        function makeSmokePetPack(dir, id, name) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, 'pet.json'),
            JSON.stringify({
              id,
              displayName: name,
              description: 'smoke',
              spritesheetPath: 'spritesheet.webp'
            }),
            'utf8'
          );
          const webp = Buffer.alloc(30);
          webp.write('RIFF', 0, 'ascii');
          webp.writeUInt32LE(22, 4);
          webp.write('WEBP', 8, 'ascii');
          webp.write('VP8X', 12, 'ascii');
          webp.writeUInt32LE(10, 16);
          webp.writeUIntLE(1535, 24, 3);
          webp.writeUIntLE(1871, 27, 3);
          fs.writeFileSync(path.join(dir, 'spritesheet.webp'), webp);
        }
        const petsRoot = path.join(codexPetsTmp, 'pets');
        makeSmokePetPack(path.join(petsRoot, 'alpha'), 'alpha-pet', 'Alpha');
        makeSmokePetPack(path.join(petsRoot, 'node_modules', 'evil'), 'evil-node', 'Evil');
        const broken = path.join(petsRoot, 'broken');
        fs.mkdirSync(broken, { recursive: true });
        fs.writeFileSync(
          path.join(broken, 'pet.json'),
          JSON.stringify({
            id: 'broken-pet',
            displayName: 'Broken',
            description: '',
            spritesheetPath: 'missing.webp'
          }),
          'utf8'
        );
        const t59State = await win.webContents.executeJavaScript(`(async () => {
          const api = window.petAPI.skin;
          const result = await api.importCodexPets({ path: ${JSON.stringify(petsRoot)} });
          const page = document.getElementById('skin-page');
          const oldHidden = page.hidden;
          page.hidden = false;
          await window.ChatUI.refreshSkins();
          const cards = Array.from(document.querySelectorAll('.skin-card'));
          const alphaCard = cards.find((card) => card.dataset.id === 'alpha-pet');
          const previewRows = alphaCard
            ? alphaCard.querySelectorAll('.skin-preview-atlas-row').length
            : 0;
          const previewRowOk = Boolean(
            alphaCard && alphaCard.querySelector('.skin-preview-atlas-rows')
          );
          const panel = document.getElementById('skin-codex-result');
          window.ChatUI.renderSkinCodexResult(result);
          const panelText = panel ? panel.textContent : '';
          const groupedFailures = panel
            ? panel.querySelectorAll('.skin-codex-failures li').length
            : 0;
          const grouped = window.ChatUI.groupSkinImportFailures(result.failed);
          page.hidden = oldHidden;
          return {
            ok: Boolean(result && result.ok),
            imported: Array.isArray(result.imported) ? result.imported.map((s) => s.id) : [],
            failed: Array.isArray(result.failed) ? result.failed.map((f) => f.name) : [],
            failedError:
              result && result.failed && result.failed[0] ? result.failed[0].error : '',
            buttonExists: Boolean(document.getElementById('skin-codex-import-btn')),
            previewRowOk,
            previewRows,
            panelText,
            groupedFailures,
            groupedCount: grouped.length
          };
        })()`);
        if (!t59State.ok) {
          fail('skin:import-codepets 未返回 ok');
        }
        if (
          !t59State.imported.includes('alpha-pet') ||
          t59State.imported.includes('evil-node')
        ) {
          fail(`扫描导入结果异常: ${JSON.stringify(t59State.imported)}`);
        }
        if (
          t59State.failed.length !== 1 ||
          t59State.failed[0] !== 'broken' ||
          !t59State.failedError.includes('spritesheet')
        ) {
          fail(`扫描失败分组异常: ${JSON.stringify(t59State.failed)}`);
        }
        if (!t59State.buttonExists) {
          fail('皮肤页缺少“扫描 Codex 宠物目录”按钮');
        }
        if (!t59State.previewRowOk || t59State.previewRows !== 9) {
          fail(`图集 9 行预览异常: ${JSON.stringify(t59State)}`);
        }
        if (
          t59State.groupedFailures < 1 ||
          !t59State.panelText.includes('broken') ||
          t59State.groupedCount < 1
        ) {
          fail(`错误分组渲染异常: ${JSON.stringify(t59State)}`);
        }
        console.log('[smoke] T-59 目录扫描导入/失败分组/9 行预览端到端通过');
      } finally {
        fs.rmSync(codexPetsTmp, { recursive: true, force: true });
      }
      // T-64：真实扫描导入期间 overlay 出现 skin-import 任务并在结束后清空
      const t64PetsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pet-smoke-t64-'));
      try {
        function makeT64PetPack(dir, id) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, 'pet.json'),
            JSON.stringify({
              id,
              displayName: `T64 ${id}`,
              description: 'smoke-t64',
              spritesheetPath: 'spritesheet.webp'
            }),
            'utf8'
          );
          // 4MB 有效 WebP 头 + 填充：放大同步扫描耗时，让浮窗渲染进程可并发观察到运行中任务
          const webp = Buffer.alloc(4 * 1024 * 1024);
          webp.write('RIFF', 0, 'ascii');
          webp.writeUInt32LE(webp.length - 8, 4);
          webp.write('WEBP', 8, 'ascii');
          webp.write('VP8X', 12, 'ascii');
          webp.writeUInt32LE(10, 16);
          webp.writeUIntLE(1535, 24, 3);
          webp.writeUIntLE(1871, 27, 3);
          fs.writeFileSync(path.join(dir, 'spritesheet.webp'), webp);
        }
        const t64Root = path.join(t64PetsTmp, 'pets');
        for (let i = 0; i < 10; i += 1) {
          makeT64PetPack(path.join(t64Root, `pack-${i}`), `t64-pack-${i}`);
        }
        // 先启动浮窗采样器（overlay 渲染进程 10ms 轮询 getTask），再触发真实导入
        const t64SamplerPromise = overlayWin.webContents.executeJavaScript(`(async () => {
          window.__t64Samples = [];
          window.__t64Stop = false;
          const t = window.__overlayTest;
          const deadline = Date.now() + 12000;
          while (!window.__t64Stop && Date.now() < deadline) {
            const task = t.getTask();
            if (task) {
              window.__t64Samples.push({
                id: task.id,
                status: task.status,
                percent: task.percent
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return true;
        })()`);
        // 等待采样器进入轮询（导入扫描为同步主进程操作，提前启动才能并发观察）
        await new Promise((resolve) => setTimeout(resolve, 50));
        const t64Import = await win.webContents.executeJavaScript(`(async () => {
          const result = await window.petAPI.skin.importCodexPets({ path: ${JSON.stringify(t64Root)} });
          return {
            ok: Boolean(result && result.ok),
            imported: Array.isArray(result.imported) ? result.imported.length : -1
          };
        })()`);
        if (!t64Import.ok || t64Import.imported !== 10) {
          fail(`T-64 扫描导入结果异常: ${JSON.stringify(t64Import)}`);
        }
        const t64Observed = await overlayWin.webContents.executeJavaScript(`(async () => {
          window.__t64Stop = true;
          const deadline = Date.now() + 3000;
          let cleared = false;
          while (Date.now() < deadline) {
            const task = window.__overlayTest.getTask();
            if (!task || task.status !== 'running') {
              cleared = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return {
            samples: window.__t64Samples || [],
            cleared,
            finalTask: window.__overlayTest.getTask()
          };
        })()`);
        await t64SamplerPromise;
        const sawRunning = t64Observed.samples.some(
          (sample) => sample.id === 'skin-import' && sample.status === 'running'
        );
        if (!sawRunning) {
          fail(
            `T-64 未观察到 overlay 运行中的 skin-import 任务（采样 ${JSON.stringify(
              t64Observed.samples.slice(0, 20)
            )}）`
          );
        }
        if (!t64Observed.cleared) {
          fail(
            `T-64 导入返回后 overlay 任务未清空（finalTask ${JSON.stringify(
              t64Observed.finalTask
            )}，采样 ${JSON.stringify(t64Observed.samples.slice(0, 20))}）`
          );
        }
        console.log('[smoke] T-64 扫描导入期间 skin-import 任务出现并结束后清空通过');
      } finally {
        fs.rmSync(t64PetsTmp, { recursive: true, force: true });
      }
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

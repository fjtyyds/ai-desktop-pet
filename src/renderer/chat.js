/**
 * T-02 聊天面板逻辑 + T-12 i18n/无障碍：
 * - 消息列表渲染（用户/桌宠气泡）
 * - 输入框与发送（通过 window.petAPI.chat.send，接口未实现时优雅降级）
 * - 设置页（petAPI.settings.get/set 初始化与保存宠物名 + 人格 + API Key + 模型 + 语言，
 *   ADR-013/ADR-015/ADR-018；localStorage 仅作 petAPI 缺失时的降级）
 * - 设置页“记忆”子页（petAPI.memory.list/delete/update，T-17，ADR-022）：
 *   列表展示、删除、内联修正，空态与错误提示
 * - 文案经 src/shared/locales 获取，默认跟随系统，设置页可选并持久化
 * - T-14：流式回复优先（chat.sendStream + chat.onDelta），"正在思考…" 占位、
 *   打字机增量更新、流式中发送按钮变为"停止"（chat.cancelStream）
 * - T-15 空闲主动互动：窗口内交互心跳上报主进程；主进程触发后随机展示互动气泡
 * - T-19 窗口体验：设置页注入“贴边隐藏/全局快捷键”开关与提示（ADR-022 冻结契约
 *   petAPI.window.toggleDock / setShortcutEnabled；提示文案为本地双语映射，不依赖 locale 文件）
 * - T-20 首次引导与人格模板：首次启动三步引导（语言 / API Key 与模型 / 人格模板），
 *   完成标志 onboardingDone 持久化；内置 6 套预设人格模板（双语内联，与 store.js
 *   PERSONA_TEMPLATE_IDS 对齐），设置页与引导中均可一键切换，切换即时保存到
 *   settings.persona 并持久化
 * - T-21 系统状态与番茄钟：小部件面板展示 CPU/内存/电池（主进程复用 idle:event
 *   推送 { type: 'system-status' }）；本地番茄钟计时，完成时写入 settings 通知信号
 *   （pomodoroNotifyAt），由主进程轮询消费并弹系统通知；面板可收起、设置可关闭
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ai-pet-settings';
  const DEFAULT_MODEL = 'deepseek-v4-flash';
  const DEFAULT_LANGUAGE = 'system';
  const ACTIVITY_POKE_MIN_INTERVAL_MS = 5000; // T-15: 交互心跳节流
  const MOOD_POLL_MS = 3000;
  const DEFAULT_POMODORO_MINUTES = 25; // T-21：与 store.js 默认值一致
  const POMODORO_TICK_MS = 250; // T-21：番茄钟刷新间隔
  /** T-19：设置页窗口行为区块文案（双语内联，因 locale 文件不在任务边界内） */
  const WINDOW_FEATURE_HINTS = {
    'zh-CN': {
      title: '窗口行为',
      dockLabel: '贴边隐藏',
      dockHint: '拖到屏幕边缘自动收起成细条，鼠标靠近自动滑出；可随时关闭。',
      shortcutLabel: '全局快捷键',
      shortcutHint: '按 Ctrl+Alt+P 可从任意位置呼出窗口；按键被占用时自动尝试备用键。',
      shortcutUnavailable: '快捷键注册失败（可能与其他应用冲突），已自动关闭。',
      shortcutChanged: '全局快捷键设置已保存。'
    },
    en: {
      title: 'Window behavior',
      dockLabel: 'Edge docking',
      dockHint:
        'Drag to a screen edge to auto-collapse; hover near the edge to slide out.',
      shortcutLabel: 'Global shortcut',
      shortcutHint:
        'Press Ctrl+Alt+P to summon the window from anywhere; fallbacks are tried if taken.',
      shortcutUnavailable:
        'Shortcut registration failed (possibly in use by another app) and was disabled.',
      shortcutChanged: 'Global shortcut setting saved.'
    }
  };
  /** T-23：语音输出按钮文案（双语内联，原因同 WINDOW_FEATURE_HINTS） */
  const TTS_HINTS = {
    'zh-CN': {
      speak: '朗读',
      stop: '停止朗读',
      unavailable: '系统语音不可用'
    },
    en: {
      speak: 'Speak',
      stop: 'Stop',
      unavailable: 'System voice unavailable'
    }
  };
  /**
   * T-20：首次引导与人格模板文案（双语内联，原因同 WINDOW_FEATURE_HINTS：
   * locale JSON 不在本次任务边界内，与协调者核对的边界一致）。
   */
  const ONBOARDING_TEXTS = {
    'zh-CN': {
      title: '欢迎使用 AI 桌宠',
      subtitle: '三步完成首次设置，随时可改。',
      progressAria: '引导步骤',
      step1: '语言',
      step2: 'API Key 与模型',
      step3: '人格模板',
      languageHint: '界面语言会即时切换，也可以在设置中随时修改。',
      modelHint: '不填写 API Key 时将以演示模式运行，随时可在设置中补充。',
      templateHint: '选择一位你喜欢的桌宠人格，之后可在设置中随时切换或微调。',
      templatePreview: '人格预览',
      templateEmpty: '暂无可用的人格模板。',
      back: '上一步',
      next: '下一步',
      finish: '开始使用',
      applied: '设置完成，欢迎回来！',
      applyError: '保存引导设置失败：{error}',
      personaTemplates: '人格模板',
      personaTemplatesHint: '一键套用预设人格，之后仍可在下方手动微调。',
      personaTemplateApplied: '已应用人格模板「{name}」',
      personaTemplateApplyError: '应用人格模板失败：{error}'
    },
    en: {
      title: 'Welcome to AI Pet',
      subtitle:
        'Complete three quick steps to get started — you can change these anytime.',
      progressAria: 'Onboarding steps',
      step1: 'Language',
      step2: 'API key & model',
      step3: 'Personality template',
      languageHint:
        'The UI language switches instantly and can be changed in settings anytime.',
      modelHint:
        'Without an API key the app runs in demo mode; you can add one later in settings.',
      templateHint:
        'Pick a personality for your pet. You can switch or fine-tune it in settings later.',
      templatePreview: 'Personality preview',
      templateEmpty: 'No personality templates are available.',
      back: 'Back',
      next: 'Next',
      finish: 'Get started',
      applied: 'Setup complete. Welcome back!',
      applyError: 'Failed to save onboarding: {error}',
      personaTemplates: 'Personality templates',
      personaTemplatesHint:
        'Apply a preset personality in one click; you can still fine-tune it below.',
      personaTemplateApplied: 'Applied personality template “{name}”',
      personaTemplateApplyError: 'Failed to apply template: {error}'
    }
  };
  /**
   * T-20：6 套预设人格模板（双语内联；id 与 store.js PERSONA_TEMPLATE_IDS 对齐，
   * 内容与现有 Persona 字段 traits/tone/backstory 一致，ADR-011）。
   */
  const PERSONA_TEMPLATES = {
    'zh-CN': {
      warm: {
        name: '温暖陪伴',
        description: '热情友善的贴心伙伴，适合日常陪伴与闲聊。',
        persona: {
          traits: ['热情', '友善', '好奇'],
          tone: '温暖活泼',
          backstory: '我是你的 AI 桌宠，喜欢陪你聊天、记住你在意的小事，给你带来好心情。'
        }
      },
      sage: {
        name: '博学智囊',
        description: '沉稳博学的知识伙伴，擅长把复杂问题讲明白。',
        persona: {
          traits: ['睿智', '沉稳', '条理清晰'],
          tone: '温和专业',
          backstory: '我是一只饱览群书的桌宠，擅长把复杂的问题讲得简单明白，陪你一起学习和思考。'
        }
      },
      playful: {
        name: '元气玩伴',
        description: '活泼幽默的气氛担当，把无聊日常变得有趣。',
        persona: {
          traits: ['活泼', '幽默', '爱玩'],
          tone: '俏皮欢快',
          backstory: '我是你的元气玩伴，最喜欢陪你打气、讲笑话，把无聊的日常变得有趣起来。'
        }
      },
      gentle: {
        name: '温柔治愈',
        description: '耐心体贴的倾听者，适合疲惫时聊聊天。',
        persona: {
          traits: ['温柔', '耐心', '善解人意'],
          tone: '轻柔舒缓',
          backstory: '我是温柔治愈型桌宠，会认真倾听你的心事，给你安心和鼓励，陪你慢慢放松下来。'
        }
      },
      cool: {
        name: '高冷猫系',
        description: '话不多但观察力一流的猫系伙伴，嘴硬心软。',
        persona: {
          traits: ['高冷', '敏锐', '嘴硬心软'],
          tone: '简洁利落',
          backstory: '我是一只高冷但护短的猫系桌宠，话不多，观察力一流，关键时刻永远站在你这边。'
        }
      },
      curious: {
        name: '好奇宝宝',
        description: '对世界充满好奇，拉着你一起探索新事物。',
        persona: {
          traits: ['好奇', '爱问', '元气'],
          tone: '天真雀跃',
          backstory: '我对世界充满好奇，总想拉着你一起探索新事物，问东问西却常常发现有趣的东西！'
        }
      }
    },
    en: {
      warm: {
        name: 'Warm Companion',
        description: 'A warm and friendly buddy for everyday chats.',
        persona: {
          traits: ['Warm', 'Friendly', 'Curious'],
          tone: 'Warm and lively',
          backstory:
            "I'm your AI pet who loves chatting with you, remembering the little things that matter, and brightening your day."
        }
      },
      sage: {
        name: 'Wise Mentor',
        description: 'A calm, well-read partner who makes complex ideas simple.',
        persona: {
          traits: ['Wise', 'Calm', 'Clear-minded'],
          tone: 'Warm and professional',
          backstory:
            "I'm a well-read pet who loves turning complex ideas into simple explanations and learning together with you."
        }
      },
      playful: {
        name: 'Playful Buddy',
        description: 'An energetic joker who makes ordinary days more fun.',
        persona: {
          traits: ['Energetic', 'Humorous', 'Playful'],
          tone: 'Cheerful and lively',
          backstory:
            "I'm your energetic buddy who cheers you on, tells jokes, and makes ordinary days more fun."
        }
      },
      gentle: {
        name: 'Gentle Healer',
        description: 'A patient listener who soothes you when you are tired.',
        persona: {
          traits: ['Gentle', 'Patient', 'Empathetic'],
          tone: 'Soft and soothing',
          backstory:
            "I'm a gentle, healing pet who listens carefully, encourages you, and helps you unwind at your own pace."
        }
      },
      cool: {
        name: 'Cool Cat',
        description: 'A sharp-eyed cat companion who says little but always has your back.',
        persona: {
          traits: ['Aloof', 'Sharp', 'Soft-hearted'],
          tone: 'Terse and witty',
          backstory:
            "I'm a cool cat who does not talk much, notices everything, and always has your back when it counts."
        }
      },
      curious: {
        name: 'Curious Explorer',
        description: 'Endlessly curious, eager to explore new things with you.',
        persona: {
          traits: ['Curious', 'Inquisitive', 'Bubbly'],
          tone: 'Eager and bright',
          backstory:
            'I am endlessly curious and love exploring new things with you, asking questions and finding fun surprises along the way.'
        }
      }
    }
  };
  /** 情绪带：valence 从高到低匹配；face 为角色表情，className 对应配色主题 */
  const MOOD_BANDS = [
    { min: 85, className: 'mood-excited', face: '🤩' },
    { min: 70, className: 'mood-happy', face: '😄' },
    { min: 55, className: 'mood-happy', face: '😊' },
    { min: 45, className: 'mood-neutral', face: '🙂' },
    { min: 35, className: 'mood-neutral', face: '😐' },
    { min: 15, className: 'mood-sad', face: '😔' },
    { min: 0, className: 'mood-sad', face: '😢' }
  ];
  let messages = [];
  let elements = {};
  let currentLocale = 'zh-CN';
  let currentPetName = 'AI 桌宠';
  let streaming = false;
  let lastActivityPokeAt = 0;
  let memoryItems = [];
  let currentSettings = {};
  let windowFeatureEls = {};
  // T-20：首次引导当前步骤与选中的预设人格模板 id
  let onboardingStep = 1;
  let selectedOnboardingTemplateId = '';
  // T-23：系统 TTS（Web Speech Synthesis）状态
  let ttsVoices = [];
  let ttsReady = false;
  let currentUtterance = null;
  let currentSpeakButton = null;
  // T-21：小部件与番茄钟状态
  let lastSystemStatus = null;
  let pomodoroStatusTimer = null;
  let pomodoroState = {
    mode: 'idle', // 'idle' | 'running' | 'paused' | 'finished'
    durationMs: DEFAULT_POMODORO_MINUTES * 60 * 1000,
    remainingMs: DEFAULT_POMODORO_MINUTES * 60 * 1000,
    endsAt: 0,
    timerId: null
  };

  async function init() {
    cacheElements();
    bindEvents();
    bindActivityEvents();
    subscribeIdle();
    initTts(); // T-23：语音输出能力探测（异步加载系统语音列表）
    // 先加载两份语言包，确保任何文案渲染不会回退到键名
    await window.PetLocales.ready;
    await restoreSettings();
    ensureWindowFeatureControls(); // T-19: 注入窗口行为开关与提示
    void restoreHistory();
    void initMood();
  }

  function cacheElements() {
    elements = {
      petCard: document.getElementById('pet-card'),
      chatView: document.getElementById('chat-view'),
      settingsView: document.getElementById('settings-view'),
      moodIndicator: document.getElementById('mood-indicator'),
      moodFace: document.getElementById('mood-face'),
      moodLabel: document.getElementById('mood-label'),
      settingsHome: document.getElementById('settings-home'),
      memoryPage: document.getElementById('memory-page'),
      messageList: document.getElementById('message-list'),
      serviceStatus: document.getElementById('service-status'),
      chatForm: document.getElementById('chat-form'),
      chatInput: document.getElementById('chat-input'),
      sendBtn: document.getElementById('send-btn'),
      settingsBtn: document.getElementById('settings-btn'),
      closeBtn: document.getElementById('close-btn'),
      settingsBack: document.getElementById('settings-back'),
      memoryManageBtn: document.getElementById('memory-manage-btn'),
      memoryBack: document.getElementById('memory-back'),
      memoryStatus: document.getElementById('memory-status'),
      memoryEmpty: document.getElementById('memory-empty'),
      memoryList: document.getElementById('memory-list'),
      headerTitle: document.getElementById('header-title'),
      apiKey: document.getElementById('api-key'),
      model: document.getElementById('model'),
      language: document.getElementById('language'),
      petName: document.getElementById('pet-name'),
      personaTraits: document.getElementById('persona-traits'),
      personaTone: document.getElementById('persona-tone'),
      personaBackstory: document.getElementById('persona-backstory'),
      idleEnabled: document.getElementById('idle-enabled'),
      settingsSave: document.getElementById('settings-save'),
      settingsStatus: document.getElementById('settings-status'),
      exportMdBtn: document.getElementById('export-md'),
      exportJsonBtn: document.getElementById('export-json'),
      exportStatus: document.getElementById('export-status'),
      clearScope: document.getElementById('clear-scope'),
      clearDataBtn: document.getElementById('clear-data'),
      clearStatus: document.getElementById('clear-status'),
      personaTemplateLabel: document.getElementById('persona-template-label'),
      personaTemplateHint: document.getElementById('persona-template-hint'),
      personaTemplateList: document.getElementById('persona-template-list'),
      onboardingView: document.getElementById('onboarding-view'),
      onboardingTitle: document.getElementById('onboarding-title'),
      onboardingSubtitle: document.getElementById('onboarding-subtitle'),
      onboardingProgress: document.getElementById('onboarding-progress'),
      onboardingProgress1: document.getElementById('onboarding-progress-1'),
      onboardingProgress2: document.getElementById('onboarding-progress-2'),
      onboardingProgress3: document.getElementById('onboarding-progress-3'),
      onboardingStep1: document.getElementById('onboarding-step-1'),
      onboardingStep2: document.getElementById('onboarding-step-2'),
      onboardingStep3: document.getElementById('onboarding-step-3'),
      onboardingLanguage: document.getElementById('onboarding-language'),
      onboardingApiKey: document.getElementById('onboarding-api-key'),
      onboardingModel: document.getElementById('onboarding-model'),
      onboardingLanguageHint: document.getElementById('onboarding-language-hint'),
      onboardingModelHint: document.getElementById('onboarding-model-hint'),
      onboardingStep3Hint: document.getElementById('onboarding-step3-hint'),
      onboardingTemplateList: document.getElementById('onboarding-template-list'),
      onboardingTemplatePreview: document.getElementById(
        'onboarding-template-preview'
      ),
      onboardingPreviewTitle: document.getElementById('onboarding-preview-title'),
      onboardingPreviewTraits: document.getElementById('onboarding-preview-traits'),
      onboardingPreviewTone: document.getElementById('onboarding-preview-tone'),
      onboardingPreviewBackstory: document.getElementById(
        'onboarding-preview-backstory'
      ),
      onboardingBack: document.getElementById('onboarding-back'),
      onboardingNext: document.getElementById('onboarding-next'),
      onboardingFinish: document.getElementById('onboarding-finish'),
      onboardingStatus: document.getElementById('onboarding-status'),
      widgetsPanel: document.getElementById('widgets-panel'),
      widgetsToggle: document.getElementById('widgets-toggle'),
      widgetStats: document.getElementById('widget-stats'),
      statCpu: document.getElementById('stat-cpu'),
      statMem: document.getElementById('stat-mem'),
      statBattery: document.getElementById('stat-battery'),
      statBatteryState: document.getElementById('stat-battery-state'),
      pomodoroTime: document.getElementById('pomodoro-time'),
      pomodoroStart: document.getElementById('pomodoro-start'),
      pomodoroReset: document.getElementById('pomodoro-reset'),
      pomodoroStop: document.getElementById('pomodoro-stop'),
      pomodoroStatus: document.getElementById('pomodoro-status'),
      widgetsEnabled: document.getElementById('widgets-enabled'),
      pomodoroEnabled: document.getElementById('pomodoro-enabled'),
      pomodoroMinutes: document.getElementById('pomodoro-minutes')
    };
    showExportStatus = makeStatusShower(elements.exportStatus);
    showClearStatus = makeStatusShower(elements.clearStatus);
  }

  /* ---------------- T-19：窗口行为开关与提示（ADR-022 冻结契约） ---------------- */

  function hasWindowApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.window &&
        typeof window.petAPI.window.toggleDock === 'function' &&
        typeof window.petAPI.window.setShortcutEnabled === 'function'
    );
  }

  function makeWindowFeatureSwitch(kind, id) {
    const label = document.createElement('label');
    label.className = 'field field-switch';
    label.dataset.windowFeature = kind;

    const text = document.createElement('span');
    text.className = 'field-label';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'field-checkbox';
    input.id = id;

    const hint = document.createElement('span');
    hint.className = 'field-hint';

    label.append(text, input, hint);
    return { label, text, input, hint };
  }

  /** 在“宠物名称”之前插入窗口行为区块（index.html 只读，由 chat.js 动态注入） */
  function ensureWindowFeatureControls() {
    if (windowFeatureEls.block || !elements.petName || !hasWindowApi()) {
      return;
    }
    const anchor = elements.petName.closest('.field');
    if (!anchor || !anchor.parentNode) {
      return;
    }

    const block = document.createElement('div');
    block.className = 'field';
    block.id = 'window-feature-block';
    const title = document.createElement('span');
    title.className = 'field-label';
    block.appendChild(title);

    const dock = makeWindowFeatureSwitch('dock', 'dock-enabled');
    const shortcut = makeWindowFeatureSwitch('shortcut', 'shortcut-enabled');
    block.append(dock.label, shortcut.label);
    anchor.parentNode.insertBefore(block, anchor);

    windowFeatureEls = {
      block,
      title,
      dockText: dock.text,
      dockCheckbox: dock.input,
      dockHint: dock.hint,
      shortcutText: shortcut.text,
      shortcutCheckbox: shortcut.input,
      shortcutHint: shortcut.hint
    };

    windowFeatureEls.dockCheckbox.addEventListener('change', () => {
      void toggleWindowDock();
    });
    windowFeatureEls.shortcutCheckbox.addEventListener('change', () => {
      void toggleWindowShortcut();
    });

    applyWindowFeatureSettings(currentSettings);
    updateWindowFeatureText();
  }

  function windowFeatureHints() {
    return (
      WINDOW_FEATURE_HINTS[currentLocale] || WINDOW_FEATURE_HINTS['zh-CN']
    );
  }

  function updateWindowFeatureText() {
    if (!windowFeatureEls.block) {
      return;
    }
    const hints = windowFeatureHints();
    windowFeatureEls.title.textContent = hints.title;
    windowFeatureEls.dockText.textContent = hints.dockLabel;
    windowFeatureEls.dockHint.textContent = hints.dockHint;
    windowFeatureEls.shortcutText.textContent = hints.shortcutLabel;
    windowFeatureEls.shortcutHint.textContent = hints.shortcutHint;
  }

  /** 从主进程设置同步开关状态（缺省开启，与 store.js DEFAULT_SETTINGS 一致） */
  function applyWindowFeatureSettings(settings) {
    if (!windowFeatureEls.block) {
      return;
    }
    windowFeatureEls.dockCheckbox.checked =
      !settings || settings.dockEnabled !== false;
    windowFeatureEls.shortcutCheckbox.checked =
      !settings || settings.shortcutEnabled !== false;
  }

  async function toggleWindowDock() {
    const api =
      window.petAPI &&
      window.petAPI.window &&
      typeof window.petAPI.window.toggleDock === 'function'
        ? window.petAPI.window
        : null;
    if (!api) {
      applyWindowFeatureSettings(currentSettings);
      return;
    }
    try {
      const result = await api.toggleDock();
      if (result && typeof result.docked === 'boolean') {
        windowFeatureEls.dockCheckbox.checked = result.docked;
        currentSettings = { ...currentSettings, dockEnabled: result.docked };
      } else {
        applyWindowFeatureSettings(currentSettings);
      }
    } catch (error) {
      console.warn('切换贴边隐藏失败：', error);
      applyWindowFeatureSettings(currentSettings);
    }
  }

  async function toggleWindowShortcut() {
    const api =
      window.petAPI &&
      window.petAPI.window &&
      typeof window.petAPI.window.setShortcutEnabled === 'function'
        ? window.petAPI.window
        : null;
    if (!api) {
      applyWindowFeatureSettings(currentSettings);
      return;
    }
    const requested = windowFeatureEls.shortcutCheckbox.checked;
    try {
      const result = await api.setShortcutEnabled(requested);
      if (result && typeof result.enabled === 'boolean') {
        windowFeatureEls.shortcutCheckbox.checked = result.enabled;
        currentSettings = {
          ...currentSettings,
          shortcutEnabled: result.enabled
        };
        const hints = windowFeatureHints();
        showSettingsStatus(
          requested && !result.enabled
            ? hints.shortcutUnavailable
            : hints.shortcutChanged,
          requested && !result.enabled ? 'error' : 'ok'
        );
      } else {
        applyWindowFeatureSettings(currentSettings);
      }
    } catch (error) {
      console.warn('切换全局快捷键失败：', error);
      applyWindowFeatureSettings(currentSettings);
    }
  }

  function bindEvents() {
    elements.chatForm.addEventListener('submit', handleSubmit);
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.closeBtn.addEventListener('click', hideToTray);
    elements.settingsBack.addEventListener('click', showChatView);
    elements.memoryManageBtn.addEventListener('click', openMemoryView);
    elements.memoryBack.addEventListener('click', closeMemoryView);
    elements.settingsSave.addEventListener('click', saveSettings);
    elements.exportMdBtn.addEventListener('click', () => void exportConversation('markdown'));
    elements.exportJsonBtn.addEventListener('click', () => void exportConversation('json'));
    elements.clearDataBtn.addEventListener('click', handleClearData);
    elements.onboardingLanguage.addEventListener(
      'change',
      handleOnboardingLanguageChange
    );
    elements.onboardingBack.addEventListener('click', () =>
      showOnboardingStep(onboardingStep - 1)
    );
    elements.onboardingNext.addEventListener('click', () =>
      showOnboardingStep(onboardingStep + 1)
    );
    elements.onboardingFinish.addEventListener('click', () => void finishOnboarding());
    elements.widgetsToggle.addEventListener('click', () => void toggleWidgets());
    elements.pomodoroStart.addEventListener('click', () => startPomodoro());
    elements.pomodoroReset.addEventListener('click', resetPomodoro);
    elements.pomodoroStop.addEventListener('click', stopPomodoro);
  }

  /**
   * T-15：窗口内任意交互（鼠标/键盘/触摸/滚动）以 5 秒节流上报主进程，
   * 主进程据此重置空闲计时——恢复交互后即停止触发。
   */
  function bindActivityEvents() {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    for (const type of events) {
      window.addEventListener(type, pokeActivity, { capture: true, passive: true });
    }
  }

  function pokeActivity() {
    const poke =
      window.petAPI && window.petAPI.idle && window.petAPI.idle.poke;
    if (typeof poke !== 'function') {
      return;
    }
    const now = Date.now();
    if (now - lastActivityPokeAt < ACTIVITY_POKE_MIN_INTERVAL_MS) {
      return;
    }
    lastActivityPokeAt = now;
    poke();
  }

  /**
   * T-15：订阅主进程空闲触发事件；仅在聊天视图随机展示一条互动气泡
   * （不写入历史，也不调用 LLM）。T-21：同一通道复用为系统状态推送，
   * 以 payload.type='system-status' 区分。
   */
  function subscribeIdle() {
    const idleApi = window.petAPI && window.petAPI.idle;
    if (!idleApi || typeof idleApi.onTrigger !== 'function') {
      return;
    }
    idleApi.onTrigger((payload) => {
      if (payload && payload.type === 'system-status') {
        void applySystemStatus(payload.status);
        return;
      }
      if (!payload || elements.chatView.hidden) {
        return; // 防打扰：设置页打开时忽略本次触发
      }
      const t = window.PetLocales.createTranslator(currentLocale);
      const phrases =
        t.messages && t.messages.idle && Array.isArray(t.messages.idle.phrases)
          ? t.messages.idle.phrases
          : [];
      if (phrases.length === 0) {
        return;
      }
      const text = phrases[Math.floor(Math.random() * phrases.length)];
      appendMessage('assistant', text, 'message-idle');
    });
  }

  /* ---------------- T-21：系统状态小部件（CPU/内存/电池） ---------------- */

  function hasWidgetsPanel() {
    return Boolean(elements.widgetsPanel);
  }

  /** 渲染主进程推送的系统状态（数值刷新 + 电池状态文案 + 无障碍标签） */
  async function applySystemStatus(status) {
    if (!hasWidgetsPanel() || !status || typeof status !== 'object') {
      return;
    }
    lastSystemStatus = status;
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    const fmtPercent = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? `${Math.round(numeric)}%` : '--%';
    };
    const cpuText = fmtPercent(status.cpuPercent);
    const memText = fmtPercent(status.memPercent);
    const batteryText = fmtPercent(status.batteryPercent);
    const batteryStateKey =
      status.batteryState === 'charging'
        ? 'batteryCharging'
        : status.batteryState === 'battery'
          ? 'batteryOnBattery'
          : status.batteryState === 'unknown'
            ? 'batteryUnknown'
            : 'batteryAc';
    const batteryStateText = t(`widgets.${batteryStateKey}`);

    if (elements.statCpu) {
      elements.statCpu.textContent = cpuText;
    }
    if (elements.statMem) {
      elements.statMem.textContent = memText;
      elements.statMem.title = t('widgets.memDetail', {
        used: status.memUsedGb != null ? status.memUsedGb : '--',
        total: status.memTotalGb != null ? status.memTotalGb : '--'
      });
    }
    if (elements.statBattery) {
      elements.statBattery.textContent = batteryText;
      elements.statBattery.title = batteryStateText;
      elements.statBattery.setAttribute(
        'aria-label',
        `${batteryText} ${batteryStateText}`
      );
      elements.statBattery.dataset.batteryState = status.batteryState || 'ac';
    }
    if (elements.statBatteryState) {
      elements.statBatteryState.textContent = batteryStateText;
      elements.statBatteryState.dataset.batteryState = status.batteryState || 'ac';
    }
    if (elements.widgetStats) {
      elements.widgetStats.setAttribute(
        'aria-label',
        t('widgets.statusAria', {
          cpu: cpuText,
          mem: memText,
          battery: `${batteryText} ${batteryStateText}`
        })
      );
    }
  }

  /** 按设置显示/隐藏小部件面板（可关闭，关闭状态持久化） */
  function syncWidgetsVisibility() {
    if (!hasWidgetsPanel()) {
      return;
    }
    elements.widgetsPanel.hidden = currentSettings.widgetsEnabled === false;
  }

  /** 面板右上角 ✕：切换小部件开关并持久化 */
  async function toggleWidgets() {
    pokeActivity();
    const next = currentSettings.widgetsEnabled === false;
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function';
    const applyNext = (settings) => {
      currentSettings =
        settings && typeof settings === 'object'
          ? settings
          : { ...currentSettings, widgetsEnabled: next };
      syncWidgetsVisibility();
      if (elements.widgetsEnabled) {
        elements.widgetsEnabled.checked = currentSettings.widgetsEnabled !== false;
      }
    };
    if (!settingsApi) {
      saveLocalFallback({ ...currentSettings, widgetsEnabled: next });
      applyNext({ ...currentSettings, widgetsEnabled: next });
      return;
    }
    try {
      const saved = await window.petAPI.settings.set({ widgetsEnabled: next });
      applyNext(saved || { ...currentSettings, widgetsEnabled: next });
    } catch (error) {
      console.warn('切换小部件失败：', error);
      applyNext(currentSettings);
    }
  }

  /* ---------------- T-21：本地番茄钟（计时 + 主进程 Notification） ---------------- */

  function pomodoroMinutesFromSettings(settings) {
    const numeric = Number(settings && settings.pomodoroMinutes);
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 120
      ? Math.round(numeric)
      : DEFAULT_POMODORO_MINUTES;
  }

  function pomodoroDurationMs(settings) {
    return pomodoroMinutesFromSettings(settings) * 60 * 1000;
  }

  function formatPomodoroTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function updatePomodoroDisplay() {
    if (!elements.pomodoroTime) {
      return;
    }
    const text = formatPomodoroTime(pomodoroState.remainingMs);
    elements.pomodoroTime.textContent = text;
    elements.pomodoroTime.setAttribute(
      'aria-label',
      window.PetLocales.createTranslator(currentLocale)('pomodoro.remainingAria', {
        time: text
      })
    );
  }

  function updatePomodoroControls() {
    if (!elements.pomodoroStart) {
      return;
    }
    const t = window.PetLocales.createTranslator(currentLocale);
    const label =
      pomodoroState.mode === 'running'
        ? t('pomodoro.pause')
        : pomodoroState.mode === 'paused'
          ? t('pomodoro.resume')
          : t('pomodoro.start');
    if (elements.pomodoroStart.textContent !== label) {
      elements.pomodoroStart.textContent = label;
      elements.pomodoroStart.setAttribute('aria-label', label);
    }
  }

  function clearPomodoroTimer() {
    if (pomodoroState.timerId != null) {
      clearInterval(pomodoroState.timerId);
      pomodoroState.timerId = null;
    }
  }

  function showPomodoroStatus(text, type) {
    if (!elements.pomodoroStatus) {
      return;
    }
    elements.pomodoroStatus.textContent = text;
    elements.pomodoroStatus.dataset.type = type || 'ok';
    elements.pomodoroStatus.hidden = false;
    clearTimeout(pomodoroStatusTimer);
    pomodoroStatusTimer = setTimeout(() => {
      if (elements.pomodoroStatus) {
        elements.pomodoroStatus.hidden = true;
      }
    }, 6000);
  }

  function hidePomodoroStatus() {
    clearTimeout(pomodoroStatusTimer);
    if (elements.pomodoroStatus) {
      elements.pomodoroStatus.hidden = true;
    }
  }

  function resetPomodoro() {
    clearPomodoroTimer();
    pomodoroState.mode = 'idle';
    pomodoroState.remainingMs = pomodoroState.durationMs;
    pomodoroState.endsAt = 0;
    hidePomodoroStatus();
    updatePomodoroDisplay();
    updatePomodoroControls();
  }

  /** 停止并复位到初始状态（“可关闭”语义之一） */
  function stopPomodoro() {
    resetPomodoro();
  }

  function tickPomodoro() {
    const remaining = pomodoroState.endsAt - Date.now();
    if (remaining <= 0) {
      finishPomodoro();
      return;
    }
    pomodoroState.remainingMs = remaining;
    updatePomodoroDisplay();
  }

  /**
   * 开始/暂停/继续番茄钟。minutesOverride 仅供测试与快捷入口使用；
   * 正常运行使用设置中的 pomodoroMinutes。
   */
  function startPomodoro(minutesOverride) {
    pokeActivity();
    if (pomodoroState.mode === 'running') {
      pausePomodoro();
      return;
    }
    if (pomodoroState.mode === 'paused') {
      resumePomodoro();
      return;
    }
    const override = Number(minutesOverride);
    if (Number.isFinite(override) && override > 0) {
      // 允许小数分钟（如 0.02 ≈ 1.2 秒）便于快捷入口与自动化验证；
      // 正常运行时长来自设置中的整数分钟。
      const minutes = Math.min(120, Math.max(1 / 60, override));
      pomodoroState.durationMs = minutes * 60 * 1000;
      pomodoroState.remainingMs = pomodoroState.durationMs;
    } else {
      pomodoroState.durationMs = pomodoroDurationMs(currentSettings);
      pomodoroState.remainingMs = pomodoroState.durationMs;
    }
    hidePomodoroStatus();
    pomodoroState.mode = 'running';
    pomodoroState.endsAt = Date.now() + pomodoroState.remainingMs;
    pomodoroState.timerId = setInterval(tickPomodoro, POMODORO_TICK_MS);
    updatePomodoroDisplay();
    updatePomodoroControls();
  }

  function pausePomodoro() {
    if (pomodoroState.mode !== 'running') {
      return;
    }
    pomodoroState.remainingMs = Math.max(0, pomodoroState.endsAt - Date.now());
    clearPomodoroTimer();
    pomodoroState.mode = 'paused';
    pomodoroState.endsAt = 0;
    updatePomodoroDisplay();
    updatePomodoroControls();
  }

  function resumePomodoro() {
    if (pomodoroState.mode !== 'paused') {
      return;
    }
    pomodoroState.mode = 'running';
    pomodoroState.endsAt = Date.now() + pomodoroState.remainingMs;
    pomodoroState.timerId = setInterval(tickPomodoro, POMODORO_TICK_MS);
    updatePomodoroControls();
  }

  /** 计时结束：界面提示 + 写入 settings 通知信号，由主进程弹系统通知 */
  function finishPomodoro() {
    clearPomodoroTimer();
    pomodoroState.mode = 'finished';
    pomodoroState.remainingMs = 0;
    pomodoroState.endsAt = 0;
    updatePomodoroDisplay();
    updatePomodoroControls();
    const t = window.PetLocales.createTranslator(currentLocale);
    showPomodoroStatus(t('pomodoro.finished'), 'ok');
    if (currentSettings.pomodoroEnabled !== false) {
      const settingsApi =
        window.petAPI &&
        window.petAPI.settings &&
        typeof window.petAPI.settings.set === 'function';
      if (settingsApi) {
        try {
          void window.petAPI.settings
            .set({
              pomodoroNotifyAt: Date.now(),
              pomodoroNotifyMinutes: pomodoroMinutesFromSettings(currentSettings)
            })
            .catch((error) => {
              console.warn('上报番茄钟完成信号失败：', error);
            });
        } catch (error) {
          console.warn('上报番茄钟完成信号失败：', error);
        }
      }
    }
  }

  /** 设置变化时同步番茄钟时长（运行中不打断当前倒计时） */
  function applyPomodoroSettings(settings) {
    const nextDuration = pomodoroDurationMs(settings);
    pomodoroState.durationMs = nextDuration;
    if (pomodoroState.mode === 'idle' || pomodoroState.mode === 'finished') {
      pomodoroState.remainingMs = nextDuration;
    }
    updatePomodoroDisplay();
    updatePomodoroControls();
  }

  function getPomodoroState() {
    const remaining =
      pomodoroState.mode === 'running'
        ? Math.max(0, pomodoroState.endsAt - Date.now())
        : pomodoroState.remainingMs;
    return {
      mode: pomodoroState.mode,
      remainingMs: remaining,
      durationMs: pomodoroState.durationMs
    };
  }

  function hideToTray() {
    if (window.petAPI && typeof window.petAPI.window?.hide === 'function') {
      window.petAPI.window.hide();
    } else {
      // 契约缺失时兜底：直接关闭窗口（window-all-closed 会保持应用存活）
      window.close();
    }
  }

  function isChatReady() {
    return Boolean(
      window.petAPI &&
      window.petAPI.chat &&
      (typeof window.petAPI.chat.send === 'function' ||
        typeof window.petAPI.chat.sendStream === 'function')
    );
  }

  /** T-14：流式通道齐全（sendStream + onDelta）时优先使用流式 */
  function canStream() {
    return Boolean(
      window.petAPI &&
      window.petAPI.chat &&
      typeof window.petAPI.chat.sendStream === 'function' &&
      typeof window.petAPI.chat.onDelta === 'function'
    );
  }

  function renderServiceStatus() {
    const t = window.PetLocales.createTranslator(currentLocale);
    if (isChatReady()) {
      elements.serviceStatus.hidden = true;
      elements.chatInput.placeholder = t('chat.inputPlaceholder');
    } else {
      elements.serviceStatus.textContent = `⚠ ${t('chat.serviceNotReady')}`;
      elements.serviceStatus.hidden = false;
      elements.chatInput.placeholder = t('chat.serviceNotReady');
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (streaming) {
      void cancelStreaming();
      return;
    }
    pokeActivity();
    const text = elements.chatInput.value.trim();
    if (!text) {
      return;
    }
    elements.chatInput.value = '';
    appendMessage('user', text);
    void sendMessage(text);
  }

  function setStreaming(active) {
    streaming = active;
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.sendBtn.textContent = active ? t('chat.stop') : t('chat.send');
    elements.sendBtn.setAttribute('aria-label', elements.sendBtn.textContent);
  }

  async function cancelStreaming() {
    const cancelApi =
      window.petAPI &&
      window.petAPI.chat &&
      typeof window.petAPI.chat.cancelStream === 'function'
        ? window.petAPI.chat.cancelStream
        : null;
    if (!cancelApi) {
      return;
    }
    try {
      await cancelApi();
    } catch (error) {
      console.warn('取消流式回复失败：', error);
    }
  }

  async function sendMessage(text) {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    if (!isChatReady()) {
      appendMessage('assistant', t('chat.serviceNotReadyReply'));
      elements.chatInput.focus();
      return;
    }

    setStreaming(true);
    const bubble = appendMessage('assistant', t('chat.thinking'));
    let received = '';
    let unsubscribe = null;
    // T-16：等待回复期间表情呈“思考”动效；文案仍保留当前 mood，避免与
    // T-14 的“正在思考…”气泡抢占同一视觉/文案通道。
    if (elements.moodIndicator) {
      elements.moodIndicator.classList.add('is-thinking');
    }
    try {
      if (canStream()) {
        // 先订阅增量再发起请求，避免首段增量丢失
        unsubscribe = window.petAPI.chat.onDelta((delta) => {
          if (typeof delta !== 'string' || delta.length === 0) {
            return;
          }
          received += delta;
          updateBubble(bubble, received);
        });
        const result = await window.petAPI.chat.sendStream({ text });
        applyStreamResult(result, bubble, received, t);
      } else {
        // 兼容旧契约：无流式通道时走非流式发送
        const result = await window.petAPI.chat.send({ text });
        if (result && result.ok) {
          updateBubble(bubble, result.reply || t('chat.emptyReply'));
        } else {
          updateBubble(bubble, formatSendError(result, '', t));
        }
      }
    } catch (error) {
      updateBubble(
        bubble,
        t('chat.errorPrefix', {
          error: error && error.message ? error.message : String(error)
        })
      );
    } finally {
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch (_error) {
          // 取消订阅失败不影响状态恢复
        }
      }
      setStreaming(false);
      if (elements.moodIndicator) {
        elements.moodIndicator.classList.remove('is-thinking');
      }
      void refreshMood();
      elements.chatInput.focus();
    }
  }

  /** 处理流式结束结果：成功整段展示；取消展示已收到部分；失败展示部分文本 + 错误 */
  function applyStreamResult(result, bubble, received, t) {
    if (result && result.ok) {
      updateBubble(bubble, result.reply || received || t('chat.emptyReply'));
      return;
    }
    if (result && result.error === '已取消') {
      updateBubble(bubble, result.reply || received || t('chat.cancelled'));
      return;
    }
    updateBubble(bubble, formatSendError(result, received, t));
  }

  function formatSendError(result, received, t) {
    const partial = result && result.reply ? result.reply : received;
    const errorText =
      result && result.error
        ? t('chat.errorPrefix', { error: result.error })
        : t('chat.serviceNotReadyReply');
    return partial ? `${partial}\n${errorText}` : errorText;
  }

  /* T-16 情绪可视化：mood.get -> 表情/配色（ADR-022） */

  function hasMoodApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.mood &&
        typeof window.petAPI.mood.get === 'function'
    );
  }

  async function initMood() {
    if (!hasMoodApi()) {
      return;
    }
    await refreshMood();
    setInterval(refreshMood, MOOD_POLL_MS);
  }

  async function refreshMood() {
    if (!hasMoodApi()) {
      return;
    }
    try {
      const mood = await window.petAPI.mood.get();
      applyMood(mood);
    } catch (error) {
      console.warn('读取情绪失败，保持上次显示：', error);
    }
  }

  /**
   * 把 mood（label/valence/intensity）映射为角色表情与配色。
   * 使用 data 属性（data-mood-label/data-valence/data-intensity）记录原始状态，
   * 用 mood-* 类驱动 CSS 主题；保持文案对比度与 aria-live 无障碍广播。
   * 暴露给 window.ChatUI.applyMood，便于冒烟与注入假 mood 验证。
   */
  function applyMood(mood) {
    if (!elements.moodIndicator || !mood || typeof mood !== 'object') {
      return;
    }
    const valence = Number(mood.valence);
    const intensity = Number(mood.intensity);
    const label =
      typeof mood.label === 'string' && mood.label.trim() ? mood.label.trim() : '平静';
    const safeValence = Number.isFinite(valence)
      ? Math.min(100, Math.max(0, valence))
      : 60;
    const safeIntensity = Number.isFinite(intensity)
      ? Math.min(1, Math.max(0, intensity))
      : 0.35;

    const band =
      MOOD_BANDS.find((item) => safeValence >= item.min) ||
      MOOD_BANDS[MOOD_BANDS.length - 1];

    elements.moodIndicator.hidden = false;
    elements.moodIndicator.dataset.moodLabel = label;
    elements.moodIndicator.dataset.valence = String(safeValence);
    elements.moodIndicator.dataset.intensity = String(safeIntensity);

    if (elements.moodFace.textContent !== band.face) {
      elements.moodFace.textContent = band.face;
    }
    if (elements.moodLabel.textContent !== label) {
      elements.moodLabel.textContent = label;
      // 仅在文案变化时更新 aria-label，避免屏幕阅读器重复广播
      elements.moodIndicator.setAttribute('aria-label', `当前情绪：${label}`);
    }

    const bandClasses = MOOD_BANDS.map((item) => item.className);
    elements.petCard.classList.remove(...bandClasses);
    elements.petCard.classList.add(band.className);
    elements.petCard.classList.toggle('mood-intense', safeIntensity >= 0.7);
  }

  /**
   * M2：启动时通过 petAPI.history.get 恢复历史气泡（ADR-012）。
   * 接口缺失（T-05 未合入）或读取失败时优雅降级为默认问候。
   */
  async function restoreHistory() {
    const historyApi =
      window.petAPI && window.petAPI.history && typeof window.petAPI.history.get === 'function';
    if (historyApi) {
      try {
        const items = await window.petAPI.history.get();
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            if (item && (item.role === 'user' || item.role === 'assistant')) {
              appendMessage(
                item.role,
                typeof item.content === 'string' ? item.content : String(item.content ?? '')
              );
            }
          }
          return;
        }
      } catch (error) {
        console.warn('恢复历史失败，回退默认问候：', error);
      }
    }
    appendMessage(
      'assistant',
      window.PetLocales.createTranslator(currentLocale)('chat.greeting')
    );
  }

  function appendMessage(role, content, extraClass) {
    const item = document.createElement('div');
    item.className = `message message-${role}`;
    if (extraClass) {
      item.classList.add(extraClass);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;

    item.appendChild(bubble);
    if (role === 'assistant') {
      attachSpeakButton(item); // T-23：桌宠回复可朗读
    }
    elements.messageList.appendChild(item);
    messages.push({ role, content });
    scrollToBottom();
    return { item, bubble };
  }

  /** T-14：流式增量更新已有回复气泡（打字机效果） */
  function updateBubble(ref, content) {
    if (!ref || !ref.bubble) {
      return;
    }
    ref.bubble.textContent = content;
    const last = messages[messages.length - 1];
    if (last) {
      last.content = content;
    }
    scrollToBottom();
  }

  function scrollToBottom() {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }

  /* ---------------- T-23：语音输出（Web Speech Synthesis / 系统 TTS） ---------------- */

  function ttsEnabled() {
    return Boolean(window.speechSynthesis && ttsReady);
  }

  function ttsHints() {
    return TTS_HINTS[currentLocale] || TTS_HINTS['zh-CN'];
  }

  /** 语音列表异步加载：voiceschanged 可能先于列表就绪，做多次兜底刷新 */
  function initTts() {
    if (
      typeof window.speechSynthesis === 'undefined' ||
      typeof window.SpeechSynthesisUtterance !== 'function'
    ) {
      ttsReady = false;
      return;
    }
    const refreshVoices = () => {
      let voices = [];
      try {
        voices = window.speechSynthesis.getVoices() || [];
      } catch (_error) {
        voices = [];
      }
      const seen = new Set();
      ttsVoices = voices.filter((voice) => {
        if (!voice || typeof voice.lang !== 'string') {
          return false;
        }
        const key = `${voice.name}|${voice.lang}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      ttsReady = ttsVoices.length > 0;
      if (ttsReady) {
        updateAllSpeakButtons();
      }
    };
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    refreshVoices();
    setTimeout(refreshVoices, 500);
    setTimeout(refreshVoices, 2000);
  }

  /** 按当前界面语言选系统语音（zh 优先 Huihui 类中文语音，en 优先英文语音） */
  function pickTtsVoice() {
    const preferred = currentLocale === 'en' ? /^en/i : /^zh/i;
    return (
      ttsVoices.find((voice) => preferred.test(voice.lang || '')) ||
      ttsVoices[0] ||
      null
    );
  }

  function updateSpeakButtonState(button, speaking) {
    const hints = ttsHints();
    button.textContent = speaking ? '⏹' : '🔊';
    button.title = speaking ? hints.stop : hints.speak;
    button.setAttribute('aria-label', speaking ? hints.stop : hints.speak);
  }

  function updateSpeakButtonVisibility(button) {
    button.hidden = !ttsEnabled();
  }

  function updateAllSpeakButtons() {
    document.querySelectorAll('.message-assistant .speak-btn').forEach((button) => {
      updateSpeakButtonState(button, false);
      updateSpeakButtonVisibility(button);
    });
    if (!ttsEnabled()) {
      stopSpeaking();
    }
  }

  function attachSpeakButton(item) {
    if (!item || item.dataset.speakAttached) {
      return;
    }
    item.dataset.speakAttached = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn speak-btn';
    button.style.flex = '0 0 auto';
    button.style.alignSelf = 'flex-end';
    button.style.marginLeft = '6px';
    button.style.width = '24px';
    button.style.height = '24px';
    button.style.fontSize = '12px';
    button.style.padding = '0';
    button.style.borderRadius = '50%';
    button.addEventListener('click', () => toggleSpeak(button));
    item.appendChild(button);
    updateSpeakButtonState(button, false);
    updateSpeakButtonVisibility(button);
  }

  function clearSpeakingState(button) {
    if (currentSpeakButton === button) {
      currentSpeakButton = null;
      currentUtterance = null;
    }
    updateSpeakButtonState(button, false);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_error) {
        // 取消失败不影响状态恢复
      }
    }
    currentUtterance = null;
    const button = currentSpeakButton;
    currentSpeakButton = null;
    if (button) {
      updateSpeakButtonState(button, false);
    }
  }

  function toggleSpeak(button) {
    if (!ttsEnabled()) {
      return;
    }
    if (currentUtterance && currentSpeakButton === button) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    const messageEl = button.closest('.message');
    const bubble = messageEl && messageEl.querySelector('.bubble');
    const text = bubble ? bubble.textContent.trim() : '';
    if (!text) {
      return;
    }
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickTtsVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = currentLocale === 'en' ? 'en-US' : 'zh-CN';
    }
    utter.rate = 1;
    utter.onend = () => clearSpeakingState(button);
    utter.onerror = () => clearSpeakingState(button);
    currentUtterance = utter;
    currentSpeakButton = button;
    synth.cancel();
    synth.speak(utter);
    updateSpeakButtonState(button, true);
  }

  /* 设置页 */
  function showSettingsView() {
    elements.chatView.hidden = true;
    elements.settingsView.hidden = false;
    elements.settingsHome.hidden = false;
    elements.memoryPage.hidden = true;
    elements.settingsBack.focus();
  }

  function showChatView() {
    elements.settingsView.hidden = true;
    elements.memoryPage.hidden = true;
    elements.settingsHome.hidden = false;
    elements.chatView.hidden = false;
    elements.chatInput.focus();
  }

  /* 记忆管理子页（T-17） */
  function isMemoryReady() {
    return Boolean(
      window.petAPI &&
      window.petAPI.memory &&
      typeof window.petAPI.memory.list === 'function' &&
      typeof window.petAPI.memory.delete === 'function' &&
      typeof window.petAPI.memory.update === 'function'
    );
  }

  async function openMemoryView() {
    elements.settingsHome.hidden = true;
    elements.memoryPage.hidden = false;
    elements.memoryBack.focus();
    await loadMemories();
  }

  function closeMemoryView() {
    elements.memoryPage.hidden = true;
    elements.settingsHome.hidden = false;
    elements.settingsBack.focus();
  }

  async function loadMemories() {
    const t = window.PetLocales.createTranslator(currentLocale);
    showMemoryStatus('', 'ok', true);
    elements.memoryList.textContent = '';
    if (!isMemoryReady()) {
      elements.memoryEmpty.hidden = false;
      elements.memoryEmpty.textContent = t('settings.memoryUnavailable');
      return;
    }
    try {
      const items = await window.petAPI.memory.list();
      memoryItems = Array.isArray(items) ? items : [];
      renderMemoryList();
    } catch (error) {
      console.warn('加载记忆失败：', error);
      elements.memoryEmpty.hidden = true;
      showMemoryStatus(
        t('settings.memoryListError', { error: formatErrorMessage(error) }),
        'error'
      );
    }
  }

  function renderMemoryList() {
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.memoryList.textContent = '';
    elements.memoryEmpty.hidden = memoryItems.length > 0;
    if (memoryItems.length === 0) {
      return;
    }

    for (const item of memoryItems) {
      const card = document.createElement('div');
      card.className = 'memory-card';
      card.dataset.id = item.id;

      const content = document.createElement('div');
      content.className = 'memory-content';
      content.textContent = item.content || '';

      const textarea = document.createElement('textarea');
      textarea.className = 'field-input field-textarea memory-edit-input';
      textarea.maxLength = 500;
      textarea.hidden = true;

      const meta = document.createElement('div');
      meta.className = 'memory-meta';
      meta.textContent = item.updatedAt
        ? t('settings.memoryUpdatedAt', { time: formatMemoryTime(item.updatedAt) })
        : '';

      const actions = document.createElement('div');
      actions.className = 'memory-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'memory-btn';
      editBtn.textContent = t('settings.memoryEdit');
      editBtn.addEventListener('click', () =>
        startEditMemory(card, content, textarea, actions, item, editBtn, deleteBtn)
      );

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'memory-btn memory-btn-danger';
      deleteBtn.textContent = t('settings.memoryDelete');
      deleteBtn.addEventListener('click', () => deleteMemoryItem(item.id));

      actions.append(editBtn, deleteBtn);
      card.append(content, textarea, meta, actions);
      elements.memoryList.appendChild(card);
    }
  }

  function startEditMemory(card, contentEl, textareaEl, actionsEl, item, editBtn, deleteBtn) {
    const t = window.PetLocales.createTranslator(currentLocale);
    contentEl.hidden = true;
    textareaEl.value = item.content || '';
    textareaEl.hidden = false;
    textareaEl.focus();

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'memory-btn memory-btn-primary';
    saveBtn.textContent = t('settings.memorySave');

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'memory-btn';
    cancelBtn.textContent = t('settings.memoryCancel');

    function restore() {
      contentEl.hidden = false;
      textareaEl.hidden = true;
      actionsEl.replaceChildren(editBtn, deleteBtn);
    }

    cancelBtn.addEventListener('click', restore);
    saveBtn.addEventListener('click', () => {
      void saveMemoryEdit(card, item.id, textareaEl.value, restore);
    });
    actionsEl.replaceChildren(saveBtn, cancelBtn);
  }

  async function saveMemoryEdit(card, id, rawValue, restore) {
    const t = window.PetLocales.createTranslator(currentLocale);
    const content = rawValue.trim();
    if (!content) {
      showMemoryStatus(t('settings.memoryEmptyContent'), 'error');
      return;
    }
    try {
      const result = await window.petAPI.memory.update(id, { content });
      if (result && result.ok && result.item) {
        const index = memoryItems.findIndex((item) => item.id === id);
        if (index >= 0) {
          memoryItems[index] = result.item;
        }
        restore();
        showMemoryStatus(t('settings.memoryUpdateSuccess'), 'ok');
        renderMemoryList();
      } else {
        restore();
        showMemoryStatus(
          t('settings.memoryUpdateError', {
            error: memoryErrorMessage(result && result.error, t)
          }),
          'error'
        );
      }
    } catch (error) {
      restore();
      showMemoryStatus(
        t('settings.memoryUpdateError', { error: formatErrorMessage(error) }),
        'error'
      );
    }
  }

  async function deleteMemoryItem(id) {
    const t = window.PetLocales.createTranslator(currentLocale);
    try {
      const result = await window.petAPI.memory.delete(id);
      if (result && result.ok) {
        memoryItems = memoryItems.filter((item) => item.id !== id);
        showMemoryStatus(t('settings.memoryDeleteSuccess'), 'ok');
        renderMemoryList();
      } else {
        showMemoryStatus(
          t('settings.memoryDeleteError', {
            error: memoryErrorMessage(result && result.error, t)
          }),
          'error'
        );
      }
    } catch (error) {
      showMemoryStatus(
        t('settings.memoryDeleteError', { error: formatErrorMessage(error) }),
        'error'
      );
    }
  }

  function memoryErrorMessage(error, t) {
    if (error === 'memory-not-found') {
      return t('settings.memoryNotFound');
    }
    if (error === 'memory-empty-content') {
      return t('settings.memoryEmptyContent');
    }
    if (error === 'memory-invalid-id') {
      return t('settings.memoryInvalidId');
    }
    return typeof error === 'string' && error ? error : String(error || '');
  }

  function formatErrorMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  function formatMemoryTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return '';
    }
    const locale = currentLocale === 'zh-CN' ? 'zh-CN' : 'en-US';
    try {
      return new Date(timestamp).toLocaleString(locale);
    } catch (_error) {
      return new Date(timestamp).toLocaleString();
    }
  }

  function showMemoryStatus(text, type, hide) {
    elements.memoryStatus.textContent = text;
    elements.memoryStatus.dataset.type = type || 'ok';
    elements.memoryStatus.hidden = Boolean(hide);
    clearTimeout(showMemoryStatus._timer);
    if (hide) {
      return;
    }
    showMemoryStatus._timer = setTimeout(() => {
      elements.memoryStatus.hidden = true;
    }, 4000);
  }

  /**
   * 启动时读取设置：优先 petAPI.settings.get（主进程 settings.json）；
   * petAPI 缺失时降级读取 localStorage（仅此路径，ADR-013）。
   */
  async function restoreSettings() {
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.get === 'function';
    if (!settingsApi) {
      restoreLocalFallback();
      return;
    }
    try {
      const settings = await window.petAPI.settings.get();
      applySettings(settings);
    } catch (error) {
      console.warn('读取主进程设置失败，使用默认值：', error);
      applySettings({});
    }
  }

  /** petAPI 缺失时的 localStorage 降级读取（旧版本数据兼容） */
  function restoreLocalFallback() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      applySettings({
        petName: saved.petName,
        apiKey: saved.apiKey,
        model: saved.model,
        persona: saved.persona,
        language: saved.language,
        idleEnabled: saved.idleEnabled !== false,
        widgetsEnabled: saved.widgetsEnabled !== false,
        pomodoroEnabled: saved.pomodoroEnabled !== false,
        pomodoroMinutes: Number(saved.pomodoroMinutes) || DEFAULT_POMODORO_MINUTES
      });
    } catch (_error) {
      // 本地设置损坏时静默回退默认值
    }
  }

  /** 计算生效语言：显式选择优先，'system'（或缺省）跟随系统语言 */
  function resolveEffectiveLocale(language) {
    if (language && language !== 'system') {
      return window.PetLocales.resolveLocale(language);
    }
    return window.PetLocales.resolveLocale(
      (typeof navigator !== 'undefined' && navigator.language) ||
        window.PetLocales.DEFAULT_LOCALE
    );
  }

  /** 应用静态文案（data-i18n 标记、语言属性、标题、meta、服务状态、宠物名标题） */
  function applyStaticText() {
    const t = window.PetLocales.createTranslator(currentLocale);
    document.documentElement.lang = currentLocale;
    document.title = t('app.name');

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });

    elements.headerTitle.textContent = currentPetName;
    renderServiceStatus();
    applyMeta();
    applyOnboardingText(); // T-20：引导与人格模板静态文案（内联双语）
  }

  /** 底部 meta（平台/版本）；renderer.js 先行写入中文，这里按当前语言覆盖 */
  function applyMeta() {
    const meta = document.getElementById('meta');
    if (meta && window.petAPI) {
      meta.textContent = window.PetLocales.createTranslator(currentLocale)(
        'meta.platformVersion',
        {
          platform: window.petAPI.platform,
          version: window.petAPI.version
        }
      );
    }
  }

  /** 将设置应用到表单与标题（缺失字段回退默认值） */
  function applySettings(settings) {
    currentSettings = settings && typeof settings === 'object' ? settings : {};
    const language =
      typeof currentSettings.language === 'string'
        ? currentSettings.language
        : DEFAULT_LANGUAGE;
    elements.language.value = language;
    currentLocale = resolveEffectiveLocale(language);
    const t = window.PetLocales.createTranslator(currentLocale);

    elements.apiKey.value =
      typeof currentSettings.apiKey === 'string' ? currentSettings.apiKey : '';
    elements.model.value =
      typeof currentSettings.model === 'string' && currentSettings.model.trim()
        ? currentSettings.model.trim()
        : DEFAULT_MODEL;

    currentPetName =
      typeof currentSettings.petName === 'string' &&
      currentSettings.petName.trim()
        ? currentSettings.petName.trim()
        : t('app.defaultPetName');
    elements.petName.value = currentPetName;
    elements.idleEnabled.checked = currentSettings.idleEnabled !== false;
    elements.widgetsEnabled.checked = currentSettings.widgetsEnabled !== false;
    elements.pomodoroEnabled.checked = currentSettings.pomodoroEnabled !== false;
    elements.pomodoroMinutes.value = String(
      pomodoroMinutesFromSettings(currentSettings)
    );
    applyPomodoroSettings(currentSettings);
    syncWidgetsVisibility();

    const persona =
      currentSettings.persona && typeof currentSettings.persona === 'object'
        ? currentSettings.persona
        : {};
    const traits = Array.isArray(persona.traits) ? persona.traits : [];
    elements.personaTraits.value = traits.join(t('settings.traitsDelimiter'));
    elements.personaTone.value = typeof persona.tone === 'string' ? persona.tone : '';
    elements.personaBackstory.value =
      typeof persona.backstory === 'string' ? persona.backstory : '';
    renderPersonaTemplates(); // T-20：刷新设置页模板选中态

    applyStaticText();
    updatePomodoroControls(); // T-21：applyStaticText 会重置按钮静态文案，需按状态覆盖
    if (lastSystemStatus) {
      void applySystemStatus(lastSystemStatus); // T-21：语言切换后按新语言重渲染状态文案
    }
    applyWindowFeatureSettings(currentSettings); // T-19
    updateWindowFeatureText(); // T-19: 语言切换后刷新提示文案
    syncOnboardingVisibility(); // T-20：首次启动引导（完成标志持久化）
    stopSpeaking(); // T-23: 语言切换后停止当前朗读，并刷新按钮文案
    updateAllSpeakButtons();
    if (elements.memoryPage && !elements.memoryPage.hidden) {
      renderMemoryList();
    }
  }

  /** 保存设置：优先 petAPI.settings.set；petAPI 缺失时降级 localStorage */
  async function saveSettings() {
    pokeActivity();
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    const petName = elements.petName.value.trim() || t('app.defaultPetName');
    elements.petName.value = petName;
    const apiKey = elements.apiKey.value.trim();
    const model = elements.model.value.trim() || DEFAULT_MODEL;
    elements.model.value = model;
    const language = elements.language.value || DEFAULT_LANGUAGE;
    const traits = elements.personaTraits.value
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const persona = {
      traits,
      tone: elements.personaTone.value.trim(),
      backstory: elements.personaBackstory.value.trim()
    };
    // T-20：人格与某套预设模板一致时保留模板 id，手动微调后标记为自定义
    const personaTemplate = currentTemplateId({ persona }) || '';

    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function';
    if (!settingsApi) {
      saveLocalFallback({
        petName,
        apiKey,
        model,
        persona,
        language,
        idleEnabled: elements.idleEnabled.checked,
        personaTemplate,
        widgetsEnabled: elements.widgetsEnabled.checked,
        pomodoroEnabled: elements.pomodoroEnabled.checked,
        pomodoroMinutes: Number(elements.pomodoroMinutes.value)
      });
      showSettingsStatus(t('settings.savedLocalFallback'), 'ok');
      return;
    }

    elements.settingsSave.disabled = true;
    try {
      const saved = await window.petAPI.settings.set({
        petName,
        apiKey,
        model,
        persona,
        language,
        idleEnabled: elements.idleEnabled.checked,
        personaTemplate,
        widgetsEnabled: elements.widgetsEnabled.checked,
        pomodoroEnabled: elements.pomodoroEnabled.checked,
        pomodoroMinutes: Number(elements.pomodoroMinutes.value)
      });
      // 回填清洗后的规范值，保证表单与持久化一致
      applySettings(saved || { petName, persona, language });
      const afterSave = window.PetLocales.createTranslator(currentLocale);
      showSettingsStatus(afterSave('settings.saved'), 'ok');
    } catch (error) {
      console.warn('保存设置失败：', error);
      showSettingsStatus(
        t('settings.saveError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.settingsSave.disabled = false;
    }
  }

  /** petAPI 缺失时的 localStorage 降级保存 */
  function saveLocalFallback(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_error) {
      // 存储不可用时仅保持本次会话生效
    }
  }

  function showSettingsStatus(text, type) {
    elements.settingsStatus.textContent = text;
    elements.settingsStatus.dataset.type = type || 'ok';
    elements.settingsStatus.hidden = false;
    clearTimeout(showSettingsStatus._timer);
    showSettingsStatus._timer = setTimeout(() => {
      elements.settingsStatus.hidden = true;
    }, 4000);
  }

  /** 为指定状态元素创建带自动隐藏的提示函数 */
  function makeStatusShower(element) {
    let timer = null;
    return (text, type) => {
      element.textContent = text;
      element.dataset.type = type || 'ok';
      element.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        element.hidden = true;
      }, 5000);
    };
  }

  /* ---------------- T-20：预设人格模板（设置页一键切换 + 首次引导） ---------------- */

  /** 当前语言下的预设人格模板表：{ id: { name, description, persona } }（双语内联） */
  function getPersonaTemplates() {
    return PERSONA_TEMPLATES[currentLocale] || PERSONA_TEMPLATES['zh-CN'];
  }

  /** 内联双语文案查询（含 {param} 插值），与 locale 文件无关 */
  function onboardingText(key, params) {
    const table = ONBOARDING_TEXTS[currentLocale] || ONBOARDING_TEXTS['zh-CN'];
    let text = table[key];
    if (typeof text !== 'string') {
      return key;
    }
    if (!params || typeof params !== 'object') {
      return text;
    }
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      params[name] != null ? String(params[name]) : match
    );
  }

  /** T-20：引导与人格模板静态文案（不依赖 locale 文件，语言切换时随 applyStaticText 刷新） */
  function applyOnboardingText() {
    if (!elements.onboardingView) {
      return;
    }
    const text = (key, params) => onboardingText(key, params);
    elements.onboardingTitle.textContent = text('title');
    elements.onboardingSubtitle.textContent = text('subtitle');
    elements.onboardingProgress.setAttribute('aria-label', text('progressAria'));
    elements.onboardingProgress1.textContent = text('step1');
    elements.onboardingProgress2.textContent = text('step2');
    elements.onboardingProgress3.textContent = text('step3');
    elements.onboardingLanguageHint.textContent = text('languageHint');
    elements.onboardingModelHint.textContent = text('modelHint');
    elements.onboardingStep3Hint.textContent = text('templateHint');
    elements.onboardingPreviewTitle.textContent = text('templatePreview');
    elements.onboardingBack.textContent = text('back');
    elements.onboardingNext.textContent = text('next');
    elements.onboardingFinish.textContent = text('finish');
    elements.personaTemplateLabel.textContent = text('personaTemplates');
    elements.personaTemplateHint.textContent = text('personaTemplatesHint');
    elements.personaTemplateList.setAttribute(
      'aria-label',
      text('personaTemplates')
    );
    elements.onboardingTemplateList.setAttribute(
      'aria-label',
      text('personaTemplates')
    );
  }

  function getTemplateById(id) {
    if (typeof id !== 'string' || !id) {
      return null;
    }
    return getPersonaTemplates()[id] || null;
  }

  /** 返回模板数组（6 套：warm/sage/playful/gentle/cool/curious） */
  function templateList() {
    const templates = getPersonaTemplates();
    return Object.keys(templates).map((id) => ({ id, ...templates[id] }));
  }

  function firstTemplateId() {
    const list = templateList();
    return list.length > 0 ? list[0].id : '';
  }

  /** persona 与模板内容是否一致（字段与顺序均需相同，T-20） */
  function personaMatchesTemplate(persona, template) {
    if (!persona || !template || !template.persona) {
      return false;
    }
    const expected = template.persona;
    const traitsMatch =
      Array.isArray(persona.traits) &&
      Array.isArray(expected.traits) &&
      persona.traits.length === expected.traits.length &&
      persona.traits.every((item, index) => item === expected.traits[index]);
    return (
      traitsMatch &&
      persona.tone === expected.tone &&
      persona.backstory === expected.backstory
    );
  }

  /** 计算当前生效的模板 id：优先 settings.personaTemplate，其次按内容匹配 */
  function currentTemplateId(settings) {
    const savedId = settings && settings.personaTemplate;
    if (savedId && getTemplateById(savedId)) {
      return savedId;
    }
    const persona = settings && settings.persona;
    for (const item of templateList()) {
      if (personaMatchesTemplate(persona, item)) {
        return item.id;
      }
    }
    return '';
  }

  /** 通用模板卡片渲染：供设置页与引导第 3 步复用 */
  function renderTemplateCards(container, options) {
    const items = templateList();
    const selectedId = options && options.selectedId ? options.selectedId : '';
    const onSelect =
      options && typeof options.onSelect === 'function'
        ? options.onSelect
        : () => {};
    container.textContent = '';
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'memory-empty';
      empty.textContent = onboardingText('templateEmpty');
      container.appendChild(empty);
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-card';
      button.dataset.templateId = item.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', item.id === selectedId ? 'true' : 'false');
      if (item.id === selectedId) {
        button.classList.add('selected');
      }

      const name = document.createElement('span');
      name.className = 'template-name';
      name.textContent = item.name || item.id;

      const desc = document.createElement('span');
      desc.className = 'template-desc';
      desc.textContent = item.description || '';

      const traits = document.createElement('span');
      traits.className = 'template-traits';
      const persona = item.persona || {};
      traits.textContent = Array.isArray(persona.traits)
        ? persona.traits.join(' · ')
        : '';

      button.append(name, desc, traits);
      button.addEventListener('click', () => onSelect(item.id));
      container.appendChild(button);
    }
  }

  /** 设置页人格模板区：点击卡片立即保存并生效 */
  function renderPersonaTemplates() {
    if (!elements.personaTemplateList) {
      return;
    }
    renderTemplateCards(elements.personaTemplateList, {
      selectedId: currentTemplateId(currentSettings),
      onSelect: (id) => void applyPersonaTemplate(id)
    });
  }

  /** 一键应用模板：persona + personaTemplate 立即写入设置并持久化 */
  async function applyPersonaTemplate(id) {
    pokeActivity();
    await window.PetLocales.ready;
    const template = getTemplateById(id);
    if (!template || !template.persona) {
      renderPersonaTemplates();
      return;
    }
    const persona = {
      traits: Array.isArray(template.persona.traits)
        ? template.persona.traits.slice()
        : [],
      tone:
        typeof template.persona.tone === 'string' ? template.persona.tone : '',
      backstory:
        typeof template.persona.backstory === 'string'
          ? template.persona.backstory
          : ''
    };
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function';
    if (!settingsApi) {
      const next = { ...currentSettings, persona, personaTemplate: id };
      saveLocalFallback(next);
      applySettings(next);
      showSettingsStatus(
        onboardingText('personaTemplateApplied', { name: template.name || id }),
        'ok'
      );
      return;
    }
    try {
      const saved = await window.petAPI.settings.set({
        persona,
        personaTemplate: id
      });
      applySettings(saved || { ...currentSettings, persona, personaTemplate: id });
      showSettingsStatus(
        onboardingText('personaTemplateApplied', { name: template.name || id }),
        'ok'
      );
    } catch (error) {
      console.warn('应用人格模板失败：', error);
      showSettingsStatus(
        onboardingText('personaTemplateApplyError', {
          error: formatErrorMessage(error)
        }),
        'error'
      );
      renderPersonaTemplates();
    }
  }

  /** 根据 onboardingDone 显示/隐藏首次引导覆盖层（applySettings 时统一调用） */
  function syncOnboardingVisibility() {
    if (!elements.onboardingView) {
      return;
    }
    if (currentSettings && currentSettings.onboardingDone === true) {
      hideOnboarding();
    } else {
      showOnboarding();
    }
  }

  function showOnboarding() {
    if (!elements.onboardingView || !elements.onboardingView.hidden) {
      return;
    }
    if (!selectedOnboardingTemplateId) {
      selectedOnboardingTemplateId =
        currentTemplateId(currentSettings) || firstTemplateId();
    }
    elements.onboardingLanguage.value =
      typeof currentSettings.language === 'string'
        ? currentSettings.language
        : DEFAULT_LANGUAGE;
    elements.onboardingApiKey.value =
      typeof currentSettings.apiKey === 'string' ? currentSettings.apiKey : '';
    elements.onboardingModel.value =
      typeof currentSettings.model === 'string' && currentSettings.model.trim()
        ? currentSettings.model.trim()
        : DEFAULT_MODEL;
    elements.onboardingView.hidden = false;
    elements.onboardingView.setAttribute('aria-label', onboardingText('title'));
    renderOnboardingTemplates();
    showOnboardingStep(1);
  }

  function hideOnboarding() {
    if (!elements.onboardingView) {
      return;
    }
    elements.onboardingView.hidden = true;
    clearOnboardingStatus();
  }

  /** 切换引导步骤（1/2/3），同步进度条与底部按钮 */
  function showOnboardingStep(n) {
    onboardingStep = Math.min(3, Math.max(1, Number(n) || 1));
    elements.onboardingStep1.hidden = onboardingStep !== 1;
    elements.onboardingStep2.hidden = onboardingStep !== 2;
    elements.onboardingStep3.hidden = onboardingStep !== 3;
    for (let i = 1; i <= 3; i += 1) {
      const item = elements[`onboardingProgress${i}`];
      if (!item) {
        continue;
      }
      item.classList.toggle('active', i <= onboardingStep);
      item.classList.toggle('current', i === onboardingStep);
      if (i === onboardingStep) {
        item.setAttribute('aria-current', 'step');
      } else {
        item.removeAttribute('aria-current');
      }
    }
    elements.onboardingBack.hidden = onboardingStep === 1;
    elements.onboardingNext.hidden = onboardingStep === 3;
    elements.onboardingFinish.hidden = onboardingStep !== 3;
    if (onboardingStep === 3) {
      renderOnboardingTemplates();
    }
    if (onboardingStep === 1) {
      elements.onboardingLanguage.focus();
    } else if (onboardingStep === 2) {
      elements.onboardingApiKey.focus();
    } else {
      elements.onboardingFinish.focus();
    }
  }

  /** 引导第 1 步：语言即时切换（完成时随设置一起保存） */
  function handleOnboardingLanguageChange() {
    const language = elements.onboardingLanguage.value || DEFAULT_LANGUAGE;
    currentLocale = resolveEffectiveLocale(language);
    applyStaticText();
    renderOnboardingTemplates();
  }

  function renderOnboardingTemplates() {
    if (!elements.onboardingTemplateList) {
      return;
    }
    renderTemplateCards(elements.onboardingTemplateList, {
      selectedId: selectedOnboardingTemplateId,
      onSelect: selectOnboardingTemplate
    });
    updateOnboardingTemplatePreview();
  }

  function selectOnboardingTemplate(id) {
    selectedOnboardingTemplateId = id;
    renderOnboardingTemplates();
  }

  function updateOnboardingTemplatePreview() {
    const template = getTemplateById(selectedOnboardingTemplateId);
    if (!template || !template.persona) {
      elements.onboardingTemplatePreview.hidden = true;
      return;
    }
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.onboardingTemplatePreview.hidden = false;
    elements.onboardingPreviewTraits.textContent = `${t('settings.traits')}：${
      Array.isArray(template.persona.traits)
        ? template.persona.traits.join(t('settings.traitsDelimiter'))
        : ''
    }`;
    elements.onboardingPreviewTone.textContent = `${t('settings.tone')}：${
      typeof template.persona.tone === 'string' ? template.persona.tone : ''
    }`;
    elements.onboardingPreviewBackstory.textContent = `${t(
      'settings.backstory'
    )}：${typeof template.persona.backstory === 'string' ? template.persona.backstory : ''}`;
  }

  /** 完成引导：语言/密钥/模型/模板 + onboardingDone 一次性持久化 */
  async function finishOnboarding() {
    pokeActivity();
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    const language = elements.onboardingLanguage.value || DEFAULT_LANGUAGE;
    const apiKey = elements.onboardingApiKey.value.trim();
    const model = elements.onboardingModel.value.trim() || DEFAULT_MODEL;
    elements.onboardingModel.value = model;
    const template = getTemplateById(selectedOnboardingTemplateId);
    const persona = template && template.persona
      ? {
          traits: Array.isArray(template.persona.traits)
            ? template.persona.traits.slice()
            : [],
          tone:
            typeof template.persona.tone === 'string'
              ? template.persona.tone
              : '',
          backstory:
            typeof template.persona.backstory === 'string'
              ? template.persona.backstory
              : ''
        }
      : {};
    const petName =
      typeof currentSettings.petName === 'string' &&
      currentSettings.petName.trim()
        ? currentSettings.petName.trim()
        : t('app.defaultPetName');
    const patch = {
      language,
      apiKey,
      model,
      petName,
      persona,
      personaTemplate: selectedOnboardingTemplateId || '',
      onboardingDone: true
    };
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function';
    if (!settingsApi) {
      saveLocalFallback({ ...currentSettings, ...patch });
      applySettings({ ...currentSettings, ...patch });
      hideOnboarding();
      showOnboardingStatus(onboardingText('applied'), 'ok');
      elements.chatInput.focus();
      return;
    }
    elements.onboardingFinish.disabled = true;
    try {
      const saved = await window.petAPI.settings.set(patch);
      applySettings(saved || patch);
      hideOnboarding();
      showOnboardingStatus(onboardingText('applied'), 'ok');
      elements.chatInput.focus();
    } catch (error) {
      console.warn('保存引导设置失败：', error);
      showOnboardingStatus(
        onboardingText('applyError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.onboardingFinish.disabled = false;
    }
  }

  function showOnboardingStatus(text, type) {
    elements.onboardingStatus.textContent = text;
    elements.onboardingStatus.dataset.type = type || 'ok';
    elements.onboardingStatus.hidden = false;
    clearTimeout(showOnboardingStatus._timer);
    showOnboardingStatus._timer = setTimeout(() => {
      elements.onboardingStatus.hidden = true;
    }, 4000);
  }

  function clearOnboardingStatus() {
    clearTimeout(showOnboardingStatus._timer);
    elements.onboardingStatus.hidden = true;
  }

  /**
   * T-18 导出对话：调用主进程 dialog.showSaveDialog，文件由主进程写入。
   * 取消（error === 'cancelled'）时静默回到原状态。
   */
  async function exportConversation(format) {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    const exportApi =
      window.petAPI &&
      window.petAPI.history &&
      typeof window.petAPI.history.export === 'function';
    if (!exportApi) {
      showExportStatus(
        t('data.exportError', { error: t('data.apiUnavailable') }),
        'error'
      );
      return;
    }

    elements.exportMdBtn.disabled = true;
    elements.exportJsonBtn.disabled = true;
    showExportStatus(t('data.exporting'), 'ok');
    try {
      const result = await window.petAPI.history.export({ format });
      if (result && result.ok && result.filePath) {
        showExportStatus(t('data.exportSaved', { filePath: result.filePath }), 'ok');
      } else if (result && result.error && result.error !== 'cancelled') {
        showExportStatus(t('data.exportError', { error: result.error }), 'error');
      } else {
        showExportStatus(t('data.exportCancelled'), 'ok');
      }
    } catch (error) {
      showExportStatus(
        t('data.exportError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.exportMdBtn.disabled = false;
      elements.exportJsonBtn.disabled = false;
    }
  }

  /** 清空当前聊天视图并恢复到空态问候（不写历史，仅 UI 刷新） */
  function resetChatView() {
    stopSpeaking(); // T-23: 气泡被清空时停止朗读，避免按钮随 DOM 移除后状态残留
    messages = [];
    elements.messageList.replaceChildren();
    void restoreHistory();
  }

  /**
   * T-18 清除数据：主进程弹出确认框，确认后按范围清空；
   * 聊天记录/全部被清除时刷新聊天视图，设置/全部被清除时重载设置表单。
   */
  async function handleClearData() {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    const clearApi =
      window.petAPI &&
      window.petAPI.history &&
      typeof window.petAPI.history.clear === 'function';
    if (!clearApi) {
      showClearStatus(t('data.clearError', { error: t('data.apiUnavailable') }), 'error');
      return;
    }

    const scope = elements.clearScope.value || 'all';
    elements.clearDataBtn.disabled = true;
    showClearStatus(t('data.clearing'), 'ok');
    try {
      const result = await window.petAPI.history.clear({ scope });
      if (result && result.ok) {
        if (scope === 'messages' || scope === 'all') {
          resetChatView();
        }
        if (scope === 'settings' || scope === 'all') {
          await restoreSettings();
        }
        const scopeLabel = t(`data.scope${scope[0].toUpperCase()}${scope.slice(1)}`);
        showClearStatus(t('data.clearSuccess', { scope: scopeLabel }), 'ok');
      } else if (result && result.error && result.error !== 'cancelled') {
        showClearStatus(t('data.clearError', { error: result.error }), 'error');
      } else {
        showClearStatus(t('data.clearCancelled'), 'ok');
      }
    } catch (error) {
      showClearStatus(
        t('data.clearError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.clearDataBtn.disabled = false;
    }
  }

  let showExportStatus = () => {};
  let showClearStatus = () => {};

  window.ChatUI = {
    init,
    applyMood,
    applySystemStatus, // T-21：供主进程推送状态注入/冒烟验证
    startPomodoro, // T-21：可传分钟数覆盖（测试/快捷入口）
    resetPomodoro,
    stopPomodoro,
    getPomodoroState
  };
})();

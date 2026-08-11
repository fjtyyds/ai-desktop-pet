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
 * - T-19/T-31 窗口体验：设置页注入“靠边吸附/全局快捷键”开关与提示（ADR-022/026
 *   冻结契约；贴边方案 B：靠边吸附、不自动隐藏）
 *   petAPI.window.toggleDock；提示文案为本地双语映射，不依赖 locale 文件）
 * - T-20 首次引导与人格模板：首次启动三步引导（语言 / API Key 与模型 / 人格模板），
 *   完成标志 onboardingDone 持久化；内置 6 套预设人格模板（双语内联，与 store.js
 *   PERSONA_TEMPLATE_IDS 对齐），设置页与引导中均可一键切换，切换即时保存到
 *   settings.persona 并持久化
 * - T-22 天气小部件：设置页开关 + 城市配置（weatherEnabled/weatherCity），
 *   角色面板顶部可选展示实时天气；刷新按钮与失败降级（缓存上次成功数据），
 *   数据源 Open-Meteo 无需 API Key，网络请求在主进程完成
 * - T-24 窗口布局与可缩放：天气小部件默认收起/可折叠，展开后不遮挡
 *   消息区与输入框；移除底部平台/版本信息（配合 renderer.js/index.html/locales）
 * - T-26 天气自动刷新增强：自动刷新间隔 30→15 分钟、窗口恢复显示即刷新
 *   （受最小间隔保护）、界面清楚展示“上次更新”时间、失败保留缓存并显示错误、
 *   指数退避自动重试
 * - T-21 本地番茄钟：界面计时，完成时写入 settings 通知信号（pomodoroNotifyAt），
 *   由主进程轮询消费并弹系统通知（系统状态小部件已按 T-30 移除）
 * - T-25 工具栏：导出对话从设置页移入聊天工具栏（下拉菜单），新增最小化按钮
 *   （petAPI.window.minimize → IPC window:minimize，ADR-026 冻结契约）
 * - T-33 TTS 专属语音包（按人格）：6 套预设人格各配 voice/pitch/rate，朗读时按当前
 *   生效人格自动应用；设置页可关闭（回退系统默认 TTS）或固定选择语音包
 *   （ttsVoicePackEnabled/ttsVoicePackId，协调者预确认的两个 settings 字段）
 * - T-34（ADR-029）：开启语音包时朗读优先走 petAPI.tts.speak（Edge 在线神经语音，
 *   HTMLAudioElement 播放/停止），断网/合成/播放失败自动回退 speechSynthesis，
 *   按钮不失效、不卡死；TTS_VOICE_PACKS 增加 edgeVoice/edgeRate/edgePitch 映射
 * - T-40 许可证与付费墙：设置页“账户/订阅”区块（档位/状态/有效期/云 AI 额度/
 *   激活与注销入口）；功能门控（高级神经语音、皮肤市场、专注统计/待办仅
 *   yearly/lifetime）；首次启动年龄确认 + 内容合规声明弹窗（同意后不再弹，
 *   拒绝后 AI 对话停用）；云额度不足时本地拦截并回显主进程错误
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ai-pet-settings';
  const DEFAULT_MODEL = 'deepseek-v4-flash';
  const DEFAULT_LANGUAGE = 'system';
  const ACTIVITY_POKE_MIN_INTERVAL_MS = 5000; // T-15: 交互心跳节流
  const MOOD_POLL_MS = 3000;
  const WEATHER_AUTO_REFRESH_MS = 15 * 60 * 1000; // T-26：开启时每 15 分钟自动刷新
  const WEATHER_MIN_REFRESH_GAP_MS = 30 * 1000; // T-26：自动/恢复刷新节流（手动刷新不受限）
  const WEATHER_RETRY_BASE_MS = 60 * 1000; // T-26：失败后首次自动重试间隔
  const WEATHER_RETRY_MAX_MS = 15 * 60 * 1000; // T-26：重试退避上限（不超过自动刷新间隔）
  const DEFAULT_POMODORO_MINUTES = 25; // T-21：与 store.js 默认值一致
  const POMODORO_TICK_MS = 250; // T-21：番茄钟刷新间隔
  /** T-31：设置页窗口行为区块文案（双语内联，沿用 T-19 结构，避免无意义的 locale 重构） */
  const WINDOW_FEATURE_HINTS = {
    'zh-CN': {
      title: '窗口行为',
      dockLabel: '靠边吸附',
      dockHint: '拖到屏幕边缘自动吸附对齐，不会自动隐藏；拖动离开边缘即可恢复正常位置。',
    },
    en: {
      title: 'Window behavior',
      dockLabel: 'Edge snapping',
      dockHint:
        'Drag to a screen edge to snap it in place — the window never auto-hides. Drag it away from the edge to move it freely.',
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
      templateEmpty: '暂无可用的人格模板。',
      detailTraits: '性格',
      detailTone: '语气',
      detailBackstory: '背景',
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
      templateEmpty: 'No personality templates are available.',
      detailTraits: 'Traits',
      detailTone: 'Tone',
      detailBackstory: 'Backstory',
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
  /**
   * T-33：6 套人格专属语音包（id 与 PERSONA_TEMPLATES/store.js PERSONA_TEMPLATE_IDS 对齐）。
   * voice 为“首选系统语音偏好”（lang 语言前缀 + name 名称关键词，按序匹配），
   * pitch/rate 为 Web Speech 参数（pitch 0.1~2、rate 0.1~10）。
   * edgeVoice/edgeRate/edgePitch 为 Edge 在线合成参数（T-36 v2 参数表，voice 不变）。
   * 机器没有匹配语音时回退按界面语言选系统默认语音，仅应用 pitch/rate 风格。
   */
  const TTS_VOICE_PACKS = {
    warm: {
      voice: { lang: 'zh', name: ['xiaoxiao', 'huihui', 'yaoyao'] },
      pitch: 1.05,
      rate: 0.95,
      edgeVoice: 'zh-CN-XiaoxiaoNeural',
      edgeRate: '-3%',
      edgePitch: '+1Hz'
    },
    sage: {
      voice: { lang: 'zh', name: ['yunyang', 'kangkang', 'huihui'] },
      pitch: 0.92,
      rate: 0.82,
      edgeVoice: 'zh-CN-YunyangNeural',
      edgeRate: '-5%',
      edgePitch: '-1Hz'
    },
    playful: {
      voice: { lang: 'zh', name: ['yaoyao', 'xiaoxiao', 'huihui'] },
      pitch: 1.2,
      rate: 1.15,
      edgeVoice: 'zh-CN-YunxiNeural',
      edgeRate: '+6%',
      edgePitch: '+3Hz'
    },
    gentle: {
      voice: { lang: 'zh', name: ['xiaoxiao', 'huihui', 'yaoyao'] },
      pitch: 1.02,
      rate: 0.88,
      edgeVoice: 'zh-CN-XiaoyiNeural',
      edgeRate: '-6%',
      edgePitch: '+0Hz'
    },
    cool: {
      voice: { lang: 'zh', name: ['kangkang', 'yunyang', 'huihui'] },
      pitch: 0.82,
      rate: 0.95,
      edgeVoice: 'zh-CN-YunjianNeural',
      edgeRate: '-2%',
      edgePitch: '-2Hz'
    },
    curious: {
      voice: { lang: 'zh', name: ['yaoyao', 'xiaoxiao'] },
      pitch: 1.22,
      rate: 1.2,
      edgeVoice: 'zh-CN-YunxiaNeural',
      edgeRate: '+2%',
      edgePitch: '+2Hz'
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
  // T-40：许可证状态（license:get 返回）与合规拒绝标记
  let licenseState = null;
  let complianceRefused = false;
  // T-20：首次引导当前步骤与选中的预设人格模板 id
  let onboardingStep = 1;
  let selectedOnboardingTemplateId = '';
  // T-23：系统 TTS（Web Speech Synthesis）状态
  let ttsVoices = [];
  let ttsReady = false;
  let currentUtterance = null;
  let currentAudio = null; // T-34：在线神经语音 HTMLAudioElement
  let currentSpeakButton = null;
  // T-22：天气小部件状态（最近一次成功数据 / 错误码 / 加载中）
  let weatherState = null;
  let weatherErrorCode = null;
  let weatherLoading = false;
  let weatherLastFetchAt = 0;
  let weatherTimer = null;
  let weatherCollapsed = true; // T-24：天气小部件默认收起（仅保留摘要行）
  let weatherRetryAttempt = 0; // T-26：失败重试次数（指数退避）
  let weatherRetryTimer = null; // T-26：失败自动重试定时器
  // T-21：番茄钟状态
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
    bindWeatherRefreshTriggers();
    subscribeIdle();
    initTts(); // T-23：语音输出能力探测（异步加载系统语音列表）
    // 先加载两份语言包，确保任何文案渲染不会回退到键名
    await window.PetLocales.ready;
    await restoreSettings();
    void refreshLicense(); // T-40：加载许可证状态并渲染账户/订阅区块
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
      minimizeBtn: document.getElementById('minimize-btn'),
      toolbarExport: document.getElementById('toolbar-export'),
      exportBtn: document.getElementById('export-btn'),
      exportMenu: document.getElementById('export-menu'),
      settingsBack: document.getElementById('settings-back'),
      memoryManageBtn: document.getElementById('memory-manage-btn'),
      memoryBack: document.getElementById('memory-back'),
      memoryStatus: document.getElementById('memory-status'),
      memoryEmpty: document.getElementById('memory-empty'),
      memoryList: document.getElementById('memory-list'),
      weatherWidget: document.getElementById('weather-widget'),
      weatherIcon: document.getElementById('weather-icon'),
      weatherLocation: document.getElementById('weather-location'),
      weatherDesc: document.getElementById('weather-desc'),
      weatherTemp: document.getElementById('weather-temp'),
      weatherMeta: document.getElementById('weather-meta'),
      weatherUpdated: document.getElementById('weather-updated'),
      weatherRefresh: document.getElementById('weather-refresh'),
      weatherToggle: document.getElementById('weather-toggle'),
      weatherEnabled: document.getElementById('weather-enabled'),
      weatherCity: document.getElementById('weather-city'),
      ttsVoicePackEnabled: document.getElementById('tts-voice-pack-enabled'),
      ttsVoicePackId: document.getElementById('tts-voice-pack-id'),
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
      onboardingBack: document.getElementById('onboarding-back'),
      onboardingNext: document.getElementById('onboarding-next'),
      onboardingFinish: document.getElementById('onboarding-finish'),
      onboardingStatus: document.getElementById('onboarding-status'),
      pomodoroTime: document.getElementById('pomodoro-time'),
      pomodoroStart: document.getElementById('pomodoro-start'),
      pomodoroReset: document.getElementById('pomodoro-reset'),
      pomodoroStop: document.getElementById('pomodoro-stop'),
      pomodoroStatus: document.getElementById('pomodoro-status'),
      pomodoroEnabled: document.getElementById('pomodoro-enabled'),
      pomodoroMinutes: document.getElementById('pomodoro-minutes'),
      // T-40：账户/订阅区块
      licenseTier: document.getElementById('license-tier'),
      licenseStatus: document.getElementById('license-status'),
      licenseStatusRow: document.getElementById('license-status-row'),
      licenseExpiry: document.getElementById('license-expiry'),
      licenseExpiryRow: document.getElementById('license-expiry-row'),
      licenseQuota: document.getElementById('license-quota'),
      licenseFeatureNeural: document.getElementById('license-feature-neural'),
      licenseFeatureSkin: document.getElementById('license-feature-skin'),
      licenseFeatureFocus: document.getElementById('license-feature-focus'),
      licenseFeatureTodo: document.getElementById('license-feature-todo'),
      licenseCode: document.getElementById('license-code'),
      licenseActivate: document.getElementById('license-activate'),
      licenseDeactivate: document.getElementById('license-deactivate'),
      licenseMessage: document.getElementById('license-message'),
      // T-40：年龄确认 + 内容合规声明弹窗
      complianceView: document.getElementById('compliance-view'),
      complianceAccept: document.getElementById('compliance-accept'),
      complianceDecline: document.getElementById('compliance-decline'),
      complianceRefused: document.getElementById('compliance-refused')
    };
    showExportStatus = makeStatusShower(elements.exportStatus);
    showClearStatus = makeStatusShower(elements.clearStatus);
    showLicenseMessage = makeStatusShower(elements.licenseMessage);
  }

  /* ---------------- T-19：窗口行为开关与提示（ADR-022 冻结契约） ---------------- */

  function hasWindowApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.window &&
        typeof window.petAPI.window.toggleDock === 'function'
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
    block.append(dock.label);
    anchor.parentNode.insertBefore(block, anchor);

    windowFeatureEls = {
      block,
      title,
      dockText: dock.text,
      dockCheckbox: dock.input,
      dockHint: dock.hint
    };

    windowFeatureEls.dockCheckbox.addEventListener('change', () => {
      void toggleWindowDock();
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
  }

  /** 从主进程设置同步开关状态（缺省开启，与 store.js DEFAULT_SETTINGS 一致） */
  function applyWindowFeatureSettings(settings) {
    if (!windowFeatureEls.block) {
      return;
    }
    windowFeatureEls.dockCheckbox.checked =
      !settings || settings.dockEnabled !== false;
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
      console.warn('切换靠边吸附失败：', error);
      applyWindowFeatureSettings(currentSettings);
    }
  }

  function bindEvents() {
    elements.chatForm.addEventListener('submit', handleSubmit);
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.closeBtn.addEventListener('click', hideToTray);
    elements.minimizeBtn.addEventListener('click', minimizeWindow);
    elements.exportBtn.addEventListener('click', toggleExportMenu);
    elements.settingsBack.addEventListener('click', showChatView);
    elements.memoryManageBtn.addEventListener('click', openMemoryView);
    elements.memoryBack.addEventListener('click', closeMemoryView);
    elements.settingsSave.addEventListener('click', saveSettings);
    elements.exportMdBtn.addEventListener('click', () => void exportConversation('markdown'));
    elements.exportJsonBtn.addEventListener('click', () => void exportConversation('json'));
    elements.clearDataBtn.addEventListener('click', handleClearData);
    elements.weatherRefresh.addEventListener('click', () => {
      pokeActivity();
      void refreshWeather(true);
    });
    elements.weatherToggle.addEventListener('click', toggleWeatherCollapsed);
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
    elements.pomodoroStart.addEventListener('click', () => startPomodoro());
    elements.pomodoroReset.addEventListener('click', resetPomodoro);
    elements.pomodoroStop.addEventListener('click', stopPomodoro);
    elements.ttsVoicePackEnabled.addEventListener(
      'change',
      updateTtsVoicePackControls
    );
    elements.licenseActivate.addEventListener('click', () => void activateLicense());
    elements.licenseDeactivate.addEventListener('click', () =>
      void deactivateLicense()
    );
    elements.complianceAccept.addEventListener('click', () =>
      void acceptCompliance()
    );
    elements.complianceDecline.addEventListener('click', declineCompliance);

    // T-25：点击工具栏外关闭导出菜单；Escape 关闭并归还焦点
    document.addEventListener('click', (event) => {
      if (!elements.exportMenu || elements.exportMenu.hidden) {
        return;
      }
      const wrap = elements.toolbarExport;
      if (!wrap || !wrap.contains(event.target)) {
        closeExportMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        elements.exportMenu &&
        !elements.exportMenu.hidden
      ) {
        closeExportMenu();
        if (elements.exportBtn) {
          elements.exportBtn.focus();
        }
      }
    });
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

  /** T-26：窗口从隐藏/托盘恢复显示（含最小化恢复）时立即刷新天气，受最小间隔保护 */
  function bindWeatherRefreshTriggers() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void refreshWeather(false);
      }
    });
    window.addEventListener('focus', () => {
      void refreshWeather(false);
    });
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
   * （不写入历史，也不调用 LLM）。
   */
  function subscribeIdle() {
    const idleApi = window.petAPI && window.petAPI.idle;
    if (!idleApi || typeof idleApi.onTrigger !== 'function') {
      return;
    }
    idleApi.onTrigger((payload) => {
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
    if (pomodoroState.mode === 'finished') {
      return; // T-27：同一轮倒计时的完成信号只处理一次（幂等）
    }
    clearPomodoroTimer();
    pomodoroState.mode = 'finished';
    pomodoroState.remainingMs = 0;
    pomodoroState.endsAt = 0;
    updatePomodoroDisplay();
    updatePomodoroControls();
    const t = window.PetLocales.createTranslator(currentLocale);
    showPomodoroStatus(t('pomodoro.finished'), 'ok');
    if (currentSettings.pomodoroEnabled !== false) {
      // T-27：一次性完成信号（pomodoroNotifyAt/pomodoroNotifyMinutes）由主进程
      // 幂等消费并清零；普通 saveSettings 的 patch 不携带这两个字段，
      // 避免把已消费的陈旧信号回写。
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

  /** T-25：最小化到任务栏（区别于 ✕ 隐藏到托盘；ADR-026 冻结契约） */
  function minimizeWindow() {
    pokeActivity();
    const api = window.petAPI && window.petAPI.window;
    if (api && typeof window.petAPI.window.minimize === 'function') {
      void window.petAPI.window.minimize();
    } else {
      console.warn('petAPI.window.minimize 不可用');
    }
  }

  /** T-25：打开/关闭工具栏导出菜单 */
  function toggleExportMenu() {
    pokeActivity();
    if (!elements.exportMenu || !elements.exportBtn) {
      return;
    }
    if (elements.exportMenu.hidden) {
      elements.exportMenu.hidden = false;
      elements.exportBtn.setAttribute('aria-expanded', 'true');
      elements.exportMdBtn.focus();
    } else {
      closeExportMenu();
    }
  }

  function closeExportMenu() {
    if (!elements.exportMenu || elements.exportMenu.hidden) {
      return;
    }
    elements.exportMenu.hidden = true;
    if (elements.exportBtn) {
      elements.exportBtn.setAttribute('aria-expanded', 'false');
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
    if (complianceRefused) {
      elements.serviceStatus.textContent = `⚠ ${t('license.complianceRefusedNotice')}`;
      elements.serviceStatus.hidden = false;
      elements.chatInput.placeholder = t('license.complianceRefusedNotice');
      return;
    }
    if (
      elements.complianceView &&
      !elements.complianceView.hidden &&
      currentSettings &&
      currentSettings.complianceAccepted !== true
    ) {
      elements.serviceStatus.textContent = `⚠ ${t('license.complianceRequired')}`;
      elements.serviceStatus.hidden = false;
      elements.chatInput.placeholder = t('license.complianceRequired');
      return;
    }
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
    if (complianceRefused) {
      elements.chatInput.focus();
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
    if (complianceRefused) {
      appendMessage('assistant', t('license.complianceRefusedNotice'));
      elements.chatInput.focus();
      return;
    }
    if (!isChatReady()) {
      appendMessage('assistant', t('chat.serviceNotReadyReply'));
      elements.chatInput.focus();
      return;
    }
    // T-40：免费云 AI 额度本地预检（主进程仍会二次校验，防止并发超用）
    if (!hasByokApiKey()) {
      const usage = licenseState && licenseState.quota;
      if (usage && Number.isFinite(usage.remaining) && usage.remaining <= 0) {
        appendMessage('assistant', t('license.quotaExceeded'));
        elements.chatInput.focus();
        return;
      }
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
    if (result && result.error === 'license-quota-exceeded') {
      const partial = result && result.reply ? result.reply : received;
      return partial ? `${partial}\n${t('license.quotaExceeded')}` : t('license.quotaExceeded');
    }
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

  /** T-33：当前生效的语音包：显式 ttsVoicePackId 优先，空值跟随 personaTemplate；未知 id 返回 null */
  function resolveTtsVoicePack() {
    const packId =
      currentSettings && typeof currentSettings.ttsVoicePackId === 'string'
        ? currentSettings.ttsVoicePackId.trim()
        : '';
    const id = packId || currentTemplateId(currentSettings) || '';
    return TTS_VOICE_PACKS[id] || null;
  }

  /**
   * 按偏好选系统语音：
   * 1. 语音包 voice 偏好（语言前缀 + 名称关键词，任一命中即用）
   * 2. 按当前界面语言（zh 优先 Huihui 类中文语音，en 优先英文语音）
   * 3. 语音列表第一个
   */
  function pickTtsVoice(preferred) {
    const preferredVoice = preferred && preferred.voice;
    if (preferredVoice && Array.isArray(preferredVoice.name)) {
      const langPrefix = typeof preferredVoice.lang === 'string'
        ? preferredVoice.lang.toLowerCase()
        : '';
      const matched = ttsVoices.find((voice) => {
        const voiceLang = String(voice.lang || '').toLowerCase();
        if (langPrefix && !voiceLang.startsWith(langPrefix)) {
          return false;
        }
        const voiceName = String(voice.name || '').toLowerCase();
        return preferredVoice.name.some((keyword) =>
          voiceName.includes(String(keyword).toLowerCase())
        );
      });
      if (matched) {
        return matched;
      }
    }
    const localePreferred = currentLocale === 'en' ? /^en/i : /^zh/i;
    return (
      ttsVoices.find((voice) => localePreferred.test(voice.lang || '')) ||
      ttsVoices[0] ||
      null
    );
  }

  /** T-33：语音包下拉选项（空=自动跟随人格；其余为 6 套预设语音包），并同步禁用态 */
  function renderTtsVoicePackOptions() {
    const select = elements.ttsVoicePackId;
    if (!select) {
      return;
    }
    const t = window.PetLocales.createTranslator(currentLocale);
    const selectedId =
      currentSettings && typeof currentSettings.ttsVoicePackId === 'string'
        ? currentSettings.ttsVoicePackId
        : '';
    select.textContent = '';
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = t('settings.ttsVoicePackAuto');
    select.appendChild(auto);
    for (const item of templateList()) {
      if (!TTS_VOICE_PACKS[item.id]) {
        continue;
      }
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name || item.id;
      select.appendChild(option);
    }
    select.value = TTS_VOICE_PACKS[selectedId] ? selectedId : '';
    updateTtsVoicePackControls();
  }

  /** T-33/T-40：专属语音包关闭或免费版（高级神经语音锁定）时禁用语音包选择 */
  function updateTtsVoicePackControls() {
    const select = elements.ttsVoicePackId;
    const checkbox = elements.ttsVoicePackEnabled;
    const paid = licenseTierIsPaid();
    if (checkbox) {
      checkbox.disabled = !paid;
    }
    if (select) {
      select.disabled = !paid || !elements.ttsVoicePackEnabled.checked;
    }
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
      if (currentAudio) {
        try {
          currentAudio.pause();
        } catch (_error) {
          // 播放对象清理失败不影响状态恢复
        }
        currentAudio = null;
      }
    }
    updateSpeakButtonState(button, false);
  }

  function stopSpeaking() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.src = '';
      } catch (_error) {
        // 播放对象清理失败不影响状态恢复
      }
      currentAudio = null;
    }
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

  /** T-34：petAPI.tts.speak 是否可用（preload 已暴露即视为可用） */
  function hasEdgeTtsApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.tts &&
        typeof window.petAPI.tts.speak === 'function'
    );
  }

  function toggleSpeak(button) {
    if (!ttsEnabled()) {
      return;
    }
    if ((currentUtterance || currentAudio) && currentSpeakButton === button) {
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
    // T-33：专属语音包开启时按当前生效人格应用 voice/pitch/rate；关闭时回退系统默认
    const packEnabled = currentSettings.ttsVoicePackEnabled !== false;
    const pack = packEnabled ? resolveTtsVoicePack() : null;
    // T-34：开启语音包且 petAPI.tts.speak 可用时优先在线神经语音
    if (pack && hasEdgeTtsApi()) {
      speakWithEdge(button, text, pack);
      return;
    }
    speakWithSystem(button, text, pack);
  }

  /** 在线神经语音：主进程合成 MP3 data URL，HTMLAudioElement 播放/停止 */
  async function speakWithEdge(button, text, pack) {
    currentSpeakButton = button;
    updateSpeakButtonState(button, true);
    let result = null;
    try {
      result = await window.petAPI.tts.speak({
        text,
        voice: pack.edgeVoice,
        rate: pack.edgeRate,
        pitch: pack.edgePitch
      });
    } catch (_error) {
      result = null;
    }
    if (currentSpeakButton !== button) {
      return; // 请求期间已被停止或切换
    }
    const audioDataUrl =
      result && result.ok === true ? result.audioDataUrl : null;
    if (typeof audioDataUrl !== 'string' || !audioDataUrl) {
      speakWithSystem(button, text, pack); // 断网/合成失败：自动回退
      return;
    }
    let fallbackDone = false;
    const fallback = () => {
      if (fallbackDone) {
        return;
      }
      fallbackDone = true;
      if (currentAudio === audio) {
        currentAudio = null;
      }
      if (currentSpeakButton !== button) {
        updateSpeakButtonState(button, false);
        return;
      }
      currentUtterance = null;
      speakWithSystem(button, text, pack); // 播放失败：回退系统 TTS
    };
    const audio = new Audio(audioDataUrl);
    currentAudio = audio;
    audio.onended = () => clearSpeakingState(button);
    audio.onerror = fallback;
    audio.play().catch(fallback);
  }

  /** 系统 TTS 回退路径（原 T-23 行为） */
  function speakWithSystem(button, text, pack) {
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickTtsVoice(pack || null);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = currentLocale === 'en' ? 'en-US' : 'zh-CN';
    }
    utter.pitch =
      pack && Number.isFinite(pack.pitch)
        ? Math.min(2, Math.max(0.1, pack.pitch))
        : 1;
    utter.rate =
      pack && Number.isFinite(pack.rate)
        ? Math.min(10, Math.max(0.1, pack.rate))
        : 1;
    utter.onend = () => clearSpeakingState(button);
    utter.onerror = () => clearSpeakingState(button);
    currentUtterance = utter;
    currentSpeakButton = button;
    synth.cancel();
    synth.speak(utter);
    updateSpeakButtonState(button, true);
  }

  /* ---------------- T-22：天气小部件（Open-Meteo，主进程请求） ---------------- */

  function hasWeatherApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.weather &&
        typeof window.petAPI.weather.get === 'function'
    );
  }

  function weatherTranslator() {
    return window.PetLocales.createTranslator(currentLocale);
  }

  /** 开关状态：设置页 weatherEnabled 且主进程 API 可用时展示 */
  function updateWeatherWidgetVisibility() {
    if (!elements.weatherWidget) {
      return;
    }
    const enabled = currentSettings.weatherEnabled === true && hasWeatherApi();
    elements.weatherWidget.hidden = !enabled;
    applyWeatherCollapsed(); // T-24：显示/隐藏时同步折叠状态
    if (!enabled) {
      if (weatherTimer) {
        clearInterval(weatherTimer);
        weatherTimer = null;
      }
      clearWeatherRetry();
      return;
    }
    if (!weatherTimer) {
      weatherTimer = setInterval(
        () => void refreshWeather(false),
        WEATHER_AUTO_REFRESH_MS
      );
    }
  }

  /** T-24：按折叠状态切换天气摘要/详情（默认收起） */
  function applyWeatherCollapsed() {
    if (!elements.weatherWidget || !elements.weatherToggle) {
      return;
    }
    elements.weatherWidget.classList.toggle('collapsed', weatherCollapsed);
    elements.weatherToggle.setAttribute(
      'aria-expanded',
      String(!weatherCollapsed)
    );
    const t = weatherTranslator();
    const key = weatherCollapsed ? 'weather.expand' : 'weather.collapse';
    elements.weatherToggle.title = t(key);
    elements.weatherToggle.setAttribute('aria-label', t(key));
    elements.weatherToggle.textContent = weatherCollapsed ? '▸' : '▾';
  }

  /** T-24：点击切换天气小部件展开/收起 */
  function toggleWeatherCollapsed() {
    pokeActivity();
    weatherCollapsed = !weatherCollapsed;
    applyWeatherCollapsed();
  }

  /** 从设置同步天气开关与城市输入框（applySettings 时调用） */
  function applyWeatherSettings(settings) {
    if (!elements.weatherEnabled || !elements.weatherCity) {
      return;
    }
    elements.weatherEnabled.checked = settings.weatherEnabled === true;
    elements.weatherCity.value =
      typeof settings.weatherCity === 'string' ? settings.weatherCity : '';
    updateWeatherWidgetVisibility();
    if (!elements.weatherWidget.hidden) {
      void refreshWeather(false);
    }
  }

  async function refreshWeather(force) {
    if (
      !hasWeatherApi() ||
      !elements.weatherWidget ||
      elements.weatherWidget.hidden ||
      weatherLoading
    ) {
      return;
    }
    const now = Date.now();
    if (
      !force &&
      weatherState &&
      now - weatherLastFetchAt < WEATHER_MIN_REFRESH_GAP_MS
    ) {
      return;
    }
    weatherLoading = true;
    elements.weatherRefresh.disabled = true;
    const t = weatherTranslator();
    setWeatherMeta(t('weather.loading'), 'loading');
    setWeatherUpdated('', 'loading');
    try {
      const result = await window.petAPI.weather.get({ force: force === true });
      weatherLastFetchAt = Date.now();
      renderWeatherResult(result);
    } catch (error) {
      console.warn('获取天气失败：', error);
      weatherLastFetchAt = Date.now();
      showWeatherFailure('weather-network-error', weatherState);
    } finally {
      weatherLoading = false;
      elements.weatherRefresh.disabled = false;
    }
  }

  function renderWeatherResult(result) {
    if (result && result.ok && result.data) {
      weatherState = result.data;
      weatherErrorCode = null;
      clearWeatherRetry();
      renderWeatherData(result.data);
      return;
    }
    const code =
      result && typeof result.error === 'string'
        ? result.error
        : 'weather-network-error';
    const cachedData = result && result.data ? result.data : null;
    showWeatherFailure(code, cachedData);
  }

  /** 渲染成功数据（城市/图标/温度/描述 + 详情行）；语言切换时经 applyWeatherText 复用 */
  function renderWeatherData(data) {
    const t = weatherTranslator();
    elements.weatherIcon.textContent = data.icon || '🌡️';
    elements.weatherLocation.textContent = [data.name, data.country]
      .filter(Boolean)
      .join(' · ');
    elements.weatherDesc.textContent = data.description || '';
    const temperature = Number(data.temperature);
    elements.weatherTemp.textContent = Number.isFinite(temperature)
      ? `${Math.round(temperature)}°`
      : '';

    const details = [];
    if (Number.isFinite(Number(data.apparentTemperature))) {
      details.push(
        t('weather.feelsLike', {
          temp: Math.round(Number(data.apparentTemperature))
        })
      );
    }
    if (Number.isFinite(Number(data.humidity))) {
      details.push(t('weather.humidity', { value: Math.round(data.humidity) }));
    }
    if (Number.isFinite(Number(data.windSpeed))) {
      details.push(t('weather.wind', { value: Math.round(data.windSpeed) }));
    }
    setWeatherMeta(details.join(' · '), 'ok');
    if (Number.isFinite(Number(data.updatedAt))) {
      setWeatherUpdated(
        t('weather.updatedAt', { time: formatWeatherTime(data.updatedAt) }),
        'ok'
      );
    } else {
      setWeatherUpdated('', 'ok');
    }
  }

  /** 失败降级：有缓存数据时保留展示；无缓存时显示本地化错误 */
  function renderWeatherError(code, cachedData) {
    weatherErrorCode = code;
    if (cachedData) {
      weatherState = cachedData;
      renderWeatherData(cachedData);
      return;
    }
    weatherState = null;
    elements.weatherIcon.textContent = '⚠️';
    elements.weatherLocation.textContent = weatherTranslator()(
      'weather.unavailable'
    );
    elements.weatherDesc.textContent = '';
    elements.weatherTemp.textContent = '';
    setWeatherMeta(weatherErrorMessage(code), 'error');
    setWeatherUpdated('', 'error');
  }

  /** T-26：失败统一出口——保留缓存、显示错误与自动重试提示、按退避间隔重试 */
  function showWeatherFailure(code, cachedData) {
    renderWeatherError(code, cachedData);
    const t = weatherTranslator();
    const retryNotice = t('weather.retryNotice', {
      seconds: nextWeatherRetrySeconds()
    });
    if (cachedData) {
      setWeatherMeta(
        `${t('weather.refreshFailed', {
          error: weatherErrorMessage(code)
        })} · ${t('weather.cachedNotice')} · ${retryNotice}`,
        'warning'
      );
    } else {
      setWeatherMeta(
        `${weatherErrorMessage(code)} · ${retryNotice}`,
        'error'
      );
    }
    scheduleWeatherRetry();
  }

  /** T-26：下一次重试延迟（指数退避：60s → 120s → 240s → …，上限 15 分钟） */
  function nextWeatherRetryDelayMs() {
    return Math.min(
      WEATHER_RETRY_BASE_MS * Math.pow(2, weatherRetryAttempt),
      WEATHER_RETRY_MAX_MS
    );
  }

  function nextWeatherRetrySeconds() {
    return Math.max(1, Math.round(nextWeatherRetryDelayMs() / 1000));
  }

  /** T-26：安排失败自动重试（定时器到期后走最小间隔保护） */
  function scheduleWeatherRetry() {
    if (weatherRetryTimer) {
      clearTimeout(weatherRetryTimer);
    }
    const delay = nextWeatherRetryDelayMs();
    weatherRetryAttempt += 1;
    weatherRetryTimer = setTimeout(() => {
      weatherRetryTimer = null;
      void refreshWeather(false);
    }, delay);
  }

  /** T-26：成功后清零退避状态并取消待执行的重试 */
  function clearWeatherRetry() {
    if (weatherRetryTimer) {
      clearTimeout(weatherRetryTimer);
      weatherRetryTimer = null;
    }
    weatherRetryAttempt = 0;
  }

  function weatherErrorMessage(code) {
    const t = weatherTranslator();
    switch (code) {
      case 'weather-empty-city':
        return t('weather.notConfigured');
      case 'weather-city-not-found':
        return t('weather.cityNotFound', {
          city:
            typeof currentSettings.weatherCity === 'string'
              ? currentSettings.weatherCity
              : ''
        });
      case 'weather-network-error':
        return t('weather.networkError');
      case 'weather-invalid-response':
        return t('weather.invalidResponse');
      default:
        return t('weather.errorPrefix', { error: code || 'unknown' });
    }
  }

  function setWeatherMeta(text, type) {
    elements.weatherMeta.textContent = text;
    elements.weatherMeta.dataset.type = type || 'ok';
  }

  /** T-26：独立“上次更新”行，类型决定配色（ok/warning/error/loading） */
  function setWeatherUpdated(text, type) {
    if (!elements.weatherUpdated) {
      return;
    }
    elements.weatherUpdated.textContent = text;
    elements.weatherUpdated.dataset.type = type || 'ok';
  }

  function formatWeatherTime(value) {
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

  /** 语言切换后按最近状态重绘动态文案（applyStaticText 时调用） */
  function applyWeatherText() {
    if (!elements.weatherWidget || elements.weatherWidget.hidden) {
      return;
    }
    if (weatherErrorCode && weatherState) {
      renderWeatherData(weatherState);
      const t = weatherTranslator();
      setWeatherMeta(
        `${t('weather.refreshFailed', {
          error: weatherErrorMessage(weatherErrorCode)
        })} · ${t('weather.cachedNotice')}`,
        'warning'
      );
    } else if (weatherErrorCode) {
      renderWeatherError(weatherErrorCode, null);
    } else if (weatherState) {
      renderWeatherData(weatherState);
    }
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
        ttsVoicePackEnabled: saved.ttsVoicePackEnabled !== false,
        ttsVoicePackId:
          typeof saved.ttsVoicePackId === 'string' ? saved.ttsVoicePackId : '',
        weatherEnabled: saved.weatherEnabled === true,
        weatherCity: saved.weatherCity,
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
    applyOnboardingText(); // T-20：引导与人格模板静态文案（内联双语）
    applyWeatherText(); // T-22：语言切换后重绘天气动态文案
    applyWeatherCollapsed(); // T-24：语言切换后刷新折叠按钮文案
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
    elements.ttsVoicePackEnabled.checked =
      currentSettings.ttsVoicePackEnabled !== false;
    renderTtsVoicePackOptions(); // T-33：语音包选项与禁用态随设置/语言刷新
    applyWeatherSettings(currentSettings); // T-22：天气开关/城市输入 + 可见性 + 刷新
    elements.pomodoroEnabled.checked = currentSettings.pomodoroEnabled !== false;
    elements.pomodoroMinutes.value = String(
      pomodoroMinutesFromSettings(currentSettings)
    );
    applyPomodoroSettings(currentSettings);

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
    applyWindowFeatureSettings(currentSettings); // T-19
    updateWindowFeatureText(); // T-19: 语言切换后刷新提示文案
    applyLicenseUi(); // T-40：许可证档位/门控/额度随设置与语言刷新
    syncComplianceVisibility(); // T-40：合规弹窗状态
    syncOnboardingVisibility(); // T-20：首次启动引导（完成标志持久化）
    applyComplianceLock(); // T-40：拒绝合规后锁定 AI 对话
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
        ttsVoicePackEnabled: elements.ttsVoicePackEnabled.checked,
        ttsVoicePackId: elements.ttsVoicePackId.value.trim(),
        weatherEnabled: elements.weatherEnabled.checked,
        weatherCity: elements.weatherCity.value.trim(),
        pomodoroEnabled: elements.pomodoroEnabled.checked,
        pomodoroMinutes: Number(elements.pomodoroMinutes.value)
      });
      showSettingsStatus(t('settings.savedLocalFallback'), 'ok');
      return;
    }

    elements.settingsSave.disabled = true;
    try {
      // T-27：普通设置保存绝不携带 pomodoroNotifyAt/pomodoroNotifyMinutes，
      // 完成信号只由 finishPomodoro 单独写入，防止回写已消费信号。
      const saved = await window.petAPI.settings.set({
        petName,
        apiKey,
        model,
        persona,
        language,
        idleEnabled: elements.idleEnabled.checked,
        personaTemplate,
        ttsVoicePackEnabled: elements.ttsVoicePackEnabled.checked,
        ttsVoicePackId: elements.ttsVoicePackId.value.trim(),
        weatherEnabled: elements.weatherEnabled.checked,
        weatherCity: elements.weatherCity.value.trim(),
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

  /* ---------------- T-40：许可证/订阅区块 + 年龄确认与内容合规弹窗 ---------------- */

  function hasLicenseApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.license &&
        typeof window.petAPI.license.get === 'function'
    );
  }

  /** 是否使用 BYOK（自备 API Key，不消耗云 AI 额度） */
  function hasByokApiKey() {
    return Boolean(
      currentSettings &&
        typeof currentSettings.apiKey === 'string' &&
        currentSettings.apiKey.trim()
    );
  }

  /** 当前生效档位：优先主进程状态，其次本地设置回退 */
  function currentEffectiveTier() {
    if (licenseState && typeof licenseState.effectiveTier === 'string') {
      return licenseState.effectiveTier;
    }
    if (currentSettings && typeof currentSettings.licenseTier === 'string') {
      return currentSettings.licenseTier;
    }
    return 'free';
  }

  /** Pro 专属门控：yearly / lifetime 为付费档 */
  function licenseTierIsPaid() {
    const tier = currentEffectiveTier();
    return tier === 'yearly' || tier === 'lifetime';
  }

  function tierLabel(t, tier) {
    const key = `license.tier${String(tier || 'free')[0].toUpperCase()}${String(
      tier || 'free'
    ).slice(1)}`;
    return t(key);
  }

  function statusLabel(t, status) {
    const map = {
      active: 'statusActive',
      expired: 'statusExpired',
      revoked: 'statusRevoked',
      inactive: 'statusInactive',
      'device-mismatch': 'statusDeviceMismatch'
    };
    return t(`license.${map[status] || 'statusInactive'}`);
  }

  /** 拉取主进程许可证状态并渲染账户/订阅区块 */
  async function refreshLicense() {
    if (!hasLicenseApi()) {
      licenseState = null;
      applyLicenseUi();
      syncComplianceVisibility();
      return;
    }
    try {
      const state = await window.petAPI.license.get();
      licenseState = state && typeof state === 'object' ? state : null;
    } catch (error) {
      console.warn('读取许可证状态失败：', error);
      licenseState = null;
    }
    applyLicenseUi();
    syncComplianceVisibility();
  }

  /** 渲染档位/状态/有效期/额度/门控（语言切换与设置变化时均调用） */
  function applyLicenseUi() {
    if (!elements.licenseTier) {
      return;
    }
    const t = window.PetLocales.createTranslator(currentLocale);
    const state = licenseState || {};
    const tier = currentEffectiveTier();
    const status =
      typeof state.status === 'string' ? state.status : 'inactive';
    const paid = licenseTierIsPaid();

    elements.licenseTier.textContent = tierLabel(t, tier);

    const showStatus = status !== 'inactive';
    elements.licenseStatusRow.hidden = !showStatus;
    if (showStatus && elements.licenseStatus) {
      elements.licenseStatus.textContent = statusLabel(t, status);
    }

    const expiresAt = Number(state.expiresAt) || 0;
    elements.licenseExpiryRow.hidden = expiresAt <= 0;
    if (elements.licenseExpiry) {
      elements.licenseExpiry.textContent =
        expiresAt > 0
          ? new Date(expiresAt).toLocaleDateString(currentLocale === 'en' ? 'en-US' : 'zh-CN')
          : t('license.perpetual');
    }

    // 云 AI 额度（BYOK 不消耗）
    if (elements.licenseQuota) {
      if (hasByokApiKey()) {
        elements.licenseQuota.textContent = t('license.quotaByok');
      } else if (state.quota) {
        elements.licenseQuota.textContent = t(
          state.quota.period === 'day' ? 'license.quotaDay' : 'license.quotaMonth',
          {
            remaining: state.quota.remaining,
            limit: state.quota.limit
          }
        );
      } else {
        elements.licenseQuota.textContent = '';
      }
    }

    // Pro 专属功能门控：高级神经语音始终可见（锁定态），皮肤/专注/待办仅付费档显示
    if (elements.licenseFeatureNeural) {
      elements.licenseFeatureNeural.textContent = paid
        ? t('license.featureNeuralVoice')
        : t('license.featureLocked', { name: t('license.featureNeuralVoice') });
      elements.licenseFeatureNeural.classList.toggle('locked', !paid);
    }
    if (elements.licenseFeatureSkin) {
      elements.licenseFeatureSkin.hidden = !paid;
    }
    if (elements.licenseFeatureFocus) {
      elements.licenseFeatureFocus.hidden = !paid;
    }
    if (elements.licenseFeatureTodo) {
      elements.licenseFeatureTodo.hidden = !paid;
    }

    // 激活/注销入口
    if (elements.licenseDeactivate) {
      elements.licenseDeactivate.hidden = !(paid && status === 'active');
    }

    updateTtsVoicePackControls(); // 免费版锁定高级神经语音
  }

  /** 激活码/订单号激活（T-41 前为本地 mock 校验） */
  async function activateLicense() {
    const t = window.PetLocales.createTranslator(currentLocale);
    const api =
      window.petAPI &&
      window.petAPI.license &&
      window.petAPI.license.activate;
    if (typeof api !== 'function') {
      showLicenseMessage(
        t('license.activateError', { error: t('data.apiUnavailable') }),
        'error'
      );
      return;
    }
    const code = elements.licenseCode.value.trim();
    if (!code) {
      showLicenseMessage(t('license.activateError', { error: 'empty' }), 'error');
      return;
    }
    elements.licenseActivate.disabled = true;
    showLicenseMessage(t('license.activating'), 'ok');
    try {
      const result = await api(code);
      if (result && result.ok) {
        licenseState = result.status || null;
        applyLicenseUi();
        showLicenseMessage(
          t('license.activated', {
            tier: tierLabel(t, licenseState ? licenseState.tier : 'free')
          }),
          'ok'
        );
      } else {
        showLicenseMessage(
          t('license.activateError', {
            error: result && result.error ? result.error : t('data.apiUnavailable')
          }),
          'error'
        );
      }
    } catch (error) {
      showLicenseMessage(
        t('license.activateError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.licenseActivate.disabled = false;
    }
  }

  /** 注销激活：回到免费版 */
  async function deactivateLicense() {
    const api =
      window.petAPI &&
      window.petAPI.license &&
      window.petAPI.license.deactivate;
    const t = window.PetLocales.createTranslator(currentLocale);
    if (typeof api !== 'function') {
      showLicenseMessage(
        t('license.deactivateError', { error: t('data.apiUnavailable') }),
        'error'
      );
      return;
    }
    elements.licenseDeactivate.disabled = true;
    try {
      const result = await api();
      if (result && result.ok) {
        licenseState = result.status || null;
        applyLicenseUi();
        showLicenseMessage(t('license.deactivated'), 'ok');
      } else {
        showLicenseMessage(
          t('license.deactivateError', {
            error: result && result.error ? result.error : t('data.apiUnavailable')
          }),
          'error'
        );
      }
    } catch (error) {
      showLicenseMessage(
        t('license.deactivateError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.licenseDeactivate.disabled = false;
    }
  }

  /** 合规弹窗：未同意时展示；同意后永久隐藏；拒绝后锁定 AI 对话 */
  function syncComplianceVisibility() {
    if (!elements.complianceView) {
      return;
    }
    const accepted =
      currentSettings && currentSettings.complianceAccepted === true;
    const show = !accepted && !complianceRefused;
    elements.complianceView.hidden = !show;
    if (show && elements.complianceRefused) {
      elements.complianceRefused.hidden = true;
    }
    applyComplianceLock();
  }

  /** 拒绝合规：AI 对话停用，本地功能（记忆/番茄钟/天气等）保留 */
  function declineCompliance() {
    complianceRefused = true;
    if (elements.complianceView) {
      elements.complianceView.hidden = true;
    }
    applyComplianceLock();
  }

  /** 同意合规：持久化 complianceAccepted=true，之后不再弹窗 */
  async function acceptCompliance() {
    complianceRefused = false;
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function';
    try {
      if (settingsApi) {
        const saved = await window.petAPI.settings.set({
          complianceAccepted: true
        });
        applySettings(saved || { ...currentSettings, complianceAccepted: true });
      } else {
        applySettings({ ...currentSettings, complianceAccepted: true });
      }
    } catch (error) {
      console.warn('保存合规同意失败：', error);
      // 持久化失败时本次会话视为已同意，下次启动重新提示
      applySettings({ ...currentSettings, complianceAccepted: true });
    }
    if (elements.complianceView) {
      elements.complianceView.hidden = true;
    }
    applyComplianceLock();
    elements.chatInput.focus();
  }

  /** 锁定/解锁 AI 对话输入（拒绝合规或尚未完成声明时禁用） */
  function applyComplianceLock() {
    const locked =
      complianceRefused ||
      Boolean(
        elements.complianceView &&
          !elements.complianceView.hidden &&
          currentSettings &&
          currentSettings.complianceAccepted !== true
      );
    if (elements.chatInput) {
      elements.chatInput.disabled = locked;
    }
    if (elements.sendBtn) {
      elements.sendBtn.disabled = locked;
    }
    renderServiceStatus();
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
      button.setAttribute('aria-expanded', item.id === selectedId ? 'true' : 'false');
      if (item.id === selectedId) {
        button.classList.add('selected');
      }

      const name = document.createElement('span');
      name.className = 'template-name';
      name.textContent = item.name || item.id;

      const desc = document.createElement('span');
      desc.className = 'template-desc';
      desc.textContent = item.description || '';
      desc.title = item.description || '';

      const details = document.createElement('div');
      details.className = 'template-details';
      const persona = item.persona || {};
      const detailLines = [
        {
          label: onboardingText('detailTraits'),
          value: Array.isArray(persona.traits)
            ? persona.traits.join(' · ')
            : ''
        },
        {
          label: onboardingText('detailTone'),
          value: typeof persona.tone === 'string' ? persona.tone : ''
        },
        {
          label: onboardingText('detailBackstory'),
          value:
            typeof persona.backstory === 'string' ? persona.backstory : ''
        }
      ];
      for (const line of detailLines) {
        if (!line.value) {
          continue;
        }
        const detail = document.createElement('span');
        detail.className = 'template-detail-line';
        detail.textContent = `${line.label}：${line.value}`;
        details.appendChild(detail);
      }

      button.append(name, desc, details);
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
  }

  function selectOnboardingTemplate(id) {
    selectedOnboardingTemplateId = id;
    renderOnboardingTemplates();
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
  let showLicenseMessage = () => {};

  window.ChatUI = {
    init,
    applyMood,
    startPomodoro, // T-21：可传分钟数覆盖（测试/快捷入口）
    resetPomodoro,
    stopPomodoro,
    getPomodoroState
  };
})();

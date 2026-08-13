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
 * - T-25 工具栏：导出对话从设置页移入聊天工具栏（下拉菜单），新增最小化按钮
 *   （petAPI.window.minimize → IPC window:minimize，ADR-026 冻结契约）
 * - T-33 TTS 专属语音包（按人格）：6 套预设人格各配 voice/pitch/rate，朗读时按当前
 *   生效人格自动应用；设置页可关闭（回退系统默认 TTS）或固定选择语音包
 *   （ttsVoicePackEnabled/ttsVoicePackId，协调者预确认的两个 settings 字段）
 * - T-34（ADR-029）：开启语音包时朗读优先走 petAPI.tts.speak（Edge 在线神经语音，
 *   HTMLAudioElement 播放/停止），断网/合成/播放失败自动回退 speechSynthesis，
 *   按钮不失效、不卡死；TTS_VOICE_PACKS 增加 edgeVoice/edgeRate/edgePitch 映射
 * - T-42 匿名遥测：首次引导与设置页提供 opt-in 开关（默认关闭），
 *   设置页可一键“关闭并清除”本地遥测数据（petAPI.telemetry.*）；
 *   事件采集/上报在主进程完成，渲染层不接触消息正文等敏感字段
 * - T-43 皮肤与配件（ADR-032）：设置页“皮肤与配件”子页——皮肤列表（预览图/名称/
 *   作者/版本/内置或导入标识）、应用/导出/移除按钮、zip 或目录导入入口；
 *   标题栏角色形象（pet-avatar）随 settings.skinId 切换默认皮肤资源（T-44 再做动效）
 * - T-40 许可证与付费墙：设置页“账户/订阅”区块（档位/状态/有效期/云 AI 额度）；
 *   功能门控（高级神经语音、皮肤市场、待办仅
 *   yearly/lifetime）；首次启动年龄确认 + 内容合规声明弹窗（同意后不再弹，
 *   拒绝后 AI 对话停用）；云额度不足时本地拦截并回显主进程错误；
 *   T-54：移除支付与激活测试桩 UI（主进程内部桩保留，不暴露给终端用户），
 *   新增设置页“重新查看新手引导”入口（复用 T-20 三步引导覆盖层）
 * - T-44 UI 大改（M3.6）：深色玻璃拟态 + 浅色主题切换（theme 持久化）、
 *   减弱动效开关（reduceMotion，关闭呼吸/眨眼/过渡）、角色呼吸/眨眼/情绪联动
 *   微动画（纯 CSS）、效率小组件增强（喝水提醒/待办，本地持久化；
 *   待办按 T-40 许可证门控仅 paid 显示）
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
  const DEFAULT_THEME = 'dark'; // T-44：与 store.js DEFAULT_THEME 一致
  const WATER_CHECK_MS = 30 * 1000; // T-44：喝水提醒检查间隔
  const WATER_INTERVAL_DEFAULT = 60; // T-44：默认 60 分钟
  const WATER_INTERVAL_MIN = 5; // T-44：与 store.js 保持一致
  const WATER_INTERVAL_MAX = 240; // T-44：与 store.js 保持一致
  const TODOS_MAX_LENGTH = 100; // T-44：与 store.js TODOS_MAX_LENGTH 一致
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
  // T-43：皮肤列表缓存（来自 petAPI.skin.list）
  let skinItems = [];
  // T-44：主题/减弱动效/效率小组件状态
  let theme = DEFAULT_THEME;
  let reduceMotion = false;
  let waterTimer = null;
  let waterStatusTimer = null;
  let waterNotifiedAt = 0;
  let waterStatusOverrideUntil = 0;

  async function init() {
    cacheElements();
    bindEvents();
    bindSettingsGroups(); // T-48：设置页分组展开/收起
    renderSettingsFooter(); // T-48：页脚版本号
    bindActivityEvents();
    bindWeatherRefreshTriggers();
    subscribeIdle();
    initTts(); // T-23：语音输出能力探测（异步加载系统语音列表）
    // 先加载两份语言包，确保任何文案渲染不会回退到键名
    await window.PetLocales.ready;
    ensureSkinCodexControls(); // T-59：皮肤页“扫描 Codex 宠物目录”入口（index.html 只读，动态注入）
    await restoreSettings();
    void refreshLicense(); // T-40：加载许可证状态并渲染账户/订阅区块
    ensureWindowFeatureControls(); // T-19: 注入窗口行为开关与提示
    void restoreHistory();
    void initMood();
    void initSkins(); // T-43：皮肤列表与当前角色形象
  }

  function cacheElements() {
    elements = {
      petCard: document.getElementById('pet-card'),
      petAvatar: document.getElementById('pet-avatar'),
      chatView: document.getElementById('chat-view'),
      settingsView: document.getElementById('settings-view'),
      moodIndicator: document.getElementById('mood-indicator'),
      moodFace: document.getElementById('mood-face'),
      moodLabel: document.getElementById('mood-label'),
      settingsHome: document.getElementById('settings-home'),
      memoryPage: document.getElementById('memory-page'),
      skinPage: document.getElementById('skin-page'),
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
      toolbarShare: document.getElementById('toolbar-share'),
      shareBtn: document.getElementById('share-btn'),
      shareMenu: document.getElementById('share-menu'),
      shareSave: document.getElementById('share-save'),
      shareCopy: document.getElementById('share-copy'),
      shareStatus: document.getElementById('share-status'),
      settingsBack: document.getElementById('settings-back'),
      memoryManageBtn: document.getElementById('memory-manage-btn'),
      memoryBack: document.getElementById('memory-back'),
      skinManageBtn: document.getElementById('skin-manage-btn'),
      petOverlayEnabled: document.getElementById('pet-overlay-enabled'),
      petOverlayToggleBtn: document.getElementById('pet-overlay-toggle-btn'),
      skinBack: document.getElementById('skin-back'),
      skinList: document.getElementById('skin-list'),
      skinImportBtn: document.getElementById('skin-import-btn'),
      skinStatus: document.getElementById('skin-status'),
      skinCodexImportBtn: null, // T-59：动态注入
      skinCodexResult: null, // T-59：扫描结果分组面板
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
      settingsVersion: document.getElementById('settings-version'),
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
      telemetryEnabled: document.getElementById('telemetry-enabled'),
      telemetryClear: document.getElementById('telemetry-clear'),
      telemetryStatus: document.getElementById('telemetry-status'),
      onboardingTelemetryEnabled: document.getElementById(
        'onboarding-telemetry-enabled'
      ),
      // T-40：账户/订阅区块
      licenseTier: document.getElementById('license-tier'),
      licenseStatus: document.getElementById('license-status'),
      licenseStatusRow: document.getElementById('license-status-row'),
      licenseExpiry: document.getElementById('license-expiry'),
      licenseExpiryRow: document.getElementById('license-expiry-row'),
      licenseQuota: document.getElementById('license-quota'),
      licenseFeatureNeural: document.getElementById('license-feature-neural'),
      licenseFeatureSkin: document.getElementById('license-feature-skin'),
      licenseFeatureTodo: document.getElementById('license-feature-todo'),
      // T-54：设置页“重新查看新手引导”入口（复用 T-20 三步引导覆盖层）
      reviewOnboardingBtn: document.getElementById('review-onboarding-btn'),
      // T-44：主题/减弱动效/效率小组件
      themeSelect: document.getElementById('theme'),
      reduceMotionCheckbox: document.getElementById('reduce-motion'),
      waterEnabled: document.getElementById('water-enabled'),
      waterInterval: document.getElementById('water-interval'),
      waterWidget: document.getElementById('water-widget'),
      waterStatus: document.getElementById('water-status'),
      waterDrink: document.getElementById('water-drink'),
      todosWidget: document.getElementById('todos-widget'),
      todoInput: document.getElementById('todo-input'),
      todoAdd: document.getElementById('todo-add'),
      todoList: document.getElementById('todo-list'),
      todoStatus: document.getElementById('todo-status'),
      // T-40：年龄确认 + 内容合规声明弹窗
      complianceView: document.getElementById('compliance-view'),
      complianceAccept: document.getElementById('compliance-accept'),
      complianceDecline: document.getElementById('compliance-decline'),
      complianceRefused: document.getElementById('compliance-refused')
    };
    showExportStatus = makeStatusShower(elements.exportStatus);
    showShareStatus = makeStatusShower(elements.shareStatus);
    showClearStatus = makeStatusShower(elements.clearStatus);
    showTelemetryStatus = makeStatusShower(elements.telemetryStatus);
    showSkinStatus = makeStatusShower(elements.skinStatus);
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

  /* T-48：设置页三段式——分组展开/收起、升级入口、页脚版本号 */
  function renderSettingsFooter() {
    if (!elements.settingsVersion) {
      return;
    }
    const appVersion =
      window.petAPI && typeof window.petAPI.version === 'string'
        ? window.petAPI.version
        : 'dev';
    elements.settingsVersion.textContent = appVersion;
  }

  function toggleSettingsGroup(toggle) {
    if (!toggle) {
      return;
    }
    const panelId = toggle.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    if (panel) {
      panel.hidden = expanded;
    }
    refreshSettingsGroupTitles();
  }

  /** 分组行 tooltip 随展开态切换（语言切换后由 applyStaticText 重新同步） */
  function refreshSettingsGroupTitles() {
    const t = window.PetLocales.createTranslator(currentLocale);
    document.querySelectorAll('.settings-group-toggle').forEach((toggle) => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.title = t(
        expanded ? 'settings.groupCollapseHint' : 'settings.groupExpandHint'
      );
    });
  }

  function bindSettingsGroups() {
    document.querySelectorAll('.settings-group-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => toggleSettingsGroup(toggle));
    });
    refreshSettingsGroupTitles();
  }

  function bindEvents() {
    elements.chatForm.addEventListener('submit', handleSubmit);
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.closeBtn.addEventListener('click', hideToTray);
    elements.minimizeBtn.addEventListener('click', minimizeWindow);
    elements.exportBtn.addEventListener('click', toggleExportMenu);
    elements.shareBtn.addEventListener('click', toggleShareMenu);
    elements.shareSave.addEventListener('click', () => void saveShareCard());
    elements.shareCopy.addEventListener('click', () => void copyShareCard());
    elements.settingsBack.addEventListener('click', showChatView);
    elements.memoryManageBtn.addEventListener('click', openMemoryView);
    elements.memoryBack.addEventListener('click', closeMemoryView);
    elements.skinManageBtn.addEventListener('click', openSkinView);
    if (elements.petOverlayToggleBtn) {
      elements.petOverlayToggleBtn.addEventListener('click', () => {
        pokeActivity();
        void togglePetOverlay();
      });
    }
    if (elements.petOverlayEnabled) {
      elements.petOverlayEnabled.addEventListener('change', () => {
        const enabled = elements.petOverlayEnabled.checked;
        currentSettings = { ...currentSettings, petOverlayEnabled: enabled };
        void applyPetOverlayEnabled(enabled);
      });
    }
    elements.skinBack.addEventListener('click', closeSkinView);
    elements.skinImportBtn.addEventListener('click', () => void handleSkinImport());
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
    // T-44：主题/减弱动效即时生效并持久化
    elements.themeSelect.addEventListener('change', () => {
      theme = elements.themeSelect.value === 'light' ? 'light' : 'dark';
      applyTheme();
      persistT44Preferences({ theme });
    });
    elements.reduceMotionCheckbox.addEventListener('change', () => {
      reduceMotion = elements.reduceMotionCheckbox.checked;
      applyTheme();
      persistT44Preferences({ reduceMotion });
    });
    // T-44：喝水提醒（开关即时生效，间隔随保存设置写入）
    elements.waterEnabled.addEventListener('change', () => {
      const wr = waterReminderSettings(currentSettings);
      currentSettings = {
        ...currentSettings,
        waterReminder: { ...wr, enabled: elements.waterEnabled.checked }
      };
      syncWaterWidget();
      persistT44Preferences({ waterReminder: currentSettings.waterReminder });
    });
    elements.waterDrink.addEventListener('click', () => void recordWaterDrink());
    // T-44：待办输入
    elements.todoAdd.addEventListener('click', addTodo);
    elements.todoInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTodo();
      }
    });
    elements.todoList.addEventListener('click', handleTodoListClick);
    elements.ttsVoicePackEnabled.addEventListener(
      'change',
      updateTtsVoicePackControls
    );
    elements.telemetryClear.addEventListener('click', () => {
      void handleTelemetryClear();
    });
    if (elements.reviewOnboardingBtn) {
      elements.reviewOnboardingBtn.addEventListener('click', showOnboarding);
    }
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
    // T-45：点击分享菜单外关闭；Escape 关闭并归还焦点
    document.addEventListener('click', (event) => {
      if (!elements.shareMenu || elements.shareMenu.hidden) {
        return;
      }
      const wrap = elements.toolbarShare;
      if (!wrap || !wrap.contains(event.target)) {
        closeShareMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        elements.shareMenu &&
        !elements.shareMenu.hidden
      ) {
        closeShareMenu();
        if (elements.shareBtn) {
          elements.shareBtn.focus();
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
    // T-55：`/pet` 命令切换宠物浮窗（Codex Pets 式），不发送给 AI
    if (/^\/pet\b/i.test(text)) {
      void togglePetOverlay();
      return;
    }
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
    let replyOk = false;
    let cancelled = false;
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
        replyOk = Boolean(result && result.ok);
        cancelled = result && result.error === '已取消';
        applyStreamResult(result, bubble, received, t);
      } else {
        // 兼容旧契约：无流式通道时走非流式发送
        const result = await window.petAPI.chat.send({ text });
        replyOk = Boolean(result && result.ok);
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
      // T-55：把聊天状态同步给宠物浮窗（气泡文案由浮窗本地化）
      reportPetStatus(cancelled ? 'idle' : replyOk ? 'ready' : 'failed');
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
    attachMessageShareGesture(item); // T-45：长按/右键唤起分享菜单
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
    // T-57：朗读结束/失败恢复 idle
    reportPetStatus('idle');
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
    // T-57：停止朗读恢复 idle
    reportPetStatus('idle');
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
    // T-57：TTS 朗读中上报浮窗 speaking 状态
    reportPetStatus('speaking');
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

  /* ---------------- T-44：主题 / 减弱动效 / 效率小组件 ---------------- */

  /** 把 theme/reduceMotion 写到 html 根节点，驱动 CSS 变量与动效开关 */
  function applyTheme() {
    if (!document.documentElement) {
      return;
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }

  /** 主题/动效/喝水开关即时生效并持久化；petAPI 缺失时降级 localStorage */
  function persistT44Preferences(patch) {
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function'
        ? window.petAPI.settings
        : null;
    if (!settingsApi) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, ...patch }));
      } catch (_error) {
        // 本地存储不可用时仅本次会话生效
      }
      return;
    }
    void settingsApi
      .set(patch)
      .then((saved) => {
        if (saved && typeof saved === 'object') {
          currentSettings = { ...currentSettings, ...saved };
        }
      })
      .catch((error) => {
        console.warn('保存主题/动效偏好失败：', error);
      });
  }

  /** 喝水提醒设置规范化（enabled / 5~240 分钟 / lastDrinkAt） */
  function waterReminderSettings(settings) {
    const wr =
      settings &&
      settings.waterReminder &&
      typeof settings.waterReminder === 'object'
        ? settings.waterReminder
        : {};
    const interval = Math.round(Number(wr.intervalMinutes));
    return {
      enabled: wr.enabled === true,
      intervalMinutes: Number.isFinite(interval)
        ? Math.min(WATER_INTERVAL_MAX, Math.max(WATER_INTERVAL_MIN, interval))
        : WATER_INTERVAL_DEFAULT,
      lastDrinkAt:
        Number.isFinite(Number(wr.lastDrinkAt)) && Number(wr.lastDrinkAt) > 0
          ? Number(wr.lastDrinkAt)
          : 0
    };
  }

  function nextWaterTime(wr) {
    const last = wr.lastDrinkAt > 0 ? wr.lastDrinkAt : Date.now();
    return last + wr.intervalMinutes * 60 * 1000;
  }

  function formatClockTime(ts) {
    return new Date(ts).toLocaleTimeString(
      currentLocale === 'en' ? 'en-US' : 'zh-CN',
      { hour: '2-digit', minute: '2-digit' }
    );
  }

  function showWaterStatus(text, type) {
    if (!elements.waterStatus) {
      return;
    }
    waterStatusOverrideUntil = Date.now() + 4000;
    elements.waterStatus.textContent = text;
    elements.waterStatus.dataset.type = type || '';
    clearTimeout(waterStatusTimer);
    waterStatusTimer = setTimeout(() => {
      elements.waterStatus.textContent = '';
      syncWaterWidget();
    }, 4000);
  }

  /** 到点提醒：每 60 秒最多弹一次系统通知，失败静默降级为面板提示 */
  function maybeNotifyWaterDue(t) {
    const now = Date.now();
    if (waterNotifiedAt > now - 60 * 1000) {
      return;
    }
    waterNotifiedAt = now;
    if (typeof window.Notification !== 'function') {
      return;
    }
    try {
      if (
        window.Notification.permission === 'granted' ||
        window.Notification.permission === 'default'
      ) {
        const notice = new window.Notification(t('water.notificationTitle'), {
          body: t('water.notificationBody')
        });
        setTimeout(() => notice.close(), 10000);
      }
    } catch (_error) {
      // 通知不可用时面板提醒仍可见
    }
  }

  /** 渲染喝水状态并保持检查定时器；记录后 4 秒内不覆盖“已记录”文案 */
  function syncWaterWidget() {
    if (!elements.waterWidget) {
      return;
    }
    const wr = waterReminderSettings(currentSettings);
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.waterWidget.hidden = !wr.enabled;
    clearInterval(waterTimer);
    if (wr.enabled) {
      waterTimer = setInterval(syncWaterWidget, WATER_CHECK_MS);
    }
    if (!wr.enabled || Date.now() < waterStatusOverrideUntil) {
      return;
    }
    const next = nextWaterTime(wr);
    if (Date.now() >= next) {
      elements.waterStatus.textContent = t('water.due');
      elements.waterStatus.dataset.type = 'ok';
      maybeNotifyWaterDue(t);
    } else {
      elements.waterStatus.textContent = t('water.next', {
        time: formatClockTime(next)
      });
      elements.waterStatus.dataset.type = '';
    }
  }

  /** 记录喝水：写入最近喝水时间并持久化 */
  async function recordWaterDrink() {
    if (!elements.waterDrink) {
      return;
    }
    const wr = waterReminderSettings(currentSettings);
    const next = { ...wr, lastDrinkAt: Date.now() };
    currentSettings = { ...currentSettings, waterReminder: next };
    const t = window.PetLocales.createTranslator(currentLocale);
    showWaterStatus(t('water.recorded'), 'ok');
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function'
        ? window.petAPI.settings
        : null;
    if (!settingsApi) {
      return;
    }
    try {
      const saved = await settingsApi.set({ waterReminder: next });
      if (saved && typeof saved === 'object') {
        currentSettings = { ...currentSettings, waterReminder: saved.waterReminder };
      }
    } catch (error) {
      console.warn('保存喝水提醒失败：', error);
    }
  }

  /** 待办读取与渲染（Pro 门控） */
  function todosFromSettings(settings) {
    return Array.isArray(settings && settings.todos) ? settings.todos : [];
  }

  function makeTodoId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function showTodoStatus(text, type) {
    if (!elements.todoStatus) {
      return;
    }
    elements.todoStatus.textContent = text;
    elements.todoStatus.dataset.type = type || '';
    elements.todoStatus.hidden = false;
    clearTimeout(showTodoStatus._timer);
    showTodoStatus._timer = setTimeout(() => {
      elements.todoStatus.hidden = true;
    }, 4000);
  }

  function renderTodos(items) {
    if (!elements.todosWidget || !elements.todoList) {
      return;
    }
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.todosWidget.hidden = !licenseTierIsPaid();
    elements.todoList.textContent = '';
    if (!items || items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'todo-empty';
      empty.textContent = t('todos.empty');
      elements.todoList.appendChild(empty);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      li.className = `todo-item${item.done ? ' is-done' : ''}`;
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'todo-check';
      check.checked = item.done === true;
      check.setAttribute(
        'aria-label',
        t(item.done ? 'todos.undoAria' : 'todos.doneAria')
      );
      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = item.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'todo-delete';
      del.textContent = '✕';
      del.setAttribute('aria-label', t('todos.delete'));
      li.append(check, text, del);
      elements.todoList.appendChild(li);
    }
  }

  function handleTodoListClick(event) {
    const itemEl = event.target.closest('.todo-item');
    if (!itemEl || !elements.todoList) {
      return;
    }
    const items = todosFromSettings(currentSettings);
    const index = Array.prototype.indexOf.call(elements.todoList.children, itemEl);
    if (index < 0 || index >= items.length) {
      return;
    }
    if (event.target.classList.contains('todo-delete')) {
      const next = items.filter((_item, i) => i !== index);
      void saveTodos(next);
    } else if (event.target.classList.contains('todo-check')) {
      const done = event.target.checked;
      const next = items.map((item, i) =>
        i === index
          ? {
              ...item,
              done,
              completedAt: done ? Date.now() : 0
            }
          : item
      );
      void saveTodos(next);
    }
  }

  async function saveTodos(next) {
    currentSettings = { ...currentSettings, todos: next };
    renderTodos(next);
    const settingsApi =
      window.petAPI &&
      window.petAPI.settings &&
      typeof window.petAPI.settings.set === 'function'
        ? window.petAPI.settings
        : null;
    if (!settingsApi) {
      return;
    }
    try {
      const saved = await settingsApi.set({ todos: next });
      if (saved && typeof saved === 'object') {
        currentSettings = { ...currentSettings, todos: saved.todos };
        renderTodos(currentSettings.todos);
      }
    } catch (error) {
      console.warn('保存待办失败：', error);
    }
  }

  function addTodo() {
    if (!elements.todoInput) {
      return;
    }
    const text = elements.todoInput.value.trim();
    if (!text) {
      return;
    }
    const items = todosFromSettings(currentSettings);
    if (items.length >= TODOS_MAX_LENGTH) {
      const t = window.PetLocales.createTranslator(currentLocale);
      showTodoStatus(t('todos.limit'), 'error');
      return;
    }
    const next = [
      ...items,
      {
        id: makeTodoId(),
        text: text.slice(0, 200),
        done: false,
        createdAt: Date.now(),
        completedAt: 0
      }
    ];
    elements.todoInput.value = '';
    void saveTodos(next);
  }

  /** 许可证变化/语言切换/设置恢复后同步小组件（待办/喝水）的可见性与内容 */
  function updateWidgetVisibility() {
    renderTodos(todosFromSettings(currentSettings));
    syncWaterWidget();
  }

  /* 设置页 */
  function showSettingsView() {
    elements.chatView.hidden = true;
    elements.settingsView.hidden = false;
    elements.settingsHome.hidden = false;
    elements.memoryPage.hidden = true;
    elements.skinPage.hidden = true;
    elements.settingsBack.focus();
  }

  function showChatView() {
    elements.settingsView.hidden = true;
    elements.memoryPage.hidden = true;
    elements.skinPage.hidden = true;
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

  /* ---------------- T-43：皮肤与配件（设置页子页 + 标题栏角色形象） ---------------- */

  function hasSkinApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.skin &&
        typeof window.petAPI.skin.list === 'function' &&
        typeof window.petAPI.skin.apply === 'function'
    );
  }

  function appliedSkinId() {
    return currentSettings && typeof currentSettings.skinId === 'string'
      ? currentSettings.skinId
      : 'default';
  }

  /** 启动时加载皮肤列表并同步标题栏角色形象（petAPI 缺失时静默跳过） */
  async function initSkins() {
    if (!hasSkinApi()) {
      return;
    }
    await refreshSkins();
  }

  /** 刷新皮肤列表缓存；皮肤页打开时重绘列表，并同步标题栏角色形象 */
  async function refreshSkins() {
    if (!hasSkinApi()) {
      return;
    }
    try {
      const result = await window.petAPI.skin.list();
      if (result && result.ok && Array.isArray(result.skins)) {
        skinItems = result.skins;
        const appliedId =
          result.appliedId && typeof result.appliedId === 'string'
            ? result.appliedId
            : 'default';
        currentSettings = { ...currentSettings, skinId: appliedId };
      }
    } catch (error) {
      console.warn('加载皮肤列表失败：', error);
    }
    updatePetAvatar();
    if (elements.skinPage && !elements.skinPage.hidden) {
      renderSkinList();
    }
  }

  function openSkinView() {
    elements.settingsHome.hidden = true;
    elements.memoryPage.hidden = true;
    elements.skinPage.hidden = false;
    elements.skinBack.focus();
    void refreshSkins();
  }

  function closeSkinView() {
    elements.skinPage.hidden = true;
    elements.settingsHome.hidden = false;
    elements.settingsBack.focus();
  }

  /** T-59：动态注入 Codex 宠物目录扫描按钮与结果面板（index.html 只读，不改静态页） */
  function ensureSkinCodexControls() {
    if (!elements.skinPage || !elements.skinImportBtn) {
      return;
    }
    if (!elements.skinCodexImportBtn) {
      const btn = document.createElement('button');
      btn.id = 'skin-codex-import-btn';
      btn.type = 'button';
      btn.className = 'secondary-btn skin-action-btn';
      btn.addEventListener('click', () => void handleSkinCodexImport());
      elements.skinImportBtn.insertAdjacentElement('afterend', btn);
      elements.skinCodexImportBtn = btn;
    }
    if (!elements.skinCodexResult) {
      const panel = document.createElement('p');
      panel.id = 'skin-codex-result';
      panel.className = 'settings-status';
      panel.setAttribute('role', 'status');
      panel.hidden = true;
      elements.skinStatus.insertAdjacentElement('afterend', panel);
      elements.skinCodexResult = panel;
    }
    updateSkinCodexButtonLabel();
  }

  /** T-59：语言切换时刷新扫描按钮文案 */
  function updateSkinCodexButtonLabel() {
    if (!elements.skinCodexImportBtn) {
      return;
    }
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.skinCodexImportBtn.textContent = t('skin.scanCodexPets');
  }

  /* T-55：宠物浮窗 API（Codex Pets 式） */

  function hasPetOverlayApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.petOverlay &&
        typeof window.petAPI.petOverlay.setStatus === 'function' &&
        typeof window.petAPI.petOverlay.toggle === 'function'
    );
  }

  function reportPetStatus(state, text) {
    if (!hasPetOverlayApi()) {
      return;
    }
    window.petAPI.petOverlay
      .setStatus({ state, text: text || '' })
      .catch((error) => {
        console.warn('上报宠物浮窗状态失败：', error);
      });
  }

  async function togglePetOverlay() {
    if (!hasPetOverlayApi()) {
      return;
    }
    try {
      const result = await window.petAPI.petOverlay.toggle();
      if (result && typeof result.enabled === 'boolean') {
        if (elements.petOverlayEnabled) {
          elements.petOverlayEnabled.checked = result.enabled;
        }
        currentSettings = { ...currentSettings, petOverlayEnabled: result.enabled };
      }
    } catch (error) {
      console.warn('切换宠物浮窗失败：', error);
    }
  }

  /** 设置页开关：立即显示/隐藏浮窗并持久化 */
  async function applyPetOverlayEnabled(enabled) {
    const api =
      window.petAPI &&
      window.petAPI.petOverlay &&
      typeof window.petAPI.petOverlay.setEnabled === 'function'
        ? window.petAPI.petOverlay
        : null;
    if (!api) {
      return;
    }
    try {
      const result = await api.setEnabled({ enabled });
      if (result && typeof result.enabled === 'boolean') {
        currentSettings = { ...currentSettings, petOverlayEnabled: result.enabled };
      }
    } catch (error) {
      console.warn('应用宠物浮窗开关失败：', error);
      if (elements.petOverlayEnabled) {
        elements.petOverlayEnabled.checked = currentSettings.petOverlayEnabled === true;
      }
    }
  }

  /** 皮肤变更后刷新浮窗角色资源 */
  function refreshPetOverlaySkin() {
    const api =
      window.petAPI &&
      window.petAPI.petOverlay &&
      typeof window.petAPI.petOverlay.refreshSkin === 'function'
        ? window.petAPI.petOverlay
        : null;
    if (api) {
      api.refreshSkin().catch((error) => {
        console.warn('刷新宠物浮窗皮肤失败：', error);
      });
    }
  }

  /** 标题栏角色形象：按 settings.skinId 取角色资源；图集皮肤以 CSS 裁切首帧循环 */
  function updatePetAvatar() {
    if (!elements.petAvatar) {
      return;
    }
    const id = appliedSkinId();
    const skin =
      skinItems.find((item) => item.id === id) ||
      skinItems.find((item) => item.id === 'default');
    const atlas =
      skin && skin.spritesheetDataUrl && skin.atlas
        ? {
            url: skin.spritesheetDataUrl,
            cols: skin.atlas.cols,
            rows: skin.atlas.rows
          }
        : null;
    if (atlas) {
      elements.petAvatar.hidden = false;
      elements.petAvatar.removeAttribute('src');
      elements.petAvatar.classList.add('is-atlas');
      elements.petAvatar.style.backgroundImage = `url("${atlas.url}")`;
      elements.petAvatar.style.backgroundSize = `${atlas.cols * 100}% ${atlas.rows * 100}%`;
      elements.petAvatar.style.backgroundRepeat = 'no-repeat';
      elements.petAvatar.alt = skin.name || '';
      return;
    }
    elements.petAvatar.classList.remove('is-atlas');
    elements.petAvatar.style.backgroundImage = '';
    const asset = skin && skin.roleAssets && skin.roleAssets.idle;
    if (asset) {
      elements.petAvatar.src = asset;
      elements.petAvatar.alt = skin.name || '';
      elements.petAvatar.hidden = false;
    } else {
      elements.petAvatar.removeAttribute('src');
      elements.petAvatar.hidden = true;
    }
  }

  /** T-59：图集 9 行预览的文案键（Codex pet.json 8 列×9 行约定） */
  const SKIN_ATLAS_ROW_LABELS = [
    'previewRowIdle',
    'previewRowUnknown',
    'previewRowUnknown',
    'previewRowHappy',
    'previewRowExcited',
    'previewRowFailed',
    'previewRowWaiting',
    'previewRowWorking',
    'previewRowReady'
  ];

  function renderSkinList() {
    const t = window.PetLocales.createTranslator(currentLocale);
    elements.skinList.textContent = '';
    if (skinItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'skin-empty';
      empty.textContent = t('skin.empty');
      elements.skinList.appendChild(empty);
      return;
    }
    const id = appliedSkinId();
    for (const skin of skinItems) {
      const isApplied = skin.id === id;
      const card = document.createElement('div');
      card.className = 'skin-card';
      card.dataset.id = skin.id;
      if (isApplied) {
        card.classList.add('is-applied');
      }

      const preview = document.createElement('div');
      preview.className = 'skin-preview';
      if (skin.atlas && skin.spritesheetDataUrl) {
        // T-59：图集皮肤展示 9 行状态预览条（每行一帧动画循环）
        const rowsBox = document.createElement('div');
        rowsBox.className = 'skin-preview-atlas-rows';
        rowsBox.setAttribute('role', 'img');
        rowsBox.setAttribute(
          'aria-label',
          t('skin.previewRows', { name: skin.name || skin.id })
        );
        rowsBox.style.gridTemplateRows = `repeat(${skin.atlas.rows}, 1fr)`;
        for (let row = 0; row < skin.atlas.rows; row += 1) {
          const cell = document.createElement('div');
          cell.className = 'skin-preview-atlas-row';
          cell.style.backgroundImage = `url("${skin.spritesheetDataUrl}")`;
          cell.style.backgroundSize = `${skin.atlas.cols * 100}% ${skin.atlas.rows * 100}%`;
          cell.style.backgroundPosition = `0% ${
            (row * 100) / (skin.atlas.rows - 1)
          }%`;
          const labelKey =
            SKIN_ATLAS_ROW_LABELS[row] || 'previewRowUnknown';
          cell.title = t(`skin.${labelKey}`, {
            row: row + 1,
            rows: skin.atlas.rows
          });
          rowsBox.appendChild(cell);
        }
        preview.appendChild(rowsBox);
      } else if (skin.previewDataUrl) {
        const img = document.createElement('img');
        img.src = skin.previewDataUrl;
        img.alt = skin.name || skin.id;
        img.loading = 'lazy';
        preview.appendChild(img);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'skin-preview-empty';
        placeholder.textContent = t('skin.noPreview');
        preview.appendChild(placeholder);
      }

      const info = document.createElement('div');
      info.className = 'skin-info';
      const nameRow = document.createElement('div');
      nameRow.className = 'skin-name-row';
      const name = document.createElement('span');
      name.className = 'skin-name';
      name.textContent = skin.name || skin.id;
      nameRow.appendChild(name);
      if (isApplied) {
        const badge = document.createElement('span');
        badge.className = 'skin-badge';
        badge.textContent = t('skin.applied');
        nameRow.appendChild(badge);
      }
      const meta = document.createElement('div');
      meta.className = 'skin-meta';
      const tag = skin.builtin ? t('skin.builtin') : t('skin.installed');
      const kindTag = skin.atlas ? t('skin.animated') : '';
      meta.textContent = `${skin.version || '?'} · ${skin.author || '-'} · ${tag}${
        kindTag ? ` · ${kindTag}` : ''
      }`;

      const actions = document.createElement('div');
      actions.className = 'skin-card-actions';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = isApplied ? 'skin-btn' : 'skin-btn skin-btn-primary';
      applyBtn.textContent = isApplied ? t('skin.applied') : t('skin.apply');
      applyBtn.disabled = isApplied;
      applyBtn.addEventListener('click', () => void applySkin(skin.id));
      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'skin-btn';
      exportBtn.textContent = t('skin.export');
      exportBtn.addEventListener('click', () => void exportSkin(skin.id));
      actions.append(applyBtn, exportBtn);
      if (!skin.builtin) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'skin-btn skin-btn-danger';
        removeBtn.textContent = t('skin.remove');
        removeBtn.addEventListener('click', () => void removeSkin(skin.id));
        actions.appendChild(removeBtn);
      }

      info.append(nameRow, meta, actions);
      card.append(preview, info);
      elements.skinList.appendChild(card);
    }
  }

  /** T-59：按错误文案分组导入失败项（可读化，同一原因合并展示） */
  function groupSkinImportFailures(failed) {
    const groups = new Map();
    for (const item of Array.isArray(failed) ? failed : []) {
      const error =
        item && typeof item.error === 'string' && item.error.trim()
          ? item.error
          : 'unknown';
      const name = item && typeof item.name === 'string' && item.name
        ? item.name
        : '?';
      if (!groups.has(error)) {
        groups.set(error, []);
      }
      groups.get(error).push(name);
    }
    return [...groups.entries()]
      .map(([error, names]) => ({ error, names }))
      .sort((a, b) => b.names.length - a.names.length);
  }

  /** T-59：渲染扫描导入结果（成功数 + 失败原因分组） */
  function renderSkinCodexResult(result) {
    const t = window.PetLocales.createTranslator(currentLocale);
    const panel = elements.skinCodexResult;
    if (!panel) {
      return;
    }
    const imported = Array.isArray(result.imported) ? result.imported.length : 0;
    const failed = Array.isArray(result.failed) ? result.failed : [];
    if (imported === 0 && failed.length === 0) {
      showSkinStatus(t('skin.scanCodexPetsNone'), 'ok');
      return;
    }
    const parts = [];
    if (imported > 0) {
      parts.push(t('skin.scanCodexPetsSuccess', { imported }));
    }
    if (failed.length > 0) {
      parts.push(t('skin.scanCodexPetsFailed', { failed: failed.length }));
    }
    const groups = groupSkinImportFailures(failed);
    panel.textContent = '';
    panel.dataset.type = failed.length > 0 ? 'error' : 'ok';
    panel.hidden = false;
    const summary = document.createElement('span');
    summary.className = 'skin-codex-summary';
    summary.textContent = parts.join('；');
    panel.appendChild(summary);
    if (groups.length > 0) {
      const list = document.createElement('ul');
      list.className = 'skin-codex-failures';
      for (const group of groups) {
        const item = document.createElement('li');
        const names =
          group.names.length > 3
            ? `${group.names.slice(0, 3).join('、')}…`
            : group.names.join('、');
        item.textContent = `${group.error}（${names}）`;
        list.appendChild(item);
      }
      panel.appendChild(list);
    }
  }

  /** T-59：扫描 Codex 宠物目录（缺省目录或用户自选目录）批量导入 */
  async function handleSkinCodexImport() {
    const t = window.PetLocales.createTranslator(currentLocale);
    const api =
      window.petAPI &&
      window.petAPI.skin &&
      typeof window.petAPI.skin.importCodexPets === 'function'
        ? window.petAPI.skin
        : null;
    if (!api) {
      showSkinStatus(t('skin.unavailable'), 'error');
      return;
    }
    elements.skinCodexImportBtn.disabled = true;
    try {
      const result = await api.importCodexPets({});
      if (result && result.ok) {
        renderSkinCodexResult(result);
        await refreshSkins();
      } else if (result && result.error === 'cancelled') {
        showSkinStatus(t('skin.importCancelled'), 'ok');
      } else {
        showSkinStatus(
          t('skin.scanCodexPetsError', {
            error: result && result.error ? result.error : 'unknown'
          }),
          'error'
        );
      }
    } catch (error) {
      showSkinStatus(
        t('skin.scanCodexPetsError', { error: formatErrorMessage(error) }),
        'error'
      );
    } finally {
      elements.skinCodexImportBtn.disabled = false;
    }
  }

  async function applySkin(id) {
    const t = window.PetLocales.createTranslator(currentLocale);
    const skin = skinItems.find((item) => item.id === id);
    const displayName = (skin && skin.name) || id;
    try {
      const result = await window.petAPI.skin.apply({ id });
      if (result && result.ok && result.settings) {
        currentSettings = result.settings;
        showSkinStatus(t('skin.applySuccess', { name: displayName }), 'ok');
        await refreshSkins();
        refreshPetOverlaySkin(); // T-55：皮肤变更同步到浮窗
      } else {
        showSkinStatus(
          t('skin.applyError', {
            error: result && result.error ? result.error : 'unknown'
          }),
          'error'
        );
      }
    } catch (error) {
      showSkinStatus(
        t('skin.applyError', { error: formatErrorMessage(error) }),
        'error'
      );
    }
  }

  async function handleSkinImport() {
    const t = window.PetLocales.createTranslator(currentLocale);
    const api =
      window.petAPI &&
      window.petAPI.skin &&
      typeof window.petAPI.skin.import === 'function'
        ? window.petAPI.skin
        : null;
    if (!api) {
      showSkinStatus(t('skin.unavailable'), 'error');
      return;
    }
    elements.skinImportBtn.disabled = true;
    try {
      const result = await api.import({});
      if (result && result.ok && result.skin) {
        showSkinStatus(
          t('skin.importSuccess', {
            name: result.skin.name || result.skin.id
          }),
          'ok'
        );
        await refreshSkins();
      } else if (result && result.error === 'cancelled') {
        showSkinStatus(t('skin.importCancelled'), 'ok');
      } else {
        showSkinStatus(
          t('skin.importError', {
            error: result && result.error ? result.error : 'unknown'
          }),
          'error'
        );
      }
    } catch (error) {
      showSkinStatus(
        t('skin.importError', { error: formatErrorMessage(error) }),
        'error'
      );
    } finally {
      elements.skinImportBtn.disabled = false;
    }
  }

  async function exportSkin(id) {
    const t = window.PetLocales.createTranslator(currentLocale);
    const api =
      window.petAPI &&
      window.petAPI.skin &&
      typeof window.petAPI.skin.export === 'function'
        ? window.petAPI.skin
        : null;
    if (!api) {
      showSkinStatus(t('skin.unavailable'), 'error');
      return;
    }
    try {
      const result = await api.export({ id });
      if (result && result.ok && result.path) {
        showSkinStatus(t('skin.exportSuccess', { path: result.path }), 'ok');
      } else if (result && result.error === 'cancelled') {
        showSkinStatus(t('skin.exportCancelled'), 'ok');
      } else {
        showSkinStatus(
          t('skin.exportError', {
            error: result && result.error ? result.error : 'unknown'
          }),
          'error'
        );
      }
    } catch (error) {
      showSkinStatus(
        t('skin.exportError', { error: formatErrorMessage(error) }),
        'error'
      );
    }
  }

  async function removeSkin(id) {
    const t = window.PetLocales.createTranslator(currentLocale);
    const skin = skinItems.find((item) => item.id === id);
    const api =
      window.petAPI &&
      window.petAPI.skin &&
      typeof window.petAPI.skin.remove === 'function'
        ? window.petAPI.skin
        : null;
    if (!api) {
      showSkinStatus(t('skin.unavailable'), 'error');
      return;
    }
    try {
      const result = await api.remove({ id });
      if (result && result.ok) {
        showSkinStatus(
          t('skin.removeSuccess', {
            name: (skin && skin.name) || id
          }),
          'ok'
        );
        await refreshSkins();
      } else {
        showSkinStatus(
          t('skin.removeError', {
            error: result && result.error ? result.error : 'unknown'
          }),
          'error'
        );
      }
    } catch (error) {
      showSkinStatus(
        t('skin.removeError', { error: formatErrorMessage(error) }),
        'error'
      );
    }
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
        telemetryEnabled: saved.telemetryEnabled === true,
        petOverlayEnabled: saved.petOverlayEnabled === true,
        theme: saved.theme === 'light' ? 'light' : 'dark',
        reduceMotion: saved.reduceMotion === true,
        waterReminder: saved.waterReminder,
        todos: saved.todos
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
    refreshSettingsGroupTitles(); // T-48：分组展开提示随语言与展开态刷新

    elements.headerTitle.textContent = currentPetName;
    renderServiceStatus();
    applyOnboardingText(); // T-20：引导与人格模板静态文案（内联双语）
    applyWeatherText(); // T-22：语言切换后重绘天气动态文案
    applyWeatherCollapsed(); // T-24：语言切换后刷新折叠按钮文案
    updateSkinCodexButtonLabel(); // T-59：语言切换后刷新扫描按钮文案
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
    elements.telemetryEnabled.checked = currentSettings.telemetryEnabled === true;
    if (elements.petOverlayEnabled) {
      elements.petOverlayEnabled.checked =
        currentSettings.petOverlayEnabled === true;
    }
    // T-44：主题/减弱动效/喝水/待办
    theme = currentSettings.theme === 'light' ? 'light' : 'dark';
    reduceMotion = currentSettings.reduceMotion === true;
    elements.themeSelect.value = theme;
    elements.reduceMotionCheckbox.checked = reduceMotion;
    applyTheme();
    const water = waterReminderSettings(currentSettings);
    elements.waterEnabled.checked = water.enabled;
    elements.waterInterval.value = String(water.intervalMinutes);

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
    updatePetAvatar(); // T-43：皮肤 id 变化时同步标题栏角色形象
    if (elements.skinPage && !elements.skinPage.hidden) {
      renderSkinList(); // T-43：语言切换时重绘皮肤列表动态文案
    }

    applyStaticText();
    applyWindowFeatureSettings(currentSettings); // T-19
    updateWindowFeatureText(); // T-19: 语言切换后刷新提示文案
    applyLicenseUi(); // T-40：许可证档位/门控/额度随设置与语言刷新
    syncComplianceVisibility(); // T-40：合规弹窗状态
    syncOnboardingVisibility(); // T-20：首次启动引导（完成标志持久化）
    applyComplianceLock(); // T-40：拒绝合规后锁定 AI 对话
    updateWidgetVisibility(); // T-44：效率小组件随设置/门控/语言刷新
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
        telemetryEnabled: elements.telemetryEnabled.checked,
        petOverlayEnabled: elements.petOverlayEnabled.checked,
        theme,
        reduceMotion,
        waterReminder: {
          ...waterReminderSettings(currentSettings),
          intervalMinutes: Number(elements.waterInterval.value)
        },
        todos: todosFromSettings(currentSettings)
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
        ttsVoicePackEnabled: elements.ttsVoicePackEnabled.checked,
        ttsVoicePackId: elements.ttsVoicePackId.value.trim(),
        weatherEnabled: elements.weatherEnabled.checked,
        weatherCity: elements.weatherCity.value.trim(),
        telemetryEnabled: elements.telemetryEnabled.checked,
        petOverlayEnabled: elements.petOverlayEnabled.checked,
        theme,
        reduceMotion,
        waterReminder: {
          ...waterReminderSettings(currentSettings),
          intervalMinutes: Number(elements.waterInterval.value)
        },
        todos: todosFromSettings(currentSettings)
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

    // Pro 专属功能门控：高级神经语音始终可见（锁定态），皮肤/待办仅付费档显示
    if (elements.licenseFeatureNeural) {
      elements.licenseFeatureNeural.textContent = paid
        ? t('license.featureNeuralVoice')
        : t('license.featureLocked', { name: t('license.featureNeuralVoice') });
      elements.licenseFeatureNeural.classList.toggle('locked', !paid);
    }
    if (elements.licenseFeatureSkin) {
      elements.licenseFeatureSkin.hidden = !paid;
    }
    if (elements.licenseFeatureTodo) {
      elements.licenseFeatureTodo.hidden = !paid;
    }

    updateTtsVoicePackControls(); // 免费版锁定高级神经语音
    updateWidgetVisibility(); // T-44：待办按付费档显示，喝水提醒随设置
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
    elements.onboardingTelemetryEnabled.checked =
      currentSettings.telemetryEnabled === true;
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
      onboardingDone: true,
      telemetryEnabled: elements.onboardingTelemetryEnabled.checked
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

  /* ---------------- T-45：应用内分享（对话卡片 Canvas 渲染 + 保存/复制） ---------------- */

  const SHARE_CARD_WIDTH = 1080;
  const SHARE_CARD_HEIGHT = 1350; // 4:5 竖版，适配小红书/朋友圈/B 站动态
  const SHARE_CARD_MAX_MESSAGES = 6;
  const SHARE_CARD_MAX_CHARS = 240;
  const SHARE_LONG_PRESS_MS = 600;

  let sharePressTimer = null;

  function hasShareApi() {
    return Boolean(
      window.petAPI &&
        window.petAPI.share &&
        typeof window.petAPI.share.saveCard === 'function' &&
        typeof window.petAPI.share.copyCard === 'function'
    );
  }

  /** T-45：脱敏——隐藏 API Key/令牌/本地路径等敏感信息后再入卡片。 */
  function sanitizeShareText(text) {
    const t = window.PetLocales.createTranslator(currentLocale);
    let value = String(text || '');
    value = value.replace(/(sk-[A-Za-z0-9_-]{8,})/g, t('share.maskedText'));
    value = value.replace(/\b(?:api[_-]?key|api key|apikey)\b/gi, t('share.maskedText'));
    value = value.replace(
      /(?:api[_-]?key|apikey)\s*[:=]\s*[^\s,，;；]+/gi,
      t('share.maskedText')
    );
    value = value.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, t('share.maskedText'));
    value = value.replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, t('share.maskedPath'));
    value = value.replace(/(?:\/home|\/Users)\/[^\s]+/g, t('share.maskedPath'));
    return value.replace(/\s+/g, ' ').trim();
  }

  /** 选取最近几条可分享消息（跳过空消息与“正在思考…”占位）。 */
  function pickShareMessages() {
    const t = window.PetLocales.createTranslator(currentLocale);
    const thinking = t('chat.thinking');
    const candidates = messages.filter((item) => {
      if (!item || (item.role !== 'user' && item.role !== 'assistant')) {
        return false;
      }
      const content =
        typeof item.content === 'string' ? item.content.trim() : '';
      return content && content !== thinking;
    });
    return candidates.slice(-SHARE_CARD_MAX_MESSAGES);
  }

  /** 按像素宽度逐字符折行（保留换行），用于 Canvas 气泡排版。 */
  function wrapShareText(ctx, text, maxWidth) {
    const lines = [];
    for (const rawLine of String(text).split('\n')) {
      let line = rawLine.trim();
      if (!line) {
        lines.push('');
        continue;
      }
      while (line) {
        let slice = line;
        while (slice.length > 1 && ctx.measureText(slice).width > maxWidth) {
          slice = slice.slice(0, -1);
        }
        lines.push(slice);
        line = line.slice(slice.length);
      }
    }
    return lines;
  }

  function formatShareDate(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  /** 卡片头部角色头像：优先当前皮肤 idle 资源（data URL），缺失时画品牌兜底。 */
  function drawShareAvatar(ctx, x, y, size) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.clip();
    const img = elements.petAvatar;
    if (img && img.src && img.naturalWidth > 0) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      ctx.fillStyle = '#4f6ef7';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${size * 0.5}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('AI', x + size / 2, y + size / 2 + 4);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  /** 渲染对话卡片 Canvas（深色玻璃风：角色头部 + 气泡消息 + 品牌尾注）。 */
  function buildShareCardCanvas() {
    const t = window.PetLocales.createTranslator(currentLocale);
    const items = pickShareMessages();
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_CARD_WIDTH;
    canvas.height = SHARE_CARD_HEIGHT;
    const ctx = canvas.getContext('2d');

    // 背景渐变
    const gradient = ctx.createLinearGradient(0, 0, 0, SHARE_CARD_HEIGHT);
    gradient.addColorStop(0, '#262b40');
    gradient.addColorStop(1, '#171b2a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

    // 顶部角色区
    const avatarSize = 112;
    const avatarX = 64;
    const avatarY = 48;
    drawShareAvatar(ctx, avatarX, avatarY, avatarSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(
      currentPetName || t('app.defaultPetName'),
      avatarX + avatarSize + 28,
      avatarY + 54
    );
    ctx.fillStyle = '#aab3d0';
    ctx.font = '28px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(
      `${t('share.cardSubtitle')} · ${formatShareDate(new Date())}`,
      avatarX + avatarSize + 28,
      avatarY + 104
    );

    // 消息区：从最近消息反推可容纳数量，不足时至少保留一条
    const contentTop = 230;
    const contentBottom = 1150;
    const maxBubbleWidth = 900;
    const lineHeight = 46;
    const bubblePaddingX = 28;
    const bubblePaddingY = 22;
    const bubbleGap = 34;
    ctx.font = '30px "Segoe UI", "Microsoft YaHei", sans-serif';

    const planned = [];
    let usedHeight = 0;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      const content = sanitizeShareText(item.content);
      const clipped =
        content.length > SHARE_CARD_MAX_CHARS
          ? `${content.slice(0, SHARE_CARD_MAX_CHARS)}…`
          : content;
      const lines = wrapShareText(ctx, clipped, maxBubbleWidth - bubblePaddingX * 2);
      const height = lines.length * lineHeight + bubblePaddingY * 2;
      if (
        usedHeight + height + (planned.length ? bubbleGap : 0) >
        contentBottom - contentTop
      ) {
        break;
      }
      usedHeight += height + (planned.length ? bubbleGap : 0);
      planned.unshift({ item, lines });
    }
    if (planned.length === 0 && items.length > 0) {
      const last = items[items.length - 1];
      const content = sanitizeShareText(last.content).slice(0, SHARE_CARD_MAX_CHARS);
      planned.push({ item: last, lines: wrapShareText(ctx, content, maxBubbleWidth - 36) });
    }

    let y = contentTop;
    for (const { item, lines } of planned) {
      const textWidth = lines.reduce(
        (max, line) => Math.max(max, ctx.measureText(line).width),
        0
      );
      const bubbleWidth = Math.min(maxBubbleWidth, textWidth + bubblePaddingX * 2);
      const bubbleHeight = lines.length * lineHeight + bubblePaddingY * 2;
      const x =
        item.role === 'user' ? SHARE_CARD_WIDTH - 64 - bubbleWidth : 64;
      roundRect(ctx, x, y, bubbleWidth, bubbleHeight, 26);
      ctx.fillStyle = item.role === 'user' ? '#4f6ef7' : '#343b57';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      lines.forEach((line, index) => {
        ctx.fillText(
          line,
          x + bubblePaddingX,
          y + bubblePaddingY + 34 + index * lineHeight
        );
      });
      y += bubbleHeight + bubbleGap;
    }

    // 底部品牌尾注
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, SHARE_CARD_HEIGHT - 170, SHARE_CARD_WIDTH, 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#dfe3f5';
    ctx.font = '30px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(t('share.cardFooter'), SHARE_CARD_WIDTH / 2, SHARE_CARD_HEIGHT - 96);
    ctx.fillStyle = '#8ab4ff';
    ctx.font = 'bold 28px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(t('share.cardTag'), SHARE_CARD_WIDTH / 2, SHARE_CARD_HEIGHT - 46);
    ctx.textAlign = 'left';
    return canvas;
  }

  /** 生成对话卡片 PNG（脱敏后内容；返回 dataUrl 供保存/复制，也便于测试断言）。 */
  function generateShareCard() {
    const items = pickShareMessages();
    if (items.length === 0) {
      return { ok: false, error: 'no-messages' };
    }
    const dataUrl = buildShareCardCanvas().toDataURL('image/png');
    const sanitized = items.map((item) => ({
      role: item.role,
      content: sanitizeShareText(item.content)
    }));
    return { ok: true, dataUrl, sanitized, count: items.length };
  }

  /** 打开分享菜单：floating 模式用于长按/右键消息定位，toolbar 模式由按钮触发。 */
  function openShareMenuAt(x, y) {
    if (!elements.shareMenu || !elements.shareBtn || !elements.shareSave) {
      return;
    }
    elements.shareMenu.classList.add('share-menu-floating');
    elements.shareMenu.style.left = `${Math.max(8, x - 120)}px`;
    elements.shareMenu.style.top = `${Math.max(8, y - 8)}px`;
    elements.shareMenu.hidden = false;
    elements.shareBtn.setAttribute('aria-expanded', 'true');
    elements.shareSave.focus();
  }

  function toggleShareMenu() {
    if (!elements.shareMenu || !elements.shareBtn || !elements.shareSave) {
      return;
    }
    if (elements.shareMenu.hidden) {
      elements.shareMenu.classList.remove('share-menu-floating');
      elements.shareMenu.style.left = '';
      elements.shareMenu.style.top = '';
      elements.shareMenu.hidden = false;
      elements.shareBtn.setAttribute('aria-expanded', 'true');
      elements.shareSave.focus();
    } else {
      closeShareMenu();
    }
  }

  function closeShareMenu() {
    if (!elements.shareMenu || elements.shareMenu.hidden) {
      return;
    }
    elements.shareMenu.hidden = true;
    elements.shareBtn.setAttribute('aria-expanded', 'false');
  }

  /** 消息长按（600ms）或右键唤起分享菜单；拖动/移出/抬起即取消计时。 */
  function attachMessageShareGesture(item) {
    if (!item || item.dataset.shareGesture) {
      return;
    }
    item.dataset.shareGesture = '1';
    const cancelTimer = () => {
      if (sharePressTimer) {
        clearTimeout(sharePressTimer);
        sharePressTimer = null;
      }
    };
    item.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      cancelTimer();
      sharePressTimer = setTimeout(() => {
        sharePressTimer = null;
        openShareMenuAt(event.clientX, event.clientY);
      }, SHARE_LONG_PRESS_MS);
    });
    item.addEventListener('pointermove', cancelTimer);
    item.addEventListener('pointerup', cancelTimer);
    item.addEventListener('pointercancel', cancelTimer);
    item.addEventListener('pointerleave', cancelTimer);
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      cancelTimer();
      openShareMenuAt(event.clientX, event.clientY);
    });
  }

  /** 生成并保存对话卡片 PNG（主进程弹保存框）。 */
  async function saveShareCard() {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    if (!hasShareApi()) {
      showShareStatus(
        t('share.error', { error: t('data.apiUnavailable') }),
        'error'
      );
      return;
    }
    const generated = generateShareCard();
    if (!generated.ok) {
      showShareStatus(t('share.noMessages'), 'error');
      return;
    }
    elements.shareSave.disabled = true;
    elements.shareCopy.disabled = true;
    showShareStatus(t('share.generating'), 'ok');
    try {
      const result = await window.petAPI.share.saveCard({
        dataUrl: generated.dataUrl,
        suggestedName: `${t('share.saveDialogDefaultName')}-${currentPetName}`
      });
      if (result && result.ok && result.filePath) {
        showShareStatus(t('share.saved', { filePath: result.filePath }), 'ok');
      } else if (result && result.error && result.error !== 'cancelled') {
        showShareStatus(t('share.error', { error: result.error }), 'error');
      } else {
        showShareStatus(t('share.cancelled'), 'ok');
      }
    } catch (error) {
      showShareStatus(
        t('share.error', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.shareSave.disabled = false;
      elements.shareCopy.disabled = false;
    }
  }

  /** 生成并复制对话卡片 PNG 到剪贴板。 */
  async function copyShareCard() {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    if (!hasShareApi()) {
      showShareStatus(
        t('share.error', { error: t('data.apiUnavailable') }),
        'error'
      );
      return;
    }
    const generated = generateShareCard();
    if (!generated.ok) {
      showShareStatus(t('share.noMessages'), 'error');
      return;
    }
    elements.shareSave.disabled = true;
    elements.shareCopy.disabled = true;
    showShareStatus(t('share.generating'), 'ok');
    try {
      const result = await window.petAPI.share.copyCard({
        dataUrl: generated.dataUrl
      });
      if (result && result.ok) {
        showShareStatus(t('share.copied'), 'ok');
      } else if (result && result.error) {
        showShareStatus(t('share.error', { error: result.error }), 'error');
      }
    } catch (error) {
      showShareStatus(
        t('share.error', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.shareSave.disabled = false;
      elements.shareCopy.disabled = false;
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

  /**
   * T-42：一键“关闭并清除”匿名遥测。
   * 关闭后不再采集；同时清除本地队列与设备标识（下次启用生成全新 UUID）。
   */
  async function handleTelemetryClear() {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    const telemetryApi =
      window.petAPI &&
      window.petAPI.telemetry &&
      typeof window.petAPI.telemetry.setEnabled === 'function'
        ? window.petAPI.telemetry
        : null;
    if (!telemetryApi) {
      showTelemetryStatus(t('settings.telemetryApiUnavailable'), 'error');
      return;
    }
    elements.telemetryClear.disabled = true;
    try {
      const status = await telemetryApi.setEnabled({
        enabled: false,
        clearData: true
      });
      if (elements.telemetryEnabled) {
        elements.telemetryEnabled.checked = false;
      }
      if (currentSettings && typeof currentSettings === 'object') {
        currentSettings = { ...currentSettings, telemetryEnabled: false };
      }
      if (elements.onboardingTelemetryEnabled) {
        elements.onboardingTelemetryEnabled.checked = false;
      }
      if (status && status.queuedCount === 0) {
        showTelemetryStatus(t('settings.telemetryCleared'), 'ok');
      } else {
        showTelemetryStatus(
          t('settings.telemetryClearError', { error: '本地数据未清空' }),
          'error'
        );
      }
    } catch (error) {
      showTelemetryStatus(
        t('settings.telemetryClearError', {
          error: error && error.message ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      elements.telemetryClear.disabled = false;
    }
  }

  let showExportStatus = () => {};
  let showShareStatus = () => {}; // T-45
  let showClearStatus = () => {};
  let showTelemetryStatus = () => {};
  let showSkinStatus = () => {}; // T-43

  window.ChatUI = {
    init,
    applyMood,
    refreshSkins, // T-43：皮肤列表刷新（测试/手动入口）
    getSkinItems: () => skinItems, // T-43
    applySkin, // T-43
    groupSkinImportFailures, // T-59：导入失败分组（测试/手动入口）
    renderSkinCodexResult, // T-59：扫描结果渲染（测试/手动入口）
    sanitizeShareText, // T-45：脱敏（测试/手动入口）
    generateShareCard, // T-45：生成对话卡片 PNG
    saveShareCard, // T-45：保存卡片
    copyShareCard, // T-45：复制卡片
    // T-44：主题/效率小组件（测试与快捷入口）
    applyTheme,
    getTodos: () => todosFromSettings(currentSettings),
    addTodo,
    recordWaterDrink
  };
})();

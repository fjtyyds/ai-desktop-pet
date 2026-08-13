'use strict';

/**
 * T-55/T-58：宠物浮窗渲染层（Codex Pets 式）。
 * - 轮询主进程状态（idle/working/ready/failed）并显示气泡；
 * - T-58：每 3s 轮询 petAPI.mood.get，情绪驱动 idle 动画行
 *   （happy→waving 行3、excited→jumping 行4、neutral→idle 行0、sad→failed 行5）；
 * - 图集行映射补全：waiting=行6（attention/等待输入）、working=行7、ready=行8；
 * - settings.reduceMotion 开启时禁用图集/静态动画（仍尊重 prefers-reduced-motion）；
 * - 普通皮肤：情绪兴奋时轻微浮动 + 表情气泡（状态气泡不受影响）；
 * - 当前皮肤为 Codex 宠物包（spritesheet.webp）时按状态切换动画行；
 * - 普通皮肤显示静态角色图；
 * - T-57：气泡队列与时长由主进程推进；petOverlayBubbleEnabled=false 时隐藏气泡。
 * - 冒烟测试钩子 window.__overlayTest（注入假 mood/状态/皮肤，验证行切换）。
 */
(async function initOverlay() {
  await window.PetLocales.ready;

  const bubble = document.getElementById('overlay-bubble');
  const pet = document.getElementById('overlay-pet');
  const tuckBtn = document.getElementById('overlay-tuck');

  // T-58：Codex 宠物包 8 列×9 行动画行映射表
  const STATE_ROWS = {
    idle: 0,
    speaking: 3,
    attention: 6,
    waiting: 6,
    working: 7,
    ready: 8,
    failed: 5
  };
  const MOOD_ROWS = { excited: 4, happy: 3, neutral: 0, sad: 5 };
  // 工作状态优先于情绪驱动动画行；其余状态（如 idle）由情绪决定
  const STATUS_ROW_OVERRIDES = {
    speaking: 3,
    attention: 6,
    waiting: 6,
    working: 7,
    ready: 8,
    failed: 5
  };
  const MOOD_POLL_MS = 3000;
  const STATUS_HEARTBEAT_MS = 5000;
  const MOOD_EMOJI = { excited: '🥳' };
  const MOOD_LOCALE_KEY = { excited: 'moodExcited' };
  let currentLocale = window.PetLocales.DEFAULT_LOCALE;
  let skin = null;
  let skinAtlas = null;
  let currentState = 'idle';
  let localText = '';
  let mood = null;
  let reduceMotion = false;
  let bubbleEnabled = true;
  let moodPolling = false;
  let moodBubble = null;
  let statusTimer = null;
  let moodTimer = null;

  function t(key, params) {
    return window.PetLocales.createTranslator(currentLocale)(key, params);
  }

  /** 由 mood 快照得到情绪档位（excited/happy/neutral/sad） */
  function moodCategory(nextMood) {
    if (!nextMood || !Number.isFinite(nextMood.valence)) {
      return 'neutral';
    }
    if (nextMood.valence >= 70) {
      return Number.isFinite(nextMood.intensity) && nextMood.intensity >= 0.6
        ? 'excited'
        : 'happy';
    }
    if (nextMood.valence <= 45) {
      return 'sad';
    }
    return 'neutral';
  }

  /** 计算当前应播放的动画行：工作状态优先，否则由情绪驱动 */
  function resolveRow() {
    if (Object.prototype.hasOwnProperty.call(STATUS_ROW_OVERRIDES, currentState)) {
      return { row: STATUS_ROW_OVERRIDES[currentState], moodDriven: false };
    }
    return {
      row: MOOD_ROWS[moodCategory(mood)] ?? STATE_ROWS.idle,
      moodDriven: true
    };
  }

  /** 同步情绪相关视觉：图集行 / 静态皮肤浮动与表情气泡 */
  function updateMoodVisuals() {
    const category = moodCategory(mood);
    pet.dataset.mood = category;
    if (skinAtlas) {
      const resolved = resolveRow();
      pet.dataset.row = String(resolved.row);
      pet.dataset.moodDrive = resolved.moodDriven ? '1' : '0';
    } else if (moodBubble) {
      const emoji = MOOD_EMOJI[category];
      const localeKey = MOOD_LOCALE_KEY[category];
      const showEmotion = Boolean(emoji && localeKey);
      moodBubble.textContent = showEmotion
        ? `${emoji} ${t(localeKey)}`
        : '';
      moodBubble.hidden = !showEmotion;
    }
  }

  function applyMood(nextMood) {
    mood =
      nextMood && Number.isFinite(nextMood.valence)
        ? {
            valence: nextMood.valence,
            intensity: nextMood.intensity,
            label: nextMood.label
          }
        : null;
    updateMoodVisuals();
  }

  function applyReduceMotion(reduced) {
    reduceMotion = Boolean(reduced);
    pet.dataset.reduceMotion = reduceMotion ? '1' : '0';
    if (moodBubble) {
      moodBubble.dataset.reduceMotion = reduceMotion ? '1' : '0';
    }
  }

  async function loadLocale() {
    try {
      const settings = await window.petAPI.settings.get();
      applyReduceMotion(settings && settings.reduceMotion === true);
      bubbleEnabled = settings ? settings.petOverlayBubbleEnabled !== false : true;
      const language =
        settings && typeof settings.language === 'string'
          ? settings.language
          : 'system';
      currentLocale =
        language === 'system'
          ? window.PetLocales.resolveLocale(navigator.language || '')
          : window.PetLocales.resolveLocale(language);
    } catch (_error) {
      currentLocale = window.PetLocales.resolveLocale(navigator.language || '');
    }
    document.documentElement.lang = currentLocale;
    tuckBtn.setAttribute('aria-label', t('overlay.tuckAway'));
  }

  function applySkin(next) {
    skin = next || null;
    if (!skin) {
      pet.style.backgroundImage = '';
      pet.classList.remove('is-atlas');
      pet.dataset.atlas = '';
      pet.dataset.row = '';
      pet.dataset.moodDrive = '0';
      skinAtlas = null;
      return;
    }
    if (skin.spritesheetDataUrl && skin.atlas) {
      skinAtlas = skin.atlas;
      pet.classList.add('is-atlas');
      pet.style.backgroundImage = `url("${skin.spritesheetDataUrl}")`;
      pet.style.backgroundSize = `${skin.atlas.cols * 100}% ${skin.atlas.rows * 100}%`;
      pet.style.backgroundRepeat = 'no-repeat';
      pet.dataset.atlas = '1';
    } else {
      skinAtlas = null;
      pet.classList.remove('is-atlas');
      pet.dataset.atlas = '';
      pet.dataset.row = '';
      pet.dataset.moodDrive = '0';
      pet.style.backgroundImage =
        skin.roleAssets && skin.roleAssets.idle
          ? `url("${skin.roleAssets.idle}")`
          : '';
      pet.style.backgroundSize = 'contain';
      pet.style.backgroundRepeat = 'no-repeat';
    }
    applyState(currentState, localText, true);
  }

  function statusKey(state) {
    return `overlay.status${state.charAt(0).toUpperCase()}${state.slice(1)}`;
  }

  function applyState(state, text, force) {
    const nextState = typeof state === 'string' ? state : 'idle';
    currentState = nextState;
    localText = typeof text === 'string' ? text : '';
    updateMoodVisuals();
    pet.dataset.state = nextState;
    const message = localText || t(statusKey(nextState));
    bubble.textContent = message;
    bubble.hidden = !message || !bubbleEnabled;
  }

  /** T-57：气泡显示开关实时同步（主进程 getStatus 携带） */
  function applyBubbleEnabled(enabled) {
    bubbleEnabled = Boolean(enabled);
    applyState(currentState, localText, true);
  }

  async function pollMood() {
    if (moodPolling) {
      return;
    }
    moodPolling = true;
    try {
      const next = await window.petAPI.mood.get();
      applyMood(next);
    } catch (_error) {
      // 主进程未就绪时保持当前情绪
    } finally {
      moodPolling = false;
    }
  }

  async function pollStatus() {
    try {
      const status = await window.petAPI.petOverlay.getStatus();
      if (status && typeof status.state === 'string') {
        applyState(status.state, status.text || '');
      }
      if (status && typeof status.bubbleEnabled === 'boolean') {
        applyBubbleEnabled(status.bubbleEnabled);
      }
    } catch (_error) {
      // 主进程未就绪时保持当前状态
    }
  }

  /** T-60：状态变更事件订阅（心跳兜底；隐藏时暂停，恢复立即同步） */
  function pauseOverlay() {
    clearInterval(statusTimer);
    clearInterval(moodTimer);
    statusTimer = null;
    moodTimer = null;
    pet.classList.add('is-paused');
  }

  function resumeOverlay() {
    pet.classList.remove('is-paused');
    if (!statusTimer) {
      statusTimer = setInterval(pollStatus, STATUS_HEARTBEAT_MS);
    }
    if (!moodTimer) {
      moodTimer = setInterval(() => {
        void pollMood();
      }, MOOD_POLL_MS);
    }
    void pollStatus();
    void pollMood();
  }

  async function loadSkin() {
    try {
      const result = await window.petAPI.petOverlay.getSkin();
      if (result && result.ok) {
        applySkin(result.skin);
      }
    } catch (_error) {
      // 皮肤读取失败时浮窗保持透明，不崩溃
    }
  }

  moodBubble = document.createElement('div');
  moodBubble.id = 'overlay-mood';
  moodBubble.className = 'overlay-mood';
  moodBubble.hidden = true;
  document.getElementById('overlay-root').appendChild(moodBubble);

  tuckBtn.addEventListener('click', () => {
    void window.petAPI.petOverlay.tuckAway();
  });
  // T-56：双击宠物切换主聊天窗口显示；Esc 收起浮窗
  pet.addEventListener('dblclick', () => {
    void window.petAPI.petOverlay.toggleMain();
  });
  // T-56 修复：拖拽区（-webkit-app-region）会吞掉点击/双击，改为手动指针拖拽
  let dragState = null;
  pet.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    dragState = {
      x: event.screenX,
      y: event.screenY,
      moved: false,
      pointerId: event.pointerId
    };
    try {
      pet.setPointerCapture(event.pointerId);
    } catch (_error) {
      // 指针捕获失败不阻塞后续移动
    }
  });
  pet.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.screenX - dragState.x;
    const dy = event.screenY - dragState.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      dragState.moved = true;
    }
    if (!dragState.moved) {
      return;
    }
    dragState.x = event.screenX;
    dragState.y = event.screenY;
    void window.petAPI.petOverlay.moveBy({ dx, dy }).catch(() => {
      // 移动失败保持原位
    });
  });
  function endDrag(event) {
    if (dragState && dragState.pointerId === event.pointerId) {
      dragState = null;
      try {
        pet.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // 指针已释放时忽略
      }
    }
  }
  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      void window.petAPI.petOverlay.tuckAway();
    }
  });

  window.petAPI.petOverlay.onSkinUpdated(() => {
    void loadSkin();
  });
  window.petAPI.petOverlay.onStatusUpdated((status) => {
    if (status && typeof status.state === 'string') {
      applyState(status.state, status.text || '');
    }
    if (status && typeof status.bubbleEnabled === 'boolean') {
      applyBubbleEnabled(status.bubbleEnabled);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseOverlay();
    } else {
      resumeOverlay();
    }
  });

  await loadLocale();
  await loadSkin();
  await pollStatus();
  await pollMood();
  resumeOverlay();

  // 冒烟测试钩子：注入假 mood/状态/皮肤，验证行切换与 reduceMotion 接线
  window.__overlayTest = {
    applyMood,
    applyState: (state, text) => applyState(state, text, true),
    applySkin: (nextSkin) => applySkin(nextSkin),
    setReduceMotion: (reduced) => applyReduceMotion(Boolean(reduced)),
    setBubbleEnabled: (enabled) => {
      bubbleEnabled = Boolean(enabled);
      applyState(currentState, localText, true);
    },
    getRow: () => pet.dataset.row,
    getMoodDrive: () => pet.dataset.moodDrive,
    getMood: () => (mood ? { ...mood } : null),
    getState: () => currentState,
    STATE_ROWS: { ...STATE_ROWS },
    MOOD_ROWS: { ...MOOD_ROWS }
  };
})();

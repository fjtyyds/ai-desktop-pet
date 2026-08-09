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
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ai-pet-settings';
  const DEFAULT_MODEL = 'deepseek-v4-flash';
  const DEFAULT_LANGUAGE = 'system';
  const ACTIVITY_POKE_MIN_INTERVAL_MS = 5000; // T-15: 交互心跳节流
  const MOOD_POLL_MS = 3000;
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

  async function init() {
    cacheElements();
    bindEvents();
    bindActivityEvents();
    subscribeIdle();
    // 先加载两份语言包，确保任何文案渲染不会回退到键名
    await window.PetLocales.ready;
    await restoreSettings();
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
      clearStatus: document.getElementById('clear-status')
    };
    showExportStatus = makeStatusShower(elements.exportStatus);
    showClearStatus = makeStatusShower(elements.clearStatus);
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
        idleEnabled: saved.idleEnabled !== false
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
    const language =
      settings && typeof settings.language === 'string'
        ? settings.language
        : DEFAULT_LANGUAGE;
    elements.language.value = language;
    currentLocale = resolveEffectiveLocale(language);
    const t = window.PetLocales.createTranslator(currentLocale);

    elements.apiKey.value =
      settings && typeof settings.apiKey === 'string' ? settings.apiKey : '';
    elements.model.value =
      settings && typeof settings.model === 'string' && settings.model.trim()
        ? settings.model.trim()
        : DEFAULT_MODEL;

    currentPetName =
      settings && typeof settings.petName === 'string' && settings.petName.trim()
        ? settings.petName.trim()
        : t('app.defaultPetName');
    elements.petName.value = currentPetName;
    elements.idleEnabled.checked = !settings || settings.idleEnabled !== false;

    const persona =
      settings && settings.persona && typeof settings.persona === 'object'
        ? settings.persona
        : {};
    const traits = Array.isArray(persona.traits) ? persona.traits : [];
    elements.personaTraits.value = traits.join(t('settings.traitsDelimiter'));
    elements.personaTone.value = typeof persona.tone === 'string' ? persona.tone : '';
    elements.personaBackstory.value =
      typeof persona.backstory === 'string' ? persona.backstory : '';

    applyStaticText();
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
        idleEnabled: elements.idleEnabled.checked
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
        idleEnabled: elements.idleEnabled.checked
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

  window.ChatUI = { init, applyMood };
})();

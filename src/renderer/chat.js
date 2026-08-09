/**
 * T-02 聊天面板逻辑 + T-12 i18n/无障碍：
 * - 消息列表渲染（用户/桌宠气泡）
 * - 输入框与发送（通过 window.petAPI.chat.send，接口未实现时优雅降级）
 * - 设置页（petAPI.settings.get/set 初始化与保存宠物名 + 人格 + API Key + 模型 + 语言，
 *   ADR-013/ADR-015/ADR-018；localStorage 仅作 petAPI 缺失时的降级）
 * - 设置页“记忆”子页（petAPI.memory.list/delete/update，T-17，ADR-022）：
 *   列表展示、删除、内联修正，空态与错误提示
 * - 文案经 src/shared/locales 获取，默认跟随系统，设置页可选并持久化
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ai-pet-settings';
  const DEFAULT_MODEL = 'deepseek-v4-flash';
  const DEFAULT_LANGUAGE = 'system';
  let messages = [];
  let elements = {};
  let currentLocale = 'zh-CN';
  let currentPetName = 'AI 桌宠';
  let memoryItems = [];

  async function init() {
    cacheElements();
    bindEvents();
    // 先加载两份语言包，确保任何文案渲染不会回退到键名
    await window.PetLocales.ready;
    await restoreSettings();
    void restoreHistory();
  }

  function cacheElements() {
    elements = {
      chatView: document.getElementById('chat-view'),
      settingsView: document.getElementById('settings-view'),
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
      settingsSave: document.getElementById('settings-save'),
      settingsStatus: document.getElementById('settings-status')
    };
  }

  function bindEvents() {
    elements.chatForm.addEventListener('submit', handleSubmit);
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.closeBtn.addEventListener('click', hideToTray);
    elements.settingsBack.addEventListener('click', showChatView);
    elements.memoryManageBtn.addEventListener('click', openMemoryView);
    elements.memoryBack.addEventListener('click', closeMemoryView);
    elements.settingsSave.addEventListener('click', saveSettings);
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
      typeof window.petAPI.chat.send === 'function'
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
    const text = elements.chatInput.value.trim();
    if (!text) {
      return;
    }
    elements.chatInput.value = '';
    appendMessage('user', text);
    void sendMessage(text);
  }

  async function sendMessage(text) {
    await window.PetLocales.ready;
    const t = window.PetLocales.createTranslator(currentLocale);
    if (!isChatReady()) {
      appendMessage('assistant', t('chat.serviceNotReadyReply'));
      elements.chatInput.focus();
      return;
    }

    elements.sendBtn.disabled = true;
    elements.sendBtn.textContent = '…';
    try {
      // M2：主进程统一组装上下文，渲染层只传当前消息（ADR-012）
      const result = await window.petAPI.chat.send({ text });
      if (result && result.ok) {
        appendMessage('assistant', result.reply || t('chat.emptyReply'));
      } else if (result && result.error) {
        appendMessage('assistant', t('chat.errorPrefix', { error: result.error }));
      } else {
        appendMessage('assistant', t('chat.serviceNotReadyReply'));
      }
    } catch (error) {
      appendMessage(
        'assistant',
        t('chat.errorPrefix', {
          error: error && error.message ? error.message : String(error)
        })
      );
    } finally {
      elements.sendBtn.disabled = false;
      elements.sendBtn.textContent = t('chat.send');
      elements.chatInput.focus();
    }
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

  function appendMessage(role, content) {
    const item = document.createElement('div');
    item.className = `message message-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;

    item.appendChild(bubble);
    elements.messageList.appendChild(item);
    messages.push({ role, content });
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
        language: saved.language
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
      saveLocalFallback({ petName, apiKey, model, persona, language });
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
        language
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

  window.ChatUI = { init };
})();

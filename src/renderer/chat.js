/**
 * T-02 聊天面板逻辑 + T-12 i18n/无障碍：
 * - 消息列表渲染（用户/桌宠气泡）
 * - 输入框与发送（通过 window.petAPI.chat.send，接口未实现时优雅降级）
 * - 设置页（petAPI.settings.get/set 初始化与保存宠物名 + 人格 + API Key + 模型 + 语言，
 *   ADR-013/ADR-015/ADR-018；localStorage 仅作 petAPI 缺失时的降级）
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
      messageList: document.getElementById('message-list'),
      serviceStatus: document.getElementById('service-status'),
      chatForm: document.getElementById('chat-form'),
      chatInput: document.getElementById('chat-input'),
      sendBtn: document.getElementById('send-btn'),
      settingsBtn: document.getElementById('settings-btn'),
      closeBtn: document.getElementById('close-btn'),
      settingsBack: document.getElementById('settings-back'),
      headerTitle: document.getElementById('header-title'),
      apiKey: document.getElementById('api-key'),
      model: document.getElementById('model'),
      language: document.getElementById('language'),
      petName: document.getElementById('pet-name'),
      personaTraits: document.getElementById('persona-traits'),
      personaTone: document.getElementById('persona-tone'),
      personaBackstory: document.getElementById('persona-backstory'),
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
    elements.settingsSave.addEventListener('click', saveSettings);
    elements.exportMdBtn.addEventListener('click', () => void exportConversation('markdown'));
    elements.exportJsonBtn.addEventListener('click', () => void exportConversation('json'));
    elements.clearDataBtn.addEventListener('click', handleClearData);
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
    elements.settingsBack.focus();
  }

  function showChatView() {
    elements.settingsView.hidden = true;
    elements.chatView.hidden = false;
    elements.chatInput.focus();
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

  window.ChatUI = { init };
})();

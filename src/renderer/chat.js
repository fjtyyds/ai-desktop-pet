/**
 * T-02 聊天面板逻辑：
 * - 消息列表渲染（用户/桌宠气泡）
 * - 输入框与发送（通过 window.petAPI.chat.send，接口未实现时优雅降级）
 * - 设置页（petAPI.settings.get/set 初始化与保存宠物名 + 人格 + API Key + 模型，
 *   ADR-013/ADR-015；
 *   localStorage 仅作 petAPI 缺失时的降级）
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ai-pet-settings';
  let messages = [];
  let elements = {};

  function init() {
    cacheElements();
    bindEvents();
    renderServiceStatus();
    void restoreSettings();
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
    if (isChatReady()) {
      elements.serviceStatus.hidden = true;
      elements.chatInput.placeholder = '对桌宠说点什么…';
    } else {
      elements.serviceStatus.textContent = '⚠ AI 服务未就绪';
      elements.serviceStatus.hidden = false;
      elements.chatInput.placeholder = 'AI 服务未就绪';
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
    if (!isChatReady()) {
      appendMessage('assistant', 'AI 服务未就绪，暂时无法回复。');
      elements.chatInput.focus();
      return;
    }

    elements.sendBtn.disabled = true;
    elements.sendBtn.textContent = '…';
    try {
      // M2：主进程统一组装上下文，渲染层只传当前消息（ADR-012）
      const result = await window.petAPI.chat.send({ text });
      if (result && result.ok) {
        appendMessage('assistant', result.reply || '（空回复）');
      } else if (result && result.error) {
        appendMessage('assistant', `出错了：${result.error}`);
      } else {
        appendMessage('assistant', 'AI 服务未就绪，暂时无法回复。');
      }
    } catch (error) {
      appendMessage(
        'assistant',
        `出错了：${error && error.message ? error.message : String(error)}`
      );
    } finally {
      elements.sendBtn.disabled = false;
      elements.sendBtn.textContent = '发送';
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
    appendMessage('assistant', '你好，我是你的 AI 桌宠 👋 想聊点什么？');
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
  }

  function showChatView() {
    elements.settingsView.hidden = true;
    elements.chatView.hidden = false;
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
        persona: saved.persona
      });
    } catch (_error) {
      // 本地设置损坏时静默回退默认值
    }
  }

  /** 将设置应用到表单与标题（缺失字段回退默认值） */
  function applySettings(settings) {
    elements.apiKey.value =
      settings && typeof settings.apiKey === 'string' ? settings.apiKey : '';
    elements.model.value =
      settings && typeof settings.model === 'string' && settings.model.trim()
        ? settings.model.trim()
        : 'deepseek-v4-flash';

    const petName =
      settings && typeof settings.petName === 'string' && settings.petName.trim()
        ? settings.petName.trim()
        : 'AI 桌宠';
    elements.petName.value = petName;
    elements.headerTitle.textContent = petName;

    const persona =
      settings && settings.persona && typeof settings.persona === 'object'
        ? settings.persona
        : {};
    const traits = Array.isArray(persona.traits) ? persona.traits : [];
    elements.personaTraits.value = traits.join('、');
    elements.personaTone.value = typeof persona.tone === 'string' ? persona.tone : '';
    elements.personaBackstory.value =
      typeof persona.backstory === 'string' ? persona.backstory : '';
  }

  /** 保存宠物名与人格：优先 petAPI.settings.set；petAPI 缺失时降级 localStorage */
  async function saveSettings() {
    const petName = elements.petName.value.trim() || 'AI 桌宠';
    elements.petName.value = petName;
    const apiKey = elements.apiKey.value.trim();
    const model = elements.model.value.trim() || 'deepseek-v4-flash';
    elements.model.value = model;
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
      saveLocalFallback({ petName, apiKey, model, persona });
      showSettingsStatus('已保存（本地降级，petAPI 不可用）', 'ok');
      return;
    }

    elements.settingsSave.disabled = true;
    try {
      const saved = await window.petAPI.settings.set({ petName, apiKey, model, persona });
      // 回填清洗后的规范值，保证表单与持久化一致
      applySettings(saved || { petName, persona });
      showSettingsStatus('已保存，密钥仅保存在本机，重启后仍生效', 'ok');
    } catch (error) {
      console.warn('保存设置失败：', error);
      showSettingsStatus(
        `保存失败：${error && error.message ? error.message : String(error)}`,
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

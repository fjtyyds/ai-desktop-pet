/**
 * T-02 聊天面板逻辑：
 * - 消息列表渲染（用户/桌宠气泡）
 * - 输入框与发送（通过 window.petAPI.chat.send，接口未实现时优雅降级）
 * - 设置页骨架（本地保存宠物名称）
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
    appendMessage('assistant', '你好，我是你的 AI 桌宠 👋 想聊点什么？');
    restoreSettings();
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
      petName: document.getElementById('pet-name'),
      petNameSave: document.getElementById('pet-name-save')
    };
  }

  function bindEvents() {
    elements.chatForm.addEventListener('submit', handleSubmit);
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.closeBtn.addEventListener('click', hideToTray);
    elements.settingsBack.addEventListener('click', showChatView);
    elements.petNameSave.addEventListener('click', savePetName);
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
      const result = await window.petAPI.chat.send({
        text,
        history: messages
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => ({ role: item.role, content: item.content }))
      });
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

  /* 设置页骨架 */
  function showSettingsView() {
    elements.chatView.hidden = true;
    elements.settingsView.hidden = false;
  }

  function showChatView() {
    elements.settingsView.hidden = true;
    elements.chatView.hidden = false;
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.petName) {
        elements.petName.value = saved.petName;
        elements.headerTitle.textContent = saved.petName;
      }
    } catch (_error) {
      // 本地设置损坏时静默回退默认值
    }
  }

  function savePetName() {
    const petName = elements.petName.value.trim() || 'AI 桌宠';
    elements.petName.value = petName;
    elements.headerTitle.textContent = petName;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ petName }));
    } catch (_error) {
      // 存储不可用时仅保持本次会话生效
    }
  }

  window.ChatUI = { init };
})();

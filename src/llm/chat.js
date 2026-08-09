'use strict';

/**
 * 聊天服务：组合 Provider 与 Store，提供 send() 及持久化历史。
 * 与 Electron 解耦，便于单元测试。
 */
function createChatService({ provider, store }) {
  let history = [];

  function loadHistory() {
    history = store.readMessages();
    return history;
  }

  async function send(text, clientHistory) {
    const content = typeof text === 'string' ? text.trim() : '';
    if (!content) {
      return { ok: false, reply: '', error: '消息不能为空' };
    }

    // 渲染层有历史则优先使用渲染层历史，否则回退到本地持久化历史
    const sessionHistory =
      Array.isArray(clientHistory) && clientHistory.length > 0 ? clientHistory : history;
    const userMessage = { role: 'user', content };
    const requestMessages = [...sessionHistory, userMessage];

    try {
      const result = await provider.chat({ messages: requestMessages });
      const reply =
        typeof result.reply === 'string' ? result.reply : String(result.reply || '');
      const assistantMessage = { role: 'assistant', content: reply };
      history = [...history, userMessage, assistantMessage];
      store.appendMessages([userMessage, assistantMessage]);
      return { ok: true, reply, error: null };
    } catch (error) {
      return {
        ok: false,
        reply: '',
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  return { send, loadHistory };
}

module.exports = { createChatService };

'use strict';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_TIMEOUT_MS = 30000;

/**
 * DeepSeek 聊天提供方（OpenAI 兼容接口）。
 * API Key 由调用方注入，本模块不硬编码、不输出密钥。
 */
class DeepSeekChatProvider {
  constructor({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async send({ text, history = [] }) {
    if (!this.apiKey) {
      return { ok: false, reply: '', error: '缺少 DeepSeek API Key' };
    }

    const messages = [
      { role: 'system', content: '你是一个 Windows 桌面 AI 桌宠，回复简洁友好。' },
      ...history.slice(-20).map((message) => ({
        role: message.role,
        content: message.content
      })),
      { role: 'user', content: text }
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ model: this.model, messages }),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const suffix = detail ? `: ${detail.slice(0, 200)}` : '';
        return {
          ok: false,
          reply: '',
          error: `DeepSeek API 请求失败（HTTP ${response.status}）${suffix}`
        };
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        return { ok: false, reply: '', error: 'DeepSeek API 返回了空回复' };
      }
      return { ok: true, reply, error: null };
    } catch (error) {
      return { ok: false, reply: '', error: `DeepSeek 调用失败：${error.message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { DeepSeekChatProvider };

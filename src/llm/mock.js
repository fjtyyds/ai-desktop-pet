'use strict';

/**
 * Mock 聊天提供方：未配置 API Key 时使用，返回确定性回复。
 */
class MockChatProvider {
  async send({ text, petName = 'AI 桌宠' }) {
    return {
      ok: true,
      reply: `（Mock）我是${petName}，已收到你的消息：「${text}」。配置 DEEPSEEK_API_KEY 后即可接入真实对话。`,
      error: null
    };
  }
}

module.exports = { MockChatProvider };

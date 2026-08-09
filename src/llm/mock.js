'use strict';

/**
 * Mock Provider：无 API Key 时的降级实现，返回固定风格回复。
 * 与 DeepSeek Provider 实现同一接口：chat({ messages }) -> Promise<{ reply }>。
 */
function createMockProvider() {
  async function chat({ messages }) {
    const lastUser = Array.isArray(messages)
      ? [...messages]
          .reverse()
          .find((item) => item && item.role === 'user')
      : null;
    const text = lastUser && typeof lastUser.content === 'string' ? lastUser.content : '';
    const reply = `（mock）收到：“${text}”。我是 AI 桌宠，接入 DeepSeek 后就能正式回答你啦～`;
    return { reply };
  }

  return { chat };
}

module.exports = { createMockProvider };

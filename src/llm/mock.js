'use strict';

/**
 * Mock Provider：无 API Key 时的降级实现，返回固定风格回复。
 * 与 DeepSeek Provider 实现同一接口：chat({ messages }) 与
 * chatStream({ messages }, { onDelta, signal }) -> Promise<{ reply }>（T-14）。
 */
const MOCK_CHUNK_SIZE = 2;
const MOCK_CHUNK_MIN_DELAY_MS = 30;
const MOCK_CHUNK_MAX_DELAY_MS = 60;

function createAbortError() {
  const error = new Error('已取消');
  error.name = 'AbortError';
  return error;
}

function buildReply(messages) {
  const lastUser = Array.isArray(messages)
    ? [...messages]
        .reverse()
        .find((item) => item && item.role === 'user')
    : null;
  const text = lastUser && typeof lastUser.content === 'string' ? lastUser.content : '';
  return `（mock）收到：“${text}”。我是 AI 桌宠，接入 DeepSeek 后就能正式回答你啦～`;
}

function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockProvider() {
  async function chat({ messages }) {
    return { reply: buildReply(messages) };
  }

  /**
   * 流式 mock（T-14，ADR-021）：把整段回复拆成 2 字符小段，每段 30~60ms 延迟，
   * 保证无 API Key 时打字机体验与真实模式一致；支持 AbortSignal 取消。
   */
  async function chatStream({ messages }, { onDelta, signal } = {}) {
    const reply = buildReply(messages);
    const chunks = chunkText(reply, MOCK_CHUNK_SIZE);
    let received = '';

    for (const chunk of chunks) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      const delay =
        MOCK_CHUNK_MIN_DELAY_MS +
        Math.floor(
          Math.random() * (MOCK_CHUNK_MAX_DELAY_MS - MOCK_CHUNK_MIN_DELAY_MS + 1)
        );
      await sleep(delay);
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      received += chunk;
      if (typeof onDelta === 'function') {
        onDelta(chunk);
      }
    }
    return { reply: received };
  }

  return { chat, chatStream };
}

module.exports = { createMockProvider };

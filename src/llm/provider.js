'use strict';

const { DEFAULT_MODEL } = require('../shared/contracts');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const REQUEST_TIMEOUT_MS = 30000;
const STREAM_FIRST_BYTE_TIMEOUT_MS = 30000;
const STREAM_TOTAL_TIMEOUT_MS = 60000;

function resolveBaseUrl() {
  return process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
}

/** 统一取消错误：chat.js 据此返回 { ok:false, error:'已取消' }（ADR-021/T-14） */
function createAbortError(message = '已取消') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * DeepSeek Provider（OpenAI 兼容接口）。
 * API Key 来自设置或环境变量 DEEPSEEK_API_KEY，绝不硬编码。
 */
function createDeepSeekProvider({ apiKey, model }) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY || '';
  const resolvedModel = model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

  async function chat({ messages }) {
    if (!key) {
      throw new Error('缺少 DeepSeek API Key');
    }

    const response = await fetch(`${resolveBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model: resolvedModel, messages, stream: false }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`DeepSeek API 请求失败（${response.status}）：${detail.slice(0, 200)}`);
    }

    const data = await response.json();
    const reply =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      throw new Error('DeepSeek API 返回了空回复');
    }
    return { reply };
  }

  /**
   * 流式聊天（T-14，ADR-021）：stream:true 的 SSE 解析。
   * - onDelta(delta)：每收到一段 content 增量即回调，增量按 UTF-8 字符串分片，不保证按词边界；
   * - signal：外部取消信号（IPC chat:stream-cancel 传入）；
   * - 超时：首字节 30 秒、整体 60 秒，到点自动 abort，不得无限挂起；
   * - 取消/超时以 AbortError 抛出，由 chat.js 转换为 { ok:false, reply: 已收到部分, error }。
   */
  async function chatStream({ messages }, { onDelta, signal } = {}) {
    if (!key) {
      throw new Error('缺少 DeepSeek API Key');
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    let timedOut = null;
    const firstByteTimer = setTimeout(() => {
      timedOut = 'firstByte';
      controller.abort();
    }, STREAM_FIRST_BYTE_TIMEOUT_MS);
    const totalTimer = setTimeout(() => {
      timedOut = 'total';
      controller.abort();
    }, STREAM_TOTAL_TIMEOUT_MS);

    function clearTimers() {
      clearTimeout(firstByteTimer);
      clearTimeout(totalTimer);
    }

    try {
      const response = await fetch(`${resolveBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({ model: resolvedModel, messages, stream: true }),
        signal: controller.signal
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`DeepSeek API 请求失败（${response.status}）：${detail.slice(0, 200)}`);
      }
      if (!response.body) {
        throw new Error('DeepSeek API 未返回流式响应体');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullReply = '';
      let sawChunk = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        sawChunk = true;
        if (timedOut === null) {
          timedOut = 'started';
          clearTimeout(firstByteTimer);
        }
        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以空行分隔；保留最后一个可能不完整的块
        const events = buffer.split('\n\n');
        buffer = events.pop();
        for (const rawEvent of events) {
          const dataLines = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          const data = dataLines.join('\n');
          if (!data || data === '[DONE]') {
            continue;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (_error) {
            // 半截 JSON 被拆到下一个事件时跳过本事件，等待后续数据
            continue;
          }
          const delta =
            parsed &&
            parsed.choices &&
            parsed.choices[0] &&
            parsed.choices[0].delta &&
            typeof parsed.choices[0].delta.content === 'string'
              ? parsed.choices[0].delta.content
              : '';
          if (delta) {
            fullReply += delta;
            if (typeof onDelta === 'function') {
              onDelta(delta);
            }
          }
        }
      }

      if (!sawChunk) {
        throw new Error('DeepSeek 流式响应为空');
      }
      if (!fullReply.trim()) {
        throw new Error('DeepSeek API 返回了空回复');
      }
      return { reply: fullReply };
    } catch (error) {
      if (timedOut === 'firstByte') {
        throw new Error('DeepSeek 流式首字节超时（30 秒）');
      }
      if (timedOut === 'total') {
        throw new Error('DeepSeek 流式响应超时（60 秒）');
      }
      if ((signal && signal.aborted) || (error && error.name === 'AbortError')) {
        throw createAbortError();
      }
      throw error;
    } finally {
      clearTimers();
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  return { chat, chatStream };
}

module.exports = { createDeepSeekProvider, resolveBaseUrl };

'use strict';

const { DEFAULT_MODEL } = require('../shared/contracts');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const REQUEST_TIMEOUT_MS = 30000;

function resolveBaseUrl() {
  return process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
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

  return { chat };
}

module.exports = { createDeepSeekProvider, resolveBaseUrl };

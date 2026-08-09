'use strict';

const { createDeepSeekProvider } = require('./provider');
const { createMockProvider } = require('./mock');

/**
 * 按设置创建 Provider（ADR-002：LLM 层可替换）：
 * - 有 API Key（设置或环境变量 DEEPSEEK_API_KEY）→ DeepSeek
 * - 否则 → Mock
 */
function createProvider(settings) {
  const apiKey = (settings && settings.apiKey) || process.env.DEEPSEEK_API_KEY || '';
  if (apiKey) {
    return createDeepSeekProvider({ apiKey, model: settings && settings.model });
  }
  return createMockProvider();
}

module.exports = { createProvider, createDeepSeekProvider, createMockProvider };

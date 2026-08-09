'use strict';

const { DEFAULT_MODEL } = require('../shared/contracts');
const { MockChatProvider } = require('./mock');
const { DeepSeekChatProvider } = require('./deepseek');

/**
 * 发送聊天消息：有 API Key（环境变量 DEEPSEEK_API_KEY 优先，其次设置）走 DeepSeek，
 * 否则走 Mock。模型名可用环境变量 DEEPSEEK_MODEL 覆盖，便于真实联调。
 *
 * @param {object} params
 * @param {string} params.text
 * @param {Array<{role: string, content: string}>} [params.history]
 * @param {object} [params.settings]
 * @returns {Promise<{ok: boolean, reply: string, error: string | null}>}
 */
async function sendChatMessage({ text, history = [], settings = {} }) {
  const apiKey = process.env.DEEPSEEK_API_KEY || settings.apiKey || '';
  const model = process.env.DEEPSEEK_MODEL || settings.model || DEFAULT_MODEL;

  if (!apiKey) {
    return new MockChatProvider().send({
      text,
      petName: settings.petName || 'AI 桌宠'
    });
  }

  return new DeepSeekChatProvider({ apiKey, model }).send({ text, history });
}

module.exports = { sendChatMessage };

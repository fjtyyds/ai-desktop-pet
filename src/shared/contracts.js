'use strict';

/**
 * 共享契约：M1 并行开发的“接口冻结层”。
 * 本文件由协调者维护；各并行任务只读。
 */

/** 默认模型标识（DeepSeek v4 Flash；具体 API 模型名以提供方文档为准） */
const DEFAULT_MODEL = 'deepseek-v4-flash';

/**
 * 聊天消息
 * @typedef {Object} ChatMessage
 * @property {'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * 应用设置
 * @typedef {Object} AppSettings
 * @property {string} apiKey
 * @property {string} model
 * @property {string} petName
 */

/**
 * 发送消息的结果
 * @typedef {Object} ChatSendResult
 * @property {boolean} ok
 * @property {string} reply
 * @property {string|null} error
 */

/**
 * 渲染进程可用的 petAPI 契约（由 preload 暴露）：
 * - chat.send({ text, history }) -> Promise<ChatSendResult>
 * - settings.get() -> Promise<AppSettings>
 * - settings.set(patch) -> Promise<AppSettings>
 */

module.exports = { DEFAULT_MODEL };
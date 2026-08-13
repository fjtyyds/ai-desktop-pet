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
 * @property {string} [sessionId]
 * @property {number} [timestamp]
 */

/**
 * 应用设置
 * @typedef {Object} AppSettings
 * @property {string} apiKey
 * @property {string} model
 * @property {string} petName
 * @property {Persona} [persona]
 */

/**
 * 人格配置（M2）
 * @typedef {Object} Persona
 * @property {string[]} traits
 * @property {string} tone
 * @property {string} backstory
 */

/**
 * 情绪状态（M2，内存态）
 * @typedef {Object} MoodState
 * @property {number} valence 0-100
 * @property {number} intensity 0-1
 * @property {string} label 情绪描述词（如“开心/平静/低落”）
 */

/**
 * 长期记忆条目（M2）
 * @typedef {Object} MemoryItem
 * @property {string} id
 * @property {string} content
 * @property {string} sessionId
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} lastUsedAt
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
 * - window.hide() -> Promise<void>（隐藏主窗口到托盘，应用不退出）
 * - window.minimize() -> Promise<void>（最小化到任务栏，T-25 冻结，ADR-026）
 * - history.get() -> Promise<ChatMessage[]>（M2：启动时恢复历史显示）
 * - tts.speak({ text, voice, rate, pitch }) -> Promise<TtsSpeakResult>（T-34 冻结，ADR-029）
 * 注：window.setShortcutEnabled 已按 ADR-026 从契约移除（T-29 实施清理）。
 */

/**
 * T-34（ADR-029）：在线神经语音合成结果。
 * @typedef {Object} TtsSpeakResult
 * @property {boolean} ok 是否合成成功
 * @property {string|null} audioDataUrl 成功时的 audio/mpeg data URL（base64）
 * @property {string|null} error 失败原因（不抛异常）
 */

/**
 * T-55（ADR-044）：宠物浮窗状态（Codex Pets 式独立悬浮宠物）。
 * @typedef {Object} PetOverlayStatus
 * @property {'idle'|'working'|'ready'|'failed'} state
 *   idle=等待聊天；working=LLM 回复中；ready=回复完成；failed=回复出错
 * @property {string} text 气泡文案（可为空串，由浮窗本地化回退）
 * @property {number} at 状态更新时间戳
 */

/**
 * 宠物浮窗 petAPI.petOverlay 契约（T-55，ADR-044）：
 * - toggle() -> Promise<{ ok, enabled, visible }>（切换并持久化 petOverlayEnabled）
 * - setEnabled({ enabled }) -> Promise<{ ok, enabled, visible }>（设置页开关）
 * - setStatus({ state, text? }) -> Promise<PetOverlayStatus>（聊天页上报）
 * - getStatus() -> Promise<PetOverlayStatus>
 * - getSkin() -> Promise<{ ok, skin }>（含 spritesheetDataUrl/atlas 的皮肤条目）
 * - tuckAway() -> Promise<{ ok, enabled }>（收起草宠）
 * - refreshSkin() / onSkinUpdated(cb)（皮肤变更刷新）
 * - showMain() -> Promise<void>（T-56，ADR-045：唤起主聊天窗口）
 * - pushBubble({ state, text? }) -> Promise<PetOverlayStatus>（T-57：状态/气泡队列上报）
 * - getConfig() -> Promise<{ bubbleEnabled, bubbleSeconds, reminders }>（T-57/T-61）
 */

/**
 * T-55/ADR-045：宠物浮窗设置字段（store.js 白名单，worker 只读）：
 * - petOverlayBubbleSeconds：气泡显示时长（秒），默认 6，允许 3~20；
 * - petOverlayBubbleEnabled：气泡显示开关，默认 true；
 * - petOverlayReminders：提醒（空闲互动/喝水等）透出到浮窗，默认 true；
 * - petOverlayBounds.displayId：可选显示器标识（整数），用于多显示器位置记忆。
 */

/**
 * T-63（ADR-046）：任务级进度气泡契约（总工已冻结，worker 只读）。
 * petAPI.petOverlay 新增：
 * - startTask({ id, title, message?, percent?, stage?, totalStages? }) -> Promise<{ ok, task }>
 * - updateTask({ id, percent?, message?, stage? }) -> Promise<{ ok, task }>
 * - finishTask({ id, ok, message? }) -> Promise<{ ok, task: null }>
 * - getConfig() -> Promise<{ bubbleEnabled, bubbleSeconds, reminders }>（T-57/T-61 契约补实现）
 * IPC：pet:task-start / pet:task-update / pet:task-finish
 *
 * @typedef {Object} PetOverlayTask
 * @property {string} id 任务标识（≤64 字符）
 * @property {string} title 任务标题（≤80 字符）
 * @property {string} message 当前阶段文案（≤80 字符，可为空串）
 * @property {number|null} percent 0~100 进度；null=未知（浮窗显示不确定进度）
 * @property {number|null} stage 当前阶段序号（可选）
 * @property {number|null} totalStages 阶段总数（可选）
 * @property {'running'|'done'|'failed'} status 任务状态
 *
 * 约束：任务不持久化，重启即清空；运行中任务气泡优先显示，提醒气泡排队并在任务
 * 结束后补放；状态事件（pet:status-updated）payload 增加 task 字段（无任务为 null）。
 */

/** 短期记忆窗口大小（M2 默认最近 20 条消息） */
const DEFAULT_SHORT_TERM_WINDOW = 20;

/** 注入上下文的最大长期记忆条数（M2） */
const MAX_MEMORIES_IN_CONTEXT = 3;

module.exports = { DEFAULT_MODEL, DEFAULT_SHORT_TERM_WINDOW, MAX_MEMORIES_IN_CONTEXT };

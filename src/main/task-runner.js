'use strict';

/**
 * T-64（ADR-048）：任务级进度气泡通用包裹器。
 * 纯 Node 模块（不得依赖 electron），供主进程任务源统一接入浮窗进度气泡：
 * startTask -> runner({ update }) -> finishTask(ok:true)；异常自动
 * finishTask(ok:false, message 截断 ≤80) 后重新抛出。
 *
 * 任务源清单（T-63/T-64）：skin-import / app-update / history-export / tts-speak。
 */

/** 与 pet-overlay.js TASK_TEXT_MAX 一致：任务 title/message 上限 80 字符 */
const TASK_TEXT_MAX = 80;

function truncateMessage(value) {
  const text = value && typeof value === 'string' ? value : '';
  return text.slice(0, TASK_TEXT_MAX);
}

/**
 * 通用任务包裹器。
 * @param {object|null} overlay 浮窗 API（可为 null；所有调用均安全跳过）
 * @param {{id: string, title?: string, totalStages?: number}} options
 * @param {Function} runner async ({ update }) => result
 * @returns {Promise<*>} runner 的返回值
 */
async function runWithTask(overlay, options, runner) {
  const { id, title, totalStages } = options || {};
  const startTask =
    overlay && typeof overlay.startTask === 'function'
      ? (payload) => overlay.startTask(payload)
      : () => undefined;
  const updateTask =
    overlay && typeof overlay.updateTask === 'function'
      ? (payload) => overlay.updateTask({ id, ...payload })
      : () => undefined;
  const finishTask =
    overlay && typeof overlay.finishTask === 'function'
      ? (payload) => overlay.finishTask({ id, ...payload })
      : () => undefined;

  const startPayload = { id, title };
  if (totalStages !== undefined) {
    startPayload.totalStages = totalStages;
  }
  startTask(startPayload);
  try {
    const result = await runner({ update: updateTask });
    finishTask({
      ok: true,
      message: result && result.message ? result.message : ''
    });
    return result;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    finishTask({ ok: false, message: truncateMessage(message) });
    throw error;
  }
}

module.exports = { runWithTask, truncateMessage };

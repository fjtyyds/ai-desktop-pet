'use strict';

/**
 * 空闲主动互动计时器（T-15）。
 *
 * 纯逻辑模块，不依赖 Electron，便于 Node 单测：
 * - 无交互达到 triggerMs 后触发一次；
 * - 触发后至少间隔 minIntervalMs 才允许下一次（节流）；
 * - isEnabled() 返回 false 时不触发（开关/防打扰）；
 * - markActivity() 在任何用户交互时重置计时（恢复交互后停止触发）。
 */

const DEFAULT_IDLE_TRIGGER_MS = 3 * 60 * 1000; // 3 分钟无交互
const DEFAULT_MIN_INTERVAL_MS = 90 * 1000; // 两次触发至少间隔 90 秒
const DEFAULT_CHECK_MS = 10 * 1000; // 检查周期

function createIdleMonitor(options) {
  const opts = options || {};
  const triggerMs =
    Number.isFinite(opts.triggerMs) && opts.triggerMs > 0
      ? opts.triggerMs
      : DEFAULT_IDLE_TRIGGER_MS;
  const minIntervalMs =
    Number.isFinite(opts.minIntervalMs) && opts.minIntervalMs > 0
      ? opts.minIntervalMs
      : DEFAULT_MIN_INTERVAL_MS;
  const checkMs =
    Number.isFinite(opts.checkMs) && opts.checkMs > 0
      ? opts.checkMs
      : DEFAULT_CHECK_MS;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const setTimer =
    typeof opts.setIntervalFn === 'function' ? opts.setIntervalFn : setInterval;
  const clearTimer =
    typeof opts.clearIntervalFn === 'function' ? opts.clearIntervalFn : clearInterval;
  const isEnabled = typeof opts.isEnabled === 'function' ? opts.isEnabled : null;
  const onTrigger = typeof opts.onTrigger === 'function' ? opts.onTrigger : null;

  let lastActivityAt = now();
  let lastTriggerAt = 0;
  let timer = null;

  /** 用户交互时重置空闲计时 */
  function markActivity() {
    lastActivityAt = now();
  }

  /**
   * 手动检查一次（也用于定时器回调）。
   * @returns {boolean} 是否实际触发
   */
  function check() {
    const current = now();
    if (current - lastActivityAt < triggerMs) {
      return false;
    }
    if (current - lastTriggerAt < minIntervalMs) {
      return false;
    }
    if (isEnabled && !isEnabled()) {
      return false;
    }
    let triggered = false;
    if (onTrigger) {
      triggered = onTrigger({ at: current }) !== false;
    } else {
      triggered = true;
    }
    if (triggered) {
      lastTriggerAt = current;
    }
    return triggered;
  }

  function start() {
    if (timer != null) {
      return;
    }
    timer = setTimer(check, checkMs);
  }

  function stop() {
    if (timer == null) {
      return;
    }
    clearTimer(timer);
    timer = null;
  }

  return { markActivity, check, start, stop };
}

module.exports = {
  createIdleMonitor,
  DEFAULT_IDLE_TRIGGER_MS,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_CHECK_MS
};

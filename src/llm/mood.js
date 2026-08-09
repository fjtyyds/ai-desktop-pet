'use strict';

/**
 * 情绪状态机（M2，ADR-011）。
 * 纯逻辑、内存态，不依赖 Electron/IPC/存储：
 * - valence 0-100，表示情绪积极程度
 * - intensity 0-1，表示情绪强度（参与度）
 * - 按交互反馈（积极/消极）更新，并做限幅
 * - 长时间无交互缓慢回归默认值
 * - 根据 valence/intensity 生成情绪描述词 label
 */

const VALENCE_MIN = 0;
const VALENCE_MAX = 100;
const INTENSITY_MIN = 0;
const INTENSITY_MAX = 1;

/** 默认情绪：平静偏愉悦，情绪强度不高 */
const DEFAULT_VALENCE = 60;
const DEFAULT_INTENSITY = 0.35;

/** 一次反馈的默认幅度（valence 点数）与单次上限 */
const DEFAULT_FEEDBACK_AMOUNT = 8;
const MAX_FEEDBACK_AMOUNT = 20;

/** 无交互超过该时长后开始缓慢回归默认（默认 10 分钟） */
const REGRESSION_IDLE_MS = 10 * 60 * 1000;
/** 回归步进间隔：超过阈值后，每经过一个间隔移动一步（默认每 5 分钟） */
const REGRESSION_STEP_MS = 5 * 60 * 1000;
/** 每步回归量 */
const REGRESSION_VALENCE_STEP = 2;
const REGRESSION_INTENSITY_STEP = 0.05;

/** valence 分段 -> 情绪描述词 */
const VALENCE_BANDS = [
  { max: 15, label: '沮丧' },
  { max: 35, label: '低落' },
  { max: 45, label: '冷淡' },
  { max: 55, label: '平静' },
  { max: 70, label: '愉悦' },
  { max: 85, label: '开心' },
  { max: 100, label: '兴奋' }
];

function clampValence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_VALENCE;
  }
  return Math.min(VALENCE_MAX, Math.max(VALENCE_MIN, n));
}

function clampIntensity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_INTENSITY;
  }
  return Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, n));
}

/**
 * 生成情绪描述词：先按 valence 分段取基础词，intensity >= 0.7 时用“很”修饰。
 * @param {number} valence
 * @param {number} [intensity]
 * @returns {string}
 */
function describe(valence, intensity) {
  const v = clampValence(valence);
  const i = clampIntensity(intensity);
  const band =
    VALENCE_BANDS.find((item) => v <= item.max) || VALENCE_BANDS[VALENCE_BANDS.length - 1];
  return i >= 0.7 ? `很${band.label}` : band.label;
}

/** 向目标值移动一步；跨过目标时直接吸附到目标，避免浮点振荡 */
function moveToward(value, target, step) {
  if (value === target) {
    return value;
  }
  if (value > target) {
    const next = value - step;
    return next <= target ? target : next;
  }
  const next = value + step;
  return next >= target ? target : next;
}

/**
 * 创建情绪状态机实例。
 * @param {{ valence?: number, intensity?: number, lastInteractionAt?: number }} [initial]
 * @returns {{
 *   applyFeedback(type: 'positive'|'negative', options?: { amount?: number }): MoodState,
 *   tick(now?: number): MoodState,
 *   snapshot(): MoodState,
 *   describe(): string
 * }}
 */
function createMood(initial = {}) {
  let valence = clampValence(initial.valence);
  let intensity = clampIntensity(initial.intensity);
  let lastInteractionAt = Number.isFinite(initial.lastInteractionAt)
    ? initial.lastInteractionAt
    : Date.now();

  function snapshot() {
    return {
      valence: clampValence(valence),
      intensity: clampIntensity(intensity),
      label: describe(valence, intensity)
    };
  }

  /**
   * 交互反馈：positive 提升情绪，negative 降低情绪；
   * 任何交互都会小幅提升强度（参与度），随后重置无交互计时。
   */
  function applyFeedback(type, options = {}) {
    const amount = Number.isFinite(options.amount)
      ? Math.min(Math.abs(options.amount), MAX_FEEDBACK_AMOUNT)
      : DEFAULT_FEEDBACK_AMOUNT;

    if (type === 'positive') {
      valence = clampValence(valence + amount);
    } else if (type === 'negative') {
      valence = clampValence(valence - amount);
    } else {
      throw new Error(`未知反馈类型：${type}（支持 positive/negative）`);
    }

    intensity = clampIntensity(intensity + 0.1);
    lastInteractionAt = Date.now();
    return snapshot();
  }

  /**
   * 时间推进：超过 REGRESSION_IDLE_MS 无交互后，按 REGRESSION_STEP_MS
   * 每步向默认值缓慢回归（valence/intensity 均回归）。
   */
  function tick(now = Date.now()) {
    const elapsed = now - lastInteractionAt;
    if (elapsed < REGRESSION_IDLE_MS) {
      return snapshot();
    }

    const steps = Math.floor((elapsed - REGRESSION_IDLE_MS) / REGRESSION_STEP_MS);
    for (let i = 0; i < steps; i += 1) {
      const current = snapshot();
      if (current.valence === DEFAULT_VALENCE && current.intensity === DEFAULT_INTENSITY) {
        break;
      }
      valence = clampValence(
        moveToward(valence, DEFAULT_VALENCE, REGRESSION_VALENCE_STEP)
      );
      intensity = clampIntensity(
        moveToward(intensity, DEFAULT_INTENSITY, REGRESSION_INTENSITY_STEP)
      );
    }
    return snapshot();
  }

  return {
    applyFeedback,
    tick,
    snapshot,
    describe: () => snapshot().label
  };
}

module.exports = {
  VALENCE_MIN,
  VALENCE_MAX,
  INTENSITY_MIN,
  INTENSITY_MAX,
  DEFAULT_VALENCE,
  DEFAULT_INTENSITY,
  DEFAULT_FEEDBACK_AMOUNT,
  MAX_FEEDBACK_AMOUNT,
  REGRESSION_IDLE_MS,
  REGRESSION_STEP_MS,
  REGRESSION_VALENCE_STEP,
  REGRESSION_INTENSITY_STEP,
  VALENCE_BANDS,
  clampValence,
  clampIntensity,
  moveToward,
  describe,
  createMood
};

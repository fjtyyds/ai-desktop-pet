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

/** 默认情绪：平静（中性基线），情绪强度不高 */
const DEFAULT_VALENCE = 52;
const DEFAULT_INTENSITY = 0.35;

/** 一次反馈的默认幅度（valence 点数）与单次上限 */
const DEFAULT_FEEDBACK_AMOUNT = 12;
const MAX_FEEDBACK_AMOUNT = 24;

/** 无交互超过该时长后开始缓慢回归默认（默认 10 分钟） */
const REGRESSION_IDLE_MS = 10 * 60 * 1000;
/** 回归步进间隔：超过阈值后，每经过一个间隔移动一步（默认每 5 分钟） */
const REGRESSION_STEP_MS = 5 * 60 * 1000;
/** 每步回归量 */
const REGRESSION_VALENCE_STEP = 2;
const REGRESSION_INTENSITY_STEP = 0.05;

/** 无交互较久后，情绪在默认值附近缓慢“呼吸”的周期与幅度（避免长期定格） */
const AMBIENT_DRIFT_MS = 4 * 60 * 1000;
const AMBIENT_VALENCE_SPAN = 5;
const AMBIENT_INTENSITY_SPAN = 0.05;

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

/** 由时间种子生成 0..1 的伪随机数（确定性，避免引入全局随机状态） */
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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
  /** 是否已无交互回归到默认基线（此后只做小幅呼吸，不再被回归拉回） */
  let regressed = false;

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
    regressed = false;
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

    if (!regressed) {
      const steps = Math.floor((elapsed - REGRESSION_IDLE_MS) / REGRESSION_STEP_MS);
      for (let i = 0; i < steps; i += 1) {
        const current = snapshot();
        if (current.valence === DEFAULT_VALENCE && current.intensity === DEFAULT_INTENSITY) {
          regressed = true;
          break;
        }
        valence = clampValence(
          moveToward(valence, DEFAULT_VALENCE, REGRESSION_VALENCE_STEP)
        );
        intensity = clampIntensity(
          moveToward(intensity, DEFAULT_INTENSITY, REGRESSION_INTENSITY_STEP)
        );
      }
      if (!regressed) {
        return snapshot();
      }
    }

    // 已回到默认基线后，让情绪在“平静/愉悦”之间缓慢变化，
    // 而不是无交互时永远定格在同一个词上。
    const bucket = Math.floor(now / AMBIENT_DRIFT_MS);
    const valenceTarget =
      DEFAULT_VALENCE +
      Math.round((pseudoRandom(bucket) - 0.5) * 2 * AMBIENT_VALENCE_SPAN);
    const intensityTarget =
      DEFAULT_INTENSITY +
      (pseudoRandom(bucket + 1) - 0.5) * 2 * AMBIENT_INTENSITY_SPAN;
    valence = clampValence(
      moveToward(valence, valenceTarget, REGRESSION_VALENCE_STEP)
    );
    intensity = clampIntensity(
      moveToward(intensity, intensityTarget, REGRESSION_INTENSITY_STEP)
    );
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
  AMBIENT_DRIFT_MS,
  AMBIENT_VALENCE_SPAN,
  AMBIENT_INTENSITY_SPAN,
  VALENCE_BANDS,
  clampValence,
  clampIntensity,
  moveToward,
  describe,
  createMood
};

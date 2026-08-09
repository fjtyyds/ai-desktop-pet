'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL } = require('../shared/contracts');

/**
 * 默认人格（与 src/llm/persona.js 的 DEFAULT_PERSONA 保持一致，ADR-011）。
 * 渲染层读取设置时以此预填人格表单；persona.js 对缺失字段仍有默认回退。
 */
const DEFAULT_PERSONA = {
  traits: ['热情', '友善', '好奇'],
  tone: '温暖活泼',
  backstory: '我是你的 AI 桌宠，喜欢陪你聊天、记住你在意的小事，给你带来好心情。'
};

/** persona 清洗上限（非法值丢弃、超长截断） */
const PERSONA_LIMITS = {
  maxTraits: 10,
  maxTraitLength: 20,
  maxToneLength: 50,
  maxBackstoryLength: 500
};

/** apiKey/model 清洗上限（ADR-015） */
const API_KEY_MAX_LENGTH = 256;
const MODEL_MAX_LENGTH = 100;

/** personaTemplate id 清洗上限（T-20） */
const PERSONA_TEMPLATE_ID_MAX_LENGTH = 40;

/** 天气城市名清洗上限（T-22） */
const WEATHER_CITY_MAX_LENGTH = 64;

/**
 * 预设人格模板 id（T-20）。
 * 与渲染层 chat.js 内联双语模板表（PERSONA_TEMPLATES）的键一一对应；
 * 此处冻结 id 清单供主进程校验/默认值使用。
 */
const PERSONA_TEMPLATE_IDS = ['warm', 'sage', 'playful', 'gentle', 'cool', 'curious'];

/** 默认人格模板 id（与 DEFAULT_PERSONA 内容一致，T-20） */
const DEFAULT_PERSONA_TEMPLATE_ID = 'warm';

/** 支持的语言设置：'system' = 跟随系统；'zh-CN' / 'en' 为显式选择（ADR-018，T-12） */
const SUPPORTED_LANGUAGES = ['system', 'zh-CN', 'en'];

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  petName: 'AI 桌宠',
  language: 'system',
  idleEnabled: true, // T-15：空闲主动互动开关，默认开启
  dockEnabled: true, // T-19：贴边隐藏开关，默认开启
  shortcutEnabled: true, // T-19：全局快捷键呼出开关，默认开启
  windowBounds: null, // T-19：上次窗口位置 { x, y }；null 表示未保存
  onboardingDone: false, // T-20：首次启动三步引导是否已完成
  personaTemplate: '', // T-20：最近应用的预设人格模板 id；'' 表示自定义/未应用
  weatherEnabled: false, // T-22：角色面板天气小部件开关（可选，默认关闭）
  weatherCity: '', // T-22：天气城市名（Open-Meteo geocoding，中英文均可）
  persona: { ...DEFAULT_PERSONA }
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed == null ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 清洗字符串设置项（ADR-015）：
 * - 非字符串视为非法值，丢弃（保留当前值）
 * - 去首尾空白，超长截断到 maxLength
 * - allowEmpty=false 时空串视为非法，保留当前值
 */
function sanitizeText(value, current, maxLength, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') {
    return current;
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    return current;
  }
  return trimmed.slice(0, maxLength);
}

/** 清洗语言设置：非法值（非字符串/不在支持列表）丢弃，保留当前值 */
function sanitizeLanguage(value, current) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : current;
}

/** 清洗布尔设置项：非布尔值丢弃，保留当前值（T-15 idleEnabled） */
function sanitizeBoolean(value, current) {
  return typeof value === 'boolean' ? value : current;
}

/**
 * 清洗窗口位置（T-19）：
 * - 必须是 { x, y } 且均为有限数值，非法值丢弃（保留当前值）
 * - 显式 null 允许（表示未保存/重置）
 * - 坐标取整，防止浮点抖动
 */
function sanitizeWindowBounds(value, current) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return current;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return current;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** 清洗天气城市名（T-22）：非字符串丢弃；去空白、压缩连续空格、截断到 64 字 */
function sanitizeWeatherCity(value, current) {
  if (typeof value !== 'string') {
    return current;
  }
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, WEATHER_CITY_MAX_LENGTH);
}

/**
 * 清洗 persona 字段（ADR-011/ADR-013）：
 * - traits 必须是字符串数组；非字符串项/空串丢弃，每项截断到 20 字、最多 10 项；
 *   空数组允许（表示回退默认人格）
 * - tone/backstory 必须是字符串；非字符串丢弃（保留现值），字符串去首尾空白并截断
 * - persona 整体非对象（含 null/数组）时丢弃，返回当前值
 */
function sanitizePersona(patchPersona, currentPersona) {
  const base =
    currentPersona && typeof currentPersona === 'object' && !Array.isArray(currentPersona)
      ? currentPersona
      : {};
  if (
    patchPersona === null ||
    typeof patchPersona !== 'object' ||
    Array.isArray(patchPersona)
  ) {
    return base;
  }

  const next = { ...base };
  if (patchPersona.traits !== undefined) {
    if (Array.isArray(patchPersona.traits)) {
      next.traits = patchPersona.traits
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.slice(0, PERSONA_LIMITS.maxTraitLength))
        .slice(0, PERSONA_LIMITS.maxTraits);
    }
    // traits 非数组：非法值丢弃，保留现值
  }

  if (patchPersona.tone !== undefined) {
    if (typeof patchPersona.tone === 'string') {
      next.tone = patchPersona.tone.trim().slice(0, PERSONA_LIMITS.maxToneLength);
    }
    // tone 非字符串：非法值丢弃，保留现值
  }

  if (patchPersona.backstory !== undefined) {
    if (typeof patchPersona.backstory === 'string') {
      next.backstory = patchPersona.backstory
        .trim()
        .slice(0, PERSONA_LIMITS.maxBackstoryLength);
    }
    // backstory 非字符串：非法值丢弃，保留现值
  }

  return next;
}

/**
 * JSON 文件本地存储：settings.json（设置）、messages.json（消息历史）。
 * 注意：MVP 阶段 API Key 以明文保存在本地设置文件中。
 */
function createStore(baseDir) {
  const settingsFile = path.join(baseDir, 'settings.json');
  const messagesFile = path.join(baseDir, 'messages.json');

  function readSettings() {
    const saved = readJsonFile(settingsFile, {});
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    merged.persona = sanitizePersona(merged.persona, DEFAULT_SETTINGS.persona);
    merged.apiKey = sanitizeText(
      merged.apiKey,
      DEFAULT_SETTINGS.apiKey,
      API_KEY_MAX_LENGTH
    );
    merged.model = sanitizeText(
      merged.model,
      DEFAULT_SETTINGS.model,
      MODEL_MAX_LENGTH,
      { allowEmpty: false }
    );
    merged.language = sanitizeLanguage(merged.language, DEFAULT_SETTINGS.language);
    merged.idleEnabled = sanitizeBoolean(
      merged.idleEnabled,
      DEFAULT_SETTINGS.idleEnabled
    );
    merged.dockEnabled = sanitizeBoolean(
      merged.dockEnabled,
      DEFAULT_SETTINGS.dockEnabled
    );
    merged.shortcutEnabled = sanitizeBoolean(
      merged.shortcutEnabled,
      DEFAULT_SETTINGS.shortcutEnabled
    );
    merged.onboardingDone = sanitizeBoolean(
      merged.onboardingDone,
      DEFAULT_SETTINGS.onboardingDone
    );
    merged.personaTemplate = sanitizeText(
      merged.personaTemplate,
      DEFAULT_SETTINGS.personaTemplate,
      PERSONA_TEMPLATE_ID_MAX_LENGTH
    );
    merged.windowBounds = sanitizeWindowBounds(
      merged.windowBounds,
      DEFAULT_SETTINGS.windowBounds
    );
    merged.weatherEnabled = sanitizeBoolean(
      merged.weatherEnabled,
      DEFAULT_SETTINGS.weatherEnabled
    );
    merged.weatherCity = sanitizeWeatherCity(
      merged.weatherCity,
      DEFAULT_SETTINGS.weatherCity
    );
    return merged;
  }

  function writeSettings(patch) {
    const current = readSettings();
    const allowed = [
      'apiKey',
      'model',
      'petName',
      'language',
      'idleEnabled',
      'dockEnabled',
      'shortcutEnabled',
      'windowBounds',
      'onboardingDone',
      'personaTemplate',
      'weatherEnabled',
      'weatherCity'
    ];
    const next = { ...current };
    for (const key of allowed) {
      if (patch && patch[key] !== undefined) {
        if (key === 'apiKey') {
          next.apiKey = sanitizeText(
            patch.apiKey,
            current.apiKey,
            API_KEY_MAX_LENGTH
          );
          continue;
        }
        if (key === 'model') {
          next.model = sanitizeText(
            patch.model,
            current.model,
            MODEL_MAX_LENGTH,
            { allowEmpty: false }
          );
          continue;
        }
        if (key === 'language') {
          next.language = sanitizeLanguage(patch.language, current.language);
          continue;
        }
        if (key === 'idleEnabled') {
          next.idleEnabled = sanitizeBoolean(patch.idleEnabled, current.idleEnabled);
          continue;
        }
        if (key === 'dockEnabled' || key === 'shortcutEnabled') {
          next[key] = sanitizeBoolean(patch[key], current[key]);
          continue;
        }
        if (key === 'windowBounds') {
          next.windowBounds = sanitizeWindowBounds(
            patch.windowBounds,
            current.windowBounds
          );
          continue;
        }
        if (key === 'onboardingDone') {
          next.onboardingDone = sanitizeBoolean(
            patch.onboardingDone,
            current.onboardingDone
          );
          continue;
        }
        if (key === 'personaTemplate') {
          next.personaTemplate = sanitizeText(
            patch.personaTemplate,
            current.personaTemplate,
            PERSONA_TEMPLATE_ID_MAX_LENGTH
          );
          continue;
        }
        if (key === 'weatherEnabled') {
          next.weatherEnabled = sanitizeBoolean(
            patch.weatherEnabled,
            current.weatherEnabled
          );
          continue;
        }
        if (key === 'weatherCity') {
          next.weatherCity = sanitizeWeatherCity(
            patch.weatherCity,
            current.weatherCity
          );
          continue;
        }
        next[key] = typeof patch[key] === 'string' ? patch[key].trim() : String(patch[key]);
      }
    }
    next.persona = sanitizePersona(patch && patch.persona, current.persona);
    writeJsonFile(settingsFile, next);
    return next;
  }

  function readMessages() {
    const saved = readJsonFile(messagesFile, []);
    return Array.isArray(saved) ? saved : [];
  }

  function appendMessages(items) {
    const next = [...readMessages(), ...items];
    writeJsonFile(messagesFile, next);
    return next;
  }

  return { readSettings, writeSettings, readMessages, appendMessages };
}

module.exports = {
  createStore,
  DEFAULT_SETTINGS,
  PERSONA_TEMPLATE_IDS,
  DEFAULT_PERSONA_TEMPLATE_ID
};

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

/** TTS 语音包设置（T-33）：语音包 id ≤ 40 字符，空值表示自动跟随当前 personaTemplate */
const TTS_VOICE_PACK_ID_MAX_LENGTH = 40;

/** 皮肤 id 清洗上限（T-43）：≤ 64 字符，默认 default（内置经典皮肤） */
const SKIN_ID_MAX_LENGTH = 64;
const DEFAULT_SKIN_ID = 'default';
/** T-55/ADR-045：宠物浮窗气泡时长（秒）与提醒透出开关 */
const PET_OVERLAY_BUBBLE_SECONDS_MIN = 3;
const PET_OVERLAY_BUBBLE_SECONDS_MAX = 20;
const DEFAULT_PET_OVERLAY_BUBBLE_SECONDS = 6;

/** 天气城市名清洗上限（T-22） */
const WEATHER_CITY_MAX_LENGTH = 64;
/** T-44：主题（深色玻璃拟态/浅色），默认深色 */
const THEMES = ['dark', 'light'];
const DEFAULT_THEME = 'dark';
/** T-44：喝水提醒间隔（分钟），默认 60，允许 5~240 */
const WATER_INTERVAL_MIN_MIN = 5;
const WATER_INTERVAL_MIN_MAX = 240;
const DEFAULT_WATER_INTERVAL_MINUTES = 60;
/** T-44：待办数量与字段上限 */
const TODOS_MAX_LENGTH = 100;
const TODO_ID_MAX_LENGTH = 64;
const TODO_TEXT_MAX_LENGTH = 200;

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

/** 许可证档位（T-40）：与 src/main/license.js TIERS 保持一致 */
const LICENSE_TIERS = ['free', 'yearly', 'lifetime'];
/** 许可证字段长度上限（T-40）：与 src/main/license.js 保持一致 */
const LICENSE_KEY_MAX_LENGTH = 128;
const LICENSE_DEVICE_ID_MAX_LENGTH = 64;

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  petName: 'AI 桌宠',
  language: 'system',
  licenseTier: 'free', // T-40：free / yearly（Pro 订阅）/ lifetime（永久买断）
  licenseKey: '', // T-40：激活码/订单号（仅本地校验，不落任何密钥）
  licenseExpiresAt: 0, // T-40：订阅到期时间戳；0 = 永久/未激活
  deviceId: '', // T-40：设备绑定标识（首次生成后不再变化）
  complianceAccepted: false, // T-40：首次启动年龄确认+内容合规声明是否已同意
  idleEnabled: true, // T-15：空闲主动互动开关，默认开启
  dockEnabled: true, // T-31：靠边吸附开关（方案 B：不自动隐藏），默认开启
  windowBounds: null, // T-19：上次窗口位置 { x, y }；null 表示未保存
  onboardingDone: false, // T-20：首次启动三步引导是否已完成
  personaTemplate: '', // T-20：最近应用的预设人格模板 id；'' 表示自定义/未应用
  ttsVoicePackEnabled: true, // T-33：专属语音包开关（关闭回退系统默认 TTS）
  ttsVoicePackId: '', // T-33：语音包 id（≤40；''=自动跟随当前 personaTemplate）
  weatherEnabled: false, // T-22：角色面板天气小部件开关（可选，默认关闭）
  weatherCity: '', // T-22：天气城市名（Open-Meteo geocoding，中英文均可）
  telemetryEnabled: false, // T-42：匿名遥测开关（opt-in，默认关闭）
  theme: DEFAULT_THEME, // T-44：主题（dark/light，默认深色玻璃拟态）
  reduceMotion: false, // T-44：减弱动效开关（关闭呼吸/眨眼/过渡动画）
  waterReminder: {
    enabled: false,
    intervalMinutes: DEFAULT_WATER_INTERVAL_MINUTES,
    lastDrinkAt: 0
  }, // T-44：喝水提醒（间隔与最近一次喝水时间）
  todos: [], // T-44：待办列表 { id, text, done, createdAt, completedAt }
  skinId: DEFAULT_SKIN_ID, // T-43：当前启用皮肤 id（≤64；default=内置经典皮肤）
  petOverlayEnabled: false, // T-55：宠物浮窗（Codex Pets 式独立悬浮宠物）开关，默认关闭
  petOverlayBounds: null, // T-55：宠物浮窗位置 { x, y }；null 表示未保存
  petOverlayBubbleSeconds: DEFAULT_PET_OVERLAY_BUBBLE_SECONDS, // ADR-045：气泡显示时长（秒）
  petOverlayBubbleEnabled: true, // ADR-045：气泡显示开关
  petOverlayReminders: true, // ADR-045：提醒（空闲互动/喝水等）透出到浮窗气泡
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

/** 清洗整数设置项：非法值丢弃（保留当前值），数值四舍五入并限制在 [min, max] */
function sanitizeInteger(value, current, min, max) {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) {
    return current;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/** 清洗非负整数（时间戳等）；非法值保留当前值 */
function sanitizeNonNegativeInteger(value, current) {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) {
    return current;
  }
  return Math.max(0, Math.round(numeric));
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
  // ADR-045：可选 displayId（显示器标识），非法值忽略
  const displayId =
    Number.isInteger(value.displayId) && value.displayId >= 0
      ? value.displayId
      : undefined;
  const bounds = { x: Math.round(x), y: Math.round(y) };
  if (displayId !== undefined) {
    bounds.displayId = displayId;
  }
  return bounds;
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

/** T-44：主题清洗：仅允许 dark/light，非法值保留当前值 */
function sanitizeTheme(value, current) {
  return THEMES.includes(value) ? value : current;
}

/** T-44：喝水提醒清洗：enabled 布尔 + 间隔 5~240 分钟 + 最近喝水时间戳 */
function sanitizeWaterReminder(value, current) {
  const fallback = {
    enabled: false,
    intervalMinutes: DEFAULT_WATER_INTERVAL_MINUTES,
    lastDrinkAt: 0
  };
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return current && typeof current === 'object' ? current : fallback;
  }
  const base = current && typeof current === 'object' ? current : fallback;
  return {
    enabled: sanitizeBoolean(value.enabled, base.enabled),
    intervalMinutes: sanitizeInteger(
      value.intervalMinutes,
      base.intervalMinutes,
      WATER_INTERVAL_MIN_MIN,
      WATER_INTERVAL_MIN_MAX
    ),
    lastDrinkAt: sanitizeNonNegativeInteger(value.lastDrinkAt, base.lastDrinkAt)
  };
}

/** T-44：待办清洗：数组、上限 100 条、id 去重、text 去空白截断 */
function sanitizeTodos(value, current) {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return Array.isArray(current) ? current : [];
  }
  const seen = new Set();
  const next = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const id = typeof item.id === 'string' ? item.id.slice(0, TODO_ID_MAX_LENGTH) : '';
    if (!id || seen.has(id)) {
      continue;
    }
    const text =
      typeof item.text === 'string' ? item.text.trim().slice(0, TODO_TEXT_MAX_LENGTH) : '';
    if (!text) {
      continue;
    }
    seen.add(id);
    next.push({
      id,
      text,
      done: sanitizeBoolean(item.done, false),
      createdAt: sanitizeNonNegativeInteger(item.createdAt, Date.now()),
      completedAt: sanitizeNonNegativeInteger(item.completedAt, 0)
    });
    if (next.length >= TODOS_MAX_LENGTH) {
      break;
    }
  }
  return next;
}

/** 清洗许可证档位：非法值（不在 free/yearly/lifetime）丢弃，保留当前值 */
function sanitizeLicenseTier(value, current) {
  return LICENSE_TIERS.includes(value) ? value : current;
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
    merged.licenseTier = sanitizeLicenseTier(
      merged.licenseTier,
      DEFAULT_SETTINGS.licenseTier
    );
    merged.licenseKey = sanitizeText(
      merged.licenseKey,
      DEFAULT_SETTINGS.licenseKey,
      LICENSE_KEY_MAX_LENGTH
    );
    merged.licenseExpiresAt = sanitizeNonNegativeInteger(
      merged.licenseExpiresAt,
      DEFAULT_SETTINGS.licenseExpiresAt
    );
    merged.deviceId = sanitizeText(
      merged.deviceId,
      DEFAULT_SETTINGS.deviceId,
      LICENSE_DEVICE_ID_MAX_LENGTH
    );
    merged.complianceAccepted = sanitizeBoolean(
      merged.complianceAccepted,
      DEFAULT_SETTINGS.complianceAccepted
    );
    merged.idleEnabled = sanitizeBoolean(
      merged.idleEnabled,
      DEFAULT_SETTINGS.idleEnabled
    );
    merged.dockEnabled = sanitizeBoolean(
      merged.dockEnabled,
      DEFAULT_SETTINGS.dockEnabled
    );
    // T-29：旧 shortcutEnabled 字段按 ADR-026 移除，兼容忽略并清理
    delete merged.shortcutEnabled;
    // T-50：旧 pomodoro 设置字段按 ADR-038 整体移除，兼容忽略并清理（不迁移、不暴露）
    delete merged.pomodoroEnabled;
    delete merged.pomodoroMinutes;
    delete merged.pomodoroNotifyAt;
    delete merged.pomodoroNotifyMinutes;
    // T-51：旧 focusStats 字段按 ADR-039 整体移除，兼容忽略并清理（不迁移、不暴露）
    delete merged.focusStats;
    merged.onboardingDone = sanitizeBoolean(
      merged.onboardingDone,
      DEFAULT_SETTINGS.onboardingDone
    );
    merged.personaTemplate = sanitizeText(
      merged.personaTemplate,
      DEFAULT_SETTINGS.personaTemplate,
      PERSONA_TEMPLATE_ID_MAX_LENGTH
    );
    merged.ttsVoicePackEnabled = sanitizeBoolean(
      merged.ttsVoicePackEnabled,
      DEFAULT_SETTINGS.ttsVoicePackEnabled
    );
    merged.ttsVoicePackId = sanitizeText(
      merged.ttsVoicePackId,
      DEFAULT_SETTINGS.ttsVoicePackId,
      TTS_VOICE_PACK_ID_MAX_LENGTH
    );
    merged.skinId = sanitizeText(
      merged.skinId,
      DEFAULT_SETTINGS.skinId,
      SKIN_ID_MAX_LENGTH
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
    merged.telemetryEnabled = sanitizeBoolean(
      merged.telemetryEnabled,
      DEFAULT_SETTINGS.telemetryEnabled
    );
    merged.theme = sanitizeTheme(merged.theme, DEFAULT_SETTINGS.theme);
    merged.reduceMotion = sanitizeBoolean(
      merged.reduceMotion,
      DEFAULT_SETTINGS.reduceMotion
    );
    merged.waterReminder = sanitizeWaterReminder(
      merged.waterReminder,
      DEFAULT_SETTINGS.waterReminder
    );
    merged.todos = sanitizeTodos(merged.todos, DEFAULT_SETTINGS.todos);
    merged.petOverlayEnabled = sanitizeBoolean(
      merged.petOverlayEnabled,
      DEFAULT_SETTINGS.petOverlayEnabled
    );
    merged.petOverlayBounds = sanitizeWindowBounds(
      merged.petOverlayBounds,
      DEFAULT_SETTINGS.petOverlayBounds
    );
    merged.petOverlayBubbleSeconds = sanitizeInteger(
      merged.petOverlayBubbleSeconds,
      DEFAULT_SETTINGS.petOverlayBubbleSeconds,
      PET_OVERLAY_BUBBLE_SECONDS_MIN,
      PET_OVERLAY_BUBBLE_SECONDS_MAX
    );
    merged.petOverlayBubbleEnabled = sanitizeBoolean(
      merged.petOverlayBubbleEnabled,
      DEFAULT_SETTINGS.petOverlayBubbleEnabled
    );
    merged.petOverlayReminders = sanitizeBoolean(
      merged.petOverlayReminders,
      DEFAULT_SETTINGS.petOverlayReminders
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
      'licenseTier',
      'licenseKey',
      'licenseExpiresAt',
      'deviceId',
      'complianceAccepted',
      'idleEnabled',
      'dockEnabled',
      'windowBounds',
      'onboardingDone',
      'personaTemplate',
      'ttsVoicePackEnabled',
      'ttsVoicePackId',
      'skinId',
      'weatherEnabled',
      'weatherCity',
      'telemetryEnabled',
      'theme',
      'reduceMotion',
      'waterReminder',
      'todos',
      'petOverlayEnabled',
      'petOverlayBounds',
      'petOverlayBubbleSeconds',
      'petOverlayBubbleEnabled',
      'petOverlayReminders'
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
        if (key === 'licenseTier') {
          next.licenseTier = sanitizeLicenseTier(
            patch.licenseTier,
            current.licenseTier
          );
          continue;
        }
        if (key === 'licenseKey') {
          next.licenseKey = sanitizeText(
            patch.licenseKey,
            current.licenseKey,
            LICENSE_KEY_MAX_LENGTH
          );
          continue;
        }
        if (key === 'licenseExpiresAt') {
          next.licenseExpiresAt = sanitizeNonNegativeInteger(
            patch.licenseExpiresAt,
            current.licenseExpiresAt
          );
          continue;
        }
        if (key === 'deviceId') {
          next.deviceId = sanitizeText(
            patch.deviceId,
            current.deviceId,
            LICENSE_DEVICE_ID_MAX_LENGTH
          );
          continue;
        }
        if (key === 'complianceAccepted') {
          next.complianceAccepted = sanitizeBoolean(
            patch.complianceAccepted,
            current.complianceAccepted
          );
          continue;
        }
        if (key === 'idleEnabled') {
          next.idleEnabled = sanitizeBoolean(patch.idleEnabled, current.idleEnabled);
          continue;
        }
        if (key === 'dockEnabled') {
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
        if (key === 'ttsVoicePackEnabled') {
          next.ttsVoicePackEnabled = sanitizeBoolean(
            patch.ttsVoicePackEnabled,
            current.ttsVoicePackEnabled
          );
          continue;
        }
        if (key === 'ttsVoicePackId') {
          next.ttsVoicePackId = sanitizeText(
            patch.ttsVoicePackId,
            current.ttsVoicePackId,
            TTS_VOICE_PACK_ID_MAX_LENGTH
          );
          continue;
        }
        if (key === 'skinId') {
          next.skinId = sanitizeText(
            patch.skinId,
            current.skinId,
            SKIN_ID_MAX_LENGTH
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
        if (key === 'telemetryEnabled') {
          next.telemetryEnabled = sanitizeBoolean(
            patch.telemetryEnabled,
            current.telemetryEnabled
          );
          continue;
        }
        if (key === 'theme') {
          next.theme = sanitizeTheme(patch.theme, current.theme);
          continue;
        }
        if (key === 'reduceMotion') {
          next.reduceMotion = sanitizeBoolean(
            patch.reduceMotion,
            current.reduceMotion
          );
          continue;
        }
        if (key === 'waterReminder') {
          next.waterReminder = sanitizeWaterReminder(
            patch.waterReminder,
            current.waterReminder
          );
          continue;
        }
        if (key === 'todos') {
          next.todos = sanitizeTodos(patch.todos, current.todos);
          continue;
        }
        if (key === 'petOverlayEnabled') {
          next.petOverlayEnabled = sanitizeBoolean(
            patch.petOverlayEnabled,
            current.petOverlayEnabled
          );
          continue;
        }
        if (key === 'petOverlayBounds') {
          next.petOverlayBounds = sanitizeWindowBounds(
            patch.petOverlayBounds,
            current.petOverlayBounds
          );
          continue;
        }
        if (key === 'petOverlayBubbleSeconds') {
          next.petOverlayBubbleSeconds = sanitizeInteger(
            patch.petOverlayBubbleSeconds,
            current.petOverlayBubbleSeconds,
            PET_OVERLAY_BUBBLE_SECONDS_MIN,
            PET_OVERLAY_BUBBLE_SECONDS_MAX
          );
          continue;
        }
        if (key === 'petOverlayBubbleEnabled') {
          next.petOverlayBubbleEnabled = sanitizeBoolean(
            patch.petOverlayBubbleEnabled,
            current.petOverlayBubbleEnabled
          );
          continue;
        }
        if (key === 'petOverlayReminders') {
          next.petOverlayReminders = sanitizeBoolean(
            patch.petOverlayReminders,
            current.petOverlayReminders
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
  DEFAULT_PERSONA_TEMPLATE_ID,
  LICENSE_TIERS,
  LICENSE_KEY_MAX_LENGTH,
  TTS_VOICE_PACK_ID_MAX_LENGTH,
  THEMES,
  DEFAULT_THEME,
  WATER_INTERVAL_MIN_MIN,
  WATER_INTERVAL_MIN_MAX,
  DEFAULT_WATER_INTERVAL_MINUTES,
  PET_OVERLAY_BUBBLE_SECONDS_MIN,
  PET_OVERLAY_BUBBLE_SECONDS_MAX,
  DEFAULT_PET_OVERLAY_BUBBLE_SECONDS,
  TODOS_MAX_LENGTH,
  TODO_ID_MAX_LENGTH,
  TODO_TEXT_MAX_LENGTH
};

'use strict';

/**
 * T-42 匿名遥测（opt-in、脱敏、批量上报）
 *
 * 职责：
 * - 仅当用户明确开启（settings.telemetryEnabled === true）后才采集事件；
 *   默认关闭，未开启时不产生任何数据。
 * - 事件只含聚合字段（次数/时长/档位等）：不采集消息正文、apiKey、
 *   绝对路径、用户名、城市、许可证密钥等任何可识别内容。
 * - deviceId 为随机 UUID，与许可证完全解耦；清除遥测数据后一并删除。
 * - 本地队列持久化（telemetry/queue.json），断网/失败时保留，网络恢复
 *   或下次启动时批量补发；上报失败绝不影响应用主流程。
 * - 上报端点通过环境变量 AI_PET_TELEMETRY_ENDPOINT 配置，默认空串 =
 *   不上传任何数据（未显式配置时绝不外发）。
 *
 * 本模块不依赖 Electron，可在纯 Node 环境中单测（scripts/check.js）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** 上报端点环境变量名；默认空串 = 不发送 */
const ENDPOINT_ENV = 'AI_PET_TELEMETRY_ENDPOINT';
const DEFAULT_ENDPOINT = '';

/** 单批上报事件数；队列达到该数量时立即尝试批量补发 */
const BATCH_SIZE = 20;
/** 本地队列上限（事件数），超出时丢弃最旧事件，防止无限膨胀 */
const QUEUE_MAX_EVENTS = 500;
/** 单次 flush 最多发送批次数（防失控大队列长时间占用） */
const MAX_BATCHES_PER_FLUSH = 25;
/** 单批 HTTP 超时（毫秒） */
const FLUSH_TIMEOUT_MS = 10000;

/** 允许的事件白名单（T-42 验收：安装/启动/对话/付费/留存等） */
const EVENT_NAMES = [
  'app_install', // 首次创建设备标识（opt-in 后记录）
  'app_start', // 每次应用启动（留存漏斗）
  'session_end', // 退出时的会话时长（留存漏斗）
  'chat_sent', // 发送消息（仅字数/是否流式）
  'chat_reply', // 收到回复（仅结果/回复字数/耗时）
  'license_state_change', // 许可证状态/档位（T-40 合并后接线；档位属聚合字段）
  'weather_refresh' // 天气刷新（仅结果/耗时）
];
const EVENT_NAMES_SET = new Set(EVENT_NAMES);

const RULE_STRING_40 = { type: 'string', max: 40 };
const RULE_STRING_64 = { type: 'string', max: 64 };
const RULE_NUMBER = { type: 'number' };

/**
 * 各事件的字段白名单。字段名与字段值都必须在此约束内：
 * - number：有限数值（绝对值 ≤ 1e9）
 * - string：非空、去首尾空白、截断到 max
 * 白名单之外或命中敏感模式（正文/密钥/路径/用户名等）的字段一律丢弃。
 */
const FIELD_RULES = {
  app_install: { version: RULE_STRING_40 },
  app_start: {
    sessionId: RULE_STRING_64,
    version: RULE_STRING_40,
    locale: RULE_STRING_40
  },
  session_end: {
    sessionId: RULE_STRING_64,
    durationSec: RULE_NUMBER
  },
  chat_sent: {
    chars: RULE_NUMBER,
    stream: RULE_NUMBER
  },
  chat_reply: {
    ok: RULE_NUMBER,
    replyChars: RULE_NUMBER,
    latencyMs: RULE_NUMBER
  },
  license_state_change: {
    state: RULE_STRING_40,
    tier: RULE_STRING_40
  },
  weather_refresh: {
    ok: RULE_NUMBER,
    latencyMs: RULE_NUMBER
  }
};

/**
 * 敏感字段名兜底模式：即使误传给 track()，命中这些模式的字段也绝不放行。
 * （消息正文、密钥、路径、用户名、城市、许可证密钥、邮箱、电话等）
 */
const FORBIDDEN_FIELD_PATTERN =
  /(text|message|content|body|prompt|history|api[-_]?key|secret|token|password|passwd|path|file|dir(?:name)?|\buser(?:name)?\b|home|city|address|license[-_]?key|serial|email|phone)/i;

/** 敏感值兜底模式：即使字段名通过了白名单，值本身命中这些模式也丢弃 */
const FORBIDDEN_VALUE_PATTERN =
  /(sk-[a-zA-Z0-9]|api[_-]?key\s*[:=]|secret\s*[:=]|token\s*[:=]|password\s*[:=]|[A-Za-z]:\\|\/home\/|\/Users\/|license[_-]?key\s*[:=])/i;

function readJsonFile(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed == null ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function describeError(value) {
  if (value instanceof Error) {
    return value.message || String(value);
  }
  try {
    return JSON.stringify(value) || String(value);
  } catch (_error) {
    return String(value);
  }
}

/**
 * 字段清洗：只保留该事件白名单内的字段；数值必须有限，字符串截断。
 * 导出供 scripts/check.js 直接断言脱敏规则。
 */
function sanitizeEventFields(eventName, fields) {
  const rules = FIELD_RULES[eventName] || {};
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (!Object.prototype.hasOwnProperty.call(rules, key)) {
      continue;
    }
    if (FORBIDDEN_FIELD_PATTERN.test(key)) {
      continue;
    }
    const rule = rules[key];
    if (rule.type === 'number') {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && Math.abs(numeric) <= 1e9) {
        out[key] = numeric;
      }
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || FORBIDDEN_VALUE_PATTERN.test(trimmed)) {
      continue;
    }
    out[key] = trimmed.slice(0, rule.max);
  }
  return out;
}

/**
 * 创建遥测实例（纯函数工厂，便于测试隔离）。
 *
 * @param {object} options
 * @param {string} options.baseDir 遥测数据目录（queue.json / device.json 所在目录）
 * @param {string} [options.endpoint] 上报端点；默认空串 = 不发送
 * @param {boolean} [options.enabled] 静态开关（测试用）
 * @param {() => boolean} [options.getEnabled] 动态开关（运行时从设置读取）
 * @param {string} [options.appName] 上报 app 名（默认 'ai-desktop-pet'）
 * @param {string} [options.version] 上报应用版本
 */
function createTelemetry(options = {}) {
  const dataDir = options.baseDir || path.join(os.tmpdir(), 'ai-pet-telemetry');
  const queueFile = path.join(dataDir, 'queue.json');
  const deviceFile = path.join(dataDir, 'device.json');
  const endpoint = typeof options.endpoint === 'string' ? options.endpoint : DEFAULT_ENDPOINT;
  const appName = typeof options.appName === 'string' && options.appName ? options.appName : 'ai-desktop-pet';
  const version = typeof options.version === 'string' ? options.version : '';
  const logger = options.logger || console;

  let deviceCache = null;
  let sessionId = null;
  let lastFlushAt = null;
  let flushInFlight = false;

  function log(level, message) {
    try {
      if (logger && typeof logger[level] === 'function') {
        logger[level](`[telemetry] ${message}`);
      }
    } catch (_error) {
      // 日志失败不影响遥测主流程
    }
  }

  function isEnabled() {
    if (typeof options.getEnabled === 'function') {
      try {
        return options.getEnabled() === true;
      } catch (_error) {
        return false; // 设置读取失败按关闭处理，绝不误采
      }
    }
    return options.enabled === true;
  }

  function readQueue() {
    const saved = readJsonFile(queueFile, null);
    if (saved && Array.isArray(saved.events)) {
      return saved;
    }
    return { events: [] };
  }

  function writeQueue(queue) {
    writeJsonFile(queueFile, { events: queue.events });
  }

  /** 读取设备标识（不创建）；不存在时返回 null（清除后应为 null） */
  function readDevice() {
    const saved = readJsonFile(deviceFile, null);
    if (
      saved &&
      typeof saved.deviceId === 'string' &&
      saved.deviceId.length === 36 &&
      typeof saved.createdAt === 'number'
    ) {
      return saved;
    }
    return null;
  }

  /**
   * 确保设备标识存在：首次创建时生成随机 UUID（与许可证无关），
   * 并返回 { device, isNew } 供 app_install 事件判断。
   */
  function ensureDevice() {
    const existing = deviceCache || readDevice();
    if (existing) {
      deviceCache = existing;
      return { device: existing, isNew: false };
    }
    const device = {
      deviceId: crypto.randomUUID(),
      createdAt: Date.now()
    };
    writeJsonFile(deviceFile, device);
    deviceCache = device;
    return { device, isNew: true };
  }

  function getSessionId() {
    if (!sessionId) {
      sessionId = crypto.randomUUID();
    }
    return sessionId;
  }

  /**
   * 记录事件（同步落盘；达到批量阈值时后台触发补发）。
   * 关闭状态 / 未知事件 / 未白名单字段一律丢弃。
   */
  function track(eventName, fields = {}) {
    if (!isEnabled()) {
      return { ok: false, reason: 'disabled' };
    }
    if (!EVENT_NAMES_SET.has(eventName)) {
      log('warn', `忽略未知遥测事件: ${eventName}`);
      return { ok: false, reason: 'unknown-event' };
    }
    const cleanFields = sanitizeEventFields(eventName, fields);
    const event = {
      id: crypto.randomUUID(),
      name: eventName,
      ts: Date.now(),
      fields: cleanFields
    };
    const queue = readQueue();
    queue.events.push(event);
    if (queue.events.length > QUEUE_MAX_EVENTS) {
      queue.events.splice(0, queue.events.length - QUEUE_MAX_EVENTS);
    }
    writeQueue(queue);
    if (queue.events.length >= BATCH_SIZE) {
      void flush();
    }
    return { ok: true, id: event.id };
  }

  /** 首次创建设备标识时记录 app_install（仅在用户已开启遥测时真正入队） */
  function trackInstallIfFirstRun() {
    const { device, isNew } = ensureDevice();
    if (isNew) {
      track('app_install', { version });
    }
    return { isNew, deviceId: device.deviceId };
  }

  /**
   * 批量上报本地队列：
   * - 未开启 / 端点为空时不上传（默认空串 = 永不外发）
   * - 每批 BATCH_SIZE 条，成功一批从队列移除一批
   * - 任意失败即中止并保留剩余队列，等待下次 flush（重连/下次启动）
   */
  async function flush() {
    if (flushInFlight) {
      return { ok: false, reason: 'busy', sent: 0, queued: readQueue().events.length };
    }
    if (!isEnabled()) {
      return { ok: false, reason: 'disabled', sent: 0, queued: readQueue().events.length };
    }
    if (!endpoint) {
      return { ok: false, reason: 'no-endpoint', sent: 0, queued: readQueue().events.length };
    }
    const queue = readQueue();
    if (!queue.events.length) {
      return { ok: true, sent: 0, queued: 0 };
    }

    flushInFlight = true;
    let sent = 0;
    let pending = queue.events;
    try {
      let batches = 0;
      while (pending.length > 0 && batches < MAX_BATCHES_PER_FLUSH) {
        const batch = pending.slice(0, BATCH_SIZE);
        const device = ensureDevice().device;
        const body = JSON.stringify({
          deviceId: device.deviceId,
          app: { name: appName, version },
          events: batch
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
        let response = null;
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'ai-desktop-pet-telemetry/0.1'
            },
            body,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response || !response.ok) {
          throw new Error(`HTTP ${response ? response.status : '无响应'}`);
        }
        sent += batch.length;
        batches += 1;
        pending = pending.slice(BATCH_SIZE);
        writeQueue({ events: pending });
      }
      lastFlushAt = Date.now();
      return { ok: true, sent, queued: pending.length };
    } catch (error) {
      log('warn', `批量上报失败，事件保留在本地队列: ${describeError(error)}`);
      return {
        ok: false,
        sent,
        error: describeError(error),
        queued: readQueue().events.length
      };
    } finally {
      flushInFlight = false;
    }
  }

  /** 一键清除：清空队列并删除设备标识（下次启用时生成全新 UUID） */
  function clear() {
    const queue = readQueue();
    const clearedEvents = queue.events.length;
    writeQueue({ events: [] });
    let deviceReset = false;
    try {
      if (fs.existsSync(deviceFile)) {
        fs.rmSync(deviceFile, { force: true });
      }
      deviceReset = true;
    } catch (_error) {
      deviceReset = false;
    }
    deviceCache = null;
    sessionId = null;
    lastFlushAt = null;
    return { clearedEvents, deviceReset };
  }

  function getStatus() {
    const device = deviceCache || readDevice();
    return {
      enabled: isEnabled(),
      endpointConfigured: Boolean(endpoint),
      deviceId: device ? device.deviceId : null,
      queuedCount: readQueue().events.length,
      lastFlushAt,
      flushInFlight
    };
  }

  /** T-40 合并后的付费联动入口：只传档位/状态聚合字段 */
  function trackLicenseState(state, tier) {
    return track('license_state_change', { state, tier });
  }

  return {
    track,
    trackInstallIfFirstRun,
    trackLicenseState,
    flush,
    clear,
    getStatus,
    getSessionId,
    getEndpoint: () => endpoint
  };
}

let singleton = null;

/** 应用运行时单例（main.js 在 app ready 时初始化） */
function initTelemetry(options) {
  if (!singleton) {
    singleton = createTelemetry(options);
  }
  return singleton;
}

function getTelemetry() {
  return singleton;
}

module.exports = {
  createTelemetry,
  initTelemetry,
  getTelemetry,
  sanitizeEventFields,
  DEFAULT_ENDPOINT,
  ENDPOINT_ENV,
  EVENT_NAMES,
  FIELD_RULES
};

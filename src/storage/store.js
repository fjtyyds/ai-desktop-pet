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

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  petName: 'AI 桌宠',
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
    return merged;
  }

  function writeSettings(patch) {
    const current = readSettings();
    const allowed = ['apiKey', 'model', 'petName'];
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

module.exports = { createStore, DEFAULT_SETTINGS };

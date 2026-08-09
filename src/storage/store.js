'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL } = require('../shared/contracts');

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: DEFAULT_MODEL,
  petName: 'AI 桌宠'
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
 * JSON 文件本地存储：settings.json（设置）、messages.json（消息历史）。
 * 注意：MVP 阶段 API Key 以明文保存在本地设置文件中。
 */
function createStore(baseDir) {
  const settingsFile = path.join(baseDir, 'settings.json');
  const messagesFile = path.join(baseDir, 'messages.json');

  function readSettings() {
    const saved = readJsonFile(settingsFile, {});
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  function writeSettings(patch) {
    const current = readSettings();
    const allowed = ['apiKey', 'model', 'petName'];
    const next = { ...current };
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        next[key] = typeof patch[key] === 'string' ? patch[key].trim() : String(patch[key]);
      }
    }
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

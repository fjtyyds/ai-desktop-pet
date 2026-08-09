'use strict';

/**
 * T-13 API Key 加密存储（ADR-019）。
 *
 * 边界约定：
 * - 只负责 apiKey 的“主进程加解密”，其他设置字段仍由 store.js 原样读写。
 * - store.js 保持纯 JSON、不感知加密；settings.json 的 apiKey 字段落盘为
 *   `enc:v1:<base64>` 密文（Electron safeStorage / Windows DPAPI）。
 * - 旧明文 apiKey 首次读取时自动迁移为密文。
 * - safeStorage 不可用时回退明文并记录告警，功能不中断。
 *
 * 注意：DPAPI 密文经 base64 编码后可能超过 store.js 的 apiKey 256 字符清洗
 * 上限（ADR-015），因此本模块负责 apiKey 字段的原始 JSON 读写与清洗；
 * store.js 仍保持纯 JSON、不感知加密。
 */

const fs = require('fs');
const path = require('path');
const { resolveBaseDir } = require('../storage');

/** 与 src/storage/store.js 的 API_KEY_MAX_LENGTH 保持一致（ADR-015） */
const API_KEY_MAX_LENGTH = 256;

/** 密文标记：enc:v1:<base64>（v1 = safeStorage/DPAPI） */
const ENCRYPTED_PREFIX = 'enc:v1:';

function loadElectron() {
  try {
    return require('electron');
  } catch (_error) {
    // 纯 Node 环境（单元测试）没有 electron 对象，由调用方注入实现
    return null;
  }
}

/**
 * 创建 secure-settings 实例。
 *
 * 生产环境不传任何注入参数，自动使用 Electron 的 safeStorage/app。
 * 测试环境可注入 safeStorageImpl/appImpl/warn/baseDir（safeStorage 不可用
 * 场景用注入实现，避免依赖真实系统状态）。
 */
function createSecureSettings(options) {
  const opts = options || {};
  const electron = opts.electron || loadElectron();
  const store = opts.store;
  const safeStorage = opts.safeStorageImpl || (electron && electron.safeStorage);
  const app = opts.appImpl || (electron && electron.app);
  const warn =
    typeof opts.warn === 'function'
      ? opts.warn
      : (message) => console.warn(message);
  const baseDir = opts.baseDir || resolveBaseDir();
  const settingsFile = path.join(baseDir, 'settings.json');

  let fallbackWarned = false;

  function isEncryptionAvailable() {
    try {
      return Boolean(
        safeStorage &&
          app &&
          typeof app.isReady === 'function' &&
          app.isReady() &&
          typeof safeStorage.isEncryptionAvailable === 'function' &&
          safeStorage.isEncryptionAvailable()
      );
    } catch (_error) {
      return false;
    }
  }

  /** 与 store.js 的 sanitizeText 对 apiKey 的规则保持一致（ADR-015） */
  function sanitizeApiKey(value, current) {
    if (typeof value !== 'string') {
      return current;
    }
    return value.trim().slice(0, API_KEY_MAX_LENGTH);
  }

  function readRawSettings() {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_error) {
      return {};
    }
  }

  function writeRawSettings(data) {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  }

  function warnFallbackOnce() {
    if (!fallbackWarned) {
      fallbackWarned = true;
      warn('[secure-settings] safeStorage 不可用，apiKey 回退为明文存储（未加密）');
    }
  }

  /** 明文 -> 落盘值；加密不可用或失败时回退明文并告警 */
  function encodeApiKey(plain) {
    if (!plain) {
      return '';
    }
    if (!isEncryptionAvailable()) {
      warnFallbackOnce();
      return plain;
    }
    try {
      return ENCRYPTED_PREFIX + safeStorage.encryptString(plain).toString('base64');
    } catch (_error) {
      warnFallbackOnce();
      return plain;
    }
  }

  /** 落盘值 -> 明文；旧明文原样返回，密文无法解密时返回空值并告警 */
  function decodeApiKey(stored) {
    if (!stored) {
      return '';
    }
    if (!stored.startsWith(ENCRYPTED_PREFIX)) {
      return stored;
    }
    if (!isEncryptionAvailable()) {
      warnFallbackOnce();
      warn(
        '[secure-settings] apiKey 密文无法解密（safeStorage 不可用），已返回空值；请重新输入密钥'
      );
      return '';
    }
    try {
      const buf = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
      return sanitizeApiKey(safeStorage.decryptString(buf), '');
    } catch (_error) {
      warn(
        '[secure-settings] apiKey 解密失败（密文可能已损坏或来自其他机器），已返回空值；请重新输入密钥'
      );
      return '';
    }
  }

  /** 旧明文首次读取自动迁移为密文（加密不可用时保留明文并已告警） */
  function migrateLegacyPlain(plain) {
    if (!plain) {
      return;
    }
    const encoded = encodeApiKey(plain);
    if (encoded === plain) {
      return;
    }
    const raw = readRawSettings();
    writeRawSettings({ ...raw, apiKey: encoded });
  }

  function readSettings() {
    const base = store.readSettings();
    const raw = readRawSettings();
    const stored = typeof raw.apiKey === 'string' ? raw.apiKey : '';
    let apiKey;
    if (stored.startsWith(ENCRYPTED_PREFIX)) {
      apiKey = decodeApiKey(stored);
    } else if (stored) {
      // 旧明文：按 store 规则清洗后返回，并自动迁移为密文
      apiKey = sanitizeApiKey(stored, '');
      migrateLegacyPlain(apiKey);
    } else {
      apiKey = '';
    }
    return { ...base, apiKey };
  }

  function writeSettings(patch) {
    const safePatch = patch && typeof patch === 'object' ? patch : {};
    const rawBefore = readRawSettings();
    const current = readSettings(); // 顺带完成旧明文迁移
    const stored = store.writeSettings(safePatch);
    let plain;
    let encoded;
    if (safePatch.apiKey !== undefined) {
      plain = sanitizeApiKey(safePatch.apiKey, current.apiKey);
      encoded = encodeApiKey(plain);
    } else {
      plain = current.apiKey;
      // 未显式修改 apiKey：复用文件中已有密文，避免每次保存都重新加密
      encoded =
        typeof rawBefore.apiKey === 'string' && rawBefore.apiKey
          ? rawBefore.apiKey
          : encodeApiKey(plain);
    }
    const raw = readRawSettings();
    writeRawSettings({ ...raw, apiKey: encoded });
    return { ...stored, apiKey: plain };
  }

  return { readSettings, writeSettings, isEncryptionAvailable };
}

module.exports = { createSecureSettings, ENCRYPTED_PREFIX, API_KEY_MAX_LENGTH };

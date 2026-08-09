'use strict';

/**
 * i18n 共享模块（T-12，ADR-018）。
 *
 * 双端复用：
 * - 主进程（Node）：同步 fs 读取 JSON，导出翻译函数；
 * - 渲染进程（浏览器）：通过 fetch 加载同一份 JSON，暴露 window.PetLocales。
 *
 * 语言解析规则：zh* → zh-CN，其他（含 en*）→ en；
 * 空值/未知值回退 DEFAULT_LOCALE（zh-CN）。
 * 设置里的 language 为 'system' 时由调用方先用系统语言解析（app.getLocale()/navigator.language）。
 */
(function (globalScope) {
  const SUPPORTED_LOCALES = ['zh-CN', 'en'];
  const DEFAULT_LOCALE = 'zh-CN';

  function resolveLocale(input) {
    if (typeof input !== 'string' || input.trim() === '') {
      return DEFAULT_LOCALE;
    }
    const normalized = input.trim().toLowerCase();
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
    if (normalized === 'en') {
      return 'en';
    }
    return 'en';
  }

  function lookup(messages, key) {
    if (!messages || typeof key !== 'string') {
      return key;
    }
    let node = messages;
    for (const part of key.split('.')) {
      if (node == null || typeof node !== 'object') {
        return key;
      }
      node = node[part];
    }
    return typeof node === 'string' ? node : key;
  }

  function interpolate(text, params) {
    if (typeof text !== 'string' || !params || typeof params !== 'object') {
      return text;
    }
    return text.replace(/\{(\w+)\}/g, (match, name) =>
      params[name] != null ? String(params[name]) : match
    );
  }

  function makeTranslator(messages, locale) {
    function t(key, params) {
      return interpolate(lookup(messages, key), params);
    }
    t.locale = locale;
    t.messages = messages;
    return t;
  }

  const isNode =
    typeof module !== 'undefined' &&
    typeof module.exports !== 'undefined' &&
    typeof require === 'function';

  if (isNode) {
    const fs = require('fs');
    const path = require('path');
    const cache = {};

    function getMessages(locale) {
      const resolved = resolveLocale(locale);
      if (!cache[resolved]) {
        try {
          cache[resolved] = JSON.parse(
            fs.readFileSync(path.join(__dirname, `${resolved}.json`), 'utf8')
          );
        } catch (_error) {
          cache[resolved] = {};
        }
      }
      return cache[resolved];
    }

    function createTranslator(locale) {
      const resolved = resolveLocale(locale);
      return makeTranslator(getMessages(resolved), resolved);
    }

    module.exports = {
      SUPPORTED_LOCALES,
      DEFAULT_LOCALE,
      resolveLocale,
      getMessages,
      createTranslator,
      translate(locale, key, params) {
        return createTranslator(locale)(key, params);
      }
    };
    return;
  }

  // 浏览器分支：沙箱渲染进程无 fs/require，用 fetch 加载与主进程完全相同的 JSON。
  const cache = {};
  let scriptDir = '';
  if (
    typeof document !== 'undefined' &&
    document.currentScript &&
    document.currentScript.src
  ) {
    scriptDir = document.currentScript.src.replace(/[^/]*$/, '');
  }

  function loadMessages() {
    return Promise.all(
      SUPPORTED_LOCALES.map(async (locale) => {
        try {
          const response = await fetch(`${scriptDir}${locale}.json`);
          cache[locale] = response.ok ? await response.json() : {};
        } catch (_error) {
          cache[locale] = {};
        }
      })
    );
  }

  function getMessages(locale) {
    return cache[resolveLocale(locale)] || {};
  }

  function createTranslator(locale) {
    const resolved = resolveLocale(locale);
    return makeTranslator(getMessages(resolved), resolved);
  }

  globalScope.PetLocales = {
    SUPPORTED_LOCALES,
    DEFAULT_LOCALE,
    resolveLocale,
    getMessages,
    createTranslator,
    translate(locale, key, params) {
      return createTranslator(locale)(key, params);
    },
    ready: loadMessages()
  };
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MAX_MEMORIES_IN_CONTEXT } = require('../shared/contracts');

/** 旧数据缺省会话 ID（契约：ChatMessage.sessionId 缺省为 'default'） */
const DEFAULT_SESSION_ID = 'default';

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

function normalizeSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : DEFAULT_SESSION_ID;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function generateId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 读取时归一化：旧数据缺省 sessionId='default'；timestamp 保留（契约允许缺省）。
 */
function normalizeStoredMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  const normalized = {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content:
      typeof message.content === 'string' ? message.content : String(message.content ?? ''),
    sessionId: normalizeSessionId(message.sessionId)
  };
  if (isFiniteNumber(message.timestamp)) {
    normalized.timestamp = message.timestamp;
  }
  return normalized;
}

/**
 * 写入时归一化：新消息补 sessionId（缺省 'default'）与 timestamp（缺省当前时间）。
 */
function normalizeNewMessage(message) {
  const normalized = normalizeStoredMessage(message);
  if (!normalized) {
    return null;
  }
  if (!isFiniteNumber(normalized.timestamp)) {
    normalized.timestamp = Date.now();
  }
  return normalized;
}

/**
 * 读取长期记忆：要求 id 与 content 有效，缺省 sessionId='default'。
 */
function normalizeStoredMemory(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    return null;
  }
  if (typeof memory.id !== 'string' || !memory.id) {
    return null;
  }
  const content = typeof memory.content === 'string' ? memory.content.trim() : '';
  if (!content) {
    return null;
  }
  return {
    id: memory.id,
    content,
    sessionId: normalizeSessionId(memory.sessionId),
    createdAt: isFiniteNumber(memory.createdAt) ? memory.createdAt : 0,
    updatedAt: isFiniteNumber(memory.updatedAt) ? memory.updatedAt : 0,
    lastUsedAt: isFiniteNumber(memory.lastUsedAt) ? memory.lastUsedAt : 0
  };
}

/**
 * 新建长期记忆：生成 id 与时间戳，content 必填。
 */
function normalizeNewMemory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) {
    return null;
  }
  const now = Date.now();
  return {
    id: generateId(),
    content,
    sessionId: normalizeSessionId(input.sessionId),
    createdAt: isFiniteNumber(input.createdAt) ? input.createdAt : now,
    updatedAt: isFiniteNumber(input.updatedAt) ? input.updatedAt : now,
    lastUsedAt: isFiniteNumber(input.lastUsedAt) ? input.lastUsedAt : now
  };
}

/**
 * 本地记忆存储：messages.json（消息历史，兼容旧数据）+ memories.json（长期事实记忆）。
 */
function createMemoryStore(baseDir) {
  const messagesFile = path.join(baseDir, 'messages.json');
  const memoriesFile = path.join(baseDir, 'memories.json');

  /**
   * 读取消息历史。options.sessionId 省略时返回全部会话；指定时只返回该会话。
   * 旧数据（无 sessionId）一律归一化为 DEFAULT_SESSION_ID。
   */
  function readMessages(options = {}) {
    const saved = readJsonFile(messagesFile, []);
    if (!Array.isArray(saved)) {
      return [];
    }
    const messages = [];
    for (const item of saved) {
      const message = normalizeStoredMessage(item);
      if (!message) {
        continue;
      }
      if (options.sessionId !== undefined && message.sessionId !== options.sessionId) {
        continue;
      }
      messages.push(message);
    }
    return messages;
  }

  /**
   * 追加消息并落盘。返回本次追加（归一化后）的消息列表。
   */
  function appendMessages(items, options = {}) {
    const list = Array.isArray(items) ? items : [items];
    const current = readJsonFile(messagesFile, []);
    const next = Array.isArray(current) ? current : [];
    const appended = [];
    const defaultSessionId = normalizeSessionId(options.sessionId);
    for (const item of list) {
      const message = normalizeNewMessage(item);
      if (!message) {
        continue;
      }
      if (defaultSessionId !== DEFAULT_SESSION_ID && message.sessionId === DEFAULT_SESSION_ID) {
        message.sessionId = defaultSessionId;
      }
      appended.push(message);
    }
    if (appended.length > 0) {
      writeJsonFile(messagesFile, [...next, ...appended]);
    }
    return appended;
  }

  /**
   * 列出长期记忆（可按会话过滤），按最近使用时间倒序。
   */
  function listMemories(options = {}) {
    const saved = readJsonFile(memoriesFile, []);
    if (!Array.isArray(saved)) {
      return [];
    }
    const memories = [];
    for (const item of saved) {
      const memory = normalizeStoredMemory(item);
      if (!memory) {
        continue;
      }
      if (options.sessionId !== undefined && memory.sessionId !== options.sessionId) {
        continue;
      }
      memories.push(memory);
    }
    memories.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return memories;
  }

  /**
   * 检索长期记忆：关键词（不区分大小写）匹配 content，按最近使用时间倒序，
   * 默认最多返回 MAX_MEMORIES_IN_CONTEXT 条（用于上下文注入）。
   */
  function getMemories(options = {}) {
    const keyword =
      typeof options.keyword === 'string' && options.keyword.trim()
        ? options.keyword.trim().toLowerCase()
        : '';
    const limit = isFiniteNumber(options.limit) ? Math.max(0, Math.floor(options.limit)) : MAX_MEMORIES_IN_CONTEXT;
    const matched = listMemories({ sessionId: options.sessionId }).filter(
      (memory) => !keyword || memory.content.toLowerCase().includes(keyword)
    );
    return limit > 0 ? matched.slice(0, limit) : matched;
  }

  /**
   * 新增长期记忆并落盘。content 必填；返回新建条目（含 id 与时间戳）。
   */
  function addMemory(input) {
    const memory = normalizeNewMemory(input);
    if (!memory) {
      throw new Error('记忆内容不能为空');
    }
    const current = readJsonFile(memoriesFile, []);
    const next = Array.isArray(current) ? current : [];
    next.push(memory);
    writeJsonFile(memoriesFile, next);
    return { ...memory };
  }

  /**
   * 更新记忆的最近使用时间（lastUsedAt），用于“最近使用时间”相关度排序。
   */
  function touchMemory(id) {
    const current = readJsonFile(memoriesFile, []);
    if (!Array.isArray(current)) {
      return null;
    }
    let touched = null;
    const next = current.map((item) => {
      if (item && item.id === id) {
        touched = { ...item, lastUsedAt: Date.now() };
        return touched;
      }
      return item;
    });
    if (!touched) {
      return null;
    }
    writeJsonFile(memoriesFile, next);
    return { ...touched };
  }

  /**
   * 删除长期记忆；返回是否实际删除。
   */
  function deleteMemory(id) {
    const current = readJsonFile(memoriesFile, []);
    if (!Array.isArray(current)) {
      return false;
    }
    const next = current.filter((item) => !item || item.id !== id);
    if (next.length === current.length) {
      return false;
    }
    writeJsonFile(memoriesFile, next);
    return true;
  }

  return {
    readMessages,
    appendMessages,
    listMemories,
    getMemories,
    addMemory,
    touchMemory,
    deleteMemory
  };
}

module.exports = { createMemoryStore, DEFAULT_SESSION_ID };

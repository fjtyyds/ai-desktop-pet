'use strict';

const {
  DEFAULT_SHORT_TERM_WINDOW,
  MAX_MEMORIES_IN_CONTEXT
} = require('../shared/contracts');

const DEFAULT_SESSION_ID = 'default';
const MEMORY_EXTRACT_MAX = 3;

/** 记忆抽取 Prompt：要求模型只输出 JSON 字符串数组，便于解析与降级。 */
const MEMORY_EXTRACT_PROMPT =
  '你是记忆抽取器。请从用户与桌宠的对话中，提取值得长期记住的用户事实（如偏好、重要事件、个人信息）。' +
  `只输出一个 JSON 字符串数组，最多 ${MEMORY_EXTRACT_MAX} 条，每条不超过 40 字；没有可记住的内容时输出 []。` +
  '不要输出任何其他文字。';

/**
 * 聊天服务：组合 Provider 与 Store，提供 send()/sendStream()、持久化历史与
 * M2 上下文组装（ADR-012）、T-14 流式回复（ADR-021）。
 *
 * 上下文组装：
 * - system = persona + mood（T-06 persona.js/mood.js 未合入时使用内置默认人格降级）
 * - 短期窗口：最近 DEFAULT_SHORT_TERM_WINDOW 条（来自本地历史，渲染层不再传全量）
 * - 长期记忆：最多 MAX_MEMORIES_IN_CONTEXT 条，以【长期记忆】标注注入 system
 * - 每轮成功后异步触发记忆抽取；任何失败只记录日志，不阻塞 UI 回复
 *
 * T-05 的 src/storage/memory-store.js 合入前自动降级为 M1 store；
 * T-06 的 persona/mood 合入前自动降级为内置默认人格、无情绪注入。
 */
function createChatService({ provider, store, memoryStore }) {
  let history = [];
  let memoryStoreRef = memoryStore || null;
  let personaModuleRef = null;
  let moodModuleRef = null;
  let moodEngine = null;

  function getPersonaModule() {
    if (personaModuleRef === null) {
      try {
        personaModuleRef = require('../llm/persona');
      } catch (_error) {
        personaModuleRef = false;
      }
    }
    return personaModuleRef || null;
  }

  function getMoodModule() {
    if (moodModuleRef === null) {
      try {
        moodModuleRef = require('../llm/mood');
      } catch (_error) {
        moodModuleRef = false;
      }
    }
    return moodModuleRef || null;
  }

  /**
   * 返回调用方注入的 memory-store（T-05）；未注入时返回 null。
   * 集成修正：不再在服务内部自动创建存储实例，由 ipc.js 注入单例，
   * 保证消息读写与长期记忆使用同一实例，且测试可注入 fake store。
   */
  function getMemoryStore() {
    return memoryStoreRef;
  }

  function getSettings() {
    return store && typeof store.readSettings === 'function' ? store.readSettings() : {};
  }

  function loadHistory() {
    const memory = getMemoryStore();
    const raw =
      memory && typeof memory.readMessages === 'function'
        ? memory.readMessages()
        : store && typeof store.readMessages === 'function'
          ? store.readMessages()
          : [];
    history = Array.isArray(raw) ? raw : [];
    return history;
  }

  function getHistory() {
    return history.slice();
  }

  /**
   * T-06 mood.js 接口尚未冻结到 contracts.js；这里按任务卡/ADR-011 的语义做最小探测：
   * 工厂名与状态读取方法均做 feature detection，任何一步缺失/异常都降级为无情绪。
   * main 合入 T-06 后需在集成验收中核对实际接口（已在任务卡记录）。
   */
  function getMoodEngine() {
    if (moodEngine) {
      return moodEngine;
    }
    const mod = getMoodModule();
    if (!mod) {
      return null;
    }
    const factory =
      (typeof mod.createMoodEngine === 'function' && mod.createMoodEngine) ||
      (typeof mod.createMoodState === 'function' && mod.createMoodState) ||
      (typeof mod.createMood === 'function' && mod.createMood) ||
      null;
    if (!factory) {
      return null;
    }
    try {
      moodEngine = factory();
    } catch (_error) {
      moodEngine = null;
    }
    return moodEngine;
  }

  function resolveMoodState() {
    const engine = getMoodEngine();
    if (!engine) {
      return null;
    }
    // T-06 mood.js：时间推进（无交互回归默认）后再读取状态
    if (typeof engine.tick === 'function') {
      try {
        engine.tick();
      } catch (_error) {
        // 时间推进失败不影响读取
      }
    }
    const getter =
      (typeof engine.getState === 'function' && engine.getState) ||
      (typeof engine.get === 'function' && engine.get) ||
      (typeof engine.current === 'function' && engine.current) ||
      (typeof engine.snapshot === 'function' && engine.snapshot) ||
      null;
    if (!getter) {
      return null;
    }
    try {
      const state = getter.call(engine);
      return state && typeof state === 'object' ? state : null;
    } catch (_error) {
      return null;
    }
  }

  function observeMoodInteraction(role, content) {
    const engine = getMoodEngine();
    if (!engine) {
      return;
    }
    const text = typeof content === 'string' ? content : '';
    // 通用观察接口（observe/update(role, content)）
    const observer =
      (typeof engine.observe === 'function' && engine.observe) ||
      (typeof engine.update === 'function' && engine.update) ||
      null;
    if (observer) {
      try {
        observer.call(engine, role, text);
        return;
      } catch (_error) {
        // 继续尝试 T-06 的 applyFeedback 接口
      }
    }
    // T-06 mood.js：applyFeedback('positive'|'negative', { amount })，
    // 用简单情感词猜测反馈方向；中性消息不改变情绪。
    if (typeof engine.applyFeedback === 'function') {
      const feedback = guessFeedback(text);
      if (feedback) {
        try {
          engine.applyFeedback(feedback);
        } catch (_error) {
          // 情绪更新失败不影响对话
        }
      }
      return;
    }
    // 兼容 feedback(role, content) 形态
    if (typeof engine.feedback === 'function') {
      try {
        engine.feedback(role, text);
      } catch (_error) {
        // 情绪更新失败不影响对话
      }
    }
  }

  /** 极简情感词猜测：命中积极词返回 positive，命中消极词返回 negative，否则 null。 */
  const POSITIVE_WORDS = ['喜欢', '谢谢', '开心', '棒', '赞', '爱', '满意', '太好了', '哈哈'];
  const NEGATIVE_WORDS = ['讨厌', '生气', '难过', '伤心', '失望', '不好', '差', '烦', '糟糕'];

  function guessFeedback(text) {
    const lower = String(text).toLowerCase();
    const hasPositive = POSITIVE_WORDS.some((word) => lower.includes(word));
    const hasNegative = NEGATIVE_WORDS.some((word) => lower.includes(word));
    if (hasPositive && !hasNegative) {
      return 'positive';
    }
    if (hasNegative && !hasPositive) {
      return 'negative';
    }
    return null;
  }

  function buildDefaultSystemPrompt(settings, mood) {
    const persona =
      settings && settings.persona && typeof settings.persona === 'object'
        ? settings.persona
        : {};
    const traits = Array.isArray(persona.traits)
      ? persona.traits.filter((item) => typeof item === 'string' && item.trim())
      : [];
    const petName =
      (settings && settings.petName && String(settings.petName).trim()) || 'AI 桌宠';
    const parts = [
      `你是${petName}，一个${traits.length > 0 ? traits.join('、') : '热情友善'}的 AI 桌宠。`
    ];
    if (typeof persona.tone === 'string' && persona.tone.trim()) {
      parts.push(`说话语气：${persona.tone}。`);
    }
    if (typeof persona.backstory === 'string' && persona.backstory.trim()) {
      parts.push(`背景设定：${persona.backstory}。`);
    }
    if (mood && typeof mood.label === 'string' && mood.label) {
      parts.push(`当前情绪：${mood.label}。请自然地在回复中体现当前情绪，但不要刻意声明。`);
    }
    return parts.join('\n');
  }

  function buildSystemPrompt(settings, mood) {
    const personaModuleRefNow = getPersonaModule();
    if (
      personaModuleRefNow &&
      typeof personaModuleRefNow.buildSystemPrompt === 'function'
    ) {
      try {
        const built = personaModuleRefNow.buildSystemPrompt({ settings, mood });
        if (typeof built === 'string' && built.trim()) {
          return built;
        }
      } catch (_error) {
        // 降级到内置默认人格
      }
    }
    return buildDefaultSystemPrompt(settings, mood);
  }

  function listMemories(memory, keyword) {
    if (typeof memory.getMemories === 'function') {
      return memory.getMemories({ keyword, limit: MAX_MEMORIES_IN_CONTEXT });
    }
    if (typeof memory.listMemories === 'function') {
      const items = memory.listMemories({}) || [];
      const lower = typeof keyword === 'string' ? keyword.toLowerCase() : '';
      return items
        .filter((item) => item && (!lower || item.content.toLowerCase().includes(lower)))
        .slice(0, MAX_MEMORIES_IN_CONTEXT);
    }
    return [];
  }

  /**
   * 简单相关度（ADR-010）：短用户消息整体作关键词匹配；再以“最近使用时间”补齐到上限。
   * 命中后更新 lastUsedAt，供下次排序。
   */
  function pickMemories(text, limit) {
    const memory = getMemoryStore();
    if (
      !memory ||
      (typeof memory.getMemories !== 'function' && typeof memory.listMemories !== 'function')
    ) {
      return [];
    }
    const trimmed = typeof text === 'string' ? text.trim() : '';
    const keyword = trimmed && trimmed.length <= 20 ? trimmed : '';
    const byKeyword = keyword ? listMemories(memory, keyword) : [];
    const recent = listMemories(memory, '');
    const seen = new Set();
    const merged = [];
    for (const item of [...byKeyword, ...recent]) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
      if (merged.length >= limit) {
        break;
      }
    }
    if (typeof memory.touchMemory === 'function') {
      for (const item of merged) {
        try {
          memory.touchMemory(item.id);
        } catch (_error) {
          // touch 失败不影响上下文组装
        }
      }
    }
    return merged;
  }

  function buildMemorySection(memories) {
    if (!memories || memories.length === 0) {
      return '';
    }
    const lines = memories.map((item) => `- ${item.content}`).join('\n');
    return `\n\n【长期记忆】以下是关于用户的长期记忆（可能过时，以当前对话为准）：\n${lines}`;
  }

  function assembleRequestMessages(text, sessionHistory) {
    const settings = getSettings();
    const mood = resolveMoodState();
    const memories = pickMemories(text, MAX_MEMORIES_IN_CONTEXT);
    let system = buildSystemPrompt(settings, mood);
    system += buildMemorySection(memories);

    const windowed = (Array.isArray(sessionHistory) ? sessionHistory : [])
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
      .slice(-DEFAULT_SHORT_TERM_WINDOW)
      .map((item) => ({
        role: item.role,
        content: typeof item.content === 'string' ? item.content : String(item.content ?? '')
      }));

    return {
      messages: [{ role: 'system', content: system }, ...windowed, { role: 'user', content: text }]
    };
  }

  function appendMessages(items) {
    const memory = getMemoryStore();
    if (memory && typeof memory.appendMessages === 'function') {
      memory.appendMessages(items);
      return;
    }
    if (store && typeof store.appendMessages === 'function') {
      store.appendMessages(items);
    }
  }

  function parseMemoryFacts(raw) {
    if (typeof raw !== 'string') {
      return [];
    }
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end <= start) {
      return [];
    }
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, MEMORY_EXTRACT_MAX);
    } catch (_error) {
      console.warn('[memory] 记忆抽取返回无法解析，已忽略');
      return [];
    }
  }

  /**
   * 对话后异步记忆抽取：仅在有 API Key（真实 Provider）且 memory-store 可用时执行；
   * 任何失败只记录日志，绝不阻塞 send() 的返回（ADR-010）。
   */
  async function extractMemories(pair) {
    const memory = getMemoryStore();
    if (!memory || typeof memory.addMemory !== 'function') {
      console.log('[memory] 记忆存储未就绪，跳过记忆抽取');
      return;
    }
    const settings = getSettings();
    const hasApiKey = Boolean((settings && settings.apiKey) || process.env.DEEPSEEK_API_KEY);
    if (!hasApiKey) {
      console.log('[memory] mock 模式（无 API Key），跳过记忆抽取');
      return;
    }

    let facts = [];
    try {
      const result = await provider.chat({
        messages: [
          { role: 'system', content: MEMORY_EXTRACT_PROMPT },
          ...pair.map((item) => ({ role: item.role, content: item.content }))
        ]
      });
      facts = parseMemoryFacts(result && result.reply);
    } catch (error) {
      console.warn(
        '[memory] 记忆抽取失败（不阻塞对话）：',
        error && error.message ? error.message : error
      );
      return;
    }

    for (const fact of facts) {
      try {
        memory.addMemory({ content: fact, sessionId: DEFAULT_SESSION_ID });
      } catch (error) {
        console.warn(
          '[memory] 记忆保存失败（不阻塞对话）：',
          error && error.message ? error.message : error
        );
      }
    }
    if (facts.length > 0) {
      console.log(`[memory] 已保存 ${facts.length} 条长期记忆`);
    }
  }

  /**
   * 发送消息。兼容两种调用：
   * - 新契约：send({ text, history? })
   * - 旧内部调用：send(text, clientHistory)
   * history 缺省时由主进程从本地存储读取；渲染层传入的 history 仅用于上下文窗口，
   * 不再重复持久化（ADR-012）。
   */
  async function send(input, clientHistory) {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    const text =
      typeof (isObject ? input.text : input) === 'string'
        ? (isObject ? input.text : input).trim()
        : '';
    const historyArg = isObject
      ? Array.isArray(input.history)
        ? input.history
        : clientHistory
      : clientHistory;
    if (!text) {
      return { ok: false, reply: '', error: '消息不能为空' };
    }

    const sessionHistory =
      Array.isArray(historyArg) && historyArg.length > 0
        ? historyArg
        : history.length > 0
          ? history
          : loadHistory();
    const { messages } = assembleRequestMessages(text, sessionHistory);

    try {
      const result = await provider.chat({ messages });
      const reply =
        typeof result.reply === 'string' ? result.reply : String(result.reply || '');
      const timestamp = Date.now();
      const userMessage = {
        role: 'user',
        content: text,
        sessionId: DEFAULT_SESSION_ID,
        timestamp
      };
      const assistantMessage = {
        role: 'assistant',
        content: reply,
        sessionId: DEFAULT_SESSION_ID,
        timestamp
      };
      history = [...history, userMessage, assistantMessage];
      appendMessages([userMessage, assistantMessage]);
      observeMoodInteraction('user', text);
      observeMoodInteraction('assistant', reply);
      // 异步抽取，不 await：失败只降级记录
      void extractMemories([userMessage, assistantMessage]);
      return { ok: true, reply, error: null };
    } catch (error) {
      return {
        ok: false,
        reply: '',
        error: error && error.message ? error.message : String(error)
      };
    }
  }

  /**
   * 流式发送（T-14，ADR-021）。上下文组装、成功持久化与记忆抽取与 send() 完全一致；
   * 增量经 streamOptions.onDelta 回调输出，取消经 streamOptions.signal 传播。
   * 结果约定：
   * - 成功：{ ok:true, reply: 完整文本, error:null }
   * - 取消：{ ok:false, reply: 已收到的部分文本, error:'已取消' }
   * - 其他失败：{ ok:false, reply: 已收到的部分文本, error }
   * 取消/失败不持久化（与 send() 的错误路径一致，避免半截回复进入历史）。
   */
  async function sendStream(input, clientHistory, streamOptions) {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    const text =
      typeof (isObject ? input.text : input) === 'string'
        ? (isObject ? input.text : input).trim()
        : '';
    const historyArg = isObject
      ? Array.isArray(input.history)
        ? input.history
        : clientHistory
      : clientHistory;
    if (!text) {
      return { ok: false, reply: '', error: '消息不能为空' };
    }

    const sessionHistory =
      Array.isArray(historyArg) && historyArg.length > 0
        ? historyArg
        : history.length > 0
          ? history
          : loadHistory();
    const { messages } = assembleRequestMessages(text, sessionHistory);

    const options = streamOptions && typeof streamOptions === 'object' ? streamOptions : {};
    const onDelta = typeof options.onDelta === 'function' ? options.onDelta : null;
    let partial = '';

    function emitDelta(chunk) {
      if (typeof chunk !== 'string' || chunk.length === 0) {
        return;
      }
      partial += chunk;
      if (onDelta) {
        onDelta(chunk);
      }
    }

    try {
      let reply = '';
      if (typeof provider.chatStream === 'function') {
        const result = await provider.chatStream(
          { messages },
          { onDelta: emitDelta, signal: options.signal }
        );
        reply =
          result && typeof result.reply === 'string' ? result.reply : partial;
      } else {
        // 降级：老 Provider 无流式接口时整段返回，仍推送一次增量保证 UI 一致性
        const result = await provider.chat({ messages });
        reply = result && typeof result.reply === 'string' ? result.reply : '';
        emitDelta(reply);
      }

      const timestamp = Date.now();
      const userMessage = {
        role: 'user',
        content: text,
        sessionId: DEFAULT_SESSION_ID,
        timestamp
      };
      const assistantMessage = {
        role: 'assistant',
        content: reply,
        sessionId: DEFAULT_SESSION_ID,
        timestamp
      };
      history = [...history, userMessage, assistantMessage];
      appendMessages([userMessage, assistantMessage]);
      observeMoodInteraction('user', text);
      observeMoodInteraction('assistant', reply);
      // 异步抽取，不 await：失败只降级记录（与 send() 一致）
      void extractMemories([userMessage, assistantMessage]);
      return { ok: true, reply, error: null };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const isCancel = Boolean(
        (error && error.name === 'AbortError') ||
          (options.signal && options.signal.aborted) ||
          message === '已取消'
      );
      return { ok: false, reply: partial, error: isCancel ? '已取消' : message };
    }
  }

  return { send, sendStream, loadHistory, getHistory };
}

module.exports = { createChatService };

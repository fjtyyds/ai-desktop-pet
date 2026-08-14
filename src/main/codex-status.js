'use strict';

/**
 * T-65（ADR-051）：真实 Codex 工作状态探针（纯 Node，无 electron 依赖，可单测）。
 *
 * 信号来源（只读元数据，绝不读取会话正文）：
 * - Codex 会话日志目录：$CODEX_HOME（默认 ~/.codex）/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl；
 * - rollout 仅在活动时写入，事件为 JSONL；本模块只解析 type/payload.type/name/status/timestamp，
 *   不读取、不落盘、不展示 content/arguments/output/message 等正文，避免隐私泄露。
 *
 * 状态映射（诚实边界，不造假）：
 * - working：最新 rollout 在 ACTIVE_MS 内有写入（模型在推理/执行工具）；气泡可附带工具标签。
 * - waiting：有会话但超过 ACTIVE_MS 无写入且最近回合未结束（尾部含 task_started）；
 *   仅保持 WAITING_MAX_MS，超时回落 idle，避免旧线程永远显示“等待输入”。
 * - attention：尾部事件类型/名称含 approval/review/permission 关键词 → 需要审阅/批准（best-effort）。
 * - idle：无 rollout、或静默超时/回合已结束；不驱动浮窗（让应用自身状态自然显示）。
 *
 * 性能：轮询默认 5s；每轮只做一次目录遍历 + 最新文件尾部 ≤TAIL_BYTES 读取；浮窗隐藏/开关关闭时跳过。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ACTIVE_MS = 25 * 1000;
const WAITING_MAX_MS = 5 * 60 * 1000;
const TAIL_BYTES = 64 * 1024;
const MAX_DEPTH = 6;
const REVIEW_RE = /approval|review|permission/i;

/** 工具名 → 气泡工具标签 key（仅白名单映射；未知工具一律 other，不显示原始名，避免泄露参数） */
const TOOL_LABEL_KEYS = {
  shell_command: 'shell',
  apply_patch: 'edit',
  search: 'search',
  open_page: 'search',
  find_in_page: 'search',
  update_plan: 'other',
  update_goal: 'other',
  create_goal: 'other',
  get_goal: 'other',
  read_mcp_resources: 'other',
  read_mcp_resource_templates: 'other',
  read_mcp_resource: 'other',
  collaboration_followup_task: 'other',
  collaboration_interrupt_agent: 'other',
  collaboration_list_agents: 'other',
  collaboration_send_message: 'other',
  collaboration_spawn_agent: 'other',
  collaboration_wait_agent: 'other'
};
const TOOL_LABEL_FALLBACK = 'other';

function codexRoot() {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
}

/** 递归收集 rollout-*.jsonl（sessions/<y>/<m>/<d>/ 结构，深度上限避免意外遍历） */
function findRolloutFiles(rootDir, maxDepth = MAX_DEPTH) {
  const files = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl')
      ) {
        try {
          const stat = fs.statSync(full);
          files.push({ path: full, mtimeMs: stat.mtimeMs });
        } catch (_error) {
          // 文件被并发清理时跳过
        }
      }
    }
  }
  if (fs.existsSync(rootDir)) {
    walk(rootDir, 0);
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

/** 读取文件尾部 ≤TAIL_BYTES 的文本（避免整文件读入） */
function readTail(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function toolLabelKey(name) {
  if (!name || typeof name !== 'string') return null;
  return TOOL_LABEL_KEYS[name] || TOOL_LABEL_FALLBACK;
}

/**
 * 解析 rollout 尾部元数据（倒序读到最近一次 task_started 为止，只分析最近一个回合）。
 * 只读取 type/payload.type/name/status 字段。
 * @returns {{ sawTaskStart: boolean, sawTool: boolean, latestToolName: string|null,
 *   latestToolStatus: string|null, sawReview: boolean, lastEventType: string|null }}
 */
function parseTailMeta(tailText) {
  const meta = {
    sawTaskStart: false,
    sawTool: false,
    latestToolName: null,
    latestToolStatus: null,
    sawReview: false,
    lastEventType: null
  };
  const lines = tailText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const type = typeof obj.type === 'string' ? obj.type : '';
    const payloadType =
      obj.payload && typeof obj.payload.type === 'string'
        ? obj.payload.type
        : '';
    const eventType = payloadType || type;
    if (!eventType) continue;
    if (!meta.lastEventType) meta.lastEventType = eventType;
    if (type === 'event_msg' && payloadType === 'task_started') {
      meta.sawTaskStart = true;
      break; // 再往前是上一个回合，不分析
    }
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      if (!meta.sawTool) {
        meta.sawTool = true;
        meta.latestToolName =
          typeof obj.payload.name === 'string' ? obj.payload.name : null;
        meta.latestToolStatus =
          typeof obj.payload.status === 'string' ? obj.payload.status : null;
      }
    }
    if (REVIEW_RE.test(`${eventType} ${meta.latestToolName || ''}`)) {
      meta.sawReview = true;
    }
  }
  return meta;
}

/**
 * 探测 Codex 当前状态。
 * @param {{ rootDir?: string, nowMs?: number }} [options]
 * @returns {{ available: boolean, state: 'working'|'waiting'|'attention'|'idle',
 *   toolKey: string|null, updatedAt: number }}
 */
function detectCodexStatus(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const rootDir = options.rootDir || codexRoot();
  const files = findRolloutFiles(rootDir);
  if (files.length === 0) {
    return { available: false, state: 'idle', toolKey: null, updatedAt: nowMs };
  }
  const latest = files[0];
  const ageMs = Math.max(0, nowMs - latest.mtimeMs);
  const tailText = readTail(latest.path);
  const meta = parseTailMeta(tailText);
  if (ageMs <= ACTIVE_MS) {
    if (meta.sawReview) {
      return {
        available: true,
        state: 'attention',
        toolKey: null,
        updatedAt: nowMs
      };
    }
    return {
      available: true,
      state: 'working',
      toolKey: toolLabelKey(meta.latestToolName),
      updatedAt: nowMs
    };
  }
  if (meta.sawTaskStart && ageMs <= WAITING_MAX_MS) {
    return { available: true, state: 'waiting', toolKey: null, updatedAt: nowMs };
  }
  return { available: true, state: 'idle', toolKey: null, updatedAt: nowMs };
}

/**
 * 轮询探针：仅浮窗可见且 codexStatusEnabled 时探测；仅活动状态推送；
 * 不覆盖运行中任务气泡与聊天 working/speaking/attention 状态；异常静默降级。
 * @param {{ getSettings?: () => object, getOverlay?: () => object,
 *   formatText?: (state: string, toolKey: string|null) => string, pollMs?: number }} options
 */
function createCodexStatusProbe(options = {}) {
  const { getSettings, getOverlay, formatText, pollMs = 5000, detect } = options;
  let timer = null;
  let lastPushed = null; // T-66：探针自己推过的状态（用于 working→waiting/attention 继续接管）

  function codexEnabled() {
    try {
      const settings = getSettings ? getSettings() : null;
      return settings ? settings.codexStatusEnabled !== false : true;
    } catch (_error) {
      return true;
    }
  }

  function overlayVisible() {
    const overlay = getOverlay ? getOverlay() : null;
    return Boolean(
      overlay &&
        typeof overlay.isVisible === 'function' &&
        overlay.isVisible()
    );
  }

  /** 只在“空闲/短暂结果态/等待态”接管，避免抢占聊天工作态、朗读与提醒 */
  function shouldTakeOver(current) {
    if (!current) return true;
    if (current.task) return false;
    if (['idle', 'ready', 'failed', 'waiting'].includes(current.state)) {
      return true;
    }
    // T-66：探针自己推过的状态允许继续接管（working→waiting/attention 切换）；
    // 聊天/TTS 推的 working（文案与 lastPushed 不同）仍不被覆盖。
    return Boolean(
      lastPushed &&
        current.state === lastPushed.state &&
        (current.text || '') === lastPushed.text
    );
  }

  function push(status) {
    const overlay = getOverlay ? getOverlay() : null;
    if (!overlay || typeof overlay.setStatus !== 'function') return;
    const text = formatText ? formatText(status.state, status.toolKey) : '';
    let current = null;
    try {
      current = typeof overlay.getState === 'function' ? overlay.getState() : null;
    } catch (_error) {
      current = null;
    }
    if (!shouldTakeOver(current)) return;
    if (
      current &&
      current.state === status.state &&
      (current.text || '') === text
    ) {
      return; // 已显示相同状态，避免事件风暴
    }
    try {
      overlay.setStatus({ state: status.state, text });
      lastPushed = { state: status.state, text };
    } catch (_error) {
      // 推送失败静默，下一轮重试
    }
  }

  function tick() {
    if (!codexEnabled() || !overlayVisible()) return;
    let status;
    try {
      status = detect ? detect() : detectCodexStatus();
    } catch (_error) {
      status = {
        available: false,
        state: 'idle',
        toolKey: null,
        updatedAt: Date.now()
      };
    }
    if (status.state !== 'idle') {
      push(status);
    }
  }

  function start() {
    if (timer) return;
    tick();
    timer = setInterval(tick, pollMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function getState() {
    try {
      return detect ? detect() : detectCodexStatus();
    } catch (_error) {
      return {
        available: false,
        state: 'idle',
        toolKey: null,
        updatedAt: Date.now()
      };
    }
  }

  function dispose() {
    stop();
  }

  return { start, stop, getState, dispose };
}

module.exports = {
  ACTIVE_MS,
  WAITING_MAX_MS,
  TAIL_BYTES,
  codexRoot,
  findRolloutFiles,
  readTail,
  toolLabelKey,
  parseTailMeta,
  detectCodexStatus,
  createCodexStatusProbe
};

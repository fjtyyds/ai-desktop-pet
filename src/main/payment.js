'use strict';

/**
 * T-41 支付通道接入（沙箱/桩，禁止真实收款）。
 *
 * 范围与边界：
 * - 仅沙箱/桩模式：下单返回本地待支付订单，模拟回调走本地验签桩，
 *   不接入任何真实网关、不发任何真实请求、不做任何扣款。
 * - 两种通道结构兼容：
 *   国内（alipay / wechat / aidian）：payment.success / payment.refund / payment.cancel
 *   海外（paddle / stripe）：subscription_activated / subscription_updated /
 *   subscription_cancelled / payment_refunded / checkout.session.completed /
 *   invoice.paid / invoice.payment_failed / charge.refunded / customer.subscription.deleted
 * - 凭证只从环境变量读取（AI_PET_PAYMENT_*），代码/日志/落盘文件零密钥。
 * - 幂等：同一订单同一事件重复回调不重复升档/降级（payment-state.json 记录 eventId）。
 * - 失败回滚：许可证升档/降级失败时订单保持原状态，可安全重试。
 * - 环境变量 AI_PET_PAYMENT_MODE 若被设置为非 sandbox，本模块拒绝一切操作，
 *   防止误配后触碰真实网关。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODE = 'sandbox';

/** 定价（商业化上线方案 §7.1）：Pro 订阅 ¥128/年、永久买断 ¥68 */
const PLANS = {
  yearly: {
    tier: 'yearly',
    amountMinor: 12800,
    currency: 'CNY',
    durationDays: 365
  },
  lifetime: {
    tier: 'lifetime',
    amountMinor: 6800,
    currency: 'CNY',
    durationDays: 0
  }
};

const CHANNELS = ['alipay', 'wechat', 'aidian', 'paddle', 'stripe'];

/** 事件类型 -> 动作（success=升档，refund/cancel=降级） */
const EVENT_ACTIONS = {
  alipay: {
    'payment.success': 'success',
    'payment.refund': 'refund',
    'payment.cancel': 'cancel'
  },
  wechat: {
    'payment.success': 'success',
    'payment.refund': 'refund',
    'payment.cancel': 'cancel'
  },
  aidian: {
    'payment.success': 'success',
    'payment.refund': 'refund',
    'payment.cancel': 'cancel'
  },
  paddle: {
    subscription_activated: 'success',
    subscription_updated: 'success',
    subscription_cancelled: 'cancel',
    payment_refunded: 'refund'
  },
  stripe: {
    'checkout.session.completed': 'success',
    'invoice.paid': 'success',
    'invoice.payment_failed': 'cancel',
    'charge.refunded': 'refund',
    'customer.subscription.deleted': 'cancel'
  }
};

/** mock 回调缺省事件（各通道一条成功事件） */
const DEFAULT_EVENTS = {
  alipay: 'payment.success',
  wechat: 'payment.success',
  aidian: 'payment.success',
  paddle: 'subscription_activated',
  stripe: 'checkout.session.completed'
};

const STATE_FILE = 'payment-state.json';
const DOMESTIC_CHANNELS = ['alipay', 'wechat', 'aidian'];

/** 按通道解析环境变量中的回调验签密钥；未配置返回空串（沙箱结构验签） */
function resolveSecret(channel, env) {
  const source = env || process.env;
  const generic = source.AI_PET_PAYMENT_WEBHOOK_SECRET || '';
  if (DOMESTIC_CHANNELS.includes(channel)) {
    return source.AI_PET_PAYMENT_WEBHOOK_SECRET_CN || generic;
  }
  return source.AI_PET_PAYMENT_WEBHOOK_SECRET_OVERSEAS || generic;
}

/** 递归稳定化对象（键排序），用于验签的规范化载荷 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

/** 验签规范化文本：剔除 signature 字段后按键排序序列化 */
function canonicalizeForSignature(payload) {
  const clone = { ...payload };
  delete clone.signature;
  return JSON.stringify(canonicalize(clone));
}

/** HMAC-SHA256 签名（仅供沙箱 mock 与测试使用，密钥来自环境变量） */
function signCallbackPayload(payload, secret) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(canonicalizeForSignature(payload))
    .digest('hex');
}

/**
 * 验签桩：
 * - 配置了 AI_PET_PAYMENT_WEBHOOK_SECRET* 时校验 HMAC-SHA256 签名；
 * - 未配置密钥时仅接受显式 sandbox:true 的结构标记（本卡沙箱范围）；
 * - 两者皆无 -> 拒绝（payment-signature-required）。
 */
function verifyCallbackSignature(payload, options) {
  const opts = options || {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'payment-invalid-payload' };
  }
  const env = opts.env || process.env;
  const secret = resolveSecret(payload.channel, env);
  if (payload.sandbox === true && !secret) {
    return { ok: true, mode: 'sandbox-structural' };
  }
  if (!secret) {
    return { ok: false, error: 'payment-signature-required' };
  }
  const provided =
    typeof payload.signature === 'string' ? payload.signature.trim() : '';
  if (!provided) {
    return { ok: false, error: 'payment-signature-missing' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonicalizeForSignature(payload))
    .digest();
  const providedBuf = Buffer.from(provided, 'hex');
  if (
    providedBuf.length !== expected.length ||
    !crypto.timingSafeEqual(providedBuf, expected)
  ) {
    return { ok: false, error: 'payment-signature-invalid' };
  }
  return { ok: true, mode: 'hmac' };
}

/** 归一化回调：通道/事件 -> 动作，提取订单号与金额（分） */
function normalizeEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'payment-invalid-payload' };
  }
  const channel =
    typeof payload.channel === 'string' ? payload.channel.toLowerCase() : '';
  const eventType =
    typeof payload.eventType === 'string' ? payload.eventType : '';
  const actionMap = EVENT_ACTIONS[channel];
  if (!actionMap) {
    return { ok: false, error: 'payment-unsupported-channel' };
  }
  const action = actionMap[eventType];
  if (!action) {
    return { ok: false, error: 'payment-unsupported-event' };
  }
  const orderId =
    typeof payload.orderId === 'string' ? payload.orderId.trim() : '';
  if (!orderId || orderId.length > 96) {
    return { ok: false, error: 'payment-invalid-order-id' };
  }
  const eventId =
    typeof payload.eventId === 'string' && payload.eventId.trim()
      ? payload.eventId.trim()
      : `evt-${Date.now()}`;
  const amountMinor = Number.isFinite(payload.amount)
    ? Math.round(payload.amount)
    : null;
  return {
    ok: true,
    channel,
    eventType,
    action,
    orderId,
    eventId,
    amountMinor
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 沙箱订单号：SB-YYYYMMDD-HHMMSS-XXXX（不依赖外部服务） */
function generateOrderId(nowMs, existing) {
  const d = new Date(nowMs);
  const base =
    `SB-${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(
      d.getUTCDate()
    )}` +
    `-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(
      d.getUTCSeconds()
    )}`;
  for (let i = 0; i < 8; i += 1) {
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const orderId = `${base}-${suffix}`;
    if (!existing || !existing[orderId]) {
      return orderId;
    }
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * 创建支付管理器。
 *
 * options：
 * - baseDir：runtime 数据目录（payment-state.json 落盘位置）
 * - license：license.js 管理器实例（回调联动升档/降级）
 * - now：可选时间函数（测试用）
 * - env：可选环境变量快照（缺省 process.env；测试注入用）
 * - logger：可选告警函数
 */
function createPaymentManager(options) {
  const opts = options || {};
  const baseDir = opts.baseDir || '.';
  const stateFile = opts.stateFile || path.join(baseDir, STATE_FILE);
  const license = opts.license;
  const env = opts.env || process.env;
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const logger =
    typeof opts.logger === 'function'
      ? opts.logger
      : (message) => console.warn(`[payment] ${message}`);

  const requestedMode = String(env.AI_PET_PAYMENT_MODE || MODE).toLowerCase();
  const mode = requestedMode === MODE ? MODE : 'unavailable';

  function readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_error) {
      return {};
    }
  }

  function writeState(data) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf8');
  }

  function getOrder(orderId) {
    const state = readState();
    const orders = state.orders && typeof state.orders === 'object' ? state.orders : {};
    const order = orders[orderId];
    return order && typeof order === 'object' ? { ...order } : null;
  }

  function getProcessed(orderId) {
    const state = readState();
    const processed =
      state.processed && typeof state.processed === 'object'
        ? state.processed
        : {};
    const record = processed[orderId];
    return record && typeof record === 'object' ? { ...record } : null;
  }

  /** 沙箱下单：返回本地待支付订单；不触网、不收款 */
  function createOrder(payload) {
    if (mode !== MODE) {
      return { ok: false, error: 'payment-sandbox-only' };
    }
    const optsPayload = payload && typeof payload === 'object' ? payload : {};
    const tier =
      typeof optsPayload.tier === 'string' ? optsPayload.tier : '';
    const plan = PLANS[tier];
    if (!plan) {
      return { ok: false, error: 'payment-invalid-tier' };
    }
    const channel =
      typeof optsPayload.channel === 'string' &&
      CHANNELS.includes(optsPayload.channel)
        ? optsPayload.channel
        : 'alipay';
    const now = nowFn();
    const state = readState();
    const existingOrders =
      state.orders && typeof state.orders === 'object' ? state.orders : {};
    const orderId = generateOrderId(now, existingOrders);
    const order = {
      orderId,
      tier: plan.tier,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      channel,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    writeState({
      ...state,
      orders: { ...existingOrders, [orderId]: order }
    });
    return { ok: true, mode, order: { ...order } };
  }

  /**
   * 沙箱模拟回调：按订单构造对应通道结构的成功/退款/取消事件，
   * 配置密钥时自动签名；仅沙箱模式可用。
   */
  function mockCallback(payload) {
    if (mode !== MODE) {
      return { ok: false, error: 'payment-sandbox-only' };
    }
    const optsPayload = payload && typeof payload === 'object' ? payload : {};
    const orderId =
      typeof optsPayload.orderId === 'string'
        ? optsPayload.orderId.trim()
        : '';
    const order = getOrder(orderId);
    if (!order) {
      return { ok: false, error: 'payment-order-not-found' };
    }
    const channel =
      typeof optsPayload.channel === 'string' &&
      CHANNELS.includes(optsPayload.channel)
        ? optsPayload.channel
        : order.channel || 'alipay';
    const eventType =
      typeof optsPayload.eventType === 'string' &&
      EVENT_ACTIONS[channel] &&
      EVENT_ACTIONS[channel][optsPayload.eventType]
        ? optsPayload.eventType
        : DEFAULT_EVENTS[channel];
    const event = {
      channel,
      eventType,
      // 确定性 eventId：同一订单同一通道同一事件的重放视为同一回调
      eventId: `evt-${orderId}-${channel}-${eventType}`,
      orderId,
      amount: order.amountMinor,
      currency: order.currency,
      tier: order.tier,
      status: 'sandbox',
      timestamp: nowFn(),
      sandbox: true
    };
    const secret = resolveSecret(channel, env);
    if (secret) {
      event.signature = signCallbackPayload(event, secret);
    }
    return processCallback(event);
  }

  /**
   * 处理回调（验签 -> 幂等 -> 升档/降级）。
   * 失败时订单状态保持不变（回滚语义），可安全重试。
   */
  function processCallback(payload) {
    if (mode !== MODE) {
      return { ok: false, error: 'payment-sandbox-only' };
    }
    const verified = verifyCallbackSignature(payload, { env });
    if (!verified.ok) {
      return { ok: false, error: verified.error };
    }
    const normalized = normalizeEvent(payload);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error };
    }
    const { action, eventId, channel, eventType, orderId, amountMinor } =
      normalized;
    const order = getOrder(orderId);
    if (!order) {
      return { ok: false, error: 'payment-order-not-found' };
    }
    if (
      action === 'success' &&
      (amountMinor === null || amountMinor !== order.amountMinor)
    ) {
      return { ok: false, error: 'payment-amount-mismatch' };
    }
    if (
      action !== 'success' &&
      amountMinor !== null &&
      amountMinor !== order.amountMinor
    ) {
      return { ok: false, error: 'payment-amount-mismatch' };
    }

    const processed = getProcessed(orderId);
    // 幂等：同一订单同一动作已处理过则直接返回，避免重复升档/降级
    if (processed && processed.action === action) {
      return {
        ok: true,
        duplicate: true,
        action,
        order: { ...order },
        licenseStatus: license ? license.getPublicStatus() : null
      };
    }

    let licenseStatus = null;
    if (action === 'success') {
      if (!license || typeof license.activateByPayment !== 'function') {
        return { ok: false, error: 'payment-license-unavailable' };
      }
      const activation = license.activateByPayment(orderId, order.tier);
      if (!activation.ok) {
        return { ok: false, error: activation.error };
      }
      order.status = 'paid';
      licenseStatus = activation.status;
    } else {
      if (!license || typeof license.downgradeByPayment !== 'function') {
        return { ok: false, error: 'payment-license-unavailable' };
      }
      const downgrade = license.downgradeByPayment(orderId);
      if (!downgrade.ok) {
        return { ok: false, error: downgrade.error };
      }
      order.status = action === 'refund' ? 'refunded' : 'cancelled';
      licenseStatus = downgrade.status;
    }
    order.updatedAt = nowFn();

    const state = readState();
    const orders =
      state.orders && typeof state.orders === 'object' ? state.orders : {};
    const processedMap =
      state.processed && typeof state.processed === 'object'
        ? state.processed
        : {};
    try {
      writeState({
        ...state,
        orders: { ...orders, [orderId]: order },
        processed: {
          ...processedMap,
          [orderId]: {
            eventId,
            action,
            channel,
            eventType,
            at: nowFn()
          }
        }
      });
    } catch (error) {
      logger(
        `回调状态落盘失败：${error && error.message ? error.message : error}`
      );
      return { ok: false, error: 'payment-persist-failed' };
    }
    return {
      ok: true,
      duplicate: false,
      action,
      order: { ...order },
      licenseStatus
    };
  }

  return {
    createOrder,
    mockCallback,
    processCallback,
    getOrder,
    getProcessed,
    verifyCallbackSignature: (payload) => verifyCallbackSignature(payload, { env }),
    getMode: () => mode
  };
}

module.exports = {
  createPaymentManager,
  PLANS,
  CHANNELS,
  EVENT_ACTIONS,
  DEFAULT_EVENTS,
  verifyCallbackSignature,
  signCallbackPayload,
  canonicalizeForSignature,
  MODE
};

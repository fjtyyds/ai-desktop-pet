'use strict';

/**
 * T-40 许可证与付费墙（ADR-032 商业化上线方案 §7）。
 *
 * 三态：free（免费）/ yearly（Pro 订阅）/ lifetime（永久买断）。
 *
 * 边界约定：
 * - 本模块只做本地许可证状态机 + 可 mock 的激活码/订单号校验；
 *   真实支付由 T-41 接入，本卡仅保留 handlePaymentCallback 回调桩。
 * - 许可证字段经 store.js 白名单持久化到 settings.json（licenseTier /
 *   licenseKey / licenseExpiresAt / deviceId / complianceAccepted）。
 * - 云 AI 额度使用量存于 baseDir/license-state.json（runtime 数据，不属源码）。
 * - 设备绑定：deviceId 首次生成后写入 settings.json，激活时绑定到当前设备；
 *   设备不一致视为未激活（status=device-mismatch，effectiveTier=free）。
 * - 永久买断不含云额度与云同步（定价表 §7.1），云额度按免费档 10 次/日执行。
 *
 * Mock 校验规则（T-41 前仅用于本地验证/验收，无网络、无收款）：
 * - PRO-YEARLY-<16 位 HEX>   → Pro 订阅一年
 * - PRO-LIFETIME-<16 位 HEX> → 永久买断
 * - ORDER-<12 位数字>        → 支付订单号（本地 mock 订单表）
 * - 0000000000000000 结尾的码列入本地吊销清单
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const TIERS = ['free', 'yearly', 'lifetime'];

/** 云 AI 额度（定价表 §7.1）：free 10 次/日，yearly 200 次/月；lifetime 不含云额度，按免费档 */
const CLOUD_QUOTA = {
  free: { period: 'day', limit: 10 },
  yearly: { period: 'month', limit: 200 },
  lifetime: { period: 'day', limit: 10 }
};

const LICENSE_KEY_MAX_LENGTH = 128;

const MOCK_YEARLY_PREFIX = 'PRO-YEARLY-';
const MOCK_LIFETIME_PREFIX = 'PRO-LIFETIME-';
const MOCK_ORDER_PREFIX = 'ORDER-';
const MOCK_TOKEN_PATTERN = /^[0-9A-F]{16}$/;
const MOCK_ORDER_PATTERN = /^\d{12}$/;

/** 本地吊销清单（mock；T-41 接入后由服务端下发并缓存到 license-state.json） */
const MOCK_REVOKED_KEYS = new Set([
  'PRO-YEARLY-0000000000000000',
  'PRO-LIFETIME-0000000000000000'
]);

/** 一年毫秒数（Pro 订阅 mock 有效期） */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** 遮罩激活码：仅返回首尾片段，避免在 UI/日志中泄露完整密钥 */
function maskLicenseKey(key) {
  if (typeof key !== 'string' || !key) {
    return '';
  }
  if (key.length <= 10) {
    return `${key.slice(0, 2)}…${key.slice(-2)}`;
  }
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function toDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

function toMonthKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/**
 * 按档位返回功能门控（effectiveTier 决定）：
 * - Pro 专属（yearly/lifetime）：高级神经语音、皮肤市场、待办
 * - 所有档位保留：BYOK 对话、本地记忆、天气
 */
function entitlementsForTier(tier) {
  const effectiveTier = TIERS.includes(tier) ? tier : 'free';
  const paid = effectiveTier !== 'free';
  const quota = CLOUD_QUOTA[effectiveTier] || CLOUD_QUOTA.free;
  return {
    tier: effectiveTier,
    paid,
    cloudAI: { enabled: true, period: quota.period, limit: quota.limit },
    advancedNeuralVoices: paid,
    skinMarket: paid,
    todos: paid,
    byokChat: true,
    localMemory: true,
    weather: true
  };
}

/**
 * 纯函数激活码解析（可独立测试）：
 * 返回 { tier, key, expiresAt } 或 { error }。
 * revokedKeys 缺省时使用内置 mock 吊销清单。
 */
function parseActivationCode(code, nowMs, options) {
  const opts = options || {};
  const revokedKeys =
    opts.revokedKeys instanceof Set ? opts.revokedKeys : MOCK_REVOKED_KEYS;
  if (typeof code !== 'string') {
    return { error: 'license-invalid-code' };
  }
  const key = code.trim().toUpperCase();
  if (!key || key.length > LICENSE_KEY_MAX_LENGTH) {
    return { error: 'license-invalid-code' };
  }
  if (revokedKeys.has(key)) {
    return { error: 'license-revoked' };
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  if (key.startsWith(MOCK_YEARLY_PREFIX)) {
    const token = key.slice(MOCK_YEARLY_PREFIX.length);
    if (!MOCK_TOKEN_PATTERN.test(token)) {
      return { error: 'license-invalid-code' };
    }
    return { tier: 'yearly', key, expiresAt: now + YEAR_MS };
  }

  if (key.startsWith(MOCK_LIFETIME_PREFIX)) {
    const token = key.slice(MOCK_LIFETIME_PREFIX.length);
    if (!MOCK_TOKEN_PATTERN.test(token)) {
      return { error: 'license-invalid-code' };
    }
    return { tier: 'lifetime', key, expiresAt: 0 };
  }

  if (key.startsWith(MOCK_ORDER_PREFIX)) {
    const orderId = key.slice(MOCK_ORDER_PREFIX.length);
    if (!MOCK_ORDER_PATTERN.test(orderId)) {
      return { error: 'license-invalid-code' };
    }
    if (key === 'ORDER-202608110001') {
      return { tier: 'yearly', key, expiresAt: now + YEAR_MS };
    }
    if (key === 'ORDER-202608110002') {
      return { tier: 'lifetime', key, expiresAt: 0 };
    }
    return { error: 'license-order-not-found' };
  }

  return { error: 'license-invalid-code' };
}

/**
 * 创建许可证管理器。
 *
 * options：
 * - settings：{ readSettings, writeSettings }（主进程传 secure-settings 实例，
 *   测试可传 store 包装对象）
 * - baseDir：runtime 数据目录（license-state.json 落盘位置）
 * - now：可选时间函数（测试过期/吊销用）
 * - revokedKeys：可选额外吊销清单
 * - logger：可选告警函数
 */
function createLicenseManager(options) {
  const opts = options || {};
  const settingsStore = opts.settings;
  const baseDir = opts.baseDir || '.';
  const stateFile = opts.stateFile || path.join(baseDir, 'license-state.json');
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const logger =
    typeof opts.logger === 'function'
      ? opts.logger
      : (message) => console.warn(`[license] ${message}`);

  const revoked = new Set(MOCK_REVOKED_KEYS);
  for (const key of opts.revokedKeys || []) {
    if (typeof key === 'string' && key.trim()) {
      revoked.add(key.trim().toUpperCase());
    }
  }

  let deviceIdCache = null;

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

  function readSettings() {
    return settingsStore && typeof settingsStore.readSettings === 'function'
      ? settingsStore.readSettings()
      : {};
  }

  function writeSettings(patch) {
    if (
      !settingsStore ||
      typeof settingsStore.writeSettings !== 'function'
    ) {
      throw new Error('license-settings-store-unavailable');
    }
    return settingsStore.writeSettings(patch);
  }

  /**
   * 当前机器设备 ID：由主机名+用户名+平台派生（确定性），
   * 拷贝 settings.json 到其他设备会触发 device-mismatch。
   * MVP 用系统信息哈希；正式版可替换为机器码/TPM。
   */
  function computeDeviceId() {
    let username = '';
    try {
      username = os.userInfo().username;
    } catch (_error) {
      username = '';
    }
    const anchor = `${os.hostname()}|${username}|${os.platform()}|${os.arch()}`;
    const digest = crypto
      .createHash('sha256')
      .update(anchor)
      .digest('hex')
      .slice(0, 16);
    return `dev-${digest}`;
  }

  /** 设备 ID：机器派生值，首次使用时写入 settings.json（设备绑定锚点） */
  function getDeviceId() {
    if (!deviceIdCache) {
      deviceIdCache = computeDeviceId();
    }
    const current = readSettings();
    const stored =
      typeof current.deviceId === 'string' ? current.deviceId.trim() : '';
    if (stored) {
      return deviceIdCache;
    }
    try {
      writeSettings({ deviceId: deviceIdCache });
    } catch (error) {
      logger(`deviceId 持久化失败：${error && error.message ? error.message : error}`);
    }
    return deviceIdCache;
  }

  function normalizeTier(value) {
    return TIERS.includes(value) ? value : 'free';
  }

  function isRevokedKey(key) {
    return revoked.has(String(key || '').trim().toUpperCase());
  }

  /**
   * 当前许可证状态：
   * - inactive：无激活码
   * - active：有效
   * - expired：订阅已过期（effectiveTier 降为 free）
   * - revoked：激活码已被吊销（effectiveTier 降为 free）
   * - device-mismatch：激活码绑定其他设备（effectiveTier 降为 free）
   */
  function getStatus() {
    const current = readSettings();
    const deviceId = getDeviceId();
    const tier = normalizeTier(current.licenseTier);
    const licenseKey =
      typeof current.licenseKey === 'string' ? current.licenseKey.trim() : '';
    const rawExpiresAt = Number(current.licenseExpiresAt);
    const expiresAt =
      Number.isFinite(rawExpiresAt) && rawExpiresAt > 0
        ? Math.floor(rawExpiresAt)
        : 0;
    const hasLicense = Boolean(licenseKey);
    const deviceBound =
      !hasLicense ||
      (typeof current.deviceId === 'string' && current.deviceId.trim() === deviceId);

    let status = 'inactive';
    let effectiveTier = 'free';
    if (hasLicense && !deviceBound) {
      status = 'device-mismatch';
    } else if (hasLicense && isRevokedKey(licenseKey)) {
      status = 'revoked';
    } else if (hasLicense && tier === 'yearly' && expiresAt > 0 && expiresAt <= nowFn()) {
      status = 'expired';
    } else if (hasLicense) {
      status = 'active';
      effectiveTier = tier;
    }

    return {
      tier,
      effectiveTier,
      status,
      licenseKey: maskLicenseKey(licenseKey),
      expiresAt,
      deviceId,
      deviceBound,
      complianceAccepted: current.complianceAccepted === true
    };
  }

  /** 读取当前周期云 AI 额度使用量 */
  function getCloudUsage() {
    const status = getStatus();
    const quota = CLOUD_QUOTA[status.effectiveTier] || CLOUD_QUOTA.free;
    const state = readState();
    const buckets =
      state.quota && typeof state.quota === 'object' ? state.quota : {};
    const bucket =
      buckets[quota.period] && typeof buckets[quota.period] === 'object'
        ? buckets[quota.period]
        : {};
    const now = new Date(nowFn());
    const key = quota.period === 'day' ? toDateKey(now) : toMonthKey(now);
    const rawUsed = Number(bucket[key]);
    const used = Number.isFinite(rawUsed) && rawUsed > 0 ? Math.floor(rawUsed) : 0;
    const remaining = Math.max(0, quota.limit - used);
    return {
      period: quota.period,
      limit: quota.limit,
      used,
      remaining,
      canUse: remaining > 0
    };
  }

  /** 记录一次云 AI 使用（调用方应先用 consumeCloudQuota 判断额度） */
  function recordCloudUsage(count) {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
    const status = getStatus();
    const quota = CLOUD_QUOTA[status.effectiveTier] || CLOUD_QUOTA.free;
    const state = readState();
    const buckets =
      state.quota && typeof state.quota === 'object' ? state.quota : {};
    const bucket =
      buckets[quota.period] && typeof buckets[quota.period] === 'object'
        ? { ...buckets[quota.period] }
        : {};
    const now = new Date(nowFn());
    const key = quota.period === 'day' ? toDateKey(now) : toMonthKey(now);
    const prev = Number(bucket[key]);
    bucket[key] = (Number.isFinite(prev) && prev > 0 ? Math.floor(prev) : 0) + n;
    writeState({ ...state, quota: { ...buckets, [quota.period]: bucket } });
    return getCloudUsage();
  }

  /** 原子化的额度消费：额度不足时返回 error=license-quota-exceeded */
  function consumeCloudQuota() {
    const usage = getCloudUsage();
    if (!usage.canUse) {
      return { ok: false, error: 'license-quota-exceeded', usage };
    }
    const next = recordCloudUsage(1);
    return { ok: true, usage: next };
  }

  /** 渲染层/设置页展示用的完整状态 */
  function getPublicStatus() {
    const status = getStatus();
    const entitlements = entitlementsForTier(status.effectiveTier);
    const usage = getCloudUsage();
    return {
      ...status,
      entitlements,
      quota: {
        period: usage.period,
        limit: usage.limit,
        used: usage.used,
        remaining: usage.remaining,
        canUse: usage.canUse
      }
    };
  }

  /** 激活：校验激活码/订单号 → 绑定当前设备 → 持久化 */
  function activate(code) {
    const parsed = parseActivationCode(code, nowFn(), { revoked });
    if (!parsed.tier) {
      return { ok: false, error: parsed.error };
    }
    const deviceId = getDeviceId();
    try {
      writeSettings({
        licenseTier: parsed.tier,
        licenseKey: parsed.key,
        licenseExpiresAt: parsed.expiresAt,
        deviceId
      });
    } catch (error) {
      logger(`激活持久化失败：${error && error.message ? error.message : error}`);
      return { ok: false, error: 'license-persist-failed' };
    }
    return { ok: true, status: getPublicStatus() };
  }

  /** 注销激活：回到免费档（保留 deviceId 与 complianceAccepted） */
  function deactivate() {
    try {
      writeSettings({
        licenseTier: 'free',
        licenseKey: '',
        licenseExpiresAt: 0
      });
    } catch (error) {
      logger(`注销激活持久化失败：${error && error.message ? error.message : error}`);
      return { ok: false, error: 'license-persist-failed' };
    }
    return { ok: true, status: getPublicStatus() };
  }

  /**
   * 支付回调联动（T-41）：按支付订单激活对应档位（yearly/lifetime）。
   * 由 payment.js 在验签与幂等通过后调用；许可证键为 PAY-<orderId>。
   */
  function activateByPayment(orderId, tier) {
    const normalizedTier = normalizeTier(tier);
    if (normalizedTier !== 'yearly' && normalizedTier !== 'lifetime') {
      return { ok: false, error: 'license-invalid-tier' };
    }
    const normalizedOrderId =
      typeof orderId === 'string' ? orderId.trim() : '';
    if (!normalizedOrderId || normalizedOrderId.length > 96) {
      return { ok: false, error: 'license-invalid-order-id' };
    }
    const deviceId = getDeviceId();
    const expiresAt = normalizedTier === 'yearly' ? nowFn() + YEAR_MS : 0;
    try {
      writeSettings({
        licenseTier: normalizedTier,
        licenseKey: `PAY-${normalizedOrderId}`,
        licenseExpiresAt: expiresAt,
        deviceId
      });
    } catch (error) {
      logger(
        `支付升档持久化失败：${error && error.message ? error.message : error}`
      );
      return { ok: false, error: 'license-persist-failed' };
    }
    return { ok: true, status: getPublicStatus() };
  }

  /**
   * 支付退款/取消联动（T-41）：仅当当前许可证由该订单激活时降级为免费，
   * 避免误伤其他订单/激活码激活的许可证。
   */
  function downgradeByPayment(orderId) {
    const normalizedOrderId =
      typeof orderId === 'string' ? orderId.trim() : '';
    const current = readSettings();
    const licenseKey =
      typeof current.licenseKey === 'string' ? current.licenseKey.trim() : '';
    if (!normalizedOrderId || licenseKey !== `PAY-${normalizedOrderId}`) {
      return { ok: true, status: getPublicStatus(), untouched: true };
    }
    const result = deactivate();
    return { ...result, untouched: false };
  }

  /**
   * 支付回调桩（T-41 接入真实支付）。
   * 当前仅支持本地 mock 订单号激活：不触网、不收款、不写任何密钥。
   */
  async function handlePaymentCallback(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const code =
      typeof data.code === 'string'
        ? data.code
        : typeof data.orderId === 'string'
          ? data.orderId
          : '';
    if (!code.trim()) {
      return { ok: false, error: 'license-payment-not-implemented' };
    }
    return activate(code);
  }

  return {
    getStatus,
    getPublicStatus,
    getDeviceId,
    activate,
    deactivate,
    activateByPayment,
    downgradeByPayment,
    getCloudUsage,
    recordCloudUsage,
    consumeCloudQuota,
    handlePaymentCallback
  };
}

module.exports = {
  createLicenseManager,
  TIERS,
  CLOUD_QUOTA,
  LICENSE_KEY_MAX_LENGTH,
  parseActivationCode,
  entitlementsForTier,
  maskLicenseKey,
  MOCK_REVOKED_KEYS
};

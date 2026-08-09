'use strict';

/**
 * T-11 崩溃上报与本地日志（ADR-017）
 *
 * 职责：
 * - 安装 process 级未捕获异常 / unhandledRejection 监听，写入
 *   userData/logs/app.log，并保持进程存活（避免崩溃后静默消失）。
 * - 初始化 Electron crashReporter：仅本地 dump、不上传；dump 目录默认
 *   userData/crashes，可通过环境变量 AI_PET_CRASH_DUMP_DIR 或
 *   initCrash({ dumpDir }) 覆盖。
 */

const fs = require('fs');
const path = require('path');
const { app, crashReporter } = require('electron');

/** dump 目录环境变量名（相对/绝对路径均可，绝对路径优先于默认目录） */
const ENV_CRASH_DUMP_DIR = 'AI_PET_CRASH_DUMP_DIR';
const LOG_DIR = 'logs';
const LOG_FILE = 'app.log';
const DEFAULT_DUMP_DIR = 'crashes';

let logFilePath = null;
let started = false;

function getLogDir() {
  return path.join(app.getPath('userData'), LOG_DIR);
}

function getDefaultLogFile() {
  return path.join(getLogDir(), LOG_FILE);
}

function ensureLogFile() {
  if (logFilePath) return logFilePath;
  fs.mkdirSync(getLogDir(), { recursive: true });
  logFilePath = getDefaultLogFile();
  return logFilePath;
}

function formatTimestamp() {
  return new Date().toISOString();
}

function describeError(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_error) {
    serialized = String(value);
  }
  return serialized || String(value);
}

/**
 * 追加一行日志。同步写入，保证异常处理路径中日志已落盘。
 */
function writeLog(level, message) {
  const file = ensureLogFile();
  const line = `[${formatTimestamp()}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch (error) {
    // 日志写入失败不能再抛出，避免在异常处理器中递归崩溃
    console.error(`[crash] 日志写入失败: ${error && error.message ? error.message : error}`);
  }
}

function handleUncaughtException(error) {
  const detail = describeError(error);
  writeLog('uncaughtException', `未捕获异常: ${detail}`);
  // 保持进程存活：崩溃留痕后应用继续运行，避免“静默退出”
  console.error(`[crash] 已记录未捕获异常到 ${ensureLogFile()}:\n${detail}`);
}

function handleUnhandledRejection(reason) {
  const detail = describeError(reason);
  writeLog('unhandledRejection', `未处理的 Promise 拒绝: ${detail}`);
  // 同上：留痕后继续运行
  console.error(`[crash] 已记录未处理的 Promise 拒绝到 ${ensureLogFile()}:\n${detail}`);
}

// require 时立即安装进程级监听，覆盖应用启动早期的错误
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);

/**
 * 初始化 crashReporter。应在 app ready 前尽早调用。
 * 重复调用幂等，返回当前状态。
 *
 * @param {{ dumpDir?: string }} [options]
 * @returns {{ dumpDir: string, logFile: string, uploadToServer: boolean }}
 */
function initCrash(options = {}) {
  if (started) return getState();

  const configuredDir = process.env[ENV_CRASH_DUMP_DIR] || options.dumpDir || '';
  const dumpDir = configuredDir
    ? path.resolve(configuredDir)
    : path.join(app.getPath('userData'), DEFAULT_DUMP_DIR);

  app.setPath('crashDumps', dumpDir);
  fs.mkdirSync(dumpDir, { recursive: true });

  crashReporter.start({
    productName: app.getName(),
    // 仅本地留痕，不向任何服务上传（ADR-017：远程上报预留、默认关闭）
    uploadToServer: false,
    // 本地调试不希望被限流，因此关闭 1 次/小时限制
    rateLimit: false,
    compress: true,
    globalExtra: {
      _companyName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron || ''
    }
  });

  started = true;
  writeLog('info', `crashReporter 已启动：dump 目录=${dumpDir}，日志=${ensureLogFile()}`);
  return getState();
}

function getState() {
  return {
    dumpDir: app.getPath('crashDumps'),
    logFile: logFilePath || getDefaultLogFile(),
    uploadToServer: crashReporter.getUploadToServer()
  };
}

module.exports = {
  initCrash,
  getState,
  writeLog
};

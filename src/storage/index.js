'use strict';

const path = require('path');
const os = require('os');
const { createStore } = require('./store');

/**
 * 解析存储目录：
 * - Electron 环境：app.getPath('userData')
 * - 纯 Node 环境（单元测试）：用户主目录/.ai-desktop-pet
 */
function resolveBaseDir() {
  try {
    const electron = require('electron');
    if (
      electron &&
      typeof electron === 'object' &&
      typeof electron.app.getPath === 'function'
    ) {
      return electron.app.getPath('userData');
    }
  } catch (_error) {
    // 非 Electron 环境，走回退目录
  }
  return path.join(os.homedir(), '.ai-desktop-pet');
}

function createDefaultStore() {
  return createStore(resolveBaseDir());
}

module.exports = { createStore, createDefaultStore, resolveBaseDir };

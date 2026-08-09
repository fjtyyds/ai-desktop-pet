'use strict';

const { app, ipcMain } = require('electron');
const { getSettings, updateSettings } = require('../storage/settings-store');
const { appendMessage } = require('../storage/message-store');
const { sendChatMessage } = require('../llm');

let registered = false;

/**
 * 注册 petAPI 对应的 IPC handler。
 * 协调者在 src/main/main.js 中 require('./ipc') 后自动调用。
 */
function registerIpcHandlers() {
  if (registered) return;
  registered = true;

  ipcMain.handle('chat:send', async (_event, payload) => {
    const text = payload?.text;
    const history = Array.isArray(payload?.history) ? payload.history : [];
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, reply: '', error: '消息不能为空' };
    }

    const settings = await getSettings();
    await appendMessage({ role: 'user', content: text.trim() });

    const result = await sendChatMessage({
      text: text.trim(),
      history,
      settings
    });

    if (result.ok) {
      await appendMessage({ role: 'assistant', content: result.reply });
    }
    return result;
  });

  ipcMain.handle('settings:get', async () => getSettings());

  ipcMain.handle('settings:set', async (_event, patch) => {
    const safePatch =
      patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    return updateSettings(safePatch);
  });
}

if (app.isReady()) {
  registerIpcHandlers();
} else {
  app.whenReady().then(registerIpcHandlers);
}

module.exports = { registerIpcHandlers };

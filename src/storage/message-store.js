'use strict';

const { app } = require('electron');
const path = require('path');
const { readJson, updateJson } = require('./json-store');

function messagesFilePath() {
  return path.join(app.getPath('userData'), 'messages.json');
}

async function listMessages() {
  const messages = await readJson(messagesFilePath(), []);
  return Array.isArray(messages) ? messages : [];
}

async function appendMessage(message) {
  return updateJson(messagesFilePath(), [], (messages) => {
    const next = Array.isArray(messages) ? messages : [];
    next.push({
      role: message.role,
      content: message.content,
      timestamp: new Date().toISOString()
    });
    return next;
  });
}

module.exports = { listMessages, appendMessage };

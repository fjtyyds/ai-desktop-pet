'use strict';

const { app } = require('electron');
const path = require('path');
const { DEFAULT_MODEL } = require('../shared/contracts');
const { readJson, updateJson } = require('./json-store');

const DEFAULTS = Object.freeze({
  apiKey: '',
  model: DEFAULT_MODEL,
  petName: 'AI 桌宠'
});

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function getSettings() {
  const saved = await readJson(settingsFilePath(), {});
  return { ...DEFAULTS, ...saved };
}

async function updateSettings(patch = {}) {
  const allowed = new Set(Object.keys(DEFAULTS));
  return updateJson(settingsFilePath(), {}, (current) => {
    const next = { ...DEFAULTS, ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) next[key] = value;
    }
    return next;
  });
}

module.exports = { getSettings, updateSettings };

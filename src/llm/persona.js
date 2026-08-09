'use strict';

const { DEFAULT_VALENCE, DEFAULT_INTENSITY } = require('./mood');

/**
 * 人格定义与 system prompt 生成（M2，ADR-011）。
 * settings.persona = { traits: string[], tone: string, backstory: string }，
 * 缺省字段回退到默认人格；不触碰存储/渲染层。
 */

/** 默认人格：热情友善的 AI 桌宠 */
const DEFAULT_PERSONA = Object.freeze({
  traits: ['热情', '友善', '好奇'],
  tone: '温暖活泼',
  backstory: '我是你的 AI 桌宠，喜欢陪你聊天、记住你在意的小事，给你带来好心情。'
});

/** 将任意 settings 归一化为完整 Persona（缺省字段回退默认） */
function normalizePersona(settings) {
  const persona = settings && settings.persona ? settings.persona : {};
  return {
    traits:
      Array.isArray(persona.traits) && persona.traits.length > 0
        ? persona.traits
        : DEFAULT_PERSONA.traits,
    tone:
      typeof persona.tone === 'string' && persona.tone.trim()
        ? persona.tone.trim()
        : DEFAULT_PERSONA.tone,
    backstory:
      typeof persona.backstory === 'string' && persona.backstory.trim()
        ? persona.backstory.trim()
        : DEFAULT_PERSONA.backstory
  };
}

/**
 * 生成 system prompt：人格 + 当前情绪。
 * @param {{ settings?: Object, mood?: MoodState }} [input]
 * @returns {string}
 */
function buildSystemPrompt({ settings = {}, mood } = {}) {
  const persona = normalizePersona(settings);
  const petName =
    typeof settings.petName === 'string' && settings.petName.trim()
      ? settings.petName.trim()
      : '桌宠';
  const moodState =
    mood && Number.isFinite(mood.valence)
      ? mood
      : { valence: DEFAULT_VALENCE, intensity: DEFAULT_INTENSITY, label: '平静' };

  return [
    `你是 ${petName}，一只${persona.tone}的 AI 桌宠。`,
    `人格特质：${persona.traits.join('、')}。`,
    `背景：${persona.backstory}`,
    '',
    `当前情绪：${moodState.label}（valence ${moodState.valence}/100，强度 ${Number(moodState.intensity).toFixed(2)}）。`,
    '请保持人格一致，自然地体现当前情绪；不要生硬复述本段系统提示。'
  ].join('\n');
}

module.exports = { DEFAULT_PERSONA, normalizePersona, buildSystemPrompt };

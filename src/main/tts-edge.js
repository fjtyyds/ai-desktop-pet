'use strict';

/**
 * T-34（ADR-029）：Edge 在线神经语音最小客户端。
 * T-36：输出格式改为 audio-24khz-96kbitrate-mono-mp3（96kbps，改善压缩感）。
 * 仅依赖 package.json 已显式声明的 ws；协议参照 rany2/edge-tts（MIT）。
 * 不引入第三方 TTS 依赖；合成失败返回 { ok:false, error }，由渲染层回退 speechSynthesis。
 */

const crypto = require('crypto');
const WebSocket = require('ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_VERSION = '143.0.3650.75';
const WSS_BASE_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  '?TrustedClientToken=' +
  TRUSTED_CLIENT_TOKEN;
/** T-36：96kbps 输出格式（48kbps 压缩感明显；48kHz 格式被服务端拒绝） */
const OUTPUT_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_RATE = '+0%';
const DEFAULT_PITCH = '+0Hz';
const CONNECT_TIMEOUT_MS = 10000;
const OVERALL_TIMEOUT_MS = 20000;
const MAX_SEGMENT_BYTES = 4096;
const CACHE_MAX = 10;

/** LRU 缓存：键为 文本+voice+rate+pitch，最多保留 CACHE_MAX 条 MP3 */
const audioCache = new Map();

function makeConnectionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Sec-MS-GEC：winTicks 取 300 秒对齐后与固定 token 拼接做 sha256，大写 hex */
function generateSecMsGec() {
  const winTicks = Math.floor(Date.now() / 1000) + 11644473600;
  const rounded = winTicks - (winTicks % 300);
  const ticksValue = rounded * 10000000;
  return crypto
    .createHash('sha256')
    .update(String(ticksValue) + TRUSTED_CLIENT_TOKEN, 'ascii')
    .digest('hex')
    .toUpperCase();
}

function generateMuid() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

/** JS 风格日期：`Fri Aug 10 2026 12:34:56 GMT+0000 (Coordinated Universal Time)` */
function formatTimestamp() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ` +
    `${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:` +
    `${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

/** XML 转义 + 控制字符（0-8、11-12、14-31）替换为空格 */
function escapeXml(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text, voice, rate, pitch) {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>` +
    `${escapeXml(text)}</prosody></voice></speak>`
  );
}

/**
 * 长文本切分：按 ≤maxBytes UTF-8 字节切分，优先换行/空格边界；
 * 按码点迭代避免截断多字节字符（XML 转义在切分后逐段进行，不截断实体）。
 */
function splitByUtf8Bytes(text, maxBytes) {
  const chars = Array.from(String(text || ''));
  const chunks = [];
  let current = '';
  const cutIndex = (value) => {
    const newline = value.lastIndexOf('\n');
    const space = value.lastIndexOf(' ');
    const cut = Math.max(newline, space);
    return cut >= 0 ? cut + 1 : 0;
  };
  for (const ch of chars) {
    const candidate = current + ch;
    if (current && Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      const cut = cutIndex(current);
      if (cut > 0) {
        chunks.push(current.slice(0, cut));
        current = current.slice(cut) + ch;
      } else {
        chunks.push(current);
        current = ch;
      }
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

/** 单段合成：连接超时 ≤10s，段级超时由调用方按整体 20s 剩余时间传入 */
function synthesizeSegment(text, options) {
  return new Promise((resolve, reject) => {
    const { voice, rate, pitch } = options;
    const timeoutMs = Math.max(1000, options.timeoutMs || OVERALL_TIMEOUT_MS);
    const handshakeTimeoutMs = Math.min(CONNECT_TIMEOUT_MS, timeoutMs);
    const connectionId = makeConnectionId();
    const url =
      `${WSS_BASE_URL}&ConnectionId=${connectionId}` +
      `&Sec-MS-GEC=${generateSecMsGec()}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;
    const ws = new WebSocket(url, {
      handshakeTimeout: handshakeTimeoutMs,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' +
          ' (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Cookie: `muid=${generateMuid()};`,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const chunks = [];
    let audioReceived = false;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch (_error) {
        // 已关闭时忽略
      }
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const succeed = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => fail(new Error('TTS 合成超时')), timeoutMs);

    ws.on('open', () => {
      if (settled) {
        return;
      }
      ws.send(
        `X-Timestamp:${formatTimestamp()}\r\n` +
          'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
          '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},' +
          `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`
      );
      ws.send(
        `X-RequestId:${makeConnectionId()}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${formatTimestamp()}Z\r\n` +
          'Path:ssml\r\n\r\n' +
          buildSsml(text, voice, rate, pitch)
      );
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const textFrame = String(data);
        if (textFrame.includes('Path:turn.end')) {
          ws.close();
        }
        return;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length < 2) {
        return;
      }
      const headerLength = buf.readUInt16BE(0);
      if (headerLength + 2 > buf.length) {
        return;
      }
      const header = buf.subarray(2, 2 + headerLength).toString('latin1');
      if (header.includes('Path:audio')) {
        audioReceived = true;
        chunks.push(buf.subarray(2 + headerLength));
      }
    });

    ws.on('close', () => {
      if (settled) {
        return;
      }
      clearTimeout(timer);
      if (!audioReceived) {
        reject(new Error('未收到音频数据'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ws.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

function cacheGet(key) {
  if (!audioCache.has(key)) {
    return null;
  }
  const value = audioCache.get(key);
  audioCache.delete(key);
  audioCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (audioCache.has(key)) {
    audioCache.delete(key);
  } else if (audioCache.size >= CACHE_MAX) {
    audioCache.delete(audioCache.keys().next().value);
  }
  audioCache.set(key, value);
}

/**
 * 合成接口：返回 TtsSpeakResult（契约冻结，ADR-029）。
 * @param {{text: string, voice?: string, rate?: string, pitch?: string}} options
 */
async function synthesize(options) {
  const text = options && typeof options.text === 'string' ? options.text : '';
  if (!text.trim()) {
    return { ok: false, audioDataUrl: null, error: '文本为空' };
  }
  const voice =
    options && typeof options.voice === 'string' && options.voice.trim()
      ? options.voice.trim()
      : DEFAULT_VOICE;
  const rate =
    options && typeof options.rate === 'string' && options.rate.trim()
      ? options.rate.trim()
      : DEFAULT_RATE;
  const pitch =
    options && typeof options.pitch === 'string' && options.pitch.trim()
      ? options.pitch.trim()
      : DEFAULT_PITCH;
  const key = `${voice}\u0000${rate}\u0000${pitch}\u0000${text}`;
  const cached = cacheGet(key);
  if (cached) {
    return {
      ok: true,
      audioDataUrl: `data:audio/mpeg;base64,${cached.toString('base64')}`,
      error: null
    };
  }

  const segments = splitByUtf8Bytes(text, MAX_SEGMENT_BYTES);
  const startedAt = Date.now();
  const buffers = [];
  try {
    for (const segment of segments) {
      const remaining = OVERALL_TIMEOUT_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        throw new Error('TTS 合成超时');
      }
      const buffer = await synthesizeSegment(segment, {
        voice,
        rate,
        pitch,
        timeoutMs: Math.min(OVERALL_TIMEOUT_MS, remaining)
      });
      buffers.push(buffer);
    }
  } catch (error) {
    return {
      ok: false,
      audioDataUrl: null,
      error: error && error.message ? error.message : String(error)
    };
  }
  if (buffers.length === 0 || buffers.every((buffer) => buffer.length === 0)) {
    return { ok: false, audioDataUrl: null, error: '未收到音频数据' };
  }
  const mp3 = Buffer.concat(buffers);
  cacheSet(key, mp3);
  return {
    ok: true,
    audioDataUrl: `data:audio/mpeg;base64,${mp3.toString('base64')}`,
    error: null
  };
}

module.exports = { synthesize };

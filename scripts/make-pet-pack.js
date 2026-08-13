'use strict';

/**
 * T-62 动画宠物包生成脚本（可复用，零新增 npm 依赖）。
 *
 * 用法（Electron 主进程运行）：
 *   node_modules\.bin\electron scripts/make-pet-pack.js
 *
 * 行为：
 * - 创建隐藏 BrowserWindow，用 renderer canvas 2D 以 16×16 逻辑网格绘制像素画；
 * - 按 8 列×9 行动画图集导出 spritesheet.webp（单元格 128×128，整体 1024×1152）；
 * - 同时导出 preview.webp（256×256 预览图）；
 * - 行语义与 src/renderer/overlay.js STATE_ROWS 一致：
 *   row0 idle（呼吸/眨眼）/ row1 walk-right / row2 walk-left /
 *   row3 speaking/waving / row4 excited/jumping / row5 sad/failed /
 *   row6 attention/waiting / row7 working / row8 ready；每行 8 帧，帧序从左到右。
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(
  __dirname,
  '..',
  'src',
  'main',
  'default-skins',
  'pixel-pet'
);
const CELL = 128;
const COLS = 8;
const ROWS = 9;

/** 在 renderer 中执行的全部绘制逻辑（纯 canvas，无 Node 依赖） */
function rendererMain() {
  const G = 16;
  const CELL = 128;
  const COLS = 8;
  const ROWS = 9;

  const P = {
    outline: '#3a2d32',
    body: '#ffd166',
    belly: '#fff1c2',
    ear: '#ff9f68',
    cheek: '#ff8fa3',
    eye: '#2d232e',
    white: '#ffffff',
    feet: '#ff9f68',
    mouth: '#2d232e',
    accent: '#ef476f',
    tear: '#6cc4ff',
    sweat: '#8ad0ff',
    spark: '#ffd166'
  };

  const grid = () =>
    Array.from({ length: G }, () => new Array(G).fill(null));
  const put = (g, x, y, c) => {
    if (x >= 0 && x < G && y >= 0 && y < G) g[y][x] = c;
  };
  const rect = (g, x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) put(g, x, y, c);
    }
  };
  const px = (g, pts, c) => {
    for (const [x, y] of pts) put(g, x, y, c);
  };
  const flip = (g) => {
    const out = grid();
    for (let y = 0; y < G; y += 1) {
      for (let x = 0; x < G; x += 1) out[y][G - 1 - x] = g[y][x];
    }
    return out;
  };

  function drawPet(g, opts = {}) {
    const dx = opts.dx || 0;
    const dy = opts.dy || 0;
    const footL = opts.footL || 0;
    const footR = opts.footR || 0;
    const blink = Boolean(opts.blink);
    const pupilX = opts.pupilX || 0;
    const mouth = opts.mouth || 'small';
    const ears = opts.ears || 'up';
    const arms = opts.arms || 'down';
    const wave = opts.wave || 0;
    const ty = opts.ty || 0;
    const tear = Boolean(opts.tear);
    const sweat = Boolean(opts.sweat);
    const cheek = Boolean(opts.cheek);
    const spark = Boolean(opts.spark);

    // 耳朵（立耳或垂耳）
    if (ears === 'up') {
      rect(g, 2 + dx, 3 + dy, 3, 3, P.outline);
      rect(g, 3 + dx, 4 + dy, 1, 2, P.ear);
      rect(g, 11 + dx, 3 + dy, 3, 3, P.outline);
      rect(g, 12 + dx, 4 + dy, 1, 2, P.ear);
    } else {
      rect(g, 1 + dx, 4 + dy, 3, 2, P.outline);
      rect(g, 2 + dx, 5 + dy, 1, 1, P.ear);
      rect(g, 12 + dx, 4 + dy, 3, 2, P.outline);
      rect(g, 13 + dx, 5 + dy, 1, 1, P.ear);
    }

    // 天线
    rect(g, 7 + dx, 1 + dy, 2, 2, P.accent);
    rect(g, 7 + dx, 3 + dy, 1, 1, P.accent);

    // 身体（含 1px 描边与肚皮）
    rect(g, 3 + dx, 5 + dy, 10, 8, P.outline);
    rect(g, 4 + dx, 6 + dy, 8, 6, P.body);
    rect(g, 5 + dx, 8 + dy, 6, 4, P.belly);

    // 手臂
    if (arms === 'down') {
      rect(g, 1 + dx, 8 + dy, 2, 3, P.body);
      rect(g, 13 + dx, 8 + dy, 2, 3, P.body);
    } else if (arms === 'up') {
      rect(g, 0 + dx, 3 + dy, 2, 4, P.body);
      rect(g, 14 + dx, 3 + dy, 2, 4, P.body);
      rect(g, 0 + dx, 2 + dy, 1, 1, P.accent);
      rect(g, 15 + dx, 2 + dy, 1, 1, P.accent);
    } else if (arms === 'wave') {
      rect(g, 1 + dx, 8 + dy, 2, 3, P.body);
      rect(g, 13 + dx, 6 + dy + wave, 2, 2, P.body);
      rect(g, 14 + dx, 5 + dy + wave, 1, 1, P.accent);
    } else if (arms === 'sad') {
      rect(g, 1 + dx, 9 + dy, 2, 2, P.body);
      rect(g, 13 + dx, 9 + dy, 2, 2, P.body);
    } else if (arms === 'type') {
      rect(g, 2 + dx, 9 + dy + ty, 2, 2, P.body);
      rect(g, 12 + dx, 9 + dy - ty, 2, 2, P.body);
    }

    // 脚
    rect(g, 4 + dx + footL, 12 + dy, 3, 2, P.feet);
    rect(g, 9 + dx + footR, 12 + dy, 3, 2, P.feet);

    // 脸
    if (blink) {
      rect(g, 5 + dx + pupilX, 8 + dy, 2, 1, P.eye);
      rect(g, 9 + dx + pupilX, 8 + dy, 2, 1, P.eye);
    } else {
      rect(g, 5 + dx + pupilX, 7 + dy, 2, 2, P.white);
      rect(g, 9 + dx + pupilX, 7 + dy, 2, 2, P.white);
      rect(g, 6 + dx + pupilX, 8 + dy, 1, 1, P.eye);
      rect(g, 10 + dx + pupilX, 8 + dy, 1, 1, P.eye);
    }
    if (cheek) {
      px(g, [[4 + dx, 9 + dy], [11 + dx, 9 + dy]], P.cheek);
    }
    if (mouth === 'small') {
      rect(g, 7 + dx, 9 + dy, 2, 1, P.mouth);
    } else if (mouth === 'open') {
      rect(g, 7 + dx, 9 + dy, 2, 2, P.mouth);
    } else if (mouth === 'smile') {
      rect(g, 6 + dx, 9 + dy, 4, 1, P.mouth);
      px(g, [[6 + dx, 8 + dy], [9 + dx, 8 + dy]], P.mouth);
    } else if (mouth === 'frown') {
      rect(g, 6 + dx, 10 + dy, 4, 1, P.mouth);
      px(g, [[6 + dx, 9 + dy], [9 + dx, 9 + dy]], P.mouth);
    } else if (mouth === 'o') {
      px(
        g,
        [
          [7 + dx, 9 + dy],
          [8 + dx, 9 + dy],
          [7 + dx, 10 + dy],
          [8 + dx, 10 + dy]
        ],
        P.mouth
      );
    }

    // 泪珠 / 汗珠 / 彩星
    if (tear) {
      px(g, [[4 + dx, 10 + dy], [4 + dx, 11 + dy], [5 + dx, 11 + dy]], P.tear);
    }
    if (sweat) {
      px(g, [[13 + dx, 5 + dy], [13 + dx, 6 + dy], [12 + dx, 6 + dy]], P.sweat);
    }
    if (spark) {
      px(
        g,
        [
          [0, 0],
          [1, 0],
          [15, 0],
          [14, 0],
          [0, 15],
          [1, 15],
          [15, 15],
          [14, 15]
        ],
        P.spark
      );
    }
  }

  function buildFrame(row, f) {
    const g = grid();
    const opts = {};
    if (row === 0) {
      // idle：呼吸起伏 + 眨眼
      opts.dy = [0, -1, -1, 0, 1, 1, 0, 0][f];
      opts.blink = f === 6;
      opts.mouth = 'small';
      opts.arms = 'down';
      opts.cheek = true;
    } else if (row === 1) {
      // walk-right：左右脚交替 + 轻微起伏
      opts.dy = [0, -1, -1, 0, 0, -1, -1, 0][f];
      opts.footL = [0, 1, 1, 0, 0, -1, -1, 0][f];
      opts.footR = [0, -1, -1, 0, 0, 1, 1, 0][f];
      opts.mouth = 'small';
      opts.arms = 'down';
    } else if (row === 2) {
      // walk-left：右行走镜像
      return flip(buildFrame(1, f));
    } else if (row === 3) {
      // speaking/waving：挥手 + 嘴巴开合
      opts.arms = 'wave';
      opts.wave = [0, 1, 2, 2, 1, 0, 1, 2][f];
      opts.mouth = f % 2 === 0 ? 'open' : 'small';
      opts.cheek = true;
    } else if (row === 4) {
      // excited/jumping：跳跃弧线 + 高举双手
      opts.dy = [1, 0, -1, -2, -2, -1, 0, 1][f];
      opts.arms = 'up';
      opts.mouth = 'smile';
      opts.cheek = true;
    } else if (row === 5) {
      // sad/failed：垂耳低头 + 沮丧脸 + 泪珠
      opts.dy = 1;
      opts.ears = 'down';
      opts.arms = 'sad';
      opts.mouth = 'frown';
      opts.tear = f >= 2 && f <= 4;
    } else if (row === 6) {
      // attention/waiting：左右张望（瞳孔/身体平移）
      opts.pupilX = [-1, 0, 1, 1, 0, -1, -1, 0][f];
      opts.dx = [0, 1, 1, 0, 0, -1, -1, 0][f];
      opts.mouth = 'o';
      opts.arms = 'down';
    } else if (row === 7) {
      // working：打字起伏 + 汗珠
      opts.arms = 'type';
      opts.ty = [0, 1, 1, 0, 0, 1, 1, 0][f];
      opts.mouth = 'small';
      opts.sweat = f <= 3;
    } else if (row === 8) {
      // ready：欢呼跳跃 + 彩星
      opts.dy = [0, -1, -2, -1, 0, -1, -2, -1][f];
      opts.arms = 'up';
      opts.mouth = 'smile';
      opts.cheek = true;
      opts.spark = f === 1 || f === 4 || f === 6;
    }
    drawPet(g, opts);
    return g;
  }

  function renderGrid(ctx, g, size, x, y) {
    const mini = document.createElement('canvas');
    mini.width = G;
    mini.height = G;
    const mctx = mini.getContext('2d');
    for (let gy = 0; gy < G; gy += 1) {
      for (let gx = 0; gx < G; gx += 1) {
        const c = g[gy][gx];
        if (c) {
          mctx.fillStyle = c;
          mctx.fillRect(gx, gy, 1, 1);
        }
      }
    }
    ctx.drawImage(mini, x, y, size, size);
  }

  const sheet = document.createElement('canvas');
  sheet.width = CELL * COLS;
  sheet.height = CELL * ROWS;
  const ctx = sheet.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      renderGrid(ctx, buildFrame(row, col), CELL, col * CELL, row * CELL);
    }
  }

  const preview = document.createElement('canvas');
  preview.width = 256;
  preview.height = 256;
  const pctx = preview.getContext('2d');
  pctx.imageSmoothingEnabled = false;
  renderGrid(pctx, buildFrame(0, 0), 256, 0, 0);

  return {
    spritesheet: sheet.toDataURL('image/webp', 0.9),
    preview: preview.toDataURL('image/webp', 0.9)
  };
}

async function main() {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 400,
    webPreferences: { offscreen: true }
  });
  try {
    await win.loadURL('about:blank');
    const result = await win.webContents.executeJavaScript(
      `(${rendererMain.toString()})()`
    );
    if (
      !result ||
      typeof result.spritesheet !== 'string' ||
      !result.spritesheet.startsWith('data:image/webp;base64,') ||
      typeof result.preview !== 'string' ||
      !result.preview.startsWith('data:image/webp;base64,')
    ) {
      throw new Error('canvas 未导出 WebP（toDataURL 返回非 webp data URL）');
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const sheetBuf = Buffer.from(result.spritesheet.split(',')[1], 'base64');
    const previewBuf = Buffer.from(result.preview.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT_DIR, 'spritesheet.webp'), sheetBuf);
    fs.writeFileSync(path.join(OUT_DIR, 'preview.webp'), previewBuf);
    console.log(`[make-pet-pack] 已生成 ${OUT_DIR}`);
    console.log(
      `[make-pet-pack] spritesheet.webp ${sheetBuf.length} bytes (${CELL * COLS}x${CELL * ROWS})`
    );
    console.log(`[make-pet-pack] preview.webp ${previewBuf.length} bytes`);
    app.exit(0);
  } catch (error) {
    console.error(
      '[make-pet-pack] 生成失败:',
      error && error.stack ? error.stack : error
    );
    app.exit(1);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(main);

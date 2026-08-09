'use strict';

const fs = require('fs/promises');
const path = require('path');

// 进程内串行化所有 JSON 写入，避免并发覆盖
let writeQueue = Promise.resolve();

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function enqueue(task) {
  const next = writeQueue.then(task, task);
  writeQueue = next.catch(() => {});
  return next;
}

async function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 读 -> 修改 -> 写（进程内串行），返回修改后的数据。
 */
function updateJson(filePath, fallback, modify) {
  return enqueue(async () => {
    const current = await readJson(filePath, fallback);
    const next = await modify(current);
    await writeJson(filePath, next);
    return next;
  });
}

module.exports = { readJson, writeJson, updateJson };
